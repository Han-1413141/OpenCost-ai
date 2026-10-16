import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { canonical } from '../shared/schema.js';
import {
  SubscriptionEnvelopeSchema,
  SubscriptionSnapshotSchema,
  type SubscriptionEnvelope,
  type SubscriptionSnapshot,
} from '../shared/subscriptions.js';
import { endpointOrigin, request, receiptFeedback } from './sdk.js';
import { z } from 'zod';
import { feedbackLink } from '../shared/feedback-link.js';

export async function listSubscriptions(
  endpoint: string,
  accessKey: string,
  options: { limit?: number; beforeSequence?: number; subscriptionRef?: string } = {},
) {
  const query = z
    .object({
      limit: z.number().int().min(1).max(500).default(100),
      beforeSequence: z.number().int().positive().safe().optional(),
      subscriptionRef: z.string().uuid().optional(),
    })
    .strict()
    .parse(options);
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.beforeSequence !== undefined)
    params.set('beforeSequence', String(query.beforeSequence));
  if (query.subscriptionRef !== undefined) params.set('subscriptionRef', query.subscriptionRef);
  const data = await request(
    endpointOrigin(endpoint),
    `/api/subscriptions/mine?${params}`,
    accessKey,
  );
  const page = z
    .object({
      entries: z
        .array(
          z.object({
            sequence: z.number().int().positive().safe(),
            snapshot: SubscriptionSnapshotSchema,
          }),
        )
        .max(query.limit),
      nextBeforeSequence: z.number().int().positive().safe().nullable(),
      truncated: z.boolean(),
      visibility: z.literal('private'),
      evidence: z.literal('Q0'),
      changes: z.array(z.record(z.string(), z.unknown())).max(query.limit * 100),
    })
    .parse(data);
  if (
    page.truncated !== (page.nextBeforeSequence !== null) ||
    (page.truncated && page.nextBeforeSequence !== page.entries.at(-1)?.sequence) ||
    page.entries.some(
      (entry, index) =>
        (query.beforeSequence !== undefined && entry.sequence >= query.beforeSequence) ||
        (index > 0 && entry.sequence >= page.entries[index - 1].sequence) ||
        (query.subscriptionRef !== undefined &&
          entry.snapshot.subscriptionRef !== query.subscriptionRef),
    )
  )
    throw new Error('订阅历史分页回执无效，不能跳过未读取的记录');
  return page;
}

export const hash = (input: unknown) => createHash('sha256').update(canonical(input)).digest('hex');
export type SubscriptionDraft = {
  format: 'opencost-subscription-preview-1';
  envelope: SubscriptionEnvelope;
  digest: string;
  idempotencyKey: string;
};
export function subscriptionEnvelope(snapshots: SubscriptionSnapshot[], statistics = false): SubscriptionEnvelope {
  return SubscriptionEnvelopeSchema.parse({
    format: 'opencost-subscriptions-1',
    origin: 'real',
    collector: {
      id: 'opencost-monitor',
      version: '1.0',
      digest: hash({ salt: randomBytes(32).toString('hex'), snapshots }),
    },
    snapshots,
    consent: { version: 'opencost-1.0', store: true, ...(statistics ? { statistics: true } : {}) },
  });
}
export function prepareSubscriptions(input: unknown): SubscriptionDraft {
  const envelope = SubscriptionEnvelopeSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify({ envelope, reviewToken: 'x'.repeat(2000) })) > 512 * 1024)
    throw new Error('订阅批次超过 512 KiB，请分批，不能删除事件或截断历史');
  return {
    format: 'opencost-subscription-preview-1',
    envelope,
    digest: hash(envelope),
    idempotencyKey: randomUUID(),
  };
}
export async function submitSubscriptions(
  endpoint: string,
  accessKey: string,
  draft: SubscriptionDraft,
  confirmedDigest: string,
  options: { signal?: AbortSignal; beforeRequest?: () => void } = {},
) {
  endpoint = endpointOrigin(endpoint);
  if (
    !draft.envelope.consent.store ||
    prepareSubscriptions(draft.envelope).digest !== draft.digest ||
    draft.digest !== confirmedDigest
  )
    throw new Error('订阅数据已变化或尚未确认当前预览');
  const body = { envelope: draft.envelope };
  const beforeRequest = () => {
    options.signal?.throwIfAborted();
    options.beforeRequest?.();
    options.signal?.throwIfAborted();
  };
  beforeRequest();
  const preview = await request(
    endpoint,
    '/api/subscriptions/preview',
    accessKey,
    body,
    undefined,
    options.signal,
  );
  beforeRequest();
  const receipt = await request(
    endpoint,
    '/api/subscriptions',
    accessKey,
    { ...body, reviewToken: preview.reviewToken },
    draft.idempotencyKey,
    options.signal,
  );
  if (
    receipt.digest !== draft.digest ||
    receipt.status !== 'stored' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      String(receipt.id),
    )
  )
    throw new Error('订阅回执无效，保留原批次重试，不推进成功位置');
  return Object.assign(receipt, {
    feedback: receiptFeedback(receipt, 'subscription'),
    feedbackUrl: feedbackLink(endpoint, accessKey, {
      kind: 'subscription',
      recordId: receipt.id as string,
    }),
    vbtiUrl: feedbackLink(endpoint, accessKey, undefined, 'vbti'),
  });
}
// All unknown quantities stay null; this template is not a measurement.
export function subscriptionTemplate(): SubscriptionSnapshot {
  return SubscriptionSnapshotSchema.parse({
    observationId: randomUUID(),
    subscriptionRef: randomUUID(),
    observedAt: new Date().toISOString(),
    provider: 'unknown',
    plan: 'unknown',
    planVersion: 'unknown',
    tier: null,
    harnesses: null,
    billingCycle: 'unknown',
    seats: null,
    status: 'unknown',
    autoRenew: null,
    cycleStartsAt: null,
    cycleEndsAt: null,
    priceMinor: null,
    currency: null,
    priceBasis: 'unknown',
    offerSnapshotId: null,
    source: 'unknown',
    freshness: 'unknown',
    pools: [
      {
        poolRef: randomUUID(),
        name: null,
        resource: 'other',
        unit: 'unknown',
        currency: null,
        semantics: 'unknown',
        category: 'unknown',
        sharing: 'unknown',
        scope: 'unknown',
        models: null,
        harnesses: null,
        window: {
          kind: 'unknown',
          durationSeconds: null,
          calendarUnit: null,
          timeZone: null,
          startsAt: null,
          endsAt: null,
          resetsAt: null,
        },
        capacity: { status: 'unknown', total: null },
        used: null,
        remaining: null,
        percent: null,
        precision: 'unknown',
        resetObserved: null,
        ledger: null,
        expiresAt: null,
        policyVersion: null,
      },
    ],
  });
}
