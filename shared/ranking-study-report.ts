import { z } from 'zod';
import { BoardScopeSchema, type RankingTarget } from './ranking-target.js';
import { RankingConfigurationSchema, type evaluateRankingSelection } from './ranking-selection.js';
import { isModelIdentity, modelIdentityKey, type ModelIdentity } from './model-identity.js';
import { canonical } from './schema.js';
import type { TaskWeightSensitivity } from './ranking-weight-sensitivity.js';
import {
  SelectionStabilitySchema,
  publicSelectionStability,
  type InternalSelectionStability,
} from './selection-stability.js';
import { MIN_TASKS, MIN_SOURCES } from './schema.js';
import {
  SourceBalanceSchema,
  sourceBalancePolicy,
  publicSourceBalance,
  type InternalSourceBalance,
} from './ranking-source-balance.js';
import {
  GroupResamplingSchema,
  groupResamplingPolicy,
  type GroupResampling,
} from './ranking-resampling.js';
import {
  SourceSensitivitySchema,
  publicSourceSensitivity,
  sourceSensitivityPolicy,
  type InternalSourceSensitivity,
} from './ranking-source-sensitivity.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/),
  amount = z.number().finite().nonnegative();
const identity = z.custom<ModelIdentity>(isModelIdentity).refine((i) => i.members.length === 1);
const cell = z
  .object({
    conditionId: hash,
    weight: z.number().positive().max(1),
    configuration: RankingConfigurationSchema,
    count: z.number().int().safe().min(MIN_TASKS),
    accepted: z.number().int().safe().nonnegative(),
    spendMinor: z.number().int().safe().nonnegative(),
    groups: z.number().int().safe().min(MIN_SOURCES),
  })
  .strict()
  .refine((c) => c.accepted <= c.count && c.groups <= c.count);
const model = z
  .object({
    id: z.string().min(1).max(1024),
    identity,
    primarySelection: z.boolean(),
    status: z.enum(['measured', 'zero_acceptance', 'incomplete']),
    selectionCost: amount.nullable(),
    perRootSpend: amount.nullable(),
    acceptedPerRoot: z.number().min(0).max(1).nullable(),
    costPerAccepted: amount.nullable(),
    cells: z.array(cell).max(256),
  })
  .strict()
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      modelIdentityKey(m.identity) !== m.id ||
      new Set(m.cells.map((c) => c.conditionId)).size !== m.cells.length
    )
      fail('模型身份或条件标识不一致');
    if (m.status === 'incomplete') {
      if (
        m.cells.length ||
        [m.selectionCost, m.perRootSpend, m.acceptedPerRoot, m.costPerAccepted].some(
          (v) => v !== null,
        )
      )
        fail('不完整评价不得披露选择集费用或分项，避免与全量结果相减反推');
      return;
    }
    if (
      !m.cells.length ||
      m.selectionCost === null ||
      m.perRootSpend === null ||
      m.acceptedPerRoot === null
    ) {
      fail('完整评价需要已公开支持的全部分项');
      return;
    }
    const weight = m.cells.reduce((s, c) => s + c.weight, 0),
      spend = m.cells.reduce((s, c) => s + (c.weight * c.spendMinor) / c.count, 0),
      accepted = m.cells.reduce((s, c) => s + (c.weight * c.accepted) / c.count, 0);
    if (
      Math.abs(weight - 1) > 1e-12 ||
      Math.abs(spend - m.perRootSpend) > 1e-10 * Math.max(1, spend) ||
      Math.abs(accepted - m.acceptedPerRoot) > 1e-12
    )
      fail('评价分子分母与固定权重不一致');
    if (
      m.status === 'zero_acceptance'
        ? accepted !== 0 || m.costPerAccepted !== null
        : accepted <= 0 ||
          m.costPerAccepted === null ||
          Math.abs(m.costPerAccepted - spend / accepted) > 1e-10 * Math.max(1, spend / accepted)
    )
      fail('验收费用与结果状态不一致');
  });
const PublicStudyBaseSchema = z
  .object({
    format: z.literal('ranking-source-holdout-public-1'),
    id: hash,
    jobId: hash,
    selectionId: hash,
    studyId: z.string().uuid(),
    targetId: hash,
    scope: BoardScopeSchema,
    month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    kind: z.string().min(1).max(72).nullable(),
    dataVersion: hash,
    splitDigest: hash,
    preparedAt: z.string().datetime(),
    evaluatedAt: z.string().datetime(),
    sourceUpdatedAt: z.string().datetime().nullable(),
    state: z.enum(['complete', 'partial', 'insufficient_support']),
    models: z.array(model).max(128),
    inference: z.literal('retrospective-held-out-known-groups'),
    denominator: z.literal('ended_independent_root_targets'),
    supportUnit: z.literal('connected_owner_and_confirmed_source'),
    interval: z.literal('not_estimated'),
    note: z.string().min(1).max(2000),
  })
  .strict();
