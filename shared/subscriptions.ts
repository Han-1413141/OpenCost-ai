import { z } from 'zod';
import { canonical, HarnessIdentitySchema, publicId } from './schema.js';
import { assessQuotaConsistency } from './quota-consistency.js';

const amount = z.number().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const time = z.string().datetime().nullable();
export const QuotaPoolSchema = z
  .object({
    poolRef: z.string().uuid(),
    name: publicId.nullable(),
    resource: z.enum([
      'tokens',
      'messages',
      'requests',
      'images',
      'media',
      'storage',
      'network',
      'compute',
      'credits',
      'other',
    ]),
    unit: z.enum([
      'token',
      'message',
      'request',
      'image',
      'second',
      'byte',
      'gib_hour',
      'credit',
      'currency_minor',
      'count',
      'unknown',
    ]),
    currency: z.enum(['CNY', 'USD', 'EUR']).nullable(),
    semantics: z.enum([
      'period_allowance',
      'balance',
      'rate',
      'concurrency',
      'storage_limit',
      'unknown',
    ]),
    category: z.enum(['base', 'promotion', 'trial', 'purchased_addon', 'unknown']),
    sharing: z.enum(['exclusive', 'shared', 'unknown']),
    scope: z.enum(['account', 'seat', 'organization', 'device', 'unknown']),
    models: z.array(publicId).max(100).nullable(),
    harnesses: z.array(HarnessIdentitySchema).max(64).nullable(),
    window: z
      .object({
        kind: z.enum(['fixed', 'rolling', 'calendar', 'lifetime', 'unknown']),
        durationSeconds: z.number().positive().max(315576000).nullable(),
        calendarUnit: z.enum(['day', 'week', 'month', 'quarter', 'year']).nullable(),
        timeZone: z
          .string()
          .max(80)
          .nullable()
          .refine((value) => {
            if (value === null) return true;
            try {
              new Intl.DateTimeFormat('en', { timeZone: value });
              return true;
            } catch {
              return false;
            }
          }),
        startsAt: time,
        endsAt: time,
        resetsAt: time,
      })
      .strict(),
    capacity: z
      .object({
        status: z.enum(['finite', 'unlimited', 'dynamic', 'undisclosed', 'unknown']),
        total: amount,
      })
      .strict(),
    used: amount,
    remaining: amount,
    percent: z
      .object({
        direction: z.enum(['used', 'remaining']),
        value: z.number().min(0).max(100),
        precision: z.enum(['exact', 'rounded', 'estimated', 'unknown']),
      })
      .strict()
      .nullable(),
    precision: z.enum(['exact', 'rounded', 'estimated', 'unknown']),
    resetObserved: z.boolean().nullable(),
    ledger: z
      .object({
        from: z.string().datetime(),
        through: z.string().datetime(),
        coverage: z.enum(['complete', 'partial', 'unknown']),
        precision: z.enum(['exact', 'rounded', 'estimated', 'unknown']),
        events: z
          .array(
            z
              .object({
                eventRef: z.string().uuid(),
                at: z.string().datetime(),
                kind: z.enum(['usage', 'reset', 'grant', 'refund', 'expiration', 'correction']),
                amount,
                beforeUsed: amount,
                afterUsed: amount,
              })
              .strict(),
          )
          .max(2000),
      })
      .strict()
      .nullable()
      .optional(),
    expiresAt: time,
    policyVersion: publicId.nullable(),
  })
  .strict()
  .superRefine((pool, ctx) => {
    if ((pool.capacity.status === 'finite') !== (pool.capacity.total !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: '有限容量必须有明确总额度；无限、动态、未披露及未知不能伪造数值',
      });
    if (pool.unit === 'currency_minor' && pool.currency === null)
      ctx.addIssue({ code: 'custom', path: ['currency'], message: '货币额度需要币种' });
    if (pool.unit !== 'currency_minor' && pool.currency !== null)
      ctx.addIssue({ code: 'custom', path: ['currency'], message: '非货币额度不填写币种' });
    if (
      pool.window.startsAt &&
      pool.window.endsAt &&
      Date.parse(pool.window.startsAt) >= Date.parse(pool.window.endsAt)
    )
      ctx.addIssue({ code: 'custom', path: ['window'], message: '额度周期结束必须晚于开始' });
    if (pool.window.kind === 'calendar' && (!pool.window.calendarUnit || !pool.window.timeZone))
      ctx.addIssue({
        code: 'custom',
        path: ['window'],
        message: '自然周期需要周期单位和时区，不能按固定秒数替代',
      });
    if (pool.ledger) {
      const ledger = pool.ledger;
      if (
        Date.parse(ledger.from) >= Date.parse(ledger.through) ||
        new Set(ledger.events.map((e) => e.eventRef)).size !== ledger.events.length ||
        ledger.events.some(
          (e) =>
            Date.parse(e.at) <= Date.parse(ledger.from) ||
            Date.parse(e.at) > Date.parse(ledger.through),
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['ledger'],
          message: '事件流水须有有效区间、唯一事件和区间内时间；缺失不能补成零',
        });
    }
  });

