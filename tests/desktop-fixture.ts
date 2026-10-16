import { randomUUID } from 'node:crypto';
import { DailySummarySchema } from '../shared/desktop-summary.js';
export function journalFixture() {
  return DailySummarySchema.parse({
    format: 'opencost-daily-summary-1',
    id: randomUUID(),
    day: '2026-10-10',
    timeZone: 'UTC',
    startAt: '2026-10-10T00:00:00Z',
    endAt: '2026-10-11T00:00:00Z',
    createdAt: new Date().toISOString(),
    revision: 1,
    origin: 'real',
    evidence: 'local_unverified',
    coverage: 'partial',
    collector: { id: 'opencost-desktop', version: '1.0', digest: 'a'.repeat(64) },
    harnesses: [{ id: 'codex', version: 'unknown' }],
    tasks: [
      {
        sourceRefs: ['a'.repeat(64)],
        kind: 'feature',
        workType: 'unknown',
        reportedStatus: 'completed',
        unit: 'requirement',
        reportedCompleted: 1,
      },
    ],
    measurements: {
      sourceRecords: 1,
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 30,
      reasoningTokens: 8,
      userTurns: 1,
      assistantTurns: 1,
      toolCalls: 2,
      modelCalls: null,
      agentCount: null,
      maxAgentDepth: null,
      observedSpanMs: 3600000,
    },
    processing: {
      harness: 'codex',
      durationMs: 1,
      inputTokens: 4,
      outputTokens: 2,
      costMinor: null,
      currency: null,
    },
    consent: { store: true, statistics: false, publicSummary: false },
  });
}
