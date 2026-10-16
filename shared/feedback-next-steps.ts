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
      '核对日记日期',
      '日记日期与采集时间不一致。',
      '在本机核对日期、时区和采集时间，再更新这份日记。',
    );
  if (report.lifecycle?.status === 'conflict')
    add(
      'settlement_conflict',
      '核对重复账目',
      `${report.lifecycle.conflictingTasks} 项任务出现重复结算，费用关系还未确认。`,
      '核对这些记录是追加费用还是替换旧账；确认前不要将多份完整快照相加。',
    );
  else if (report.lifecycle && ['pending', 'unknown'].includes(report.lifecycle.status))
    add(
      'history_unprepared',
      '稍后刷新成本比较',
      '历史账目还在整理。',
      '稍后刷新这份反馈，已经保存的摘要不需要重复提交。',
    );
  const charges = report.analytics?.chargeReconciliation;
  if (
    charges &&
    (charges.status !== 'reconciled' || charges.unmappedMinor === null || charges.unmappedMinor > 0)
  )
    add(
      'charges_incomplete',
      '补齐任务费用',
      '部分费用还没有对应到具体任务。',
      '补上实际金额、账期和对应任务，账单原件留在本机。',
    );
  const allocation = report.analytics?.costAttribution;
  if (allocation && (allocation.coverage !== 'complete' || allocation.unallocatedMinor > 0))
    add(
      'allocation_incomplete',
      '分配共享费用',
      `${allocation.unallocatedMinor > 0 ? '还有费用未分配' : '费用明细不完整'}，影响单项任务成本。`,
      '注明费用属于哪个任务；多个任务共用的费用，选择分配方式。',
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
      '做完后更新进度',
      '还有任务在进行、等待处理，或没有记录结束状态；这些不能当最终失败。',
      '继续更新原任务的进度和验收结果，重试记在同一项任务下。',
    );
  if (
    report.comparisonCoverage?.reasons.some((r) => r.reason === 'workload_unknown' && r.tasks > 0)
  )
    add(
      'workload_missing',
      '补充任务规模',
      '部分任务缺少数量或材料规模，找不到相同条件的参照。',
      '按原需求补充工作类型、数量和材料规模，不用最终生成字数或 Token 反推。',
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
      '补齐用量记录',
      '部分任务缺少时间、人工、用量或费用。',
      '从本地记录补齐缺项；没有记录的保留“未记录”，不要填零。',
    );
  if (report.referenceUnavailable)
    add(
      'reference_missing',
      '稍后查看比较结果',
      '摘要已保存，比较数据还未准备好。',
      '稍后刷新这份反馈，无需重新上传。',
    );
  else if (report.provisional)
    add(
      'reference_missing',
      '保留这份反馈的入口',
      '这份反馈尚未保存，页面上已有的结果可以查看。',
      '保留上传回执或私人链接，稍后再次读取，无需重新上传。',
    );
  else if (
    report.comparisonCoverage?.reasons.some(
      (r) => ['no_same_conditions', 'too_few_configurations'].includes(r.reason) && r.tasks > 0,
    )
  )
    add(
      'reference_missing',
      '稍后查看同类比较',
      '部分任务还没有足够的同类方案可比较。',
      '本次工作和费用已保留，后续反馈会按相同任务条件比较。',
    );
  if (report.quota.some((q) => q.consumption === null))
    add(
      'quota_unknown',
      '补充额度变化记录',
      '这段消费缺少可用的前后观察或完整事件记录。',
      '补充期初、期末及重置或赠额记录；滚动额度还需要每次使用时间。',
    );
  if (report.kind === 'journal')
    add(
      'journal_evidence',
      '查看成本比较',
      '这份日记还没有记录实付费用和验收结果。',
      '在上传工作统计时补充实际费用和验收结果，即可匹配同类任务。',
    );
  if (['single', 'short'].includes(report.sample.stage))
    add(
      'observe_longer',
      '继续记录几天',
      report.sample.coveredDays === null
        ? '覆盖天数尚未确认。'
        : `已覆盖 ${report.sample.coveredDays} 天${report.sample.coveredDays >= 7 ? '；一次长窗口仍需后续观察' : '，继续记录可观察日常变化'}。`,
      '每天只记录新增工作，积累一周或一个月再看趋势；无需一次读取一个月历史。',
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
