import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readMonitorConfig, type MonitorConfig } from './monitor-config.js';
import { type MonitorGrant, type MonitorStore, type SourceState } from './monitor-store.js';
import { assertMonitorStorageAvailable, monitorAuthority, monitorTick } from './monitor.js';
import { StorageBudgetError } from '../shared/sqlite-storage-budget.js';
import { type LocalProcessLock } from './session-storage.js';
import { acquireMonitorStartLock, hasMonitorStop } from './monitor-stop.js';

const runtimeErrorMessages = {
  configuration_changed: '监控配置已改变，已停止；请重新确认来源。',
  authorization_changed: '监控授权已改变，已停止；请按新授权重新启动。',
  authorization_unreadable: '监控授权无法核验，已停止；请检查本地授权后重新启动。',
  lock_unavailable: '已有监控进程或遗留锁。先查看 status 并核对进程；不要重复启动或自动删除锁。',
  lock_changed: '监控进程锁已改变或无法核验，已取消当前操作；请检查后重新启动。',
  supervision_failed: '监控停止检查未完成，已取消当前操作；请检查后重新启动。',
  credentials_unavailable: '监控上传身份无法读取或不匹配，已停止；请检查身份后重新启动。',
  clock_changed:
    '本机时间早于已保存进度或运行中发生明显回拨，已停止。请校准时间后重新选择范围并授权；历史、回执和待传批次保留。若旧待传批次的截止时间仍在未来，仅重新授权不能恢复，请先核对来源时间。',
} as const;

const cleanupWarning = '监控进程的本地清理未完成；历史与回执保留，请检查运行状态后重试。';
function warnCleanup() {
  try {
    console.warn(cleanupWarning);
  } catch {
    // Diagnostics must never replace the work result or interrupt lock release.
  }
}

export type MonitorRuntimeErrorCode = keyof typeof runtimeErrorMessages;

/** Diagnostics use fixed messages; never retain private adapter errors or their causes. */
export class MonitorRuntimeError extends Error {
  constructor(
    readonly code: MonitorRuntimeErrorCode,
    configurationUnreadable = false,
  ) {
    super(
      code === 'configuration_changed' && configurationUnreadable
        ? '监控配置无法核验，已停止；请检查配置后重新确认来源。'
        : runtimeErrorMessages[code],
    );
    this.name = 'MonitorRuntimeError';
  }
}

export type MonitorRuntimeResult = {
  code: 'not_authorized' | 'completed_once' | 'stopped';
};

type RuntimeSignal = 'SIGINT' | 'SIGTERM';
type RuntimeEvents = {
  on(signal: RuntimeSignal, callback: () => void): unknown;
  off(signal: RuntimeSignal, callback: () => void): unknown;
};
type RuntimeTick = (
  store: MonitorStore,
  config: MonitorConfig,
  digest: string,
  key: string | undefined,
  now: Date,
  options: { signal: AbortSignal; assertActive: () => void; clock: () => Date },
) => Promise<unknown>;

type RuntimeOptions = {
  store: MonitorStore;
  file: string;
  configFile: string;
  config: MonitorConfig;
  digest: string;
  key(grant: MonitorGrant): string | undefined;
  once?: boolean;
  onReady?: () => void;
  runId?: string;
  /** Injectable boundaries keep tests isolated from process signals and real time. */
  events?: RuntimeEvents;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  tick?: RuntimeTick;
  clock?: () => Date;
};