const validateStudy = (
  r: Omit<z.infer<typeof PublicStudyBaseSchema>, 'format'>,
  ctx: z.RefinementCtx,
) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (Date.parse(r.evaluatedAt) < Date.parse(r.preparedAt)) fail('评价不能早于准备');
  if (
    new Set(r.models.map((m) => m.id)).size !== r.models.length ||
    r.models.reduce((n, m) => n + m.cells.length, 0) > 8192
  )
    fail('报告模型重复或超过展开容量');
  const complete = r.models.length > 0 && r.models.every((m) => m.status !== 'incomplete'),
    partial = r.models.some((m) => m.status !== 'incomplete');
  if (r.state !== (complete ? 'complete' : partial ? 'partial' : 'insufficient_support'))
    fail('报告支持状态不一致');
  const shapes = r.models
    .filter((m) => m.status !== 'incomplete')
    .map((m) =>
      m.cells
        .map((c) => [c.conditionId, c.weight])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  if (shapes.some((s) => JSON.stringify(s) !== JSON.stringify(shapes[0])))
    fail('完整模型必须使用相同固定条件与权重');
};
const PublicStudyV1Schema = PublicStudyBaseSchema.superRefine(validateStudy);
const PublicStudyV2Schema = PublicStudyBaseSchema.extend({
  format: z.literal('ranking-source-holdout-public-2'),
  resampling: GroupResamplingSchema,
  sourceSensitivity: SourceSensitivitySchema.optional(),
  sourceBalance: SourceBalanceSchema.optional(),
  selectionStability: SelectionStabilitySchema.optional(),
}).superRefine((r, ctx) => {
  validateStudy(r, ctx);
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (r.selectionStability) {
    if (r.selectionStability.models.length !== r.models.length) fail('重选模型范围不一致');
    for (const m of r.selectionStability.models) {
      const base = r.models.find((b) => b.id === m.modelId);
      if (
        !base ||
        (base.status === 'incomplete' &&
          (m.reason !== 'base_incomplete' || m.state !== 'suppressed'))
      )
        fail('重选统计不能披露缺项模型');
      if (
        base &&
        m.state === 'measured' &&
        canonical(m.conditions.map((c) => c.conditionId).sort()) !==
          canonical(base.cells.map((c) => c.conditionId).sort())
      )
        fail('重选条件范围与冻结目标不一致');
    }
  }
  if (r.sourceBalance) {
    const values = r.sourceBalance.models;
    if (
      values.length !== r.models.length ||
      values.some((v) => !r.models.some((m) => m.id === v.modelId))
    )
      fail('来源等权模型范围不一致');
    for (const v of values) {
      const base = r.models.find((m) => m.id === v.modelId);
      if (!base) continue;
      if (base.status === 'incomplete') {
        if (
          v.state !== 'suppressed' ||
          v.reason !== 'base_incomplete' ||
          v.minGroupsPerCell !== null
        )
          fail('基础缺项不能披露来源等权');
        continue;
      }
      const min = Math.min(...base.cells.map((c) => c.groups));
      if (v.minGroupsPerCell !== min || v.reason === 'base_incomplete')
        fail('来源等权组数或范围不一致');
      if (
        min < sourceBalancePolicy.minGroupsPerCell &&
        (v.state !== 'suppressed' || v.reason !== 'few_groups')
      )
        fail('少组不公开来源等权');
      if (['measured', 'zero_acceptance_paid', 'undefined_zero_over_zero'].includes(v.state)) {
        const hasAcceptance = base.cells.some((c) => c.accepted > 0),
          hasSpend = base.cells.some((c) => c.spendMinor > 0);
        if (
          v.state !==
          (hasAcceptance
            ? 'measured'
            : hasSpend
              ? 'zero_acceptance_paid'
              : 'undefined_zero_over_zero')
        )
          fail('来源等权零值状态不一致');
        if (v.comparison && (v.comparison.direction === 'zero_baseline') !== !hasSpend)
          fail('来源等权零费用口径不一致');
      }
    }
  }
  if (
    r.resampling.models.length !== r.models.length ||
    r.resampling.models.some((m) => !r.models.some((base) => base.id === m.modelId))
  )
    fail('重采样模型范围与冻结评价不一致');
  for (const m of r.resampling.models) {
    const base = r.models.find((b) => b.id === m.modelId);
    if (!base) continue;
    if (base.status === 'incomplete') {
      if (
        m.state !== 'suppressed' ||
        m.reason !== 'base_incomplete' ||
        m.minGroupsPerCell !== null ||
        m.boundary !== 'unknown'
      )
        fail('不完整评价不能披露局部分布');
      continue;
    }
    const min = Math.min(...base.cells.map((c) => c.groups));
    const boundary = base.cells.every((c) => c.accepted === c.count)
      ? 'all_accepted'
      : base.cells.every((c) => c.accepted === 0)
        ? 'all_zero_acceptance'
        : 'mixed';
    if (m.minGroupsPerCell !== min || m.boundary !== boundary) fail('分组或边界诊断与点估计不一致');
    if (
      min < groupResamplingPolicy.minGroupsPerCell &&
      (m.state !== 'suppressed' || m.reason !== 'few_groups')
    )
      fail('来源组较少不公开分布数值');
    if (m.range && boundary !== 'mixed') fail('验收边界不能形成推断范围');
  }
  if (r.sourceSensitivity) {
    const values = r.sourceSensitivity.models;
    if (
      values.length !== r.models.length ||
      values.some((v) => !r.models.some((m) => m.id === v.modelId))
    )
      fail('来源敏感性模型范围不一致');
    for (const v of values) {
      const base = r.models.find((m) => m.id === v.modelId);
      if (!base) continue;
      if (base.status === 'incomplete') {
        if (
          v.state !== 'suppressed' ||
          v.reason !== 'base_incomplete' ||
          v.minGroupsPerCell !== null
        )
          fail('基础缺项不公开来源档位');
        continue;
      }
      const min = Math.min(...base.cells.map((c) => c.groups));
      if (v.minGroupsPerCell !== min) fail('来源档位组数与点估计不一致');
      if (
        min < sourceSensitivityPolicy.minGroupsPerCell &&
        (v.state !== 'suppressed' || v.reason !== 'few_groups')
      )
        fail('少组不公开来源档位');
      if (
        min === sourceSensitivityPolicy.minResidualGroupsPerCell &&
        (v.state !== 'suppressed' || v.reason !== 'residual_support')
      )
        fail('删组后不够支持不公开档位');
      if (v.state === 'measured' || v.state === 'zero_acceptance') {
        if ((base.status === 'zero_acceptance') !== (v.state === 'zero_acceptance'))
          fail('来源档位验收状态不一致');
        if (base.costPerAccepted === 0 && v.costInfluence !== 'zero_baseline')
          fail('零基准相对变化不适用');
        if (base.costPerAccepted !== 0 && v.costInfluence === 'zero_baseline')
          fail('正基准不能标零基准');
        if (
          (v.concentration!.spendBand === 'no_positive_total') !==
          base.cells.every((c) => c.spendMinor === 0)
        )
          fail('费用集中度分母不一致');
        if (
          (v.concentration!.acceptanceBand === 'no_positive_total') !==
          base.cells.every((c) => c.accepted === 0)
        )
          fail('验收集中度分母不一致');
      }
    }
  }
});
export const PublicRankingStudySchema = z.discriminatedUnion('format', [
  PublicStudyV1Schema,
  PublicStudyV2Schema,
]);
export type PublicRankingStudy = z.infer<typeof PublicRankingStudySchema>;
export type RankingStudyView = {
  status:
    'not_evaluated' | 'target_not_fixed' | 'snapshot_changed' | 'target_changed' | 'available';
  report: PublicRankingStudy | null;
  weightSensitivity?: TaskWeightSensitivity;
};
export type RankingStudyContext = {
  reports: PublicRankingStudy[];
  dataVersion: string;
  weightSensitivity?: ReadonlyMap<string, TaskWeightSensitivity>;
};
/** Exact target and fact revision only; old metrics never attach to current selections. */
export function rankingStudyView(
  target: RankingTarget | undefined,
  context?: RankingStudyContext,
): RankingStudyView {
  if (!target) return { status: 'target_not_fixed', report: null };
  const candidates = (context?.reports ?? []).filter(
    (r) =>
      r.targetId === target.id &&
      r.month === target.month &&
      r.kind === target.kind &&
      canonical(r.scope) === canonical(target.scope),
  );
  const report = candidates.find((r) => r.dataVersion === context?.dataVersion);
  if (report) {
    const weightSensitivity = context?.weightSensitivity?.get(report.id);
    return { status: 'available', report, ...(weightSensitivity ? { weightSensitivity } : {}) };
  }
  if (candidates.length) return { status: 'snapshot_changed', report: null };
  const related = context?.reports.some(
    (r) =>
      r.month === target.month &&
      r.kind === target.kind &&
      canonical(r.scope) === canonical(target.scope),
  );
  return { status: related ? 'target_changed' : 'not_evaluated', report: null };
}
export type InternalRankingStudy = ReturnType<typeof evaluateRankingSelection> & {
  target: RankingTarget;
  jobId: string;
  preparedAt: string;
  evaluatedAt: string;
  sourceUpdatedAt: string | null;
  resampling?: GroupResampling;
  sourceSensitivity?: InternalSourceSensitivity;
  sourceBalance?: InternalSourceBalance;
  selectionStability?: InternalSelectionStability;
};

