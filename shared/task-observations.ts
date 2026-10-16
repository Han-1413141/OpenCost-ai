import { z } from 'zod';
import { RequirementHistoryValuesSchema } from './requirement-history-values.js';
import { CodeMeasurementObservationsSchema } from './code-observations-schema.js';

export const ObservationMetaSchema = z
  .object({
    source: z.enum([
      'recorded_log',
      'artifact_parser',
      'human_report',
      'local_model',
      'local_rule',
      'unknown',
    ]),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    timing: z.enum([
      'before_execution',
      'approved_change',
      'during_execution',
      'after_execution',
      'retrospective',
      'followup',
      'unknown',
    ]),
    missingReason: z
      .enum([
        'not_recorded',
        'unsupported',
        'not_applicable',
        'not_consented',
        'source_unavailable',
        'redacted',
        'unknown',
      ])
      .nullable(),
  })
  .strict();

export type ObservationMeta = z.infer<typeof ObservationMetaSchema>;

export const observationMethodFamilies = [
  'retrieval',
  'transformation',
  'construction',
  'diagnosis',
  'formal_verification',
  'statistical_inference',
  'optimization',
  'simulation',
  'multimodal_alignment',
  'cross_system_integration',
] as const;
export const observationConstraintKinds = [
  'correctness',
  'performance',
  'security',
  'compatibility',
  'format',
  'accessibility',
  'source_traceability',
  'resource_limit',
  'deadline',
] as const;

const missing = (value: unknown) => value === undefined || value === null || value === 'unknown';

// Provenance is a client declaration. A valid schema never authenticates its source.
function checkMetadata(meta: ObservationMeta, values: unknown[], ctx: z.RefinementCtx) {
  const hasMissing = values.some(missing);
  if (hasMissing && meta.missingReason === null)
    ctx.addIssue({
      code: 'custom',
      path: ['meta', 'missingReason'],
      message: '未记录、未知或省略的观察字段需要缺失原因',
    });
  if (!hasMissing && meta.missingReason !== null)
    ctx.addIssue({
      code: 'custom',
      path: ['meta', 'missingReason'],
      message: '全部观察字段已知时缺失原因应为 null',
    });
  if (
    (meta.source === 'unknown' || meta.coverage === 'unknown') &&
    values.some((value) => !missing(value))
  )
    ctx.addIssue({
      code: 'custom',
      path: ['meta'],
      message: '没有来源或覆盖依据时不能填写已知观察值',
    });
}

const unique = (
  values: readonly string[] | null | undefined,
  ctx: z.RefinementCtx,
  key: string,
) => {
  if (values && new Set(values).size !== values.length)
    ctx.addIssue({ code: 'custom', path: [key], message: '分类代码不能重复' });
};

export const RequirementObservationsSchema = z
  .object({
    meta: ObservationMetaSchema,
    clarity: z.enum(['specified', 'incomplete', 'conflicting', 'unknown']).optional(),
    inputCondition: z
      .enum(['clean', 'missing', 'inconsistent', 'noisy', 'mixed', 'unknown'])
      .optional(),
    solutionNovelty: z.enum(['repeat', 'adaptation', 'new_solution', 'unknown']).optional(),
    knowledge: z.enum(['general', 'specialist', 'research', 'unknown']).optional(),
    reasoning: z.enum(['routine', 'multi_step', 'formal', 'open_ended', 'unknown']).optional(),
    methodFamilies: z
      .array(z.enum(observationMethodFamilies))
      .max(observationMethodFamilies.length)
      .nullable()
      .optional(),
    constraintKinds: z
      .array(z.enum(observationConstraintKinds))
      .max(observationConstraintKinds.length)
      .nullable()
      .optional(),
    contextReuse: z.enum(['fresh', 'continued', 'template_based', 'unknown']).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    checkMetadata(
      v.meta,
      [
        v.clarity,
        v.inputCondition,
        v.solutionNovelty,
        v.knowledge,
        v.reasoning,
        v.methodFamilies,
        v.constraintKinds,
        v.contextReuse,
      ],
      ctx,
    );
    unique(v.methodFamilies, ctx, 'methodFamilies');
    unique(v.constraintKinds, ctx, 'constraintKinds');
  });

