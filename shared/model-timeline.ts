import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const publicName = z.string().regex(/^[a-z0-9][a-z0-9._:+-]{0,71}$/);
export const TimelineModelSchema = z.object({ provider: publicName, model: publicName, version: publicName }).strict();
export type TimelineModel = z.infer<typeof TimelineModelSchema>;
export const tokenFields = ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens'] as const;
export const TimelineTokensSchema = z.object({
  inputTokens: count.nullable(), cachedInputTokens: count.nullable(), cacheWriteTokens: count.nullable(),
  outputTokens: count.nullable(), reasoningTokens: count.nullable(),
}).strict();
export type TimelineTokens = z.infer<typeof TimelineTokensSchema>;
export const emptyTimelineTokens = (): TimelineTokens => ({ inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, reasoningTokens: null });
const Segment = z.object({
  ordinal: count, model: TimelineModelSchema.nullable(), firstAt: z.string().datetime().nullable(), lastAt: z.string().datetime().nullable(),
  observations: count.positive(), tokens: TimelineTokensSchema, knownTokens: TimelineTokensSchema,
  apiEquivalentMinor: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(), currency: z.enum(['CNY', 'USD', 'EUR']).nullable(),
}).strict();
const Stream = z.object({
  stream: count, ordering: z.enum(['sequence', 'timestamp', 'unknown']), observations: count,
  segments: z.array(Segment).max(2048),
}).strict();
export const ModelTimelineSchema = z.object({
  version: z.literal('model-timeline-1'), coverage: z.enum(['complete', 'partial', 'unknown']),
  switches: count.nullable(), observedSwitches: count, unsequencedObservations: count,
  streams: z.array(Stream).max(1000),
}).strict().superRefine((value, ctx) => {
  let switches = 0, unsequenced = 0, size = 0;
  for (const [i, stream] of value.streams.entries()) {
    if (stream.stream !== i) ctx.addIssue({ code: 'custom', message: '模型时间线来源序号不连续' });
    size += stream.segments.length;
    if (stream.ordering === 'unknown') {
      unsequenced += stream.observations;
      if (stream.segments.length) ctx.addIssue({ code: 'custom', message: '未知顺序不能生成有序模型阶段' });
    } else if (stream.segments.reduce((n, s) => n + s.observations, 0) !== stream.observations)
      ctx.addIssue({ code: 'custom', message: '模型阶段观察数不守恒' });
    for (const [j, segment] of stream.segments.entries()) {
      if (segment.ordinal !== j || (segment.firstAt && segment.lastAt && Date.parse(segment.firstAt) > Date.parse(segment.lastAt)))
        ctx.addIssue({ code: 'custom', message: '模型阶段序号或时间无效' });
      for (const key of tokenFields) if (segment.tokens[key] !== null && segment.knownTokens[key] !== segment.tokens[key])
        ctx.addIssue({ code: 'custom', message: '完整 Token 与已知小计不一致' });
      if (segment.apiEquivalentMinor !== null && segment.currency === null)
        ctx.addIssue({ code: 'custom', message: 'API 等价费用需要币种' });
      const previous = stream.segments[j - 1];
      if (previous?.model && segment.model && modelKey(previous.model) !== modelKey(segment.model)) switches++;
    }
  }
  if (size > 2048 || unsequenced !== value.unsequencedObservations || switches !== value.observedSwitches ||
      (value.coverage === 'complete' ? value.switches !== switches || unsequenced > 0 || !value.streams.length || value.streams.some(s => s.segments.some(p => !p.model)) : value.switches !== null))
    ctx.addIssue({ code: 'custom', message: '模型时间线覆盖或切换计数不一致，最多 2048 个阶段' });
});
export type ModelTimeline = z.infer<typeof ModelTimelineSchema>;
export type ModelObservation = {
  stream: string; model: TimelineModel | null; at?: string | null; sequence?: number;
  tokens: TimelineTokens; apiEquivalentMinor?: number | null; currency?: 'CNY' | 'USD' | 'EUR' | null;
};
const modelKey = (m: TimelineModel | null) => m ? JSON.stringify([m.provider, m.model, m.version]) : 'unknown';

