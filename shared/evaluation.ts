import { canonical, type Envelope, type Task } from './schema.js';
import { WORK_TAXONOMY_VERSION } from './work-taxonomy.js';
import { workMeasurementRules } from './work-structure.js';
import { hasCompleteChargeMapping } from './charge-reconciliation.js';
import { requirementHistoryComparisonAllowed } from './requirement-history-values.js';

export const EVALUATION_VERSION = 'work-summary-1';
export const countBand = (n: number | null | undefined) =>
  n == null
    ? 'unknown'
    : n === 0
      ? '0'
      : n === 1
        ? '1'
        : n <= 3
          ? '2-3'
          : n <= 7
            ? '4-7'
            : n <= 20
              ? '8-20'
              : '21+';

// Kept as a compatibility function. No task ratings are computed, even for old records.
export function difficulty(_task: Task) {
  return { status: 'disabled' as const, level: 'unknown' as const, points: null };
}

export function evaluationCohort(task: Task) {
  return {
    version: task.evaluation ? EVALUATION_VERSION : 'legacy',
    difficulty: 'unknown',
    profile: null,
  };
}

export function isCurrentSummaryProjection(e: { version: string; profile: unknown } | undefined) {
  return !e || (['legacy', EVALUATION_VERSION].includes(e.version) && e.profile === null);
}

export const executionMetrics = [
  'userTurns',
  'assistantTurns',
  'modelCalls',
  'toolCalls',
  'toolFailures',
  'contextResets',
  'contextCompactions',
  'humanInterventions',
  'requirementChanges',
  'modelSwitches',
  'harnessSwitches',
  'agentCount',
  'maxAgentDepth',
  'maxParallelAgents',
] as const;
export type ExecutionMetric = (typeof executionMetrics)[number];
export const resourceMetrics = [
  'cpuSeconds',
  'gpuSeconds',
  'memoryGiBHours',
  'storageGiBDays',
  'networkBytes',
  'searchRequests',
  'externalApiRequests',
  'images',
  'mediaSeconds',
] as const;
export type ResourceMetric = (typeof resourceMetrics)[number];

export const tokenMetrics = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'outputTokens',
  'reasoningTokens',
] as const;