const criterionCount = z.number().int().min(0).max(100).nullable().optional();
export const ValidationObservationsSchema = z
  .object({
    meta: ObservationMetaSchema,
    criteriaPlanned: criterionCount,
    criteriaExecuted: criterionCount,
    criteriaPassed: criterionCount,
    criticalCriteriaPlanned: criterionCount,
    criticalCriteriaPassed: criterionCount,
    independence: z
      .enum(['self_check', 'separate_human', 'separate_tool', 'mixed', 'unknown'])
      .optional(),
    planBasis: z
      .enum(['before_execution', 'approved_change', 'retrospective', 'unknown'])
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    checkMetadata(
      v.meta,
      [
        v.criteriaPlanned,
        v.criteriaExecuted,
        v.criteriaPassed,
        v.criticalCriteriaPlanned,
        v.criticalCriteriaPassed,
        v.independence,
        v.planBasis,
      ],
      ctx,
    );
    const within = (
      child: number | null | undefined,
      parent: number | null | undefined,
      key: string,
    ) => {
      if (child != null && parent != null && child > parent)
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: '验收子项数量不能超过对应的总项数量',
        });
    };
    within(v.criteriaExecuted, v.criteriaPlanned, 'criteriaExecuted');
    within(v.criteriaPassed, v.criteriaExecuted, 'criteriaPassed');
    within(v.criteriaPassed, v.criteriaPlanned, 'criteriaPassed');
    within(v.criticalCriteriaPlanned, v.criteriaPlanned, 'criticalCriteriaPlanned');
    within(v.criticalCriteriaPassed, v.criteriaPassed, 'criticalCriteriaPassed');
    within(v.criticalCriteriaPassed, v.criteriaExecuted, 'criticalCriteriaPassed');
    within(v.criticalCriteriaPassed, v.criteriaPlanned, 'criticalCriteriaPassed');
    within(v.criticalCriteriaPassed, v.criticalCriteriaPlanned, 'criticalCriteriaPassed');
    if (
      v.meta.timing === 'before_execution' &&
      ((v.criteriaExecuted ?? 0) > 0 ||
        (v.criteriaPassed ?? 0) > 0 ||
        (v.criticalCriteriaPassed ?? 0) > 0)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'timing'],
        message: '事前观察不能包含已执行或已通过的验收结果',
      });
    if (v.meta.timing === 'before_execution' && v.planBasis === 'retrospective')
      ctx.addIssue({
        code: 'custom',
        path: ['planBasis'],
        message: '事前观察不能声明事后补写的验收计划',
      });
  });

const followupCount = z.number().int().min(0).max(1e7).nullable().optional();
export const FollowupObservationsSchema = z
  .object({
    meta: ObservationMetaSchema,
    windowDays: z.union([z.literal(7), z.literal(30)]),
    observedDays: z.number().int().min(0).max(30),
    status: z.enum(['complete', 'right_censored', 'not_observed']),
    reopenedCount: followupCount,
    delayedDefectCount: followupCount,
  })
  .strict()
  .superRefine((v, ctx) => {
    // Window and observation status describe the collection plan, not defect measurements.
    checkMetadata(v.meta, [v.reopenedCount, v.delayedDefectCount], ctx);
    if (v.observedDays > v.windowDays)
      ctx.addIssue({
        code: 'custom',
        path: ['observedDays'],
        message: '已观察天数不能超过随访窗口',
      });
    if (
      v.status === 'complete' &&
      (v.observedDays !== v.windowDays || v.meta.coverage !== 'complete')
    )
      ctx.addIssue({ code: 'custom', path: ['status'], message: '完整随访需要覆盖整个观察窗口' });
    if (v.status === 'right_censored' && (v.observedDays === 0 || v.observedDays >= v.windowDays))
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: '右删失随访需要已经观察且尚未达到完整窗口',
      });
    if (
      v.status === 'not_observed' &&
      (v.observedDays !== 0 || v.reopenedCount != null || v.delayedDefectCount != null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: '未随访时观察天数为零，重开和缺陷数量必须未记录，不能补零',
      });
    if (
      v.status !== 'not_observed' &&
      (v.meta.source === 'unknown' || v.meta.coverage === 'unknown')
    )
      ctx.addIssue({ code: 'custom', path: ['meta'], message: '已经开展的随访需要来源与覆盖依据' });
    if (
      v.status !== 'not_observed' &&
      ['before_execution', 'approved_change', 'during_execution'].includes(v.meta.timing)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'timing'],
        message: '交付后的随访不能标记为执行前或执行期间的观察',
      });
  });

const elapsed = z.number().int().min(0).max(1e12).nullable().optional();
export const TimeObservationsSchema = z
  .object({
    meta: ObservationMetaSchema,
    partition: z.enum(['exclusive', 'overlapping', 'unknown']),
    activeMs: elapsed,
    waitingUserMs: elapsed,
    waitingExternalMs: elapsed,
    pausedMs: elapsed,
    unknownMs: elapsed,
  })
  .strict()
  .superRefine((v, ctx) => {
    const components = [v.activeMs, v.waitingUserMs, v.waitingExternalMs, v.pausedMs, v.unknownMs];
    checkMetadata(v.meta, [v.partition, ...components], ctx);
    if (v.meta.timing === 'before_execution' && components.some((n) => n != null && n > 0))
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'timing'],
        message: '事前观察不能包含执行耗时',
      });
  });

