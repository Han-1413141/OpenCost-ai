import { z } from 'zod';
import type { PublicRankingStudy } from './ranking-study-report.js';

export const taskWeightPolicy = {
  version: 'task-weight-sensitivity-1',
  method: 'fixed-baseline-equal-one-condition-half-double',
  maxReports: 128,
  maxModelCells: 8192,
  maxCatalogPairSteps: 4_000_000,
  maxCatalogWork: 20_000_000,
  maxCatalogScenarioValues: 500_000,
  relativeEqualityTolerance: 1e-10,
} as const;
const amount = z.number().finite().nonnegative();
const count = z.number().int().safe().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ScenarioSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('baseline') }).strict(),
  z.object({ kind: z.literal('equal_conditions') }).strict(),
  z
    .object({
      kind: z.literal('condition'),
      conditionId: hash,
      factor: z.union([z.literal(0.5), z.literal(2)]),
    })
    .strict(),
]);
export type WeightScenario = z.infer<typeof ScenarioSchema>;
export const TaskWeightModelSchema = z
  .object({
    modelId: z.string().min(1).max(1024),
    state: z.enum([
      'measured',
      'zero_acceptance_paid',
      'undefined_zero_over_zero',
      'incomplete',
      'capacity',
      'numeric_unavailable',
    ]),
    baselineCost: amount.nullable(),
    reportedBaselineCost: amount.nullable(),
    equalConditionCost: amount.nullable(),
    minimumCost: amount.nullable(),
    maximumCost: amount.nullable(),
    minimumScenario: ScenarioSchema.nullable(),
    maximumScenario: ScenarioSchema.nullable(),
    maxAbsoluteChange: amount.nullable(),
    maxRelativeChange: amount.nullable(),
    comparedModels: count.max(127),
    reversedComparisons: count.max(127),
    separatedBaselineTies: count.max(127),
  })
  .strict()
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (m.reversedComparisons + m.separatedBaselineTies > m.comparedModels) fail('比较计数不一致');
    const values = [
      m.baselineCost,
      m.reportedBaselineCost,
      m.equalConditionCost,
      m.minimumCost,
      m.maximumCost,
      m.maxAbsoluteChange,
    ];
    if (m.state !== 'measured') {
      if (
        values.some((v) => v !== null) ||
        m.minimumScenario ||
        m.maximumScenario ||
        m.maxRelativeChange !== null ||
        m.comparedModels ||
        m.reversedComparisons ||
        m.separatedBaselineTies
      )
        fail('未计算或无有限费用时不得附带数值范围与比较');
      return;
    }
    if (values.some((v) => v === null) || !m.minimumScenario || !m.maximumScenario) {
      fail('完整结果缺值');
      return;
    }
    const lo = m.minimumCost!,
      hi = m.maximumCost!,
      base = m.baselineCost!;
    if (
      lo > hi ||
      base < lo ||
      base > hi ||
      m.equalConditionCost! < lo ||
      m.equalConditionCost! > hi
    )
      fail('费用不在情景范围内');
    const change = Math.max(base - lo, hi - base);
    if (base === 0 && hi !== 0) fail('正权重下零费用基准不能变为正费用');
    if (!equal(change, m.maxAbsoluteChange!)) fail('绝对变化与范围不一致');
    if (
      base === 0
        ? m.maxRelativeChange !== null
        : m.maxRelativeChange === null || !equal(m.maxRelativeChange, change / base)
    )
      fail('相对变化不一致');
  });
