import { z } from 'zod';
import { ModelTimelineSchema } from './model-timeline.js';
import { SettlementRevisionSchema } from './settlement-revision-schema.js';
import { PriceUnitSchema, PriceMeteringSchema } from './price-metering.js';
import { CostAttributionSchema, validateCostAttribution } from './cost-attribution.js';
import { ChargeReconciliationSchema } from './charge-reconciliation.js';
import { TaskProgressSchema, progressConflict } from './task-progress.js';
import { CollectionWindowSchema } from './collection.js';
import { workTypeIds, workUnits, workDomainForType, type WorkUnit } from './work-taxonomy.js';
import { WorkStructureSchema, ExecutionScopeSchema } from './work-structure.js';
import { workSubjectIds } from './work-subjects.js';
import { canAllocateComponentTypes } from './work-classification.js';
import { TaskObservationsSchema, validateTaskObservationConsistency } from './task-observations.js';
import { CODE_OBSERVATION_LIMITS } from './code-observations-schema.js';

export const RULE_VERSION = 'opencost-1.1';
export * from './task-labels.js';
import {
  labels,
  taskKinds,
  workloadLabels,
  taskDomain,
  taskUnits,
  inputSizeBands,
  inputSizeLabels,
  taskInputUnits,
} from './task-labels.js';

const integer = (max: number) => z.number().int().min(0).max(max);
export const publicId = z
  .string()
  .min(1)
  .max(72)
  .regex(/^[a-z0-9][a-z0-9._:+-]*$/, '请使用公开产品标识，仅允许小写字母、数字、点、冒号、加减号');
const uuid = z.string().uuid();
export const HarnessIdentitySchema = z
  .object({
    id: publicId,
    version: publicId,
    variant: publicId.nullable().optional(),
    surface: z.enum(['cli', 'desktop', 'ide', 'web', 'api', 'custom', 'unknown']).optional(),
  })
  .strict();
export const eventLabels = {
  intent_misunderstood: '意图理解错误',
  requirements_missed: '遗漏需求',
  scope_drift: '偏离任务范围',
  incorrect_logic: '逻辑错误',
  invented_api: '虚构 API 或依赖',
  syntax_error: '语法错误',
  type_error: '类型错误',
  test_failure: '测试未通过',
  regression: '引入回归',
  security_issue: '安全问题',
  performance_issue: '性能不达标',
  review_rejected: '评审未通过',
  dependency_failure: '依赖问题',
  environment_failure: '环境问题',
  tool_failure: '工具调用失败',
  permission_blocked: '权限受阻',
  rate_limited: '触发限流',
  timeout: '超时',
  connection_failure: '连接中断',
  provider_error: '服务商错误',
  context_lost: '上下文丢失',
  repeated_work: '重复劳动',
  user_requirement_change: '需求变更',
  interrupted: '任务中断',
  manual_takeover: '人工接管',
  model_switch: '切换模型',
  harness_switch: '切换 Harness',
  rollback: '回滚修改',
  abandoned_attempt: '放弃本次尝试',
  factual_error: '事实错误',
  unsupported_claim: '结论缺少依据',
  fabricated_source: '虚构来源或引用',
  data_omission: '遗漏数据或材料',
  calculation_error: '计算错误',
  format_mismatch: '格式不符',
  style_mismatch: '风格不符',
  accessibility_issue: '可访问性问题',
  privacy_issue: '隐私信息处理不当',
  copyright_issue: '素材使用条件不符',
  other: '其他情况',
} as const;
export type EventKind = keyof typeof eventLabels;
export const eventKinds = Object.keys(eventLabels) as [EventKind, ...EventKind[]];
export const PerformanceSchema = z
  .object({
    wallMs: integer(1e12).nullable(),
    modelWallMs: integer(1e12).nullable(),
    toolWallMs: integer(1e12).nullable(),
    queueMs: integer(1e12).nullable(),
    ttftSumMs: integer(1e12).nullable(),
    ttftSamples: integer(1e7).nullable(),
    outputTokens: integer(1e11).nullable(),
    outputDurationMs: integer(1e12).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.ttftSumMs === null) !== (v.ttftSamples === null))
      ctx.addIssue({ code: 'custom', message: '首字耗时与样本数必须同时记录或同时缺失' });
    if (v.ttftSamples === 0 && v.ttftSumMs !== 0)
      ctx.addIssue({ code: 'custom', message: '没有首字样本时累计耗时必须为 0' });
    if ((v.outputTokens === null) !== (v.outputDurationMs === null))
      ctx.addIssue({ code: 'custom', message: '输出 Token 与输出阶段耗时必须成对记录' });
    if (v.outputTokens && !v.outputDurationMs)
      ctx.addIssue({ code: 'custom', message: '正输出量必须对应正输出时间' });
  });
export const PriceSnapshotSchema = z
  .object({
    version: publicId,
    currency: z.enum(['CNY', 'USD', 'EUR']),
    capturedAt: z.string().datetime(),
    effectiveFrom: z.string().datetime().nullable(),
    source: z.enum(['provider_public', 'aggregator_public', 'invoice', 'unknown']),
    sourceId: publicId,
    snapshotId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    rates: z
      .array(
        z
          .object({
            unit: PriceUnitSchema,
            amount: z.number().finite().min(0).max(1e10),
          })
          .strict(),
      )
      .max(12),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.rates.map((r) => r.unit)).size !== v.rates.length)
      ctx.addIssue({ code: 'custom', path: ['rates'], message: '同一价格单位不能重复' });
  });
