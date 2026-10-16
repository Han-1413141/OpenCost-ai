import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EnvelopeSchema, WorkSummarySchema } from '../shared/schema.js';
import { resourceMetrics } from '../shared/evaluation.js';
import type { CollectionWindow } from '../shared/collection.js';
import { TaskObservationsSchema } from '../shared/task-observations.js';

// Generates all keys but never invents measured numbers. It is deliberately not
// a valid contribution until the collector fills required facts from real sources.
function blank(schema: any): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf)
    return schema.anyOf.some((s: any) => s.type === 'null') ? null : blank(schema.anyOf[0]);
  if (Array.isArray(schema.type) && schema.type.includes('null')) return null;
  if (schema.enum) return schema.enum.includes('unknown') ? 'unknown' : null;
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, s]) => [key, blank(s)]),
    );
  if (schema.type === 'array') return [];
  return null;
}
export function observationTemplate() {
  const meta = () => ({
    source: 'unknown',
    coverage: 'unknown',
    timing: 'unknown',
    missingReason: 'not_recorded',
  });
  return TaskObservationsSchema.parse({
    version: 'task-observations-1',
    requirements: {
      meta: meta(),
      clarity: 'unknown',
      inputCondition: 'unknown',
      solutionNovelty: 'unknown',
      knowledge: 'unknown',
      reasoning: 'unknown',
      methodFamilies: null,
      constraintKinds: null,
      contextReuse: 'unknown',
    },
    validation: {
      meta: meta(),
      criteriaPlanned: null,
      criteriaExecuted: null,
      criteriaPassed: null,
      criticalCriteriaPlanned: null,
      criticalCriteriaPassed: null,
      independence: 'unknown',
      planBasis: 'unknown',
    },
    followup: {
      meta: meta(),
      windowDays: 7,
      observedDays: 0,
      status: 'not_observed',
      reopenedCount: null,
      delayedDefectCount: null,
    },
    time: {
      meta: meta(),
      partition: 'unknown',
      activeMs: null,
      waitingUserMs: null,
      waitingExternalMs: null,
      pausedMs: null,
      unknownMs: null,
    },
  });
}
export function captureTemplate(
  window: CollectionWindow | null = null,
  options: {
    extendedObservations?: boolean;
    itemizedCosts?: boolean;
    chargeCoverage?: boolean;
  } = {},
) {
  const schema = z.toJSONSchema(EnvelopeSchema, { unrepresentable: 'any' }) as any;
  const envelope = blank(schema) as any;
  envelope.schemaVersion = '1.1';
  envelope.origin = 'real';
  envelope.collectionWindow = window;
  const processing = blank(schema.properties.collectionProcessing.items) as any;
  processing.runId = randomUUID();
  envelope.collectionProcessing = [processing];
  envelope.period.id = randomUUID();
  delete envelope.period.costAttribution;
  delete envelope.period.chargeReconciliation;
  if (options.itemizedCosts) {
    envelope.period.allocation = 'itemized';
    envelope.period.unassignedWeight = 0;
    envelope.period.costAttribution = {
      version: 'cost-attribution-1',
      coverage: 'partial',
      entries: [],
    };
  }
  const task = blank(schema.properties.tasks.items) as any;
  // Optional schema additions must not silently enable additional collection.
  delete task.observations;
  if (options.extendedObservations) task.observations = observationTemplate();
  task.id = randomUUID();
  task.progress = { phase: 'unknown', reason: 'unknown', basis: 'unknown' };
  task.requirementsLocked = false;
  task.evaluation = blank(z.toJSONSchema(WorkSummarySchema, { unrepresentable: 'any' }));
  task.models = [blank(schema.properties.tasks.items.properties.models.items)];
  delete task.models[0].priceMetering;
  envelope.tasks = [task];
  envelope.quota = [];
  envelope.consent = {
    version: 'opencost-1.0',
    store: false,
    statistics: false,
    publicSummary: false,
  };
  return {
    format: 'opencost-local-capture-1',
    envelope,
    collector: { id: 'opencost-contribute', version: '1.1', salt: randomUUID() },
    manifest: {},
    coverage: {
      agents: 'unknown',
      calls: 'unknown',
      charges: 'unknown',
      workItems: 'unknown',
      events: Object.fromEntries(
        [
          'user_turn',
          'assistant_turn',
          'tool_call',
          'tool_failure',
          'context_reset',
          'context_compaction',
          'human_intervention',
          'requirement_change',
        ].map((k) => [k, 'unknown']),
      ),
      resources: Object.fromEntries(resourceMetrics.map((k) => [k, 'unknown'])),
    },
    agents: [],
    events: [],
    charges: [],
    ...(options.chargeCoverage
      ? {
          chargeCoverage: {
            version: 'charge-coverage-1',
            periodId: envelope.period.id,
            basis: 'unknown',
            rootsDisjoint: 'unknown',
            relations: [],
          },
        }
      : {}),
    resources: [],
    workItems: null,
    workGraphs: null,
  };
}