export type TaskWeightModel = z.infer<typeof TaskWeightModelSchema>;
export const TaskWeightSensitivitySchema = z
  .object({
    version: z.literal(taskWeightPolicy.version),
    method: z.literal(taskWeightPolicy.method),
    reportId: hash,
    targetId: hash,
    dataVersion: hash,
    scope: z.literal('published_evaluation_cells_only'),
    interpretation: z.literal('descriptive_scenarios_not_probability_or_confidence'),
    state: z.enum(['computed', 'no_complete_models', 'capacity', 'numeric_unavailable']),
    conditions: count.max(256),
    scenarioCount: count.max(514),
    // Deliberately counts formulas, not independent draws or distinct vectors.
    scenarioUnit: z.literal('predefined_formulas_not_probabilistic_draws'),
    relativeEqualityTolerance: z.literal(taskWeightPolicy.relativeEqualityTolerance),
    models: z.array(TaskWeightModelSchema).max(128),
    comparedPairs: count,
    reversedPairs: count,
    separatedBaselineTies: count,
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(r.models.map((m) => m.modelId)).size !== r.models.length) fail('重复模型');
    const measured = r.models.filter((m) => m.state === 'measured');
    if (measured.some((m) => m.comparedModels !== measured.length - 1))
      fail('有限模型必须比较固定的全部模型对');
    if (r.conditions === 1 && measured.some((m) => !singleConditionResult(m)))
      fail('单条件不应产生构成变化');
    if (
      r.scenarioCount !== (r.conditions === 0 ? 0 : r.conditions === 1 ? 1 : 2 + 2 * r.conditions)
    )
      fail('情景配方数错误');
    if (
      r.comparedPairs * 2 !== r.models.reduce((s, m) => s + m.comparedModels, 0) ||
      r.reversedPairs * 2 !== r.models.reduce((s, m) => s + m.reversedComparisons, 0) ||
      r.separatedBaselineTies * 2 !== r.models.reduce((s, m) => s + m.separatedBaselineTies, 0)
    )
      fail('模型与模型对计数不一致');
    if (r.state === 'capacity' && r.models.some((m) => m.state !== 'capacity'))
      fail('超限不得保留部分结果');
    if (
      r.state === 'numeric_unavailable' &&
      r.models.some((m) => m.state !== 'numeric_unavailable')
    )
      fail('数值不兼容不保留部分模型结果');
    if (
      r.state === 'no_complete_models' &&
      (r.conditions !== 0 || r.models.some((m) => m.state !== 'incomplete'))
    )
      fail('无完整模型状态错误');
    if (
      r.state === 'computed' &&
      (!r.conditions ||
        !r.models.some(
          (m) =>
            m.state !== 'incomplete' && m.state !== 'capacity' && m.state !== 'numeric_unavailable',
        ) ||
        r.models.some((m) => m.state === 'capacity' || m.state === 'numeric_unavailable'))
    )
      fail('计算状态错误');
  });
export type TaskWeightSensitivity = z.infer<typeof TaskWeightSensitivitySchema>;
// A single-model excerpt does not contain global pair totals or other models.
export const TaskWeightExcerptSchema = z
  .object({
    version: z.literal(taskWeightPolicy.version),
    method: z.literal(taskWeightPolicy.method),
    reportId: hash,
    targetId: hash,
    dataVersion: hash,
    scope: z.literal('published_evaluation_cells_only'),
    interpretation: z.literal('descriptive_scenarios_not_probability_or_confidence'),
    conditions: count.min(1).max(256),
    scenarioCount: count.min(1).max(514),
    scenarioUnit: z.literal('predefined_formulas_not_probabilistic_draws'),
    relativeEqualityTolerance: z.literal(taskWeightPolicy.relativeEqualityTolerance),
    result: TaskWeightModelSchema,
  })
  .strict()
  .refine((r) => r.scenarioCount === (r.conditions === 1 ? 1 : 2 + 2 * r.conditions))
  .refine(
    (r) => r.conditions !== 1 || r.result.state !== 'measured' || singleConditionResult(r.result),
  );
export type TaskWeightExcerpt = z.infer<typeof TaskWeightExcerptSchema>;

function singleConditionResult(m: TaskWeightModel) {
  return (
    m.minimumCost === m.baselineCost &&
    m.maximumCost === m.baselineCost &&
    m.equalConditionCost === m.baselineCost &&
    m.maxAbsoluteChange === 0 &&
    m.reversedComparisons === 0 &&
    m.separatedBaselineTies === 0 &&
    m.minimumScenario?.kind === 'baseline' &&
    m.maximumScenario?.kind === 'baseline'
  );
}

