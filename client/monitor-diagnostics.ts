import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeSync,
  type BigIntStats,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export const MONITOR_DIAGNOSTIC_CODES = [
  'starting',
  'ready',
  'completed_once',
  'stopped',
  'not_authorized',
  'configuration_invalid',
  'configuration_changed',
  'authorization_changed',
  'authorization_unreadable',
  'credentials_unavailable',
  'clock_changed',
  'storage_database',
  'storage_wal',
  'storage_disk',
  'storage_unavailable',
  'lock_unavailable',
  'lock_changed',
  'supervision_failed',
  'runtime_failed',
] as const;
export type MonitorDiagnosticCode = (typeof MONITOR_DIAGNOSTIC_CODES)[number];
export type MonitorDiagnosticEvent = 'start' | 'ready' | 'finished';
export type MonitorProcessPresence = 'absent' | 'present-unverified' | 'unknown';

const MAX_RECORD_BYTES = 1_024;
const WRITE_THRESHOLD_BYTES = 1_048_576;
const READ_TAIL_BYTES = 65_536;
const codeSet = new Set<string>(MONITOR_DIAGNOSTIC_CODES);
const recordFields = new Set(['version', 'runId', 'pid', 'at', 'event', 'code']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DiagnosticRecord {
  version: 1;
  runId: string;
  pid: number;
  at: string;
  event: MonitorDiagnosticEvent;
  code: MonitorDiagnosticCode;
}

export interface MonitorDiagnosticRunStatus {
  runId: string;
  pid: number;
  startedAt: string | null;
  readyAt: string | null;
  lastEvent: MonitorDiagnosticEvent;
  code: MonitorDiagnosticCode;
  at: string;
  processPresence: MonitorProcessPresence;
}

export interface MonitorDiagnostics {
  checkedAt: string;
  latestAttempt: MonitorDiagnosticRunStatus | null;
  lastReadyRun: MonitorDiagnosticRunStatus | null;
  /** These describe missing evidence, never proof that monitoring has never run. */
  observations: Array<
    | 'tail_only'
    | 'invalid_records'
    | 'trailing_partial'
    | 'log_unavailable'
    | 'attempt_start_not_observed'
    | 'ready_not_observed'
  >;
  log: {
    exists: boolean | null;
    bytes: number | null;
    readBytes: number;
    /** Byte range is [fromByte, toByte); totalBytes is the last observed file size. */
    fromByte: number | null;
    toByte: number | null;
    totalBytes: number | null;
    coverage: 'complete' | 'tail' | 'unavailable';
    invalidRecords: number;
    trailingPartial: boolean;
    atCapacity: boolean | null;
  };
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function safeSize(stat: BigIntStats): number {
  if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('diagnostic_size_unavailable');
  return Number(stat.size);
}

function requireRegularFile(stat: BigIntStats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
    throw new Error('diagnostic_file_unavailable');
}

function checkedFile(file: string): BigIntStats {
  const stat = lstatSync(file, { bigint: true });
  requireRegularFile(stat);
  return stat;
}

function checkedDirectories(file: string, allowMissing = false): Map<string, BigIntStats> {
  const result = new Map<string, BigIntStats>();
  let directory = dirname(file);
  for (;;) {
    try {
      const stat = lstatSync(directory, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('diagnostic_directory_unavailable');
      result.set(directory, stat);
    } catch (error) {
      if (!(allowMissing && errorCode(error) === 'ENOENT')) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return result;
}

function requireDirectoriesUnchanged(directories: Map<string, BigIntStats>): void {
  for (const [path, before] of directories) {
    const after = lstatSync(path, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(before, after))
      throw new Error('diagnostic_directory_changed');
  }
}

function requireIdentity(file: string, descriptor: number, before: BigIntStats): BigIntStats {
  const opened = fstatSync(descriptor, { bigint: true });
  requireRegularFile(opened);
  const current = checkedFile(file);
  if (!sameIdentity(before, opened) || !sameIdentity(opened, current))
    throw new Error('diagnostic_file_changed');
  return opened;
}

function isRecord(value: unknown): value is DiagnosticRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== recordFields.size ||
    Object.keys(data).some((key) => !recordFields.has(key))
  )
    return false;
  if (
    data.version !== 1 ||
    typeof data.runId !== 'string' ||
    !uuidPattern.test(data.runId) ||
    typeof data.pid !== 'number' ||
    !Number.isSafeInteger(data.pid) ||
    data.pid <= 0 ||
    typeof data.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.at) ||
    !Number.isFinite(Date.parse(data.at)) ||
    new Date(data.at).toISOString() !== data.at ||
    typeof data.code !== 'string' ||
    !codeSet.has(data.code)
  )
    return false;
  return data.event === 'start'
    ? data.code === 'starting'
    : data.event === 'ready'
      ? data.code === 'ready'
      : data.event === 'finished' && data.code !== 'starting' && data.code !== 'ready';
}

/**
 * Local best-effort diagnostics, not signed evidence of monitoring or task execution.
 * The 1 MiB pre-write limit is a soft threshold: concurrent writers may cross it.
 * No lock, retry loop, rotation, truncation, or cleanup of existing history is used.
 */
export function newMonitorDiagnosticRun(file: string): {
  runId: string;
  record: (event: MonitorDiagnosticEvent, code: MonitorDiagnosticCode) => boolean;
} {
  const runId = randomUUID();
  const pid = process.pid;
  return {
    runId,
    record(event, code) {
      let descriptor: number | undefined;
      try {
        const record: DiagnosticRecord = {
          version: 1,
          runId,
          pid,
          at: new Date().toISOString(),
          event,
          code,
        };
        if (!isRecord(record)) return false;
        const path = resolve(`${file}.diagnostics.jsonl`);
        const originalDirectories = checkedDirectories(path, true);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        requireDirectoriesUnchanged(originalDirectories);
        const directories = checkedDirectories(path);
        let before: BigIntStats | undefined;
        try {
          before = checkedFile(path);
          if (before.size >= WRITE_THRESHOLD_BYTES) return false;
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw error;
        }
        descriptor = openSync(
          path,
          constants.O_RDWR |
            constants.O_APPEND |
            (constants.O_NOFOLLOW ?? 0) |
            (before ? 0 : constants.O_CREAT | constants.O_EXCL),
          0o600,
        );
        const opened = requireIdentity(
          path,
          descriptor,
          before ?? fstatSync(descriptor, { bigint: true }),
        );
        requireDirectoriesUnchanged(directories);
        if (opened.size >= WRITE_THRESHOLD_BYTES) return false;
        let prefix = '';
        const openedBytes = safeSize(opened);
        if (openedBytes > 0) {
          const last = Buffer.alloc(1);
          if (readSync(descriptor, last, 0, 1, openedBytes - 1) !== 1) return false;
          if (last[0] !== 10) prefix = '\n';
        }
        const buffer = Buffer.from(`${prefix}${JSON.stringify(record)}\n`, 'utf8');
        if (buffer.length > MAX_RECORD_BYTES) return false;
        // One O_APPEND write keeps each normal record together; partial writes remain visible.
        const written = writeSync(descriptor, buffer, 0, buffer.length);
        requireIdentity(path, descriptor, opened);
        requireDirectoriesUnchanged(directories);
        return written === buffer.length;
      } catch {
        return false;
      } finally {
        if (descriptor !== undefined) {
          try {
            closeSync(descriptor);
          } catch {
            /* Diagnostic failure must not stop monitoring. */
          }
        }
      }
    },
  };
}

function defaultProbeProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    throw error;
  }
}

