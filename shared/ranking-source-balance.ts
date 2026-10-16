import { z } from 'zod';
import { sourceCostDistributionAllowed } from './source-support.js';
import { validateResamplingInput, type GroupResamplingInput } from './ranking-resampling.js';

export const sourceBalancePolicy = {
  version: 'source-balance-1',
  minGroupsPerCell: 20,
  maxOperations: 1000000,
  bandComparisonTolerance: 1e-10,
} as const;
const amount = z.number().finite().nonnegative();
const meta = {
  modelId: z.string().min(1).max(1024),
  state: z.enum([
    'measured',
    'zero_acceptance_paid',
    'undefined_zero_over_zero',
    'suppressed',
    'capacity',
    'numeric_unavailable',
  ]),
  reason: z.enum([
    'complete',
    'base_incomplete',
    'few_groups',
    'distribution_support',
    'work_budget',
    'numeric_range',
  ]),
  minGroupsPerCell: z.number().int().safe().min(1).nullable(),
};
type ModelMeta = { id: string; complete: boolean; minGroups: number | null };
type Status = {
  modelId: string;
  state: z.infer<typeof meta.state>;
  reason: z.infer<typeof meta.reason>;
  minGroupsPerCell: number | null;
};
const available = (state: Status['state']) =>
  ['measured', 'zero_acceptance_paid', 'undefined_zero_over_zero'].includes(state);
function validateStatus(m: Status, ctx: z.RefinementCtx) {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (m.reason === 'base_incomplete') {
    if (m.state !== 'suppressed' || m.minGroupsPerCell !== null) fail('基础缺项必须隐藏');
  } else if (m.minGroupsPerCell === null) fail('完整基础需要来源组数');
  if ((m.state === 'capacity') !== (m.reason === 'work_budget')) fail('容量状态不一致');
  if ((m.state === 'numeric_unavailable') !== (m.reason === 'numeric_range'))
    fail('数值状态不一致');
  if (available(m.state) !== (m.reason === 'complete')) fail('已计算状态不一致');
  if (
    m.reason === 'few_groups' &&
    (m.state !== 'suppressed' ||
      m.minGroupsPerCell === null ||
      m.minGroupsPerCell >= sourceBalancePolicy.minGroupsPerCell)
  )
    fail('少组状态不一致');
  if (m.reason === 'distribution_support' && m.state !== 'suppressed') fail('发布支持不足必须隐藏');
  if (
    !['base_incomplete', 'few_groups'].includes(m.reason) &&
    (m.minGroupsPerCell === null || m.minGroupsPerCell < sourceBalancePolicy.minGroupsPerCell)
  )
    fail('来源等权需要足够组数');
}
const internalModel = z
  .object({
    ...meta,
    basePerRootSpend: amount.nullable(),
    baseAcceptedPerRoot: z.number().min(0).max(1).nullable(),
    baseCost: amount.nullable(),
    balancedPerRootSpend: amount.nullable(),
    balancedAcceptedPerRoot: z.number().min(0).max(1).nullable(),
    balancedCost: amount.nullable(),
    absoluteChange: amount.nullable(),
    relativeChange: amount.nullable(),
  })
  .strict()
  .superRefine((m, ctx) => {
    validateStatus(m, ctx);
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const values = [
      m.basePerRootSpend,
      m.baseAcceptedPerRoot,
      m.baseCost,
      m.balancedPerRootSpend,
      m.balancedAcceptedPerRoot,
      m.balancedCost,
      m.absoluteChange,
      m.relativeChange,
    ];
    if (!available(m.state)) {
      if (values.some((v) => v !== null)) fail('不可用分析不能保留数值前缀');
      return;
    }
    const close = (a: number, b: number) =>
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b));
    if (
      m.basePerRootSpend === null ||
      m.balancedPerRootSpend === null ||
      m.baseAcceptedPerRoot === null ||
      m.balancedAcceptedPerRoot === null
    ) {
      fail('完整分析缺少分子或分母');
      return;
    }
    if (
      (m.basePerRootSpend === 0) !== (m.balancedPerRootSpend === 0) ||
      (m.baseAcceptedPerRoot === 0) !== (m.balancedAcceptedPerRoot === 0)
    )
      fail('正权重不能改变是否有支出或验收');
    if (m.state !== 'measured') {
      if (
        m.baseAcceptedPerRoot !== 0 ||
        m.balancedAcceptedPerRoot !== 0 ||
        [m.baseCost, m.balancedCost, m.absoluteChange, m.relativeChange].some((v) => v !== null) ||
        (m.state === 'undefined_zero_over_zero') !== (m.basePerRootSpend === 0)
      )
        fail('零分母分类或数值不一致');
      return;
    }
    if (
      m.baseAcceptedPerRoot <= 0 ||
      m.balancedAcceptedPerRoot <= 0 ||
      m.baseCost === null ||
      m.balancedCost === null ||
      m.absoluteChange === null
    ) {
      fail('有限分析需要正验收与完整费用');
      return;
    }
    if (
      !close(m.baseCost, m.basePerRootSpend / m.baseAcceptedPerRoot) ||
      !close(m.balancedCost, m.balancedPerRootSpend / m.balancedAcceptedPerRoot) ||
      !close(m.absoluteChange, Math.abs(m.balancedCost - m.baseCost))
    )
      fail('来源等权费用关系错误');
    if (
      m.baseCost === 0
        ? m.relativeChange !== null || m.balancedCost !== 0
        : m.relativeChange === null || !close(m.relativeChange, m.absoluteChange / m.baseCost)
    )
      fail('来源等权相对变化错误');
  });
