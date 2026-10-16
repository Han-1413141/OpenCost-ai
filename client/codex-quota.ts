import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SubscriptionSnapshotSchema, type SubscriptionSnapshot } from '../shared/subscriptions.js';
import { subscriptionTemplate } from './subscriptions.js';

/** The random subscription reference namespaces every public identifier. */
export function quotaUuid(value: string) {
  const h = createHash('sha256').update(value).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const Window = z
  .object({
    used_percent: z.number().min(0).max(100),
    window_minutes: z.number().positive().max(5259600).nullish(),
    window_duration_mins: z.number().positive().max(5259600).nullish(),
    resets_at: z.number().int().min(0).max(253402300799).nullish(),
  })
  .superRefine((w, ctx) => {
    if (
      w.window_minutes != null &&
      w.window_duration_mins != null &&
      w.window_minutes !== w.window_duration_mins
    )
      ctx.addIssue({ code: 'custom', message: 'Ambiguous window duration' });
  });
const Limits = z.object({
  limit_id: z.string().min(1).max(200).nullish(),
  primary: Window.nullish(),
  secondary: Window.nullish(),
});

/** Reads only the structured quota event. Conversation text and credit balances are not projected. */
export function codexQuotaSnapshots(
  text: string,
  subscriptionRef: string,
  interval: { startAt: string; endAt: string },
): { snapshots: SubscriptionSnapshot[]; invalidEvents: number } {
  z.string().uuid().parse(subscriptionRef);
  const start = Date.parse(interval.startAt),
    end = Date.parse(interval.endAt);
  const snapshots: SubscriptionSnapshot[] = [];
  let invalidEvents = 0;
  let version = 'unknown';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      invalidEvents++;
      continue;
    }
    if (
      event?.type === 'session_meta' &&
      typeof event.payload?.cli_version === 'string' &&
      /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-(?:alpha|beta|rc)\.?\d{1,5})?$/.test(event.payload.cli_version)
    )
      version = event.payload.cli_version;
    if (
      event?.type !== 'event_msg' ||
      event.payload?.type !== 'token_count' ||
      event.payload.rate_limits == null
    )
      continue;
    const at = z.string().datetime().safeParse(event.timestamp);
    if (!at.success) {
      invalidEvents++;
      continue;
    }
    const ms = Date.parse(at.data);
    if (ms < start || ms >= end) continue;
    const limits = Limits.safeParse(event.payload.rate_limits);
    if (!limits.success || (!limits.data.primary && !limits.data.secondary)) {
      invalidEvents++;
      continue;
    }
    const base = subscriptionTemplate();
    const id = limits.data.limit_id ?? 'codex';
    const pools = (['primary', 'secondary'] as const).flatMap((slot) => {
      const w = limits.data[slot];
      if (!w) return [];
      const minutes = w.window_minutes ?? w.window_duration_mins ?? null;
      return [
        {
          ...base.pools[0],
          poolRef: quotaUuid(`${subscriptionRef}/${id}/${slot}`),
          // A provider's private routing label is never copied into the upload.
          name: null,
          scope: 'account' as const,
          capacity: { status: 'undisclosed' as const, total: null },
          percent: {
            direction: 'used' as const,
            value: w.used_percent,
            precision: 'unknown' as const,
          },
          window: {
            ...base.pools[0].window,
            durationSeconds: minutes === null ? null : minutes * 60,
            resetsAt: w.resets_at == null ? null : new Date(w.resets_at * 1000).toISOString(),
          },
        },
      ];
    });
    snapshots.push(
      SubscriptionSnapshotSchema.parse({
        ...base,
        subscriptionRef,
        observationId: quotaUuid(`${subscriptionRef}/${new Date(ms).toISOString()}/${id}`),
        observedAt: new Date(ms).toISOString(),
        provider: 'openai',
        source: 'harness_meter',
        harnesses: [{ id: 'codex', version, surface: 'unknown' }],
        pools,
      }),
    );
  }
  return { snapshots, invalidEvents };
}
