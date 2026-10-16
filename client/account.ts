import { z } from 'zod';
import { accountConnectLink } from '../shared/feedback-link.js';
import { contributorId, endpointOrigin, request } from './sdk.js';

/** Only app-managed credentials for this exact origin are sent, after a user requests connection. */
export async function connectAccount(endpoint: string, accessKeys: string[]) {
  const origin = endpointOrigin(endpoint), keys = [...new Set(accessKeys)];
  if (!keys.length || keys.length > 20) throw new Error('每次关联需要 1 至 20 个本机凭证');
  for (const key of keys) contributorId(key);
  const result = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.string().datetime(), identities: z.number().int().min(1).max(20) })
    .parse(await request(origin, '/api/auth/connect', keys[0], { accessKeys: keys.slice(1) }));
  return { url: accountConnectLink(origin, result.token), expiresAt: result.expiresAt, identities: result.identities };
}
export async function accountConnection(endpoint: string, accessKey: string) {
  contributorId(accessKey);
  return z.object({ linked: z.boolean(), login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).nullable() })
    .parse(await request(endpointOrigin(endpoint), '/api/auth/connection', accessKey));
}
