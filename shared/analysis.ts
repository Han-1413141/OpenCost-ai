import { comparableEquivalentMinor } from './price-metering.js';
import { netPayment } from './payment.js';
import { settlementStates } from './settlement-revision.js';
import { harnessComposition } from './harness-composition.js';
import {
  evaluationCohort,
  executionMetrics,
  resourceMetrics,
  type ExecutionMetric,
  type ResourceMetric,
} from './evaluation.js';
import {
  canonical,
  MAX_SOURCE_SHARE,
  MIN_SOURCES,
  MIN_TASKS,
  type Envelope,
  type Evidence,
  type Task,
  type EventKind,
  taskDomain,
} from './schema.js';
import { workDomainForType } from './work-taxonomy.js';
import { isModelIdentity, modelIdentity, type ModelIdentity } from './model-identity.js';
import { summarizeSourceSupport, type SourceSupport } from './source-support.js';
import { isTaskEnded } from './task-progress.js';
import { requirementHistoryComparisonAllowed } from './requirement-history-values.js';
import { workloadComparisonEligibility } from './comparison-eligibility.js';
import {
  allocateItemized,
  costAttributionPolicy,
  hasCompleteCostAttribution,
  hasComparableCostAttribution,
} from './cost-attribution.js';

export function hasComparableTaskType(task: Task) {
  if (taskDomain(task.kind) !== 'other') return true;
  const c = task.requirementClassification;
  return (
    !!c &&
    c.coverage === 'complete' &&
    ['original_request', 'approved_change'].includes(c.basis) &&
    !['unknown', 'mixed'].includes(c.workType) &&
    !!workDomainForType(c.workType)?.parentDomains.includes('other')
  );
}

