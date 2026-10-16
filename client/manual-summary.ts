import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../shared/schema.js';
import { DailySummarySchema, SummaryTaskSchema, harnessIds } from '../shared/desktop-summary.js';
import { journalWindowCheck, journalWindowError } from '../shared/journal-time.js';
import { publicJournalModel } from '../shared/public-models.js';
import { buildModelTimeline, tokenFields, type TimelineTokens } from '../shared/model-timeline.js';
import { LocalUsageSchema } from './usage-facts.js';

const localId = z.string().min(1).max(1024);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const taskShape = SummaryTaskSchema.shape;
export const ManualSummaryFactsSchema = z.object({
  format: z.literal('opencost-summary-facts-1'),
  id: z.string().uuid(), salt: z.string().uuid(), createdAt: z.string().datetime(),
  day: z.string(), timeZone: z.string(), startAt: z.string().datetime(), endAt: z.string().datetime(),
  harness: z.enum(harnessIds),
  tasks: z.array(z.object({
    localId, kind: taskShape.kind, workType: taskShape.workType.default('unknown'),
    reportedStatus: taskShape.reportedStatus.default('unknown'), progress: taskShape.progress,
    unit: taskShape.unit, reportedCompleted: taskShape.reportedCompleted.default(null),
    analysis: taskShape.analysis,
  }).strict()).max(100),
  calls: z.array(z.object({
    id: localId, agentId: localId, at: z.string().datetime().optional(),
    sequence: z.number().int().nonnegative().safe().optional(), usage: LocalUsageSchema,
  }).strict()).max(20000).default([]),
  processing: DailySummarySchema.shape.processing.optional(),
}).strict();

/** Only a blank local template. Never reads a conversation or enables collection. */
export function manualSummaryTemplate(window: { day: string; timeZone: string; startAt: string; endAt: string }, harness: string) {
  const facts = ManualSummaryFactsSchema.parse({ format: 'opencost-summary-facts-1',
    id: randomUUID(), salt: randomUUID(), createdAt: new Date().toISOString(), ...window, harness, tasks: [], calls: [] });
  if (journalWindowCheck(facts).status !== 'valid') throw new Error(journalWindowError);
  return facts;
}

function deduplicate<T>(values: T[], identify: (value: T) => string): T[] {
  const rows = new Map<string, T>();
  for (const value of values) {
    const id = identify(value), existing = rows.get(id);
    if (existing && canonical(existing) !== canonical(value)) throw new Error('相同本地事实标识有冲突，请核对来源后再生成摘要');
    rows.set(id, value);
  }
  return [...rows.values()];
}

/** Adapter-free, partial observations. Local identifiers and raw text never leave this compiler. */
export function compileManualSummary(input: unknown) {
  const facts = ManualSummaryFactsSchema.parse(input);
  if (journalWindowCheck(facts).status !== 'valid') throw new Error(journalWindowError);
  const tasks = deduplicate(facts.tasks, t => t.localId), calls = deduplicate(facts.calls, c => c.id);
  if (!tasks.length) throw new Error('请先从授权记录中整理至少一项目标；空模板不是工作摘要');
  if (calls.some(c => c.at && (Date.parse(c.at) < Date.parse(facts.startAt) || Date.parse(c.at) >= Date.parse(facts.endAt))))
    throw new Error('调用记录超出本次日记范围，请按实际本地日期拆分');
  const keys = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'] as const;
  const unknownTokens = Object.fromEntries(keys.map(k => [k, null]));
  const known = Object.fromEntries(keys.map(k => {
    const values = calls.map(c => c.usage[k]).filter((v): v is number => v !== null);
    return [k, values.length ? values.reduce((a, b) => a + b, 0) : null];
  }));
  const summary = DailySummarySchema.parse({
    format: 'opencost-daily-summary-1', id: facts.id, day: facts.day, timeZone: facts.timeZone,
    startAt: facts.startAt, endAt: facts.endAt, createdAt: facts.createdAt, revision: 1,
    origin: 'real', evidence: 'local_unverified', coverage: 'partial',
    collector: { id: 'opencost-contribute', version: '1.0', digest: hash(facts) },
    harnesses: [{ id: facts.harness, version: 'unknown' }],
    models: [...new Set(calls.map(c => publicJournalModel(c.usage.model)).filter(v => v !== null))],
    tasks: tasks.map(({ localId: id, ...task }) => ({ ...task, sourceRefs: [hash({ salt: facts.salt, task: id })] })),
    measurements: {
      sourceRecords: tasks.length + calls.length, ...unknownTokens, knownTokenSubtotals: known,
      userTurns: null, assistantTurns: null, modelCalls: null, toolCalls: null,
      agentCount: null, rootAgentCount: null, maxAgentDepth: null, observedSpanMs: null,
      modelTimeline: buildModelTimeline(calls.map(c => ({
        stream: c.agentId, at: c.at, sequence: c.sequence,
        // Free-form deployment aliases and version strings stay local.
        model: publicJournalModel(c.usage.model) ? { provider: 'unknown', model: publicJournalModel(c.usage.model)!, version: 'unknown' } : null,
        tokens: Object.fromEntries(tokenFields.map(k => [k, c.usage[k] ?? null])) as TimelineTokens,
      })), false),
    },
    processing: facts.processing ?? { harness: facts.harness, durationMs: null, inputTokens: null, outputTokens: null, costMinor: null, currency: null },
    consent: { store: false, statistics: false, publicSummary: false },
  });
  return { summary, report: { tasks: tasks.length, observedCalls: calls.length,
    duplicatesRemoved: facts.tasks.length + facts.calls.length - tasks.length - calls.length,
    knownTokenSubtotals: known, totalTokens: null, actualPaidMinor: null,
    coverage: 'partial', ranked: false } };
}

export function prepareJournal(input: unknown) {
  const summary = DailySummarySchema.parse({ ...(input as object), consent: { store: true, statistics: false, publicSummary: false } });
  if (journalWindowCheck(summary).status !== 'valid') throw new Error(journalWindowError);
  if (Buffer.byteLength(JSON.stringify({ summary, reviewToken: 'x'.repeat(2000) }), 'utf8') > 512 * 1024)
    throw new Error('工作摘要超过 512 KiB，请按日拆分并保留完整本地来源');
  return { format: 'opencost-journal-preview-1' as const, summary, digest: hash(summary), visibility: 'private', ranked: false };
}