/** Never order independent agents against each other. Input IDs stay local. */
export function buildModelTimeline(observations: ModelObservation[], complete: boolean): ModelTimeline {
  const groups = new Map<string, ModelObservation[]>();
  for (const observation of observations) {
    if (!groups.has(observation.stream)) groups.set(observation.stream, []);
    groups.get(observation.stream)!.push(observation);
  }
  const streams: ModelTimeline['streams'] = [];
  let observedSwitches = 0, unsequencedObservations = 0, unknownModels = false;
  for (const rows of groups.values()) {
    const sequence = rows.every(r => Number.isSafeInteger(r.sequence) && r.sequence! >= 0) && new Set(rows.map(r => r.sequence)).size === rows.length;
    const timestamps = rows.every(r => r.at && Number.isFinite(Date.parse(r.at)));
    const atModels = new Map<number, string>();
    let ambiguous = false;
    if (timestamps) for (const r of rows) {
      const at = Date.parse(r.at!), model = modelKey(r.model);
      if (atModels.has(at) && atModels.get(at) !== model) ambiguous = true;
      atModels.set(at, model);
    }
    const ordering = sequence ? 'sequence' : timestamps && !ambiguous ? 'timestamp' : 'unknown';
    const stream: ModelTimeline['streams'][number] = { stream: streams.length, ordering, observations: rows.length, segments: [] };
    streams.push(stream);
    if (ordering === 'unknown') { unsequencedObservations += rows.length; continue; }
    rows.sort((a, b) => sequence ? a.sequence! - b.sequence! : Date.parse(a.at!) - Date.parse(b.at!));
    let phase: ModelObservation[] = [];
    const flush = () => {
      if (!phase.length) return;
      const tokens = emptyTimelineTokens(), knownTokens = emptyTimelineTokens();
      for (const key of tokenFields) {
        const known = phase.map(p => p.tokens[key]).filter((v): v is number => v !== null);
        knownTokens[key] = known.length ? known.reduce((a, b) => a + b, 0) : null;
        tokens[key] = known.length === phase.length ? knownTokens[key] : null;
      }
      const times = phase.map(p => p.at).filter((v): v is string => Boolean(v)).sort();
      const currencies = new Set(phase.map(p => p.currency ?? null));
      const currency = currencies.size === 1 ? phase[0].currency ?? null : null;
      stream.segments.push({ ordinal: stream.segments.length, model: phase[0].model,
        firstAt: times[0] ?? null, lastAt: times.at(-1) ?? null, observations: phase.length, tokens, knownTokens,
        currency, apiEquivalentMinor: currency && phase.every(p => p.apiEquivalentMinor != null) ? phase.reduce((n, p) => n + p.apiEquivalentMinor!, 0) : null });
      phase = [];
    };
    for (const row of rows) {
      if (!row.model) unknownModels = true;
      if (phase.length && modelKey(phase[0].model) !== modelKey(row.model)) {
        if (phase[0].model && row.model) observedSwitches++;
        flush();
      }
      phase.push(row);
    }
    flush();
  }
  const coverage = !observations.length ? 'unknown' : complete && !unsequencedObservations && !unknownModels ? 'complete' : 'partial';
  return ModelTimelineSchema.parse({ version: 'model-timeline-1', coverage, switches: coverage === 'complete' ? observedSwitches : null,
    observedSwitches, unsequencedObservations, streams });
}

export function combineModelTimelines(values: (ModelTimeline | undefined)[]): ModelTimeline {
  const present = values.filter((v): v is ModelTimeline => Boolean(v));
  const streams = present.flatMap(v => v.streams).map((s, i) => ({ ...s, stream: i }));
  const complete = values.length > 0 && values.every(v => v?.coverage === 'complete');
  const observedSwitches = present.reduce((n, v) => n + v.observedSwitches, 0);
  return ModelTimelineSchema.parse({ version: 'model-timeline-1', coverage: complete ? 'complete' : streams.length ? 'partial' : 'unknown',
    switches: complete ? observedSwitches : null, observedSwitches,
    unsequencedObservations: present.reduce((n, v) => n + v.unsequencedObservations, 0), streams });
}
