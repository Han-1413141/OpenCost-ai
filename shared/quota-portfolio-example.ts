import { quotaPlanComparisonExample } from './quota-plan-comparison-example.js';
import { QuotaPortfolioSchema, type QuotaPortfolio } from './quota-portfolio-schema.js';

/** Explicit local scenario, never a provider offer or uploaded community fact. */
export function quotaPortfolioExample(): QuotaPortfolio {
  const base = quotaPlanComparisonExample();
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const source = base.candidates[0].pools[0];
  if (source.kind !== 'balance') throw new Error();
  const prices = [100, 120, 300],
    capacities = [100, 100, 200];
  return QuotaPortfolioSchema.parse({
    version: 'quota-portfolio-1',
    comparisonRef: id(200),
    window: { ...base.window, horizonMs: 2000 },
    execution: base.execution,
    demandBasis: 'explicit_scenario',
    externalDemand: 'assume_none',
    sameTimeOrder: 'scenario_sequence',
    requirementsCoverage: 'complete',
    meters: base.meters,
    currency: 'CNY',
    preferences: base.preferences,
    requests: [0, 1].map((i) => ({
      requestRef: id(210 + i),
      rootTaskRef: id(220 + i),
      atMs: 0,
      sequence: i + 1,
      latestStartMs: 1000,
      durationMs: 0,
      required: true,
      demands: [{ meterId: 'messages', classId: 'standard', units: 60 }],
    })),
    pools: capacities.map((units, i) => ({
      ...structuredClone(source),
      poolRef: id(230 + i),
      initialLots: [
        {
          ...structuredClone(source.initialLots![0]),
          lotRef: id(240 + i),
          units,
          expiresAtMs: null,
          appliesTo: { kind: 'all' },
        },
      ],
    })),
    events: [],
    shortage: 'wait_only',
    overage: null,
    overageCoverage: 'complete',
    payments: prices.map((price, i) => ({
      paymentRef: id(250 + i),
      wholePeriodMinor: price,
      inWindowMinor: price,
      adjustments: [],
      coverage: 'all_required_payments_taxes_fees',
      priceRecord: { capturedAt: base.window.startAt, snapshotId: null, source: 'user_input' },
    })),
    purchases: prices.map((_, i) => ({
      purchaseRef: id(260 + i),
      entitlementRef: id(270 + i),
      plan: ['example-small-a', 'example-small-b', 'example-larger'][i],
      policyVersion: 'v1',
      eligibility: 'eligible',
      executionMatch: 'matches',
      exclusiveGroup: null,
      requiresPurchaseRefs: [],
      poolRefs: [id(230 + i)],
      eventRefs: [],
      paymentRefs: [id(250 + i)],
      bindings: [
        {
          poolRef: id(230 + i),
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
    routingGroups: [0, 1].map((i) => ({
      groupRef: id(280 + i),
      requestRefs: [id(210 + i)],
      purchaseRefs: prices.map((_, j) => id(260 + j)),
    })),
    search: {
      maxPurchases: 3,
      requiredPurchaseRefs: [],
      maxEvaluations: 64,
      maxReplaySteps: 1000000,
    },
  });
}