export const SubscriptionSnapshotSchema = z
  .object({
    observationId: z.string().uuid(),
    subscriptionRef: z.string().uuid(),
    observedAt: z.string().datetime(),
    provider: publicId,
    plan: publicId,
    planVersion: publicId,
    tier: publicId.nullable(),
    harnesses: z.array(HarnessIdentitySchema).max(64).nullable(),
    billingCycle: z.enum([
      'weekly',
      'monthly',
      'quarterly',
      'yearly',
      'one_time',
      'usage',
      'custom',
      'unknown',
    ]),
    seats: z.number().int().min(1).max(1000000).nullable(),
    status: z.enum(['active', 'trial', 'paused', 'cancelled', 'expired', 'unknown']),
    autoRenew: z.boolean().nullable(),
    cycleStartsAt: time,
    cycleEndsAt: time,
    priceMinor: amount,
    currency: z.enum(['CNY', 'USD', 'EUR']).nullable(),
    priceBasis: z.enum(['billed', 'advertised', 'unknown']),
    offerSnapshotId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    source: z.enum([
      'provider_api',
      'provider_page',
      'provider_export',
      'harness_meter',
      'unknown',
    ]),
    freshness: z.enum(['current', 'stale', 'unknown']),
    pools: z.array(QuotaPoolSchema).min(1).max(100),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.priceMinor !== null && snapshot.currency === null)
      ctx.addIssue({ code: 'custom', path: ['currency'], message: '套餐价格需要币种' });
    if (new Set(snapshot.pools.map((pool) => pool.poolRef)).size !== snapshot.pools.length)
      ctx.addIssue({
        code: 'custom',
        path: ['pools'],
        message: '同一个共享额度池只能记录一次，适用模型和 Harness 写入同一池',
      });
    if (
      snapshot.pools.some(
        (pool) => pool.ledger && Date.parse(pool.ledger.through) > Date.parse(snapshot.observedAt),
      )
    )
      ctx.addIssue({ code: 'custom', path: ['pools'], message: '事件流水不能晚于本次观察时间' });
    if (
      snapshot.cycleStartsAt &&
      snapshot.cycleEndsAt &&
      Date.parse(snapshot.cycleStartsAt) >= Date.parse(snapshot.cycleEndsAt)
    )
      ctx.addIssue({ code: 'custom', path: ['cycleEndsAt'], message: '订阅周期结束必须晚于开始' });
  });
