import type { HarnessDetection } from './model.js';

const messages = {
  authentication:
    '所选 Harness 报告身份验证失败，请先在原环境重新登录或检查 API 配置，再手动生成摘要。',
  access_denied:
    '所选 Harness 报告当前身份无权调用，请在原环境检查模型和账户权限，再手动生成摘要。',
  billing_required:
    '所选 Harness 报告账户余额或付款条件不足，请在原环境处理账户或选择可用模型，再手动生成摘要。',
  quota_exhausted: '所选 Harness 报告额度不足，请等额度恢复或在原环境调整套餐，再手动生成摘要。',
  rate_limited: '所选 Harness 报告请求频率受限，请稍后手动生成摘要。应用未再次发起生成。',
  provider_unavailable: '所选 Harness 报告服务暂不可用，请稍后手动生成摘要。应用未再次发起生成。',
  invalid_request: '所选 Harness 拒绝了本次请求，请检查模型与 CLI 配置或更新版本，再手动生成摘要。',
  provider_error: '所选 Harness 已报告生成失败，摘要未保存；请在原环境检查原因后手动重试。',
} as const;

export type HarnessFailureCode = keyof typeof messages;
export class HarnessReportedError extends Error {
  constructor(readonly failureCode: HarnessFailureCode) {
    super(messages[failureCode]);
    this.name = 'HarnessReportedError';
  }
}

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
const json = (value: string): ObjectValue | null => {
  try {
    return object(JSON.parse(value));
  } catch {
    return null;
  }
};

function classify(value: ObjectValue | null): HarnessReportedError {
  const code = value?.code ?? value?.type;
  // Fixed provider codes only; never interpret prose, URLs, headers or model text.
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached')
    return new HarnessReportedError('quota_exhausted');
  if (code === 'invalid_api_key' || code === 'authentication_error')
    return new HarnessReportedError('authentication');
  if (code === 'rate_limit_exceeded' || code === 'rate_limit_error')
    return new HarnessReportedError('rate_limited');
  if (code === 'overloaded_error') return new HarnessReportedError('provider_unavailable');
  if (code === 'invalid_json_schema' || code === 'invalid_request_error')
    return new HarnessReportedError('invalid_request');
  const status = value?.statusCode ?? value?.status_code;
  if (status === 401) return new HarnessReportedError('authentication');
  if (status === 402) return new HarnessReportedError('billing_required');
  if (status === 403) return new HarnessReportedError('access_denied');
  if (status === 429) return new HarnessReportedError('rate_limited');
  if (status === 400 || status === 404 || status === 422)
    return new HarnessReportedError('invalid_request');
  if (typeof status === 'number' && Number.isInteger(status) && status >= 500 && status <= 599)
    return new HarnessReportedError('provider_unavailable');
  return new HarnessReportedError('provider_error');
}

function codexError(value: unknown): HarnessReportedError {
  const error = object(value);
  // Codex can encode the provider's JSON error object inside message. Parse one
  // bounded level; arbitrary text and nested model output are never diagnostics.
  const nested =
    typeof error?.message === 'string' && error.message.length <= 32768
      ? json(error.message)
      : null;
  return classify(object(nested?.error) ?? nested ?? error);
}

/** Only recognizes supported outer CLI error envelopes, not assistant text. */
export function reportedHarnessFailure(
  harness: HarnessDetection['id'],
  raw: string,
): HarnessReportedError | null {
  if (harness === 'claude') {
    const result = json(raw);
    return result?.type === 'result' && result.is_error === true
      ? classify(object(result.error))
      : null;
  }
  let failure: HarnessReportedError | null = null;
  for (const line of raw.split('\n')) {
    const event = json(line);
    if (!event) continue;
    if (harness === 'opencode' && event.type === 'error') {
      const error = object(event.error);
      failure = classify(object(error?.data));
    }
    if (harness === 'codex') {
      if (event.type === 'turn.started' || event.type === 'turn.completed') failure = null;
      else if (event.type === 'turn.failed') failure = codexError(event.error);
      else if (event.type === 'error') failure = codexError(event);
    }
  }
  return failure;
}