export function readMonitorDiagnostics(
  file: string,
  options: { probeProcess?: (pid: number) => boolean } = {},
): MonitorDiagnostics {
  const result: MonitorDiagnostics = {
    checkedAt: new Date().toISOString(),
    latestAttempt: null,
    lastReadyRun: null,
    observations: [],
    log: {
      exists: null,
      bytes: null,
      readBytes: 0,
      fromByte: null,
      toByte: null,
      totalBytes: null,
      coverage: 'unavailable',
      invalidRecords: 0,
      trailingPartial: false,
      atCapacity: null,
    },
  };
  let descriptor: number | undefined;
  try {
    const path = resolve(`${file}.diagnostics.jsonl`);
    let before: BigIntStats;
    try {
      before = lstatSync(path, { bigint: true });
      result.log.exists = true;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      Object.assign(result.log, {
        exists: false,
        bytes: 0,
        fromByte: 0,
        toByte: 0,
        totalBytes: 0,
        coverage: 'complete',
        atCapacity: false,
      });
      return result;
    }
    requireRegularFile(before);
    result.log.bytes = result.log.totalBytes = safeSize(before);
    result.log.atCapacity = before.size >= WRITE_THRESHOLD_BYTES;
    const directories = checkedDirectories(path);
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = requireIdentity(path, descriptor, before);
    requireDirectoriesUnchanged(directories);
    const openedBytes = safeSize(opened);
    const start = Math.max(0, openedBytes - READ_TAIL_BYTES);
    const buffer = Buffer.alloc(openedBytes - start);
    result.log.fromByte = result.log.toByte = start;
    while (result.log.readBytes < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        result.log.readBytes,
        buffer.length - result.log.readBytes,
        start + result.log.readBytes,
      );
      if (count === 0) break;
      result.log.readBytes += count;
      result.log.toByte = start + result.log.readBytes;
    }
    const after = requireIdentity(path, descriptor, opened);
    requireDirectoriesUnchanged(directories);
    result.log.bytes = result.log.totalBytes = safeSize(after);
    result.log.atCapacity = after.size >= WRITE_THRESHOLD_BYTES;
    const read = buffer.subarray(0, result.log.readBytes);
    result.log.trailingPartial = read.length > 0 && read[read.length - 1] !== 10;
    if (
      read.length !== buffer.length ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    )
      throw new Error('diagnostic_file_changed');
    result.log.coverage = start === 0 ? 'complete' : 'tail';

    const runs = new Map<string, MonitorDiagnosticRunStatus>();
    let latestStartId: string | null = null;
    let lastReadyId: string | null = null;
    // A tail may begin halfway through a record. Discard the first fragment without parsing it.
    let offset = start === 0 ? 0 : read.indexOf(10) + 1;
    if (start > 0 && offset === 0) offset = read.length;
    while (offset < read.length) {
      const end = read.indexOf(10, offset);
      if (end < 0) break;
      const line = read.subarray(offset, end);
      offset = end + 1;
      try {
        if (line.length === 0 || line.length + 1 > MAX_RECORD_BYTES)
          throw new Error('diagnostic_record_invalid');
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        if (!isRecord(parsed)) throw new Error('diagnostic_record_invalid');
        const previous = runs.get(parsed.runId);
        if (previous && previous.pid !== parsed.pid) throw new Error('diagnostic_record_invalid');
        const run: MonitorDiagnosticRunStatus = {
          runId: parsed.runId,
          pid: parsed.pid,
          startedAt: parsed.event === 'start' ? parsed.at : (previous?.startedAt ?? null),
          readyAt: parsed.event === 'ready' ? parsed.at : (previous?.readyAt ?? null),
          lastEvent: parsed.event,
          code: parsed.code,
          at: parsed.at,
          processPresence: 'unknown',
        };
        runs.set(parsed.runId, run);
        if (parsed.event === 'start') latestStartId = parsed.runId;
        if (parsed.event === 'ready') lastReadyId = parsed.runId;
      } catch {
        result.log.invalidRecords++;
      }
    }
    const statuses = new Map<string, MonitorDiagnosticRunStatus>();
    for (const id of new Set([latestStartId, lastReadyId])) {
      if (!id) continue;
      const run = runs.get(id)!;
      if (run.lastEvent !== 'finished') {
        try {
          const presence = (options.probeProcess ?? defaultProbeProcess)(run.pid);
          run.processPresence =
            presence === true ? 'present-unverified' : presence === false ? 'absent' : 'unknown';
        } catch {
          run.processPresence = 'unknown';
        }
      }
      statuses.set(id, run);
    }
    result.latestAttempt = latestStartId ? statuses.get(latestStartId)! : null;
    result.lastReadyRun = lastReadyId ? statuses.get(lastReadyId)! : null;
  } catch {
    result.log.coverage = 'unavailable';
    result.latestAttempt = result.lastReadyRun = null;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        /* Read status remains best-effort. */
      }
    }
    if (result.log.coverage === 'tail') result.observations.push('tail_only');
    if (result.log.coverage === 'unavailable') result.observations.push('log_unavailable');
    if (result.log.invalidRecords > 0) result.observations.push('invalid_records');
    if (result.log.trailingPartial) result.observations.push('trailing_partial');
    if (!result.latestAttempt) result.observations.push('attempt_start_not_observed');
    if (!result.lastReadyRun) result.observations.push('ready_not_observed');
  }
  return result;
}