/** Do not publish a selection subtotal when its held-out complement is suppressed. */
export function projectRankingStudy(report: InternalRankingStudy): PublicRankingStudy {
  if (
    (report.sourceSensitivity || report.sourceBalance || report.selectionStability) &&
    !report.resampling
  )
    throw new Error('来源敏感性报告需要配套的评价格式2。');
  for (const diagnostic of report.sourceBalance?.models ?? []) {
    if (
      !['measured', 'zero_acceptance_paid', 'undefined_zero_over_zero'].includes(diagnostic.state)
    )
      continue;
    const base = report.models.find((m) => m.id === diagnostic.modelId);
    if (!base || base.status === 'incomplete') throw new Error('来源等权与基础评价范围不一致。');
    for (const [actual, expected] of [
      [diagnostic.basePerRootSpend, base.perRootSpend],
      [diagnostic.baseAcceptedPerRoot, base.acceptedPerRoot],
      [diagnostic.baseCost, base.costPerAccepted],
    ]) {
      if (
        actual === null || expected === null
          ? actual !== expected
          : Math.abs(actual - expected) > 1e-10 * Math.max(1, expected)
      )
        throw new Error('来源等权与基础评价费用不一致。');
    }
  }
  for (const diagnostic of report.sourceSensitivity?.models ?? []) {
    if (diagnostic.state !== 'measured') continue;
    const base = report.models.find((m) => m.id === diagnostic.modelId)?.costPerAccepted;
    if (
      base === null ||
      base === undefined ||
      diagnostic.baseCost === null ||
      Math.abs(diagnostic.baseCost - base) > 1e-10 * Math.max(1, base)
    )
      throw new Error('来源敏感性与基础评价费用不一致。');
  }
  const models = report.models.map((m) => {
    const complete = m.status !== 'incomplete' && m.selectionCost !== null;
    return {
      id: m.id,
      identity: m.identity,
      primarySelection: m.primarySelection,
      status: complete ? m.status : ('incomplete' as const),
      selectionCost: complete ? m.selectionCost : null,
      perRootSpend: complete ? m.perRootSpend : null,
      acceptedPerRoot: complete ? m.acceptedPerRoot : null,
      costPerAccepted: complete ? m.costPerAccepted : null,
      cells: complete
        ? m.cells.map((c) => ({
            conditionId: c.conditionId,
            weight: c.weight,
            configuration: c.configuration!,
            count: c.count!,
            accepted: c.accepted!,
            spendMinor: c.spendMinor!,
            groups: c.groups!,
          }))
        : [],
    };
  });
  const state =
    models.length && models.every((m) => m.status !== 'incomplete')
      ? 'complete'
      : models.some((m) => m.status !== 'incomplete')
        ? 'partial'
        : 'insufficient_support';
  return PublicRankingStudySchema.parse({
    format: report.resampling
      ? 'ranking-source-holdout-public-2'
      : 'ranking-source-holdout-public-1',
    ...(report.resampling ? { resampling: report.resampling } : {}),
    ...(report.sourceSensitivity
      ? { sourceSensitivity: publicSourceSensitivity(report.sourceSensitivity) }
      : {}),
    ...(report.sourceBalance ? { sourceBalance: publicSourceBalance(report.sourceBalance) } : {}),
    ...(report.selectionStability
      ? { selectionStability: publicSelectionStability(report.selectionStability) }
      : {}),
    id: '0'.repeat(64),
    jobId: report.jobId,
    selectionId: report.selectionId,
    studyId: report.studyId,
    targetId: report.targetId,
    scope: report.target.scope,
    month: report.target.month,
    kind: report.target.kind,
    dataVersion: report.dataVersion,
    splitDigest: report.splitDigest,
    preparedAt: report.preparedAt,
    evaluatedAt: report.evaluatedAt,
    sourceUpdatedAt: report.sourceUpdatedAt,
    state,
    models,
    inference: report.inference,
    denominator: report.denominator,
    supportUnit: report.supportUnit,
    interval: report.interval,
    note: report.note,
  });
}
