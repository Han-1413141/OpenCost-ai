import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { subscriptionTemplate, prepareSubscriptions } from '../client/subscriptions.js';
import { codexQuotaSnapshots } from '../client/codex-quota.js';
import {
  collectQuotaOnce,
  mergeQuotaSnapshots,
  quotaCoverage,
  quotaBatches,
} from '../client/quota-collection.js';
import { SourceManifestSchema } from '../shared/source.js';

const now = new Date('2026-10-16T10:00:00.000Z');
const interval = { startAt: '2026-10-13T10:00:00.000Z', endAt: now.toISOString() };
const ref = randomUUID();
const event = (at: string, used = 12, more: object = {}) =>
  JSON.stringify({
    timestamp: at,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        limit_id: 'private-product-route',
        primary: { used_percent: used, window_minutes: 300, resets_at: 1792155600 },
        ...more,
      },
    },
  });
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'opencost-quota-test-'));
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + 'opencost-quota-test-'));
    rmSync(dir, { recursive: true, force: true });
  });
  const save = (file: string, data: unknown) =>
    writeFileSync(join(dir, file), JSON.stringify(data));
  return { dir, save, configPath: join(dir, 'collect.json'), out: join(dir, 'out') };
}

test('disabled collection performs no source reads, network calls, output or monitor writes', async (t) => {
  const f = fixture(t);
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('must not fetch');
  };
  t.after(() => {
    globalThis.fetch = fetch;
  });
  const r = await collectQuotaOnce({
    enabled: false,
    configPath: join(f.dir, 'missing'),
    out: f.out,
  });
  assert.equal(r.status, 'disabled');
  assert.equal(existsSync(f.out), false);
  const cli = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'client/monitor-cli.ts', 'collect', '--config', 'missing', '--out', f.out],
    { encoding: 'utf8' },
  );
  assert.equal(JSON.parse(cli).status, 'disabled');
  assert.equal(existsSync(f.out), false);
});

test('Codex parses structured percentage, window, reset and public version only; boundaries and missing values stay explicit', () => {
  const text = [
    JSON.stringify({
      type: 'session_meta',
      payload: { cli_version: '0.120.0', cwd: 'private-customer' },
    }),
    JSON.stringify({
      type: 'response_item',
      payload: { content: 'secret@example.invalid prompt' },
    }),
    event(interval.startAt),
    event(interval.endAt),
    event('2026-10-12T10:00:00.000Z'),
    event('2026-10-14T10:00:00.000Z', 120),
    event('2026-10-15T10:00:00.000Z', 13, {
      secondary: { used_percent: 40, window_duration_mins: 10080 },
    }),
    '{broken',
  ].join('\n');
  const result = codexQuotaSnapshots(text, ref, interval);
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.invalidEvents, 2);
  const s = result.snapshots[0];
  assert.equal(s.pools[0].window.durationSeconds, 18000);
  assert.ok(s.pools[0].window.resetsAt);
  assert.equal(s.pools[0].used, null);
  assert.equal(s.pools[0].capacity.total, null);
  assert.equal(s.harnesses![0].version, '0.120.0');
  assert.equal(result.snapshots[1].pools[1].window.resetsAt, null);
  assert.equal(result.snapshots[1].pools[1].window.durationSeconds, 604800);
  assert.doesNotMatch(JSON.stringify(result), /private-product|secret@|private-customer|prompt/);
  assert.equal(
    codexQuotaSnapshots(text, ref, interval).snapshots[0].observationId,
    s.observationId,
  );
  assert.notEqual(
    codexQuotaSnapshots(text, randomUUID(), interval).snapshots[0].pools[0].poolRef,
    s.pools[0].poolRef,
  );
});

test('deduplicates copied descendant logs; merges disjoint pools and detects altered identities and readings', () => {
  const a = codexQuotaSnapshots(event(interval.startAt), ref, interval).snapshots[0];
  assert.equal(mergeQuotaSnapshots([a, a, a]).snapshots.length, 1);
  assert.equal(mergeQuotaSnapshots([a, a, a]).duplicates, 2);
  assert.equal(mergeQuotaSnapshots([a, a]).snapshots[0].observationId, a.observationId);
  const b = structuredClone(a);
  b.observationId = randomUUID();
  b.pools[0].poolRef = randomUUID();
  assert.equal(mergeQuotaSnapshots([a, b]).snapshots[0].pools.length, 2);
  const c = structuredClone(a);
  c.pools[0].percent!.value = 99;
  assert.equal(mergeQuotaSnapshots([a, c]).conflicts.length, 1);
  c.observedAt = '2026-10-14T10:00:00.000Z';
  assert.equal(mergeQuotaSnapshots([a, c]).conflicts.length, 1);
});

