import { z } from 'zod';
import { RequirementObservationsSchema } from './task-observations.js';
import { JournalTaskAnalysisSchema } from './journal-analysis-schema.js';
import { REQUIREMENT_FRAMEWORK_VERSION } from './requirement-anchor-catalog.js';

// Model output has no free-text fields, source labels, paths, code or report payloads.
const { meta: _meta, ...fields } = RequirementObservationsSchema.shape;
const count = z.number().int().min(1).max(256).nullable();
export const SemanticExtensionsSchema = z
  .object({
    requirements: z.object(fields).strict(),
    requirementCoverage: z.enum(['complete', 'partial', 'unknown']),
    structure: z
      .object({
        componentCount: count,
        dependencyDepth: z.number().int().min(0).max(255).nullable(),
        integrationRequired: z.boolean().nullable(),
        coverage: z.enum(['complete', 'partial', 'unknown']),
      })
      .strict(),
  })
  .strict();

export function semanticAnalysis(
  input: unknown,
  workType: z.infer<typeof JournalTaskAnalysisSchema>['workType'],
) {
  const e = SemanticExtensionsSchema.parse(input);
  const all = Object.keys(fields).map((k) => e.requirements[k as keyof typeof e.requirements]);
  const missing = all.some((v) => v == null || v === 'unknown');
  const requirements = RequirementObservationsSchema.parse({
    ...e.requirements,
    meta: {
      source: 'local_model',
      coverage: e.requirementCoverage,
      timing: 'retrospective',
      missingReason: missing ? 'source_unavailable' : null,
    },
  });
  const s = e.structure;
  if (
    s.coverage === 'unknown' &&
    [s.componentCount, s.dependencyDepth, s.integrationRequired].some((v) => v !== null)
  )
    throw new Error('没有结构依据时不能填结构数值');
  // Partial structure cannot establish a total or a maximum depth.
  const complete = s.coverage === 'complete';
  const hasStructure =
    complete &&
    [s.componentCount, s.dependencyDepth, s.integrationRequired].some((v) => v !== null);
  return JournalTaskAnalysisSchema.parse({
    version: 'journal-task-analysis-1',
    source: 'unverified_client_program_report',
    use: 'private_descriptive_only',
    workType,
    requirements,
    structure: {
      status: hasStructure ? 'declared_summary' : 'unknown',
      coverage: hasStructure ? 'complete' : 'unknown',
      componentCount: hasStructure ? s.componentCount : null,
      dependencyDepth: hasStructure ? s.dependencyDepth : null,
      integrationRequired: hasStructure ? s.integrationRequired : null,
      dependencyEdges: null,
      cyclicDependencyGroups: null,
      largestDependencyCycle: null,
      feedbackLinks: null,
      feedbackCyclicGroups: null,
      sharedStateGroups: null,
    },
    requirementLevels: {
      frameworkVersion: REQUIREMENT_FRAMEWORK_VERSION,
      calibration: 'not_calibrated',
      overallGrade: null,
      criteria: [],
      missingCriteria: null,
    },
  });
}

export const semanticExtensionInstructions =
  '扩展分析已开启。extensions 只能填 schema 指定的分类和数值：要求分类依据原要求或已批准变更，不根据最终产物倒推。未观察到不等于没有，未知枚举填 unknown、未知数组或数值填 null。requirementCoverage 的 complete 仅表示已完整核对这项原要求，片段不全用 partial。结构只统计原计划中可区分的交付部分，工具步骤、文件数和重试不是组成部分；不能确定全部组成时 coverage 用 partial。不得复制任何原文，不输出理由文本、姓名、单位、项目、路径、链接、代码、密钥、账号或哈希；不得把文本编码进数值。没有额外工具调用或文件读取；无依据保持未知。程序会固定标记这些分类来自模型提取，不作为独立核验或难度评分。';
