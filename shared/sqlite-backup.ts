import { backup, DatabaseSync } from 'node:sqlite';
import {
  constants,
  closeSync,
  createReadStream,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  type BigIntStats,
} from 'node:fs';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface SQLiteSnapshotResult {
  destination: string;
  byteLength: number;
  pageCount: number;
  pageSize: number;
  sha256: string;
  createdAt: string;
  integrity: 'ok';
}

type Identity = Pick<BigIntStats, 'dev' | 'ino'>;
const readFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const writeFlags = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL;

function sameFile(first: Identity, second: Identity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function exists(path: string): BigIntStats | null {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function validatePath(path: string): string {
  if (!path || path.includes('\0')) throw new Error('数据库路径无效');
  const absolute = resolve(path);
  if (process.platform === 'win32') {
    const tail = absolute.slice(parse(absolute).root.length);
    for (const component of tail.split(/[\\/]/)) {
      if (
        /[<>:"|?*]/.test(component) ||
        /[. ]$/.test(component) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)
      ) {
        throw new Error('数据库路径包含 Windows 保留名称或字符');
      }
    }
  }
  return absolute;
}

// Walk each component instead of recursively creating a path through a link.
// Publication later also checks this directory's identity after asynchronous I/O.
function checkedDirectory(path: string, create: boolean): string {
  const absolute = validatePath(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    let item = exists(current);
    if (!item && create) {
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      item = lstatSync(current, { bigint: true });
    }
    if (!item?.isDirectory() || item.isSymbolicLink()) {
      throw new Error('数据库路径的目录不存在或包含链接');
    }
  }
  return realpathSync(absolute);
}

function assertIdentity(path: string, identity: Identity, directory = false): void {
  const item = lstatSync(path, { bigint: true });
  if (
    item.isSymbolicLink() ||
    (directory ? !item.isDirectory() : !item.isFile()) ||
    !sameFile(item, identity)
  ) {
    throw new Error('备份期间文件或目录已更换，操作已停止');
  }
}

function integrity(db: DatabaseSync, label: string): void {
  const rows = db.prepare('PRAGMA integrity_check').all();
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
    throw new Error(`${label}完整性检查失败`);
  }
}

function assertNoSQLiteSiblings(destination: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (exists(`${destination}${suffix}`)) {
      throw new Error('目标存在 SQLite 辅助文件，请使用完整的新路径；不会覆盖原文件');
    }
  }
}

async function hashFile(fd: number): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream('', { fd, autoClose: false, start: 0, highWaterMark: 64 * 1024 });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Create a verified SQLite snapshot at a new path without replacing any file.
 * Uses the online backup API (including committed WAL data), then an exclusive
 * same-volume hard-link publication. The caller owns an existing connection.
 * Keys such as SERVER_SECRET are external and are not included in this file.
 */
