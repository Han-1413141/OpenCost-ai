import { z } from 'zod';
import { ModelTimelineSchema } from './model-timeline.js';
import { TaskProgressSchema, progressConflict } from './task-progress.js';
import { taskKinds, taskDomain, HarnessIdentitySchema } from './schema.js';
import { workTypeIds, workUnits, workDomainForType } from './work-taxonomy.js';
import { JournalTaskAnalysisSchema, JOURNAL_ANALYSIS_LIMITS } from './journal-analysis-schema.js';
import { PublicJournalModelSchema } from './public-models.js';

export const harnessIds = ['codex', 'claude', 'opencode', 'dsh'] as const;
export const SemanticTaskSchema = z
  .object({
    sourceRefs: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(100),
    kind: z.enum(taskKinds),
    workType: z.enum(['unknown', ...workTypeIds]),
    reportedStatus: z.enum([
      'completed',
      'partial',
      'failed',
      'abandoned',
      'in_progress',
      'unknown',
    ]),
    progress: TaskProgressSchema.extend({ basis: z.literal('model_report') }).optional(),
    unit: z.enum(
      Object.keys(workUnits) as [keyof typeof workUnits, ...Array<keyof typeof workUnits>],
    ),
    reportedCompleted: z.number().finite().min(0).max(100000).nullable(),
  })
  .strict()
  .superRefine((t, ctx) => {
    const progressError = progressConflict(t.reportedStatus, t.progress);
    if (progressError) ctx.addIssue({ code: 'custom', path: ['progress'], message: progressError });
    if (new Set(t.sourceRefs).size !== t.sourceRefs.length)
      ctx.addIssue({ code: 'custom', message: '同一任务不能重复引用来源' });
    const domain = t.workType === 'unknown' ? undefined : workDomainForType(t.workType);
    if (
      domain &&
      (!domain.units.includes(t.unit) || !domain.parentDomains.includes(taskDomain(t.kind)))
    )
      ctx.addIssue({ code: 'custom', message: '工作单位与子类型不符' });
    if (
      t.unit !== 'media_second' &&
      t.reportedCompleted !== null &&
      !Number.isSafeInteger(t.reportedCompleted)
    )
      ctx.addIssue({ code: 'custom', message: '除媒体秒数外，完成量须为安全整数' });
  });
export const SummaryTaskSchema = SemanticTaskSchema.safeExtend({
  analysis: JournalTaskAnalysisSchema.optional(),
}).superRefine((task, ctx) => {
  if (task.analysis && task.analysis.workType !== task.workType)
    ctx.addIssue({ code: 'custom', message: '分析与日记工作类型不一致' });
});
export const SemanticSummarySchema = z
  .object({ tasks: z.array(SemanticTaskSchema).max(100) })
  .strict();

export { summaryTaskStatusLabel } from './summary-task-labels.js';
const count = z.number().int().nonnegative().max(1e12).nullable();
export const ProcessingAttemptSchema = z
  .object({
    id: z.string().uuid(),
    day: z.string().regex(/^20\d\d-\d\d-\d\d$/),
    harness: z.enum(harnessIds),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    status: z.enum(['running', 'completed', 'failed', 'interrupted']),
    durationMs: count,
    inputTokens: count,
    outputTokens: count,
    costMinor: count,
    currency: z.enum(['CNY', 'USD', 'EUR']).nullable(),
  })
  .strict();
