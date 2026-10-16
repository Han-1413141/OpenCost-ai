import { mergePriceMetering } from '../shared/price-metering.js';
import {
  LocalCodeEvidenceSchema,
  applyCodeEvidence,
  type CodeAttachmentCounts,
} from './code-observations.js';
import {
  LocalChargeSchema,
  LocalChargeCoverageSchema,
  reconcileCharges,
} from './charge-coverage.js';
import { chargeComponents, type ChargeReconciliation } from '../shared/charge-reconciliation.js';
import { createHash } from 'node:crypto';
import { LocalRequirementHistorySchema, analyzeRequirementHistory } from './requirement-history.js';
import { z } from 'zod';
import {
  canonical,
  EnvelopeSchema,
  UsageSchema,
  ResourceUsageSchema,
  HarnessIdentitySchema,
  publicId,
  type Envelope,
  type Usage,
} from '../shared/schema.js';
import { resourceMetrics } from '../shared/evaluation.js';
import {
  CostEntryAllocationSchema,
  attributionTargets,
  type CostAttribution,
} from '../shared/cost-attribution.js';
import {
  LocalWorkGraphSchema,
  LocalWorkItemSchema,
  compileWorkItems,
  summarizeWorkGraph,
} from './work-ledger.js';

const localId = z.string().min(1).max(512);
export const CapturePacketSchema = z
  .object({
    format: z.literal('opencost-local-capture-1'),
    envelope: EnvelopeSchema,
    collector: z.object({ id: publicId, version: publicId, salt: z.string().uuid() }).strict(),
    // This object and all local IDs stay in the local packet, never in the upload.
    manifest: z.record(z.string(), z.unknown()),
    coverage: z
      .object({
        agents: z.enum(['complete', 'partial', 'unknown']),
        calls: z.enum(['complete', 'partial', 'unknown']),
        charges: z.enum(['complete', 'partial', 'unknown']),
        workItems: z.enum(['complete', 'partial', 'unknown']).optional(),
        events: z
          .object(
            Object.fromEntries(
              [
                'user_turn',
                'assistant_turn',
                'tool_call',
                'tool_failure',
                'context_reset',
                'context_compaction',
                'human_intervention',
                'requirement_change',
              ].map((key) => [key, z.enum(['complete', 'partial', 'unknown'])]),
            ),
          )
          .strict(),
        resources: z
          .object(
            Object.fromEntries(
              resourceMetrics.map((key) => [key, z.enum(['complete', 'partial', 'unknown'])]),
            ),
          )
          .strict(),
      })
      .strict(),
    agents: z
      .array(
        z
          .object({
            id: localId,
            parentId: localId.nullable(),
            taskId: z.string().uuid(),
            taskIds: z.array(z.string().uuid()).min(1).max(10000).optional(),
            harness: HarnessIdentitySchema,
          })
          .strict(),
      )
      .max(100000),
    events: z
      .array(
        z
          .object({
            id: localId,
            agentId: localId,
            taskId: z.string().uuid(),
            kind: z.enum([
              'user_turn',
              'assistant_turn',
              'model_call',
              'tool_call',
              'tool_failure',
              'context_reset',
              'context_compaction',
              'human_intervention',
              'requirement_change',
            ]),
            usage: UsageSchema.optional(),
          })
          .strict(),
      )
      .max(1000000),
    // Amounts are net of explicitly linked refunds, in this period's currency.
    charges: z.array(LocalChargeSchema).max(1000000),
    chargeCoverage: LocalChargeCoverageSchema.optional(),
    resources: z
      .array(
        z
          .object({
            id: localId,
            agentId: localId.nullable(),
            taskId: z.string().uuid(),
            scope: z.enum(['direct', 'aggregate']),
            usage: ResourceUsageSchema,
          })
          .strict(),
      )
      .max(1000000),
    workItems: z.array(LocalWorkItemSchema).max(1000000).nullable().optional(),
    workGraphs: z.array(LocalWorkGraphSchema).max(10000).nullable().optional(),
    taskHistory: LocalRequirementHistorySchema.nullable().optional(),
    codeMeasurements: LocalCodeEvidenceSchema.optional(),
  })
  .strict();
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function unique<T extends { id: string }>(values: T[]) {
  const seen = new Map<string, T>();
  for (const value of values) {
    const old = seen.get(value.id);
    if (old && canonical(old) !== canonical(value))
      throw new Error('相同本地事实标识对应不同内容，请核对原始记录');
    seen.set(value.id, value);
  }
  return [...seen.values()];
}

