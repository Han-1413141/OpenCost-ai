import {
  LocalEconomicHistorySchema,
  EconomicHistoryReportSchema,
  economicHistoryLimits,
  economicHistoryNote,
  type EconomicObservation,
  type EconomicHistoryReport,
} from './economic-history-schema.js';

type Issue = EconomicHistoryReport['issues'][number];
const zeroCounts = (): EconomicHistoryReport['counts'] => ({
  inputObservations: 0,
  selectedObservations: 0,
  duplicateObservations: 0,
  operations: 0,
  pending: 0,
  failed: 0,
  cancelled: 0,
  unknown: 0,
  sourceUnknown: 0,
  settledCharges: 0,
  settledRefunds: 0,
  creditGrants: 0,
  unlinkedRefunds: 0,
  incompleteChargeMappings: 0,
  unknownRefundAmounts: 0,
  distinctTasks: 0,
  distinctRequirements: 0,
});
const portionKey = (p: { taskId: string; requirementRef: string; workMonth: string }) =>
  `${p.taskId}:${p.requirementRef}:${p.workMonth}`;
const sumPortions = (o: EconomicObservation) =>
  o.allocation.portions.reduce((n, p) => n + BigInt(p.amountMinor), 0n);
const canonicalObservation = (o: EconomicObservation) =>
  JSON.stringify({
    ...o,
    recordedAt: new Date(o.recordedAt).toISOString(),
    occurredAt: o.occurredAt === null ? null : new Date(o.occurredAt).toISOString(),
    allocation: {
      ...o.allocation,
      portions: [...o.allocation.portions].sort((a, b) =>
        portionKey(a).localeCompare(portionKey(b)),
      ),
    },
  });

