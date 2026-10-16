import { z } from 'zod';
import { readSessionText, writeSessionText, withSessionStorageLock } from './session-storage.js';
import {
  DAY_MS,
  RESELECT_AFTER_DAYS,
  CollectionWindowSchema,
  collectionWindow,
  type CollectionWindow,
} from '../shared/collection.js';

const CursorSchema = z
  .object({
    through: z.string().datetime(),
    uploadedAt: z.string().datetime(),
    endpoint: z.string().url(),
    contributor: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const AutomationSchema = z
  .object({
    mode: z.enum(['off', 'preview', 'upload']),
    everyHours: z.number().int().min(1).max(72),
    endpoint: z.string().url().nullable(),
    share: z.enum(['private', 'statistics', 'summary']),
    contributor: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    sourceScope: z.string().min(1).max(4096).nullable(),
    scheduleId: z.string().min(1).max(256).nullable(),
    configuredAt: z.string().datetime().nullable(),
  })
  .strict();
const SessionSchema = z
  .object({
    format: z.literal('opencost-collection-state-1'),
    introduced: z.boolean(),
    incrementalEnabled: z.boolean().nullable(),
    extendedObservations: z.boolean().default(true),
    cursor: CursorSchema.nullable(),
    automation: AutomationSchema,
    batches: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            startAt: z.string().datetime(),
            endAt: z.string().datetime(),
            total: z.number().int().positive(),
            received: z.array(z.number().int().positive()),
            endpoint: z.string().url(),
            contributor: z.string(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type CollectionSession = z.infer<typeof SessionSchema>;
export const initialSession = (): CollectionSession => ({
  format: 'opencost-collection-state-1',
  introduced: false,
  incrementalEnabled: null,
  extendedObservations: true,
  cursor: null,
  automation: {
    mode: 'off',
    everyHours: 24,
    endpoint: null,
    share: 'private',
    contributor: null,
    sourceScope: null,
    scheduleId: null,
    configuredAt: null,
  },
  batches: [],
});
export function readSession(path: string): CollectionSession {
  const text = readSessionText(path);
  return text === null ? initialSession() : SessionSchema.parse(JSON.parse(text));
}
export function saveSession(path: string, state: CollectionSession) {
  writeSessionText(path, JSON.stringify(SessionSchema.parse(state)) + '\n');
}
export function updateSession(
  path: string,
  update: (state: CollectionSession) => CollectionSession,
) {
  return withSessionStorageLock(path, (storage) => {
    const text = storage.read();
    const state = update(text === null ? initialSession() : SessionSchema.parse(JSON.parse(text)));
    storage.write(JSON.stringify(SessionSchema.parse(state)) + '\n');
    return state;
  });
}
export function nextCollection(
  state: CollectionSession,
  now = new Date(),
  endpoint?: string,
  contributor?: string,
) {
  const cursor = state.cursor;
  if (
    !cursor ||
    (endpoint && endpoint !== cursor.endpoint) ||
    (contributor && contributor !== cursor.contributor)
  )
    return { action: 'choose_range' as const, reason: 'first_run' as const, window: null };
  if (now.getTime() - Date.parse(cursor.through) > RESELECT_AFTER_DAYS * DAY_MS)
    return {
      action: 'choose_range' as const,
      reason: 'gap_over_three_days' as const,
      window: null,
    };
  if (!state.incrementalEnabled)
    return {
      action: 'choose_range' as const,
      reason: 'incremental_disabled' as const,
      window: null,
    };
  if (now.getTime() <= Date.parse(cursor.through))
    return { action: 'nothing_new' as const, reason: 'no_new_interval' as const, window: null };
  return {
    action: 'collect' as const,
    reason: 'incremental_enabled' as const,
    window: collectionWindow('incremental', now, cursor.through),
  };
}

export function assertAutomaticRun(state: CollectionSession, now = new Date()) {
  if (state.automation.mode === 'off')
    throw new Error('自动运行尚未开启；请先向用户说明并取得其选择');
  if (!state.automation.sourceScope || state.automation.contributor !== state.cursor?.contributor)
    throw new Error('自动运行的来源范围或访问凭证尚未确认，请先配置用户授权的范围');
  if (state.batches.length)
    throw new Error('还有未全部上传的批次；先用原预览重试，不能跳过失败文件重新开始自动采集');
  const plan = nextCollection(state, now, state.automation.endpoint ?? undefined);
  if (plan.action !== 'collect')
    throw new Error(
      plan.reason === 'gap_over_three_days'
        ? '间隔超过 3 天，自动运行暂停；请重新显示首次时间范围选择，默认推荐近 3 天'
        : '自动运行需要已成功上传的起点及已开启的默认增量；请先让用户选择时间范围',
    );
  return plan.window;
}
export function assertAutomaticUpload(
  state: CollectionSession,
  window: CollectionWindow,
  endpoint: string,
  contributor: string,
  share: string,
  now = new Date(),
) {
  // A retry may complete its own pending batch, but cannot skip another batch.
  const pendingOthers = state.batches.filter((batch) => batch.id !== window.batch.id);
  assertAutomaticRun({ ...state, batches: pendingOthers }, now);
  CollectionWindowSchema.parse(window);
  if (Date.parse(window.endAt) > now.getTime()) throw new Error('采集终点不能在未来');
  if (
    state.automation.mode !== 'upload' ||
    state.automation.endpoint !== endpoint ||
    state.automation.share !== share
  )
    throw new Error('自动上传未获本次目标站点与分享范围的授权');
  if (
    !state.cursor ||
    state.cursor.contributor !== contributor ||
    state.cursor.endpoint !== endpoint ||
    window.range !== 'incremental' ||
    window.startAt !== state.cursor.through
  )
    throw new Error('自动上传的凭证或增量起点发生变化，请重新选择范围');
}
export function recordSuccessfulUpload(
  state: CollectionSession,
  windowInput: CollectionWindow,
  endpoint: string,
  contributor: string,
  now = new Date(),
): CollectionSession {
  const window = CollectionWindowSchema.parse(windowInput),
    next = structuredClone(state);
  // Retrying a completed file must not recreate an unfinished multi-file batch.
  if (
    next.cursor?.endpoint === endpoint &&
    next.cursor.contributor === contributor &&
    Date.parse(window.endAt) <= Date.parse(next.cursor.through)
  )
    return next;
  const { id, part, total } = window.batch;
  let batch = next.batches.find(
    (b) => b.id === id && b.endpoint === endpoint && b.contributor === contributor,
  );
  if (
    batch &&
    (batch.startAt !== window.startAt || batch.endAt !== window.endAt || batch.total !== total)
  )
    throw new Error('同一采集批次的时间范围或总批数发生变化，不能推进上传位置');
  if (!batch) {
    batch = {
      id,
      startAt: window.startAt,
      endAt: window.endAt,
      total,
      received: [],
      endpoint,
      contributor,
    };
    next.batches.push(batch);
  }
  if (!batch.received.includes(part)) batch.received.push(part);
  if (batch.received.length === total) {
    const skipped = next.batches.some(
      (b) =>
        b !== batch &&
        b.endpoint === endpoint &&
        b.contributor === contributor &&
        Date.parse(b.endAt) <= Date.parse(window.endAt),
    );
    if (skipped) throw new Error('较早批次尚未全部成功；请先重试原预览，不能推进位置跳过失败文件');
    if (
      !next.cursor ||
      next.cursor.endpoint !== endpoint ||
      next.cursor.contributor !== contributor ||
      Date.parse(window.endAt) > Date.parse(next.cursor.through)
    )
      next.cursor = { through: window.endAt, uploadedAt: now.toISOString(), endpoint, contributor };
    next.batches = next.batches.filter((b) => b !== batch);
  }
  return next;
}
