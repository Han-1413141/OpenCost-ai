import type { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { SQLiteSnapshotResult } from '../shared/sqlite-backup.js';

/** One short-lived worker owns validation, copying and hashing of a new snapshot. */
export async function backupJournal(
  db: DatabaseSync,
  destination: string,
): Promise<SQLiteSnapshotResult> {
  if (!db.isOpen) throw new Error('日记数据库已经关闭');
  if (db.isTransaction) throw new Error('请在当前数据库事务结束后备份');
  const path = db.location('main');
  if (!path) throw new Error('只支持本地文件数据库备份');
  const identity = lstatSync(path, { bigint: true });
  if (!identity.isFile() || identity.isSymbolicLink()) throw new Error('源数据库必须为普通文件');
  const source = import.meta.url.endsWith('.ts');
  const entry = new URL(`./backup-worker.${source ? 'ts' : 'js'}`, import.meta.url);
  const executable = source
    ? new URL(
        `data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href)}; register(); await import(${JSON.stringify(entry.href)});`)}`,
      )
    : entry;
  return new Promise((accept, reject) => {
    const worker = new Worker(executable, {
      workerData: {
        kind: 'opencost-journal-backup-1',
        path,
        destination,
        identity: { dev: identity.dev, ino: identity.ino },
      },
      execArgv: [],
    });
    let result: SQLiteSnapshotResult | undefined;
    let failure: Error | undefined;
    worker.once('message', (message) => {
      if (message?.kind === 'complete') result = message.result;
      else if (message?.kind === 'failed' && typeof message.message === 'string')
        failure = new Error(message.message);
      else failure = new Error('备份工作线程未返回有效结果，原日记保留');
    });
    worker.once('error', () => {
      failure ??= new Error('备份工作线程执行失败，原日记与已有备份保留');
    });
    // Resolve only after the worker has closed its SQLite connection and exited.
    // Controller shutdown already waits for the backup promise before closing.
    worker.once('exit', (code) => {
      if (failure) reject(failure);
      else if (code === 0 && result) accept(result);
      else reject(new Error('备份工作线程未完成，原日记与已有备份保留'));
    });
  });
}
