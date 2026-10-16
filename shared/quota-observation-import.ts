import { canonical } from './schema.js';
import {
  QuotaObservationImportSchema,
  quotaObservationImportLimits,
  type QuotaObservationImport,
} from './quota-observation-import-schema.js';
import {
  QuotaReplayInputSchema,
  type QuotaReplayInput,
  type ReplayPool,
} from './quota-replay-schema.js';
import { replayQuota, type QuotaAccountingEvent } from './quota-replay.js';
import type { SubscriptionSnapshot } from './subscriptions.js';
import { assessQuotaConsistency } from './quota-consistency.js';

export type QuotaImportDiagnostic = {
  code: string;
  severity: 'missing' | 'conflict';
  poolRef?: string;
  requestRef?: string;
};
export type QuotaObservationImportResult = {
  version: 'quota-observation-import-result-1';
  status: 'disabled' | 'ready' | 'incomplete' | 'conflict' | 'capacity';
  window: QuotaObservationImport['window'] | null;
  counts: { observations: number; pools: number; requests: number; sourceEvents: number } | null;
  assumptions: string[];
  diagnostics: QuotaImportDiagnostic[];
  input: QuotaReplayInput | null;
  notice: string;
};
const notice =
  '本地记录与用户映射说明的一致性检查，不认证供应商来源或任务成果。检查包含一遍额度账目核对；调度情景仍需另行运行。未查询账号、调用模型或上传。';
type SourcePool = SubscriptionSnapshot['pools'][number];
type SourceEvent = NonNullable<SourcePool['ledger']>['events'][number];
type SourceEntry = { poolRef: string; event: SourceEvent };
type StateMapping = NonNullable<QuotaObservationImport['mapping']>['pools'][number]['opening'];
const key = (pool: string, ref: string) => pool + ':' + ref;
const ms = (at: string) => {
  // Preserve source precision; Date.parse alone silently truncates sub-millisecond input.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(at)) return NaN;
  const value = Date.parse(at);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 19) === at.slice(0, 19)
    ? value
    : NaN;
};
const covers = (
  intervals: { from: string; through: string }[],
  start: number,
  end: number,
  openLeft: boolean,
) => {
  const sorted = intervals
    .map((i) => ({ from: ms(i.from), through: ms(i.through) }))
    .sort((a, b) => a.from - b.from);
  let cursor = start,
    started = false;
  for (const i of sorted) {
    if (!Number.isFinite(i.from) || !Number.isFinite(i.through) || i.from >= i.through) continue;
    if (!started ? (openLeft ? i.from >= cursor : i.from > cursor) : i.from > cursor) break;
    if (i.through >= cursor) {
      cursor = i.through;
      started = true;
    }
    if (started && cursor >= end) return true;
  }
  return false;
};

