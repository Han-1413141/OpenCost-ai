import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { PersonalFeedbackSchema } from '../shared/personal-feedback.js';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SettingsSchema, BindingSchema, type Settings, type Binding } from './model.js';
import { sourceAuthorization } from './sources.js';
import { backupJournal } from './backup.js';
import {
  DailySummarySchema,
  ProcessingAttemptSchema,
  type DailySummary,
  type ProcessingAttempt,
} from '../shared/desktop-summary.js';
export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

function initializeReceipts(db: DatabaseSync) {
  // Keep the original three-column table writable by the preserved desktop app.
  db.exec(`CREATE TABLE IF NOT EXISTS uploads(
    id TEXT PRIMARY KEY,endpoint TEXT NOT NULL,receipt TEXT NOT NULL)`);
  const columns = db.prepare('PRAGMA table_info(uploads)').all() as {
    name: string;
    pk: number;
  }[];
  const primaryKey = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
  const legacy =
    columns.length === 3 &&
    columns.map((column) => column.name).join(',') === 'id,endpoint,receipt' &&
    primaryKey.length === 1 &&
    primaryKey[0].name === 'id';
  if (!legacy) throw new Error('上传回执表结构不兼容，已保留原数据库');
  db.exec(`CREATE TABLE IF NOT EXISTS uploads_legacy(
    endpoint TEXT NOT NULL,id TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(endpoint,id));
    CREATE TABLE IF NOT EXISTS upload_receipts(
      endpoint TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,receipt TEXT NOT NULL,
      PRIMARY KEY(endpoint,owner,id));`);
  // The current credential cannot prove which account received an older upload.
  // Retain every original receipt without assigning it to the current owner.
  // Copy without altering the old table or replacing an archived original. Later
  // writes by the old application remain visible through the unowned query.
  db.exec(`INSERT INTO uploads_legacy(endpoint,id,receipt)
    SELECT endpoint,id,receipt FROM uploads WHERE true
    ON CONFLICT(endpoint,id) DO NOTHING;`);
}

