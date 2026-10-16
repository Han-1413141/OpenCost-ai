import { taskDomain, taskUnits, taskInputUnits, type Envelope, type Task } from './schema.js';
import type { StoredRecord } from './analysis.js';

function uuid(n: number) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
const modelSpecs = [
  ['deepseek', 'deepseek-v3.2', 43, 78],
  ['qwen', 'qwen3-coder', 59, 95],
  ['moonshot', 'kimi-k2', 74, 65],
  ['zai', 'glm-4.5', 86, 83],
  ['openai', 'gpt-5', 201, 58],
  ['anthropic', 'claude-sonnet-4-5', 279, 71],
] as const;

export function demoTask(n = 1, spec: (typeof modelSpecs)[number] = modelSpecs[0]): Task {
  const [provider, model, price, speed] = spec;
  const tokens = 14000 + (n % 7) * 1800;
  const retry = n % 5 === 0 ? 2 : n % 3 === 0 ? 1 : 0;
  const accepted = n % (model === 'gpt-5' || model === 'claude-sonnet-4-5' ? 17 : 10) !== 0;
  const outputTokens = 1900 + (n % 9) * 240;
  const wallMinutes = 6 + (n % 12);
  return {
    id: uuid(n),
    kind: 'bugfix',
    scope: 'module',
    context: 'existing',
    acceptance: 'both',
    acceptanceTotal: 3,
    acceptancePassed: accepted ? 3 : 1,
    dependencies: '1',
    requirementsLocked: true,
    workload: {
      unit: 'code_change',
      inputUnits: '2-5',
      outputUnits: '2-5',
      constraintCount: '1-3',
      verification: 'mixed',
      inputSize: { unit: 'source_lines', band: 'medium' },
    },
    status: accepted ? 'accepted' : 'failed',
    attempts: 1 + retry,
    humanMinutes: 2 + (n % 7),
    reworkCount: retry,
    revisionCount: n % 3,
    events: [
      ...(n % 9 === 0
        ? [{ kind: 'intent_misunderstood' as const, count: 1, attribution: 'model' as const }]
        : []),
      ...(retry
        ? [{ kind: 'test_failure' as const, count: retry, attribution: 'unknown' as const }]
        : []),
      ...(n % 13 === 0
        ? [{ kind: 'tool_failure' as const, count: 1, attribution: 'harness' as const }]
        : []),
    ],
    performance: {
      wallMs: wallMinutes * 60000,
      modelWallMs: wallMinutes * 28000,
      toolWallMs: 35000 + (n % 3) * 10000,
      queueMs: 1200,
      ttftSumMs: 1800 + (n % 5) * 200,
      ttftSamples: 2,
      outputTokens,
      outputDurationMs: Math.round((outputTokens / speed) * 1000),
    },
    directCostMinor: Math.round(price * (0.8 + (n % 7) * 0.11)),
    harness: {
      id: 'opencode',
      version: 'demo',
      mode: 'agent',
      tools: 'standard',
      reasoning: 'high',
      cache: 'on',
    },
    models: [
      {
        provider,
        model,
        version: 'demo',
        inputTokens: tokens,
        cachedInputTokens: Math.floor(tokens * 0.62),
        outputTokens,
        reasoningTokens: 0,
        apiEquivalentMinor: Math.round(price * 1.2),
        priceVersion: 'synthetic-2026-10',
      },
    ],
    changeSize: '51-200',
  };
}

export function sampleEnvelope(): Envelope {
  const tasks = Array.from({ length: 4 }, (_, i) => demoTask(i + 1));
  return {
    schemaVersion: '1.0',
    origin: 'synthetic',
    period: {
      id: uuid(900000),
      month: '2026-10',
      currency: 'CNY',
      plan: 'pay-as-you-go',
      planVersion: 'demo',
      billing: 'api',
      payment: 'regular',
      paidMinor: tasks.reduce((s, t) => s + t.directCostMinor, 0),
      refundMinor: 0,
      allocation: 'direct',
      unassignedWeight: 0,
      coverage: 'complete',
      selection: 'continuous',
    },
    tasks,
    quota: [],
    collector: null,
    consent: { version: 'opencost-1.0', store: false, statistics: false, publicSummary: false },
  };
}

