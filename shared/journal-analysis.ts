import { z } from 'zod';
import { TaskSchema } from './schema.js';
import { computeTaskComplexity } from './task-complexity.js';
import { projectCodeReports } from './code-observations-project.js';
import { parseCodeMeasurementReport } from './code-measurement-import.js';
import {
  JournalAnalysisAttachmentSchema,
  JournalAnalysisTargetSchema,
  JOURNAL_ANALYSIS_LIMITS,
} from './journal-analysis-schema.js';
import { REQUIREMENT_FRAMEWORK_VERSION } from './requirement-anchor-catalog.js';
import { requirementAnchorCatalog } from './requirement-anchor-catalog.js';
import { workTypeIds, workDomainForType } from './work-taxonomy.js';

export const JournalAnalysisInputSchema = z
  .object({
    format: z.literal('journal-analysis-input-1'),
    target: JournalAnalysisTargetSchema,
    task: TaskSchema.optional(),
    workType: z.enum(['unknown', ...workTypeIds]).optional(),
    requirementRevision: z.uuid(),
    domainReview: z.unknown().optional(),
    dependencyGraph: z.unknown().optional(),
    reports: z.array(z.unknown()).max(12).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !v.task &&
      (!v.reports.length || v.domainReview !== undefined || v.dependencyGraph !== undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message: '要求与结构分析需要原任务；仅代码测量至少选择一份报告',
      });
  });
export function analyzeJournalTask(input: unknown) {
  const v = JournalAnalysisInputSchema.parse(input);
  for (const report of v.reports) {
    const parsed = parseCodeMeasurementReport(report);
    if (
      !parsed ||
      parsed.status === 'disabled' ||
      !parsed.requirementRevision ||
      parsed.requirementRevision.toLowerCase() !== v.requirementRevision.toLowerCase()
    )
      throw new Error('报告必须关联同一要求修订；未测得、缺少修订或其他修订的报告不能混入本次任务');
  }
  const result = v.task
    ? computeTaskComplexity(v.task, {
        enabled: true,
        requirementRevision: v.requirementRevision,
        domainReview: v.domainReview,
        dependencyGraph: v.dependencyGraph,
      })
    : null;
  if (result && result.status !== 'computed_unvalidated') throw new Error('任务分析未完成');
  const s = result?.structure ?? {
    status: 'unknown',
    coverage: 'unknown',
    componentCount: null,
    dependencyEdges: null,
    dependencyDepth: null,
    cyclicDependencyGroups: null,
    largestDependencyCycle: null,
    feedbackLinks: null,
    feedbackCyclicGroups: null,
    sharedStateGroups: null,
    integrationRequired: null,
  };
  const type = result?.classification.workType ?? v.workType ?? 'unknown';
  const domain = workDomainForType(type)?.id;
  return JournalAnalysisAttachmentSchema.parse({
    format: 'journal-analysis-attachment-1',
    target: v.target,
    analysis: {
      version: 'journal-task-analysis-1',
      source: 'unverified_client_program_report',
      use: 'private_descriptive_only',
      workType: type === 'mixed' ? 'unknown' : type,
      ...(v.task?.observations?.requirements
        ? { requirements: v.task.observations.requirements }
        : {}),
      structure: {
        status: s.status,
        coverage: s.coverage,
        componentCount: s.componentCount,
        dependencyEdges: s.dependencyEdges,
        dependencyDepth: s.dependencyDepth,
        cyclicDependencyGroups: s.cyclicDependencyGroups,
        largestDependencyCycle: s.largestDependencyCycle,
        feedbackLinks: s.feedbackLinks,
        feedbackCyclicGroups: s.feedbackCyclicGroups,
        sharedStateGroups: s.sharedStateGroups,
        integrationRequired: s.integrationRequired,
      },
      requirementLevels: {
        frameworkVersion: REQUIREMENT_FRAMEWORK_VERSION,
        calibration: 'not_calibrated',
        overallGrade: null,
        criteria:
          result?.judgement.highestKnownRequirements.map(
            ({ domain, workType, criterionId, anchorIndex }) => ({
              domain,
              workType,
              criterionId,
              anchorIndex,
            }),
          ) ?? [],
        missingCriteria: result?.domainReview
          ? result.judgement.missingCriteria.length
          : domain
            ? requirementAnchorCatalog[domain as keyof typeof requirementAnchorCatalog].length
            : null,
      },
      ...(v.reports.length ? { codeMeasurements: projectCodeReports(v.reports) } : {}),
    },
  });
}

/** Exact-input, bounded, memory-only cache. No source, report body or path is persisted. */
export function createJournalAnalysisProcessor() {
  const cache = new Map<string, ReturnType<typeof analyzeJournalTask>>();
  return async function process(text: string) {
    if (
      typeof text !== 'string' ||
      text.length > JOURNAL_ANALYSIS_LIMITS.inputBytes ||
      new TextEncoder().encode(text).length > JOURNAL_ANALYSIS_LIMITS.inputBytes
    )
      throw new Error('请选择不超过1 MiB的任务分析输入');
    const key = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    const previous = cache.get(key);
    if (previous) {
      cache.delete(key);
      cache.set(key, previous);
      return { attachment: structuredClone(previous), cacheHit: true };
    }
    let attachment;
    const parsed = JSON.parse(text);
    if (parsed?.format === 'journal-analysis-attachment-1')
      attachment = JournalAnalysisAttachmentSchema.parse(parsed);
    else attachment = analyzeJournalTask(parsed);
    cache.set(key, attachment);
    if (cache.size > JOURNAL_ANALYSIS_LIMITS.cacheEntries) cache.delete(cache.keys().next().value!);
    return { attachment: structuredClone(attachment), cacheHit: false };
  };
}
