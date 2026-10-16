import { quotaObservationImportExample } from './quota-observation-import-example.js';
import {
  QuotaPlanComparisonSchema,
  type QuotaPlanComparison,
} from './quota-plan-comparison-schema.js';

/** Local method example, never a real offer or a community record. */
export function quotaPlanComparisonExample(): QuotaPlanComparison {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const source = quotaObservationImportExample(),
    scenario = source.mapping!.scenario;
  const base = scenario.pools[0];
  if (base.kind !== 'balance') throw new Error();
  return QuotaPlanComparisonSchema.parse({
    version: 'quota-plan-comparison-1',
    comparisonRef: id(100),
    window: { startAt: source.window.startAt, horizonMs: scenario.horizonMs },
    execution: {
      provider: 'example-provider',
      model: 'example-model',
      modelVersion: 'v1',
      harness: 'example-harness',
      harnessVersion: 'v1',
      harnessSurface: 'cli',
      variant: null,
      mode: 'agent',
      tools: 'standard',
      reasoning: 'medium',
      cache: 'off',
    },
    demandBasis: 'explicit_scenario',
    externalDemand: 'included',
    sameTimeOrder: 'source_sequence',
    requirementsCoverage: 'complete',
    meters: [{ meterId: 'messages', unit: 'message', currency: null }],
    currency: 'CNY',
    requests: scenario.requests.map((r) => ({
      requestRef: r.requestRef,
      rootTaskRef: r.rootTaskRef,
      atMs: r.atMs,
      sequence: r.sequence,
      latestStartMs: r.latestStartMs,
      durationMs: r.durationMs,
      required: true,
      demands: r.requirements.map((q) => ({
        meterId: 'messages',
        classId: q.classId,
        units: q.units,
      })),
    })),
    preferences: {
      objective: 'whole_period_cost',
      coverage: 'all_requests',
      budgetMinor: null,
      maxWaitMs: null,
    },
    candidates: [
      { ref: 101, plan: 'example-periodic', price: 100, capacity: 100, reset: true },
      { ref: 102, plan: 'example-larger', price: 150, capacity: 200, reset: false },
      { ref: 103, plan: 'example-smaller', price: 50, capacity: 100, reset: false },
      { ref: 104, plan: 'example-expensive', price: 200, capacity: 100, reset: true },
    ].map((c) => ({
      candidateRef: id(c.ref),
      plan: c.plan,
      policyVersion: 'v1',
      eligibility: 'eligible',
      pools: [
        { ...structuredClone(base), initialLots: [{ ...base.initialLots![0], units: c.capacity }] },
      ],
      events: c.reset ? structuredClone(scenario.events) : [],
      shortage: 'wait_only',
      cost: {
        ...structuredClone(scenario.cost),
        wholePeriodFixedMinor: c.price,
        inWindowFixedMinor: c.price,
      },
      costCoverage: 'all_required_payments_taxes_fees',
      priceRecord: { capturedAt: source.window.startAt, snapshotId: null, source: 'user_input' },
      bindings: [
        {
          poolRef: base.poolRef,
          meterId: 'messages',
          conversion: {
            numerator: 1,
            denominator: 1,
            rounding: 'ceil_per_request',
            basis: 'explicit_assumption',
          },
        },
      ],
    })),
  });
}
