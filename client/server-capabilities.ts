import { z } from 'zod';
import { endpointOrigin, responseJson } from './sdk.js';
import { uploadProtocol } from '../shared/upload-protocol.js';

const Capabilities = z.object({
  format: z.literal(uploadProtocol.format),
  protocolRevision: z.string().max(80),
  maxRequestBytes: z.number().int().positive(),
  contribution: z.object({
    schemaVersion: z.string(),
    schema: z.literal(uploadProtocol.contribution.schema),
    preview: z.literal(uploadProtocol.contribution.preview),
    submit: z.literal(uploadProtocol.contribution.submit),
    unknownBilling: z.boolean(),
    nullableAmounts: z.boolean(),
  }),
  journal: z.object({
    format: z.string(),
    schema: z.literal(uploadProtocol.journal.schema),
    preview: z.literal(uploadProtocol.journal.preview),
    submit: z.literal(uploadProtocol.journal.submit),
    adapterRequired: z.boolean(),
  }),
});

/** Public GET only: never loads history, credentials, or submits a record. */
export async function checkServer(endpoint: string) {
  const origin = endpointOrigin(endpoint);
  const checkedAt = new Date().toISOString();
  const signal = AbortSignal.timeout(15000);
  const response = await fetch(`${origin}/api/capabilities`, {
    headers: { 'User-Agent': 'OpenCost/0.1 (+https://opencost-ai.com)', 'Cache-Control': 'no-cache' },
    redirect: 'error', signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status === 404 ? 'upgrade_required' : 'unavailable',
      endpoint: origin, checkedAt, httpStatus: response.status,
      nextStep: '保留本地摘要；检查站点版本。不要用零替代未知金额，也不要重复提交。',
      documentation: `${origin}/api/schema`, uploaded: false };
  }
  const parsed = Capabilities.safeParse(await responseJson(response, signal));
  if (!parsed.success)
    return { status: 'incompatible', endpoint: origin, checkedAt, uploaded: false,
      nextStep: '站点接口声明无法识别；保留本地摘要并更新工具包或站点。' };
  const contribution = parsed.data.contribution.schemaVersion === uploadProtocol.contribution.schemaVersion
    && parsed.data.contribution.unknownBilling && parsed.data.contribution.nullableAmounts;
  const journal = parsed.data.journal.format === uploadProtocol.journal.format && !parsed.data.journal.adapterRequired;
  return { status: contribution && journal ? 'compatible' : 'incompatible', endpoint: origin,
    checkedAt, protocolRevision: parsed.data.protocolRevision,
    contributionSupported: contribution, journalSupported: journal,
    interfaces: parsed.data, uploaded: false,
    nextStep: contribution && journal
      ? '贡献事实齐全用 capture；缺少验收或尝试记录用私有工作日记。完成本地预览后确认上传。'
      : '仅使用站点明确支持的记录形式；保留其余本地草稿，升级后继续原批次。' };
}
