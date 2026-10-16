import { z } from 'zod';

export const economicHistoryLimits = {
  bytes: 4 * 1024 * 1024,
  observations: 10000,
  allocationReferences: 50000,
  operations: 5000,
  requirementRows: 5000,
  windowDays: 90,
} as const;
const id = z.uuid().toLowerCase();
const time = z.iso
  .datetime()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s),
    '使用UTC、最多毫秒精度',
  );
const money = z.number().int().nonnegative().max(1e10);
const total = z.number().int().nonnegative().max(1e14);
const signedTotal = z.number().int().min(-1e14).max(1e14);
const count = z.number().int().nonnegative().max(1e6);
const currency = z.enum(['CNY', 'USD', 'EUR']);
const coverage = z.enum(['complete', 'partial', 'unknown']);
const CoverageSchema = z.object({ cashWindow: coverage, allocationHistory: coverage }).strict();
const month = z.string().regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/);
export const EconomicAllocationSchema = z
  .object({
    taskId: id,
    requirementRef: id,
    workMonth: month,
    amountMinor: money,
  })
  .strict();
export const EconomicObservationSchema = z
  .object({
    id,
    eventRef: id,
    revision: z.number().int().nonnegative().max(10000),
    parentId: id.nullable(),
    recordedAt: time,
    kind: z.enum(['charge', 'refund', 'credit_grant']),
    currency,
    amountMinor: money.nullable(),
    status: z.enum(['pending', 'settled', 'failed', 'cancelled', 'unknown']),
    occurredAt: time.nullable(),
    refundOf: id.nullable(),
    source: z.enum(['official_export', 'authorized_meter', 'manual_report', 'unknown']),
    allocation: z
      .object({ coverage, portions: z.array(EconomicAllocationSchema).max(500) })
      .strict(),
  })
  .strict()
  .superRefine((o, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if ((o.revision === 0) !== (o.parentId === null)) fail('起点没有父观察，后继必须引用父观察');
    if ((o.kind === 'refund') !== (o.refundOf !== null)) fail('退款必须且只能引用原收费事件');
    if ((o.status === 'settled') !== (o.occurredAt !== null)) fail('仅已结算事件有实际发生时刻');
    if (o.occurredAt && Date.parse(o.occurredAt) > Date.parse(o.recordedAt))
      fail('记录不能早于已发生结算');
    const keys = new Set(
      o.allocation.portions.map((p) => `${p.taskId}:${p.requirementRef}:${p.workMonth}`),
    );
    if (keys.size !== o.allocation.portions.length) fail('同一要求和工作月份的归属不能重复');
    if (o.allocation.coverage === 'unknown' && o.allocation.portions.length)
      fail('未知归属不能带有确定分配');
    const allocated = o.allocation.portions.reduce((n, p) => n + p.amountMinor, 0);
    if (o.kind === 'credit_grant') {
      if (allocated || o.allocation.portions.length) fail('赠额不是任务付款，不能直接冲减任务费用');
    } else {
      if (o.amountMinor !== null && allocated > o.amountMinor) fail('归属金额不能超过事件金额');
      if (
        o.allocation.coverage === 'complete' &&
        (o.amountMinor === null || allocated !== o.amountMinor)
      )
        fail('完整归属必须与已知事件总额一致');
    }
  });
const WindowSchema = z.object({ from: time, to: time, recordedAtOrBefore: time }).strict();
export const LocalEconomicHistorySchema = z
  .object({
    version: z.literal('opencost-local-economic-history-1'),
    dataUse: z.enum(['user_records', 'method_example']),
    coverage: CoverageSchema,
    currencies: z.array(currency).min(1).max(3),
    window: WindowSchema,
    observations: z.array(EconomicObservationSchema).max(economicHistoryLimits.observations),
  })
  .strict()
  .superRefine((input, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const { from, to, recordedAtOrBefore } = input.window;
    const length = Date.parse(to) - Date.parse(from);
    if (length <= 0 || length > economicHistoryLimits.windowDays * 86400000)
      fail('现金窗口为大于零、最多90天的左闭右开范围');
    if (Date.parse(to) > Date.parse(recordedAtOrBefore)) fail('现金窗口不能超过本次记录截止');
    if (new Set(input.currencies).size !== input.currencies.length) fail('币种范围不能重复');
    if (input.observations.some((o) => !input.currencies.includes(o.currency)))
      fail('事件币种须属于声明范围');
    if (
      input.observations.reduce((n, o) => n + o.allocation.portions.length, 0) >
      economicHistoryLimits.allocationReferences
    )
      fail('费用归属引用超过工作容量');
  });
