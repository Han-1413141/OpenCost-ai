import { createHash } from 'node:crypto';
import { gzip, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);
const magic = Buffer.from([0x4f, 0x43, 0x4a, 0x42, 1, 0, 0, 1]);
const headerBytes = 44;
export type StoredJournal = string | Uint8Array;
export const journalStorageLimits = {
  minimumBytes: 8192,
  maximumBytes: 1024 * 1024,
  concurrency: 2,
  minimumSaving: 0.1,
} as const;
let active = 0;
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest();
export async function encodeJournalStorage(text: string): Promise<StoredJournal> {
  const size = Buffer.byteLength(text, 'utf8');
  if (
    size < journalStorageLimits.minimumBytes ||
    size > journalStorageLimits.maximumBytes ||
    active >= journalStorageLimits.concurrency
  )
    return text;
  active++;
  try {
    const raw = Buffer.from(text, 'utf8');
    const body = await compress(raw, { level: 1 });
    if (body.length + headerBytes > size * (1 - journalStorageLimits.minimumSaving)) return text;
    const header = Buffer.alloc(headerBytes);
    magic.copy(header);
    header.writeUInt32BE(size, 8);
    digest(raw).copy(header, 12);
    return Buffer.concat([header, body]);
  } catch {
    return text;
  } finally {
    active--;
  }
}
export function decodeJournalStorage(value: StoredJournal): string {
  if (typeof value === 'string') return value;
  try {
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength <= headerBytes ||
      value.byteLength > journalStorageLimits.maximumBytes
    )
      throw new Error();
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (!bytes.subarray(0, 8).equals(magic)) throw new Error();
    const size = bytes.readUInt32BE(8);
    if (size < 1 || size > journalStorageLimits.maximumBytes) throw new Error();
    const raw = gunzipSync(bytes.subarray(headerBytes), { maxOutputLength: size });
    if (raw.length !== size || !digest(raw).equals(bytes.subarray(12, 44))) throw new Error();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw Object.assign(new Error('日记存储校验失败，原历史保留'), {
      statusCode: 503,
      code: 'JOURNAL_STORAGE_INVALID',
    });
  }
}
