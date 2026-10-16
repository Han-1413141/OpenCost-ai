import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  SubscriptionSnapshotSchema,
  compareSubscriptionPool,
  knownSubscriptionCapacity,
  subscriptionConditions,
  type QuotaPool,
  type SubscriptionHistoryReason,
  type SubscriptionPoolContext,
  type SubscriptionSnapshot,
} from '../shared/subscriptions.js';
import { hash, type SubscriptionDraft } from './subscriptions.js';
import {
  SQLiteStorageBudget,
  asStorageBudgetError,
  validateStorageBudgetOptions,
  type StorageBudgetOptions,
} from '../shared/sqlite-storage-budget.js';

export type MonitorGrant = {
  authorizationId?: string;
  mode: 'local' | 'upload' | 'off';
  incrementalEnabled: boolean;
  configDigest: string;
  endpoint: string | null;
  contributor: string | null;
  since: string;
  authorizedAt: string;
  through: string | null;
  lastUploadAt: string | null;
  nextUploadAt: string;
  uploadFailure?: {
    at: string;
    status: number | null;
    code: string | null;
    automaticRetry: boolean;
    notBefore: string | null;
  } | null;
  cycle?: { since: string; through: string; received: boolean } | null;
  pending: {
    draft: SubscriptionDraft;
    ids: string[];
    through: string;
    anchorSequence: number;
  } | null;
};
export type SourceState = {
  nextAt: number;
  failures: number;
  etag?: string;
  modified?: string;
  fileStamp?: string;
  lastGood?: string;
  resetAt?: string;
  probeFor?: string;
  snapshot?: SubscriptionSnapshot;
};

type HistoryFailure = 'row_budget' | 'byte_budget' | 'ambiguous_time' | 'invalid_history';
type HistoryResult<T> = { value: T; failure?: never } | { failure: HistoryFailure; value?: never };
type HistoryMetadata = {
  sequence: number;
  id: string;
  at: string;
  body_digest: string;
  at_ms: number | null;
  bytes: number | null;
  ambiguous: number;
};
const completeHistory = (reason: SubscriptionHistoryReason = 'resolved') =>
  ({ status: 'complete', reason }) as const;
const partialHistory = (reason: HistoryFailure) => ({ status: 'partial', reason }) as const;

