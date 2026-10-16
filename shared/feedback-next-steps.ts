import { z } from 'zod';
import type { PersonalFeedback } from './personal-feedback.js';

const codes = [
  'journal_window',
  'settlement_conflict',
  'history_unprepared',
  'charges_incomplete',
  'allocation_incomplete',
  'task_unfinished',
  'workload_missing',
  'measurement_missing',
  'reference_missing',
  'quota_unknown',
  'journal_evidence',
  'observe_longer',
] as const;
export const FeedbackNextStepsSchema = z
  .object({
    version: z.literal('feedback-next-steps-1'),
    basis: z.literal('report_facts'),
    reportGeneratedAt: z.string().datetime(),
    actions: z
      .array(
        z
          .object({
            code: z.enum(codes),
            title: z.string().min(1).max(100),
            reason: z.string().min(1).max(600),
            action: z.string().min(1).max(600),
          })
          .strict(),
      )
      .max(3),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (new Set(r.actions.map((a) => a.code)).size !== r.actions.length)
      ctx.addIssue({ code: 'custom', message: '反馈行动不能重复' });
  });
export type FeedbackNextSteps = z.infer<typeof FeedbackNextStepsSchema>;

/** Fixed rules on this report only: no retrieval, model calls, diagnosis or metric mutation. */
export function feedbackNextSteps(report: PersonalFeedback): FeedbackNextSteps {
  const actions: FeedbackNextSteps['actions'] = [];
  const add = (code: (typeof codes)[number], title: string, reason: string, action: string) =>
    actions.push({ code, title, reason, action });
  if (report.sample.journalCoverage && report.sample.journalCoverage.currentWindow !== 'valid')
    add(
      'journal_window',
      '核对日记日期与采集区间',
      '本报告的日期、时区或区间检查未通过，不能据此判断周/月覆盖。',
      '在本机核对日期、时区及原采集区间，保留原修订；不要通过复制日期标签增加覆盖天数。',
    );
  if (report.lifecycle?.status === 'conflict')
    add(
      'settlement_conflict',
      '核对重复完整结算的关系',
      `本报告发现 ${report.lifecycle.conflictingTasks} 项重复根目标，费用尚不能确定为累计、增量或替代。`,
      '保留相关回执，在本地核对同一任务及账期的费用关系；确认关系前不要将多份完整快照相加。',
    );
  else if (report.lifecycle && ['pending', 'unknown'].includes(report.lifecycle.status))
    add(
      'history_unprepared',
      '先确认历史结算范围',
      '本报告尚未确认全部需要检查的历史，单位成本比较和推荐条件不足。',
      '检查现有记录与历史准备状态；可手动再读取反馈，已经保存的上传不需要重复提交。',
    );
  const charges = report.analytics?.chargeReconciliation;
  if (
    charges &&
    (charges.status !== 'reconciled' || charges.unmappedMinor === null || charges.unmappedMinor > 0)
  )
    add(
      'charges_incomplete',
      '补充费用总额与任务映射',
      '本报告的累计费用或任务映射尚未完整核对；已知下界不能代替完整成本。',
      '在本地补充费用包含关系、账期和任务归属；原账单编号及映射保留在本机，不用模型猜金额。',
    );
  const allocation = report.analytics?.costAttribution;
  if (allocation && (allocation.coverage !== 'complete' || allocation.unallocatedMinor > 0))
    add(
      'allocation_incomplete',
      '明确未归属费用',
      `本报告有${allocation.unallocatedMinor > 0 ? '未分配金额' : '部分费用明细'}，任务成本覆盖尚不完整。`,
      '补充直接费用或明确的共享分配规则，连同已知零费用一起覆盖全部目标；不自动套用 Token 分摊。',
    );
  const progress =
    report.analytics?.groups.find((g) => g.id === 'progress')?.metrics ?? report.metrics;
  if (
    progress.some(
      (m) => m.id.startsWith('phase_') && m.id !== 'phase_ended' && m.value !== null && m.value > 0,
    )
  )
    add(
      'task_unfinished',
      '记录后续阶段和验收',
      '本报告仍有未结束或结束状态未知的工作；目前不能当最终失败或完整验收率。',
      '继续沿用同一根目标记录等待、执行和最终验收，保留已花投入；需求变化另记版本，重试不新增任务。',
    );
  if (
    report.comparisonCoverage?.reasons.some((r) => r.reason === 'workload_unknown' && r.tasks > 0)
  )
    add(
      'workload_missing',
      '补原要求的规模条件',
      '本报告有工作量单位、输入/输出数量或材料规模缺项，无法对齐社区比较条件。',
      '从原要求补充对应固定类别、单位和规模档位；不用最终生成字数、Token 或代理数量反推原要求。',
    );
  if (
    report.metrics.some(
      (m) =>
        m.measurement &&
        m.measurement.tasks !== null &&
        m.measurement.tasks < m.measurement.totalTasks,
    )
  )
    add(
      'measurement_missing',
      '补充实际测量覆盖',
      '本报告部分投入指标未覆盖全部目标，已观察数值不能代表完整范围。',
      '只补有来源的人工、时间、用量或费用记录；没有测量的项目继续保留未知，不能补零。',
    );
  if (report.referenceUnavailable || report.provisional)
    add(
      'reference_missing',
      '保留本次事实，稍后手动读取',
      '本报告为临时结果或没有取得所需公开参照；这不表示原上传失败。',
      '使用原回执手动读取反馈，不重新上传；参照仍不可用时继续查看本人工作与用量。',
    );
  else if (
    report.comparisonCoverage?.reasons.some(
      (r) => ['no_same_conditions', 'too_few_configurations'].includes(r.reason) && r.tasks > 0,
    )
  )
    add(
      'reference_missing',
      '按已覆盖条件使用结果',
      '本报告存在同条件配置不足的工作，尚不能给出该部分的可靠成本位置。',
      '查看比较覆盖及排除原因，保留这些任务的本人统计；不要将其他领域或缺条件样本并入来凑排名。',
    );
  if (report.quota.some((q) => q.consumption === null))
    add(
      'quota_unknown',
      '补齐额度窗口和变化依据',
      '本报告部分额度消费无法确定，重置、恢复、赠额或外部消费可能影响差值。',
      '通过已授权来源保留同单位的期初、期末及重置/恢复事件；滚动窗口还需要逐笔消费时间，余额下降不直接视为消费。',
    );
  if (report.kind === 'journal')
    add(
      'journal_evidence',
      '需要成本比较时再补账期与验收',
      '每日工作日记本身没有独立完整的实付和用户验收证据。',
      '需要比较时，通过贡献流程选择性补充账期实付、固定任务条件及验收来源；日记 Token 不直接换成实际付款。',
    );
  if (['single', 'short'].includes(report.sample.stage))
    add(
      'observe_longer',
      '继续积累可比观察',
      report.sample.coveredDays === null
        ? '本报告覆盖天数尚未确认；采集批次数不能确定观察期限或结果稳定性。'
        : `本报告已记录 ${report.sample.coveredDays} 天覆盖；一次长窗口或少量采集批次不能证明同条件表现稳定。`,
      '继续按近几天的授权范围增量记录；无需一次读取一个月历史。积累时间不是准确性保证，仍需检查任务与费用覆盖。',
    );
  return FeedbackNextStepsSchema.parse({
    version: 'feedback-next-steps-1',
    basis: 'report_facts',
    reportGeneratedAt: report.generatedAt,
    actions: actions.slice(0, 3),
  });
}

export function withFeedbackNextSteps(report: PersonalFeedback): PersonalFeedback {
  return { ...report, nextSteps: feedbackNextSteps(report) };
}
