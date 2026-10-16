import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageBudgetError } from '../shared/sqlite-storage-budget.js';
import { SubscriptionSnapshotSchema, type SubscriptionSnapshot } from '../shared/subscriptions.js';
import {
  type MonitorConfig,
  type MonitorSource,
  jsonPointer,
  setPointer,
} from './monitor-config.js';
import { MonitorStore, type MonitorGrant, type SourceState } from './monitor-store.js';
import { readLocalText } from './local-file.js';
import {
  contributorId,
  HttpRequestError,
  prepareDraft,
  submitDraft,
  type PreparedDraft,
} from './sdk.js';
import {
  prepareSubscriptions,
  subscriptionEnvelope,
  submitSubscriptions,
} from './subscriptions.js';
import {
  readSession,
  assertAutomaticUpload,
  recordSuccessfulUpload,
  updateSession,
} from './session.js';

const DAY = 86400000,
  MAX_BYTES = 1024 * 1024;
export type MonitorControl = {
  signal?: AbortSignal;
  assertActive?: () => void;
  /** Runtime supplies a live clock; explicit dates remain deterministic for callers and tests. */
  clock?: () => Date;
};
function checkControl(control: MonitorControl) {
  control.signal?.throwIfAborted();
  control.assertActive?.();
  control.signal?.throwIfAborted();
}
export function assertMonitorStorageAvailable(store: MonitorStore) {
  store.storageBudget.checkpointIfNeeded();
  const state = store.storageBudget.snapshot();
  if (!state.writesAvailable) throw new StorageBudgetError(state.blockedBy[0]);
}
async function boundedJson(response: Response, signal: AbortSignal) {
  if (!response.body) throw new Error('额度接口没有返回内容');
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    if (Number(response.headers.get('content-length')) > MAX_BYTES)
      throw new Error('额度响应超过 1 MiB');
    for (;;) {
      const item = await reader.read();
      signal.throwIfAborted();
      if (item.done) break;
      size += item.value.length;
      if (size > MAX_BYTES) throw new Error('额度响应超过 1 MiB');
      parts.push(item.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await (cancellation ?? reader.cancel().catch(() => {}));
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
}
export function nextPoll(source: MonitorSource, state: SourceState, now: number) {
  if (state.failures)
    return (
      now +
      Math.min(
        3600000,
        Math.max(source.pollSeconds * 1000, 60000) * 2 ** Math.min(state.failures - 1, 6),
      )
    );
  let next = now + source.pollSeconds * 1000;
  if (source.resetProbe && state.resetAt) {
    const reset = Date.parse(state.resetAt);
    // At most one pre/post pair for a reported reset. No tight loops or API traffic bursts.
    if (reset - 15000 > now && reset - 15000 < next) next = reset - 15000;
    else if (now >= reset - 15000 && now < reset + 15000 && state.probeFor !== state.resetAt)
      next = Math.max(now + 30000, reset + 15000);
  }
  return Math.max(now + 30000, next);
}
export async function pollSource(
  source: MonitorSource,
  previous: SourceState,
  now = new Date(),
  control: MonitorControl = {},
): Promise<{ state: SourceState; snapshot: SubscriptionSnapshot | null; completedAt: Date }> {
  checkControl(control);
  const state = { ...previous };
  let snapshot: SubscriptionSnapshot | null = null;
  let completedAt = now;
  if (source.kind === 'file') {
    const info = await lstat(source.path),
      stamp = `${info.mtimeMs}:${info.size}`;
    checkControl(control);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('额度来源必须是普通文件');
    if (info.size > MAX_BYTES) throw new Error('额度文件超过 1 MiB');
    if (stamp !== state.fileStamp) {
      snapshot = SubscriptionSnapshotSchema.parse(
        JSON.parse(await readLocalText(source.path, MAX_BYTES)),
      );
      checkControl(control);
      if (snapshot.subscriptionRef !== source.subscriptionRef)
        throw new Error('导出文件的订阅身份改变，需要重新授权来源');
      state.fileStamp = stamp;
    }
    completedAt = control.clock?.() ?? now;
  } else {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (state.etag) headers['If-None-Match'] = state.etag;
    if (state.modified) headers['If-Modified-Since'] = state.modified;
    if (source.auth) {
      if (new URL(source.url).origin !== source.auth.origin) throw new Error('API 凭据来源不匹配');
      const value = process.env[source.auth.env];
      if (!value || /[\r\n]/.test(value)) throw new Error('本地 API 凭据未配置');
      headers[source.auth.header] = source.auth.scheme === 'Bearer' ? `Bearer ${value}` : value;
    }
    const signal = control.signal
      ? AbortSignal.any([control.signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000);
    checkControl(control);
    const response = await fetch(source.url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal,
    });
    if (response.status !== 304) {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`额度接口返回 HTTP ${response.status}`);
      }
      const raw = await boundedJson(response, signal),
        mapped = structuredClone(source.template);
      checkControl(control);
      completedAt = control.clock?.() ?? now;
      mapped.observationId = randomUUID();
      mapped.observedAt = completedAt.toISOString();
      for (const field of source.mapping)
        setPointer(mapped, field.to, jsonPointer(raw, field.from));
      snapshot = SubscriptionSnapshotSchema.parse(mapped);
      state.etag = response.headers.get('etag')?.slice(0, 500);
      state.modified = response.headers.get('last-modified')?.slice(0, 200);
    } else {
      await response.body?.cancel();
      completedAt = control.clock?.() ?? now;
    }
  }
  checkControl(control);
  state.failures = 0;
  if (snapshot) {
    if (Date.parse(snapshot.observedAt) > completedAt.getTime() + 60000)
      throw new Error('额度来源时间在未来');
    state.lastGood = completedAt.toISOString();
    state.snapshot = snapshot;
    state.resetAt = snapshot.pools
      .map((p) => p.window.resetsAt)
      .filter(
        (value): value is string =>
          value !== null && Date.parse(value) > completedAt.getTime() - 60000,
      )
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  }
  if (previous.resetAt && completedAt.getTime() >= Date.parse(previous.resetAt) + 15000)
    state.probeFor = previous.resetAt;
  state.nextAt = nextPoll(source, state, completedAt.getTime());
  return { state, snapshot, completedAt };
}
function authorized(store: MonitorStore, digest: string, accessKey?: string) {
  const grant = store.get<MonitorGrant>('grant');
  if (!grant || grant.mode === 'off') throw new Error('监控尚未开启或已关闭，请先让用户选择');
  if (grant.configDigest !== digest) throw new Error('来源配置发生变化，需要用户重新选择并授权');
  if (grant.mode === 'upload' && (!accessKey || contributorId(accessKey) !== grant.contributor))
    throw new Error('上传身份发生变化，需要重新授权');
  return grant;
}
export function monitorAuthority(grant: MonitorGrant) {
  return JSON.stringify([
    grant.authorizationId ?? null,
    grant.authorizedAt,
    grant.mode,
    grant.configDigest,
    grant.endpoint,
    grant.contributor,
    grant.since,
    grant.incrementalEnabled,
  ]);
}
function sameAuthority(latest: MonitorGrant | null, original: MonitorGrant) {
  return latest !== null && monitorAuthority(latest) === monitorAuthority(original);
}
function activeCheck(
  store: MonitorStore,
  digest: string,
  accessKey: string | undefined,
  original: MonitorGrant,
  control: MonitorControl,
) {
  return () => {
    checkControl(control);
    const latest = authorized(store, digest, accessKey);
    if (!sameAuthority(latest, original)) throw new Error('监控授权已改变，停止当前批次');
  };
}
const targetId = (grant: MonitorGrant) => `${grant.endpoint}/${grant.contributor}`;
function saveGrant(store: MonitorStore, original: MonitorGrant, changes: Partial<MonitorGrant>) {
  store.atomic(() => {
    const latest = store.get<MonitorGrant>('grant');
    if (!sameAuthority(latest, original)) throw new Error('监控授权已改变，停止当前批次');
    store.set('grant', { ...latest, ...changes });
  });
}
export async function uploadDaily(
  store: MonitorStore,
  config: MonitorConfig,
  digest: string,
  accessKey: string,
  now = new Date(),
  control: MonitorControl = {},
) {
  checkControl(control);
  now = control.clock?.() ?? now;
  let grant = authorized(store, digest, accessKey);
  // Keep the authority that started this operation, even when refreshing its progress.
  const original = grant;
  const check = activeCheck(store, digest, accessKey, original, control);
  const subscriptionRefs = config.sources.map((source) =>
    source.kind === 'file' ? source.subscriptionRef : source.template.subscriptionRef,
  );
  const allowedSubscriptions = new Set(subscriptionRefs);
  if (grant.mode !== 'upload' || Date.parse(grant.nextUploadAt) > now.getTime()) return;
  // Keep permanent rejections and long server deadlines across process restarts.
  // A new explicit grant clears this state while preserving its original batch.
  if (
    grant.uploadFailure?.automaticRetry === false ||
    (grant.uploadFailure?.notBefore && Date.parse(grant.uploadFailure.notBefore) > now.getTime())
  )
    return;
  assertMonitorStorageAvailable(store);
  if (!grant.incrementalEnabled && grant.through) {
    store.atomic(() => {
      check();
      store.set('attention', {
        code: 'choose_range',
        message: '默认增量已关闭，每次上传前请重新选择范围。',
      });
    });
    return;
  }
  if (now.getTime() - Date.parse(grant.through ?? grant.authorizedAt) > 3 * DAY) {
    store.atomic(() => {
      check();
      store.set('attention', {
        code: 'choose_range',
        at: now.toISOString(),
        message: '超过 3 天未成功上传，请重新选择 1d/3d/7d/30d/90d 范围；不会自动补传整个间隔。',
      });
    });
    return;
  }
  const cycle = grant.cycle ?? {
    since: grant.since,
    // The half-open range includes observations from this millisecond without changing
    // their timestamps. An existing batch keeps its original boundary for retries.
    through: grant.pending?.through ?? new Date(now.getTime() + 1).toISOString(),
    received: false,
  };
  if (!grant.cycle) saveGrant(store, original, { cycle });
  const target = targetId(grant),
    through = cycle.through,
    // Observation time may precede arrival (for example a delayed reset export).
    // Retain the authorized lower bound and deduplicate by receipts, not by the last scan time.
    since = grant.since;
  let uploaded = cycle.received;
  // Bounded batches and checkpointed receipts; no full-history scan in each timer tick.
  for (let batches = 0; batches < 64; batches++) {
    check();
    assertMonitorStorageAvailable(store);
    grant = authorized(store, digest, accessKey);
    let pending = grant.pending;
    if (!pending) {
      const rows = store.pending(target, since, through, subscriptionRefs, 100);
      if (!rows.length) break;
      let size = rows.length,
        draft;
      const anchor = store.anchor();
      for (;;) {
        const envelope = subscriptionEnvelope(rows.slice(0, size));
        if (anchor)
          envelope.historyAnchor = {
            installationRef: store.get<string>('installationRef')!,
            sequence: anchor.sequence,
            head: anchor.digest,
            previous: store.get<string>(`remote-head:${target}`),
          };
        try {
          draft = prepareSubscriptions(envelope);
          break;
        } catch (error) {
          if (size === 1) throw error;
          size = Math.max(1, Math.floor(size / 2));
        }
      }
      pending = {
        draft,
        ids: rows.slice(0, size).map((r) => r.observationId),
        through,
        anchorSequence: anchor?.sequence ?? 0,
      };
      saveGrant(store, original, { pending });
    }
    if (
      pending.draft.envelope.snapshots.some(
        (snapshot) => !allowedSubscriptions.has(snapshot.subscriptionRef),
      )
    )
      throw new Error('待重试批次包含当前未授权的订阅来源；保留批次，重新选择来源后重试');
    authorized(store, digest, accessKey);
    const receipt = await submitSubscriptions(
      grant.endpoint!,
      accessKey,
      pending.draft,
      pending.draft.digest,
      {
        signal: control.signal,
        beforeRequest: () => {
          check();
          assertMonitorStorageAvailable(store);
        },
      },
    );
    uploaded = true;
    store.atomic(
      () => {
        for (const id of pending!.ids)
          store.db
            .prepare('INSERT OR IGNORE INTO uploads VALUES(?,?,?)')
            .run(target, id, JSON.stringify(receipt));
        if (pending!.draft.envelope.historyAnchor)
          store.set(`remote-head:${target}`, pending!.draft.envelope.historyAnchor.head);
        // A late, verified receipt belongs to the original target even after revocation.
        // Preserve it without overwriting a replacement grant or re-enabling upload.
        if (sameAuthority(store.get<MonitorGrant>('grant'), original))
          saveGrant(store, original, {
            pending: null,
            cycle: { ...cycle, received: true },
            uploadFailure: null,
          });
      },
      { maintenance: true },
    );
    check();
  }
  check();
  if (store.pending(target, since, through, subscriptionRefs, 1).length) return; // Continue next bounded tick, cursor unchanged.
  if (config.workOutbox)
    uploaded =
      (await uploadWork(store, config, original, accessKey, target, {
        signal: control.signal,
        assertActive: check,
        clock: control.clock ?? (() => now),
      })) || uploaded;
  check();
  const completedAt = control.clock?.() ?? now;
  if (!uploaded) {
    saveGrant(store, original, {
      cycle: null,
      uploadFailure: null,
      nextUploadAt: new Date(completedAt.getTime() + DAY).toISOString(),
    });
    return;
  }
  if (
    config.sources.some(
      (s) => (store.get<SourceState>(`source:${digest}:${s.id}`)?.failures ?? 1) > 0,
    )
  ) {
    store.atomic(() => {
      saveGrant(store, original, {
        cycle: { ...cycle, received: true },
        uploadFailure: null,
        nextUploadAt: new Date(completedAt.getTime() + 15 * 60000).toISOString(),
      });
      store.set('attention', {
        code: 'source_incomplete',
        message: '部分来源读取失败；已成功批次保留，全量成功位置未推进。',
      });
    });
    return;
  }
  store.atomic(() => {
    saveGrant(store, original, {
      through,
      cycle: null,
      lastUploadAt: completedAt.toISOString(),
      nextUploadAt: new Date(completedAt.getTime() + DAY).toISOString(),
      uploadFailure: null,
    });
    store.set('attention', null);
  });
}
async function uploadWork(
  store: MonitorStore,
  config: MonitorConfig,
  original: MonitorGrant,
  key: string,
  target: string,
  control: MonitorControl,
) {
  checkControl(control);
  let uploaded = false;
  const files = (await readdir(config.workOutbox!)).filter((f) => f.endsWith('.json')).sort();
  checkControl(control);
  if (files.length > 1000) throw new Error('待上传目录超过 1000 个批次，请整理已上传文件后重试');
  const queue: { name: string; digest: string; startAt: string; endAt: string; part: number }[] =
    [];
  for (const name of files) {
    checkControl(control);
    const path = join(config.workOutbox!, name),
      info = await lstat(path);
    checkControl(control);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024)
      throw new Error('待上传目录只接受大小合规的普通 JSON 预览文件');
    const draft = JSON.parse(await readLocalText(path, MAX_BYTES)) as PreparedDraft;
    checkControl(control);
    if (draft.format !== 'opencost-preview-1')
      throw new Error('待上传文件必须先通过 contribute prepare 生成');
    if (prepareDraft(draft.envelope).digest !== draft.digest)
      throw new Error('工作预览被修改，请重新生成预览');
    const window = draft.envelope.collectionWindow;
    if (!window) throw new Error('工作预览缺少用户选择的采集区间');
    queue.push({
      name,
      digest: draft.digest,
      startAt: window.startAt,
      endAt: window.endAt,
      part: window.batch.part,
    });
  }
  // Keep only ordering metadata in memory, not up to 1000 full record bodies.
  queue.sort(
    (a, b) =>
      Date.parse(a.startAt) - Date.parse(b.startAt) ||
      Date.parse(a.endAt) - Date.parse(b.endAt) ||
      a.part - b.part,
  );
  for (const item of queue) {
    checkControl(control);
    const path = join(config.workOutbox!, item.name),
      info = await lstat(path);
    checkControl(control);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024)
      throw new Error('工作预览文件在读取期间变化');
    const draft = JSON.parse(await readLocalText(path, MAX_BYTES)) as PreparedDraft;
    checkControl(control);
    const currentDigest = prepareDraft(draft.envelope).digest;
    if (
      draft.format !== 'opencost-preview-1' ||
      currentDigest !== item.digest ||
      draft.digest !== currentDigest
    )
      throw new Error('工作预览文件在读取期间变化');
    const grant = original;
    const share = draft.envelope.consent.publicSummary
      ? 'summary'
      : draft.envelope.consent.statistics
        ? 'statistics'
        : 'private';
    const saveWorkCursor = () =>
      updateSession(config.collectionState, (state) => {
        checkControl(control);
        const window = draft.envelope.collectionWindow!;
        if (
          state.cursor?.endpoint === grant.endpoint &&
          state.cursor.contributor === contributorId(key) &&
          Date.parse(window.endAt) <= Date.parse(state.cursor.through)
        )
          return state;
        const completedAt = control.clock?.() ?? new Date();
        assertAutomaticUpload(
          state,
          window,
          grant.endpoint!,
          contributorId(key),
          share,
          completedAt,
        );
        return recordSuccessfulUpload(
          state,
          window,
          grant.endpoint!,
          contributorId(key),
          completedAt,
        );
      });
    if (
      store.db
        .prepare('SELECT 1 FROM work_receipts WHERE digest=? AND target=?')
        .get(currentDigest, target)
    ) {
      // Recover the collection cursor after a crash without restoring another site's consent.
      if (Date.parse(draft.envelope.collectionWindow!.startAt) >= Date.parse(grant.since))
        saveWorkCursor();
      continue;
    }
    if (
      !draft.envelope.collectionWindow ||
      Date.parse(draft.envelope.collectionWindow.startAt) < Date.parse(grant.since)
    )
      throw new Error('工作预览超出用户选择的历史范围');
    const session = readSession(config.collectionState);
    assertAutomaticUpload(
      session,
      draft.envelope.collectionWindow,
      grant.endpoint!,
      contributorId(key),
      share,
      control.clock?.() ?? new Date(),
    );
    const receipt = await submitDraft({
      endpoint: grant.endpoint!,
      accessKey: key,
      draft,
      confirmedDigest: draft.digest,
      signal: control.signal,
      beforeRequest: () => {
        checkControl(control);
        assertMonitorStorageAvailable(store);
        // The collection skill's separate upload consent may change while preview is pending.
        assertAutomaticUpload(
          readSession(config.collectionState),
          draft.envelope.collectionWindow!,
          grant.endpoint!,
          contributorId(key),
          share,
          control.clock?.() ?? new Date(),
        );
      },
    });
    uploaded = true;
    store.atomic(
      () => {
        store.db
          .prepare('INSERT OR IGNORE INTO work_receipts VALUES(?,?,?)')
          .run(currentDigest, target, JSON.stringify(receipt));
        const latest = store.get<MonitorGrant>('grant');
        if (sameAuthority(latest, original) && latest?.cycle)
          saveGrant(store, original, { cycle: { ...latest.cycle, received: true } });
      },
      { maintenance: true },
    );
    checkControl(control);
    saveWorkCursor();
  }
  return uploaded;
}
export async function monitorTick(
  store: MonitorStore,
  config: MonitorConfig,
  digest: string,
  accessKey?: string,
  now = new Date(),
  control: MonitorControl = {},
) {
  checkControl(control);
  const grant = authorized(store, digest, accessKey);
  const check = activeCheck(store, digest, accessKey, grant, control);
  assertMonitorStorageAvailable(store);
  // Sequential reads deliberately cap the network and memory concurrency at one.
  for (const source of config.sources) {
    check();
    const sourceKey = `source:${digest}:${source.id}`;
    const previous = store.get<SourceState>(sourceKey) ?? { nextAt: 0, failures: 0 };
    const sourceAt = control.clock?.() ?? now;
    if (previous.nextAt > sourceAt.getTime()) continue;
    assertMonitorStorageAvailable(store);
    try {
      const { state, snapshot, completedAt } = await pollSource(source, previous, sourceAt, {
        signal: control.signal,
        assertActive: check,
        clock: control.clock,
      });
      check();
      store.atomic(() => {
        check();
        if (
          snapshot &&
          store.record(snapshot, source.id, completedAt.toISOString()) &&
          grant.mode === 'upload' &&
          Date.parse(snapshot.observedAt) < Date.parse(grant.since)
        )
          store.set('rangeNotice', {
            code: 'outside_authorized_range',
            at: completedAt.toISOString(),
            observedAt: snapshot.observedAt,
            message:
              '收到授权起点以前的额度记录，已保留本地。需要上传时请重新选择包含该记录的时间范围。',
          });
        store.set(sourceKey, state);
        store.audit(
          'poll',
          {
            source: source.id,
            status: snapshot ? 'read' : 'unchanged',
            lastGood: state.lastGood ?? null,
          },
          completedAt.toISOString(),
        );
      });
    } catch (error) {
      check(); // Revocation/stop is not a provider failure and must not change retry state.
      if (error instanceof StorageBudgetError) throw error;
      const failedAt = control.clock?.() ?? now;
      const state = { ...previous, failures: previous.failures + 1 };
      state.nextAt = nextPoll(source, state, failedAt.getTime());
      store.atomic(() => {
        check();
        store.set(sourceKey, state);
        // Never persist raw exception text: provider errors can contain account IDs or URLs.
        store.audit(
          'poll',
          {
            source: source.id,
            status: 'failed',
            lastGood: state.lastGood ?? null,
            nextAt: state.nextAt,
          },
          failedAt.toISOString(),
        );
      });
    }
  }
  if (grant.mode === 'upload') {
    try {
      check();
      await uploadDaily(store, config, digest, accessKey!, now, {
        signal: control.signal,
        assertActive: check,
        clock: control.clock,
      });
    } catch (error) {
      check();
      if (error instanceof StorageBudgetError) throw error;
      const failedAt = control.clock?.() ?? now;
      const httpError = error instanceof HttpRequestError ? error : null;
      const automaticRetry = httpError?.retryable !== false;
      const waitMs = Math.max(15 * 60000, httpError?.retryAfterMs ?? 0);
      // Parsing already bounds the server deadline. A few milliseconds can pass
      // before this catch; saturating at Date's upper bound cannot shorten that
      // original representable deadline and avoids an exception while saving it.
      const retryAt = (delay: number) =>
        new Date(Math.min(8_640_000_000_000_000, failedAt.getTime() + delay)).toISOString();
      const notBefore = automaticRetry ? retryAt(waitMs) : null;
      store.atomic(() => {
        check();
        saveGrant(store, grant, {
          // The one-day boundary is a local check only; notBefore still prohibits
          // network requests for the complete server-advertised waiting period.
          nextUploadAt: retryAt(Math.min(waitMs, DAY)),
          uploadFailure: {
            at: failedAt.toISOString(),
            status: httpError?.status ?? null,
            code: httpError?.code ?? null,
            automaticRetry,
            notBefore,
          },
        });
        store.set('attention', {
          code: automaticRetry ? 'upload_failed' : 'upload_paused',
          at: failedAt.toISOString(),
          notBefore,
          message: automaticRetry
            ? `上传未完成，保留原批次与幂等键，最早于 ${notBefore} 重试；成功位置未推进。`
            : '站点明确拒绝自动重试，已暂停上传。原批次与幂等键保留，成功位置未推进；处理原因后使用 grant 重新授权，或手动提交原预览。',
        });
      });
    }
  }
}
