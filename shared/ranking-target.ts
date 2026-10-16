import { z } from 'zod';
import { canonical, domainLabels, labels } from './schema.js';
import type { Comparison } from './analysis.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const publicId = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,71}$/);
const methods = z.array(z.enum(['direct', 'equal', 'tokens', 'unallocated'])).max(4);
export const BoardScopeSchema = z
  .object({
    domain: z.enum(
      Object.keys(domainLabels) as [keyof typeof domainLabels, ...(keyof typeof domainLabels)[]],
    ),
    currency: z.enum(['CNY', 'USD', 'EUR']),
    billing: z.enum(['api', 'subscription', 'mixed']),
    allocation: z.enum(['direct', 'equal', 'tokens', 'unallocated', 'itemized']),
    costAttributionPolicy: z
      .object({ version: z.literal('cost-attribution-1'), methods, periodMethods: methods })
      .strict()
      .nullable(),
    payment: z.enum(['regular', 'promotion', 'trial', 'grant']),
    costCoverage: z.enum(['model_only', 'total_execution', 'unknown']),
    evaluationVersion: z.enum(['legacy', 'work-summary-1']),
    evidence: z
      .object({
        cost: z.enum(['C0', 'C1', 'C2']),
        work: z.enum(['W0', 'W1', 'W2']),
        coverage: z.enum(['declared', 'verified']),
      })
      .strict(),
  })
  .strict();
export type BoardScope = z.infer<typeof BoardScopeSchema>;
export function boardScope(row: {
  cohort: Comparison['cohort'];
  evidence: Comparison['evidence'];
}) {
  const c = row.cohort;
  return {
    domain: c.domain,
    currency: c.currency,
    billing: c.billing,
    allocation: c.allocation,
    costAttributionPolicy: c.costAttributionPolicy ?? null,
    payment: c.payment,
    costCoverage: c.costCoverage ?? 'unknown',
    evaluationVersion: c.evaluation?.version ?? 'legacy',
    evidence: { cost: row.evidence.cost, work: row.evidence.work, coverage: row.evidence.coverage },
  };
}
export function modelWorkCondition(row: {
  cohort: Comparison['cohort'];
  evidence: Comparison['evidence'];
}) {
  const {
    models,
    modelIdentity,
    harness,
    harnessVersion,
    harnessVariant,
    harnessSurface,
    plan,
    planVersion,
    mode,
    tools,
    reasoning,
    cache,
    harnessAttribution,
    ...conditions
  } = row.cohort;
  return canonical({
    ...conditions,
    costEvidence: row.evidence.cost,
    workEvidence: row.evidence.work,
    coverage: row.evidence.coverage,
  });
}
export function planWorkCondition(row: {
  cohort: Comparison['cohort'];
  evidence: Comparison['evidence'];
}) {
  const { plan, planVersion, models, modelIdentity, ...conditions } = row.cohort;
  return canonical({
    ...conditions,
    evidence: { cost: row.evidence.cost, work: row.evidence.work, coverage: row.evidence.coverage },
  });
}
const taskKind = z.enum(
  Object.keys(labels.kind) as [keyof typeof labels.kind, ...(keyof typeof labels.kind)[]],
);
const conditionKey = z
  .string()
  .min(2)
  .max(16384)
  .superRefine((key, ctx) => {
    try {
      const value = JSON.parse(key);
      if (
        !value ||
        Array.isArray(value) ||
        typeof value !== 'object' ||
        canonical(value) !== key ||
        !taskKind.safeParse(value.kind).success
      )
        throw new Error();
      // These keys are produced by the two common condition builders, never arbitrary text.
      const allowed = new Set([
        'harnessComposition',
        'evaluation',
        'costCoverage',
        'harnessAttribution',
        'month',
        'currency',
        'billing',
        'payment',
        'allocation',
        'costAttributionPolicy',
        'domain',
        'kind',
        'workType',
        'subjects',
        'componentTypes',
        'useContext',
        'classificationBasis',
        'scope',
        'context',
        'acceptance',
        'acceptanceBand',
        'dependencies',
        'requirementsLocked',
        'workloadUnit',
        'inputUnits',
        'outputUnits',
        'constraintCount',
        'verification',
        'inputSizeUnit',
        'inputSizeBand',
        'harness',
        'harnessVersion',
        'harnessVariant',
        'harnessSurface',
        'mode',
        'tools',
        'reasoning',
        'cache',
        'costEvidence',
        'workEvidence',
        'coverage',
        'evidence',
      ]);
      if (Object.keys(value).some((k) => !allowed.has(k))) throw new Error();
    } catch {
      ctx.addIssue({ code: 'custom', message: '任务条件必须为共同条件函数生成的规范 JSON' });
    }
  });
