import {
  planWorkCondition,
  targetConditions,
  rankingTargetSummary,
  type RankingTarget,
  type RankingExpansionBudget,
  reserveTargetExpansion,
} from './ranking-target.js';
import type { Comparison } from './analysis.js';
import { hasComparableCostAttribution } from './cost-attribution.js';
import { canonical } from './schema.js';
import { isCurrentSummaryProjection } from './evaluation.js';
import { isModelIdentity, modelIdentityKey } from './model-identity.js';
import { rankingMethodology, withRankingSensitivity } from './ranking.js';
import { withCostCompletionTradeoffs } from './ranking-diagnostics.js';
import { hasComparableHarnessComposition } from './harness-composition.js';
import { workloadComparisonEligibility } from './comparison-eligibility.js';

export type PlanComparison = {
  id: string;
  cohort: Comparison['cohort'];
  evidence: Comparison['evidence'];
  plan: string;
  planVersion: string;
  month: string;
  currency: string;
  model: string;
  modelIds: string[];
  sources: number;
  periods: number;
  totalMinor: number;
  observedPaidMinor: number;
  apiEquivalentMinor: number | null;
  apiEquivalentPriceVersion: string | null;
  apiEquivalentMultiple: number | null;
  accepted: number;
  costPerAccepted: number | null;
  observedPercent: number | null;
  windowHours: number | null;
  tokensPerPercent: number | null;
  equivalentPerPercent: number | null;
  quotaSamples: number;
  cycleCostMedian: number;
  cycleCostRange: [number, number];
  cycleAcceptedP25: number;
  completion: number;
  humanMinutes: number | null;
  quotaPriceVersion?: string | null;
};

// A shared "mixed" label is not a matched task composition. Keep valid multi-model
// plans, but require the same recorded component types used by model comparisons.
export const planRankingEligible = (plan: PlanComparison) =>
  hasComparableCostAttribution(plan.cohort) &&
  workloadComparisonEligibility(plan.cohort).eligible &&
  isCurrentSummaryProjection(plan.cohort.evaluation) &&
  isModelIdentity(plan.cohort.modelIdentity) &&
  hasComparableHarnessComposition(plan.cohort);

