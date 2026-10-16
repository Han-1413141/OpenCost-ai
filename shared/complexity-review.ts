import { z } from 'zod';
import { difficultyFramework } from './difficulty-framework.js';
import {
  computeDifficultyReview,
  DifficultyReviewSchema,
  type DifficultyReviewInput,
} from './difficulty-review.js';
import { RequirementObservationsSchema } from './task-observations.js';
import { workTypeIds } from './work-taxonomy.js';
import {
  TASK_COMPLEXITY_VERSION,
  computeTaskComplexity,
  extractTaskComplexityRequirements,
  taskComplexityDimensions,
} from './task-complexity.js';

export const COMPLEXITY_REVIEW_VERSION = 'complexity-model-review-1';
export const COMPLEXITY_REVIEW_MAX_BYTES = 65_536;

const dimensionIds = taskComplexityDimensions.map((d) => d.id) as [string, ...string[]];
const fieldRefs = taskComplexityDimensions.map((d) => d.fieldRef) as [string, ...string[]];
const categoryValues = [...new Set(taskComplexityDimensions.flatMap((d) => [...d.categories]))] as [
  string,
  ...string[],
];
const valueSchema = z.union([
  z.enum(categoryValues),
  z.array(z.enum(categoryValues)).max(categoryValues.length),
  z.null(),
]);
const SnapshotSchema = z
  .object({
    taskId: z.string().uuid(),
    classification: z
      .object({
        workType: z.enum(['unknown', 'mixed', ...workTypeIds]),
        basis: z.enum(['original_request', 'approved_change', 'human_report', 'unknown']),
        coverage: z.enum(['complete', 'partial', 'unknown']),
      })
      .strict(),
    requirements: RequirementObservationsSchema.nullable(),
  })
  .strict();
const AssessmentSchema = z
  .object({
    dimensionId: z.enum(dimensionIds),
    state: z.enum(['mapped', 'unknown']),
    value: valueSchema,
    fieldRefs: z.array(z.enum(fieldRefs)).max(1),
    missingReason: z.enum(['not_recorded', 'not_eligible', 'reviewer_abstained']).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.state === 'unknown') {
      if (v.value !== null || v.fieldRefs.length || v.missingReason === null)
        ctx.addIssue({ code: 'custom', message: '未知条目必须留空值与字段引用，并记录缺失原因' });
    } else if (v.value === null || v.fieldRefs.length !== 1 || v.missingReason !== null) {
      ctx.addIssue({
        code: 'custom',
        message: '映射条目必须给出分类、单个字段引用，缺失原因为 null',
      });
    }
    if (Array.isArray(v.value) && new Set(v.value).size !== v.value.length)
      ctx.addIssue({ code: 'custom', message: '分类集合不能重复' });
  });

export const ComplexityReviewSchema = z
  .object({
    version: z.literal(COMPLEXITY_REVIEW_VERSION),
    rubricVersion: z.literal(TASK_COMPLEXITY_VERSION),
    taskId: z.string().uuid(),
    requirementRevision: z.string().uuid(),
    snapshot: SnapshotSchema,
    assessments: z.array(AssessmentSchema).length(taskComplexityDimensions.length),
    domainAssessment: DifficultyReviewSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.assessments.map((a) => a.dimensionId)).size !== taskComplexityDimensions.length)
      ctx.addIssue({
        code: 'custom',
        path: ['assessments'],
        message: '每个维度必须且只能出现一次',
      });
    if (v.snapshot.taskId !== v.taskId)
      ctx.addIssue({ code: 'custom', path: ['taskId'], message: '任务与要求快照不一致' });
    const domain = v.domainAssessment;
    if (domain) {
      const fail = (message: string) =>
        ctx.addIssue({ code: 'custom', path: ['domainAssessment'], message });
      if (domain.parts.length) fail('本轮模型辅助答卷只评价所绑定根任务，不增加子任务');
      if (
        domain.root.componentId !== v.taskId.toLowerCase() ||
        domain.root.requirementVersion !== v.requirementRevision.toLowerCase()
      )
        fail('领域答卷必须绑定当前任务和要求修订');
      const a = domain.root.annotation;
      const classification = v.snapshot.classification;
      const identified =
        a.phase !== 'unavailable' &&
        classification.coverage === 'complete' &&
        classification.basis !== 'unknown' &&
        !['unknown', 'mixed'].includes(classification.workType);
      const expectedWorkType = identified ? classification.workType : 'unknown';
      const expectedDomain = identified ? classification.workType.split('.')[0] : 'unknown';
      if (a.workType !== expectedWorkType || a.domain !== expectedDomain)
        fail('领域和细类必须与完整已记录分类相符；未完整分类时保持 unknown');
      if (a.phase === 'before_execution')
        fail('模型辅助回看原要求应使用 original_request_review，不能补登记事前评价');
      if (
        a.criteria.some((c) => c.review !== 'unreviewed') ||
        domain.root.facets?.some((f) => f.review !== 'unreviewed')
      )
        fail('模型答卷不能自行声明已经通过人工或独立复核');
      if (a.usedMethods !== null) fail('领域答卷不采集实际执行方法，避免用执行结果反推要求');
    }
  });

