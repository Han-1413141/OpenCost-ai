import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { z } from 'zod';
import { collectionWindow } from '../shared/collection.js';
import { canonical } from '../shared/schema.js';
import { SubscriptionSnapshotSchema, type SubscriptionSnapshot } from '../shared/subscriptions.js';
import { readLocalTextSync } from './local-file.js';
import { readMonitorConfig } from './monitor-config.js';
import { pollSource } from './monitor.js';
import { dshSubscriptionSnapshots } from './dsh.js';
import { codexQuotaSnapshots, quotaUuid } from './codex-quota.js';
import {
  prepareSubscriptions,
  subscriptionEnvelope,
  type SubscriptionDraft,
} from './subscriptions.js';

const MiB = 1024 * 1024,
  DAY = 86400000;
const Source = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    kind: z.enum(['snapshots', 'dsh', 'codex']),
    files: z.array(z.string().min(1).max(4096)).min(1).max(128),
    subscriptionRef: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.kind === 'codex' && !s.subscriptionRef)
      ctx.addIssue({
        code: 'custom',
        message: 'Codex needs a stable, locally generated subscriptionRef',
      });
    if (s.kind !== 'codex' && s.subscriptionRef)
      ctx.addIssue({
        code: 'custom',
        message: 'Imports preserve their existing subscription references',
      });
  });
export const QuotaCollectionConfigSchema = z
  .object({
    format: z.literal('opencost-quota-collection-1'),
    history: z.array(Source).max(20),
    current: z
      .object({
        configPath: z.string().min(1).max(4096),
        sourceIds: z
          .array(z.string().regex(/^[a-z0-9-]{1,64}$/))
          .min(1)
          .max(20),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      new Set(c.history.map((s) => s.id)).size !== c.history.length ||
      c.history.reduce((n, s) => n + s.files.length, 0) > 128 ||
      (c.current && new Set(c.current.sourceIds).size !== c.current.sourceIds.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Sources must be unique; at most 128 history files',
      });
  });

export const quotaCollectionTemplate = () => ({
  format: 'opencost-quota-collection-1',
  history: [],
  current: null,
});
type Interval = { startAt: string; endAt: string };
type SourceResult = {
  source: string;
  mode: 'history' | 'current';
  status: 'read' | 'partial' | 'failed';
  filesRead: number;
  observations: number;
  invalidEvents: number;
  failures: number;
};

function clipLedger(snapshot: SubscriptionSnapshot, start: number) {
  const result = structuredClone(snapshot);
  for (const p of result.pools)
    if (p.ledger) {
      const from = Math.max(Date.parse(p.ledger.from), start);
      if (from >= Date.parse(p.ledger.through)) p.ledger = null;
      else {
        p.ledger.from = new Date(from).toISOString();
        p.ledger.events = p.ledger.events.filter((e) => Date.parse(e.at) > from);
      }
    }
  return result;
}

/** Same-time disjoint pools may merge; disagreeing values never silently win. */
export function mergeQuotaSnapshots(input: SubscriptionSnapshot[]) {
  const byTime = new Map<string, SubscriptionSnapshot>();
  const ids = new Map<string, string>();
  const conflicts = new Set<string>();
  let duplicates = 0;
  for (const raw of input) {
    const s = SubscriptionSnapshotSchema.parse(raw);
    s.observedAt = new Date(s.observedAt).toISOString();
    s.pools.sort((a, b) => a.poolRef.localeCompare(b.poolRef));
    const { observationId, ...body } = s,
      key = `${s.subscriptionRef}/${s.observedAt}`;
    const encoded = canonical(body);
    if (ids.has(observationId) && ids.get(observationId) !== encoded) conflicts.add(key);
    ids.set(observationId, encoded);
    const previous = byTime.get(key);
    if (!previous) {
      byTime.set(key, s);
      continue;
    }
    const { observationId: _a, pools: ap, ...abase } = previous;
    const { observationId: _b, pools: bp, ...bbase } = s;
    if (canonical(abase) !== canonical(bbase)) {
      conflicts.add(key);
      continue;
    }
    const pools = new Map(ap.map((p) => [p.poolRef, p]));
    let additions = 0;
    for (const p of bp) {
      if (pools.has(p.poolRef) && canonical(pools.get(p.poolRef)) !== canonical(p))
        conflicts.add(key);
      else if (!pools.has(p.poolRef)) {
        pools.set(p.poolRef, p);
        additions++;
      }
    }
    if (pools.size > 100) {
      conflicts.add(key);
      continue;
    }
    if (!additions) duplicates++;
    previous.pools = [...pools.values()].sort((a, b) => a.poolRef.localeCompare(b.poolRef));
    if (additions) previous.observationId = quotaUuid(`merged/${key}/${canonical(previous.pools)}`);
  }
  return {
    snapshots: [...byTime.values()].sort(
      (a, b) =>
        Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
        a.subscriptionRef.localeCompare(b.subscriptionRef),
    ),
    conflicts: [...conflicts],
    duplicates,
  };
}

export function quotaCoverage(snapshots: SubscriptionSnapshot[], interval: Interval) {
  const start = Date.parse(interval.startAt),
    end = Date.parse(interval.endAt);
  const pools = new Map<
    string,
    { snapshot: SubscriptionSnapshot; pool: SubscriptionSnapshot['pools'][number] }[]
  >();
  for (const snapshot of snapshots)
    for (const pool of snapshot.pools) {
      const key = `${snapshot.subscriptionRef}/${pool.poolRef}`;
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key)!.push({ snapshot, pool });
    }
  return [...pools.values()].map((entries) => {
    entries.sort((a, b) => Date.parse(a.snapshot.observedAt) - Date.parse(b.snapshot.observedAt));
    const history = entries.filter(
      (e) => Date.parse(e.snapshot.observedAt) >= start && Date.parse(e.snapshot.observedAt) < end,
    );
    const times = history.map((e) => Date.parse(e.snapshot.observedAt));
    const segments = history
      .flatMap((e) =>
        e.pool.ledger?.coverage === 'complete'
          ? [
              [
                Math.max(start, Date.parse(e.pool.ledger.from)),
                Math.min(end, Date.parse(e.pool.ledger.through)),
              ],
            ]
          : [],
      )
      .sort((a, b) => a[0] - b[0]);
    let ledgerMs = 0,
      through = start;
    for (const [a, b] of segments)
      if (b > Math.max(a, through)) {
        ledgerMs += b - Math.max(a, through);
        through = b;
      }
    const points = [start, ...times, end];
    let maxGap = 0,
      resetBoundariesCrossed = 0,
      counterDecreases = 0;
    for (let i = 1; i < points.length; i++) maxGap = Math.max(maxGap, points[i] - points[i - 1]);
    for (let i = 1; i < history.length; i++) {
      const a = history[i - 1],
        b = history[i],
        reset = a.pool.window.resetsAt;
      if (
        reset &&
        Date.parse(reset) > Date.parse(a.snapshot.observedAt) &&
        Date.parse(reset) <= Date.parse(b.snapshot.observedAt)
      )
        resetBoundariesCrossed++;
      if (
        a.pool.percent?.direction === 'used' &&
        b.pool.percent?.direction === 'used' &&
        b.pool.percent.value < a.pool.percent.value
      )
        counterDecreases++;
    }
    const days = new Set(times.map((t) => Math.floor(t / DAY)));
    const dayCount = Math.ceil(end / DAY) - Math.floor(start / DAY);
    return {
      subscriptionRef: entries[0].snapshot.subscriptionRef,
      poolRef: entries[0].pool.poolRef,
      historyObservations: history.length,
      firstObservedAt: history[0]?.snapshot.observedAt ?? null,
      lastObservedAt: history.at(-1)?.snapshot.observedAt ?? null,
      utcDaysWithoutObservation: dayCount - days.size,
      maxUnobservedSeconds: maxGap / 1000,
      declaredCompleteLedgerSeconds: ledgerMs / 1000,
      resetBoundariesCrossed,
      counterDecreases,
      numericCapacityKnown: entries.some((e) => e.pool.capacity.total !== null),
      evidence: 'Q0' as const,
      consumptionCoverage: 'not_established' as const,
    };
  });
}

