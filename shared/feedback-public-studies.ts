import { z } from 'zod';
import type { Comparison } from './analysis.js';
import { canonical } from './schema.js';
import { modelIdentityKey } from './model-identity.js';
import { boardScope, modelWorkCondition, type RankingTarget } from './ranking-target.js';
import { rankingConfiguration } from './ranking.js';
import { RankingConfigurationSchema } from './ranking-selection.js';
import type { PublicRankingStudy } from './ranking-study-report.js';
import { GroupResamplingSchema } from './ranking-resampling.js';
import { SourceSensitivitySchema } from './ranking-source-sensitivity.js';
import { SourceBalanceSchema } from './ranking-source-balance.js';
import { SelectionStabilitySchema } from './selection-stability.js';
import {
  TaskWeightExcerptSchema,
  taskWeightExcerpt,
  type TaskWeightSensitivity,
} from './ranking-weight-sensitivity.js';

export const feedbackStudyLimits = {
  indexedConditions: 8192,
  indexedBytes: 8 * 1024 * 1024,
  itemBytes: 8192,
  reportBytes: 256 * 1024,
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const amount = z.number().finite().nonnegative();
const count = z.number().int().safe().nonnegative();
const unavailable = z
  .object({
    version: z.literal('feedback-public-study-1'),
    status: z.enum([
      'not_configured',
      'capacity',
      'target_not_found',
      'report_not_found',
      'snapshot_changed',
      'report_mismatch',
      'model_not_selected',
      'model_incomplete',
      'configuration_not_selected',
    ]),
  })
  .strict();
const available = z
  .object({
    version: z.literal('feedback-public-study-1'),
    status: z.literal('available'),
    population: z.literal('whole_public_community'),
    ownerExclusion: z.literal('not_applied'),
    relationship: z.literal('context_only_not_recommendation_validation'),
    reportId: hash,
    targetId: hash,
    dataVersion: hash,
    preparedAt: z.string().datetime(),
    evaluatedAt: z.string().datetime(),
    sourceUpdatedAt: z.string().datetime().nullable(),
    month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    currency: z.enum(['CNY', 'USD', 'EUR']),
    modelId: z.string().min(1).max(1024),
    configuration: RankingConfigurationSchema,
    matchedCondition: z
      .object({
        id: hash,
        weight: z.number().positive().max(1),
        count: count.min(20),
        accepted: count,
        spendMinor: count,
        groups: count.min(5),
        costPerAccepted: amount.nullable(),
      })
      .strict(),
    targetResult: z
      .object({
        conditions: count.min(1).max(256),
        kind: z.string().min(1).max(72).nullable(),
        status: z.enum(['measured', 'zero_acceptance']),
        perRootSpend: amount,
        acceptedPerRoot: z.number().min(0).max(1),
        costPerAccepted: amount.nullable(),
        // Each excerpt contains exactly this model, while retaining the public method metadata.
        resampling: GroupResamplingSchema.nullable(),
        sourceSensitivity: SourceSensitivitySchema.nullable(),
        sourceBalance: SourceBalanceSchema.optional(),
        sourceBalanceBasis: z
          .object({ positiveSpend: z.boolean(), positiveAcceptance: z.boolean() })
          .strict()
          .optional(),
        weightSensitivity: TaskWeightExcerptSchema.optional(),
        selectionStability: SelectionStabilitySchema.optional(),
        selectionStabilityScope: z.literal('whole_route_and_matched_condition').optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const p = v.matchedCondition,
      t = v.targetResult;
    const equal = (a: number, b: number) =>
      Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));
    if (Date.parse(v.preparedAt) > Date.parse(v.evaluatedAt)) fail('评价时间顺序错误');
    if (p.accepted > p.count || p.groups > p.count) fail('匹配条件计数不一致');
    if (
      p.accepted === 0
        ? p.costPerAccepted !== null
        : p.costPerAccepted === null || !equal(p.costPerAccepted, p.spendMinor / p.accepted)
    )
      fail('匹配条件费用不一致');
    if (
      t.status === 'zero_acceptance'
        ? t.acceptedPerRoot !== 0 || t.costPerAccepted !== null || p.accepted !== 0
        : t.acceptedPerRoot <= 0 ||
          t.costPerAccepted === null ||
          !equal(t.costPerAccepted, t.perRootSpend / t.acceptedPerRoot)
    )
      fail('固定组合费用不一致');
    if (
      t.conditions === 1 &&
      (!equal(p.weight, 1) ||
        !equal(t.perRootSpend, p.spendMinor / p.count) ||
        !equal(t.acceptedPerRoot, p.accepted / p.count))
    )
      fail('单条件与组合不一致');
    for (const diagnostic of [t.resampling, t.sourceSensitivity, t.sourceBalance]) {
      if (
        diagnostic &&
        (diagnostic.models.length !== 1 || diagnostic.models[0].modelId !== v.modelId)
      )
        fail('附加分布只能属于匹配模型');
      const minimum = diagnostic?.models[0]?.minGroupsPerCell;
      if (
        diagnostic &&
        (minimum == null || minimum > p.groups || (t.conditions === 1 && minimum !== p.groups))
      )
        fail('附加分布组数不一致');
    }
    const s = t.sourceSensitivity?.models[0];
    if (Boolean(t.selectionStability) !== Boolean(t.selectionStabilityScope))
      fail('重选摘录须声明整体组合与匹配条件范围');
    if (t.selectionStability) {
      const values = t.selectionStability.models;
      if (
        values.length !== 1 ||
        values[0].modelId !== v.modelId ||
        (values[0].state === 'measured' &&
          (values[0].conditions.length !== 1 || values[0].conditions[0].conditionId !== p.id))
      )
        fail('重选摘录只包含本模型及匹配任务条件');
    }
    const b = t.sourceBalance?.models[0];
    const basis = t.sourceBalanceBasis;
    if (Boolean(t.sourceBalance) !== Boolean(basis)) fail('来源等权需同时保留原公开分项的零值依据');
    if (b) {
      if (b.reason === 'base_incomplete') fail('完整模型不能附加缺项来源等权');
      if (basis) {
        if (
          basis.positiveAcceptance !== (t.status === 'measured') ||
          (!basis.positiveSpend && p.spendMinor > 0) ||
          (!basis.positiveAcceptance && p.accepted > 0) ||
          (t.conditions === 1 &&
            (basis.positiveSpend !== p.spendMinor > 0 ||
              basis.positiveAcceptance !== p.accepted > 0))
        )
          fail('来源等权原分项依据不一致');
        // Legacy report summaries may be rounded to zero within their existing
        // validation tolerance; only the original public integer cells establish zero.
        if (!basis.positiveSpend && Math.abs(t.perRootSpend) > 1e-10) fail('零支出依据与摘要矛盾');
        if (['measured', 'zero_acceptance_paid', 'undefined_zero_over_zero'].includes(b.state)) {
          if (
            b.state !==
            (basis.positiveAcceptance
              ? 'measured'
              : basis.positiveSpend
                ? 'zero_acceptance_paid'
                : 'undefined_zero_over_zero')
          )
            fail('来源等权验收状态不一致');
          if (b.comparison && (b.comparison.direction === 'zero_baseline') !== !basis.positiveSpend)
            fail('来源等权零基准不一致');
        }
      }
    }
    const w = t.weightSensitivity;
    if (w) {
      if (
        w.reportId !== v.reportId ||
        w.targetId !== v.targetId ||
        w.dataVersion !== v.dataVersion ||
        w.conditions !== t.conditions ||
        w.result.modelId !== v.modelId
      )
        fail('任务权重情景与当前摘录不一致');
      if (w.result.state === 'incomplete') fail('完整模型不能附加缺项模型的情景');
      if (
        w.result.state === 'measured' &&
        (t.costPerAccepted === null || w.result.reportedBaselineCost !== t.costPerAccepted)
      )
        fail('任务权重情景基准不一致');
      if (
        w.result.state !== 'measured' &&
        w.result.state !== 'capacity' &&
        w.result.state !== 'numeric_unavailable' &&
        (t.status !== 'zero_acceptance' ||
          (w.result.state === 'undefined_zero_over_zero') !== (t.perRootSpend === 0))
      )
        fail('任务权重情景零分母不一致');
    }
    if (s && (s.state === 'measured' || s.state === 'zero_acceptance')) {
      if ((s.state === 'zero_acceptance') !== (t.status === 'zero_acceptance'))
        fail('来源档位验收状态不一致');
      if ((s.costInfluence === 'zero_baseline') !== (t.costPerAccepted === 0))
        fail('来源档位费用基准不一致');
    }
  });
export const FeedbackPublicStudySchema = z.discriminatedUnion('status', [unavailable, available]);
export type FeedbackPublicStudy = z.infer<typeof FeedbackPublicStudySchema>;
export type FeedbackStudyLookup = (row: Comparison) => FeedbackPublicStudy;
const absent = (status: z.infer<typeof unavailable>['status']): FeedbackPublicStudy => ({
  version: 'feedback-public-study-1',
  status,
});
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Build once from validated catalogs, without querying user records or a second population. */
export function createFeedbackStudyLookup(
  targets: readonly RankingTarget[],
  reports: readonly PublicRankingStudy[],
  weights?: ReadonlyMap<string, TaskWeightSensitivity>,
) {
  const conditions = new Map<string, { target: RankingTarget; conditionId: string }>();
  let entries = 0,
    usedBytes = 0,
    capacity = false;
  // This preference does not inspect availability, performance or uncertainty.
  const ordered = targets
    .filter((t) => t.board === 'models')
    .sort(
      (a, b) =>
        Number(a.kind === null) - Number(b.kind === null) ||
        a.cells.length - b.cells.length ||
        a.id.localeCompare(b.id),
    );
  for (const target of ordered) {
    for (const cell of target.cells) {
      if (
        ++entries > feedbackStudyLimits.indexedConditions ||
        (usedBytes += new TextEncoder().encode(cell.key).byteLength + 256) >
          feedbackStudyLimits.indexedBytes
      ) {
        capacity = true;
        break;
      }
      if (!conditions.has(cell.key)) conditions.set(cell.key, { target, conditionId: cell.id });
    }
    if (capacity) break;
  }
  if (capacity) conditions.clear();
  const byTarget = new Map<string, PublicRankingStudy[]>();
  for (const report of reports) {
    const existing = byTarget.get(report.targetId) ?? [];
    existing.push(report);
    byTarget.set(report.targetId, existing);
  }
  const consistent = (target: RankingTarget, report: PublicRankingStudy) => {
    const weights = new Map(target.cells.map((c) => [c.id, c.weight]));
    return (
      report.month === target.month &&
      report.kind === target.kind &&
      canonical(report.scope) === canonical(target.scope) &&
      report.models.every(
        (m) =>
          m.status === 'incomplete' ||
          (m.cells.length === target.cells.length &&
            m.cells.every(
              (c) =>
                weights.has(c.conditionId) &&
                Math.abs(weights.get(c.conditionId)! - c.weight) <= 1e-12,
            )),
      )
    );
  };
  const validity = new Map<PublicRankingStudy, boolean>();
  for (const { target } of conditions.values())
    for (const report of byTarget.get(target.id) ?? [])
      if (!validity.has(report)) validity.set(report, consistent(target, report));
  return (dataVersion: string): FeedbackStudyLookup =>
    (row) => {
      if (capacity) return absent('capacity');
      if (!ordered.length) return absent('not_configured');
      const selected = conditions.get(modelWorkCondition(row));
      if (!selected) return absent('target_not_found');
      const { target, conditionId } = selected;
      const candidates = byTarget.get(target.id) ?? [];
      if (!candidates.length) return absent('report_not_found');
      const report = candidates.find((r) => r.dataVersion === dataVersion);
      if (!report) return absent('snapshot_changed');
      if (!validity.get(report) || canonical(boardScope(row)) !== canonical(report.scope))
        return absent('report_mismatch');
      const modelId = modelIdentityKey(row.cohort.modelIdentity);
      if (!modelId) return absent('model_not_selected');
      const model = report.models.find((m) => m.id === modelId);
      if (!model) return absent('model_not_selected');
      if (model.status === 'incomplete') return absent('model_incomplete');
      const cell = model.cells.find((c) => c.conditionId === conditionId);
      if (!cell) return absent('report_mismatch');
      if (canonical(cell.configuration) !== canonical(rankingConfiguration(row)))
        return absent('configuration_not_selected');
      const resampling =
        report.format === 'ranking-source-holdout-public-2' ? report.resampling : null;
      const source =
        report.format === 'ranking-source-holdout-public-2' ? report.sourceSensitivity : null;
      const balance =
        report.format === 'ranking-source-holdout-public-2' ? report.sourceBalance : undefined;
      const stability =
        report.format === 'ranking-source-holdout-public-2' ? report.selectionStability : undefined;
      const result = FeedbackPublicStudySchema.parse({
        version: 'feedback-public-study-1',
        status: 'available',
        population: 'whole_public_community',
        ownerExclusion: 'not_applied',
        relationship: 'context_only_not_recommendation_validation',
        reportId: report.id,
        targetId: report.targetId,
        dataVersion: report.dataVersion,
        preparedAt: report.preparedAt,
        evaluatedAt: report.evaluatedAt,
        sourceUpdatedAt: report.sourceUpdatedAt,
        month: report.month,
        currency: report.scope.currency,
        modelId,
        configuration: cell.configuration,
        matchedCondition: {
          id: cell.conditionId,
          weight: cell.weight,
          count: cell.count,
          accepted: cell.accepted,
          spendMinor: cell.spendMinor,
          groups: cell.groups,
          costPerAccepted: cell.accepted > 0 ? cell.spendMinor / cell.accepted : null,
        },
        targetResult: {
          conditions: target.cells.length,
          kind: target.kind,
          status: model.status,
          perRootSpend: model.perRootSpend,
          acceptedPerRoot: model.acceptedPerRoot,
          costPerAccepted: model.costPerAccepted,
          resampling: resampling
            ? { ...resampling, models: resampling.models.filter((m) => m.modelId === modelId) }
            : null,
          sourceSensitivity: source
            ? { ...source, models: source.models.filter((m) => m.modelId === modelId) }
            : null,
          ...(balance
            ? {
                sourceBalance: {
                  ...balance,
                  models: balance.models.filter((m) => m.modelId === modelId),
                },
                sourceBalanceBasis: {
                  positiveSpend: model.cells.some((c) => c.spendMinor > 0),
                  positiveAcceptance: model.cells.some((c) => c.accepted > 0),
                },
              }
            : {}),
          ...(stability
            ? {
                selectionStability: {
                  ...stability,
                  models: stability.models
                    .filter((m) => m.modelId === modelId)
                    .map((m) => ({
                      ...m,
                      conditions: m.conditions.filter((c) => c.conditionId === cell.conditionId),
                    })),
                },
                selectionStabilityScope: 'whole_route_and_matched_condition',
              }
            : {}),
          ...(weights?.has(report.id)
            ? { weightSensitivity: taskWeightExcerpt(weights.get(report.id), modelId) }
            : {}),
        },
      });
      return bytes(result) > feedbackStudyLimits.itemBytes ? absent('capacity') : result;
    };
}

/** Never retain a favorable prefix when the combined optional evidence is too large. */
export function limitFeedbackStudyEvidence(
  recommendations: { publicStudyEvidence?: FeedbackPublicStudy }[],
) {
  if (
    recommendations.reduce(
      (sum, r) => sum + (r.publicStudyEvidence ? bytes(r.publicStudyEvidence) : 0),
      0,
    ) <= feedbackStudyLimits.reportBytes
  )
    return;
  for (const r of recommendations)
    if (r.publicStudyEvidence) r.publicStudyEvidence = absent('capacity');
}
