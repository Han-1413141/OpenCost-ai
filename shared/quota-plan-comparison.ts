import {
  QuotaPlanComparisonSchema,
  quotaPlanComparisonLimits,
  type QuotaPlanComparison,
} from './quota-plan-comparison-schema.js';
import {
  QuotaReplayInputSchema,
  quotaReplayLimits,
  type QuotaReplayInput,
} from './quota-replay-schema.js';
import {
  replayQuota,
  QUOTA_REPLAY_METHOD_VERSION,
  type QuotaReplayResult,
} from './quota-replay.js';
import { quotaPlanReplayMetrics, quotaPlanObjectiveValue } from './quota-plan-metrics.js';

export type QuotaPlanCandidateResult = {
  candidateRef: string;
  plan: string;
  policyVersion: string;
  state: 'evaluated' | 'not_evaluated' | 'conflict' | 'capacity';
  reasons: string[];
  replayIssues: string[];
  assumptions: string[];
  metrics: {
    scheduled: number;
    unmet: number;
    requests: number;
    requiredScheduled: number;
    requiredCount: number;
    requiredWaitTotalMs: number | null;
    requiredWaitMaxMs: number | null;
    wholePeriodCostMinor: number | null;
    windowCashMinor: number | null;
    steps: number;
  } | null;
  preferenceEligible: boolean;
  preferenceReasons: string[];
  dominatedBy: string[];
  tradeoff: 'not_assessed' | 'frontier' | 'dominated';
  priceRecord: QuotaPlanComparison['candidates'][number]['priceRecord'];
};
export type QuotaPlanComparisonResult = {
  version: 'quota-plan-comparison-result-1';
  replayMethodVersion: typeof QUOTA_REPLAY_METHOD_VERSION;
  comparisonMethodVersion: 'quota-plan-selection-1';
  status: 'disabled' | 'complete' | 'partial' | 'capacity' | 'invalid';
  computedAt: string | null;
  snapshot: QuotaPlanComparison | null;
  issues: string[];
  candidates: QuotaPlanCandidateResult[];
  selection: {
    state: 'not_assessed' | 'none_meets_preferences' | 'best_among_evaluated';
    candidateRefs: string[];
    eligible: number;
    unassessed: number;
  };
  frontier: { candidateRefs: string[]; assessed: number; unassessed: number };
  notice: string;
};
const notice =
  '比较仅针对用户明确列出的候选、同一模型/Harness配置和固定资源需求情景；不是全市场最优、任务成功预测或供应商真实容量保证。所有获准数量均为请求，不是已验收任务。完整购买费用包含闲置，窗口现金另列；未知不填零。';