export function summarizeWork(envelope: Envelope) {
  const tasks = envelope.tasks;
  const measured = (values: (number | null | undefined)[]) => ({
    total:
      values.length && values.every((v) => v != null)
        ? values.reduce<number>((s, v) => s + v!, 0)
        : null,
    knownSubtotal: values.reduce<number>((s, v) => s + (v ?? 0), 0),
    measured: values.filter((v) => v != null).length,
    expected: values.length,
  });
  const quantities = tasks.flatMap((t) =>
    t.evaluation?.version === 'work-summary-1' ? (t.evaluation.completedWork ?? []) : [],
  );
  const workRecordedTasks = tasks.filter(
    (t) => t.evaluation?.version === 'work-summary-1' && t.evaluation.completedWork !== null,
  ).length;
  const workComplete = tasks.length > 0 && workRecordedTasks === tasks.length;
  const groups = new Map<string, typeof quantities>();
  for (const quantity of quantities) {
    const key = canonical([
      quantity.kind,
      quantity.workType,
      quantity.unit,
      quantity.source,
      quantity.acceptance,
      quantity.coverage,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), quantity]);
  }
  const agentComplete =
    tasks.length > 0 && tasks.every((t) => t.evaluation?.execution.agentCoverage === 'complete');
  const tokens = Object.fromEntries(
    tokenMetrics.map((key) => {
      const value = measured(tasks.flatMap((t) => t.models.map((m) => m[key])));
      return [key, { ...value, total: agentComplete ? value.total : null }];
    }),
  ) as Record<(typeof tokenMetrics)[number], ReturnType<typeof measured>>;
  const input = tokens.inputTokens.total,
    output = tokens.outputTokens.total;
  const structures = tasks.map((t) =>
    t.evaluation?.version === 'work-summary-1' ? t.evaluation.workStructure : null,
  );
  const structureMeasured = (
    key:
      | 'componentCount'
      | 'requiredComponentCount'
      | 'completedComponentCount'
      | 'acceptedComponentCount',
  ) => {
    const m = measured(structures.map((s) => s?.[key]));
    return {
      ...m,
      knownSubtotal:
        key === 'componentCount'
          ? structures.reduce((sum, s) => sum + (s?.observed.componentCount ?? 0), 0)
          : m.knownSubtotal,
    };
  };
  const dependencyDepths = structures.flatMap((s) =>
    s?.dependencyDepth == null ? [] : [s.dependencyDepth],
  );
  return {
    basis: 'observed_work_and_usage_only',
    difficultyEnabled: false,
    rootGoals: {
      recorded: tasks.length,
      accepted: tasks.filter((t) => t.status === 'accepted').length,
      partial: tasks.filter((t) => t.status === 'partial').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      abandoned: tasks.filter((t) => t.status === 'abandoned').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    },
    completedWorkCoverage: { recordedTasks: workRecordedTasks, totalTasks: tasks.length },
    workStructure: {
      recordedTasks: structures.filter(Boolean).length,
      expectedTasks: tasks.length,
      components: structureMeasured('componentCount'),
      requiredComponents: structureMeasured('requiredComponentCount'),
      completedComponents: structureMeasured('completedComponentCount'),
      acceptedComponents: structureMeasured('acceptedComponentCount'),
      maximumDependencyDepth:
        dependencyDepths.length === tasks.length && tasks.length > 0
          ? Math.max(...dependencyDepths)
          : null,
      observedMaximumDependencyDepth: dependencyDepths.length
        ? Math.max(...dependencyDepths)
        : null,
      integrationRequiredGoals: measured(
        structures.map((s) =>
          s?.integrationRequired == null ? null : Number(s.integrationRequired),
        ),
      ),
      integrationAcceptedGoals: measured(
        structures.map((s) =>
          s?.integrationRequired === false
            ? 0
            : s?.integrationAccepted == null
              ? null
              : Number(s.integrationAccepted),
        ),
      ),
      coupling: structures.reduce<Record<string, number>>((counts, s) => {
        if (s) counts[s.coupling] = (counts[s.coupling] ?? 0) + 1;
        return counts;
      }, {}),
    },
    completedWork: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, values]) => {
        const complete = workComplete && values[0].coverage === 'complete';
        const metric = (key: 'planned' | 'completed' | 'accepted') => {
          const value = measured(values.map((v) => v[key]));
          return { ...value, total: complete ? value.total : null };
        };
        return {
          kind: values[0].kind,
          workType: values[0].workType,
          unit: values[0].unit,
          source: values[0].source,
          acceptance: values[0].acceptance,
          coverage: values[0].coverage,
          planned: metric('planned'),
          completed: metric('completed'),
          accepted: metric('accepted'),
        };
      }),
    tokens: {
      ...tokens,
      total: input !== null && output !== null ? input + output : null,
      totalDefinition: 'input_plus_output; cached_and_reasoning_are_subsets',
    },
    execution: Object.fromEntries(
      executionMetrics.map((key) => {
        const values = tasks.map((t) => t.evaluation?.execution[key]),
          metric = measured(values);
        const maximum = ['maxAgentDepth', 'maxParallelAgents'].includes(key);
        const known = values.filter((v): v is number => v != null);
        const observedMaximum = maximum && known.length ? Math.max(...known) : null;
        if (key === 'agentCount' && envelope.executionScope) {
          const scope = envelope.executionScope;
          return [
            key,
            {
              ...metric,
              aggregation: 'unique_identity_across_tasks',
              total: scope.uniqueAgents,
              knownSubtotal: scope.observedAgents,
              maximum: null,
              observedMaximum: null,
            },
          ];
        }
        return [
          key,
          {
            ...metric,
            aggregation: maximum ? 'maximum_per_task' : 'sum',
            total: !maximum && agentComplete ? metric.total : null,
            knownSubtotal: maximum ? null : metric.knownSubtotal,
            maximum:
              maximum && agentComplete && metric.measured === metric.expected
                ? observedMaximum
                : null,
            observedMaximum,
          },
        ];
      }),
    ),
    agentCoverage: agentComplete ? 'complete' : 'incomplete',
  };
}

