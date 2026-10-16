import { z } from 'zod';
const metric = z
  .object({
    id: z.enum(['accepted', 'tokens', 'equivalent']),
    value: z.number().finite().nonnegative().nullable(),
    sources: z.number().int().min(5).max(100).nullable(),
    abovePercent: z.number().min(0).max(100).nullable(),
  })
  .strict();
export const FeedbackActivitySchema = z
  .object({
    version: z.literal('feedback-activity-1'),
    status: z.enum(['available', 'insufficient', 'ineligible', 'capacity', 'unavailable']),
    metrics: z.array(metric).length(3),
    window: z
      .object({ startAt: z.string().datetime(), endAt: z.string().datetime() })
      .strict()
      .nullable(),
  })
  .strict();
export type FeedbackActivity = z.infer<typeof FeedbackActivitySchema>;
export function activityPercentile(value: number | null, peers: (number | null)[]) {
  const known = peers.filter((p): p is number => p !== null && Number.isFinite(p) && p >= 0);
  return value === null || !Number.isFinite(value) || value < 0 || known.length < 5
    ? { sources: null, abovePercent: null }
    : {
        sources: known.length,
        abovePercent: (100 * known.filter((v) => v < value).length) / known.length,
      };
}
