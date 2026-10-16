import { z } from 'zod';

const amount = z.number().finite().nonnegative();
export const QuotaPeerFeedbackSchema = z
  .object({
    version: z.literal('quota-peers-1'),
    status: z.enum(['available', 'insufficient', 'ineligible', 'capacity']),
    basis: z.literal('opt_in_reported_capacity'),
    observedThrough: z.string().datetime(),
    lookbackDays: z.literal(30),
    minimumSources: z.literal(5),
    statistics: z
      .object({
        sources: z.number().int().min(5).max(1000),
        mean: amount,
        median: amount,
        p25: amount,
        p75: amount,
        difference: z.number().finite(),
        differencePercent: z.number().finite().nullable(),
        percentile: z.number().min(0).max(100),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine(
    (v) => (v.status === 'available') === (v.statistics !== null),
    '比较状态与统计结果须一致',
  );
export type QuotaPeerFeedback = z.infer<typeof QuotaPeerFeedbackSchema>;

/** One latest observation per distinct source must be selected before this function. */
export function quotaPeerStatistics(own: number, values: number[]) {
  if (
    values.length < 5 ||
    values.length > 1000 ||
    ![own, ...values].every((v) => Number.isFinite(v) && v >= 0)
  )
    return null;
  const ordered = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => {
    const i = (ordered.length - 1) * p,
      low = Math.floor(i);
    return ordered[low] + (ordered[Math.ceil(i)] - ordered[low]) * (i - low);
  };
  // Dividing first avoids overflow when many large finite source values are summed.
  const mean = values.reduce((sum, n) => sum + n / values.length, 0);
  const difference = own - mean;
  return {
    sources: values.length,
    mean,
    median: quantile(0.5),
    p25: quantile(0.25),
    p75: quantile(0.75),
    difference,
    differencePercent: mean > 0 ? (difference / mean) * 100 : null,
    percentile:
      ((values.filter((v) => v < own).length + values.filter((v) => v === own).length / 2) /
        values.length) *
      100,
  };
}
