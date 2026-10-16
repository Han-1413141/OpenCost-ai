import fs, { type BigIntStats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MAX_SESSION_BYTES = 1024 * 1024;
const MAX_MARKER_BYTES = 4096;
const APPLICATION_ID = 0x4f43534c;
const MUTEX_FORMAT = 'opencost-session-mutex-1';
const MUTEX_SCHEMA =
  'CREATE TABLE session_mutex (format TEXT NOT NULL, state_digest TEXT NOT NULL) STRICT';
const MARKER_FORMAT = 'opencost-session-lock-1';
const CLEANUP_WARNING = '上传状态的本地文件清理未完成；请保留现有文件并稍后检查。';
const BUSY = '另一进程正在更新上传状态，或存在无法核验的遗留锁；请稍后重试并保留现有锁文件。';
const CHANGED = '上传状态文件或目录在操作期间发生变化，原状态未替换；请重新读取。';
const INVALID = '上传状态路径包含链接、设备或无法核验的文件，操作已停止。';
const READ_FAILED = '上传状态无法安全读取，请保留现有文件并检查本地存储。';
const WRITE_FAILED = '上传状态无法安全保存，原状态未替换；请保留现有文件并重试。';
const TOO_LARGE = '上传状态超过 1 MiB，原状态未替换；请先处理未完成批次。';
const activeMutexes = new Set<string>();
const activeMutexFiles = new Set<string>();
const unreleasedMutexes = new Set<string>();
const ERROR_MESSAGES = new Set([BUSY, CHANGED, INVALID, READ_FAILED, WRITE_FAILED, TOO_LARGE]);

type Identity = Pick<BigIntStats, 'dev' | 'ino'>;
type DirectoryEntry = { path: string; identity: Identity };
type Snapshot = BigIntStats | null;
type Temporary = { path: string; identity: Identity };
type Marker = { format: typeof MARKER_FORMAT; pid: number; nonce: string; stateDigest: string };
type OwnedMarker = { identity: Identity; bytes: Buffer };
type LockContext = {
  paths: ReturnType<typeof sessionStoragePaths>;
  directories: DirectoryEntry[];
  reportCleanupWarning?: () => void;
};
type StorageContext = LockContext & {
  expected: Snapshot;
  assertAdditional?: () => void;
};

class SessionStorageError extends Error {}
export function sessionStorageErrorMessage(error: unknown): string | null {
  return error instanceof SessionStorageError && ERROR_MESSAGES.has(error.message)
    ? error.message
    : null;
}
function fail(message: string): never {
  throw new SessionStorageError(message);
}
function fixed(error: unknown, fallback: string) {
  return error instanceof SessionStorageError ? error : new SessionStorageError(fallback);
}
function warnCleanup() {
  try {
    console.warn(CLEANUP_WARNING);
  } catch {
    // A diagnostic failure cannot change a committed result or the original error.
  }
}
function sameFile(first: Identity, second: Identity) {
  return first.dev === second.dev && first.ino === second.ino;
}
function exists(path: string): BigIntStats | null {
  try {
    return fs.lstatSync(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function validPath(path: string) {
  if (typeof path !== 'string' || !path || path.includes('\0')) fail(INVALID);
  if (process.platform === 'win32' && /^\\\\[?.]\\/.test(path)) fail(INVALID);
  const absolute = resolve(path);
  if (process.platform === 'win32') {
    for (const component of absolute.slice(parse(absolute).root.length).split(/[\\/]/)) {
      if (
        /[<>:"|?*]/.test(component) ||
        /[. ]$/.test(component) ||
        /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(component)
      )
        fail(INVALID);
    }
  }
  return absolute;
}
const pathKey = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
function digest(path: string) {
  return createHash('sha256').update(pathKey(path)).digest('hex');
}

export function sessionStoragePaths(path: string) {
  const state = validPath(path);
  const mutex = `${state}.mutex.sqlite`;
  return {
    state,
    lock: `${state}.lock`,
    mutex,
    sqliteAuxiliary: ['-journal', '-wal', '-shm'].map((suffix) => mutex + suffix),
  };
}
export function reservedSessionPaths(path: string): string[] {
  const paths = sessionStoragePaths(path);
  return [paths.state, paths.lock, paths.mutex, ...paths.sqliteAuxiliary];
}

function checkedDirectory(path: string, create: boolean) {
  const absolute = validPath(path);
  const root = parse(absolute).root;
  const entries: DirectoryEntry[] = [];
  let current = root;
  for (const component of ['', ...relative(root, absolute).split(sep).filter(Boolean)]) {
    if (component) current = join(current, component);
    let item = exists(current);
    if (!item && create) {
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      item = exists(current);
    }
    if (!item && !create) return { entries, complete: false };
    if (!item?.isDirectory() || item.isSymbolicLink()) fail(INVALID);
    entries.push({ path: current, identity: item });
  }
  return { entries, complete: true };
}
function assertIdentity(path: string, identity: Identity, directory = false) {
  const item = exists(path);
  if (
    !item ||
    item.isSymbolicLink() ||
    (directory ? !item.isDirectory() : !item.isFile()) ||
    !sameFile(item, identity)
  )
    fail(CHANGED);
  return item;
}
function assertDirectories(entries: DirectoryEntry[]) {
  for (const entry of entries) assertIdentity(entry.path, entry.identity, true);
}
function snapshot(path: string): Snapshot {
  const item = exists(path);
  if (item && (!item.isFile() || item.isSymbolicLink())) fail(INVALID);
  return item;
}
function assertSnapshot(path: string, expected: Snapshot) {
  const current = snapshot(path);
  if (!expected && !current) return;
  if (
    !expected ||
    !current ||
    !sameFile(expected, current) ||
    expected.size !== current.size ||
    expected.mtimeNs !== current.mtimeNs ||
    expected.ctimeNs !== current.ctimeNs
  )
    fail(CHANGED);
}
function boundedRead(path: string, maximum: number, expected?: Snapshot, openingMutex = false) {
  const before = snapshot(path);
  if (!before) fail(CHANGED);
  // On POSIX, closing any raw fd for an inode can release this process's
  // SQLite locks. Never read a live mutex through a state or marker alias.
  if (!openingMutex && activeMutexFiles.has(`${before.dev}:${before.ino}`)) fail(INVALID);
  if (expected !== undefined) assertSnapshot(path, expected);
  if (before.size > BigInt(maximum)) fail(maximum === MAX_SESSION_BYTES ? TOO_LARGE : INVALID);
  const handle = fs.openSync(
    path,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fs.fstatSync(handle, { bigint: true });
    if (!opened.isFile() || !sameFile(before, opened) || opened.size > BigInt(maximum))
      fail(CHANGED);
    const bytes = Buffer.allocUnsafe(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(handle, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    if (count > maximum) fail(maximum === MAX_SESSION_BYTES ? TOO_LARGE : INVALID);
    if (count !== Number(before.size)) fail(CHANGED);
    assertSnapshot(path, before);
    return { bytes: bytes.subarray(0, count), identity: before };
  } finally {
    fs.closeSync(handle);
  }
}
function context(path: string, create: boolean): StorageContext | null {
  const paths = sessionStoragePaths(path);
  const directory = checkedDirectory(dirname(paths.state), create);
  if (!directory.complete) {
    assertDirectories(directory.entries);
    return null;
  }
  return { paths, directories: directory.entries, expected: snapshot(paths.state) };
}
function assertContext(storage: StorageContext) {
  assertDirectories(storage.directories);
  assertSnapshot(storage.paths.state, storage.expected);
  storage.assertAdditional?.();
}
function read(storage: StorageContext): string | null {
  assertContext(storage);
  if (!storage.expected) return null;
  const result = boundedRead(storage.paths.state, MAX_SESSION_BYTES, storage.expected);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
  assertContext(storage);
  return text;
}
function bytesForState(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength > MAX_SESSION_BYTES) fail(TOO_LARGE);
  return bytes;
}
function cleanupTemporary(
  temporary: Temporary | undefined,
  directories: DirectoryEntry[],
  reportCleanupWarning = warnCleanup,
) {
  if (!temporary) return;
  try {
    assertDirectories(directories);
    assertIdentity(temporary.path, temporary.identity);
    fs.unlinkSync(temporary.path);
  } catch {
    reportCleanupWarning();
  }
}
function createTemporary(
  path: string,
  bytes: Buffer,
  directories: DirectoryEntry[],
  reportCleanupWarning = warnCleanup,
): Temporary {
  let handle: number | undefined;
  let temporary: Temporary | undefined;
  try {
    assertDirectories(directories);
    handle = fs.openSync(path, 'wx', 0o600);
    temporary = { path, identity: fs.fstatSync(handle, { bigint: true }) };
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    assertDirectories(directories);
    assertIdentity(path, temporary.identity);
    if (fs.fstatSync(handle, { bigint: true }).size !== BigInt(bytes.byteLength))
      fail(WRITE_FAILED);
    const closing = handle;
    handle = undefined;
    fs.closeSync(closing);
    return temporary;
  } catch (error) {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        reportCleanupWarning();
      }
    }
    cleanupTemporary(temporary, directories, reportCleanupWarning);
    throw error;
  }
}
function write(storage: StorageContext, text: string) {
  const bytes = bytesForState(text);
  let temporary: Temporary | undefined;
  try {
    assertContext(storage);
    temporary = createTemporary(
      `${storage.paths.state}.${randomUUID()}.tmp`,
      bytes,
      storage.directories,
    );
    assertContext(storage);
    assertIdentity(temporary.path, temporary.identity);
    fs.renameSync(temporary.path, storage.paths.state);
    // Rename is the commit point. Cleanup errors must never turn success into failure.
    temporary = undefined;
  } finally {
    cleanupTemporary(temporary, storage.directories);
  }
}

export function readSessionText(path: string): string | null {
  try {
    const storage = context(path, false);
    return storage ? read(storage) : null;
  } catch (error) {
    throw fixed(error, READ_FAILED);
  }
}
export function writeSessionText(path: string, text: string): void {
  try {
    // Enforce the bound before creating directories or replacing any state.
    bytesForState(text);
    write(context(path, true)!, text);
  } catch (error) {
    throw fixed(error, WRITE_FAILED);
  }
}

function assertSQLiteSiblings(paths: ReturnType<typeof sessionStoragePaths>) {
  for (const path of paths.sqliteAuxiliary) snapshot(path);
}
function createMutex(storage: LockContext) {
  const { paths, directories } = storage;
  if (snapshot(paths.mutex)) return;
  const temporary = createTemporary(
    `${paths.mutex}.${randomUUID()}.tmp`,
    Buffer.alloc(0),
    directories,
    storage.reportCleanupWarning,
  );
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(temporary.path);
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;
      ${MUTEX_SCHEMA};`);
    db.prepare('INSERT INTO session_mutex VALUES (?, ?)').run(MUTEX_FORMAT, digest(paths.state));
    db.close();
    db = undefined;
    assertDirectories(directories);
    assertIdentity(temporary.path, temporary.identity);
    const handle = fs.openSync(
      temporary.path,
      fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0),
    );
    try {
      if (!sameFile(fs.fstatSync(handle, { bigint: true }), temporary.identity)) fail(CHANGED);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    assertDirectories(directories);
    assertSQLiteSiblings(paths);
    try {
      fs.linkSync(temporary.path, paths.mutex);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        (storage.reportCleanupWarning ?? warnCleanup)();
      }
    }
    cleanupTemporary(temporary, directories, storage.reportCleanupWarning);
  }
}
function closeMutex(db: DatabaseSync, reportCleanupWarning = warnCleanup) {
  let released = false;
  try {
    if (db.isTransaction) db.exec('ROLLBACK');
    released = true;
  } catch {
    reportCleanupWarning();
  }
  // Closing is still attempted if rollback failed, and vice versa. Neither
  // diagnostic may replace a committed state or an original callback error.
  try {
    db.close();
    released = true;
  } catch {
    reportCleanupWarning();
  }
  return released;
}
function openMutex(storage: LockContext): {
  db: DatabaseSync;
  identity: Identity;
  fileKey: string;
} {
  const { paths } = storage;
  createMutex(storage);
  assertDirectories(storage.directories);
  assertSQLiteSiblings(paths);
  const before = snapshot(paths.mutex);
  if (!before) fail(CHANGED);
  const fileKey = `${before.dev}:${before.ino}`;
  // An alias can have a different path but the same underlying file. Reject
  // re-entry before opening/closing a raw fd: POSIX locks belong to the process.
  if (activeMutexFiles.has(fileKey)) fail(BUSY);
  if (before.nlink !== 1n) fail(INVALID);
  activeMutexFiles.add(fileKey);
  let db: DatabaseSync | undefined;
  try {
    // All raw handles close before SQLite takes its POSIX process-associated lock.
    const existing = boundedRead(paths.mutex, 64 * 1024, before, true);
    if (
      existing.bytes.length < 100 ||
      existing.bytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0' ||
      existing.bytes.readUInt32BE(68) !== APPLICATION_ID ||
      existing.bytes.readUInt32BE(60) !== 1
    )
      fail(INVALID);
    db = new DatabaseSync(paths.mutex);
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
    assertIdentity(paths.mutex, existing.identity);
    assertDirectories(storage.directories);
    const objects = db
      .prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 2")
      .all();
    if (
      objects.length !== 1 ||
      objects[0]?.name !== 'session_mutex' ||
      objects[0]?.type !== 'table' ||
      objects[0]?.sql !== MUTEX_SCHEMA
    )
      fail(INVALID);
    // Validate the actual table before reading it. Views and generated columns
    // must never turn a small unrecognized mutex file into an unbounded query.
    const records = db.prepare('SELECT format,state_digest FROM session_mutex LIMIT 2').all();
    if (
      records.length !== 1 ||
      records[0]?.format !== MUTEX_FORMAT ||
      records[0]?.state_digest !== digest(paths.state)
    )
      fail(INVALID);
    return { db, identity: existing.identity, fileKey };
  } catch (error) {
    if (!db || closeMutex(db, storage.reportCleanupWarning)) {
      activeMutexFiles.delete(fileKey);
    } else {
      unreleasedMutexes.add(pathKey(paths.mutex));
    }
    throw fixed(error, BUSY);
  }
}
function parseMarker(bytes: Buffer, state: string): Marker {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Marker;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'format,nonce,pid,stateDigest' ||
      value.format !== MARKER_FORMAT ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      typeof value.nonce !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.nonce) ||
      value.stateDigest !== digest(state)
    )
      fail(BUSY);
    return value;
  } catch {
    fail(BUSY);
  }
}
function assertMarker(storage: LockContext, marker: OwnedMarker) {
  assertDirectories(storage.directories);
  assertIdentity(storage.paths.lock, marker.identity);
  const current = boundedRead(storage.paths.lock, MAX_MARKER_BYTES);
  if (!sameFile(current.identity, marker.identity) || !current.bytes.equals(marker.bytes))
    fail(CHANGED);
}
function claimMarker(storage: LockContext): OwnedMarker {
  const { paths, directories } = storage;
  if (snapshot(paths.lock)) {
    let previous: ReturnType<typeof boundedRead>;
    try {
      previous = boundedRead(paths.lock, MAX_MARKER_BYTES);
    } catch {
      fail(BUSY);
    }
    const marker = parseMarker(previous.bytes, paths.state);
    let dead = false;
    try {
      process.kill(marker.pid, 0);
    } catch (error) {
      dead = (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
    if (!dead) fail(BUSY);
    assertMarker(storage, { identity: previous.identity, bytes: previous.bytes });
    fs.unlinkSync(paths.lock);
  }
  const bytes = Buffer.from(
    JSON.stringify({
      format: MARKER_FORMAT,
      pid: process.pid,
      nonce: randomUUID(),
      stateDigest: digest(paths.state),
    } satisfies Marker) + '\n',
    'utf8',
  );
  const temporary = createTemporary(
    `${paths.lock}.${randomUUID()}.tmp`,
    bytes,
    directories,
    storage.reportCleanupWarning,
  );
  try {
    assertDirectories(directories);
    try {
      fs.linkSync(temporary.path, paths.lock);
    } catch {
      fail(BUSY);
    }
    return { identity: temporary.identity, bytes };
  } finally {
    cleanupTemporary(temporary, directories, storage.reportCleanupWarning);
  }
}

export type LocalProcessLockRelease = {
  released: boolean;
  cleanupWarning: boolean;
};
export type LocalProcessLock = {
  assertOwned(): void;
  /** Idempotent and non-throwing; cleanup cannot replace a caller's result. */
  release(): LocalProcessLockRelease;
};

/**
 * The OS owns the mutex lifetime; marker timestamps never authorize takeover.
 * This guard may span awaits. It never opens, reads or snapshots the target,
 * which may be a changing business database rather than a session JSON file.
 */
export function acquireLocalProcessLock(path: string): LocalProcessLock {
  const paths = sessionStoragePaths(path);
  const key = pathKey(paths.mutex);
  if (activeMutexes.has(key)) fail(BUSY);
  activeMutexes.add(key);
  let storage: LockContext | undefined;
  let mutex: ReturnType<typeof openMutex> | undefined;
  let marker: OwnedMarker | undefined;
  let cleanupWarning = false;
  let result: LocalProcessLockRelease | undefined;
  const reportCleanupWarning = () => {
    cleanupWarning = true;
  };
  const release = (): LocalProcessLockRelease => {
    if (result) return { ...result };
    // Mark the guard unusable before any cleanup; user diagnostics never run here.
    result = { released: false, cleanupWarning };
    if (marker && storage && mutex) {
      try {
        assertIdentity(paths.mutex, mutex.identity);
        assertMarker(storage, marker);
        fs.unlinkSync(paths.lock);
      } catch {
        reportCleanupWarning();
      }
    }
    let released = !mutex;
    if (mutex) {
      released = closeMutex(mutex.db, reportCleanupWarning);
      if (released) activeMutexFiles.delete(mutex.fileKey);
      else unreleasedMutexes.add(key);
    }
    if (!unreleasedMutexes.has(key)) activeMutexes.delete(key);
    result = { released: released && !unreleasedMutexes.has(key), cleanupWarning };
    return { ...result };
  };
  try {
    storage = {
      paths,
      directories: checkedDirectory(dirname(paths.state), true).entries,
      reportCleanupWarning,
    };
    mutex = openMutex(storage);
    marker = claimMarker(storage);
    const assertOwned = () => {
      if (result || !mutex!.db.isTransaction) fail(CHANGED);
      assertDirectories(storage!.directories);
      assertIdentity(paths.mutex, mutex!.identity);
      assertMarker(storage!, marker!);
    };
    assertOwned();
    return { assertOwned, release };
  } catch (error) {
    release();
    if (cleanupWarning) warnCleanup();
    throw fixed(error, BUSY);
  }
}

/** Synchronous state transaction using the same cross-process guard as monitoring. */
export function withSessionStorageLock<T>(
  path: string,
  action: (storage: { read(): string | null; write(text: string): void }) => T,
): T {
  const lock = acquireLocalProcessLock(path);
  try {
    let current: StorageContext;
    try {
      // Take the snapshot after acquiring the OS lock, so a preceding writer's
      // completed update is visible to this synchronous transaction.
      current = context(path, true)!;
      current.assertAdditional = lock.assertOwned;
      assertContext(current);
    } catch (error) {
      throw fixed(error, BUSY);
    }
    return action({
      read: () => {
        try {
          return read(current);
        } catch (error) {
          throw fixed(error, READ_FAILED);
        }
      },
      write: (text) => {
        try {
          write(current, text);
        } catch (error) {
          throw fixed(error, WRITE_FAILED);
        }
      },
    });
  } finally {
    if (lock.release().cleanupWarning) warnCleanup();
  }
}