export const UsageSchema = z
  .object({
    provider: publicId,
    model: publicId,
    version: publicId,
    inputTokens: integer(1e11).nullable(), // Includes cache reads and cache writes.
    cachedInputTokens: integer(1e11).nullable(),
    cacheWriteTokens: integer(1e11).nullable().optional(),
    priceMetering: PriceMeteringSchema.optional(),
    outputTokens: integer(1e11).nullable(), // Includes reasoning tokens.
    reasoningTokens: integer(1e11).nullable(),
    apiEquivalentMinor: integer(1e10).nullable(),
    priceVersion: publicId.nullable(),
    priceSnapshot: PriceSnapshotSchema.nullable().optional(),
    priceHistory: z.array(PriceSnapshotSchema).max(128).optional(),
    equivalentConversions: z
      .array(
        z
          .object({
            from: z.enum(['CNY', 'USD', 'EUR']),
            to: z.enum(['CNY', 'USD', 'EUR']),
            rate: z.number().finite().positive(),
            date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
            snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(128)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.priceSnapshot && v.priceSnapshot.version !== v.priceVersion)
      ctx.addIssue({
        code: 'custom',
        path: ['priceSnapshot'],
        message: '价格快照版本必须与该调用记录的价格版本一致',
      });
    if (
      v.cachedInputTokens !== null &&
      v.inputTokens !== null &&
      v.cachedInputTokens > v.inputTokens
    )
      ctx.addIssue({
        code: 'custom',
        path: ['cachedInputTokens'],
        message: '缓存 Token 不能超过输入 Token',
      });
    if (
      v.cacheWriteTokens != null &&
      v.inputTokens != null &&
      v.cacheWriteTokens + (v.cachedInputTokens ?? 0) > v.inputTokens
    )
      ctx.addIssue({
        code: 'custom',
        path: ['cacheWriteTokens'],
        message: '缓存读取与写入不能超过输入 Token',
      });
    if (v.reasoningTokens !== null && v.outputTokens !== null && v.reasoningTokens > v.outputTokens)
      ctx.addIssue({
        code: 'custom',
        path: ['reasoningTokens'],
        message: '思考 Token 已包含在输出 Token 中',
      });
    if (v.apiEquivalentMinor !== null && !v.priceVersion)
      ctx.addIssue({
        code: 'custom',
        path: ['priceVersion'],
        message: 'API 等价金额需要价格快照版本',
      });
  });

const measuredCount = integer(1e7).nullable();
export const ResourceUsageSchema = z
  .object({
    cpuSeconds: z.number().finite().nonnegative().max(1e12).nullable(),
    gpuSeconds: z.number().finite().nonnegative().max(1e12).nullable(),
    memoryGiBHours: z.number().finite().nonnegative().max(1e12).nullable(),
    storageGiBDays: z.number().finite().nonnegative().max(1e12).nullable(),
    networkBytes: integer(Number.MAX_SAFE_INTEGER).nullable(),
    searchRequests: measuredCount,
    externalApiRequests: measuredCount,
    images: measuredCount,
    mediaSeconds: z.number().finite().nonnegative().max(1e12).nullable(),
  })
  .strict();
const LegacyEvaluationObjectSchema = z
  .object({
    version: z.literal('work-1'),
    basis: z.enum(['before_execution', 'original_request', 'retrospective', 'unknown']),
    classification: z.enum(['human_reviewed', 'local_agent', 'collector', 'unknown']),
    confidence: z.enum(['high', 'medium', 'low', 'unknown']),
    requirements: z
      .object({
        parts: z
          .array(z.object({ kind: z.enum(taskKinds), count: integer(100000).min(1) }).strict())
          .min(1)
          .max(taskKinds.length)
          .nullable(),
        coupling: z.enum([
          'single',
          'independent',
          'pipeline',
          'shared_state',
          'iterative',
          'unknown',
        ]),
        dependencyEdges: measuredCount,
        dependencyDepth: measuredCount,
        integration: z.enum(['required', 'not_required', 'unknown']),
        reasoning: z.enum(['routine', 'applied', 'multi_step', 'open_ended', 'unknown']),
        knowledge: z.enum(['general', 'specialist', 'research', 'unknown']),
        novelty: z.enum(['repeat', 'adaptation', 'new_solution', 'unknown']),
        clarity: z.enum(['specified', 'incomplete', 'conflicting', 'unknown']),
        inputQuality: z.enum(['clean', 'missing', 'inconsistent', 'noisy', 'mixed', 'unknown']),
        qualityTarget: z.enum(['basic', 'professional', 'critical', 'unknown']),
        risk: z.enum(['reversible', 'costly', 'high_stakes', 'unknown']),
        deadline: z.enum(['none', 'fixed', 'urgent', 'unknown']),
      })
      .strict(),
    environment: z
      .object({
        tools: z.enum(['none', 'read_only', 'read_write', 'external_actions', 'unknown']),
        network: z.enum(['offline', 'online', 'restricted', 'unknown']),
        preparation: z.enum(['ready', 'setup_required', 'unknown']),
        contextReuse: z.enum(['fresh', 'continued', 'unknown']),
      })
      .strict(),
    resources: ResourceUsageSchema,
    execution: z
      .object({
        userTurns: measuredCount,
        assistantTurns: measuredCount,
        modelCalls: measuredCount,
        toolCalls: measuredCount,
        toolFailures: measuredCount,
        contextResets: measuredCount,
        contextCompactions: measuredCount,
        humanInterventions: measuredCount,
        requirementChanges: measuredCount,
        modelSwitches: measuredCount,
        modelTimeline: ModelTimelineSchema.optional(),
        harnessSwitches: measuredCount,
        agentCount: measuredCount,
        maxAgentDepth: measuredCount,
        maxParallelAgents: measuredCount,
        agentCoverage: z.enum(['complete', 'partial', 'unknown']),
        costScope: z.enum(['lifecycle_complete', 'partial', 'unknown']),
        harnesses: z.array(HarnessIdentitySchema).min(1).max(64).nullable(),
      })
      .strict(),
    outcome: z
      .object({
        partsCompleted: measuredCount,
        partsAccepted: measuredCount,
        integrationAccepted: z.boolean().nullable(),
      })
      .strict(),
  })
  .strict();

export const CompletedWorkSchema = z
  .object({
    kind: z.enum(taskKinds),
    workType: z.enum(['unknown', ...workTypeIds]),
    unit: z.enum(Object.keys(workUnits) as [WorkUnit, ...WorkUnit[]]),
    planned: z.number().finite().nonnegative().max(1e12).nullable(),
    completed: z.number().finite().nonnegative().max(1e12).nullable(),
    accepted: z.number().finite().nonnegative().max(1e12).nullable(),
    source: z.enum(['artifact_inspection', 'execution_log', 'human_report', 'unknown']),
    acceptance: z.enum(['automatic', 'human', 'both', 'unknown']),
    coverage: z.enum(['complete', 'partial', 'unknown']),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const domain = v.workType === 'unknown' ? undefined : workDomainForType(v.workType);
    if (
      domain &&
      (!domain.parentDomains.includes(taskDomain(v.kind)) || !domain.units.includes(v.unit))
    )
      issue('工作子类型、主要类别和完成量单位不匹配');
    if (
      v.unit !== 'media_second' &&
      [v.planned, v.completed, v.accepted].some((n) => n !== null && !Number.isSafeInteger(n))
    )
      issue('除媒体秒数外，工作量必须使用整数计量');
    if (v.accepted !== null && (v.completed === null || v.accepted > v.completed))
      issue('验收量必须有已完成量且不能超过已完成量');
    if (v.accepted !== null && v.acceptance === 'unknown') issue('验收量需要记录实际验收方式');
    if (
      (v.completed !== null || v.accepted !== null) &&
      (v.source === 'unknown' || v.coverage === 'unknown')
    )
      issue('已完成量需要注明计量来源和覆盖情况');
  });

// New contributions ask only for observed work and usage. No placeholder ratings.
const WorkSummaryObjectSchema = LegacyEvaluationObjectSchema.omit({
  version: true,
  basis: true,
  classification: true,
  confidence: true,
  requirements: true,
  environment: true,
})
  .extend({
    version: z.literal('work-summary-1'),
    requirements: LegacyEvaluationObjectSchema.shape.requirements.pick({
      parts: true,
      integration: true,
    }),
    completedWork: z.array(CompletedWorkSchema).max(200).nullable(),
    workStructure: WorkStructureSchema.nullable().optional(),
  })
  .strict();
type EvaluationInput =
  z.infer<typeof LegacyEvaluationObjectSchema> | z.infer<typeof WorkSummaryObjectSchema>;
function validateEvaluation(v: EvaluationInput, ctx: z.RefinementCtx) {
  const r = v.requirements,
    x = v.execution,
    o = v.outcome;
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });
  if (r.parts) {
    const total = r.parts.reduce((sum, part) => sum + part.count, 0);
    if (new Set(r.parts.map((p) => p.kind)).size !== r.parts.length)
      issue(['requirements', 'parts'], '同类部分合并计数');
    if ('coupling' in r && r.coupling === 'single' && total !== 1)
      issue(['requirements', 'coupling'], 'single 只能有一个部分');
    if (
      (o.partsCompleted !== null && o.partsCompleted > total) ||
      (o.partsAccepted !== null && o.partsAccepted > total)
    )
      issue(['outcome'], '完成或验收部分数不能超过计划部分数');
    if ('dependencyDepth' in r && r.dependencyDepth !== null && r.dependencyDepth > total)
      issue(['requirements', 'dependencyDepth'], '依赖深度不能超过部分数');
    if (
      'dependencyEdges' in r &&
      r.dependencyEdges !== null &&
      r.dependencyEdges > total * (total - 1)
    )
      issue(['requirements', 'dependencyEdges'], '有向依赖不能重复或指向自身');
  }
  if (o.partsCompleted !== null && o.partsAccepted !== null && o.partsAccepted > o.partsCompleted)
    issue(['outcome'], '通过验收的部分不能超过已完成部分');
  if (x.toolCalls !== null && x.toolFailures !== null && x.toolFailures > x.toolCalls)
    issue(['execution', 'toolFailures'], '工具失败次数不能超过调用次数');
  if (
    x.agentCoverage === 'complete' &&
    (x.agentCount === null || x.agentCount < 1 || x.maxAgentDepth === null)
  )
    issue(['execution'], '完整代理范围需要代理总数和最大深度，根代理深度为 0');
  if (
    x.agentCount !== null &&
    ((x.maxAgentDepth !== null && x.maxAgentDepth >= x.agentCount) ||
      (x.maxParallelAgents !== null && x.maxParallelAgents > x.agentCount))
  )
    issue(['execution'], '代理深度或并行数与代理总数不一致');
  if (
    x.harnesses &&
    new Set(
      x.harnesses.map((h) =>
        canonical({
          id: h.id,
          version: h.version,
          variant: h.variant ?? null,
          surface: h.surface ?? 'unknown',
        }),
      ),
    ).size !== x.harnesses.length
  )
    issue(['execution', 'harnesses'], '参与 Harness 不重复列出');
  if (v.version === 'work-summary-1' && v.completedWork) {
    const keys = v.completedWork.map((p) => canonical([p.kind, p.workType, p.unit]));
    if (new Set(keys).size !== keys.length)
      issue(['completedWork'], '同类别、子类型和单位的已完成量应先在本地去重合并');
  }
}
export const LegacyEvaluationSchema = LegacyEvaluationObjectSchema.superRefine(validateEvaluation);
export const WorkSummarySchema = WorkSummaryObjectSchema.superRefine(validateEvaluation);
export const EvaluationSchema = z.union([WorkSummarySchema, LegacyEvaluationSchema]);

