import { z } from 'zod';
import { TaskSchema, type Task } from './schema.js';
import { difficultyFramework } from './difficulty-framework.js';
import {
  computeDifficultyReview,
  DifficultyReviewSchema,
  type DifficultyReviewInput,
} from './difficulty-review.js';
import type { ObservationMeta, TaskObservations } from './task-observations.js';

// Local, explicit research only. These rules describe requirements and graph
// structure; they are not fitted estimates of success, cost or human effort.
export const TASK_COMPLEXITY_VERSION = 'task-complexity-research-1' as const;
export const taskComplexityLimits = {
  inputBytes: 1_048_576,
  entries: 30_000,
  depth: 32,
  graphNodes: 256,
  graphEdges: 2_048,
  stateGroups: 256,
} as const;

const definition = <T extends string>(
  id: T,
  label: string,
  role: 'requirement' | 'input_condition' | 'method' | 'constraint',
  categories: readonly string[],
  orderedCategories: readonly string[] | null = null,
) => ({
  id,
  field: id,
  fieldRef: `observations.requirements.${id}`,
  label,
  role,
  categories,
  orderedCategories,
});

export const taskComplexityDimensions = [
  definition('clarity', '需求明确程度', 'input_condition', [
    'specified',
    'incomplete',
    'conflicting',
  ]),
  definition('inputCondition', '原始材料条件', 'input_condition', [
    'clean',
    'missing',
    'inconsistent',
    'noisy',
    'mixed',
  ]),
  definition(
    'solutionNovelty',
    '方案构造要求',
    'requirement',
    ['repeat', 'adaptation', 'new_solution'],
    ['repeat', 'adaptation', 'new_solution'],
  ),
  definition(
    'knowledge',
    '知识要求',
    'requirement',
    ['general', 'specialist', 'research'],
    ['general', 'specialist', 'research'],
  ),
  // Formal proof and open-ended inquiry are different obligations, not a scale.
  definition('reasoning', '推理与论证要求', 'requirement', [
    'routine',
    'multi_step',
    'formal',
    'open_ended',
  ]),
  definition('methodFamilies', '必要方法类别', 'method', [
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
  ]),
  definition('constraintKinds', '必须保持的约束', 'constraint', [
    'correctness',
    'performance',
    'security',
    'compatibility',
    'format',
    'accessibility',
    'source_traceability',
    'resource_limit',
    'deadline',
  ]),
  definition('contextReuse', '原有材料复用条件', 'input_condition', [
    'fresh',
    'continued',
    'template_based',
  ]),
] as const;

export type TaskComplexityDimensionId = (typeof taskComplexityDimensions)[number]['id'];
export type TaskComplexityDimension = {
  id: TaskComplexityDimensionId;
  label: string;
  role: (typeof taskComplexityDimensions)[number]['role'];
  value: string | string[] | null;
  ordinalPosition: number | null;
  fieldRefs: string[];
  source: ObservationMeta['source'];
  timing: ObservationMeta['timing'];
  coverage: ObservationMeta['coverage'];
  status: 'known' | 'unknown' | 'excluded_timing';
  missingReason: string | null;
};

// Refuse oversized arrays before Zod walks them. Only plain JSON-shaped values
// are accepted: no getters, prototypes, circular structures or executable input.
function boundInput(value: unknown) {
  let entries = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++entries > taskComplexityLimits.entries || depth > taskComplexityLimits.depth)
      throw new Error('复杂度输入超过节点或嵌套上限');
    if (
      item === null ||
      item === undefined ||
      typeof item === 'boolean' ||
      typeof item === 'number'
    ) {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('输入数值必须有限');
      bytes += 16;
    } else if (typeof item === 'string') {
      if (item.length > taskComplexityLimits.inputBytes)
        throw new Error('复杂度输入超过 1 MiB 上限');
      bytes += new TextEncoder().encode(item).length + 2;
    } else if (typeof item === 'object') {
      if (ancestors.has(item)) throw new Error('输入不允许循环引用');
      const array = Array.isArray(item);
      if (array && item.length > taskComplexityLimits.graphEdges)
        throw new Error('复杂度输入数组超过计算上限');
      if (
        !array &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        throw new Error('输入必须是普通 JSON 对象');
      const names = Object.getOwnPropertyNames(item);
      if (names.length > taskComplexityLimits.entries - entries + 1)
        throw new Error('复杂度输入超过字段上限');
      ancestors.add(item);
      for (const name of names) {
        if (array && name === 'length') continue;
        const property = Object.getOwnPropertyDescriptor(item, name)!;
        if (!('value' in property)) throw new Error('输入不允许 getter 或 setter');
        bytes += new TextEncoder().encode(name).length + 4;
        visit(property.value, depth + 1);
      }
      ancestors.delete(item);
    } else throw new Error('输入必须可以表示为 JSON');
    if (bytes > taskComplexityLimits.inputBytes) throw new Error('复杂度输入超过 1 MiB 上限');
  };
  visit(value, 0);
}