export type ComplexityReview = z.infer<typeof ComplexityReviewSchema>;
export type ComplexityReviewOptions = { enabled?: boolean; requirementRevision?: string };

const disabled = () =>
  ({
    status: 'disabled',
    enabled: false,
    productionIntake: false,
    productionRanking: false,
    score: null,
  }) as const;

function revision(options: ComplexityReviewOptions) {
  return z.string().uuid().parse(options.requirementRevision);
}

function boundedReview(value: unknown) {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 2048 || depth > 12) return false;
    if (item === null) return true;
    if (typeof item === 'number') return Number.isInteger(item) && item >= 0 && item <= 3;
    if (typeof item === 'string') return item.length <= 256;
    if (item && typeof item === 'object') {
      if (ancestors.has(item)) return false;
      const array = Array.isArray(item);
      if (array && item.length > 64) return false;
      if (
        !array &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        return false;
      const names = Object.getOwnPropertyNames(item).filter((name) => !array || name !== 'length');
      if (names.length > (array ? 64 : 16)) return false;
      ancestors.add(item);
      const valid = names.every((name) => {
        const property = Object.getOwnPropertyDescriptor(item, name)!;
        return name.length <= 64 && 'value' in property && visit(property.value, depth + 1);
      });
      ancestors.delete(item);
      return valid;
    }
    return false;
  }
  try {
    return (
      visit(value, 0) &&
      new TextEncoder().encode(JSON.stringify(value)).length <= COMPLEXITY_REVIEW_MAX_BYTES
    );
  } catch {
    return false;
  }
}

// Only schema-validated, bounded JSON projections reach this comparison. No
// arbitrary field resolver or object path traversal is exposed to model output.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function selectedGuidance(workType: string) {
  const domain = difficultyFramework.domains.find((d) =>
    d.subtypeProfiles.some((s) => s.workType === workType),
  );
  const subtype = domain?.subtypeProfiles.find((s) => s.workType === workType);
  if (!domain || !subtype) return null;
  return {
    frameworkVersion: difficultyFramework.version,
    domain: domain.domain,
    workType,
    requirementChecks: subtype.requirementChecks,
    criteria: domain.criteria.map((c) => ({
      criterionId: `${domain.domain}.${c.id}`,
      label: c.label,
      descriptions: [...c.anchors],
      assessment: 'not_identifiable_from_summary' as const,
    })),
    methodCatalogue: domain.methodCatalogue,
    use: 'local_requirement_checklist_only' as const,
  };
}

function domainTemplate(
  snapshot: z.infer<typeof SnapshotSchema>,
  requirementRevision: string,
): DifficultyReviewInput {
  const c = snapshot.classification;
  const identified =
    c.coverage === 'complete' &&
    c.basis !== 'unknown' &&
    !['unknown', 'mixed'].includes(c.workType);
  const workType = identified ? c.workType : 'unknown';
  const domain = identified ? c.workType.split('.')[0] : 'unknown';
  const definition = difficultyFramework.domains.find((d) => d.domain === domain);
  return {
    version: 'difficulty-local-review-1',
    root: {
      componentId: snapshot.taskId,
      requirementVersion: requirementRevision,
      annotation: {
        version: 'domain-difficulty-draft-2',
        requirementVersion: requirementRevision,
        phase: 'original_request_review',
        domain,
        workType,
        classificationState: identified ? 'supported' : 'unknown',
        criteria: (definition?.criteria ?? []).map((criterion) => ({
          criterionId: `${domain}.${criterion.id}`,
          applicability: 'unknown',
          state: 'not_reviewed',
          anchorIndex: null,
          evidenceKind: 'unknown',
          coverage: 'unknown',
          review: 'unreviewed',
        })),
        requiredMethods: null,
        usedMethods: null,
        inputConditions: { missing: 'unknown', conflict: 'unknown', ambiguity: 'unknown' },
      },
    },
    parts: [],
  };
}

/** The packet deliberately excludes cost, outcome, model identity and task text. */
export function createComplexityReviewPacket(
  task?: unknown,
  options: ComplexityReviewOptions = {},
) {
  if (options.enabled !== true) return disabled();
  const requirementRevision = revision(options);
  const snapshot = SnapshotSchema.parse(extractTaskComplexityRequirements(task));
  const responseTemplate: ComplexityReview = {
    version: COMPLEXITY_REVIEW_VERSION,
    rubricVersion: TASK_COMPLEXITY_VERSION,
    taskId: snapshot.taskId,
    requirementRevision,
    snapshot,
    assessments: taskComplexityDimensions.map((d) => ({
      dimensionId: d.id,
      state: 'unknown',
      value: null,
      fieldRefs: [],
      missingReason: 'reviewer_abstained',
    })),
    domainAssessment: domainTemplate(snapshot, requirementRevision),
  };
  return {
    status: 'ready',
    version: COMPLEXITY_REVIEW_VERSION,
    enabled: true,
    productionIntake: false,
    productionRanking: false,
    networkCalls: false,
    maxReviewBytes: COMPLEXITY_REVIEW_MAX_BYTES,
    snapshot,
    taskId: snapshot.taskId,
    requirementRevision,
    rubricVersion: TASK_COMPLEXITY_VERSION,
    rubric: taskComplexityDimensions,
    eligibility: {
      timings: ['before_execution', 'approved_change'],
      rule: 'use_program_eligibility; preserve_source_and_unknown; never_infer_missing_values',
    },
    domainGuidance: selectedGuidance(snapshot.classification.workType),
    responseTemplate,
    notice:
      '结构映射只核验已有脱敏字段；可选领域答卷由本地 Harness 根据其原要求判别并标为模型声明，程序仅检查规则一致性，不验证原文或所选级别真实。答卷保持本地，不改变上传或排名。',
  } as const;
}

