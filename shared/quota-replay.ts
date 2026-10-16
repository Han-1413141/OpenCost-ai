import {
  QuotaReplayInputSchema,
  quotaReplayLimits,
  type QuotaReplayInput,
  type ReplayPool,
  type QuotaLot,
} from './quota-replay-schema.js';

export const quotaReplayNotice =
  '这是按明确规则和需求进行的额度情景回放，获准请求不等于任务完成或验收。没有调用模型、查询账户、上传数据或改变公共榜单；结果不保证供应商未来容量或模型效果。';
export const QUOTA_REPLAY_METHOD_VERSION = 'quota-replay-method-2' as const;
export type QuotaAccountingEvent = {
  kind:
    | 'usage'
    | 'grant'
    | 'reset'
    | 'return_to_lot'
    | 'release_rolling_usage'
    | 'expiration'
    | 'recovery';
  poolRef: string;
  atMs: number;
  ref: string;
  units: number;
};
export type ReplayRequestResult = {
  requestRef: string;
  rootTaskRef: string;
  arrivedAtMs: number;
  startedAtMs: number | null;
  serviceEndsAtMs: number | null;
  waitMs: number | null;
  waitIsLowerBound: boolean;
  status: 'scheduled' | 'unmet' | 'unknown';
  reason:
    | 'capacity_available'
    | 'deadline'
    | 'horizon'
    | 'exceeds_hard_capacity'
    | 'input_unknown'
    | 'operation_budget'
    | 'event_conflict';
  blockedPools: string[];
};
export type ReplayPoolResult = {
  poolRef: string;
  kind: ReplayPool['kind'];
  unit: ReplayPool['unit'];
  remainingUnits: number | null;
  remainingExact?: { numerator: string; denominator: number };
  consumedUnits: number;
  issuedUnits: number;
  expiredUnusedUnits: number;
  resetDiscardedUnits: number;
  rollingRecoveredUnits: number;
  returnedUnits: number;
  returnLostUnits: number;
  activeOccupancyUnits: number | null;
  overageUnits: number;
};
export type QuotaReplayResult = {
  version: 'quota-replay-result-1';
  methodVersion?: typeof QUOTA_REPLAY_METHOD_VERSION;
  scenarioRef: string;
  plan: string;
  policyVersion: string;
  status: 'complete' | 'not_evaluated' | 'incomplete' | 'conflict';
  horizonMs: number;
  processedThroughMs: number | null;
  currentTimestampComplete: boolean | null;
  steps: number;
  inputBasis: QuotaReplayInput['basis'];
  assumptions: string[];
  issues: string[];
  requests: ReplayRequestResult[];
  pools: ReplayPoolResult[];
  summary: {
    requests: number;
    rootTasks: number;
    scheduled: number | null;
    unmet: number | null;
    unknown: number;
    waitTotalMs: number | null;
    waitMaximumMs: number | null;
  };
  cost: {
    currency: QuotaReplayInput['cost']['currency'];
    wholePeriodFixedMinor: number | null;
    inWindowFixedMinor: number | null;
    adjustmentMinor: number;
    overageMinor: number | null;
    wholePeriodTotalMinor: number | null;
    inWindowCashMinor: number | null;
    note: string;
  };
  notice: string;
};

