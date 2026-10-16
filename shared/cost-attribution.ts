import { z } from 'zod';
import type { Envelope, Task } from './schema.js';
import { hasCompleteChargeMapping } from './charge-reconciliation.js';

const money = z.number().int().nonnegative().max(1e10);
const shared = {
  taskIds: z.array(z.string().uuid()).min(1).max(500),
  unassignedWeight: z.number().int().nonnegative().max(1e12),
};
export const CostEntryAllocationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('direct'), taskId: z.string().uuid() }).strict(),
  z.object({ method: z.literal('equal'), ...shared }).strict(),
  z.object({ method: z.literal('tokens'), ...shared }).strict(),
  z.object({ method: z.literal('unallocated') }).strict(),
]);
export const CostAttributionSchema = z
  .object({
    version: z.literal('cost-attribution-1'),
    coverage: z.enum(['complete', 'partial']),
    entries: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            netMinor: money,
            allocation: CostEntryAllocationSchema,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type CostAttribution = z.infer<typeof CostAttributionSchema>;
export const attributionTargets = (a: z.infer<typeof CostEntryAllocationSchema>) =>
  a.method === 'direct' ? [a.taskId] : a.method === 'unallocated' ? [] : a.taskIds;

type Input = {
  period: {
    allocation: string;
    billing: string;
    coverage: string;
    paidMinor: number;
    refundMinor: number;
    unassignedWeight: number;
    costAttribution?: CostAttribution;
  };
  tasks: {
    id: string;
    directCostMinor: number;
    models: { inputTokens: number | null; outputTokens: number | null }[];
  }[];
};
export function validateCostAttribution(v: Input, ctx: z.RefinementCtx) {
  const p = v.period,
    attribution = p.costAttribution;
  const issue = (message: string) =>
    ctx.addIssue({ code: 'custom', path: ['period', 'costAttribution'], message });
  if (p.allocation !== 'itemized') {
    if (attribution) issue('逐项归属明细只能与 itemized 一起使用');
    return;
  }
  if (!attribution) {
    issue('逐项归属需要明确的费用明细及覆盖范围');
    return;
  }
  if (p.unassignedWeight !== 0 || v.tasks.some((t) => t.directCostMinor !== 0))
    issue('逐项归属时旧逐任务费用及账期未归属权重必须为零，避免重复解释');
  const tasks = new Map(v.tasks.map((t) => [t.id, t]));
  const covered = new Set<string>();
  let references = 0,
    total = 0;
  if (new Set(attribution.entries.map((e) => e.id)).size !== attribution.entries.length)
    issue('费用明细标识不能重复');
  for (const entry of attribution.entries) {
    total += entry.netMinor;
    const a = entry.allocation,
      ids = attributionTargets(a);
    references += ids.length;
    if (new Set(ids).size !== ids.length || ids.some((id) => !tasks.has(id)))
      issue('每行任务引用须存在且不重复');
    ids.forEach((id) => covered.add(id));
    if (a.method === 'equal' || a.method === 'tokens') {
      if (p.billing === 'api') issue('纯 API 逐项实付不能用共享权重替代账单归属');
      if (p.coverage !== 'complete') issue('不完整周期不能推算共享费用分摊');
      if (
        a.method === 'tokens' &&
        ids.some((id) =>
          tasks.get(id)?.models.some((m) => m.inputTokens === null || m.outputTokens === null),
        )
      )
        issue('该共享费用覆盖的任务缺少 Token，不能按 Token 分摊');
    }
  }
  if (references > 5000) issue('单份费用明细最多包含 5000 个任务引用');
  const net = p.paidMinor - p.refundMinor;
  if (total > net) issue('费用明细合计超过账期净实付');
  if (
    attribution.coverage === 'complete' &&
    (total !== net || v.tasks.some((t) => !covered.has(t.id)))
  )
    issue('完整费用明细须对齐净实付并覆盖每项目标；已知零费用须明确登记');
}

// Pure accounting: validated amounts are already net, in one period currency.
// Zero or unknown weights leave this entry unallocated; they never erase direct costs.
export function allocateItemized(e: Envelope) {
  const net = e.period.paidMinor - e.period.refundMinor;
  const direct = e.tasks.map(() => 0),
    shared = e.tasks.map(() => 0);
  const indexes = new Map(e.tasks.map((t, i) => [t.id, i]));
  const covered = new Set<string>();
  // Merge equal rules before rounding: splitting two cents into two one-cent
  // lines must not turn an equal 1/1 allocation into 2/0.
  const pools = new Map<string, CostAttribution['entries'][number]>();
  for (const entry of e.period.costAttribution?.entries ?? []) {
    const a = entry.allocation;
    const allocation =
      a.method === 'equal' || a.method === 'tokens'
        ? { method: a.method, taskIds: [...a.taskIds].sort(), unassignedWeight: a.unassignedWeight }
        : a;
    const key = JSON.stringify(allocation),
      existing = pools.get(key);
    if (existing) existing.netMinor += entry.netMinor;
    else pools.set(key, { ...entry, allocation });
  }
  for (const entry of pools.values()) {
    const a = entry.allocation;
    attributionTargets(a).forEach((id) => covered.add(id));
    if (a.method === 'unallocated') continue;
    if (a.method === 'direct') {
      const i = indexes.get(a.taskId);
      if (i !== undefined) direct[i] += entry.netMinor;
      continue;
    }
    const targets = a.taskIds.map((id) => ({ id, index: indexes.get(id) }));
    if (targets.some((t) => t.index === undefined)) continue;
    // UUID order makes a one-cent tie stable under task/entry reordering.
    targets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const weights = targets.map((t) =>
      a.method === 'equal'
        ? 1n
        : e.tasks[t.index!].models.reduce<bigint | null>(
            (sum, m) =>
              sum === null || m.inputTokens === null || m.outputTokens === null
                ? null
                : sum + BigInt(m.inputTokens) + BigInt(m.outputTokens),
            0n,
          ),
    );
    if (weights.some((w) => w === null)) continue;
    const knownWeights = [...(weights as bigint[]), BigInt(a.unassignedWeight)];
    const sum = knownWeights.reduce((a, b) => a + b, 0n);
    if (!sum) continue;
    const shares = knownWeights.map((w) => Number((BigInt(entry.netMinor) * w) / sum));
    const remainder = knownWeights
      .map((w, i) => ({ i, r: (BigInt(entry.netMinor) * w) % sum }))
      .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
    const left = entry.netMinor - shares.reduce((a, b) => a + b, 0);
    for (let i = 0; i < left; i++) shares[remainder[i].i]++;
    targets.forEach((t, i) => {
      shared[t.index!] += shares[i];
    });
  }
  const costs = direct.map((n, i) => n + shared[i]);
  return {
    net,
    costs,
    unallocated: net - costs.reduce((a, b) => a + b, 0),
    direct,
    shared,
    coveredTasks: covered.size,
    complete: e.period.costAttribution?.coverage === 'complete',
  };
}

export const hasCompleteCostAttribution = (period: Envelope['period']) =>
  hasCompleteChargeMapping(period) &&
  (period.allocation !== 'itemized' || period.costAttribution?.coverage === 'complete');

export function hasComparableCostAttribution(cohort: {
  allocation: string;
  costAttributionPolicy?: ReturnType<typeof costAttributionPolicy>;
}) {
  if (cohort.allocation !== 'itemized') return true;
  const p = cohort.costAttributionPolicy;
  return (
    p?.version === 'cost-attribution-1' &&
    Array.isArray(p.methods) &&
    p.methods.length > 0 &&
    p.methods.every((m) => ['direct', 'equal', 'tokens'].includes(m)) &&
    Array.isArray(p.periodMethods) &&
    p.periodMethods.length > 0 &&
    p.periodMethods.every((m) => ['direct', 'equal', 'tokens', 'unallocated'].includes(m))
  );
}

export function costAttributionPolicy(task: Task, period: Envelope['period']) {
  if (period.allocation !== 'itemized') return undefined;
  return {
    version: period.costAttribution?.version ?? 'unknown',
    periodMethods: [
      ...new Set((period.costAttribution?.entries ?? []).map((e) => e.allocation.method)),
    ].sort(),
    methods: [
      ...new Set(
        (period.costAttribution?.entries ?? [])
          .filter((e) => attributionTargets(e.allocation).includes(task.id))
          .map((e) => e.allocation.method),
      ),
    ].sort(),
  };
}

export function costAttributionMethodsLabel(policy: ReturnType<typeof costAttributionPolicy>) {
  const labels: Record<string, string> = {
    direct: '直接归属',
    equal: '按任务分摊',
    tokens: '按 Token 分摊',
    unallocated: '未归属',
  };
  return policy?.version === 'cost-attribution-1'
    ? policy.methods.map((m) => labels[m] ?? '未知规则').join(' + ')
    : '归属规则未记录';
}