export async function createSQLiteSnapshot(
  source: DatabaseSync | string,
  requestedDestination: string,
): Promise<SQLiteSnapshotResult> {
  const sourcePath = typeof source === 'string' ? validatePath(source) : source.location('main');
  if (!sourcePath) throw new Error('只支持本地文件数据库备份');
  const sourceDirectory = checkedDirectory(dirname(sourcePath), false);
  const actualSource = join(sourceDirectory, basename(sourcePath));
  const sourceStat = lstatSync(actualSource, { bigint: true });
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
    throw new Error('源数据库必须为普通文件');
  const sourceHandle = openSync(actualSource, readFlags);
  let db: DatabaseSync | undefined;
  let temporaryDirectory: string | undefined;
  let temporaryDirectoryIdentity: Identity | undefined;
  let temporaryFile: string | undefined;
  let temporaryHandle: number | undefined;
  let temporaryIdentity: Identity | undefined;
  const ownsConnection = typeof source === 'string';
  try {
    if (!sameFile(sourceStat, fstatSync(sourceHandle, { bigint: true })))
      throw new Error('源数据库文件已更换');
    db = typeof source === 'string' ? new DatabaseSync(actualSource, { readOnly: true }) : source;
    assertIdentity(actualSource, sourceStat);
    if (db.isTransaction) throw new Error('请在当前数据库事务结束后备份');
    integrity(db, '源数据库');

    const requested = validatePath(requestedDestination);
    const parent = checkedDirectory(dirname(requested), true);
    const parentIdentity = lstatSync(parent, { bigint: true });
    const destination = join(parent, basename(requested));
    const existing = exists(destination);
    if (existing && sameFile(existing, sourceStat)) throw new Error('备份不能覆盖源数据库');
    if (existing) throw new Error('目标已经存在，请使用新路径；不会覆盖原文件');
    assertNoSQLiteSiblings(destination);

    temporaryDirectory = mkdtempSync(join(parent, '.opencost-snapshot-'));
    temporaryDirectoryIdentity = lstatSync(temporaryDirectory, { bigint: true });
    temporaryFile = join(temporaryDirectory, 'snapshot.sqlite');
    temporaryHandle = openSync(temporaryFile, writeFlags, 0o600);
    temporaryIdentity = fstatSync(temporaryHandle, { bigint: true });
    await backup(db, temporaryFile);

    assertIdentity(temporaryDirectory, temporaryDirectoryIdentity, true);
    assertIdentity(temporaryFile, temporaryIdentity);
    assertNoSQLiteSiblings(destination);
    const check = new DatabaseSync(temporaryFile);
    let pageCount: number;
    let pageSize: number;
    try {
      // Backup preserves the source's WAL header. Convert this private, closed
      // snapshot to DELETE mode so the published file needs no WAL/SHM siblings.
      if (check.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode !== 'delete') {
        throw new Error('备份数据库无法生成独立文件');
      }
      integrity(check, '备份数据库');
      pageCount = Number(check.prepare('PRAGMA page_count').get()?.page_count);
      pageSize = Number(check.prepare('PRAGMA page_size').get()?.page_size);
    } finally {
      check.close();
    }
    fsyncSync(temporaryHandle);
    const byteLength = Number(fstatSync(temporaryHandle, { bigint: true }).size);
    if (!Number.isSafeInteger(byteLength)) throw new Error('备份数据库大小超出可记录范围');
    const sha256 = await hashFile(temporaryHandle);

    // Revalidate after async backup/hash. linkSync is atomic and always refuses
    // existing entries, including a competing process's file or dangling link.
    if (checkedDirectory(dirname(requested), false) !== parent) {
      throw new Error('备份目标目录已更换，操作已停止');
    }
    assertIdentity(parent, parentIdentity, true);
    assertIdentity(actualSource, sourceStat);
    assertIdentity(temporaryDirectory, temporaryDirectoryIdentity, true);
    assertIdentity(temporaryFile, temporaryIdentity);
    assertNoSQLiteSiblings(destination);
    try {
      linkSync(temporaryFile, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('目标已经存在，请使用新路径；不会覆盖原文件', { cause: error });
      }
      throw error;
    }
    assertIdentity(destination, temporaryIdentity);
    return {
      destination,
      byteLength,
      pageCount,
      pageSize,
      sha256,
      createdAt: new Date().toISOString(),
      integrity: 'ok',
    };
  } finally {
    if (ownsConnection) db?.close();
    closeSync(sourceHandle);
    if (temporaryHandle !== undefined) closeSync(temporaryHandle);
    // Never remove destination, even if publication or final verification fails.
    // Cleanup touches only identities created by this call; changed directories
    // are left intact rather than traversed or recursively removed.
    if (temporaryDirectory && temporaryDirectoryIdentity && temporaryFile && temporaryIdentity) {
      try {
        checkedDirectory(dirname(temporaryDirectory), false);
        assertIdentity(temporaryDirectory, temporaryDirectoryIdentity, true);
        assertIdentity(temporaryFile, temporaryIdentity);
        unlinkSync(temporaryFile);
        rmdirSync(temporaryDirectory);
      } catch {
        // A locked file or changed path must not cause deletion of another file.
      }
    }
  }
}
