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
  history.replaceState(history.state, '', `${location.pathname}${location.search}#feedback`);
  return access;
}