/** Explicit selected data only; no I/O, persistence, credentials, inference API or collection. */
export function analyzeEconomicHistory(
  raw: unknown,
  options: { enabled?: boolean } = {},
): EconomicHistoryReport {
  const report: EconomicHistoryReport = {
    format: 'economic-history-analysis-1',
    method: 'economic-history-method-1',
    status: 'disabled',
    dataUse: null,
    inputCoverage: null,
    window: null,
    counts: zeroCounts(),
    issues: [],
    mappingComplete: false,
    cash: [],
    requirements: [],
    note: economicHistoryNote,
  };
  if (!options.enabled) return report;
  const parsed = LocalEconomicHistorySchema.safeParse(raw);
  if (!parsed.success) return { ...report, status: 'invalid', issues: ['invalid_input'] };
  const input = parsed.data,
    issues = new Set<Issue>(),
    c = report.counts;
  report.dataUse = input.dataUse;
  report.inputCoverage = input.coverage;
  report.window = input.window;
  c.inputObservations = input.observations.length;
  const cutoff = Date.parse(input.window.recordedAtOrBefore),
    byId = new Map<string, EconomicObservation>();
  for (const o of input.observations) {
    if (Date.parse(o.recordedAt) > cutoff) continue;
    c.selectedObservations++;
    const old = byId.get(o.id);
    if (old) {
      if (canonicalObservation(old) !== canonicalObservation(o)) issues.add('observation_conflict');
      else c.duplicateObservations++;
    } else byId.set(o.id, o);
  }
  const children = new Map<string, string>(),
    roots = new Map<string, number>();
  const heads = new Map<string, EconomicObservation>();
  for (const o of byId.values()) {
    if (o.parentId === null) roots.set(o.eventRef, (roots.get(o.eventRef) ?? 0) + 1);
    else {
      const p = byId.get(o.parentId);
      if (!p) {
        issues.add('missing_parent');
        continue;
      }
      if (children.has(p.id) && children.get(p.id) !== o.id) issues.add('branch');
      children.set(p.id, o.id);
      if (
        o.eventRef !== p.eventRef ||
        o.revision !== p.revision + 1 ||
        Date.parse(o.recordedAt) < Date.parse(p.recordedAt)
      )
        issues.add('revision_conflict');
      if (o.kind !== p.kind || o.currency !== p.currency || o.refundOf !== p.refundOf)
        issues.add('operation_changed');
      if (['settled', 'failed', 'cancelled'].includes(p.status) && o.status !== p.status)
        issues.add('terminal_status_changed');
      if (p.amountMinor !== null && o.amountMinor !== p.amountMinor) issues.add('amount_changed');
      if (
        p.occurredAt !== null &&
        (o.occurredAt === null || Date.parse(o.occurredAt) !== Date.parse(p.occurredAt))
      )
        issues.add('occurrence_changed');
    }
    const previous = heads.get(o.eventRef);
    if (!previous || o.revision > previous.revision) heads.set(o.eventRef, o);
    else if (o.revision === previous.revision && o.id !== previous.id)
      issues.add('revision_conflict');
  }
  for (const ref of heads.keys()) if (roots.get(ref) !== 1) issues.add('revision_conflict');
  c.operations = heads.size;
  const stop = (status: 'conflict' | 'capacity') =>
    EconomicHistoryReportSchema.parse({
      ...report,
      status,
      issues: [...issues].sort(),
      cash: [],
      requirements: [],
      mappingComplete: false,
    });
  if (heads.size > economicHistoryLimits.operations) {
    issues.add('capacity');
    return stop('capacity');
  }
  if (issues.size) return stop('conflict');
  const refunds = new Map<string, EconomicObservation[]>();
  for (const o of heads.values()) {
    if (o.source === 'unknown') c.sourceUnknown++;
    if (o.status === 'pending') c.pending++;
    if (o.status === 'failed') c.failed++;
    if (o.status === 'cancelled') c.cancelled++;
    if (o.status === 'unknown') c.unknown++;
    if (o.kind === 'credit_grant' && o.status === 'settled') c.creditGrants++;
    if (o.kind === 'charge' && o.status === 'settled') {
      c.settledCharges++;
      if (o.amountMinor === null || o.allocation.coverage !== 'complete')
        c.incompleteChargeMappings++;
    }
    if (o.kind !== 'refund') continue;
    const target = heads.get(o.refundOf!);
    if (!target) {
      if (o.status === 'settled') {
        c.unlinkedRefunds++;
        c.settledRefunds++;
        if (o.amountMinor === null) c.unknownRefundAmounts++;
      }
      continue;
    }
    if (target.kind !== 'charge') {
      issues.add('missing_charge');
      continue;
    }
    if (target.currency !== o.currency) issues.add('refund_currency');
    if (o.status !== 'settled') continue;
    c.settledRefunds++;
    if (target.status !== 'settled') issues.add('refund_not_settled_charge');
    if (
      target.occurredAt &&
      o.occurredAt &&
      Date.parse(o.occurredAt) < Date.parse(target.occurredAt)
    )
      issues.add('refund_before_charge');
    if (o.amountMinor === null) c.unknownRefundAmounts++;
    const list = refunds.get(target.eventRef) ?? [];
    list.push(o);
    refunds.set(target.eventRef, list);
  }
  if (issues.size) return stop('conflict');
  const rows = new Map<
    string,
    {
      taskId: string;
      requirementRef: string;
      workMonth: string;
      currency: 'CNY' | 'USD' | 'EUR';
      gross: bigint;
      explicit: bigint;
      lower: bigint;
      upper: bigint;
    }
  >();
  const requirementOwners = new Map<string, string>();
  for (const charge of heads.values()) {
    if (charge.kind !== 'charge' || charge.status !== 'settled') continue;
    const related = refunds.get(charge.eventRef) ?? [];
    const byPortion = new Map(
      charge.allocation.portions.map((p) => [portionKey(p), BigInt(p.amountMinor)]),
    );
    const mappedRefund = new Map<string, bigint>();
    let refundLower = 0n,
      refundMapped = 0n;
    const refundExact = related.every((r) => r.amountMinor !== null);
    for (const refund of related) {
      refundLower += refund.amountMinor === null ? sumPortions(refund) : BigInt(refund.amountMinor);
      for (const p of refund.allocation.portions) {
        const key = portionKey(p),
          next = (mappedRefund.get(key) ?? 0n) + BigInt(p.amountMinor);
        if (!byPortion.has(key) || next > byPortion.get(key)!)
          issues.add('refund_allocation_conflict');
        mappedRefund.set(key, next);
        refundMapped += BigInt(p.amountMinor);
      }
    }
    const chargeAmount = charge.amountMinor === null ? null : BigInt(charge.amountMinor);
    if (chargeAmount !== null && refundLower > chargeAmount) issues.add('refund_exceeds_charge');
    if (issues.size) return stop('conflict');
    const unassignedRefund = refundLower - refundMapped;
    for (const portion of charge.allocation.portions) {
      const owner = requirementOwners.get(portion.requirementRef);
      if (owner && owner !== portion.taskId) {
        issues.add('requirement_binding_conflict');
        return stop('conflict');
      }
      requirementOwners.set(portion.requirementRef, portion.taskId);
      const key = portionKey(portion),
        amount = BigInt(portion.amountMinor),
        explicit = mappedRefund.get(key) ?? 0n;
      const remaining = amount - explicit;
      const lower =
        refundExact && input.coverage.allocationHistory === 'complete' && c.unlinkedRefunds === 0
          ? remaining > unassignedRefund
            ? remaining - unassignedRefund
            : 0n
          : 0n;
      let forced = 0n;
      if (chargeAmount !== null) {
        const otherRemaining = chargeAmount - refundMapped - remaining;
        if (unassignedRefund > otherRemaining) forced = unassignedRefund - otherRemaining;
      }
      const upper = remaining - forced;
      const rowKey = `${charge.currency}:${key}`;
      const row = rows.get(rowKey) ?? {
        ...portion,
        currency: charge.currency,
        gross: 0n,
        explicit: 0n,
        lower: 0n,
        upper: 0n,
      };
      row.gross += amount;
      row.explicit += explicit;
      row.lower += lower;
      row.upper += upper;
      rows.set(rowKey, row);
      if (rows.size > economicHistoryLimits.requirementRows) {
        issues.add('capacity');
        return stop('capacity');
      }
    }
  }
  report.mappingComplete =
    input.coverage.allocationHistory === 'complete' &&
    ![...heads.values()].some((o) => o.status === 'unknown' && o.kind !== 'credit_grant') &&
    c.incompleteChargeMappings === 0 &&
    c.unknownRefundAmounts === 0 &&
    c.unlinkedRefunds === 0;
  const tasks = new Set<string>(),
    requirements = new Set<string>();
  report.requirements = [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => {
      tasks.add(row.taskId);
      requirements.add(`${row.taskId}:${row.requirementRef}`);
      return {
        taskId: row.taskId,
        requirementRef: row.requirementRef,
        workMonth: row.workMonth,
        currency: row.currency,
        knownAllocatedChargeMinor: Number(row.gross),
        explicitAllocatedRefundMinor: Number(row.explicit),
        allocatedNetRangeMinor: { lower: Number(row.lower), upper: Number(row.upper) },
        recordedAllocatedNetMinor:
          report.mappingComplete && row.lower === row.upper ? Number(row.lower) : null,
      };
    });
  c.distinctTasks = tasks.size;
  c.distinctRequirements = requirements.size;
  const from = Date.parse(input.window.from),
    to = Date.parse(input.window.to);
  report.cash = [...input.currencies].sort().map((currency) => {
    let paid = 0n,
      refunded = 0n,
      unlinked = 0n,
      credit = 0n,
      missingCredit = 0,
      missing = 0,
      unknown = 0;
    for (const o of heads.values()) {
      if (o.currency !== currency) continue;
      if (o.status === 'unknown' && o.kind !== 'credit_grant') unknown++;
      if (o.status !== 'settled') continue;
      const at = Date.parse(o.occurredAt!);
      if (at < from || at >= to) continue;
      if (o.amountMinor === null) {
        if (o.kind !== 'credit_grant') missing++;
        else missingCredit++;
        continue;
      }
      if (o.kind === 'charge') paid += BigInt(o.amountMinor);
      else if (o.kind === 'refund') {
        refunded += BigInt(o.amountMinor);
        if (!heads.has(o.refundOf!)) unlinked += BigInt(o.amountMinor);
      } else credit += BigInt(o.amountMinor);
    }
    const complete = input.coverage.cashWindow === 'complete' && missing === 0 && unknown === 0;
    return {
      currency,
      knownPaidMinor: Number(paid),
      knownRefundedMinor: Number(refunded),
      knownUnlinkedRefundMinor: Number(unlinked),
      knownCreditGrantedMinor: Number(credit),
      unknownCreditAmounts: missingCredit,
      unknownSettledAmounts: missing,
      unknownStates: unknown,
      knownNetCashMinor: Number(paid - refunded),
      netCashMinor: complete ? Number(paid - refunded) : null,
      coverage: complete
        ? ('complete' as const)
        : input.coverage.cashWindow === 'unknown'
          ? ('unknown' as const)
          : ('partial' as const),
    };
  });
  report.status = 'computed';
  return EconomicHistoryReportSchema.parse(report);
}

