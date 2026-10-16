import { z } from 'zod';

const count = z.number().int().nonnegative().max(1e7).nullable();
export const WorkStructureSchema = z
  .object({
    version: z.literal('work-structure-1'),
    basis: z.enum([
      'original_request',
      'approved_change',
      'artifact_inspection',
      'human_report',
      'unknown',
    ]),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    componentCount: count,
    requiredComponentCount: count,
    completedComponentCount: count,
    acceptedComponentCount: count,
    acceptedRequiredComponentCount: count,
    dependencyEdges: count,
    dependencyDepth: count,
    sharedStateGroups: count,
    feedbackLinks: count,
    feedbackCycles: count,
    integrationRequired: z.boolean().nullable(),
    integrationAccepted: z.boolean().nullable(),
    coupling: z.enum([
      'single',
      'independent',
      'pipeline',
      'shared_state',
      'iterative',
      'mixed',
      'unknown',
    ]),
    observed: z
      .object({
        componentCount: z.number().int().nonnegative().max(10000),
        dependencyEdges: z.number().int().nonnegative().max(100000),
        sharedStateGroups: z.number().int().nonnegative().max(10000),
        feedbackLinks: z.number().int().nonnegative().max(100000),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const within = (a: number | null, b: number | null) => a !== null && b !== null && a > b;
    if (
      within(v.requiredComponentCount, v.componentCount) ||
      within(v.completedComponentCount, v.componentCount) ||
      within(v.acceptedComponentCount, v.completedComponentCount) ||
      within(v.acceptedRequiredComponentCount, v.requiredComponentCount) ||
      within(v.acceptedRequiredComponentCount, v.acceptedComponentCount)
    )
      fail('必需、完成及验收部分的数量必须相互一致');
    if (v.acceptedComponentCount !== null && v.completedComponentCount === null)
      fail('部分验收量需要已完成量');
    if (v.integrationAccepted !== null && v.integrationRequired !== true)
      fail('整合验收结果只用于明确要求整体整合的任务');
    const exact = [
      v.componentCount,
      v.requiredComponentCount,
      v.completedComponentCount,
      v.acceptedComponentCount,
      v.acceptedRequiredComponentCount,
      v.dependencyEdges,
      v.dependencyDepth,
      v.sharedStateGroups,
      v.feedbackLinks,
      v.feedbackCycles,
    ];
    if ((v.coverage !== 'complete' || v.basis === 'unknown') && exact.some((n) => n !== null))
      fail('覆盖或依据不明时结构总量为 null，只能保留已观察小计');
    if (v.coverage !== 'complete' && v.coupling !== 'unknown') fail('局部图不能声明完整耦合类型');
    if (v.componentCount !== null) {
      if (
        v.componentCount !== v.observed.componentCount ||
        v.dependencyEdges !== v.observed.dependencyEdges ||
        v.sharedStateGroups !== v.observed.sharedStateGroups ||
        v.feedbackLinks !== v.observed.feedbackLinks
      )
        fail('完整结构总量必须与去重后的观察数量一致');
      if (v.dependencyDepth !== null && v.dependencyDepth >= Math.max(1, v.componentCount))
        fail('依赖深度按缩合后的组间边数计算，不能达到部分总数');
      if (v.coupling === 'single' && v.componentCount !== 1) fail('single 只适用于一个组成部分');
    }
  });
export type WorkStructure = z.infer<typeof WorkStructureSchema>;

export const ExecutionScopeSchema = z
  .object({
    version: z.literal('execution-scope-1'),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    uniqueAgents: count,
    rootAgents: count.optional(),
    agentTaskAssignments: count,
    sharedAgents: count,
    maxAgentDepth: count,
    observedAgents: z.number().int().nonnegative().max(100000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.rootAgents != null && (v.coverage !== 'complete' || v.uniqueAgents === null || v.rootAgents < 1 || v.rootAgents > v.uniqueAgents || (v.maxAgentDepth === 0 && v.rootAgents !== v.uniqueAgents) || (v.maxAgentDepth != null && v.maxAgentDepth > v.uniqueAgents - v.rootAgents)))
      fail('根代理数量必须与完整代理范围及层级一致');
    if (
      v.coverage === 'complete' &&
      [v.uniqueAgents, v.agentTaskAssignments, v.sharedAgents, v.maxAgentDepth].some(
        (n) => n === null,
      )
    )
      fail('完整执行范围必须有去重代理数、目标参与数及深度');
    if (
      v.coverage !== 'complete' &&
      [v.uniqueAgents, v.agentTaskAssignments, v.sharedAgents, v.maxAgentDepth].some(
        (n) => n !== null,
      )
    )
      fail('未覆盖全部代理时完整总量均为 null，只保留已观察代理小计');
    if (
      v.uniqueAgents !== null &&
      (v.uniqueAgents !== v.observedAgents ||
        v.agentTaskAssignments! < v.uniqueAgents ||
        v.sharedAgents! > v.uniqueAgents ||
        v.maxAgentDepth! >= Math.max(1, v.uniqueAgents))
    )
      fail('去重代理与目标参与数、深度不一致');
    if (
      v.uniqueAgents !== null &&
      ((v.sharedAgents === 0 && v.agentTaskAssignments !== v.uniqueAgents) ||
        (v.sharedAgents! > 0 && v.agentTaskAssignments! < v.uniqueAgents + v.sharedAgents!))
    )
      fail('共享代理的参与映射必须满足去重数量守恒');
  });

export const workMeasurementRules = {
  version: 'work-measurement-2',
  difficultyEnabled: false,
  counters: [
    { id: 'root_goals', label: '独立验收目标', aggregation: 'stable_goal_identity' },
    {
      id: 'components',
      label: '目标内组成部分',
      aggregation: 'unique_atomic_parts; containers_excluded',
    },
    { id: 'outputs', label: '不同内容的实际成果', aggregation: 'final_revision_per_item_and_unit' },
    { id: 'execution', label: '执行消耗', aggregation: 'all_actual_attempts_and_descendants' },
  ],
  quantities: {
    grouping: ['kind', 'workType', 'unit', 'source', 'acceptance', 'coverage'],
    differentUnits: 'never_sum_or_convert_to_work_value',
    finalVersions: 'revisions_and_format_derivatives_do_not_add_outputs',
    repeatedProcessing: 'unique_input_items_not_sum_of_pipeline_passes',
    sharedInput:
      'independent_goals_may_reuse_input; execution_and_outputs_must_not_be_double_booked',
    coverage: 'unknown_is_null; partial_has_known_subtotal_only',
  },
  topology: {
    localOnly: [
      'node_ids',
      'parent_ids',
      'dependency_edges',
      'state_group_members',
      'artifact_identity',
      'revision_identity',
    ],
    public: 'fixed_types_and_aggregate_counts_only',
    depth: 'longest_intergroup_path_after_strongly_connected_component_collapse',
    sharedState: 'count_groups_not_all_pairwise_links',
    missing: 'do_not_infer_edges_or_parts_from_tokens_tools_or_agents',
  },
  outcomes: {
    acceptedRoot: 'all_required_parts_and_required_integration_pass',
    reportedCompletion: 'conversation_claim_is_not_independent_acceptance',
    planned: 'original_plan_and_approved_changes; never_rewrite_using_the_outcome',
  },
  process: {
    attempts: 'new_execution_attempt_for_same_goal',
    requestRetries: 'actual_request_resends_not_new_goals',
    revisions: 'changed_final_content_not_exports',
    rework: 'repeated_work_to_correct_identified_defect',
    requirementChanges: 'changed_original_goal_or_acceptance_conditions',
    humanTurns: 'human_origin_only; exclude_agent_dispatch_system_and_tool_results',
    labor: 'measured_human_activity; event_span_is_not_labor',
  },
  trust: 'structural_checks_and_hashes_prove_consistency_not_truth_or_independent_acceptance',
} as const;
