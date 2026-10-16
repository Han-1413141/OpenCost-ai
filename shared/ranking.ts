import {
  modelWorkCondition,
  targetConditions,
  rankingTargetSummary,
  type RankingTarget,
  type RankingExpansionBudget,
  reserveTargetExpansion,
} from './ranking-target.js';
import { canonical } from './schema.js';
import type { Comparison } from './analysis.js';
import { hasComparableCostAttribution } from './cost-attribution.js';
import { isCurrentSummaryProjection, executionMetrics } from './evaluation.js';
import { isModelIdentity, modelIdentityKey } from './model-identity.js';
import { hasComparableHarnessComposition } from './harness-composition.js';
import { selectionCostMargin, withCostCompletionTradeoffs } from './ranking-diagnostics.js';
import {
  WORKLOAD_COMPARISON_VERSION,
  workloadComparisonEligibility,
} from './comparison-eligibility.js';

export const rankingMethodology = {
  workloadEligibility: WORKLOAD_COMPARISON_VERSION,
  method: 'equal-task-attempt-mix-v1',
  weights: 'equal-task-types-then-equal-conditions',
  sensitivityMethod: 'equal-accepted-outcome-mix',
  inference: 'descriptive',
  selectionUncertainty: 'not-estimated',
} as const;

// These ranks describe two different workload targets, not confidence in either
// one. Build ranks once per view; do not compare every pair of configurations.
export function withRankingSensitivity<
  T extends { id: string; cost: number | null; qualified: boolean; acceptedMixCost: number | null },
>(rows: T[], comparable: boolean) {
  const ranks = (get: (row: T) => number | null) => {
    const values = rows
      .filter((row) => row.qualified && get(row) !== null)
      .map((row) => get(row)!)
      .sort((a, b) => a - b);
    const byValue = new Map<number, number>();
    if (comparable && values.length >= 2)
      values.forEach((value, index) => {
        if (!byValue.has(value)) byValue.set(value, index + 1);
      });
    return byValue;
  };
  const primary = ranks((row) => row.cost),
    acceptedMix = ranks((row) => row.acceptedMixCost);
  return rows.map(({ acceptedMixCost, ...row }) => {
    const primaryRank = row.qualified && row.cost !== null ? (primary.get(row.cost) ?? null) : null;
    const acceptedMixRank =
      row.qualified && acceptedMixCost !== null ? (acceptedMix.get(acceptedMixCost) ?? null) : null;
    return {
      ...row,
      sensitivity: {
        acceptedMixCost,
        relativeDifference:
          row.cost !== null && row.cost > 0 && acceptedMixCost !== null
            ? acceptedMixCost / row.cost - 1
            : null,
        primaryRank,
        acceptedMixRank,
        rankChanged:
          primaryRank !== null && acceptedMixRank !== null ? primaryRank !== acceptedMixRank : null,
      },
    };
  });
}

export const modelRankingEligible = (row: Comparison) =>
  hasComparableCostAttribution(row.cohort) &&
  workloadComparisonEligibility(row.cohort).eligible &&
  hasComparableHarnessComposition(row.cohort) &&
  isModelIdentity(row.cohort.modelIdentity) &&
  row.cohort.modelIdentity.members.length === 1 &&
  row.modelIds.length === 1 &&
  row.modelIds[0] === row.cohort.modelIdentity.members[0].model &&
  isCurrentSummaryProjection(row.cohort.evaluation) &&
  !['mixed', 'unknown'].includes(row.cohort.harnessAttribution ?? 'legacy');

/** The exact execution configuration selected for a model/work condition. */
export const rankingConfiguration = (r: Comparison) => ({
  harness: r.cohort.harness,
  harnessVersion: r.cohort.harnessVersion,
  harnessVariant: r.cohort.harnessVariant ?? null,
  harnessSurface: r.cohort.harnessSurface ?? 'unknown',
  plan: r.cohort.plan,
  planVersion: r.cohort.planVersion,
  mode: r.cohort.mode,
  tools: r.cohort.tools,
  reasoning: r.cohort.reasoning,
  cache: r.cohort.cache,
});

