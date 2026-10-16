import { randomUUID } from 'node:crypto';
import { sampleEnvelope } from '../shared/demo.js';
import { currentRecord } from './evaluation-fixture.js';
import { collectionWindow } from '../shared/collection.js';
import { comparisons, type StoredRecord } from '../shared/analysis.js';
import { contributionFeedback, type FeedbackSampleRecord } from '../shared/personal-feedback.js';

export function feedbackMetadata(record: StoredRecord): FeedbackSampleRecord {
  return {
    id: record.id,
    quarantined: record.quarantined,
    origin: record.envelope.origin,
    collectionWindow: record.envelope.collectionWindow,
    coverage: record.envelope.period.coverage,
    selection: record.envelope.period.selection,
  };
}

// Fictional isolated measurements: never upload these to a production service.
export function feedbackRecord(
  cost = 200,
  model = 'model-a',
  harness = 'opencode',
  owner: string = randomUUID(),
): StoredRecord {
  const e = sampleEnvelope();
  e.origin = 'real';
  e.period.id = randomUUID();
  e.period.planVersion = 'v1';
  e.consent = { version: 'opencost-1.0', store: true, statistics: true, publicSummary: false };
  e.collector = { id: 'isolated-test', version: 'v1', digest: 'a'.repeat(64) };
  e.collectionWindow = collectionWindow('3d', new Date('2026-10-10T00:00:00Z'), undefined, 'UTC');
  e.tasks.forEach((t) => {
    t.id = randomUUID();
    t.directCostMinor = cost;
    t.harness.id = harness;
    t.harness.version = 'v1';
    t.models.forEach((m) => {
      m.provider = 'test-provider';
      m.model = model;
      m.version = 'v1';
      m.priceVersion = 'test-prices';
    });
  });
  e.period.paidMinor = cost * e.tasks.length;
  const current = currentRecord(e);
  current.tasks.forEach((t) => {
    t.evaluation!.execution.userTurns = 4;
    t.evaluation!.resources.cpuSeconds = 10;
  });
  return {
    id: randomUUID(),
    owner,
    envelope: current,
    createdAt: '2026-10-10T00:00:00Z',
    quarantined: false,
    evidence: {
      cost: 'C2',
      work: 'W2',
      quota: 'Q2',
      coverage: 'verified',
      source: null,
      issuer: null,
    },
  };
}
export function feedbackPeers() {
  return [100, 200, 400].flatMap((cost, i) =>
    Array.from({ length: 5 }, (_, n) =>
      feedbackRecord(cost, 'model-' + String.fromCharCode(97 + i), 'opencode', `peer-${i}-${n}`),
    ),
  );
}
export function feedbackVisualFixture() {
  const record = feedbackRecord(600, 'my-model');
  const peers = feedbackPeers();
  return contributionFeedback(record, {
    history: [record],
    references: comparisons(peers),
    plans: [],
  });
}