export const CostComponentsSchema = z
  .object({
    model: integer(1e10).nullable(),
    harness: integer(1e10).nullable(),
    tool: integer(1e10).nullable(),
    compute: integer(1e10).nullable(),
    storage: integer(1e10).nullable(),
    network: integer(1e10).nullable(),
    other: integer(1e10).nullable(),
  })
  .strict();

export const RequirementClassificationSchema = z
  .object({
    version: z.literal('task-classification-1'),
    workType: z.enum(['unknown', 'mixed', ...workTypeIds]),
    subjects: z.array(z.enum(['unknown', ...workSubjectIds])).max(8),
    componentTypes: z
      .array(
        z
          .object({
            workType: z.enum(['unknown', ...workTypeIds]),
            count: integer(5000).min(1),
          })
          .strict(),
      )
      .max(256)
      .nullable()
      .optional(),
    useContext: z.enum(['occupational', 'education', 'personal', 'unknown']),
    basis: z.enum(['original_request', 'approved_change', 'human_report', 'unknown']),
    coverage: z.enum(['complete', 'partial', 'unknown']),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(v.subjects).size !== v.subjects.length) fail('学科代码不能重复');
    if (v.subjects.includes('unknown') && v.subjects.length > 1) fail('未知学科不与确定学科混列');
    if (
      v.basis === 'unknown' &&
      (v.workType !== 'unknown' ||
        v.subjects.some((s) => s !== 'unknown') ||
        v.useContext !== 'unknown')
    )
      fail('没有分类依据时保留未知，不能依据结果补写事前类型');
    if (v.coverage === 'unknown' && v.workType !== 'unknown') fail('没有分类覆盖时工作类型为未知');
    if (
      v.componentTypes &&
      new Set(v.componentTypes.map((p) => p.workType)).size !== v.componentTypes.length
    )
      fail('组成部分的相同子类型先合并；不能重复登记');
    if (v.componentTypes && v.basis === 'unknown') fail('没有依据时不能声明组成部分的细分类型');
    if (v.componentTypes && v.componentTypes.reduce((s, p) => s + p.count, 0) > 5000)
      fail('组成部分总数超过采集上限');
  });

