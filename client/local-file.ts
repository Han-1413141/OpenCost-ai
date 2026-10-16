import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type BigIntStats,
} from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const CHUNK_BYTES = 64 * 1024;
function validateLimit(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024)
    throw new Error('本地文件读取上限必须是 1 字节至 64 MiB 的整数');
}
function validateFile(before: BigIntStats, opened: BigIntStats, maxBytes: number) {
  if (!before.isFile() || before.isSymbolicLink() || !opened.isFile())
    throw new Error('本地记录必须是普通文件，不能使用链接或设备');
  if (before.dev !== opened.dev || before.ino !== opened.ino)
    throw new Error('本地记录在打开时已被替换，请重新读取');
  if (opened.size > BigInt(maxBytes)) throw new Error('本地记录超过大小限制');
}
function decode(chunks: Buffer[]) {
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export function readLocalTextSync(path: string, maxBytes: number) {
  validateLimit(maxBytes);
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('本地记录必须是普通文件，不能使用链接或设备');
  const descriptor = openSync(path, READ_FLAGS);
  try {
    validateFile(before, fstatSync(descriptor, { bigint: true }), maxBytes);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, maxBytes - total + 1));
      const size = readSync(descriptor, chunk, 0, chunk.length, null);
      if (!size) break;
      total += size;
      if (total > maxBytes) throw new Error('本地记录超过大小限制');
      chunks.push(chunk.subarray(0, size));
    }
    return decode(chunks);
  } finally {
    closeSync(descriptor);
  }
}

export async function readLocalText(path: string, maxBytes: number) {
  validateLimit(maxBytes);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('本地记录必须是普通文件，不能使用链接或设备');
  const file = await open(path, READ_FLAGS);
  try {
    validateFile(before, await file.stat({ bigint: true }), maxBytes);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, maxBytes - total + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error('本地记录超过大小限制');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return decode(chunks);
  } finally {
    await file.close();
  }
}
