import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSemantic } from '../desktop/runner.js';
import { semanticAnalysis } from '../shared/semantic-extensions.js';
import { journalFixture } from './desktop-fixture.js';
import { DailySummarySchema } from '../shared/desktop-summary.js';
import { SettingsSchema } from '../desktop/model.js';
import { feedbackTaskProfile } from '../shared/feedback-task-profile.js';
import { feedbackPersonas } from '../shared/feedback-persona.js';
import { feedbackRadar } from '../shared/feedback-radar.js';
import { journalFeedback } from '../shared/personal-feedback.js';
import { initialSession, saveSession, readSession } from '../client/session.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const extensions = () => ({
  requirements: {
    clarity: 'specified',
    inputCondition: 'clean',
    solutionNovelty: 'new_solution',
    knowledge: 'research',
    reasoning: 'multi_step',
    methodFamilies: ['retrieval'],
    constraintKinds: ['source_traceability'],
    contextReuse: 'fresh',
  },
  requirementCoverage: 'complete',
  structure: {
    componentCount: 4,
    dependencyDepth: 2,
    integrationRequired: true,
    coverage: 'complete',
  },
});
test('default extensions remain reversible and separate from upload, statistics and automation', () => {
  assert.equal(SettingsSchema.parse({}).extendedObservations, true);
  assert.equal(SettingsSchema.parse({ extendedObservations: false }).extendedObservations, false);
  assert.equal(SettingsSchema.parse({}).generationMode, 'ask');
  assert.equal(SettingsSchema.parse({}).uploadMode, 'ask');
  const path = mkdtempSync(join(tmpdir(), 'opencost-vbti-options-'));
  try {
    const state = initialSession();
    state.extendedObservations = false;
    saveSession(join(path, 'state.json'), state);
    assert.equal(readSession(join(path, 'state.json')).extendedObservations, false);
    assert.equal(state.automation.mode, 'off');
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('model extensions project into strict anonymous fields and cannot impersonate code measurements or source authentication', () => {
  const summary = journalFixture(),
    task = summary.tasks[0];
  const records = [{ ref: task.sourceRefs[0] }] as Parameters<typeof parseSemantic>[1];
  const result = parseSemantic(
    JSON.stringify({ tasks: [{ ...task, extensions: extensions() }] }),
    records,
  );
  const analysis = result.tasks[0].analysis!;
  assert.equal(analysis.requirements!.meta.source, 'local_model');
  assert.equal(analysis.requirements!.meta.timing, 'retrospective');
  assert.equal(analysis.structure.status, 'declared_summary');
  assert.equal(analysis.requirementLevels.overallGrade, null);
  summary.tasks = result.tasks;
  assert.ok(DailySummarySchema.safeParse(summary).success);
  assert.throws(() =>
    parseSemantic(
      JSON.stringify({ tasks: [{ ...task, extensions: extensions() }] }),
      records,
      false,
    ),
  );
  const sensitive = 'private@example.org C:/Users/private/project sk-secret-key';
  for (const key of [
    'text',
    'prompt',
    'path',
    'code',
    'account',
    'email',
    'source',
    'codeMeasurements',
    'evidence',
  ]) {
    for (const scope of ['top', 'requirements', 'structure']) {
      const value: any = extensions();
      (scope === 'top' ? value : value[scope])[key] = sensitive;
      assert.throws(() => semanticAnalysis(value, 'unknown'), `${scope}.${key}`);
    }
  }
  const invalid: any = extensions();
  invalid.requirements.methodFamilies = [sensitive];
  assert.throws(() => semanticAnalysis(invalid, 'unknown'));
  assert.throws(() => parseSemantic(JSON.stringify({ tasks: [{ ...task, analysis }] }), records));
  assert.throws(() =>
    semanticAnalysis(
      { ...extensions(), structure: { ...extensions().structure, componentCount: 13912345678 } },
      'unknown',
    ),
  );
});
test('multiple roots, single-task decomposition and unknown coverage cannot inflate scores or unlocks', () => {
  const s = journalFixture();
  Object.assign(s.measurements, { agentCount: 6, rootAgentCount: 4, maxAgentDepth: 1 });
  let report = journalFeedback(s, []);
  assert.equal(feedbackRadar(report)[0].score, 33);
  assert.ok(feedbackPersonas(report).some((p) => p.code === 'BOSS'));
  delete s.measurements.rootAgentCount;
  report = journalFeedback(s, []);
  assert.equal(feedbackRadar(report)[0].score, null);
  assert.ok(!feedbackPersonas(report).some((p) => p.code === 'BOSS'));
  report.taskProfile = feedbackTaskProfile(
    Array.from({ length: 4 }, () => ({
      structure: {
        componentCount: 1,
        dependencyDepth: 0,
        integrationRequired: false,
        coverage: 'complete',
      },
    })),
  );
  assert.equal(feedbackRadar(report).find((a) => a.id === 'decomposition')!.score, 0);
  assert.ok(!feedbackPersonas(report).some((p) => p.code === 'LEGO'));
  report.taskProfile = feedbackTaskProfile(
    [1, 1, 1, 1000].map((componentCount) => ({
      structure: { componentCount, dependencyDepth: 0, integrationRequired: false },
    })),
  );
  assert.equal(report.taskProfile!.decompositionIndex, 25);
  const r = semanticAnalysis(extensions(), 'unknown').requirements!;
  r.knowledge = 'specialist';
  r.methodFamilies = [];
  r.constraintKinds = [];
  r.meta.coverage = 'partial';
  assert.deepEqual(feedbackTaskProfile([{ requirements: r }])!.behaviorSignals!.exploration, {
    known: 0,
    matched: 0,
  });
  r.methodFamilies = ['retrieval', 'simulation'];
  assert.deepEqual(feedbackTaskProfile([{ requirements: r }])!.behaviorSignals!.exploration, {
    known: 1,
    matched: 1,
  });
});
test('dominant type follows repeated task evidence, not a permanently preferred catalogue order', () => {
  const s = journalFixture();
  Object.assign(s.measurements, { agentCount: 3, maxAgentDepth: 2 });
  const report = journalFeedback(s, []);
  const requirements = semanticAnalysis(extensions(), 'unknown').requirements!;
  report.taskProfile = feedbackTaskProfile(Array.from({ length: 5 }, () => ({ requirements })));
  assert.equal(feedbackPersonas(report)[0].code, 'DIG');
  assert.ok(feedbackPersonas(report).some((p) => p.code === 'NEST'));
  assert.equal(report.taskProfile!.sources![0].source, 'local_model');
});
