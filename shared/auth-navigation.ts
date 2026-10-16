const allowedPaths = new Set(['/vbti/', '/vbti/test/', '/vbti/result/']);
/** Only public in-app destinations; credentials, external URLs and arbitrary queries are rejected. */
export function authReturnTo(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 160 ||
    !value.startsWith('/') ||
    value.startsWith('//')
  )
    return null;
  const u = new URL(value, 'https://opencost.invalid');
  if (u.origin !== 'https://opencost.invalid') return null;
  if (
    !allowedPaths.has(u.pathname) &&
    !(u.pathname === '/' && ['#feedback', '#workspace'].includes(u.hash))
  )
    return null;
  if (allowedPaths.has(u.pathname) && u.hash) return null;
  if (
    [...u.searchParams.keys()].some((k) => k !== 'lang') ||
    u.searchParams.getAll('lang').length > 1
  )
    return null;
  const lang = u.searchParams.get('lang');
  if (lang && !['zh-CN', 'zh-TW', 'en', 'ja'].includes(lang)) return null;
  return u.pathname + u.search + u.hash;
}
export function authRedirect(destination: string, result: string, linked?: string) {
  const url = new URL(authReturnTo(destination) ?? '/#workspace', 'https://opencost.invalid');
  url.searchParams.set('login', result);
  if (linked) url.searchParams.set('link', linked);
  return url.pathname + url.search + url.hash;
}
