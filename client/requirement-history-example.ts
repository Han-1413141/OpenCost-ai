import {
  LocalRequirementHistorySchema,
  type LocalRequirementHistory,
} from './requirement-history.js';
/** Explicit method example, never a real workload record. */
export function requirementHistoryExample(): LocalRequirementHistory {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const common = (n: number) => ({
    eventRef: id(n),
    rootTaskId: id(100),
    previousEventRef: n === 1 ? null : id(n - 1),
    occurredAt: `2026-10-15T00:00:0${n}.000Z`,
    recordedAt: `2026-10-15T00:00:0${n}.000Z`,
  });
  const criteria = ['private-criterion-a', 'private-criterion-b'].map((criterionRef) => ({
    criterionRef,
    definitionRef: criterionRef + '-v1',
    required: true,
  }));
  return LocalRequirementHistorySchema.parse({
    format: 'opencost-local-task-history-1',
    meta: {
      source: 'human_report',
      coverage: 'complete',
      timing: 'retrospective',
      missingReason: null,
    },
    recordedAtOrBefore: '2026-10-15T00:01:00.000Z',
    events: [
      { ...common(1), kind: 'baseline', requirementRef: id(200), criteria },
      {
        ...common(2),
        kind: 'assessment',
        requirementRef: id(200),
        artifactRef: 'private-deliverable',
        artifactRevision: 1,
        basis: 'user_report',
        results: criteria.map((c) => ({
          criterionRef: c.criterionRef,
          definitionRef: c.definitionRef,
          result: 'passed',
        })),
      },
      {
        ...common(3),
        kind: 'closed',
        requirementRef: id(200),
        outcome: 'accepted',
        reason: 'none',
      },
      {
        ...common(4),
        kind: 'reopened',
        requirementRef: id(200),
        closedEventRef: id(3),
        reason: 'defect',
      },
      {
        ...common(5),
        kind: 'state',
        requirementRef: id(200),
        phase: 'waiting_user',
        reason: 'unknown',
      },
    ],
  });
}