// Each comparable task condition selects its own observed lowest-cost Harness.
export function rankModels(
  rows: Comparison[],
  _legacyMinimumCompletion = 0.9,
  options: {
    workConditions?: string[];
    target?: RankingTarget;
    expansionBudget?: RankingExpansionBudget;
    maximumHumanMinutesPerAccepted?: number;
  } = {},
) {
  if (options.target && options.workConditions)
    throw new Error('固定榜单目标与个人工作条件不能同时指定');
  // Older live API responses remain readable while the server and browser update.
  rows = rows.map((r) => ({
    ...r,
    cohort: {
      ...r.cohort,
      workType: r.cohort.workType ?? 'unknown',
      subjects: r.cohort.subjects ?? [],
      componentTypes: r.cohort.componentTypes ?? null,
      useContext: r.cohort.useContext ?? 'unknown',
      classificationBasis: r.cohort.classificationBasis ?? 'unknown',
      evaluation: r.cohort.evaluation ?? {
        version: 'legacy',
        difficulty: 'unknown',
        profile: null,
      },
      costCoverage: r.cohort.costCoverage ?? 'unknown',
      harnessAttribution: r.cohort.harnessAttribution ?? 'legacy',
    },
    metrics: {
      ...r.metrics,
      execution:
        r.metrics.execution ??
        (Object.fromEntries(
          executionMetrics.map((key) => [key, { mean: null, samples: 0 }]),
        ) as Comparison['metrics']['execution']),
    },
  }));
  rows = rows.filter(modelRankingEligible);
  const partitions = new Set(
    rows.map((r) =>
      canonical({
        domain: r.cohort.domain,
        month: r.cohort.month,
        currency: r.cohort.currency,
        billing: r.cohort.billing,
        payment: r.cohort.payment,
        allocation: r.cohort.allocation,
        costAttributionPolicy: r.cohort.costAttributionPolicy ?? null,
        costCoverage: r.cohort.costCoverage,
        evaluationVersion: r.cohort.evaluation.version,
        cost: r.evidence.cost,
        work: r.evidence.work,
        coverage: r.evidence.coverage,
      }),
    ),
  );
  const models = new Map<string, Map<string, Comparison[]>>();
  for (const row of rows) {
    const model = modelIdentityKey(row.cohort.modelIdentity)!;
    const key = modelWorkCondition(row);
    if (!models.has(model)) models.set(model, new Map());
    const cells = models.get(model)!;
    const cell = cells.get(key);
    if (cell) cell.push(row);
    else cells.set(key, [row]);
  }
  const entries = [...models.entries()];
  const withinCapacity = reserveTargetExpansion(
    options.target,
    entries.length,
    options.expansionBudget,
  );
  // Establish the comparison scope before filtering completion or selecting cheap runs.
  const common = options.target
    ? options.target.cells.map((c) => c.key)
    : options.workConditions
      ? [...new Set(options.workConditions)].sort()
      : [...(entries[0]?.[1].keys() ?? [])]
          .filter((key) => entries.every(([, cells]) => cells.has(key)))
          .sort();
  const targetCells = targetConditions(common, options.target);
  const weights = new Map(targetCells.map((c) => [c.key, c.weight]));
  const targetIds = new Map(targetCells.map((c) => [c.key, c.id]));
  const available = new Set(entries.flatMap(([, cells]) => [...cells.keys()]));
  const weight = (key: string) => weights.get(key) ?? 0;
  const configuration = rankingConfiguration;
  const validTaskCounts = (r: Comparison) =>
    Number.isSafeInteger(r.metrics.count) &&
    r.metrics.count > 0 &&
    Number.isSafeInteger(r.metrics.accepted) &&
    r.metrics.accepted >= 0 &&
    r.metrics.accepted <= r.metrics.count;
  const hasFiniteCost = (r: Comparison) =>
    validTaskCounts(r) &&
    Number.isFinite(r.metrics.spendMinor) &&
    r.metrics.spendMinor >= 0 &&
    r.metrics.accepted > 0 &&
    r.metrics.costPerAccepted !== null &&
    Number.isFinite(r.metrics.costPerAccepted) &&
    r.metrics.costPerAccepted >= 0;
  const isQualified = (r: Comparison) =>
    hasFiniteCost(r) &&
    (options.maximumHumanMinutesPerAccepted === undefined ||
      (r.metrics.humanMinutes !== null &&
        r.metrics.humanSamples === r.metrics.count &&
        r.metrics.humanMinutes / (r.metrics.accepted / r.metrics.count) <=
          options.maximumHumanMinutesPerAccepted));
  const ranking = (withinCapacity ? entries : [])
    .map(([id, cells]) => {
      const selected = common.map((key) => {
        const candidates = [...(cells.get(key) ?? [])].sort(
          (a, b) =>
            Number(isQualified(b)) - Number(isQualified(a)) ||
            (a.metrics.costPerAccepted ?? Infinity) - (b.metrics.costPerAccepted ?? Infinity) ||
            b.metrics.completion - a.metrics.completion ||
            b.metrics.sources - a.metrics.sources ||
            b.metrics.count - a.metrics.count ||
            canonical(configuration(a)).localeCompare(canonical(configuration(b))),
        );
        return { key, candidates, row: candidates[0] };
      });
      const observed = selected.flatMap((s) => (s.row ? [s.row] : []));
      const complete = common.length > 0 && observed.length === common.length;
      const qualified = complete && observed.every(isQualified);
      const finiteCost = complete && observed.every(hasFiniteCost);
      const mean = (get: (r: Comparison) => number) =>
        observed.reduce((s, r) => s + get(r) * weight(modelWorkCondition(r)), 0);
      const measured = (
        get: (r: Comparison) => number | null,
        covered: (r: Comparison) => boolean,
      ) =>
        complete && observed.every((r) => get(r) !== null && covered(r))
          ? mean((r) => get(r)!)
          : null;
      const configs = [
        ...new Map(observed.map((r) => [canonical(configuration(r)), configuration(r)])).values(),
      ];
      const acceptedPerAttempt =
        complete && observed.every(validTaskCounts)
          ? mean((r) => r.metrics.accepted / r.metrics.count)
          : null;
      const costPerAttempt = finiteCost
        ? mean((r) => r.metrics.spendMinor / r.metrics.count)
        : null;
      const cost =
        costPerAttempt !== null && acceptedPerAttempt !== null && acceptedPerAttempt > 0
          ? costPerAttempt / acceptedPerAttempt
          : null;
      const first = [...cells.values()][0][0];
      return {
        id,
        model: first.modelIds[0],
        modelIdentity: first.cohort.modelIdentity!,
        cells: observed.length,
        requiredCells: common.length,
        count: observed.reduce((s, r) => s + r.metrics.count, 0),
        sourcesMin: observed.length
          ? observed.reduce((minimum, row) => Math.min(minimum, row.metrics.sources), Infinity)
          : 0,
        cost,
        acceptedMixCost: finiteCost ? mean((r) => r.metrics.costPerAccepted!) : null,
        aggregation: { method: rankingMethodology.method, costPerAttempt, acceptedPerAttempt },
        support: {
          availableConditions: cells.size,
          matchedConditions: observed.length,
          requiredTargetConditions: common.length,
          targetCoverage: common.length ? observed.length / common.length : null,
          targetWeightCoverage: selected.reduce(
            (total, item) => total + (item.row ? weight(item.key) : 0),
            0,
          ),
          conditionCoverage: cells.size ? observed.length / cells.size : null,
          selectedTasks: observed.reduce((s, r) => s + r.metrics.count, 0),
          minimumSources: observed.length
            ? observed.reduce((minimum, row) => Math.min(minimum, row.metrics.sources), Infinity)
            : 0,
        },
        completion: acceptedPerAttempt ?? 0,
        minimumCellCompletion: observed.length
          ? observed.reduce((minimum, row) => Math.min(minimum, row.metrics.completion), Infinity)
          : null,
        qualified,
        excludedReason: !complete
          ? 'incomplete_work_coverage'
          : !finiteCost
            ? observed.some((r) => r.metrics.accepted === 0)
              ? 'zero_acceptance'
              : 'missing_or_invalid_measurement'
            : !qualified
              ? 'no_accepted_harness_for_some_conditions'
              : null,
        harnesses: [...new Set(configs.map((c) => c.harness))],
        selectedHarness: configs.length === 1 && qualified ? configs[0] : null,
        selectionMode: 'per-work-condition' as const,
        candidateCount: selected.reduce((s, c) => s + c.candidates.length, 0),
        selections: selected.map((s) => ({
          conditions: available.has(s.key) ? JSON.parse(s.key) : null,
          targetConditionId: targetIds.get(s.key) ?? null,
          weight: weight(s.key),
          configuration: s.row && isQualified(s.row) ? configuration(s.row) : null,
          observedConfiguration: s.row ? configuration(s.row) : null,
          excludedReason: !s.row
            ? 'missing_condition'
            : s.row.metrics.accepted === 0
              ? 'zero_acceptance'
              : !hasFiniteCost(s.row)
                ? 'missing_or_invalid_measurement'
                : !isQualified(s.row)
                  ? 'human_limit_or_missing_measurement'
                  : null,
          qualified: s.row ? isQualified(s.row) : false,
          cost: s.row?.metrics.costPerAccepted ?? null,
          completion: s.row?.metrics.completion ?? null,
          count: s.row?.metrics.count ?? 0,
          sources: s.row?.metrics.sources ?? 0,
          candidateCount: s.candidates.length,
          costMargin: selectionCostMargin(
            s.candidates.map((r) => ({
              cost: r.metrics.costPerAccepted,
              qualified: isQualified(r),
            })),
          ),
          candidates: s.candidates.map((r) => ({
            configuration: configuration(r),
            cost: r.metrics.costPerAccepted,
            completion: r.metrics.completion,
            qualified: isQualified(r),
          })),
        })),
        wallPerAccepted: finiteCost
          ? (() => {
              const time = measured(
                (r) => r.metrics.wallMinutes,
                (r) => r.metrics.wallSamples === r.metrics.count,
              );
              return time === null ? null : time / acceptedPerAttempt!;
            })()
          : null,
        humanPerAccepted: finiteCost
          ? (() => {
              const time = measured(
                (r) => r.metrics.humanMinutes,
                (r) => r.metrics.humanSamples === r.metrics.count,
              );
              return time === null ? null : time / acceptedPerAttempt!;
            })()
          : null,
        humanMinutes: measured(
          (r) => r.metrics.humanMinutes,
          (r) => r.metrics.humanSamples === r.metrics.count,
        ),
        outputTps: measured(
          (r) => r.metrics.outputTps,
          (r) => r.metrics.speedSamples === r.metrics.count,
        ),
        reworkPerTask: measured(
          (r) => r.metrics.rework,
          (r) => r.metrics.reworkSamples === r.metrics.count,
        ),
        revisionsPerTask: measured(
          (r) => r.metrics.revisions,
          (r) => r.metrics.revisionSamples === r.metrics.count,
        ),
        intentErrorsPerTask: measured(
          (r) => r.metrics.intentErrors,
          (r) => r.metrics.eventSamples === r.metrics.count,
        ),
        userTurnsPerTask: measured(
          (r) => r.metrics.execution.userTurns.mean,
          (r) => r.metrics.execution.userTurns.samples === r.metrics.count,
        ),
        modelCallsPerTask: measured(
          (r) => r.metrics.execution.modelCalls.mean,
          (r) => r.metrics.execution.modelCalls.samples === r.metrics.count,
        ),
        agentsPerTask: measured(
          (r) => r.metrics.execution.agentCount.mean,
          (r) => r.metrics.execution.agentCount.samples === r.metrics.count,
        ),
        sourceCostRangeBasis: 'equal-accepted-outcome-mix-source-extrema' as const,
        sourceCostRange:
          complete && observed.every((r) => r.metrics.sourceRange !== null)
            ? ([mean((r) => r.metrics.sourceRange![0]), mean((r) => r.metrics.sourceRange![1])] as [
                number,
                number,
              ])
            : null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.qualified) - Number(a.qualified) ||
        (a.cost ?? Infinity) - (b.cost ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
  const reason = !withinCapacity
    ? '固定目标与候选组合超过本次榜单计算容量；目标和权重保留，暂不生成排名。'
    : partitions.size > 1
      ? '请先选择同一领域、月份、币种、付款方式、费用覆盖、评价版本和核验等级。'
      : entries.length < 2
        ? '至少需要两个模型在共同条件下的合格记录。'
        : !common.length
          ? '这些模型没有共同覆盖的工作条件，无法生成总体排名。'
          : ranking.filter((r) => r.qualified).length < 2
            ? '不足两个模型在全部共同条件中有合格 Harness；保留成本，不据此宣布优胜。'
            : null;
  const ranked = withCostCompletionTradeoffs(
    withRankingSensitivity(
      partitions.size > 1 || (!options.target && entries.length < 2) || !common.length
        ? []
        : ranking,
      !reason,
    ),
    !reason,
  );
  return {
    capacityExceeded: !withinCapacity,
    rows: ranked,
    strata: targetCells.map((cell) => ({
      conditions: available.has(cell.key) ? JSON.parse(cell.key) : null,
      weight: cell.weight,
      ...(cell.id ? { targetConditionId: cell.id } : {}),
    })),
    target: rankingTargetSummary(targetCells, available, options.target, !!options.workConditions),
    reason,
    comparable: !reason,
    methodology: rankingMethodology,
    sensitivity: {
      orderChanged: !reason ? ranked.some((row) => row.sensitivity.rankChanged === true) : null,
    },
    selection: 'minimum-harness-per-work-condition' as const,
  };
}