export type ProcessingAttempt = z.infer<typeof ProcessingAttemptSchema>;
export const DailySummarySchema = z
  .object({
    format: z.literal('opencost-daily-summary-1'),
    id: z.string().uuid(),
    day: z.string().regex(/^20\d\d-\d\d-\d\d$/),
    timeZone: z.string().min(1).max(80),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    revision: z.number().int().positive(),
    origin: z.enum(['real', 'synthetic']),
    evidence: z.literal('local_unverified'),
    coverage: z.literal('partial'),
    collector: z
      .object({
        id: z.literal('opencost-desktop'),
        version: z.literal('1.0'),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    harnesses: z.array(HarnessIdentitySchema).max(32),
    models: z.array(PublicJournalModelSchema).max(64).refine(v => new Set(v).size === v.length).optional(),
    tasks: z.array(SummaryTaskSchema).max(100),
    measurements: z
      .object({
        sourceRecords: z.number().int().nonnegative().max(100000),
        inputTokens: count,
        cachedInputTokens: count,
        outputTokens: count,
        reasoningTokens: count,
        knownTokenSubtotals: z
          .object({
            inputTokens: count,
            cachedInputTokens: count,
            outputTokens: count,
            reasoningTokens: count,
          })
          .strict()
          .optional(),
        userTurns: count,
        assistantTurns: count,
        modelCalls: count,
        modelTimeline: ModelTimelineSchema.optional(),
        toolCalls: count,
        agentCount: count,
        rootAgentCount: count.optional(),
        maxAgentDepth: count,
        observedSpanMs: count,
      })
      .strict(),
    processing: z
      .object({
        harness: z.enum(harnessIds),
        durationMs: z.number().int().nonnegative(),
        inputTokens: count,
        outputTokens: count,
        costMinor: count,
        currency: z.enum(['CNY', 'USD', 'EUR']).nullable(),
      })
      .strict(),
    processingHistory: z.array(ProcessingAttemptSchema).max(100).default([]),
    consent: z
      .object({ store: z.boolean(), statistics: z.literal(false), publicSummary: z.literal(false) })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const m = s.measurements;
    if (m.rootAgentCount != null && (m.agentCount === null || m.rootAgentCount < 1 || m.rootAgentCount > m.agentCount || (m.maxAgentDepth === 0 && m.rootAgentCount !== m.agentCount) || (m.maxAgentDepth != null && m.maxAgentDepth > m.agentCount - m.rootAgentCount)))
      ctx.addIssue({ code: 'custom', message: '根代理计数与代理范围或层级不一致' });
    if (
      m.cachedInputTokens !== null &&
      m.inputTokens !== null &&
      m.cachedInputTokens > m.inputTokens
    )
      ctx.addIssue({ code: 'custom', message: '缓存输入不能超过输入总量' });
    if (m.reasoningTokens !== null && m.outputTokens !== null && m.reasoningTokens > m.outputTokens)
      ctx.addIssue({ code: 'custom', message: '推理 Token 已包含在输出总量中' });
    for (const key of [
      'inputTokens',
      'cachedInputTokens',
      'outputTokens',
      'reasoningTokens',
    ] as const)
      if (
        m[key] !== null &&
        m.knownTokenSubtotals?.[key] != null &&
        m.knownTokenSubtotals[key]! > m[key]!
      )
        ctx.addIssue({ code: 'custom', message: '已知 Token 小计不能超过相应完整计量' });
    if (
      Date.parse(s.startAt) >= Date.parse(s.endAt) ||
      Date.parse(s.endAt) - Date.parse(s.startAt) > 86400000 * 1.1
    )
      ctx.addIssue({ code: 'custom', message: '工作日记必须是一个真实本地日内的区间' });
    const refs = s.tasks.flatMap((t) => t.sourceRefs);
    if (new Set(refs).size !== refs.length)
      ctx.addIssue({ code: 'custom', message: '相同来源不能重复计算为多个任务' });
    if (refs.length > s.measurements.sourceRecords)
      ctx.addIssue({ code: 'custom', message: '任务来源不能超过已观察记录数' });
    let analysisBytes = 0,
      reports = 0;
    for (const task of s.tasks)
      if (task.analysis) {
        analysisBytes += new TextEncoder().encode(JSON.stringify(task.analysis)).length;
        reports +=
          (task.analysis.codeMeasurements?.snapshots.length ?? 0) +
          (task.analysis.codeMeasurements?.patches.length ?? 0);
      }
    if (
      analysisBytes > JOURNAL_ANALYSIS_LIMITS.summaryBytes ||
      reports > JOURNAL_ANALYSIS_LIMITS.reports
    )
      ctx.addIssue({
        code: 'custom',
        message: '日记分析超出192 KiB或64份报告，请减少本次附加范围',
      });
  });
export type DailySummary = z.infer<typeof DailySummarySchema>;
export type SummaryTask = z.infer<typeof SummaryTaskSchema>;