export const TaskSchema = z
  .object({
    id: uuid,
    evaluation: EvaluationSchema.optional(),
    observations: TaskObservationsSchema.optional(),
    kind: z.enum(taskKinds),
    requirementClassification: RequirementClassificationSchema.nullable().optional(),
    scope: z.enum([
      'component',
      'module',
      'service',
      'single',
      'collection',
      'cross_system',
      'unknown',
    ]),
    context: z.enum(['existing', 'new', 'unknown']),
    acceptance: z.enum(['automatic', 'human', 'both', 'unknown']),
    acceptanceTotal: integer(100).min(1),
    acceptancePassed: integer(100),
    dependencies: z.enum(['0', '1', '2+', 'unknown']),
    requirementsLocked: z.boolean(),
    workload: z
      .object({
        unit: z.enum(
          Object.keys(workloadLabels.unit) as [
            keyof typeof workloadLabels.unit,
            ...(keyof typeof workloadLabels.unit)[],
          ],
        ),
        inputUnits: z.enum(['0', '1', '2-5', '6-20', '21+', 'unknown']),
        outputUnits: z.enum(['1', '2-5', '6-20', '21+', 'unknown']),
        constraintCount: z.enum(['0', '1-3', '4-7', '8+', 'unknown']),
        verification: z.enum([
          'test_suite',
          'checklist',
          'source_crosscheck',
          'reconciliation',
          'rubric',
          'execution',
          'mixed',
          'unknown',
        ]),
        inputSize: z
          .object({
            unit: z.enum(['source_lines', 'characters', 'cells', 'pixels', 'seconds', 'items']),
            band: z.enum(inputSizeBands),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    status: z.enum(['accepted', 'partial', 'failed', 'abandoned', 'in_progress']),
    progress: TaskProgressSchema.optional(),
    attempts: integer(1000).min(1),
    humanMinutes: integer(100000).nullable(),
    reworkCount: integer(1000).nullable(),
    revisionCount: integer(1000).nullable(),
    events: z
      .array(
        z
          .object({
            kind: z.enum(eventKinds),
            count: integer(10000).min(1),
            attribution: z.enum(['model', 'harness', 'provider', 'environment', 'user', 'unknown']),
          })
          .strict(),
      )
      .max(eventKinds.length)
      .nullable(),
    performance: PerformanceSchema.nullable(),
    directCostMinor: integer(1e10).nullable(),
    harness: HarnessIdentitySchema.extend({
      mode: z.enum(['agent', 'assisted']),
      tools: z.enum(['standard', 'extended']),
      reasoning: z.enum(['low', 'medium', 'high', 'auto']),
      cache: z.enum(['on', 'off', 'mixed']),
    }).strict(),
    models: z.array(UsageSchema).min(1).max(64),
    changeSize: z.enum(['1-50', '51-200', '201-1000', '1000+', 'unknown']).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const type = v.requirementClassification?.workType;
    validateTaskObservationConsistency(v, ctx);
    if (
      type &&
      !['mixed', 'unknown'].includes(type) &&
      !workDomainForType(type)?.parentDomains.includes(taskDomain(v.kind))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['requirementClassification', 'workType'],
        message: '原要求工作子类型与主要任务类别不一致',
      });
    }
    if (v.evaluation) {
      const { requirements: r, execution: x, outcome: o } = v.evaluation;
      const components = v.requirementClassification?.componentTypes;
      if (components && v.requirementClassification?.coverage === 'complete') {
        const count = components.reduce((s, p) => s + p.count, 0);
        const structure =
          v.evaluation.version === 'work-summary-1' ? v.evaluation.workStructure : null;
        const expected =
          (structure?.coverage === 'complete' ? structure.componentCount : null) ??
          (r.parts ? r.parts.reduce((s, p) => s + p.count, 0) : null);
        if (expected !== null && count !== expected)
          ctx.addIssue({
            code: 'custom',
            path: ['requirementClassification', 'componentTypes'],
            message: '细分组成数与完整原要求部分数必须守恒',
          });
        if (
          r.parts &&
          !canAllocateComponentTypes(
            components,
            r.parts.map((p) => ({ domain: taskDomain(p.kind), count: p.count })),
          )
        )
          ctx.addIssue({
            code: 'custom',
            path: ['requirementClassification', 'componentTypes'],
            message: '细分组成必须能够分配到原计划的工作类别；不能替换成不相符的领域',
          });
      }
      if (
        v.evaluation.version === 'work-1' &&
        v.requirementsLocked !== (v.evaluation.basis === 'before_execution')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['evaluation', 'basis'],
          message: '事前登记状态与评价依据不一致',
        });
      if (r.parts && !r.parts.some((p) => p.kind === v.kind))
        ctx.addIssue({
          code: 'custom',
          path: ['evaluation', 'requirements', 'parts'],
          message: '部分构成必须包含主要任务类别',
        });
      if (
        x.harnesses &&
        !x.harnesses.some(
          (h) =>
            h.id === v.harness.id &&
            h.version === v.harness.version &&
            (h.variant ?? null) === (v.harness.variant ?? null) &&
            (h.surface ?? 'unknown') === (v.harness.surface ?? 'unknown'),
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['evaluation', 'execution', 'harnesses'],
          message: '参与列表缺少主 Harness',
        });
      if (
        v.status === 'accepted' &&
        !(
          v.evaluation?.version === 'work-summary-1' &&
          v.evaluation.workStructure?.coverage === 'complete'
        ) &&
        ((r.parts &&
          ((o.partsAccepted !== null &&
            o.partsAccepted !== r.parts.reduce((s, p) => s + p.count, 0)) ||
            (o.partsCompleted !== null &&
              o.partsCompleted !== r.parts.reduce((s, p) => s + p.count, 0)))) ||
          o.integrationAccepted === false ||
          (r.integration === 'required' && o.integrationAccepted !== true))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['evaluation', 'outcome'],
          message: '根目标验收要求必需部分通过且整体整合验收通过',
        });
    }
    if (v.workload && v.workload.unit !== taskUnits[v.kind])
      ctx.addIssue({
        code: 'custom',
        path: ['workload', 'unit'],
        message: '工作单位需要与任务类别一致',
      });
    if (v.workload?.inputSize && v.workload.inputSize.unit !== taskInputUnits[v.kind])
      ctx.addIssue({
        code: 'custom',
        path: ['workload', 'inputSize', 'unit'],
        message: '输入规模的计量单位需要与任务类别一致',
      });
    if (
      v.workload?.inputUnits === '0' &&
      v.workload.inputSize &&
      !['none', 'unknown'].includes(v.workload.inputSize.band)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['workload', 'inputSize'],
        message: '没有输入材料时不能填写正材料规模',
      });
    if (taskDomain(v.kind) !== 'software' && ['component', 'module', 'service'].includes(v.scope))
      ctx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: '非软件任务使用单一成果、关联成果或跨系统范围',
      });
    if (taskDomain(v.kind) !== 'software' && v.changeSize !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['changeSize'],
        message: '非软件任务不填写代码变更规模',
      });
    const progressError = progressConflict(v.status, v.progress);
    if (progressError) ctx.addIssue({ code: 'custom', path: ['progress'], message: progressError });
    if (v.acceptancePassed > v.acceptanceTotal)
      ctx.addIssue({
        code: 'custom',
        path: ['acceptancePassed'],
        message: '通过项数超过验收项总数',
      });
    if (
      v.status === 'accepted' &&
      (v.acceptancePassed !== v.acceptanceTotal || v.acceptance === 'unknown')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: '已验收需要全部条件通过并记录验收方式',
      });
    const structure =
      v.evaluation?.version === 'work-summary-1' ? v.evaluation.workStructure : null;
    if (
      v.status === 'accepted' &&
      structure?.coverage === 'complete' &&
      (structure.requiredComponentCount === null ||
        structure.acceptedRequiredComponentCount !== structure.requiredComponentCount ||
        (structure.integrationRequired === true && structure.integrationAccepted !== true))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: '根目标验收需要全部必需部分通过，要求整合时还须通过整合验收',
      });
    const ids = v.models.map((m) => canonical([m.provider, m.model, m.version]));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['models'],
        message: '同一任务内相同模型请先合并调用，重试不能重复计任务数',
      });
    if (v.events && new Set(v.events.map((e) => e.kind)).size !== v.events.length)
      ctx.addIssue({
        code: 'custom',
        path: ['events'],
        message: '同类事件请合并次数，不能重复列出',
      });
    const knownOutput = v.models.every((m) => m.outputTokens !== null);
    const visibleOutput = v.models.reduce(
      (s, m) => s + (m.outputTokens ?? 0) - (m.reasoningTokens ?? 0),
      0,
    );
    if (
      knownOutput &&
      v.performance?.outputTokens != null &&
      v.performance.outputTokens > visibleOutput
    )
      ctx.addIssue({
        code: 'custom',
        path: ['performance', 'outputTokens'],
        message: '实测可见输出 Token 不能超过任务记录中的可见输出总量',
      });
  });

