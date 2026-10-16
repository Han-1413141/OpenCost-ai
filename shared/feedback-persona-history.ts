import { z } from 'zod';
import type { DailySummary } from './desktop-summary.js';
import { labels } from './schema.js';
import { journalWindowCheck } from './journal-time.js';
import { feedbackTaskProfile } from './feedback-task-profile.js';
import {
  feedbackPersonas,
  personaCatalog,
  type PersonaInput,
  type PersonaCode,
} from './feedback-persona.js';
export const PersonaHistorySchema = z
  .object({
    version: z.literal('persona-history-1'),
    status: z.enum(['available', 'incomplete', 'invalid']),
    observedDays: z.number().int().min(0).max(30),
    classifiedDays: z.number().int().min(0).max(30),
    types: z
      .array(
        z
          .object({
            code: z.enum(personaCatalog.map((p) => p[0]) as [PersonaCode, ...PersonaCode[]]),
            days: z.number().int().min(1).max(30),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();
export type PersonaHistory = z.infer<typeof PersonaHistorySchema>;
export function journalPersonaInput(summary: DailySummary): PersonaInput {
  return {
    metrics: (
      [
        ['agents', summary.measurements.agentCount],
        ['root_agents', summary.measurements.rootAgentCount ?? null],
        ['depth', summary.measurements.maxAgentDepth],
        ['turns', summary.measurements.userTurns],
        ['tool_calls', summary.measurements.toolCalls],
      ] as const
    ).map(([id, value]) => ({
      id,
      value,
      label: '',
      unit: '',
      note: '',
      position: 'unavailable',
      reference: null,
    })),
    work: summary.tasks.map((t) => ({
      label: labels.kind[t.kind],
      completed: t.reportedStatus === 'completed' ? t.reportedCompleted : null,
      accepted: null,
      unit: t.unit,
      note: '',
    })),
    taskProfile: feedbackTaskProfile(
      summary.tasks.map((t) => ({
        requirements: t.analysis?.requirements,
        structure: t.analysis?.structure,
      })),
    ),
  };
}
/** Latest revision per local date, as known at this revision; bounded to 30 dates. */
export function personaHistory(
  summary: DailySummary,
  history: DailySummary[],
  complete = true,
): PersonaHistory {
  const result: PersonaHistory = {
    version: 'persona-history-1',
    status: complete ? 'available' : 'incomplete',
    observedDays: 0,
    classifiedDays: 0,
    types: [],
  };
  const current = journalWindowCheck(summary);
  if (current.status !== 'valid') return { ...result, status: 'invalid' };
  const cutoff = Date.parse(summary.day),
    created = Date.parse(summary.createdAt),
    end = Date.parse(summary.endAt);
  const days = new Map<string, DailySummary>();
  for (const item of [...history, summary]) {
    const checked = journalWindowCheck(item),
      distance = cutoff - Date.parse(item.day);
    if (
      checked.status !== 'valid' ||
      checked.timeZone !== current.timeZone ||
      item.origin !== summary.origin ||
      distance < 0 ||
      distance >= 30 * 86400000 ||
      Date.parse(item.createdAt) > created ||
      Date.parse(item.endAt) > end
    )
      continue;
    const previous = days.get(item.day);
    if (
      !previous ||
      item.createdAt > previous.createdAt ||
      (item.createdAt === previous.createdAt && item.revision >= previous.revision)
    )
      days.set(item.day, item);
  }
  const counts = new Map<PersonaCode, number>();
  for (const item of days.values()) {
    const personas = feedbackPersonas(journalPersonaInput(item));
    if (personas.length) result.classifiedDays++;
    for (const p of personas) counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
  }
  result.observedDays = days.size;
  result.types = [...counts]
    .map(([code, days]) => ({ code, days }))
    .sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));
  return result;
}