export type SubscriptionSnapshot = z.infer<typeof SubscriptionSnapshotSchema>;
export type QuotaPool = z.infer<typeof QuotaPoolSchema>;
export const SubscriptionEnvelopeSchema = z
  .object({
    format: z.literal('opencost-subscriptions-1'),
    origin: z.literal('real'),
    collector: z
      .object({ id: publicId, version: publicId, digest: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
    historyAnchor: z
      .object({
        installationRef: z.string().uuid(),
        sequence: z.number().int().positive(),
        head: z.string().regex(/^[a-f0-9]{64}$/),
        previous: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    snapshots: z.array(SubscriptionSnapshotSchema).min(1).max(500),
    consent: z.object({ version: z.literal('opencost-1.0'), store: z.boolean(), statistics: z.boolean().optional() }).strict(),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    if (
      new Set(envelope.snapshots.map((snapshot) => snapshot.observationId)).size !==
      envelope.snapshots.length
    )
      ctx.addIssue({ code: 'custom', path: ['snapshots'], message: '同一次观察不能重复上传' });
    if (
      new Set(envelope.snapshots.map((s) => `${s.subscriptionRef}/${Date.parse(s.observedAt)}`))
        .size !== envelope.snapshots.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['snapshots'],
        message: '同一订阅同一时刻只能有一次观察',
      });
  });
export type SubscriptionEnvelope = z.infer<typeof SubscriptionEnvelopeSchema>;

export function subscriptionConditions(snapshot: SubscriptionSnapshot, pool: QuotaPool) {
  return canonical({
    provider: snapshot.provider,
    plan: snapshot.plan,
    planVersion: snapshot.planVersion,
    tier: snapshot.tier,
    billingCycle: snapshot.billingCycle,
    seats: snapshot.seats,
    status: snapshot.status,
    resource: pool.resource,
    unit: pool.unit,
    currency: pool.currency,
    semantics: pool.semantics,
    category: pool.category,
    sharing: pool.sharing,
    scope: pool.scope,
    policyVersion: pool.policyVersion,
    models: pool.models?.slice().sort() ?? null,
    harnesses: pool.harnesses?.map(canonical).sort() ?? null,
    window: {
      kind: pool.window.kind,
      durationSeconds: pool.window.durationSeconds,
      calendarUnit: pool.window.calendarUnit,
      timeZone: pool.window.timeZone,
    },
  });
}
export const knownSubscriptionCapacity = (snapshot: SubscriptionSnapshot, pool: QuotaPool) =>
  snapshot.freshness === 'current' &&
  snapshot.source !== 'unknown' &&
  pool.precision === 'exact' &&
  ['finite', 'unlimited'].includes(pool.capacity.status);

// This is arithmetic on reported counters, never independent proof of their truth.
export function intervalConsumption(
  previous: SubscriptionSnapshot | null,
  before: QuotaPool | null,
  current: SubscriptionSnapshot,
  after: QuotaPool,
  reset: boolean,
) {
  const unknown = (reason: string) => ({
    amount: null as number | null,
    method: 'unknown',
    reason,
  });
  if (!previous || !before) return unknown('no_previous_observation');
  if (subscriptionConditions(previous, before) !== subscriptionConditions(current, after))
    return unknown('conditions_changed');
  if (
    previous.freshness !== 'current' ||
    current.freshness !== 'current' ||
    before.precision !== 'exact' ||
    after.precision !== 'exact'
  )
    return unknown('stale_or_inexact');
  const start = Date.parse(previous.observedAt),
    end = Date.parse(current.observedAt),
    ledger = after.ledger;
  const inconsistent =
    assessQuotaConsistency(before).status === 'conflict' ||
    assessQuotaConsistency(after).status === 'conflict';
  const reportedEvents =
    ledger?.events.filter((e) => Date.parse(e.at) > start && Date.parse(e.at) <= end) ?? [];
  if (
    ledger?.coverage === 'complete' &&
    ledger.precision === 'exact' &&
    Date.parse(ledger.from) <= start &&
    Date.parse(ledger.through) >= end
  ) {
    const events = ledger.events
      .filter((e) => Date.parse(e.at) > start && Date.parse(e.at) <= end)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (events.some((e) => e.kind === 'correction')) return unknown('counter_correction');
    const usage = events.filter((e) => e.kind === 'usage');
    if (usage.length && usage.every((e) => e.amount !== null)) {
      const total = usage.reduce((sum, e) => sum + e.amount!, 0);
      return Number.isFinite(total) && total <= Number.MAX_SAFE_INTEGER
        ? { amount: total, method: 'reported_usage_ledger', reason: 'complete_usage_events' }
        : unknown('overflow');
    }
    if (inconsistent) return unknown('conflicting_pool_counters');
    const boundaries = events.filter((e) => e.kind !== 'usage');
    if (
      boundaries.length &&
      !usage.length &&
      before.used !== null &&
      after.used !== null &&
      after.semantics === 'period_allowance' &&
      ['fixed', 'calendar', 'lifetime'].includes(after.window.kind)
    ) {
      if ((reset || after.resetObserved === true) && !boundaries.some((e) => e.kind === 'reset'))
        return unknown('missing_reset_boundary');
      let counter = before.used,
        total = 0;
      for (let index = 0; index < boundaries.length; index++) {
        const event = boundaries[index];
        if (event.beforeUsed === null || event.afterUsed === null)
          return unknown(
            event.kind === 'reset' ? 'missing_reset_boundary' : 'incomplete_counter_event_history',
          );
        // Equal timestamps do not establish the order of separate counter adjustments.
        if (index > 0 && Date.parse(event.at) === Date.parse(boundaries[index - 1].at))
          return unknown('incomplete_counter_event_history');
        if (event.beforeUsed < counter) return unknown('counter_decreased');
        total += event.beforeUsed - counter;
        counter = event.afterUsed;
      }
      if (after.used < counter) return unknown('counter_decreased');
      total += after.used - counter;
      const onlyResets = boundaries.every((e) => e.kind === 'reset');
      return total <= Number.MAX_SAFE_INTEGER
        ? {
            amount: total,
            method: onlyResets ? 'reported_reset_segments' : 'reported_counter_segments',
            reason: onlyResets ? 'all_reset_boundaries_present' : 'all_counter_boundaries_present',
          }
        : unknown('overflow');
    }
  }
  if (inconsistent) return unknown('conflicting_pool_counters');
  if (reportedEvents.some((e) => e.kind !== 'usage'))
    return unknown('incomplete_counter_event_history');
  if (reset || after.resetObserved === true) return unknown('missing_reset_boundary');
  if (after.window.kind === 'rolling') return unknown('rolling_release_is_not_consumption');
  if (end - start > 3 * 86400000) return unknown('observation_gap_over_three_days');
  if (
    !['fixed', 'calendar', 'lifetime'].includes(after.window.kind) ||
    after.semantics !== 'period_allowance'
  )
    return unknown('not_a_cumulative_usage_counter');
  if (
    after.window.kind !== 'lifetime' &&
    (!before.window.startsAt ||
      !after.window.startsAt ||
      !before.window.endsAt ||
      !after.window.endsAt ||
      Date.parse(before.window.startsAt) !== Date.parse(after.window.startsAt) ||
      Date.parse(before.window.endsAt) !== Date.parse(after.window.endsAt) ||
      Date.parse(before.window.startsAt) > start ||
      Date.parse(before.window.endsAt) <= start ||
      Date.parse(after.window.startsAt) > end ||
      Date.parse(after.window.endsAt) <= end)
  )
    return unknown('window_not_established');
  if (before.used === null || after.used === null) return unknown('missing_counter');
  if (after.used < before.used) return unknown('counter_decreased');
  return {
    amount: after.used - before.used,
    method: 'reported_same_window_counter',
    reason: 'nonnegative_cumulative_delta',
  };
}

export type SubscriptionHistoryReason =
  | 'resolved'
  | 'history_exhausted'
  | 'conditions_changed'
  | 'row_budget'
  | 'byte_budget'
  | 'ambiguous_time'
  | 'invalid_history';
export type SubscriptionHistoryCoverage = Record<
  'previous' | 'capacity' | 'latest',
  { status: 'complete' | 'partial'; reason: SubscriptionHistoryReason }
>;
export type SubscriptionPoolContext = {
  previous: SubscriptionSnapshot | null;
  priorPool: QuotaPool | null;
  baseline: SubscriptionSnapshot | null;
  baselinePool: QuotaPool | null;
  isLatest: boolean | null;
  historyCoverage: SubscriptionHistoryCoverage;
};

// History selection is separate from arithmetic: a bounded reader must explicitly distinguish
// proven absence from a search it could not finish. Historical ledgers are not used here.
export function compareSubscriptionPool(
  snapshot: SubscriptionSnapshot,
  pool: QuotaPool,
  context: SubscriptionPoolContext,
) {
  const coverage = context.historyCoverage;
  const previous = coverage.previous.status === 'complete' ? context.previous : null;
  const priorPool = previous ? context.priorPool : null;
  const consistency = {
    current: assessQuotaConsistency(pool),
    previous: priorPool ? assessQuotaConsistency(priorPool) : null,
  };
  const countersConsistent =
    consistency.current.status !== 'conflict' && consistency.previous?.status !== 'conflict';
  const baseline = coverage.capacity.status === 'complete' ? context.baseline : null;
  const baselinePool = baseline ? context.baselinePool : null;
  let status:
    | 'baseline'
    | 'unknown'
    | 'not_comparable'
    | 'unchanged'
    | 'increased'
    | 'decreased'
    | 'became_unlimited'
    | 'became_finite' = 'baseline';
  let reason = 'first_observation',
    delta: number | null = null,
    relative: number | null = null;
  const conditionsChanged =
    previous &&
    priorPool &&
    subscriptionConditions(previous, priorPool) !== subscriptionConditions(snapshot, pool);
  const expired =
    pool.expiresAt !== null && Date.parse(pool.expiresAt) <= Date.parse(snapshot.observedAt);
  if (conditionsChanged) {
    status = 'not_comparable';
    reason = 'plan_or_pool_conditions_changed';
  } else if (expired || ['expired', 'cancelled', 'paused'].includes(snapshot.status)) {
    status = 'not_comparable';
    reason = 'expired_or_inactive';
  } else if (!knownSubscriptionCapacity(snapshot, pool)) {
    status = 'unknown';
    reason =
      pool.capacity.status === 'dynamic'
        ? 'dynamic_capacity'
        : 'absolute_capacity_unavailable_or_stale';
  } else if (coverage.previous.status === 'partial') {
    status = 'unknown';
    reason = 'history_previous_incomplete';
  } else if (coverage.capacity.status === 'partial') {
    status = 'unknown';
    reason = 'history_capacity_incomplete';
  } else if (previous && !baselinePool) {
    status = 'unknown';
    reason = 'no_valid_capacity_baseline';
  } else if (baselinePool) {
    if (baselinePool.capacity.status !== pool.capacity.status) {
      status = pool.capacity.status === 'unlimited' ? 'became_unlimited' : 'became_finite';
      reason = 'declared_capacity_state_changed';
    } else if (pool.capacity.status === 'unlimited') {
      status = 'unchanged';
      reason = 'both_declared_unlimited';
    } else {
      delta = pool.capacity.total! - baselinePool.capacity.total!;
      relative = baselinePool.capacity.total! > 0 ? delta / baselinePool.capacity.total! : null;
      status = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged';
      reason = 'reported_absolute_limit';
    }
  }
  const sameMeaning = !!previous && !!priorPool && !conditionsChanged;
  const fixedWindowChanged =
    sameMeaning &&
    ['fixed', 'calendar'].includes(pool.window.kind) &&
    ((pool.window.startsAt !== null &&
      priorPool!.window.startsAt !== null &&
      Date.parse(pool.window.startsAt) !== Date.parse(priorPool!.window.startsAt)) ||
      (pool.window.resetsAt !== null &&
        priorPool!.window.resetsAt !== null &&
        Date.parse(pool.window.resetsAt) !== Date.parse(priorPool!.window.resetsAt)) ||
      (priorPool!.window.resetsAt !== null &&
        Date.parse(priorPool!.window.resetsAt) > Date.parse(previous!.observedAt) &&
        Date.parse(priorPool!.window.resetsAt) <= Date.parse(snapshot.observedAt)));
  const exactBalances =
    countersConsistent &&
    sameMeaning &&
    snapshot.freshness === 'current' &&
    previous!.freshness === 'current' &&
    pool.precision === 'exact' &&
    priorPool!.precision === 'exact';
  const percentDelta =
    countersConsistent &&
    sameMeaning &&
    snapshot.freshness === 'current' &&
    previous!.freshness === 'current' &&
    pool.percent &&
    priorPool!.percent &&
    pool.percent.direction === priorPool!.percent.direction
      ? pool.percent.value - priorPool!.percent.value
      : null;
  return {
    observationId: snapshot.observationId,
    subscriptionRef: snapshot.subscriptionRef,
    poolRef: pool.poolRef,
    provider: snapshot.provider,
    plan: snapshot.plan,
    planVersion: snapshot.planVersion,
    resource: pool.resource,
    unit: pool.unit,
    semantics: pool.semantics,
    category: pool.category,
    scope: pool.scope,
    sharing: pool.sharing,
    evidence: 'Q0',
    verification: 'client_reported',
    observedAt: snapshot.observedAt,
    baselineAt: baseline?.observedAt ?? null,
    previousObservationAt: previous?.observedAt ?? null,
    observedGapHours: previous
      ? (Date.parse(snapshot.observedAt) - Date.parse(previous.observedAt)) / 3600000
      : null,
    capacity: pool.capacity,
    used: pool.used,
    remaining: pool.remaining,
    percent: pool.percent,
    consistency,
    expiresAt: pool.expiresAt,
    status,
    reason,
    capacityDelta: delta,
    capacityRelativeChange: relative,
    remainingDelta:
      exactBalances && pool.remaining !== null && priorPool!.remaining !== null
        ? pool.remaining - priorPool!.remaining
        : null,
    percentPointChange: percentDelta,
    usageReset:
      pool.resetObserved === true
        ? 'reported'
        : fixedWindowChanged
          ? 'reported_window_changed'
          : 'not_established',
    consumption:
      coverage.previous.status === 'partial'
        ? { amount: null, method: 'unknown', reason: 'history_previous_incomplete' }
        : intervalConsumption(previous, priorPool, snapshot, pool, !!fixedWindowChanged),
    freshness: snapshot.freshness,
    isLatest: coverage.latest.status === 'complete' ? context.isLatest : null,
    historyCoverage: coverage,
  };
}
export type SubscriptionChange = ReturnType<typeof compareSubscriptionPool>;

// Compatibility for callers holding complete local arrays. Server history uses explicit
// per-pool contexts rather than treating a bounded array as the complete database history.
export function compareSubscriptionSnapshots(
  current: SubscriptionSnapshot[],
  history: SubscriptionSnapshot[],
) {
  return current.flatMap((snapshot) =>
    snapshot.pools.map((pool) => {
      const earlier = [...history, ...current]
        .filter(
          (previous) =>
            previous.subscriptionRef === snapshot.subscriptionRef &&
            Date.parse(previous.observedAt) < Date.parse(snapshot.observedAt) &&
            previous.pools.some((p) => p.poolRef === pool.poolRef),
        )
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
      const previous = earlier[0] ?? null;
      const priorPool = previous?.pools.find((p) => p.poolRef === pool.poolRef) ?? null;
      let baseline: SubscriptionSnapshot | null = null;
      let baselinePool: QuotaPool | null = null;
      let capacityReason: SubscriptionHistoryReason = 'history_exhausted';
      for (const candidate of earlier) {
        const candidatePool = candidate.pools.find((p) => p.poolRef === pool.poolRef)!;
        if (
          subscriptionConditions(candidate, candidatePool) !==
          subscriptionConditions(snapshot, pool)
        ) {
          capacityReason = 'conditions_changed';
          break;
        }
        if (knownSubscriptionCapacity(candidate, candidatePool)) {
          baseline = candidate;
          baselinePool = candidatePool;
          capacityReason = 'resolved';
          break;
        }
      }
      return compareSubscriptionPool(snapshot, pool, {
        previous,
        priorPool,
        baseline,
        baselinePool,
        isLatest: ![...history, ...current].some(
          (other) =>
            other.subscriptionRef === snapshot.subscriptionRef &&
            Date.parse(other.observedAt) > Date.parse(snapshot.observedAt) &&
            other.pools.some((p) => p.poolRef === pool.poolRef),
        ),
        historyCoverage: {
          previous: { status: 'complete', reason: previous ? 'resolved' : 'history_exhausted' },
          capacity: { status: 'complete', reason: capacityReason },
          latest: { status: 'complete', reason: 'resolved' },
        },
      });
    }),
  );
}