test('single collection preserves partial results, clips historical ledger events, prepares private batches and leaves monitoring off', async (t) => {
  const f = fixture(t),
    s = subscriptionTemplate();
  s.observedAt = '2026-10-15T10:00:00.000Z';
  s.pools[0].ledger = {
    from: '2026-10-10T10:00:00.000Z',
    through: s.observedAt,
    coverage: 'complete',
    precision: 'exact',
    events: [
      {
        eventRef: randomUUID(),
        at: '2026-10-11T10:00:00.000Z',
        kind: 'usage',
        amount: 1,
        beforeUsed: null,
        afterUsed: null,
      },
    ],
  };
  f.save('history.json', [s]);
  f.save('collect.json', {
    format: 'opencost-quota-collection-1',
    history: [{ id: 'history', kind: 'snapshots', files: ['missing.json', 'history.json'] }],
    current: null,
  });
  const r = await collectQuotaOnce({ enabled: true, ...f, interval, now });
  assert.equal(r.status, 'partial');
  assert.equal(r.monitoringStarted, false);
  assert.equal(r.uploaded, false);
  assert.ok('batches' in r);
  assert.equal(r.sources[0].status, 'partial');
  assert.equal(r.sources[0].failures, 1);
  const draft = JSON.parse(readFileSync(join(f.out, 'preview-1.json'), 'utf8'));
  assert.equal(prepareSubscriptions(draft.envelope).digest, draft.digest);
  assert.equal(draft.envelope.consent.statistics, undefined);
  assert.equal(draft.envelope.snapshots[0].pools[0].ledger.from, interval.startAt);
  assert.equal(draft.envelope.snapshots[0].pools[0].ledger.events.length, 0);
  assert.equal(existsSync(join(f.dir, 'monitor.sqlite')), false);
  await assert.rejects(collectQuotaOnce({ enabled: true, ...f, interval, now }), /输出目录已存在/);
});

test('current HTTP reads only selected sources once, with no database, model call or credential leakage', async (t) => {
  const f = fixture(t),
    original = globalThis.fetch,
    template = subscriptionTemplate();
  let requests = 0;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (input, init) => {
    requests++;
    assert.equal(String(input), 'https://quota.invalid/current');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    return new Response(
      JSON.stringify({ used: 31, password: 'NEVER_COPY_THIS', customer: 'private-user' }),
    );
  };
  f.save('monitor.json', {
    format: 'opencost-monitor-1',
    sources: [
      {
        id: 'selected',
        kind: 'http',
        url: 'https://quota.invalid/current',
        auth: null,
        template,
        mapping: [{ from: '/used', to: '/pools/0/used' }],
      },
      { id: 'unselected', kind: 'file', path: 'never-read.json', subscriptionRef: randomUUID() },
    ],
  });
  f.save('collect.json', {
    format: 'opencost-quota-collection-1',
    history: [],
    current: { configPath: 'monitor.json', sourceIds: ['selected'] },
  });
  const r = await collectQuotaOnce({ enabled: true, ...f, interval, now });
  assert.equal(r.status, 'ready');
  assert.equal(requests, 1);
  assert.ok('modelCalls' in r);
  assert.equal(r.modelCalls, 0);
  const draft = readFileSync(join(f.out, 'preview-1.json'), 'utf8');
  assert.equal(JSON.parse(draft).envelope.snapshots[0].pools[0].used, 31);
  assert.doesNotMatch(draft, /NEVER_COPY_THIS|private-user|quota.invalid/);
  assert.equal(r.coverage[0].historyObservations, 0);
});

