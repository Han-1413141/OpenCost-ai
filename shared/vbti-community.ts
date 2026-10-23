import { z } from 'zod';
import { personaCatalog, type PersonaCode } from './feedback-persona.js';
import { VBTI_REVEAL_USERS } from './vbti-community-view.js';
export { VBTI_REVEAL_USERS, communityUsers, publiclyRevealed } from './vbti-community-view.js';

export const VbtiCommunitySchema = z
  .object({
    version: z.literal('vbti-community-1'),
    status: z.enum(['ready', 'updating', 'unavailable']),
    threshold: z.literal(VBTI_REVEAL_USERS),
    basis: z.literal('consenting-linked-accounts'),
    updatedAt: z.string().datetime().nullable(),
    counts: z
      .array(
        z
          .object({
            code: z.enum(personaCatalog.map((p) => p[0]) as [PersonaCode, ...PersonaCode[]]),
            users: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
          })
          .strict(),
      )
      .length(personaCatalog.length),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.counts.map((c) => c.code)).size !== personaCatalog.length ||
      v.counts.some((c) => (v.status === 'ready' ? c.users === null : c.users !== null))
    )
      ctx.addIssue({ code: 'custom', message: '角色人数必须完整且与统计状态一致' });
  });
export type VbtiCommunity = z.infer<typeof VbtiCommunitySchema>;
export function emptyVbtiCommunity(status: VbtiCommunity['status'] = 'unavailable'): VbtiCommunity {
  return {
    version: 'vbti-community-1',
    status,
    threshold: 100,
    basis: 'consenting-linked-accounts',
    updatedAt: null,
    counts: personaCatalog.map(([code]) => ({ code, users: status === 'ready' ? 0 : null })),
  };
}