export const RankingTargetSchema = z
  .object({
    format: z.literal('ranking-target-1'),
    id: hash,
    name: publicId,
    board: z.enum(['models', 'plans']),
    kind: taskKind.nullable(),
    scope: BoardScopeSchema,
    month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    conditionVersion: z.literal('work-condition-1'),
    method: z.literal('equal-task-attempt-mix-v1'),
    weighting: z.literal('equal-task-types-then-equal-conditions'),
    publishedAt: z.string().datetime(),
    selectionCutoff: z.string().datetime(),
    sourceDigest: hash,
    source: z.literal('public-community-snapshot'),
    cells: z
      .array(
        z
          .object({ id: hash, key: conditionKey, weight: z.number().finite().positive().max(1) })
          .strict(),
      )
      .min(1)
      .max(256),
  })
  .strict()
  .superRefine((t, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (t.board === 'plans' && t.kind !== null) fail('套餐目标不使用任务类型子榜字段');
    if (Date.parse(t.selectionCutoff) > Date.parse(t.publishedAt))
      fail('目标选择截止时间不能晚于发布时间');
    if (
      new Set(t.cells.map((c) => c.key)).size !== t.cells.length ||
      new Set(t.cells.map((c) => c.id)).size !== t.cells.length
    )
      fail('目标条件和标识不能重复');
    const counts = new Map<string, number>();
    for (const cell of t.cells) {
      let c: any;
      try {
        c = JSON.parse(cell.key);
      } catch {
        continue;
      }
      counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
      const e =
        t.board === 'models'
          ? { cost: c.costEvidence, work: c.workEvidence, coverage: c.coverage }
          : c.evidence;
      if (
        c.month !== t.month ||
        (t.kind !== null && c.kind !== t.kind) ||
        ['domain', 'currency', 'billing', 'allocation', 'payment', 'costCoverage'].some(
          (k) => c[k] !== (t.scope as any)[k],
        ) ||
        (c.evaluation?.version ?? 'legacy') !== t.scope.evaluationVersion ||
        canonical(c.costAttributionPolicy ?? null) !== canonical(t.scope.costAttributionPolicy) ||
        canonical(e) !== canonical(t.scope.evidence)
      )
        fail('目标条件与适用范围不一致');
    }
    for (const cell of t.cells) {
      let c: any;
      try {
        c = JSON.parse(cell.key);
      } catch {
        continue;
      }
      const expected = 1 / (counts.size * (counts.get(c.kind) ?? 1));
      if (Math.abs(cell.weight - expected) > 1e-12)
        fail('目标权重必须符合已发布的等任务类型、等条件规则');
    }
  });
export type RankingTarget = z.infer<typeof RankingTargetSchema>;
export type RankingExpansionBudget = { remainingCells: number; remainingBytes: number };
export const rankingExpansionBudget = (): RankingExpansionBudget => ({
  remainingCells: 8192,
  remainingBytes: 8 * 1024 * 1024,
});
// Check before constructing a candidate-by-target matrix. All fixed boards in
// one response share this budget; never shrink the target to fit the budget.
export function reserveTargetExpansion(
  target: RankingTarget | undefined,
  candidates: number,
  budget = rankingExpansionBudget(),
) {
  if (!target) return true;
  const cells = target.cells.length * candidates;
  const bytes = target.cells.reduce((n, c) => n + c.key.length * 3 + 2048, 0) * candidates;
  if (cells > budget.remainingCells || bytes > budget.remainingBytes) return false;
  budget.remainingCells -= cells;
  budget.remainingBytes -= bytes;
  return true;
}
export const targetSlot = (t: Pick<RankingTarget, 'board' | 'kind' | 'scope'>) =>
  canonical([t.board, t.kind, t.scope]);

/** Fixed targets retain their weights even when a candidate or public cell disappears. */
export function targetConditions(common: string[], target?: RankingTarget) {
  if (target) return target.cells.map((c) => ({ ...c }));
  const counts = new Map<string, number>();
  for (const key of common) {
    const kind = JSON.parse(key).kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return common.map((key) => ({
    id: null,
    key,
    weight: 1 / (counts.size * (counts.get(JSON.parse(key).kind) ?? 1)),
  }));
}
export function rankingTargetSummary(
  cells: ReturnType<typeof targetConditions>,
  available: Set<string>,
  target?: RankingTarget,
  requested = false,
) {
  const observed = cells.filter((c) => available.has(c.key)).length;
  const targetKeys = new Set(cells.map((c) => c.key));
  return {
    mode: target ? ('fixed' as const) : requested ? ('requested' as const) : ('temporary' as const),
    id: target?.id ?? null,
    name: target?.name ?? null,
    publishedAt: target?.publishedAt ?? null,
    selectionCutoff: target?.selectionCutoff ?? null,
    sourceDigest: target?.sourceDigest ?? null,
    conditionVersion: 'work-condition-1' as const,
    requiredConditions: cells.length,
    observedConditions: observed,
    unavailableConditions: cells.length - observed,
    outsideTargetConditions: [...available].filter((key) => !targetKeys.has(key)).length,
    // Keys from an unavailable historical cell must never be copied into public results.
    conditions: cells.map((c) => ({ id: c.id, weight: c.weight, available: available.has(c.key) })),
  };
}
