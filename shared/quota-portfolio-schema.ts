import { z } from 'zod';
import { publicId } from './schema.js';
import { QuotaPlanComparisonSchema } from './quota-plan-comparison-schema.js';
import { QuotaReplayInputSchema, quotaReplayLimits } from './quota-replay-schema.js';

export const quotaPortfolioLimits = {
  bytes: quotaReplayLimits.bytes,
  purchases: 8,
  payments: 32,
  evaluations: 256,
  constructedReferences: 100000,
  allocationReferences: 100000,
  replaySteps: 1000000,
} as const;
const id = z.string().uuid();
const common = QuotaPlanComparisonSchema.shape;
const replay = QuotaReplayInputSchema.shape;
const candidate = common.candidates.element.shape;
export const QuotaPortfolioSchema = z
  .object({
    version: z.literal('quota-portfolio-1'),
    comparisonRef: common.comparisonRef,
    window: common.window,
    execution: common.execution,
    demandBasis: common.demandBasis,
    externalDemand: common.externalDemand,
    sameTimeOrder: common.sameTimeOrder,
    requirementsCoverage: common.requirementsCoverage,
    meters: common.meters,
    requests: common.requests.min(1),
    currency: common.currency,
    preferences: common.preferences,
    pools: replay.pools,
    events: replay.events,
    shortage: replay.shortage,
    overage: replay.cost.shape.overage,
    overageCoverage: z.enum(['complete', 'partial', 'unknown']),
    payments: z
      .array(
        z
          .object({
            paymentRef: id,
            wholePeriodMinor: replay.cost.shape.wholePeriodFixedMinor,
            inWindowMinor: replay.cost.shape.inWindowFixedMinor,
            adjustments: replay.cost.shape.adjustments,
            coverage: candidate.costCoverage,
            priceRecord: candidate.priceRecord,
          })
          .strict(),
      )
      .min(1)
      .max(quotaPortfolioLimits.payments),
    purchases: z
      .array(
        z
          .object({
            purchaseRef: id,
            entitlementRef: id,
            plan: publicId,
            policyVersion: publicId,
            eligibility: replay.eligibility,
            executionMatch: z.enum(['matches', 'different', 'unknown']),
            exclusiveGroup: id.nullable(),
            requiresPurchaseRefs: z.array(id).max(quotaPortfolioLimits.purchases),
            poolRefs: z.array(id).min(1).max(quotaReplayLimits.pools),
            eventRefs: z.array(id).max(quotaReplayLimits.events),
            paymentRefs: z.array(id).min(1).max(quotaPortfolioLimits.payments),
            bindings: candidate.bindings,
          })
          .strict(),
      )
      .min(1)
      .max(quotaPortfolioLimits.purchases),
    routingGroups: z
      .array(
        z
          .object({
            groupRef: id,
            requestRefs: z.array(id).min(1).max(quotaReplayLimits.requests),
            purchaseRefs: z.array(id).min(1).max(quotaPortfolioLimits.purchases),
          })
          .strict(),
      )
      .min(1)
      .max(quotaReplayLimits.requests),
    search: z
      .object({
        maxPurchases: z.number().int().min(1).max(quotaPortfolioLimits.purchases),
        requiredPurchaseRefs: z.array(id).max(quotaPortfolioLimits.purchases),
        maxEvaluations: z.number().int().min(1).max(quotaPortfolioLimits.evaluations),
        maxReplaySteps: z.number().int().min(1).max(quotaPortfolioLimits.replaySteps),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const unique = (values: string[]) => new Set(values).size === values.length;
    const pools = new Map(input.pools.map((p) => [p.poolRef, p]));
    const events = new Map(input.events.map((e) => [e.eventRef, e]));
    const payments = new Map(input.payments.map((p) => [p.paymentRef, p]));
    const purchases = new Map(input.purchases.map((p) => [p.purchaseRef, p]));
    const meters = new Map(input.meters.map((m) => [m.meterId, m]));
    if (
      pools.size !== input.pools.length ||
      events.size !== input.events.length ||
      payments.size !== input.payments.length ||
      purchases.size !== input.purchases.length ||
      meters.size !== input.meters.length ||
      !unique(input.requests.map((r) => r.requestRef)) ||
      !unique(input.routingGroups.map((g) => g.groupRef))
    )
      fail('全局标识不能重复');
    const positions = new Set<string>();
    for (const meter of input.meters)
      if ((meter.unit === 'currency_minor') !== (meter.currency !== null))
        fail('货币计量必须有币种');
    for (const request of input.requests) {
      if (
        request.atMs >= input.window.horizonMs ||
        request.latestStartMs < request.atMs ||
        request.latestStartMs > input.window.horizonMs
      )
        fail('请求时间超出范围');
      if (
        !unique(request.demands.map((d) => d.meterId)) ||
        request.demands.some((d) => !meters.has(d.meterId))
      )
        fail('共同需求计量缺失或重复');
      const position = request.atMs + ':' + request.sequence;
      if (positions.has(position)) fail('同刻请求序号重复');
      positions.add(position);
    }
    for (const purchase of input.purchases) {
      for (const refs of [
        purchase.poolRefs,
        purchase.eventRefs,
        purchase.paymentRefs,
        purchase.requiresPurchaseRefs,
      ])
        if (!unique(refs)) fail('订阅引用不能重复');
      if (
        purchase.poolRefs.some((ref) => !pools.has(ref)) ||
        purchase.eventRefs.some((ref) => !events.has(ref)) ||
        purchase.paymentRefs.some((ref) => !payments.has(ref)) ||
        purchase.requiresPurchaseRefs.some(
          (ref) => !purchases.has(ref) || ref === purchase.purchaseRef,
        )
      )
        fail('订阅引用了未登记对象或自身');
      if (
        purchase.bindings.length !== purchase.poolRefs.length ||
        !unique(purchase.bindings.map((b) => b.poolRef)) ||
        purchase.bindings.some(
          (b) => !purchase.poolRefs.includes(b.poolRef) || !meters.has(b.meterId),
        )
      )
        fail('订阅必须为每个相关池明确登记一次计量绑定');
      if (
        purchase.eventRefs.some(
          (ref) => events.has(ref) && !purchase.poolRefs.includes(events.get(ref)!.poolRef),
        )
      )
        fail('订阅事件必须对应其额度池');
    }
    const requests = new Set(input.requests.map((r) => r.requestRef)),
      covered: string[] = [];
    for (const group of input.routingGroups) {
      covered.push(...group.requestRefs);
      if (
        !unique(group.purchaseRefs) ||
        group.purchaseRefs.some((ref) => !purchases.has(ref)) ||
        group.requestRefs.some((ref) => !requests.has(ref))
      )
        fail('分配组引用无效');
    }
    if (!unique(covered) || covered.length !== requests.size)
      fail('每个请求必须恰好属于一个分配组');
    if (
      !unique(input.search.requiredPurchaseRefs) ||
      input.search.requiredPurchaseRefs.some((ref) => !purchases.has(ref))
    )
      fail('必需购买项引用无效');
    // A physical grant is global, including across separately offered subscriptions.
    const lots = new Set<string>();
    const lot = (ref: string) => {
      if (lots.has(ref)) fail('同一额度批次不能复制到不同池或事件');
      lots.add(ref);
    };
    for (const pool of input.pools)
      if (pool.kind === 'balance') for (const item of pool.initialLots ?? []) lot(item.lotRef);
    for (const event of input.events) {
      if (!pools.has(event.poolRef)) fail('全局事件引用缺失额度池');
      if (event.kind === 'grant') lot(event.lot.lotRef);
      if (event.kind === 'reset') for (const item of event.newLots) lot(item.lotRef);
    }
    const cashRefs: string[] = [];
    for (const payment of input.payments) {
      cashRefs.push(...payment.adjustments.map((a) => a.eventRef));
      if (
        payment.wholePeriodMinor !== null &&
        payment.inWindowMinor !== null &&
        payment.inWindowMinor > payment.wholePeriodMinor
      )
        fail('窗口付款不能超过完整购买费用');
    }
    if (!unique(cashRefs)) fail('同一现金调整不能复制到多个费用项目');
    if (input.overage && !pools.has(input.overage.poolRef)) fail('额外按量费用引用缺失额度池');
  });
export type QuotaPortfolio = z.infer<typeof QuotaPortfolioSchema>;
