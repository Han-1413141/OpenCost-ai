import { z } from 'zod';
import { canonical, CompletedWorkSchema, taskKinds, type Envelope } from '../shared/schema.js';
import { WorkStructureSchema, type WorkStructure } from '../shared/work-structure.js';

const localId = z.string().min(1).max(512);
export const LocalWorkItemSchema = CompletedWorkSchema.safeExtend({
  id: localId,
  taskId: z.string().uuid(),
  artifactId: localId,
  revision: z.number().int().nonnegative().max(100000),
  derivativeOf: localId.nullable(),
  scope: z.enum(['direct', 'aggregate']),
  isFinal: z.boolean(),
  planVersion: localId.nullable(),
}).superRefine((v, ctx) => {
  if (v.planned !== null && v.planVersion === null)
    ctx.addIssue({ code: 'custom', message: '计划数量需要本地原计划或获准变更的版本映射' });
});
export type LocalWorkItem = z.infer<typeof LocalWorkItemSchema>;

export const LocalWorkGraphSchema = z
  .object({
    taskId: z.string().uuid(),
    basis: WorkStructureSchema.shape.basis,
    coverage: WorkStructureSchema.shape.coverage,
    integrationRequired: z.boolean().nullable(),
    integrationAccepted: z.boolean().nullable(),
    nodes: z
      .array(
        z
          .object({
            id: localId,
            parentId: localId.nullable(),
            kind: z.enum(taskKinds),
            role: z.enum(['delivery', 'verification', 'integration', 'container']),
            required: z.boolean().nullable(),
            completed: z.boolean().nullable(),
            accepted: z.boolean().nullable(),
          })
          .strict(),
      )
      .max(5000),
    edges: z
      .array(
        z
          .object({
            from: localId,
            to: localId,
            relation: z.enum(['dependency', 'feedback']),
          })
          .strict(),
      )
      .max(50000),
    sharedStates: z
      .array(
        z
          .object({
            id: localId,
            members: z.array(localId).min(2).max(5000),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();
export type LocalWorkGraph = z.infer<typeof LocalWorkGraphSchema>;

// No recursive traversal and no all-pairs expansion of shared state.
export function summarizeWorkGraph(input: unknown): WorkStructure {
  const g = LocalWorkGraphSchema.parse(input);
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  if (nodes.size !== g.nodes.length) throw new Error('组成部分的本地标识不能重复');
  const checked = new Set<string>();
  for (const n of g.nodes) {
    if (n.accepted === true && n.completed !== true) throw new Error('部分验收必须已经完成');
    const active = new Set<string>();
    let current: typeof n | undefined = n;
    while (current && !checked.has(current.id)) {
      if (active.has(current.id)) throw new Error('组成层级存在循环');
      active.add(current.id);
      if (current.parentId === null) break;
      const parent = nodes.get(current.parentId);
      if (!parent || parent.role !== 'container') throw new Error('组成部分缺少合法的容器父节点');
      current = parent;
    }
    for (const id of active) checked.add(id);
  }
  const parts = g.nodes.filter((n) => n.role !== 'container');
  const ids = new Set(parts.map((n) => n.id));
  const edges = [...new Map(g.edges.map((e) => [canonical(e), e])).values()];
  for (const e of edges)
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to)
      throw new Error('依赖与反馈须连接已登记的不同原子部分');
  const states = new Map<string, string>();
  for (const s of g.sharedStates) {
    if (new Set(s.members).size !== s.members.length || s.members.some((id) => !ids.has(id)))
      throw new Error('共享状态成员必须是不同的已登记部分');
    const value = canonical([...s.members].sort());
    if (states.has(s.id) && states.get(s.id) !== value) throw new Error('同一共享状态对应不同成员');
    states.set(s.id, value);
  }
  const outgoing = new Map(parts.map((p) => [p.id, [] as string[]]));
  const incoming = new Map(parts.map((p) => [p.id, [] as string[]]));
  for (const e of edges) {
    outgoing.get(e.from)!.push(e.to);
    incoming.get(e.to)!.push(e.from);
  }
  const visited = new Set<string>(),
    order: string[] = [];
  for (const id of ids) {
    const stack: [string, boolean][] = [[id, false]];
    while (stack.length) {
      const [v, finished] = stack.pop()!;
      if (finished) {
        order.push(v);
        continue;
      }
      if (visited.has(v)) continue;
      visited.add(v);
      stack.push([v, true]);
      for (const next of outgoing.get(v)!) if (!visited.has(next)) stack.push([next, false]);
    }
  }
  const group = new Map<string, number>(),
    sizes: number[] = [];
  for (const id of order.reverse()) {
    if (group.has(id)) continue;
    const index = sizes.length,
      stack = [id];
    let size = 0;
    while (stack.length) {
      const v = stack.pop()!;
      if (group.has(v)) continue;
      group.set(v, index);
      size++;
      for (const next of incoming.get(v)!) if (!group.has(next)) stack.push(next);
    }
    sizes.push(size);
  }
  const links = sizes.map(() => new Set<number>()),
    indegree = sizes.map(() => 0);
  for (const e of edges) {
    const from = group.get(e.from)!,
      to = group.get(e.to)!;
    if (from !== to && !links[from].has(to)) {
      links[from].add(to);
      indegree[to]++;
    }
  }
  const queue = indegree.flatMap((n, i) => (n === 0 ? [i] : [])),
    depth = sizes.map(() => 0);
  for (let cursor = 0; cursor < queue.length; cursor++)
    for (const to of links[queue[cursor]]) {
      depth[to] = Math.max(depth[to], depth[queue[cursor]] + 1);
      if (--indegree[to] === 0) queue.push(to);
    }
  const dependencies = edges.filter((e) => e.relation === 'dependency').length;
  const feedback = edges.length - dependencies;
  const cycles = sizes.filter((n) => n > 1).length;
  const complete = g.coverage === 'complete' && g.basis !== 'unknown';
  const selected = parts.filter((n) => n.required === true);
  const knownRequired = parts.every((n) => n.required !== null);
  const nullableCount = (key: 'completed' | 'accepted') =>
    complete && parts.every((n) => n[key] !== null)
      ? parts.filter((n) => n[key] === true).length
      : null;
  const iterative = feedback > 0 || cycles > 0;
  const mechanisms =
    Number(dependencies > 0 && !iterative) + Number(states.size > 0) + Number(iterative);
  const coupling = !complete
    ? 'unknown'
    : mechanisms > 1
      ? 'mixed'
      : feedback || cycles
        ? 'iterative'
        : states.size
          ? 'shared_state'
          : dependencies
            ? 'pipeline'
            : parts.length === 1
              ? 'single'
              : 'independent';
  return WorkStructureSchema.parse({
    version: 'work-structure-1',
    basis: g.basis,
    coverage: g.basis === 'unknown' ? 'unknown' : g.coverage,
    componentCount: complete ? parts.length : null,
    requiredComponentCount: complete && knownRequired ? selected.length : null,
    completedComponentCount: nullableCount('completed'),
    acceptedComponentCount: nullableCount('accepted'),
    acceptedRequiredComponentCount:
      complete && knownRequired && selected.every((n) => n.accepted !== null)
        ? selected.filter((n) => n.accepted === true).length
        : null,
    dependencyEdges: complete ? dependencies : null,
    dependencyDepth: complete ? Math.max(0, ...depth) : null,
    sharedStateGroups: complete ? states.size : null,
    feedbackLinks: complete ? feedback : null,
    feedbackCycles: complete ? cycles : null,
    integrationRequired: g.integrationRequired,
    integrationAccepted: g.integrationAccepted,
    coupling,
    observed: {
      componentCount: parts.length,
      dependencyEdges: dependencies,
      sharedStateGroups: states.size,
      feedbackLinks: feedback,
    },
  });
}

export function compileWorkItems(
  items: LocalWorkItem[],
  envelope: Envelope,
  coverage: 'complete' | 'partial' | 'unknown',
) {
  const tasks = new Set(envelope.tasks.map((t) => t.id));
  const identities = new Map<string, string | null>();
  for (const item of items) {
    if (!tasks.has(item.taskId)) throw new Error('成果必须归属已登记的独立目标');
    if (identities.has(item.artifactId) && identities.get(item.artifactId) !== item.derivativeOf)
      throw new Error('同一成果身份对应不同的导出来源');
    identities.set(item.artifactId, item.derivativeOf);
  }
  const roots = new Map<string, string>();
  for (const id of identities.keys()) {
    const chain: string[] = [],
      seen = new Set<string>();
    let current = id;
    while (!roots.has(current)) {
      if (seen.has(current)) throw new Error('成果导出关系存在循环');
      seen.add(current);
      chain.push(current);
      const parent = identities.get(current);
      if (parent === null) break;
      if (parent === undefined || !identities.has(parent))
        throw new Error('缺少原成果身份，无法去重导出版本');
      current = parent;
    }
    const root = roots.get(current) ?? current;
    for (const child of chain) roots.set(child, root);
  }
  const final = new Map<string, LocalWorkItem>();
  for (const item of items.filter(
    (i) => i.scope === 'direct' && i.isFinal && i.derivativeOf === null,
  )) {
    const key = canonical([roots.get(item.artifactId), item.unit]);
    const previous = final.get(key);
    if (previous && previous.taskId !== item.taskId)
      throw new Error('共享成果不能在多个根目标重复计量，请明确唯一归属');
    if (previous && previous.revision === item.revision) {
      const shape = (i: LocalWorkItem) =>
        canonical([
          i.kind,
          i.workType,
          i.planned,
          i.completed,
          i.accepted,
          i.source,
          i.acceptance,
          i.coverage,
          i.planVersion,
        ]);
      if (shape(previous) !== shape(item)) throw new Error('同一成果版本对应不同数量或计量条件');
    }
    if (!previous || item.revision > previous.revision) final.set(key, item);
  }
  for (const item of items.filter(
    (i) => i.scope === 'direct' && i.isFinal && i.derivativeOf !== null,
  )) {
    const original = final.get(canonical([roots.get(item.artifactId), item.unit]));
    if (!original) throw new Error('导出版本需要同单位的原成果最终测量，不能单独充当权威完成量');
    if (
      original.taskId !== item.taskId ||
      item.revision !== original.revision ||
      canonical([
        original.kind,
        original.workType,
        original.planned,
        original.completed,
        original.accepted,
      ]) !== canonical([item.kind, item.workType, item.planned, item.completed, item.accepted])
    )
      throw new Error('格式导出必须对应原成果内容版本与数量，不能用更高导出版本覆盖原成果');
  }
  for (const task of envelope.tasks) {
    const v = task.evaluation;
    if (v?.version !== 'work-summary-1') throw new Error('成果账本需要当前工作摘要协议');
    const groups = new Map<string, LocalWorkItem[]>();
    for (const item of final.values())
      if (item.taskId === task.id) {
        const key = canonical([item.kind, item.workType, item.unit]);
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
      }
    v.completedWork =
      coverage === 'unknown'
        ? null
        : [...groups.values()].map((group) => {
            const first = group[0];
            const sum = (key: 'planned' | 'completed' | 'accepted') =>
              group.every((i) => i[key] !== null) ? group.reduce((n, i) => n + i[key]!, 0) : null;
            const source = group.every((i) => i.source === first.source) ? first.source : 'unknown';
            if (source === 'unknown') throw new Error('同单位成果的来源不同，请核对统一计量依据');
            const acceptance = group.every((i) => i.acceptance === first.acceptance)
              ? first.acceptance
              : 'unknown';
            return CompletedWorkSchema.parse({
              kind: first.kind,
              workType: first.workType,
              unit: first.unit,
              planned: sum('planned'),
              completed: sum('completed'),
              accepted: acceptance === 'unknown' ? null : sum('accepted'),
              source,
              acceptance,
              coverage:
                coverage === 'complete' && group.every((i) => i.coverage === 'complete')
                  ? 'complete'
                  : 'partial',
            });
          });
    if (coverage !== 'complete' && groups.size === 0) v.completedWork = null;
  }
  return {
    finalItems: final.size,
    ignoredAggregateItems: items.filter((i) => i.scope === 'aggregate').length,
  };
}