export const CollectionProcessingSchema = z
  .object({
    runId: uuid,
    purpose: z.literal('classification_redaction_summary'),
    method: z.enum(['program', 'ai', 'mixed', 'unknown']),
    inputBasis: z.enum(['incremental_history', 'structured_records', 'mixed', 'unknown']),
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
    status: z.enum(['complete', 'partial', 'unknown']),
    inputRecords: integer(1e9).nullable(),
    classifiedRecords: integer(1e9).nullable(),
    reusedRecords: integer(1e9).nullable(),
    modelRequests: integer(1e8).nullable(),
    agentCount: integer(1e6).nullable(),
    maxAgentDepth: integer(1e6).nullable(),
    models: z.array(UsageSchema).max(64),
    harnesses: z.array(HarnessIdentitySchema).max(64),
    costMinor: integer(1e10).nullable(),
    currency: z.enum(['CNY', 'USD', 'EUR']).nullable(),
    costRelation: z.enum(['included_in_period', 'outside_period', 'unknown']),
  })
  .strict()
  .superRefine((run, ctx) => {
    if (run.costMinor !== null && run.currency === null)
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: '整理费用需要币种；未测量不能补零',
      });
    if (run.startedAt && run.endedAt && Date.parse(run.endedAt) < Date.parse(run.startedAt))
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: '整理结束时间不能早于开始' });
    if (run.method === 'program' && (run.models.length > 0 || (run.modelRequests ?? 0) > 0))
      ctx.addIssue({ code: 'custom', path: ['method'], message: '发生模型调用不能声明纯程序整理' });
    if (
      run.inputRecords !== null &&
      run.classifiedRecords !== null &&
      run.reusedRecords !== null &&
      run.classifiedRecords + run.reusedRecords > run.inputRecords
    )
      ctx.addIssue({
        code: 'custom',
        path: ['classifiedRecords'],
        message: '新分类与复用记录不能重复计数',
      });
  });

