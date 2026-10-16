import type { DatabaseSync } from './sqlite-connection.js';
import { statSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';

export type StorageBudgetOptions = {
  maxBytes?: number;
  reserveBytes?: number;
  walMaxBytes?: number;
  diskReserveBytes?: number;
  checkpointIntervalMs?: number;
};
export const defaultStorageBudgetOptions = {
  maxBytes: 2 * 1024 ** 3,
  reserveBytes: 16 * 1024 ** 2,
  walMaxBytes: 64 * 1024 ** 2,
  diskReserveBytes: 64 * 1024 ** 2,
  checkpointIntervalMs: 30000,
};
type BudgetReason = 'database' | 'wal' | 'disk';
export class StorageBudgetError extends Error {
  readonly statusCode = 503;
  readonly code = 'STORAGE_BUDGET_EXCEEDED';
  constructor(
    readonly reason: BudgetReason = 'database',
    options?: ErrorOptions,
  ) {
    super(
      reason === 'wal'
        ? '数据库写入日志达到容量上限，已保存历史仍可读取；稍后重试或增加写入日志容量'
        : reason === 'disk'
          ? '数据库所在磁盘的可用空间不足，已保存历史仍可读取；释放其他磁盘空间后重试'
          : '数据库写入容量不足，已保存历史仍可读取；增加存储容量后重试',
      options,
    );
    this.name = 'StorageBudgetError';
  }
}
export function isSQLiteFullError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; errcode?: unknown };
  return (
    value.code === 'SQLITE_FULL' ||
    (typeof value.errcode === 'number' && (value.errcode & 255) === 13)
  );
}
export function asStorageBudgetError(error: unknown): Error {
  if (error instanceof StorageBudgetError) return error;
  if (isSQLiteFullError(error)) return new StorageBudgetError('database', { cause: error });
  return error instanceof Error ? error : new Error('数据库操作失败', { cause: error });
}
function integer(value: number, name: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new Error(`${name}必须为${allowZero ? '非负' : '正'}安全整数`);
  return value;
}
export function validateStorageBudgetOptions(
  options: StorageBudgetOptions = {},
): Required<StorageBudgetOptions> {
  const maxBytes = integer(options.maxBytes ?? defaultStorageBudgetOptions.maxBytes, '数据库容量');
  if (maxBytes < 512) throw new Error('数据库容量必须至少容纳一个 SQLite 页面');
  const reserveBytes = integer(
    options.reserveBytes ??
      Math.min(defaultStorageBudgetOptions.reserveBytes, Math.floor(maxBytes / 16)),
    '数据库恢复保留空间',
    true,
  );
  if (reserveBytes >= maxBytes) throw new Error('数据库恢复保留空间必须小于数据库容量');
  return {
    maxBytes,
    reserveBytes,
    walMaxBytes: integer(
      options.walMaxBytes ?? defaultStorageBudgetOptions.walMaxBytes,
      '写入日志容量',
    ),
    diskReserveBytes: integer(
      options.diskReserveBytes ?? defaultStorageBudgetOptions.diskReserveBytes,
      '磁盘恢复保留空间',
      true,
    ),
    checkpointIntervalMs: integer(
      options.checkpointIntervalMs ?? defaultStorageBudgetOptions.checkpointIntervalMs,
      '写入日志整理间隔',
    ),
  };
}
function pragma(db: DatabaseSync, name: string): number {
  return Number(Object.values(db.prepare(`PRAGMA main.${name}`).get()!)[0]);
}
function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}
export type StorageBudgetSnapshot = {
  pageSize: number;
  pageCount: number;
  freelistPages: number;
  allocatedBytes: number;
  configuredMaxBytes: number;
  admissionLimitBytes: number;
  recoveryReserveBytes: number;
  sqliteMaxPages: number;
  mainFileBytes: number | null;
  walBytes: number | null;
  shmBytes: number | null;
  footprintBytes: number | null;
  walMaxBytes: number;
  availableDiskBytes: number | null;
  diskReserveBytes: number;
  overBudget: boolean;
  writesAvailable: boolean;
  blockedBy: BudgetReason[];
};
export type StorageTransactionState = StorageBudgetSnapshot & {
  totalChanges: number;
  schemaVersion: number;
};