export function evaluateEnvelope(envelope: Envelope) {
  return {
    version: EVALUATION_VERSION,
    schemaVersion: envelope.schemaVersion,
    costCoverage: envelope.period.costCoverage ?? 'unknown',
    costComponents: envelope.period.costComponents ?? null,
    summary: summarizeWork(envelope),
    tasks: envelope.tasks.map((task) => {
      const e = task.evaluation;
      const exclusions: string[] = [];
      if (!requirementHistoryComparisonAllowed(task))
        exclusions.push('changed_or_incomplete_requirement_history');
      if (!hasCompleteChargeMapping(envelope.period))
        exclusions.push('incomplete_charge_reconciliation');
      if (!e) exclusions.push('legacy_evaluation');
      if (e && e.execution.agentCoverage !== 'complete') exclusions.push('incomplete_agent_tree');
      if (e && e.execution.costScope !== 'lifecycle_complete')
        exclusions.push('incomplete_task_cost');
      if (e && e.execution.harnesses?.length !== 1)
        exclusions.push('multiple_or_unknown_harnesses');
      if (task.models.length !== 1) exclusions.push('multiple_models');
      return {
        id: task.id,
        kind: task.kind,
        completedWork: e?.version === 'work-summary-1' ? e.completedWork : null,
        plannedParts: e?.requirements.parts?.reduce((s, p) => s + p.count, 0) ?? null,
        completedParts: e?.outcome.partsCompleted ?? null,
        acceptedParts: e?.outcome.partsAccepted ?? null,
        rootAccepted: task.status === 'accepted',
        execution: e?.execution ?? null,
        resources: e?.resources ?? null,
        workStructure: e?.version === 'work-summary-1' ? (e.workStructure ?? null) : null,
        modelRankingExclusions: exclusions,
      };
    }),
  };
}

export const methodology = {
  workMeasurement: workMeasurementRules,
  version: EVALUATION_VERSION,
  minimumSubmissionVersion: '1.1',
  algorithm: 'minimum-harness-per-work-condition',
  unit: 'one_independently_accepted_root_goal',
  cost: 'sum_all_task_costs_including_failures / accepted_root_goals',
  modelCost:
    'task types equally weighted, then conditions equally weighted within each type; each condition uses its lowest observed model/harness/configuration/plan cost with nonzero acceptance',
  difficulty: {
    enabled: false,
    status: 'disabled',
    draftVersion: 'domain-difficulty-draft-2',
    use: 'none; no collection, scoring, stratification or ranking adjustment',
    calibrated: false,
  },
  taxonomy: {
    version: WORK_TAXONOMY_VERSION,
    endpoint: '/api/work-taxonomy',
    use: 'optional_completed_work_description',
  },
  workConditions:
    'Observed task kind, scope, workload and acceptance conditions only; legacy subjective evaluation profiles ignored; no cost/duration/turn bonus',
  minimumTasks: 20,
  minimumSources: 5,
  maximumSourceShare: 0.35,
  completion:
    'accepted / all_tasks is displayed, never a ranking threshold; failure costs are already in the cost numerator',
  selection:
    'Select independently within each task condition; expose each selected Harness; aggregated results describe a combination of task-specific choices, not one observed execution; equal-cost ties use completion, source count, task count, then stable configuration ID',
  missing:
    'unknown and null remain missing; historical raw evaluation is preserved but does not generate ratings',
  limitation:
    'No difficulty adjustment; observed cost summaries do not establish equivalent task complexity or causal model superiority',
  externalBenchmarks: 'reference_only_not_used_in_real_work_rankings',
};
