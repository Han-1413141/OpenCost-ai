import { PriceMeteringSummarySchema, summarizePriceMetering } from './price-metering.js';
import {
  CodeObservationInsightsSchema,
  analyzeCodeObservations,
} from './code-observation-insights.js';
import { z } from 'zod';
import { allocate } from './analysis.js';
import { allocateItemized } from './cost-attribution.js';
import { ChargeReconciliationSchema, hasReconciledCharges } from './charge-reconciliation.js';
import { labels, type Envelope, type Task } from './schema.js';
import { taskProgress, isTaskEnded, progressPhaseLabels } from './task-progress.js';

const count = z.number().int().nonnegative().max(1e7);
const measured = z.number().finite().nonnegative().nullable();
const MetricSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    label: z.string().min(1).max(100),
    value: measured,
    unit: z.string().min(1).max(40),
    known: count,
    expected: count,
    numerator: measured.optional(),
    denominator: measured.optional(),
    note: z.string().min(1).max(600),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.known > m.expected)
      ctx.addIssue({ code: 'custom', message: '已知观察数不能超过应观察数' });
  });

export const TaskInsightsSchema = z
  .object({
    version: z.literal('task-insights-1'),
    scope: z.literal('current_record'),
    inference: z.literal('descriptive_only'),
    currency: z.enum(['CNY', 'USD', 'EUR']),
    priceMetering: PriceMeteringSummarySchema.optional(),
    codeMeasurements: CodeObservationInsightsSchema.optional(),
    chargeReconciliation: ChargeReconciliationSchema.optional(),
    costAttribution: z
      .object({
        version: z.literal('cost-attribution-1'),
        coverage: z.enum(['complete', 'partial']),
        entries: count,
        coveredTasks: count,
        totalTasks: count,
        directMinor: measured.unwrap(),
        sharedMinor: measured.unwrap(),
        unallocatedMinor: measured.unwrap(),
        note: z.string().max(600),
      })
      .strict()
      .optional(),
    groups: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
            label: z.string().min(1).max(100),
            metrics: z.array(MetricSchema).max(32),
          })
          .strict(),
      )
      .max(16),
    costByStatus: z
      .array(
        z
          .object({
            status: z.enum(['accepted', 'partial', 'failed', 'abandoned', 'in_progress']),
            label: z.string().min(1).max(100),
            tasks: count,
            allocatedMinor: measured,
            shareOfAllocated: z.number().finite().min(0).max(1).nullable(),
            known: count,
            expected: count,
          })
          .strict(),
      )
      .length(5),
    limitations: z.array(z.string().min(1).max(600)).max(16),
  })
  .strict();

export type TaskInsights = z.infer<typeof TaskInsightsSchema>;
export const taskInsightUnitLabels: Record<string, string> = {
  goals: '项目标',
  turns: '轮',
  calls: '次调用',
  attempts: '次尝试',
  agents: '个代理',
  levels: '层',
  milliseconds: '毫秒',
  events: '次事件',
  minutes: '分钟',
  attempts_per_accepted_goal: '次尝试 / 验收目标',
};
type Metric = z.infer<typeof MetricSchema>;
type Group = TaskInsights['groups'][number];
const statuses = ['accepted', 'partial', 'failed', 'abandoned', 'in_progress'] as const;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const moneySum = (values: (number | null)[]) => values.some(v => v === null) ? null : sum(values as number[]);
const present = (value: number | null | undefined): value is number => value != null;
const ratio = (numerator: number | null, denominator: number | null) =>
  numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;

function metric(
  id: string,
  label: string,
  value: number | null,
  unit: string,
  known: number,
  expected: number,
  note: string,
  numerator?: number | null,
  denominator?: number | null,
): Metric {
  return {
    id,
    label,
    value,
    unit,
    known,
    expected,
    note,
    ...(numerator !== undefined ? { numerator } : {}),
    ...(denominator !== undefined ? { denominator } : {}),
  };
}

function proportion(
  id: string,
  label: string,
  numerator: number | null,
  denominator: number | null,
  known: number,
  expected: number,
  note: string,
) {
  return metric(
    id,
    label,
    numerator !== null && denominator !== null && denominator > 0 ? (numerator / denominator) * 100 : null,
    '%',
    known,
    expected,
    note,
    numerator,
    denominator,
  );
}

