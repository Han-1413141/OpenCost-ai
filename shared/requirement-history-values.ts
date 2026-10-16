import { z } from 'zod';
const count = z.number().int().nonnegative().max(10000).nullable();
export const RequirementHistoryValuesSchema = z
  .object({
    version: z.literal('requirement-history-1'),
    observed: z
      .object({
        events: count.unwrap(),
        proposals: count.unwrap(),
        changes: count.unwrap(),
        reopens: count.unwrap(),
        acceptances: count.unwrap(),
      })
      .strict(),
    baselineRequired: count,
    currentRequired: count,
    currentPassed: count,
    approvedChanges: count,
    pendingProposals: count,
    reopenedCount: count,
    acceptanceEvents: count,
    originalAcceptedHistorically: z.boolean().nullable(),
    originalVerifiedNow: z.boolean().nullable(),
    activeReopen: z.boolean().nullable(),
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
    currentOutcome: z.enum(['accepted', 'failed', 'abandoned', 'unknown']),
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
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      v.observed.events <
      1 + v.observed.proposals + v.observed.changes + v.observed.reopens + v.observed.acceptances
    )
      fail('提供事件数须包含原要求及已记录各类事件');
    if (v.observed.changes > v.observed.proposals) fail('批准变化不能多于已提供提案');
    if (
      v.currentPassed !== null &&
      (v.currentRequired === null || v.currentPassed > v.currentRequired)
    )
      fail('当前通过项数不能超过当前必需项数');
    if (v.currentOutcome !== 'unknown' && v.phase !== 'ended') fail('最终结果须已结束');
    if (
      v.currentOutcome === 'accepted' &&
      (!v.currentRequired || v.currentPassed !== v.currentRequired)
    )
      fail('验收须有非空且全部通过的当前必需条件');
    if (v.activeReopen === true && (v.phase === 'ended' || !v.reopenedCount))
      fail('活动重开须仍在执行且存在重开事件');
    if (v.originalAcceptedHistorically === true && !v.acceptanceEvents)
      fail('历史验收需要验收事件');
    for (const [total, subtotal] of [
      [v.approvedChanges, v.observed.changes],
      [v.reopenedCount, v.observed.reopens],
      [v.acceptanceEvents, v.observed.acceptances],
    ])
      if (total !== null && total !== subtotal) fail('完整历史总数须与已提供事件数一致');
  });
export type RequirementHistoryValues = z.infer<typeof RequirementHistoryValuesSchema>;

export function requirementHistoryComparisonAllowed(task: {
  observations?: {
    history?: RequirementHistoryValues & { meta: { source: string; coverage: string } };
  };
}) {
  const value = task.observations?.history;
  return (
    !value ||
    (value.meta.source !== 'unknown' &&
      value.meta.coverage === 'complete' &&
      value.approvedChanges === 0 &&
      value.phase === 'ended' &&
      value.activeReopen === false)
  );
}
