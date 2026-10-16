import { z } from 'zod';
export const PYTHON_CODE_LIMITS = Object.freeze({
  entries: 64,
  manifestBytes: 65536,
  perFileBytes: 1048576,
  totalInputBytes: 8388608,
  transportBytes: 16777216,
  astNodes: 100000,
  astDepth: 256,
  functionScopes: 10000,
  timeoutMs: 10000,
  outputBytes: 262144,
});
export const pythonCodeRules = {
  cc: 'unmodified_radon_6_0_1_no_assert_false_named_def_scopes',
  functions: 'def_async_def_methods_and_nested_defs_each_once_lambdas_not_separate',
  nesting: 'function_body_if_loops_try_with_match_conditional_comprehension_elif_nested',
  parameters: 'declared_positional_keyword_and_variadics_including_self_cls',
  quantiles: 'hyndman_fan_type_7',
  assertions: 'radon_statement_increment_without_assert_test_traversal',
  withStatements: 'no_direct_cc_increment_in_radon_6_0_1',
  unsupported: 'except_star_template_strings_and_guarded_match',
  raw: 'radon_6_0_1_analyze',
  reachability: 'not_analyzed',
  independentVerification: 'not_verified',
} as const;
const count = z.number().int().safe().nonnegative();
const quantity = z.number().finite().nonnegative();
export const PythonDistributionSchema = z
  .object({
    count: count.max(10000),
    sum: count,
    min: count.nullable(),
    median: quantity.nullable(),
    p90: quantity.nullable(),
    max: count.nullable(),
    mean: quantity.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: 'Python测量分布不守恒' });
    if (v.count === 0) {
      if (v.sum !== 0 || [v.min, v.median, v.p90, v.max, v.mean].some((x) => x !== null)) fail();
      return;
    }
    if ([v.min, v.median, v.p90, v.max, v.mean].some((x) => x === null)) {
      fail();
      return;
    }
    if (
      v.min! > v.median! ||
      v.median! > v.p90! ||
      v.p90! > v.max! ||
      v.mean! < v.min! ||
      v.mean! > v.max! ||
      Math.abs(v.mean! - v.sum / v.count) > 1e-10 * Math.max(1, v.mean!)
    )
      fail();
  });
export const PythonCodeMetricsSchema = z
  .object({
    raw: z
      .object({
        loc: count,
        lloc: count,
        sloc: count,
        comments: count,
        multi: count,
        blank: count,
        single_comments: count,
      })
      .strict(),
    syntax: z
      .object({
        functions: count,
        asyncFunctions: count,
        classes: count,
        lambdas: count,
        callExpressions: count,
        comprehensions: count,
        withStatements: count,
        matchStatements: count,
        exceptionHandlers: count,
      })
      .strict(),
    functionCount: count.max(10000),
    cyclomatic: PythonDistributionSchema,
    parameters: PythonDistributionSchema,
    controlNesting: PythonDistributionSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.raw.sloc + v.raw.multi + v.raw.blank + v.raw.single_comments !== v.raw.loc ||
      v.functionCount !== v.syntax.functions + v.syntax.asyncFunctions ||
      [v.cyclomatic, v.parameters, v.controlNesting].some((d) => d.count !== v.functionCount) ||
      (v.functionCount > 0 && (v.cyclomatic.min! < 1 || v.cyclomatic.sum < v.functionCount))
    )
      ctx.addIssue({ code: 'custom', message: 'Python代码数量或分布不一致' });
  });
