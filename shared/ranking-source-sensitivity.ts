import { z } from 'zod';
import { sourceCostDistributionAllowed } from './source-support.js';
import {
  evaluateGroupDraw,
  validateResamplingInput,
  ResamplingCountsSchema,
  type GroupResamplingInput,
  type ResamplingModel,
  type GroupCounts,
  type GroupRange,
} from './ranking-resampling.js';

export const sourceSensitivityPolicy = {
  minGroupsPerCell: 20,
  minResidualGroupsPerCell: 20,
  maxOperations: 40000000,
  // Fraction units, not display rounding; consistent with report numerical validation.
  bandComparisonTolerance: 1e-10,
} as const;
const integer = z.number().int().safe().nonnegative(),
  amount = z.number().finite().nonnegative(),
  share = z.number().finite().min(0).max(1);
const endpoint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('finite'), value: amount }).strict(),
  z.object({ kind: z.literal('unbounded') }).strict(),
]);
const InternalSourceSensitivityModelSchema = z
  .object({
    modelId: z.string().min(1).max(1024),
    state: z.enum(['measured', 'zero_acceptance', 'suppressed', 'capacity']),
    reason: z.enum([
      'complete',
      'base_incomplete',
      'few_groups',
      'distribution_support',
      'residual_support',
      'work_budget',
    ]),
    minGroupsPerCell: integer.nullable(),
    observedGroups: integer.max(20000).nullable(),
    baseCost: amount.nullable(),
    counts: ResamplingCountsSchema.nullable(),
    costRange: z.object({ lower: endpoint, upper: endpoint }).strict().nullable(),
    maxAbsoluteChange: amount.nullable(),
    maxRelativeChange: amount.nullable(),
    concentration: z
      .object({
        maxConditionTaskShare: share.max(0.35),
        maxConditionSpendShare: share.nullable(),
        maxConditionAcceptanceShare: share.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (m.reason === 'base_incomplete') {
      if (m.state !== 'suppressed' || m.minGroupsPerCell !== null) fail('基础缺项必须隐藏');
    } else if (m.minGroupsPerCell === null || m.minGroupsPerCell < 1) fail('完整基础需要组数');
    if ((m.state === 'capacity') !== (m.reason === 'work_budget')) fail('容量原因不一致');
    if (
      m.reason === 'few_groups' &&
      (m.minGroupsPerCell === null ||
        m.minGroupsPerCell >= sourceSensitivityPolicy.minGroupsPerCell)
    )
      fail('少组状态不一致');
    if (m.reason === 'residual_support' && m.state !== 'suppressed') fail('剩余支持不足必须隐藏');
    if (m.state === 'suppressed' || m.state === 'capacity') {
      if (
        m.state === 'suppressed' &&
        !['base_incomplete', 'few_groups', 'distribution_support', 'residual_support'].includes(
          m.reason,
        )
      )
        fail('隐藏原因不一致');
      if (
        [
          m.observedGroups,
          m.baseCost,
          m.counts,
          m.costRange,
          m.maxAbsoluteChange,
          m.maxRelativeChange,
          m.concentration,
        ].some((v) => v !== null)
      )
        fail('未获完整支持不公开数值前缀');
      return;
    }
    if (
      m.reason !== 'complete' ||
      m.minGroupsPerCell! <= sourceSensitivityPolicy.minResidualGroupsPerCell ||
      m.observedGroups === null ||
      m.observedGroups < m.minGroupsPerCell! ||
      !m.counts ||
      Object.values(m.counts).reduce((a, b) => a + b, 0) !== m.observedGroups ||
      !m.concentration
    )
      fail('删除范围与完整支持不一致');
    if (m.state === 'zero_acceptance') {
      if (
        m.baseCost !== null ||
        m.costRange !== null ||
        m.maxAbsoluteChange !== null ||
        m.maxRelativeChange !== null ||
        m.counts?.finite ||
        m.concentration?.maxConditionAcceptanceShare !== null
      )
        fail('零验收不产生有限比较');
      return;
    }
    if (m.baseCost === null || !m.costRange || !m.counts) {
      fail('敏感性范围需要完整基础费用');
      return;
    }
    const lo = m.costRange.lower,
      hi = m.costRange.upper,
      unknown = m.counts.missingCondition + m.counts.undefinedZeroOverZero;
    if ((hi.kind === 'unbounded') !== (m.counts.finite !== m.observedGroups))
      fail('上界必须保留全部无界与未知删除');
    if ((lo.kind === 'finite') !== unknown + m.counts.finite > 0) fail('下界必须保留无界删除');
    if (unknown && (lo.kind !== 'finite' || lo.value !== 0)) fail('未知删除下界为0');
    if (lo.kind === 'finite' && hi.kind === 'finite') {
      if (lo.value > hi.value) fail('范围次序错误');
      const change = Math.max(Math.abs(lo.value - m.baseCost), Math.abs(hi.value - m.baseCost));
      if (
        m.maxAbsoluteChange === null ||
        Math.abs(change - m.maxAbsoluteChange) > 1e-10 * Math.max(1, change)
      )
        fail('绝对变化与范围不一致');
      if (
        m.baseCost === 0
          ? m.maxRelativeChange !== null
          : m.maxRelativeChange === null ||
            Math.abs(m.maxRelativeChange - change / m.baseCost) >
              1e-10 * Math.max(1, change / m.baseCost)
      )
        fail('相对变化与基础费用不一致');
    } else if (m.maxAbsoluteChange !== null || m.maxRelativeChange !== null)
      fail('无界或未知范围没有有限最大变化');
  });
export const InternalSourceSensitivitySchema = z
  .object({
    version: z.literal('source-sensitivity-internal-1'),
    method: z.literal('leave_one_known_group_out_fixed_policy'),
    unit: z.literal('connected_owner_and_confirmed_source'),
    interpretation: z.literal('descriptive_influence_not_confidence_or_selection_stability'),
    rangeDefinition: z.literal('all_own_group_deletions_min_max_unknowns_zero_to_unbounded'),
    modelScope: z.literal('groups_with_observations_for_this_model'),
    models: z.array(InternalSourceSensitivityModelSchema).max(128),
  })
  .strict()
  .refine((r) => new Set(r.models.map((m) => m.modelId)).size === r.models.length);
export type InternalSourceSensitivity = z.infer<typeof InternalSourceSensitivitySchema>;
const metadata = {
  version: 'source-sensitivity-internal-1',
  method: 'leave_one_known_group_out_fixed_policy',
  unit: 'connected_owner_and_confirmed_source',
  interpretation: 'descriptive_influence_not_confidence_or_selection_stability',
  rangeDefinition: 'all_own_group_deletions_min_max_unknowns_zero_to_unbounded',
  modelScope: 'groups_with_observations_for_this_model',
} as const;
type ModelMeta = { id: string; complete: boolean; minGroups: number | null };
export function unavailableSourceSensitivity(models: ModelMeta[]): InternalSourceSensitivity {
  return InternalSourceSensitivitySchema.parse({
    ...metadata,
    models: models.map((m) =>
      hidden(
        m,
        !m.complete
          ? 'base_incomplete'
          : m.minGroups! < sourceSensitivityPolicy.minGroupsPerCell
            ? 'few_groups'
            : m.minGroups === sourceSensitivityPolicy.minResidualGroupsPerCell
              ? 'residual_support'
              : 'work_budget',
      ),
    ),
  });
}
function hidden(
  m: ModelMeta,
  reason:
    'base_incomplete' | 'few_groups' | 'distribution_support' | 'residual_support' | 'work_budget',
) {
  return {
    modelId: m.id,
    state: reason === 'work_budget' ? ('capacity' as const) : ('suppressed' as const),
    reason,
    minGroupsPerCell: m.minGroups,
    observedGroups: null,
    baseCost: null,
    counts: null,
    costRange: null,
    maxAbsoluteChange: null,
    maxRelativeChange: null,
    concentration: null,
  };
}
type Top = { id: string; n: number };
type Support = { n: number; groups: number; first: Top; second: Top };
const support = (): Support => ({
  n: 0,
  groups: 0,
  first: { id: '', n: 0 },
  second: { id: '', n: 0 },
});
function add(s: Support, id: string, n: number) {
  s.n += n;
  s.groups++;
  if (n > s.first.n) {
    s.second = s.first;
    s.first = { id, n };
  } else if (n > s.second.n) s.second = { id, n };
}
function remains(
  s: Support,
  id: string,
  n: number,
  included: boolean,
  minimum: number,
  allowEmpty = true,
) {
  const groups = s.groups - (included ? 1 : 0),
    count = s.n - (included ? n : 0),
    largest = s.first.id === id ? s.second.n : s.first.n;
  return (
    (allowEmpty && groups === 0) ||
    (groups >= minimum && sourceCostDistributionAllowed(count, groups, largest))
  );
}
/** Full per-model own-group deletion; source identifiers never leave this function. */
export function sourceSensitivity(input: GroupResamplingInput): InternalSourceSensitivity {
  const { entries } = validateResamplingInput(input),
    { models, groups, slots } = input;
  const metas = models.map((m) => ({
    id: m.id,
    complete: m.complete,
    minGroups: m.cells.length ? Math.min(...m.cells.map((c) => c.groups)) : null,
  }));
  const slotOwner = new Map<number, number>();
  models.forEach((m, index) => m.cells.forEach((c) => slotOwner.set(c.slot, index)));
  const own = models.map(() => new Map<string, (typeof groups)[number]['cells']>()),
    full = Array.from({ length: slots }, support),
    positive = Array.from({ length: slots }, support),
    notFull = Array.from({ length: slots }, support);
  const maxCost = new Float64Array(slots),
    maxAccepted = new Float64Array(slots);
  for (const g of groups)
    for (const c of g.cells) {
      const map = own[slotOwner.get(c.slot)!];
      if (!map.has(g.id)) map.set(g.id, []);
      map.get(g.id)!.push(c);
      add(full[c.slot], g.id, c.count);
      if (c.accepted > 0) add(positive[c.slot], g.id, c.count);
      if (c.accepted < c.count) add(notFull[c.slot], g.id, c.count);
      maxCost[c.slot] = Math.max(maxCost[c.slot], c.spendMinor);
      maxAccepted[c.slot] = Math.max(maxAccepted[c.slot], c.accepted);
    }
  const estimate =
    9 * entries +
    slots * 3 +
    models.reduce((sum, m, i) => sum + own[i].size * m.cells.length * 4 + own[i].size, 0);
  if (estimate > sourceSensitivityPolicy.maxOperations) return unavailableSourceSensitivity(metas);
  const n = new Float64Array(slots),
    a = new Float64Array(slots),
    c = new Float64Array(slots);
  models.forEach((m) =>
    m.cells.forEach((v) => {
      n[v.slot] = v.count;
      a[v.slot] = v.accepted;
      c[v.slot] = v.spendMinor;
    }),
  );
  const bySlot = new Map(models.flatMap((m) => m.cells.map((c) => [c.slot, c] as const)));
  let operations = slots * 3 + 5 * entries;
  const tick = (amount: number) => {
    operations += amount;
    if (operations > sourceSensitivityPolicy.maxOperations)
      throw Object.assign(new Error('来源敏感性超过工作预算，未发布前缀。'), {
        code: 'ranking_sensitivity_capacity',
      });
  };
  const results = [];
  try {
    for (let index = 0; index < models.length; index++) {
      const m = models[index],
        meta = metas[index];
      if (!m.complete) {
        results.push(hidden(meta, 'base_incomplete'));
        continue;
      }
      if (meta.minGroups! < sourceSensitivityPolicy.minGroupsPerCell) {
        results.push(hidden(meta, 'few_groups'));
        continue;
      }
      if (meta.minGroups === sourceSensitivityPolicy.minResidualGroupsPerCell) {
        results.push(hidden(meta, 'residual_support'));
        continue;
      }
      if (
        m.cells.some(
          (v) =>
            !v.distributionAllowed ||
            !sourceCostDistributionAllowed(v.count, v.groups, full[v.slot].first.n),
        )
      ) {
        results.push(hidden(meta, 'distribution_support'));
        continue;
      }
      const base = evaluateGroupDraw(m, n, a, c),
        counts: GroupCounts = {
          finite: 0,
          zeroAcceptancePaid: 0,
          undefinedZeroOverZero: 0,
          missingCondition: 0,
        };
      let least = Infinity,
        most = -Infinity,
        failedSupport = false;
      for (const [id, values] of own[index]) {
        tick(values.length * 4 + m.cells.length * 4 + 1);
        for (const v of values) {
          const original = bySlot.get(v.slot)!;
          n[v.slot] = original.count - v.count;
          a[v.slot] = original.accepted - v.accepted;
          c[v.slot] = original.spendMinor - v.spendMinor;
          if (
            !remains(
              full[v.slot],
              id,
              v.count,
              true,
              sourceSensitivityPolicy.minResidualGroupsPerCell,
              false,
            ) ||
            !remains(positive[v.slot], id, v.count, v.accepted > 0, 5) ||
            !remains(notFull[v.slot], id, v.count, v.accepted < v.count, 5)
          )
            failedSupport = true;
        }
        const draw = evaluateGroupDraw(m, n, a, c);
        counts[draw.kind]++;
        if (draw.kind === 'finite') {
          least = Math.min(least, draw.value);
          most = Math.max(most, draw.value);
        }
        for (const v of values) {
          const original = bySlot.get(v.slot)!;
          n[v.slot] = original.count;
          a[v.slot] = original.accepted;
          c[v.slot] = original.spendMinor;
        }
      }
      if (failedSupport) {
        results.push(hidden(meta, 'residual_support'));
        continue;
      }
      const peak = (
        denominator: (cell: ResamplingModel['cells'][number]) => number,
        numerator: (slot: number) => number,
      ) => {
        let value: number | null = null;
        for (const cell of m.cells) {
          const total = denominator(cell);
          if (total > 0) value = Math.max(value ?? 0, numerator(cell.slot) / total);
        }
        return value;
      };
      const concentration = {
        maxConditionTaskShare: peak(
          (v) => v.count,
          (slot) => full[slot].first.n,
        )!,
        maxConditionSpendShare: peak(
          (v) => v.spendMinor,
          (slot) => maxCost[slot],
        ),
        maxConditionAcceptanceShare: peak(
          (v) => v.accepted,
          (slot) => maxAccepted[slot],
        ),
      };
      const common = {
        modelId: m.id,
        reason: 'complete' as const,
        minGroupsPerCell: meta.minGroups,
        observedGroups: own[index].size,
        counts,
        concentration,
      };
      if (base.kind !== 'finite') {
        results.push({
          ...common,
          state: 'zero_acceptance' as const,
          baseCost: null,
          costRange: null,
          maxAbsoluteChange: null,
          maxRelativeChange: null,
        });
        continue;
      }
      const unknown = counts.missingCondition + counts.undefinedZeroOverZero;
      const range: GroupRange = {
        lower: unknown
          ? { kind: 'finite', value: 0 }
          : counts.finite
            ? { kind: 'finite', value: least }
            : { kind: 'unbounded' },
        upper:
          counts.finite === own[index].size
            ? { kind: 'finite', value: most }
            : { kind: 'unbounded' },
      };
      const absolute =
        range.lower.kind === 'finite' && range.upper.kind === 'finite'
          ? Math.max(
              Math.abs(range.lower.value - base.value),
              Math.abs(range.upper.value - base.value),
            )
          : null;
      const relative = absolute !== null && base.value > 0 ? absolute / base.value : null;
      results.push({
        ...common,
        state: 'measured' as const,
        baseCost: base.value,
        costRange: range,
        maxAbsoluteChange: absolute,
        maxRelativeChange: relative,
      });
    }
  } catch (error) {
    if ((error as { code?: string }).code !== 'ranking_sensitivity_capacity') throw error;
    return unavailableSourceSensitivity(metas);
  }
  return InternalSourceSensitivitySchema.parse({ ...metadata, models: results });
}

const costInfluence = z.enum([
  'up_to_5pct',
  '5_to_20pct',
  '20_to_50pct',
  'over_50pct',
  'unknown',
  'unbounded',
  'zero_baseline',
  'zero_acceptance',
]);
const broadShare = z.enum([
  'up_to_10pct',
  '10_to_25pct',
  '25_to_50pct',
  '50_to_75pct',
  'over_75pct',
  'no_positive_total',
]);
const publicModel = z
  .object({
    modelId: z.string().min(1).max(1024),
    state: z.enum(['measured', 'zero_acceptance', 'suppressed', 'capacity']),
    reason: z.enum([
      'complete',
      'base_incomplete',
      'few_groups',
      'distribution_support',
      'residual_support',
      'work_budget',
    ]),
    minGroupsPerCell: integer.nullable(),
    costInfluence: costInfluence.nullable(),
    concentration: z
      .object({
        taskBand: z.enum(['up_to_10pct', '10_to_20pct', '20_to_35pct']),
        spendBand: broadShare,
        acceptanceBand: broadShare,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      m.reason === 'base_incomplete'
        ? m.state !== 'suppressed' || m.minGroupsPerCell !== null
        : m.minGroupsPerCell === null || m.minGroupsPerCell < 1
    )
      fail('基础支持状态不一致');
    if ((m.state === 'capacity') !== (m.reason === 'work_budget')) fail('容量状态不一致');
    if (m.state === 'suppressed' || m.state === 'capacity') {
      if (m.costInfluence !== null || m.concentration !== null) fail('支持不足或超预算不公开档位');
      if (
        m.state === 'suppressed' &&
        !['base_incomplete', 'few_groups', 'distribution_support', 'residual_support'].includes(
          m.reason,
        )
      )
        fail('隐藏原因无效');
      if (
        m.reason === 'few_groups' &&
        m.minGroupsPerCell! >= sourceSensitivityPolicy.minGroupsPerCell
      )
        fail('少组原因不一致');
    } else {
      if (
        m.reason !== 'complete' ||
        m.minGroupsPerCell! <= sourceSensitivityPolicy.minResidualGroupsPerCell ||
        m.costInfluence === null ||
        !m.concentration
      )
        fail('公开档位需要全部删除获得支持');
      if ((m.state === 'zero_acceptance') !== (m.costInfluence === 'zero_acceptance'))
        fail('零验收档位不一致');
      if (m.state === 'zero_acceptance' && m.concentration?.acceptanceBand !== 'no_positive_total')
        fail('零验收没有正验收占比');
    }
  });
export const SourceSensitivitySchema = z
  .object({
    version: z.literal('source-sensitivity-1'),
    method: z.literal('leave_one_known_group_out_fixed_policy'),
    unit: z.literal('connected_owner_and_confirmed_source'),
    interpretation: z.literal('descriptive_influence_not_confidence_or_selection_stability'),
    precision: z.literal('predeclared_bands_no_exact_extrema_counts_or_peak_shares'),
    modelScope: z.literal('groups_with_observations_for_this_model'),
    models: z.array(publicModel).max(128),
  })
  .strict()
  .refine((r) => new Set(r.models.map((m) => m.modelId)).size === r.models.length);
export type SourceSensitivity = z.infer<typeof SourceSensitivitySchema>;
const bandShare = (v: number | null) =>
  v === null
    ? ('no_positive_total' as const)
    : v <= 0.1
      ? ('up_to_10pct' as const)
      : v <= 0.25
        ? ('10_to_25pct' as const)
        : v <= 0.5
          ? ('25_to_50pct' as const)
          : v <= 0.75
            ? ('50_to_75pct' as const)
            : ('over_75pct' as const);
const atMostInfluence = (value: number, boundary: number) =>
  value <= boundary + sourceSensitivityPolicy.bandComparisonTolerance;
/** Explicit allowlist, never spread a private exact diagnostic into public output. */
export function publicSourceSensitivity(raw: InternalSourceSensitivity): SourceSensitivity {
  const parsed = InternalSourceSensitivitySchema.parse(raw);
  return SourceSensitivitySchema.parse({
    version: 'source-sensitivity-1',
    method: metadata.method,
    unit: metadata.unit,
    interpretation: metadata.interpretation,
    precision: 'predeclared_bands_no_exact_extrema_counts_or_peak_shares',
    modelScope: metadata.modelScope,
    models: parsed.models.map((m) => ({
      modelId: m.modelId,
      state: m.state,
      reason: m.reason,
      minGroupsPerCell: m.minGroupsPerCell,
      costInfluence:
        m.state === 'suppressed' || m.state === 'capacity'
          ? null
          : m.state === 'zero_acceptance'
            ? 'zero_acceptance'
            : m.counts!.missingCondition + m.counts!.undefinedZeroOverZero > 0
              ? 'unknown'
              : m.counts!.zeroAcceptancePaid > 0
                ? 'unbounded'
                : m.baseCost === 0
                  ? 'zero_baseline'
                  : atMostInfluence(m.maxRelativeChange!, 0.05)
                    ? 'up_to_5pct'
                    : atMostInfluence(m.maxRelativeChange!, 0.2)
                      ? '5_to_20pct'
                      : atMostInfluence(m.maxRelativeChange!, 0.5)
                        ? '20_to_50pct'
                        : 'over_50pct',
      concentration: m.concentration
        ? {
            taskBand:
              m.concentration.maxConditionTaskShare <= 0.1
                ? 'up_to_10pct'
                : m.concentration.maxConditionTaskShare <= 0.2
                  ? '10_to_20pct'
                  : '20_to_35pct',
            spendBand: bandShare(m.concentration.maxConditionSpendShare),
            acceptanceBand: bandShare(m.concentration.maxConditionAcceptanceShare),
          }
        : null,
    })),
  });
}
