export type CostCompletionTradeoff = {
  method: 'cost-completion-pareto-1';
  inference: 'descriptive';
  status: 'frontier' | 'dominated' | 'unavailable';
  reason: 'not_comparable' | 'insufficient_options' | 'ineligible' | 'invalid_measurement' | null;
  comparedOptions: number;
  alternative: {
    id: string;
    cost: number;
    completion: number;
    costDifference: number;
    completionDifference: number;
  } | null;
};

type Candidate = { id: string; cost: number | null; completion: number; qualified: boolean };

/** Observed Pareto dominance, within one already matched workload and cost scope.
 * Sort once, then scan the best completion seen at an equal or lower cost.
 * No pairwise matrix, fitted weights, confidence claims or changes to cost ranks.
 */
export function withCostCompletionTradeoffs<T extends Candidate>(rows: T[], comparable: boolean) {
  const valid = (row: T) =>
    row.cost !== null &&
    Number.isFinite(row.cost) &&
    row.cost >= 0 &&
    Number.isFinite(row.completion) &&
    row.completion >= 0 &&
    row.completion <= 1;
  const eligible = rows
    .filter((row) => row.qualified && valid(row))
    .sort((a, b) => a.cost! - b.cost! || b.completion - a.completion || a.id.localeCompare(b.id));
  const witnesses = new Map<string, T | null>();
  let best: T | undefined;
  if (comparable && eligible.length >= 2) {
    for (const row of eligible) {
      const dominates =
        best &&
        best.completion >= row.completion &&
        (best.cost! < row.cost! || best.completion > row.completion);
      witnesses.set(row.id, dominates ? best! : null);
      if (!best || row.completion > best.completion) best = row;
    }
  }
  return rows.map((row) => {
    const reason: CostCompletionTradeoff['reason'] = !comparable
      ? 'not_comparable'
      : !row.qualified
        ? 'ineligible'
        : !valid(row)
          ? 'invalid_measurement'
          : eligible.length < 2
            ? 'insufficient_options'
            : null;
    const alternative = reason === null ? witnesses.get(row.id) : null;
    const tradeoff: CostCompletionTradeoff = {
      method: 'cost-completion-pareto-1',
      inference: 'descriptive',
      status: reason !== null ? 'unavailable' : alternative ? 'dominated' : 'frontier',
      reason,
      comparedOptions: eligible.length,
      alternative: alternative
        ? {
            id: alternative.id,
            cost: alternative.cost!,
            completion: alternative.completion,
            costDifference: row.cost! - alternative.cost!,
            completionDifference: alternative.completion - row.completion,
          }
        : null,
    };
    return { ...row, tradeoff };
  });
}

/** Cost gaps are observations about candidates, never uncertainty intervals. */
export function selectionCostMargin(
  candidates: readonly { cost: number | null; qualified: boolean }[],
) {
  let lowest = Infinity,
    next = Infinity,
    ties = 0,
    eligible = 0;
  for (const row of candidates) {
    if (!row.qualified || row.cost === null || !Number.isFinite(row.cost) || row.cost < 0) continue;
    eligible++;
    if (row.cost < lowest) {
      next = lowest;
      lowest = row.cost;
      ties = 1;
    } else if (row.cost === lowest) {
      next = lowest;
      ties++;
    } else if (row.cost < next) next = row.cost;
  }
  return {
    eligibleCandidates: eligible,
    lowestCostTies: ties,
    nextCandidateCost: eligible >= 2 ? next : null,
    gapMinor: eligible >= 2 ? next - lowest : null,
    gapFractionOfNext: eligible >= 2 && next > 0 ? (next - lowest) / next : null,
  };
}
