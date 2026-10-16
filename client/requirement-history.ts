import { z } from 'zod';
import { canonical } from '../shared/schema.js';
import {
  ObservationMetaSchema,
  RequirementHistoryObservationsSchema,
  type ObservationMeta,
} from '../shared/task-observations.js';
import {
  RequirementHistoryValuesSchema,
  type RequirementHistoryValues,
} from '../shared/requirement-history-values.js';

const id = z.string().uuid(),
  local = z.string().min(1).max(512);
const criteria = z
  .array(z.object({ criterionRef: local, definitionRef: local, required: z.boolean() }).strict())
  .max(100);
const base = {
  eventRef: id,
  rootTaskId: id,
  previousEventRef: id.nullable(),
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
};
const reason = z.enum([
  'none',
  'model_limit',
  'tool_failure',
  'environment',
  'resource_limit',
  'user_cancelled',
  'requirement_changed',
  'unknown',
]);
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('baseline'), requirementRef: id, criteria }).strict(),
  z
    .object({
      ...base,
      kind: z.literal('proposal'),
      expectedRequirementRef: id,
      nextRequirementRef: id,
      criteria,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('decision'),
      proposalEventRef: id,
      expectedRequirementRef: id,
      decision: z.enum(['approve', 'reject']),
      basis: z.enum(['user_event', 'human_report', 'model_report', 'unknown']),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('assessment'),
      requirementRef: id,
      artifactRef: local,
      artifactRevision: z.number().int().nonnegative().max(100000),
      basis: z.enum(['user_report', 'validator', 'model_report', 'unknown']),
      results: z
        .array(
          z
            .object({
              criterionRef: local,
              definitionRef: local,
              result: z.enum(['passed', 'failed', 'unknown']),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('state'),
      requirementRef: id,
      phase: z.enum([
        'running',
        'paused',
        'waiting_user',
        'waiting_external',
        'blocked',
        'awaiting_acceptance',
      ]),
      reason,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('closed'),
      requirementRef: id,
      outcome: z.enum(['accepted', 'failed', 'abandoned']),
      reason,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('reopened'),
      requirementRef: id,
      closedEventRef: id,
      reason: z.enum(['defect', 'acceptance_review', 'retry', 'unknown']),
    })
    .strict(),
]);
export const LocalRequirementHistorySchema = z
  .object({
    format: z.literal('opencost-local-task-history-1'),
    meta: ObservationMetaSchema,
    recordedAtOrBefore: z.string().datetime(),
    events: z.array(eventSchema).max(10000),
  })
  .strict();
export type LocalRequirementHistory = z.infer<typeof LocalRequirementHistorySchema>;
type Event = LocalRequirementHistory['events'][number];
type Criterion = z.infer<typeof criteria>[number];
type Observation = RequirementHistoryValues & { meta: ObservationMeta };
export type RequirementHistoryReport = {
  format: 'opencost-task-history-analysis-1';
  methodVersion: 'requirement-history-method-1';
  status: 'disabled' | 'complete' | 'partial' | 'conflict' | 'capacity' | 'invalid';
  recordedAtOrBefore: string | null;
  diagnostics: string[];
  deferredEvents: number;
  tasks: { taskId: string; observation: Observation }[];
  notice: string;
};
const notice =
  '仅按本次提供的事件与接收截止重放；不识别改换标识的同一目标，不认证用户声明或验证器身份。要求条件、成果和事件标识只留本地，上传投影只有数量与状态；不改变既有费用、工作量、结算修订或自动设置。';
const precise = (at: string) =>
  !at
    .match(/\.(\d+)Z$/)?.[1]
    .slice(3)
    .split('')
    .some((digit) => digit !== '0') &&
  Number.isSafeInteger(Date.parse(at)) &&
  new Date(Date.parse(at)).toISOString().slice(0, 19) === at.slice(0, 19);

/** Parent links, not timestamps or largest revision numbers, determine the one permitted path. */
export function analyzeRequirementHistory(
  raw: unknown,
  options: { enabled?: boolean } = {},
): RequirementHistoryReport {
  const report: RequirementHistoryReport = {
    format: 'opencost-task-history-analysis-1',
    methodVersion: 'requirement-history-method-1',
    status: 'disabled',
    recordedAtOrBefore: null,
    diagnostics: [],
    deferredEvents: 0,
    tasks: [],
    notice,
  };
  if (options.enabled !== true) return report;
  const fail = (status: RequirementHistoryReport['status'], code: string) => {
    report.status = status;
    report.diagnostics = [code];
    report.tasks = [];
    return report;
  };
  try {
    const text = JSON.stringify(raw);
    if (typeof text !== 'string') return fail('invalid', 'invalid_structure');
    if (new TextEncoder().encode(text).length > 4 * 1024 * 1024)
      return fail('capacity', 'input_capacity');
  } catch {
    return fail('invalid', 'invalid_structure');
  }
  const parsed = LocalRequirementHistorySchema.safeParse(raw);
  if (!parsed.success)
    return fail(
      parsed.error.issues.some((issue) => issue.code === 'too_big') ? 'capacity' : 'invalid',
      'invalid_structure',
    );
  const input = parsed.data,
    cutoff = Date.parse(input.recordedAtOrBefore);
  report.recordedAtOrBefore = input.recordedAtOrBefore;
  if (!precise(input.recordedAtOrBefore)) return fail('invalid', 'time_precision');
  const events = new Map<string, Event>();
  let references = 0;
  for (const event of input.events) {
    if (!precise(event.recordedAt)) return fail('conflict', 'event_time_conflict');
    if (Date.parse(event.recordedAt) > cutoff) {
      report.deferredEvents++;
      continue;
    }
    if (!precise(event.occurredAt) || Date.parse(event.occurredAt) > Date.parse(event.recordedAt))
      return fail('conflict', 'event_time_conflict');
    const old = events.get(event.eventRef);
    if (old && canonical(old) !== canonical(event))
      return fail('conflict', 'event_identity_conflict');
    events.set(event.eventRef, event);
    references +=
      'criteria' in event
        ? event.criteria.length
        : event.kind === 'assessment'
          ? event.results.length
          : 1;
    if (references > 100000) return fail('capacity', 'reference_capacity');
  }
  const roots = new Map<string, Event[]>();
  for (const event of events.values()) {
    const group = roots.get(event.rootTaskId) ?? [];
    group.push(event);
    roots.set(event.rootTaskId, group);
  }
  if (roots.size > 500) return fail('capacity', 'root_capacity');
  for (const [taskId, supplied] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
    const starts = supplied.filter((e) => e.previousEventRef === null);
    if (starts.length !== 1 || starts[0].kind !== 'baseline')
      return fail('conflict', 'baseline_or_parent_missing');
    const next = new Map<string, Event>();
    for (const event of supplied) {
      if (event.previousEventRef === null) continue;
      const parent = events.get(event.previousEventRef);
      if (!parent || parent.rootTaskId !== taskId)
        return fail('conflict', 'baseline_or_parent_missing');
      if (next.has(event.previousEventRef)) return fail('conflict', 'concurrent_event_fork');
      if (Date.parse(parent.recordedAt) > Date.parse(event.recordedAt))
        return fail('conflict', 'recorded_time_conflict');
      if (Date.parse(parent.occurredAt) > Date.parse(event.occurredAt))
        return fail('conflict', 'event_time_conflict');
      next.set(event.previousEventRef, event);
    }
    const baseline = starts[0],
      baselineCriteria = baseline.criteria;
    const unique = (list: Criterion[]) =>
      new Set(list.map((c) => c.criterionRef)).size === list.length;
    if (!unique(baselineCriteria)) return fail('conflict', 'criterion_identity_conflict');
    let active = baselineCriteria,
      activeRef = baseline.requirementRef;
    let phase: RequirementHistoryValues['phase'] = 'running',
      outcome: RequirementHistoryValues['currentOutcome'] = 'unknown';
    let currentReason: RequirementHistoryValues['reason'] = 'unknown';
    let assessment: Extract<Event, { kind: 'assessment' }> | null = null;
    let closed: Extract<Event, { kind: 'closed' }> | null = null;
    const proposals = new Map<string, Extract<Event, { kind: 'proposal' }>>(),
      resolved = new Set<string>(),
      usedRequirements = new Set([activeRef]);
    let changes = 0,
      reopens = 0,
      acceptances = 0,
      originalAccepted = false,
      activeReopen = false;
    const verification = (scope: Criterion[]) => {
      const required = scope.filter((c) => c.required);
      if (
        !required.length ||
        !assessment ||
        !['user_report', 'validator'].includes(assessment.basis)
      )
        return { passed: null, all: null };
      const results = new Map(assessment.results.map((r) => [r.criterionRef, r]));
      const outcomes = required.map((c) => {
        const value = results.get(c.criterionRef);
        return value?.definitionRef === c.definitionRef ? value.result : 'unknown';
      });
      return {
        passed: outcomes.filter((r) => r === 'passed').length,
        all: outcomes.includes('failed') ? false : outcomes.includes('unknown') ? null : true,
      };
    };
    let current: Event | undefined = baseline,
      visited = 0;
    while (current) {
      visited++;
      const event: Event = current;
      if (event.kind === 'baseline' && event !== baseline)
        return fail('conflict', 'duplicate_baseline');
      if ('requirementRef' in event && event !== baseline && event.requirementRef !== activeRef)
        return fail('conflict', 'requirement_version_mismatch');
      if (event.kind === 'proposal') {
        if (
          event.expectedRequirementRef !== activeRef ||
          !unique(event.criteria) ||
          usedRequirements.has(event.nextRequirementRef)
        )
          return fail('conflict', 'requirement_proposal_conflict');
        proposals.set(event.eventRef, event);
      } else if (event.kind === 'decision') {
        const proposal = proposals.get(event.proposalEventRef);
        if (
          !proposal ||
          resolved.has(event.proposalEventRef) ||
          event.expectedRequirementRef !== activeRef ||
          (event.decision === 'approve' && proposal.expectedRequirementRef !== activeRef)
        )
          return fail('conflict', 'requirement_decision_conflict');
        if (['user_event', 'human_report'].includes(event.basis)) {
          resolved.add(event.proposalEventRef);
          if (event.decision === 'approve') {
            if (
              canonical(
                [...active].sort((a, b) => a.criterionRef.localeCompare(b.criterionRef)),
              ) ===
              canonical(
                [...proposal.criteria].sort((a, b) => a.criterionRef.localeCompare(b.criterionRef)),
              )
            )
              return fail('conflict', 'scope_change_without_change');
            if (usedRequirements.has(proposal.nextRequirementRef))
              return fail('conflict', 'requirement_proposal_conflict');
            active = proposal.criteria;
            activeRef = proposal.nextRequirementRef;
            usedRequirements.add(activeRef);
            changes++;
            assessment = null;
            closed = null;
            phase = 'running';
            outcome = 'unknown';
            currentReason = 'requirement_changed';
          }
        }
      } else if (event.kind === 'assessment') {
        if (phase === 'ended') return fail('conflict', 'closed_task_needs_reopen');
        const known = new Map(active.map((c) => [c.criterionRef, c.definitionRef]));
        if (
          new Set(event.results.map((r) => r.criterionRef)).size !== event.results.length ||
          event.results.some((r) => known.get(r.criterionRef) !== r.definitionRef)
        )
          return fail('conflict', 'assessment_scope_mismatch');
        assessment = event;
        currentReason = 'unknown';
        if (verification(active).all === true) phase = 'awaiting_acceptance';
      } else if (event.kind === 'closed') {
        if (phase === 'ended') return fail('conflict', 'closed_task_needs_reopen');
        if (
          event.outcome === 'accepted' &&
          (verification(active).all !== true || event.reason === 'model_limit')
        )
          return fail('conflict', 'acceptance_not_supported');
        phase = 'ended';
        outcome = event.outcome;
        closed = event;
        activeReopen = false;
        currentReason = event.reason;
        if (event.outcome === 'accepted') {
          acceptances++;
          if (verification(baselineCriteria).all === true) originalAccepted = true;
        }
      } else if (event.kind === 'reopened') {
        if (phase !== 'ended' || !closed || closed.eventRef !== event.closedEventRef)
          return fail('conflict', 'reopen_without_close');
        reopens++;
        activeReopen = true;
        phase = 'running';
        outcome = 'unknown';
        assessment = null;
        closed = null;
        currentReason = 'unknown';
      } else if (event.kind === 'state') {
        if (phase === 'ended') return fail('conflict', 'closed_task_needs_reopen');
        phase = event.phase;
        currentReason = event.reason;
      }
      current = next.get(event.eventRef);
      if (visited > supplied.length) return fail('conflict', 'event_cycle');
    }
    if (visited !== supplied.length) return fail('conflict', 'disconnected_events');
    const complete = input.meta.coverage === 'complete' && input.meta.source !== 'unknown';
    const known = <T>(value: T): T | null => (complete ? value : null);
    const values = RequirementHistoryValuesSchema.parse({
      version: 'requirement-history-1',
      observed: {
        events: supplied.length,
        proposals: proposals.size,
        changes,
        reopens,
        acceptances,
      },
      baselineRequired: known(baselineCriteria.filter((c) => c.required).length),
      currentRequired: known(active.filter((c) => c.required).length),
      currentPassed: complete ? verification(active).passed : null,
      approvedChanges: known(changes),
      pendingProposals: known([...proposals.keys()].filter((ref) => !resolved.has(ref)).length),
      reopenedCount: known(reopens),
      acceptanceEvents: known(acceptances),
      originalAcceptedHistorically: known(originalAccepted),
      originalVerifiedNow: complete ? verification(baselineCriteria).all : null,
      activeReopen: known(activeReopen),
      phase: complete ? phase : 'unknown',
      currentOutcome: complete ? outcome : 'unknown',
      reason: complete ? currentReason : 'unknown',
    });
    const missing = Object.entries(values).some(
      ([key, value]) =>
        !['version', 'observed'].includes(key) && (value === null || value === 'unknown'),
    );
    const meta = {
      ...input.meta,
      missingReason: missing ? (input.meta.missingReason ?? ('not_recorded' as const)) : null,
    };
    const observation = RequirementHistoryObservationsSchema.safeParse({ ...values, meta });
    if (!observation.success) return fail('conflict', 'history_metadata_conflict');
    report.tasks.push({ taskId, observation: observation.data });
  }
  report.status =
    input.meta.coverage === 'complete' && input.meta.source !== 'unknown' ? 'complete' : 'partial';
  return report;
}
