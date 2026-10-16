import { z } from 'zod';
import {
  CodeMeasurementLanguageGroupSchema,
  codeSetExclusionReasons,
} from './code-measurement-set-schema.js';
import {
  PythonCodeMeasurementSchema,
  pythonMeasurementReasons,
} from './python-code-measurement-schema.js';
import { PatchMeasurementReportSchema, PatchMetricsSchema } from './patch-measurement-schema.js';

export const CODE_OBSERVATION_LIMITS = Object.freeze({
  tasks: 100,
  reports: 256,
  snapshotsPerTask: 8,
  patchesPerTask: 4,
  localBytes: 4194304,
  manifestBytes: 65536,
});
const count = z.number().int().safe().nonnegative();
const scope = z
  .object({
    declared: z.enum(['complete', 'partial', 'unknown']),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    selectedEntries: count.min(1).max(64),
    measuredFiles: count.max(64),
    duplicateEntries: count.max(64),
    unavailableEntries: count.max(64),
  })
  .strict();
const stage = z.enum(['before_execution', 'during_execution', 'after_execution', 'unknown']);
const status = z.enum(['measured', 'partial', 'unavailable']);
const source = z.literal('unverified_client_program_report');
function scopeValid(s: z.infer<typeof scope>) {
  return (
    s.measuredFiles + s.duplicateEntries + s.unavailableEntries === s.selectedEntries &&
    s.coverage ===
      (s.measuredFiles === 0 ? 'unknown' : s.unavailableEntries > 0 ? 'partial' : s.declared)
  );
}
const JsSnapshotSchema = z
  .object({
    kind: z.literal('js_ts_snapshot'),
    sourceVersion: z.literal('code-measurement-set-1'),
    source,
    stage,
    status,
    scope,
    excluded: z
      .object(Object.fromEntries(codeSetExclusionReasons.map((k) => [k, count.max(64)])))
      .strict(),
    languageGroups: z.array(CodeMeasurementLanguageGroupSchema).max(4),
  })
  .strict()
  .superRefine((v, ctx) => {
    const s = v.scope,
      expected =
        s.measuredFiles === 0 ? 'unavailable' : s.unavailableEntries > 0 ? 'partial' : 'measured';
    if (
      !scopeValid(s) ||
      v.status !== expected ||
      v.excluded.duplicate_file !== s.duplicateEntries ||
      Object.entries(v.excluded)
        .filter(([k]) => k !== 'duplicate_file')
        .reduce((n, [, x]) => n + x, 0) !== s.unavailableEntries ||
      v.languageGroups.reduce((n, g) => n + g.files, 0) !== s.measuredFiles ||
      v.languageGroups.reduce((n, g) => n + g.sourceBytes, 0) > 8388608 ||
      new Set(v.languageGroups.map((g) => g.language)).size !== v.languageGroups.length
    )
      ctx.addIssue({ code: 'custom', message: 'JS/TS上传观察数量或覆盖不一致' });
  });
const PythonSnapshotSchema = z
  .object({
    kind: z.literal('python_snapshot'),
    sourceVersion: z.literal('python-code-measurement-1'),
    source,
    stage,
    status,
    algorithm: PythonCodeMeasurementSchema.shape.algorithm,
    parser: PythonCodeMeasurementSchema.shape.parser,
    reason: PythonCodeMeasurementSchema.shape.reason,
    scope: scope.nullable(),
    excluded: z
      .object(Object.fromEntries(pythonMeasurementReasons.map((k) => [k, count.max(64)])))
      .strict()
      .nullable(),
    metrics: PythonCodeMeasurementSchema.shape.metrics,
  })
  .strict()
  .superRefine((v, ctx) => {
    const active = v.status === 'measured' || v.status === 'partial';
    const fail = () => ctx.addIssue({ code: 'custom', message: 'Python上传观察状态或数量不一致' });
    if (
      active !== (v.reason === 'none') ||
      v.reason === 'not_enabled' ||
      (v.scope && !scopeValid(v.scope))
    )
      fail();
    if (active) {
      if (
        !v.metrics ||
        !v.scope ||
        !v.excluded ||
        !v.parser.pythonVersion ||
        !v.scope.measuredFiles
      ) {
        fail();
        return;
      }
      if (
        (v.status === 'measured') !== (v.scope.unavailableEntries === 0) ||
        v.excluded.duplicate_file !== v.scope.duplicateEntries ||
        Object.entries(v.excluded)
          .filter(([k]) => k !== 'duplicate_file')
          .reduce((n, [, x]) => n + x, 0) !== v.scope.unavailableEntries
      )
        fail();
    } else if (v.metrics !== null) fail();
  });
export const CodeSnapshotObservationSchema = z.discriminatedUnion('kind', [
  JsSnapshotSchema,
  PythonSnapshotSchema,
]);
export const PatchObservationSchema = z
  .object({
    kind: z.literal('patch'),
    sourceVersion: z.literal('patch-measurement-1'),
    source,
    algorithm: PatchMeasurementReportSchema.shape.algorithm,
    parser: PatchMeasurementReportSchema.shape.parser,
    status,
    reason: PatchMeasurementReportSchema.shape.reason,
    stage: PatchMeasurementReportSchema.shape.stage,
    format: PatchMeasurementReportSchema.shape.format,
    scope: PatchMeasurementReportSchema.shape.scope,
    generation: PatchMeasurementReportSchema.shape.generation,
    metrics: PatchMetricsSchema.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const active = v.status === 'measured' || v.status === 'partial';
    const fail = () => ctx.addIssue({ code: 'custom', message: '补丁上传观察状态不一致' });
    if (active !== (v.reason === 'none') || v.reason === 'not_enabled') fail();
    if (active) {
      if (!v.metrics || !v.scope || !v.generation || v.format === 'unknown') {
        fail();
        return;
      }
      if (
        (v.status === 'partial') !== v.metrics.unmeasuredContentFiles > 0 ||
        v.scope.coverage !==
          (v.metrics.unmeasuredContentFiles > 0 ? 'partial' : v.scope.declared) ||
        (v.format === 'empty') !== (v.metrics.totalFiles === 0)
      )
        fail();
    } else if (v.metrics !== null || (v.scope && v.scope.coverage !== 'unknown')) fail();
  });
// Version 1 is for private feedback only. Statistics consent does not publish these fields.
export const CodeMeasurementObservationsSchema = z
  .object({
    version: z.literal('code-measurement-observations-1'),
    binding: z.literal('user_declared_task_and_requirement'),
    inference: z.literal('descriptive_only'),
    snapshots: z.array(CodeSnapshotObservationSchema).max(8),
    patches: z.array(PatchObservationSchema).max(4),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.snapshots.length && !v.patches.length)
      ctx.addIssue({ code: 'custom', message: '没有代码报告时省略该字段，不能伪装成测得零工作' });
    if (
      new Set(v.snapshots.map((s) => `${s.kind}:${s.stage}`)).size !== v.snapshots.length ||
      new Set(v.patches.map((p) => p.stage)).size !== v.patches.length
    )
      ctx.addIssue({
        code: 'custom',
        message: '同一要求、测量族和阶段只选择一份代码报告，不累加重复快照',
      });
  });
export type CodeSnapshotObservation = z.infer<typeof CodeSnapshotObservationSchema>;
export type PatchObservation = z.infer<typeof PatchObservationSchema>;
export type CodeMeasurementObservations = z.infer<typeof CodeMeasurementObservationsSchema>;