type LotState = QuotaLot & { remaining: number; active: boolean; issued: number };
type TimedUsage = {
  ref: string;
  units: number;
  original: number;
  returned: number;
  until: number;
  active: boolean;
};
type PoolState = {
  spec: ReplayPool;
  lots: LotState[];
  activeLots: Set<LotState>;
  lotMap: Map<string, LotState>;
  useMap: Map<string, TimedUsage>;
  occupied: number;
  tokens: bigint;
  updatedAt: number;
  queue: number[];
  head: number;
  wakeAt: number | null;
  stats: ReplayPoolResult;
};
type Event = {
  at: number;
  phase: 0 | 1 | 2 | 3;
  sequence: number;
  kind: 'wake' | 'expire' | 'recover' | 'boundary' | 'arrival' | 'deadline' | 'end';
  pool?: string;
  index?: number;
  lot?: LotState;
  usage?: TimedUsage;
};
class EventHeap {
  values: Event[] = [];
  less(a: Event, b: Event) {
    return (
      a.at < b.at ||
      (a.at === b.at && (a.phase < b.phase || (a.phase === b.phase && a.sequence < b.sequence)))
    );
  }
  push(e: Event) {
    let i = this.values.length;
    this.values.push(e);
    while (i) {
      const p = (i - 1) >> 1;
      if (!this.less(e, this.values[p])) break;
      this.values[i] = this.values[p];
      i = p;
    }
    this.values[i] = e;
  }
  pop() {
    const first = this.values[0],
      last = this.values.pop()!;
    if (this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let k = i * 2 + 1;
        if (k + 1 < this.values.length && this.less(this.values[k + 1], this.values[k])) k++;
        if (!this.less(this.values[k], last)) break;
        this.values[i] = this.values[k];
        i = k;
      }
      this.values[i] = last;
    }
    return first;
  }
}
const applies = (rule: QuotaLot['appliesTo'], classId: string) =>
  rule.kind === 'all' || (rule.kind === 'classes' && rule.ids.includes(classId));
const rounded = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator;
const knownMoney = (v: bigint | null) =>
  v !== null && v >= 0n && v <= 10000000000n ? Number(v) : null;
const unique = <T extends { eventRef: string }>(items: T[]) => [
  ...new Map(items.map((e) => [e.eventRef, e])).values(),
];

