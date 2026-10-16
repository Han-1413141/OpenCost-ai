import { createHash, randomUUID } from 'node:crypto';
import { canonical, EnvelopeSchema, type Envelope } from '../shared/schema.js';
import { ContributionDetailSchema } from '../shared/contribution-history.js';
import { validateSettlementReplacement } from '../shared/settlement-revision.js';

const digest = (envelope: Envelope) =>
  createHash('sha256').update(canonical(envelope)).digest('hex');

/** Explicit local preparation only. No identity lookup, source scan, request or upload. */
export function startSettlement(input: unknown): Envelope {
  const envelope = EnvelopeSchema.parse(input);
  if (envelope.settlement)
    throw new Error('记录已有修订声明，请保留原版本并使用有效父回执准备下一份。');
  return EnvelopeSchema.parse({
    ...envelope,
    settlement: {
      version: 'settlement-revision-1',
      scope: 'whole_record_snapshot',
      revision: 0,
      replaces: null,
      requirements: envelope.tasks.map((t) => ({
        taskId: t.id,
        requirementRef: randomUUID(),
        revision: 0,
      })),
    },
  });
}

export function reviseSettlement(previous: unknown, input: unknown): Envelope {
  const { record } = ContributionDetailSchema.parse(previous);
  if (digest(record.envelope) !== record.digest)
    throw new Error('父记录正文与回执摘要不一致，请重新读取修订依据。');
  if (record.settlement && record.settlement.state !== 'active')
    throw new Error('父回执不是已确认的当前版本，请刷新记录后使用当前有效回执。');
  if (record.envelope.settlement && !record.settlement)
    throw new Error('父记录缺少服务端接收的修订状态，不能仅信任本地声明。');
  const next = EnvelopeSchema.parse(input);
  const requirements =
    record.envelope.settlement?.requirements ??
    record.envelope.tasks.map((t) => ({
      taskId: t.id,
      requirementRef: randomUUID(),
      revision: 0,
    }));
  const result = EnvelopeSchema.parse({
    ...next,
    settlement: {
      version: 'settlement-revision-1',
      scope: 'whole_record_snapshot',
      revision: (record.envelope.settlement?.revision ?? 0) + 1,
      replaces: {
        recordId: record.id,
        digest: record.digest,
        revision: record.envelope.settlement?.revision ?? 0,
      },
      requirements,
    },
  });
  if (
    validateSettlementReplacement(
      { id: record.id, owner: 'local', envelope: record.envelope, digest: record.digest },
      { owner: 'local', envelope: result },
    )
  )
    throw new Error(
      '替代需要同一账期、全部根目标及原要求版本；费用、用量、结果可修正，要求变化须另行处理。',
    );
  return result;
}
