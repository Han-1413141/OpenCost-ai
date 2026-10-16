import { canonical } from './schema.js';
import type { Comparison } from './analysis.js';
import { modelIdentityKey } from './model-identity.js';
import { hasComparableHarnessComposition } from './harness-composition.js';

export function trendSeries(
  rows: Comparison[],
  value: (row: Comparison) => number | null = (row) => row.metrics.costPerAccepted,
) {
  const groups = new Map<string, Comparison[]>();
  let first = Infinity;
  let last = -Infinity;
  for (const row of rows) {
    const { month, models: _modelDisplay, modelIdentity, ...conditions } = row.cohort;
    const identity = modelIdentityKey(modelIdentity);
    if (
      !identity ||
      !hasComparableHarnessComposition(row.cohort) ||
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)
    )
      continue;
    const observed = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
    first = Math.min(first, observed);
    last = Math.max(last, observed);
    const key = canonical({
      ...conditions,
      modelIdentity: identity,
      cost: row.evidence.cost,
      work: row.evidence.work,
      coverage: row.evidence.coverage,
    });
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const series = [...groups.values()]
    .filter((group) => group.filter((row) => value(row) !== null).length >= 2)
    .map((group) => group.sort((a, b) => a.cohort.month.localeCompare(b.cohort.month)));
  if (first === Infinity) return { series, months: [] as string[] };
  const months = Array.from({ length: last - first + 1 }, (_, offset) => {
    const value = first + offset;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, '0')}`;
  });
  return { series, months };
}
