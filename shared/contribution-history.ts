import { z } from 'zod';
import { EnvelopeSchema, type Envelope } from './schema.js';
import { netPayment } from './payment.js';

const count = z.number().int().nonnegative().safe();
export const ContributionListSummarySchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    currency: z.enum(['CNY', 'USD', 'EUR']),
    billing: z.enum(['api', 'subscription', 'mixed', 'unknown']),
    statistics: z.boolean(),
    taskCount: count,
    accepted: count,
    netMinor: count.nullable(),
    retries: count,
    humanMinutes: z.number().finite().nonnegative().nullable(),
    completeCycle: z.boolean(),
  })
  .strict()
  .refine((summary) => summary.accepted <= summary.taskCount);
export type ContributionListSummary = z.infer<typeof ContributionListSummarySchema>;

export function contributionListSummary(envelope: Envelope): ContributionListSummary {
  const { period, tasks } = envelope;
  return ContributionListSummarySchema.parse({
    month: period.month,
    currency: period.currency,
    billing: period.billing,
    statistics: envelope.consent.statistics,
    taskCount: tasks.length,
    accepted: tasks.filter((task) => task.status === 'accepted').length,
    netMinor: netPayment(period),
    retries: tasks.reduce((sum, task) => sum + task.attempts - 1, 0),
    humanMinutes: tasks.every((task) => task.humanMinutes !== null)
      ? tasks.reduce((sum, task) => sum + task.humanMinutes!, 0)
      : null,
    completeCycle: period.coverage === 'complete' && period.selection === 'continuous',
  });
}

const recordMetadata = {
  id: z.string().uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  status: z.enum(['stored', 'quarantined']),
  receivedSequence: z.number().int().positive().safe().optional(),
};
export const SettlementIndexSchema = z
  .object({
    version: z.literal('settlement-revision-1'),
    revision: z.number().int().nonnegative(),
    rootReceiptId: z.string().uuid(),
    currentReceiptId: z.string().uuid().nullable(),
    state: z.enum(['active', 'superseded', 'conflict', 'unknown']),
  })
  .strict();
export const ContributionIndexEntrySchema = z
  .object({
    ...recordMetadata,
    summary: ContributionListSummarySchema.nullable(),
    settlement: SettlementIndexSchema.optional(),
  })
  .strict();
export type ContributionIndexEntry = z.infer<typeof ContributionIndexEntrySchema>;
export const ContributionIndexPageSchema = z
  .object({
    records: z.array(ContributionIndexEntrySchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable(),
    truncated: z.boolean(),
    visibility: z.literal('private'),
    revision: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
  .refine((page) => page.truncated === (page.nextCursor !== null));
export type ContributionIndexPage = z.infer<typeof ContributionIndexPageSchema>;

export const ContributionDetailSchema = z
  .object({
    record: z
      .object({
        ...recordMetadata,
        evidence: z
          .object({
            cost: z.enum(['C0', 'C1', 'C2']),
            work: z.enum(['W0', 'W1', 'W2']),
            coverage: z.enum(['declared', 'verified']),
            issuer: z.string().max(200).nullable(),
            source: z.string().max(200).nullable(),
            quota: z.enum(['Q0', 'Q2']).optional(),
          })
          .strict(),
        envelope: EnvelopeSchema,
        settlement: SettlementIndexSchema.optional(),
      })
      .strict(),
    visibility: z.literal('private'),
  })
  .strict();
export type ContributionDetail = z.infer<typeof ContributionDetailSchema>;