// Every plan uses the same observed work conditions. Do not compare unequal task mixes.
export function rankPlans(
  plans: PlanComparison[],
  _legacyMinimumCompletion = 0.9,
  options: { target?: RankingTarget; expansionBudget?: RankingExpansionBudget } = {},
) {
  plans = plans.filter(planRankingEligible);
  const partitions = new Set(
    plans.map((r) =>
      canonical({
        domain: r.cohort.domain,
        month: r.cohort.month,
        currency: r.currency,
        billing: r.cohort.billing,
        payment: r.cohort.payment,
        allocation: r.cohort.allocation,
        costAttributionPolicy: r.cohort.costAttributionPolicy ?? null,
        cost: r.evidence.cost,
        work: r.evidence.work,
        coverage: r.evidence.coverage,
        costCoverage: r.cohort.costCoverage ?? 'unknown',
        evaluationVersion: r.cohort.evaluation?.version ?? 'legacy',
      }),
    ),
  );
  const groups = new Map<string, Map<string, PlanComparison>>();
  for (const row of plans) {
    const { plan, planVersion, modelIdentity } = row.cohort;
    const id = canonical({ plan, planVersion, modelIdentity: modelIdentityKey(modelIdentity)! });
    const stratum = planWorkCondition(row);
    if (!groups.has(id)) groups.set(id, new Map());
    groups.get(id)!.set(stratum, row);
  }
  const entries = [...groups.entries()];
  const withinCapacity = reserveTargetExpansion(
    options.target,
    entries.length,
    options.expansionBudget,
  );
  const common = options.target
    ? options.target.cells.map((c) => c.key)
    : [...(entries[0]?.[1].keys() ?? [])]
        .filter((key) => entries.every(([, rows]) => rows.has(key)))
        .sort();
  const targetCells = targetConditions(common, options.target);
  const weights = new Map(targetCells.map((c) => [c.key, c.weight]));
  const available = new Set(entries.flatMap(([, cells]) => [...cells.keys()]));
  const weight = (row: PlanComparison) => weights.get(planWorkCondition(row)) ?? 0;
  const ranking =
    withinCapacity &&
    common.length &&
    partitions.size <= 1 &&
    (options.target || entries.length >= 2)
      ? entries
          .map(([id, rows]) => {
            const cells = common.flatMap((key) => (rows.has(key) ? [rows.get(key)!] : []));
            const first = [...rows.values()][0];
            const complete = common.length > 0 && cells.length === common.length;
            const completion = cells.reduce((s, r) => s + r.completion * weight(r), 0);
            const hasAcceptedInEveryCell =
              complete &&
              cells.every(
                (r) =>
                  r.accepted > 0 &&
                  r.costPerAccepted !== null &&
                  Number.isFinite(r.costPerAccepted) &&
                  r.costPerAccepted >= 0 &&
                  Number.isFinite(r.completion) &&
                  r.completion > 0 &&
                  r.completion <= 1,
              );
            // The plan aggregate predates a published task-count field. For a
            // nonzero accepted cell, (C/A)*(A/N) is exactly its mean cost C/N.
            // Never apply this identity to a zero-acceptance cell or invent N.
            const costPerAttempt = hasAcceptedInEveryCell
              ? cells.reduce((s, r) => s + r.costPerAccepted! * r.completion * weight(r), 0)
              : null;
            return {
              id,
              plan: first.plan,
              version: first.planVersion,
              modelIds: first.modelIds,
              modelIdentity: first.cohort.modelIdentity!,
              cost: costPerAttempt !== null && completion > 0 ? costPerAttempt / completion : null,
              acceptedMixCost: hasAcceptedInEveryCell
                ? cells.reduce((s, r) => s + r.costPerAccepted! * weight(r), 0)
                : null,
              aggregation: {
                method: rankingMethodology.method,
                costPerAttempt,
                acceptedPerAttempt: complete && Number.isFinite(completion) ? completion : null,
              },
              support: {
                availableConditions: rows.size,
                matchedConditions: cells.length,
                requiredTargetConditions: common.length,
                targetCoverage: common.length ? cells.length / common.length : null,
                targetWeightCoverage: cells.reduce((s, r) => s + weight(r), 0),
                conditionCoverage: rows.size ? cells.length / rows.size : null,
                selectedTasks: null,
                minimumSources: cells.length
                  ? cells.reduce((minimum, row) => Math.min(minimum, row.sources), Infinity)
                  : 0,
              },
              completion: complete ? completion : 0,
              excludedReason: !complete
                ? 'incomplete_work_coverage'
                : !hasAcceptedInEveryCell
                  ? 'missing_acceptance_or_measurement'
                  : null,
              qualified: hasAcceptedInEveryCell,
              periods: cells.reduce((s, r) => s + r.periods, 0),
              cycleCostRange: cells.length
                ? ([
                    cells.reduce(
                      (minimum, row) => Math.min(minimum, row.cycleCostRange[0]),
                      Infinity,
                    ),
                    cells.reduce(
                      (maximum, row) => Math.max(maximum, row.cycleCostRange[1]),
                      -Infinity,
                    ),
                  ] as [number, number])
                : ([null, null] as [null, null]),
            };
          })
          .sort(
            (a, b) =>
              Number(b.qualified) - Number(a.qualified) ||
              (a.cost ?? Infinity) - (b.cost ?? Infinity) ||
              a.id.localeCompare(b.id),
          )
      : [];
  const reason = !withinCapacity
    ? '固定目标与候选组合超过本次榜单计算容量；目标和权重保留，暂不生成排名。'
    : partitions.size > 1
      ? '请先选择同一领域、月份、币种、付款方式、费用覆盖、评价版本和核验等级。'
      : entries.length < 2
        ? '至少需要两个套餐在共同条件下的合格记录。'
        : !common.length
          ? '这些套餐没有共同覆盖的工作条件，无法生成总体排名。'
          : ranking.filter((row) => row.qualified).length < 2
            ? '不足两个套餐在全部共同条件中有验收记录；保留观察值，不据此宣布优胜。'
            : null;
  const ranked = withCostCompletionTradeoffs(withRankingSensitivity(ranking, !reason), !reason);
  return {
    capacityExceeded: !withinCapacity,
    rows: ranked,
    strata: options.target
      ? common.length
      : partitions.size > 1 || entries.length < 2
        ? 0
        : common.length,
    conditions: targetCells.map((c) => ({
      conditions: available.has(c.key) ? JSON.parse(c.key) : null,
      weight: c.weight,
      ...(c.id ? { targetConditionId: c.id } : {}),
    })),
    target: rankingTargetSummary(targetCells, available, options.target),
    reason,
    comparable: !reason,
    methodology: rankingMethodology,
    sensitivity: {
      orderChanged: !reason ? ranked.some((row) => row.sensitivity.rankChanged === true) : null,
    },
  };
}

