import { DailySummarySchema, type DailySummary } from './desktop-summary.js';
import { JournalAnalysisAttachmentSchema } from './journal-analysis-schema.js';
import { canonical } from './schema.js';

/** An attachment targets exactly one existing task; all historical revisions survive. */
export function attachJournalAnalysis(
  summary: DailySummary,
  input: unknown,
  nextId: string,
  revision: number,
  createdAt: string,
) {
  const attachment = JournalAnalysisAttachmentSchema.parse(input);
  if (attachment.target.summaryId !== summary.id)
    throw new Error('分析属于另一份日记，请选择原日记后重新导入');
  const refs = [...attachment.target.sourceRefs].sort();
  const targets = summary.tasks.filter(
    (t) => canonical([...t.sourceRefs].sort()) === canonical(refs),
  );
  if (targets.length !== 1) throw new Error('分析来源必须完整对应日记中的一个工作条目');
  if (targets[0].workType !== attachment.analysis.workType)
    throw new Error('分析的工作类型与所选条目不同');
  if (canonical(targets[0].analysis ?? null) === canonical(attachment.analysis)) return summary;
  return DailySummarySchema.parse({
    ...summary,
    id: nextId,
    revision,
    createdAt,
    consent: { store: false, statistics: false, publicSummary: false },
    tasks: summary.tasks.map((t) =>
      t === targets[0] ? { ...t, analysis: attachment.analysis } : t,
    ),
  });
}
