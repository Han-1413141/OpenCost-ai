import { workDomainForType } from './work-taxonomy.js';

// Feasibility of a declared subtype composition against a known broad-domain plan.
// Capacities are counts, not difficulty points. Equal parent sets share one node.
export function canAllocateComponentTypes(
  types: readonly { workType: string; count: number }[],
  plan: readonly { domain: string; count: number }[],
) {
  const capacities = new Map<string, number>();
  for (const p of plan) capacities.set(p.domain, (capacities.get(p.domain) ?? 0) + p.count);
  const domains = [...capacities.keys()];
  const groups = new Map<string, { parents: string[]; count: number }>();
  for (const type of types) {
    const parents =
      type.workType === 'unknown'
        ? domains
        : (workDomainForType(type.workType)?.parentDomains ?? []).filter((d) => capacities.has(d));
    if (!parents.length) return false;
    const key = parents.slice().sort().join('|');
    const previous = groups.get(key);
    groups.set(key, { parents, count: (previous?.count ?? 0) + type.count });
  }
  const count = types.reduce((s, p) => s + p.count, 0);
  if (count !== plan.reduce((s, p) => s + p.count, 0)) return false;
  const entries = [...groups.values()];
  const source = 0,
    firstDomain = entries.length + 1,
    sink = firstDomain + domains.length;
  const graph: { to: number; reverse: number; capacity: number }[][] = Array.from(
    { length: sink + 1 },
    () => [],
  );
  function edge(from: number, to: number, capacity: number) {
    graph[from].push({ to, capacity, reverse: graph[to].length });
    graph[to].push({ to: from, capacity: 0, reverse: graph[from].length - 1 });
  }
  entries.forEach((g, i) => {
    edge(source, i + 1, g.count);
    for (const parent of g.parents) edge(i + 1, firstDomain + domains.indexOf(parent), g.count);
  });
  domains.forEach((d, i) => edge(firstDomain + i, sink, capacities.get(d)!));
  let flow = 0;
  while (flow < count) {
    const previous = new Array<number>(graph.length).fill(-1);
    const previousEdge = new Array<number>(graph.length).fill(-1);
    const queue = [source];
    previous[source] = source;
    for (let q = 0; q < queue.length && previous[sink] < 0; q++)
      for (let e = 0; e < graph[queue[q]].length; e++) {
        const item = graph[queue[q]][e];
        if (item.capacity > 0 && previous[item.to] < 0) {
          previous[item.to] = queue[q];
          previousEdge[item.to] = e;
          queue.push(item.to);
        }
      }
    if (previous[sink] < 0) return false;
    let amount = count - flow;
    for (let at = sink; at !== source; at = previous[at])
      amount = Math.min(amount, graph[previous[at]][previousEdge[at]].capacity);
    for (let at = sink; at !== source; at = previous[at]) {
      const item = graph[previous[at]][previousEdge[at]];
      item.capacity -= amount;
      graph[at][item.reverse].capacity += amount;
    }
    flow += amount;
  }
  return true;
}
