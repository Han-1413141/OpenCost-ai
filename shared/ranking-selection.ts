import { z } from 'zod';
import { canonical, publicId, MIN_TASKS, MIN_SOURCES, MAX_SOURCE_SHARE } from './schema.js';
import type { Comparison } from './analysis.js';
import { isModelIdentity, modelIdentityKey, type ModelIdentity } from './model-identity.js';
import { RankingTargetSchema, modelWorkCondition } from './ranking-target.js';
import { rankModels, rankingConfiguration, modelRankingEligible } from './ranking.js';

export const RANKING_SELECTION_VERSION = 'ranking-selection-1';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.custom<ModelIdentity>(isModelIdentity).refine((v) => v.members.length === 1);
export const RankingConfigurationSchema = z
  .object({
    harness: publicId,
    harnessVersion: publicId,
    harnessVariant: publicId.nullable(),
    harnessSurface: z.enum(['cli', 'desktop', 'ide', 'web', 'api', 'custom', 'unknown']),
    plan: publicId,
    planVersion: publicId,
    mode: z.enum(['agent', 'assisted']),
    tools: z.enum(['standard', 'extended']),
    reasoning: z.enum(['low', 'medium', 'high', 'auto']),
    cache: z.enum(['on', 'off', 'mixed']),
  })
  .strict();
export const RankingSelectionSchema = z
  .object({
    format: z.literal(RANKING_SELECTION_VERSION),
    id: hash,
    studyId: z.string().uuid(),
    target: RankingTargetSchema,
    dataVersion: z.string().min(1).max(1024),
    splitDigest: hash,
    preparedAt: z.string().datetime(),
    design: z.literal('retrospective_source_component_holdout'),
    supportUnit: z.literal('connected_owner_and_confirmed_source'),
    denominator: z.literal('ended_independent_root_targets'),
    models: z
      .array(
        z
          .object({
            id: z.string().min(1).max(1024),
            identity,
            selectionCost: z.number().finite().nonnegative().nullable(),
            cells: z
              .array(
                z
                  .object({
                    conditionId: hash,
                    configuration: RankingConfigurationSchema.nullable(),
                  })
                  .strict(),
              )
              .max(256),
          })
          .strict(),
      )
      .max(128),
    primaryWinnerModelIds: z.array(z.string().min(1).max(1024)).max(128),
  })
  .strict()
  .superRefine((d, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (d.target.board !== 'models') fail('模型选择不能使用套餐目标');
    if (d.models.reduce((n, m) => n + m.cells.length, 0) > 8192) fail('固定选择超过展开容量');
    const keys = new Set(d.target.cells.map((c) => c.id)),
      models = new Set(d.models.map((m) => m.id));
    if (models.size !== d.models.length) fail('选择模型不能重复');
    for (const m of d.models) {
      if (modelIdentityKey(m.identity) !== m.id) fail('模型身份与选择标识不一致');
      if (
        m.cells.length !== keys.size ||
        new Set(m.cells.map((c) => c.conditionId)).size !== keys.size ||
        m.cells.some((c) => !keys.has(c.conditionId))
      )
        fail('每个模型必须保留完整目标范围');
      if (m.cells.some((c) => c.configuration === null) !== (m.selectionCost === null))
        fail('完整选择费用必须与完整配置覆盖一致');
    }
    if (
      new Set(d.primaryWinnerModelIds).size !== d.primaryWinnerModelIds.length ||
      d.primaryWinnerModelIds.some((id) => !models.has(id))
    )
      fail('主选择模型必须来自冻结候选');
    const eligible = d.models.filter((m) => m.selectionCost !== null),
      best = eligible.reduce((v, m) => Math.min(v, m.selectionCost!), Infinity);
    const winners =
      eligible.length < 2
        ? []
        : eligible
            .filter((m) => m.selectionCost === best)
            .map((m) => m.id)
            .sort();
    if (canonical([...d.primaryWinnerModelIds].sort()) !== canonical(winners))
      fail('主选择必须保留选择集最低模型及并列');
  });
export type RankingSelection = z.infer<typeof RankingSelectionSchema>;

/** Each partition must pass disclosure using connected groups, not original sources. */
export function rankingStudySupported(row: Comparison) {
  const m = row.metrics,
    s = m.sourceSupport;
  return (
    Number.isSafeInteger(m.count) &&
    m.count >= MIN_TASKS &&
    Number.isSafeInteger(m.accepted) &&
    m.accepted >= 0 &&
    m.accepted <= m.count &&
    Number.isSafeInteger(m.spendMinor) &&
    m.spendMinor >= 0 &&
    Number.isSafeInteger(m.sources) &&
    m.sources >= MIN_SOURCES &&
    !!s &&
    s.sources === m.sources &&
    Number.isFinite(s.maxTaskShare) &&
    s.maxTaskShare >= 0 &&
    s.maxTaskShare <= MAX_SOURCE_SHARE
  );
}

