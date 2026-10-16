import { MAX_SOURCE_SHARE, MIN_SOURCES, MIN_TASKS } from './schema.js';
import { z } from 'zod';

export const SOURCE_SUPPORT_VERSION = 'source-support-1' as const;

// These are source-weight diagnostics, not independent-user counts or a
// confidence interval. Sources can remain related after evidence attribution.
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const amount = z.number().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export const SourceSupportSchema = z
  .object({
    version: z.literal(SOURCE_SUPPORT_VERSION),
    sources: count,
    effectiveSources: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
    maxTaskShare: z.number().min(0).max(1),
    zeroAcceptedSources: count,
    acceptedCostSources: count,
    // Conditional distribution over sources with at least one accepted task.
    // Each such source contributes its entire spend, including failed tasks.
    costPerAcceptedP25: amount,
    costPerAcceptedP50: amount,
    costPerAcceptedP75: amount,
    distributionCoverage: z.enum(['complete', 'partial', 'suppressed']),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (value.zeroAcceptedSources + value.acceptedCostSources !== value.sources)
      issue('验收来源和零验收来源必须合计为全部来源');
    if (value.effectiveSources > value.sources + 1e-10)
      issue('按任务权重折算的来源数不能超过来源数');
    const quartiles = [
      value.costPerAcceptedP25,
      value.costPerAcceptedP50,
      value.costPerAcceptedP75,
    ];
    if (value.distributionCoverage === 'suppressed') {
      if (quartiles.some((n) => n !== null)) issue('未披露的成本分布不能包含分位数');
    } else {
      if (!value.acceptedCostSources || quartiles.some((n) => n === null))
        issue('已披露的成本分布需要有验收来源及完整分位数');
      if (quartiles[0]! > quartiles[1]! || quartiles[1]! > quartiles[2]!)
        issue('成本分位数必须按顺序排列');
      if ((value.distributionCoverage === 'complete') !== (value.zeroAcceptedSources === 0))
        issue('成本分布的覆盖状态必须说明零验收来源');
    }
  });

export type SourceSupport = z.infer<typeof SourceSupportSchema>;

type SourceGroup = { tasks: number; spend: number; accepted: number };

export function sourceCostDistributionAllowed(tasks: number, sources: number, largest: number) {
  return tasks >= MIN_TASKS && sources >= MIN_SOURCES && largest / tasks <= MAX_SOURCE_SHARE;
}

export function summarizeSourceSupport(
  groups: readonly SourceGroup[],
  publicOnly = false,
): SourceSupport {
  const tasks = groups.reduce((sum, group) => sum + group.tasks, 0);
  const acceptedGroups = groups.filter((group) => group.accepted > 0);
  const acceptedTasks = acceptedGroups.reduce((sum, group) => sum + group.tasks, 0);
  const largestAccepted = acceptedGroups.reduce((max, group) => Math.max(max, group.tasks), 0);
  const allowed =
    acceptedGroups.length > 0 &&
    (!publicOnly ||
      sourceCostDistributionAllowed(acceptedTasks, acceptedGroups.length, largestAccepted));
  const costs = allowed
    ? acceptedGroups.map((group) => group.spend / group.accepted).sort((a, b) => a - b)
    : [];
  const quantile = (p: number) => {
    if (!costs.length) return null;
    const index = (costs.length - 1) * p;
    const low = costs[Math.floor(index)],
      high = costs[Math.ceil(index)];
    return low + (high - low) * (index - Math.floor(index));
  };
  // Kish's weight concentration formula, used descriptively. Divide the sum
  // of squared counts by the total first, matching SQLite's real arithmetic.
  const squaredCounts = groups.reduce((sum, group) => sum + group.tasks * group.tasks, 0);
  return {
    version: SOURCE_SUPPORT_VERSION,
    sources: groups.length,
    effectiveSources: tasks ? tasks / (squaredCounts / tasks) : 0,
    maxTaskShare: tasks ? groups.reduce((max, group) => Math.max(max, group.tasks), 0) / tasks : 0,
    zeroAcceptedSources: groups.length - acceptedGroups.length,
    acceptedCostSources: acceptedGroups.length,
    costPerAcceptedP25: quantile(0.25),
    costPerAcceptedP50: quantile(0.5),
    costPerAcceptedP75: quantile(0.75),
    distributionCoverage: !allowed
      ? 'suppressed'
      : acceptedGroups.length === groups.length
        ? 'complete'
        : 'partial',
  };
}
