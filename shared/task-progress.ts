import { z } from 'zod';

export { progressPhaseLabels, progressReasonLabels } from './progress-labels.js';
export const TaskProgressSchema = z
  .object({
    phase: z.enum([
      'running',
      'paused',
      'waiting_user',
      'waiting_external',
      'blocked',
      'awaiting_acceptance',
      'ended',
      'unknown',
    ]),
    reason: z.enum([
      'none',
      'model_limit',
      'tool_failure',
      'environment',
      'resource_limit',
      'user_cancelled',
      'requirement_changed',
      'unknown',
    ]),
    basis: z.enum(['harness_event', 'user_report', 'validator', 'model_report', 'unknown']),
  })
  .strict();
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

type ProgressTask = {
  status: 'accepted' | 'partial' | 'failed' | 'abandoned' | 'in_progress';
  progress?: TaskProgress;
};

/** Legacy partial outcomes do not tell us whether execution has ended. */
export function taskProgress(task: ProgressTask): TaskProgress {
  return (
    task.progress ?? {
      phase:
        task.status === 'in_progress' ? 'running' : task.status === 'partial' ? 'unknown' : 'ended',
      reason: 'unknown',
      basis: 'unknown',
    }
  );
}
export function isTaskEnded(task: ProgressTask) {
  return taskProgress(task).phase === 'ended';
}

export function progressConflict(
  status: ProgressTask['status'] | 'completed' | 'unknown',
  progress?: TaskProgress,
) {
  if (!progress) return null;
  if (['accepted', 'failed', 'abandoned'].includes(status) && progress.phase !== 'ended')
    return '已验收、最终失败或放弃必须已结束；仍在继续时使用进行中或部分完成';
  if (status === 'in_progress' && progress.phase === 'ended')
    return '进行中任务不能同时声明已经结束';
  if (
    status === 'completed' &&
    !['ended', 'awaiting_acceptance', 'unknown'].includes(progress.phase)
  )
    return '对话报告全部完成时，执行阶段只能为待验收、已经结束或未知';
  if (['accepted', 'completed'].includes(status) && progress.reason === 'model_limit')
    return '已完成或已验收任务不能同时归因为模型无法完成';
  return null;
}