function parseTask(input: unknown): Task {
  boundInput(input);
  return TaskSchema.parse(input);
}

function projectTask(task: Task) {
  const classification = task.requirementClassification;
  const requirements = task.observations?.requirements
    ? structuredClone(task.observations.requirements)
    : null;
  requirements?.methodFamilies?.sort();
  requirements?.constraintKinds?.sort();
  return {
    taskId: task.id,
    classification: {
      workType: classification?.workType ?? 'unknown',
      basis: classification?.basis ?? 'unknown',
      coverage: classification?.coverage ?? 'unknown',
    },
    requirements,
  };
}

export function extractTaskComplexityRequirements(input: unknown) {
  return projectTask(parseTask(input));
}
export type TaskComplexityRequirements = ReturnType<typeof extractTaskComplexityRequirements>;

const uuid = z.string().uuid().toLowerCase();
export const TaskDependencyGraphSchema = z
  .object({
    version: z.literal('task-requirement-graph-1'),
    taskId: uuid,
    requirementRevision: uuid,
    basis: z.enum(['original_request', 'approved_change']),
    source: z.enum([
      'recorded_log',
      'artifact_parser',
      'human_report',
      'local_model',
      'local_rule',
    ]),
    coverage: z.enum(['complete', 'partial']),
    // Several display or implementation parts may represent one stable original
    // requirement unit. Only the quotient graph of those units is measured.
    nodes: z
      .array(z.object({ partId: uuid, requirementUnitId: uuid }).strict())
      .min(1)
      .max(taskComplexityLimits.graphNodes),
    edges: z
      .array(z.object({ from: uuid, to: uuid, kind: z.enum(['dependency', 'feedback']) }).strict())
      .max(taskComplexityLimits.graphEdges),
    sharedStateGroups: z
      .array(z.array(uuid).min(2).max(taskComplexityLimits.graphNodes))
      .max(taskComplexityLimits.stateGroups),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const known = new Set(graph.nodes.map((node) => node.partId));
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (known.size !== graph.nodes.length) fail('partId 不能重复');
    const edges = new Set<string>();
    for (const edge of graph.edges) {
      if (!known.has(edge.from) || !known.has(edge.to)) fail('边必须引用本图的部分');
      const key = `${edge.kind}:${edge.from}:${edge.to}`;
      if (edges.has(key)) fail('相同的边不能重复');
      edges.add(key);
    }
    for (const group of graph.sharedStateGroups) {
      if (new Set(group).size !== group.length) fail('共享状态组的部分不能重复');
      if (group.some((id) => !known.has(id))) fail('共享状态组必须引用本图的部分');
    }
  });
export type TaskDependencyGraph = z.infer<typeof TaskDependencyGraphSchema>;

