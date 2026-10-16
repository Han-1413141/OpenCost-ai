import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { SubscriptionSnapshotSchema } from '../shared/subscriptions.js';
import { endpointOrigin } from './sdk.js';
import { hash } from './subscriptions.js';
import { readLocalTextSync } from './local-file.js';

const common = {
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  pollSeconds: z.number().int().min(60).max(86400).default(300),
  resetProbe: z.boolean().default(true),
};
const pointer = z
  .string()
  .regex(/^(\/[^\s]*)?$/)
  .max(512)
  .refine(
    (v) => !v.split('/').some((p) => ['__proto__', 'prototype', 'constructor'].includes(p)),
    '不允许原型字段',
  );
export const MonitorConfigSchema = z
  .object({
    format: z.literal('opencost-monitor-1'),
    sources: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              ...common,
              kind: z.literal('file'),
              path: z.string().min(1),
              subscriptionRef: z.string().uuid(),
            })
            .strict(),
          z
            .object({
              ...common,
              kind: z.literal('http'),
              url: z.string().url(),
              auth: z
                .object({
                  env: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/),
                  header: z.enum(['Authorization', 'x-api-key', 'api-key']),
                  scheme: z.enum(['Bearer', 'raw']),
                  origin: z.string().url(),
                })
                .strict()
                .nullable(),
              template: SubscriptionSnapshotSchema,
              mapping: z
                .array(z.object({ from: pointer, to: pointer }).strict())
                .min(1)
                .max(300),
            })
            .strict(),
        ]),
      )
      .max(20),
    workOutbox: z.string().min(1).nullable().default(null),
    collectionState: z.string().min(1).default('.local/collection-state.json'),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (new Set(config.sources.map((s) => s.id)).size !== config.sources.length)
      ctx.addIssue({ code: 'custom', message: '来源 id 不能重复' });
    const refs = config.sources.map((s) =>
      s.kind === 'file' ? s.subscriptionRef : s.template.subscriptionRef,
    );
    if (new Set(refs).size !== refs.length)
      ctx.addIssue({ code: 'custom', message: '同一订阅只选一个权威来源，避免共享额度重复记录' });
    for (const source of config.sources)
      if (source.kind === 'http') {
        const url = new URL(source.url);
        try {
          endpointOrigin(url.origin);
        } catch {
          ctx.addIssue({ code: 'custom', message: '额度 API 必须使用 HTTPS 或本机 HTTP' });
        }
        if (
          url.username ||
          url.password ||
          url.hash ||
          (source.auth && source.auth.origin !== url.origin)
        )
          ctx.addIssue({
            code: 'custom',
            message: 'API 凭据来源须绑定准确 Origin，不允许 URL 内嵌凭据和重定向',
          });
        for (const map of source.mapping)
          if (
            !/^\/(pools\/\d+\/(capacity\/|used$|remaining$|percent|precision$|window\/|resetObserved$|ledger|expiresAt$|policyVersion$)|observedAt$|freshness$|cycleStartsAt$|cycleEndsAt$|priceMinor$|currency$|priceBasis$|seats$|status$|autoRenew$)/.test(
              map.to,
            )
          )
            ctx.addIssue({
              code: 'custom',
              message: '映射只允许额度和订阅状态字段；产品名称、随机标识由本地配置确定',
            });
      }
  });
export type MonitorConfig = z.infer<typeof MonitorConfigSchema>;
export type MonitorSource = MonitorConfig['sources'][number];
export function readMonitorConfig(file: string) {
  file = resolve(file);
  const raw = MonitorConfigSchema.parse(JSON.parse(readLocalTextSync(file, 1024 * 1024)));
  const config = structuredClone(raw),
    base = dirname(file);
  for (const source of config.sources)
    if (source.kind === 'file') source.path = resolve(base, source.path);
  if (config.workOutbox) config.workOutbox = resolve(base, config.workOutbox);
  config.collectionState = resolve(base, config.collectionState);
  return { config, digest: hash(config) };
}
export function jsonPointer(value: unknown, pointer: string): unknown {
  for (const key of pointer
    .split('/')
    .slice(1)
    .map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !value ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key)
    )
      throw new Error('供应商字段缺失，不能用零代替');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function setPointer(target: unknown, pointer: string, value: unknown) {
  const keys = pointer.split('/').slice(1),
    key = keys.pop()!;
  if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('不允许原型字段');
  const parent = jsonPointer(target, keys.length ? '/' + keys.join('/') : '');
  if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key))
    throw new Error('映射目标必须先存在于结构模板中');
  (parent as Record<string, unknown>)[key] = value;
}