export class DesktopStore {
  readonly db: DatabaseSync;
  readonly file: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'work-journal.sqlite');
    this.db = new DatabaseSync(this.file);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS summaries(id TEXT PRIMARY KEY, day TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(day,revision));
      CREATE INDEX IF NOT EXISTS summary_day ON summaries(day,revision);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS file_cache(path TEXT PRIMARY KEY, stamp TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS processing_attempts(id TEXT PRIMARY KEY,day TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feedback_reports(endpoint TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(endpoint,owner,kind,id));`);
      initializeReceipts(this.db);
      if (!this.get('salt')) this.set('salt', randomBytes(32).toString('hex'));
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  get<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      { value: string } | undefined;
    return r ? JSON.parse(r.value) : null;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  setCredential(endpoint: string, encryptedKey: string, owner: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.set('access:' + endpoint, encryptedKey);
      this.set('feedback-owner:' + endpoint, owner);
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  backup(destination: string) {
    return backupJournal(this.db, destination);
  }
  settings(): Settings {
    return SettingsSchema.parse(this.get('preferences') ?? {});
  }
  bindings(): Binding[] {
    return (this.db.prepare('SELECT payload FROM bindings').all() as { payload: string }[]).map(
      (r) => BindingSchema.parse(JSON.parse(r.payload)),
    );
  }
  bind(harness: Binding['harness'], source: string): Binding {
    // Called only by the explicit folder picker or one-use pairing flow. Never
    // refresh this identity during collection or when loading older bindings.
    const authorization = sourceAuthorization(source);
    const existing = this.bindings().find((b) => b.harness === harness && b.source === source);
    if (existing) {
      const rebound = BindingSchema.parse({
        ...existing,
        authorization,
        authorizationRevokedAt: undefined,
      });
      this.db
        .prepare('UPDATE bindings SET payload=? WHERE id=?')
        .run(JSON.stringify(rebound), existing.id);
      return rebound;
    }
    const b = BindingSchema.parse({
      id: randomUUID(),
      harness,
      source,
      enabled: true,
      createdAt: new Date().toISOString(),
      authorization,
    });
    this.db.prepare('INSERT INTO bindings VALUES(?,?)').run(b.id, JSON.stringify(b));
    return b;
  }
  revokeSourceAuthorization(id: string) {
    const binding = this.bindings().find((item) => item.id === id);
    if (!binding || binding.authorizationRevokedAt) return;
    // Preserve the approved identity as history, but never let restoring the
    // original directory silently revive an authorization already invalidated.
    binding.authorizationRevokedAt = new Date().toISOString();
    this.db.prepare('UPDATE bindings SET payload=? WHERE id=?').run(JSON.stringify(binding), id);
  }
  toggle(id: string, enabled: boolean) {
    const b = this.bindings().find((b) => b.id === id);
    if (!b) throw new Error('环境不存在');
    b.enabled = enabled;
    this.db.prepare('UPDATE bindings SET payload=? WHERE id=?').run(JSON.stringify(b), id);
  }
  summaries(): DailySummary[] {
    return (
      this.db
        .prepare(
          'SELECT payload FROM summaries WHERE (day,revision) IN (SELECT day,MAX(revision) FROM summaries GROUP BY day) ORDER BY day DESC LIMIT 366',
        )
        .all() as { payload: string }[]
    ).map((r) => DailySummarySchema.parse(JSON.parse(r.payload)));
  }
  summary(id: string): DailySummary {
    const r = this.db.prepare('SELECT payload FROM summaries WHERE id=?').get(id) as
      { payload: string } | undefined;
    if (!r) throw new Error('摘要不存在');
    return DailySummarySchema.parse(JSON.parse(r.payload));
  }
  save(summary: DailySummary) {
    const s = DailySummarySchema.parse(summary);
    this.db
      .prepare('INSERT INTO summaries VALUES(?,?,?,?)')
      .run(s.id, s.day, s.revision, JSON.stringify(s));
  }
  revision(day: string) {
    return (
      Number(
        (this.db.prepare('SELECT MAX(revision) AS n FROM summaries WHERE day=?').get(day) as any)
          .n ?? 0,
      ) + 1
    );
  }
  uploaded(
    endpoint: string,
    owner = this.get<string>('feedback-owner:' + endpoint) ?? '',
  ): string[] {
    const rows = (
      owner
        ? this.db
            .prepare('SELECT id FROM upload_receipts WHERE endpoint=? AND owner=? ORDER BY id')
            .all(endpoint, owner)
        : this.db
            .prepare(
              `SELECT id FROM uploads_legacy WHERE endpoint=?
              UNION SELECT id FROM uploads WHERE endpoint=? ORDER BY id`,
            )
            .all(endpoint, endpoint)
    ) as { id: string }[];
    return rows.map((row) => row.id);
  }
  receipt(
    id: string,
    endpoint: string,
    receipt: unknown,
    owner = this.get<string>('feedback-owner:' + endpoint) ?? '',
  ) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (owner)
        this.db
          .prepare(
            `INSERT INTO upload_receipts(endpoint,owner,id,receipt) VALUES(?,?,?,?)
          ON CONFLICT(endpoint,owner,id) DO UPDATE SET receipt=excluded.receipt`,
          )
          .run(endpoint, owner, id, JSON.stringify(receipt));
      else
        this.db
          .prepare(
            `INSERT INTO uploads_legacy(endpoint,id,receipt) VALUES(?,?,?)
          ON CONFLICT(endpoint,id) DO NOTHING`,
          )
          .run(endpoint, id, JSON.stringify(receipt));
      const r = receipt as Record<string, unknown>,
        parsed = PersonalFeedbackSchema.safeParse(r?.feedback);
      if (
        parsed.success &&
        parsed.data.kind === 'journal' &&
        parsed.data.recordId === id &&
        r.id === id
      )
        this.saveFeedback(endpoint, [parsed.data], owner);
      const existing = PersonalFeedbackSchema.safeParse(r?.existingFeedback);
      if (
        existing.success &&
        existing.data.kind === 'journal' &&
        r.id === id &&
        typeof r.duplicateOf === 'string' &&
        r.duplicateOf === r.existingId &&
        existing.data.recordId === r.duplicateOf
      )
        this.saveFeedback(endpoint, [existing.data], owner);
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  feedback(endpoint: string) {
    return this.feedbackHistory(endpoint)[0] ?? null;
  }
  saveFeedback(
    endpoint: string,
    reports: unknown[],
    owner = this.get<string>('feedback-owner:' + endpoint) ?? '',
  ) {
    const parsed = reports.map((report) => PersonalFeedbackSchema.parse(report));
    const insert = this.db.prepare(`INSERT INTO feedback_reports VALUES(?,?,?,?,?,?)
      ON CONFLICT(endpoint,owner,kind,id) DO UPDATE SET created_at=excluded.created_at,payload=excluded.payload
      WHERE json_valid(feedback_reports.payload) AND json_type(feedback_reports.payload,'$.provisional')='true'`);
    for (const report of parsed)
      insert.run(
        endpoint,
        owner,
        report.kind,
        report.recordId,
        report.generatedAt,
        JSON.stringify(report),
      );
  }
  feedbackTarget(endpoint: string, owner: string, kind: string, id: string): string | null {
    if (!owner) return null;
    if (
      this.db
        .prepare('SELECT 1 FROM feedback_reports WHERE endpoint=? AND owner=? AND kind=? AND id=?')
        .get(endpoint, owner, kind, id)
    )
      return id;
    if (kind !== 'journal') return null;
    const row = this.db
      .prepare(
        `SELECT CASE WHEN octet_length(receipt)<=1048576 THEN receipt ELSE NULL END AS receipt
      FROM upload_receipts WHERE endpoint=? AND owner=? AND id=?`,
      )
      .get(endpoint, owner, id) as { receipt: string | null } | undefined;
    if (!row?.receipt) return null;
    try {
      const receipt = JSON.parse(row.receipt) as Record<string, unknown>;
      if (receipt.id !== id) return null;
      if (receipt.duplicateOf === undefined) return id;
      const duplicate = z.string().uuid().safeParse(receipt.duplicateOf);
      return duplicate.success && duplicate.data === receipt.existingId ? duplicate.data : null;
    } catch {
      return null;
    }
  }
  feedbackHistory(endpoint: string) {
    const owner = this.get<string>('feedback-owner:' + endpoint) ?? '';
    return (
      this.db
        .prepare(
          'SELECT payload FROM feedback_reports WHERE endpoint=? AND owner=? ORDER BY created_at DESC LIMIT 30',
        )
        .all(endpoint, owner) as { payload: string }[]
    ).map((row) => PersonalFeedbackSchema.parse(JSON.parse(row.payload)));
  }
  event(kind: string, detail: string) {
    this.db
      .prepare('INSERT INTO events(at,kind,detail) VALUES(?,?,?)')
      .run(new Date().toISOString(), kind, detail);
  }
  storageBytes() {
    return [this.file, this.file + '-wal'].reduce((n, p) => {
      try {
        return n + statSync(p).size;
      } catch {
        return n;
      }
    }, 0);
  }
  attempts(day?: string): ProcessingAttempt[] {
    const rows = (
      day
        ? this.db
            .prepare('SELECT payload FROM processing_attempts WHERE day=? ORDER BY rowid')
            .all(day)
        : this.db
            .prepare('SELECT payload FROM processing_attempts ORDER BY rowid DESC LIMIT 30')
            .all()
    ) as { payload: string }[];
    return rows.map((r) => ProcessingAttemptSchema.parse(JSON.parse(r.payload)));
  }
  startAttempt(day: string, harness: ProcessingAttempt['harness']) {
    if (this.attempts(day).length >= 100)
      throw new Error('当天已有 100 次生成尝试，停止继续消耗额度');
    const attempt = ProcessingAttemptSchema.parse({
      id: randomUUID(),
      day,
      harness,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'running',
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      costMinor: null,
      currency: null,
    });
    this.db
      .prepare('INSERT INTO processing_attempts VALUES(?,?,?)')
      .run(attempt.id, day, JSON.stringify(attempt));
    return attempt.id;
  }
  finishAttempt(
    id: string,
    status: 'completed' | 'failed',
    processing?: Partial<DailySummary['processing']>,
  ) {
    const row = this.db.prepare('SELECT payload FROM processing_attempts WHERE id=?').get(id) as
      { payload: string } | undefined;
    if (!row) return;
    const a = JSON.parse(row.payload);
    const result = ProcessingAttemptSchema.parse({
      ...a,
      ...processing,
      id: a.id,
      status,
      endedAt: new Date().toISOString(),
      durationMs: processing?.durationMs ?? Date.now() - Date.parse(a.startedAt),
    });
    this.db
      .prepare('UPDATE processing_attempts SET payload=? WHERE id=?')
      .run(JSON.stringify(result), id);
  }
  recoverAttempts() {
    for (const row of this.db.prepare('SELECT id,payload FROM processing_attempts').all() as {
      id: string;
      payload: string;
    }[]) {
      const a = JSON.parse(row.payload);
      if (a.status === 'running')
        this.db
          .prepare('UPDATE processing_attempts SET payload=? WHERE id=?')
          .run(JSON.stringify({ ...a, status: 'interrupted', durationMs: null }), row.id);
    }
  }
  close() {
    this.db.close();
  }
}
