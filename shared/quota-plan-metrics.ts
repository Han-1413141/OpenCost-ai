import type { QuotaPlanComparison } from './quota-plan-comparison-schema.js';
import type { QuotaPlanCandidateResult } from './quota-plan-comparison.js';
import type { QuotaReplayResult } from './quota-replay.js';

export function quotaPlanReplayMetrics(
  input: Pick<QuotaPlanComparison, 'preferences' | 'requests'>,
  replay: QuotaReplayResult,
  fullCost: boolean,
): Pick<QuotaPlanCandidateResult, 'metrics' | 'preferenceEligible' | 'preferenceReasons'> {
  const required = input.requests.filter(
    (r) => input.preferences.coverage === 'all_requests' || r.required,
  );
  const requiredSet = new Set(required.map((r) => r.requestRef));
  const scheduled = replay.requests.filter(
    (r) => requiredSet.has(r.requestRef) && r.status === 'scheduled',
  );
  const fullRequired = required.length > 0 && scheduled.length === required.length;
  const metrics = {
    scheduled: replay.summary.scheduled!,
    unmet: replay.summary.unmet!,
    requests: input.requests.length,
    requiredScheduled: scheduled.length,
    requiredCount: required.length,
    requiredWaitTotalMs: fullRequired ? scheduled.reduce((n, r) => n + r.waitMs!, 0) : null,
    requiredWaitMaxMs: fullRequired ? scheduled.reduce((n, r) => Math.max(n, r.waitMs!), 0) : null,
    wholePeriodCostMinor: fullCost ? replay.cost.wholePeriodTotalMinor : null,
    windowCashMinor: fullCost ? replay.cost.inWindowCashMinor : null,
    steps: replay.steps,
  };
  const reasons: string[] = [];
  if (!required.length) reasons.push('no_required_requests');
  else if (!fullRequired) reasons.push('required_requests_unmet');
  if (!fullCost) reasons.push('purchase_cost_coverage_incomplete');
  if (input.preferences.budgetMinor !== null) {
    if (metrics.wholePeriodCostMinor === null) reasons.push('budget_cannot_be_checked');
    else if (metrics.wholePeriodCostMinor > input.preferences.budgetMinor)
      reasons.push('over_budget');
  }
  if (
    input.preferences.maxWaitMs !== null &&
    (metrics.requiredWaitMaxMs === null || metrics.requiredWaitMaxMs > input.preferences.maxWaitMs)
  )
    reasons.push('wait_limit_not_met');
  if (input.preferences.objective === 'whole_period_cost' && metrics.wholePeriodCostMinor === null)
    reasons.push('purchase_cost_unknown');
  return {
    metrics,
    preferenceReasons: reasons,
    preferenceEligible:
      reasons.every((reason) => reason === 'purchase_cost_coverage_incomplete') && fullRequired,
  };
}

export function quotaPlanObjectiveValue(
  metrics: NonNullable<QuotaPlanCandidateResult['metrics']>,
  objective: QuotaPlanComparison['preferences']['objective'],
) {
  return metrics[
    objective === 'whole_period_cost'
      ? 'wholePeriodCostMinor'
      : objective === 'required_wait_total'
        ? 'requiredWaitTotalMs'
        : 'requiredWaitMaxMs'
  ];
}
