import { z } from 'zod';
import {
  QuotaObservationImportSchema,
  quotaObservationImportLimits,
} from './quota-observation-import-schema.js';

import {
  monitorHistoryExportNotice,
  monitorHistoryExportDiagnostics,
} from './monitor-history-export-text.js';
export {
  monitorHistoryExportNotice,
  monitorHistoryExportDiagnostics,
} from './monitor-history-export-text.js';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const MonitorHistoryExportSchema = z
  .object({
    format: z.literal('opencost-monitor-history-export-1'),
    status: z.enum([
      'disabled',
      'complete',
      'empty',
      'incomplete',
      'conflict',
      'capacity',
      'unavailable',
    ]),
    selection: z
      .object({
        subscriptionRef: z.string().uuid(),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    snapshot: z.object({ readAt: z.string().datetime(), maxSequence: count }).strict().nullable(),
    counts: z
      .object({
        matchedRows: count.max(quotaObservationImportLimits.observations + 1),
        matchedRowsIsLowerBound: z.boolean(),
        bodyBytes: count.nullable(),
      })
      .strict(),
    storedSelectionComplete: z.boolean(),
    diagnostics: z
      .array(
        z.enum(
          Object.keys(monitorHistoryExportDiagnostics) as [
            keyof typeof monitorHistoryExportDiagnostics,
            ...Array<keyof typeof monitorHistoryExportDiagnostics>,
          ],
        ),
      )
      .max(16),
    input: QuotaObservationImportSchema.nullable(),
    notice: z.literal(monitorHistoryExportNotice),
  })
  .strict()
  .superRefine((report, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: '导出状态、范围和观察不一致' });
    if (report.status === 'complete') {
      if (
        !report.input ||
        !report.selection ||
        !report.snapshot ||
        !report.storedSelectionComplete ||
        report.counts.matchedRowsIsLowerBound ||
        report.counts.matchedRows !== report.input.observations.length ||
        report.input.subscriptionRef !== report.selection.subscriptionRef ||
        report.input.window.startAt !== report.selection.startAt ||
        report.input.window.endAt !== report.selection.endAt
      )
        fail();
    } else if (report.input || (report.storedSelectionComplete && report.status !== 'empty'))
      fail();
    if (
      report.status === 'empty' &&
      (report.counts.matchedRows !== 0 || report.counts.matchedRowsIsLowerBound)
    )
      fail();
  });
export type MonitorHistoryExport = z.infer<typeof MonitorHistoryExportSchema>;
export type MonitorHistoryExportPreview = Omit<MonitorHistoryExport, 'input'>;
export const monitorHistoryExportPreview = ({
  input: _input,
  ...preview
}: MonitorHistoryExport): MonitorHistoryExportPreview => preview;
