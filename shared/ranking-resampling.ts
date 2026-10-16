import { z } from 'zod';

export const GROUP_RESAMPLING_VERSION = 'group-resampling-1';
export const groupResamplingPolicy = {
  replicates: 1000,
  centralMass: 0.95,
  minGroupsPerCell: 20,
  maxGroups: 20000,
  maxSlots: 8192,
  maxEntries: 100000,
  maxOperations: 40000000,
} as const;
const nonnegative = z.number().finite().nonnegative(),
  integer = z.number().int().safe().nonnegative(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const endpoint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('finite'), value: nonnegative }).strict(),
  z.object({ kind: z.literal('unbounded') }).strict(),
]);
export const ResamplingCountsSchema = z
  .object({
    finite: integer,
    zeroAcceptancePaid: integer,
    undefinedZeroOverZero: integer,
    missingCondition: integer,
  })
  .strict();
export const GroupResamplingModelSchema = z
  .object({
    modelId: z.string().min(1).max(1024),
    state: z.enum(['range', 'unbounded_range', 'degenerate', 'suppressed', 'capacity']),
    reason: z.enum([
      'complete',
      'observed_values_identical',
      'all_accepted',
      'all_zero_acceptance',
      'base_incomplete',
      'few_groups',
      'distribution_support',
      'work_budget',
    ]),
    boundary: z.enum(['mixed', 'all_accepted', 'all_zero_acceptance', 'unknown']),
    minGroupsPerCell: integer.nullable(),
    counts: ResamplingCountsSchema.nullable(),
    range: z.object({ lower: endpoint, upper: endpoint }).strict().nullable(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (m.reason === 'base_incomplete') {
      if (m.state !== 'suppressed' || m.boundary !== 'unknown' || m.minGroupsPerCell !== null)
        fail('基础缺项状态不一致');
    } else if (m.boundary === 'unknown' || m.minGroupsPerCell === null || m.minGroupsPerCell < 1)
      fail('完整评价需要已知分组与边界');
    if (
      m.state === 'suppressed' &&
      !['base_incomplete', 'few_groups', 'distribution_support'].includes(m.reason)
    )
      fail('隐藏原因不一致');
    if ((m.state === 'capacity') !== (m.reason === 'work_budget')) fail('容量状态不一致');
    if (
      m.reason === 'few_groups' &&
      (m.minGroupsPerCell === null || m.minGroupsPerCell >= groupResamplingPolicy.minGroupsPerCell)
    )
      fail('少组原因不一致');
    if (m.state !== 'suppressed' && m.minGroupsPerCell! < groupResamplingPolicy.minGroupsPerCell)
      fail('少组不得公开分布');
    if (
      ['range', 'unbounded_range'].includes(m.state) &&
      (m.reason !== 'complete' || m.boundary !== 'mixed')
    )
      fail('范围需要混合验收观测');
    if (
      m.state === 'degenerate' &&
      !(
        (m.boundary === 'all_accepted' && m.reason === 'all_accepted') ||
        (m.boundary === 'all_zero_acceptance' && m.reason === 'all_zero_acceptance') ||
        (m.boundary === 'mixed' && m.reason === 'observed_values_identical')
      )
    )
      fail('退化原因不一致');
    if (m.state === 'suppressed' || m.state === 'capacity') {
      if (m.counts !== null || m.range !== null) fail('不足支持或超预算不披露分布');
    } else {
      if (
        !m.counts ||
        Object.values(m.counts).reduce((a, b) => a + b, 0) !== groupResamplingPolicy.replicates
      )
        fail('重复分类必须保留全部预定次数');
      if (m.state === 'degenerate' && m.range !== null) fail('退化观测不展示区间');
      if (m.state !== 'degenerate' && !m.range) fail('重采样范围缺失');
    }
    if (m.range) {
      const lo = m.range.lower,
        hi = m.range.upper;
      if (
        (lo.kind === 'unbounded' && hi.kind !== 'unbounded') ||
        (lo.kind === 'finite' && hi.kind === 'finite' && lo.value > hi.value)
      )
        fail('范围顺序错误');
      if ((m.state === 'unbounded_range') !== (hi.kind === 'unbounded')) fail('无界状态不一致');
      if (m.counts) {
        const unknown = m.counts.missingCondition + m.counts.undefinedZeroOverZero;
        const lowerRank = Math.ceil(groupResamplingPolicy.replicates / 40),
          upperRank = Math.ceil((groupResamplingPolicy.replicates * 39) / 40);
        if ((hi.kind === 'finite') !== m.counts.finite >= upperRank)
          fail('上界与有限重复次数不一致');
        if ((lo.kind === 'finite') !== unknown + m.counts.finite >= lowerRank)
          fail('下界与已知重复次数不一致');
        if (unknown >= lowerRank && (lo.kind !== 'finite' || lo.value !== 0))
          fail('未知重复达到下分位时下界必须为0');
      }
    }
    if (
      m.reason === 'observed_values_identical' &&
      m.counts?.finite !== groupResamplingPolicy.replicates
    )
      fail('相同有限观测需要全部重复有限');
    if (
      m.counts &&
      m.boundary === 'all_accepted' &&
      (m.counts.zeroAcceptancePaid || m.counts.undefinedZeroOverZero)
    )
      fail('全验收重复不能形成零验收');
    if (m.counts && m.boundary === 'all_zero_acceptance' && m.counts.finite)
      fail('全零验收重复不能形成有限比值');
  });
export const GroupResamplingSchema = z
  .object({
    version: z.literal(GROUP_RESAMPLING_VERSION),
    method: z.literal('pairs_known_group_bootstrap_fixed_policy'),
    inference: z.literal('observed_resampling_not_calibrated_confidence_interval'),
    replicates: z.literal(groupResamplingPolicy.replicates),
    centralMass: z.literal(groupResamplingPolicy.centralMass),
    unit: z.literal('connected_owner_and_confirmed_source'),
    quantiles: z.literal('inverse_empirical_cdf_unknowns_low_zero_high_unbounded'),
    randomGenerator: z.literal('xoshiro128starstar_rejection_index_1'),
    seedDigest: hash,
    conditionalOn: z.literal('frozen_model_and_harness_selection'),
    models: z.array(GroupResamplingModelSchema).max(128),
  })
  .strict()
  .refine((r) => new Set(r.models.map((m) => m.modelId)).size === r.models.length);
export type GroupResampling = z.infer<typeof GroupResamplingSchema>;
export type GroupCounts = z.infer<typeof ResamplingCountsSchema>;
export type GroupRange = NonNullable<z.infer<typeof GroupResamplingModelSchema>['range']>;
export type ResamplingModel = {
  id: string;
  cells: {
    slot: number;
    weight: number;
    count: number;
    accepted: number;
    spendMinor: number;
    groups: number;
    distributionAllowed: boolean;
  }[];
  complete: boolean;
};
export type ResamplingGroup = {
  id: string;
  cells: { slot: number; count: number; accepted: number; spendMinor: number }[];
};
export type GroupResamplingInput = {
  models: ResamplingModel[];
  groups: ResamplingGroup[];
  slots: number;
  seed: string;
  seedDigest: string;
};
export type RatioDraw =
  | { kind: 'finite'; value: number }
  | { kind: 'zeroAcceptancePaid' | 'undefinedZeroOverZero' | 'missingCondition' };
const fail = (message: string) => {
  throw Object.assign(new Error(message), { code: 'ranking_resampling_invalid_input' });
};
const safe = (v: number) => Number.isSafeInteger(v) && v >= 0;

/** All conditions and models receive the same source-group multiplicities. */
export function evaluateGroupDraw(
  model: ResamplingModel,
  n: ArrayLike<number>,
  a: ArrayLike<number>,
  c: ArrayLike<number>,
): RatioDraw {
  let spend = 0,
    accepted = 0;
  for (const cell of model.cells) {
    const count = n[cell.slot];
    if (count === 0) return { kind: 'missingCondition' };
    if (!safe(count) || !safe(a[cell.slot]) || a[cell.slot] > count || !safe(c[cell.slot]))
      return fail('重采样总量超出安全整数或验收范围。');
    spend += (cell.weight * c[cell.slot]) / count;
    accepted += (cell.weight * a[cell.slot]) / count;
  }
  if (!Number.isFinite(spend) || !Number.isFinite(accepted))
    return fail('重采样比值超出计算范围。');
  if (accepted === 0) return { kind: spend > 0 ? 'zeroAcceptancePaid' : 'undefinedZeroOverZero' };
  const value = spend / accepted;
  if (!Number.isFinite(value)) return fail('重采样比值非有限。');
  return { kind: 'finite', value };
}

/** Unknown ratios range over nonnegative costs; never condition on finite draws. */
export function resamplingRange(finite: readonly number[], counts: GroupCounts): GroupRange {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  ResamplingCountsSchema.parse(counts);
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > groupResamplingPolicy.replicates ||
    counts.finite !== finite.length ||
    finite.some((v) => !Number.isFinite(v) || v < 0)
  )
    return fail('重采样分位数输入错误。');
  const values = [...finite].sort((a, b) => a - b),
    unknown = counts.missingCondition + counts.undefinedZeroOverZero;
  // Integer tail ranks avoid ceil(25.00000000000002) moving the lower quantile.
  const lowerIndex = Math.ceil(total / 40) - 1,
    upperIndex = Math.ceil((total * 39) / 40) - 1;
  const lower =
    lowerIndex < unknown
      ? { kind: 'finite' as const, value: 0 }
      : lowerIndex - unknown < values.length
        ? { kind: 'finite' as const, value: values[lowerIndex - unknown] }
        : { kind: 'unbounded' as const };
  const upper =
    upperIndex < values.length
      ? { kind: 'finite' as const, value: values[upperIndex] }
      : { kind: 'unbounded' as const };
  return { lower, upper };
}

