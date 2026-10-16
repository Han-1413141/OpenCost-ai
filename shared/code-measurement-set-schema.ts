import { z } from 'zod';

const count = z.number().int().safe().nonnegative();
const quantity = z.number().finite().nonnegative();
const fixed = (values: Record<string, string | number>) =>
  z
    .object(
      Object.fromEntries(Object.entries(values).map(([key, value]) => [key, z.literal(value)])),
    )
    .strict();
const maxScopes = 640000;
export const CodeDistributionSchema = z
  .object({
    count: count.max(maxScopes),
    sum: count,
    min: count.nullable(),
    median: quantity.nullable(),
    p90: quantity.nullable(),
    max: count.nullable(),
    mean: quantity.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: '代码测量分布不一致' });
    if (!v.count) {
      if (v.sum !== 0 || [v.min, v.median, v.p90, v.max, v.mean].some((n) => n !== null)) fail();
      return;
    }
    if ([v.min, v.median, v.p90, v.max, v.mean].some((n) => n === null)) {
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
const decisionKeys = [
  'if',
  'for',
  'for_in',
  'for_of',
  'while',
  'do_while',
  'catch',
  'case',
  'conditional',
  'logical_and',
  'logical_or',
  'nullish',
  'default_value',
  'logical_assignment_and',
  'logical_assignment_or',
  'nullish_assignment',
  'optional_member',
  'optional_call',
] as const;
const decisions = z.object(Object.fromEntries(decisionKeys.map((key) => [key, count]))).strict();
const scopeFields = {
  count: count.max(maxScopes),
  decisions,
  decisionCount: CodeDistributionSchema,
  controlNesting: CodeDistributionSchema,
  callNodes: CodeDistributionSchema,
  constructionNodes: CodeDistributionSchema,
  taggedTemplateNodes: CodeDistributionSchema,
};
const ScopeSchema = z
  .object({
    ...scopeFields,
    cyclomaticApproximation: CodeDistributionSchema,
    parameters: CodeDistributionSchema,
  })
  .strict();
const ImplicitScopeSchema = ScopeSchema.extend({ fieldInitializers: count, staticBlocks: count });
const ModuleScopeSchema = z.object(scopeFields).strict();
type Scope = z.infer<typeof ModuleScopeSchema> & Partial<z.infer<typeof ScopeSchema>>;
function validScope(s: Scope) {
  const distributions = [
    s.decisionCount,
    s.controlNesting,
    s.callNodes,
    s.constructionNodes,
    s.taggedTemplateNodes,
    ...(s.cyclomaticApproximation ? [s.cyclomaticApproximation] : []),
    ...(s.parameters ? [s.parameters] : []),
  ];
  if (
    distributions.some((d) => d.count !== s.count) ||
    Object.values(s.decisions).reduce((n, value) => n + value, 0) !== s.decisionCount.sum
  )
    return false;
  if (s.cyclomaticApproximation) {
    const a = s.decisionCount,
      b = s.cyclomaticApproximation;
    if (b.sum !== a.sum + s.count) return false;
    for (const key of ['min', 'median', 'p90', 'max', 'mean'] as const) {
      if (
        a[key] === null
          ? b[key] !== null
          : b[key] === null || Math.abs(b[key]! - a[key]! - 1) > 1e-8
      )
        return false;
    }
  }
  return true;
}
export const CodeMeasurementLanguageGroupSchema = z
  .object({
    language: z.enum(['javascript', 'typescript', 'jsx', 'tsx']),
    files: count.min(1).max(64),
    sourceBytes: count.max(8388608),
    parser: z
      .object({
        name: z.literal('rolldown_oxc'),
        version: z
          .string()
          .max(80)
          .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/),
      })
      .strict(),
    algorithm: z.literal('eslint_classic_syntax_approximation_v1'),
    quantiles: z.literal('hyndman_fan_type_7'),
    metrics: z
      .object({
        functionCount: count.max(maxScopes),
        functions: ScopeSchema,
        implicitScopes: ImplicitScopeSchema,
        moduleScopes: ModuleScopeSchema,
        totalCallNodes: count,
        totalConstructionNodes: count,
        totalTaggedTemplateNodes: count,
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const m = v.metrics,
      scopes = [m.functions, m.implicitScopes, m.moduleScopes];
    if (
      m.functionCount !== m.functions.count ||
      m.moduleScopes.count !== v.files ||
      scopes.some((s) => !validScope(s)) ||
      m.implicitScopes.count !==
        m.implicitScopes.fieldInitializers + m.implicitScopes.staticBlocks ||
      scopes.reduce((n, s) => n + s.callNodes.sum, 0) !== m.totalCallNodes ||
      scopes.reduce((n, s) => n + s.constructionNodes.sum, 0) !== m.totalConstructionNodes ||
      scopes.reduce((n, s) => n + s.taggedTemplateNodes.sum, 0) !== m.totalTaggedTemplateNodes
    )
      ctx.addIssue({ code: 'custom', message: '代码测量语言数量不守恒' });
  });
export const codeSetExclusionReasons = [
  'duplicate_file',
  'unsupported_language',
  'source_unavailable',
  'source_changed',
  'input_too_large',
  'total_input_limit',
  'parser_unavailable',
  'parse_error',
  'parser_error',
  'ast_limit',
  'invalid_input',
] as const;
const measuredSchema = z
  .object({
    version: z.literal('code-measurement-set-1'),
    status: z.enum(['measured', 'partial', 'unavailable']),
    measuredAt: z.string().datetime(),
    requirementRevision: z.uuid(),
    stage: z.enum(['before_execution', 'during_execution', 'after_execution', 'unknown']),
    stageBasis: z.literal('user_declaration'),
    scope: z
      .object({
        declared: z.enum(['complete', 'partial', 'unknown']),
        basis: z.literal('user_selected_manifest'),
        coverage: z.enum(['complete', 'partial', 'unknown']),
        selectedEntries: count.min(1).max(64),
        measuredFiles: count.max(64),
        duplicateEntries: count.max(64),
        unavailableEntries: count.max(64),
      })
      .strict(),
    knownInputBytesRead: count.max(8388608),
    inputReadBudgetUsed: count.max(8388608),
    snapshotConsistency: z.literal('per_file_checked_not_atomic_project_snapshot'),
    excluded: z
      .object(Object.fromEntries(codeSetExclusionReasons.map((r) => [r, count.max(64)])))
      .strict(),
    limits: fixed({
      manifestBytes: 65536,
      entries: 64,
      totalInputBytes: 8388608,
      perFileBytes: 1048576,
    }),
    languageGroups: z.array(CodeMeasurementLanguageGroupSchema).max(4),
    inference: z.literal('syntax_only'),
    taskDifficulty: z.literal('not_inferred'),
    algorithmicComplexity: z.literal('not_inferred'),
    independentVerification: z.literal('not_verified'),
  })
  .strict()
  .superRefine((v, ctx) => {
    const s = v.scope,
      groups = v.languageGroups;
    const expectedStatus =
      s.measuredFiles === 0 ? 'unavailable' : s.unavailableEntries > 0 ? 'partial' : 'measured';
    if (
      v.status !== expectedStatus ||
      s.measuredFiles + s.duplicateEntries + s.unavailableEntries !== s.selectedEntries ||
      s.coverage !==
        (s.measuredFiles === 0 ? 'unknown' : s.unavailableEntries > 0 ? 'partial' : s.declared) ||
      v.excluded.duplicate_file !== s.duplicateEntries ||
      Object.entries(v.excluded)
        .filter(([k]) => k !== 'duplicate_file')
        .reduce((n, [, x]) => n + x, 0) !== s.unavailableEntries ||
      groups.reduce((n, g) => n + g.files, 0) !== s.measuredFiles ||
      groups.reduce((n, g) => n + g.sourceBytes, 0) > v.knownInputBytesRead ||
      v.knownInputBytesRead > v.inputReadBudgetUsed ||
      new Set(groups.map((g) => g.language)).size !== groups.length
    )
      ctx.addIssue({ code: 'custom', message: '代码测量范围或覆盖不一致' });
  });
export const CodeMeasurementSetSchema = z.union([
  z
    .object({
      version: z.literal('code-measurement-set-1'),
      status: z.literal('disabled'),
      languageGroups: z.null(),
    })
    .strict(),
  measuredSchema,
]);
export type CodeMeasurementSet = z.infer<typeof CodeMeasurementSetSchema>;
