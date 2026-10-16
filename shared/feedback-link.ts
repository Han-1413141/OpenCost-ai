export type FeedbackTarget = {
  kind: 'contribution' | 'journal' | 'subscription';
  recordId: string;
};
const keyPattern = /^[A-Za-z0-9_-]{43,128}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** A ten-minute, one-use pairing token, never a permanent access key. */
export function accountConnectLink(origin: string, token: string) {
  const validated = new URL(feedbackLink(origin, token));
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('账号关联令牌无效');
  return `${validated.origin}/#connect?token=${token}`;
}
export function parseAccountConnect(hash: string): string | null {
  if (!hash.startsWith('#connect?') || hash.length > 128) return null;
  const params = new URLSearchParams(hash.slice('#connect?'.length));
  const token = params.get('token');
  return [...params.keys()].length === 1 && token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function validFeedbackTarget(
  kind: unknown,
  recordId: unknown,
): kind is FeedbackTarget['kind'] {
  return (
    ['contribution', 'journal', 'subscription'].includes(String(kind)) &&
    typeof recordId === 'string' &&
    uuidPattern.test(recordId)
  );
}
/** Fragments are not part of HTTP requests. Never put credentials in query parameters. */
export function feedbackLink(origin: string, accessKey: string, target?: FeedbackTarget) {
  const url = new URL(origin);
  if (
    !keyPattern.test(accessKey) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
    (target && !validFeedbackTarget(target.kind, target.recordId))
  )
    throw new Error('无法生成私人反馈链接');
  const params = new URLSearchParams({ key: accessKey });
  if (target) {
    params.set('kind', target.kind);
    params.set('recordId', target.recordId);
  }
  return `${url.origin}/#feedback?${params}`;
}
export function parseFeedbackLink(
  hash: string,
): { accessKey: string; target: FeedbackTarget | null } | null {
  if (!hash.startsWith('#feedback?') || hash.length > 1024) return null;
  const params = new URLSearchParams(hash.slice('#feedback?'.length));
  if (
    [...params.keys()].some((k) => !['key', 'kind', 'recordId'].includes(k)) ||
    [...params.keys()].some((k) => params.getAll(k).length !== 1)
  )
    return null;
  const accessKey = params.get('key') ?? '';
  if (!keyPattern.test(accessKey)) return null;
  const kind = params.get('kind'),
    recordId = params.get('recordId');
  if ((kind !== null || recordId !== null) && !validFeedbackTarget(kind, recordId)) return null;
  return {
    accessKey,
    target: kind && recordId ? { kind: kind as FeedbackTarget['kind'], recordId } : null,
  };
}
