import { z } from 'zod';
export const WorkspaceEntrySchema = z
  .object({
    kind: z.enum(['contribution', 'journal', 'subscription']),
    recordId: z.string().uuid(),
    receivedAt: z.string().datetime(),
    source: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
export const WorkspacePageSchema = z
  .object({
    entries: z.array(WorkspaceEntrySchema).max(25),
    nextCursor: z.string().max(1024).nullable(),
    visibility: z.literal('private'),
    linkedSources: z.number().int().min(0).max(20),
  })
  .strict();
export const feedbackKindLabels = {
  contribution: '工作与费用',
  journal: '每日工作摘要',
  subscription: '订阅与额度',
};