/** Convert only explicitly selected data; disabled means input is not inspected at all. */
export function prepareQuotaReplayFromObservations(
  raw: unknown,
  options: { enabled?: boolean } = {},
): QuotaObservationImportResult {
  const output: QuotaObservationImportResult = {
    version: 'quota-observation-import-result-1',
    status: 'disabled',
    window: null,
    counts: null,
    assumptions: [],
    diagnostics: [],
    input: null,
    notice,
  };
  if (options.enabled !== true) return output;
  const atCapacity = () => output.status === 'capacity';
  const issue = (
    code: string,
    severity: QuotaImportDiagnostic['severity'] = 'missing',
    refs: Pick<QuotaImportDiagnostic, 'poolRef' | 'requestRef'> = {},
  ) => {
    if (output.diagnostics.length >= quotaObservationImportLimits.diagnostics) {
      output.status = 'capacity';
      return;
    }
    output.diagnostics.push({ code, severity, ...refs });
  };
  const finish = () => {
    if (output.status !== 'capacity')
      output.status = output.diagnostics.some((i) => i.severity === 'conflict')
        ? 'conflict'
        : output.diagnostics.length
          ? 'incomplete'
          : 'ready';
    if (output.status !== 'ready') output.input = null;
    return output;
  };
  try {
    const text = JSON.stringify(raw);
    if (
      typeof text !== 'string' ||
      new TextEncoder().encode(text).length > quotaObservationImportLimits.bytes
    ) {
      output.status = 'capacity';
      return output;
    }
  } catch {
    issue('invalid_structure', 'conflict');
    return finish();
  }
  const parsed = QuotaObservationImportSchema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.code === 'too_big' && i.origin === 'array')) {
      output.status = 'capacity';
      return output;
    }
    issue('invalid_structure', 'conflict');
    return finish();
  }
  const source = parsed.data,
    start = ms(source.window.startAt),
    end = ms(source.window.endAt);
  output.window = source.window;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
    issue('time_precision_or_range', 'conflict');
    return finish();
  }
  const observations = new Map<string, SubscriptionSnapshot>();
  const poolIds = new Set<string>();
  for (const observation of source.observations) {
    if (observation.subscriptionRef !== source.subscriptionRef)
      issue('subscription_mismatch', 'conflict');
    const old = observations.get(observation.observationId);
    if (old && canonical(old) !== canonical(observation))
      issue('observation_id_conflict', 'conflict');
    observations.set(observation.observationId, observation);
    for (const p of observation.pools) poolIds.add(p.poolRef);
  }
  output.counts = {
    observations: observations.size,
    pools: poolIds.size,
    requests: 0,
    sourceEvents: 0,
  };
  if (source.mapping === null) {
    issue('mapping_missing');
    return finish();
  }
  const mapping = source.mapping,
    scenario = structuredClone(mapping.scenario),
    claims = mapping.claims;
  output.counts.requests = scenario.requests.length;
  if (scenario.horizonMs !== end - start) issue('window_horizon_mismatch', 'conflict');
  if (claims.requests !== 'complete' || !covers(claims.requestIntervals, start, end, false))
    issue('request_coverage_gap');
  if (claims.accountScope !== 'all_shared_consumption') issue('external_consumption_scope_unknown');
  if (claims.requirements !== 'complete' || scenario.requirementsCoverage !== 'complete')
    issue('request_requirements_incomplete');
  for (const [name, value] of [
    ['pool_rules', claims.poolRules],
    ['same_time_order', claims.sameTimeOrder],
    ['eligibility', claims.eligibility],
  ] as const) {
    if (value === 'unknown') issue(name + '_unknown');
    else if (value === 'assumed') output.assumptions.push(name);
  }
  if (scenario.eligibility !== 'eligible') issue('eligibility_not_confirmed');
  if (scenario.externalDemand === 'unknown') issue('external_consumption_scope_unknown');
  if (scenario.externalDemand === 'assume_none') output.assumptions.push('no_external_consumption');
  if (scenario.sameTimeOrder === 'unknown') issue('same_time_order_unknown');
  if (scenario.sameTimeOrder === 'scenario_sequence') output.assumptions.push('same_time_order');
  if (claims.cost === 'unknown') {
    if (scenario.shortage === 'pay_then_wait_limits') issue('overage_rule_unknown');
    scenario.cost = {
      currency: scenario.cost.currency,
      wholePeriodFixedMinor: null,
      inWindowFixedMinor: null,
      adjustments: [],
      overage: null,
    };
  } else output.assumptions.push('cost_is_explicit_scenario');
  const scenarioPools = new Map(scenario.pools.map((p) => [p.poolRef, p]));
  const poolMappings = new Map(mapping.pools.map((p) => [p.poolRef, p]));
  if (
    poolMappings.size !== mapping.pools.length ||
    poolIds.size !== scenarioPools.size ||
    [...poolIds].some((p) => !scenarioPools.has(p)) ||
    poolMappings.size !== poolIds.size ||
    [...poolMappings.keys()].some((p) => !poolIds.has(p))
  )
    issue('pool_scope_mismatch', 'conflict');
  const first = source.observations[0];
  for (const o of source.observations) {
    if (
      o.provider !== first.provider ||
      o.plan !== first.plan ||
      o.planVersion !== first.planVersion ||
      o.plan !== scenario.plan
    )
      issue('subscription_rule_identity_changed', 'conflict');
  }
  const sourceEvents = new Map<string, SourceEntry>();
  const intervals = new Map<string, { from: string; through: string; ids: Set<string> }[]>();
  let references = 0;
  for (const observation of observations.values())
    for (const pool of observation.pools) {
      if (!pool.ledger) continue;
      const ledger = pool.ledger;
      references += ledger.events.length;
      if (references > quotaObservationImportLimits.references) {
        output.status = 'capacity';
        return finish();
      }
      if (!Number.isFinite(ms(ledger.from)) || !Number.isFinite(ms(ledger.through)))
        issue('time_precision_or_range', 'missing', { poolRef: pool.poolRef });
      const ids = new Set<string>();
      for (const event of ledger.events) {
        const at = ms(event.at);
        if (!Number.isFinite(at)) {
          issue('time_precision_or_range', 'missing', { poolRef: pool.poolRef });
          continue;
        }
        if (at < start || at >= end) continue;
        const k = key(pool.poolRef, event.eventRef),
          old = sourceEvents.get(k);
        if (old && canonical(old.event) !== canonical(event))
          issue('source_event_conflict', 'conflict', { poolRef: pool.poolRef });
        sourceEvents.set(k, { poolRef: pool.poolRef, event });
        ids.add(k);
        if (sourceEvents.size > quotaObservationImportLimits.sourceEvents) {
          output.status = 'capacity';
          return finish();
        }
      }
      if (ledger.coverage === 'complete' && ledger.precision === 'exact') {
        if (!intervals.has(pool.poolRef)) intervals.set(pool.poolRef, []);
        intervals.get(pool.poolRef)!.push({ from: ledger.from, through: ledger.through, ids });
      }
    }
  output.counts.sourceEvents = sourceEvents.size;
  const closing = new Map<string, SourcePool>();
  const boundaryPool = (ref: string, state: StateMapping, expected: number) => {
    const observation = observations.get(state.observationId),
      pool = observation?.pools.find((p) => p.poolRef === ref);
    if (!pool || !observation) {
      issue('state_observation_missing', 'missing', { poolRef: ref });
      return null;
    }
    if (assessQuotaConsistency(pool).status === 'conflict')
      issue('pool_counter_conflict', 'conflict', { poolRef: ref });
    if (
      ms(state.stateAt) !== expected ||
      !Number.isFinite(ms(observation.observedAt)) ||
      ms(observation.observedAt) < expected
    )
      issue('state_time_mismatch', 'conflict', { poolRef: ref });
    if (state.timeBasis === 'unknown')
      issue('state_time_basis_unknown', 'missing', { poolRef: ref });
    if (state.timeBasis === 'assumed') output.assumptions.push('state_time');
    if (
      pool.precision !== 'exact' ||
      pool.remaining === null ||
      !Number.isInteger(pool.remaining) ||
      pool.remaining > 1e12 ||
      pool.unit === 'unknown'
    )
      issue('absolute_state_not_exact', 'missing', { poolRef: ref });
    if (
      pool.capacity.status !== 'finite' ||
      pool.capacity.total === null ||
      !Number.isInteger(pool.capacity.total) ||
      pool.capacity.total > 1e12
    )
      issue('finite_capacity_unknown', 'missing', { poolRef: ref });
    return pool;
  };
  for (const [ref, p] of scenarioPools) {
    const m = poolMappings.get(ref);
    if (!m) continue;
    const open = boundaryPool(ref, m.opening, start),
      close = boundaryPool(ref, m.closing, end);
    if (!open || !close) continue;
    closing.set(ref, close);
    if (m.ledgerMeaning !== 'quota_units_by_event_kind')
      issue('ledger_quantity_meaning_unknown', 'missing', { poolRef: ref });
    if (p.unit === 'unknown') issue('pool_rule_not_supported', 'missing', { poolRef: ref });
    if (open.policyVersion === null || close.policyVersion === null)
      issue('pool_policy_unknown', 'missing', { poolRef: ref });
    else if (open.policyVersion !== p.policyVersion || close.policyVersion !== p.policyVersion)
      issue('pool_policy_mismatch', 'conflict', { poolRef: ref });
    if (
      (open.unit === 'currency_minor' &&
        (open.currency !== scenario.cost.currency || close.currency !== scenario.cost.currency)) ||
      open.currency !== close.currency
    )
      issue('pool_currency_mismatch', 'conflict', { poolRef: ref });
    if (
      p.unit !== 'unknown' &&
      open.unit !== 'unknown' &&
      close.unit !== 'unknown' &&
      (open.unit !== close.unit ||
        (p.unit === 'slot'
          ? open.unit !== 'count' || p.kind !== 'concurrency'
          : open.unit !== p.unit))
    )
      issue('pool_unit_mismatch', 'conflict', { poolRef: ref });
    const compatible =
      p.kind === 'balance'
        ? ['balance', 'period_allowance'].includes(open.semantics)
        : p.kind === 'rolling'
          ? ['period_allowance', 'rate'].includes(open.semantics) && open.window.kind === 'rolling'
          : p.kind === 'concurrency'
            ? open.semantics === 'concurrency'
            : p.kind === 'token_bucket'
              ? open.semantics === 'rate'
              : false;
    if (!compatible || open.semantics !== close.semantics)
      issue('pool_rule_not_supported', 'missing', { poolRef: ref });
    let initial: number | null = null;
    if (p.kind === 'balance' && p.initialLots !== null)
      initial = p.initialLots.reduce((n, l) => n + l.units, 0);
    else if (
      p.kind === 'rolling' &&
      p.capacity !== null &&
      p.initialHistory === 'complete' &&
      p.initialUsage !== null
    ) {
      initial = p.capacity - p.initialUsage.reduce((n, u) => n + u.units, 0);
      if (p.windowMs === null || open.window.durationSeconds === null)
        issue('rolling_window_unknown', 'missing', { poolRef: ref });
      else if (p.windowMs !== open.window.durationSeconds * 1000)
        issue('rolling_window_mismatch', 'conflict', { poolRef: ref });
    } else if (p.kind === 'concurrency' && p.capacity !== null && p.initialReservations !== null)
      initial = p.capacity - p.initialReservations.reduce((n, u) => n + u.units, 0);
    else if (p.kind === 'token_bucket' && p.refill !== null) initial = p.initialAvailable;
    if (initial === null) issue('initial_history_missing', 'missing', { poolRef: ref });
    else if (open.remaining !== null && open.precision === 'exact' && initial !== open.remaining)
      issue('opening_state_mismatch', 'conflict', { poolRef: ref });
    if (
      p.kind !== 'balance' &&
      p.kind !== 'unsupported' &&
      (p.capacity !== open.capacity.total || p.capacity !== close.capacity.total)
    )
      issue('capacity_changed_without_rule', 'conflict', { poolRef: ref });
    const complete = (intervals.get(ref) ?? []).map((interval) => ({
      ...interval,
      fromMs: ms(interval.from),
      throughMs: ms(interval.through),
    }));
    if (!covers(complete, start, end, true))
      issue('ledger_coverage_gap', 'missing', { poolRef: ref });
    for (const entry of sourceEvents.values())
      if (entry.poolRef === ref) {
        const at = ms(entry.event.at);
        for (const i of complete)
          if (at > i.fromMs && at <= i.throughMs && !i.ids.has(key(ref, entry.event.eventRef)))
            issue('complete_ledgers_disagree', 'conflict', { poolRef: ref });
        if (atCapacity()) return finish();
      }
  }
  for (const p of scenario.pools) {
    if (p.kind === 'balance' && p.initialLots?.some((l) => l.appliesTo.kind === 'unknown'))
      issue('pool_applicability_unknown', 'missing', { poolRef: p.poolRef });
  }
  for (const e of scenario.events) {
    const lots = e.kind === 'grant' ? [e.lot] : e.kind === 'reset' ? e.newLots : [];
    if (lots.some((l) => l.appliesTo.kind === 'unknown'))
      issue('pool_applicability_unknown', 'missing', { poolRef: e.poolRef });
  }
  if (output.diagnostics.length || atCapacity()) return finish();
  const usedSource = new Set<string>(),
    expectedTrace = new Map<string, SourceEvent>();
  const traceKey = (kind: QuotaAccountingEvent['kind'], pool: string, ref: string) =>
    kind + ':' + key(pool, ref);
  const bind = (
    pool: string,
    sourceRef: string,
    kind: QuotaAccountingEvent['kind'],
    ref: string,
    sourceKind: SourceEvent['kind'],
  ) => {
    const k = key(pool, sourceRef),
      entry = sourceEvents.get(k),
      tk = traceKey(kind, pool, ref);
    if (!entry) {
      issue('source_event_missing', 'missing', { poolRef: pool });
      return;
    }
    if (usedSource.has(k) || expectedTrace.has(tk))
      issue('source_event_reused', 'conflict', { poolRef: pool });
    usedSource.add(k);
    expectedTrace.set(tk, entry.event);
    if (entry.event.kind !== sourceKind)
      issue('source_event_kind_mismatch', 'conflict', { poolRef: pool });
    if (
      entry.event.amount === null ||
      !Number.isInteger(entry.event.amount) ||
      entry.event.amount > 1e12
    )
      issue('source_event_units_unknown', 'missing', { poolRef: pool });
  };
  const requestMap = new Map(mapping.requests.map((r) => [r.requestRef, r]));
  const requestIds = new Set(scenario.requests.map((r) => r.requestRef));
  if (
    requestMap.size !== mapping.requests.length ||
    requestMap.size !== scenario.requests.length ||
    [...requestMap.keys()].some((id) => !requestIds.has(id))
  )
    issue('request_mapping_scope_mismatch', 'conflict');
  const actualRequests: QuotaReplayInput['requests'] = [];
  for (const r of scenario.requests) {
    const m = requestMap.get(r.requestRef);
    if (!m) continue;
    const refs = { requestRef: r.requestRef };
    if (ms(m.arrivalAt) - start !== r.atMs) issue('request_arrival_mismatch', 'conflict', refs);
    if (m.arrivalBasis === 'unknown') issue('request_arrival_basis_unknown', 'missing', refs);
    if (m.arrivalBasis === 'assumed') output.assumptions.push('request_arrival');
    if (m.consumption === 'unknown') {
      issue('consumption_outcome_unknown', 'missing', refs);
      continue;
    }
    if (r.requirements.some((q) => q.units === null))
      issue('request_units_unknown', 'missing', refs);
    if (
      r.durationMs === null &&
      r.requirements.some((q) => scenarioPools.get(q.poolRef)?.kind === 'concurrency')
    )
      issue('request_duration_unknown', 'missing', refs);
    if (m.consumption === 'not_consumed') {
      if (m.charges.length || m.chargedAt !== null || m.chargeSequence !== null)
        issue('unconsumed_request_has_charge', 'conflict', refs);
      continue;
    }
    const at = m.chargedAt === null ? NaN : ms(m.chargedAt) - start;
    if (
      !Number.isInteger(at) ||
      at < r.atMs ||
      at >= scenario.horizonMs ||
      m.chargeSequence === null
    ) {
      issue('charge_time_or_order_missing', 'missing', refs);
      continue;
    }
    if (new Set(m.charges.map((c) => c.poolRef)).size !== m.charges.length)
      issue('request_pool_charge_repeated', 'conflict', refs);
    for (const q of r.requirements) {
      const charge = m.charges.find((c) => c.poolRef === q.poolRef);
      if (!charge) {
        if (q.units !== 0) issue('request_pool_charge_missing', 'missing', refs);
        continue;
      }
      bind(charge.poolRef, charge.sourceEventRef, 'usage', r.requestRef, 'usage');
      const event = sourceEvents.get(key(charge.poolRef, charge.sourceEventRef))?.event;
      if (event && (ms(event.at) - start !== at || event.amount !== q.units))
        issue('charge_time_or_units_mismatch', 'conflict', refs);
      if (
        event?.beforeUsed !== null &&
        event?.beforeUsed !== undefined &&
        event.afterUsed !== null &&
        event.afterUsed - event.beforeUsed !== event.amount
      )
        issue('usage_counter_mismatch', 'conflict', refs);
    }
    if (m.charges.some((c) => !r.requirements.some((q) => q.poolRef === c.poolRef)))
      issue('charge_outside_request_scope', 'conflict', refs);
    actualRequests.push({ ...r, atMs: at, latestStartMs: at, sequence: m.chargeSequence! });
  }
  const events = new Map(scenario.events.map((e) => [e.eventRef, e]));
  if (
    new Set(mapping.events.map((e) => e.eventRef)).size !== mapping.events.length ||
    mapping.events.length !== events.size
  )
    issue('boundary_mapping_scope_mismatch', 'conflict');
  for (const m of mapping.events) {
    const event = events.get(m.eventRef);
    if (!event || event.poolRef !== m.poolRef) {
      issue('boundary_event_missing', 'conflict', { poolRef: m.poolRef });
      continue;
    }
    bind(
      m.poolRef,
      m.sourceEventRef,
      event.kind,
      event.eventRef,
      event.kind === 'return_to_lot' || event.kind === 'release_rolling_usage'
        ? 'refund'
        : event.kind,
    );
  }
  for (const m of mapping.expirations)
    bind(m.poolRef, m.sourceEventRef, 'expiration', m.lotRef, 'expiration');
  for (const m of mapping.recoveries)
    bind(m.poolRef, m.sourceEventRef, 'recovery', m.debitRef, 'refund');
  for (const k of sourceEvents.keys())
    if (!usedSource.has(k))
      issue('unmapped_source_event', 'missing', { poolRef: sourceEvents.get(k)!.poolRef });
  if (output.diagnostics.length || atCapacity()) return finish();
  if (
    output.assumptions.length ||
    scenario.basis === 'explicit_scenario' ||
    claims.sameTimeOrder === 'assumed'
  )
    scenario.basis = 'explicit_scenario';
  else scenario.basis = 'observed_demand';
  scenario.sameTimeOrder = output.assumptions.includes('same_time_order')
    ? 'scenario_sequence'
    : 'source_sequence';
  const actual = {
    ...scenario,
    requests: actualRequests,
    shortage: scenario.shortage,
    cost: {
      currency: scenario.cost.currency,
      wholePeriodFixedMinor: null,
      inWindowFixedMinor: null,
      adjustments: [],
      overage: scenario.cost.overage,
    },
  };
  const validActual = QuotaReplayInputSchema.safeParse(actual);
  if (!validActual.success) {
    issue('observed_charge_order_conflict', 'conflict');
    return finish();
  }
  const seen = new Set<string>();
  let traceCount = 0;
  const accounting = replayQuota(validActual.data, {
    enabled: true,
    onAccountingEvent(event) {
      if (event.atMs >= scenario.horizonMs) return;
      if (++traceCount > quotaObservationImportLimits.references) {
        output.status = 'capacity';
        return;
      }
      const k = traceKey(event.kind, event.poolRef, event.ref),
        original = expectedTrace.get(k);
      if (!original) {
        if (
          event.units !== 0 &&
          (event.kind !== 'recovery' || scenarioPools.get(event.poolRef)?.kind !== 'token_bucket')
        )
          issue('unrecorded_accounting_event', 'missing', { poolRef: event.poolRef });
        return;
      }
      if (seen.has(k)) issue('accounting_event_repeated', 'conflict', { poolRef: event.poolRef });
      seen.add(k);
      if (ms(original.at) - start !== event.atMs || original.amount !== event.units)
        issue('accounting_event_mismatch', 'conflict', { poolRef: event.poolRef });
    },
  });
  if (accounting.status === 'disabled') throw new Error('Unexpected disabled quota accounting');
  if (accounting.status === 'incomplete') output.status = 'capacity';
  else if (accounting.status !== 'complete') issue('accounting_could_not_complete', 'conflict');
  if (accounting.requests.some((r) => r.status !== 'scheduled' || r.startedAtMs !== r.arrivedAtMs))
    issue('observed_charge_not_affordable', 'conflict');
  for (const k of expectedTrace.keys())
    if (!seen.has(k)) issue('source_event_not_reproduced', 'conflict');
  for (const p of accounting.pools) {
    const expected = closing.get(p.poolRef);
    if (p.remainingUnits !== expected?.remaining)
      issue('closing_state_mismatch', 'conflict', { poolRef: p.poolRef });
  }
  output.assumptions = [...new Set(output.assumptions)];
  output.input = QuotaReplayInputSchema.parse(scenario);
  return finish();
}
