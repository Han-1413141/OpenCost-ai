import { parseFeedbackLink, parseAccountConnect, type FeedbackTarget } from '../shared/feedback-link';

/** Consume before React, locale requests or page navigation. No persistent browser storage. */
export function consumeFeedbackAccess(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState' | 'state'>,
): { accessKey: string; target: FeedbackTarget | null; connectToken?: string } | null {
  if (location.hash.startsWith('#connect?')) {
    const token = parseAccountConnect(location.hash);
    history.replaceState(history.state, '', `${location.pathname}${location.search}#feedback`);
    return token ? { accessKey: '', target: null, connectToken: token } : null;
  }
  if (!location.hash.startsWith('#feedback?')) return null;
  const access = parseFeedbackLink(location.hash);
  const resultPage = /^\/vbti\/result\/?$/.test(location.pathname);
  // Old general/work links now open the type result directly. Subscription-only
  // links retain their quota report; a balance cannot establish a work persona.
  const legacyWorkLink = location.pathname === '/' && access && access.view !== 'feedback' && access.target?.kind !== 'subscription';
  history.replaceState(
    history.state,
    '',
    resultPage || legacyWorkLink
      ? `/vbti/result/${location.search}`
      : `${location.pathname}${location.search}#feedback`,
  );
  return access;
}
