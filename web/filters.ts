import { buildBoards } from '../shared/boards';
export { buildComparisonGroups as comparisonGroups } from '../shared/boards';
import { taskDomain, type Evidence, type WorkDomain } from '../shared/schema';
import type { DashboardFilters } from './dashboard-filter-state';
export { defaultFilters, type DashboardFilters } from './dashboard-filter-state';
import type { Comparison } from '../shared/analysis';
import type { ExploreData } from './api';

export type UpdateFilters = (patch: Partial<DashboardFilters>) => void;
export type PublicBoards = ReturnType<typeof buildBoards>;
export type ModelBoard = PublicBoards['models'][number];
export type PlanBoard = PublicBoards['plans'][number];
export const evidenceKey = (e: Pick<Evidence, 'cost' | 'work' | 'coverage'>) =>
  `${e.cost}/${e.work}/${e.coverage}`;

export function publicBoards(data: ExploreData | null, domain: WorkDomain) {
  const boards = data?.boards ?? buildBoards(data?.rows ?? [], data?.plans ?? []);
  return {
    ...boards,
    models: boards.models.filter((b) => b.scope.domain === domain),
    plans: boards.plans.filter((b) => b.scope.domain === domain),
  };
}

export function matchesBoardScope(
  row: Pick<Comparison, 'cohort' | 'evidence'>,
  scope: ModelBoard['scope'],
) {
  const c = row.cohort;
  return (
    taskDomain(c.kind) === scope.domain &&
    c.currency === scope.currency &&
    c.billing === scope.billing &&
    c.allocation === scope.allocation &&
    c.payment === scope.payment &&
    (c.costCoverage ?? 'unknown') === scope.costCoverage &&
    (c.evaluation?.version ?? 'legacy') === scope.evaluationVersion &&
    evidenceKey(row.evidence) === evidenceKey(scope.evidence)
  );
}