export function freezeRankingSelection(
  rows: Comparison[],
  input: Pick<
    RankingSelection,
    'id' | 'studyId' | 'target' | 'dataVersion' | 'splitDigest' | 'preparedAt'
  >,
): RankingSelection {
  if (rows.length > 10000) throw new Error('选择集超过容量，不能截断后选择。');
  const target = RankingTargetSchema.parse(input.target);
  if (target.board !== 'models') throw new Error('请选择模型榜目标。');
  const ranked = rankModels(rows.filter(rankingStudySupported), 0.9, { target });
  if (ranked.capacityExceeded) throw new Error('选择集与目标展开超过容量。');
  const models = ranked.rows.map((m) => ({
    id: m.id,
    identity: m.modelIdentity,
    selectionCost: m.qualified ? m.cost : null,
    cells: m.selections.map((c) => ({
      conditionId: c.targetConditionId!,
      configuration: c.configuration,
    })),
  }));
  const best = ranked.comparable ? ranked.rows.find((m) => m.qualified)?.cost : null;
  return RankingSelectionSchema.parse({
    ...input,
    target,
    format: RANKING_SELECTION_VERSION,
    design: 'retrospective_source_component_holdout',
    supportUnit: 'connected_owner_and_confirmed_source',
    denominator: 'ended_independent_root_targets',
    models,
    primaryWinnerModelIds:
      best === null || best === undefined
        ? []
        : models.filter((m) => m.selectionCost === best).map((m) => m.id),
  });
}

/** No selector runs here. Zero-acceptance cells retain their spend and weight. */
export function evaluateRankingSelection(input: unknown, evaluationRows: Comparison[]) {
  const definition = RankingSelectionSchema.parse(input);
  if (evaluationRows.length > 10000) throw new Error('评价集超过容量，不能截断评价。');
  const index = new Map<string, Comparison>(),
    duplicates = new Set<string>();
  const key = (model: string, condition: string, config: unknown) =>
    canonical([model, condition, config]);
  const conditions = new Set(definition.target.cells.map((c) => c.key));
  for (const r of evaluationRows) {
    if (!modelRankingEligible(r)) continue;
    const condition = modelWorkCondition(r);
    if (!conditions.has(condition)) continue;
    const k = key(modelIdentityKey(r.cohort.modelIdentity)!, condition, rankingConfiguration(r));
    if (index.has(k)) duplicates.add(k);
    else index.set(k, r);
  }
  const models = definition.models.map((model) => {
    const selected = new Map(model.cells.map((c) => [c.conditionId, c.configuration]));
    const cells = definition.target.cells.map((c) => {
      const configuration = selected.get(c.id) ?? null;
      const k = configuration ? key(model.id, c.key, configuration) : null,
        r = k ? index.get(k) : undefined;
      const status = !configuration
        ? ('not_selected' as const)
        : k && duplicates.has(k)
          ? ('conflicting_aggregate' as const)
          : !r
            ? ('missing_public_support' as const)
            : !rankingStudySupported(r)
              ? ('invalid_or_insufficient_support' as const)
              : ('measured' as const);
      return {
        conditionId: c.id,
        weight: c.weight,
        configuration,
        status,
        count: status === 'measured' ? r!.metrics.count : null,
        accepted: status === 'measured' ? r!.metrics.accepted : null,
        spendMinor: status === 'measured' ? r!.metrics.spendMinor : null,
        groups: status === 'measured' ? r!.metrics.sources : null,
      };
    });
    const complete = cells.every((c) => c.status === 'measured');
    const weightTotal = cells.reduce((sum, c) => sum + c.weight, 0);
    const perRootSpend = complete
      ? cells.reduce((n, c) => n + (c.weight * c.spendMinor!) / c.count!, 0) / weightTotal
      : null;
    const acceptedPerRoot = complete
      ? Math.min(
          1,
          cells.reduce((n, c) => n + (c.weight * c.accepted!) / c.count!, 0) / weightTotal,
        )
      : null;
    if (
      (perRootSpend !== null && !Number.isFinite(perRootSpend)) ||
      (acceptedPerRoot !== null && !Number.isFinite(acceptedPerRoot))
    )
      throw new Error('评价数值超过计算范围。');
    return {
      id: model.id,
      identity: model.identity,
      primarySelection: definition.primaryWinnerModelIds.includes(model.id),
      selectionCost: model.selectionCost,
      cells,
      status: !complete
        ? ('incomplete' as const)
        : acceptedPerRoot === 0
          ? ('zero_acceptance' as const)
          : ('measured' as const),
      perRootSpend,
      acceptedPerRoot,
      costPerAccepted:
        perRootSpend !== null && acceptedPerRoot !== null && acceptedPerRoot > 0
          ? perRootSpend / acceptedPerRoot
          : null,
      targetCoverage: cells.filter((c) => c.status === 'measured').length / cells.length,
      targetWeightCoverage: cells.reduce((n, c) => n + (c.status === 'measured' ? c.weight : 0), 0),
    };
  });
  return {
    version: 'ranking-fixed-policy-evaluation-1' as const,
    selectionId: definition.id,
    studyId: definition.studyId,
    targetId: definition.target.id,
    dataVersion: definition.dataVersion,
    splitDigest: definition.splitDigest,
    inference: 'retrospective-held-out-known-groups' as const,
    denominator: definition.denominator,
    supportUnit: definition.supportUnit,
    primaryWinnerModelIds: definition.primaryWinnerModelIds,
    models,
    interval: 'not_estimated' as const,
    note: '评价固定选择集中的模型及配置；没有在评价集重新选赢家。费用分母是已结束独立根目标，包含失败，不是请求或重试数。已知关联组不证明真人独立，观察结果不保证未来费用或每项条件验收。',
  };
}
