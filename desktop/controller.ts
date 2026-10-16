import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DailySummarySchema } from '../shared/desktop-summary.js';
import type { DailySummary } from '../shared/desktop-summary.js';
import { DesktopStore, digest } from './store.js';
import {
  SettingsSchema,
  type Settings,
  type Request,
  type Snapshot,
  type HarnessDetection,
  type Binding,
} from './model.js';
import {
  collectSources,
  measurements,
  dayWindow,
  localDay,
  authorizedSourceRoot,
  SourceAuthorizationError,
} from './sources.js';
import { generateSemantic } from './runner.js';
import { endpointOrigin, getFeedback, listFeedback } from '../client/sdk.js';
import { uploadWorkJournal } from '../client/work-journal.js';
import { pairFromArgs } from './pairing.js';
import { attachJournalAnalysis } from '../shared/journal-analysis-revision.js';

export type ControllerDeps = {
  changed(): void;
  approval(): void;
  directory: string;
  accessKey(endpoint: string): string;
  collect?: typeof collectSources;
  generate?: typeof generateSemantic;
  upload?: (...args: Parameters<typeof uploadWorkJournal>) => Promise<Record<string, unknown>>;
  feedback?: typeof listFeedback;
  readFeedback?: typeof getFeedback;
  origin?: DailySummary['origin'];
};
export class JournalController {
  pending: Request | null = null;
  busy = false;
  message = '';
  private closing = false;
  private closed: Promise<void> | null = null;
  private operation: { abort: AbortController; done: Promise<void>; finish(): void } | null = null;
  constructor(
    readonly store: DesktopStore,
    readonly harnesses: HarnessDetection[],
    readonly deps: ControllerDeps,
  ) {}
  assertOpen() {
    if (this.closing) throw new Error('应用正在退出，不能开始新的操作');
  }
  private beginOperation() {
    this.assertOpen();
    if (this.busy) throw new Error('已有任务正在运行');
    const abort = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation = { abort, done, finish };
    this.operation = operation;
    this.busy = true;
    return operation;
  }
  private endOperation(operation: NonNullable<JournalController['operation']>) {
    if (this.operation === operation) this.operation = null;
    this.busy = false;
    try {
      this.deps.changed();
    } finally {
      operation.finish();
    }
  }
  cancel() {
    this.assertOpen();
    this.pending = null;
    this.operation?.abort.abort(new Error('当前操作已取消'));
    this.message = this.busy ? '正在停止当前操作，已记录的用量和历史保留' : '已取消当前请求';
    this.deps.changed();
  }
  async attachAnalysis(input: unknown) {
    this.assertOpen();
    if (this.busy) throw new Error('请等待当前操作完成后附加分析');
    const id = z.object({ target: z.object({ summaryId: z.uuid() }) }).parse(input)
      .target.summaryId;
    const original = this.store.summary(id);
    if (this.store.latestSummaryId(original.day) !== id)
      throw new Error('这份日记已有新修订，请刷新后重新选择');
    const summary = attachJournalAnalysis(
      original,
      input,
      randomUUID(),
      this.store.revision(original.day),
      new Date().toISOString(),
    );
    if (summary === original) return summary.id;
    // Analysis changes invalidate any outstanding upload approval.
    this.pending = null;
    const operation = this.beginOperation();
    try {
      await this.store.saveOptimized(summary, { signal: operation.abort.signal });
      this.message = '分析已保存为新修订，请查看后选择是否上传';
      return summary.id;
    } finally {
      this.endOperation(operation);
    }
  }
  close(): Promise<void> {
    if (this.closed) return this.closed;
    this.closing = true;
    this.pending = null;
    const operation = this.operation;
    this.closed = operation?.done ?? Promise.resolve();
    operation?.abort.abort(new Error('应用正在退出，当前操作已取消'));
    this.message = '正在结束后台操作并保存已取得的回执与用量';
    this.deps.changed();
    return this.closed;
  }
  private async waitForSelection<T>(selection: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const aborted = () => {
        signal.removeEventListener('abort', aborted);
        reject(signal.reason);
      };
      signal.addEventListener('abort', aborted, { once: true });
      selection.then(
        (value) => {
          signal.removeEventListener('abort', aborted);
          if (signal.aborted) reject(signal.reason);
          else resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', aborted);
          reject(error);
        },
      );
      if (signal.aborted) aborted();
    });
  }
  scope() {
    const s = this.store.settings();
    return digest({
      bindings: this.store.bindings(),
      engine: s.engine,
      endpoint: s.endpoint,
      generation: s.generationMode,
      upload: s.uploadMode,
    });
  }
  configurationToken() {
    this.assertOpen();
    if (this.busy || this.pending) throw new Error('先处理当前请求，再修改配置或绑定');
    const settings = this.store.settings();
    return digest({
      settings,
      bindings: this.store.bindings(),
      owner: this.store.get('feedback-owner:' + settings.endpoint),
    });
  }
  assertConfiguration(token: string) {
    if (token !== this.configurationToken())
      throw new Error('配置或绑定已变化，请重新打开设置或绑定窗口');
  }
  pair(args: string[]) {
    this.assertOpen();
    // A busy rejection must precede consuming the one-use token or writing a binding.
    if (args.includes('--bind-token')) this.configurationToken();
    const binding = pairFromArgs(this.store, args);
    if (binding) this.changedScope();
    return binding;
  }
  snapshot(pairPrompt = ''): Snapshot {
    if (!this.store.db.isOpen) throw new Error('应用已退出，日记数据库已关闭');
    return {
      settings: this.store.settings(),
      bindings: this.store.bindings(),
      harnesses: this.harnesses,
      summaries: this.store.summaryHeads(),
      uploaded: this.store.uploaded(this.store.settings().endpoint),
      pending: this.pending,
      busy: this.busy,
      message: this.message,
      pairPrompt,
      storageBytes: this.store.storageBytes(),
      attempts: this.store.attempts(),
      feedback: this.store.feedback(this.store.settings().endpoint),
      feedbackHistory: this.store.feedbackHistory(this.store.settings().endpoint),
    };
  }
  changedScope() {
    this.assertOpen();
    this.pending = null;
    const s = this.store.settings();
    this.store.set('preferences', { ...s, generationMode: 'ask', uploadMode: 'ask' });
    this.deps.changed();
  }
  private validateBindings(bindings: Binding[]) {
    try {
      for (const binding of bindings) {
        try {
          authorizedSourceRoot(binding);
        } catch (cause) {
          this.store.revokeSourceAuthorization(binding.id);
          throw cause;
        }
      }
    } catch (cause) {
      this.pending = null;
      const settings = this.store.settings();
      this.store.set('preferences', { ...settings, generationMode: 'ask', uploadMode: 'ask' });
      this.message = cause instanceof Error ? cause.message : '来源目录无法验证，请重新绑定';
      this.deps.changed();
      throw cause;
    }
  }
  async refreshFeedback() {
    this.assertOpen();
    if (this.busy || this.pending) throw new Error('先处理当前请求');
    const endpoint = this.store.settings().endpoint;
    if (!endpoint) throw new Error('先在设置中保存 OpenCost-AI 站点地址');
    const operation = this.beginOperation();
    const signal = operation.abort.signal;
    this.message = '正在读取个人反馈，不调用模型…';
    this.deps.changed();
    try {
      const key = this.deps.accessKey(endpoint);
      const owner = digest(key);
      this.store.set('feedback-owner:' + endpoint, owner);
      const reports = await (this.deps.feedback ?? listFeedback)(endpoint, key, signal);
      signal.throwIfAborted();
      this.store.saveFeedback(endpoint, reports, owner);
      this.message = reports.length
        ? '已读取个人反馈，历史价格与反馈保留生成时的版本'
        : '此身份暂时没有反馈；请先上传摘要，或导入 Skill 上传时保存的访问凭证';
    } catch (cause) {
      this.message = '反馈暂未取得，已保存的摘要与历史保留';
      throw cause;
    } finally {
      this.endOperation(operation);
    }
  }
  async readFeedback(input: unknown) {
    this.assertOpen();
    const { kind, recordId } = z
      .object({
        kind: z.enum(['contribution', 'journal', 'subscription']),
        recordId: z.string().uuid(),
      })
      .strict()
      .parse(input);
    if (this.busy || this.pending) throw new Error('先处理当前请求');
    const endpoint = this.store.settings().endpoint;
    if (!endpoint) throw new Error('先在设置中保存 OpenCost-AI 站点地址');
    const operation = this.beginOperation();
    const signal = operation.abort.signal;
    this.message = '正在读取所选记录的反馈，不调用模型…';
    this.deps.changed();
    try {
      const key = this.deps.accessKey(endpoint),
        owner = digest(key);
      const target = this.store.feedbackTarget(endpoint, owner, kind, recordId);
      if (!target) throw new Error('当前站点和身份没有这份反馈或已确认的上传回执');
      this.store.set('feedback-owner:' + endpoint, owner);
      const result = await (this.deps.readFeedback ?? getFeedback)(
        endpoint,
        key,
        kind,
        target,
        signal,
      );
      signal.throwIfAborted();
      this.store.saveFeedback(endpoint, [result.feedback], owner);
      this.message = result.persisted
        ? '已取得并保存这份反馈，正式历史报告保留生成时的版本'
        : '已取得临时反馈；可在准备完成后手动重新读取，无需重新上传';
      return { kind, recordId: target };
    } catch (error) {
      this.message = '这份反馈暂未取得，已有回执和反馈仍保留';
      throw error;
    } finally {
      this.endOperation(operation);
    }
  }
  async backup(selectDestination: () => Promise<string | null>) {
    this.assertOpen();
    if (this.busy || this.pending) throw new Error('先处理当前请求，再备份日记');
    const operation = this.beginOperation();
    const signal = operation.abort.signal;
    this.message = '请选择完整日记备份的保存位置';
    this.deps.changed();
    try {
      const destination = await this.waitForSelection(selectDestination(), signal);
      signal.throwIfAborted();
      if (!destination) {
        this.message = '已取消备份';
        return null;
      }
      this.message = '正在备份完整日记，不调用模型…';
      this.deps.changed();
      const result = await this.store.backup(destination);
      this.message = '完整日记备份已保存，并通过数据库完整性检查';
      return result;
    } catch (error) {
      this.message = '备份未完成，原日记与已有备份保留';
      throw error;
    } finally {
      this.endOperation(operation);
    }
  }
  async saveFile(
    selectDestination: () => Promise<string | null>,
    write: (destination: string) => Promise<void>,
  ) {
    this.assertOpen();
    if (this.busy || this.pending) throw new Error('先处理当前请求，再导出文件');
    const operation = this.beginOperation();
    const signal = operation.abort.signal;
    this.message = '请选择导出文件的保存位置';
    this.deps.changed();
    try {
      const destination = await this.waitForSelection(selectDestination(), signal);
      signal.throwIfAborted();
      if (!destination) {
        this.message = '已取消导出';
        return null;
      }
      // Once writing starts, shutdown drains it instead of leaving a partial file.
      await write(destination);
      this.message = '文件已保存';
      return destination;
    } catch (error) {
      this.message = '文件导出未完成，本机日记与历史保留';
      throw error;
    } finally {
      this.endOperation(operation);
    }
  }
  settings(input: unknown) {
    this.configurationToken();
    const next = SettingsSchema.parse(input);
    if (next.endpoint) next.endpoint = endpointOrigin(next.endpoint);
    if (next.uploadMode === 'automatic' && !next.endpoint)
      throw new Error('自动上传需要先填写 OpenCost-AI 站点地址');
    const current = this.store.settings();
    // A changed provider or upload origin always requires fresh authorization in the UI.
    if (next.engine !== current.engine) next.generationMode = 'ask';
    if (next.endpoint !== current.endpoint) next.uploadMode = 'ask';
    this.store.set('preferences', next);
    this.deps.changed();
  }
  async requestGeneration(day: string, automatic = false) {
    this.assertOpen();
    if (this.busy || this.pending) throw new Error('先处理当前请求或等待正在运行的任务');
    dayWindow(day);
    if (Date.now() - Date.parse(day + 'T00:00:00') > 31 * 86400000)
      throw new Error('只整理近 30 天内的一天，避免读取过长历史');
    const bindings = this.store.bindings().filter((b) => b.enabled);
    if (!bindings.length) throw new Error('先绑定至少一个日志来源');
    this.validateBindings(bindings);
    const s = this.store.settings(),
      engine = this.harnesses.find((h) => h.id === s.engine);
    if (!engine?.available || s.engine === 'dsh')
      throw new Error('请选择 Codex、Claude Code 或 OpenCode 整理摘要；DSH 目前支持作为日志来源');
    const pending: Request = {
      id: randomUUID(),
      kind: 'generate',
      day,
      bindings: bindings.length,
      scopeDigest: this.scope(),
      engine: engine.label,
      endpoint: '',
    };
    this.pending = pending;
    this.deps.changed();
    if (automatic && s.generationMode === 'automatic') await this.approve(pending.id);
    else this.deps.approval();
  }
  async requestUpload(id: string, automatic = false) {
    this.assertOpen();
    if (this.busy || this.pending) throw new Error('先处理当前请求');
    const summary = this.store.summary(id),
      s = this.store.settings();
    if (!s.endpoint) throw new Error('先在设置中填写 OpenCost-AI 站点地址');
    if (this.store.uploaded(s.endpoint).includes(id)) {
      this.message = '这个修订已上传';
      this.deps.changed();
      return;
    }
    const pending: Request = {
      id: randomUUID(),
      kind: 'upload',
      day: summary.day,
      bindings: summary.harnesses.length,
      summaryId: id,
      scopeDigest: this.scope(),
      engine: summary.processing.harness,
      endpoint: s.endpoint,
      ...(summary.tasks.some(t=>t.analysis)?{analysis:summary.tasks.reduce((a,t)=>{
        if(t.analysis){a.items++;a.bytes+=Buffer.byteLength(JSON.stringify(t.analysis),'utf8');a.reports+=(t.analysis.codeMeasurements?.snapshots.length??0)+(t.analysis.codeMeasurements?.patches.length??0);}return a;
      },{items:0,reports:0,bytes:0})}:{}),
    };
    this.pending = pending;
    this.deps.changed();
    if (automatic && s.uploadMode === 'automatic') await this.approve(pending.id);
    else this.deps.approval();
  }
  deny(id: string) {
    this.assertOpen();
    if (this.pending?.id !== id) throw new Error('请求已失效');
    this.pending = null;
    this.message = '已跳过本次请求';
    this.deps.changed();
  }
  async approve(id: string) {
    this.assertOpen();
    const p = this.pending;
    if (!p || p.id !== id || p.scopeDigest !== this.scope())
      throw new Error('授权内容已变化，请重新发起');
    if (this.busy) throw new Error('已有任务正在运行');
    if (p.kind === 'generate')
      this.validateBindings(this.store.bindings().filter((binding) => binding.enabled));
    this.pending = null;
    const operation = this.beginOperation();
    const signal = operation.abort.signal;
    this.message =
      p.kind === 'generate' ? '正在读取已授权来源并整理摘要…' : '正在上传已预览的脱敏字段…';
    this.deps.changed();
    let summary: DailySummary | null = null;
    let attemptId: string | null = null;
    let processing: DailySummary['processing'] | undefined;
    try {
      if (p.kind === 'generate') {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
          window = dayWindow(p.day),
          bindings = this.store.bindings().filter((b) => b.enabled);
        const collectedThrough=new Date().toISOString();
        if(window.startAt>=collectedThrough)throw new Error('所选日期尚未开始，请选择已经发生的工作');
        if(window.endAt>collectedThrough)window.endAt=collectedThrough;
        const records = await (this.deps.collect ?? collectSources)(
          bindings,
          this.store,
          window.startAt,
          window.endAt,
          { signal },
        );
        signal.throwIfAborted();
        // Source identity can change while an asynchronous collector is running.
        // Recheck before passing any excerpt to a model, even with an injected collector.
        this.validateBindings(bindings);
        if (p.scopeDigest !== this.scope())
          throw new Error('读取期间绑定或配置发生变化，未调用模型，请重新允许');
        if (!records.length) {
          this.message = '选定日期没有可读取的会话事件，没有调用模型';
          return;
        }
        const engine = this.harnesses.find((h) => h.id === this.store.settings().engine)!;
        if (records.some((r) => r.texts.length))
          attemptId = this.store.startAttempt(p.day, engine.id);
        const generated = records.some((r) => r.texts.length)
          ? await (this.deps.generate ?? generateSemantic)(engine, records, this.deps.directory, {
              signal,
              extendedObservations: this.store.settings().extendedObservations,
            })
          : {
              tasks: [],
              processing: {
                harness: engine.id,
                durationMs: 0,
                inputTokens: null,
                outputTokens: null,
                costMinor: null,
                currency: null,
              },
            };
        processing = generated.processing;
        signal.throwIfAborted();
        if (p.scopeDigest !== this.scope())
          throw new Error('运行中绑定或配置发生变化，本次摘要未保存');
        if (attemptId) this.store.finishAttempt(attemptId, 'completed', processing);
        const saved = DailySummarySchema.parse({
          format: 'opencost-daily-summary-1',
          id: randomUUID(),
          day: p.day,
          timeZone,
          ...window,
          createdAt: new Date().toISOString(),
          revision: this.store.revision(p.day),
          origin: this.deps.origin ?? 'real',
          evidence: 'local_unverified',
          coverage: 'partial',
          collector: { id: 'opencost-desktop', version: '1.0', digest: digest(records) },
          harnesses: [
            ...new Map(
              records.map((r) => [
                r.harness + ':' + (r.harnessVersion ?? 'unknown'),
                { id: r.harness, version: r.harnessVersion ?? 'unknown', surface: 'unknown' },
              ]),
            ).values(),
          ],
          tasks: generated.tasks,
          models: [...new Set(records.flatMap(r => r.models ?? []))],
          measurements: measurements(records),
          processing: generated.processing,
          processingHistory: this.store.attempts(p.day),
          consent: { store: false, statistics: false, publicSummary: false },
        });
        this.store.save(saved);
        this.store.set('lastGeneration', new Date().toISOString());
        summary = saved;
        this.message = '摘要已保存在本机，点击画布节点查看详情';
      } else {
        const s = this.store.settings(),
          item = this.store.summary(p.summaryId!);
        const key = this.deps.accessKey(s.endpoint);
        const owner = digest(key);
        this.store.set('feedback-owner:' + s.endpoint, owner);
        const receipt = await (this.deps.upload ?? uploadWorkJournal)(s.endpoint, key, item, {
          signal,
        });
        // A validated commit receipt remains valuable even if exit was requested
        // while it was arriving. close() waits for this write before closing SQLite.
        this.store.receipt(item.id, s.endpoint, receipt, owner);
        this.message =
          receipt.feedback || receipt.existingFeedback
            ? '已上传至个人工作日记，可查看个人反馈；未加入公开排名'
            : '上传成功，个人反馈暂不可用；摘要已保留，可稍后刷新反馈';
      }
    } catch (error) {
      if (error instanceof SourceAuthorizationError && !this.closing) this.changedScope();
      if (attemptId)
        this.store.finishAttempt(
          attemptId,
          'failed',
          (error as { processing?: Partial<DailySummary['processing']> })?.processing ?? processing,
        );
      // Do not persist raw provider output, stderr, excerpts or credentials in error logs.
      this.message = error instanceof Error ? error.message.slice(0, 240) : '任务失败';
      this.store.event('failure', p.kind === 'generate' ? '生成未成功' : '上传未成功');
    } finally {
      this.endOperation(operation);
    }
    if (!this.closing && !signal.aborted && summary && this.store.settings().endpoint)
      await this.requestUpload(summary.id, true);
  }
  async tick(now = new Date()) {
    if (this.closing) return;
    const s = this.store.settings(),
      day = localDay(now);
    if (
      !s.introduced ||
      !s.reminderEnabled ||
      !this.store.bindings().some((b) => b.enabled) ||
      this.busy ||
      this.pending
    )
      return;
    const [h, m] = s.dailyTime.split(':').map(Number);
    if (
      now.getHours() * 60 + now.getMinutes() < h * 60 + m ||
      this.store.get('remindedDay') === day
    )
      return;
    this.store.set('remindedDay', day);
    const last = this.store.get<string>('lastGeneration');
    const longGap = last && now.getTime() - Date.parse(last) > 3 * 86400000;
    if (longGap) {
      this.store.set('preferences', { ...s, generationMode: 'ask', uploadMode: 'ask' });
      this.message =
        '距离上次成功已超过 3 天：本次重新确认，只整理今天；可在日记中另选近 30 天的一天';
    }
    await this.requestGeneration(day, !longGap);
  }
}