/** Linear batching, with room reserved for envelope and server review token. */
export function quotaBatches(snapshots: SubscriptionSnapshot[], statistics = false) {
  const drafts: SubscriptionDraft[] = [];
  let batch: SubscriptionSnapshot[] = [],
    bytes = 4096;
  const flush = () => {
    if (batch.length) drafts.push(prepareSubscriptions(subscriptionEnvelope(batch, statistics)));
    batch = [];
    bytes = 4096;
  };
  for (const s of snapshots) {
    const size = Buffer.byteLength(JSON.stringify(s)) + 1;
    if (size + 4096 > 512 * 1024)
      throw new Error('单条额度观察超过上传上限；请保留原记录，调整来源导出分段。');
    if (batch.length === 500 || bytes + size > 512 * 1024) flush();
    batch.push(s);
    bytes += size;
  }
  flush();
  return drafts;
}

export async function collectQuotaOnce(options: {
  enabled: boolean;
  configPath?: string;
  interval?: Interval;
  out?: string;
  statistics?: boolean;
  now?: Date;
}) {
  // Before this gate there must be no source/config/state reads or output writes.
  if (!options.enabled)
    return { status: 'disabled' as const, monitoringStarted: false, uploaded: false };
  const now = options.now ?? new Date();
  const interval = z
    .object({ startAt: z.string().datetime(), endAt: z.string().datetime() })
    .parse(options.interval);
  const start = Date.parse(interval.startAt),
    end = Date.parse(interval.endAt);
  if (start >= end || end - start > 90 * DAY || end > now.getTime() + 60000)
    throw new Error('采集时间必须为过去最多 90 天的有效区间。');
  if (!options.configPath || !options.out) throw new Error('请提供单次采集配置和新的输出目录。');
  const out = resolve(options.out),
    configPath = resolve(options.configPath),
    base = dirname(configPath);
  if (existsSync(out)) throw new Error('输出目录已存在，请保留原批次并选择新目录。');
  const config = QuotaCollectionConfigSchema.parse(JSON.parse(readLocalTextSync(configPath, MiB)));
  const sources: SourceResult[] = [],
    selected: SubscriptionSnapshot[] = [];
  let readBytes = 0;
  const add = (input: SubscriptionSnapshot[], mode: 'history' | 'current') => {
    const rows = input
      .filter((s) => {
        const at = Date.parse(s.observedAt);
        return mode === 'history'
          ? at >= start && at < end
          : at >= start && at <= (options.now ?? new Date()).getTime() + 60000;
      })
      .map((s) => clipLedger(s, mode === 'history' ? start : Date.parse(s.observedAt)));
    if (selected.length + rows.length > 20000) throw new Error('observation_budget');
    selected.push(...rows);
    return rows.length;
  };
  for (const source of config.history) {
    const report: SourceResult = {
      source: source.id,
      mode: 'history',
      status: 'read',
      filesRead: 0,
      observations: 0,
      invalidEvents: 0,
      failures: 0,
    };
    sources.push(report);
    for (const file of source.files) {
      try {
        const text = readLocalTextSync(
          resolve(base, file),
          Math.min(16 * MiB, 128 * MiB - readBytes),
        );
        readBytes += Buffer.byteLength(text);
        let rows: SubscriptionSnapshot[];
        if (source.kind === 'codex') {
          const parsed = codexQuotaSnapshots(text, source.subscriptionRef!, interval);
          rows = parsed.snapshots;
          report.invalidEvents += parsed.invalidEvents;
          if (parsed.invalidEvents) report.status = 'partial';
        } else if (source.kind === 'dsh') {
          // Validate the source export, then add() narrows to the explicitly selected interval.
          rows = dshSubscriptionSnapshots(JSON.parse(text), collectionWindow('90d', new Date(end)));
        } else {
          const json: unknown = JSON.parse(text);
          rows = z
            .array(SubscriptionSnapshotSchema)
            .max(20000)
            .parse(Array.isArray(json) ? json : [json]);
        }
        report.observations += add(rows, 'history');
        report.filesRead++;
      } catch {
        report.failures++;
      }
    }
    if (report.failures) report.status = report.filesRead ? 'partial' : 'failed';
  }
  if (config.current) {
    // Validate the complete config but contact only explicitly selected entries.
    let current;
    try {
      current = readMonitorConfig(resolve(base, config.current.configPath)).config;
    } catch {
      /* Report failures without discarding successful history. */
    }
    for (const id of config.current.sourceIds) {
      const report: SourceResult = {
        source: id,
        mode: 'current',
        status: 'read',
        filesRead: 0,
        observations: 0,
        invalidEvents: 0,
        failures: 0,
      };
      sources.push(report);
      try {
        const source = current?.sources.find((s) => s.id === id);
        if (!source) throw new Error('unknown_source');
        const result = await pollSource(source, { nextAt: 0, failures: 0 }, now, {
          clock: () => options.now ?? new Date(),
        });
        if (!result.snapshot) throw new Error('no_observation');
        report.observations = add([result.snapshot], 'current');
        if (!report.observations) throw new Error('stale_observation');
      } catch {
        report.status = 'failed';
        report.failures++;
      }
    }
  }
  const merged = mergeQuotaSnapshots(selected);
  const issues = sources.some((s) => s.status !== 'read');
  const status = merged.conflicts.length
    ? 'needs_resolution'
    : issues
      ? 'partial'
      : merged.snapshots.length
        ? 'ready'
        : 'empty';
  const drafts = merged.conflicts.length ? [] : quotaBatches(merged.snapshots, options.statistics);
  const report = {
    format: 'opencost-quota-collection-report-1',
    status,
    interval,
    generatedAt: now.toISOString(),
    monitoringStarted: false,
    uploaded: false,
    modelCalls: 0,
    sources,
    readBytes,
    observations: merged.snapshots.length,
    duplicates: merged.duplicates,
    conflicts: merged.conflicts,
    coverage: quotaCoverage(merged.snapshots, interval),
    batches: drafts.map((draft, i) => ({
      file: `preview-${i + 1}.json`,
      observations: draft.envelope.snapshots.length,
      digest: draft.digest,
    })),
  };
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const save = (file: string, value: unknown) =>
    writeFileSync(join(out, file), JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  save('report.json', report);
  // Preserve all normalized conflicting observations locally for correction.
  save('observations.json', merged.conflicts.length ? selected : merged.snapshots);
  drafts.forEach((draft, i) => save(`preview-${i + 1}.json`, draft));
  return report;
}
