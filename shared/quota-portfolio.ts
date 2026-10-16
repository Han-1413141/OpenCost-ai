import {
  QuotaPortfolioSchema,
  quotaPortfolioLimits,
  type QuotaPortfolio,
} from './quota-portfolio-schema.js';
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
import type { QuotaPlanCandidateResult } from './quota-plan-comparison.js';

type Purchase = QuotaPortfolio['purchases'][number];
export type QuotaPortfolioRow = {
  configurationRef: string;
  purchaseRefs: string[];
  paymentRefs: string[];
  poolRefs: string[];
  allocations: { groupRef: string; purchaseRef: string }[];
  state: 'evaluated' | 'excluded' | 'not_evaluated' | 'conflict';
  reasons: string[];
  assumptions: string[];
  metrics: QuotaPlanCandidateResult['metrics'];
  preferenceEligible: boolean;
};
export type QuotaPortfolioResult = {
  version: 'quota-portfolio-result-1';
  methodVersion: 'quota-portfolio-enumeration-1';
  replayMethodVersion: typeof QUOTA_REPLAY_METHOD_VERSION;
  status: 'disabled' | 'invalid' | 'capacity' | 'complete' | 'partial';
  computedAt: string | null;
  snapshot: QuotaPortfolio | null;
  issues: string[];
  search: {
    admissiblePurchaseSets: number;
    structurallyExcludedSets: number;
    assignmentConfigurations: string;
    evaluatedConfigurations: number;
    unprocessedConfigurations: string;
    constructedReferences: number;
    allocationReferences: number;
    replaySteps: number;
    complete: boolean;
  };
  configurations: QuotaPortfolioRow[];
  selection: {
    state: 'not_assessed' | 'none_meets_preferences' | 'best_among_evaluated';
    configurationRefs: string[];
    unassessed: number;
  };
  selectedReplays: { configurationRef: string; replay: QuotaReplayResult }[];
  notice: string;
};
const union = (values: string[][]) => [...new Set(values.flat())].sort();
const notice =
  '固定同一模型、Harness和需求，枚举明确目录内的购买组合与允许分配。共享池、赠额和费用只记一次；完整购买费用含闲置，窗口现金另列。请求安排不是任务验收，搜索完成也不代表全市场最优。';