const metadata = {
  method: 'equal_known_groups_within_condition_fixed_policy',
  unit: 'connected_owner_and_confirmed_source',
  interpretation: 'descriptive_reweighting_not_population_correction',
} as const;
const metadataSchema = {
  method: z.literal(metadata.method),
  unit: z.literal(metadata.unit),
  interpretation: z.literal(metadata.interpretation),
};
export const InternalSourceBalanceSchema = z
  .object({
    version: z.literal('source-balance-internal-1'),
    ...metadataSchema,
    models: z.array(internalModel).max(128),
  })
  .strict()
  .refine((r) => new Set(r.models.map((m) => m.modelId)).size === r.models.length);
export type InternalSourceBalance = z.infer<typeof InternalSourceBalanceSchema>;
const comparison = z
  .object({
    direction: z.enum(['lower', 'higher', 'within_5pct', 'zero_baseline']),
    magnitude: z.enum(['up_to_5pct', '5_to_20pct', '20_to_50pct', 'over_50pct', 'not_applicable']),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.direction === 'zero_baseline') !== (v.magnitude === 'not_applicable') ||
      (v.direction === 'within_5pct') !== (v.magnitude === 'up_to_5pct')
    )
      ctx.addIssue({ code: 'custom', message: '方向和幅度档位不一致' });
  });
const publicModel = z
  .object({ ...meta, comparison: comparison.nullable() })
  .strict()
  .superRefine((m, ctx) => {
    validateStatus(m, ctx);
    if ((m.state === 'measured') !== (m.comparison !== null))
      ctx.addIssue({ code: 'custom', message: '只有有限费用能比较档位' });
  });
export const SourceBalanceSchema = z
  .object({
    version: z.literal('source-balance-1'),
    ...metadataSchema,
    disclosure: z.literal('fixed_change_bands_only'),
    models: z.array(publicModel).max(128),
  })
  .strict()
  .refine((r) => new Set(r.models.map((m) => m.modelId)).size === r.models.length);
export type SourceBalance = z.infer<typeof SourceBalanceSchema>;

