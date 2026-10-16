import { z } from 'zod';
import type { Usage } from './schema.js';

export const PriceUnitSchema = z.enum([
  'input_million_tokens',
  'cached_input_million_tokens',
  'cache_write_million_tokens',
  'output_million_tokens',
  'reasoning_surcharge_million_tokens',
  'image',
  'second',
  'request',
  'search',
  'compute_minute',
  'storage_gib_month',
  'network_gib',
]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const PriceMeteringSchema = z
  .object({
    version: z.literal('price-metering-1'),
    coverage: z.enum(['complete', 'partial']),
    segments: z
      .array(
        z
          .object({
            snapshotId: hash,
            conversionSnapshotId: hash.optional(),
            meters: z
              .array(
                z
                  .object({
                    unit: PriceUnitSchema,
                    // Token quantities are tokens, not millions. Other quantities use the named rate unit.
                    quantity: z.number().finite().nonnegative().max(1e11),
                  })
                  .strict(),
              )
              .max(12),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((v, ctx) => {
    const keys = new Set<string>();
    for (const [i, s] of v.segments.entries()) {
      const key = `${s.snapshotId}:${s.conversionSnapshotId ?? ''}`;
      if (keys.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['segments', i],
          message: '同价格和汇率的计量段必须合并',
        });
      keys.add(key);
      if (new Set(s.meters.map((m) => m.unit)).size !== s.meters.length)
        ctx.addIssue({
          code: 'custom',
          path: ['segments', i, 'meters'],
          message: '同段计量单位不能重复',
        });
      for (const [j, m] of s.meters.entries())
        if (m.unit.endsWith('_tokens') && !Number.isSafeInteger(m.quantity))
          ctx.addIssue({
            code: 'custom',
            path: ['segments', i, 'meters', j],
            message: 'Token 计量必须为整数',
          });
    }
  });
export type PriceMetering = z.infer<typeof PriceMeteringSchema>;
type Currency = 'CNY' | 'USD' | 'EUR';
type Decimal = { n: bigint; scale: number };
const power = (scale: number) => 10n ** BigInt(scale);
function decimal(value: number): Decimal {
  if (!Number.isFinite(value) || value < 0) throw new Error('计价数量必须为有限非负数');
  const [digits, exponent = '0'] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = digits.split('.');
  const scale = fraction.length - Number(exponent);
  const n = BigInt(whole + fraction);
  return scale < 0 ? { n: n * power(-scale), scale: 0 } : { n, scale };
}
function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { n: a.n * power(scale - a.scale) + b.n * power(scale - b.scale), scale };
}
const multiply = (a: Decimal, b: Decimal): Decimal => ({ n: a.n * b.n, scale: a.scale + b.scale });
function minor(value: Decimal): number | null {
  const divisor = power(value.scale);
  const cents = (value.n * 200n + divisor) / (divisor * 2n);
  return cents <= 10000000000n ? Number(cents) : null;
}
/** Exact decimal summation of source quotes, rounded once. Not an actual payment. */
export function sumQuoteMinor(amounts: number[]) {
  return amounts.length ? minor(amounts.reduce((s, n) => add(s, decimal(n)), decimal(0))) : null;
}
const tokenUnits = [
  'input_million_tokens',
  'cached_input_million_tokens',
  'cache_write_million_tokens',
  'output_million_tokens',
] as const;
const reasoningUnit = 'reasoning_surcharge_million_tokens';
/** A single recorded price applies to the entire supplied usage. Multiple price
 * versions require actual segment quantities; never apportion by token ratios. */
export function automaticPriceMetering(usage: Usage, currency?: Currency): PriceMetering | undefined {
  if (usage.priceMetering) return usage.priceMetering;
  const prices = [...(usage.priceHistory ?? []), ...(usage.priceSnapshot ? [usage.priceSnapshot] : [])];
  if (!prices.length || prices.some(p => !p.snapshotId) || new Set(prices.map(p => p.snapshotId)).size !== 1)
    return undefined;
  const price = prices[0];
  const { inputTokens: input, cachedInputTokens: cached, cacheWriteTokens: write, outputTokens: output } = usage;
  if (input == null || cached == null || write == null || output == null || cached + write > input)
    return undefined;
  const conversions = (usage.equivalentConversions ?? []).filter(f => currency !== price.currency && f.from === price.currency && f.to === currency);
  return {
    version: 'price-metering-1', coverage: 'complete',
    segments: [{ snapshotId: price.snapshotId!,
      ...(conversions.length === 1 ? { conversionSnapshotId: conversions[0].snapshotId } : {}),
      meters: [
        { unit: 'input_million_tokens', quantity: input - cached - write },
        { unit: 'cached_input_million_tokens', quantity: cached },
        { unit: 'cache_write_million_tokens', quantity: write },
        { unit: 'output_million_tokens', quantity: output },
        ...(usage.reasoningTokens != null && price.rates.some(r => r.unit === reasoningUnit)
          ? [{ unit: reasoningUnit as typeof reasoningUnit, quantity: usage.reasoningTokens }] : []),
      ] }],
  };
}
export type MeteringResult = {
  status: 'legacy' | 'recomputed' | 'incomplete' | 'conflict' | 'out_of_range';
  reportedMinor: number | null;
  recomputedMinor: number | null;
  comparableMinor: number | null;
  reasons: string[];
};
/** Reproduces only the recorded pricing scope. No current prices, payment inference or network. */
export function evaluatePriceMetering(usage: Usage, currency: Currency): MeteringResult {
  const reportedMinor = usage.apiEquivalentMinor;
  const base = { reportedMinor, recomputedMinor: null, comparableMinor: null };
  const automatic = automaticPriceMetering(usage, currency);
  if (!automatic) {
    const prices = [...(usage.priceHistory ?? []), ...(usage.priceSnapshot ? [usage.priceSnapshot] : [])];
    // Preserve truly legacy amounts. A recorded quote must not bypass checking
    // merely because the caller removed its metering segments.
    if (!prices.length && reportedMinor !== null)
      return { ...base, status: 'legacy', comparableMinor: reportedMinor, reasons: [] };
    const reasons: string[] = [];
    if (!prices.length) reasons.push('缺少调用当时的价格快照');
    else if (prices.some(p => !p.snapshotId)) reasons.push('历史价格快照缺少标识');
    else if (new Set(prices.map(p => p.snapshotId)).size > 1) reasons.push('跨价格版本缺少各段实际用量');
    if (usage.inputTokens == null) reasons.push('缺少输入 Token');
    if (usage.outputTokens == null) reasons.push('缺少输出 Token');
    if (usage.cachedInputTokens == null) reasons.push('缺少缓存读取 Token，不能默认零');
    if (usage.cacheWriteTokens == null) reasons.push('缺少缓存写入 Token，不能默认零');
    return { ...base, status: 'incomplete', reasons };
  }
  const parsed = PriceMeteringSchema.safeParse(automatic);
  if (!parsed.success) return { ...base, status: 'conflict', reasons: ['计量段结构无效'] };
  const metering = parsed.data;
  const missing = new Set<string>(),
    conflicts = new Set<string>();
  if (metering.coverage !== 'complete' || !metering.segments.length) missing.add('计量覆盖不完整');
  type Price = NonNullable<Usage['priceSnapshot']>;
  const prices = new Map<string, Price>();
  const priceSignature = (p: Price) =>
    JSON.stringify([
      p.version,
      p.currency,
      p.effectiveFrom,
      p.rates
        .map((r) => [r.unit, r.amount])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ]);
  for (const p of [
    ...(usage.priceHistory ?? []),
    ...(usage.priceSnapshot ? [usage.priceSnapshot] : []),
  ]) {
    if (!p.snapshotId) continue;
    const previous = prices.get(p.snapshotId);
    if (previous && priceSignature(previous) !== priceSignature(p))
      conflicts.add('同一价格快照标识对应不同价格');
    else prices.set(p.snapshotId, p);
  }
  const conversions = new Map<string, NonNullable<Usage['equivalentConversions']>[number]>();
  for (const fx of usage.equivalentConversions ?? []) {
    const previous = conversions.get(fx.snapshotId);
    if (
      previous &&
      JSON.stringify([previous.from, previous.to, previous.rate, previous.date]) !==
        JSON.stringify([fx.from, fx.to, fx.rate, fx.date])
    )
      conflicts.add('同一汇率快照标识对应不同汇率');
    else conversions.set(fx.snapshotId, fx);
  }
  const totals = new Map<string, number>();
  let amount = decimal(0),
    reasoningSegments = 0;
  for (const segment of metering.segments) {
    const meters = new Map(segment.meters.map((m) => [m.unit, m.quantity]));
    for (const unit of tokenUnits)
      if (!meters.has(unit)) missing.add('缺少明确的输入、缓存或输出计量');
    const reasoning = meters.get(reasoningUnit),
      output = meters.get('output_million_tokens');
    if (reasoning !== undefined) {
      reasoningSegments++;
      if (output !== undefined && reasoning > output) conflicts.add('段内推理数量超过输出数量');
    }
    for (const m of segment.meters) totals.set(m.unit, (totals.get(m.unit) ?? 0) + m.quantity);
    const price = prices.get(segment.snapshotId);
    if (!price) {
      missing.add('缺少对应历史价格快照');
      continue;
    }
    const rates = new Map(price.rates.map((r) => [r.unit, r.amount]));
    for (const rate of price.rates) {
      // Explicit zero reasoning surcharge does not require unavailable reasoning counts.
      if (!meters.has(rate.unit) && !(rate.unit === reasoningUnit && rate.amount === 0))
        missing.add('价格表存在未记录数量的计价项');
    }
    let conversion = 1;
    if (price.currency !== currency) {
      const fx = segment.conversionSnapshotId
        ? conversions.get(segment.conversionSnapshotId)
        : null;
      if (!fx) {
        missing.add('缺少逐段历史汇率');
        continue;
      }
      if (fx.from !== price.currency || fx.to !== currency) {
        conflicts.add('汇率方向或目标币种不符');
        continue;
      }
      conversion = fx.rate;
    } else if (segment.conversionSnapshotId) {
      conflicts.add('同币种计量不能重复换汇');
      continue;
    }
    for (const meter of segment.meters) {
      const rate = rates.get(meter.unit);
      if (rate === undefined) {
        // A measured zero needs no price; missing nonzero prices never become zero cost.
        if (meter.quantity > 0) missing.add('非零数量缺少对应费率');
        continue;
      }
      const product = multiply(
        multiply(decimal(meter.quantity), decimal(rate)),
        decimal(conversion),
      );
      if (meter.unit.endsWith('_tokens')) product.scale += 6;
      amount = add(amount, product);
    }
  }
  const input =
    (totals.get(tokenUnits[0]) ?? 0) +
    (totals.get(tokenUnits[1]) ?? 0) +
    (totals.get(tokenUnits[2]) ?? 0);
  const reconciliation: [number | null | undefined, number][] = [
    [usage.inputTokens, input],
    [usage.cachedInputTokens, totals.get(tokenUnits[1]) ?? 0],
    [usage.cacheWriteTokens, totals.get(tokenUnits[2]) ?? 0],
    [usage.outputTokens, totals.get(tokenUnits[3]) ?? 0],
  ];
  for (const [recorded, metered] of reconciliation) {
    if (recorded == null) missing.add('缺少可对账的 Token 总数');
    else if (metered > recorded || (metering.coverage === 'complete' && metered !== recorded))
      conflicts.add('分段数量与 Token 总数不一致');
  }
  if (usage.reasoningTokens != null) {
    const reasoning = totals.get(reasoningUnit) ?? 0;
    if (
      reasoning > usage.reasoningTokens ||
      (metering.coverage === 'complete' &&
        reasoningSegments === metering.segments.length &&
        reasoning !== usage.reasoningTokens)
    )
      conflicts.add('分段推理数量与推理总数不一致');
  }
  if (conflicts.size) return { ...base, status: 'conflict', reasons: [...conflicts] };
  if (missing.size) return { ...base, status: 'incomplete', reasons: [...missing] };
  const recomputedMinor = minor(amount);
  if (recomputedMinor === null)
    return { ...base, status: 'out_of_range', reasons: ['重算金额超过协议金额上限'] };
  if (reportedMinor !== null && reportedMinor !== recomputedMinor)
    return {
      ...base,
      recomputedMinor,
      status: 'conflict',
      reasons: ['来源报告金额与分段重算金额不同'],
    };
  return {
    reportedMinor,
    recomputedMinor,
    comparableMinor: recomputedMinor,
    status: 'recomputed',
    reasons: [],
  };
}

export function comparableEquivalentMinor(usage: Usage, currency: Currency) {
  return evaluatePriceMetering(usage, currency).comparableMinor;
}

/** A quota-window quote remains a separate observation; it cannot exceed a known period total. */
export function quotaEquivalentAmounts(
  usages: Usage[],
  currency: Currency,
  amounts: (number | null)[],
) {
  const results = usages.map((u) => evaluatePriceMetering(u, currency));
  if (results.some((r) => !['legacy', 'recomputed'].includes(r.status)))
    return amounts.map(() => null);
  const total =
    results.length && results.every((r) => r.comparableMinor !== null)
      ? results.reduce((s, r) => s + r.comparableMinor!, 0)
      : null;
  return amounts.map((amount) =>
    amount !== null && total !== null && amount > total ? null : amount,
  );
}

const count = z.number().int().nonnegative().max(1e7);
export const PriceMeteringSummarySchema = z
  .object({
    version: z.literal('price-metering-1'),
    usages: count,
    recomputed: count,
    legacy: count,
    incomplete: count,
    conflicts: count,
    outOfRange: count,
    reportedMinor: z.number().finite().nonnegative().nullable(),
    recomputedMinor: z.number().finite().nonnegative().nullable(),
    comparableMinor: z.number().finite().nonnegative().nullable(),
    reasons: z.array(z.string().max(100)).max(20),
    note: z.string().max(600),
  })
  .strict();
export function summarizePriceMetering(usages: Usage[], currency: Currency) {
  if (!usages.length) return undefined;
  const values = usages.map((u) => evaluatePriceMetering(u, currency));
  const sum = (key: 'reportedMinor' | 'recomputedMinor' | 'comparableMinor') => {
    if (!values.length || values.some((v) => v[key] === null)) return null;
    const total = values.reduce((s, v) => s + v[key]!, 0);
    return Number.isSafeInteger(total) ? total : null;
  };
  return PriceMeteringSummarySchema.parse({
    version: 'price-metering-1',
    usages: values.length,
    recomputed: values.filter((v) => v.status === 'recomputed').length,
    legacy: values.filter((v) => v.status === 'legacy').length,
    incomplete: values.filter((v) => v.status === 'incomplete').length,
    conflicts: values.filter((v) => v.status === 'conflict').length,
    outOfRange: values.filter((v) => v.status === 'out_of_range').length,
    reportedMinor: sum('reportedMinor'),
    recomputedMinor: sum('recomputedMinor'),
    comparableMinor: sum('comparableMinor'),
    reasons: [...new Set(values.flatMap((v) => v.reasons))],
    note: '仅重现已记录模型用量范围内的历史 API 等价金额，不是实际付款，也不证明代理或收费项目全部采集。各模型的价格段和汇率先相加再舍入；来源按调用舍入也可能产生差额。缺失、冲突及越界项不进入等价金额比较，来源金额原样保留。旧记录沿用来源金额，未完成分段复核；零费率不证明无需订阅付款。',
  });
}

/** Merge quantities by both historical price and FX. Reject overflow instead of truncation. */
export function mergePriceMetering(usages: Usage[], currency: Currency): PriceMetering | undefined {
  usages = usages.map(u => { const m = automaticPriceMetering(u, currency); return m ? { ...u, priceMetering: m } : u; });
  if (!usages.some((u) => u.priceMetering)) return undefined;
  let complete = true;
  for (const usage of usages) {
    const result = evaluatePriceMetering(usage, currency);
    if (result.status === 'conflict')
      throw new Error(`不能合并计价冲突：${result.reasons.join('；')}`);
    if (result.status === 'out_of_range') throw new Error('计价金额越界，请缩小采集范围');
    // One call cannot fill another call's missing meters during aggregation.
    if (result.status === 'legacy' || result.status === 'incomplete') complete = false;
  }
  const grouped = new Map<
    string,
    {
      snapshotId: string;
      conversionSnapshotId?: string;
      meters: Map<z.infer<typeof PriceUnitSchema>, Decimal>;
    }
  >();
  for (const u of usages)
    for (const s of u.priceMetering?.segments ?? []) {
      const key = `${s.snapshotId}:${s.conversionSnapshotId ?? ''}`;
      let group = grouped.get(key);
      if (!group) {
        group = {
          snapshotId: s.snapshotId,
          ...(s.conversionSnapshotId ? { conversionSnapshotId: s.conversionSnapshotId } : {}),
          meters: new Map(),
        };
        grouped.set(key, group);
      }
      for (const m of s.meters)
        group.meters.set(m.unit, add(group.meters.get(m.unit) ?? decimal(0), decimal(m.quantity)));
    }
  return PriceMeteringSchema.parse({
    version: 'price-metering-1',
    coverage: complete ? 'complete' : 'partial',
    segments: [...grouped.values()].map((s) => ({
      snapshotId: s.snapshotId,
      ...(s.conversionSnapshotId ? { conversionSnapshotId: s.conversionSnapshotId } : {}),
      meters: [...s.meters].map(([unit, d]) => {
        const quantity = Number(`${d.n}e-${d.scale}`);
        const roundTrip = decimal(quantity);
        if (roundTrip.n * power(d.scale) !== d.n * power(roundTrip.scale))
          throw new Error('合并计量数量超出可精确表示的范围，请缩小采集范围');
        return { unit, quantity };
      }),
    })),
  });
}
