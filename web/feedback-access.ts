import { parseFeedbackLink } from '../shared/feedback-link';

/** Consume before React, locale requests or page navigation. No persistent browser storage. */
export function consumeFeedbackAccess(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState' | 'state'>) {
  if (!location.hash.startsWith('#feedback?')) return null;
  const access = parseFeedbackLink(location.hash);
  history.replaceState(history.state, '', `${location.pathname}${location.search}#feedback`);
  return access;
}
