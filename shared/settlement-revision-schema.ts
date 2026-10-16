import { z } from 'zod';

export const SettlementRevisionSchema = z
  .object({
    version: z.literal('settlement-revision-1'),
    scope: z.literal('whole_record_snapshot'),
    revision: z.number().int().nonnegative().max(100000),
    replaces: z
      .object({
        recordId: z.string().uuid(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        revision: z.number().int().nonnegative().max(99999),
      })
      .strict()
      .nullable(),
    requirements: z
      .array(
        z
          .object({
            taskId: z.string().uuid(),
            requirementRef: z.string().uuid(),
            revision: z.number().int().nonnegative().max(100000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.replaces ? s.revision !== s.replaces.revision + 1 : s.revision !== 0)
      ctx.addIssue({ code: 'custom', message: '首次完整快照为修订0；替代必须是父修订加1' });
    if (
      new Set(s.requirements.map((r) => r.taskId)).size !== s.requirements.length ||
      new Set(s.requirements.map((r) => r.requirementRef)).size !== s.requirements.length
    )
      ctx.addIssue({ code: 'custom', message: '每项根目标的要求引用必须唯一' });
  });
export type SettlementRevision = z.infer<typeof SettlementRevisionSchema>;