type Edge = [number, number];
function stronglyConnected(size: number, edges: Edge[]) {
  const adjacent: number[][] = Array.from({ length: size }, () => []);
  for (const [from, to] of edges) adjacent[from].push(to);
  const index = Array<number>(size).fill(-1),
    low = [...index],
    stack: number[] = [];
  const onStack = new Set<number>(),
    groups: number[][] = [];
  let sequence = 0;
  const visit = (node: number) => {
    index[node] = low[node] = sequence++;
    stack.push(node);
    onStack.add(node);
    for (const next of adjacent[node]) {
      if (index[next] === -1) {
        visit(next);
        low[node] = Math.min(low[node], low[next]);
      } else if (onStack.has(next)) low[node] = Math.min(low[node], index[next]);
    }
    if (low[node] === index[node]) {
      const group: number[] = [];
      let member: number;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        group.push(member);
      } while (member !== node);
      groups.push(group);
    }
  };
  for (let node = 0; node < size; node++) if (index[node] === -1) visit(node);
  const groupOf = Array<number>(size);
  groups.forEach((group, i) => group.forEach((node) => (groupOf[node] = i)));
  return { groups, groupOf };
}

export type TaskComplexityStructure = {
  status: 'computed_graph' | 'declared_summary' | 'unknown';
  basis: string;
  source: string;
  coverage: 'complete' | 'partial' | 'unknown';
  aggregation: 'stable_requirement_units' | 'declared_components' | 'none';
  componentCount: number | null;
  dependencyEdges: number | null;
  dependencyDepth: number | null;
  cyclicDependencyGroups: number | null;
  largestDependencyCycle: number | null;
  feedbackLinks: number | null;
  feedbackCyclicGroups: number | null;
  sharedStateGroups: number | null;
  integrationRequired: boolean | null;
  fieldRefs: string[];
  notes: string[];
};

function graphStructure(graph: TaskDependencyGraph): TaskComplexityStructure {
  const units = [...new Set(graph.nodes.map((node) => node.requirementUnitId))].sort();
  const unitIndex = new Map(units.map((id, i) => [id, i]));
  const partUnit = new Map(
    graph.nodes.map((node) => [node.partId, unitIndex.get(node.requirementUnitId)!]),
  );
  const uniqueEdges = (kind: 'dependency' | 'feedback'): Edge[] => {
    const keys = new Set(
      graph.edges
        .filter((edge) => edge.kind === kind)
        .map((edge) => `${partUnit.get(edge.from)}:${partUnit.get(edge.to)}`),
    );
    return [...keys]
      .map((key) => key.split(':').map(Number) as Edge)
      .filter(([from, to]) => from !== to);
  };
  const dependencies = uniqueEdges('dependency'),
    feedback = uniqueEdges('feedback');
  const dependencyGroups = stronglyConnected(units.length, dependencies);
  const combinedGroups = stronglyConnected(units.length, [...dependencies, ...feedback]);
  const dag: Set<number>[] = dependencyGroups.groups.map(() => new Set<number>());
  const indegree = dependencyGroups.groups.map(() => 0),
    depth = [...indegree];
  for (const [from, to] of dependencies) {
    const a = dependencyGroups.groupOf[from],
      b = dependencyGroups.groupOf[to];
    if (a !== b && !dag[a].has(b)) {
      dag[a].add(b);
      indegree[b]++;
    }
  }
  const queue = indegree.flatMap((count, i) => (count === 0 ? [i] : []));
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor];
    for (const next of dag[node]) {
      depth[next] = Math.max(depth[next], depth[node] + 1);
      if (--indegree[next] === 0) queue.push(next);
    }
  }
  const sharedGroups = new Set(
    graph.sharedStateGroups
      .map((members) => [...new Set(members.map((id) => partUnit.get(id)!))].sort((a, b) => a - b))
      .filter((members) => members.length >= 2)
      .map((members) => members.join(':')),
  );
  const feedbackGroups = new Set(
    feedback
      .filter(([from, to]) => combinedGroups.groupOf[from] === combinedGroups.groupOf[to])
      .map(([from]) => combinedGroups.groupOf[from]),
  );
  const cycles = dependencyGroups.groups.filter((group) => group.length > 1);
  return {
    status: 'computed_graph',
    basis: graph.basis,
    source: graph.source,
    coverage: graph.coverage,
    aggregation: 'stable_requirement_units',
    componentCount: units.length,
    dependencyEdges: dependencies.length,
    dependencyDepth: Math.max(0, ...depth),
    cyclicDependencyGroups: cycles.length,
    largestDependencyCycle: Math.max(0, ...cycles.map((group) => group.length)),
    feedbackLinks: feedback.length,
    feedbackCyclicGroups: feedbackGroups.size,
    sharedStateGroups: sharedGroups.size,
    integrationRequired: null,
    fieldRefs: [
      'dependencyGraph.nodes',
      'dependencyGraph.edges',
      'dependencyGraph.sharedStateGroups',
    ],
    notes: [
      '按稳定原要求单元合并部分，组内边不增加结构量；重复的单元间边和相同共享状态组只计一次。',
      '依赖深度为依赖图强连通分量缩合后的最长路径边数；循环单独保留，不能用较短深度解释为更简单。',
      '反馈循环数是包含反馈边的强连通组数量，不枚举所有简单循环。',
      graph.coverage === 'partial'
        ? '局部图只表示已观察结构；深度和循环分组不是完整图的上下界。'
        : '完整性是输入声明，程序检查图的一致性，不验证原要求是否遗漏。',
    ],
  };
}