type Candidate = QuotaPlanComparison['candidates'][number];
const empty = (c: Candidate): QuotaPlanCandidateResult => ({
  candidateRef: c.candidateRef,
  plan: c.plan,
  policyVersion: c.policyVersion,
  state: 'not_evaluated',
  reasons: [],
  replayIssues: [],
  assumptions: [],
  metrics: null,
  preferenceEligible: false,
  preferenceReasons: [],
  dominatedBy: [],
  tradeoff: 'not_assessed',
  priceRecord: c.priceRecord,
});
const construct = (input: QuotaPlanComparison, candidate: Candidate) => {
  const result = empty(candidate),
    pools = new Map(candidate.pools.map((p) => [p.poolRef, p])),
    meters = new Map(input.meters.map((m) => [m.meterId, m]));
  const mapped = new Map<string, Candidate['bindings']>();
  if (
    candidate.bindings.length !== pools.size ||
    new Set(candidate.bindings.map((b) => b.poolRef)).size !== candidate.bindings.length ||
    candidate.bindings.some((b) => !pools.has(b.poolRef) || !meters.has(b.meterId))
  ) {
    result.state = 'conflict';
    result.reasons.push('pool_binding_scope_mismatch');
    return { result, scenario: null };
  }
  for (const b of candidate.bindings) {
    if (!mapped.has(b.meterId)) mapped.set(b.meterId, []);
    mapped.get(b.meterId)!.push(b);
    const meter = meters.get(b.meterId)!;
    if (meter.unit === 'unknown' || pools.get(b.poolRef)!.unit === 'unknown')
      result.reasons.push('meter_unit_unknown');
    if (meter.unit === 'currency_minor' && meter.currency !== input.currency)
      result.reasons.push('foreign_currency_meter_unsupported');
    if (b.conversion.basis === 'unknown') result.reasons.push('conversion_unknown');
    if (b.conversion.basis === 'explicit_assumption')
      result.assumptions.push('resource_conversion_assumed');
  }
  const requiredIds = new Set(input.requests.flatMap((r) => r.demands.map((d) => d.meterId)));
  if ([...requiredIds].some((id) => !mapped.has(id))) {
    result.reasons.push('common_demand_not_mapped');
    return { result, scenario: null };
  }
  if (candidate.cost.currency !== input.currency) {
    result.state = 'conflict';
    result.reasons.push('candidate_currency_mismatch');
    return { result, scenario: null };
  }
  let references = 0;
  const requests = input.requests.map((r) => ({
    requestRef: r.requestRef,
    rootTaskRef: r.rootTaskRef,
    atMs: r.atMs,
    sequence: r.sequence,
    latestStartMs: r.latestStartMs,
    durationMs: r.durationMs,
    requirements: r.demands.flatMap((d) =>
      mapped.get(d.meterId)!.map((b) => {
        let units: number | null = null;
        if (d.units !== null && b.conversion.basis !== 'unknown') {
          const n = BigInt(d.units) * BigInt(b.conversion.numerator),
            denominator = BigInt(b.conversion.denominator),
            value = (n + denominator - 1n) / denominator;
          if (value > 1000000000000n) result.reasons.push('converted_quantity_out_of_range');
          else units = Number(value);
        } else if (d.units === null) result.reasons.push('common_quantity_unknown');
        references++;
        return { poolRef: b.poolRef, classId: d.classId, units };
      }),
    ),
  }));
  if (references > quotaReplayLimits.references) {
    result.state = 'capacity';
    result.reasons.push('candidate_reference_capacity');
    return { result, scenario: null };
  }
  if (result.reasons.length) return { result, scenario: null };
  const scenario = QuotaReplayInputSchema.safeParse({
    version: 'quota-replay-1',
    scenarioRef: candidate.candidateRef,
    plan: candidate.plan,
    policyVersion: candidate.policyVersion,
    horizonMs: input.window.horizonMs,
    basis:
      input.demandBasis === 'explicit_scenario' || result.assumptions.length
        ? 'explicit_scenario'
        : 'observed_demand',
    eligibility: candidate.eligibility,
    externalDemand: input.externalDemand,
    sameTimeOrder: input.sameTimeOrder,
    requirementsCoverage: input.requirementsCoverage,
    dispatch: 'per_pool_fifo',
    shortage: candidate.shortage,
    pools: candidate.pools,
    events: candidate.events,
    requests,
    cost: candidate.cost,
  });
  if (!scenario.success) {
    result.state = 'conflict';
    result.reasons.push('constructed_scenario_invalid');
    return { result, scenario: null };
  }
  return { result, scenario: scenario.data };
};