function subtotal(
  id: string,
  label: string,
  values: (number | null | undefined)[],
  unit: string,
  note: string,
): Metric {
  const observed = values.filter(present);
  return metric(
    id,
    label,
    observed.length ? sum(observed) : null,
    unit,
    observed.length,
    values.length,
    note,
  );
}

// Linear interpolation between adjacent order statistics (Hyndman–Fan type 7).
function quantile(sorted: number[], probability: number): number | null {
  if (!sorted.length) return null;
  const location = (sorted.length - 1) * probability;
  const lower = Math.floor(location);
  return sorted[lower] + (sorted[Math.ceil(location)] - sorted[lower]) * (location - lower);
}

function distribution(
  id: string,
  label: string,
  values: (number | null)[],
  unit: string,
  note: string,
): Metric[] {
  const sorted = values.filter(present).sort((a, b) => a - b);
  const total = sum(sorted);
  const topCount = Math.ceil(sorted.length * 0.2);
  const top = topCount ? sum(sorted.slice(-topCount)) : 0;
  return [
    metric(
      `${id}_median`,
      `${label}中位数`,
      quantile(sorted, 0.5),
      unit,
      sorted.length,
      values.length,
      `${note}按线性插值计算，仅描述已知任务。`,
    ),
    metric(
      `${id}_p90`,
      `${label} P90`,
      quantile(sorted, 0.9),
      unit,
      sorted.length,
      values.length,
      `${note}按线性插值计算；少量任务的分位数不能代表长期尾部。`,
    ),
    proportion(
      `${id}_top20_share`,
      `${label}最高 20% 任务占比`,
      top,
      total,
      sorted.length,
      values.length,
      `${note}按已知任务数向上取整选取 ${topCount} 个任务，分母为已知任务${label}之和；不是全量承诺或因果结论。`,
    ),
  ];
}

function structure(task: Task) {
  return task.evaluation?.version === 'work-summary-1' ? task.evaluation.workStructure : null;
}