/** Bounded exhaustive search, with a preflight count; never rank a truncated search prefix. */
export function compareQuotaPortfolio(
  raw: unknown,
  options: { enabled?: boolean; now?: string } = {},
): QuotaPortfolioResult {
  const result: QuotaPortfolioResult = {
    version: 'quota-portfolio-result-1',
    methodVersion: 'quota-portfolio-enumeration-1',
    replayMethodVersion: QUOTA_REPLAY_METHOD_VERSION,
    status: 'disabled',
    computedAt: null,
    snapshot: null,
    issues: [],
    configurations: [],
    selectedReplays: [],
    selection: { state: 'not_assessed', configurationRefs: [], unassessed: 0 },
    search: {
      admissiblePurchaseSets: 0,
      structurallyExcludedSets: 0,
      assignmentConfigurations: '0',
      evaluatedConfigurations: 0,
      unprocessedConfigurations: '0',
      constructedReferences: 0,
      allocationReferences: 0,
      replaySteps: 0,
      complete: false,
    },
    notice,
  };
  if (options.enabled !== true) return result;
  try {
    const text = JSON.stringify(raw);
    if (typeof text !== 'string') throw new Error();
    if (new TextEncoder().encode(text).length > quotaPortfolioLimits.bytes) {
      result.status = 'capacity';
      result.issues.push('input_capacity');
      return result;
    }
  } catch {
    result.status = 'invalid';
    result.issues.push('invalid_structure');
    return result;
  }
  const parsed = QuotaPortfolioSchema.safeParse(raw);
  if (!parsed.success) {
    result.status = 'invalid';
    result.issues.push('portfolio_structure_invalid');
    return result;
  }
  const input = parsed.data;
  result.snapshot = input;
  result.computedAt = options.now ?? new Date().toISOString();
  const purchases = [...input.purchases].sort((a, b) => a.purchaseRef.localeCompare(b.purchaseRef));
  const groups = [...input.routingGroups].sort((a, b) => a.groupRef.localeCompare(b.groupRef));
  const sets: { selected: Purchase[]; choices: string[][] }[] = [];
  let total = 0n;
  for (let mask = 1; mask < 2 ** purchases.length; mask++) {
    const selected = purchases.filter((_, index) => mask & (1 << index));
    const refs = new Set(selected.map((p) => p.purchaseRef));
    const exclusive = selected.map((p) => p.exclusiveGroup).filter((g): g is string => g !== null);
    const choices = groups.map((g) => g.purchaseRefs.filter((ref) => refs.has(ref)).sort());
    if (
      selected.length > input.search.maxPurchases ||
      input.search.requiredPurchaseRefs.some((ref) => !refs.has(ref)) ||
      selected.some((p) => p.requiresPurchaseRefs.some((ref) => !refs.has(ref))) ||
      new Set(selected.map((p) => p.entitlementRef)).size !== selected.length ||
      new Set(exclusive).size !== exclusive.length ||
      choices.some((c) => !c.length)
    ) {
      result.search.structurallyExcludedSets++;
      continue;
    }
    sets.push({ selected, choices });
    total += choices.reduce((n, c) => n * BigInt(c.length), 1n);
  }
  result.search.admissiblePurchaseSets = sets.length;
  result.search.assignmentConfigurations = total.toString();
  const capacity = (reason: string) => {
    result.status = 'capacity';
    result.issues = [reason];
    result.configurations = [];
    result.selectedReplays = [];
    result.selection = { state: 'not_assessed', configurationRefs: [], unassessed: 0 };
    result.search.unprocessedConfigurations = (
      total - BigInt(result.search.evaluatedConfigurations)
    ).toString();
    return result;
  };
  if (total > BigInt(input.search.maxEvaluations)) return capacity('portfolio_search_capacity');
  const poolMap = new Map(input.pools.map((p) => [p.poolRef, p]));
  const eventMap = new Map(input.events.map((e) => [e.eventRef, e]));
  const paymentMap = new Map(input.payments.map((p) => [p.paymentRef, p]));
  const purchaseMap = new Map(input.purchases.map((p) => [p.purchaseRef, p]));
  const meterMap = new Map(input.meters.map((m) => [m.meterId, m]));
  const allReplays = new Map<string, QuotaReplayResult>();
  let number = 0;
  for (const set of sets) {
    const paymentRefs = union(set.selected.map((p) => p.paymentRefs));
    const poolRefs = union(set.selected.map((p) => p.poolRefs));
    const eventRefs = union(set.selected.map((p) => p.eventRefs));
    const payments = paymentRefs.map((ref) => paymentMap.get(ref)!);
    const sum = (field: 'wholePeriodMinor' | 'inWindowMinor') =>
      payments.some((p) => p[field] === null) ? null : payments.reduce((n, p) => n + p[field]!, 0);
    const fullCost = payments.every((p) => p.coverage === 'all_required_payments_taxes_fees');
    const indices = groups.map(() => 0);
    let done = false;
    while (!done) {
      result.search.allocationReferences += groups.length;
      if (result.search.allocationReferences > quotaPortfolioLimits.allocationReferences)
        return capacity('portfolio_allocation_capacity');
      const allocations = groups.map((g, i) => ({
        groupRef: g.groupRef,
        purchaseRef: set.choices[i][indices[i]],
      }));
      const row: QuotaPortfolioRow = {
        configurationRef: `configuration-${++number}`,
        purchaseRefs: set.selected.map((p) => p.purchaseRef),
        paymentRefs,
        poolRefs,
        allocations,
        state: 'not_evaluated',
        reasons: [],
        assumptions: [],
        metrics: null,
        preferenceEligible: false,
      };
      if (
        set.selected.some((p) => p.eligibility === 'ineligible' || p.executionMatch === 'different')
      ) {
        row.state = 'excluded';
        row.reasons.push('portfolio_purchase_ineligible');
      } else if (
        set.selected.some((p) => p.eligibility === 'unknown' || p.executionMatch === 'unknown')
      ) {
        row.reasons.push('portfolio_purchase_unknown');
      } else if (input.overageCoverage !== 'complete') {
        row.reasons.push('portfolio_overage_unknown');
      } else {
        const routes = new Map<string, Purchase>();
        groups.forEach((g, i) =>
          g.requestRefs.forEach((ref) =>
            routes.set(ref, purchaseMap.get(allocations[i].purchaseRef)!),
          ),
        );
        const requests: QuotaReplayInput['requests'] = input.requests.map((r) => {
          const purchase = routes.get(r.requestRef)!;
          const requiredMeters = new Set(r.demands.map((d) => d.meterId));
          if (purchase.bindings.some((b) => !requiredMeters.has(b.meterId)))
            row.reasons.push('portfolio_route_meter_missing');
          const requirements = r.demands.flatMap((d) => {
            const bindings = purchase.bindings.filter((b) => b.meterId === d.meterId);
            if (!bindings.length) row.reasons.push('common_demand_not_mapped');
            return bindings.map((b) => {
              const meter = meterMap.get(d.meterId)!;
              if (meter.unit === 'unknown' || poolMap.get(b.poolRef)!.unit === 'unknown')
                row.reasons.push('meter_unit_unknown');
              if (meter.unit === 'currency_minor' && meter.currency !== input.currency)
                row.reasons.push('foreign_currency_meter_unsupported');
              if (b.conversion.basis === 'unknown') row.reasons.push('conversion_unknown');
              if (b.conversion.basis === 'explicit_assumption')
                row.assumptions.push('resource_conversion_assumed');
              let units: number | null = null;
              if (d.units === null) row.reasons.push('common_quantity_unknown');
              else {
                const denominator = BigInt(b.conversion.denominator);
                const converted =
                  (BigInt(d.units) * BigInt(b.conversion.numerator) + denominator - 1n) /
                  denominator;
                if (converted > 1000000000000n) row.reasons.push('converted_quantity_out_of_range');
                else units = Number(converted);
              }
              return { poolRef: b.poolRef, classId: d.classId, units };
            });
          });
          result.search.constructedReferences += requirements.length;
          return {
            requestRef: r.requestRef,
            rootTaskRef: r.rootTaskRef,
            atMs: r.atMs,
            sequence: r.sequence,
            latestStartMs: r.latestStartMs,
            durationMs: r.durationMs,
            requirements,
          };
        });
        if (result.search.constructedReferences > quotaPortfolioLimits.constructedReferences)
          return capacity('portfolio_reference_capacity');
        if (!row.reasons.length) {
          const scenario = QuotaReplayInputSchema.safeParse({
            version: 'quota-replay-1',
            scenarioRef: input.comparisonRef,
            plan: 'subscription-portfolio',
            policyVersion: 'quota-portfolio-enumeration-1',
            horizonMs: input.window.horizonMs,
            basis: row.assumptions.length ? 'explicit_scenario' : input.demandBasis,
            eligibility: 'eligible',
            externalDemand: input.externalDemand,
            sameTimeOrder: input.sameTimeOrder,
            requirementsCoverage: input.requirementsCoverage,
            dispatch: 'per_pool_fifo',
            shortage:
              input.overage && !poolRefs.includes(input.overage.poolRef)
                ? 'wait_only'
                : input.shortage,
            pools: poolRefs.map((ref) => poolMap.get(ref)!),
            events: eventRefs.map((ref) => eventMap.get(ref)!),
            requests,
            cost: {
              currency: input.currency,
              wholePeriodFixedMinor: sum('wholePeriodMinor'),
              inWindowFixedMinor: sum('inWindowMinor'),
              adjustments: payments.flatMap((p) => p.adjustments),
              overage:
                input.overage && poolRefs.includes(input.overage.poolRef) ? input.overage : null,
            },
          });
          if (!scenario.success) {
            row.state = 'conflict';
            row.reasons.push('constructed_scenario_invalid');
          } else {
            const remaining = input.search.maxReplaySteps - result.search.replaySteps;
            if (remaining <= 0) return capacity('portfolio_replay_capacity');
            const replay = replayQuota(scenario.data, {
              enabled: true,
              maxSteps: Math.min(quotaReplayLimits.steps, remaining),
            });
            if (replay.status === 'disabled')
              throw new Error('Unexpected disabled portfolio replay');
            result.search.replaySteps += replay.steps;
            if (replay.status === 'incomplete') return capacity('portfolio_replay_capacity');
            row.assumptions.push(...replay.assumptions);
            if (replay.status !== 'complete') {
              row.state = replay.status === 'conflict' ? 'conflict' : 'not_evaluated';
              row.reasons.push(...replay.issues, 'replay_not_complete');
            } else {
              row.state = 'evaluated';
              const metrics = quotaPlanReplayMetrics(input, replay, fullCost);
              row.metrics = metrics.metrics;
              row.preferenceEligible = metrics.preferenceEligible;
              row.reasons.push(...metrics.preferenceReasons);
              allReplays.set(row.configurationRef, replay);
            }
          }
        }
      }
      row.reasons = [...new Set(row.reasons)];
      row.assumptions = [...new Set(row.assumptions)];
      result.configurations.push(row);
      result.search.evaluatedConfigurations++;
      let cursor = indices.length - 1;
      while (cursor >= 0 && ++indices[cursor] === set.choices[cursor].length) {
        indices[cursor] = 0;
        cursor--;
      }
      done = cursor < 0;
    }
  }
  result.search.complete = true;
  result.status = result.configurations.every(
    (r) =>
      r.state === 'excluded' ||
      (r.state === 'evaluated' && r.metrics!.wholePeriodCostMinor !== null),
  )
    ? 'complete'
    : 'partial';
  const eligible = result.configurations.filter((r) => r.preferenceEligible);
  const value = (row: QuotaPortfolioRow) =>
    quotaPlanObjectiveValue(row.metrics!, input.preferences.objective)!;
  const best = eligible.length ? Math.min(...eligible.map(value)) : null;
  result.selection = {
    state: eligible.length ? 'best_among_evaluated' : 'none_meets_preferences',
    configurationRefs: eligible.filter((r) => value(r) === best).map((r) => r.configurationRef),
    unassessed: result.configurations.filter(
      (r) =>
        r.state === 'not_evaluated' ||
        r.state === 'conflict' ||
        (r.state === 'evaluated' &&
          r.metrics!.wholePeriodCostMinor === null &&
          (input.preferences.objective === 'whole_period_cost' ||
            input.preferences.budgetMinor !== null)),
    ).length,
  };
  result.selectedReplays = result.selection.configurationRefs.map((ref) => ({
    configurationRef: ref,
    replay: allReplays.get(ref)!,
  }));
  return result;
}
