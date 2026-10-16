import { z } from 'zod';
import { publicId } from './schema.js';
import { QuotaReplayInputSchema, quotaReplayLimits } from './quota-replay-schema.js';

export const quotaPlanComparisonLimits = {
  bytes: quotaReplayLimits.bytes,
  candidates: 16,
  steps: 1000000,
  constructedReferences: 100000,
} as const;
const id = z.string().uuid();
const time = z.number().int().nonnegative().max(quotaReplayLimits.horizonMs);
const unit = z.enum([
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
]);
const quantity = z.number().int().nonnegative().max(1e12);
const commonRequest = z
  .object({
    requestRef: id,
    rootTaskRef: id,
    atMs: time,
    sequence: z.number().int().nonnegative().max(1000000),
    latestStartMs: time,
    durationMs: time.nullable(),
    required: z.boolean(),
    demands: z
      .array(
        z.object({ meterId: publicId, classId: publicId, units: quantity.nullable() }).strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
const shape = QuotaReplayInputSchema.shape;
export const QuotaPlanComparisonSchema = z
  .object({
    version: z.literal('quota-plan-comparison-1'),
    comparisonRef: id,
    window: z.object({ startAt: z.string().datetime(), horizonMs: time.positive() }).strict(),
    execution: z
      .object({
        provider: publicId,
        model: publicId,
        modelVersion: publicId,
        harness: publicId,
        harnessVersion: publicId,
        harnessSurface: z.enum(['cli', 'desktop', 'web', 'sdk', 'unknown']),
        variant: publicId.nullable(),
        mode: z.enum(['agent', 'assisted']),
        tools: z.enum(['standard', 'extended']),
        reasoning: z.enum(['low', 'medium', 'high', 'auto']),
        cache: z.enum(['on', 'off', 'mixed']),
      })
      .strict(),
    demandBasis: z.enum(['observed_demand', 'explicit_scenario']),
    externalDemand: shape.externalDemand,
    sameTimeOrder: shape.sameTimeOrder,
    requirementsCoverage: shape.requirementsCoverage,
    meters: z
      .array(
        z
          .object({ meterId: publicId, unit, currency: z.enum(['CNY', 'USD', 'EUR']).nullable() })
          .strict(),
      )
      .min(1)
      .max(32),
    requests: z.array(commonRequest).max(quotaReplayLimits.requests),
    currency: z.enum(['CNY', 'USD', 'EUR']),
    preferences: z
      .object({
        objective: z.enum(['whole_period_cost', 'required_wait_total', 'required_wait_max']),
        coverage: z.enum(['all_requests', 'required_requests']),
        budgetMinor: z.number().int().nonnegative().max(1e10).nullable(),
        maxWaitMs: time.nullable(),
      })
      .strict(),
    candidates: z
      .array(
        z
          .object({
            candidateRef: id,
            plan: publicId,
            policyVersion: publicId,
            eligibility: shape.eligibility,
            pools: shape.pools,
            events: shape.events,
            shortage: shape.shortage,
            cost: shape.cost,
            costCoverage: z.enum(['all_required_payments_taxes_fees', 'partial', 'unknown']),
            priceRecord: z
              .object({
                capturedAt: z.string().datetime().nullable(),
                snapshotId: z
                  .string()
                  .regex(/^[a-f0-9]{64}$/)
                  .nullable(),
                source: z.enum(['provider_export', 'provider_page', 'user_input', 'unknown']),
              })
              .strict(),
            bindings: z
              .array(
                z
                  .object({
                    poolRef: id,
                    meterId: publicId,
                    conversion: z
                      .object({
                        numerator: z.number().int().positive().max(1000000),
                        denominator: z.number().int().positive().max(1000000),
                        rounding: z.literal('ceil_per_request'),
                        basis: z.enum(['provider_rule', 'explicit_assumption', 'unknown']),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
          })
          .strict(),
      )
      .min(1)
      .max(quotaPlanComparisonLimits.candidates),
  })
  .strict()
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const meterIds = new Set(s.meters.map((m) => m.meterId)),
      requestIds = new Set(s.requests.map((r) => r.requestRef));
    if (
      meterIds.size !== s.meters.length ||
      requestIds.size !== s.requests.length ||
      new Set(s.candidates.map((c) => c.candidateRef)).size !== s.candidates.length
    )
      fail('计量项、请求和候选标识不能重复');
    const positions = new Set<string>();
    let references = 0;
    for (const m of s.meters)
      if ((m.unit === 'currency_minor') !== (m.currency !== null))
        fail('货币计量需要明确币种，其他单位不携带币种');
    for (const r of s.requests) {
      if (
        r.atMs >= s.window.horizonMs ||
        r.latestStartMs < r.atMs ||
        r.latestStartMs > s.window.horizonMs
      )
        fail('共同需求时间超出窗口或顺序无效');
      if (
        new Set(r.demands.map((d) => d.meterId)).size !== r.demands.length ||
        r.demands.some((d) => !meterIds.has(d.meterId))
      )
        fail('请求计量项缺失或重复');
      const key = r.atMs + ':' + r.sequence;
      if (positions.has(key)) fail('共同到达时点的操作序号重复');
      positions.add(key);
      references += r.demands.length;
    }
    if (references > quotaReplayLimits.references) fail('共同需求引用超过容量');
  });
export type QuotaPlanComparison = z.infer<typeof QuotaPlanComparisonSchema>;
