import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { canonical, EnvelopeSchema, type Attestation, type Envelope } from '../shared/schema.js';
import { analyze } from '../shared/analysis.js';
import { evaluateEnvelope } from '../shared/evaluation.js';
import { PersonalFeedbackSchema, type PersonalFeedback } from '../shared/personal-feedback.js';
import { feedbackLink } from '../shared/feedback-link.js';
import { parseRetryAfter } from '../shared/http-retry.js';
import {
  ContributionIndexPageSchema,
  ContributionDetailSchema,
} from '../shared/contribution-history.js';

export function receiptFeedback(
  receipt: Record<string, unknown>,
  kind: PersonalFeedback['kind'],
): PersonalFeedback | null {
  const result = PersonalFeedbackSchema.safeParse(receipt.feedback);
  return result.success && result.data.recordId === receipt.id && result.data.kind === kind
    ? result.data
    : null;
}

export type PreparedDraft = {
  format: 'opencost-preview-1';
  envelope: Envelope;
  digest: string;
  idempotencyKey: string;
  analysis: ReturnType<typeof analyze>;
  evaluation: ReturnType<typeof evaluateEnvelope>;
};
export function prepareDraft(input: unknown): PreparedDraft {
  const envelope = EnvelopeSchema.parse(input);
  if (
    Buffer.byteLength(
      JSON.stringify({ envelope, attestation: null, reviewToken: 'x'.repeat(2000) }),
      'utf8',
    ) >
    512 * 1024
  )
    throw new Error('完整记录超过接口 512 KiB 限制；保留本地材料，不截断代理或费用记录');
  return {
    format: 'opencost-preview-1',
    envelope,
    digest: createHash('sha256').update(canonical(envelope)).digest('hex'),
    idempotencyKey: randomUUID(),
    analysis: analyze(envelope),
    evaluation: evaluateEnvelope(envelope),
  };
}
export function createAccessKey() {
  return randomBytes(32).toString('base64url');
}
export function contributorId(accessKey: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(accessKey)) throw new Error('访问密钥格式错误');
  return createHash('sha256').update(accessKey).digest('hex');
}
export function endpointOrigin(endpoint: string) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('只填写站点 Origin，不包含路径、查询参数或凭据');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('非本机地址必须使用 HTTPS');
  return url.origin;
}
// A default bearer must never be reused for another site. Explicit keys remain caller-owned.
export function defaultAccessKeyPath(endpoint: string) {
  const origin = endpointOrigin(endpoint);
  return resolve(
    '.local',
    'identities',
    `${createHash('sha256').update(origin).digest('hex')}.key`,
  );
}
export const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;
export class HttpRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  constructor(
    status: number,
    message: string,
    metadata: { code?: string; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(`${status}: ${message}`);
    this.name = 'HttpRequestError';
    this.status = status;
    this.code = metadata.code;
    this.retryable = metadata.retryable;
    this.retryAfterMs = metadata.retryAfterMs;
  }
}
async function responseJson(
  response: Response,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error('站点没有返回 JSON 内容');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    if (Number(response.headers.get('content-length')) > MAX_JSON_RESPONSE_BYTES)
      throw new Error('站点 JSON 响应超过 4 MiB，请缩小查询范围或使用分页');
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.length;
      if (length > MAX_JSON_RESPONSE_BYTES)
        throw new Error('站点 JSON 响应超过 4 MiB，请缩小查询范围或使用分页');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await (cancellation ?? reader.cancel().catch(() => {}));
    reader.releaseLock();
  }
  let data: unknown;
  try {
    data = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)),
    );
  } catch {
    throw new Error('站点返回无效 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('站点 JSON 响应必须是对象');
  return data as Record<string, unknown>;
}
export async function request(
  endpoint: string,
  path: string,
  accessKey: string,
  body?: unknown,
  idempotencyKey?: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  // A fresh contribution report can wait for the bounded 30-second fact query.
  // Give its response time to arrive; other requests retain their existing limit.
  const timeoutMs =
    !body && (path === '/api/feedback' || path.startsWith('/api/feedback?')) ? 35000 : 20000;
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const response = await fetch(`${endpoint}${path}`, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: requestSignal,
    headers: {
      Authorization: `Bearer ${accessKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: Record<string, unknown>;
  try {
    data = await responseJson(response, requestSignal);
  } catch (error) {
    // A proxy can reject a request with HTML or an empty body. Preserve its status
    // and deadline too, while cancellation remains cancellation rather than a retry.
    requestSignal.throwIfAborted();
    if (response.ok) throw error;
    throw new HttpRequestError(response.status, '请求失败，站点未返回有效 JSON', {
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  if (!response.ok)
    throw new HttpRequestError(response.status, String(data.error ?? '请求失败'), {
      code:
        typeof data.code === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(data.code)
          ? data.code
          : undefined,
      retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  return data;
}
export async function submitDraft(options: {
  endpoint: string;
  draft: PreparedDraft;
  accessKey: string;
  confirmedDigest: string;
  attestation?: Attestation | null;
  signal?: AbortSignal;
  beforeRequest?: () => void;
}) {
  const { draft } = options;
  const current = prepareDraft(draft.envelope);
  if (current.digest !== draft.digest || options.confirmedDigest !== draft.digest)
    throw new Error('内容已经改变或没有确认当前摘要，请重新预览');
  if (!draft.envelope.consent.store) throw new Error('草稿未选择允许保存');
  if (draft.envelope.origin !== 'real') throw new Error('演示数据不能提交');
  if (options.attestation && options.attestation.contributor !== contributorId(options.accessKey))
    throw new Error('独立证明不属于当前访问密钥');
  const endpoint = endpointOrigin(options.endpoint);
  const payload = { envelope: draft.envelope, attestation: options.attestation ?? null };
  const beforeRequest = () => {
    options.signal?.throwIfAborted();
    options.beforeRequest?.();
    options.signal?.throwIfAborted();
  };
  beforeRequest();
  const preview = await request(
    endpoint,
    '/api/contributions/preview',
    options.accessKey,
    payload,
    draft.idempotencyKey,
    options.signal,
  );
  if ('replayed' in preview) {
    if (
      preview.replayed !== true ||
      preview.digest !== draft.digest ||
      !preview.receipt ||
      typeof preview.receipt !== 'object' ||
      Array.isArray(preview.receipt)
    )
      throw new Error('历史上传回执无效，保留原预览与幂等键以便重试');
    // The original commit already succeeded. Keep its validated receipt even when
    // consent was revoked during this read; no further commit request is needed.
    return validateContributionReceipt(preview.receipt as Record<string, unknown>, draft.digest, endpoint, options.accessKey);
  }
  // Older saved requests may lack current intake metadata. Only an exact server
  // replay can recover them; a new commit must still meet all current requirements.
  if (!draft.envelope.collector)
    throw new Error('新贡献需要 AI Skill 或采集器提供采集来源 id、version 和 digest');
  if (draft.envelope.schemaVersion !== '1.1')
    throw new Error('新贡献使用 1.1 协议，请补充任务评价、代理范围和费用覆盖字段');
  if (!draft.envelope.collectionWindow)
    throw new Error('新贡献需要用户选择的采集时间范围，请先运行 init');
  beforeRequest();
  const receipt = await request(
    endpoint,
    '/api/contributions',
    options.accessKey,
    { ...payload, reviewToken: preview.reviewToken },
    draft.idempotencyKey,
    options.signal,
  );
  return validateContributionReceipt(receipt, draft.digest, endpoint, options.accessKey);
}
function validateContributionReceipt(receipt: Record<string, unknown>, digest: string, endpoint: string, accessKey: string) {
  if (
    typeof receipt.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      receipt.id,
    ) ||
    !['stored', 'quarantined'].includes(String(receipt.status)) ||
    receipt.digest !== digest
  )
    throw new Error('上传回执无效，不能推进成功位置；请保留原预览并用同一幂等键重试');
  return Object.assign(receipt, { feedback: receiptFeedback(receipt, 'contribution'), feedbackUrl: feedbackLink(endpoint, accessKey, { kind: 'contribution', recordId: receipt.id }) });
}
export function listRecords(
  endpoint: string,
  accessKey: string,
  options: { limit?: number; cursor?: string } = {},
) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error('记录分页大小必须是 1 至 200 的整数');
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor !== undefined) {
    if (typeof options.cursor !== 'string' || !options.cursor.length || options.cursor.length > 512)
      throw new Error('记录分页游标无效');
    // Cursors are opaque; preserve the server value and encode it as a single query parameter.
    query.set('cursor', options.cursor);
  }
  return request(endpointOrigin(endpoint), `/api/contributions/mine?${query}`, accessKey);
}
/** Lightweight private list; the legacy listRecords envelope response remains unchanged. */
export async function listRecordIndex(
  endpoint: string,
  accessKey: string,
  options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
) {
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('记录索引分页大小必须是 1 至 100 的整数');
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor !== undefined) {
    if (typeof options.cursor !== 'string' || !options.cursor.length || options.cursor.length > 512)
      throw new Error('记录索引游标无效');
    query.set('cursor', options.cursor);
  }
  const data = await request(
    endpointOrigin(endpoint),
    `/api/contributions/index?${query}`,
    accessKey,
    undefined,
    undefined,
    options.signal,
  );
  const parsed = ContributionIndexPageSchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.records.length > limit ||
    new Set(parsed.data.records.map((row) => row.id)).size !== parsed.data.records.length
  )
    throw new Error('个人记录索引响应无效');
  return parsed.data;
}

export async function getRecord(
  endpoint: string,
  accessKey: string,
  id: string,
  options: { expectedDigest?: string; signal?: AbortSignal } = {},
) {
  if (
    typeof id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
  )
    throw new Error('记录标识无效');
  if (options.expectedDigest !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedDigest))
    throw new Error('记录摘要标识无效');
  const data = await request(
    endpointOrigin(endpoint),
    `/api/contributions/${encodeURIComponent(id)}`,
    accessKey,
    undefined,
    undefined,
    options.signal,
  );
  const parsed = ContributionDetailSchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.record.id !== id ||
    (options.expectedDigest !== undefined &&
      parsed.data.record.digest !== options.expectedDigest) ||
    createHash('sha256')
      .update(canonical((data.record as { envelope: unknown }).envelope))
      .digest('hex') !== parsed.data.record.digest
  )
    throw new Error('个人记录内容与标识不一致，请刷新记录后重试');
  return parsed.data.record;
}
export async function listFeedback(endpoint: string, accessKey: string, signal?: AbortSignal) {
  const data = await request(
    endpointOrigin(endpoint),
    '/api/feedback/mine?limit=20',
    accessKey,
    undefined,
    undefined,
    signal,
  );
  if (!Array.isArray(data.reports) || data.reports.length > 20 || data.visibility !== 'private')
    throw new Error('个人反馈列表无效');
  return data.reports.map((report) => PersonalFeedbackSchema.parse(report));
}

export type FeedbackReadResult = {
  feedback: PersonalFeedback;
  persisted: boolean;
  historyCoverage: {
    coverage: 'complete' | 'partial' | 'unknown';
    truncated: boolean | null;
    records: number | null;
  };
  visibility: 'private';
};

/** Read one private report on demand; temporary reports must never become frozen history. */
export async function getFeedback(
  endpoint: string,
  accessKey: string,
  kind: PersonalFeedback['kind'],
  recordId: string,
  signal?: AbortSignal,
): Promise<FeedbackReadResult> {
  if (
    !['contribution', 'journal', 'subscription'].includes(kind) ||
    typeof recordId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(recordId)
  )
    throw new Error('反馈类型或记录标识无效');
  const query = new URLSearchParams({ kind, recordId });
  const data = await request(
    endpointOrigin(endpoint),
    `/api/feedback?${query}`,
    accessKey,
    undefined,
    undefined,
    signal,
  );
  const parsed = PersonalFeedbackSchema.safeParse(data.feedback);
  const history = data.historyCoverage;
  if (
    data.visibility !== 'private' ||
    typeof data.persisted !== 'boolean' ||
    !parsed.success ||
    parsed.data.kind !== kind ||
    parsed.data.recordId !== recordId ||
    (data.persisted && (parsed.data.provisional || parsed.data.referenceUnavailable)) ||
    !history ||
    typeof history !== 'object' ||
    Array.isArray(history)
  )
    throw new Error('个人反馈响应无效');
  const coverage = history as Record<string, unknown>;
  if (
    typeof coverage.coverage !== 'string' ||
    !['complete', 'partial', 'unknown'].includes(coverage.coverage) ||
    (coverage.truncated !== null && typeof coverage.truncated !== 'boolean') ||
    (coverage.records !== null &&
      (typeof coverage.records !== 'number' ||
        !Number.isSafeInteger(coverage.records) ||
        coverage.records < 0))
  )
    throw new Error('个人反馈历史覆盖信息无效');
  return {
    feedback: data.persisted ? parsed.data : { ...parsed.data, provisional: true },
    persisted: data.persisted,
    historyCoverage: {
      coverage: coverage.coverage as FeedbackReadResult['historyCoverage']['coverage'],
      truncated: coverage.truncated as boolean | null,
      records: coverage.records as number | null,
    },
    visibility: 'private',
  };
}

const finiteCount = (n: unknown): number | null => {
  if (n === undefined || n === null) return null;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0)
    throw new Error('用量必须是非负安全整数');
  return n;
};
export function normalizeOpenAIUsage(usage: {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}) {
  return {
    inputTokens: finiteCount(usage.input_tokens ?? usage.prompt_tokens),
    cachedInputTokens: finiteCount(
      usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens,
    ),
    outputTokens: finiteCount(usage.output_tokens ?? usage.completion_tokens),
    reasoningTokens: finiteCount(
      usage.output_tokens_details?.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens,
    ),
  };
}
export function normalizeAnthropicUsage(usage: {
  input_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens: number;
}) {
  const cached = finiteCount(usage.cache_read_input_tokens);
  const creation = finiteCount(usage.cache_creation_input_tokens);
  const uncached = finiteCount(usage.input_tokens);
  return {
    inputTokens:
      uncached !== null && cached !== null && creation !== null
        ? uncached + cached + creation
        : null,
    cachedInputTokens: cached,
    cacheWriteTokens: creation,
    outputTokens: finiteCount(usage.output_tokens),
    reasoningTokens: null,
  };
}
export function normalizeDshUsage(usage: {
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens?: number | null;
  outputTokens: number | null;
  reasoningTokens?: number;
  inputIncludesCache: boolean;
  outputIncludesReasoning: boolean;
}) {
  const cached = finiteCount(usage.cacheReadTokens),
    creation = finiteCount(usage.cacheWriteTokens),
    reasoning = finiteCount(usage.reasoningTokens),
    input = finiteCount(usage.inputTokens),
    output = finiteCount(usage.outputTokens);
  return {
    inputTokens: usage.inputIncludesCache
      ? input
      : input !== null && cached !== null
        ? usage.cacheWriteTokens === undefined
          ? input + cached
          : creation !== null
            ? input + cached + creation
            : null
        : null,
    cachedInputTokens: cached,
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: creation } : {}),
    outputTokens: usage.outputIncludesReasoning
      ? output
      : output !== null && reasoning !== null
        ? output + reasoning
        : null,
    reasoningTokens: reasoning,
  };
}
