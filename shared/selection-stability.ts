import { z } from 'zod';
import { MIN_TASKS, MIN_SOURCES, MAX_SOURCE_SHARE } from './schema.js';
import { groupResamplingGenerator, type ResamplingGroup } from './ranking-resampling.js';

export const selectionStabilityPolicy = {
  replicates: 1000,
  minGroups: 20,
  maxSlots: 8192,
  maxGroups: 20000,
  maxEntries: 100000,
  maxOperations: 20000000,
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bounds = z
  .object({
    lower: z.number().int().min(0).max(100).multipleOf(10),
    upper: z.number().int().min(0).max(100).multipleOf(10),
  })
  .strict()
  .refine((v) => v.lower <= v.upper);
const publicCondition = z
  .object({ conditionId: hash, exactChoice: bounds, costMinimum: bounds })
  .strict();
const publicModel = z
  .object({
    modelId: z.string().min(1).max(1024),
    state: z.enum(['measured', 'suppressed', 'capacity']),
    reason: z.enum([
      'complete',
      'base_incomplete',
      'few_groups',
      'distribution_support',
      'work_budget',
    ]),
    route: bounds.nullable(),
    leader: bounds.nullable(),
    unresolved: bounds.nullable(),
    conditions: z.array(publicCondition).max(256),
  })
  .strict()
  .superRefine((m, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: '重选稳定性状态与公开字段不一致' });
    if (new Set(m.conditions.map((c) => c.conditionId)).size !== m.conditions.length) fail();
    if (m.state === 'measured') {
      if (m.reason !== 'complete' || !m.route || !m.unresolved || !m.conditions.length) {
        fail();
        return;
      }
      for (const c of m.conditions)
        if (
          c.exactChoice.lower > c.costMinimum.lower ||
          c.exactChoice.upper > c.costMinimum.upper ||
          m.route!.lower > c.exactChoice.lower ||
          m.route!.upper > c.exactChoice.upper
        )
          fail();
    } else if (
      m.route ||
      m.leader ||
      m.unresolved ||
      m.conditions.length ||
      (m.state === 'capacity') !== (m.reason === 'work_budget') ||
      m.reason === 'complete'
    )
      fail();
  });
export const SelectionStabilitySchema = z
  .object({
    version: z.literal('selection-stability-1'),
    method: z.literal('selection_partition_group_bootstrap_reselect'),
    inference: z.literal('observed_selection_frequency_not_win_probability'),
    partition: z.literal('selection_only'),
    replicates: z.literal(selectionStabilityPolicy.replicates),
    seedDigest: hash,
    unit: z.literal('connected_owner_and_confirmed_source'),
    candidateUniverse: z.literal('initially_supported_selection_configurations'),
    frequency: z.literal('all_replicates_unknown_bounds_outward_ten_percentage_points'),
    comparisonModels: z.number().int().min(0).max(128),
    models: z.array(publicModel).max(128),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.models.map((m) => m.modelId)).size !== v.models.length ||
      v.models.reduce((n, m) => n + m.conditions.length, 0) > 8192 ||
      (v.comparisonModels < 2 && v.models.some((m) => m.leader !== null))
    )
      ctx.addIssue({ code: 'custom', message: '重选稳定性模型集合不一致' });
  });
export type SelectionStability = z.infer<typeof SelectionStabilitySchema>;
export type SelectionFrequencyCounts = { yes: number; no: number; unknown: number };
export type SelectionStabilityInput = {
  seed: string;
  seedDigest: string;
  comparisonModels: number;
  slots: {
    key: string;
    count: number;
    accepted: number;
    spendMinor: number;
    groups: number;
    distributionAllowed: boolean;
  }[];
  groups: ResamplingGroup[];
  models: {
    id: string;
    complete: boolean;
    conditions: { id: string; weight: number; original: number; candidates: number[] }[];
  }[];
};
export type InternalSelectionStability = Omit<SelectionStability, 'models' | 'frequency'> & {
  operations: number;
  models: {
    modelId: string;
    state: 'measured' | 'suppressed' | 'capacity';
    reason: z.infer<typeof publicModel>['reason'];
    route: SelectionFrequencyCounts | null;
    leader: SelectionFrequencyCounts | null;
    unresolved: SelectionFrequencyCounts | null;
    conditions: {
      conditionId: string;
      exactChoice: SelectionFrequencyCounts;
      costMinimum: SelectionFrequencyCounts;
    }[];
  }[];
};
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
const empty = (): SelectionFrequencyCounts => ({ yes: 0, no: 0, unknown: 0 });
const invalid = () => {
  throw new Error('重选矩阵关系或数值无效，不能截断或补零');
};
const capacity = () =>
  Object.assign(new Error('重选统计超过工作容量，整份附加统计未计算'), {
    code: 'selection_stability_capacity',
  });
