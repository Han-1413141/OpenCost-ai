import { z } from 'zod';
import { publicId, type Envelope } from './schema.js';
import type { DailySummary } from './desktop-summary.js';
import { personaDays } from './feedback-persona-history.js';
export const FeedbackToolboxSchema = z
  .object({
    version: z.literal('feedback-toolbox-1'),
    unit: z.enum(['task', 'day']),
    complete: z.boolean(),
    total: z.number().int().nonnegative(),
    items: z
      .array(
        z
          .object({
            kind: z.enum(['harness', 'model']),
            id: publicId,
            version: publicId,
            provider: publicId.nullable(),
            count: z.number().int().positive(),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.items.some((i) => i.count > v.total))
      ctx.addIssue({ code: 'custom', message: '产品使用计数超过记录范围' });
  });
export type FeedbackToolbox = z.infer<typeof FeedbackToolboxSchema>;
type Identity = Omit<FeedbackToolbox['items'][number], 'count'>;
function summarize(
  groups: Identity[][],
  unit: FeedbackToolbox['unit'],
  complete: boolean,
): FeedbackToolbox {
  const items = new Map<string, Identity & { count: number }>();
  for (const group of groups) {
    const seen = new Set<string>();
    for (const item of group) {
      const key = JSON.stringify([item.kind, item.provider, item.id, item.version]);
      if (seen.has(key) || item.id === 'unknown' || item.id === 'custom-harness') continue;
      seen.add(key);
      const current = items.get(key) ?? { ...item, count: 0 };
      current.count++;
      items.set(key, current);
    }
  }
  return FeedbackToolboxSchema.parse({
    version: 'feedback-toolbox-1',
    unit,
    complete,
    total: groups.length,
    items: [...items.values()]
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
      .slice(0, 128),
  });
}
export function contributionToolbox(envelope: Envelope): FeedbackToolbox {
  return summarize(
    envelope.tasks.map((t) => [
      ...(t.evaluation?.version === 'work-summary-1'
        ? (t.evaluation.execution.harnesses ?? [t.harness])
        : [t.harness]
      ).map((h) => ({ kind: 'harness' as const, id: h.id, version: h.version, provider: null })),
      ...t.models.map((m) => ({
        kind: 'model' as const,
        id: m.model,
        version: m.version,
        provider: m.provider,
      })),
    ]),
    'task',
    true,
  );
}
export function journalToolbox(
  summary: DailySummary,
  history: DailySummary[],
  complete: boolean,
): FeedbackToolbox {
  return summarize(
    personaDays(summary, history).map((s) => [
      ...s.harnesses.map((h) => ({
        kind: 'harness' as const,
        id: h.id,
        version: h.version,
        provider: null,
      })),
      ...(s.models ?? []).map((id) => ({
        kind: 'model' as const,
        id,
        version: 'unknown',
        provider: null,
      })),
    ]),
    'day',
    complete,
  );
}
export const frequentTool = (toolbox: FeedbackToolbox, item: FeedbackToolbox['items'][number]) =>
  toolbox.complete &&
  toolbox.unit === 'day' &&
  item.count >= 7 &&
  item.count / toolbox.total >= 0.5;
