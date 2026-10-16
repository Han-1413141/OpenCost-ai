import { lstatSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { createSQLiteSnapshot } from '../shared/sqlite-backup.js';

if (!parentPort || workerData?.kind !== 'opencost-journal-backup-1')
  throw new Error('备份工作线程参数无效');
const port = parentPort;
async function run() {
  try {
    const identity = lstatSync(workerData.path, { bigint: true });
    if (
      !identity.isFile() ||
      identity.isSymbolicLink() ||
      identity.dev !== workerData.identity?.dev ||
      identity.ino !== workerData.identity?.ino
    )
      throw new Error('备份期间源数据库已更换，操作已停止');
    const result = await createSQLiteSnapshot(workerData.path, workerData.destination);
    port.postMessage({ kind: 'complete', result });
  } catch (error) {
    port.postMessage({
      kind: 'failed',
      message: error instanceof Error ? error.message : '备份未完成，原日记保留',
    });
  } finally {
    port.close();
  }
}
void run();