const base = (input: Pick<SelectionStabilityInput, 'seedDigest' | 'comparisonModels'>) => ({
  version: 'selection-stability-1' as const,
  method: 'selection_partition_group_bootstrap_reselect' as const,
  inference: 'observed_selection_frequency_not_win_probability' as const,
  partition: 'selection_only' as const,
  replicates: selectionStabilityPolicy.replicates,
  seedDigest: input.seedDigest,
  unit: 'connected_owner_and_confirmed_source' as const,
  candidateUniverse: 'initially_supported_selection_configurations' as const,
  comparisonModels: input.comparisonModels,
});

/** Known draws remain in the denominator. Bounds also include every unresolved draw. */
export function selectionFrequencyBounds(c: SelectionFrequencyCounts) {
  if (
    Object.values(c).some((n) => !safe(n)) ||
    c.yes + c.no + c.unknown !== selectionStabilityPolicy.replicates
  )
    return invalid();
  return { lower: Math.floor(c.yes / 100) * 10, upper: Math.ceil((c.yes + c.unknown) / 100) * 10 };
}

export function unavailableSelectionStability(
  seedDigest: string,
  comparisonModels: number,
  models: { id: string; complete: boolean }[],
): InternalSelectionStability {
  return {
    ...base({ seedDigest, comparisonModels }),
    operations: 0,
    models: models.map((m) => ({
      modelId: m.id,
      state: m.complete ? 'capacity' : 'suppressed',
      reason: m.complete ? 'work_budget' : 'base_incomplete',
      route: null,
      leader: null,
      unresolved: null,
      conditions: [],
    })),
  };
}

