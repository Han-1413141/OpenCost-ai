import { z } from 'zod';
import { publicId } from './schema.js';

export const quotaReplayLimits = {
  bytes: 2 * 1024 * 1024,
  requests: 2000,
  pools: 32,
  events: 2000,
  initialEntries: 4000,
  references: 16000,
  steps: 200000,
  horizonMs: 366 * 86400000,
} as const;
const id = z.string().uuid(),
  units = z.number().int().nonnegative().max(1e12),
  money = z.number().int().nonnegative().max(1e10);
const time = z.number().int().nonnegative().max(quotaReplayLimits.horizonMs);
export const AppliesToSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('classes'), ids: z.array(publicId).min(1).max(64) }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
]);
export const QuotaLotSchema = z
  .object({
    lotRef: id,
    units,
    expiresAtMs: time.nullable(),
    priority: z.number().int().min(0).max(1000000),
    resettable: z.boolean(),
    category: z.enum(['base', 'promotion', 'trial', 'addon']),
    appliesTo: AppliesToSchema,
  })
  .strict();
const poolBase = {
  poolRef: id,
  unit: z.enum([
    'token',
    'message',
    'request',
    'image',
    'second',
    'byte',
    'credit',
    'currency_minor',
    'count',
    'slot',
    'unknown',
  ]),
  policyVersion: publicId,
};
export const ReplayPoolSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...poolBase,
      kind: z.literal('balance'),
      initialLots: z.array(QuotaLotSchema).max(1000).nullable(),
      spendOrder: z.literal('priority_expiry_issue_order'),
      returnPolicy: z.literal('original_lot_no_revive'),
    })
    .strict(),
  z
    .object({
      ...poolBase,
      kind: z.literal('rolling'),
      capacity: units.nullable(),
      windowMs: time.positive().nullable(),
      initialHistory: z.enum(['complete', 'unknown']),
      initialUsage: z
        .array(
          z
            .object({
              debitRef: id,
              atMs: z.number().int().min(-quotaReplayLimits.horizonMs).max(-1),
              units,
            })
            .strict(),
        )
        .max(2000)
        .nullable(),
    })
    .strict(),
  z
    .object({
      ...poolBase,
      kind: z.literal('concurrency'),
      capacity: units.nullable(),
      initialReservations: z
        .array(z.object({ debitRef: id, untilMs: time.positive(), units }).strict())
        .max(2000)
        .nullable(),
    })
    .strict(),
  z
    .object({
      ...poolBase,
      kind: z.literal('token_bucket'),
      capacity: units.nullable(),
      initialAvailable: units.nullable(),
      refill: z.object({ units: units.positive(), perMs: time.positive() }).strict().nullable(),
    })
    .strict(),
  z
    .object({
      ...poolBase,
      kind: z.literal('unsupported'),
      reason: z.enum(['dynamic_capacity', 'storage_occupancy', 'unknown_policy', 'other']),
    })
    .strict(),
]);
const boundary = {
  eventRef: id,
  poolRef: id,
  atMs: time,
  sequence: z.number().int().nonnegative().max(1000000),
};
export const ReplayEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...boundary, kind: z.literal('grant'), lot: QuotaLotSchema }).strict(),
  z
    .object({
      ...boundary,
      kind: z.literal('reset'),
      discard: z.enum(['all', 'resettable']),
      newLots: z.array(QuotaLotSchema).max(1000),
    })
    .strict(),
  z
    .object({ ...boundary, kind: z.literal('return_to_lot'), requestRef: id, lotRef: id, units })
    .strict(),
  z.object({ ...boundary, kind: z.literal('release_rolling_usage'), debitRef: id, units }).strict(),
]);
export const QuotaReplayInputSchema = z
  .object({
    version: z.literal('quota-replay-1'),
    scenarioRef: id,
    plan: publicId,
    policyVersion: publicId,
    horizonMs: time.positive(),
    basis: z.enum(['observed_demand', 'explicit_scenario']),
    eligibility: z.enum(['eligible', 'ineligible', 'unknown']),
    externalDemand: z.enum(['included', 'assume_none', 'unknown']),
    sameTimeOrder: z.enum(['source_sequence', 'scenario_sequence', 'unknown']),
    requirementsCoverage: z.enum(['complete', 'partial', 'unknown']),
    dispatch: z.literal('per_pool_fifo'),
    shortage: z.enum(['wait_only', 'pay_then_wait_limits']),
    pools: z.array(ReplayPoolSchema).min(1).max(quotaReplayLimits.pools),
    events: z.array(ReplayEventSchema).max(quotaReplayLimits.events),
    requests: z
      .array(
        z
          .object({
            requestRef: id,
            rootTaskRef: id,
            atMs: time,
            sequence: z.number().int().nonnegative().max(1000000),
            latestStartMs: time,
            durationMs: time.nullable(),
            requirements: z
              .array(z.object({ poolRef: id, classId: publicId, units: units.nullable() }).strict())
              .min(1)
              .max(32),
          })
          .strict(),
      )
      .max(quotaReplayLimits.requests),
    cost: z
      .object({
        currency: z.enum(['CNY', 'USD', 'EUR']),
        wholePeriodFixedMinor: money.nullable(),
        inWindowFixedMinor: money.nullable(),
        adjustments: z
          .array(
            z
              .object({
                eventRef: id,
                atMs: time,
                kind: z.enum(['debit', 'refund']),
                amountMinor: money,
              })
              .strict(),
          )
          .max(1000),
        overage: z
          .object({
            poolRef: id,
            appliesTo: AppliesToSchema,
            priceMinor: money,
            perUnits: units.positive(),
            rounding: z.enum(['ceil_per_request', 'ceil_total']),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const pools = new Map(s.pools.map((p) => [p.poolRef, p]));
    if (pools.size !== s.pools.length) issue('共享池只能初始化一次');
    const requestIds = new Set(s.requests.map((r) => r.requestRef));
    if (requestIds.size !== s.requests.length) issue('请求标识不能重复');
    const lotKeys = new Set<string>();
    let entries = 0,
      refs = 0;
    const lot = (poolRef: string, l: z.infer<typeof QuotaLotSchema>, at: number) => {
      const key = poolRef + ':' + l.lotRef;
      if (lotKeys.has(key)) issue('同一池额度批次标识不能重用');
      lotKeys.add(key);
      entries++;
      if (l.expiresAtMs !== null && l.expiresAtMs <= at) issue('额度批次有效期须晚于发放时点');
      if (
        l.appliesTo.kind === 'classes' &&
        new Set(l.appliesTo.ids).size !== l.appliesTo.ids.length
      )
        issue('额度适用类别不能重复');
    };
    for (const p of s.pools) {
      if (p.unit === 'slot' && p.kind !== 'concurrency') issue('并发槽位只能用于并发池');
      if (p.kind === 'balance') for (const l of p.initialLots ?? []) lot(p.poolRef, l, 0);
      if (p.kind === 'rolling') {
        entries += p.initialUsage?.length ?? 0;
        if (new Set(p.initialUsage?.map((x) => x.debitRef)).size !== (p.initialUsage?.length ?? 0))
          issue('期初滚动消费标识不能重复');
        if (p.windowMs !== null && p.initialUsage?.some((x) => x.atMs <= -p.windowMs!))
          issue('期初滚动消费须位于有效窗口内');
        if (p.initialUsage?.some((x) => requestIds.has(x.debitRef)))
          issue('期初消费与回放请求标识不能重用');
        if (
          p.capacity !== null &&
          (p.initialUsage ?? []).reduce((n, x) => n + BigInt(x.units), 0n) > BigInt(p.capacity)
        )
          issue('期初滚动占用超过容量');
      }
      if (p.kind === 'concurrency') {
        entries += p.initialReservations?.length ?? 0;
        if (
          new Set(p.initialReservations?.map((x) => x.debitRef)).size !==
          (p.initialReservations?.length ?? 0)
        )
          issue('期初并发占用标识不能重复');
        if (p.initialReservations?.some((x) => requestIds.has(x.debitRef)))
          issue('期初占用与回放请求标识不能重用');
        if (
          p.capacity !== null &&
          (p.initialReservations ?? []).reduce((n, x) => n + BigInt(x.units), 0n) >
            BigInt(p.capacity)
        )
          issue('期初并发占用超过容量');
      }
      if (
        p.kind === 'token_bucket' &&
        p.capacity !== null &&
        p.initialAvailable !== null &&
        p.initialAvailable > p.capacity
      )
        issue('令牌桶期初可用量超过容量');
    }
    const positions = new Set<string>();
    for (const r of s.requests) {
      if (r.atMs >= s.horizonMs || r.latestStartMs < r.atMs || r.latestStartMs > s.horizonMs)
        issue('请求到达与最晚开始时间须位于回放范围内');
      if (new Set(r.requirements.map((x) => x.poolRef)).size !== r.requirements.length)
        issue('一个请求对同一池只登记一次总需求');
      refs += r.requirements.length;
      for (const q of r.requirements) if (!pools.has(q.poolRef)) issue('请求引用了未登记的额度池');
      const key = r.atMs + ':' + r.sequence;
      if (positions.has(key)) issue('相同时点的操作序号不能重复');
      positions.add(key);
    }
    const events = new Map<string, string>();
    for (const e of s.events) {
      const value = JSON.stringify(e),
        old = events.get(e.eventRef);
      if (old) {
        if (old !== value) issue('同一额度事件内容冲突');
        continue;
      }
      events.set(e.eventRef, value);
      const p = pools.get(e.poolRef);
      if (!p || (e.kind === 'release_rolling_usage' ? p.kind !== 'rolling' : p.kind !== 'balance'))
        issue('额度事件类型与池规则不一致');
      if (e.atMs >= s.horizonMs) issue('额度事件超出回放范围');
      const key = e.atMs + ':' + e.sequence;
      if (positions.has(key)) issue('相同时点的操作序号不能重复');
      positions.add(key);
      if (e.kind === 'grant') lot(e.poolRef, e.lot, e.atMs);
      if (e.kind === 'reset') for (const l of e.newLots) lot(e.poolRef, l, e.atMs);
    }
    if (entries > quotaReplayLimits.initialEntries || refs > quotaReplayLimits.references)
      issue('额度批次、期初占用或请求引用超过处理预算');
    if (s.cost.overage && pools.get(s.cost.overage.poolRef)?.kind !== 'balance')
      issue('线性超额费用只绑定一个余额池，不能购买速率或并发限制');
    if (
      s.cost.overage?.appliesTo.kind === 'classes' &&
      new Set(s.cost.overage.appliesTo.ids).size !== s.cost.overage.appliesTo.ids.length
    )
      issue('超额费用适用类别不能重复');
    const cash = new Map<string, string>();
    for (const e of s.cost.adjustments) {
      if (e.atMs >= s.horizonMs) issue('现金事件超出回放范围');
      const old = cash.get(e.eventRef),
        value = JSON.stringify(e);
      if (old && old !== value) issue('同一现金事件内容冲突');
      cash.set(e.eventRef, value);
    }
    if (
      s.cost.wholePeriodFixedMinor !== null &&
      s.cost.inWindowFixedMinor !== null &&
      s.cost.inWindowFixedMinor > s.cost.wholePeriodFixedMinor
    )
      issue('窗口内固定付款不能大于覆盖该情景的完整周期固定费用');
  });
export type QuotaReplayInput = z.infer<typeof QuotaReplayInputSchema>;
export type ReplayPool = QuotaReplayInput['pools'][number];
export type QuotaLot = z.infer<typeof QuotaLotSchema>;
