import { z } from 'zod';

export const chargeComponents = [
  'model',
  'harness',
  'tool',
  'compute',
  'storage',
  'network',
  'other',
] as const;
export const chargeIssueCodes = [
  'period_mismatch',
  'currency_mismatch',
  'duplicate_conflict',
  'missing_reference',
  'multiple_parents',
  'cycle',
  'missing_relation',
  'direct_has_children',
  'children_exceed_parent',
  'incomplete_partition',
  'ambiguous_allocation',
  'allocation_conflict',
  'component_conflict',
  'amount_limit',
  'exceeds_net',
  'complete_total_mismatch',
] as const;
const money = z.number().int().nonnegative().max(1e10);
const count = z.number().int().nonnegative().max(200000);
export const ChargeReconciliationSchema = z
  .object({
    version: z.literal('charge-reconciliation-1'),
    status: z.enum(['reconciled', 'partial', 'conflict']),
    basis: z.enum(['collector_record', 'user_report', 'unknown']),
    observedCharges: count,
    aggregateCharges: count,
    containmentLinks: count,
    roots: count,
    maxDepth: count.nullable(),
    rootDisjointness: z.enum(['declared', 'unknown']),
    knownTotalMinor: money.nullable(),
    lowerBoundMinor: money.nullable(),
    unexplainedMinor: money.nullable(),
    residualMinor: money.nullable(),
    unmappedMinor: money.nullable(),
    unclassifiedMinor: money.nullable(),
    componentLowerBounds: z
      .object(
        Object.fromEntries(chargeComponents.map((c) => [c, money.nullable()])) as Record<
          (typeof chargeComponents)[number],
          ReturnType<typeof money.nullable>
        >,
      )
      .strict(),
    unresolvedGroups: count,
    issues: z.array(z.enum(chargeIssueCodes)).max(chargeIssueCodes.length),
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (r.aggregateCharges > r.observedCharges || r.roots > r.observedCharges)
      fail('费用节点计数不一致');
    if ((r.status === 'conflict') !== r.issues.length > 0) fail('费用冲突状态须与诊断一致');
    if (new Set(r.issues).size !== r.issues.length) fail('费用诊断代码不能重复');
    if (
      r.status === 'reconciled' &&
      (r.knownTotalMinor === null ||
        r.lowerBoundMinor !== r.knownTotalMinor ||
        r.unexplainedMinor !== 0)
    )
      fail('已核对费用须有完整金额');
    if (
      r.knownTotalMinor !== null &&
      (r.lowerBoundMinor === null || r.lowerBoundMinor > r.knownTotalMinor)
    )
      fail('费用下界不能超过已知总额');
    if (r.status === 'partial' && r.knownTotalMinor !== null) fail('部分费用仅输出下界');
    if (
      r.status === 'conflict' &&
      [
        r.knownTotalMinor,
        r.lowerBoundMinor,
        r.unmappedMinor,
        r.unclassifiedMinor,
        r.residualMinor,
        r.unexplainedMinor,
        ...Object.values(r.componentLowerBounds),
      ].some((v) => v !== null)
    )
      fail('冲突结果不能输出有效派生金额');
    if (r.lowerBoundMinor !== null) {
      const classified = Object.values(r.componentLowerBounds).reduce<number>(
        (n, v) => n + (v ?? 0),
        0,
      );
      if (
        classified > r.lowerBoundMinor ||
        [r.residualMinor, r.unmappedMinor, r.unclassifiedMinor].some(
          (v) => v !== null && v > r.lowerBoundMinor!,
        )
      )
        fail('费用组成下界超出已知金额');
      if (r.unclassifiedMinor !== null && classified + r.unclassifiedMinor !== r.lowerBoundMinor)
        fail('已分类和未分类金额须对齐下界');
    }
  });
export type ChargeReconciliation = z.infer<typeof ChargeReconciliationSchema>;
export function hasReconciledCharges(period: { chargeReconciliation?: ChargeReconciliation }) {
  return !period.chargeReconciliation || period.chargeReconciliation.status === 'reconciled';
}
export function hasCompleteChargeMapping(period: { chargeReconciliation?: ChargeReconciliation }) {
  return (
    hasReconciledCharges(period) &&
    (!period.chargeReconciliation || period.chargeReconciliation.unmappedMinor === 0)
  );
}
export const chargeReconciliationNote =
  '总额、任务归属和费用类别分别核对。差额可能包含未记录后代费用，不等于父代理自身支出；包含与互斥关系仍依赖来源声明，不能仅凭哈希证明账单真实。';
export function chargeReconciliationLines(r: ChargeReconciliation, currency: string) {
  const amount = (n: number | null) =>
    n === null ? '未知' : (n / 100).toFixed(2) + ' ' + currency;
  const status = {
    reconciled: '已按声明核对总额',
    partial: '仅掌握部分费用',
    conflict: '费用关系存在冲突',
  }[r.status];
  const basis = {
    collector_record: '采集器记录',
    user_report: '用户声明',
    unknown: '来源依据未说明',
  }[r.basis];
  return [
    `${status}；依据：${basis}。已知总额 ${amount(r.knownTotalMinor)}，已知费用下界 ${amount(r.lowerBoundMinor)}，账单中尚未解释的金额 ${amount(r.unexplainedMinor)}。`,
    `${r.observedCharges} 条费用观察，${r.aggregateCharges} 条累计费用，${r.containmentLinks} 条包含关系；${r.unresolvedGroups} 组关系或金额仍有缺项。`,
    `本次包含图中尚未由子项细分的差额 ${amount(r.residualMinor)}；未声明任务归属 ${amount(r.unmappedMinor)}，未确定费用类别 ${amount(r.unclassifiedMinor)}。这些金额可重叠，不能相加。另有依据的已存归属仍保留；本次数值不含共享权重未分配的金额，最终结果见费用归属。`,
    ...(r.status === 'conflict' ? [`冲突诊断：${r.issues.join('、')}。不能参与费用比较。`] : []),
    ...(r.status === 'partial' ? ['部分费用不参与单位成本、用户位置或套餐比较。'] : []),
    ...(r.status === 'reconciled' && r.unmappedMinor !== 0
      ? [
          '总额虽已核对，本次任务归属仍未核对完整；保留已有明细，暂不参与单位成本、用户位置或套餐比较。',
        ]
      : []),
    chargeReconciliationNote,
  ];
}