/** Input is a private numeric matrix, never an upload or public schema. */
export function resampleSelectionStability(
  input: SelectionStabilityInput,
): InternalSelectionStability {
  const { slots, models } = input,
    groups = [...input.groups].sort((a, b) => a.id.localeCompare(b.id));
  if (
    !/^[a-f0-9]{64}$/.test(input.seed) ||
    !/^[a-f0-9]{64}$/.test(input.seedDigest) ||
    !safe(input.comparisonModels) ||
    input.comparisonModels > models.length ||
    input.comparisonModels < models.filter((m) => m.complete).length ||
    models.length > 128 ||
    new Set(models.map((m) => m.id)).size !== models.length
  )
    return invalid();
  if (
    slots.length > selectionStabilityPolicy.maxSlots ||
    groups.length > selectionStabilityPolicy.maxGroups
  )
    throw capacity();
  const n = new Float64Array(slots.length),
    a = new Float64Array(slots.length),
    c = new Float64Array(slots.length),
    g = new Uint32Array(slots.length),
    largest = new Float64Array(slots.length);
  let entries = 0;
  const owned = new Set<number>();
  for (const m of models) {
    if (
      !m.id ||
      m.id.length > 1024 ||
      typeof m.complete !== 'boolean' ||
      m.conditions.length > 256 ||
      (!m.complete && m.conditions.length) ||
      (m.complete && !m.conditions.length) ||
      new Set(m.conditions.map((x) => x.id)).size !== m.conditions.length
    )
      return invalid();
    let weight = 0;
    for (const condition of m.conditions) {
      if (
        !/^[a-f0-9]{64}$/.test(condition.id) ||
        !Number.isFinite(condition.weight) ||
        condition.weight <= 0 ||
        !condition.candidates.length ||
        new Set(condition.candidates).size !== condition.candidates.length ||
        !condition.candidates.includes(condition.original)
      )
        return invalid();
      weight += condition.weight;
      for (const slot of condition.candidates) {
        if (!safe(slot) || slot >= slots.length || owned.has(slot)) return invalid();
        owned.add(slot);
      }
      if (
        new Set(condition.candidates.map((slot) => slots[slot].key)).size !==
        condition.candidates.length
      )
        return invalid();
    }
    if (m.complete && Math.abs(weight - 1) > 1e-12) return invalid();
  }
  if (owned.size !== slots.length || new Set(groups.map((g) => g.id)).size !== groups.length)
    return invalid();
  for (const group of groups) {
    if (
      !/^[a-f0-9]{64}$/.test(group.id) ||
      new Set(group.cells.map((v) => v.slot)).size !== group.cells.length
    )
      return invalid();
    for (const v of group.cells) {
      if (++entries > selectionStabilityPolicy.maxEntries) throw capacity();
      if (
        !owned.has(v.slot) ||
        !safe(v.count) ||
        v.count === 0 ||
        !safe(v.accepted) ||
        v.accepted > v.count ||
        !safe(v.spendMinor)
      )
        return invalid();
      n[v.slot] += v.count;
      a[v.slot] += v.accepted;
      c[v.slot] += v.spendMinor;
      g[v.slot]++;
      largest[v.slot] = Math.max(largest[v.slot], v.count);
    }
  }
  for (const [i, slot] of slots.entries())
    if (
      !slot.key ||
      !safe(slot.count) ||
      !safe(slot.spendMinor) ||
      !safe(slot.accepted) ||
      !safe(slot.groups) ||
      slot.accepted > slot.count ||
      !slot.count ||
      !slot.groups ||
      typeof slot.distributionAllowed !== 'boolean' ||
      !safe(n[i]) ||
      !safe(c[i]) ||
      n[i] !== slot.count ||
      a[i] !== slot.accepted ||
      c[i] !== slot.spendMinor ||
      g[i] !== slot.groups
    )
      return invalid();
  const result: InternalSelectionStability = {
    ...base(input),
    operations: 0,
    models: models.map((m) => {
      const candidates = m.conditions.flatMap((c) => c.candidates.map((i) => slots[i]));
      const reason = !m.complete
        ? 'base_incomplete'
        : candidates.some((c) => c.groups < selectionStabilityPolicy.minGroups)
          ? 'few_groups'
          : candidates.some((c) => !c.distributionAllowed)
            ? 'distribution_support'
            : 'complete';
      return {
        modelId: m.id,
        reason,
        state: reason === 'complete' ? 'measured' : 'suppressed',
        route: reason === 'complete' ? empty() : null,
        leader: null,
        unresolved: reason === 'complete' ? empty() : null,
        conditions:
          reason === 'complete'
            ? m.conditions.map((c) => ({
                conditionId: c.id,
                exactChoice: empty(),
                costMinimum: empty(),
              }))
            : [],
      };
    }),
  };
  const work =
    selectionStabilityPolicy.replicates *
    (2 * groups.length + 7 * slots.length + entries + models.length);
  if (result.models.every((m) => m.state !== 'measured')) return result;
  if (work > selectionStabilityPolicy.maxOperations)
    return unavailableSelectionStability(input.seedDigest, input.comparisonModels, models);
  const step = (k = 1) => {
    result.operations += k;
    if (result.operations > selectionStabilityPolicy.maxOperations) throw capacity();
  };
  const next = groupResamplingGenerator(input.seed),
    weights = new Uint32Array(groups.length),
    ceiling = groups.length ? Math.floor(2 ** 32 / groups.length) * groups.length : 0;
  const compare = (i: number, j: number) =>
    c[i] / a[i] - c[j] / a[j] ||
    a[j] / n[j] - a[i] / n[i] ||
    g[j] - g[i] ||
    n[j] - n[i] ||
    slots[i].key.localeCompare(slots[j].key);
  const eligible = (i: number) =>
    n[i] >= MIN_TASKS && g[i] >= MIN_SOURCES && largest[i] / n[i] <= MAX_SOURCE_SHARE && a[i] > 0;
  for (const model of models)
    for (const condition of model.conditions) {
      const first = [...condition.candidates].filter(eligible).sort(compare)[0];
      if (first !== condition.original) return invalid();
    }
  const comparableIndices = result.models.flatMap((m, i) => (m.state === 'measured' ? [i] : []));
  const leaderAvailable =
    input.comparisonModels >= 2 && comparableIndices.length === input.comparisonModels;
  if (leaderAvailable)
    comparableIndices.forEach((i) => {
      result.models[i].leader = empty();
    });
  for (let b = 0; b < selectionStabilityPolicy.replicates; b++) {
    weights.fill(0);
    n.fill(0);
    a.fill(0);
    c.fill(0);
    g.fill(0);
    largest.fill(0);
    step(6 * slots.length);
    for (let draw = 0; draw < groups.length; draw++) {
      let value: number;
      do {
        step();
        value = next();
      } while (value >= ceiling);
      weights[value % groups.length]++;
    }
    for (let index = 0; index < groups.length; index++) {
      step();
      const weight = weights[index];
      if (!weight) continue;
      for (const value of groups[index].cells) {
        step();
        n[value.slot] += weight * value.count;
        a[value.slot] += weight * value.accepted;
        c[value.slot] += weight * value.spendMinor;
        g[value.slot]++;
        largest[value.slot] = Math.max(largest[value.slot], weight * value.count);
      }
    }
    for (let i = 0; i < slots.length; i++)
      if (!safe(n[i]) || !safe(a[i]) || !safe(c[i])) throw capacity();
    const costs: (number | null)[] = [];
    for (const [index, model] of models.entries()) {
      step();
      const summary = result.models[index];
      if (summary.state !== 'measured') {
        costs[index] = null;
        continue;
      }
      let route = true,
        unresolved = false,
        spend = 0,
        acceptance = 0;
      for (const [ci, condition] of model.conditions.entries()) {
        let selected: number | null = null;
        for (const slot of condition.candidates) {
          step();
          if (eligible(slot) && (selected === null || compare(slot, selected) < 0)) selected = slot;
        }
        const stats = summary.conditions[ci];
        if (selected === null) {
          stats.exactChoice.unknown++;
          stats.costMinimum.unknown++;
          unresolved = true;
          continue;
        }
        const retained = selected === condition.original;
        stats.exactChoice[retained ? 'yes' : 'no']++;
        stats.costMinimum[
          eligible(condition.original) &&
          c[condition.original] / a[condition.original] === c[selected] / a[selected]
            ? 'yes'
            : 'no'
        ]++;
        route &&= retained;
        spend += (condition.weight * c[selected]) / n[selected];
        acceptance += (condition.weight * a[selected]) / n[selected];
      }
      summary.route![!route ? 'no' : unresolved ? 'unknown' : 'yes']++;
      summary.unresolved![unresolved ? 'yes' : 'no']++;
      costs[index] = unresolved ? null : spend / acceptance;
      if (costs[index] !== null && !Number.isFinite(costs[index])) throw capacity();
    }
    if (leaderAvailable) {
      const unresolved = comparableIndices.some((i) => costs[i] === null),
        best = unresolved ? null : Math.min(...comparableIndices.map((i) => costs[i]!));
      comparableIndices.forEach((i) => {
        result.models[i].leader![unresolved ? 'unknown' : costs[i] === best ? 'yes' : 'no']++;
      });
    }
  }
  return result;
}

export function publicSelectionStability(result: InternalSelectionStability): SelectionStability {
  return SelectionStabilitySchema.parse({
    ...base(result),
    frequency: 'all_replicates_unknown_bounds_outward_ten_percentage_points',
    models: result.models.map((m) => ({
      modelId: m.modelId,
      state: m.state,
      reason: m.reason,
      route: m.route && selectionFrequencyBounds(m.route),
      leader: m.leader && selectionFrequencyBounds(m.leader),
      unresolved: m.unresolved && selectionFrequencyBounds(m.unresolved),
      conditions: m.conditions.map((c) => ({
        conditionId: c.conditionId,
        exactChoice: selectionFrequencyBounds(c.exactChoice),
        costMinimum: selectionFrequencyBounds(c.costMinimum),
      })),
    })),
  });
}