export const RequirementHistoryObservationsSchema = RequirementHistoryValuesSchema.safeExtend({
  meta: ObservationMetaSchema,
}).superRefine((v, ctx) => {
  if (
    v.meta.timing === 'before_execution' &&
    (v.observed.changes > 0 ||
      v.observed.reopens > 0 ||
      v.observed.acceptances > 0 ||
      (v.currentPassed ?? 0) > 0 ||
      v.phase === 'ended')
  )
    ctx.addIssue({
      code: 'custom',
      message: '执行前要求历史不能包含执行后的变更、重开、通过或终态',
    });
  checkMetadata(
    v.meta,
    [
      v.baselineRequired,
      v.currentRequired,
      v.currentPassed,
      v.approvedChanges,
      v.pendingProposals,
      v.reopenedCount,
      v.acceptanceEvents,
      v.originalAcceptedHistorically,
      v.originalVerifiedNow,
      v.activeReopen,
      v.phase,
      v.currentOutcome,
      v.reason,
    ],
    ctx,
  );
  if (
    v.meta.coverage !== 'complete' &&
    [
      v.baselineRequired,
      v.currentRequired,
      v.currentPassed,
      v.approvedChanges,
      v.pendingProposals,
      v.reopenedCount,
      v.acceptanceEvents,
      v.originalAcceptedHistorically,
      v.originalVerifiedNow,
      v.activeReopen,
    ].some((value) => value !== null)
  )
    ctx.addIssue({
      code: 'custom',
      message: '局部要求历史只保留已提供事件数，完整状态与总数须未知',
    });
});

export const TaskObservationsSchema = z
  .object({
    version: z.literal('task-observations-1'),
    requirements: RequirementObservationsSchema.optional(),
    validation: ValidationObservationsSchema.optional(),
    followup: FollowupObservationsSchema.optional(),
    time: TimeObservationsSchema.optional(),
    history: RequirementHistoryObservationsSchema.optional(),
    codeMeasurements: CodeMeasurementObservationsSchema.optional(),
  })
  .strict();

export type TaskObservations = z.infer<typeof TaskObservationsSchema>;

export function validateTaskObservationConsistency(
  task: {
    observations?: TaskObservations;
    acceptanceTotal: number;
    acceptancePassed: number;
    performance: { wallMs: number | null } | null;
    status?: string;
    requirementsLocked?: boolean;
    progress?: { phase: string; reason: string };
  },
  ctx: z.RefinementCtx,
) {
  const history = task.observations?.history;
  if (history?.meta.coverage === 'complete') {
    const fail = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['observations', 'history'], message });
    if (history.currentRequired !== null && history.currentRequired !== task.acceptanceTotal)
      fail('当前要求历史必需项数与本次验收总项数不同');
    if (history.currentPassed !== null && history.currentPassed !== task.acceptancePassed)
      fail('当前要求历史通过项数与本次验收通过项数不同');
    if (history.approvedChanges && task.requirementsLocked)
      fail('已批准变更不能继续声明原要求未改变');
    if (history.currentOutcome !== 'unknown' && history.currentOutcome !== task.status)
      fail('要求历史终态与本次任务结果不同');
    if (history.phase !== 'unknown' && task.progress && history.phase !== task.progress.phase)
      fail('要求历史执行阶段与本次进度不同');
    if (history.reason !== 'unknown' && task.progress && history.reason !== task.progress.reason)
      fail('要求历史原因与本次进度不同');
    if (
      history.phase !== 'ended' &&
      history.phase !== 'unknown' &&
      ['accepted', 'failed', 'abandoned'].includes(task.status ?? '')
    )
      fail('仍在执行的要求历史不能作为最终结果上传');
  }
  const validation = task.observations?.validation;
  if (validation?.meta.coverage === 'complete') {
    if (validation.criteriaPlanned != null && validation.criteriaPlanned !== task.acceptanceTotal)
      ctx.addIssue({
        code: 'custom',
        path: ['observations', 'validation', 'criteriaPlanned'],
        message: '完整验收观察的计划项数必须与任务验收总项数一致',
      });
    if (validation.criteriaPassed != null && validation.criteriaPassed !== task.acceptancePassed)
      ctx.addIssue({
        code: 'custom',
        path: ['observations', 'validation', 'criteriaPassed'],
        message: '完整验收观察的通过项数必须与任务验收通过项数一致',
      });
  }
  const time = task.observations?.time;
  const wallMs = task.performance?.wallMs;
  if (time?.partition === 'exclusive' && wallMs != null) {
    const components = [
      time.activeMs,
      time.waitingUserMs,
      time.waitingExternalMs,
      time.pausedMs,
      time.unknownMs,
    ];
    const knownSum = components.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (knownSum > wallMs)
      ctx.addIssue({
        code: 'custom',
        path: ['observations', 'time'],
        message: '互斥耗时分量之和不能超过任务总墙钟耗时',
      });
    if (
      time.meta.coverage === 'complete' &&
      components.every((value) => value != null) &&
      knownSum !== wallMs
    )
      ctx.addIssue({
        code: 'custom',
        path: ['observations', 'time'],
        message: '完整且全部已知的互斥耗时分量必须与任务总墙钟耗时守恒',
      });
  }
}