/** A bounded, local description of one validated, redacted contribution. */
export function analyzeTaskInsights(envelope: Envelope): TaskInsights {
  const tasks = envelope.tasks;
  const n = tasks.length;
  const accepted = tasks.filter((task) => task.status === 'accepted').length;
  const progress = tasks.map(taskProgress);
  const ended = tasks.filter(isTaskEnded);
  const currency = `${envelope.period.currency}_minor`;
  const groups: Group[] = [];
  const rootNote = '以本条记录的独立根目标为单位；组成部分、重试和所有层级子代理都不增加根目标数。';
  groups.push({
    id: 'outcomes',
    label: '目标结果',
    metrics: [
      metric('root_goals', '独立根目标', n, 'goals', n, n, rootNote),
      ...statuses.flatMap((status) => {
        const amount = tasks.filter((task) => task.status === status).length;
        return [
          metric(
            `goals_${status}`,
            `${labels.status[status]}目标`,
            amount,
            'goals',
            n,
            n,
            rootNote,
          ),
          proportion(
            `goals_${status}_share`,
            `${labels.status[status]}目标占比`,
            amount,
            n,
            n,
            n,
            `${rootNote}进行中目标仍保留在分母；不按完成率拆组。`,
          ),
        ];
      }),
    ],
  });

  const money = allocate(envelope);
  const allocationAvailable =
    money.net !== null &&
    hasReconciledCharges(envelope.period) &&
    ((envelope.period.allocation === 'itemized' &&
      envelope.period.costAttribution?.coverage === 'complete') ||
      envelope.period.allocation === 'direct' ||
      (envelope.period.allocation === 'equal' && n + envelope.period.unassignedWeight > 0) ||
      (envelope.period.allocation === 'tokens' &&
        tasks.every((task) =>
          task.models.every((model) => model.inputTokens !== null && model.outputTokens !== null),
        ) &&
        tasks.reduce(
          (total, task) =>
            total +
            task.models.reduce((v, model) => v + model.inputTokens! + model.outputTokens!, 0),
          envelope.period.unassignedWeight,
        ) > 0));
  const assigned = moneySum(money.costs);
  const progressNote =
    '执行阶段与验收结果分别记录；暂停、等待、阻塞、会话中断或单次检查失败均不等于最终失败。来源声明不等于独立证明。';
  groups.push({
    id: 'progress',
    label: '任务是否结束与未完成原因',
    metrics: [
      ...Object.entries(progressPhaseLabels).map(([phase, label]) =>
        metric(
          `phase_${phase}`,
          label,
          progress.filter((p) => p.phase === phase).length,
          'goals',
          progress.filter((p) => p.phase !== 'unknown').length,
          n,
          progressNote,
        ),
      ),
      metric(
        'reported_model_limit',
        '记录称模型无法完成且已结束',
        tasks.filter(
          (task) =>
            isTaskEnded(task) &&
            ['failed', 'partial'].includes(task.status) &&
            task.progress?.reason === 'model_limit',
        ).length,
        'goals',
        tasks.filter((task) => task.progress && task.progress.reason !== 'unknown').length,
        n,
        '只统计明确记录的原因；最终未通过不自动归因模型能力，模型自述也不是独立核验。',
      ),
      proportion(
        'final_completion',
        '全部目标结束后的验收率',
        accepted,
        n,
        ended.length,
        n,
        '全部根目标结束后才计算；不能删除仍在做的目标来提高完成率。只有部分成果不等于整个目标验收。',
      ),
      metric(
        'unfinished_cost',
        '尚未结束或结束情况未知的已归属费用',
        allocationAvailable ? moneySum(money.costs.filter((_, i) => !isTaskEnded(tasks[i]))) : null,
        currency,
        allocationAvailable ? n : 0,
        n,
        '包含仍在执行、暂停、等待、阻塞及结束情况未知目标；保留投入，不把这部分金额叫作失败损失。',
      ),
    ].map((m) =>
      m.id === 'final_completion' && ended.length !== n
        ? { ...m, value: null, numerator: null, denominator: null }
        : m,
    ),
  });
  const costNote =
    '使用本条记录的净费用及指定分摊规则；只表示已归属部分，缺失费用不补零。按 Token 或均摊的金额是分配结果，不是逐任务账单。费用含各状态与重试消耗，未验收金额不等于浪费。';
  groups.push({
    id: 'cost',
    label: '费用与归属',
    metrics: [
      metric(
        'net_cost',
        '记录净费用',
        money.net,
        currency,
        money.net === null ? 0 : 1,
        1,
        `${costNote}净费用为实付减退款，不再加回折扣或赠送额度；未覆盖的外部费用仍未知。`,
      ),
      metric(
        'allocated_cost',
        '已分摊到目标的费用',
        assigned,
        currency,
        allocationAvailable ? n : 0,
        n,
        costNote,
      ),
      metric(
        'unallocated_cost',
        '未分摊费用',
        money.unallocated,
        currency,
        money.unallocated === null ? 0 : 1,
        1,
        '净费用减各目标分摊金额，保留未归属部分；不会按目标状态猜测去向。',
      ),
      proportion(
        'cost_attribution_share',
        '净费用归属覆盖',
        assigned,
        money.net,
        allocationAvailable ? n : 0,
        n,
        '分母为本条记录净费用；零支出没有可定义的金额占比。全额分摊不代表已采集所有外部费用。',
      ),
      metric(
        'net_cost_per_accepted',
        '每个已验收目标对应净费用',
        ratio(money.net, accepted),
        currency,
        n,
        n,
        `${costNote}分子包含记录内全部状态费用；零验收时不可定义。`,
        money.net,
        accepted,
      ),
      ...distribution(
        'task_cost',
        '分摊费用',
        money.costs.map((value) => (allocationAvailable ? value : null)),
        currency,
        `${costNote}未分摊费用未进入任务分布。`,
      ),
    ],
  });
  const costByStatus: TaskInsights['costByStatus'] = statuses.map((status) => {
    const indexes = tasks.map((task, i) => (task.status === status ? i : -1)).filter((i) => i >= 0);
    const allocatedMinor = allocationAvailable ? moneySum(indexes.map((i) => money.costs[i])) : null;
    return {
      status,
      label: labels.status[status],
      tasks: indexes.length,
      allocatedMinor,
      shareOfAllocated: allocatedMinor === null ? null : ratio(allocatedMinor, assigned),
      known: allocationAvailable ? indexes.length : 0,
      expected: indexes.length,
    };
  });

  const retries = sum(tasks.map((task) => task.attempts - 1));
  groups.push({
    id: 'attempts',
    label: '尝试与返工',
    metrics: [
      proportion(
        'retried_goal_share',
        '发生再次尝试的目标占比',
        tasks.filter((task) => task.attempts > 1).length,
        n,
        n,
        n,
        '以实际记录的 attempts > 1 为准；再次尝试不是新增工作成果，也不等同于每次请求重发。',
      ),
      metric(
        'additional_attempts',
        '额外执行尝试',
        retries,
        'attempts',
        n,
        n,
        '逐目标累计 attempts − 1；不推断缺失的失败原因或各次尝试费用。',
      ),
      metric(
        'additional_attempts_per_accepted',
        '每个已验收目标对应额外尝试',
        ratio(retries, accepted),
        'attempts_per_accepted_goal',
        n,
        n,
        '分子包含所有状态目标的额外尝试，零验收时不可定义；不能解释为已验收目标自身的重试次数。',
        retries,
        accepted,
      ),
      subtotal(
        'observed_rework',
        '已记录返工次数',
        tasks.map((task) => task.reworkCount),
        'events',
        '只累计已知任务的返工计数；缺失不补零，返工不与尝试数相加。',
      ),
    ],
  });

  const execution = tasks.map((task) => task.evaluation?.execution);
  const toolPairs = execution.filter(
    (value) => value?.toolCalls != null && value.toolFailures !== null,
  );
  groups.push({
    id: 'execution',
    label: '人工、对话与代理',
    metrics: [
      proportion(
        'tool_failure_share',
        '已观察工具失败率',
        sum(toolPairs.map((value) => value!.toolFailures!)),
        sum(toolPairs.map((value) => value!.toolCalls!)),
        toolPairs.length,
        n,
        '仅使用工具调用数与失败数同时已知的同一组任务；零调用时失败率不可定义，其他任务没有被当作零失败。',
      ),
      subtotal(
        'observed_human_minutes',
        '已记录人工用时',
        tasks.map((task) => task.humanMinutes),
        'minutes',
        '只累计实际记录的人工活动分钟；任务跨度和等待时间不能替代人工用时，缺失不补零。',
      ),
      subtotal(
        'observed_human_interventions',
        '已记录人工介入',
        execution.map((value) => value?.humanInterventions),
        'events',
        '仅累计已知介入事件，不据此推断人工用时或模型错误。',
      ),
      subtotal(
        'observed_user_turns',
        '已记录用户轮次',
        execution.map((value) => value?.userTurns),
        'turns',
        '按上传的用户轮次计数，不将工具结果、系统消息和代理分发当作用户轮次。',
      ),
      subtotal(
        'observed_assistant_turns',
        '已记录助手轮次',
        execution.map((value) => value?.assistantTurns),
        'turns',
        '只累计已知任务的助手轮次；轮次不是成果数量或难度。',
      ),
      subtotal(
        'observed_model_calls',
        '已记录模型调用',
        execution.map((value) => value?.modelCalls),
        'calls',
        '只累计已知调用数；子代理调用应包含在对应根目标消耗中，不重复增加任务数。',
      ),
      proportion(
        'complete_agent_coverage_share',
        '递归代理完整覆盖目标占比',
        execution.filter((value) => value?.agentCoverage === 'complete').length,
        n,
        n,
        n,
        '只有明确记录 agentCoverage=complete 才计为完整；partial、unknown 和未记录均保留在分母，覆盖声明本身不是独立真实性认证。',
      ),
      metric(
        'unique_agents',
        '整条记录去重代理数',
        envelope.executionScope?.coverage === 'complete'
          ? envelope.executionScope.uniqueAgents
          : null,
        'agents',
        envelope.executionScope?.coverage === 'complete' ? 1 : 0,
        1,
        '仅使用整条记录的完整执行范围；同一代理参与多个目标时不相加各任务代理数，以免重复计算。',
      ),
      metric(
        'max_observed_agent_depth',
        '已知最大代理深度',
        execution.some((value) => value?.maxAgentDepth != null)
          ? Math.max(
              ...execution.flatMap((value) =>
                value?.maxAgentDepth == null ? [] : [value.maxAgentDepth],
              ),
            )
          : null,
        'levels',
        execution.filter((value) => value?.maxAgentDepth != null).length,
        n,
        '根代理深度为 0；仅为已知任务的最大值，不保证缺失或部分覆盖任务中没有更深层子代理。',
      ),
    ],
  });

  const models = tasks.flatMap((task) => task.models);
  const cachePairs = models.filter(
    (model) => model.cachedInputTokens !== null && model.inputTokens !== null,
  );
  const reasoningPairs = models.filter(
    (model) => model.reasoningTokens !== null && model.outputTokens !== null,
  );
  groups.push({
    id: 'tokens',
    label: 'Token 构成',
    metrics: [
      proportion(
        'cached_input_share',
        '已知输入 Token 中缓存读取占比',
        sum(cachePairs.map((model) => model.cachedInputTokens!)),
        sum(cachePairs.map((model) => model.inputTokens!)),
        cachePairs.length,
        models.length,
        '覆盖单位为任务内模型用量记录；分子分母使用相同的字段完整记录。输入已含缓存，不重复相加；不能从占比直接推断节省金额。',
      ),
      proportion(
        'reasoning_output_share',
        '已知输出 Token 中思考占比',
        sum(reasoningPairs.map((model) => model.reasoningTokens!)),
        sum(reasoningPairs.map((model) => model.outputTokens!)),
        reasoningPairs.length,
        models.length,
        '覆盖单位为任务内模型用量记录；输出已含思考 Token，不重复相加。该占比不衡量推理质量或任务难度。',
      ),
    ],
  });
  groups.push({
    id: 'duration',
    label: '任务耗时分布',
    metrics: distribution(
      'task_wall',
      '任务耗时',
      tasks.map((task) => task.performance?.wallMs ?? null),
      'milliseconds',
      '仅使用每个任务记录的 wallMs。不同任务可能并发，任务耗时之和不代表整个采集窗口时长；modelWallMs 与 toolWallMs 不相加为等待占比。',
    ),
  });

  const structures = tasks.map(structure);
  const requiredPairs = structures.filter(
    (value) =>
      value?.coverage === 'complete' &&
      value.requiredComponentCount !== null &&
      value.acceptedRequiredComponentCount !== null,
  );
  const integrationRequired = structures.filter((value) => value?.integrationRequired === true);
  const integrationKnown = integrationRequired.filter(
    (value) => value!.integrationAccepted !== null,
  );
  const knownCoupling = structures.filter(
    (value) => value?.coverage === 'complete' && value.coupling !== 'unknown',
  );
  const couplingLabels = {
    single: '单一部分',
    independent: '独立部分',
    pipeline: '顺序依赖',
    shared_state: '共享状态',
    iterative: '反复协作',
    mixed: '混合耦合',
  } as const;
  groups.push({
    id: 'structure',
    label: '组成部分与整体整合',
    metrics: [
      proportion(
        'required_component_acceptance',
        '已知必需部分验收率',
        sum(requiredPairs.map((value) => value!.acceptedRequiredComponentCount!)),
        sum(requiredPairs.map((value) => value!.requiredComponentCount!)),
        requiredPairs.length,
        n,
        '只使用结构完整且必需部分总数和验收数同时已知的目标；分母是必需部分，不与根目标、成果量或 Token 混合。',
      ),
      proportion(
        'integration_acceptance',
        '已知整体整合验收率',
        integrationKnown.filter((value) => value!.integrationAccepted === true).length,
        integrationKnown.length,
        integrationKnown.length,
        integrationRequired.length,
        '只比较明确要求整体整合的目标，且结果必须已知；缺失整合要求的目标未纳入此适用分母，不代表无需整合。组成部分通过不能替代整体整合通过。',
      ),
      ...Object.entries(couplingLabels).map(([coupling, label]) =>
        proportion(
          `coupling_${coupling}_share`,
          `${label}目标占比`,
          knownCoupling.filter((value) => value!.coupling === coupling).length,
          knownCoupling.length,
          knownCoupling.length,
          n,
          '分母为完整结构且耦合类型已知的根目标；类型描述任务连接方式，不自动转换为难度分数。',
        ),
      ),
    ],
  });

  if (tasks.some((task) => task.observations?.validation)) {
    const validation = tasks.map((task) => task.observations?.validation);
    const plannedPairs = validation.filter(
      (value) =>
        value?.meta.coverage === 'complete' &&
        ['before_execution', 'approved_change'].includes(value.planBasis ?? '') &&
        value.criteriaPlanned != null &&
        value.criteriaExecuted != null,
    );
    const criticalPairs = validation.filter(
      (value) =>
        value?.meta.coverage === 'complete' &&
        ['before_execution', 'approved_change'].includes(value.planBasis ?? '') &&
        value.criticalCriteriaPlanned != null &&
        value.criticalCriteriaPassed != null,
    );
    const independenceKnown = validation.filter(
      (value) =>
        value?.meta.coverage === 'complete' &&
        value.independence != null &&
        value.independence !== 'unknown',
    );
    groups.push({
      id: 'validation',
      label: '验收执行与独立核查',
      metrics: [
        proportion(
          'validation_execution_share',
          '事前或批准计划的验收执行覆盖',
          sum(plannedPairs.map((value) => value!.criteriaExecuted!)),
          sum(plannedPairs.map((value) => value!.criteriaPlanned!)),
          plannedPairs.length,
          n,
          '使用观察完整且计划依据为执行前或已批准变更的同一组目标；分母为验收项，事后补写、未执行和验收通过是不同概念。',
        ),
        proportion(
          'critical_validation_pass_share',
          '已知关键验收项通过率',
          sum(criticalPairs.map((value) => value!.criticalCriteriaPassed!)),
          sum(criticalPairs.map((value) => value!.criticalCriteriaPlanned!)),
          criticalPairs.length,
          n,
          '只使用完整观察和事前或批准变更计划；未通过关键项不能由普通项通过数抵消，未记录关键项不等于没有关键项。',
        ),
        proportion(
          'separate_validation_share',
          '已知独立人工或工具核查目标占比',
          independenceKnown.filter(
            (value) =>
              value!.independence === 'separate_human' || value!.independence === 'separate_tool',
          ).length,
          independenceKnown.length,
          independenceKnown.length,
          n,
          '仅计明确的独立人工或独立工具核查；mixed 不代表全部核查独立，self_check 不算独立。上传的独立性声明仍需要来源支持。',
        ),
      ],
    });
  }

  if (tasks.some((task) => task.observations?.time)) {
    const exclusive = tasks.filter(
      (task) =>
        task.observations?.time?.partition === 'exclusive' &&
        task.observations.time.meta.coverage === 'complete' &&
        task.performance?.wallMs != null,
    );
    const timeLabels = {
      activeMs: '执行活动',
      waitingUserMs: '等待用户',
      waitingExternalMs: '等待外部服务',
      pausedMs: '暂停',
      unknownMs: '未分类耗时',
    } as const;
    groups.push({
      id: 'time_partition',
      label: '互斥时间构成',
      metrics: Object.entries(timeLabels).map(([key, label]) => {
        const field = key as keyof typeof timeLabels;
        const matched = exclusive.filter((task) => task.observations!.time![field] != null);
        return proportion(
          `exclusive_${field.replace(/Ms$/, '').replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase())}_share`,
          `${label}占已知任务耗时`,
          sum(matched.map((task) => task.observations!.time![field]!)),
          sum(matched.map((task) => task.performance!.wallMs!)),
          matched.length,
          n,
          '仅使用完整观察、明确互斥且本分量与 wallMs 同时已知的相同任务集合；不同分量覆盖集合可能不同，比例不可相加。重叠计时不计算该占比，也不混加模型与工具耗时。',
        );
      }),
    });
  }

  if (tasks.some((task) => task.observations?.followup)) {
    const followup = tasks.map((task) => task.observations?.followup);
    groups.push({
      id: 'followup',
      label: '交付后随访',
      metrics: [7, 30].flatMap((days) => {
        const window = followup.filter((value) => value?.windowDays === days);
        const complete = window.filter(
          (value) => value!.status === 'complete' && value!.meta.coverage === 'complete',
        );
        const reopens = complete.filter((value) => value!.reopenedCount != null);
        const defects = complete.filter((value) => value!.delayedDefectCount != null);
        return [
          proportion(
            `followup_${days}d_reopened_share`,
            `${days} 天完整随访中的任务重开占比`,
            reopens.filter((value) => value!.reopenedCount! > 0).length,
            reopens.length,
            reopens.length,
            n,
            `分母仅包含完成 ${days} 天随访且重开计数已知的目标；不混合 7 天与 30 天，不将尚未观察完整或未随访任务计为没有重开。`,
          ),
          proportion(
            `followup_${days}d_delayed_defect_share`,
            `${days} 天完整随访中的延迟缺陷任务占比`,
            defects.filter((value) => value!.delayedDefectCount! > 0).length,
            defects.length,
            defects.length,
            n,
            `分母仅包含完成 ${days} 天随访且延迟缺陷计数已知的目标；反映任务是否出现缺陷，不把缺陷事件总数当作任务数，也不推断模型归因。`,
          ),
          metric(
            `followup_${days}d_right_censored`,
            `${days} 天随访尚未观察完整的目标`,
            window.length
              ? window.filter((value) => value!.status === 'right_censored').length
              : null,
            'goals',
            window.length,
            n,
            '右删失表示观察在完整窗口结束前截止；本指标保留这部分任务，不进行生存率估计，不把未观察到事件解释为长期无缺陷。',
          ),
        ];
      }),
    });
  }

  if (tasks.some((task) => task.observations?.history)) {
    const histories = tasks.map((task) => task.observations?.history);
    const note =
      '仅描述本次提供的要求事件历史；原验收和当前核对分别保留，重开、变更与多个验收事件均不增加根目标数。缺项不补零，来源声明不等于认证。';
    const totals = [
      ['approvedChanges', 'history_scope_changes', '已批准的要求变更'],
      ['pendingProposals', 'history_pending_proposals', '尚未确认的要求提案'],
      ['reopenedCount', 'history_reopen_events', '同一目标重开事件'],
      ['acceptanceEvents', 'history_acceptance_events', '历次验收事件'],
    ] as const;
    groups.push({
      id: 'requirement_history',
      label: '要求版本、历史验收与重开',
      metrics: [
        ...totals.map(([field, id, label]) =>
          subtotal(
            id,
            label,
            histories.map((h) => h?.[field]),
            'events',
            note,
          ),
        ),
        ...(
          [
            ['originalAcceptedHistorically', 'history_original_accepted', '原要求曾验收的目标'],
            [
              'originalVerifiedNow',
              'history_original_verified_now',
              '原要求在当前成果上已核对通过的目标',
            ],
            ['activeReopen', 'history_active_reopens', '重开后仍在执行的目标'],
          ] as const
        ).map(([field, id, label]) => {
          const known = histories.filter((h) => h?.[field] != null);
          return metric(
            id,
            label,
            known.length ? known.filter((h) => h![field] === true).length : null,
            'tasks',
            known.length,
            n,
            note,
          );
        }),
      ],
    });
  }
  const attribution = envelope.period.allocation === 'itemized' ? allocateItemized(envelope) : null;
  const priceMetering = summarizePriceMetering(
    envelope.tasks.flatMap((t) => t.models),
    envelope.period.currency,
  );
  const codeMeasurements = analyzeCodeObservations(tasks);
  return TaskInsightsSchema.parse({
    version: 'task-insights-1',
    scope: 'current_record',
    inference: 'descriptive_only',
    currency: envelope.period.currency,
    ...(priceMetering ? { priceMetering } : {}),
    ...(codeMeasurements ? { codeMeasurements } : {}),
    ...(envelope.period.chargeReconciliation
      ? { chargeReconciliation: envelope.period.chargeReconciliation }
      : {}),
    ...(attribution
      ? {
          costAttribution: {
            version: 'cost-attribution-1',
            coverage: attribution.complete ? 'complete' : 'partial',
            entries: envelope.period.costAttribution?.entries.length ?? 0,
            coveredTasks: attribution.coveredTasks,
            totalTasks: n,
            directMinor: sum(attribution.direct),
            sharedMinor: sum(attribution.shared),
            unallocatedMinor: attribution.unallocated,
            note: '直接归属与共享分摊分别相加，合计再加未归属费用等于本次净实付。部分明细只表示已知归属，不代表任务全部费用。共享分摊是会计分配；金额守恒不能证明账单真实、互斥或完整。',
          },
        }
      : {}),
    groups,
    costByStatus,
    limitations: [
      '这些指标只描述本条上传记录，不能代表用户全部工作或真实人群；选择性上传和缺失字段会改变观察结果。',
      'known / expected 表示该指标已知和应观察的记录数，具体单位见说明；部分覆盖时数值只代表已知范围，未知不是零。',
      '费用、结果、人工用时、任务结构与执行消耗分别展示，不跨单位相加成总分，也不把更多 Token、轮次或子代理当作更难或更多成果。',
      '没有随机分配和共同任务对照时，描述性差异不能证明模型或 Harness 导致结果变化；本分析不提供因果结论或人群置信区间。',
      '摘要中的计数和验收声明仍取决于采集来源；哈希与结构校验只能检验一致性，不能证明任务真实发生或已经独立验收。',
    ],
  });
}