// The limits cover every subscription and pool in one status request, including current
// snapshots. A stored body is checked for size before it is retrieved into JavaScript.
class MonitorHistoryReader {
  private accesses = 0;
  private bytes = 0;
  private readonly latest;
  private readonly previous;
  private readonly invalidTime;
  private readonly body;
  constructor(
    db: DatabaseSync,
    private readonly maxRows: number,
    private readonly maxBytes: number,
  ) {
    const columns = `SELECT o.sequence,o.id,o.at,o.at_ms,o.body_digest,
      length(CAST(b.payload AS BLOB)) AS bytes,
      EXISTS(SELECT 1 FROM observations duplicate
        WHERE duplicate.subscription_ref=o.subscription_ref
          AND duplicate.at_ms=o.at_ms
          AND duplicate.sequence<>o.sequence LIMIT 1) AS ambiguous
      FROM observations o LEFT JOIN bodies b ON b.digest=o.body_digest
      WHERE o.subscription_ref=?`;
    this.latest = db.prepare(`${columns} ORDER BY o.at_ms DESC,o.sequence DESC LIMIT 1`);
    this.previous = db.prepare(
      `${columns} AND o.at_ms<? ORDER BY o.at_ms DESC,o.sequence DESC LIMIT 1`,
    );
    this.invalidTime = db.prepare(
      'SELECT 1 FROM observations WHERE subscription_ref=? AND at_ms IS NULL LIMIT 1',
    );
    this.body = db.prepare('SELECT payload FROM bodies WHERE digest=?');
  }
  private visit(): HistoryFailure | null {
    if (this.accesses >= this.maxRows) return 'row_budget';
    this.accesses++;
    return null;
  }
  hasInvalidTime(ref: string): HistoryResult<boolean> {
    const failure = this.visit();
    return failure ? { failure } : { value: !!this.invalidTime.get(ref) };
  }
  seek(ref: string, before?: number): HistoryResult<HistoryMetadata | null> {
    const failure = this.visit();
    if (failure) return { failure };
    return {
      value:
        ((before === undefined ? this.latest.get(ref) : this.previous.get(ref, before)) as
          HistoryMetadata | undefined) ?? null,
    };
  }
  read(ref: string, row: HistoryMetadata): HistoryResult<SubscriptionSnapshot> {
    // Keep original time strings while checking the derived index against the same parser
    // used by subscription comparisons, including equivalent and submillisecond ISO forms.
    if (
      !Number.isSafeInteger(row.at_ms) ||
      Date.parse(row.at) !== row.at_ms ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes === null ||
      row.bytes < 0
    )
      return { failure: 'invalid_history' };
    if (row.bytes > this.maxBytes - this.bytes) return { failure: 'byte_budget' };
    this.bytes += row.bytes;
    const record = this.body.get(row.body_digest) as { payload: string } | undefined;
    try {
      if (!record || Buffer.byteLength(record.payload, 'utf8') !== row.bytes)
        return { failure: 'invalid_history' };
      const body = JSON.parse(record.payload);
      if (hash(body) !== row.body_digest) return { failure: 'invalid_history' };
      const parsed = SubscriptionSnapshotSchema.safeParse({
        ...body,
        observationId: row.id,
        observedAt: row.at,
      });
      if (!parsed.success || parsed.data.subscriptionRef !== ref)
        return { failure: 'invalid_history' };
      return { value: parsed.data };
    } catch {
      return { failure: 'invalid_history' };
    }
  }
}

type MonitorPoolState = {
  pool: QuotaPool;
  conditions: string;
  context: SubscriptionPoolContext;
};
const unresolvedHistory = ({ context }: MonitorPoolState) =>
  context.historyCoverage.previous.status === 'partial' ||
  context.historyCoverage.capacity.status === 'partial';
