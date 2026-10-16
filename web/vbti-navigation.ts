export const vbtiRoutes = {
  vbti: '/vbti/',
  'vbti-test': '/vbti/test/',
  'vbti-result': '/vbti/result/',
} as const;
export type VbtiPage = keyof typeof vbtiRoutes;

export function readVbtiPage(pathname: string): VbtiPage | null {
  const normalized = pathname.replace(/\/+$/, '') + '/';
  return (
    (Object.entries(vbtiRoutes).find(([, path]) => path === normalized)?.[0] as VbtiPage) ?? null
  );
}

/** Only route this site's pages. Access credentials stay in React memory, never in history state. */
export function internalPageHref(href: string, current: string): string | null {
  const url = new URL(href, current);
  if (url.origin !== new URL(current).origin || url.search) return null;
  const legacy = url.hash.slice(1);
  if (Object.hasOwn(vbtiRoutes, legacy)) return vbtiRoutes[legacy as VbtiPage];
  if (readVbtiPage(url.pathname) && !url.hash) return url.pathname;
  if (url.pathname === '/' && /^#[a-z-]+$/.test(url.hash)) return '/' + url.hash;
  return null;
}

export function navigateInApp(href: string, replace = false) {
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
