import type { SummaryTask } from './desktop-summary.js';
import { progressPhaseLabels, progressReasonLabels } from './progress-labels.js';

export function summaryTaskStatusLabel(task: Pick<SummaryTask, 'reportedStatus' | 'progress'>) {
  const label = {
    completed: '对话报告完成',
    partial: '部分完成',
    failed: '已结束，未通过',
    abandoned: '已放弃',
    in_progress: '尚未做完',
    unknown: '结果未记录',
  }[task.reportedStatus];
  if (!task.progress)
    return `${label}${task.reportedStatus === 'partial' ? ' · 结束情况未记录' : ''}`;
  return `${label} · ${progressPhaseLabels[task.progress.phase]}${
    ['none', 'unknown'].includes(task.progress.reason)
      ? ''
      : ` · ${progressReasonLabels[task.progress.reason]}`
  }`;
}
