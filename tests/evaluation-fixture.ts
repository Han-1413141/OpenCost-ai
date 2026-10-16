import { captureTemplate } from '../client/template.js';
import { LegacyEvaluationSchema, type Envelope, type Task } from '../shared/schema.js';
import type { z } from 'zod';
import { collectionWindow } from '../shared/collection.js';

// Explicit synthetic test metadata, never a collector fallback for real records.
type LegacyTestRecord = Envelope & {
  tasks: (Task & { evaluation: z.infer<typeof LegacyEvaluationSchema> })[];
};
export function currentRecord(e: Envelope): LegacyTestRecord {
  e.schemaVersion = '1.1';
  e.collectionWindow ??= collectionWindow('3d');
  e.period.costCoverage = 'total_execution';
  e.period.costComponents = {
    model: null,
    harness: null,
    tool: null,
    compute: null,
    storage: null,
    network: null,
    other: null,
  };
  const evaluation = captureTemplate().envelope.tasks[0].evaluation;
  delete evaluation.completedWork;
  delete evaluation.workStructure;
  evaluation.version = 'work-1';
  evaluation.requirements = {
    parts: null,
    coupling: 'unknown',
    dependencyEdges: null,
    dependencyDepth: null,
    integration: 'unknown',
    reasoning: 'unknown',
    knowledge: 'unknown',
    novelty: 'unknown',
    clarity: 'unknown',
    inputQuality: 'unknown',
    qualityTarget: 'unknown',
    risk: 'unknown',
    deadline: 'unknown',
  };
  evaluation.environment = {
    tools: 'unknown',
    network: 'unknown',
    preparation: 'unknown',
    contextReuse: 'unknown',
  };
  for (const t of e.tasks) {
    const v = {
      ...structuredClone(evaluation),
      basis: t.requirementsLocked ? 'before_execution' : 'original_request',
      classification: 'collector',
      confidence: 'high',
    };
    v.execution.agentCoverage = 'complete';
    v.execution.agentCount = 1;
    v.execution.maxAgentDepth = 0;
    v.execution.costScope = 'lifecycle_complete';
    v.execution.harnesses = [{ id: t.harness.id, version: t.harness.version }];
    t.evaluation = v;
    t.models.forEach((m) => (m.priceSnapshot = null));
  }
  return e as LegacyTestRecord;
}