/** A submitted model answer can abstain or fail checks; it cannot change the
 * program's independent result. Version and snapshot binding are consistency
 * checks, not signatures, independent evidence or authentication. */
export function validateComplexityReview(
  task?: unknown,
  review?: unknown,
  options: ComplexityReviewOptions = {},
) {
  if (options.enabled !== true) return disabled();
  const requirementRevision = revision(options);
  const snapshot = SnapshotSchema.parse(extractTaskComplexityRequirements(task));
  const recomputed = computeTaskComplexity(task, { enabled: true, requirementRevision });
  if (recomputed.status !== 'computed_unvalidated') throw new Error('复杂度研究计算未启用');
  const result = boundedReview(review)
    ? ComplexityReviewSchema.safeParse(review)
    : { success: false as const };
  if (!result.success)
    return {
      status: 'invalid',
      enabled: true,
      productionIntake: false,
      productionRanking: false,
      reasons: ['invalid_schema'],
      recomputed,
      comparisons: [],
      score: null,
    } as const;
  const answer = result.data;
  const bindingErrors: string[] = [];
  if (answer.taskId !== snapshot.taskId) bindingErrors.push('task_mismatch');
  if (answer.requirementRevision !== requirementRevision) bindingErrors.push('revision_mismatch');
  if (canonical(answer.snapshot) !== canonical(snapshot)) bindingErrors.push('snapshot_mismatch');
  if (bindingErrors.length)
    return {
      status: 'invalid',
      enabled: true,
      productionIntake: false,
      productionRanking: false,
      reasons: bindingErrors,
      recomputed,
      comparisons: [],
      score: null,
    } as const;

  const comparisons = recomputed.dimensions.map((dimension) => {
    const declared = answer.assessments.find((a) => a.dimensionId === dimension.id)!;
    const raw =
      snapshot.requirements?.[dimension.id as keyof NonNullable<typeof snapshot.requirements>];
    const absent = raw === undefined || raw === null || raw === 'unknown';
    const expectedMissing = absent ? 'not_recorded' : 'not_eligible';
    const status: 'abstained' | 'agreed_unknown' | 'mismatch' | 'agreed' =
      declared.state === 'unknown'
        ? declared.missingReason === 'reviewer_abstained'
          ? 'abstained'
          : dimension.status !== 'known' && declared.missingReason === expectedMissing
            ? 'agreed_unknown'
            : 'mismatch'
        : dimension.status === 'known' &&
            canonical(declared.value) === canonical(dimension.value) &&
            canonical(declared.fieldRefs) === canonical(dimension.fieldRefs)
          ? 'agreed'
          : 'mismatch';
    return {
      dimensionId: dimension.id,
      label: dimension.label,
      status,
      declared,
      expected: {
        value: dimension.value,
        fieldRefs: dimension.fieldRefs,
        status: dimension.status,
        missingReason: dimension.status === 'known' ? null : expectedMissing,
      },
    };
  });
  const mismatches = comparisons.filter((c) => c.status === 'mismatch').length;
  const agreed = comparisons.filter((c) => c.status === 'agreed').length;
  const agreedUnknown = comparisons.filter((c) => c.status === 'agreed_unknown').length;
  const abstained = comparisons.filter((c) => c.status === 'abstained').length;
  return {
    status: mismatches ? 'rejected' : 'consistent',
    enabled: true,
    productionIntake: false,
    productionRanking: false,
    version: COMPLEXITY_REVIEW_VERSION,
    provenance: 'unverified_local_submission',
    verification: 'structured_mapping_consistency_only',
    comparisons,
    coverage: { expected: comparisons.length, agreed, agreedUnknown, abstained, mismatches },
    recomputed,
    domainAssessment: answer.domainAssessment
      ? {
          status: 'declared_model_assessment',
          verification: 'schema_and_binding_only',
          result: computeDifficultyReview(answer.domainAssessment, { mode: 'local_review' }),
        }
      : null,
    score: null,
    aggregation: 'none',
  } as const;
}

export type ComplexityReviewPacket = ReturnType<typeof createComplexityReviewPacket>;
export type ComplexityReviewResult = ReturnType<typeof validateComplexityReview>;