export const EnvelopeSchema = z
  .object({
    schemaVersion: z.enum(['1.0', '1.1']),
    settlement: SettlementRevisionSchema.optional(),
    origin: z.enum(['real', 'synthetic']),
    // Historical records remain readable; every new intake requires a selected interval.
    collectionWindow: CollectionWindowSchema.nullable().optional(),
    // Measurement overhead stays explicit; never silently double-add it to task costs.
    collectionProcessing: z.array(CollectionProcessingSchema).max(100).optional(),
    period: z
      .object({
        id: uuid,
        month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
        currency: z.enum(['CNY', 'USD', 'EUR']),
        plan: publicId,
        planVersion: publicId,
        subscriptionRef: uuid.nullable().optional(),
        billing: z.enum(['api', 'subscription', 'mixed', 'unknown']),
        payment: z.enum(['regular', 'promotion', 'trial', 'grant', 'unknown']),
        paidMinor: integer(1e10).nullable(),
        refundMinor: integer(1e10).nullable(),
        allocation: z.enum(['direct', 'tokens', 'equal', 'unallocated', 'itemized']),
        costAttribution: CostAttributionSchema.optional(),
        chargeReconciliation: ChargeReconciliationSchema.optional(),
        unassignedWeight: integer(1e12),
        coverage: z.enum(['complete', 'partial']),
        selection: z.enum(['continuous', 'selected']),
        costCoverage: z.enum(['total_execution', 'model_only', 'unknown']).optional(),
        costComponents: CostComponentsSchema.optional(),
        // Context only: discounts and credits must never be added to net paid costs.
        billingBenefits: z
          .object({
            listEquivalentMinor: integer(1e10).nullable(),
            discountAppliedMinor: integer(1e10).nullable(),
            creditAppliedMinor: integer(1e10).nullable(),
            creditGrantedMinor: integer(1e10).nullable(),
            creditRemainingMinor: integer(1e10).nullable(),
            taxIncludedMinor: integer(1e10).nullable(),
            platformFeeIncludedMinor: integer(1e10).nullable(),
            creditExpiresAt: z.string().datetime().nullable(),
            offerSnapshotId: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    tasks: z.array(TaskSchema).max(500),
    quota: z
      .array(
        z
          .object({
            window: z.enum(['fixed', 'rolling']),
            windowHours: z.number().positive().max(9000),
            usedPercent: z.number().positive().max(100),
            tokens: integer(1e12),
            apiEquivalentMinor: integer(1e10).nullable(),
            isolated: z.boolean(),
            resetOccurred: z.boolean(),
            exact: z.boolean(),
          })
          .strict(),
      )
      .max(1),
    executionScope: ExecutionScopeSchema.nullable().optional(),
    collector: z
      .object({ id: publicId, version: publicId, digest: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .nullable(),
    consent: z
      .object({
        version: z.literal('opencost-1.0'),
        store: z.boolean(),
        statistics: z.boolean(),
        publicSummary: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const p = v.period;
    const net = p.paidMinor === null || p.refundMinor === null ? null : p.paidMinor - p.refundMinor;
    if (net === null && (p.allocation !== 'unallocated' || p.costAttribution || p.chargeReconciliation))
      ctx.addIssue({ code: 'custom', path: ['period', 'allocation'], message: '实付或退款未知时保留用量，费用不分摊；补齐账单后再提交费用归属' });
    if (net === null && v.tasks.some(t => t.evaluation?.execution.costScope === 'lifecycle_complete'))
      ctx.addIssue({ code: 'custom', path: ['tasks'], message: '账期净实付未知，不能声明完整任务费用' });
    if (
      v.tasks.reduce(
        (n, t) =>
          n +
          (t.observations?.codeMeasurements?.snapshots.length ?? 0) +
          (t.observations?.codeMeasurements?.patches.length ?? 0),
        0,
      ) > CODE_OBSERVATION_LIMITS.reports
    )
      ctx.addIssue({
        code: 'custom',
        path: ['tasks'],
        message: '单份上传最多附加256份代码或补丁数值报告，不自动截断',
      });
    if (v.settlement) {
      const tasks = new Set(v.tasks.map((t) => t.id));
      if (
        v.settlement.requirements.length !== tasks.size ||
        v.settlement.requirements.some((r) => !tasks.has(r.taskId))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['settlement'],
          message: '整份快照修订的要求映射必须覆盖相同全部根目标',
        });
    }
    if (v.executionScope?.coverage === 'complete') {
      const counts = v.tasks.map((t) => t.evaluation?.execution.agentCount);
      const depths = v.tasks.map((t) => t.evaluation?.execution.maxAgentDepth);
      if (
        v.tasks.some((t) => t.evaluation?.execution.agentCoverage !== 'complete') ||
        counts.some((n) => n == null || n > v.executionScope!.uniqueAgents!) ||
        counts.reduce<number>((sum, n) => sum + (n ?? 0), 0) !==
          v.executionScope.agentTaskAssignments ||
        depths.some((n) => n == null) ||
        Math.max(...depths.map((n) => n ?? 0)) !== v.executionScope.maxAgentDepth
      )
        ctx.addIssue({
          code: 'custom',
          path: ['executionScope'],
          message: '全局代理参与数必须与各目标的参与数一致；去重身份总数另计',
        });
    }
    if (
      v.collectionProcessing &&
      new Set(v.collectionProcessing.map((run) => run.runId)).size !== v.collectionProcessing.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['collectionProcessing'],
        message: '同一次整理只登记一次，不能重复计数费用',
      });
    if (v.schemaVersion === '1.1') {
      if (!p.costCoverage || !p.costComponents)
        ctx.addIssue({
          code: 'custom',
          path: ['period'],
          message: '1.1 需要明确费用覆盖范围及费用分类，未知分类填写 null',
        });
      v.tasks.forEach((task, i) => {
        if (!task.evaluation)
          ctx.addIssue({
            code: 'custom',
            path: ['tasks', i, 'evaluation'],
            message: '1.1 每项任务都需要结构化评价记录',
          });
        task.models.forEach((model, j) => {
          if (model.priceSnapshot === undefined)
            ctx.addIssue({
              code: 'custom',
              path: ['tasks', i, 'models', j, 'priceSnapshot'],
              message: '明确记录当时价格快照；未取得时填写 null，不能用当前标价补写历史',
            });
          const currencies = new Set([
            ...(model.priceSnapshot ? [model.priceSnapshot.currency] : []),
            ...(model.priceHistory ?? []).map((snapshot) => snapshot.currency),
          ]);
          if (
            model.apiEquivalentMinor !== null &&
            [...currencies].some(
              (currency) =>
                currency !== p.currency &&
                !model.equivalentConversions?.some(
                  (rate) => rate.from === currency && rate.to === p.currency,
                ),
            )
          )
            ctx.addIssue({
              code: 'custom',
              path: ['tasks', i, 'models', j, 'equivalentConversions'],
              message: '跨币种 API 等价金额必须保留换汇日期、汇率与历史快照依据',
            });
        });
      });
    }
    if (p.chargeReconciliation) {
      const r = p.chargeReconciliation,
        knownNet = net;
      if (
        !['itemized', 'unallocated'].includes(p.allocation) &&
        !(p.billing === 'api' && p.allocation === 'direct')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['period', 'allocation'],
          message: '费用包含摘要不能与旧整期分摊混用，请明确逐项归属或不归属',
        });
      if (
        knownNet === null ||
        (r.lowerBoundMinor !== null && r.lowerBoundMinor > knownNet) ||
        (r.status === 'reconciled' && r.knownTotalMinor !== knownNet) ||
        (r.lowerBoundMinor !== null && r.unexplainedMinor !== knownNet - r.lowerBoundMinor)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['period', 'chargeReconciliation'],
          message: '费用包含摘要须与账期净实付一致',
        });
      if (
        r.status !== 'reconciled' &&
        (p.costAttribution?.coverage === 'complete' ||
          v.tasks.some((t) => t.evaluation?.execution.costScope === 'lifecycle_complete'))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['period', 'chargeReconciliation'],
          message: '费用包含关系未完整核对，不能声称任务费用或逐项归属完整',
        });
      for (const [component, amount] of Object.entries(r.componentLowerBounds)) {
        const declared = p.costComponents?.[component as keyof typeof r.componentLowerBounds];
        if (amount !== null && declared != null && amount > declared)
          ctx.addIssue({
            code: 'custom',
            path: ['period', 'costComponents', component],
            message: '费用类别总额不能低于包含关系中的已知下界',
          });
      }
    }
    if (p.costComponents) {
      const values = Object.values(p.costComponents);
      const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
      if (
        net !== null && (sum > net || (values.every((v) => v !== null) && sum !== net))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['period', 'costComponents'],
          message: '费用分类是净实付的组成部分，已知分类不能超额，全部已知时合计必须相等',
        });
    }
    if (
      v.origin === 'real' &&
      (p.planVersion === 'demo' ||
        v.tasks.some(
          (t) =>
            t.harness.version === 'demo' ||
            t.models.some((m) => m.version === 'demo' || m.priceVersion?.startsWith('synthetic-')),
        ))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['origin'],
        message: '记录中仍有示例版本标记，请从真实记录采集，不能修改示例来源后上传',
      });
    if (p.refundMinor !== null && p.paidMinor !== null && p.refundMinor > p.paidMinor)
      ctx.addIssue({
        code: 'custom',
        path: ['period', 'refundMinor'],
        message: '退款不能超过本期付款',
      });
    if (new Set(v.tasks.map((t) => t.id)).size !== v.tasks.length)
      ctx.addIssue({ code: 'custom', path: ['tasks'], message: '任务标识重复，请合并重试记录' });
    validateCostAttribution(v, ctx);
    if (net !== null && p.billing === 'api' && !['direct', 'itemized'].includes(p.allocation))
      ctx.addIssue({
        code: 'custom',
        path: ['period', 'allocation'],
        message: 'API 实付使用逐任务账单金额，不能用估算替代',
      });
    if (p.billing !== 'api' && p.allocation === 'direct')
      ctx.addIssue({
        code: 'custom',
        path: ['period', 'allocation'],
        message: '含订阅费用时必须说明分摊方法',
      });
    if (p.billing !== 'api' && v.tasks.some((t) => t.directCostMinor !== null && t.directCostMinor !== 0))
      ctx.addIssue({
        code: 'custom',
        path: ['tasks'],
        message: '订阅及混合付费由周期总支出分摊，逐任务实付字段应为 0',
      });
    if (
      p.allocation === 'direct' &&
      (net === null || v.tasks.some(t => t.directCostMinor === null) || v.tasks.reduce((s, t) => s + (t.directCostMinor ?? 0), 0) > net)
    )
      ctx.addIssue({ code: 'custom', path: ['tasks'], message: '逐任务净费用合计超过账期净支出' });
    if (p.coverage === 'partial' && !['direct', 'unallocated', 'itemized'].includes(p.allocation))
      ctx.addIssue({
        code: 'custom',
        path: ['period', 'allocation'],
        message: '不完整的订阅周期不能推算单任务分摊成本',
      });
    if (
      p.allocation === 'tokens' &&
      v.tasks.some((t) => t.models.some((m) => m.inputTokens === null || m.outputTokens === null))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['period', 'allocation'],
        message: 'Token 总量缺失时不能按 Token 分摊费用',
      });
    if (v.consent.publicSummary && !v.consent.statistics)
      ctx.addIssue({
        code: 'custom',
        path: ['consent', 'publicSummary'],
        message: '公开分组摘要需要同时允许统计',
      });
    const usage = v.tasks.flatMap((t) => t.models);
    const tokensKnown = usage.every((m) => m.inputTokens !== null && m.outputTokens !== null);
    const equivalentKnown = usage.every((m) => m.apiEquivalentMinor !== null);
    const tokenTotal = usage.reduce(
      (sum, m) => sum + (m.inputTokens ?? 0) + (m.outputTokens ?? 0),
      0,
    );
    const equivalentTotal = usage.reduce((sum, m) => sum + (m.apiEquivalentMinor ?? 0), 0);
    if (v.quota.some((q) => tokensKnown && q.tokens > tokenTotal))
      ctx.addIssue({
        code: 'custom',
        path: ['quota'],
        message: '额度观察中的 Token 不能超出本期记录范围',
      });
    if (
      v.quota.some(
        (q) =>
          equivalentKnown &&
          q.apiEquivalentMinor !== null &&
          q.apiEquivalentMinor > equivalentTotal,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['quota'],
        message: '额度观察的 API 等价金额不能超出本期记录范围',
      });
  });

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type Evidence = {
  cost: 'C0' | 'C1' | 'C2';
  work: 'W0' | 'W1' | 'W2';
  coverage: 'declared' | 'verified';
  issuer: string | null;
  source: string | null;
  quota?: 'Q0' | 'Q2';
};
export const MIN_TASKS = 20;
export const MIN_SOURCES = 5;
export const MAX_SOURCE_SHARE = 0.35;