function equal(a: number, b: number) {
  return (
    a === b ||
    Math.abs(a - b) <=
      taskWeightPolicy.relativeEqualityTolerance * Math.max(Math.abs(a), Math.abs(b))
  );
}
function order(a: number, b: number) {
  return equal(a, b) ? 0 : a < b ? -1 : 1;
}
function sum(values: readonly number[]) {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const y = value - correction,
      t = total + y;
    correction = t - total - y;
    total = t;
  }
  return total;
}
const emptyModel = (modelId: string, state: TaskWeightModel['state']): TaskWeightModel => ({
  modelId,
  state,
  baselineCost: null,
  reportedBaselineCost: null,
  equalConditionCost: null,
  minimumCost: null,
  maximumCost: null,
  minimumScenario: null,
  maximumScenario: null,
  maxAbsoluteChange: null,
  maxRelativeChange: null,
  comparedModels: 0,
  reversedComparisons: 0,
  separatedBaselineTies: 0,
});
function shape(report: PublicRankingStudy) {
  const first = report.models.find((m) => m.status !== 'incomplete');
  const conditions = first?.cells.length ?? 0,
    scenarioCount = conditions === 0 ? 0 : conditions === 1 ? 1 : 2 + 2 * conditions;
  const measured = report.models.filter((m) => m.status === 'measured').length;
  return {
    conditions,
    scenarioCount,
    pairSteps: (scenarioCount * measured * (measured - 1)) / 2,
    cellSteps: scenarioCount * measured * conditions,
    values: scenarioCount * measured,
  };
}
class TaskWeightCalculationError extends Error {}
function blank(
  report: PublicRankingStudy,
  capacity: boolean,
  numerical = false,
): TaskWeightSensitivity {
  const { conditions, scenarioCount } = shape(report);
  return {
    version: taskWeightPolicy.version,
    method: taskWeightPolicy.method,
    reportId: report.id,
    targetId: report.targetId,
    dataVersion: report.dataVersion,
    scope: 'published_evaluation_cells_only',
    interpretation: 'descriptive_scenarios_not_probability_or_confidence',
    state: numerical ? 'numeric_unavailable' : capacity ? 'capacity' : 'no_complete_models',
    conditions,
    scenarioCount,
    scenarioUnit: 'predefined_formulas_not_probabilistic_draws',
    relativeEqualityTolerance: taskWeightPolicy.relativeEqualityTolerance,
    models: report.models.map((m) =>
      emptyModel(m.id, numerical ? 'numeric_unavailable' : capacity ? 'capacity' : 'incomplete'),
    ),
    comparedPairs: 0,
    reversedPairs: 0,
    separatedBaselineTies: 0,
  };
}

/** Deterministic post-processing of validated, already-public cells. No resampling or selection. */
export function taskWeightSensitivity(report: PublicRankingStudy): TaskWeightSensitivity {
  const size = shape(report);
  if (
    report.models.length > 128 ||
    size.conditions > 256 ||
    report.models.reduce((s, m) => s + m.cells.length, 0) > taskWeightPolicy.maxModelCells ||
    size.pairSteps > taskWeightPolicy.maxCatalogPairSteps ||
    size.values > taskWeightPolicy.maxCatalogScenarioValues
  )
    return blank(report, true);
  if (!size.conditions) return blank(report, false);
  const reference = report.models
    .find((m) => m.status !== 'incomplete')!
    .cells.slice()
    .sort((a, b) => a.conditionId.localeCompare(b.conditionId));
  const scenarios: WeightScenario[] = [{ kind: 'baseline' }];
  if (size.conditions > 1) {
    scenarios.push({ kind: 'equal_conditions' });
    for (const c of reference)
      for (const factor of [0.5, 2] as const)
        scenarios.push({ kind: 'condition', conditionId: c.conditionId, factor });
  }
  const vectors = new Map<string, number[]>();
  const result = blank(report, false);
  result.state = 'computed';
  result.models = report.models.map((m) => {
    if (m.status === 'incomplete') return emptyModel(m.id, 'incomplete');
    const cells = m.cells.slice().sort((a, b) => a.conditionId.localeCompare(b.conditionId));
    if (
      cells.length !== reference.length ||
      cells.some(
        (c, i) => c.conditionId !== reference[i].conditionId || c.weight !== reference[i].weight,
      )
    )
      throw new Error('权重情景需要一致的完整公开条件');
    const c = cells.map((x) => x.spendMinor / x.count),
      a = cells.map((x) => x.accepted / x.count);
    const wc = c.map((x, i) => x * cells[i].weight),
      wa = a.map((x, i) => x * cells[i].weight);
    const totalC = sum(wc),
      totalA = sum(wa);
    if (
      (totalA === 0 && cells.some((c) => c.accepted > 0)) ||
      (totalC === 0 && cells.some((c) => c.spendMinor > 0))
    )
      throw new TaskWeightCalculationError('正数权重发生数值下溢');
    if (totalA === 0)
      return emptyModel(m.id, totalC === 0 ? 'undefined_zero_over_zero' : 'zero_acceptance_paid');
    const base = totalC / totalA;
    // The historic parser has an absolute floor and evaluates stored cell order.
    // Preserve that compatibility check; never use its rounded value for scenarios.
    const historicSpend = m.cells.reduce((s, c) => s + (c.weight * c.spendMinor) / c.count, 0);
    const historicAccepted = m.cells.reduce((s, c) => s + (c.weight * c.accepted) / c.count, 0);
    const historicBaseline = historicSpend / historicAccepted;
    if (
      m.costPerAccepted === null ||
      !Number.isFinite(historicBaseline) ||
      Math.abs(m.costPerAccepted - historicBaseline) > 1e-10 * Math.max(1, historicBaseline)
    )
      throw new TaskWeightCalculationError('基准费用与公开报告不一致');
    const costs = [base];
    if (size.conditions > 1) {
      costs.push(sum(c) / sum(a));
      for (let i = 0; i < cells.length; i++)
        for (const factor of [0.5, 2]) {
          // All terms remain nonnegative; normalization cancels in the ratio.
          const denominator = sum(wa.map((v, j) => (j === i ? v * factor : v)));
          if (denominator <= 0) throw new TaskWeightCalculationError('正数验收分母发生数值下溢');
          costs.push(sum(wc.map((v, j) => (j === i ? v * factor : v))) / denominator);
        }
    }
    if (costs.some((v) => !Number.isFinite(v) || v < 0))
      throw new TaskWeightCalculationError('权重情景超出有效数值范围');
    let min = 0,
      max = 0;
    for (let i = 1; i < costs.length; i++) {
      if (costs[i] < costs[min]) min = i;
      if (costs[i] > costs[max]) max = i;
    }
    vectors.set(m.id, costs);
    const change = Math.max(base - costs[min], costs[max] - base);
    const relativeChange = base === 0 ? null : change / base;
    if (relativeChange !== null && !Number.isFinite(relativeChange))
      throw new TaskWeightCalculationError('相对变化超出有效数值范围');
    return {
      ...emptyModel(m.id, 'measured'),
      baselineCost: base,
      reportedBaselineCost: m.costPerAccepted,
      equalConditionCost: costs[size.conditions > 1 ? 1 : 0],
      minimumCost: costs[min],
      maximumCost: costs[max],
      minimumScenario: scenarios[min],
      maximumScenario: scenarios[max],
      maxAbsoluteChange: change,
      maxRelativeChange: relativeChange,
    };
  });
  const finite = result.models.filter((m) => m.state === 'measured');
  for (let i = 0; i < finite.length; i++)
    for (let j = i + 1; j < finite.length; j++) {
      const a = finite[i],
        b = finite[j],
        av = vectors.get(a.modelId)!,
        bv = vectors.get(b.modelId)!;
      const baseline = order(av[0], bv[0]);
      let reversed = false,
        separated = false;
      for (let s = 1; s < scenarios.length; s++) {
        const relation = order(av[s], bv[s]);
        if (baseline !== 0 && relation === -baseline) reversed = true;
        if (baseline === 0 && relation !== 0) separated = true;
      }
      a.comparedModels++;
      b.comparedModels++;
      result.comparedPairs++;
      if (reversed) {
        a.reversedComparisons++;
        b.reversedComparisons++;
        result.reversedPairs++;
      }
      if (separated) {
        a.separatedBaselineTies++;
        b.separatedBaselineTies++;
        result.separatedBaselineTies++;
      }
    }
  return TaskWeightSensitivitySchema.parse(result);
}