export function compileCapture(input: unknown): {
  envelope: Envelope;
  report: {
    agents: number;
    maxDepth: number | null;
    directCharges: number;
    ignoredAggregateCharges: number;
    directResources: number;
    duplicatesRemoved: number;
    finalWorkItems: number | null;
    ignoredAggregateWorkItems: number;
    chargeReconciliation?: ChargeReconciliation;
    codeMeasurements?: CodeAttachmentCounts;
  };
} {
  const packet = CapturePacketSchema.parse(input);
  if (packet.envelope.schemaVersion !== '1.1') throw new Error('本地采集编译需要 1.1 协议');
  if (!packet.envelope.collectionWindow) throw new Error('请先通过 init 选择本次采集时间范围');
  if (!Object.keys(packet.manifest).length) throw new Error('来源清单不能为空');
  const envelope = structuredClone(packet.envelope);
  const codeMeasurements = packet.codeMeasurements
    ? applyCodeEvidence(envelope, packet.codeMeasurements)
    : undefined;
  if (packet.taskHistory) {
    const history = analyzeRequirementHistory(packet.taskHistory, { enabled: true });
    if (
      !['complete', 'partial'].includes(history.status) ||
      history.tasks.length !== envelope.tasks.length ||
      history.tasks.some((item) => !envelope.tasks.some((task) => task.id === item.taskId))
    )
      throw new Error('要求历史存在冲突、缺根目标或超出容量；请先单独分析，不输出部分工作记录。');
    for (const item of history.tasks) {
      const task = envelope.tasks.find((candidate) => candidate.id === item.taskId)!;
      task.observations = {
        ...task.observations,
        version: 'task-observations-1',
        history: item.observation,
      };
    }
  }
  if (!packet.chargeCoverage && envelope.period.chargeReconciliation)
    throw new Error('重新编译费用包含摘要需要原本地包含关系，不能沿用未核对的派生结果');
  if (
    packet.chargeCoverage &&
    !['itemized', 'unallocated'].includes(envelope.period.allocation) &&
    !(envelope.period.billing === 'api' && envelope.period.allocation === 'direct')
  )
    throw new Error(
      '费用包含关系需要逐项归属 itemized、纯 API 直接归属或明确不归属；不能自动套用旧整期均摊规则',
    );
  if (
    !packet.chargeCoverage &&
    packet.charges.some(
      (c) =>
        c.amountMinor === null ||
        !chargeComponents.includes(c.component as (typeof chargeComponents)[number]),
    )
  )
    throw new Error('未知金额或混合类别须提供明确的 chargeCoverage，旧采集仍只使用已知直接费用');
  const tasks = new Map(envelope.tasks.map((t) => [t.id, t]));
  const agents = unique(packet.agents),
    events = unique(packet.events),
    charges = unique(packet.charges);
  const resources = unique(packet.resources);
  const workItems = packet.workItems ? unique(packet.workItems) : null;
  const workGraphs = packet.workGraphs ?? [];
  if (new Set(workGraphs.map((g) => g.taskId)).size !== workGraphs.length)
    throw new Error('每个独立目标只能有一份合并后的组成图');
  for (const graph of workGraphs) {
    const task = tasks.get(graph.taskId);
    if (task?.evaluation?.version !== 'work-summary-1')
      throw new Error('组成图必须归属当前摘要中的独立目标');
    const structure = summarizeWorkGraph(graph);
    task.evaluation.workStructure = structure;
    task.evaluation.requirements.integration =
      structure.integrationRequired === null
        ? 'unknown'
        : structure.integrationRequired
          ? 'required'
          : 'not_required';
    task.evaluation.outcome.integrationAccepted = structure.integrationAccepted;
    task.evaluation.outcome.partsCompleted = structure.completedComponentCount;
    task.evaluation.outcome.partsAccepted = structure.acceptedComponentCount;
    if (
      structure.coverage === 'complete' &&
      ['original_request', 'approved_change'].includes(structure.basis)
    ) {
      const counts = new Map<(typeof graph.nodes)[number]['kind'], number>();
      for (const n of graph.nodes.filter((n) => n.role !== 'container'))
        counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
      task.evaluation.requirements.parts = counts.size
        ? [...counts].map(([kind, count]) => ({ kind, count }))
        : null;
    }
  }
  const itemReport =
    workItems === null
      ? null
      : compileWorkItems(workItems, envelope, packet.coverage.workItems ?? 'unknown');
  const byAgent = new Map(agents.map((a) => [a.id, a]));
  const belongs = (a: (typeof agents)[number]) => a.taskIds ?? [a.taskId];
  for (const agent of agents) {
    const ids = belongs(agent);
    if (
      !ids.includes(agent.taskId) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !tasks.has(id))
    )
      throw new Error('代理参与目标须包含主目标、不重复且已登记');
  }
  const depths = new Map<string, number>();
  // Iterative traversal supports deep delegation without JavaScript stack overflow.
  for (const agent of agents) {
    const chain: string[] = [],
      active = new Set<string>();
    let current: typeof agent | undefined = agent;
    while (current && !depths.has(current.id)) {
      if (active.has(current.id)) throw new Error('代理关系存在循环');
      if (!tasks.has(current.taskId)) throw new Error('代理必须归属一个已登记根目标');
      active.add(current.id);
      chain.push(current.id);
      if (current.parentId === null) {
        current = undefined;
        break;
      }
      const parent = byAgent.get(current.parentId);
      if (!parent) {
        if (packet.coverage.agents === 'complete')
          throw new Error('缺少父代理，补全代理树后再编译');
        current = undefined;
        break;
      }
      if (belongs(current).some((id) => !belongs(parent).includes(id)))
        throw new Error('后代参与的目标必须在祖先映射中登记，不能丢失委派上下文');
      current = parent;
    }
    let depth = current ? depths.get(current.id)! : -1;
    for (const id of chain.reverse()) depths.set(id, ++depth);
  }
  for (const event of events) {
    if (!byAgent.has(event.agentId) || !belongs(byAgent.get(event.agentId)!).includes(event.taskId))
      throw new Error('调用事件与代理的根目标不一致');
    if (event.kind !== 'model_call' && event.usage) throw new Error('只有模型请求可以携带模型用量');
  }
  const validateAllocation = (a: z.infer<typeof CostEntryAllocationSchema>) => {
    if (
      envelope.period.allocation !== 'itemized' &&
      a.method !== 'direct' &&
      a.method !== 'unallocated'
    )
      throw new Error('共享费用规则需要启用 itemized 归属');
    const ids = attributionTargets(a);
    if (new Set(ids).size !== ids.length || ids.some((id) => !tasks.has(id)))
      throw new Error('费用规则中的目标必须存在且每行不重复');
  };
  for (const relation of packet.chargeCoverage?.relations ?? [])
    if (relation.remainderAllocation) validateAllocation(relation.remainderAllocation);
  for (const charge of charges) {
    if (charge.currency !== envelope.period.currency) throw new Error('不同币种费用不能相加');
    if (charge.taskId && !tasks.has(charge.taskId)) throw new Error('费用归属的根目标不存在');
    if (charge.allocation) {
      if (!packet.chargeCoverage && envelope.period.allocation !== 'itemized')
        throw new Error('逐项费用规则需要启用 itemized 归属');
      validateAllocation(charge.allocation);
      const a = charge.allocation,
        ids = attributionTargets(a);
      if (new Set(ids).size !== ids.length || ids.some((id) => !tasks.has(id)))
        throw new Error('费用规则中的目标必须存在且每行不重复');
      if (charge.taskId && (a.method !== 'direct' || a.taskId !== charge.taskId))
        throw new Error('单任务费用归属不能与逐项规则冲突');
    }
    if (
      charge.agentId &&
      (!byAgent.has(charge.agentId) ||
        !charge.taskId ||
        !belongs(byAgent.get(charge.agentId)!).includes(charge.taskId))
    )
      throw new Error('费用与代理归属不一致');
  }
  for (const resource of resources) {
    if (
      !tasks.has(resource.taskId) ||
      (resource.agentId &&
        (!byAgent.has(resource.agentId) ||
          !belongs(byAgent.get(resource.agentId)!).includes(resource.taskId)))
    )
      throw new Error('资源记录与代理的根目标不一致');
  }
  const reconciliation = packet.chargeCoverage
    ? reconcileCharges({ ...packet, chargeCoverage: packet.chargeCoverage })
    : null;
  if (reconciliation?.summary.status === 'conflict')
    throw new Error(
      '费用包含关系存在冲突；先用 reconcile-charges 保存本地诊断，不生成上传数据。诊断：' +
        reconciliation.summary.issues.join(', '),
    );
  const chargesComplete =
    packet.coverage.charges === 'complete' &&
    (!reconciliation || reconciliation.summary.status === 'reconciled');
  const mappingComplete =
    chargesComplete && (!reconciliation || reconciliation.summary.unmappedMinor === 0);
  if (reconciliation) envelope.period.chargeReconciliation = reconciliation.summary;
  const direct =
    reconciliation?.fragments ??
    charges.filter((c) => c.scope === 'direct').map((c) => ({ ...c, amountMinor: c.amountMinor! }));
  const directResources = resources.filter((r) => r.scope === 'direct');
  const agentsByTask = new Map<string, typeof agents>(),
    eventsByTask = new Map<string, typeof events>();
  const chargesByTask = new Map<string, typeof direct>(),
    resourcesByTask = new Map<string, typeof directResources>();
  let assignments = 0;
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
  };
  for (const a of agents) {
    assignments += belongs(a).length;
    if (assignments > 1000000) throw new Error('目标参与映射超过单次处理上限，请按不重叠范围分批');
    for (const id of belongs(a)) add(agentsByTask, id, a);
  }
  for (const e of events) add(eventsByTask, e.taskId, e);
  for (const c of direct) if (c.taskId) add(chargesByTask, c.taskId, c);
  for (const r of directResources) add(resourcesByTask, r.taskId, r);
  const net = envelope.period.paidMinor - envelope.period.refundMinor;
  const total = direct.reduce((sum, c) => sum + c.amountMinor, 0);
  if (total > net || (chargesComplete && total !== net))
    throw new Error('费用账本必须与净实付对齐；父级累计费用不能再次相加');
  if (envelope.period.allocation === 'itemized') {
    const pools = new Map<string, CostAttribution['entries'][number]>();
    for (const charge of direct) {
      const original =
        charge.allocation ??
        (charge.taskId
          ? { method: 'direct' as const, taskId: charge.taskId }
          : { method: 'unallocated' as const });
      const allocation =
        original.method === 'equal' || original.method === 'tokens'
          ? { ...original, taskIds: [...original.taskIds].sort() }
          : original;
      const key = canonical(allocation),
        known = pools.get(key);
      if (known) known.netMinor += charge.amountMinor;
      else {
        if (pools.size >= 500) throw new Error('逐项费用归属超过 500 组，请按不重叠范围分批');
        // Salt and raw invoice IDs stay local; uploaded IDs describe accounting groups.
        const hex = hash([packet.collector.salt, 'cost-attribution-1', key]);
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        pools.set(key, { id, netMinor: charge.amountMinor, allocation });
      }
    }
    const old = envelope.period.costAttribution!;
    if (old.entries.length) {
      const declared = new Map<string, number>();
      for (const entry of old.entries) {
        const a = entry.allocation;
        const key = canonical(
          a.method === 'equal' || a.method === 'tokens'
            ? { ...a, taskIds: [...a.taskIds].sort() }
            : a,
        );
        declared.set(key, (declared.get(key) ?? 0) + entry.netMinor);
      }
      for (const [key, entry] of pools) {
        // A gap without a mapping can already be covered by the older invoice.
        // It does not contradict that independent declaration.
        if (reconciliation && !mappingComplete && entry.allocation.method === 'unallocated')
          continue;
        const amount = declared.get(key);
        if (
          amount === undefined ||
          amount < entry.netMinor ||
          (mappingComplete && amount !== entry.netMinor)
        )
          throw new Error('本地费用与已有逐项归属不一致，请核对账单及目标映射');
      }
      if (mappingComplete && [...declared].some(([key, amount]) => !pools.has(key) && amount > 0))
        throw new Error('完整本地账本缺少已声明的费用归属');
      // A partial capture never overwrites an already recorded allocation.
    } else {
      const mappedTasks = new Set(
        [...pools.values()].flatMap((e) => attributionTargets(e.allocation)),
      );
      envelope.period.costAttribution = {
        version: 'cost-attribution-1',
        coverage:
          chargesComplete && (!reconciliation || envelope.tasks.every((t) => mappedTasks.has(t.id)))
            ? 'complete'
            : 'partial',
        entries: [...pools.values()],
      };
    }
    if (reconciliation && !chargesComplete) envelope.period.costAttribution!.coverage = 'partial';
  }
  envelope.period.costComponents = Object.fromEntries(
    ['model', 'harness', 'tool', 'compute', 'storage', 'network', 'other'].map((component) => [
      component,
      chargesComplete && (!reconciliation || reconciliation.summary.unclassifiedMinor === 0)
        ? direct.filter((c) => c.component === component).reduce((sum, c) => sum + c.amountMinor, 0)
        : null,
    ]),
  ) as NonNullable<Envelope['period']['costComponents']>;
  for (const task of envelope.tasks) {
    const e = task.evaluation!;
    const owned = agentsByTask.get(task.id) ?? [],
      ownEvents = eventsByTask.get(task.id) ?? [];
    const ownResources = resourcesByTask.get(task.id) ?? [];
    for (const key of resourceMetrics)
      e.resources[key] =
        packet.coverage.resources[key] === 'complete' &&
        ownResources.every((r) => r.usage[key] !== null)
          ? ownResources.reduce((sum, r) => sum + r.usage[key]!, 0)
          : null;
    if (
      packet.coverage.agents === 'complete' &&
      owned.filter((a) => a.parentId === null).length < 1
    )
      throw new Error('完整代理范围中每项目标必须有完整的根代理与参与映射');
    e.execution.agentCoverage = packet.coverage.agents;
    e.execution.agentCount = packet.coverage.agents === 'complete' ? owned.length : null;
    e.execution.maxAgentDepth =
      packet.coverage.agents === 'complete'
        ? owned.reduce((maximum, a) => Math.max(maximum, depths.get(a.id)!), 0)
        : null;
    e.execution.harnesses =
      packet.coverage.agents === 'complete'
        ? [...new Map(owned.map((a) => [canonical(a.harness), a.harness])).values()]
        : null;
    for (const [key, kind] of Object.entries({
      userTurns: 'user_turn',
      assistantTurns: 'assistant_turn',
      modelCalls: 'model_call',
      toolCalls: 'tool_call',
      toolFailures: 'tool_failure',
      contextResets: 'context_reset',
      contextCompactions: 'context_compaction',
      humanInterventions: 'human_intervention',
      requirementChanges: 'requirement_change',
    })) {
      const coverage = kind === 'model_call' ? packet.coverage.calls : packet.coverage.events[kind];
      (e.execution as Record<string, unknown>)[key] =
        coverage === 'complete' ? ownEvents.filter((event) => event.kind === kind).length : null;
    }
    const calls = ownEvents.filter((v) => v.kind === 'model_call');
    if (packet.coverage.calls === 'complete' && calls.length && calls.every((c) => c.usage)) {
      const models = new Map<string, Usage[]>();
      for (const call of calls) {
        const usage = call.usage!,
          key = canonical([usage.provider, usage.model, usage.version]);
        if (!models.has(key)) models.set(key, []);
        models.get(key)!.push(usage);
      }
      task.models = [...models.values()].map((usages) => {
        const first = structuredClone(usages[0]);
        for (const field of [
          'inputTokens',
          'cachedInputTokens',
          'cacheWriteTokens',
          'outputTokens',
          'reasoningTokens',
          'apiEquivalentMinor',
        ] as const)
          first[field] = usages.every((u) => u[field] != null)
            ? usages.reduce((sum, u) => sum + u[field]!, 0)
            : null;
        const history = [
          ...new Map(
            usages
              .flatMap((u) => [
                ...(u.priceHistory ?? []),
                ...(u.priceSnapshot ? [u.priceSnapshot] : []),
              ])
              .map((p) => [canonical(p), p]),
          ).values(),
        ];
        const versions = [...new Set(usages.map((u) => u.priceVersion))];
        first.priceHistory = history;
        if (history.length > 128) throw new Error('历史价格快照超过上限，请缩小采集范围');
        const metering = mergePriceMetering(usages, envelope.period.currency);
        if (metering) first.priceMetering = metering;
        first.equivalentConversions = [
          ...new Map(
            usages.flatMap((u) => u.equivalentConversions ?? []).map((r) => [canonical(r), r]),
          ).values(),
        ];
        if (first.equivalentConversions.length > 128)
          throw new Error('历史汇率快照超过上限，请缩小采集范围');
        first.priceVersion =
          versions.length === 1 ? versions[0] : 'mixed-' + hash(versions.sort()).slice(0, 32);
        first.priceSnapshot = versions.length === 1 && history.length === 1 ? history[0] : null;
        return first;
      });
    } else if (
      packet.coverage.calls !== 'complete' ||
      !calls.length ||
      calls.some((c) => !c.usage)
    ) {
      // Unknown descendants may contain another model: don't rank a falsely single-model task.
      e.execution.agentCoverage = 'partial';
    }
    if (!chargesComplete) e.execution.costScope = 'partial';
    if (envelope.period.billing === 'api' && envelope.period.allocation !== 'itemized') {
      const known = (chargesByTask.get(task.id) ?? []).reduce((sum, c) => sum + c.amountMinor, 0);
      if (mappingComplete) task.directCostMinor = known;
      else if (known > task.directCostMinor)
        throw new Error('已知费用小计超过原记录金额，请核对归属与账单');
      // A partial event ledger does not erase an already recorded invoice total.
    }
  }
  const completeAgents =
    packet.coverage.agents === 'complete' &&
    envelope.tasks.every((t) => t.evaluation?.execution.agentCoverage === 'complete');
  envelope.executionScope = {
    version: 'execution-scope-1',
    coverage: completeAgents
      ? 'complete'
      : packet.coverage.agents === 'unknown'
        ? 'unknown'
        : 'partial',
    uniqueAgents: completeAgents ? agents.length : null,
    rootAgents: completeAgents ? agents.filter(a => a.parentId === null).length : null,
    agentTaskAssignments: completeAgents ? assignments : null,
    sharedAgents: completeAgents ? agents.filter((a) => belongs(a).length > 1).length : null,
    maxAgentDepth: completeAgents
      ? [...depths.values()].reduce((maximum, depth) => Math.max(maximum, depth), 0)
      : null,
    observedAgents: agents.length,
  };
  envelope.collector = {
    id: packet.collector.id,
    version: packet.collector.version,
    digest: hash({
      salt: packet.collector.salt,
      collectionWindow: envelope.collectionWindow,
      collectionProcessing: envelope.collectionProcessing,
      manifest: packet.manifest,
      agents,
      events,
      charges,
      ...(packet.chargeCoverage ? { chargeCoverage: packet.chargeCoverage } : {}),
      resources,
      workItems,
      workGraphs,
      ...(packet.taskHistory ? { taskHistory: packet.taskHistory } : {}),
      ...(packet.codeMeasurements ? { codeMeasurements: packet.codeMeasurements } : {}),
      coverage: packet.coverage,
    }),
  };
  return {
    envelope: EnvelopeSchema.parse(envelope),
    report: {
      ...(codeMeasurements ? { codeMeasurements } : {}),
      agents: agents.length,
      maxDepth: completeAgents
        ? [...depths.values()].reduce((maximum, depth) => Math.max(maximum, depth), 0)
        : null,
      directCharges: charges.filter((c) => c.scope === 'direct').length,
      ignoredAggregateCharges: reconciliation
        ? 0
        : charges.filter((c) => c.scope === 'aggregate').length,
      ...(reconciliation ? { chargeReconciliation: reconciliation.summary } : {}),
      directResources: directResources.length,
      finalWorkItems: itemReport?.finalItems ?? null,
      ignoredAggregateWorkItems: itemReport?.ignoredAggregateItems ?? 0,
      duplicatesRemoved:
        packet.agents.length +
        packet.events.length +
        packet.charges.length +
        packet.resources.length -
        agents.length -
        events.length -
        charges.length -
        resources.length +
        (packet.workItems?.length ?? 0) -
        (workItems?.length ?? 0),
    },
  };
}