/** No new inference or account reads: a finite, explicit candidate set shares one demand definition. */
export function compareQuotaPlans(
  raw: unknown,
  options: { enabled?: boolean; now?: string } = {},
): QuotaPlanComparisonResult {
  const result: QuotaPlanComparisonResult = {
    version: 'quota-plan-comparison-result-1',
    replayMethodVersion: QUOTA_REPLAY_METHOD_VERSION,
    comparisonMethodVersion: 'quota-plan-selection-1',
    status: 'disabled',
    computedAt: null,
    snapshot: null,
    issues: [],
    candidates: [],
    selection: { state: 'not_assessed', candidateRefs: [], eligible: 0, unassessed: 0 },
    frontier: { candidateRefs: [], assessed: 0, unassessed: 0 },
    notice,
  };
  if (options.enabled !== true) return result;
  try {
    const text = JSON.stringify(raw);
    if (
      typeof text !== 'string' ||
      new TextEncoder().encode(text).length > quotaPlanComparisonLimits.bytes
    ) {
      result.status = 'capacity';
      result.issues.push('input_capacity');
      return result;
    }
  } catch {
    result.status = 'invalid';
    result.issues.push('invalid_structure');
    return result;
  }
  const parsed = QuotaPlanComparisonSchema.safeParse(raw);
  if (!parsed.success) {
    result.status = parsed.error.issues.some((i) => i.code === 'too_big' && i.origin === 'array')
      ? 'capacity'
      : 'invalid';
    result.issues.push('invalid_structure_or_capacity');
    return result;
  }
  const input = parsed.data;
  result.snapshot = input;
  result.computedAt = options.now ?? new Date().toISOString();
  const frequencies = new Map<string, number>();
  for (const r of input.requests)
    for (const d of r.demands) frequencies.set(d.meterId, (frequencies.get(d.meterId) ?? 0) + 1);
  const work = input.candidates.reduce(
    (n, c) => n + c.bindings.reduce((s, b) => s + (frequencies.get(b.meterId) ?? 0), 0),
    0,
  );
  const capacity = () => {
    result.status = 'capacity';
    result.issues = ['comparison_work_capacity'];
    result.candidates = input.candidates.map((c) => ({
      ...empty(c),
      state: 'capacity' as const,
      reasons: ['comparison_work_capacity'],
    }));
    result.selection = {
      state: 'not_assessed',
      candidateRefs: [],
      eligible: 0,
      unassessed: input.candidates.length,
    };
    result.frontier = { candidateRefs: [], assessed: 0, unassessed: input.candidates.length };
    return result;
  };
  if (work > quotaPlanComparisonLimits.constructedReferences) return capacity();
  const observations = new Map<string, QuotaReplayResult>();
  let steps = 0;
  for (const candidate of input.candidates) {
    const built = construct(input, candidate),
      row = built.result;
    if (row.state === 'capacity') return capacity();
    if (!built.scenario) {
      row.reasons = [...new Set(row.reasons)];
      result.candidates.push(row);
      continue;
    }
    const remaining = quotaPlanComparisonLimits.steps - steps;
    if (remaining <= 0) return capacity();
    const replay = replayQuota(built.scenario, {
      enabled: true,
      maxSteps: Math.min(quotaReplayLimits.steps, remaining),
    });
    if (replay.status === 'disabled') throw new Error('Unexpected disabled quota comparison');
    steps += replay.steps;
    if (replay.status === 'incomplete') return capacity();
    row.replayIssues = replay.issues;
    row.assumptions.push(...replay.assumptions);
    if (replay.status !== 'complete') {
      row.state = replay.status === 'conflict' ? 'conflict' : 'not_evaluated';
      row.reasons.push('replay_not_complete');
      result.candidates.push(row);
      continue;
    }
    row.state = 'evaluated';
    observations.set(candidate.candidateRef, replay);
    const fullCost = candidate.costCoverage === 'all_required_payments_taxes_fees';
    Object.assign(row, quotaPlanReplayMetrics(input, replay, fullCost));
    result.candidates.push(row);
  }
  result.status = result.candidates.every(
    (c) => c.state === 'evaluated' && c.metrics?.wholePeriodCostMinor !== null,
  )
    ? 'complete'
    : 'partial';
  const objective = (c: QuotaPlanCandidateResult) =>
    quotaPlanObjectiveValue(c.metrics!, input.preferences.objective);
  const eligible = result.candidates.filter((c) => c.preferenceEligible && objective(c) !== null),
    best = eligible.length ? Math.min(...eligible.map((c) => objective(c)!)) : null;
  result.selection = {
    state: eligible.length ? 'best_among_evaluated' : 'none_meets_preferences',
    candidateRefs: eligible
      .filter((c) => objective(c) === best)
      .map((c) => c.candidateRef)
      .sort(),
    eligible: eligible.length,
    unassessed: result.candidates.filter((c) => c.state !== 'evaluated').length,
  };
  const frontier = result.candidates.filter(
    (c) => c.state === 'evaluated' && c.metrics!.wholePeriodCostMinor !== null,
  );
  const outcomes = new Map(
    frontier.map((c) => [
      c.candidateRef,
      new Map(observations.get(c.candidateRef)!.requests.map((r) => [r.requestRef, r])),
    ]),
  );
  for (const b of frontier) {
    for (const a of frontier) {
      if (a === b || a.metrics!.wholePeriodCostMinor! > b.metrics!.wholePeriodCostMinor!) continue;
      let strict = a.metrics!.wholePeriodCostMinor! < b.metrics!.wholePeriodCostMinor!,
        dominates = true;
      for (const request of input.requests) {
        const ar = outcomes.get(a.candidateRef)!.get(request.requestRef)!,
          br = outcomes.get(b.candidateRef)!.get(request.requestRef)!;
        if (br.status === 'scheduled') {
          if (ar.status !== 'scheduled' || ar.waitMs! > br.waitMs!) {
            dominates = false;
            break;
          }
          if (ar.waitMs! < br.waitMs!) strict = true;
        } else if (ar.status === 'scheduled') strict = true;
      }
      if (dominates && strict) b.dominatedBy.push(a.candidateRef);
    }
    b.dominatedBy.sort();
    b.tradeoff = b.dominatedBy.length ? 'dominated' : 'frontier';
  }
  result.frontier = {
    candidateRefs: frontier
      .filter((c) => c.tradeoff === 'frontier')
      .map((c) => c.candidateRef)
      .sort(),
    assessed: frontier.length,
    unassessed: input.candidates.length - frontier.length,
  };
  return result;
}
