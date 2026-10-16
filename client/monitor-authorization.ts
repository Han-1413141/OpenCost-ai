import { randomUUID } from 'node:crypto';
import { type CollectionWindow } from '../shared/collection.js';
import { MonitorStore, type MonitorGrant, type SourceState } from './monitor-store.js';

type AuthorizationOptions = {
  mode: 'local' | 'upload';
  incrementalEnabled: boolean;
  configDigest: string;
  endpoint: string | null;
  contributor: string | null;
  window: CollectionWindow;
  sourceIds?: readonly string[];
};

export function grantMonitorAuthorization(store: MonitorStore, options: AuthorizationOptions) {
  // Identity-file creation and config reads belong to the caller, before this lock.
  // Pending batches and receipt state must be read only after BEGIN IMMEDIATE.
  return store.atomic(() => {
    const old = store.get<MonitorGrant>('grant');
    if (
      old?.pending &&
      (old.configDigest !== options.configDigest ||
        old.endpoint !== options.endpoint ||
        old.contributor !== options.contributor ||
        old.pending.draft.envelope.snapshots.some((snapshot) => {
          const at = Date.parse(snapshot.observedAt);
          return (
            !Number.isFinite(at) ||
            at < Date.parse(options.window.startAt) ||
            at >= Date.parse(options.window.endAt)
          );
        }))
    )
      throw new Error(
        '存在待重试批次；请保留相同来源、身份和目标，并选择包含该批次的范围后继续。旧批次不会被丢弃。',
      );
    if (!store.get('installationRef')) store.set('installationRef', randomUUID());
    const now = new Date().toISOString();
    const grant: MonitorGrant = {
      mode: options.mode,
      incrementalEnabled: options.incrementalEnabled,
      configDigest: options.configDigest,
      endpoint: options.endpoint,
      contributor: options.contributor,
      since: options.window.startAt,
      authorizedAt: now,
      authorizationId: randomUUID(),
      through: null,
      lastUploadAt: old?.lastUploadAt ?? null,
      nextUploadAt: now,
      pending: old?.pending ?? null,
    };
    store.set('grant', grant);
    // Explicitly selecting a new range also restarts the chosen polling schedule.
    // This recovers future deadlines after clock correction without editing history.
    for (const id of options.sourceIds ?? []) {
      const key = `source:${options.configDigest}:${id}`;
      const state = store.get<SourceState>(key);
      if (state) store.set(key, { ...state, nextAt: Date.parse(now) });
    }
    store.set('attention', null);
    store.audit('authorization', {
      mode: options.mode,
      configDigest: options.configDigest,
      range: options.window.range,
      incrementalEnabled: options.incrementalEnabled,
    });
    return grant;
  });
}

export function revokeMonitorAuthorization(store: MonitorStore) {
  return store.atomic(
    () => {
      // Preserve even partial legacy grants and every field advanced by a receipt.
      const latest = store.get<MonitorGrant>('grant');
      if (!latest || latest.mode === 'off') return latest;
      const disabled = { ...latest, mode: 'off' as const };
      store.set('grant', disabled);
      return disabled;
    },
    { maintenance: true },
  );
}