test('conflicting readings preserve originals locally and produce no upload draft', async (t) => {
  const f = fixture(t),
    s = subscriptionTemplate();
  s.observedAt = interval.startAt;
  const b = structuredClone(s);
  b.observationId = randomUUID();
  b.pools[0].used = 42;
  f.save('history.json', [s, b]);
  f.save('collect.json', {
    format: 'opencost-quota-collection-1',
    history: [{ id: 'h', kind: 'snapshots', files: ['history.json'] }],
    current: null,
  });
  const r = await collectQuotaOnce({ enabled: true, ...f, interval, now });
  assert.equal(r.status, 'needs_resolution');
  assert.equal(existsSync(join(f.out, 'preview-1.json')), false);
  assert.equal(JSON.parse(readFileSync(join(f.out, 'observations.json'), 'utf8')).length, 2);
});

test('reset/decrease and missing days describe observations without negative usage or full-history claims', () => {
  const a = codexQuotaSnapshots(event(interval.startAt, 90), ref, interval).snapshots[0];
  const b = structuredClone(a);
  b.observedAt = '2026-10-15T10:00:00.000Z';
  b.pools[0].percent!.value = 10;
  a.pools[0].window.resetsAt = '2026-10-14T10:00:00.000Z';
  const coverage = quotaCoverage([a, b], interval)[0];
  assert.equal(coverage.resetBoundariesCrossed, 1);
  assert.equal(coverage.counterDecreases, 1);
  assert.equal(coverage.maxUnobservedSeconds, 172800);
  assert.equal(coverage.utcDaysWithoutObservation, 2);
  assert.equal(coverage.declaredCompleteLedgerSeconds, 0);
  assert.equal(coverage.consumptionCoverage, 'not_established');
});

test('batching covers every observation once within server count and byte limits', () => {
  const snapshots = Array.from({ length: 1050 }, (_, i) => {
    const s = subscriptionTemplate();
    s.observedAt = new Date(now.getTime() - (i + 1) * 1000).toISOString();
    return s;
  });
  const drafts = quotaBatches(snapshots, true);
  assert.ok(drafts.length >= 3);
  assert.equal(
    drafts.reduce((n, d) => n + d.envelope.snapshots.length, 0),
    snapshots.length,
  );
  for (const d of drafts) {
    assert.ok(d.envelope.snapshots.length <= 500);
    assert.ok(
      Buffer.byteLength(JSON.stringify({ envelope: d.envelope, reviewToken: 'x'.repeat(2000) })) <=
        512 * 1024,
    );
    assert.equal(d.envelope.consent.statistics, true);
    assert.equal(d.digest, prepareSubscriptions(d.envelope).digest);
  }
});

test('DSH historical percentage imports use the requested time window and do not manufacture numeric usage', async (t) => {
  const f = fixture(t),
    hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const body = {
    format: 'dsh-opencost-export-1',
    generatedAt: now.toISOString(),
    collector: { id: 'dsh-cost-meter', version: '1.8.20' },
    harness: { id: 'dsh', version: 'unknown', surface: 'unknown' },
    window: { startAt: interval.startAt, endAt: interval.endAt },
    coverage: { calls: 'partial', agents: 'partial', charges: 'unknown' },
    agents: [],
    calls: [],
    quotas: [
      {
        type: 'quota',
        id: hash('observation'),
        at: interval.startAt,
        provider: 'go',
        window: 'weekly',
        poolId: hash('pool'),
        usedPercent: 28,
        resetsAt: null,
        unlimited: false,
      },
    ],
  };
  f.save('dsh.json', {
    ...body,
    integrity: {
      algorithm: 'sha256',
      digest: hash(JSON.stringify(body)),
      assurance: 'local_unverified',
    },
  });
  f.save('collect.json', {
    format: 'opencost-quota-collection-1',
    history: [{ id: 'dsh', kind: 'dsh', files: ['dsh.json'] }],
    current: null,
  });
  const r = await collectQuotaOnce({ enabled: true, ...f, interval, now });
  assert.equal(r.status, 'ready');
  const s = JSON.parse(readFileSync(join(f.out, 'observations.json'), 'utf8'))[0];
  assert.equal(s.pools[0].percent.value, 28);
  assert.equal(s.pools[0].used, null);
});

test('public provenance includes the new quota reference', () => {
  const manifest = SourceManifestSchema.parse(
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import {makeSourceManifest} from './scripts/source-manifest.mjs'; console.log(JSON.stringify(makeSourceManifest(process.cwd())))",
        ],
        { encoding: 'utf8' },
      ),
    ),
  );
  assert.ok(
    manifest.files.some(
      (f) => f.path === 'skills/opencost-contribute/references/quota-collection.md',
    ),
  );
});
