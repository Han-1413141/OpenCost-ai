import { readdir, stat, open, realpath } from 'node:fs/promises';
import { constants, realpathSync, statSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { resolve, join, relative, isAbsolute, sep, basename } from 'node:path';
import type { Binding, SourceAuthorization } from './model.js';
import type { DesktopStore } from './store.js';
import type { DailySummary } from '../shared/desktop-summary.js';
import { readDshExport } from '../client/dsh.js';
import { canonical } from '../shared/schema.js';

export type SourceRecord = {
  ref: string;
  harness: Binding['harness'];
  firstAt: string;
  lastAt: string;
  texts: string[];
  userTurns: number | null;
  assistantTurns: number | null;
  toolCalls: number | null;
  input: number | null;
  cached: number | null;
  output: number | null;
  reasoning: number | null;
  sessionId?: string;
  parentSessionId?: string;
  agentDepth?: number;
  harnessVersion?: string;
  formatVersion?: number;
  usageExport?: boolean;
  knownUsage?: {
    input: number | null;
    cached: number | null;
    output: number | null;
    reasoning: number | null;
  };
};
const measured = (x: unknown): number | null =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;

export function sourceAuthorization(source: string): SourceAuthorization {
  const realPath = realpathSync(source);
  const info = statSync(realPath, { bigint: true });
  if (!info.isDirectory() || info.ino === 0n)
    throw new Error('来源需要可验证身份的实际目录，请选择本机会话日志目录');
  return {
    version: 'source-root-1',
    realPath,
    device: info.dev.toString(),
    inode: info.ino.toString(),
  };
}

export class SourceAuthorizationError extends Error {}

export function authorizedSourceRoot(binding: Binding): string {
  const approved = binding.authorization;
  if (!approved)
    throw new SourceAuthorizationError('旧来源绑定尚未确认真实目录，请重新绑定；历史日记保留');
  if (binding.authorizationRevokedAt)
    throw new SourceAuthorizationError('来源绑定的旧授权已失效，请重新绑定；历史日记保留');
  let current: SourceAuthorization;
  try {
    current = sourceAuthorization(binding.source);
  } catch {
    throw new SourceAuthorizationError('来源目录不可验证，请重新绑定；历史日记保留');
  }
  if (
    current.realPath !== approved.realPath ||
    current.device !== approved.device ||
    current.inode !== approved.inode
  )
    throw new SourceAuthorizationError(
      '来源目录目标或身份已变化，请重新绑定；旧授权失效，历史日记保留',
    );
  return current.realPath;
}

const sensitiveKey = (key: string) =>
  /(?:password|passwd|pwd|secret|token|apikey|accesskey|privatekey|authorization|cookie|密码|密钥|令牌)$/.test(
    key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, ''),
  );

function redactCredentialFields(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      '[私钥已移除]',
    )
    .replace(
      /(["'])(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:[^\r\n]*?\1/gi,
      '[凭据请求头已移除]',
    )
    .replace(
      /(^|\n)[ \t]*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:[^\r\n]*/gi,
      '$1[凭据请求头已移除]',
    )
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)[ \t]*:[^\r\n]*/gi,
      '[凭据请求头已移除]',
    )
    .replace(
      /["']?(?:[A-Za-z_$][A-Za-z0-9_.$:-]{0,120})?(?:password|passwd|pwd|secret|token|api[ _-]?key|access[ _-]?key|private[ _-]?key|authorization|cookie|密码|密钥|令牌)["']?[ \t]*[:=：][ \t]*("(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|(?:Bearer|Basic)[ \t]+[^\s"',;}\]]+|[^\s"',;}\]]+)/gi,
      '[凭据字段已移除]',
    );
}

