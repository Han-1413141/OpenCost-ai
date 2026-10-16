import { z } from 'zod';
import { RequirementObservationsSchema } from './task-observations.js';
import { CodeMeasurementObservationsSchema } from './code-observations-schema.js';
import { workTypeIds, workDomainForType } from './work-taxonomy.js';
import {
  REQUIREMENT_FRAMEWORK_VERSION,
  requirementAnchorCatalog,
} from './requirement-anchor-catalog.js';
import { CodeObservationInsightsSchema } from './code-observation-insights.js';

export const JOURNAL_ANALYSIS_LIMITS = Object.freeze({
  inputBytes: 1024 * 1024,
  taskBytes: 64 * 1024,
  summaryBytes: 192 * 1024,
  reports: 64,
  cacheEntries: 4,
});
const count = z.number().int().min(0).max(1_000_000).nullable();
const domains = Object.keys(requirementAnchorCatalog) as [
  keyof typeof requirementAnchorCatalog,
  ...Array<keyof typeof requirementAnchorCatalog>,
];
const criterionIds = Object.entries(requirementAnchorCatalog).flatMap(([domain, ids]) =>
  ids.map((id) => `${domain}.${id}`),
) as [string, ...string[]];
const AnchorSchema = z
  .object({
    domain: z.enum(domains),
    workType: z.enum(workTypeIds),
    criterionId: z.enum(criterionIds),
    anchorIndex: z.number().int().min(0).max(3),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !criterionIds.includes(v.criterionId) ||
      !v.criterionId.startsWith(v.domain + '.') ||
      workDomainForType(v.workType)?.id !== v.domain
    )
      ctx.addIssue({ code: 'custom', message: '要求描述不属于所选领域和活动' });
  });
export const JournalTaskAnalysisSchema = z
  .object({
    version: z.literal('journal-task-analysis-1'),
    source: z.literal('unverified_client_program_report'),
    use: z.literal('private_descriptive_only'),
    workType: z.enum(['unknown', ...workTypeIds]),
    requirements: RequirementObservationsSchema.optional(),
    structure: z
      .object({
        status: z.enum(['computed_graph', 'declared_summary', 'unknown']),
        coverage: z.enum(['complete', 'partial', 'unknown']),
        componentCount: count,
        dependencyEdges: count,
        dependencyDepth: count,
        cyclicDependencyGroups: count,
        largestDependencyCycle: count,
        feedbackLinks: count,
        feedbackCyclicGroups: count,
        sharedStateGroups: count,
        integrationRequired: z.boolean().nullable(),
      })
      .strict(),
    requirementLevels: z
      .object({
        frameworkVersion: z.literal(REQUIREMENT_FRAMEWORK_VERSION),
        calibration: z.literal('not_calibrated'),
        overallGrade: z.null(),
        criteria: z.array(AnchorSchema).max(128),
        missingCriteria: z.number().int().min(0).max(128).nullable(),
      })
      .strict()
      .superRefine((v, ctx) => {
        const keys = v.criteria.map((a) => `${a.domain}:${a.workType}:${a.criterionId}`);
        if (new Set(keys).size !== keys.length)
          ctx.addIssue({ code: 'custom', message: '同一活动的同一要求条目不能重复计量' });
      }),
    codeMeasurements: CodeMeasurementObservationsSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const s = v.structure;
    if (
      s.status === 'unknown' &&
      (s.coverage !== 'unknown' ||
        Object.entries(s).some(
          ([key, value]) => !['status', 'coverage'].includes(key) && value !== null,
        ))
    )
      ctx.addIssue({ code: 'custom', message: '未知结构不能填写结构计数' });
    if (
      s.status === 'computed_graph' &&
      (s.coverage === 'unknown' ||
        s.componentCount === null ||
        s.componentCount < 1 ||
        s.componentCount > 256 ||
        [
          s.dependencyEdges,
          s.dependencyDepth,
          s.cyclicDependencyGroups,
          s.largestDependencyCycle,
          s.feedbackLinks,
          s.feedbackCyclicGroups,
          s.sharedStateGroups,
        ].some((n) => n === null))
    )
      ctx.addIssue({ code: 'custom', message: '程序结构计算缺少必要计量' });
    if (
      s.componentCount !== null &&
      ((s.dependencyDepth ?? 0) >= Math.max(1, s.componentCount) ||
        (s.largestDependencyCycle ?? 0) > s.componentCount ||
        (s.cyclicDependencyGroups ?? 0) * 2 > s.componentCount)
    )
      ctx.addIssue({ code: 'custom', message: '结构计量超出组成部分范围' });
    if (new TextEncoder().encode(JSON.stringify(v)).length > JOURNAL_ANALYSIS_LIMITS.taskBytes)
      ctx.addIssue({ code: 'custom', message: '单项分析超过64 KiB，请缩小附加范围' });
  });
export type JournalTaskAnalysis = z.infer<typeof JournalTaskAnalysisSchema>;
export const JournalAnalysisTargetSchema = z
  .object({
    summaryId: z.uuid(),
    sourceRefs: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.sourceRefs).size !== v.sourceRefs.length)
      ctx.addIssue({ code: 'custom', message: '分析来源不能重复' });
  });
export const JournalAnalysisAttachmentSchema = z
  .object({
    format: z.literal('journal-analysis-attachment-1'),
    target: JournalAnalysisTargetSchema,
    analysis: JournalTaskAnalysisSchema,
  })
  .strict();
export type JournalAnalysisAttachment = z.infer<typeof JournalAnalysisAttachmentSchema>;
export const JournalAnalysisFeedbackSchema = z
  .object({
    analyzedItems: z.number().int().min(1).max(100),
    graphItems: z.number().int().min(0).max(100),
    knownCriteria: z.number().int().min(0).max(12800),
    missingCriteria: z.number().int().min(0).max(12800).nullable(),
    codeMeasurements: CodeObservationInsightsSchema.optional(),
    requirementHighlights: z.array(z.object({ label: z.string().max(200), description: z.string().max(2000), tasks: z.number().int().min(1).max(100) }).strict()).max(12).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.graphItems > v.analyzedItems)
      ctx.addIssue({ code: 'custom', message: '图计算覆盖不能超过分析条目数' });
  });
