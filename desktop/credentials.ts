import { z } from 'zod';
import { readLocalText } from '../client/local-file.js';
import { contributorId, endpointOrigin } from '../client/sdk.js';

export async function readAccessCredential(path: string, endpoint: string) {
  const credential = z
    .object({
      format: z.literal('opencost-access-1'),
      origin: z.string().max(2048).optional(),
      endpoint: z.string().max(2048).optional(),
      accessKey: z.string().max(500),
    })
    .passthrough()
    .parse(JSON.parse(await readLocalText(path, 50000)));
  const origin = endpointOrigin(credential.origin ?? credential.endpoint ?? '');
  if (origin !== endpoint) throw new Error('凭证站点与当前设置不同，请先保存正确的站点');
  contributorId(credential.accessKey);
  return { origin, accessKey: credential.accessKey };
}
