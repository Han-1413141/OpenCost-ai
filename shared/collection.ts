import { z } from 'zod';

export const DAY_MS = 86400000;
export const RESELECT_AFTER_DAYS = 3;
export const MAX_HISTORY_DAYS = 90;
export const rangeDays = { '1d': 1, '3d': 3, '7d': 7, '30d': 30, '90d': 90 } as const;
export const rangeLabels = {
  '1d': '近 24 小时',
  '3d': '近 3 天（推荐）',
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '历史数据（最多近 90 天）',
  incremental: '上次成功上传后的增量',
} as const;
export type CollectionRange = keyof typeof rangeLabels;

export const CollectionWindowSchema = z
  .object({
    range: z.enum(['1d', '3d', '7d', '30d', '90d', 'incremental']),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    timeZone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('zh-CN', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, '需要有效的时区'),
    // All slices in one selected interval must succeed before its cursor advances.
    batch: z
      .object({
        id: z.string().uuid(),
        part: z.number().int().min(1),
        total: z.number().int().min(1).max(1000),
      })
      .strict(),
  })
  .strict()
  .superRefine((window, ctx) => {
    const length = Date.parse(window.endAt) - Date.parse(window.startAt);
    const expected = window.range === 'incremental' ? null : rangeDays[window.range] * DAY_MS;
    if (
      length <= 0 ||
      length > MAX_HISTORY_DAYS * DAY_MS ||
      (expected !== null && length !== expected)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['startAt'],
        message: '范围须为所选的滚动时段，最多 90 天，起点早于终点',
      });
    if (window.range === 'incremental' && length > RESELECT_AFTER_DAYS * DAY_MS)
      ctx.addIssue({
        code: 'custom',
        path: ['range'],
        message: '间隔超过 3 天，请重新显示时间范围选择，不自动补传',
      });
    if (window.batch.part > window.batch.total)
      ctx.addIssue({ code: 'custom', path: ['batch'], message: '分批序号不能超过总批数' });
  });
export type CollectionWindow = z.infer<typeof CollectionWindowSchema>;

export function collectionWindow(
  range: CollectionRange,
  now = new Date(),
  since?: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): CollectionWindow {
  if (range === 'incremental' && !since) throw new Error('首次运行需要选择时间范围');
  return CollectionWindowSchema.parse({
    range,
    startAt:
      range === 'incremental'
        ? since
        : new Date(now.getTime() - rangeDays[range] * DAY_MS).toISOString(),
    endAt: now.toISOString(),
    timeZone,
    batch: { id: globalThis.crypto.randomUUID(), part: 1, total: 1 },
  });
}

export function describeWindow(window: CollectionWindow) {
  const format = new Intl.DateTimeFormat('zh-CN', {
    timeZone: window.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  });
  return `${rangeLabels[window.range]}：${format.format(new Date(window.startAt))} 至 ${format.format(new Date(window.endAt))}（${window.timeZone}，起点包含、终点不含）`;
}
export const largeRangeNotice =
  '范围超过 3 天：任务较多时，本地 AI 分类和整理可能消耗较多 Token 或订阅额度。先用程序统计数量和体积，优先使用已有结构字段；无法准确估算时明确说明，不编造费用。服务端费用计算不调用大模型。';
