import { publicJournalModel } from '../shared/public-models.js';
import { buildModelTimeline, emptyTimelineTokens, type ModelObservation, type TimelineModel, type TimelineTokens } from '../shared/model-timeline.js';

const measured = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const sum = (...v: unknown[]) => v.every(n => measured(n) !== null) ? (v as number[]).reduce((a, b) => a + b, 0) : null;
const modelOf = (raw: unknown): TimelineModel | null => {
  const model = publicJournalModel(raw);
  return model ? { provider: 'unknown', model, version: 'unknown' } : null;
};

/** One pass over already-authorized JSONL events; no model calls and no raw text retained. */
export class LogModelUsage {
  private rows: ModelObservation[] = [];
  private active: TimelineModel | null = null;
  private previous: TimelineTokens | null = null;
  private started = false;
  private complete = true;
  private seen = new Map<string, { value: string; row: ModelObservation }>();
  private ordinal = 0;
  constructor(private harness: string, private from: number, private through: number) {}
  invalid() { this.complete = false; }
  feed(e: any) {
    const rawAt = e?.timestamp ?? e?.at ?? e?.time ?? e?.data?.at;
    const at = typeof rawAt === 'number' ? rawAt : typeof rawAt === 'string' ? Date.parse(rawAt) : NaN;
    if (!Number.isFinite(at)) return;
    const p = e.payload ?? e.data ?? e;
    const inWindow = at >= this.from && at < this.through;
    if (at >= this.through) return;
    if (this.harness === 'codex' && e.type === 'session_meta' && inWindow) this.started = true;
    if (this.harness === 'codex' && e.type === 'turn_context') { this.active = modelOf(p.model); return; }
    let model: TimelineModel | null = null, tokens = emptyTimelineTokens(), id: string | undefined;
    let stream = 'session';
    if (this.harness === 'codex' && e.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
      const u = p.info.total_token_usage;
      const current = { inputTokens: measured(u.input_tokens), cachedInputTokens: measured(u.cached_input_tokens), cacheWriteTokens: null,
        outputTokens: measured(u.output_tokens), reasoningTokens: measured(u.reasoning_output_tokens) };
      const base = this.previous ?? (this.started ? { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: null, outputTokens: 0, reasoningTokens: 0 } : null);
      this.previous = current;
      if (!inWindow) return;
      if (base && JSON.stringify(base) === JSON.stringify(current)) return; // Repeated quota notifications are not another call.
      for (const key of Object.keys(current) as (keyof TimelineTokens)[]) {
        const a = current[key], b = base?.[key] ?? null;
        tokens[key] = a !== null && b !== null && a >= b ? a - b : null;
      }
      model = this.active;
      if (!base || tokens.inputTokens === null || tokens.outputTokens === null) this.complete = false;
    } else if (e.type === 'call') {
      if (!inWindow) return;
      model = modelOf(e.model); const u = e.tokens;
      tokens = { inputTokens: sum(u?.input, u?.cacheRead, u?.cacheWrite), cachedInputTokens: measured(u?.cacheRead), cacheWriteTokens: measured(u?.cacheWrite),
        outputTokens: measured(u?.output), reasoningTokens: measured(u?.reasoning) };
      // Export files can contain many agents. Their calls must never form one artificial sequence.
      stream = typeof e.agentId === 'string' ? e.agentId : `unknown-agent-${this.ordinal++}`;
      if (typeof e.agentId !== 'string') this.complete = false;
      id = e.id;
    } else if (e.message?.role === 'assistant') {
      if (!inWindow) return;
      model = modelOf(e.message.model); const u = e.message.usage;
      tokens = { inputTokens: sum(u?.input_tokens, u?.cache_read_input_tokens, u?.cache_creation_input_tokens), cachedInputTokens: measured(u?.cache_read_input_tokens),
        cacheWriteTokens: measured(u?.cache_creation_input_tokens), outputTokens: measured(u?.output_tokens), reasoningTokens: measured(u?.reasoning_output_tokens) };
      id = e.message.id ?? e.uuid ?? e.id;
    } else return;
    if (!model) this.complete = false;
    const row: ModelObservation = { stream, model, at: new Date(at).toISOString(), ...(e.type === 'call' ? {} : { sequence: this.ordinal++ }), tokens };
    if (id) {
      const value = JSON.stringify([model, tokens]);
      const previous = this.seen.get(id);
      if (previous) {
        if (previous.value !== value) {
          this.complete = false;
          previous.row.tokens = emptyTimelineTokens();
          if (JSON.stringify(previous.row.model) !== JSON.stringify(model)) previous.row.model = null;
        }
        return;
      }
      this.seen.set(id, { value, row });
    }
    this.rows.push(row);
  }
  finish() { return buildModelTimeline(this.rows, this.complete); }
}
