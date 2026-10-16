import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackPersonas, personaCatalog, type PersonaInput } from '../shared/feedback-persona.js';
import { personaHistory } from '../shared/feedback-persona-history.js';
import { journalFixture } from './desktop-fixture.js';
import { feedbackTaskProfile } from '../shared/feedback-task-profile.js';
import { randomUUID } from 'node:crypto';
const empty = (): PersonaInput => ({ metrics: [], work: [] });
const record = (field: string, value: string): PersonaInput => ({
  ...empty(),
  taskProfile: {
    ...feedbackTaskProfile([
      { structure: { componentCount: 4, dependencyDepth: 0, integrationRequired: false } },
    ])!,
    requirements: [{ field, value, tasks: 1 }],
  },
});
test('32 types each have an observable trigger; missing records and spending alone do not award types', () => {
  assert.equal(personaCatalog.length, 32);
  assert.equal(new Set(personaCatalog.map((p) => p[0])).size, 32);
  assert.deepEqual(feedbackPersonas(empty()), []);
  const cases = [
    ['CHECK', 'methodFamilies', 'formal_verification'],
    ['FIX', 'methodFamilies', 'diagnosis'],
    ['DIG', 'methodFamilies', 'retrieval'],
    ['DATA', 'methodFamilies', 'statistical_inference'],
    ['SPEED', 'methodFamilies', 'optimization'],
    ['SIM', 'methodFamilies', 'simulation'],
    ['BRIDGE', 'methodFamilies', 'cross_system_integration'],
    ['ART', 'methodFamilies', 'multimodal_alignment'],
    ['BUILD', 'methodFamilies', 'construction'],
    ['SHIELD', 'constraintKinds', 'security'],
    ['REF', 'constraintKinds', 'source_traceability'],
    ['FORMAT', 'methodFamilies', 'transformation'],
    ['PATCH', 'solutionNovelty', 'adaptation'],
    ['CLASH', 'clarity', 'conflicting'],
    ['LOST', 'inputCondition', 'missing'],
    ['NOISE', 'inputCondition', 'noisy'],
    ['NEW', 'solutionNovelty', 'new_solution'],
    ['REUSE', 'contextReuse', 'template_based'],
    ['DEEP', 'knowledge', 'research'],
    ['EXPERT', 'knowledge', 'specialist'],
    ['CHAIN', 'reasoning', 'multi_step'],
    ['PROOF', 'reasoning', 'formal'],
    ['OPEN', 'reasoning', 'open_ended'],
    ['BUDGET', 'constraintKinds', 'resource_limit'],
    ['CLOCK', 'constraintKinds', 'deadline'],
    ['ACCESS', 'constraintKinds', 'accessibility'],
  ];
  for (const [code, field, value] of cases)
    assert.ok(
      feedbackPersonas(record(field, value)).some((p) => p.code === code),
      code,
    );
  assert.ok(feedbackPersonas(record('clarity', 'unknown')).some((p) => p.code === 'LEGO'));
  const m = empty();
  m.work = [{ label: '写作', completed: 1, accepted: null, unit: '篇', note: '' }];
  assert.equal(feedbackPersonas(m)[0].code, 'WRITE');
  m.work[0].completed = null;
  assert.equal(feedbackPersonas(m).length, 0);
  for (const [id, value] of [
    ['agents', 3],
    ['depth', 2],
    ['turns', 10],
    ['tool_calls', 10],
  ] as const)
    m.metrics.push({
      id,
      value,
      label: '',
      unit: '',
      note: '',
      position: 'unavailable',
      reference: null,
    });
  for (const code of ['BOSS', 'NEST', 'CHAT', 'TOOL'])
    assert.ok(feedbackPersonas(m).some((p) => p.code === code));
  m.metrics = m.metrics.map((v) => ({ ...v, value: v.value! - 1 }));
  assert.ok(!feedbackPersonas(m).some((p) => ['BOSS', 'NEST', 'CHAT', 'TOOL'].includes(p.code)));
  m.metrics = [
    {
      id: 'cost',
      value: 1e8,
      label: '',
      unit: '',
      note: '',
      position: 'unavailable',
      reference: null,
    },
  ];
  assert.deepEqual(feedbackPersonas(m), []);
});
function day(n: number) {
  const s = journalFixture(),
    start = new Date(Date.UTC(2026, 9, n));
  s.day = start.toISOString().slice(0, 10);
  s.startAt = start.toISOString();
  s.endAt = new Date(+start + 86400000).toISOString();
  s.createdAt = s.endAt;
  s.measurements.agentCount = 3;
  s.measurements.maxAgentDepth = 2;
  return s;
}
test('long-term badges count unique dates, respect cutoff, origin, timezone and latest revision', () => {
  const current = day(28),
    history = Array.from({ length: 28 }, (_, i) => day(i + 1));
  assert.equal(personaHistory(current, history).types.find((t) => t.code === 'NEST')?.days, 28);
  assert.equal(personaHistory(day(7), history).types.find((t) => t.code === 'NEST')?.days, 7);
  const duplicates = Array.from({ length: 20 }, () => ({ ...day(7), id: randomUUID() }));
  assert.equal(personaHistory(day(7), duplicates).observedDays, 1);
  const revised = day(1);
  revised.createdAt = '2026-10-03T00:00:00Z';
  revised.revision = 2;
  revised.measurements.maxAgentDepth = 0;
  assert.equal(
    personaHistory(current, [day(1), revised]).types.find((t) => t.code === 'NEST')?.days,
    1,
  );
  const future = day(2);
  future.createdAt = '2026-11-01T00:00:00Z';
  const synthetic = day(3);
  synthetic.origin = 'synthetic';
  const other = day(4);
  other.timeZone = 'Asia/Shanghai';
  assert.equal(personaHistory(current, [future, synthetic, other]).observedDays, 1);
  assert.equal(personaHistory(current, history, false).status, 'incomplete');
});