/** Build once at catalog load; a whole-catalog budget failure keeps no favorable prefix. */
export function createTaskWeightCatalog(reports: readonly PublicRankingStudy[]) {
  const sizes = reports.map(shape);
  const capacity =
    reports.length > taskWeightPolicy.maxReports ||
    sizes.reduce((s, x) => s + x.pairSteps, 0) > taskWeightPolicy.maxCatalogPairSteps ||
    sizes.reduce((s, x) => s + x.pairSteps + x.cellSteps, 0) > taskWeightPolicy.maxCatalogWork ||
    sizes.reduce((s, x) => s + x.values, 0) > taskWeightPolicy.maxCatalogScenarioValues;
  return new Map(
    reports.map((report) => {
      if (capacity) return [report.id, blank(report, true)] as const;
      try {
        return [report.id, taskWeightSensitivity(report)] as const;
      } catch (error) {
        if (!(error instanceof TaskWeightCalculationError)) throw error;
        return [report.id, blank(report, false, true)] as const;
      }
    }),
  );
}
export function taskWeightExcerpt(
  result: TaskWeightSensitivity | undefined,
  modelId: string,
): TaskWeightExcerpt | undefined {
  const model = result?.models.find((m) => m.modelId === modelId);
  if (!result || !model || !result.conditions) return undefined;
  return {
    version: result.version,
    method: result.method,
    reportId: result.reportId,
    targetId: result.targetId,
    dataVersion: result.dataVersion,
    scope: result.scope,
    interpretation: result.interpretation,
    conditions: result.conditions,
    scenarioCount: result.scenarioCount,
    scenarioUnit: result.scenarioUnit,
    relativeEqualityTolerance: result.relativeEqualityTolerance,
    result: model,
  };
}