function declaredStructure(task: Task): TaskComplexityStructure {
  const structure =
    task.evaluation?.version === 'work-summary-1' ? task.evaluation.workStructure : null;
  const usable = structure && ['original_request', 'approved_change'].includes(structure.basis);
  return {
    status: usable ? 'declared_summary' : 'unknown',
    basis: usable ? structure.basis : 'unknown',
    source: usable ? 'uploaded_summary_declaration' : 'unknown',
    coverage: usable ? structure.coverage : 'unknown',
    aggregation: usable ? 'declared_components' : 'none',
    componentCount: usable ? structure.componentCount : null,
    dependencyEdges: usable ? structure.dependencyEdges : null,
    dependencyDepth: usable ? structure.dependencyDepth : null,
    cyclicDependencyGroups: null,
    largestDependencyCycle: null,
    feedbackLinks: usable ? structure.feedbackLinks : null,
    feedbackCyclicGroups: null,
    sharedStateGroups: usable ? structure.sharedStateGroups : null,
    integrationRequired: usable ? structure.integrationRequired : null,
    fieldRefs: usable ? ['evaluation.workStructure'] : [],
    notes: [
      usable
        ? '上传摘要只有结构计数；没有原图时不能重算去重、循环或验证稳定单元。'
        : '未取得原要求结构，不能从代理数量、工具调用或实际成果量推定组成部分。',
    ],
  };
}

function dimensions(
  requirements: NonNullable<TaskObservations['requirements']> | null,
): TaskComplexityDimension[] {
  const meta = requirements?.meta;
  const eligible = !!meta && ['before_execution', 'approved_change'].includes(meta.timing);
  return taskComplexityDimensions.map((dimension) => {
    const supplied = requirements?.[dimension.id];
    const known = supplied !== undefined && supplied !== null && supplied !== 'unknown';
    const value =
      eligible && known
        ? Array.isArray(supplied)
          ? [...supplied].sort()
          : (supplied as string)
        : null;
    return {
      id: dimension.id,
      label: dimension.label,
      role: dimension.role,
      value,
      ordinalPosition:
        typeof value === 'string' && dimension.orderedCategories
          ? dimension.orderedCategories.indexOf(value)
          : null,
      fieldRefs: value === null ? [] : [dimension.fieldRef],
      source: meta?.source ?? 'unknown',
      timing: meta?.timing ?? 'unknown',
      coverage: meta?.coverage ?? 'unknown',
      status: known && !eligible ? 'excluded_timing' : value === null ? 'unknown' : 'known',
      missingReason:
        known && !eligible
          ? '要求未在执行前或已批准变更时登记，不能作为事前复杂度依据'
          : value === null
            ? (meta?.missingReason ?? 'not_recorded')
            : null,
    };
  });
}

export type TaskComplexityOptions = {
  enabled?: boolean;
  requirementRevision?: string;
  domainReview?: DifficultyReviewInput | unknown;
  dependencyGraph?: TaskDependencyGraph | unknown;
};

