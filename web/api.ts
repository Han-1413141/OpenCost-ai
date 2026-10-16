import type { Comparison } from '../shared/analysis';
import type { buildBoards } from '../shared/boards';
import type { CommunityStatistics } from '../shared/community-statistics';
import { ApiRetryCooldowns, apiRetryScope, retryWaitMessage } from './retry-after';
import { getLocale } from './i18n/locale';
export type { PlanComparison as PlanRow } from '../shared/plans';
import type { PlanComparison as PlanRow } from '../shared/plans';
export type ExploreData = {
  source: 'demo' | 'community';
  evidence: 'verified' | 'all';
  rows: Comparison[];
  plans: PlanRow[];
  boards?: ReturnType<typeof buildBoards>;
  rankingTargetsVersion?: string | null;
  rankingStudiesVersion?: string | null;
  statisticsVersion?: string | null;
  communityStats?: CommunityStatistics;
  updatedAt: string;
  threshold: { tasks: number; sources: number; maxSourceShare: number };
};
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable?: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export type RequestError = string | Error;
export function publicErrorState(error: RequestError) {
  const code = error instanceof ApiError ? error.code : undefined;
  const retryable = !(error instanceof ApiError && error.retryable === false);
  const titles: Record<string, string> = {
    aggregation_pending: '公开统计正在准备',
    aggregation_busy: '公开统计服务繁忙',
    aggregation_timeout: '公开统计计算超时',
    aggregation_capacity: '公开统计容量不足',
    aggregation_storage_capacity: '公开统计存储容量不足',
    aggregation_numeric_overflow: '公开统计数据需要修复',
    aggregation_unavailable: '公开统计暂时不可用',
  };
  return {
    title: (code && titles[code]) || '数据暂时无法加载',
    message: typeof error === 'string' ? error : error.message,
    retryable,
    actionNote: retryable ? '' : '需要管理员调整容量或修复数据后再读取，重复请求不会解决。',
  };
}
const aggregationReads = new Set([
  '/api/explore',
  '/api/rankings',
  '/api/comparisons',
  '/api/summaries',
  '/api/feedback',
  '/api/feedback/mine',
  '/api/workspace/feedback',
]);
const retryCooldowns = new ApiRetryCooldowns();
export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  opts.signal?.throwIfAborted();
  const scope = apiRetryScope(path, opts.method);
  const waiting = retryCooldowns.remaining(scope);
  if (waiting)
    throw new ApiError(
      retryWaitMessage(waiting.remainingMs),
      waiting.status,
      waiting.code,
      true,
      waiting.remainingMs,
    );
  const controller = new AbortController();
  const abort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', abort, { once: true });
  const timeoutMs =
    (opts.method ?? 'GET').toUpperCase() === 'GET' && aggregationReads.has(path.split(/[?#]/, 1)[0])
      ? 35000
      : 15000;
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(`请求超过 ${timeoutMs / 1000} 秒，可稍后手动重试。`, 'TimeoutError'),
      ),
    timeoutMs,
  );
  try {
    const headers = new Headers(opts.headers);
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    // This UI identity is only a cache boundary. Authentication stays in an HttpOnly cookie.
    if (/^Bearer github-session:[A-Za-z0-9-]{1,39}$/.test(headers.get('Authorization') ?? ''))
      headers.delete('Authorization');
    if ((opts.method ?? 'GET').toUpperCase() === 'POST') headers.set('X-OpenCost-CSRF', '1');
    const res = await fetch(path, {
      ...opts,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const receivedAt = Date.now();
    const rememberWait = (code?: string, retryable?: boolean) =>
      retryCooldowns.record(
        scope,
        res.status,
        res.headers?.get('Retry-After'),
        receivedAt,
        code,
        retryable,
      );
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      controller.signal.throwIfAborted();
      const wait = rememberWait();
      throw new ApiError(
        (res.ok
          ? '服务返回的数据格式不符合预期，请稍后重试。'
          : `服务暂时无法完成请求（HTTP ${res.status}），请稍后重试。`) +
          (wait ? ` ${retryWaitMessage(wait.remainingMs)}` : ''),
        res.status,
        'invalid_response',
        undefined,
        wait?.remainingMs,
      );
    }
    controller.signal.throwIfAborted();
    if (!res.ok) {
      const failure = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const code = typeof failure.code === 'string' ? failure.code : undefined;
      const retryable = typeof failure.retryable === 'boolean' ? failure.retryable : undefined;
      const wait = rememberWait(code, retryable);
      const issues = Array.isArray(failure.issues)
        ? failure.issues
            .slice(0, 4)
            .flatMap((issue) =>
              issue &&
              typeof issue === 'object' &&
              typeof issue.path === 'string' &&
              typeof issue.message === 'string'
                ? [`${issue.path}：${issue.message}`]
                : [],
            )
        : [];
      throw new ApiError(
        [
          typeof failure.error === 'string' && failure.error
            ? failure.error
            : `请求失败（HTTP ${res.status}）。`,
          ...issues,
          ...(wait ? [retryWaitMessage(wait.remainingMs)] : []),
        ].join('；'),
        res.status,
        code,
        retryable,
        wait?.remainingMs,
      );
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', abort);
  }
}
export function download(name: string, value: unknown) {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {
    type: typeof value === 'string' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const money = (minor: number | null | undefined, currency = 'CNY') =>
  minor == null
    ? '—'
    : new Intl.NumberFormat(getLocale(), {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(minor / 100);
export const number = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(n);
export const percent = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