export function quotaChanges(plans: PlanComparison[], month: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return [];
  plans = plans.filter(
    (plan) =>
      isModelIdentity(plan.cohort.modelIdentity) && hasComparableHarnessComposition(plan.cohort),
  );
  const [year, number] = month.split('-').map(Number);
  const previousMonth = new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
  const key = (row: PlanComparison) => {
    const { month: _, ...conditions } = row.cohort;
    return canonical({
      ...conditions,
      windowHours: row.windowHours,
      evidence: {
        cost: row.evidence.cost,
        work: row.evidence.work,
        coverage: row.evidence.coverage,
      },
    });
  };
  const previous = new Map(plans.filter((r) => r.month === previousMonth).map((r) => [key(r), r]));
  return plans
    .filter((r) => r.month === month && r.tokensPerPercent !== null && r.windowHours !== null)
    .map((row) => {
      const before = previous.get(key(row));
      return {
        ...row,
        previousMonth,
        previousTokens: before?.tokensPerPercent ?? null,
        change:
          before?.tokensPerPercent && row.tokensPerPercent !== null
            ? row.tokensPerPercent / before.tokensPerPercent - 1
            : null,
        equivalentChange:
          before?.equivalentPerPercent &&
          row.equivalentPerPercent !== null &&
          row.quotaPriceVersion &&
          row.quotaPriceVersion === before.quotaPriceVersion
            ? row.equivalentPerPercent / before.equivalentPerPercent - 1
            : null,
      };
    });
}

export function recommendPlans(
  plans: PlanComparison[],
  opts: { budget: number; tasks: number; minCompletion?: number; maxHuman?: number },
) {
  if (
    !Number.isFinite(opts.budget) ||
    opts.budget < 0 ||
    !Number.isSafeInteger(opts.tasks) ||
    opts.tasks <= 0 ||
    (opts.maxHuman !== undefined && (!Number.isFinite(opts.maxHuman) || opts.maxHuman < 0))
  )
    return [];
  return plans
    .filter(
      (plan) =>
        planRankingEligible(plan) &&
        plan.accepted > 0 &&
        plan.completion > 0 &&
        plan.completion <= 1 &&
        plan.costPerAccepted !== null &&
        Number.isFinite(plan.costPerAccepted) &&
        plan.cycleAcceptedP25 >= opts.tasks &&
        plan.cycleCostRange[1] <= opts.budget &&
        (opts.maxHuman === undefined ||
          (plan.humanMinutes !== null &&
            Number.isFinite(plan.humanMinutes) &&
            plan.humanMinutes >= 0 &&
            plan.completion > 0 &&
            plan.humanMinutes / plan.completion <= opts.maxHuman)),
    )
    .sort((a, b) => a.cycleCostMedian - b.cycleCostMedian || a.id.localeCompare(b.id));
}
