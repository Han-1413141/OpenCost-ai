type WithCode = {
  observations?: {
    codeMeasurements?: {
      snapshots: readonly { status: string; stage: string }[];
      patches: readonly { status: string; stage: string }[];
    };
  };
};
export function codeObservationCounts(tasks: readonly WithCode[]) {
  const counts = {
    totalTasks: tasks.length,
    attachedTasks: 0,
    snapshots: 0,
    patches: 0,
    beforeTasks: 0,
    afterTasks: 0,
    proposedPatchTasks: 0,
    partialReports: 0,
    unavailableReports: 0,
  };
  for (const task of tasks) {
    const c = task.observations?.codeMeasurements;
    if (!c) continue;
    counts.attachedTasks++;
    counts.snapshots += c.snapshots.length;
    counts.patches += c.patches.length;
    if (c.snapshots.some((s) => s.stage === 'before_execution')) counts.beforeTasks++;
    if (c.snapshots.some((s) => s.stage === 'after_execution')) counts.afterTasks++;
    if (c.patches.some((p) => p.stage === 'proposed')) counts.proposedPatchTasks++;
    for (const r of [...c.snapshots, ...c.patches]) {
      if (r.status === 'partial') counts.partialReports++;
      if (r.status === 'unavailable') counts.unavailableReports++;
    }
  }
  return counts;
}
export function codeObservationNotice(tasks: readonly WithCode[]): string | null {
  const c = codeObservationCounts(tasks);
  return c.attachedTasks
    ? `本次将附加${c.attachedTasks}项根目标的代码数值：${c.snapshots}份代码快照、${c.patches}份补丁记录；` +
        `其中${c.partialReports}份部分测得、${c.unavailableReports}份未测得。仅用于本人描述性反馈，来源与阶段为客户端声明。` +
        '不包含源码、路径、本地要求修订UUID或精确测量时间；不增加完成量或影响公开排名。'
    : null;
}
