import type { StoredRecord } from './analysis.js';
import { settlementStates } from './settlement-revision.js';

export type CommunityStatistics = {
  summaries: number;
  tasks: number;
  wallMs: number | null;
  timedTasks: number;
};

export function communityStatistics(
  records: StoredRecord[],
  allowSynthetic = false,
): CommunityStatistics {
  const summaries = new Set<string>();
  const settlements = settlementStates(records, { acceptedHeads: true });
  const unresolved = new Set(
    records.flatMap((r) =>
      ['unknown', 'conflict'].includes(settlements.get(r) ?? 'unknown')
        ? r.envelope.tasks.map((t) => JSON.stringify([r.owner, r.envelope.origin, t.id]))
        : [],
    ),
  );
  const tasks = new Map<string, number | null>();
  for (const record of records) {
    if (settlements.get(record) !== 'active') continue;
    if (
      record.envelope.tasks.some((t) =>
        unresolved.has(JSON.stringify([record.owner, record.envelope.origin, t.id])),
      )
    )
      continue;
    const envelope = record.envelope;
    if (
      record.quarantined ||
      !envelope.consent.statistics ||
      (!allowSynthetic && envelope.origin !== 'real')
    )
      continue;
    summaries.add(JSON.stringify([record.owner, envelope.collectionWindow?.batch.id ?? record.id]));
    for (const task of envelope.tasks) {
      const key = JSON.stringify([record.owner, task.id]);
      const previous = tasks.get(key) ?? null;
      const duration = task.performance?.wallMs ?? null;
      // Root task duration can recur in later batches; retain the latest cumulative maximum.
      tasks.set(key, duration === null ? previous : Math.max(previous ?? 0, duration));
    }
  }
  const knownDurations = [...tasks.values()].filter((value): value is number => value !== null);
  return {
    summaries: summaries.size,
    tasks: tasks.size,
    wallMs:
      tasks.size && !knownDurations.length
        ? null
        : knownDurations.reduce((sum, duration) => sum + duration, 0),
    timedTasks: knownDurations.length,
  };
}