function hidden(
  m: ModelMeta,
  reason: Exclude<Status['reason'], 'complete'>,
): InternalSourceBalance['models'][number] {
  return {
    modelId: m.id,
    state:
      reason === 'work_budget'
        ? 'capacity'
        : reason === 'numeric_range'
          ? 'numeric_unavailable'
          : 'suppressed',
    reason,
    minGroupsPerCell: m.minGroups,
    basePerRootSpend: null,
    baseAcceptedPerRoot: null,
    baseCost: null,
    balancedPerRootSpend: null,
    balancedAcceptedPerRoot: null,
    balancedCost: null,
    absoluteChange: null,
    relativeChange: null,
  };
}
export function unavailableSourceBalance(
  models: ModelMeta[],
  reason: 'work_budget' | 'numeric_range' = 'work_budget',
): InternalSourceBalance {
  return InternalSourceBalanceSchema.parse({
    version: 'source-balance-internal-1',
    ...metadata,
    models: models.map((m) =>
      hidden(
        m,
        !m.complete
          ? 'base_incomplete'
          : m.minGroups! < sourceBalancePolicy.minGroupsPerCell
            ? 'few_groups'
            : reason,
      ),
    ),
  });
}
class SourceBalanceNumericalError extends Error {}
class Sum {
  value = 0;
  correction = 0;
  add(v: number) {
    if (!Number.isFinite(v) || v < 0) throw new SourceBalanceNumericalError('来源等权数值范围错误');
    const next = this.value + v;
    this.correction += this.value >= v ? this.value - next + v : v - next + this.value;
    this.value = next;
  }
  get() {
    const v = this.value + this.correction;
    if (!Number.isFinite(v)) throw new SourceBalanceNumericalError('来源等权合计超出范围');
    return v;
  }
}
const product = (a: number, b: number) => {
  const v = a * b;
  if (!Number.isFinite(v) || (a > 0 && b > 0 && v === 0))
    throw new SourceBalanceNumericalError('来源等权正项下溢或溢出');
  return v;
};
const divide = (a: number, b: number) => {
  const v = a / b;
  if (!Number.isFinite(v) || (a > 0 && v === 0))
    throw new SourceBalanceNumericalError('来源等权比值下溢或溢出');
  return v;
};

