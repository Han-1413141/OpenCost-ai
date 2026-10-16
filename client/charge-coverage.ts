import { z } from 'zod';
import { canonical } from '../shared/schema.js';
import { CostEntryAllocationSchema, attributionTargets } from '../shared/cost-attribution.js';
import {
  ChargeReconciliationSchema,
  chargeComponents,
  type ChargeReconciliation,
} from '../shared/charge-reconciliation.js';

const localId = z.string().min(1).max(512);
export const LocalChargeSchema = z
  .object({
    id: localId,
    agentId: localId.nullable(),
    taskId: z.string().uuid().nullable(),
    component: z.enum([...chargeComponents, 'mixed', 'unknown']),
    currency: z.enum(['CNY', 'USD', 'EUR']),
    amountMinor: z.number().int().nonnegative().max(1e10).nullable(),
    scope: z.enum(['direct', 'aggregate']),
    allocation: CostEntryAllocationSchema.optional(),
  })
  .strict();
export const LocalChargeCoverageSchema = z
  .object({
    version: z.literal('charge-coverage-1'),
    periodId: z.string().uuid(),
    basis: z.enum(['collector_record', 'user_report', 'unknown']),
    rootsDisjoint: z.enum(['declared', 'unknown']),
    relations: z
      .array(
        z
          .object({
            parentId: localId,
            childIds: z.array(localId).max(100000),
            childrenDisjoint: z.enum(['declared', 'unknown']),
            childrenCoverage: z.enum(['complete', 'partial']),
            remainderAllocation: CostEntryAllocationSchema.optional(),
            remainderComponent: z.enum([...chargeComponents, 'unknown']).optional(),
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();
type Charge = z.infer<typeof LocalChargeSchema>;
type Coverage = z.infer<typeof LocalChargeCoverageSchema>;
export type ChargeFragment = {
  id: string;
  taskId: string | null;
  agentId: null;
  scope: 'direct';
  component: Charge['component'];
  currency: Charge['currency'];
  amountMinor: number;
  allocation: z.infer<typeof CostEntryAllocationSchema>;
};
type Period = { id: string; currency: Charge['currency']; paidMinor: number | null; refundMinor: number | null };

/** One period's declared economic containment graph, independent of its agent tree. */
export function reconcileCharges(input: {
  charges: Charge[];
  chargeCoverage: Coverage;
  coverage: { charges: 'complete' | 'partial' | 'unknown' };
  envelope: { period: Period };
}): { summary: ChargeReconciliation; fragments: ChargeFragment[] } {
  const graph = LocalChargeCoverageSchema.parse(input.chargeCoverage),
    p = input.envelope.period;
  if (p.paidMinor === null || p.refundMinor === null)
    throw new Error('净实付未知，先保留用量；费用核对需要付款与退款记录');
  if (input.charges.length > 100000) throw new Error('包含图最多处理 100000 条费用观察');
  const issues = new Set<ChargeReconciliation['issues'][number]>();
  const nodes = new Map<string, Charge>();
  for (const raw of input.charges) {
    const c = LocalChargeSchema.parse(raw),
      old = nodes.get(c.id);
    if (old && canonical(old) !== canonical(c)) issues.add('duplicate_conflict');
    nodes.set(c.id, c);
    if (c.currency !== p.currency) issues.add('currency_mismatch');
  }
  if (graph.periodId !== p.id) issues.add('period_mismatch');
  let allocationReferences = 0;
  for (const a of [...nodes.values()]
    .map((c) => c.allocation)
    .concat(graph.relations.map((r) => r.remainderAllocation))) {
    if (!a) continue;
    const ids = attributionTargets(a);
    allocationReferences += ids.length;
    if (allocationReferences > 200000) throw new Error('包含图任务归属引用超过 200000 条');
    if (new Set(ids).size !== ids.length) issues.add('allocation_conflict');
  }
  const relations = new Map<string, Coverage['relations'][number]>(),
    parent = new Map<string, string>();
  let links = 0;
  for (const r of graph.relations) {
    links += r.childIds.length;
    if (links > 200000) throw new Error('包含图引用超过 200000 条，请按不重叠费用范围整理');
    if (relations.has(r.parentId)) issues.add('duplicate_conflict');
    relations.set(r.parentId, r);
    if (!nodes.has(r.parentId)) issues.add('missing_reference');
    if (nodes.get(r.parentId)?.scope === 'direct') issues.add('direct_has_children');
    for (const id of r.childIds) {
      if (!nodes.has(id)) issues.add('missing_reference');
      if (parent.has(id)) issues.add('multiple_parents');
      parent.set(id, r.parentId);
    }
  }
  for (const c of nodes.values())
    if (c.scope === 'aggregate' && !relations.has(c.id)) issues.add('missing_relation');
  const roots = [...nodes.keys()].filter((id) => !parent.has(id));
  const order: string[] = [],
    depths = new Map<string, number>();
  for (const id of roots) {
    order.push(id);
    depths.set(id, 0);
  }
  if (!issues.size)
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      for (const child of relations.get(id)?.childIds ?? []) {
        order.push(child);
        depths.set(child, depths.get(id)! + 1);
      }
    }
  if (!issues.size && order.length !== nodes.size) issues.add('cycle');
  const emptyAmounts = {
    knownTotalMinor: null,
    lowerBoundMinor: null,
    unexplainedMinor: null,
    residualMinor: null,
    unmappedMinor: null,
    unclassifiedMinor: null,
    componentLowerBounds: Object.fromEntries(chargeComponents.map((c) => [c, null])),
  };
  const base = {
    version: 'charge-reconciliation-1' as const,
    basis: graph.basis,
    observedCharges: nodes.size,
    aggregateCharges: [...nodes.values()].filter((c) => c.scope === 'aggregate').length,
    containmentLinks: links,
    roots: roots.length,
    maxDepth: issues.size ? null : order.reduce((n, id) => Math.max(n, depths.get(id)!), 0),
    rootDisjointness: graph.rootsDisjoint,
    unresolvedGroups: 0,
  };
  const conflict = () => ({
    summary: ChargeReconciliationSchema.parse({
      ...base,
      ...emptyAmounts,
      status: 'conflict',
      issues: [...issues].sort(),
    }),
    fragments: [],
  });
  if (issues.size) return conflict();
  const lower = new Map<string, bigint>(),
    exact = new Map<string, boolean>(),
    opaque = new Set<string>();
  const residuals = new Map<string, bigint>();
  // Constant-sized state per node; no descendant lists or recursion.
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i],
      c = nodes.get(id)!,
      r = relations.get(id),
      children = r?.childIds ?? [];
    const disjoint = children.length <= 1 || r?.childrenDisjoint === 'declared';
    let subtotal = 0n;
    for (const child of children) {
      const amount = lower.get(child)!;
      subtotal = disjoint ? subtotal + amount : amount > subtotal ? amount : subtotal;
    }
    const amount = c.amountMinor === null ? null : BigInt(c.amountMinor);
    if (amount !== null && subtotal > amount) issues.add('children_exceed_parent');
    if (
      r?.childrenCoverage === 'complete' &&
      disjoint &&
      children.every((k) => exact.get(k)) &&
      amount !== null &&
      subtotal !== amount
    )
      issues.add('incomplete_partition');
    if (r?.remainderAllocation && r.childrenCoverage === 'complete')
      issues.add('ambiguous_allocation');
    if (r?.remainderComponent && r.childrenCoverage === 'complete')
      issues.add('component_conflict');
    if (
      c.scope === 'aggregate' &&
      c.allocation &&
      (c.allocation.method === 'equal' || c.allocation.method === 'tokens') &&
      children.length
    )
      issues.add('ambiguous_allocation');
    if (!disjoint) {
      opaque.add(id);
      base.unresolvedGroups++;
    }
    if (c.amountMinor === null) base.unresolvedGroups++;
    lower.set(id, amount ?? subtotal);
    exact.set(id, amount !== null);
    residuals.set(id, amount !== null && disjoint && amount >= subtotal ? amount - subtotal : 0n);
  }
  // Explicit whole-node task/category declarations constrain descendants.
  const requiredTask = new Map<string, string>(),
    requiredComponent = new Map<string, Charge['component']>();
  for (const id of order) {
    const c = nodes.get(id)!,
      r = relations.get(id),
      wholeTask = c.allocation?.method === 'direct' ? c.allocation.taskId : undefined;
    const inheritedTask = requiredTask.get(id),
      inheritedComponent = requiredComponent.get(id);
    const own =
      c.allocation ??
      (c.scope === 'direct' && c.taskId
        ? { method: 'direct' as const, taskId: c.taskId }
        : undefined);
    for (const a of [own, r?.remainderAllocation])
      if (a && inheritedTask && attributionTargets(a).some((t) => t !== inheritedTask))
        issues.add('allocation_conflict');
    if (
      wholeTask &&
      r?.remainderAllocation &&
      attributionTargets(r.remainderAllocation).some((t) => t !== wholeTask)
    )
      issues.add('allocation_conflict');
    if (
      inheritedComponent &&
      c.component !== 'unknown' &&
      c.component !== 'mixed' &&
      c.component !== inheritedComponent
    )
      issues.add('component_conflict');
    if (
      r?.remainderComponent &&
      r.remainderComponent !== 'unknown' &&
      ((inheritedComponent && inheritedComponent !== r.remainderComponent) ||
        (chargeComponents.includes(c.component as any) && c.component !== r.remainderComponent))
    )
      issues.add('component_conflict');
    for (const child of r?.childIds ?? []) {
      if (wholeTask ?? inheritedTask) requiredTask.set(child, (wholeTask ?? inheritedTask)!);
      const component = chargeComponents.includes(c.component as any)
        ? c.component
        : inheritedComponent;
      if (component) requiredComponent.set(child, component);
    }
  }
  const disjointRoots = roots.length <= 1 || graph.rootsDisjoint === 'declared';
  let total = 0n;
  for (const id of roots) {
    const n = lower.get(id)!;
    total = disjointRoots ? total + n : n > total ? n : total;
  }
  const net = BigInt(p.paidMinor) - BigInt(p.refundMinor);
  if (total > 10000000000n) issues.add('amount_limit');
  if (total > net) issues.add('exceeds_net');
  const covered =
    input.coverage.charges === 'complete' && disjointRoots && roots.every((id) => exact.get(id));
  if (covered && total !== net) issues.add('complete_total_mismatch');
  if (issues.size) return conflict();
  const fragments: ChargeFragment[] = [];
  let residualTotal = 0n;
  const emit = (
    id: string,
    amount: bigint,
    component: Charge['component'],
    allocation?: ChargeFragment['allocation'],
  ) => {
    // Explicit zero allocations preserve known zero-cost task coverage.
    const a = allocation ?? { method: 'unallocated' as const };
    if (amount === 0n && a.method === 'unallocated') return;
    fragments.push({
      id,
      amountMinor: Number(amount),
      component,
      currency: p.currency,
      scope: 'direct',
      agentId: null,
      taskId: a.method === 'direct' ? a.taskId : null,
      allocation: a,
    });
  };
  if (disjointRoots) {
    const queue = [...roots];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i],
        c = nodes.get(id)!,
        r = relations.get(id),
        inherited = requiredTask.get(id);
      const component = requiredComponent.get(id) ?? c.component;
      if (opaque.has(id)) {
        emit(
          id,
          lower.get(id)!,
          component,
          c.allocation?.method === 'direct'
            ? c.allocation
            : inherited
              ? { method: 'direct', taskId: inherited }
              : undefined,
        );
        continue;
      }
      if (c.scope === 'direct') {
        if (c.amountMinor !== null)
          emit(
            id,
            BigInt(c.amountMinor),
            component,
            c.allocation ??
              (c.taskId
                ? { method: 'direct', taskId: c.taskId }
                : inherited
                  ? { method: 'direct', taskId: inherited }
                  : undefined),
          );
        continue;
      }
      for (const child of r?.childIds ?? []) queue.push(child);
      if (c.amountMinor === null) continue;
      const remainder = residuals.get(id)!;
      residualTotal += remainder;
      // With an unknown child total, this gap may belong to that child. It is
      // not the parent's remainder, so only whole-range declarations apply.
      const exactChildren = (r?.childIds ?? []).every((child) => exact.get(child));
      const allocation =
        (exactChildren ? r?.remainderAllocation : undefined) ??
        c.allocation ??
        (inherited ? { method: 'direct' as const, taskId: inherited } : undefined);
      emit(
        id + ':remainder',
        remainder,
        (exactChildren ? r?.remainderComponent : undefined) ?? component,
        allocation,
      );
    }
  } else base.unresolvedGroups++;
  const components = Object.fromEntries(chargeComponents.map((c) => [c, 0])) as Record<
    (typeof chargeComponents)[number],
    number
  >;
  let unallocated = 0,
    unclassified = 0;
  for (const f of fragments) {
    if (f.allocation.method === 'unallocated') unallocated += f.amountMinor;
    if (chargeComponents.includes(f.component as any))
      components[f.component as keyof typeof components] += f.amountMinor;
    else unclassified += f.amountMinor;
  }
  const sumFragments = fragments.reduce((n, f) => n + BigInt(f.amountMinor), 0n);
  if (disjointRoots && sumFragments !== total) throw new Error('费用包含图金额守恒失败');
  const summary = ChargeReconciliationSchema.parse({
    ...base,
    status: covered ? 'reconciled' : 'partial',
    knownTotalMinor: covered ? Number(total) : null,
    lowerBoundMinor: Number(total),
    unexplainedMinor: Number(net - total),
    residualMinor: disjointRoots ? Number(residualTotal) : null,
    unmappedMinor: disjointRoots ? unallocated : null,
    unclassifiedMinor: disjointRoots ? unclassified : null,
    componentLowerBounds: disjointRoots
      ? components
      : Object.fromEntries(chargeComponents.map((c) => [c, null])),
    issues: [],
  });
  return { summary, fragments };
}