/** No timers or external reads: advance only to explicit boundaries and calculated recoveries. */
export function replayQuota(
  input: unknown,
  options: {
    enabled?: boolean;
    maxSteps?: number;
    onAccountingEvent?: (event: QuotaAccountingEvent) => void;
  } = {},
): QuotaReplayResult | { version: 'quota-replay-result-1'; status: 'disabled'; notice: string } {
  if (options.enabled !== true)
    return {
      version: 'quota-replay-result-1',
      status: 'disabled',
      notice: '共享额度回放默认关闭；未读取或解析输入。',
    };
  const s = QuotaReplayInputSchema.parse(input),
    events = unique(s.events);
  const stepLimit = options.maxSteps ?? quotaReplayLimits.steps;
  if (!Number.isSafeInteger(stepLimit) || stepLimit < 1 || stepLimit > quotaReplayLimits.steps)
    throw new Error('处理步骤预算必须是 1 至 200000 的整数，不能超过内置上限。');
  const issues: string[] = [],
    assumptions = [
      s.basis === 'explicit_scenario'
        ? '需求为明确的用户情景，不是真实工作成绩。'
        : '请求需求来自观察记录，调度仍按本情景规则模拟。',
      '同池请求按共同到达顺序排队；独立池可继续处理，所有约束一次满足后才扣除。',
      '有效期为左闭右开区间；恢复和到期先于同刻有序操作，最晚开始时间包含该时点，但回放结束时点不再安排新请求。',
    ];
  if (s.eligibility !== 'eligible')
    issues.push(s.eligibility === 'ineligible' ? 'plan_ineligible' : 'eligibility_unknown');
  if (s.externalDemand === 'unknown') issues.push('external_demand_unknown');
  if (s.externalDemand === 'assume_none') assumptions.push('本情景假设没有未列出的外部共享消费。');
  if (s.requirementsCoverage !== 'complete') issues.push('requirements_incomplete');
  if (s.sameTimeOrder === 'scenario_sequence')
    assumptions.push('同刻序号由情景指定，不表示供应商承诺的真实顺序。');
  if (s.sameTimeOrder === 'unknown') {
    const times = [...s.requests.map((r) => r.atMs), ...events.map((e) => e.atMs)];
    if (new Set(times).size !== times.length) issues.push('same_time_order_unknown');
  }
  for (const p of s.pools) {
    if (p.unit === 'unknown') issues.push('quota_unit_unknown');
    if (p.kind === 'unsupported') issues.push('unsupported_pool_policy');
    if (
      p.kind === 'balance' &&
      (p.initialLots === null || p.initialLots.some((l) => l.appliesTo.kind === 'unknown'))
    )
      issues.push('balance_initial_or_eligibility_unknown');
    if (
      p.kind === 'rolling' &&
      (p.capacity === null ||
        p.windowMs === null ||
        p.initialUsage === null ||
        p.initialHistory !== 'complete')
    )
      issues.push('rolling_initial_history_unknown');
    if (p.kind === 'concurrency' && (p.capacity === null || p.initialReservations === null))
      issues.push('initial_concurrency_unknown');
    if (
      p.kind === 'token_bucket' &&
      (p.capacity === null || p.initialAvailable === null || p.refill === null)
    )
      issues.push('token_bucket_policy_unknown');
  }
  for (const e of events) {
    const lots = e.kind === 'grant' ? [e.lot] : e.kind === 'reset' ? e.newLots : [];
    if (lots.some((l) => l.appliesTo.kind === 'unknown')) issues.push('grant_eligibility_unknown');
  }
  if (s.requests.some((r) => r.requirements.some((q) => q.units === null)))
    issues.push('demand_units_unknown');
  const specs = new Map(s.pools.map((p) => [p.poolRef, p]));
  if (
    s.requests.some(
      (r) =>
        r.durationMs === null &&
        r.requirements.some((q) => specs.get(q.poolRef)!.kind === 'concurrency'),
    )
  )
    issues.push('occupancy_duration_unknown');
  if (s.shortage === 'pay_then_wait_limits' && s.cost.overage?.appliesTo.kind === 'unknown')
    issues.push('overage_eligibility_unknown');
  if (s.shortage === 'pay_then_wait_limits' && s.cost.overage === null)
    issues.push('overage_rule_missing');
  const results: ReplayRequestResult[] = s.requests.map((r) => ({
    requestRef: r.requestRef,
    rootTaskRef: r.rootTaskRef,
    arrivedAtMs: r.atMs,
    startedAtMs: null,
    serviceEndsAtMs: null,
    waitMs: null,
    waitIsLowerBound: true,
    status: 'unknown',
    reason: 'input_unknown',
    blockedPools: [],
  }));
  const cash = unique(s.cost.adjustments).reduce(
    (sum, e) => sum + (e.kind === 'debit' ? BigInt(e.amountMinor) : -BigInt(e.amountMinor)),
    0n,
  );
  let extraNumerator = 0n,
    extraRounded = 0n,
    steps = 0,
    now = 0,
    status: QuotaReplayResult['status'] = issues.length ? 'not_evaluated' : 'complete';
  const states = new Map<string, PoolState>();
  const cost = () => {
    const extra =
      status === 'complete'
        ? s.cost.overage?.rounding === 'ceil_total'
          ? rounded(extraNumerator, BigInt(s.cost.overage.perUnits))
          : extraRounded
        : null;
    const full =
      extra === null || s.cost.wholePeriodFixedMinor === null
        ? null
        : BigInt(s.cost.wholePeriodFixedMinor) + cash + extra;
    const inWindow =
      extra === null || s.cost.inWindowFixedMinor === null
        ? null
        : BigInt(s.cost.inWindowFixedMinor) + cash + extra;
    if (extra !== null && knownMoney(extra) === null && !issues.includes('cost_out_of_range'))
      issues.push('cost_out_of_range');
    if (
      full !== null &&
      knownMoney(full) === null &&
      !issues.includes('whole_period_cost_not_comparable')
    )
      issues.push('whole_period_cost_not_comparable');
    // Cash may legitimately be negative due to a refund; it is never a negative cost score.
    const windowCash =
      inWindow !== null && inWindow >= -10000000000n && inWindow <= 10000000000n
        ? Number(inWindow)
        : null;
    return {
      currency: s.cost.currency,
      wholePeriodFixedMinor: s.cost.wholePeriodFixedMinor,
      inWindowFixedMinor: s.cost.inWindowFixedMinor,
      adjustmentMinor: Number(cash),
      overageMinor: knownMoney(extra),
      wholePeriodTotalMinor: knownMoney(full),
      inWindowCashMinor: windowCash,
      note: '覆盖情景的完整周期固定费用只计一次，包含闲置；窗口内现金另列。现金退款不恢复额度，额度退回不产生现金退款。按量补足只作用于明确的一条线性规则，不能绕过其他限额；未模拟订阅分摊或任务验收。',
    };
  };
  const finish = (): QuotaReplayResult => {
    const c = cost();
    const scheduled = results.filter((r) => r.status === 'scheduled'),
      unmet = results.filter((r) => r.status === 'unmet');
    return {
      version: 'quota-replay-result-1',
      methodVersion: QUOTA_REPLAY_METHOD_VERSION,
      scenarioRef: s.scenarioRef,
      plan: s.plan,
      policyVersion: s.policyVersion,
      status,
      horizonMs: s.horizonMs,
      processedThroughMs: status === 'not_evaluated' ? null : now,
      currentTimestampComplete: status === 'not_evaluated' ? null : status === 'complete',
      steps,
      inputBasis: s.basis,
      assumptions,
      issues: [...new Set(issues)],
      requests: results,
      pools: [...states.values()].map((p) => p.stats),
      summary: {
        requests: results.length,
        rootTasks: new Set(s.requests.map((r) => r.rootTaskRef)).size,
        scheduled: status === 'not_evaluated' ? null : scheduled.length,
        unmet: status === 'not_evaluated' ? null : unmet.length,
        unknown: results.filter((r) => r.status === 'unknown').length,
        waitTotalMs:
          status === 'not_evaluated' ? null : scheduled.reduce((n, r) => n + r.waitMs!, 0),
        waitMaximumMs: scheduled.length
          ? scheduled.reduce((n, r) => Math.max(n, r.waitMs!), 0)
          : null,
      },
      cost: c,
      notice: quotaReplayNotice,
    };
  };
  if (issues.length) return finish();
  const heap = new EventHeap();
  let issueOrder = 0;
  const terminal = new Set<number>(),
    arrived = new Set<number>(),
    ready: number[] = [],
    readySet = new Set<number>();
  const budget = () => {
    if (++steps > stepLimit) throw new Error('operation_budget');
  };
  const wake = (at: number, pool: string) => {
    if (at > now && at <= s.horizonMs) heap.push({ at, phase: 0, sequence: 0, kind: 'wake', pool });
  };
  const sortLots = (p: PoolState) =>
    p.lots.sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.expiresAtMs ?? Infinity) - (b.expiresAtMs ?? Infinity) ||
        a.issued - b.issued,
    );
  const addLot = (p: PoolState, l: QuotaLot) => {
    const x = { ...l, remaining: l.units, active: true, issued: issueOrder++ };
    p.activeLots.add(x);
    p.lotMap.set(x.lotRef, x);
    p.stats.issuedUnits += x.units;
    if (x.remaining) {
      p.lots.push(x);
      sortLots(p);
    }
    if (l.expiresAtMs !== null && l.expiresAtMs <= s.horizonMs)
      heap.push({
        at: l.expiresAtMs,
        phase: 0,
        sequence: 0,
        kind: 'expire',
        pool: p.spec.poolRef,
        lot: x,
      });
  };
  const addUse = (p: PoolState, ref: string, units: number, until: number) => {
    const x = { ref, units, original: units, returned: 0, until, active: until > now && units > 0 };
    p.useMap.set(ref, x);
    if (x.active) {
      p.occupied += units;
      if (until <= s.horizonMs)
        heap.push({
          at: until,
          phase: 0,
          sequence: 0,
          kind: 'recover',
          pool: p.spec.poolRef,
          usage: x,
        });
    }
  };
  for (const spec of s.pools) {
    const p: PoolState = {
      spec,
      lots: [],
      activeLots: new Set(),
      lotMap: new Map(),
      useMap: new Map(),
      occupied: 0,
      tokens: 0n,
      updatedAt: 0,
      queue: [],
      head: 0,
      wakeAt: null,
      stats: {
        poolRef: spec.poolRef,
        kind: spec.kind,
        unit: spec.unit,
        remainingUnits: null,
        consumedUnits: 0,
        issuedUnits: 0,
        expiredUnusedUnits: 0,
        resetDiscardedUnits: 0,
        rollingRecoveredUnits: 0,
        returnedUnits: 0,
        returnLostUnits: 0,
        activeOccupancyUnits: null,
        overageUnits: 0,
      },
    };
    states.set(spec.poolRef, p);
    if (spec.kind === 'balance') for (const l of spec.initialLots!) addLot(p, l);
    if (spec.kind === 'rolling')
      for (const u of [...spec.initialUsage!].sort((a, b) => a.atMs - b.atMs))
        addUse(p, u.debitRef, u.units, u.atMs + spec.windowMs!);
    if (spec.kind === 'concurrency')
      for (const u of [...spec.initialReservations!].sort((a, b) => a.untilMs - b.untilMs))
        addUse(p, u.debitRef, u.units, u.untilMs);
    if (spec.kind === 'token_bucket')
      p.tokens = BigInt(spec.initialAvailable!) * BigInt(spec.refill!.perMs);
  }
  const head = (p: PoolState) => {
    while (p.head < p.queue.length && terminal.has(p.queue[p.head])) p.head++;
    return p.queue[p.head];
  };
  const notify = (p: PoolState) => {
    const i = head(p);
    if (i !== undefined && !readySet.has(i)) {
      ready.push(i);
      readySet.add(i);
    }
  };
  const refill = (p: PoolState) => {
    if (p.spec.kind !== 'token_bucket') return;
    const spec = p.spec,
      cap = BigInt(spec.capacity!) * BigInt(spec.refill!.perMs),
      next = p.tokens + BigInt(now - p.updatedAt) * BigInt(spec.refill!.units);
    p.tokens = next > cap ? cap : next;
    p.updatedAt = now;
  };
  const deposits = new Map<string, { spent: number; returned: number }>();
  const complete = (i: number, why: 'deadline' | 'horizon' | 'exceeds_hard_capacity') => {
    const r = results[i];
    r.status = 'unmet';
    r.reason = why;
    r.waitMs = now - r.arrivedAtMs;
    r.waitIsLowerBound = why !== 'exceeds_hard_capacity';
    terminal.add(i);
    for (const q of s.requests[i].requirements) notify(states.get(q.poolRef)!);
  };
  const dispatch = () => {
    for (let cursor = 0; cursor < ready.length; cursor++) {
      budget();
      const i = ready[cursor];
      readySet.delete(i);
      if (terminal.has(i)) continue;
      const r = s.requests[i],
        out = results[i];
      if (r.requirements.some((q) => head(states.get(q.poolRef)!) !== i)) continue;
      if (now >= s.horizonMs || now > r.latestStartMs) {
        complete(i, now >= s.horizonMs ? 'horizon' : 'deadline');
        continue;
      }
      const deductions: {
        p: PoolState;
        units: number;
        lots: { lot: LotState; units: number }[];
        overage: number;
      }[] = [];
      const blocked: string[] = [];
      for (const q of r.requirements) {
        budget();
        const p = states.get(q.poolRef)!,
          spec = p.spec,
          amount = q.units!;
        let enough = false;
        const d = { p, units: amount, lots: [] as { lot: LotState; units: number }[], overage: 0 };
        if (spec.kind === 'balance') {
          let left = amount;
          for (const lot of p.lots) {
            budget();
            if (!left) break;
            if (!lot.active || !applies(lot.appliesTo, q.classId)) continue;
            const n = Math.min(left, lot.remaining);
            if (n) {
              d.lots.push({ lot, units: n });
              left -= n;
            }
          }
          const fee = s.cost.overage;
          if (
            left &&
            s.shortage === 'pay_then_wait_limits' &&
            fee?.poolRef === q.poolRef &&
            applies(fee.appliesTo, q.classId)
          ) {
            d.overage = left;
            left = 0;
          }
          enough = left === 0;
        } else if (spec.kind === 'rolling' || spec.kind === 'concurrency')
          enough = p.occupied + amount <= spec.capacity!;
        else if (spec.kind === 'token_bucket') {
          refill(p);
          enough = p.tokens >= BigInt(amount) * BigInt(spec.refill!.perMs);
          if (!enough && amount <= spec.capacity!) {
            const delay = Number(
                rounded(
                  BigInt(amount) * BigInt(spec.refill!.perMs) - p.tokens,
                  BigInt(spec.refill!.units),
                ),
              ),
              at = now + delay;
            if (p.wakeAt === null || at < p.wakeAt) {
              p.wakeAt = at;
              wake(at, q.poolRef);
            }
          }
        }
        if (!enough) blocked.push(q.poolRef);
        deductions.push(d);
      }
      out.blockedPools = blocked;
      if (blocked.length) continue;
      // Commit only after every pool is feasible. No provisional partial debit.
      for (const d of deductions) {
        const p = d.p,
          spec = p.spec;
        p.stats.consumedUnits += d.units;
        if (spec.kind === 'balance') {
          for (const { lot, units } of d.lots) {
            lot.remaining -= units;
            const key = i + ':' + spec.poolRef + ':' + lot.lotRef;
            deposits.set(key, { spent: units, returned: 0 });
          }
          p.lots = p.lots.filter((l) => l.remaining > 0);
        }
        if (spec.kind === 'rolling') addUse(p, r.requestRef, d.units, now + spec.windowMs!);
        if (spec.kind === 'concurrency') addUse(p, r.requestRef, d.units, now + r.durationMs!);
        if (spec.kind === 'token_bucket') p.tokens -= BigInt(d.units) * BigInt(spec.refill!.perMs);
        if (d.overage) {
          p.stats.overageUnits += d.overage;
          const fee = s.cost.overage!,
            n = BigInt(d.overage) * BigInt(fee.priceMinor);
          extraNumerator += n;
          extraRounded += rounded(n, BigInt(fee.perUnits));
        }
        options.onAccountingEvent?.({
          kind: 'usage',
          poolRef: spec.poolRef,
          atMs: now,
          ref: r.requestRef,
          units: d.units,
        });
      }
      out.status = 'scheduled';
      out.reason = 'capacity_available';
      out.startedAtMs = now;
      out.serviceEndsAtMs = r.durationMs === null ? null : now + r.durationMs;
      out.waitMs = now - r.atMs;
      out.waitIsLowerBound = false;
      terminal.add(i);
      for (const q of r.requirements) notify(states.get(q.poolRef)!);
    }
    ready.length = 0;
  };
  const requestIndex = new Map(s.requests.map((r, i) => [r.requestRef, i]));
  // A source sequence orders arrivals at their own timestamp. It is not a
  // global rank and cannot order deadlines shared by different arrival times.
  // Retire equal deadlines in FIFO arrival order so a later head may still
  // start at its inclusive deadline after an impossible earlier head retires.
  const deadlineOrder = new Int32Array(s.requests.length);
  s.requests
    .map((r, index) => ({ r, index }))
    .sort((a, b) => a.r.atMs - b.r.atMs || a.r.sequence - b.r.sequence)
    .forEach((entry, rank) => {
      deadlineOrder[entry.index] = rank;
    });
  s.requests.forEach((r, index) => {
    heap.push({ at: r.atMs, phase: 1, sequence: r.sequence, kind: 'arrival', index });
    heap.push({
      at: r.latestStartMs,
      phase: 2,
      sequence: deadlineOrder[index],
      kind: 'deadline',
      index,
    });
  });
  events.forEach((e, index) =>
    heap.push({ at: e.atMs, phase: 1, sequence: e.sequence, kind: 'boundary', index }),
  );
  heap.push({ at: s.horizonMs, phase: 3, sequence: 0, kind: 'end' });
  try {
    while (heap.values.length) {
      budget();
      const event = heap.pop();
      now = event.at;
      if (event.kind === 'arrival') {
        const i = event.index!;
        arrived.add(i);
        const impossible = s.requests[i].requirements.filter((q) => {
          const spec = states.get(q.poolRef)!.spec;
          return (
            (spec.kind === 'rolling' ||
              spec.kind === 'concurrency' ||
              spec.kind === 'token_bucket') &&
            q.units! > spec.capacity!
          );
        });
        if (impossible.length) {
          results[i].blockedPools = impossible.map((q) => q.poolRef);
          complete(i, 'exceeds_hard_capacity');
        } else
          for (const q of s.requests[i].requirements) {
            const p = states.get(q.poolRef)!;
            p.queue.push(i);
            notify(p);
          }
      } else if (event.phase === 0) {
        const p = states.get(event.pool!)!;
        if (event.kind === 'expire' && event.lot!.active) {
          const l = event.lot!;
          options.onAccountingEvent?.({
            kind: 'expiration',
            poolRef: p.spec.poolRef,
            atMs: now,
            ref: l.lotRef,
            units: l.remaining,
          });
          p.stats.expiredUnusedUnits += l.remaining;
          l.remaining = 0;
          l.active = false;
          p.activeLots.delete(l);
          p.lots = p.lots.filter((x) => x !== l);
        }
        if (event.kind === 'recover' && event.usage!.active) {
          const u = event.usage!;
          options.onAccountingEvent?.({
            kind: 'recovery',
            poolRef: p.spec.poolRef,
            atMs: now,
            ref: u.ref,
            units: u.units,
          });
          p.occupied -= u.units;
          if (p.spec.kind === 'rolling') p.stats.rollingRecoveredUnits += u.units;
          u.active = false;
        }
        if (event.kind === 'wake' && p.wakeAt !== null && p.wakeAt <= now) p.wakeAt = null;
        notify(p);
      } else if (event.kind === 'boundary') {
        const e = events[event.index!],
          p = states.get(e.poolRef)!;
        if (e.kind === 'grant') addLot(p, e.lot);
        if (e.kind === 'reset') {
          for (const l of p.activeLots)
            if (e.discard === 'all' || l.resettable) {
              p.stats.resetDiscardedUnits += l.remaining;
              l.remaining = 0;
              l.active = false;
              p.activeLots.delete(l);
            }
          p.lots = p.lots.filter((l) => l.active);
          for (const l of e.newLots) addLot(p, l);
        }
        if (e.kind === 'return_to_lot') {
          const i = requestIndex.get(e.requestRef),
            d = deposits.get(i + ':' + e.poolRef + ':' + e.lotRef),
            l = p.lotMap.get(e.lotRef);
          if (i === undefined || !d || !l || d.returned + e.units > d.spent)
            throw new Error('return_without_matching_debit');
          d.returned += e.units;
          p.stats.returnedUnits += e.units;
          if (l.active) {
            const depleted = l.remaining === 0;
            l.remaining += e.units;
            if (depleted && e.units) {
              p.lots.push(l);
              sortLots(p);
            }
          } else p.stats.returnLostUnits += e.units;
        }
        if (e.kind === 'release_rolling_usage') {
          const u = p.useMap.get(e.debitRef);
          if (!u || u.returned + e.units > u.original)
            throw new Error('release_without_matching_usage');
          u.returned += e.units;
          p.stats.returnedUnits += e.units;
          if (u.active) {
            p.occupied -= e.units;
            u.units -= e.units;
          } else p.stats.returnLostUnits += e.units;
        }
        options.onAccountingEvent?.({
          kind: e.kind,
          poolRef: e.poolRef,
          atMs: now,
          ref: e.eventRef,
          units:
            e.kind === 'grant'
              ? e.lot.units
              : e.kind === 'reset'
                ? e.newLots.reduce((n, l) => n + l.units, 0)
                : e.units,
        });
        notify(p);
      }
      // All half-open expiries and timed releases at an instant precede any dispatch.
      if (event.phase === 0 && heap.values[0]?.at === now && heap.values[0].phase === 0) continue;
      dispatch();
      if (event.kind === 'deadline' && !terminal.has(event.index!)) {
        complete(event.index!, now === s.horizonMs ? 'horizon' : 'deadline');
        dispatch();
      }
      if (event.kind === 'end') break;
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'event_conflict';
    status = code === 'operation_budget' ? 'incomplete' : 'conflict';
    issues.push(code);
    for (const [i, r] of results.entries())
      if (!terminal.has(i)) {
        r.reason = status === 'incomplete' ? 'operation_budget' : 'event_conflict';
        r.waitMs = arrived.has(i) ? now - r.arrivedAtMs : null;
        r.waitIsLowerBound = true;
      }
  }
  for (const p of states.values()) {
    const spec = p.spec;
    refill(p);
    p.stats.remainingUnits =
      spec.kind === 'balance'
        ? p.lots.reduce((n, l) => n + (l.active ? l.remaining : 0), 0)
        : spec.kind === 'token_bucket'
          ? Number(p.tokens / BigInt(spec.refill!.perMs)) +
            Number(p.tokens % BigInt(spec.refill!.perMs)) / spec.refill!.perMs
          : spec.kind === 'rolling' || spec.kind === 'concurrency'
            ? spec.capacity! - p.occupied
            : null;
    p.stats.activeOccupancyUnits =
      spec.kind === 'rolling' || spec.kind === 'concurrency' ? p.occupied : null;
    if (spec.kind === 'token_bucket')
      p.stats.remainingExact = { numerator: p.tokens.toString(), denominator: spec.refill!.perMs };
    if (status !== 'complete') {
      p.stats.remainingUnits = null;
      p.stats.activeOccupancyUnits = null;
      delete p.stats.remainingExact;
    }
  }
  return finish();
}

