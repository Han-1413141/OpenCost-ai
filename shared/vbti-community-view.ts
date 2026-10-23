import type { VbtiCommunity } from './vbti-community.js';

export const VBTI_REVEAL_USERS = 100;
export function communityUsers(data: VbtiCommunity | null, code: string): number | null {
  return data?.status === 'ready'
    ? (data.counts.find((c) => c.code === code)?.users ?? null)
    : null;
}
export const publiclyRevealed = (data: VbtiCommunity | null, code: string) =>
  (communityUsers(data, code) ?? 0) >= VBTI_REVEAL_USERS;