/** One existing numeric matrix; no query, text inspection, re-selection or random draws. */
export function sourceBalance(input: GroupResamplingInput): InternalSourceBalance {
  const { entries } = validateResamplingInput(input);
  const metas = input.models.map((m) => ({
    id: m.id,
    complete: m.complete,
    minGroups: m.complete ? Math.min(...m.cells.map((c) => c.groups)) : null,
  }));
  // Includes validation, accumulation and cell projection. Budget failure is all-or-none.
  if (entries * 5 + input.slots * 10 + input.models.length > sourceBalancePolicy.maxOperations)
    return unavailableSourceBalance(metas);
  try {
    const sums = Array.from({ length: input.slots }, () => ({
      c: new Sum(),
      a: new Sum(),
      largest: 0,
      positive: { n: 0, k: 0, largest: 0 },
      notFull: { n: 0, k: 0, largest: 0 },
    }));
    for (const group of input.groups)
      for (const c of group.cells) {
        const s = sums[c.slot];
        s.c.add(divide(c.spendMinor, c.count));
        s.a.add(divide(c.accepted, c.count));
        s.largest = Math.max(s.largest, c.count);
        for (const [include, bucket] of [
          [c.accepted > 0, s.positive],
          [c.accepted < c.count, s.notFull],
        ] as const) {
          if (include) {
            bucket.n += c.count;
            bucket.k++;
            bucket.largest = Math.max(bucket.largest, c.count);
          }
        }
      }
    const models = input.models.map((m, i): InternalSourceBalance['models'][number] => {
      const info = metas[i];
      if (!m.complete) return hidden(info, 'base_incomplete');
      if (info.minGroups! < sourceBalancePolicy.minGroupsPerCell) return hidden(info, 'few_groups');
      if (
        m.cells.some((c) => {
          const s = sums[c.slot];
          return (
            !c.distributionAllowed ||
            !sourceCostDistributionAllowed(c.count, c.groups, s.largest) ||
            [s.positive, s.notFull].some(
              (b) => b.k > 0 && !sourceCostDistributionAllowed(b.n, b.k, b.largest),
            )
          );
        })
      )
        return hidden(info, 'distribution_support');
      const n = new Sum(),
        a = new Sum(),
        c = new Sum(),
        ba = new Sum(),
        bc = new Sum();
      for (const cell of m.cells) {
        const s = sums[cell.slot];
        n.add(cell.weight);
        c.add(product(cell.weight, divide(cell.spendMinor, cell.count)));
        a.add(product(cell.weight, divide(cell.accepted, cell.count)));
        bc.add(product(cell.weight, divide(s.c.get(), cell.groups)));
        ba.add(product(cell.weight, divide(s.a.get(), cell.groups)));
      }
      const basePerRootSpend = divide(c.get(), n.get()),
        baseAcceptedPerRoot = divide(a.get(), n.get()),
        balancedPerRootSpend = divide(bc.get(), n.get()),
        balancedAcceptedPerRoot = divide(ba.get(), n.get());
      if (baseAcceptedPerRoot > 1 || balancedAcceptedPerRoot > 1)
        throw new SourceBalanceNumericalError('来源等权验收比例超出范围');
      const hasAcceptance = m.cells.some((c) => c.accepted > 0),
        hasSpend = m.cells.some((c) => c.spendMinor > 0);
      if (
        hasAcceptance !== (baseAcceptedPerRoot > 0 && balancedAcceptedPerRoot > 0) ||
        hasSpend !== (basePerRootSpend > 0 && balancedPerRootSpend > 0)
      )
        throw new SourceBalanceNumericalError('来源等权丢失正项');
      const baseCost = hasAcceptance ? divide(basePerRootSpend, baseAcceptedPerRoot) : null,
        balancedCost = hasAcceptance ? divide(balancedPerRootSpend, balancedAcceptedPerRoot) : null,
        absoluteChange = baseCost === null ? null : Math.abs(balancedCost! - baseCost),
        relativeChange =
          baseCost !== null && baseCost > 0 ? divide(absoluteChange!, baseCost) : null;
      return {
        modelId: m.id,
        state: hasAcceptance
          ? 'measured'
          : hasSpend
            ? 'zero_acceptance_paid'
            : 'undefined_zero_over_zero',
        reason: 'complete',
        minGroupsPerCell: info.minGroups,
        basePerRootSpend,
        baseAcceptedPerRoot,
        baseCost,
        balancedPerRootSpend,
        balancedAcceptedPerRoot,
        balancedCost,
        absoluteChange,
        relativeChange,
      };
    });
    return InternalSourceBalanceSchema.parse({
      version: 'source-balance-internal-1',
      ...metadata,
      models,
    });
  } catch (error) {
    if (!(error instanceof SourceBalanceNumericalError)) throw error;
    return unavailableSourceBalance(metas, 'numeric_range');
  }
}

/** Do not disclose exact balanced costs: paired with public totals they can reveal one group. */
export function publicSourceBalance(raw: InternalSourceBalance): SourceBalance {
  const result = InternalSourceBalanceSchema.parse(raw);
  return SourceBalanceSchema.parse({
    version: sourceBalancePolicy.version,
    ...metadata,
    disclosure: 'fixed_change_bands_only',
    models: result.models.map((m) => {
      let comparison: SourceBalance['models'][number]['comparison'] = null;
      if (m.state === 'measured') {
        const x = m.relativeChange;
        if (m.baseCost === 0)
          comparison = { direction: 'zero_baseline', magnitude: 'not_applicable' };
        else if (x! <= 0.05 + sourceBalancePolicy.bandComparisonTolerance)
          comparison = { direction: 'within_5pct', magnitude: 'up_to_5pct' };
        else
          comparison = {
            direction: m.balancedCost! > m.baseCost! ? 'higher' : 'lower',
            magnitude:
              x! <= 0.2 + sourceBalancePolicy.bandComparisonTolerance
                ? '5_to_20pct'
                : x! <= 0.5 + sourceBalancePolicy.bandComparisonTolerance
                  ? '20_to_50pct'
                  : 'over_50pct',
          };
      }
      return {
        modelId: m.modelId,
        state: m.state,
        reason: m.reason,
        minGroupsPerCell: m.minGroupsPerCell,
        comparison,
      };
    }),
  });
}