export type LocalEconomicHistory = z.infer<typeof LocalEconomicHistorySchema>;
export type EconomicObservation = z.infer<typeof EconomicObservationSchema>;
export type EconomicAllocation = z.infer<typeof EconomicAllocationSchema>;
export const economicHistoryIssueCodes = [
  'invalid_input',
  'observation_conflict',
  'missing_parent',
  'revision_conflict',
  'branch',
  'operation_changed',
  'terminal_status_changed',
  'amount_changed',
  'occurrence_changed',
  'missing_charge',
  'refund_currency',
  'refund_before_charge',
  'refund_not_settled_charge',
  'refund_exceeds_charge',
  'refund_allocation_conflict',
  'requirement_binding_conflict',
  'capacity',
] as const;
const CashRowSchema = z
  .object({
    currency,
    knownPaidMinor: total,
    knownRefundedMinor: total,
    knownUnlinkedRefundMinor: total,
    knownCreditGrantedMinor: total,
    unknownCreditAmounts: count,
    unknownSettledAmounts: count,
    unknownStates: count,
    knownNetCashMinor: signedTotal,
    netCashMinor: signedTotal.nullable(),
    coverage,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.knownNetCashMinor !== r.knownPaidMinor - r.knownRefundedMinor ||
      r.knownUnlinkedRefundMinor > r.knownRefundedMinor ||
      (r.netCashMinor !== null &&
        (r.coverage !== 'complete' ||
          r.unknownSettledAmounts ||
          r.unknownStates ||
          r.netCashMinor !== r.knownNetCashMinor))
    )
      ctx.addIssue({ code: 'custom', message: '现金金额、缺项和完整性不一致' });
  });
const RequirementRowSchema = z
  .object({
    taskId: id,
    requirementRef: id,
    workMonth: month,
    currency,
    knownAllocatedChargeMinor: total,
    explicitAllocatedRefundMinor: total,
    allocatedNetRangeMinor: z.object({ lower: total, upper: total }).strict(),
    recordedAllocatedNetMinor: total.nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const { lower, upper } = r.allocatedNetRangeMinor;
    if (
      r.explicitAllocatedRefundMinor > r.knownAllocatedChargeMinor ||
      lower > upper ||
      upper > r.knownAllocatedChargeMinor - r.explicitAllocatedRefundMinor ||
      (r.recordedAllocatedNetMinor !== null &&
        (lower !== upper || r.recordedAllocatedNetMinor !== lower))
    )
      ctx.addIssue({ code: 'custom', message: '要求费用的已知分配与可行范围不一致' });
  });
export const EconomicHistoryReportSchema = z
  .object({
    format: z.literal('economic-history-analysis-1'),
    method: z.literal('economic-history-method-1'),
    status: z.enum(['disabled', 'invalid', 'conflict', 'capacity', 'computed']),
    dataUse: z.enum(['user_records', 'method_example']).nullable(),
    inputCoverage: CoverageSchema.nullable(),
    window: WindowSchema.nullable(),
    counts: z
      .object({
        inputObservations: count,
        selectedObservations: count,
        duplicateObservations: count,
        operations: count,
        pending: count,
        failed: count,
        cancelled: count,
        unknown: count,
        sourceUnknown: count,
        settledCharges: count,
        settledRefunds: count,
        creditGrants: count,
        unlinkedRefunds: count,
        incompleteChargeMappings: count,
        unknownRefundAmounts: count,
        distinctTasks: count,
        distinctRequirements: count,
      })
      .strict(),
    issues: z.array(z.enum(economicHistoryIssueCodes)).max(economicHistoryIssueCodes.length),
    mappingComplete: z.boolean(),
    cash: z.array(CashRowSchema).max(3),
    requirements: z.array(RequirementRowSchema).max(economicHistoryLimits.requirementRows),
    note: z.literal(
      '本地选择的经济事件；来源、范围与关联是输入声明。现金窗口与已记录要求费用分开；退款范围不是概率区间。未证明任务结束、费用生命周期完整或账单真实，不用于排名；赠额不作现金退款。输出含金额、随机关联号与时间，不能直接作为匿名上传。',
    ),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.status === 'computed' &&
      (!r.window || !r.inputCoverage || !r.dataUse || r.cash.length === 0 || r.issues.length)
    )
      ctx.addIssue({ code: 'custom', message: '完成分析须保留范围与有效结果，不能带有冲突诊断' });
    if (r.status !== 'computed' && (r.cash.length || r.requirements.length || r.mappingComplete))
      ctx.addIssue({ code: 'custom', message: '未完成分析不能保留有效结果前缀' });
    if (!r.mappingComplete && r.requirements.some((row) => row.recordedAllocatedNetMinor !== null))
      ctx.addIssue({ code: 'custom', message: '归属未完整时不输出完整要求费用点值' });
  });
export type EconomicHistoryReport = z.infer<typeof EconomicHistoryReportSchema>;
export const economicHistoryNote: EconomicHistoryReport['note'] =
  '本地选择的经济事件；来源、范围与关联是输入声明。现金窗口与已记录要求费用分开；退款范围不是概率区间。未证明任务结束、费用生命周期完整或账单真实，不用于排名；赠额不作现金退款。输出含金额、随机关联号与时间，不能直接作为匿名上传。';