export function quotaReplayExample(): QuotaReplayInput {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    version: 'quota-replay-1',
    scenarioRef: id(1),
    plan: 'example-shared-plan',
    policyVersion: 'example-v1',
    horizonMs: 86400000,
    basis: 'explicit_scenario',
    eligibility: 'eligible',
    externalDemand: 'assume_none',
    sameTimeOrder: 'scenario_sequence',
    requirementsCoverage: 'complete',
    dispatch: 'per_pool_fifo',
    shortage: 'wait_only',
    pools: [
      {
        poolRef: id(2),
        unit: 'credit',
        policyVersion: 'example-v1',
        kind: 'balance',
        spendOrder: 'priority_expiry_issue_order',
        returnPolicy: 'original_lot_no_revive',
        initialLots: [
          {
            lotRef: id(3),
            units: 100,
            expiresAtMs: 43200000,
            priority: 0,
            resettable: true,
            category: 'base',
            appliesTo: { kind: 'all' },
          },
        ],
      },
    ],
    events: [
      {
        eventRef: id(4),
        poolRef: id(2),
        kind: 'reset',
        atMs: 43200000,
        sequence: 0,
        discard: 'resettable',
        newLots: [
          {
            lotRef: id(5),
            units: 100,
            expiresAtMs: null,
            priority: 0,
            resettable: true,
            category: 'base',
            appliesTo: { kind: 'all' },
          },
        ],
      },
    ],
    requests: [6, 7].map((n, i) => ({
      requestRef: id(n),
      rootTaskRef: id(n + 10),
      atMs: 3600000,
      sequence: i,
      latestStartMs: 86399999,
      durationMs: 1000,
      requirements: [{ poolRef: id(2), classId: 'standard', units: 60 }],
    })),
    cost: {
      currency: 'CNY',
      wholePeriodFixedMinor: 10000,
      inWindowFixedMinor: 10000,
      adjustments: [],
      overage: null,
    },
  };
}