/** Own the lock until all work has actually settled. The caller closes the database afterwards. */
export async function runMonitorRuntime(options: RuntimeOptions): Promise<MonitorRuntimeResult> {
  const { store, file, configFile, config, digest } = options;
  let lock: LocalProcessLock;
  try {
    lock = acquireMonitorStartLock(file);
  } catch {
    throw new MonitorRuntimeError('lock_unavailable');
  }
  const events = options.events ?? process;
  const wait =
    options.wait ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
  const tick: RuntimeTick = options.tick ?? monitorTick;
  const cancellation = new AbortController();
  let failure: Error | null = null;
  const stop = (error?: Error) => {
    if (cancellation.signal.aborted) return;
    failure = error ?? null;
    cancellation.abort(error ?? new Error('监控已停止'));
  };
  const halt = () => stop();
  const assertLockOwned = () => {
    try {
      lock.assertOwned();
    } catch {
      stop(new MonitorRuntimeError('lock_changed'));
    }
    cancellation.signal.throwIfAborted();
  };
  let runningIdentity: { pid: number; startedAt: string; runId: string } | undefined;
  let clockHighWater: number | undefined;
  const clock = () => {
    const value = options.clock?.() ?? new Date();
    const milliseconds = value.getTime();
    if (
      !Number.isFinite(milliseconds) ||
      (clockHighWater !== undefined && milliseconds < clockHighWater - 60000)
    ) {
      stop(new MonitorRuntimeError('clock_changed'));
      cancellation.signal.throwIfAborted();
    }
    clockHighWater = Math.max(clockHighWater ?? milliseconds, milliseconds);
    return value;
  };
  try {
    events.on('SIGINT', halt);
    events.on('SIGTERM', halt);
    assertLockOwned();
    try {
      if (hasMonitorStop(file)) stop();
    } catch {
      stop(new MonitorRuntimeError('supervision_failed'));
    }
    cancellation.signal.throwIfAborted();
    let initialGrant: MonitorGrant | null;
    try {
      initialGrant = store.get<MonitorGrant>('grant');
    } catch (error) {
      if (error instanceof StorageBudgetError) throw error;
      throw new MonitorRuntimeError('authorization_unreadable');
    }
    if (!initialGrant || initialGrant.mode === 'off') return { code: 'not_authorized' };
    const expectedAuthorization = monitorAuthority(initialGrant);
    const startedAt = clock().toISOString();
    const runId = options.runId ?? randomUUID();
    const startMs = Date.parse(startedAt);
    // Inspect persisted deadlines once on startup, rather than repeatedly reading
    // every source body during the two-second cancellation checks.
    const futureGrant = [
      initialGrant.authorizedAt,
      initialGrant.through,
      initialGrant.cycle?.through,
      initialGrant.pending?.through,
    ].some((at) => at != null && Date.parse(at) > startMs + 60000);
    const futureSource = config.sources.some((source) => {
      const state = store.get<SourceState>(`source:${digest}:${source.id}`);
      if (!state) return false;
      const interval = state.failures
        ? Math.min(
            3600000,
            Math.max(source.pollSeconds * 1000, 60000) * 2 ** Math.min(state.failures - 1, 6),
          )
        : source.pollSeconds * 1000;
      return state.nextAt > startMs + Math.max(30000, interval) + 60000;
    });
    const futureUpload =
      initialGrant.mode === 'upload' &&
      Date.parse(initialGrant.nextUploadAt) > startMs + 86400000 + 60000;
    if (futureGrant || futureSource || futureUpload) {
      stop(new MonitorRuntimeError('clock_changed'));
      cancellation.signal.throwIfAborted();
    }
    let ready = false;
    const assertActive = () => {
      cancellation.signal.throwIfAborted();
      assertLockOwned();
      clock();
      try {
        if (hasMonitorStop(file)) stop();
      } catch {
        stop(new MonitorRuntimeError('supervision_failed'));
      }
      cancellation.signal.throwIfAborted();
      let grant: MonitorGrant | null;
      try {
        grant = store.get<MonitorGrant>('grant');
        if (!grant || grant.mode === 'off') {
          stop();
        } else if (
          grant.configDigest !== digest ||
          monitorAuthority(grant) !== expectedAuthorization
        ) {
          stop(new MonitorRuntimeError('authorization_changed'));
        }
      } catch (error) {
        if (error instanceof StorageBudgetError) throw error;
        stop(new MonitorRuntimeError('authorization_unreadable'));
      }
      cancellation.signal.throwIfAborted();
      try {
        if (readMonitorConfig(configFile).digest !== digest)
          stop(new MonitorRuntimeError('configuration_changed'));
      } catch (error) {
        if (error instanceof StorageBudgetError) throw error;
        stop(new MonitorRuntimeError('configuration_changed', true));
      }
      cancellation.signal.throwIfAborted();
    };
    while (!cancellation.signal.aborted) {
      assertActive();
      assertMonitorStorageAvailable(store);
      const grant = store.get<MonitorGrant>('grant')!;
      let accessKey: string | undefined;
      try {
        accessKey = options.key(grant);
      } catch (error) {
        if (error instanceof StorageBudgetError) throw error;
        throw new MonitorRuntimeError('credentials_unavailable');
      }
      assertActive();
      store.set('running', {
        pid: process.pid,
        startedAt,
        heartbeatAt: clock().toISOString(),
        runId,
      });
      runningIdentity = { pid: process.pid, startedAt, runId };
      if (!ready) {
        ready = true;
        try {
          options.onReady?.();
        } catch {
          // Diagnostic reporting is best-effort and must not interrupt monitoring.
        }
      }
      const supervision = new AbortController();
      const supervising = (async () => {
        try {
          while (!supervision.signal.aborted && !cancellation.signal.aborted) {
            await wait(2000, supervision.signal);
            if (supervision.signal.aborted) return;
            assertActive();
          }
        } catch (error) {
          if (!supervision.signal.aborted && !cancellation.signal.aborted)
            stop(
              error instanceof StorageBudgetError
                ? error
                : new MonitorRuntimeError('supervision_failed'),
            );
        }
      })();
      try {
        await tick(store, config, digest, accessKey, clock(), {
          signal: cancellation.signal,
          assertActive,
          clock,
        });
      } finally {
        supervision.abort();
        await supervising;
      }
      assertActive();
      if (options.once) return { code: 'completed_once' };
      const now = clock().getTime();
      const due = config.sources.map(
        (source) => store.get<SourceState>(`source:${digest}:${source.id}`)?.nextAt ?? now + 60000,
      );
      await wait(
        Math.min(60000, Math.max(1000, Math.min(...due, now + 60000) - now)),
        cancellation.signal,
      );
    }
  } catch (error) {
    if (error instanceof StorageBudgetError) {
      try {
        store.set(
          'attention',
          {
            code: 'storage_full',
            reason: error.reason,
            at: new Date().toISOString(),
            message:
              '监控存储容量不足，已停止新的采集和上传。原历史与待重试批次保留；请备份后扩容或释放其他文件占用的磁盘空间，再重新启动。',
          },
          { maintenance: true },
        );
      } catch {
        // A physically full disk may not even accept this small notice. Status derives
        // storage availability independently; never turn failed persistence into success.
      }
    }
    if (failure) throw failure;
    if (!cancellation.signal.aborted) throw error;
  } finally {
    let cleanupFailed = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      try {
        events.off(signal, halt);
      } catch {
        cleanupFailed = true;
      }
    }
    // No timeout races this cleanup: even an adapter that ignores cancellation must settle first.
    try {
      if (runningIdentity) {
        lock.assertOwned();
        const current = store.get<typeof runningIdentity>('running');
        if (
          current?.pid === runningIdentity.pid &&
          current.startedAt === runningIdentity.startedAt &&
          current.runId === runningIdentity.runId
        )
          store.set('running', null, { maintenance: true });
      }
    } catch {
      cleanupFailed = true;
    } finally {
      const released = lock.release();
      if (cleanupFailed || released.cleanupWarning || !released.released) warnCleanup();
    }
  }
  return { code: 'stopped' };
}