export function economicHistoryLines(report: EconomicHistoryReport): string[] {
  if (report.status !== 'computed')
    return [`本地经济事件分析：${report.status}。未生成有效金额结果。`];
  return [
    ...(report.dataUse === 'method_example' ? ['这是方法示例，不是用户的实际账单。'] : []),
    `本次${report.counts.operations}项经济事件、${report.counts.distinctTasks}项根目标、${report.counts.distinctRequirements}份要求；根目标及要求数量不是完成量。`,
    ...report.cash.map(
      (r) =>
        `${r.currency}窗口现金净支出：${r.netCashMinor === null ? '未知，已知部分' + (r.knownNetCashMinor / 100).toFixed(2) : (r.netCashMinor / 100).toFixed(2)}；已知付款${(r.knownPaidMinor / 100).toFixed(2)}，已知退款${(r.knownRefundedMinor / 100).toFixed(2)}，另有非现金赠额已知部分${(r.knownCreditGrantedMinor / 100).toFixed(2)}、金额未知${r.unknownCreditAmounts}项。`,
    ),
    '负现金净支出表示本窗口退款多于付款，不是负任务成本。要求费用可行范围只覆盖已明确分配的部分，不是置信区间；完整任务费用与验收仍需另行核对。',
    report.note,
  ];
}
