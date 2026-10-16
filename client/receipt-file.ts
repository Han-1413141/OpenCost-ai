import fs, { type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { canonical } from '../shared/schema.js';
import { contributorId, endpointOrigin } from './sdk.js';

export interface ReceiptFileInput {
  origin: string;
  accessKey: string;
  receipt: Record<string, unknown>;
}

export interface PreparedReceiptDocument {
  document: {
    format: 'opencost-access-1';
    origin: string;
    accessKey: string;
    receipt: Record<string, unknown>;
  };
  bytes: Buffer;
  sha256: string;
  scope: string;
  id: string;
}

export interface SavedReceipt {
  path: string;
  sha256: string;
  byteLength: number;
  created: boolean;
  cleanupWarning: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024;
const INVALID_DOCUMENT = '回执内容无效，无法保存本地回执；请保留原预览和幂等键。';
const SAVE_FAILED = '本地回执保存失败；原有文件未覆盖，请保留原预览和幂等键重试。';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Identity = Pick<BigIntStats, 'dev' | 'ino'>;
type DirectoryEntry = { path: string; identity: Identity };

/** Stable bytes make retries reusable while retaining every distinct feedback version. */
export function prepareReceiptDocument(input: ReceiptFileInput): PreparedReceiptDocument {
  try {
    if (typeof input.origin !== 'string' || typeof input.accessKey !== 'string') throw new Error();
    const origin = endpointOrigin(input.origin);
    const contributor = contributorId(input.accessKey);
    const serialized = JSON.stringify({
      format: 'opencost-access-1',
      origin,
      accessKey: input.accessKey,
      receipt: input.receipt,
    });
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new Error();
    const document = JSON.parse(serialized) as PreparedReceiptDocument['document'];
    const receipt = document.receipt;
    if (
      !receipt ||
      typeof receipt !== 'object' ||
      Array.isArray(receipt) ||
      typeof receipt.id !== 'string' ||
      !UUID.test(receipt.id) ||
      typeof receipt.digest !== 'string' ||
      !SHA256.test(receipt.digest) ||
      (receipt.status !== 'stored' && receipt.status !== 'quarantined')
    )
      throw new Error();
    const bytes = Buffer.from(`${canonical(document)}\n`, 'utf8');
    if (bytes.byteLength > MAX_BYTES) throw new Error();
    return {
      document,
      bytes,
      sha256: hash(bytes),
      scope: hash(canonical({ origin, contributor })),
      id: receipt.id.toLowerCase(),
    };
  } catch {
    // Never relay a serializer, URL, filesystem, or remote-content error verbatim.
    throw new Error(INVALID_DOCUMENT);
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

function validatePath(path: string) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error();
  // Namespaced Windows paths can address devices or bypass ordinary name checks.
  if (process.platform === 'win32' && /^\\\\[?.]\\/.test(path)) throw new Error();
  const absolute = resolve(path);
  if (process.platform === 'win32') {
    for (const component of absolute.slice(parse(absolute).root.length).split(/[\\/]/)) {
      if (
        /[<>:"|?*]/.test(component) ||
        /[. ]$/.test(component) ||
        /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(component)
      )
        throw new Error();
    }
  }
  return absolute;
}

function checkedDirectory(path: string, create: boolean): DirectoryEntry[] {
  const absolute = validatePath(path);
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
      item = fs.lstatSync(current, { bigint: true });
    }
    if (!item?.isDirectory() || item.isSymbolicLink()) throw new Error();
    entries.push({ path: current, identity: item });
  }
  return entries;
}

function assertIdentity(path: string, identity: Identity, directory = false) {
  const current = fs.lstatSync(path, { bigint: true });
  if (
    current.isSymbolicLink() ||
    (directory ? !current.isDirectory() : !current.isFile()) ||
    !sameFile(current, identity)
  )
    throw new Error();
}

function assertDirectories(entries: DirectoryEntry[]) {
  for (const entry of entries) assertIdentity(entry.path, entry.identity, true);
}

function syncDirectory(path: string) {
  // Node cannot portably open/fsync a directory on Windows. File fsync still
  // precedes publication there; this is not a promise of power-loss durability.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function assertExistingBytes(path: string, bytes: Buffer) {
  const before = fs.lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(bytes.byteLength))
    throw new Error();
  const fd = fs.openSync(
    path,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameFile(before, opened) || opened.size !== before.size)
      throw new Error();
    // Fixed-size reads prevent a concurrently growing file from allocating
    // unbounded memory. The extra byte proves the exact expected length.
    const existing = Buffer.allocUnsafe(bytes.byteLength + 1);
    let count = 0;
    for (;;) {
      const read = fs.readSync(fd, existing, count, existing.byteLength - count, null);
      count += read;
      if (!read || count === existing.byteLength) break;
    }
    if (count !== bytes.byteLength || !existing.subarray(0, count).equals(bytes)) throw new Error();
    assertIdentity(path, opened);
  } finally {
    fs.closeSync(fd);
  }
}