function finishUnresolvedHistory(states: MonitorPoolState[], reason: SubscriptionHistoryReason) {
  const coverage =
    reason === 'history_exhausted'
      ? completeHistory(reason)
      : partialHistory(reason as HistoryFailure);
  for (const { context } of states) {
    if (context.historyCoverage.previous.status === 'partial')
      context.historyCoverage.previous = coverage;
    if (context.historyCoverage.capacity.status === 'partial')
      context.historyCoverage.capacity = coverage;
  }
}
export class MonitorStore {
  db: DatabaseSync;
  readonly storageBudget: SQLiteStorageBudget;
  private atomicDepth = 0;
  constructor(file: string, options: StorageBudgetOptions = {}) {
    const validatedOptions = validateStorageBudgetOptions(options);
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    if (file !== ':memory:')
      try {
        chmodSync(file, 0o600);
      } catch {
        /* Windows uses directory ACLs. */
      }
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
      this.storageBudget = new SQLiteStorageBudget(this.db, file, validatedOptions);
      this.atomic(
        () => {
          this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bodies(digest TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observations(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, subscription_ref TEXT NOT NULL, at TEXT NOT NULL, body_digest TEXT NOT NULL REFERENCES bodies(digest), UNIQUE(subscription_ref,at));
      CREATE INDEX IF NOT EXISTS local_observation_time ON observations(at,sequence);
      CREATE TABLE IF NOT EXISTS uploads(target TEXT NOT NULL,id TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(target,id));
      CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, previous TEXT NOT NULL,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work_receipts(digest TEXT NOT NULL,target TEXT NOT NULL,receipt TEXT NOT NULL, PRIMARY KEY(digest,target));`);
          const columns = this.db.prepare('PRAGMA table_info(observations)').all() as {
            name: string;
          }[];
          if (!columns.some((column) => column.name === 'at_ms'))
            this.db.exec('ALTER TABLE observations ADD COLUMN at_ms INTEGER');
          // Legacy versions name the inserted columns, so their newer observations leave this
          // derived field NULL. Fill those rows on reopening without rewriting signed history.
          const rows = this.db.prepare(
            'SELECT sequence,at FROM observations WHERE at_ms IS NULL AND sequence>? ORDER BY sequence LIMIT 256',
          );
          const saveTime = this.db.prepare('UPDATE observations SET at_ms=? WHERE sequence=?');
          let after = 0;
          for (;;) {
            const batch = rows.all(after) as { sequence: number; at: string }[];
            if (!batch.length) break;
            for (const row of batch) {
              const milliseconds = Date.parse(row.at);
              if (Number.isSafeInteger(milliseconds)) saveTime.run(milliseconds, row.sequence);
              after = row.sequence;
            }
          }
          this.db.exec(
            'CREATE INDEX IF NOT EXISTS local_observation_subscription_time_ms ON observations(subscription_ref,at_ms,sequence)',
          );
          if (!this.get('salt')) this.set('salt', randomBytes(32).toString('hex'));
        },
        { maintenance: true },
      );
    } catch (error) {
      try {
        this.db.close();
      } catch {
        // Preserve the initialization error; no store escaped this constructor.
      }
      throw asStorageBudgetError(error);
    }
  }
  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT payload FROM settings WHERE key=?').get(key) as
      { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  set(key: string, value: unknown, options: { maintenance?: boolean } = {}) {
    this.atomic(
      () =>
        this.db
          .prepare(
            'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload',
          )
          .run(key, JSON.stringify(value)),
      options,
    );
  }
  atomic<T>(fn: () => T, options: { maintenance?: boolean } = {}): T {
    // Nested writes share the owning transaction and its maintenance permission;
    // an inner call cannot grant itself access to the recovery reserve.
    if (this.atomicDepth > 0) {
      if (!this.db.isTransaction) throw new Error('额度写入事务已回滚，不能继续写入');
      try {
        return fn();
      } catch (error) {
        throw asStorageBudgetError(error);
      }
    }
    if (this.db.isTransaction) throw new Error('额度数据库已存在外部事务，请使用 atomic 管理写入');
    try {
      this.storageBudget.checkpointIfNeeded();
      this.db.exec('BEGIN IMMEDIATE');
      this.atomicDepth++;
      const before = this.storageBudget.captureTransaction();
      const result = fn();
      if (!this.db.isTransaction) throw new Error('额度写入事务已回滚，不能继续提交');
      const changed = this.storageBudget.assertTransaction(before, options);
      this.db.exec('COMMIT');
      if (changed) this.storageBudget.afterWrite();
      return result;
    } catch (error) {
      // SQLITE_FULL can roll back the transaction itself. Preserve that cause
      // instead of replacing it with a second, unsuccessful ROLLBACK.
      if (this.db.isTransaction) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          /* Preserve the original error. */
        }
      }
      throw asStorageBudgetError(error);
    } finally {
      this.atomicDepth = 0;
    }
  }
  audit(kind: string, payload: unknown, now = new Date().toISOString()) {
    return this.atomic(() => {
      const last = this.db
        .prepare('SELECT digest FROM audit ORDER BY sequence DESC LIMIT 1')
        .get() as { digest: string } | undefined;
      const previous = last?.digest ?? '0'.repeat(64),
        digest = hash({ salt: this.get('salt'), previous, at: now, kind, payload });
      this.db
        .prepare('INSERT INTO audit(at,kind,payload,previous,digest) VALUES(?,?,?,?,?)')
        .run(now, kind, JSON.stringify(payload), previous, digest);
    });
  }
  record(snapshot: SubscriptionSnapshot, source: string, now = new Date().toISOString()) {
    snapshot = SubscriptionSnapshotSchema.parse(snapshot);
    if (Date.parse(snapshot.observedAt) > Date.parse(now) + 60000)
      throw new Error('额度来源给出了未来的观察时间');
    const { observationId, observedAt, ...body } = snapshot,
      digest = hash(body);
    return this.atomic(() => {
      const existing = this.db
        .prepare(
          'SELECT body_digest,id,at FROM observations WHERE id=? OR (subscription_ref=? AND at=?)',
        )
        .get(observationId, snapshot.subscriptionRef, observedAt) as
        { body_digest: string; id: string; at: string } | undefined;
      if (existing) {
        if (existing.body_digest !== digest || existing.at !== observedAt)
          throw new Error('来源修改了既有观察，历史不会被覆盖');
        return false;
      }
      this.db.prepare('INSERT OR IGNORE INTO bodies VALUES(?,?)').run(digest, JSON.stringify(body));
      this.db
        .prepare(
          'INSERT INTO observations(id,subscription_ref,at,body_digest,at_ms) VALUES(?,?,?,?,?)',
        )
        .run(observationId, snapshot.subscriptionRef, observedAt, digest, Date.parse(observedAt));
      this.audit('observation', { source, observationId, observedAt, bodyDigest: digest }, now);
      return true;
    });
  }
  pending(
    target: string,
    since: string,
    through: string,
    subscriptionRefs: readonly string[],
    limit = 100,
  ) {
    const refs = [...new Set(subscriptionRefs)];
    if (!refs.length) return [];
    const sinceMs = Date.parse(since),
      throughMs = Date.parse(through);
    if (!Number.isSafeInteger(sinceMs) || !Number.isSafeInteger(throughMs) || sinceMs > throughMs)
      throw new Error('额度上传时间范围无效');
    return (
      this.db
        .prepare(
          `SELECT o.id,o.at,o.at_ms,b.payload FROM observations o JOIN bodies b ON b.digest=o.body_digest WHERE o.at_ms>=? AND o.at_ms<? AND NOT EXISTS(SELECT 1 FROM uploads u WHERE u.target=? AND u.id=o.id) AND o.subscription_ref IN (${refs.map(() => '?').join(',')}) ORDER BY o.at_ms,o.sequence LIMIT ?`,
        )
        .all(sinceMs, throughMs, target, ...refs, limit) as {
        id: string;
        at: string;
        at_ms: number;
        payload: string;
      }[]
    ).map((r) => {
      if (Date.parse(r.at) !== r.at_ms) throw new Error('额度历史时间索引与原始记录不一致');
      return {
        ...JSON.parse(r.payload),
        observationId: r.id,
        observedAt: r.at,
      } as SubscriptionSnapshot;
    });
  }
  anchor() {
    return this.db
      .prepare('SELECT sequence,digest FROM audit ORDER BY sequence DESC LIMIT 1')
      .get() as { sequence: number; digest: string } | undefined;
  }
  changes(options: { maxRows?: number; maxBytes?: number } = {}) {
    const maxRows = options.maxRows ?? 2048,
      maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    if (![maxRows, maxBytes].every((value) => Number.isSafeInteger(value) && value >= 0))
      throw new Error('额度历史读取预算必须是非负安全整数');
    const reader = new MonitorHistoryReader(this.db, maxRows, maxBytes);
    const refs = this.db
      .prepare(
        'SELECT DISTINCT subscription_ref FROM observations ORDER BY subscription_ref LIMIT 100',
      )
      .all() as { subscription_ref: string }[];
    // Read current targets first so a long capacity search cannot hide other subscriptions.
    const targets = refs.map(({ subscription_ref: ref }) => {
      const latest = reader.seek(ref);
      if (latest.failure || !latest.value)
        throw new Error(`额度当前快照无法安全读取：${latest.failure ?? 'invalid_history'}`);
      const current = reader.read(ref, latest.value);
      if (current.failure) throw new Error(`额度当前快照无法安全读取：${current.failure}`);
      const invalidTime = reader.hasInvalidTime(ref);
      const failure =
        invalidTime.failure ??
        (invalidTime.value ? 'invalid_history' : undefined) ??
        (latest.value.ambiguous ? 'ambiguous_time' : undefined);
      const states: MonitorPoolState[] = current.value.pools.map((pool) => ({
        pool,
        conditions: subscriptionConditions(current.value, pool),
        context: {
          previous: null,
          priorPool: null,
          baseline: null,
          baselinePool: null,
          isLatest: failure ? null : true,
          historyCoverage: {
            previous: partialHistory(failure ?? 'row_budget'),
            capacity: partialHistory(failure ?? 'row_budget'),
            latest: failure ? partialHistory(failure) : completeHistory(),
          },
        },
      }));
      return { snapshot: current.value, before: latest.value.at_ms!, states, failure };
    });
    for (const target of targets) {
      if (target.failure) continue;
      while (target.states.some(unresolvedHistory)) {
        const next = reader.seek(target.snapshot.subscriptionRef, target.before);
        if (next.failure || !next.value) {
          finishUnresolvedHistory(target.states, next.failure ?? 'history_exhausted');
          break;
        }
        const candidate = reader.read(target.snapshot.subscriptionRef, next.value);
        const failure = candidate.failure ?? (next.value.ambiguous ? 'ambiguous_time' : undefined);
        if (failure) {
          finishUnresolvedHistory(target.states, failure);
          break;
        }
        const snapshot = candidate.value!;
        if (Date.parse(snapshot.observedAt) >= Date.parse(target.snapshot.observedAt)) {
          finishUnresolvedHistory(target.states, 'ambiguous_time');
          break;
        }
        target.before = next.value.at_ms!;
        const pools = new Map(snapshot.pools.map((pool) => [pool.poolRef, pool]));
        for (const state of target.states) {
          const pool = pools.get(state.pool.poolRef),
            context = state.context;
          if (!pool) continue;
          if (context.historyCoverage.previous.status === 'partial') {
            context.previous = snapshot;
            context.priorPool = pool;
            context.historyCoverage.previous = completeHistory();
          }
          if (context.historyCoverage.capacity.status === 'partial') {
            if (subscriptionConditions(snapshot, pool) !== state.conditions)
              context.historyCoverage.capacity = completeHistory('conditions_changed');
            else if (knownSubscriptionCapacity(snapshot, pool)) {
              context.baseline = snapshot;
              context.baselinePool = pool;
              context.historyCoverage.capacity = completeHistory();
            }
          }
        }
      }
    }
    return targets.flatMap(({ snapshot, states }) =>
      states.map(({ pool, context }) => compareSubscriptionPool(snapshot, pool, context)),
    );
  }
  verify() {
    let previous = '0'.repeat(64),
      count = 0;
    for (const row of this.db
      .prepare('SELECT * FROM audit ORDER BY sequence')
      .iterate() as Iterable<{
      at: string;
      kind: string;
      payload: string;
      previous: string;
      digest: string;
    }>) {
      if (
        row.previous !== previous ||
        row.digest !==
          hash({
            salt: this.get('salt'),
            previous,
            at: row.at,
            kind: row.kind,
            payload: JSON.parse(row.payload),
          })
      )
        throw new Error('本地历史校验失败');
      if (row.kind === 'observation') {
        const p = JSON.parse(row.payload),
          saved = this.db
            .prepare(
              'SELECT o.at,o.body_digest,b.payload FROM observations o JOIN bodies b ON o.body_digest=b.digest WHERE o.id=?',
            )
            .get(p.observationId) as
            { at: string; body_digest: string; payload: string } | undefined;
        if (
          !saved ||
          saved.at !== p.observedAt ||
          saved.body_digest !== p.bodyDigest ||
          hash(JSON.parse(saved.payload)) !== p.bodyDigest
        )
          throw new Error('本地快照与留存摘要不一致');
      }
      previous = row.digest;
      count++;
    }
    return {
      count,
      head: previous,
      limitation: '发现留存后修改；不证明最初数据真实，也不能阻止有本机控制权的人重写未上传历史',
    };
  }
  close() {
    this.db.close();
  }
}