export const AttestationSchema = z
  .object({
    issuer: publicId,
    subject: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().regex(/^[a-f0-9]{64}$/),
    contributor: z.string().regex(/^[a-f0-9]{64}$/),
    coverageRef: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    nonce: uuid,
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    checks: z
      .object({
        cost: z.boolean(),
        work: z.boolean(),
        coverage: z.boolean(),
        quota: z.boolean().optional(),
      })
      .strict(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.checks.coverage && !value.coverageRef)
      ctx.addIssue({
        code: 'custom',
        path: ['coverageRef'],
        message: '连续范围核验需要验证方签发的稳定账期标识',
      });
  });
export type Attestation = z.infer<typeof AttestationSchema>;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}

export function workSummary(task: Task): string {
  return [
    labels.context[task.context],
    labels.kind[task.kind],
    labels.scope[task.scope],
    `${task.acceptanceTotal} 项验收`,
    labels.acceptance[task.acceptance],
    ...(task.workload
      ? [
          `${workloadLabels.outputUnits[task.workload.outputUnits]}${workloadLabels.unit[task.workload.unit]}`,
          `${workloadLabels.inputUnits[task.workload.inputUnits]}输入材料`,
          `${workloadLabels.constraintCount[task.workload.constraintCount]}附加约束`,
          workloadLabels.verification[task.workload.verification],
          ...(task.workload.inputSize
            ? [inputSizeLabels[task.workload.inputSize.unit][task.workload.inputSize.band]]
            : ['材料规模未记录']),
        ]
      : ['工作量细项未记录']),
  ].join(' / ');
}