export function groupResamplingGenerator(seed: string) {
  // xoshiro128** 1.1, Blackman & Vigna (public-domain reference):
  // https://prng.di.unimi.it/xoshiro128starstar.c
  if (!/^[a-f0-9]{64}$/.test(seed)) return fail('重采样种子无效。');
  const s = Array.from({ length: 4 }, (_, i) => parseInt(seed.slice(i * 8, i * 8 + 8), 16) >>> 0);
  if (s.reduce((a, b) => a | b, 0) === 0) s[0] = 0x9e3779b9;
  const rot = (n: number, k: number) => ((n << k) | (n >>> (32 - k))) >>> 0;
  return () => {
    const value = Math.imul(rot(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0,
      t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rot(s[3], 11);
    return value;
  };
}

export function validateResamplingInput(input: GroupResamplingInput) {
  const { models, groups, slots } = input;
  if (
    !/^[a-f0-9]{64}$/.test(input.seed) ||
    !/^[a-f0-9]{64}$/.test(input.seedDigest) ||
    !Number.isSafeInteger(slots) ||
    slots < 0 ||
    slots > groupResamplingPolicy.maxSlots ||
    models.length > 128 ||
    groups.length > groupResamplingPolicy.maxGroups ||
    new Set(models.map((m) => m.id)).size !== models.length ||
    new Set(groups.map((g) => g.id)).size !== groups.length
  )
    return fail('重采样矩阵容量或唯一性无效。');
  const originals = new Map<number, ResamplingModel['cells'][number]>();
  for (const m of models) {
    if (
      typeof m.id !== 'string' ||
      !m.id.length ||
      m.id.length > 1024 ||
      typeof m.complete !== 'boolean' ||
      m.cells.length > 256 ||
      (m.complete && !m.cells.length)
    )
      return fail('重采样模型范围无效。');
    let weight = 0;
    for (const c of m.cells) {
      if (
        !Number.isInteger(c.slot) ||
        c.slot < 0 ||
        c.slot >= slots ||
        originals.has(c.slot) ||
        !safe(c.count) ||
        c.count < 1 ||
        !safe(c.accepted) ||
        c.accepted > c.count ||
        !safe(c.spendMinor) ||
        !safe(c.groups) ||
        c.groups < 1 ||
        c.groups > c.count ||
        typeof c.distributionAllowed !== 'boolean' ||
        !Number.isFinite(c.weight) ||
        c.weight <= 0 ||
        c.weight > 1
      )
        return fail('重采样条件总量无效。');
      originals.set(c.slot, c);
      weight += c.weight;
    }
    if ((m.complete && Math.abs(weight - 1) > 1e-12) || (!m.complete && m.cells.length))
      return fail('完整目标权重或缺项状态无效。');
  }
  if (originals.size !== slots) return fail('重采样矩阵不能隐藏或补零条件。');
  const n = new Float64Array(slots),
    a = new Float64Array(slots),
    c = new Float64Array(slots),
    k = new Uint32Array(slots);
  let entries = 0;
  for (const g of groups) {
    if (
      !/^[a-f0-9]{64}$/.test(g.id) ||
      !g.cells.length ||
      new Set(g.cells.map((c) => c.slot)).size !== g.cells.length
    )
      return fail('关联组矩阵无效。');
    for (const v of g.cells) {
      if (
        ++entries > groupResamplingPolicy.maxEntries ||
        !originals.has(v.slot) ||
        !safe(v.count) ||
        v.count < 1 ||
        !safe(v.accepted) ||
        v.accepted > v.count ||
        !safe(v.spendMinor)
      )
        return fail('关联组数量或总量无效。');
      n[v.slot] += v.count;
      a[v.slot] += v.accepted;
      c[v.slot] += v.spendMinor;
      k[v.slot]++;
    }
  }
  for (const [slot, original] of originals) {
    if (
      !safe(n[slot]) ||
      !safe(c[slot]) ||
      n[slot] !== original.count ||
      a[slot] !== original.accepted ||
      c[slot] !== original.spendMinor ||
      k[slot] !== original.groups
    )
      return fail('逐组总量与已公开点估计不一致，不把缺读当零。');
  }
  return { entries };
}

/** Internal summaries only. The public projection below separately gates disclosure. */
export function resampleKnownGroups(input: GroupResamplingInput) {
  const { entries } = validateResamplingInput(input),
    models = input.models,
    groups = [...input.groups].sort((a, b) => a.id.localeCompare(b.id));
  const estimated =
    groupResamplingPolicy.replicates *
    (groups.length + 3 * input.slots + entries + models.reduce((n, m) => n + m.cells.length, 0));
  if (estimated > groupResamplingPolicy.maxOperations)
    return { state: 'capacity' as const, models: [], operations: 0 };
  const next = groupResamplingGenerator(input.seed),
    multiplicities = new Uint32Array(groups.length),
    n = new Float64Array(input.slots),
    a = new Float64Array(input.slots),
    c = new Float64Array(input.slots);
  const results = models.map((m) => ({
    modelId: m.id,
    counts: { finite: 0, zeroAcceptancePaid: 0, undefinedZeroOverZero: 0, missingCondition: 0 },
    finite: [] as number[],
  }));
  let operations = 0;
  const step = (count = 1) => {
    operations += count;
    if (operations > groupResamplingPolicy.maxOperations)
      throw Object.assign(new Error('重采样运行预算不足，不发布前缀分布。'), {
        code: 'ranking_resampling_capacity',
      });
  };
  const ceiling = groups.length ? Math.floor(2 ** 32 / groups.length) * groups.length : 0;
  for (let b = 0; b < groupResamplingPolicy.replicates; b++) {
    multiplicities.fill(0);
    n.fill(0);
    a.fill(0);
    c.fill(0);
    step(3 * input.slots);
    for (let draw = 0; draw < groups.length; draw++) {
      let r: number;
      do {
        step();
        r = next();
      } while (r >= ceiling);
      multiplicities[r % groups.length]++;
    }
    for (let g = 0; g < groups.length; g++) {
      const k = multiplicities[g];
      if (k === 0) continue;
      for (const value of groups[g].cells) {
        step();
        n[value.slot] += k * value.count;
        a[value.slot] += k * value.accepted;
        c[value.slot] += k * value.spendMinor;
      }
    }
    for (let m = 0; m < models.length; m++) {
      if (!models[m].complete) continue;
      step(models[m].cells.length);
      const result = evaluateGroupDraw(models[m], n, a, c);
      results[m].counts[result.kind]++;
      if (result.kind === 'finite') results[m].finite.push(result.value);
    }
  }
  return {
    state: 'complete' as const,
    operations,
    models: results.map((r, i) => ({
      modelId: r.modelId,
      counts: r.counts,
      range: models[i].complete ? resamplingRange(r.finite, r.counts) : null,
      identicalFinite:
        r.finite.length === groupResamplingPolicy.replicates &&
        r.finite.every((v) => v === r.finite[0]),
    })),
  };
}

export function resamplingMetadata(seedDigest: string) {
  return {
    version: GROUP_RESAMPLING_VERSION,
    method: 'pairs_known_group_bootstrap_fixed_policy',
    inference: 'observed_resampling_not_calibrated_confidence_interval',
    replicates: groupResamplingPolicy.replicates,
    centralMass: groupResamplingPolicy.centralMass,
    unit: 'connected_owner_and_confirmed_source',
    quantiles: 'inverse_empirical_cdf_unknowns_low_zero_high_unbounded',
    randomGenerator: 'xoshiro128starstar_rejection_index_1',
    seedDigest,
    conditionalOn: 'frozen_model_and_harness_selection',
  } as const;
}
export function publicGroupResampling(
  input: GroupResamplingInput,
  internal: ReturnType<typeof resampleKnownGroups>,
): GroupResampling {
  const resultByModel = new Map(internal.models.map((m) => [m.modelId, m]));
  const models = input.models.map((m) => {
    const min = m.cells.length ? Math.min(...m.cells.map((c) => c.groups)) : null;
    const boundary = !m.complete
      ? ('unknown' as const)
      : m.cells.every((c) => c.accepted === c.count)
        ? ('all_accepted' as const)
        : m.cells.every((c) => c.accepted === 0)
          ? ('all_zero_acceptance' as const)
          : ('mixed' as const);
    const base = { modelId: m.id, boundary, minGroupsPerCell: min, counts: null, range: null };
    if (!m.complete)
      return { ...base, state: 'suppressed' as const, reason: 'base_incomplete' as const };
    if (min! < groupResamplingPolicy.minGroupsPerCell)
      return { ...base, state: 'suppressed' as const, reason: 'few_groups' as const };
    if (m.cells.some((c) => !c.distributionAllowed))
      return { ...base, state: 'suppressed' as const, reason: 'distribution_support' as const };
    if (internal.state === 'capacity')
      return { ...base, state: 'capacity' as const, reason: 'work_budget' as const };
    const r = resultByModel.get(m.id);
    if (!r) return fail('重采样模型结果缺失。');
    if (boundary !== 'mixed' || r.identicalFinite)
      return {
        ...base,
        counts: r.counts,
        state: 'degenerate' as const,
        reason:
          boundary === 'all_accepted'
            ? ('all_accepted' as const)
            : boundary === 'all_zero_acceptance'
              ? ('all_zero_acceptance' as const)
              : ('observed_values_identical' as const),
      };
    return {
      ...base,
      counts: r.counts,
      range: r.range,
      state:
        r.range!.upper.kind === 'unbounded' ? ('unbounded_range' as const) : ('range' as const),
      reason: 'complete' as const,
    };
  });
  return GroupResamplingSchema.parse({ ...resamplingMetadata(input.seedDigest), models });
}
