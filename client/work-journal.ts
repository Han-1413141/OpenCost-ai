import { createHash } from 'node:crypto';
import { DailySummarySchema, type DailySummary } from '../shared/desktop-summary.js';
import { canonical } from '../shared/schema.js';
import { request, endpointOrigin, receiptFeedback } from './sdk.js';
import { z } from 'zod';
import { feedbackLink } from '../shared/feedback-link.js';
const JournalPageSchema = z
  .object({
    summaries: z.array(DailySummarySchema).max(366),
    visibility: z.literal('private'),
    ranked: z.literal(false),
    total: z.number().int().nonnegative().safe(),
    truncated: z.boolean(),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .refine(
    (page) =>
      page.total >= page.summaries.length &&
      page.truncated === (page.nextCursor !== null) &&
      (!page.truncated || page.summaries.length > 0),
    '工作日记分页状态不一致',
  );

export async function listWorkJournals(
  endpoint: string,
  accessKey: string,
  options: { limit?: number; before?: string; cursor?: string } = {},
) {
  const query = z
    .object({
      limit: z.number().int().min(1).max(366).default(100),
      before: z
        .string()
        .regex(/^20\d\d-\d\d-\d\d$/)
        .optional(),
      cursor: z.string().min(1).max(512).optional(),
    })
    .strict()
    .parse(options);
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.before !== undefined) params.set('before', query.before);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  const data = await request(
    endpointOrigin(endpoint),
    `/api/work-summaries/mine?${params}`,
    accessKey,
  );
  return JournalPageSchema.parse(data);
}

export async function uploadWorkJournal(
  endpoint: string,
  accessKey: string,
  input: DailySummary,
  options: { signal?: AbortSignal } = {},
) {
  if (input.origin !== 'real') throw new Error('该记录不能发送到正式上传接口');
  return submitJournal(endpoint, accessKey, input, options);
}
export async function uploadPresentationJournal(
  endpoint: string,
  accessKey: string,
  input: DailySummary,
  options: { signal?: AbortSignal } = {},
) {
  const origin = endpointOrigin(endpoint),
    url = new URL(origin);
  if (input.origin !== 'synthetic' || url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('预设记录只能在独立本地服务中处理');
  return submitJournal(origin, accessKey, input, options);
}
async function submitJournal(
  endpoint: string,
  accessKey: string,
  input: DailySummary,
  options: { signal?: AbortSignal },
) {
  options.signal?.throwIfAborted();
  const summary = DailySummarySchema.parse({
    ...input,
    consent: { store: true, statistics: false, publicSummary: false },
  });
  const origin = endpointOrigin(endpoint);
  const digest = createHash('sha256').update(canonical(summary)).digest('hex');
  const preview = await request(
    origin,
    '/api/work-summaries/preview',
    accessKey,
    { summary },
    undefined,
    options.signal,
  );
  if (preview.digest !== digest || preview.visibility !== 'private' || preview.ranked !== false)
    throw new Error('服务端预览不符合私有工作日记协议');
  const receipt = await request(
    origin,
    '/api/work-summaries',
    accessKey,
    { summary, reviewToken: preview.reviewToken },
    summary.id,
    options.signal,
  );
  if (
    receipt.id !== summary.id ||
    receipt.digest !== digest ||
    receipt.status !== 'stored' ||
    receipt.visibility !== 'private' ||
    receipt.ranked !== false
  )
    throw new Error('上传回执无效，保留本地记录以便使用相同 ID 重试');
  if (receipt.duplicateOf !== undefined) {
    const duplicate = z
      .object({
        existingId: z.string().uuid(),
        duplicateOf: z.string().uuid(),
        existingDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse({
        existingId: receipt.existingId,
        duplicateOf: receipt.duplicateOf,
        existingDigest: receipt.existingDigest,
      });
    if (duplicate.existingId !== duplicate.duplicateOf || duplicate.duplicateOf === summary.id)
      throw new Error('重复摘要回执无效，保留本地记录以便重试');
    // Persist the successful receipt immediately. Existing feedback can be read
    // explicitly using duplicateOf; no second request may delay this receipt.
  }
  return Object.assign(receipt, {
    feedback: receiptFeedback(receipt, 'journal'),
    existingFeedback: null,
    feedbackUrl: feedbackLink(origin, accessKey, { kind: 'journal', recordId: typeof receipt.existingId === 'string' ? receipt.existingId : summary.id }),
  });
}
