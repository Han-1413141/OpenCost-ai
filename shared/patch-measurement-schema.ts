import { z } from 'zod';
import { CodeDistributionSchema } from './code-measurement-set-schema.js';

export const PATCH_MEASUREMENT_LIMITS = Object.freeze({
  inputBytes: 4194304,
  manifestBytes: 65536,
  lines: 100000,
  lineBytes: 262144,
  files: 64,
  hunks: 4096,
  changedLines: 100000,
  coordinate: 1000000000,
});
export const patchRoles = [
  'implementation',
  'test',
  'documentation',
  'configuration',
  'data',
  'other',
  'unknown',
] as const;
export const patchFlags = ['yes', 'no', 'unknown'] as const;
export const patchKinds = [
  'added',
  'deleted',
  'renamed',
  'copied',
  'modified',
  'metadata_only',
] as const;
const count = z.number().int().safe().nonnegative();
const fileCount = count.max(64);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => !v.includes('\0'));
const fixed = (values: Record<string, string | number>) =>
  z.object(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, z.literal(v)]))).strict();
export const PatchMeasurementManifestSchema = z
  .object({
    version: z.literal('patch-measurement-manifest-1'),
    requirementRevision: z.uuid(),
    stage: z.enum(['proposed', 'during_execution', 'after_execution', 'unknown']),
    scope: z.enum(['complete', 'partial', 'unknown']),
    patchFile: path,
    generation: z
      .object({
        contextLines: count.max(10000).nullable(),
        algorithm: z.enum(['myers', 'minimal', 'patience', 'histogram', 'unknown']),
        whitespaceIgnored: z.enum(['none', 'some', 'unknown']),
        renameDetection: z.enum(['enabled', 'disabled', 'unknown']),
      })
      .strict(),
    classifications: z
      .array(
        z
          .object({
            path,
            role: z.enum(patchRoles),
            generated: z.enum(patchFlags),
            formattingOnly: z.enum(patchFlags),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.classifications.map((c) => c.path)).size !== v.classifications.length)
      ctx.addIssue({ code: 'custom', message: '补丁用途声明重复' });
  });
export type PatchMeasurementManifest = z.infer<typeof PatchMeasurementManifestSchema>;
const BucketSchema = z
  .object({
    files: fileCount,
    knownTextFiles: fileCount,
    unmeasuredFiles: fileCount,
    addedLines: count.max(100000),
    deletedLines: count.max(100000),
    changedLineEntries: count.max(100000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.knownTextFiles + v.unmeasuredFiles !== v.files ||
      v.changedLineEntries !== v.addedLines + v.deletedLines
    )
      ctx.addIssue({ code: 'custom', message: '补丁分类数量不守恒' });
  });
type Bucket = z.infer<typeof BucketSchema>;
export const patchMetricRules = {
  changes: 'added_plus_deleted_line_entries_not_unique_semantic_changes',
  runs: 'maximal_adjacent_added_deleted_lines_within_each_hunk_context_separates',
  whitespace:
    'per_run_removed_and_added_text_equal_after_ascii_space_tab_cr_lf_removal_not_semantic_equivalence',
  quantiles: 'hyndman_fan_type_7_across_known_text_files_including_known_zero',
  dispersion: 'sum_squared_known_text_change_shares_and_reciprocal_no_domain_thresholds',
  classification: 'user_declaration_exact_selected_patch_path_only',
  sourceVerification: 'not_verified_against_source_or_applied',
} as const;
export const PatchMetricsSchema = z
  .object({
    totalFiles: fileCount,
    knownTextFiles: fileCount,
    binaryFiles: fileCount,
    unmeasuredContentFiles: fileCount,
    filesWithTextChanges: fileCount,
    knownFilesWithoutTextChanges: fileCount,
    modeChanges: fileCount,
    specialModeEntries: fileCount,
    fileKinds: z.object(Object.fromEntries(patchKinds.map((k) => [k, fileCount]))).strict(),
    addedLines: count.max(100000),
    deletedLines: count.max(100000),
    changedLineEntries: count.max(100000),
    netLineChange: z.number().int().min(-100000).max(100000),
    contextLines: count.max(100000),
    hunks: count.max(4096),
    editRuns: count.max(100000),
    asciiWhitespaceEquivalentRuns: count.max(100000),
    blankAddedLines: count.max(100000),
    blankDeletedLines: count.max(100000),
    fileDistributions: z
      .object({
        addedLines: CodeDistributionSchema,
        deletedLines: CodeDistributionSchema,
        changedLineEntries: CodeDistributionSchema,
        hunks: CodeDistributionSchema,
        editRuns: CodeDistributionSchema,
      })
      .strict(),
    dispersion: z
      .object({
        basis: z.literal('known_text_changed_line_entries'),
        largestFileShare: z.number().min(0).max(1).nullable(),
        concentration: z.number().min(0).max(1).nullable(),
        effectiveFileCount: z.number().min(1).max(64).nullable(),
      })
      .strict(),
    classifications: z
      .object({
        basis: z.literal('user_declaration'),
        mappedFiles: fileCount,
        unmappedFiles: fileCount,
        byRole: z.object(Object.fromEntries(patchRoles.map((k) => [k, BucketSchema]))).strict(),
        generated: z.object(Object.fromEntries(patchFlags.map((k) => [k, BucketSchema]))).strict(),
        formattingOnly: z
          .object(Object.fromEntries(patchFlags.map((k) => [k, BucketSchema])))
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: '补丁数量、分布或覆盖不一致' });
    if (
      v.knownTextFiles + v.unmeasuredContentFiles !== v.totalFiles ||
      v.binaryFiles > v.unmeasuredContentFiles ||
      v.filesWithTextChanges + v.knownFilesWithoutTextChanges !== v.knownTextFiles ||
      Object.values(v.fileKinds).reduce((n, x) => n + x, 0) !== v.totalFiles ||
      v.changedLineEntries !== v.addedLines + v.deletedLines ||
      v.netLineChange !== v.addedLines - v.deletedLines ||
      v.blankAddedLines > v.addedLines ||
      v.blankDeletedLines > v.deletedLines ||
      v.asciiWhitespaceEquivalentRuns > v.editRuns ||
      v.editRuns > v.changedLineEntries ||
      v.modeChanges > v.totalFiles ||
      v.specialModeEntries > v.totalFiles ||
      v.classifications.mappedFiles + v.classifications.unmappedFiles !== v.totalFiles
    )
      fail();
    for (const key of [
      'addedLines',
      'deletedLines',
      'changedLineEntries',
      'hunks',
      'editRuns',
    ] as const)
      if (
        v.fileDistributions[key].count !== v.knownTextFiles ||
        v.fileDistributions[key].sum !== v[key]
      )
        fail();
    for (const axis of [
      v.classifications.byRole,
      v.classifications.generated,
      v.classifications.formattingOnly,
    ]) {
      for (const key of [
        'files',
        'knownTextFiles',
        'unmeasuredFiles',
        'addedLines',
        'deletedLines',
        'changedLineEntries',
      ] as const) {
        const expected =
          key === 'files'
            ? v.totalFiles
            : key === 'unmeasuredFiles'
              ? v.unmeasuredContentFiles
              : v[key];
        if (Object.values(axis).reduce((n, bucket: Bucket) => n + bucket[key], 0) !== expected)
          fail();
      }
    }
    const d = v.dispersion;
    if (v.changedLineEntries === 0) {
      if (
        [d.largestFileShare, d.concentration, d.effectiveFileCount].some((n) => n !== null) ||
        v.filesWithTextChanges !== 0
      )
        fail();
    } else if (
      !v.filesWithTextChanges ||
      d.largestFileShare === null ||
      d.concentration === null ||
      d.effectiveFileCount === null
    )
      fail();
    else if (
      d.largestFileShare < 1 / v.filesWithTextChanges - 1e-12 ||
      d.concentration < d.largestFileShare ** 2 - 1e-12 ||
      d.concentration > d.largestFileShare + 1e-12 ||
      Math.abs(d.effectiveFileCount * d.concentration - 1) > 1e-10 ||
      d.effectiveFileCount > v.filesWithTextChanges + 1e-10
    )
      fail();
  });
export type PatchMetrics = z.infer<typeof PatchMetricsSchema>;
export const PatchMeasurementReportSchema = z
  .object({
    version: z.literal('patch-measurement-1'),
    algorithm: z.literal('jsdiff_9_0_0_unified_patch_counts_v1'),
    parser: z.object({ name: z.literal('jsdiff'), version: z.literal('9.0.0') }).strict(),
    status: z.enum(['disabled', 'measured', 'partial', 'unavailable']),
    reason: z.enum([
      'not_enabled',
      'none',
      'invalid_manifest',
      'source_unavailable',
      'source_changed',
      'input_limit',
      'unsupported_format',
      'invalid_patch',
      'classification_mismatch',
      'parser_unavailable',
      'parse_error',
      'operation_limit',
    ]),
    requirementRevision: z.uuid().nullable(),
    stage: z.enum(['proposed', 'during_execution', 'after_execution', 'unknown']),
    stageBasis: z.literal('user_declaration'),
    measuredAt: z.string().datetime().nullable(),
    inputBytes: count.max(4194304).nullable(),
    format: z.enum(['git_unified', 'unified', 'empty', 'unknown']),
    scope: z
      .object({
        declared: z.enum(['complete', 'partial', 'unknown']),
        coverage: z.enum(['complete', 'partial', 'unknown']),
      })
      .strict()
      .nullable(),
    generation: PatchMeasurementManifestSchema.shape.generation.nullable(),
    metrics: PatchMetricsSchema.nullable(),
    limits: fixed(PATCH_MEASUREMENT_LIMITS),
    rules: fixed(patchMetricRules),
    taskDifficulty: z.literal('not_inferred'),
    codeQuality: z.literal('not_inferred'),
    completedWork: z.literal('not_inferred'),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: '补丁报告状态不一致' });
    const active = v.status === 'measured' || v.status === 'partial';
    if (active !== (v.reason === 'none')) fail();
    if (v.status === 'disabled') {
      if (
        v.reason !== 'not_enabled' ||
        v.metrics !== null ||
        v.scope !== null ||
        v.requirementRevision !== null ||
        v.measuredAt !== null ||
        v.inputBytes !== null ||
        v.generation !== null
      )
        fail();
    } else if (v.reason === 'not_enabled' || v.measuredAt === null) fail();
    if (active) {
      if (
        !v.metrics ||
        !v.scope ||
        !v.generation ||
        !v.requirementRevision ||
        v.inputBytes === null ||
        v.format === 'unknown'
      ) {
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
export type PatchMeasurementReport = z.infer<typeof PatchMeasurementReportSchema>;