/** Main database pages include free pages. WAL/SHM are additional files, not page quota. */
export class SQLiteStorageBudget {
  readonly options: Required<StorageBudgetOptions>;
  private readonly admissionPages: number;
  private lastCheckpointAt = 0;
  private hasWritten = false;
  constructor(
    private readonly db: DatabaseSync,
    private readonly path: string,
    options: StorageBudgetOptions = {},
  ) {
    this.options = validateStorageBudgetOptions(options);
    const { maxBytes, reserveBytes } = this.options;
    const pageSize = pragma(db, 'page_size');
    const maxPages = Math.min(4294967294, Math.floor(maxBytes / pageSize));
    if (maxPages < 1) throw new Error('数据库容量必须至少容纳一个 SQLite 页面');
    const reservePages = Math.ceil(reserveBytes / pageSize);
    this.admissionPages = Math.max(0, maxPages - reservePages);
    // A smaller new limit never truncates a pre-existing database. Limited extra pages
    // let an old, already-full database finish schema migration and remain readable.
    const existingPages = pragma(db, 'page_count');
    const hardMaxPages = Math.min(
      4294967294,
      Math.max(
        maxPages,
        existingPages > this.admissionPages ? existingPages + reservePages : existingPages,
      ),
    );
    db.exec(`PRAGMA main.max_page_count=${hardMaxPages};
      PRAGMA main.journal_size_limit=${this.options.walMaxBytes};
      PRAGMA main.wal_autocheckpoint=1000;`);
    // A WAL left by a previous process already contains writes; allow recovery
    // checkpointing even when this newly opened connection has not written yet.
    this.hasWritten = path !== ':memory:' && fileBytes(`${path}-wal`) > 0;
  }
  snapshot(): StorageBudgetSnapshot {
    const pageSize = pragma(this.db, 'page_size'),
      pageCount = pragma(this.db, 'page_count');
    let mainFileBytes: number | null = null,
      walBytes: number | null = null,
      shmBytes: number | null = null,
      availableDiskBytes: number | null = null;
    if (this.path !== ':memory:') {
      mainFileBytes = fileBytes(this.path);
      walBytes = fileBytes(`${this.path}-wal`);
      shmBytes = fileBytes(`${this.path}-shm`);
      try {
        const space = statfsSync(dirname(this.path), { bigint: true });
        availableDiskBytes = Number(space.bavail * space.bsize);
      } catch (error) {
        // Platforms without statfs still enforce page and WAL admission limits.
        if (
          !['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        )
          throw error;
      }
    }
    const blockedBy: BudgetReason[] = [];
    if (pageCount >= this.admissionPages) blockedBy.push('database');
    if (walBytes !== null && walBytes >= this.options.walMaxBytes) blockedBy.push('wal');
    if (availableDiskBytes !== null && availableDiskBytes < this.options.diskReserveBytes)
      blockedBy.push('disk');
    return {
      pageSize,
      pageCount,
      freelistPages: pragma(this.db, 'freelist_count'),
      allocatedBytes: pageSize * pageCount,
      configuredMaxBytes: this.options.maxBytes,
      admissionLimitBytes: pageSize * this.admissionPages,
      recoveryReserveBytes: this.options.reserveBytes,
      sqliteMaxPages: pragma(this.db, 'max_page_count'),
      mainFileBytes,
      walBytes,
      shmBytes,
      footprintBytes: mainFileBytes === null ? null : mainFileBytes + walBytes! + shmBytes!,
      walMaxBytes: this.options.walMaxBytes,
      availableDiskBytes,
      diskReserveBytes: this.options.diskReserveBytes,
      overBudget: pageCount * pageSize > this.options.maxBytes,
      writesAvailable: blockedBy.length === 0,
      blockedBy,
    };
  }
  captureTransaction(): StorageTransactionState {
    return {
      ...this.snapshot(),
      totalChanges: Number(this.db.prepare('SELECT total_changes() AS n').get()!.n),
      schemaVersion: pragma(this.db, 'schema_version'),
    };
  }
  assertTransaction(before: StorageTransactionState, options: { maintenance?: boolean } = {}) {
    const after = this.captureTransaction();
    const changed =
      after.totalChanges !== before.totalChanges ||
      after.schemaVersion !== before.schemaVersion ||
      after.pageCount !== before.pageCount;
    if (!changed) return false; // Already-stored idempotent receipts have no mutation.
    if (
      !options.maintenance &&
      (before.pageCount >= this.admissionPages || after.pageCount > this.admissionPages)
    )
      throw new StorageBudgetError('database');
    if (
      before.blockedBy.includes('wal') ||
      (after.walBytes !== null && after.walBytes >= this.options.walMaxBytes)
    )
      throw new StorageBudgetError('wal');
    if (before.blockedBy.includes('disk') || after.blockedBy.includes('disk'))
      throw new StorageBudgetError('disk');
    return true;
  }
  checkpointIfNeeded() {
    if (!this.hasWritten || this.path === ':memory:' || this.db.isTransaction) return;
    const now = Date.now();
    if (now - this.lastCheckpointAt < this.options.checkpointIntervalMs) return;
    const walBytes = fileBytes(`${this.path}-wal`);
    if (walBytes < Math.min(4 * 1024 ** 2, this.options.walMaxBytes)) return;
    this.lastCheckpointAt = now;
    // PASSIVE does not wait for active readers. A full checkpoint still leaves the WAL
    // file allocated; at its admission cap, try TRUNCATE with zero busy wait.
    const result = this.db.prepare('PRAGMA main.wal_checkpoint(PASSIVE)').get() as {
      busy: number;
      log: number;
      checkpointed: number;
    };
    if (
      walBytes >= this.options.walMaxBytes &&
      result.busy === 0 &&
      result.log === result.checkpointed
    ) {
      const timeout = pragma(this.db, 'busy_timeout');
      try {
        this.db.exec('PRAGMA busy_timeout=0');
        this.db.prepare('PRAGMA main.wal_checkpoint(TRUNCATE)').get();
      } finally {
        this.db.exec(`PRAGMA busy_timeout=${timeout}`);
      }
    }
  }
  afterWrite() {
    this.hasWritten = true;
    // A checkpoint is housekeeping after a durable commit, never a reason to report
    // that an already-stored record failed. The next write checks fresh capacity.
    try {
      this.checkpointIfNeeded();
    } catch {
      /* Existing durable receipt is preserved. */
    }
  }
}
