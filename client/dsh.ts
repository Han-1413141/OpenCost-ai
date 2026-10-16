import {
  evaluatePriceMetering,
  mergePriceMetering,
  sumQuoteMinor,
} from '../shared/price-metering.js';
/** Local DSH adapter. Importing observations never grants upload consent. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical, publicId, UsageSchema, type Usage } from '../shared/schema.js';
import { CollectionWindowSchema } from '../shared/collection.js';
import { SubscriptionSnapshotSchema } from '../shared/subscriptions.js';

const ref = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().datetime();
const number = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = number.int().nullable();
const version = z.string().regex(/^(?:unknown|\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)$/);
const CallSchema = z
  .object({
    type: z.literal('call'),
    id: ref,
    at: time,
    recordedAt: time,
    agentId: ref.nullable(),
    provider: publicId,
    model: publicId,
    tokens: z
      .object({
        input: count,
        cacheRead: count,
        cacheWrite: count,
        output: count,
        reasoning: count,
      })
      .strict(),
    billing: z.enum(['api', 'plan', 'unknown']),
    quote: z
      .object({
        currency: z.enum(['CNY', 'USD']),
        amount: number.nullable(),
        exchangeRate: number.positive().nullable(),
        rates: z
          .object({
            input: number.nullable(),
            cacheRead: number.nullable(),
            cacheWrite: number.nullable(),
            output: number.nullable(),
            reasoning: number.nullable(),
          })
          .strict(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const DshExportSchema = z
  .object({
    format: z.literal('dsh-opencost-export-1'),
    generatedAt: time,
    collector: z.object({ id: z.literal('dsh-cost-meter'), version }).strict(),
    harness: z.object({ id: z.literal('dsh'), version, surface: z.literal('unknown') }).strict(),
    window: z
      .object({ startAt: time, endAt: time })
      .strict()
      .refine((v) => {
        const n = Date.parse(v.endAt) - Date.parse(v.startAt);
        return n > 0 && n <= 90 * 86400000;
      }),
    coverage: z
      .object({
        calls: z.literal('partial'),
        agents: z.literal('partial'),
        charges: z.literal('unknown'),
      })
      .strict(),
    agents: z
      .array(
        z
          .object({
            id: ref,
            parentId: ref.nullable(),
            relationship: z.enum(['root', 'subagent', 'unknown']),
          })
          .strict(),
      )
      .max(100000),
    calls: z.array(CallSchema).max(100000),
    quotas: z
      .array(
        z
          .object({
            type: z.literal('quota'),
            id: ref,
            at: time,
            provider: publicId,
            window: z.enum(['fiveHour', 'daily', 'weekly', 'monthly', 'unknown']),
            poolId: ref,
            usedPercent: number.max(100).nullable(),
            resetsAt: time.nullable(),
            unlimited: z.boolean(),
          })
          .strict(),
      )
      .max(100000),
    integrity: z
      .object({
        algorithm: z.literal('sha256'),
        digest: ref,
        assurance: z.literal('local_unverified'),
      })
      .strict(),
  })
  .strict();
type DshExport = z.infer<typeof DshExportSchema>;
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const uuid = (key: string) => {
  const h = hash(key);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
function unique<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    if (seen.has(row.id) && canonical(seen.get(row.id)) !== canonical(row))
      throw new Error('同一 DSH 记录标识对应不同内容，已停止导入');
    seen.set(row.id, row);
  }
  return [...seen.values()];
}
export function readDshExport(input: unknown) {
  const parsed = DshExportSchema.parse(input);
  // Verify the exact payload order emitted by the plugin, before any projection.
  const { integrity, ...body } = input as DshExport;
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (digest !== integrity.digest)
    throw new Error('DSH 导出摘要不一致；请重新导出，不要手改导出文件');
  return {
    ...parsed,
    calls: unique(parsed.calls),
    quotas: unique(parsed.quotas),
    agents: unique(parsed.agents),
  };
}
function rootsOf(data: DshExport) {
  const byId = new Map(data.agents.map((a) => [a.id, a])),
    roots = new Map<string, string>();
  for (const agent of data.agents) {
    const path: string[] = [],
      active = new Set<string>();
    let current = agent;
    while (!roots.has(current.id)) {
      if (active.has(current.id)) throw new Error('DSH 代理关系存在循环');
      active.add(current.id);
      path.push(current.id);
      if (!current.parentId) {
        roots.set(current.id, current.id);
        break;
      }
      const parent = byId.get(current.parentId);
      if (!parent) throw new Error('DSH 缺少父代理记录，请补齐导出范围');
      current = parent;
    }
    for (const id of path) roots.set(id, roots.get(current.id)!);
  }
  for (const call of data.calls)
    if (call.agentId && !byId.has(call.agentId)) throw new Error('DSH 调用缺少代理记录');
  return roots;
}
export function inspectDsh(input: unknown) {
  const data = readDshExport(input),
    roots = rootsOf(data);
  return {
    window: data.window,
    harness: data.harness,
    calls: data.calls.length,
    quotaSamples: data.quotas.length,
    rootMapping: Object.fromEntries([...new Set(roots.values())].map((id) => [id, null])),
    unassignedCalls: data.calls.filter((c) => !c.agentId).length,
    assurance: 'local_unverified',
    note: '映射值填写已有根目标 UUID；会话不是已完成任务。未知父子关系、实付与完成情况不得推断。',
  };
}
function usageOf(call: DshExport['calls'][number]): Usage {
  const q = call.quote,
    t = call.tokens;
  const snapshotId = q ? hash({ currency: q.currency, rates: q.rates }) : null;
  const priceVersion = snapshotId ? 'dsh-' + snapshotId.slice(0, 24) : null;
  const input = [t.input, t.cacheRead, t.cacheWrite];
  // DSH input/cacheRead/cacheWrite are mutually exclusive. OpenCost-AI input includes all three.
  return UsageSchema.parse({
    provider: call.provider,
    model: call.model,
    version: 'unknown',
    inputTokens: input.every((v) => v !== null) ? input.reduce<number>((s, v) => s + v!, 0) : null,
    cachedInputTokens: t.cacheRead,
    cacheWriteTokens: t.cacheWrite,
    outputTokens: t.output,
    reasoningTokens:
      t.reasoning !== null && t.output !== null && t.reasoning <= t.output ? t.reasoning : null,
    // Convert after summing, when the billing currency is known. No per-call cent rounding.
    apiEquivalentMinor: null,
    priceVersion,
    priceMetering: {
      version: 'price-metering-1',
      coverage:
        q &&
        [t.input, t.cacheRead, t.cacheWrite, t.output].every((v) => v !== null) &&
        (!(q.rates.reasoning ?? 0) || t.reasoning !== null)
          ? 'complete'
          : 'partial',
      segments: snapshotId
        ? [
            {
              snapshotId,
              meters: Object.entries({
                input_million_tokens: t.input,
                cached_input_million_tokens: t.cacheRead,
                cache_write_million_tokens: t.cacheWrite,
                output_million_tokens: t.output,
                reasoning_surcharge_million_tokens: t.reasoning,
              })
                .filter(([, value]) => value !== null)
                .map(([unit, quantity]) => ({ unit, quantity })),
            },
          ]
        : [],
    },
    priceSnapshot: q
      ? {
          version: priceVersion,
          currency: q.currency,
          capturedAt: call.recordedAt,
          effectiveFrom: null,
          source: 'unknown',
          sourceId: 'dsh-configured-price',
          snapshotId,
          rates: Object.entries({
            input_million_tokens: q.rates.input,
            cached_input_million_tokens: q.rates.cacheRead,
            cache_write_million_tokens: q.rates.cacheWrite,
            output_million_tokens: q.rates.output,
            // DSH costOf treats missing reasoning rate as no additional charge.
            reasoning_surcharge_million_tokens: q.rates.reasoning ?? 0,
          })
            .filter(([, value]) => value !== null)
            .map(([unit, amount]) => ({ unit, amount })),
        }
      : null,
  });
}

/** Enrich an init-created LOCAL draft, keeping required unknowns invalid for upload. */
export function importDsh(input: unknown, capture: any, mappingInput: unknown = {}) {
  const data = readDshExport(input);
  if (capture?.format !== 'opencost-local-capture-1' || capture.envelope?.schemaVersion !== '1.1')
    throw new Error('请先运行 init 生成本地 capture 模板并选择时间范围');
  const window = CollectionWindowSchema.parse(capture.envelope.collectionWindow);
  const start = Date.parse(window.startAt),
    end = Date.parse(window.endAt);
  if (end <= Date.parse(data.window.startAt) || start >= Date.parse(data.window.endAt))
    throw new Error('DSH 导出与已选采集时间范围没有交集');
  const packet = structuredClone(capture);
  const oldDsh = packet.manifest?.dsh;
  if (oldDsh && canonical(oldDsh.window) !== canonical(window))
    throw new Error('时间范围已变化，请新建 capture，避免带入此前范围的数据');
  if ((packet.events?.length || packet.agents?.length) && !oldDsh)
    throw new Error('请使用独立 capture 导入 DSH，避免与其他采集器重复记账');
  const oldMapping = z.record(ref, z.string().uuid()).parse(oldDsh?.mapping ?? {});
  const newMapping = z.record(ref, z.string().uuid()).parse(mappingInput);
  for (const [root, taskId] of Object.entries(newMapping))
    if (oldMapping[root] && oldMapping[root] !== taskId)
      throw new Error('已导入的根目标映射不能改写，请新建草稿核对');
  const mapping = { ...oldMapping, ...newMapping };
  const sourceAgents = unique([
    ...DshExportSchema.shape.agents.parse(oldDsh?.sourceAgents ?? []),
    ...data.agents,
  ]);
  const roots = rootsOf({ ...data, agents: sourceAgents });
  const tasks = new Map<string, any>(packet.envelope.tasks.map((t: any) => [t.id, t]));
  for (const [root, task] of Object.entries(mapping))
    if (roots.get(root) !== root || !tasks.has(task))
      throw new Error('代理根映射必须引用已有根目标，不能用会话数量生成任务量');
  const selected = data.calls.filter(
    (c) => Date.parse(c.recordedAt) >= start && Date.parse(c.recordedAt) < end,
  );
  const observations = unique([
    ...z.array(CallSchema).parse(oldDsh?.observations ?? []),
    ...selected,
  ]);
  const byId = new Map(sourceAgents.map((a) => [a.id, a]));
  const included = new Set(
    observations.map((c) => c.agentId).filter((id): id is string => id !== null),
  );
  for (const id of included) {
    const parent = byId.get(id)?.parentId;
    if (parent) included.add(parent);
  }
  const events: any[] = [],
    agents: any[] = [],
    unassigned: DshExport['calls'] = [];
  for (const a of sourceAgents.filter((a) => included.has(a.id))) {
    const taskId = mapping[roots.get(a.id)!];
    if (taskId) agents.push({ id: a.id, parentId: a.parentId, taskId, harness: data.harness });
  }
  for (const call of observations) {
    const taskId = call.agentId ? mapping[roots.get(call.agentId)!] : null;
    if (!taskId) {
      unassigned.push(call);
      continue;
    }
    events.push({
      id: call.id,
      taskId,
      agentId: call.agentId,
      kind: 'model_call',
      at: call.at,
      usage: usageOf(call),
    });
  }
  packet.agents = unique([...(packet.agents ?? []), ...agents]);
  const eventTimes = new Map(events.map(e => [e.id, e.at]));
  packet.events = unique([...(packet.events ?? []).map((e: any) => eventTimes.has(e.id) && e.at === undefined ? { ...e, at: eventTimes.get(e.id) } : e), ...events]);
  packet.coverage.agents = 'partial';
  packet.coverage.calls = 'partial';
  // DSH quotations are not actual charges, and cannot establish cost completeness.
  packet.coverage.charges = 'unknown';
  packet.manifest ??= {};
  packet.manifest.dsh = {
    format: data.format,
    version: data.collector.version,
    mapping,
    window,
    sourceAgents: sourceAgents.filter((a) => included.has(a.id)),
    observations,
    quotaObservations: unique([
      ...(oldDsh?.quotaObservations ?? []),
      ...data.quotas.filter((q) => Date.parse(q.at) >= start && Date.parse(q.at) < end),
    ]),
    unassignedIds: unassigned.map((c) => c.id),
    semantics:
      'input_excludes_cache; output_includes_reasoning; observations_partial; prices_api_equivalent',
    hashes: [...new Set([...(oldDsh?.hashes ?? []), data.integrity.digest])],
    assurance: 'local_unverified',
  };
  for (const task of tasks.values()) {
    const calls = packet.events.filter((c: any) => c.taskId === task.id && c.kind === 'model_call');
    if (!calls.length) continue;
    if (task.evaluation?.version !== 'work-summary-1')
      throw new Error('DSH 导入只使用难度关闭的 work-summary-1 模板');
    // Do not erase a user-verified primary Harness, or stamp today's metadata
    // over unknown historical versions. Each observed agent remains a DSH agent.
    if (!task.harness.id || task.harness.id === 'unknown')
      task.harness = { ...task.harness, ...data.harness };
    else if (task.harness.id === 'dsh') {
      if (!task.harness.version || task.harness.version === 'unknown')
        task.harness.version = data.harness.version;
      if (!task.harness.surface || task.harness.surface === 'unknown')
        task.harness.surface = data.harness.surface;
    }
    task.evaluation.execution.agentCoverage = 'partial';
    task.evaluation.execution.costScope = 'partial';
    task.evaluation.execution.modelCalls = null;
    const grouped = new Map<string, Usage[]>();
    for (const event of calls) {
      const key = canonical([event.usage.provider, event.usage.model, event.usage.version]);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(event.usage);
    }
    task.models = [...grouped.values()].map((values) => {
      const first = structuredClone(values[0]);
      for (const key of [
        'inputTokens',
        'cachedInputTokens',
        'cacheWriteTokens',
        'outputTokens',
        'reasoningTokens',
      ] as const)
        first[key] = values.every((v) => v[key] != null)
          ? values.reduce((sum, v) => sum + v[key]!, 0)
          : null;
      first.priceMetering = mergePriceMetering(values, packet.envelope.period.currency);
      const prices = values
        .flatMap((v) => (v.priceSnapshot ? [v.priceSnapshot] : []))
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
      first.priceHistory = [
        ...new Map(
          prices
            .slice()
            .reverse()
            .map((p) => [p.snapshotId ?? canonical(p), p]),
        ).values(),
      ];
      if (first.priceHistory.length > 128)
        throw new Error('历史价格快照超过上限，请按较小范围分批，不能截断');
      first.priceSnapshot = first.priceHistory.length === 1 ? first.priceHistory[0] : null;
      first.priceVersion =
        first.priceSnapshot?.version ??
        (first.priceHistory.length ? 'mixed-' + hash(first.priceHistory).slice(0, 24) : null);
      const ids = new Set(
        calls
          .filter(
            (c: any) =>
              canonical([c.usage.provider, c.usage.model, c.usage.version]) ===
              canonical([first.provider, first.model, first.version]),
          )
          .map((c: any) => c.id),
      );
      const quotes = observations.filter((c: any) => ids.has(c.id)).map((c: any) => c.quote);
      const quotesComplete =
        quotes.length === ids.size &&
        quotes.every(
          (q: any) => q && q.amount !== null && q.currency === packet.envelope.period.currency,
        );
      first.apiEquivalentMinor = quotesComplete
        ? sumQuoteMinor(quotes.map((q: any) => q.amount))
        : null;
      if (quotesComplete && first.apiEquivalentMinor === null)
        throw new Error('来源报价汇总超过金额上限，请缩小采集范围，不能丢弃报价');
      const result = evaluatePriceMetering(first, packet.envelope.period.currency);
      if (result.status === 'incomplete' && first.priceMetering)
        first.priceMetering.coverage = 'partial';
      return UsageSchema.parse(first);
    });
  }
  return {
    packet,
    report: {
      calls: selected.length,
      mappedCalls: events.length,
      unassignedCalls: unassigned.length,
      agents: agents.length,
      quotaSamples: packet.manifest.dsh.quotaObservations.length,
      requiredFacts: [
        '根目标与代理映射',
        '公开 Harness 版本',
        '已完成量及验收依据',
        '实际付款与完整账期',
        '缺失的其他代理、工具和资源支出',
      ],
      note: '已知 Token 为观察小计；采集范围保持 partial，不能进入完整成本排名。未新增任何完成量、难度、实际付款或上传授权。',
    },
  };
}