let cached: StoredRecord[] | undefined;
export function demoRecords(): StoredRecord[] {
  if (cached) return cached;
  const records: StoredRecord[] = [];
  let seq = 100;
  const make = (
    modelIndex: number,
    month: string,
    kind: Task['kind'],
    harness: string,
    plan: string | null,
    sourceCount = 8,
    tasksPerSource = 8,
  ) => {
    for (let owner = 0; owner < sourceCount; owner++) {
      const tasks = Array.from({ length: tasksPerSource }, () => {
        const t = demoTask(++seq, modelSpecs[modelIndex]);
        t.kind = kind;
        t.workload!.unit = taskUnits[kind];
        t.workload!.inputSize = { unit: taskInputUnits[kind], band: 'medium' };
        if (taskDomain(kind) !== 'software') {
          t.scope = 'collection';
          t.changeSize = null;
          t.events =
            t.events?.map((event) =>
              event.kind === 'test_failure' ? { ...event, kind: 'review_rejected' } : event,
            ) ?? null;
        }
        t.harness.id = harness;
        const historyFactor = 1 + (10 - Number(month.slice(-2))) * 0.055;
        t.directCostMinor = Math.round(
          t.directCostMinor *
            historyFactor *
            (harness === 'dsh' ? 0.93 : harness === 'aider' ? 1.19 : 1) *
            (kind === 'feature' ? 2 : kind === 'test' ? 0.72 : 1),
        );
        return t;
      });
      const paid = tasks.reduce((s, t) => s + t.directCostMinor, 0);
      const e: Envelope = {
        ...sampleEnvelope(),
        origin: 'synthetic',
        tasks,
        period: {
          ...sampleEnvelope().period,
          id: uuid(++seq + 100000),
          month,
          plan: plan ?? 'pay-as-you-go',
          paidMinor: plan ? Math.round(paid * 0.76) : paid,
          billing: plan ? 'subscription' : 'api',
          allocation: plan ? 'tokens' : 'direct',
        },
        quota: plan
          ? [
              {
                window: 'fixed',
                windowHours: 720,
                usedPercent: 12 + owner,
                tokens: tasks.reduce(
                  (s, t) => s + t.models[0].inputTokens! + t.models[0].outputTokens!,
                  0,
                ),
                apiEquivalentMinor: tasks.reduce(
                  (sum, t) => sum + t.models[0].apiEquivalentMinor!,
                  0,
                ),
                isolated: true,
                resetOccurred: false,
                exact: true,
              },
            ]
          : [],
        consent: { version: 'opencost-1.0', store: true, statistics: true, publicSummary: false },
      };
      if (plan)
        tasks.forEach((t) => {
          t.directCostMinor = 0;
        });
      records.push({
        id: `demo-${seq}`,
        owner: `demo-source-${owner}`,
        envelope: e,
        evidence: {
          cost: 'C2',
          work: 'W2',
          coverage: 'verified',
          issuer: 'synthetic',
          source: `demo-source-${owner}`,
          quota: 'Q2',
        },
        createdAt: `${month}-10T00:00:00Z`,
        quarantined: false,
      });
    }
  };
  for (const month of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    for (const kind of ['bugfix', 'feature', 'test'] as const) {
      modelSpecs.forEach((_, i) => make(i, month, kind, 'opencode', null));
      make(0, month, kind, 'dsh', null);
      make(0, month, kind, 'aider', null);
    }
    make(1, month, 'bugfix', 'opencode', 'sample-coder-plan');
    make(2, month, 'bugfix', 'opencode', 'sample-code-plan');
    make(3, month, 'bugfix', 'opencode', 'sample-coding-plan');
  }
  for (const month of ['2026-09', '2026-10']) {
    for (const kind of [
      'writing_edit',
      'research_synthesis',
      'data_analysis',
      'visual_design',
      'office_workflow',
      'content_operation',
      'learning_material',
    ] as const) {
      for (const modelIndex of [0, 1, 2]) make(modelIndex, month, kind, 'opencode', null, 5, 4);
    }
  }
  return (cached = records);
}