export function allocate(envelope: Envelope) {
  const p = envelope.period;
  const net = netPayment(p);
  if (net === null) return { net, costs: envelope.tasks.map(() => null), unallocated: null };
  if (p.allocation === 'itemized') {
    const { costs, unallocated } = allocateItemized(envelope);
    return { net, costs, unallocated };
  }
  if (p.allocation === 'direct') {
    const costs = envelope.tasks.map((t) => t.directCostMinor!);
    return { net, costs, unallocated: net - costs.reduce((a, b) => a + b, 0) };
  }
  if (p.allocation === 'unallocated')
    return { net, costs: envelope.tasks.map(() => 0), unallocated: net };
  if (
    p.allocation === 'tokens' &&
    envelope.tasks.some((t) =>
      t.models.some((m) => m.inputTokens === null || m.outputTokens === null),
    )
  )
    return { net, costs: envelope.tasks.map(() => 0), unallocated: net };
  const weights = envelope.tasks.map((t) =>
    p.allocation === 'equal'
      ? 1
      : t.models.reduce((s, m) => s + m.inputTokens! + m.outputTokens!, 0),
  );
  weights.push(p.unassignedWeight);
  // Integer largest-remainder apportionment. BigInt prevents money/weight precision loss.
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (!sum) return { net, costs: envelope.tasks.map(() => 0), unallocated: net };
  const shares = weights.map((w) => Number((BigInt(net) * BigInt(w)) / sum));
  const remainders = weights
    .map((w, i) => ({ i, remainder: (BigInt(net) * BigInt(w)) % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  const left = net - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; i < left; i++) shares[remainders[i].i]++;
  return { net, costs: shares.slice(0, -1), unallocated: shares.at(-1)! };
}

export function analyze(envelope: Envelope) {
  const money = allocate(envelope);
  const accepted = envelope.tasks.filter((t) => t.status === 'accepted').length;
  return {
    ...money,
    tasks: envelope.tasks.length,
    accepted,
    costPerAccepted: accepted && money.net !== null ? money.net / accepted : null,
    completion: envelope.tasks.length ? accepted / envelope.tasks.length : null,
    retries: envelope.tasks.reduce((s, t) => s + t.attempts - 1, 0),
    humanMinutes: envelope.tasks.every((t) => t.humanMinutes !== null)
      ? envelope.tasks.reduce((s, t) => s + t.humanMinutes!, 0)
      : null,
    tokens: envelope.tasks.every((t) =>
      t.models.every((m) => m.inputTokens !== null && m.outputTokens !== null),
    )
      ? envelope.tasks.reduce(
          (s, t) => s + t.models.reduce((v, m) => v + m.inputTokens! + m.outputTokens!, 0),
          0,
        )
      : null,
    equivalentMinor: (() => {
      const values = envelope.tasks.flatMap((t) =>
        t.models.map((m) => comparableEquivalentMinor(m, envelope.period.currency)),
      );
      return values.length && values.every((v) => v !== null)
        ? values.reduce<number>((s, v) => s + v!, 0)
        : null;
    })(),
  };
}

export type StoredRecord = {
  id: string;
  owner: string;
  envelope: Envelope;
  evidence: Evidence;
  createdAt: string;
  quarantined: boolean;
  digest?: string;
  receivedSequence?: number;
  settlementVerified?: boolean;
  /** Set only by the store's accepted relation projection, never the upload envelope. */
  acceptedSettlementState?: import('./settlement-revision.js').SettlementState;
};
export type Observation = {
  task: Task;
  cost: number;
  owner: string;
  period: Envelope['period'];
  evidence: Evidence;
};
const band = (n: number) => (n === 1 ? '1' : n <= 3 ? '2-3' : '4+');

export function cohort(task: Task, period: Envelope['period']) {
  return {
    ...(task.evaluation?.execution.harnesses && task.evaluation.execution.harnesses.length > 1
      ? { harnessComposition: harnessComposition(task.evaluation.execution.harnesses) }
      : {}),
    evaluation: evaluationCohort(task),
    costCoverage: period.costCoverage ?? 'unknown',
    harnessAttribution: !task.evaluation
      ? 'legacy'
      : !task.evaluation.execution.harnesses
        ? 'unknown'
        : task.evaluation.execution.harnesses.length > 1
          ? 'mixed'
          : 'single',
    month: period.month,
    currency: period.currency,
    billing: period.billing,
    payment: period.payment,
    allocation: period.allocation,
    ...(period.allocation === 'itemized'
      ? { costAttributionPolicy: costAttributionPolicy(task, period) }
      : {}),
    plan: period.plan,
    planVersion: period.planVersion,
    domain: taskDomain(task.kind),
    kind: task.kind,
    // Classify from requirements, never from the produced artifacts or success.
    workType:
      task.requirementClassification?.workType === 'mixed'
        ? 'mixed'
        : task.requirementClassification?.coverage === 'complete'
          ? task.requirementClassification.workType
          : 'unknown',
    subjects:
      task.requirementClassification?.coverage === 'complete'
        ? task.requirementClassification.subjects.filter((s) => s !== 'unknown').sort()
        : [],
    componentTypes:
      task.requirementClassification?.coverage === 'complete'
        ? (task.requirementClassification.componentTypes
            ?.slice()
            .sort((a, b) => a.workType.localeCompare(b.workType)) ?? null)
        : null,
    useContext:
      task.requirementClassification?.coverage === 'complete'
        ? task.requirementClassification.useContext
        : 'unknown',
    classificationBasis:
      task.requirementClassification?.coverage === 'complete'
        ? task.requirementClassification.basis
        : 'unknown',
    scope: task.scope,
    context: task.context,
    acceptance: task.acceptance,
    acceptanceBand: band(task.acceptanceTotal),
    dependencies: task.dependencies,
    requirementsLocked: task.requirementsLocked,
    workloadUnit: task.workload?.unit ?? ('unknown' as const),
    inputUnits: task.workload?.inputUnits ?? 'unknown',
    outputUnits: task.workload?.outputUnits ?? 'unknown',
    constraintCount: task.workload?.constraintCount ?? 'unknown',
    verification: task.workload?.verification ?? 'unknown',
    inputSizeUnit: task.workload?.inputSize?.unit ?? ('unknown' as const),
    inputSizeBand: task.workload?.inputSize?.band ?? 'unknown',
    models: task.models
      .map((m) => `${m.provider}:${m.model}@${m.version}`)
      .sort()
      .join(' + '),
    modelIdentity: modelIdentity(task.models),
    harness: task.harness.id,
    harnessVersion: task.harness.version,
    harnessVariant: task.harness.variant ?? null,
    harnessSurface: task.harness.surface ?? 'unknown',
    mode: task.harness.mode,
    tools: task.harness.tools,
    reasoning: task.harness.reasoning,
    cache: task.harness.cache,
  };
}

export type Cohort = Omit<ReturnType<typeof cohort>, 'modelIdentity'> & {
  // Optional only for reading old aggregate responses; newly compiled cohorts
  // always carry the structured identity generated from the raw model usages.
  modelIdentity?: ModelIdentity;
};
export type Metrics = {
  execution: Record<ExecutionMetric, { mean: number | null; samples: number }>;
  resources: Record<ResourceMetric, { mean: number | null; samples: number }>;
  count: number;
  sources: number;
  accepted: number;
  spendMinor: number;
  costPerAccepted: number | null;
  completion: number;
  median: number;
  p25: number;
  p75: number;
  retries: number;
  humanMinutes: number | null;
  humanSamples: number;
  tokens: number | null;
  cacheRate: number | null;
  sourceBalancedCost: number | null;
  sourceRange: [number, number] | null;
  // Optional for historical aggregate responses produced before source-support-1.
  sourceSupport?: SourceSupport;
  rework: number | null;
  revisions: number | null;
  intentErrors: number | null;
  events: Partial<Record<EventKind, number>>;
  eventSamples: number;
  outputTps: number | null;
  ttftMs: number | null;
  // Measured root tasks, distinct from the number of timed model requests.
  ttftTaskSamples?: number;
  wallMinutes: number | null;
  wallSamples: number;
  modelMinutes: number | null;
  toolMinutes: number | null;
  queueSeconds: number | null;
  speedSamples: number;
  reworkSamples: number;
  revisionSamples: number;
};
export type Comparison = {
  id: string;
  cohort: Cohort;
  modelIds: string[];
  evidence: Evidence;
  metrics: Metrics;
};
const sortedQuantile = (s: number[], p: number) => {
  if (!s.length) return 0;
  const i = (s.length - 1) * p,
    lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
export const quantile = (values: number[], p: number) =>
  sortedQuantile(
    [...values].sort((a, b) => a - b),
    p,
  );

export function baselineComparableRecord(r: StoredRecord, allowSynthetic = false) {
  const e = r.envelope,
    p = e.period;
  if (
    (!allowSynthetic && e.origin !== 'real') ||
    !e.consent.statistics ||
    r.quarantined ||
    p.coverage !== 'complete' ||
    p.selection !== 'continuous' ||
    e.tasks.some(
      (t) =>
        !isTaskEnded(t) || !hasComparableTaskType(t) || !requirementHistoryComparisonAllowed(t),
    )
  )
    return false;
  if (
    e.tasks.some(
      (t) =>
        t.evaluation &&
        (t.evaluation.execution.agentCoverage !== 'complete' ||
          t.evaluation.execution.costScope !== 'lifecycle_complete'),
    )
  )
    return false;
  const allocation = allocate(e);
  return (
    p.allocation !== 'unallocated' && hasCompleteCostAttribution(p) && allocation.unallocated === 0
  );
}

export function observations(
  records: StoredRecord[],
  verifiedOnly = true,
  allowSynthetic = false,
): Observation[] {
  // Determine baseline candidates before evidence/view filters. A stable root
  // cannot represent two complete settlements just by changing its cohort.
  const settlement = settlementStates(records, { acceptedHeads: true });
  const unresolvedRoots = new Set(
    records.flatMap((r) =>
      ['unknown', 'conflict'].includes(settlement.get(r) ?? 'unknown')
        ? r.envelope.tasks.map((t) => canonical([r.owner, r.envelope.origin, t.id]))
        : settlement.get(r) === 'active' && !r.quarantined
          ? r.envelope.tasks
              .filter((t) => !requirementHistoryComparisonAllowed(t))
              .map((t) => canonical([r.owner, r.envelope.origin, t.id]))
          : [],
    ),
  );
  const baseline = records.flatMap((r) => {
    if (settlement.get(r) !== 'active') return [];
    if (
      r.envelope.tasks.some((t) =>
        unresolvedRoots.has(canonical([r.owner, r.envelope.origin, t.id])),
      )
    )
      return [];
    if (!baselineComparableRecord(r, allowSynthetic)) return [];
    const allocation = allocate(r.envelope);
    return [{ record: r, allocation }];
  });
  const candidates = [
    ...new Map(
      baseline.map((candidate) => [
        canonical([candidate.record.owner, candidate.record.id]),
        candidate,
      ]),
    ).values(),
  ];
  const first = new Map<string, StoredRecord>(),
    conflicts = new Set<StoredRecord>();
  for (const { record } of candidates)
    for (const task of record.envelope.tasks) {
      const key = canonical([record.owner, task.id]),
        previous = first.get(key);
      if (previous) {
        conflicts.add(previous);
        conflicts.add(record);
      } else first.set(key, record);
    }
  return candidates.flatMap(({ record: r, allocation }) => {
    const e = r.envelope,
      p = e.period,
      evidence = r.evidence;
    if (
      conflicts.has(r) ||
      (verifiedOnly &&
        (evidence.cost !== 'C2' || evidence.work !== 'W2' || evidence.coverage !== 'verified'))
    )
      return [];
    return e.tasks.map((task, i) => ({
      task,
      cost: allocation.costs[i]!, // baselineComparableRecord requires known, complete costs.
      period: p,
      owner: evidence.source ?? r.owner,
      evidence,
    }));
  });
}

export function summarize(rows: Observation[], publicSourceSupport = false): Metrics {
  if (!rows.length) throw new Error('汇总至少需要一条观测');
  const accepted = rows.filter((r) => r.task.status === 'accepted').length;
  const sources = new Map<string, { tasks: number; spend: number; accepted: number }>();
  for (const row of rows) {
    const source = sources.get(row.owner) ?? { tasks: 0, spend: 0, accepted: 0 };
    source.tasks++;
    source.spend += row.cost;
    if (row.task.status === 'accepted') source.accepted++;
    sources.set(row.owner, source);
  }
  const costs = rows.map((r) => r.cost);
  const spendMinor = costs.reduce((s, n) => s + n, 0);
  // Keep exact historical quantiles while sorting each cost distribution only once.
  costs.sort((a, b) => a - b);
  const sourceCosts = [...sources.values()].map((source) =>
    source.accepted ? source.spend / source.accepted : null,
  );
  const valid = sourceCosts.filter((x): x is number => x !== null);
  const inputKnown = rows.every((r) => r.task.models.every((m) => m.inputTokens !== null));
  const outputKnown = rows.every((r) => r.task.models.every((m) => m.outputTokens !== null));
  const cacheKnown = rows.every((r) => r.task.models.every((m) => m.cachedInputTokens !== null));
  const input = rows.reduce(
    (s, r) => s + r.task.models.reduce((n, m) => n + (m.inputTokens ?? 0), 0),
    0,
  );
  const cached = rows.reduce(
    (s, r) => s + r.task.models.reduce((n, m) => n + (m.cachedInputTokens ?? 0), 0),
    0,
  );
  const average = (get: (t: Task) => number | null) => {
    const values = rows.map((r) => get(r.task)).filter((n): n is number => n !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const timed = rows.map((r) => r.task.performance).filter((p) => p !== null);
  const outputTokens = timed.reduce((s, p) => s + (p.outputTokens ?? 0), 0);
  const outputMs = timed.reduce((s, p) => s + (p.outputDurationMs ?? 0), 0);
  const ttftCount = timed.reduce((s, p) => s + (p.ttftSamples ?? 0), 0);
  const events: Partial<Record<EventKind, number>> = {};
  rows.forEach((r) =>
    r.task.events?.forEach((e) => {
      events[e.kind] = (events[e.kind] ?? 0) + e.count;
    }),
  );
  return {
    count: rows.length,
    execution: Object.fromEntries(
      executionMetrics.map((key) => {
        const values = rows
          .map((r) => r.task.evaluation?.execution[key])
          .filter((n): n is number => n != null);
        return [
          key,
          {
            mean: values.length ? values.reduce((s, n) => s + n, 0) / values.length : null,
            samples: values.length,
          },
        ];
      }),
    ) as Metrics['execution'],
    resources: Object.fromEntries(
      resourceMetrics.map((key) => {
        const values = rows
          .map((r) => r.task.evaluation?.resources[key])
          .filter((n): n is number => n != null);
        return [
          key,
          {
            mean: values.length ? values.reduce((s, n) => s + n, 0) / values.length : null,
            samples: values.length,
          },
        ];
      }),
    ) as Metrics['resources'],
    sources: sources.size,
    accepted,
    spendMinor,
    costPerAccepted: accepted ? spendMinor / accepted : null,
    completion: accepted / rows.length,
    median: sortedQuantile(costs, 0.5),
    p25: sortedQuantile(costs, 0.25),
    p75: sortedQuantile(costs, 0.75),
    retries: rows.reduce((s, r) => s + r.task.attempts - 1, 0) / rows.length,
    humanMinutes: average((t) => t.humanMinutes),
    humanSamples: rows.filter((r) => r.task.humanMinutes !== null).length,
    tokens:
      inputKnown && outputKnown
        ? rows.reduce(
            (s, r) => s + r.task.models.reduce((n, m) => n + m.inputTokens! + m.outputTokens!, 0),
            0,
          ) / rows.length
        : null,
    cacheRate: inputKnown && cacheKnown && input ? cached / input : null,
    rework: average((t) => t.reworkCount),
    revisions: average((t) => t.revisionCount),
    intentErrors: average((t) =>
      t.events ? (t.events.find((e) => e.kind === 'intent_misunderstood')?.count ?? 0) : null,
    ),
    events,
    eventSamples: rows.filter((r) => r.task.events !== null).length,
    outputTps: outputMs ? (outputTokens / outputMs) * 1000 : null,
    ttftMs: ttftCount ? timed.reduce((s, p) => s + (p.ttftSumMs ?? 0), 0) / ttftCount : null,
    ttftTaskSamples: timed.filter((p) => (p.ttftSamples ?? 0) > 0).length,
    wallMinutes: average((t) =>
      t.performance?.wallMs != null ? t.performance.wallMs / 60000 : null,
    ),
    wallSamples: timed.filter((p) => p.wallMs !== null).length,
    modelMinutes: average((t) =>
      t.performance?.modelWallMs != null ? t.performance.modelWallMs / 60000 : null,
    ),
    toolMinutes: average((t) =>
      t.performance?.toolWallMs != null ? t.performance.toolWallMs / 60000 : null,
    ),
    queueSeconds: average((t) =>
      t.performance?.queueMs != null ? t.performance.queueMs / 1000 : null,
    ),
    speedSamples: timed.filter((p) => (p.outputDurationMs ?? 0) > 0).length,
    reworkSamples: rows.filter((r) => r.task.reworkCount !== null).length,
    revisionSamples: rows.filter((r) => r.task.revisionCount !== null).length,
    sourceBalancedCost:
      valid.length === sourceCosts.length && valid.length
        ? valid.reduce((a, b) => a + b, 0) / valid.length
        : null,
    sourceRange:
      valid.length === sourceCosts.length && valid.length
        ? [
            valid.reduce((lowest, value) => Math.min(lowest, value), Infinity),
            valid.reduce((highest, value) => Math.max(highest, value), -Infinity),
          ]
        : null,
    sourceSupport: summarizeSourceSupport([...sources.values()], publicSourceSupport),
  };
}

export function comparisons(
  records: StoredRecord[],
  verifiedOnly = true,
  allowSynthetic = false,
): Comparison[] {
  const groups = new Map<string, Observation[]>();
  for (const row of observations(records, verifiedOnly, allowSynthetic)) {
    // Evidence categories never mix. Fixed public cells make query differencing harder.
    const key = canonical({
      ...cohort(row.task, row.period),
      costEvidence: row.evidence.cost,
      workEvidence: row.evidence.work,
      coverageEvidence: row.evidence.coverage,
    });
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const published: Comparison[] = [];
  for (const [key, rows] of groups) {
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(r.owner, (counts.get(r.owner) ?? 0) + 1));
    if (
      rows.length < MIN_TASKS ||
      counts.size < MIN_SOURCES ||
      [...counts.values()].reduce((largest, count) => Math.max(largest, count), 0) / rows.length >
        MAX_SOURCE_SHARE
    )
      continue;
    const first = rows[0];
    published.push({
      id: key,
      cohort: cohort(first.task, first.period),
      modelIds: first.task.models.map((m) => m.model).sort(),
      evidence: { ...first.evidence, source: null, issuer: null },
      metrics: publicMetrics(rows),
    });
  }
  return published.sort(
    (a, b) => (a.metrics.costPerAccepted ?? Infinity) - (b.metrics.costPerAccepted ?? Infinity),
  );
}

function sufficientMetric(rows: Observation[], measured: (t: Task) => boolean) {
  let present = 0;
  const sources = new Map<string, number>();
  let largest = 0;
  for (const row of rows) {
    if (!measured(row.task)) continue;
    present++;
    const count = (sources.get(row.owner) ?? 0) + 1;
    sources.set(row.owner, count);
    largest = Math.max(largest, count);
  }
  return (
    present >= MIN_TASKS && sources.size >= MIN_SOURCES && largest / present <= MAX_SOURCE_SHARE
  );
}

// A large task group must not expose a measurement supplied by only one participant.
function publicMetrics(rows: Observation[]): Metrics {
  const metrics = summarize(rows, true);
  for (const key of executionMetrics)
    if (!sufficientMetric(rows, (t) => t.evaluation?.execution[key] != null))
      metrics.execution[key] = { mean: null, samples: 0 };
  for (const key of resourceMetrics)
    if (!sufficientMetric(rows, (t) => t.evaluation?.resources[key] != null))
      metrics.resources[key] = { mean: null, samples: 0 };
  if (!sufficientMetric(rows, (t) => t.humanMinutes !== null)) metrics.humanMinutes = null;
  if (!sufficientMetric(rows, (t) => t.reworkCount !== null)) metrics.rework = null;
  if (!sufficientMetric(rows, (t) => t.revisionCount !== null)) metrics.revisions = null;
  if (!sufficientMetric(rows, (t) => t.events !== null)) {
    metrics.events = {};
    metrics.intentErrors = null;
  }
  if (!sufficientMetric(rows, (t) => (t.performance?.outputDurationMs ?? 0) > 0))
    metrics.outputTps = null;
  if (!sufficientMetric(rows, (t) => (t.performance?.ttftSamples ?? 0) > 0)) metrics.ttftMs = null;
  for (const [field, measurement] of [
    ['wallMinutes', 'wallMs'],
    ['modelMinutes', 'modelWallMs'],
    ['toolMinutes', 'toolWallMs'],
    ['queueSeconds', 'queueMs'],
  ] as const) {
    if (!sufficientMetric(rows, (t) => t.performance?.[measurement] != null)) metrics[field] = null;
  }
  return metrics;
}

export type RecommendationOptions = {
  budget: number;
  tasks: number;
  minCompletion?: number;
  maxHuman?: number;
};
export const recommendationExclusionLabels = {
  invalid_constraint: '预算、目标数量或人工上限无效',
  model_identity_missing: '模型身份未完整记录',
  workload_unknown: '任务分类或工作量信息不完整',
  zero_acceptance: '尚无验收结果',
  cost_unknown: '费用未完整记录',
  human_unknown: '启用人工上限，但人工测量不完整',
  human_limit: '人工投入超过所设上限',
  budget_limit: '历史点估算超过预算',
} as const;
export type RecommendationExclusion = keyof typeof recommendationExclusionLabels;

// Reasons are mutually exclusive in this order. Missing human measurements are
// excluded only when the user actually enables that constraint.
export function recommendationWithDiagnostics(rows: Comparison[], opts: RecommendationOptions) {
  const excluded: Partial<Record<RecommendationExclusion, number>> = {};
  const validOptions =
    Number.isFinite(opts.budget) &&
    opts.budget >= 0 &&
    Number.isSafeInteger(opts.tasks) &&
    opts.tasks > 0 &&
    (opts.maxHuman === undefined || (Number.isFinite(opts.maxHuman) && opts.maxHuman >= 0));
  const decide = (r: Comparison): RecommendationExclusion | null => {
    if (!validOptions) return 'invalid_constraint';
    if (!isModelIdentity(r.cohort.modelIdentity)) return 'model_identity_missing';
    if (!workloadComparisonEligibility(r.cohort).eligible) return 'workload_unknown';
    if (!hasComparableCostAttribution(r.cohort)) return 'cost_unknown';
    if (r.metrics.accepted <= 0 || r.metrics.completion <= 0) return 'zero_acceptance';
    const cost = r.metrics.costPerAccepted;
    if (cost === null || !Number.isFinite(cost) || cost < 0) return 'cost_unknown';
    if (opts.maxHuman !== undefined) {
      if (r.metrics.humanMinutes === null || r.metrics.humanSamples !== r.metrics.count)
        return 'human_unknown';
      if (r.metrics.humanMinutes / r.metrics.completion > opts.maxHuman) return 'human_limit';
    }
    return cost * opts.tasks > opts.budget || !Number.isFinite(cost * opts.tasks)
      ? 'budget_limit'
      : null;
  };
  const candidates = rows
    .filter((r) => {
      const reason = decide(r);
      if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
      return reason === null;
    })
    .map((r) => ({
      ...r,
      projected: r.metrics.costPerAccepted! * opts.tasks,
      projectedLow: r.metrics.sourceRange == null ? null : r.metrics.sourceRange[0] * opts.tasks,
      projectedHigh: r.metrics.sourceRange == null ? null : r.metrics.sourceRange[1] * opts.tasks,
    }))
    .sort((a, b) => a.projected - b.projected || a.id.localeCompare(b.id));
  return {
    rows: candidates,
    total: rows.length,
    eligible: candidates.length,
    excluded,
    budgetBasis: 'historical_point_estimate' as const,
  };
}

export function recommendation(rows: Comparison[], opts: RecommendationOptions) {
  return recommendationWithDiagnostics(rows, opts).rows;
}
