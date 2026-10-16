import fs, { type BigIntStats } from 'node:fs';
import { dirname, join, parse, relative, sep } from 'node:path';
import {
  acquireLocalProcessLock,
  sessionStoragePaths,
  type LocalProcessLock,
} from './session-storage.js';

const STOP_FAILED = '监控停止请求无法安全保存或核验；请保留现有控制文件，稍后重试并检查本地存储。';
const CLEANUP_WARNING = '监控停止控制文件清理未完成；停止请求和历史已保留，请检查后重试。';
type Identity = Pick<BigIntStats, 'dev' | 'ino'>;
type Directory = { path: string; identity: Identity };
export type MonitorStopSnapshot = {
  path: string;
  directories: Directory[];
  marker: BigIntStats | null;
};

function warnCleanup() {
  try {
    console.warn(CLEANUP_WARNING);
  } catch {
    // Local diagnostics cannot replace a published stop request.
  }
}
function controlTarget(file: string) {
  return `${sessionStoragePaths(file).state}.stop-control`;
}

/**
 * Serialize snapshot, long-lived acquisition and stale-stop removal against stop.
 * The separate control guard is released before callbacks, awaits or business work.
 */
export function acquireMonitorStartLock(file: string): LocalProcessLock {
  const control = acquireLocalProcessLock(controlTarget(file));
  let monitor: LocalProcessLock | undefined;
  let failed = false;
  let failure: unknown;
  try {
    const previous = captureMonitorStop(file);
    monitor = acquireLocalProcessLock(file);
    clearPreviousMonitorStop(previous);
  } catch (error) {
    failed = true;
    failure = error;
  }
  const released = control.release();
  if (!released.released || released.cleanupWarning) {
    warnCleanup();
    if (!failed) {
      failed = true;
      failure = new Error(STOP_FAILED);
    }
  }
  if (failed) {
    if (monitor) {
      const result = monitor.release();
      if (!result.released || result.cleanupWarning) warnCleanup();
    }
    throw failure;
  }
  return monitor!;
}

function sameIdentity(first: Identity, second: Identity) {
  return first.dev === second.dev && first.ino === second.ino;
}
function existing(path: string): BigIntStats | null {
  try {
    return fs.lstatSync(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function regularMarker(path: string) {
  const marker = existing(path);
  if (marker && (!marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1n))
    throw new Error(STOP_FAILED);
  return marker;
}
function assertDirectories(directories: Directory[]) {
  for (const directory of directories) {
    const current = existing(directory.path);
    if (
      !current?.isDirectory() ||
      current.isSymbolicLink() ||
      !sameIdentity(current, directory.identity)
    )
      throw new Error(STOP_FAILED);
  }
}
function directoriesFor(path: string, create: boolean) {
  const directory = dirname(path);
  const root = parse(directory).root;
  const directories: Directory[] = [];
  let current = root;
  for (const component of ['', ...relative(root, directory).split(sep).filter(Boolean)]) {
    if (component) current = join(current, component);
    let item = existing(current);
    if (!item && create) {
      assertDirectories(directories);
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      item = existing(current);
    }
    if (!item && !create) break;
    if (!item?.isDirectory() || item.isSymbolicLink()) throw new Error(STOP_FAILED);
    directories.push({ path: current, identity: item });
  }
  assertDirectories(directories);
  return directories;
}

/** Captured before acquiring the long-lived monitor lock; no file is opened. */
export function captureMonitorStop(file: string): MonitorStopSnapshot {
  try {
    const path = `${sessionStoragePaths(file).state}.stop`;
    const directories = directoriesFor(path, false);
    const marker = regularMarker(path);
    assertDirectories(directories);
    return { path, directories, marker };
  } catch {
    throw new Error(STOP_FAILED);
  }
}

/** Remove only the exact ordinary marker observed before this start attempt. */
export function clearPreviousMonitorStop(previous: MonitorStopSnapshot): void {
  try {
    if (!previous.marker) return;
    assertDirectories(previous.directories);
    const current = regularMarker(previous.path);
    if (
      current &&
      sameIdentity(current, previous.marker) &&
      current.size === previous.marker.size &&
      current.mtimeNs === previous.marker.mtimeNs &&
      current.ctimeNs === previous.marker.ctimeNs
    )
      fs.unlinkSync(previous.path);
  } catch {
    throw new Error(STOP_FAILED);
  }
}

export function hasMonitorStop(file: string): boolean {
  return captureMonitorStop(file).marker !== null;
}

/** Exclusive creation never truncates a file or follows an existing marker link. */
function requestMarker(file: string): { created: boolean } {
  let handle: number | undefined;
  try {
    const path = `${sessionStoragePaths(file).state}.stop`;
    const directories = directoriesFor(path, true);
    if (regularMarker(path)) return { created: false };
    assertDirectories(directories);
    try {
      handle = fs.openSync(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      assertDirectories(directories);
      if (!regularMarker(path)) throw new Error(STOP_FAILED);
      return { created: false };
    }
    const opened = fs.fstatSync(handle, { bigint: true });
    const current = regularMarker(path);
    if (!opened.isFile() || opened.nlink !== 1n || !current || !sameIdentity(opened, current))
      throw new Error(STOP_FAILED);
    fs.fsyncSync(handle);
    assertDirectories(directories);
    const after = regularMarker(path);
    if (!after || !sameIdentity(opened, after)) throw new Error(STOP_FAILED);
    return { created: true };
  } catch {
    throw new Error(STOP_FAILED);
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        // The empty marker is already published; a close diagnostic cannot undo stop.
      }
    }
  }
}

export function requestMonitorStop(file: string): { created: boolean } {
  let control: LocalProcessLock;
  try {
    control = acquireLocalProcessLock(controlTarget(file));
  } catch {
    throw new Error(STOP_FAILED);
  }
  try {
    return requestMarker(file);
  } finally {
    const released = control.release();
    if (!released.released || released.cleanupWarning) warnCleanup();
  }
}