export const pythonMeasurementReasons = [
  'duplicate_file',
  'source_unavailable',
  'source_changed',
  'input_too_large',
  'total_input_limit',
  'unsupported_syntax',
  'parse_error',
  'parser_error',
  'ast_limit',
] as const;
export const PythonHelperResultSchema = z
  .object({
    format: z.literal('opencost-python-helper-1'),
    pythonVersion: z.string().regex(/^3\.1[0-5]\.\d+$/),
    radonVersion: z.literal('6.0.1'),
    results: z
      .array(
        z
          .object({
            index: count.max(63),
            status: z.enum(['measured', 'unavailable']),
            reason: z.enum([
              'none',
              'unsupported_syntax',
              'parse_error',
              'parser_error',
              'ast_limit',
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    measuredFiles: count.max(64),
    metrics: PythonCodeMetricsSchema.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.results.some(
        (r, i) => r.index !== i || (r.status === 'measured') !== (r.reason === 'none'),
      ) ||
      v.measuredFiles !== v.results.filter((r) => r.status === 'measured').length ||
      Boolean(v.metrics) !== v.measuredFiles > 0
    )
      ctx.addIssue({ code: 'custom', message: 'Python子进程结果不完整' });
  });
export const PythonMeasurementManifestSchema = z
  .object({
    version: z.literal('python-code-measurement-manifest-1'),
    requirementRevision: z.uuid(),
    stage: z.enum(['before_execution', 'during_execution', 'after_execution', 'unknown']),
    scope: z.enum(['complete', 'partial', 'unknown']),
    files: z
      .array(
        z
          .string()
          .min(1)
          .max(4096)
          .refine((s) => !s.includes('\0')),
      )
      .min(1)
      .max(64),
  })
  .strict();
export type PythonCodeMetrics = z.infer<typeof PythonCodeMetricsSchema>;
const reason = z.enum([
  'not_enabled',
  'none',
  'runtime_not_selected',
  'invalid_runtime',
  'runtime_unavailable',
  'invalid_manifest',
  'no_measured_sources',
  'transport_limit',
  'tool_unavailable',
  'runtime_timeout',
  'runtime_failed',
  'invalid_runtime_output',
]);
const fixedObject = (values: Record<string, string | number>) =>
  z.object(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, z.literal(v)]))).strict();
export const PythonCodeMeasurementSchema = z
  .object({
    version: z.literal('python-code-measurement-1'),
    language: z.literal('python'),
    algorithm: z.literal('radon_6_0_1_named_function_cc_v1'),
    status: z.enum(['disabled', 'measured', 'partial', 'unavailable']),
    reason,
    parser: z
      .object({
        name: z.literal('python_ast_radon'),
        version: z.literal('6.0.1'),
        pythonVersion: z
          .string()
          .regex(/^3\.1[0-5]\.\d+$/)
          .nullable(),
      })
      .strict(),
    measuredAt: z.string().datetime().nullable(),
    requirementRevision: z.uuid().nullable(),
    stage: z.enum(['before_execution', 'during_execution', 'after_execution', 'unknown']),
    stageBasis: z.literal('user_declaration'),
    snapshotConsistency: z.literal('per_file_checked_not_atomic_project_snapshot'),
    scope: z
      .object({
        declared: z.enum(['complete', 'partial', 'unknown']),
        coverage: z.enum(['complete', 'partial', 'unknown']),
        selectedEntries: count.min(1).max(64),
        measuredFiles: count.max(64),
        duplicateEntries: count.max(64),
        unavailableEntries: count.max(64),
      })
      .strict()
      .nullable(),
    knownInputBytesRead: count.max(PYTHON_CODE_LIMITS.totalInputBytes).nullable(),
    inputReadBudgetUsed: count.max(PYTHON_CODE_LIMITS.totalInputBytes).nullable(),
    excluded: z
      .object(Object.fromEntries(pythonMeasurementReasons.map((r) => [r, count.max(64)])))
      .strict()
      .nullable(),
    metrics: PythonCodeMetricsSchema.nullable(),
    limits: fixedObject(PYTHON_CODE_LIMITS),
    rules: fixedObject(pythonCodeRules),
    taskDifficulty: z.literal('not_inferred'),
    algorithmicComplexity: z.literal('not_inferred'),
    codeQuality: z.literal('not_inferred'),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = () =>
      ctx.addIssue({ code: 'custom', message: 'Python测量报告状态、覆盖或数量不一致' });
    const measured = v.status === 'measured' || v.status === 'partial';
    if (measured !== (v.reason === 'none')) fail();
    if (
      v.status === 'disabled'
        ? v.reason !== 'not_enabled' ||
          v.scope !== null ||
          v.metrics !== null ||
          v.measuredAt !== null
        : v.reason === 'not_enabled'
    )
      fail();
    if (measured) {
      if (
        v.reason !== 'none' ||
        !v.metrics ||
        !v.scope ||
        !v.parser.pythonVersion ||
        !v.measuredAt
      ) {
        fail();
        return;
      }
      if (
        !v.scope.measuredFiles ||
        (v.status === 'measured') !== (v.scope.unavailableEntries === 0) ||
        !v.excluded ||
        Object.entries(v.excluded)
          .filter(([k]) => k !== 'duplicate_file')
          .reduce((n, [, x]) => n + x, 0) !== v.scope.unavailableEntries
      )
        fail();
    } else if (v.metrics !== null) fail();
    if (v.scope) {
      const s = v.scope;
      if (
        s.measuredFiles + s.duplicateEntries + s.unavailableEntries !== s.selectedEntries ||
        s.coverage !==
          (s.measuredFiles === 0 ? 'unknown' : s.unavailableEntries > 0 ? 'partial' : s.declared) ||
        (v.excluded && v.excluded.duplicate_file !== s.duplicateEntries)
      )
        fail();
    }
    if (
      v.knownInputBytesRead !== null &&
      (v.inputReadBudgetUsed === null || v.knownInputBytesRead > v.inputReadBudgetUsed)
    )
      fail();
  });
export type PythonCodeMeasurement = z.infer<typeof PythonCodeMeasurementSchema>;
