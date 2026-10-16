import { parseRetryAfter } from '../shared/http-retry';

type Cooldown = { until: number; status: number; code?: string };
export type RetryWait = Cooldown & { remainingMs: number };
const globalLimits = new Set(['REQUEST_ADMISSION_LIMIT', 'EDGE_RATE_LIMITED']);

/** Only application API paths participate; queries, credentials and bodies are never retained. */
export function apiRetryScope(path: string, method = 'GET'): string | undefined {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    return undefined;
  const normalized = new URL(path, 'https://opencost.invalid');
  if (
    normalized.origin !== 'https://opencost.invalid' ||
    !normalized.pathname.startsWith('/api/') ||
    normalized.pathname.length > 1024
  )
    return undefined;
  const verb = method.toUpperCase();
  return /^[A-Z]{1,16}$/.test(verb) ? `${verb} ${normalized.pathname}` : undefined;
}

/** Page-local, bounded state. No timers, background retries, storage or cross-tab messages. */
export class ApiRetryCooldowns {
  private global?: Cooldown;
  private readonly paths = new Map<string, Cooldown>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private prune(now: number) {
    if (this.global && this.global.until <= now) this.global = undefined;
    for (const [path, cooldown] of this.paths) {
      if (cooldown.until <= now) this.paths.delete(path);
    }
  }

  remaining(scope: string | undefined): RetryWait | undefined {
    if (!scope) return undefined;
    const now = this.now();
    this.prune(now);
    const local = this.paths.get(scope);
    if (local) {
      this.paths.delete(scope);
      this.paths.set(scope, local);
    }
    const selected =
      this.global && (!local || this.global.until >= local.until) ? this.global : local;
    return selected ? { ...selected, remainingMs: selected.until - now } : undefined;
  }

  record(
    scope: string | undefined,
    status: number,
    header: string | null | undefined,
    receivedAt: number,
    code?: string,
    retryable?: boolean,
  ): RetryWait | undefined {
    if (!scope || ![429, 503].includes(status) || retryable === false) return undefined;
    const delay = parseRetryAfter(header, receivedAt);
    if (delay === undefined) return undefined;
    const now = this.now();
    const until = receivedAt + delay;
    this.prune(now);
    if (until <= now) return undefined;
    const safeCode = code && /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? code : undefined;
    const cooldown = { until, status, code: safeCode };
    if (safeCode && globalLimits.has(safeCode)) {
      if (!this.global || this.global.until < until) this.global = cooldown;
    } else {
      const previous = this.paths.get(scope);
      this.paths.delete(scope);
      this.paths.set(scope, previous && previous.until >= until ? previous : cooldown);
      if (this.paths.size > 64) this.paths.delete(this.paths.keys().next().value!);
    }
    return this.remaining(scope);
  }
}

export function retryWaitMessage(waitMs: number) {
  return `服务要求等待，请在 ${Math.ceil(waitMs / 1000)} 秒后手动重试；页面不会自动发送请求。`;
}
