import {
  boardScope,
  targetSlot,
  rankingExpansionBudget,
  type RankingTarget,
} from './ranking-target.js';
import { canonical } from './schema.js';
import { rankModels, modelRankingEligible } from './ranking.js';
import { rankPlans, planRankingEligible, type PlanComparison } from './plans.js';
import type { Comparison } from './analysis.js';
import { WORKLOAD_COMPARISON_VERSION } from './comparison-eligibility.js';
import { costAttributionMethodsLabel } from './cost-attribution.js';
import { rankingStudyView, type RankingStudyContext } from './ranking-study-report.js';
import { taskWeightPolicy } from './ranking-weight-sensitivity.js';
import { sourceBalancePolicy } from './ranking-source-balance.js';

export const costBasisName = (
  billing: string,
  allocation: string,
  policy?: Comparison['cohort']['costAttributionPolicy'],
) =>
  billing === 'api'
    ? 'API 实付'
    : `${billing === 'mixed' ? '混合付费' : '套餐'}${allocation === 'tokens' ? '按 Token 分摊' : allocation === 'equal' ? '按任务分摊' : allocation === 'itemized' ? '逐项归属（' + costAttributionMethodsLabel(policy) + '）' : '未分摊'}`;
const scope = boardScope;
function targetGroups<T extends { cohort: Comparison['cohort']; evidence: Comparison['evidence'] }>(
  rows: T[],
  board: 'models' | 'plans',
  targets: RankingTarget[],
) {
  const groups = new Map<
    string,
    { id: string; scope: ReturnType<typeof boardScope>; rows: T[]; targets: RankingTarget[] }
  >();
  for (const row of rows) {
    const value = scope(row),
      id = canonical(value);
    if (!groups.has(id)) groups.set(id, { id, scope: value, rows: [], targets: [] });
    groups.get(id)!.rows.push(row);
  }
  for (const target of targets.filter((t) => t.board === board)) {
    const id = canonical(target.scope);
    if (!groups.has(id)) groups.set(id, { id, scope: target.scope, rows: [], targets: [] });
    groups.get(id)!.targets.push(target);
  }
  return [...groups.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((g) => {
      const target = g.targets.find((t) => t.kind === null);
      const months = [
        ...new Set([...g.rows.map((r) => r.cohort.month), ...g.targets.map((t) => t.month)]),
      ]
        .sort()
        .reverse();
      const month = target?.month ?? months[0];
      return {
        ...g,
        target,
        month,
        availableMonths: months,
        items: g.rows.filter((r) => r.cohort.month === month),
      };
    });
}
// Public display policy is shared with clients. No visitor-selected statistical knobs.
export const BOARDS_POLICY_VERSION = 'boards-13';
export function buildBoards(
  rows: Comparison[],
  plans: PlanComparison[],
  targets: RankingTarget[] = [],
  studies?: RankingStudyContext,
) {
  if (new Set(targets.map(targetSlot)).size !== targets.length)
    throw new Error('同一榜单只能启用一个目标版本');
  const expansionBudget = rankingExpansionBudget();
  return {
    policy: {
      version: BOARDS_POLICY_VERSION,
      workloadEligibility: WORKLOAD_COMPARISON_VERSION,
      month: 'published_target_or_latest_observed_per_comparable_scope',
      completionThreshold: null,
      evidence: 'separate_exact_grades',
      currency: 'keep_original_currencies_separate',
      weighting: 'equal_task_types_then_equal_conditions',
      estimand: 'cost_per_accepted_in_standardized_attempt_mix',
      target: 'published_fixed_or_explicit_temporary_common_range',
      independentEvaluation: 'optional_precomputed_source_holdout',
      taskWeightSensitivity: taskWeightPolicy.version,
      sourceBalance: sourceBalancePolicy.version,
    },
    models: targetGroups(rows.filter(modelRankingEligible), 'models', targets).map((g) => ({
      id: g.id,
      scope: g.scope,
      month: g.month,
      availableMonths: g.availableMonths,
      costBasis: costBasisName(
        g.scope.billing,
        g.scope.allocation,
        g.scope.costAttributionPolicy ?? undefined,
      ),
      ...rankModels(g.items, 0.9, { target: g.target, expansionBudget }),
      independentEvaluation: rankingStudyView(g.target, studies),
      taskResults: [
        ...new Set([
          ...g.items.map((r) => r.cohort.kind),
          ...g.targets.flatMap((t) => (t.kind ? [t.kind] : [])),
        ]),
      ]
        .sort()
        .map((kind) => {
          const target = g.targets.find((t) => t.kind === kind),
            month = target?.month ?? g.month;
          return {
            kind,
            month,
            ...rankModels(
              g.rows.filter((r) => r.cohort.month === month && r.cohort.kind === kind),
              0.9,
              { target, expansionBudget },
            ),
            independentEvaluation: rankingStudyView(target, studies),
          };
        }),
    })),
    plans: targetGroups(plans.filter(planRankingEligible), 'plans', targets).map((g) => ({
      id: g.id,
      scope: g.scope,
      month: g.month,
      availableMonths: g.availableMonths,
      costBasis: costBasisName(
        g.scope.billing,
        g.scope.allocation,
        g.scope.costAttributionPolicy ?? undefined,
      ),
      ...rankPlans(g.items, 0.9, { target: g.target, expansionBudget }),
    })),
  };
}

// A comparison changes one object, keeps all other task/accounting facts fixed,
// and selects the latest observed month independently for each exact condition.
export function buildComparisonGroups(rows: Comparison[], by: 'model' | 'harness') {
  const groups = new Map<string, Comparison[]>();
  for (const row of rows.filter(modelRankingEligible)) {
    const { month: _, ...conditions } = row.cohort;
    const comparable: Record<string, unknown> = {
      ...conditions,
      costCoverage: conditions.costCoverage ?? 'unknown',
      evaluation: conditions.evaluation ?? {
        version: 'legacy',
        difficulty: 'unknown',
        profile: null,
      },
      harnessAttribution: conditions.harnessAttribution ?? 'legacy',
      evidence: {
        cost: row.evidence.cost,
        work: row.evidence.work,
        coverage: row.evidence.coverage,
      },
    };
    if (by === 'model') {
      delete comparable.models;
      delete comparable.modelIdentity;
    } else
      for (const key of [
        'harness',
        'harnessVersion',
        'harnessVariant',
        'harnessSurface',
        'mode',
        'tools',
        'reasoning',
        'cache',
      ])
        delete comparable[key];
    const id = canonical(comparable);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(row);
  }
  return [...groups]
    .map(([id, history]) => {
      const availableMonths = [...new Set(history.map((r) => r.cohort.month))].sort().reverse();
      const month = availableMonths[0];
      const latest = history.filter((r) => r.cohort.month === month);
      const first = latest[0];
      return {
        id,
        by,
        month,
        availableMonths,
        rows: latest,
        history,
        cohort: first.cohort,
        conditions: JSON.parse(id),
        scope: scope(first),
        costBasis: costBasisName(first.cohort.billing, first.cohort.allocation),
      };
    })
    .sort(
      (a, b) =>
        Number(b.rows.length > 1) - Number(a.rows.length > 1) ||
        b.month.localeCompare(a.month) ||
        a.id.localeCompare(b.id),
    );
}