/** Quota percentages are observations, never a guessed numeric subscription allowance. */
export function dshSubscriptionSnapshots(input: unknown, selectedWindow: unknown) {
  const data = readDshExport(input),
    grouped = new Map<string, DshExport['quotas']>();
  const window = CollectionWindowSchema.parse(selectedWindow);
  for (const q of data.quotas) {
    if (
      Date.parse(q.at) < Date.parse(window.startAt) ||
      Date.parse(q.at) >= Date.parse(window.endAt)
    )
      continue;
    // The plugin isolates credential scopes. Unknown identities cannot share a pool.
    const key = q.poolId + '/' + q.at;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(q);
  }
  return [...grouped.values()].map((rows) => {
    const first = rows[0];
    return SubscriptionSnapshotSchema.parse({
      observationId: uuid(first.id),
      subscriptionRef: uuid(first.poolId),
      observedAt: first.at,
      provider: first.provider,
      plan: 'unknown',
      planVersion: 'unknown',
      tier: null,
      harnesses: [data.harness],
      billingCycle: 'unknown',
      seats: null,
      status: 'unknown',
      autoRenew: null,
      cycleStartsAt: null,
      cycleEndsAt: null,
      priceMinor: null,
      currency: null,
      priceBasis: 'unknown',
      offerSnapshotId: null,
      source: 'harness_meter',
      freshness: 'unknown',
      pools: rows.map((q) => ({
        poolRef: uuid(q.poolId),
        name: null,
        resource: 'other',
        unit: 'unknown',
        currency: null,
        semantics: 'unknown',
        category: 'unknown',
        sharing: 'unknown',
        scope: 'unknown',
        models: null,
        harnesses: [data.harness],
        window: {
          kind: 'unknown',
          durationSeconds: null,
          calendarUnit: null,
          timeZone: null,
          startsAt: null,
          endsAt: null,
          resetsAt: q.resetsAt,
        },
        capacity: { status: q.unlimited ? 'unlimited' : 'undisclosed', total: null },
        used: null,
        remaining: null,
        percent:
          q.usedPercent === null
            ? null
            : { direction: 'used', value: q.usedPercent, precision: 'unknown' },
        precision: 'unknown',
        resetObserved: null,
        ledger: null,
        expiresAt: null,
        policyVersion: null,
      })),
    });
  });
}