/** Publish complete bytes without ever replacing an existing directory entry. */
function saveNewFile(bytes: Buffer, requestedPath: string): SavedReceipt {
  let directories: DirectoryEntry[] | undefined;
  let temporaryDirectory: string | undefined;
  let temporaryDirectoryIdentity: Identity | undefined;
  let temporaryFile: string | undefined;
  let temporaryIdentity: Identity | undefined;
  let handle: number | undefined;
  let result: SavedReceipt | undefined;
  let cleanupWarning = false;
  try {
    const path = validatePath(requestedPath);
    const parent = dirname(path);
    directories = checkedDirectory(parent, true);
    const makeResult = (created: boolean): SavedReceipt => ({
      path,
      sha256: hash(bytes),
      byteLength: bytes.byteLength,
      created,
      cleanupWarning: false,
    });
    if (exists(path)) {
      assertExistingBytes(path, bytes);
      assertDirectories(directories);
      syncDirectory(parent);
      return (result = makeResult(false));
    }

    temporaryDirectory = fs.mkdtempSync(join(parent, '.opencost-receipt-'));
    temporaryDirectoryIdentity = fs.lstatSync(temporaryDirectory, { bigint: true });
    assertDirectories(directories);
    assertIdentity(temporaryDirectory, temporaryDirectoryIdentity, true);
    temporaryFile = join(temporaryDirectory, 'receipt.json');
    handle = fs.openSync(
      temporaryFile,
      fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    temporaryIdentity = fs.fstatSync(handle, { bigint: true });
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    assertDirectories(directories);
    assertIdentity(temporaryDirectory, temporaryDirectoryIdentity, true);
    assertIdentity(temporaryFile, temporaryIdentity);
    if (fs.fstatSync(handle, { bigint: true }).size !== BigInt(bytes.byteLength)) throw new Error();
    try {
      // Same-directory temporary storage guarantees the same volume. Never
      // fall back to replacement rename or a partially visible direct copy.
      fs.linkSync(temporaryFile, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      assertExistingBytes(path, bytes);
      assertDirectories(directories);
      syncDirectory(parent);
      return (result = makeResult(false));
    }
    assertIdentity(path, temporaryIdentity);
    assertDirectories(directories);
    syncDirectory(parent);
    return (result = makeResult(true));
  } catch {
    throw new Error(SAVE_FAILED);
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        cleanupWarning = true;
      }
    }
    if (temporaryDirectory && temporaryDirectoryIdentity) {
      try {
        assertDirectories(directories!);
        assertIdentity(temporaryDirectory, temporaryDirectoryIdentity, true);
        if (temporaryFile && temporaryIdentity) {
          assertIdentity(temporaryFile, temporaryIdentity);
          fs.unlinkSync(temporaryFile);
        }
        // Removing only an empty, identity-checked directory cannot erase an
        // unexpected file. A locked/replaced temporary path is left intact.
        assertIdentity(temporaryDirectory, temporaryDirectoryIdentity, true);
        fs.rmdirSync(temporaryDirectory);
      } catch {
        cleanupWarning = true;
      }
    }
    if (result) result.cleanupWarning = cleanupWarning;
  }
}

export function saveReceiptHistory(
  input: ReceiptFileInput,
  historyRoot = '.local/receipts',
): SavedReceipt {
  const prepared = prepareReceiptDocument(input);
  return saveNewFile(
    prepared.bytes,
    historyPath(historyRoot, prepared.scope, prepared.id, `${prepared.sha256}.json`),
  );
}

function historyPath(root: string, ...components: string[]) {
  try {
    return join(validatePath(root), ...components);
  } catch {
    throw new Error(SAVE_FAILED);
  }
}

export function exportReceiptDocument(input: ReceiptFileInput, path: string): SavedReceipt {
  return saveNewFile(prepareReceiptDocument(input).bytes, path);
}

/** Small credential companion remains readable by existing 50 KiB entry points. */
export function saveReceiptCredential(
  input: ReceiptFileInput,
  historyRoot = '.local/receipts',
): SavedReceipt {
  const prepared = prepareReceiptDocument(input);
  const bytes = Buffer.from(
    `${canonical({
      format: prepared.document.format,
      origin: prepared.document.origin,
      accessKey: prepared.document.accessKey,
    })}\n`,
    'utf8',
  );
  return saveNewFile(bytes, historyPath(historyRoot, prepared.scope, 'access.json'));
}
