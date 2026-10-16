import { resolve, dirname } from 'node:path';
import { readLocalTextSync } from './local-file.js';
import { DailySummarySchema } from '../shared/desktop-summary.js';
import { JOURNAL_ANALYSIS_LIMITS } from '../shared/journal-analysis-schema.js';
import { JournalAnalysisInputSchema } from '../shared/journal-analysis.js';
import { parseCodeMeasurementReport } from '../shared/code-measurement-import.js';

/** Explicit paths only. No repository discovery, source reads, model call or upload. */
export function loadJournalAnalysisInput(options: {
  summary: string;
  sourceRef: string;
  task?: string;
  revision?: string;
  reports?: string;
  domainReview?: string;
  graph?: string;
}) {
  let bytes = 0;
  const read = (path: string, max = JOURNAL_ANALYSIS_LIMITS.inputBytes) => {
    const text = readLocalTextSync(
      resolve(path),
      Math.min(max, JOURNAL_ANALYSIS_LIMITS.inputBytes - bytes),
    );
    bytes += Buffer.byteLength(text, 'utf8');
    return JSON.parse(text);
  };
  const summary = DailySummarySchema.parse(read(options.summary));
  const targets = summary.tasks.filter((t) => t.sourceRefs.includes(options.sourceRef));
  if (targets.length !== 1) throw new Error('匿名来源必须对应所选日记中的一个工作条目');
  const reports: unknown[] = [];
  if (options.reports) {
    const list = read(options.reports, 64 * 1024);
    if (
      !Array.isArray(list) ||
      !list.length ||
      list.length > 12 ||
      list.some((p) => typeof p !== 'string' || !p.length)
    )
      throw new Error('报告清单需要1至12个本地数值报告路径');
    for (const path of list)
      reports.push(read(resolve(dirname(resolve(options.reports)), path), 256 * 1024));
  }
  const first = reports.length ? parseCodeMeasurementReport(reports[0]) : null;
  const revision =
    options.revision ?? (first && first.status !== 'disabled' ? first.requirementRevision : null);
  return JournalAnalysisInputSchema.parse({
    format: 'journal-analysis-input-1',
    target: { summaryId: summary.id, sourceRefs: targets[0].sourceRefs },
    workType: targets[0].workType,
    ...(options.task ? { task: read(options.task) } : {}),
    requirementRevision: revision,
    reports,
    ...(options.domainReview ? { domainReview: read(options.domainReview) } : {}),
    ...(options.graph ? { dependencyGraph: read(options.graph) } : {}),
  });
}