export function computeTaskComplexity(input?: unknown, options: TaskComplexityOptions = {}) {
  // This branch deliberately does not touch input or any other option.
  if (options.enabled !== true)
    return {
      version: TASK_COMPLEXITY_VERSION,
      status: 'disabled',
      enabled: false,
      productionEnabled: false,
      calibration: 'not_calibrated',
      totalScore: null,
    } as const;
  const task = parseTask(input);
  const requirementRevision = uuid.parse(options.requirementRevision);
  const projection = projectTask(task);
  const measured = dimensions(projection.requirements);
  let domainReview: ReturnType<typeof computeDifficultyReview> | null = null;
  if (options.domainReview !== undefined) {
    boundInput(options.domainReview);
    const inputReview = DifficultyReviewSchema.parse(options.domainReview);
    if (
      inputReview.root.componentId !== task.id.toLowerCase() ||
      inputReview.root.requirementVersion !== requirementRevision
    )
      throw new Error('领域要求表必须绑定同一任务和要求修订版本');
    if (
      projection.classification.workType !== 'unknown' &&
      projection.classification.workType !== 'mixed' &&
      inputReview.root.annotation.workType !== projection.classification.workType
    )
      throw new Error('领域要求表与摘要的工作细类不一致');
    domainReview = computeDifficultyReview(inputReview, { mode: 'local_review' });
  }
  let structure = declaredStructure(task);
  if (options.dependencyGraph !== undefined) {
    boundInput(options.dependencyGraph);
    const graph = TaskDependencyGraphSchema.parse(options.dependencyGraph);
    if (graph.taskId !== task.id.toLowerCase() || graph.requirementRevision !== requirementRevision)
      throw new Error('结构图必须绑定同一任务和要求修订版本');
    structure = graphStructure(graph);
  }
  const known = measured.filter((dimension) => dimension.status === 'known').length;
  const allKnownRequirements =
    domainReview?.mode === 'local_review'
      ? [domainReview.root, ...domainReview.parts].flatMap((part) =>
          part.domainReview.criteria
            .filter((criterion) => criterion.anchorIndex !== null)
            .map((criterion) => ({
              domain: part.domain,
              workType: part.workType,
              criterionId: criterion.criterionId,
              label: criterion.label,
              anchorIndex: criterion.anchorIndex!,
              description: criterion.description!,
            })),
        )
      : [];
  // Retain the highest anchor only within the exact same domain, activity and
  // criterion. Repeating or splitting an annotation cannot raise it by addition.
  const knownByCriterion = new Map<string, (typeof allKnownRequirements)[number]>();
  for (const item of allKnownRequirements) {
    const key = `${item.domain}:${item.workType}:${item.criterionId}`;
    if (!knownByCriterion.has(key) || knownByCriterion.get(key)!.anchorIndex < item.anchorIndex)
      knownByCriterion.set(key, item);
  }
  const highestKnownRequirements = [...knownByCriterion.values()].sort((a, b) =>
    `${a.domain}:${a.workType}:${a.criterionId}`.localeCompare(
      `${b.domain}:${b.workType}:${b.criterionId}`,
    ),
  );
  const allMissingCriteria =
    domainReview?.mode === 'local_review'
      ? [domainReview.root, ...domainReview.parts].flatMap((part) =>
          part.domainReview.criteria
            .filter(
              (criterion) =>
                criterion.applicability !== 'not_applicable' && criterion.anchorIndex === null,
            )
            .map((criterion) => ({
              domain: part.domain,
              workType: part.workType,
              criterionId: criterion.criterionId,
              possibleAnchorIndices: [0, 1, 2, 3],
            })),
        )
      : [];
  const missingCriteria = [
    ...new Map(
      allMissingCriteria.map((item) => [
        `${item.domain}:${item.workType}:${item.criterionId}`,
        item,
      ]),
    ).values(),
  ];
  const requirementLabels: string[] = [];
  const valueOf = (id: TaskComplexityDimensionId) =>
    measured.find((dimension) => dimension.id === id)?.value;
  if (valueOf('solutionNovelty') === 'new_solution') requirementLabels.push('需要构造新方案');
  else if (valueOf('solutionNovelty') === 'adaptation') requirementLabels.push('需要适配既有方案');
  else if (valueOf('solutionNovelty') === 'repeat') requirementLabels.push('复用已知方案');
  if (valueOf('knowledge') === 'research') requirementLabels.push('涉及研究性知识');
  else if (valueOf('knowledge') === 'specialist') requirementLabels.push('涉及专业知识');
  if (valueOf('reasoning') === 'formal') requirementLabels.push('需要形式化论证');
  else if (valueOf('reasoning') === 'open_ended') requirementLabels.push('包含开放式推断');
  else if (valueOf('reasoning') === 'multi_step') requirementLabels.push('需要多步推理');
  if ((structure.cyclicDependencyGroups ?? 0) > 0) requirementLabels.push('组成部分存在循环依赖');
  if ((structure.sharedStateGroups ?? 0) > 0) requirementLabels.push('组成部分需要协调共享状态');
  return {
    version: TASK_COMPLEXITY_VERSION,
    frameworkVersion: difficultyFramework.version,
    status: 'computed_unvalidated',
    enabled: true,
    productionEnabled: false,
    calibration: 'not_calibrated',
    totalScore: null,
    taskId: task.id,
    requirementRevision,
    classification: projection.classification,
    dimensions: measured,
    coverage: {
      expected: measured.length,
      known,
      unknown: measured.length - known,
      excludedTiming: measured.filter((dimension) => dimension.status === 'excluded_timing').length,
    },
    structure,
    domainReview,
    judgement: {
      state:
        known === 0 && highestKnownRequirements.length === 0
          ? 'insufficient'
          : known === measured.length &&
              projection.requirements?.meta.coverage === 'complete' &&
              domainReview?.mode === 'local_review' &&
              [domainReview.root, ...domainReview.parts].every(
                (part) =>
                  part.domainReview.coverage.status === 'complete' &&
                  !Object.values(part.inputConditions).includes('unknown'),
              ) &&
              structure.status === 'computed_graph' &&
              structure.coverage === 'complete'
            ? 'profile_complete'
            : 'partial_profile',
      headline: requirementLabels.length
        ? requirementLabels.join('；')
        : '已知要求不足以形成复杂度判断',
      labels: requirementLabels,
      missingDimensionIds: measured
        .filter((dimension) => dimension.value === null)
        .map((dimension) => dimension.id),
      highestKnownRequirements,
      missingCriteria,
      interpretation:
        '等级只表示各条目内的要求锚点；没有跨领域总分、成功概率或费用换算。缺项的可能锚点集合不是统计置信区间。',
    },
    provenance: 'declared_not_authenticated',
    limitations: [
      '这是确定性要求画像和结构计算，尚未用共同任务和留出数据校准真实难度。',
      '来源、任务身份和要求单元均由输入声明；一致性检查不能证明原记录真实，也不能识别不同 ID 包装的语义重复。',
      'Token、费用、时长、失败、重试、对话轮次和代理数量不进入复杂度判断。',
      '方法类别数量、约束数量、输出数量不直接加分；不同领域与活动不采用人为权重换算。',
    ],
  } as const;
}

