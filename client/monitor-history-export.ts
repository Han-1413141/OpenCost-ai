import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, fstatSync, lstatSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_HISTORY_DAYS, DAY_MS } from '../shared/collection.js';
import { canonical } from '../shared/schema.js';
import { createHash } from 'node:crypto';
import { SubscriptionSnapshotSchema } from '../shared/subscriptions.js';
import {
  QuotaObservationImportSchema,
  quotaObservationImportLimits,
} from '../shared/quota-observation-import-schema.js';
import {
  MonitorHistoryExportSchema,
  monitorHistoryExportNotice,
  type MonitorHistoryExport,
} from '../shared/monitor-history-export-schema.js';

const selectionSchema = z
  .object({
    file: z.string().min(1),
    subscriptionRef: z.string().uuid(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    mapping: QuotaObservationImportSchema.shape.mapping.optional(),
  })
  .strict();
const preciseMs = (at: string) => {
  const value = Date.parse(at);
  return Number.isSafeInteger(value) &&
    new Date(value).toISOString().slice(0, 19) === at.slice(0, 19) &&
    !at
      .match(/\.(\d+)Z$/)?.[1]
      .slice(3)
      .split('')
      .some((digit) => digit !== '0')
    ? value
    : NaN;
};
const sameFile = (first: { dev: bigint; ino: bigint }, second: { dev: bigint; ino: bigint }) =>
  first.dev === second.dev && first.ino === second.ino;

/** Opens the selected file directly in read-only mode, never through the migrating MonitorStore. */
export function exportMonitorHistory(
  raw: unknown,
  options: { enabled?: boolean; maxObservations?: number; maxBytes?: number; now?: string } = {},
): MonitorHistoryExport {
  const result: MonitorHistoryExport = {
    format: 'opencost-monitor-history-export-1',
    status: 'disabled',
    selection: null,
    snapshot: null,
    counts: { matchedRows: 0, matchedRowsIsLowerBound: false, bodyBytes: null },
    storedSelectionComplete: false,
    diagnostics: [],
    input: null,
    notice: monitorHistoryExportNotice,
  };
  if (options.enabled !== true) return result;
  const fail = (
    status: MonitorHistoryExport['status'],
    diagnostic: MonitorHistoryExport['diagnostics'][number],
  ) => {
    result.status = status;
    result.input = null;
    result.storedSelectionComplete = false;
    result.diagnostics = [diagnostic];
    return result;
  };
  const parsed = selectionSchema.safeParse(raw);
  const maxRows = options.maxObservations ?? quotaObservationImportLimits.observations;
  const maxBytes = options.maxBytes ?? quotaObservationImportLimits.bytes;
  if (
    !parsed.success ||
    !Number.isInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > quotaObservationImportLimits.observations ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 128 ||
    maxBytes > quotaObservationImportLimits.bytes
  )
    return fail('incomplete', 'invalid_selection');
  const input = parsed.data,
    start = preciseMs(input.startAt),
    end = preciseMs(input.endAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end - start > MAX_HISTORY_DAYS * DAY_MS
  )
    return fail('incomplete', 'invalid_selection');
  result.selection = {
    subscriptionRef: input.subscriptionRef,
    startAt: input.startAt,
    endAt: input.endAt,
  };
  const path = resolve(input.file);
  let descriptor: number | undefined, db: DatabaseSync | undefined;
  let opened = false;
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink())
      return fail('unavailable', 'source_unavailable');
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const held = fstatSync(descriptor, { bigint: true });
    if (!held.isFile() || !sameFile(before, held)) return fail('conflict', 'source_changed');
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false, timeout: 250 });
    opened = true;
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=250; BEGIN;');
    if (db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8')
      return fail('incomplete', 'unsupported_storage');
    const schema = db
      .prepare("SELECT name,type FROM sqlite_schema WHERE name IN ('observations','bodies')")
      .all();
    const columns = (table: 'observations' | 'bodies') =>
      db!.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        type: string;
        pk: number;
      }[];
    const observedColumns = columns('observations'),
      bodyColumns = columns('bodies');
    const index = db.prepare('PRAGMA index_info(local_observation_subscription_time_ms)').all() as {
      name: string;
    }[];
    const bodyIndex = db.prepare('PRAGMA index_info(sqlite_autoindex_bodies_1)').all() as {
      name: string;
    }[];
    if (
      schema.length !== 2 ||
      schema.some((row) => row.type !== 'table') ||
      !['sequence', 'id', 'subscription_ref', 'at', 'at_ms', 'body_digest'].every((name) =>
        observedColumns.some((c) => c.name === name),
      ) ||
      !observedColumns.some((c) => c.name === 'sequence' && c.type === 'INTEGER' && c.pk === 1) ||
      !bodyColumns.some((c) => c.name === 'digest' && c.pk === 1) ||
      !bodyColumns.some((c) => c.name === 'payload') ||
      index.map((c) => c.name).join(',') !== 'subscription_ref,at_ms,sequence' ||
      bodyIndex.map((c) => c.name).join(',') !== 'digest'
    )
      return fail('incomplete', 'unsupported_storage');
    const maxSequence = db.prepare('SELECT max(sequence) AS maximum FROM observations').get()!
      .maximum;
    if (maxSequence !== null && (!Number.isSafeInteger(maxSequence) || Number(maxSequence) < 0))
      return fail('conflict', 'invalid_history');
    result.snapshot = {
      readAt: options.now ?? new Date().toISOString(),
      maxSequence: Number(maxSequence ?? 0),
    };
    if (
      db
        .prepare(
          'SELECT 1 FROM observations INDEXED BY local_observation_subscription_time_ms WHERE subscription_ref=? AND at_ms IS NULL LIMIT 1',
        )
        .get(input.subscriptionRef)
    )
      return fail('incomplete', 'unindexed_time');
    const rows = db
      .prepare(
        `SELECT o.sequence,o.id,o.subscription_ref,o.at,o.at_ms,o.body_digest,
      (SELECT octet_length(payload) FROM bodies INDEXED BY sqlite_autoindex_bodies_1 WHERE digest=o.body_digest) AS bytes
      FROM observations o INDEXED BY local_observation_subscription_time_ms
      WHERE o.subscription_ref=? AND o.at_ms>=? AND o.at_ms<=?
      ORDER BY o.at_ms,o.sequence LIMIT ?`,
      )
      .all(input.subscriptionRef, start, end, maxRows + 1) as {
      sequence: number;
      id: string;
      subscription_ref: string;
      at: string;
      at_ms: number;
      body_digest: string;
      bytes: number | null;
    }[];
    result.counts.matchedRows = rows.length;
    if (rows.length > maxRows) {
      result.counts.matchedRowsIsLowerBound = true;
      return fail('capacity', 'observation_capacity');
    }
    if (
      rows.some(
        (r) =>
          !Number.isSafeInteger(r.bytes) ||
          r.bytes === null ||
          r.bytes < 0 ||
          !/^[a-f0-9]{64}$/.test(r.body_digest),
      )
    )
      return fail('conflict', 'invalid_history');
    result.counts.bodyBytes = rows.reduce((sum, row) => sum + row.bytes!, 0);
    if (result.counts.bodyBytes > maxBytes) return fail('capacity', 'byte_capacity');
    if (!rows.length) {
      result.status = 'empty';
      result.storedSelectionComplete = true;
      result.diagnostics = ['no_observations'];
      return result;
    }
    const body = db.prepare(
      'SELECT payload FROM bodies INDEXED BY sqlite_autoindex_bodies_1 WHERE digest=?',
    );
    const observations = [];
    const decodedBodies = new Map<string, unknown>();
    const instants = new Set<number>();
    for (const row of rows) {
      const at = preciseMs(row.at);
      if (!Number.isFinite(at) || instants.has(at))
        return fail('conflict', 'ambiguous_observed_time');
      instants.add(at);
      if (
        !Number.isSafeInteger(row.at_ms) ||
        row.at_ms !== at ||
        at < start ||
        at > end ||
        !Number.isSafeInteger(row.sequence) ||
        row.sequence < 1 ||
        row.sequence > result.snapshot.maxSequence
      )
        return fail('conflict', 'invalid_history');
      if (!decodedBodies.has(row.body_digest)) {
        const value = body.get(row.body_digest)?.payload;
        if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') !== row.bytes)
          return fail('conflict', 'invalid_history');
        const decoded = JSON.parse(value);
        if (createHash('sha256').update(canonical(decoded)).digest('hex') !== row.body_digest)
          return fail('conflict', 'invalid_history');
        decodedBodies.set(row.body_digest, decoded);
      }
      const decoded = decodedBodies.get(row.body_digest);
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
        return fail('conflict', 'invalid_history');
      const snapshot = SubscriptionSnapshotSchema.safeParse({
        ...decoded,
        observationId: row.id,
        observedAt: row.at,
      });
      if (!snapshot.success || snapshot.data.subscriptionRef !== input.subscriptionRef)
        return fail('conflict', 'invalid_history');
      observations.push(snapshot.data);
    }
    const after = lstatSync(path, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink() || !sameFile(held, after))
      return fail('conflict', 'source_changed');
    result.input = QuotaObservationImportSchema.parse({
      format: 'quota-observation-import-1',
      importRef: randomUUID(),
      subscriptionRef: input.subscriptionRef,
      window: { startAt: input.startAt, endAt: input.endAt },
      observations,
      mapping: input.mapping ?? null,
    });
    result.status = 'complete';
    result.storedSelectionComplete = true;
    result.diagnostics = input.mapping ? [] : ['mapping_not_attached'];
    if (Buffer.byteLength(JSON.stringify(result, null, 2) + '\n', 'utf8') > maxBytes)
      return fail('capacity', 'byte_capacity');
    return MonitorHistoryExportSchema.parse(result);
  } catch (error) {
    const sqliteCode =
      error && typeof error === 'object' && 'errcode' in error ? error.errcode : null;
    if (typeof sqliteCode === 'number' && [5, 6].includes(sqliteCode & 255))
      return fail('unavailable', 'source_busy');
    return fail(
      opened ? 'conflict' : 'unavailable',
      opened ? 'invalid_history' : 'source_unavailable',
    );
  } finally {
    try {
      if (db) {
        try {
          if (db.isTransaction) db.exec('ROLLBACK');
        } finally {
          db.close();
        }
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}
