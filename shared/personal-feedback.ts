import { z } from 'zod';
import { ModelTimelineSchema, combineModelTimelines } from './model-timeline.js';
import { QuotaPeerFeedbackSchema } from './quota-peer-feedback.js';
import { FeedbackTaskProfileSchema, feedbackTaskProfile } from './feedback-task-profile.js';
import { comparableEquivalentMinor } from './price-metering.js';
import { difficultyFramework } from './difficulty-framework.js';
import { FeedbackActivitySchema } from './feedback-activity.js';
import { PersonaHistorySchema, personaHistory } from './feedback-persona-history.js';
import { FeedbackToolboxSchema, contributionToolbox, journalToolbox } from './feedback-toolbox.js';
import {
  FeedbackNextStepsSchema,
  feedbackNextSteps,
  withFeedbackNextSteps,
} from './feedback-next-steps.js';
import { chargeReconciliationLines } from './charge-reconciliation.js';
import { costAttributionMethodsLabel } from './cost-attribution.js';
import {
  feedbackWorkKey as workKey,
  sameFeedbackConditions as sameWorkAndCostConditions,
  sameFeedbackEvidence as sameReferenceEvidence,
  selectFeedbackReferences,
  FeedbackReferenceIndex,
} from './feedback-reference-matching.js';
import {
  harnessCompositionLabel,
  isHarnessComposition,
  type HarnessComposition,
} from './harness-composition.js';
import { progressPhaseLabels } from './task-progress.js';
import { journalCoverage } from './journal-time.js';
import { JournalAnalysisFeedbackSchema } from './journal-analysis-schema.js';
import { analyzeCodeObservations } from './code-observation-insights.js';
import {
  TaskLifecycleSchema,
  lifecycleFromHistory,
  hasCompleteLifecycleCosts,
  type TaskLifecycle,
} from './task-lifecycle.js';
import { canonical, labels, workloadLabels, type Envelope } from './schema.js';
import {
  allocate,
  analyze,
  cohort,
  summarize,
  type Comparison,
  type StoredRecord,
} from './analysis.js';
import { summarizeWork, resourceMetrics } from './evaluation.js';
import { modelRankingEligible } from './ranking.js';
import { planRankingEligible, type PlanComparison } from './plans.js';
import type { DailySummary } from './desktop-summary.js';
import {
  workloadComparisonEligibility,
  workloadExclusionLabels,
} from './comparison-eligibility.js';
import { workClassificationLabel } from './work-labels.js';
import { isModelIdentity, modelIdentityKey, type ModelIdentity } from './model-identity.js';
import { SourceSupportSchema } from './source-support.js';
import { TaskInsightsSchema, analyzeTaskInsights, taskInsightUnitLabels } from './task-insights.js';
import { codeObservationInsightLines } from './code-observation-insights.js';
import { feedbackPublicStudyLines } from './feedback-public-studies-text.js';
import {
  FeedbackPublicStudySchema,
  limitFeedbackStudyEvidence,
  type FeedbackStudyLookup,
} from './feedback-public-studies.js';

export const legacyJournalCoverageNotice =
  '此历史反馈未包含日期、时区与采集区间的一致性检查；保留原计算值，其周/月覆盖不能视为已经通过当前规则核对。';
export const referenceExclusionNote = (snapshot: { exclusionPolicy?: string }) =>
  snapshot.exclusionPolicy === 'owner-and-confirmed-sources-1'
    ? '已在统计前排除本人的记录及当前可信证据确认的同源记录；未被证明关联的其他身份仍可能存在。'
    : '此历史参照按上传身份排除本人；尚未检查其他身份下的同源数据，原报告保留。';

const number = z.number().finite().nonnegative().nullable();
const text = z.string().max(1000);
const ReferenceSnapshotSchema = z
  .object({
    version: z.string().min(1).max(256),
    publishedAt: z.string().datetime(),
    excludesContributor: z.literal(true),
    exclusionPolicy: z.literal('owner-and-confirmed-sources-1').optional(),
  })
  .strict();
const RecommendationEvidenceSchema = z
  .object({
    taskCount: z.number().int().nonnegative().nullable(),
    acceptedCount: z.number().int().nonnegative(),
    sources: z.number().int().positive(),
    periods: z.number().int().positive().nullable(),
    completion: z.number().min(0).max(1),
    cost: z.enum(['C0', 'C1', 'C2']),
    work: z.enum(['W0', 'W1', 'W2']),
    coverage: z.enum(['declared', 'verified']),
    projectedRangeMinor: z
      .tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()])
      .refine(([low, high]) => low <= high)
      .nullable(),
    rangeBasis: z.enum(['source_cost_per_accepted', 'cycle_purchase_cost']),
    sourceSupport: SourceSupportSchema.optional(),
    candidateHarnesses: z.number().int().positive().optional(),
    selectionBasis: z.literal('observed_minimum').optional(),
    selectionUncertainty: z.literal('not_estimated').optional(),
  })
  .strict();
const referenceCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ReferenceCountsSchema = z
  .object({
    total: referenceCount,
    eligible: referenceCount,
    below: referenceCount,
    equal: referenceCount,
    above: referenceCount,
    excluded: referenceCount,
    excludedReasons: z
      .object({
        zeroAcceptance: referenceCount,
        measurementUnavailable: referenceCount,
        invalidValue: referenceCount,
      })
      .strict(),
  })
  .strict()
  .superRefine((counts, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (counts.below + counts.equal + counts.above !== counts.eligible)
      issue('低于、等于和高于本次数值的配置数必须合计为有效配置数');
    if (counts.eligible + counts.excluded !== counts.total)
      issue('有效与未计入的配置数必须合计为本组参照配置数');
    if (
      Object.values(counts.excludedReasons).reduce((sum, value) => sum + value, 0) !==
      counts.excluded
    )
      issue('未计入配置的互斥原因必须合计为未计入配置数');
  });
const ReferenceSchema = z
  .object({
    options: z.number().int().min(3),
    median: number,
    p25: number,
    p75: number,
    percentile: z.number().min(0).max(100),
    differencePercent: z.number().finite().nullable(),
    basis: z.literal('published_configurations'),
    month: z.string(),
    counts: ReferenceCountsSchema.optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.counts && reference.counts.eligible !== reference.options)
      context.addIssue({ code: 'custom', message: '有效配置数必须与该指标的参照分母一致' });
  });
const MetricSchema = z
  .object({
    id: z.string(),
    label: text,
    value: number,
    unit: z.string(),
    position: z.enum(['lower', 'typical', 'higher', 'unavailable']),
    reference: ReferenceSchema.nullable(),
    measurement: z
      .object({
        tasks: z.number().int().nonnegative().nullable(),
        totalTasks: z.number().int().positive(),
      })
      .strict()
      .optional(),
    note: text,
  })
  .strict();