function redactJsonFragments(text: string, depth: number): string {
  // Scan each bounded fragment once. Do not repeatedly JSON.parse every opening
  // brace, which would turn an unfinished object into quadratic work.
  const chunks: string[] = [];
  const stack: string[] = [];
  let start = -1,
    copied = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (start === -1) {
      if (char !== '{' && char !== '[') continue;
      start = i;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) {
        stack.length = 0;
        start = -1;
        continue;
      }
      if (stack.length) continue;
      const fragment = text.slice(start, i + 1);
      try {
        const clean = redactStructured(JSON.parse(fragment), depth + 1);
        chunks.push(text.slice(copied, start), JSON.stringify(clean));
        copied = i + 1;
      } catch {
        // Malformed snippets still pass through credential field/header masking.
      }
      start = -1;
    }
  }
  return chunks.join('') + text.slice(copied);
}

function redactEmbedded(text: string, depth: number): string {
  if (depth > 32) return '[深层结构已移除]';
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'string') return redactEmbedded(value, depth + 1);
    if (value && typeof value === 'object')
      return JSON.stringify(redactStructured(value, depth + 1));
  } catch {
    // A message often contains a JSON object inside a sentence.
  }
  // Decode JSON escape spellings only after exact structured JSON has been
  // parsed, so legitimate escaped quotes cannot break a credential value.
  let normalized = text;
  for (let pass = 0; pass < 8; pass++) {
    const next = normalized
      .replace(/\\+u([0-9a-f]{4})/gi, (_match, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      .replace(/\\+(["'])/g, '$1');
    if (next === normalized) break;
    normalized = next;
  }
  return redactCredentialFields(redactJsonFragments(normalized, depth));
}

function redactStructured(value: unknown, depth = 0): unknown {
  if (depth > 32) return '[深层结构已移除]';
  if (typeof value === 'string') return redactEmbedded(value, depth + 1);
  if (Array.isArray(value)) return value.map((item) => redactStructured(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey(key) ? '[凭据字段已移除]' : redactStructured(item, depth + 1),
      ]),
    );
  return value;
}

export function redact(text: string): string {
  // Only a 900-character excerpt is emitted. Bound parsing and regex work first,
  // while retaining enough following text to remove a quoted credential in full.
  const bounded = redactEmbedded(text.slice(0, 32768), 0);
  return bounded
    .replace(/```[\s\S]*?```/g, '[代码或文稿已移除]')
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '[结构内容已移除]')
    .replace(/(?:sk-|sess-|Bearer\s+)[A-Za-z0-9_\-./+=]{8,}/gi, '[凭据已移除]')
    .replace(/https?:\/\/[^\s<>"']+/g, '[链接已移除]')
    .replace(/[A-Z]:[\\/][^\s<>"']+/gi, '[路径已移除]')
    .replace(/(?:\/[A-Za-z0-9_.-]+){2,}/g, '[路径已移除]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已移除]')
    .replace(/\b\d{7,}\b/g, '[长数字已移除]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, 900);
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dayWindow(day: string, now = new Date()) {
  if (!/^20\d\d-\d\d-\d\d$/.test(day)) throw new Error('日期格式错误');
  const start = new Date(day + 'T00:00:00'),
    end = new Date(start);
  if (localDay(start) !== day || start > now) throw new Error('不能生成未来或无效日期的摘要');
  end.setDate(end.getDate() + 1);
  return {
    startAt: start.toISOString(),
    endAt: new Date(Math.min(end.getTime(), now.getTime())).toISOString(),
  };
}
function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .filter((v) => v?.type === 'text' || v?.type === 'input_text' || v?.type === 'output_text')
      .map((v) => v.text ?? '')
      .join('\n');
  return '';
}
export function parseLog(
  lines: string,
  harness: Binding['harness'],
  ref: string,
  startAt: string,
  endAt: string,
): SourceRecord | null {
  const from = Date.parse(startAt),
    through = Date.parse(endAt);
  const r: SourceRecord = {
    ref,
    harness,
    firstAt: '',
    lastAt: '',
    texts: [],
    userTurns: 0,
    assistantTurns: 0,
    toolCalls: 0,
    input: null,
    cached: null,
    output: null,
    reasoning: null,
    knownUsage: { input: null, cached: null, output: null, reasoning: null },
  };
  const ids = new Set<string>();
  const missingUsage = new Set<string>();
  const snapshots: { at: number; usage: any }[] = [];
  let before: any = null,
    after: any = null,
    startedHere = false;
  const add = (name: 'input' | 'cached' | 'output' | 'reasoning', value: unknown) => {
    const n = measured(value);
    if (n === null) {
      missingUsage.add(name);
      r[name] = null;
    } else {
      r.knownUsage![name] = (r.knownUsage![name] ?? 0) + n;
      if (!missingUsage.has(name)) r[name] = (r[name] ?? 0) + n;
    }
  };
  for (const line of lines.split('\n')) {
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (harness === 'codex' && e.type === 'session_meta') {
      if (typeof e.payload?.id === 'string') r.sessionId = e.payload.id;
      const parent = e.payload?.source?.subagent?.thread_spawn?.parent_thread_id;
      if (typeof parent === 'string') r.parentSessionId = parent;
      else if (typeof e.payload?.source === 'string' && e.payload.source !== 'subagent')
        r.agentDepth = 0;
      if (
        typeof e.payload?.cli_version === 'string' &&
        /^\d[0-9a-z.+-]{0,60}$/.test(e.payload.cli_version)
      )
        r.harnessVersion = e.payload.cli_version;
    }
    if (harness === 'claude' && typeof e.sessionId === 'string') r.sessionId = e.sessionId;
    if (
      harness === 'dsh' &&
      !e.type &&
      typeof e.id === 'string' &&
      Number.isSafeInteger(e.delegationDepth)
    ) {
      r.sessionId = e.id;
      r.agentDepth = e.delegationDepth;
      r.formatVersion = e.version;
    }
    const rawTime = e.timestamp ?? e.at ?? e.time ?? e.data?.at;
    const at =
      typeof rawTime === 'string'
        ? Date.parse(rawTime)
        : typeof rawTime === 'number'
          ? rawTime
          : NaN;
    if (!Number.isFinite(at)) continue;
    if (e.type === 'session_meta' && at >= from && at < through) startedHere = true;
    const p = e.payload ?? e.data ?? e;
    if (
      harness === 'codex' &&
      e.type === 'event_msg' &&
      p.type === 'token_count' &&
      p.info?.total_token_usage
    ) {
      if (at < through) snapshots.push({ at, usage: p.info.total_token_usage });
    }
    if (at < from || at >= through) continue;
    const identity = e.uuid ?? e.id ?? (e.seq !== undefined ? `${e.seq}:${e.type}` : p.message?.id);
    if (identity && ids.has(identity)) continue;
    if (identity) ids.add(identity);
    if (!r.firstAt || at < Date.parse(r.firstAt)) r.firstAt = new Date(at).toISOString();
    if (!r.lastAt || at > Date.parse(r.lastAt)) r.lastAt = new Date(at).toISOString();
    let role = '',
      text = '';
    if (harness === 'codex' && e.type === 'response_item' && p.type === 'message') {
      role = p.role;
      text = textOf(p.content);
    }
    if (
      harness === 'codex' &&
      e.type === 'response_item' &&
      ['function_call', 'custom_tool_call'].includes(p.type)
    )
      r.toolCalls = (r.toolCalls ?? 0) + 1;
    if (e.message?.role) {
      role = e.message.role;
      text = textOf(e.message.content);
      const u = e.message.usage;
      if (u) {
        const input = measured(u.input_tokens),
          cached = measured(u.cache_read_input_tokens),
          write = measured(u.cache_creation_input_tokens);
        add(
          'input',
          input !== null && cached !== null && write !== null ? input + cached + write : null,
        );
        add('cached', cached);
        add('output', u.output_tokens);
      } else if (e.message.role === 'assistant') {
        for (const key of ['input', 'cached', 'output', 'reasoning'] as const) add(key, null);
      }
      if (Array.isArray(e.message.content))
        r.toolCalls =
          (r.toolCalls ?? 0) + e.message.content.filter((v: any) => v.type === 'tool_use').length;
    }
    if (['user/message', 'assistant/message'].includes(e.type)) {
      role = e.type.split('/')[0];
      text = textOf(p.message?.content ?? p.content);
    }
    if (e.type === 'tool/call') r.toolCalls = (r.toolCalls ?? 0) + 1;
    if (e.type === 'call' && e.tokens) {
      add(
        'input',
        [e.tokens.input, e.tokens.cacheRead, e.tokens.cacheWrite].every((v) => measured(v) !== null)
          ? e.tokens.input + e.tokens.cacheRead + e.tokens.cacheWrite
          : null,
      );
      add('cached', e.tokens.cacheRead);
      add('output', e.tokens.output);
      add('reasoning', e.tokens.reasoning);
    } else if (e.type === 'call') {
      for (const key of ['input', 'cached', 'output', 'reasoning'] as const) add(key, null);
    }
    if (role === 'user') {
      const explicitActor = e.actorType ?? p.actorType ?? e.message?.actorType;
      const toolResult =
        Array.isArray(e.message?.content) &&
        e.message.content.length > 0 &&
        e.message.content.every((v: any) => v.type === 'tool_result');
      const actor = ['human', 'agent', 'system', 'unknown'].includes(explicitActor)
        ? explicitActor
        : toolResult || e.isMeta === true
          ? 'system'
          : r.parentSessionId || (r.agentDepth ?? 0) > 0 || e.isSidechain === true
            ? 'agent'
            : r.agentDepth === 0 || e.isSidechain === false
              ? 'human'
              : 'unknown';
      if (actor === 'human' && r.userTurns !== null) r.userTurns++;
      if (actor === 'unknown') r.userTurns = null;
    }
    if (role === 'assistant') r.assistantTurns = (r.assistantTurns ?? 0) + 1;
    if (['user', 'assistant'].includes(role) && text) {
      r.texts.push(`${role}: ${redact(text)}`);
      if (r.texts.length > 18) r.texts.splice(4, 1);
    }
  }
  snapshots.sort((a, b) => a.at - b.at);
  before = snapshots.filter((s) => s.at < from).at(-1)?.usage ?? null;
  const within = snapshots.filter((s) => s.at >= from);
  after = within.at(-1)?.usage ?? null;
  if (after) {
    const base =
      before ??
      (startedHere
        ? { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 }
        : null);
    if (base)
      for (const [name, key] of [
        ['input', 'input_tokens'],
        ['cached', 'cached_input_tokens'],
        ['output', 'output_tokens'],
        ['reasoning', 'reasoning_output_tokens'],
      ] as const) {
        const a = measured(after[key]),
          b = measured(base[key]);
        let previous = b,
          decreased = false;
        for (const s of within) {
          const value = measured(s.usage[key]);
          if (previous !== null && value !== null && value < previous) decreased = true;
          if (value !== null) previous = value;
        }
        r[name] = !decreased && a !== null && b !== null && a >= b ? a - b : null;
        r.knownUsage![name] = r[name];
      }
  }
  if (!r.texts.length && r.assistantTurns === 0) {
    r.userTurns = null;
    r.assistantTurns = null;
    if (r.toolCalls === 0) r.toolCalls = null;
  }
  return r.firstAt ? r : null;
}

function mergeLogCopies(previous: string, next: string) {
  if (previous.trim() === next.trim()) return { content: previous, ambiguous: false };
  const identified = new Map<string, any>(),
    anonymous = new Map<string, { entry: any; count: number }>();
  let ambiguous = false;
  for (const content of [previous, next]) {
    const localAnonymous = new Map<string, { entry: any; count: number }>();
    for (const line of content.split('\n')) {
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const id = e.uuid ?? e.id ?? (e.seq !== undefined ? `${e.seq}:${e.type}` : e.message?.id);
      const stable = id ? `${e.type ?? e.message?.role}:${id}` : null;
      if (stable) {
        const old = identified.get(stable);
        if (old && canonical(old) !== canonical(e))
          throw new Error('重复日志事件标识对应不同内容，请核对来源');
        identified.set(stable, e);
      } else {
        const key = canonical(e),
          item = localAnonymous.get(key) ?? { entry: e, count: 0 };
        item.count++;
        localAnonymous.set(key, item);
      }
    }
    for (const [key, item] of localAnonymous) {
      if (
        anonymous.has(key) &&
        (item.entry.type === 'response_item' || item.entry.message || item.entry.type === 'call')
      )
        ambiguous = true;
      if (!anonymous.has(key) || anonymous.get(key)!.count < item.count) anonymous.set(key, item);
    }
  }
  const entries = [
    ...identified.values(),
    ...[...anonymous.values()].flatMap((v) => Array.from({ length: v.count }, () => v.entry)),
  ];
  const time = (e: any) => {
    const value = e.timestamp ?? e.at ?? e.time ?? e.data?.at;
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  entries.sort(
    (a, b) =>
      time(a) - time(b) || Number(b.type === 'session_meta') - Number(a.type === 'session_meta'),
  );
  return { content: entries.map((e) => JSON.stringify(e)).join('\n'), ambiguous };
}

export async function collectSources(
  bindings: Binding[],
  store: DesktopStore,
  startAt: string,
  endAt: string,
  options: { signal?: AbortSignal } = {},
) {
  const checkCancellation = () => {
    if (options.signal?.aborted) throw new Error('摘要采集已取消，未继续读取来源');
  };
  checkCancellation();
  const records = new Map<string, SourceRecord>(),
    contents = new Map<string, string>(),
    ambiguousCopies = new Set<string>(),
    seen = new Set<string>(),
    dshCalls = new Map<string, string>();
  let bytes = 0,
    visited = 0;
  const key = store.get<string>('salt')!;
  for (const b of bindings.filter((v) => v.enabled)) {
    const validateRoot = () => {
      checkCancellation();
      try {
        const root = authorizedSourceRoot(b);
        checkCancellation();
        return root;
      } catch (cause) {
        checkCancellation();
        store.revokeSourceAuthorization(b.id);
        throw cause;
      }
    };
    const root = validateRoot();
    const todo = [root];
    while (todo.length && visited < 20000) {
      checkCancellation();
      const directory = todo.pop()!;
      const entries = await readdir(directory, { withFileTypes: true });
      checkCancellation();
      validateRoot();
      for (const entry of entries) {
        checkCancellation();
        visited++;
        if (visited > 20000) break;
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'opencost-summary-runs'].includes(entry.name))
            todo.push(path);
          continue;
        }
        if (
          !entry.isFile() ||
          !/\.(jsonl(?:\.zstd)?|json)$/.test(entry.name) ||
          /(?:auth|config|credential|settings|identity|billing|invoice|receipt|secret|key)/i.test(
            entry.name,
          )
        )
          continue;
        const info = await stat(path, { bigint: true });
        checkCancellation();
        validateRoot();
        if (!info.isFile()) throw new Error('来源文件类型已变化，请稍后重试');
        if (Number(info.mtimeMs) < Date.parse(startAt)) continue;
        if (info.size > 8n * 1024n * 1024n)
          throw new Error('有日志超过单文件 8 MiB 上限，请先按日期导出到专用目录；本次不截断记录');
        if (bytes + Number(info.size) > 32 * 1024 * 1024 || records.size >= 100)
          throw new Error('本日记录超过读取上限，请缩小已绑定来源；不会截断成完整摘要');
        const actual = await realpath(path),
          rel = relative(root, actual);
        checkCancellation();
        validateRoot();
        if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
          throw new Error('来源越过已授权目录');
        if (seen.has(actual)) continue;
        seen.add(actual);
        {
          const ref = createHmac('sha256', key).update(actual).digest('hex');
          // Bind the read to the file checked above. A directory/file can be
          // replaced and restored between awaits, so an end-only path check is
          // insufficient; a handle opened on the replacement has a different
          // filesystem identity even after the original path has been restored.
          const file = await open(actual, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          let buffer: Buffer;
          try {
            checkCancellation();
            const opened = await file.stat({ bigint: true });
            checkCancellation();
            validateRoot();
            if (
              !opened.isFile() ||
              opened.dev !== info.dev ||
              opened.ino !== info.ino ||
              opened.ino === 0n
            )
              throw new Error('来源文件在读取前被替换，请重新确认绑定；本次不调用模型');
            const chunks: Buffer[] = [];
            let size = 0;
            while (true) {
              checkCancellation();
              const chunk = Buffer.allocUnsafe(Math.min(65536, 8 * 1024 * 1024 + 1 - size));
              const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
              checkCancellation();
              if (!bytesRead) break;
              size += bytesRead;
              if (size > 8 * 1024 * 1024)
                throw new Error('读取期间日志超过单文件 8 MiB 上限，本次不截断记录');
              chunks.push(chunk.subarray(0, bytesRead));
            }
            buffer = Buffer.concat(chunks, size);
            validateRoot();
          } finally {
            await file.close();
          }
          checkCancellation();
          bytes += buffer.length;
          if (bytes > 32 * 1024 * 1024)
            throw new Error('读取期间日志总量超过 32 MiB 上限，本次不截断记录');
          const expanded = entry.name.endsWith('.zstd')
            ? await promisify(zstdDecompress)(buffer, { maxOutputLength: 8 * 1024 * 1024 })
            : buffer;
          checkCancellation();
          if (expanded !== buffer) {
            bytes += expanded.length - buffer.length;
            if (bytes > 32 * 1024 * 1024) throw new Error('解压后的日志总量超过 32 MiB 上限');
          }
          let content = expanded.toString('utf8');
          let version: string | undefined,
            usageExport = false;
          if (entry.name.endsWith('.json')) {
            let data: any;
            try {
              data = JSON.parse(content);
            } catch {
              continue;
            }
            if (data?.format === 'dsh-opencost-export-1') {
              const exported = readDshExport(data);
              version = exported.harness.version;
              usageExport = true;
              content = exported.calls
                .filter((c) => {
                  const body = JSON.stringify(c),
                    previous = dshCalls.get(c.id);
                  if (previous && previous !== body)
                    throw new Error('DSH 重复调用标识对应不同内容，已停止读取');
                  if (previous) return false;
                  dshCalls.set(c.id, body);
                  return true;
                })
                .map((c) => JSON.stringify(c))
                .join('\n');
            } else if (Array.isArray(data?.messages))
              content = data.messages
                .map((m: any) => {
                  const u = m.info?.tokens;
                  return JSON.stringify({
                    uuid: m.info?.id ?? m.id,
                    timestamp: m.info?.time?.created
                      ? new Date(m.info.time.created).toISOString()
                      : m.timestamp,
                    message: {
                      role: m.info?.role ?? m.role,
                      content: m.parts ?? m.content,
                      usage: u
                        ? {
                            input_tokens: u.input,
                            output_tokens: u.output,
                            cache_read_input_tokens: u.cache?.read,
                            cache_creation_input_tokens: u.cache?.write,
                          }
                        : undefined,
                    },
                  });
                })
                .join('\n');
            else if (Array.isArray(data?.events))
              content = data.events.map((e: any) => JSON.stringify(e)).join('\n');
            else continue;
          }
          const record = parseLog(content, b.harness, ref, startAt, endAt);
          if (record) {
            if (version) record.harnessVersion = version;
            if (usageExport) record.usageExport = true;
            if (record.sessionId)
              record.ref = createHmac('sha256', key)
                .update(b.harness + ':' + record.sessionId)
                .digest('hex');
            const previous = contents.get(record.ref);
            if (previous) {
              const merged = mergeLogCopies(previous, content);
              const combined = parseLog(merged.content, b.harness, record.ref, startAt, endAt)!;
              combined.harnessVersion =
                record.harnessVersion ?? records.get(record.ref)?.harnessVersion;
              combined.usageExport = record.usageExport;
              if (merged.ambiguous) ambiguousCopies.add(record.ref);
              if (ambiguousCopies.has(record.ref)) {
                combined.userTurns = combined.assistantTurns = combined.toolCalls = null;
                if (b.harness !== 'codex') {
                  combined.input = combined.cached = combined.output = combined.reasoning = null;
                  combined.knownUsage = {
                    input: null,
                    cached: null,
                    output: null,
                    reasoning: null,
                  };
                }
              }
              records.set(record.ref, combined);
              contents.set(record.ref, merged.content);
            } else {
              records.set(record.ref, record);
              contents.set(record.ref, content);
            }
          }
        }
      }
    }
    if (todo.length || visited >= 20000) throw new Error('来源文件过多，请绑定更具体的日志目录');
    validateRoot();
  }
  checkCancellation();
  return [...records.values()];
}
export function measurements(records: SourceRecord[]): DailySummary['measurements'] {
  const hasDshExport = records.some((r) => r.harness === 'dsh' && r.usageExport);
  const metered = records.filter((r) => !(hasDshExport && r.harness === 'dsh' && !r.usageExport));
  const sum = (key: 'input' | 'cached' | 'output' | 'reasoning') =>
    metered.length && metered.every((r) => r[key] !== null)
      ? metered.reduce((n, r) => n + r[key]!, 0)
      : null;
  const bySession = new Map(
    records.filter((r) => r.sessionId).map((r) => [r.harness + ':' + r.sessionId, r]),
  );
  const depth = (r: SourceRecord, seen = new Set<string>()): number | null => {
    if (r.agentDepth !== undefined) return r.agentDepth;
    const parent = r.parentSessionId
      ? bySession.get(r.harness + ':' + r.parentSessionId)
      : undefined;
    if (!parent) return null;
    const id = r.harness + ':' + r.sessionId;
    if (seen.has(id)) throw new Error('日志代理关系存在循环');
    seen.add(id);
    const d = depth(parent, seen);
    return d === null ? null : d + 1;
  };
  const depths = records.map((r) => depth(r));
  const known = (key: 'input' | 'cached' | 'output' | 'reasoning') => {
    const values = metered.map((r) => r[key] ?? r.knownUsage?.[key] ?? null);
    return values.some((v) => v !== null)
      ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
      : null;
  };
  const events = (key: 'userTurns' | 'assistantTurns' | 'toolCalls') =>
    records.length && records.every((r) => r[key] !== null)
      ? records.reduce((sum, r) => sum + r[key]!, 0)
      : null;
  return {
    sourceRecords: records.length,
    inputTokens: sum('input'),
    cachedInputTokens: sum('cached'),
    outputTokens: sum('output'),
    reasoningTokens: sum('reasoning'),
    knownTokenSubtotals: {
      inputTokens: known('input'),
      cachedInputTokens: known('cached'),
      outputTokens: known('output'),
      reasoningTokens: known('reasoning'),
    },
    userTurns: events('userTurns'),
    assistantTurns: events('assistantTurns'),
    toolCalls: events('toolCalls'),
    modelCalls: null,
    agentCount: records.length && bySession.size === records.length ? bySession.size : null,
    rootAgentCount: records.length && bySession.size === records.length && depths.every(d => d !== null) && depths.some(d => d === 0) ? depths.filter(d => d === 0).length : null,
    maxAgentDepth:
      depths.length && depths.every((d) => d !== null) ? Math.max(...(depths as number[])) : null,
    observedSpanMs: records.length
      ? Math.max(...records.map((r) => Date.parse(r.lastAt))) -
        Math.min(...records.map((r) => Date.parse(r.firstAt)))
      : null,
  };
}
