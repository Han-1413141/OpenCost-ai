import type { QuotaPool } from './subscriptions.js';

type Check = 'consistent' | 'conflict' | 'unavailable';
export type QuotaConsistency = {
  version: 'quota-consistency-1';
  status: Check;
  checks: { amounts: Check; percent: Check };
  issues: Array<'amounts_disagree' | 'percent_disagrees'>;
  overCapacity: boolean | null;
};

const equalQuantity = (a: number, b: number) =>
  Number.isInteger(a) && Number.isInteger(b)
    ? a === b
    : Math.abs(a - b) <= Number.EPSILON * 8 * Math.max(1, Math.abs(a), Math.abs(b));

/** Internal consistency of reported fields, never proof of provider authenticity. */
export function assessQuotaConsistency(pool: QuotaPool): QuotaConsistency {
  const result: QuotaConsistency = {
    version: 'quota-consistency-1',
    status: 'unavailable',
    checks: { amounts: 'unavailable', percent: 'unavailable' },
    issues: [],
    overCapacity: null,
  };
  // A monetary balance may have lifetime spent counters; a rate may use a
  // different time denominator. Neither establishes complementary quantities.
  const comparable =
    ['concurrency', 'storage_limit'].includes(pool.semantics) ||
    (pool.semantics === 'period_allowance' && pool.window.kind !== 'unknown');
  if (!comparable || pool.precision !== 'exact' || pool.capacity.status !== 'finite') return result;
  const total = pool.capacity.total;
  if (total === null) return result;
  result.overCapacity = pool.used === null ? null : pool.used > total;
  if (pool.used !== null && pool.remaining !== null) {
    // Preserve legitimate overage with zero remaining. Never clamp the source.
    result.checks.amounts = equalQuantity(pool.remaining, Math.max(0, total - pool.used))
      ? 'consistent'
      : 'conflict';
    if (result.checks.amounts === 'conflict') result.issues.push('amounts_disagree');
  }
  const percent = pool.percent;
  if (percent?.precision === 'exact' && total > 0) {
    const value = percent.direction === 'used' ? pool.used : pool.remaining;
    if (value !== null) {
      // The protocol's percentage is a 0..100 display, including capped overage.
      const expected = Math.min(100, (value / total) * 100);
      result.checks.percent = equalQuantity(percent.value, expected) ? 'consistent' : 'conflict';
      if (result.checks.percent === 'conflict') result.issues.push('percent_disagrees');
    }
  }
  result.status = result.issues.length
    ? 'conflict'
    : Object.values(result.checks).includes('consistent')
      ? 'consistent'
      : 'unavailable';
  return result;
}

export function quotaConsistencyNote(checks: {
  current: QuotaConsistency;
  previous: QuotaConsistency | null;
}): string {
  const parts: string[] = [];
  for (const [label, result] of [
    ['本次', checks.current],
    ['前次', checks.previous],
  ] as const) {
    if (result?.checks.amounts === 'conflict') parts.push(`${label}已用量与剩余额度不相符`);
    if (result?.checks.percent === 'conflict') parts.push(`${label}精确百分比与绝对数值不相符`);
  }
  return parts.length
    ? `${parts.join('；')}。原始记录保留，矛盾计数不用于差值消费推断；独立完整消费流水仍可使用。`
    : '';
}