export const PersonalFeedbackSchema = z
  .object({
    version: z.literal('personal-feedback-1'),
    visibility: z.literal('private'),
    kind: z.enum(['contribution', 'journal', 'subscription']),
    recordId: z.string().uuid(),
    generatedAt: z.string().datetime(),
    headline: text,
    nextSteps: FeedbackNextStepsSchema.optional(),
    referenceSnapshot: ReferenceSnapshotSchema.optional(),
    referenceUnavailable: z.enum(['preparing', 'capacity', 'busy', 'unavailable']).optional(),
    provisional: z.literal(true).optional(),
    lifecycle: TaskLifecycleSchema.optional(),
    modelTimeline: ModelTimelineSchema.optional(),
    analytics: TaskInsightsSchema.optional(),
    journalAnalysis: JournalAnalysisFeedbackSchema.optional(),
    taskProfile: FeedbackTaskProfileSchema.optional(),
    activity: FeedbackActivitySchema.optional(),
    personaHistory: PersonaHistorySchema.optional(),
    toolbox: FeedbackToolboxSchema.optional(),
    usageValue: z.object({
      currency: z.enum(['CNY', 'USD', 'EUR']),
      equivalentMinor: number,
      usageRecords: z.number().int().nonnegative(),
      pricedRecords: z.number().int().nonnegative(),
      priceVersions: z.array(z.string().max(100)).max(100),
    }).strict().optional(),
    comparisonCoverage: z
      .object({
        totalTasks: z.number().int().nonnegative(),
        reviewedTasks: z.number().int().nonnegative(),
        comparedTasks: z.number().int().nonnegative(),
        unreviewedTasks: z.number().int().nonnegative(),
        reasons: z
          .array(
            z
              .object({
                reason: z.enum([
                  'available',
                  'reference_unavailable',
                  'record_incomplete',
                  'workload_unknown',
                  'no_same_conditions',
                  'too_few_configurations',
                  'missing_measurements',
                ]),
                tasks: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .max(7),
        note: text,
      })
      .strict()
      .superRefine((coverage, ctx) => {
        const reasonTotal = coverage.reasons.reduce((total, item) => total + item.tasks, 0);
        const available = coverage.reasons.find((item) => item.reason === 'available')?.tasks ?? 0;
        if (
          coverage.reviewedTasks + coverage.unreviewedTasks !== coverage.totalTasks ||
          coverage.comparedTasks > coverage.reviewedTasks ||
          reasonTotal !== coverage.reviewedTasks ||
          available !== coverage.comparedTasks ||
          new Set(coverage.reasons.map((item) => item.reason)).size !== coverage.reasons.length
        )
          ctx.addIssue({ code: 'custom', message: '比较覆盖与原因任务数必须守恒' });
      })
      .optional(),
    sample: z
      .object({
        batches: z.number().int().nonnegative(),
        coveredDays: number,
        stage: z.enum(['single', 'short', 'weekly', 'monthly']),
        historyCoverage: z.enum(['complete', 'partial', 'unknown']).optional(),
        note: text,
        observationCutoff: z.string().datetime().nullable().optional(),
        currentRecordWindow: z
          .object({ startAt: z.string().datetime(), endAt: z.string().datetime() })
          .strict()
          .nullable()
          .optional(),
        journalCoverage: z
          .object({
            version: z.literal('journal-coverage-1'),
            currentWindow: z.enum([
              'valid',
              'invalid_day',
              'invalid_timezone',
              'invalid_interval',
              'day_mismatch',
            ]),
            timeZone: z.string().max(80).nullable(),
            inspectedRecords: referenceCount,
            eligibleRecords: referenceCount,
            coveredDays: referenceCount.nullable(),
            excluded: z
              .object({
                invalidWindow: referenceCount,
                differentTimeZone: referenceCount,
                outsidePeriod: referenceCount,
              })
              .strict(),
          })
          .strict()
          .refine(
            (value) =>
              value.eligibleRecords + Object.values(value.excluded).reduce((a, b) => a + b, 0) ===
              value.inspectedRecords,
            '日记覆盖检查的计入与排除记录数必须守恒',
          )
          .optional(),
      })
      .strict(),
    metrics: z.array(MetricSchema).max(40),
    work: z
      .array(
        z
          .object({
            label: text,
            unit: z.string(),
            completed: number,
            accepted: number,
            note: text,
          })
          .strict(),
      )
      .max(100),
    groups: z
      .array(
        z
          .object({
            label: text,
            tasks: z.number().int().nonnegative(),
            metrics: z.array(MetricSchema).max(24),
          })
          .strict(),
      )
      .max(24),
    recommendations: z
      .array(
        z
          .object({
            kind: z.enum(['model', 'plan']),
            work: text,
            model: text,
            modelIdentity: z.custom<ModelIdentity>(isModelIdentity).optional(),
            harness: text,
            harnessComposition: z.custom<HarnessComposition>(isHarnessComposition).optional(),
            plan: text.nullable(),
            currency: z.string(),
            unitCostMinor: number,
            projectedMinor: number,
            targetTasks: z.number().int().positive(),
            capacityP25: number,
            candidates: z.number().int().positive(),
            month: z.string(),
            note: text,
            evidence: RecommendationEvidenceSchema.optional(),
            publicStudyEvidence: FeedbackPublicStudySchema.optional(),
          })
          .strict(),
      )
      .max(72),
    quota: z
      .array(
        z
          .object({
            label: text,
            status: z.string(),
            capacityChange: z.number().finite().nullable(),
            changePercent: z.number().finite().nullable(),
            consumption: number,
            unit: z.string(),
            peers: QuotaPeerFeedbackSchema.optional(),
            current: z
              .object({
                capacityStatus: z.enum([
                  'finite',
                  'unlimited',
                  'dynamic',
                  'undisclosed',
                  'unknown',
                ]),
                total: number,
                used: number,
                remaining: number,
                currency: z.enum(['CNY', 'USD', 'EUR']).nullable(),
                usedPercent: z.number().min(0).max(100).nullable(),
                window: text,
                observedAt: z.string().datetime(),
                freshness: z.enum(['current', 'stale', 'unknown']),
                consistent: z.boolean(),
              })
              .strict()
              .optional(),
            note: text,
          })
          .strict(),
      )
      .max(100),
    notices: z.array(text).max(16),
  })
  .strict()
  .superRefine((report, ctx) => {
    for (const r of report.recommendations) {
      const study = r.publicStudyEvidence;
      if (!study) continue;
      if (r.kind !== 'model')
        ctx.addIssue({ code: 'custom', message: '模型留出观察不能附给套餐推荐' });
      if (
        study.status === 'available' &&
        (study.modelId !== modelIdentityKey(r.modelIdentity) ||
          study.currency !== r.currency ||
          study.month !== r.month)
      )
        ctx.addIssue({ code: 'custom', message: '附加公开观察与推荐身份、币种或月份不一致' });
    }
  });
export type PersonalFeedback = z.infer<typeof PersonalFeedbackSchema>;
export const referenceUnavailableNote = {
  preparing: '公开参照正在更新，暂不可用；本次用量仍可查看。',
  capacity: '公开统计的存储或计算容量不足，公开参照暂不可用；本次用量仍可查看。',
  busy: '公开参照服务繁忙，暂不可用；本次用量仍可查看。',
  unavailable: '读取公开参照失败，公开参照暂不可用；本次用量仍可查看。',
} satisfies Record<NonNullable<PersonalFeedback['referenceUnavailable']>, string>;
type Metric = PersonalFeedback['metrics'][number];
export function feedbackReferenceCountsText(reference: NonNullable<Metric['reference']>) {
  const counts = reference.counts;
  return counts
    ? `本组 ${counts.eligible} 个有效配置：${counts.below} 个数值低于本次，${counts.equal} 个相同，${counts.above} 个高于本次。`
    : `本组 ${reference.options} 个有效配置；历史报告未保存高低数量。`;
}
export function feedbackReferenceExclusionsText(reference: NonNullable<Metric['reference']>) {
  const counts = reference.counts;
  if (!counts) return '历史报告未保存该指标的配置排除数量，不据此反推。';
  if (!counts.excluded) return `同条件参照共 ${counts.total} 个配置，该指标全部计入。`;
  const reasons = [
    counts.excludedReasons.zeroAcceptance
      ? `${counts.excludedReasons.zeroAcceptance} 个零验收、无法计算验收单位指标`
      : null,
    counts.excludedReasons.measurementUnavailable
      ? `${counts.excludedReasons.measurementUnavailable} 个缺少完整可比测量`
      : null,
    counts.excludedReasons.invalidValue
      ? `${counts.excludedReasons.invalidValue} 个数值无效`
      : null,
  ].filter(Boolean);
  return `同条件参照共 ${counts.total} 个配置；该指标未计入 ${counts.excluded} 个：${reasons.join('；')}。`;
}
export type QuotaFeedback = PersonalFeedback['quota'][number];
const dayMs = 86400000;
const finite = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
const metric = (
  id: string,
  label: string,
  value: number | null,
  unit: string,
  note = '',
): Metric => ({
  id,
  label,
  value: finite(value),
  unit,
  position: 'unavailable',
  reference: null,
  note,
});
export const repeatNotice =
  '单次结果可能受任务差异、缓存、返工和活动价格影响。建议连续记录至少一周，最好一个月，再观察多次结果；更长时间也不能替代完整数据和独立验收。';

export type FeedbackSampleRecord = {
  id: string;
  quarantined: boolean;
  origin: Envelope['origin'];
  collectionWindow: Envelope['collectionWindow'];
  coverage: Envelope['period']['coverage'];
  selection: Envelope['period']['selection'];
};

export function feedbackSample(
  history: StoredRecord[],
  allowSynthetic = false,
  observationCutoff?: string,
): PersonalFeedback['sample'] {
  return feedbackSampleFromMetadata(
    history.map((r) => ({
      id: r.id,
      quarantined: r.quarantined,
      origin: r.envelope.origin,
      collectionWindow: r.envelope.collectionWindow,
      coverage: r.envelope.period.coverage,
      selection: r.envelope.period.selection,
    })),
    allowSynthetic,
    observationCutoff,
  );
}

export function feedbackSampleFromMetadata(
  history: FeedbackSampleRecord[],
  allowSynthetic = false,
  observationCutoff?: string,
): PersonalFeedback['sample'] {
  const eligibleHistory = history.filter(
    (r) => !r.quarantined && (r.origin === 'real' || allowSynthetic),
  );
  const ends = eligibleHistory.flatMap((r) =>
    r.collectionWindow ? [Date.parse(r.collectionWindow.endAt)] : [],
  );
  // A newly generated report for an old record must not borrow subsequent observations.
  const end = observationCutoff
    ? Date.parse(observationCutoff)
    : ends.length
      ? ends.reduce((latest, value) => Math.max(latest, value), -Infinity)
      : null;
  const recent = eligibleHistory.filter(
    (r) =>
      !r.quarantined &&
      (r.origin === 'real' || allowSynthetic) &&
      r.collectionWindow &&
      end !== null &&
      Date.parse(r.collectionWindow.endAt) <= end &&
      Date.parse(r.collectionWindow.endAt) > end - 30 * dayMs,
  );
  const batches = new Set(recent.map((r) => r.collectionWindow!.batch.id)).size;
  const completeBatches = new Set<string>();
  const byBatch = new Map<string, FeedbackSampleRecord[]>();
  for (const r of recent) {
    const key = r.collectionWindow!.batch.id;
    const batch = byBatch.get(key);
    if (batch) batch.push(r);
    else byBatch.set(key, [r]);
  }
  for (const [id, parts] of byBatch) {
    const first = parts[0].collectionWindow!;
    if (
      new Set(parts.map((r) => r.collectionWindow!.batch.part)).size === first.batch.total &&
      parts.every((r) => {
        const w = r.collectionWindow!;
        return (
          w.batch.total === first.batch.total &&
          w.startAt === first.startAt &&
          w.endAt === first.endAt &&
          r.coverage === 'complete' &&
          r.selection === 'continuous'
        );
      })
    )
      completeBatches.add(id);
  }
  const intervals = recent
    .filter((r) => completeBatches.has(r.collectionWindow!.batch.id))
    .map((r) => [
      Math.max(Date.parse(r.collectionWindow!.startAt), end! - 30 * dayMs),
      Math.min(end!, Date.parse(r.collectionWindow!.endAt)),
    ])
    .sort((a, b) => a[0] - b[0]);
  let duration = 0,
    through = -Infinity;
  for (const [start, stop] of intervals) {
    duration += Math.max(0, stop - Math.max(start, through));
    through = Math.max(through, stop);
  }
  const coveredDays = end === null ? null : Math.round((duration / dayMs) * 10) / 10;
  const stage =
    batches <= 1
      ? 'single'
      : coveredDays !== null && coveredDays >= 28 && completeBatches.size >= 4
        ? 'monthly'
        : coveredDays !== null && coveredDays >= 7 && completeBatches.size >= 3
          ? 'weekly'
          : 'short';
  return {
    batches,
    coveredDays,
    stage,
    observationCutoff: end === null ? null : new Date(end).toISOString(),
    note: `截至本次观察的最近 30 天内 ${batches} 次采集批次，${completeBatches.size} 次分片齐全${coveredDays === null ? '' : `，声明连续覆盖 ${coveredDays} 天`}。重试、同批分片不算新的测量；覆盖天数按区间合并，不把缺失分片、间隔天数或截止时间之后的观察算成完整记录。此处仅说明采集覆盖，不代表相同任务经过重复测量或结果已经稳定；下方投入与比较只属于本次记录。`,
  };
}
function crossBillingNote(candidate: Comparison['cohort'], own: Comparison['cohort']) {
  if (candidate.billing === own.billing) return '';
  return `本人采用${labels.billing[own.billing]}（${labels.allocation[own.allocation]}），此候选采用${labels.billing[candidate.billing]}（${labels.allocation[candidate.allocation]}）。跨计费方式只作相同工作条件下的方案参考，不用于本人成本百分位或直接推算节省比例。`;
}
function projectedRange(range: [number, number] | null, multiplier = 1): [number, number] | null {
  if (!range) return null;
  const low = finite(range[0] * multiplier),
    high = finite(range[1] * multiplier);
  return low === null || high === null ? null : [low, high];
}
function harnessDescription(c: Comparison['cohort']) {
  return [
    harnessCompositionLabel(c),
    c.harnessAttribution === 'mixed' ? '以下为主 Harness 设置' : null,
    c.harnessVariant ? `型号 ${c.harnessVariant}` : null,
    c.harnessSurface !== 'unknown' ? `环境 ${c.harnessSurface}` : null,
    `模式 ${c.mode}`,
    `工具 ${c.tools}`,
    `推理 ${c.reasoning}`,
    `缓存 ${c.cache}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
function latest<T extends { cohort: Comparison['cohort'] }>(rows: T[]) {
  const month = rows
    .map((r) => r.cohort.month)
    .sort()
    .at(-1);
  return rows.filter((r) => r.cohort.month === month);
}
function compare(m: Metric, peers: Comparison[], get: (r: Comparison) => number | null): Metric {
  const values: number[] = [];
  const excludedReasons = { zeroAcceptance: 0, measurementUnavailable: 0, invalidValue: 0 };
  const needsAcceptance = ['cost', 'tokens', 'human', 'wall', 'turns'].includes(m.id);
  for (const peer of peers) {
    const value = get(peer);
    if (value !== null && Number.isFinite(value) && value >= 0) values.push(value);
    else if (needsAcceptance && peer.metrics.accepted === 0) excludedReasons.zeroAcceptance++;
    else if (value === null) excludedReasons.measurementUnavailable++;
    else excludedReasons.invalidValue++;
  }
  if (m.value === null || values.length < 3)
    return { ...m, note: m.note || '可比公开方案或该项测量不足，暂不判断位置。' };
  // Same type-7 interpolation as analysis.quantile, sharing one sorted array.
  values.sort((a, b) => a - b);
  const quantile = (p: number) => {
    const position = (values.length - 1) * p,
      low = Math.floor(position);
    return values[low] + (values[Math.ceil(position)] - values[low]) * (position - low);
  };
  const median = quantile(0.5),
    p25 = quantile(0.25),
    p75 = quantile(0.75);
  const less = values.filter((v) => v < m.value!).length,
    equal = values.filter((v) => v === m.value).length;
  return {
    ...m,
    position: m.value < p25 ? 'lower' : m.value > p75 ? 'higher' : 'typical',
    reference: {
      options: values.length,
      median,
      p25,
      p75,
      percentile: Math.round(((less + equal / 2) / values.length) * 1000) / 10,
      differencePercent: median > 0 ? ((m.value - median) / median) * 100 : null,
      basis: 'published_configurations',
      month: peers[0].cohort.month,
      counts: {
        total: peers.length,
        eligible: values.length,
        below: less,
        equal,
        above: values.length - less - equal,
        excluded: peers.length - values.length,
        excludedReasons,
      },
    },
    note: '仅描述这组相同工作条件的公开配置；配置数量不是独立样本量，数值位置不是用户排名，不表示差异已被统计确认、任务难度相同或未来表现。',
  };
}

export function contributionFeedback(
  record: StoredRecord,
  options: {
    history: StoredRecord[];
    lifecycle?: TaskLifecycle;
    sample?: PersonalFeedback['sample'];
    references: Comparison[];
    plans: PlanComparison[];
    quota?: QuotaFeedback[];
    allowSynthetic?: boolean;
    referenceEvidence?: 'verified' | 'recorded';
    referenceSnapshot?: PersonalFeedback['referenceSnapshot'];
    referenceUnavailable?: PersonalFeedback['referenceUnavailable'];
    lookupPublicStudy?: FeedbackStudyLookup;
    referenceMatches?: FeedbackReferenceIndex | null;
  },
): PersonalFeedback {
  const e = record.envelope,
    lifecycle = options.lifecycle ?? lifecycleFromHistory(record, options.history),
    referenceUnavailable = options.referenceUnavailable,
    references = referenceUnavailable ? [] : options.references,
    a = analyze(e),
    work = summarizeWork(e),
    complete = hasCompleteLifecycleCosts(record) && lifecycle.status === 'clear';
  const report: PersonalFeedback = {
    version: 'personal-feedback-1',
    visibility: 'private',
    kind: 'contribution',
    ...(e.tasks.some(t => t.evaluation?.execution.modelTimeline) ? { modelTimeline: combineModelTimelines(e.tasks.map(t => t.evaluation?.execution.modelTimeline)) } : {}),
    lifecycle,
    recordId: record.id,
    generatedAt: new Date().toISOString(),
    headline: referenceUnavailable
      ? '已保存摘要，公开参照暂不可用；先展示本次已知投入。'
      : lifecycle.status === 'conflict'
        ? '已保存摘要；发现重复完整结算，先展示本次工作与用量。'
        : lifecycle.status === 'pending' || lifecycle.status === 'unknown'
          ? '已保存摘要；历史任务尚未确认，暂不比较或推荐。'
          : complete
            ? '已保存摘要，以下是本次投入和同类工作的比较。'
            : '已保存摘要；记录或费用覆盖不完整，先展示已知投入。',
    ...(referenceUnavailable
      ? { referenceUnavailable }
      : options.referenceSnapshot
        ? { referenceSnapshot: options.referenceSnapshot }
        : {}),
    sample: {
      ...(options.sample ??
        feedbackSample(
          options.history,
          options.allowSynthetic,
          e.collectionWindow?.endAt ?? record.createdAt,
        )),
      currentRecordWindow: e.collectionWindow
        ? { startAt: e.collectionWindow.startAt, endAt: e.collectionWindow.endAt }
        : null,
    },
    metrics: [
      metric('tasks', '记录的独立目标', e.tasks.length, '项'),
      metric('accepted', '已验收目标', a.accepted, '项'),
      metric(
        'completion',
        '截至本次采集已验收占比',
        a.completion === null ? null : a.completion * 100,
        '%',
        '分母为本次全部根目标，包含仍在做、等待及状态未知的目标；这是进度快照，剩余部分不等于失败率。不设完成率档位。',
      ),
      metric(
        'paid',
        '本次净实付',
        a.net,
        e.period.currency + '_minor',
        '账期实付减退款；费用依据未独立核验时属于自报。',
      ),
      metric(
        'unit_cost',
        '验收单位成本',
        complete ? a.costPerAccepted : null,
        e.period.currency + '_minor',
        '失败与返工支出包含在内；零验收或覆盖不全时不计算比较值。',
      ),
      metric(
        'tokens',
        '全部已计量 Token',
        work.tokens.total,
        'Token',
        '输入加输出；缓存和推理为子项，覆盖不完整时总量保留未知。',
      ),
      metric(
        'known_tokens',
        '已知 Token 小计',
        work.tokens.inputTokens.knownSubtotal + work.tokens.outputTokens.knownSubtotal,
        'Token',
        '不是完整总量，不能据此判断更省。',
      ),
      metric('input', '输入 Token', work.tokens.inputTokens.total, 'Token'),
      metric('output', '输出 Token', work.tokens.outputTokens.total, 'Token'),
      metric('cache', '缓存读取 Token', work.tokens.cachedInputTokens.total, 'Token'),
      ...(e.tasks.some((t) => t.models.some((m) => m.cacheWriteTokens !== undefined))
        ? [
            metric(
              'cache_write',
              '缓存写入 Token',
              work.tokens.cacheWriteTokens.total,
              'Token',
              '输入 Token 的子项，不与总量重复相加。',
            ),
          ]
        : []),
      metric('reasoning', '推理 Token', work.tokens.reasoningTokens.total, 'Token'),
      metric(
        'human',
        '人工投入',
        a.humanMinutes,
        '分钟',
        '记录的人工投入，不等于任务首末事件跨度。',
      ),
      metric('user_turns', '用户轮次', work.execution.userTurns.total, '轮'),
      metric('model_calls', '模型调用', work.execution.modelCalls.total, '次'),
      metric('tool_calls', '工具调用', work.execution.toolCalls.total, '次'),
      metric(
        'agents',
        e.executionScope ? '所有层级去重代理' : '所有层级代理参与数',
        work.execution.agentCount.total,
        '个',
        e.executionScope
          ? '按实际代理身份跨目标去重。'
          : '历史记录按每个目标的参与数相加，不能解释为全局去重身份总数。',
      ),
      metric('depth', '最大代理层级', work.execution.maxAgentDepth.maximum, '层'),
      ...(e.executionScope?.rootAgents != null ? [metric('root_agents', '根代理', e.executionScope.rootAgents, '个')] : []),
      metric(
        'components',
        '目标内组成部分',
        work.workStructure.components.total,
        '部分',
        '组成部分不加入独立目标数；未登记完整构成时为未知。',
      ),
      metric(
        'completed_components',
        '已完成组成部分',
        work.workStructure.completedComponents.total,
        '部分',
      ),
      metric(
        'accepted_components',
        '已验收组成部分',
        work.workStructure.acceptedComponents.total,
        '部分',
      ),
      metric(
        'dependency_depth',
        '最长组成依赖深度',
        work.workStructure.maximumDependencyDepth,
        '步',
        '按任务组成图计算，反馈组缩合后取组间最长路径；与代理层级不同。',
      ),
      metric(
        'integrated_goals',
        '已通过整合验收的目标',
        work.workStructure.integrationAcceptedGoals.total,
        '项',
      ),
    ],
    work: work.completedWork.slice(0, 100).map((q) => ({
      label: labels.kind[q.kind],
      unit: q.unit,
      completed: q.completed.total,
      accepted: q.accepted.total,
      note:
        q.coverage === 'complete'
          ? '不同单位分别记录，完成不等于验收。'
          : '覆盖不全，完整完成量保留未知。',
    })),
    groups: [],
    recommendations: [],
    quota: options.quota ?? [],
    notices: [
      repeatNotice,
      '反馈仅对你可见，由程序计算，不调用大模型；不改变公开统计同意，也不自动购买、换模型或开启上传。',
      '成本较低、Token 较少或轮次较少不自动代表质量更高；原始材料、难度和未记录资源可能不同。',
    ],
  };
  if (
    record.evidence.cost !== 'C2' ||
    record.evidence.work !== 'W2' ||
    record.evidence.coverage !== 'verified'
  )
    report.notices.push(
      referenceUnavailable
        ? '你的费用或验收尚未独立验证；本人用量按已知记录展示，不提升证据等级。'
        : options.referenceEvidence === 'recorded'
          ? '费用与验收采用本地记录口径，尚未独立核验；参照由相同口径的配置记录汇总，比较不能提升证据等级。'
          : '你的费用或验收尚未独立验证；以下社区参照只使用已核验且符合发布门槛的数据，比较不能提升你的证据等级。',
    );
  const costs = allocate(e),
    groups = new Map<string, { c: Comparison['cohort']; indexes: number[] }>();
  e.tasks.forEach((task, i) => {
    const c = cohort(task, e.period),
      key = canonical([workKey(c), c.costAttributionPolicy ?? null]);
    if (!groups.has(key)) groups.set(key, { c, indexes: [] });
    groups.get(key)!.indexes.push(i);
  });
  const allGroups = [...groups.values()].sort((a, b) => b.indexes.length - a.indexes.length);
  const comparisonReasons = new Map<
    NonNullable<PersonalFeedback['comparisonCoverage']>['reasons'][number]['reason'],
    number
  >();
  let reviewedTasks = 0,
    comparedTasks = 0;
  const referenceMatches =
    options.referenceMatches === undefined
      ? FeedbackReferenceIndex.create(references)
      : options.referenceMatches;
  for (const { c, indexes } of allGroups.slice(0, 24)) {
    const own = summarize(
      indexes.map((i) => ({
        task: e.tasks[i],
        // Only non-cost statistics are used when complete is false; every
        // compared monetary value is gated below by complete lifecycle costs.
        cost: costs.costs[i] ?? 0,
        period: e.period,
        owner: record.owner,
        evidence: record.evidence,
      })),
    );
    const workloadEligibility = workloadComparisonEligibility(c),
      workloadKnown = workloadEligibility.eligible,
      common =
        referenceMatches?.select(
          references,
          c,
          record.evidence,
          options.referenceEvidence ?? 'verified',
        ) ??
        selectFeedbackReferences(
          references,
          c,
          record.evidence,
          options.referenceEvidence ?? 'verified',
        );
    // common already matches work and cost rules. Equal billing below also
    // removes its cross-billing exception, so no second condition-key pass is needed.
    const peers =
      complete && workloadKnown
        ? latest(
            common.filter(
              (r) =>
                r.cohort.billing === c.billing &&
                r.cohort.month === c.month &&
                r.cohort.payment === c.payment,
            ),
          )
        : [];
    const perAccepted = (n: number | null, completion: number) =>
      n !== null && completion > 0 ? n / completion : null;
    const detailType = workClassificationLabel(c);
    const groupLabel = `${labels.kind[c.kind]}${detailType ? ' · ' + detailType : ''} · ${labels.scope[c.scope]} · ${labels.acceptance[c.acceptance]} · 输入 ${workloadLabels.inputUnits[c.inputUnits]} · 输出 ${workloadLabels.outputUnits[c.outputUnits]}${c.workloadUnit === 'unknown' ? '' : workloadLabels.unit[c.workloadUnit]}${c.allocation === 'itemized' ? ' · ' + costAttributionMethodsLabel(c.costAttributionPolicy) : ''}`;
    const specifications: [string, string, string, (r: Comparison['metrics']) => number | null][] =
      [
        ['cost', '验收单位成本', c.currency + '_minor', (m) => m.costPerAccepted],
        ['completion', '验收完成率', '%', (m) => m.completion * 100],
        ['tokens', '每项验收目标 Token', 'Token', (m) => perAccepted(m.tokens, m.completion)],
        ['cache', '缓存命中占比', '%', (m) => (m.cacheRate === null ? null : m.cacheRate * 100)],
        [
          'human',
          '每项验收目标人工投入',
          '分钟',
          (m) => (m.humanSamples === m.count ? perAccepted(m.humanMinutes, m.completion) : null),
        ],
        [
          'wall',
          '每项验收目标经过时间',
          '分钟',
          (m) => (m.wallSamples === m.count ? perAccepted(m.wallMinutes, m.completion) : null),
        ],
        ['retries', '每项目标重试', '次', (m) => m.retries],
        ['rework', '每项目标返工', '次', (m) => (m.reworkSamples === m.count ? m.rework : null)],
        ['ttft', '首字等待', '毫秒', (m) => m.ttftMs],
        ['speed', '可见输出速度', 'Token/秒', (m) => m.outputTps],
        [
          'turns',
          '每项验收目标用户轮次',
          '轮',
          (m) =>
            m.execution.userTurns.samples === m.count
              ? perAccepted(m.execution.userTurns.mean, m.completion)
              : null,
        ],
        [
          'agents',
          '每项目标代理数量',
          '个',
          (m) => (m.execution.agentCount.samples === m.count ? m.execution.agentCount.mean : null),
        ],
      ];
    report.groups.push({
      label: groupLabel,
      tasks: indexes.length,
      metrics: specifications.map(([id, label, unit, get]) => {
        const measuredTasks = (m: Comparison['metrics']) =>
          id === 'speed' ? m.speedSamples : id === 'ttft' ? (m.ttftTaskSamples ?? null) : null;
        const performanceMetric = id === 'speed' || id === 'ttft';
        const measured = measuredTasks(own);
        const base = metric(
          id,
          label,
          complete ? get(own) : null,
          unit,
          !complete
            ? '本次记录不具备完整比较条件。'
            : !workloadKnown
              ? `比较条件缺少：${workloadEligibility.reasons.map((reason) => workloadExclusionLabels[reason]).join('、')}。保留本次已知投入，补齐有依据的记录后再比较。`
              : '',
        );
        if (performanceMetric) {
          base.measurement = { tasks: measured, totalTasks: own.count };
          if (measured !== own.count) {
            base.note = `本组 ${own.count} 项目标中${measured === null ? '测量覆盖未记录' : `有 ${measured} 项包含该项测量`}；只展示已观察值，不判断整组快慢。`;
            return base;
          }
        }
        if (referenceUnavailable)
          return { ...base, note: base.note || referenceUnavailableNote[referenceUnavailable] };
        return compare(base, peers, (r) =>
          performanceMetric && measuredTasks(r.metrics) !== r.metrics.count ? null : get(r.metrics),
        );
      }),
    });
    const hasComparison = report.groups.at(-1)!.metrics.some((m) => m.reference !== null);
    const comparisonReason = referenceUnavailable
      ? 'reference_unavailable'
      : !complete
        ? 'record_incomplete'
        : !workloadKnown
          ? 'workload_unknown'
          : peers.length === 0
            ? 'no_same_conditions'
            : peers.length < 3
              ? 'too_few_configurations'
              : !hasComparison
                ? 'missing_measurements'
                : 'available';
    reviewedTasks += indexes.length;
    if (hasComparison) comparedTasks += indexes.length;
    comparisonReasons.set(
      comparisonReason,
      (comparisonReasons.get(comparisonReason) ?? 0) + indexes.length,
    );
    if (referenceUnavailable || !complete || !workloadKnown) continue;
    const eligible = latest(
      common.filter(
        (r) =>
          modelRankingEligible(r) &&
          r.cohort.billing === 'api' &&
          r.cohort.payment === 'regular' &&
          r.metrics.accepted > 0 &&
          r.metrics.costPerAccepted !== null,
      ),
    );
    const selected = new Map<string, Comparison>();
    for (const r of eligible) {
      const key = modelIdentityKey(r.cohort.modelIdentity)!,
        old = selected.get(key);
      if (!old || r.metrics.costPerAccepted! < old.metrics.costPerAccepted!) selected.set(key, r);
    }
    const candidates = [...selected.values()].sort(
      (a, b) => a.metrics.costPerAccepted! - b.metrics.costPerAccepted!,
    );
    for (const r of candidates.slice(0, 2))
      report.recommendations.push({
        kind: 'model',
        work: groupLabel,
        model: r.cohort.models,
        modelIdentity: r.cohort.modelIdentity,
        harness: harnessDescription(r.cohort),
        plan: null,
        currency: r.cohort.currency,
        unitCostMinor: r.metrics.costPerAccepted,
        projectedMinor: finite(r.metrics.costPerAccepted! * indexes.length),
        targetTasks: indexes.length,
        capacityP25: null,
        candidates: candidates.length,
        month: r.cohort.month,
        evidence: {
          taskCount: r.metrics.count,
          acceptedCount: r.metrics.accepted,
          sources: r.metrics.sources,
          periods: null,
          completion: r.metrics.completion,
          cost: r.evidence.cost,
          work: r.evidence.work,
          coverage: r.evidence.coverage,
          projectedRangeMinor: projectedRange(r.metrics.sourceRange, indexes.length),
          rangeBasis: 'source_cost_per_accepted',
          ...(r.metrics.sourceSupport ? { sourceSupport: r.metrics.sourceSupport } : {}),
          candidateHarnesses: eligible.filter(
            (candidate) =>
              modelIdentityKey(candidate.cohort.modelIdentity) ===
              modelIdentityKey(r.cohort.modelIdentity),
          ).length,
          selectionBasis: 'observed_minimum',
          selectionUncertainty: 'not_estimated',
        },
        ...(options.lookupPublicStudy ? { publicStudyEvidence: options.lookupPublicStudy(r) } : {}),
        note: `以最终验收 ${indexes.length} 项为目标估计，费用包含失败和返工；这不是只发起同数量任务的预算。${candidates.length === 1 ? '目前只有一个可比模型，不能确认全局最优' : '已观察模型按成本排序，每个模型选择此类任务最省的 Harness'}。这是历史候选中的最低观察值，尚未估计选择最低值带来的偏差，不能承诺下次最省。来源间观察范围不是置信区间或未来报价；不同任务分别推荐，历史价格不保证当前购买价。${crossBillingNote(r.cohort, c)}`,
      });
    if (allGroups.length !== 1) continue;
    const plans = latest(
      options.plans.filter(
        (p) =>
          planRankingEligible(p) &&
          sameWorkAndCostConditions(p.cohort, c, true) &&
          sameReferenceEvidence(
            p.evidence,
            record.evidence,
            options.referenceEvidence ?? 'verified',
          ) &&
          p.currency === c.currency &&
          p.month <= c.month &&
          p.cohort.billing !== 'api' &&
          p.cohort.payment === 'regular' &&
          p.cycleAcceptedP25 >= indexes.length &&
          p.costPerAccepted !== null &&
          p.accepted > 0,
      ),
    ).sort((a, b) => a.cycleCostMedian - b.cycleCostMedian || a.plan.localeCompare(b.plan));
    for (const p of plans.slice(0, 2))
      report.recommendations.push({
        kind: 'plan',
        work: groupLabel,
        model: p.model,
        modelIdentity: p.cohort.modelIdentity,
        harness: harnessDescription(p.cohort),
        ...(p.cohort.harnessComposition ? { harnessComposition: p.cohort.harnessComposition } : {}),
        plan: `${p.plan} ${p.planVersion}`,
        currency: p.currency,
        unitCostMinor: p.costPerAccepted,
        projectedMinor: p.cycleCostMedian,
        targetTasks: indexes.length,
        capacityP25: p.cycleAcceptedP25,
        candidates: plans.length,
        month: p.month,
        evidence: {
          taskCount: null,
          acceptedCount: p.accepted,
          sources: p.sources,
          periods: p.periods,
          completion: p.completion,
          cost: p.evidence.cost,
          work: p.evidence.work,
          coverage: p.evidence.coverage,
          projectedRangeMinor: projectedRange(p.cycleCostRange),
          rangeBasis: 'cycle_purchase_cost',
        },
        note: `按完整账期历史实付比较，费用包含失败和返工；购买费用不按目标数折算，单位验收成本不作为购买价。历史周期验收量下四分位达到此次目标量，不代表套餐额度上限或交付保证。账期支出范围是观察值，不是置信区间或当前报价；不自动推算混合工作下的共享额度。${crossBillingNote(p.cohort, c)}`,
      });
  }
  limitFeedbackStudyEvidence(report.recommendations);
  report.analytics = analyzeTaskInsights(e);
  report.toolbox = contributionToolbox(e);
  const taskProfile = feedbackTaskProfile(e.tasks.map(t => ({ requirements: t.observations?.requirements, structure: t.evaluation?.version === 'work-summary-1' ? t.evaluation.workStructure : null })));
  if (taskProfile) report.taskProfile = taskProfile;
  const usages = e.tasks.flatMap(t => t.models);
  const equivalents = usages.map(u => comparableEquivalentMinor(u, e.period.currency));
  const equivalentTotal = equivalents.length && equivalents.every(v => v !== null) ? equivalents.reduce<number>((sum, v) => sum + v!, 0) : null;
  report.usageValue = {
    currency: e.period.currency, equivalentMinor: equivalentTotal !== null && Number.isSafeInteger(equivalentTotal) ? equivalentTotal : null,
    usageRecords: usages.length, pricedRecords: equivalents.filter(v => v !== null).length,
    priceVersions: [...new Set(usages.flatMap(u => u.priceVersion ? [u.priceVersion] : []))].slice(0, 100),
  };
  report.comparisonCoverage = {
    totalTasks: e.tasks.length,
    reviewedTasks,
    comparedTasks,
    unreviewedTasks: e.tasks.length - reviewedTasks,
    reasons: [...comparisonReasons].map(([reason, tasks]) => ({ reason, tasks })),
    note: '覆盖按本次根目标计数；有至少一项可比指标的目标计入已比较，各指标仍各自检查测量覆盖。这里只与符合条件、排除本人并达到发布门槛的公开配置比较，不代表所有用户，也不将局部结果外推到未匹配工作。',
  };
  if (allGroups.length > 24)
    report.notices.push(
      `本次含 ${allGroups.length} 组工作条件，反馈展示任务数最多的 24 组；原记录完整保留。`,
    );
  if (!referenceUnavailable && allGroups.length > 1)
    report.notices.push(
      '混合工作分别推荐模型；缺少覆盖全部混合工作的完整套餐周期证据，暂不判定整体最优套餐。',
    );
  if (referenceUnavailable) report.notices.push(referenceUnavailableNote[referenceUnavailable]);
  if (
    lifecycle.status === 'clear' &&
    !referenceUnavailable &&
    !report.groups.some((g) => g.metrics.some((m) => m.reference))
  )
    report.notices.push(
      '可比社区样本不足，暂不能判断你在整体统计中的成本位置；空统计不会用演示数据补齐。',
    );
  if (lifecycle.status === 'clear' && !referenceUnavailable && !report.recommendations.length)
    report.notices.push(
      '目前没有符合这些任务条件、规模与费用口径的已核验方案；暂不编造最优模型或套餐。',
    );
  const benefits = e.period.billingBenefits;
  if (benefits)
    for (const [key, label] of [
      ['discountAppliedMinor', '已应用折扣'],
      ['creditAppliedMinor', '已使用赠额'],
      ['creditRemainingMinor', '已知剩余赠额'],
    ] as const)
      report.metrics.push(
        metric(
          key,
          label,
          benefits[key],
          e.period.currency + '_minor',
          '账期背景信息，不重复加减实付。',
        ),
      );
  report.metrics.push(
    metric(
      'accepted_per_currency',
      '单位费用完成目标',
      complete && a.net !== null && a.net > 0 ? a.accepted / (a.net / 100) : null,
      '项/' + e.period.currency,
      '按本次全部支出计算；零费用、赠额和覆盖缺项不能当成无限性价比。',
    ),
  );
  // Quota observations have no root-goal attribution. Even equal Token totals
  // cannot establish that the accepted goals belong to the observed quota window.
  report.metrics.push(
    metric(
      'accepted_per_percent',
      '每 1% 额度完成目标',
      null,
      '项/%',
      '缺少本额度区间与已验收目标的对应记录，暂不能计算。Token 总量相等或时间长度相同都不能证明这些目标使用了这段额度；需要先记录这段额度对应哪些目标，并确认这些目标的全部执行及额度消耗都在统计范围内。',
    ),
  );
  const resourceLabels = {
    cpuSeconds: ['CPU 使用', '秒'],
    gpuSeconds: ['GPU 使用', '秒'],
    memoryGiBHours: ['内存占用', 'GiB·小时'],
    storageGiBDays: ['存储占用', 'GiB·天'],
    networkBytes: ['网络流量', '字节'],
    searchRequests: ['搜索请求', '次'],
    externalApiRequests: ['外部 API 请求', '次'],
    images: ['图片处理', '张'],
    mediaSeconds: ['媒体处理', '秒'],
  } as const;
  for (const key of resourceMetrics) {
    const values = e.tasks.map((t) => t.evaluation?.resources[key]);
    const sum =
      values.every((v) => v != null) && work.agentCoverage === 'complete'
        ? values.reduce<number>((n, v) => n + v!, 0)
        : null;
    report.metrics.push(
      metric(
        key,
        resourceLabels[key][0],
        sum !== null && sum <= Number.MAX_SAFE_INTEGER ? sum : null,
        resourceLabels[key][1],
        '包括已记录的全部层级代理；缺项保留未知。',
      ),
    );
  }
  const runs = e.collectionProcessing ?? [];
  for (const key of ['inputTokens', 'outputTokens'] as const) {
    const known =
      runs.length > 0 &&
      runs.every(
        (r) =>
          r.method === 'program' ||
          (r.status === 'complete' &&
            r.models.length > 0 &&
            r.models.every((m) => m[key] !== null)),
      );
    const sum = known
      ? runs.reduce((n, r) => n + r.models.reduce((s, m) => s + (m[key] ?? 0), 0), 0)
      : null;
    report.metrics.push(
      metric(
        'processing_' + key,
        key === 'inputTokens' ? '整理输入 Token' : '整理输出 Token',
        sum,
        'Token',
        '采集、分类与脱敏的单独开销，不重复加到账期或工作 Token。',
      ),
    );
  }
  return PersonalFeedbackSchema.parse(withFeedbackNextSteps(report));
}

export function journalFeedback(summary: DailySummary, history: DailySummary[], historyComplete = true): PersonalFeedback {
  const analyzed = summary.tasks.flatMap((task) => (task.analysis ? [task.analysis] : []));
  const requirementHighlights = new Map<string, {label: string; description: string; tasks: number}>();
  for (const a of analyzed) {
    const seen = new Set<string>();
    for (const c of a.requirementLevels.criteria) {
      const key = `${c.criterionId}:${c.anchorIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const criterion = difficultyFramework.domains.find(d => d.domain === c.domain)?.criteria.find(r => `${c.domain}.${r.id}` === c.criterionId);
      if (!criterion) continue;
      const item = requirementHighlights.get(key) ?? {label: criterion.label, description: criterion.anchors[c.anchorIndex], tasks: 0};
      item.tasks++; requirementHighlights.set(key, item);
    }
  }
  const codeAnalysis = analyzeCodeObservations(
    summary.tasks.map((task) => ({
      observations: task.analysis?.codeMeasurements
        ? { codeMeasurements: task.analysis.codeMeasurements }
        : undefined,
    })),
  );
  const coverage = journalCoverage(summary, history);
  const batches = coverage.coveredDays ?? 0,
    measuredDays = coverage.coveredDays;
  const coverageNote =
    coverage.currentWindow !== 'valid'
      ? '此历史日记的日期、时区或采集区间不一致，保留原记录；覆盖天数未知，不能判定周度或月度覆盖。'
      : `按最近 30 个本地日期、相同时区的有效日记计数；同一天的修订不增加天数，不能证明全天完整覆盖。${
          coverage.excluded.invalidWindow
            ? ` ${coverage.excluded.invalidWindow} 份日期或区间不一致的记录未计入。`
            : ''
        }${
          coverage.excluded.differentTimeZone
            ? ` ${coverage.excluded.differentTimeZone} 份其他时区记录单独保留，未并入本时区覆盖。`
            : ''
        }`;
  const attempts = summary.processingHistory;
  const attemptTotal = (key: 'inputTokens' | 'outputTokens') =>
    attempts?.length && attempts.every((a) => a[key] !== null)
      ? attempts.reduce((n, a) => n + a[key]!, 0)
      : null;
  return withFeedbackNextSteps(
    PersonalFeedbackSchema.parse({
      version: 'personal-feedback-1',
      visibility: 'private',
      kind: 'journal',
      ...(summary.measurements.modelTimeline ? { modelTimeline: summary.measurements.modelTimeline } : {}),
      personaHistory: personaHistory(summary, history, historyComplete),
      toolbox: journalToolbox(summary, history, historyComplete),
      ...(analyzed.length ? {taskProfile: feedbackTaskProfile(summary.tasks.map(t => ({ requirements: t.analysis?.requirements, structure: t.analysis?.structure })))} : {}),
      ...(analyzed.length
        ? {
            journalAnalysis: {
              analyzedItems: analyzed.length,
              graphItems: analyzed.filter((a) => a.structure.status === 'computed_graph').length,
              knownCriteria: analyzed.reduce((n, a) => n + a.requirementLevels.criteria.length, 0),
              missingCriteria: analyzed.some((a) => a.requirementLevels.missingCriteria === null)
                ? null
                : analyzed.reduce((n, a) => n + a.requirementLevels.missingCriteria!, 0),
              ...(codeAnalysis ? { codeMeasurements: codeAnalysis } : {}),
              requirementHighlights: [...requirementHighlights.values()].sort((a,b) => b.tasks-a.tasks).slice(0, 12),
            },
          }
        : {}),
      recordId: summary.id,
      generatedAt: new Date().toISOString(),
      headline: '日记已保存，以下是本日工作与用量反馈。',
      sample: {
        batches,
        coveredDays: measuredDays,
        stage:
          batches <= 1
            ? 'single'
            : measuredDays !== null && measuredDays >= 28
              ? 'monthly'
              : measuredDays !== null && measuredDays >= 7
                ? 'weekly'
                : 'short',
        note: coverageNote,
        journalCoverage: coverage,
      },
      metrics: [
        metric(
          'items',
          '对话整理的工作条目',
          summary.tasks.length,
          '条',
          '工作条目不等于独立验收目标。',
        ),
        metric('input', '已观察输入 Token', summary.measurements.inputTokens, 'Token'),
        metric('output', '已观察输出 Token', summary.measurements.outputTokens, 'Token'),
        metric(
          'known_input',
          '可计量输入小计',
          summary.measurements.knownTokenSubtotals?.inputTokens ?? null,
          'Token',
          '缺请求用量时只保留已有小计，不能据此判断更省。',
        ),
        metric(
          'known_output',
          '可计量输出小计',
          summary.measurements.knownTokenSubtotals?.outputTokens ?? null,
          'Token',
          '小计不是完整消耗；缓存与推理不重复加入总 Token。',
        ),
        metric('turns', '已观察用户轮次', summary.measurements.userTurns, '轮'),
        metric('agents', '已观察代理', summary.measurements.agentCount, '个'),
        ...(summary.measurements.rootAgentCount != null ? [metric('root_agents', '根代理', summary.measurements.rootAgentCount, '个')] : []),
        metric('processing_input', '本次整理输入 Token', summary.processing.inputTokens, 'Token'),
        metric('processing_output', '本次整理输出 Token', summary.processing.outputTokens, 'Token'),
        metric(
          'cost',
          '实际费用',
          null,
          '金额',
          '此日记没有独立账期实付和验收字段，不能从 Token 或公开报价猜实际付款。',
        ),
        metric(
          'cache',
          '已观察缓存输入',
          summary.measurements.cachedInputTokens,
          'Token',
          '输入的子项，不重复相加。',
        ),
        metric(
          'reasoning',
          '已观察推理输出',
          summary.measurements.reasoningTokens,
          'Token',
          '输出的子项，不重复相加。',
        ),
        metric('model_calls', '已观察模型调用', summary.measurements.modelCalls, '次'),
        metric('tool_calls', '已观察工具调用', summary.measurements.toolCalls, '次'),
        metric('depth', '已观察代理最大层级', summary.measurements.maxAgentDepth, '层'),
        metric(
          'processing_attempts',
          '已记录整理尝试',
          attempts?.length ?? null,
          '次',
          '含失败和中断，截至此日记修订时；不是成功任务数。',
        ),
        metric(
          'processing_failed',
          '整理失败与中断',
          attempts?.filter((a) => ['failed', 'interrupted'].includes(a.status)).length ?? null,
          '次',
        ),
        metric(
          'processing_all_input',
          '已记录整理历史输入',
          attemptTotal('inputTokens'),
          'Token',
          '任一尝试缺用量时完整合计保留未知，不只计算成功尝试。',
        ),
        metric(
          'processing_all_output',
          '已记录整理历史输出',
          attemptTotal('outputTokens'),
          'Token',
          '包含已计量的失败与中断，不与本次整理或工作用量重复相加。',
        ),
        ...Object.entries(progressPhaseLabels).map(([phase, label]) =>
          metric(
            `phase_${phase}`,
            `${label}的工作条目`,
            summary.tasks.filter(
              (task) =>
                (task.progress?.phase ??
                  (task.reportedStatus === 'in_progress'
                    ? 'running'
                    : ['failed', 'abandoned'].includes(task.reportedStatus)
                      ? 'ended'
                      : 'unknown')) === phase,
            ).length,
            '条',
            '仅描述本日材料提及的状态；对话报告完成不等于用户验收，缺少结束信息保留未知。',
          ),
        ),
      ],
      work: summary.tasks.map((t) => ({
        label: labels.kind[t.kind],
        unit: t.unit,
        completed: t.reportedCompleted,
        accepted: null,
        note: '根据对话报告，尚未独立验收；不同单位不混加。',
      })),
      groups: [],
      recommendations: [],
      quota: [],
      notices: [
        repeatNotice,
        '本日记覆盖部分已知；材料规模、费用和独立验收不足，暂不能对齐社区排名或判定最优套餐。可通过贡献 Skill 补充固定工作条件与实际费用后获取比较。',
        '反馈仅供本人查看，由程序生成，不额外消耗模型额度。',
      ],
    }),
  );
}

export function renderFeedbackText(report: PersonalFeedback): string {
  const value = (m: Metric) =>
    m.value === null
      ? '未知'
      : m.unit.endsWith('_minor')
        ? `${(m.value / 100).toFixed(2)} ${m.unit.replace('_minor', '')}`
        : `${Number(m.value.toFixed(2))} ${taskInsightUnitLabels[m.unit] ?? m.unit}`;
  const recommendationEvidence = (r: PersonalFeedback['recommendations'][number]) => {
    const e = r.evidence;
    if (!e) return [];
    const range = e.projectedRangeMinor;
    return [
      `依据：${e.sources} 个来源${e.taskCount === null ? '' : `、${e.taskCount} 项目标`}${e.periods === null ? '' : `、${e.periods} 个账期`}，${e.acceptedCount} 项验收，完成率 ${(e.completion * 100).toFixed(1)}%。来源标识数量不证明样本相互独立。`,
      `${e.rangeBasis === 'cycle_purchase_cost' ? '历史账期支出范围' : '来源间观察范围'}：${range === null ? '未知' : `${(range[0] / 100).toFixed(2)}–${(range[1] / 100).toFixed(2)} ${r.currency}`}；不是置信区间或当前报价。`,
      ...(e.candidateHarnesses === undefined
        ? []
        : [
            `该模型从 ${e.candidateHarnesses} 个可比 Harness 配置选择历史最低观察值，未估计选择不确定性。`,
          ]),
      ...(e.sourceSupport
        ? [
            `来源集中度：按任务权重折算 ${e.sourceSupport.effectiveSources.toFixed(1)} 个来源，最大来源占比 ${(e.sourceSupport.maxTaskShare * 100).toFixed(1)}%，零验收来源 ${e.sourceSupport.zeroAcceptedSources} 个；不代表独立样本量。`,
          ]
        : []),
    ];
  };
  return [
    report.headline,
    ...(report.provisional
      ? ['这是尚未保存的临时反馈。你可以稍后手动再次读取反馈，不需要重复上传。']
      : []),
    report.sample.note,
    ...(report.journalAnalysis
      ? [
          `本日 ${report.journalAnalysis.analyzedItems} 条工作附有分析；已记录 ${report.journalAnalysis.knownCriteria} 项要求描述，缺项数 ${report.journalAnalysis.missingCriteria ?? '未知'}。实验难度未校准，不参与正式排名。`,
          ...(report.journalAnalysis.codeMeasurements
            ? codeObservationInsightLines(report.journalAnalysis.codeMeasurements)
            : []),
        ]
      : []),
    ...(report.nextSteps ?? feedbackNextSteps(report)).actions.map(
      (a) => `下一步：${a.title}。${a.reason} ${a.action}`,
    ),
    ...(report.lifecycle
      ? [report.lifecycle.note]
      : report.kind === 'contribution'
        ? ['此历史反馈尚未检查重复完整结算，原报告保留；不能据此认定历史没有重复。']
        : []),
    ...(report.kind === 'journal' && !report.sample.journalCoverage
      ? [legacyJournalCoverageNotice]
      : []),
    ...(report.referenceSnapshot
      ? [
          `参照统计保存于 ${report.referenceSnapshot.publishedAt}。${referenceExclusionNote(report.referenceSnapshot)}`,
        ]
      : []),
    ...report.metrics.filter((m) => m.value !== null).map((m) => `${m.label}：${value(m)}`),
    ...(report.analytics?.chargeReconciliation
      ? [
          '累计费用与子项核对',
          ...chargeReconciliationLines(
            report.analytics.chargeReconciliation,
            report.analytics.currency,
          ),
        ]
      : []),
    ...(report.analytics?.priceMetering
      ? [
          `历史 API 等价费用复核：来源报告 ${report.analytics.priceMetering.reportedMinor === null ? '未知' : (report.analytics.priceMetering.reportedMinor / 100).toFixed(2) + ' ' + report.analytics.currency}，分段重算 ${report.analytics.priceMetering.recomputedMinor === null ? '未知' : (report.analytics.priceMetering.recomputedMinor / 100).toFixed(2) + ' ' + report.analytics.currency}；${report.analytics.priceMetering.recomputed}/${report.analytics.priceMetering.usages} 条模型用量已完成分段重算；缺项 ${report.analytics.priceMetering.incomplete}，冲突 ${report.analytics.priceMetering.conflicts}，越界 ${report.analytics.priceMetering.outOfRange}，旧记录 ${report.analytics.priceMetering.legacy}。${report.analytics.priceMetering.reasons.join('；')}。${report.analytics.priceMetering.note}`,
        ]
      : []),
    ...(report.analytics?.costAttribution
      ? [
          `逐项费用归属：直接归属 ${(report.analytics.costAttribution.directMinor / 100).toFixed(2)} ${report.analytics.currency}，共享分摊 ${(report.analytics.costAttribution.sharedMinor / 100).toFixed(2)} ${report.analytics.currency}，未归属 ${(report.analytics.costAttribution.unallocatedMinor / 100).toFixed(2)} ${report.analytics.currency}；${report.analytics.costAttribution.coverage === 'complete' ? '完整' : '部分'}明细。${report.analytics.costAttribution.note}`,
        ]
      : []),
    ...(report.comparisonCoverage
      ? [
          `社区比较覆盖：${report.comparisonCoverage.comparedTasks}/${report.comparisonCoverage.totalTasks} 项目标；${report.comparisonCoverage.unreviewedTasks} 项未在本次组数范围内评估。${report.comparisonCoverage.note}`,
        ]
      : []),
    ...(report.analytics
      ? report.analytics.costByStatus.map(
          (item) =>
            `${item.label}目标已归属费用：${item.allocatedMinor === null ? '未知' : `${(item.allocatedMinor / 100).toFixed(2)} ${report.analytics!.currency}`}；费用观察 ${item.known}/${item.expected}。`,
        )
      : []),
    ...(report.analytics?.codeMeasurements
      ? codeObservationInsightLines(report.analytics.codeMeasurements)
      : []),
    ...(report.analytics
      ? report.analytics.groups.flatMap((group) => [
          group.label,
          ...group.metrics.map(
            (m) =>
              `${m.label}：${value({ ...m, position: 'unavailable', reference: null })}；已知观察 ${m.known}/${m.expected}。${m.note}`,
          ),
        ])
      : []),
    ...report.groups.flatMap((g) => [
      g.label,
      ...g.metrics
        .filter((m) => m.reference)
        .map(
          (m) =>
            `${m.label}：${value(m)}；${feedbackReferenceCountsText(m.reference!)}${feedbackReferenceExclusionsText(m.reference!)} 中间 50% 配置值范围：${value({ ...m, value: m.reference!.p25 })} 至 ${value({ ...m, value: m.reference!.p75 })}；描述性数值位置，不是用户排名或统计显著差异。`,
        ),
    ]),
    ...report.recommendations.flatMap((r) => {
      const model = r.modelIdentity
        ? r.modelIdentity.members
            .map((member) => `${member.provider} / ${member.model} @ ${member.version}`)
            .join(' + ')
        : r.model;
      return [
        `${r.kind === 'plan' ? '套餐' : '模型'}参考：${r.plan ? `${r.plan}（${model}）` : model} / ${r.harness}；${r.work}；预计 ${r.projectedMinor === null ? '未知' : (r.projectedMinor / 100).toFixed(2)} ${r.currency}。${r.note}`,
        ...(r.harnessComposition
          ? [
              '全部参与 Harness：' +
                r.harnessComposition.members
                  .map(
                    (h) =>
                      `${h.id} / ${h.version} / 型号 ${h.variant ?? '未记录'} / 环境 ${h.surface}`,
                  )
                  .join('；') +
                '。整套协作配置的效果和费用不归属于单个 Harness。',
            ]
          : []),
        ...recommendationEvidence(r),
        ...(r.kind === 'model' ? feedbackPublicStudyLines(r.publicStudyEvidence) : []),
      ];
    }),
    ...report.quota.map(
      (q) => `${q.label}：${q.status}；区间消费 ${q.consumption ?? '未知'} ${q.unit}。${q.note}`,
    ),
    ...report.notices,
  ].join('\n');
}