export type TaskComplexityResult = ReturnType<typeof computeTaskComplexity>;
export type ComputedTaskComplexity = Extract<
  TaskComplexityResult,
  { status: 'computed_unvalidated' }
>;

export function compareTaskComplexityProfiles(
  left: ComputedTaskComplexity,
  right: ComputedTaskComplexity,
) {
  const result = (
    relation:
      | 'higher_requirements'
      | 'lower_requirements'
      | 'equal_profile'
      | 'incomparable'
      | 'insufficient'
      | 'different_reference',
    compared: string[],
    reason: string,
  ) => ({ relation, compared, reason, ruleVersion: TASK_COMPLEXITY_VERSION });
  if (
    left.version !== right.version ||
    left.frameworkVersion !== right.frameworkVersion ||
    left.classification.workType !== right.classification.workType
  )
    return result('different_reference', [], '规则版本或工作细类不同，不能直接排序');
  if (
    ['unknown', 'mixed'].includes(left.classification.workType) ||
    left.classification.coverage !== 'complete' ||
    right.classification.coverage !== 'complete'
  )
    return result('insufficient', [], '需要完整且明确的同一工作细类');
  const a = left.domainReview,
    b = right.domainReview;
  if (a?.mode !== 'local_review' || b?.mode !== 'local_review' || a.parts.length || b.parts.length)
    return result('insufficient', [], '需要同一根目标的完整领域要求表；混合部分不相加');
  const x = a.root,
    y = b.root;
  if (x.domain !== y.domain || x.workType !== y.workType)
    return result('different_reference', [], '领域要求表的参照不同');
  if (
    x.domainReview.coverage.status !== 'complete' ||
    y.domainReview.coverage.status !== 'complete' ||
    left.coverage.known !== left.coverage.expected ||
    right.coverage.known !== right.coverage.expected
  )
    return result('insufficient', [], '未知、冲突或不完整要求不补最低等级');
  if (
    left.dimensions.some((dimension) => dimension.coverage !== 'complete') ||
    right.dimensions.some((dimension) => dimension.coverage !== 'complete')
  )
    return result('insufficient', [], '局部材料中已填写的字段不能代表完整要求覆盖');
  if (
    Object.values(x.inputConditions).includes('unknown') ||
    Object.values(y.inputConditions).includes('unknown')
  )
    return result('insufficient', [], '领域要求表的材料缺失、冲突或明确性条件尚未知');
  if (
    left.structure.status !== 'computed_graph' ||
    right.structure.status !== 'computed_graph' ||
    left.structure.coverage !== 'complete' ||
    right.structure.coverage !== 'complete'
  )
    return result(
      'insufficient',
      [],
      '需要完整的要求图，两个缺测结构或未经图校验的摘要不能视为相同条件',
    );
  // Input conditions and graph obligations must match. A bigger requirement
  // vector under a different environment is not a controlled comparison.
  const conditions = (profile: ComputedTaskComplexity) =>
    JSON.stringify({
      dimensions: profile.dimensions
        .filter((dimension) => dimension.ordinalPosition === null)
        .map((dimension) => [dimension.id, dimension.value]),
      domainInputConditions:
        profile.domainReview?.mode === 'local_review'
          ? profile.domainReview.root.inputConditions
          : null,
      structure: Object.fromEntries(
        Object.entries(profile.structure).filter(
          ([key]) => !['notes', 'fieldRefs', 'source', 'basis'].includes(key),
        ),
      ),
    });
  if (conditions(left) !== conditions(right))
    return result('incomparable', [], '输入条件、方法、约束或结构不同，保留各维度而不强排');
  let higher = false,
    lower = false;
  const compared: string[] = [];
  for (const criterion of x.domainReview.criteria) {
    const other = y.domainReview.criteria.find(
      (candidate) => candidate.criterionId === criterion.criterionId,
    );
    if (!other || criterion.applicability !== other.applicability)
      return result('incomparable', compared, '领域条目的适用性不同');
    if (criterion.applicability === 'not_applicable') continue;
    if (criterion.anchorIndex === null || other.anchorIndex === null)
      return result('insufficient', compared, '领域条目缺少要求锚点');
    compared.push(criterion.criterionId);
    higher ||= criterion.anchorIndex > other.anchorIndex;
    lower ||= criterion.anchorIndex < other.anchorIndex;
  }
  for (const dimension of left.dimensions.filter((entry) => entry.ordinalPosition !== null)) {
    const other = right.dimensions.find((entry) => entry.id === dimension.id)!;
    if (other.ordinalPosition === null)
      return result('insufficient', compared, '要求条件缺少对应序位');
    compared.push(dimension.id);
    higher ||= dimension.ordinalPosition! > other.ordinalPosition;
    lower ||= dimension.ordinalPosition! < other.ordinalPosition;
  }
  if (!compared.length) return result('insufficient', [], '没有共同的适用要求条目');
  return higher && lower
    ? result('incomparable', compared, '各有更高要求，不能用平均值相互抵消')
    : higher
      ? result(
          'higher_requirements',
          compared,
          '全部可比维度不低，至少一项要求更高；不代表实测更难',
        )
      : lower
        ? result(
            'lower_requirements',
            compared,
            '全部可比维度不高，至少一项要求更低；不代表实测更容易',
          )
        : result('equal_profile', compared, '已记录的要求向量相同，不证明两个真实任务难度相同');
}
