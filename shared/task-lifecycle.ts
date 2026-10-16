import { z } from 'zod';
import { allocate, type StoredRecord } from './analysis.js';
import { isTaskEnded } from './task-progress.js';
import { hasCompleteCostAttribution } from './cost-attribution.js';
import { settlementStates, receivedBy } from './settlement-revision.js';
import { requirementHistoryComparisonAllowed } from './requirement-history-values.js';

export const TaskLifecycleSchema = z
  .object({
    version: z.literal('task-lifecycle-1'),
    scope: z.enum(['received_history', 'provided_history']),
    receivedAtOrBefore: z.string().datetime(),
    receivedSequenceAtOrBefore: z.number().int().positive().safe().optional(),
    status: z.enum(['clear', 'conflict', 'pending', 'unknown', 'not_applicable']),
    conflictingTasks: z.number().int().min(0).max(500),
    note: z.string().max(1000),
  })
  .strict()
  .refine(
    (value) =>
      value.status === 'conflict' ? value.conflictingTasks > 0 : value.conflictingTasks === 0,
    '重复任务数量必须与冲突状态一致',
  );
export type TaskLifecycle = z.infer<typeof TaskLifecycleSchema>;

// Private comparisons do not require consent to publish statistics. This is
// exactly the existing complete-cost condition, independent of evidence grade.
export function hasCompleteLifecycleCosts(record: StoredRecord) {
  const e = record.envelope;
  return (
    !record.quarantined &&
    e.period.allocation !== 'unallocated' &&
    hasCompleteCostAttribution(e.period) &&
    !!e.period.costCoverage &&
    e.period.costCoverage !== 'unknown' &&
    e.period.coverage === 'complete' &&
    e.period.selection === 'continuous' &&
    allocate(e).unallocated === 0 &&
    e.tasks.every(
      (t) =>
        isTaskEnded(t) &&
        requirementHistoryComparisonAllowed(t) &&
        t.evaluation?.execution.agentCoverage === 'complete' &&
        t.evaluation.execution.costScope === 'lifecycle_complete',
    )
  );
}

export function lifecycleDiagnostic(
  record: StoredRecord,
  scope: TaskLifecycle['scope'],
  status: TaskLifecycle['status'],
  conflictingTasks = 0,
): TaskLifecycle {
  const notes: Record<TaskLifecycle['status'], string> = {
    clear:
      '所检查历史中未发现同一任务的重复完整结算；这不证明费用完整，也不能识别重新生成 UUID 的重复任务。',
    conflict: `本次有 ${conflictingTasks} 项任务也出现在另一份完整结算中，无法判断费用是累计、增量还是替代。保留本次工作和用量，暂停整条记录的单位成本比较、百分位和推荐；不要把多份记录的费用相加。`,
    pending:
      '历史任务索引尚未准备完成，先展示本次工作和用量，暂不比较或推荐；可手动再次读取，无须重新上传。',
    unknown:
      '部分历史任务仍在重开、要求已经改变或无法读取校验，尚不能确认原要求的完整结算；先展示本次工作和用量，暂不比较或推荐。',
    not_applicable: record.envelope.tasks.some((task) => !requirementHistoryComparisonAllowed(task))
      ? '本次要求历史含范围变化、尚未结束的重开或覆盖未知，未作为相同原要求的完整结算比较；当前成果、原验收历史与已发生投入仍保留。'
      : '本次任务或费用尚未完整结束，不作为完整结算比较；进度与已发生投入仍保留。',
  };
  return {
    version: 'task-lifecycle-1',
    scope,
    receivedAtOrBefore: record.createdAt,
    ...(record.receivedSequence !== undefined
      ? { receivedSequenceAtOrBefore: record.receivedSequence }
      : {}),
    status,
    conflictingTasks,
    note:
      notes[status] +
      (scope === 'provided_history'
        ? ' 检查范围仅为本次提供的历史，不表示全部历史已检查。'
        : ' 检查包含接收截止之前本人的私人记录，不受公开统计同意限制。'),
  };
}

export function lifecycleFromHistory(record: StoredRecord, history: StoredRecord[]): TaskLifecycle {
  if (!hasCompleteLifecycleCosts(record))
    return lifecycleDiagnostic(record, 'provided_history', 'not_applicable');
  if (!history.length) return lifecycleDiagnostic(record, 'provided_history', 'unknown');
  const roots = new Set(record.envelope.tasks.map((t) => t.id)),
    conflicts = new Set<string>();
  const prefix = history.filter((r) => r.owner === record.owner && receivedBy(r, record));
  const settlements = settlementStates([...prefix, record]);
  let unresolved = false;
  if (settlements.get(record) === 'unknown')
    return lifecycleDiagnostic(record, 'provided_history', 'unknown');
  if (settlements.get(record) === 'conflict')
    return lifecycleDiagnostic(
      record,
      'provided_history',
      'conflict',
      record.envelope.tasks.length,
    );
  for (const other of prefix) {
    if (
      other.id === record.id ||
      other.owner !== record.owner ||
      other.envelope.origin !== record.envelope.origin
    )
      continue;
    if (['unknown', 'conflict'].includes(settlements.get(other) ?? 'unknown')) {
      if (other.envelope.tasks.some((t) => roots.has(t.id))) unresolved = true;
      continue;
    }
    if (settlements.get(other) !== 'active') continue;
    if (
      !other.quarantined &&
      other.envelope.tasks.some((t) => roots.has(t.id) && !requirementHistoryComparisonAllowed(t))
    )
      unresolved = true;
    if (!hasCompleteLifecycleCosts(other)) continue;
    for (const task of other.envelope.tasks) if (roots.has(task.id)) conflicts.add(task.id);
  }
  return lifecycleDiagnostic(
    record,
    'provided_history',
    conflicts.size ? 'conflict' : unresolved ? 'unknown' : 'clear',
    conflicts.size,
  );
}
