import { z } from 'zod';
import type {
  CodeMeasurementObservations,
  CodeSnapshotObservation,
  PatchObservation,
} from './code-observations-schema.js';
import { codeObservationCounts } from './code-observation-counts.js';

const count = z.number().int().nonnegative().max(1000000);
const value = z.number().finite().nullable();
export const CodeObservationDistributionSchema = z
  .object({
    expected: count,
    known: count,
    notApplicable: count,
    missing: count,
    min: value,
    median: value,
    p90: value,
    max: value,
    mean: value,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.known + v.notApplicable + v.missing !== v.expected ||
      (v.known === 0
        ? [v.min, v.median, v.p90, v.max, v.mean].some((n) => n !== null)
        : [v.min, v.median, v.p90, v.max, v.mean].some((n) => n === null) ||
          v.min! > v.median! ||
          v.median! > v.p90! ||
          v.p90! > v.max! ||
          v.mean! < v.min! ||
          v.mean! > v.max!)
    )
      ctx.addIssue({ code: 'custom', message: '代码反馈分布覆盖不一致' });
  });
const countsSchema = z
  .object({
    totalTasks: count,
    attachedTasks: count,
    snapshots: count,
    patches: count,
    beforeTasks: count,
    afterTasks: count,
    proposedPatchTasks: count,
    partialReports: count,
    unavailableReports: count,
  })
  .strict();
const groupSchema = z
  .object({
    kind: z.enum(['snapshot', 'patch']),
    language: z.enum(['javascript', 'jsx', 'typescript', 'tsx', 'python', 'unknown', 'patch']),
    stage: z.enum([
      'before_execution',
      'during_execution',
      'after_execution',
      'proposed',
      'unknown',
    ]),
    algorithm: z.enum([
      'eslint_classic_syntax_approximation_v1',
      'radon_6_0_1_named_function_cc_v1',
      'jsdiff_9_0_0_unified_patch_counts_v1',
    ]),
    parserVersion: z
      .string()
      .max(80)
      .regex(/^(?:unknown|\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/),
    pythonVersion: z
      .string()
      .regex(/^3\.1[0-5]\.\d+$/)
      .nullable(),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    generation: z
      .object({
        format: z.enum(['git_unified', 'unified', 'empty', 'unknown']),
        contextLines: count.nullable(),
        algorithm: z.enum(['myers', 'minimal', 'patience', 'histogram', 'unknown']),
        whitespaceIgnored: z.enum(['none', 'some', 'unknown']),
        renameDetection: z.enum(['enabled', 'disabled', 'unknown']),
      })
      .strict()
      .nullable(),
    tasks: count,
    reports: z.object({ measured: count, partial: count, unavailable: count }).strict(),
    metrics: z
      .array(
        z
          .object({
            key: z.enum([
              'files',
              'functions',
              'cc_median',
              'cc_p90',
              'cc_max',
              'nesting_max',
              'parameters_median',
              'sloc',
              'changes',
              'hunks',
              'runs',
              'unknown_files',
              'concentration',
              'net_lines',
            ]),
            label: z.string().max(100),
            unit: z.string().max(24),
            distribution: CodeObservationDistributionSchema,
          })
          .strict(),
      )
      .max(12),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (
      g.reports.measured + g.reports.partial + g.reports.unavailable !== g.tasks ||
      g.metrics.some((m) => m.distribution.expected !== g.tasks) ||
      new Set(g.metrics.map((m) => m.key)).size !== g.metrics.length
    )
      ctx.addIssue({ code: 'custom', message: '代码反馈任务分母不一致' });
  });
export const CodeObservationInsightsSchema = z
  .object({
    version: z.literal('code-observation-insights-1'),
    inference: z.literal('descriptive_task_snapshots'),
    status: z.enum(['measured', 'group_limit']),
    counts: countsSchema,
    groupCount: count,
    groups: z.array(groupSchema).max(64),
    note: z.string().max(1500),
  })
  .strict()
  .superRefine((v, ctx) => {
    const c = v.counts;
    if (
      c.attachedTasks > c.totalTasks ||
      c.beforeTasks > c.attachedTasks ||
      c.afterTasks > c.attachedTasks ||
      c.proposedPatchTasks > c.attachedTasks ||
      c.partialReports + c.unavailableReports > c.snapshots + c.patches ||
      (v.status === 'measured'
        ? v.groups.length !== v.groupCount
        : v.groupCount <= 64 || v.groups.length !== 0)
    )
      ctx.addIssue({ code: 'custom', message: '代码反馈总体覆盖或分组不一致' });
  });
export type CodeObservationInsights = z.infer<typeof CodeObservationInsightsSchema>;
type InputTask = { observations?: { codeMeasurements?: CodeMeasurementObservations } };
type Scalar = { value: number | null; notApplicable: boolean };
type Observation = {
  meta: Omit<z.infer<typeof groupSchema>, 'tasks' | 'metrics' | 'reports'>;
  values: Record<string, Scalar>;
};
const scalar = (n: number | null | undefined, notApplicable = false): Scalar => ({
  value: n ?? null,
  notApplicable,
});
const snapshotFields = [
  ['files', '各任务快照中测得文件数', '文件'],
  ['functions', '各任务快照中函数数', '函数'],
  ['cc_median', '各任务函数圈复杂度中位数', '结构数值'],
  ['cc_p90', '各任务函数圈复杂度P90', '结构数值'],
  ['cc_max', '各任务函数圈复杂度最大值', '结构数值'],
  ['nesting_max', '各任务控制嵌套最大值', '层'],
  ['parameters_median', '各任务函数参数数中位数', '参数'],
  ['sloc', '各任务已测得源码行SLOC', '行'],
] as const;
const patchFields = [
  ['files', '各任务补丁文件数', '文件'],
  ['changes', '各任务已知文本增删条目', '增删条目'],
  ['hunks', '各任务补丁修改块数', '修改块'],
  ['runs', '各任务连续改动段数', '段'],
  ['unknown_files', '各任务内容未测得文件数', '文件'],
  ['concentration', '各任务已知文本改动占比平方和', '比例'],
  ['net_lines', '各任务已知文本净行数变化', '行'],
] as const;
function snapshotObservations(s: CodeSnapshotObservation): Observation[] {
  const meta = {
    kind: 'snapshot' as const,
    stage: s.stage,
    coverage: s.scope?.coverage ?? 'unknown',
    generation: null,
  };
  if (s.kind === 'python_snapshot') {
    const m = s.metrics,
      empty = m?.functionCount === 0;
    return [
      {
        meta: {
          ...meta,
          language: 'python',
          algorithm: s.algorithm,
          parserVersion: s.parser.version,
          pythonVersion: s.parser.pythonVersion,
        },
        values: {
          files: scalar(s.scope?.measuredFiles),
          functions: scalar(m?.functionCount),
          cc_median: scalar(m?.cyclomatic.median, empty),
          cc_p90: scalar(m?.cyclomatic.p90, empty),
          cc_max: scalar(m?.cyclomatic.max, empty),
          nesting_max: scalar(m?.controlNesting.max, empty),
          parameters_median: scalar(m?.parameters.median, empty),
          sloc: scalar(m?.raw.sloc),
        },
      },
    ];
  }
  if (!s.languageGroups.length)
    return [
      {
        meta: {
          ...meta,
          language: 'unknown',
          algorithm: 'eslint_classic_syntax_approximation_v1',
          parserVersion: 'unknown',
          pythonVersion: null,
        },
        values: {
          files: scalar(s.scope.measuredFiles),
          functions: scalar(null),
          cc_median: scalar(null),
          cc_p90: scalar(null),
          cc_max: scalar(null),
          nesting_max: scalar(null),
          parameters_median: scalar(null),
          sloc: scalar(null, true),
        },
      },
    ];
  return s.languageGroups.map((g) => {
    const m = g.metrics,
      empty = m.functionCount === 0;
    return {
      meta: {
        ...meta,
        language: g.language,
        algorithm: g.algorithm,
        parserVersion: g.parser.version,
        pythonVersion: null,
      },
      values: {
        files: scalar(g.files),
        functions: scalar(m.functionCount),
        cc_median: scalar(m.functions.cyclomaticApproximation.median, empty),
        cc_p90: scalar(m.functions.cyclomaticApproximation.p90, empty),
        cc_max: scalar(m.functions.cyclomaticApproximation.max, empty),
        nesting_max: scalar(m.functions.controlNesting.max, empty),
        parameters_median: scalar(m.functions.parameters.median, empty),
        sloc: scalar(null, true),
      },
    };
  });
}
function patchObservation(p: PatchObservation): Observation {
  const m = p.metrics;
  return {
    meta: {
      kind: 'patch',
      language: 'patch',
      stage: p.stage,
      algorithm: p.algorithm,
      parserVersion: p.parser.version,
      pythonVersion: null,
      coverage: p.scope?.coverage ?? 'unknown',
      generation: p.generation
        ? { format: p.format, ...p.generation }
        : {
            format: p.format,
            contextLines: null,
            algorithm: 'unknown',
            whitespaceIgnored: 'unknown',
            renameDetection: 'unknown',
          },
    },
    values: {
      files: scalar(m?.totalFiles),
      changes: scalar(m?.changedLineEntries),
      hunks: scalar(m?.hunks),
      runs: scalar(m?.editRuns),
      unknown_files: scalar(m?.unmeasuredContentFiles),
      concentration: scalar(m?.dispersion.concentration, m?.changedLineEntries === 0),
      net_lines: scalar(m?.netLineChange),
    },
  };
}
function distribution(values: Scalar[]) {
  const sorted = values.flatMap((s) => (s.value === null ? [] : [s.value])).sort((a, b) => a - b),
    known = sorted.length;
  const notApplicable = values.filter((s) => s.value === null && s.notApplicable).length;
  const quantile = (p: number) => {
    if (!known) return null;
    const at = (known - 1) * p,
      low = Math.floor(at);
    return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
  };
  return {
    expected: values.length,
    known,
    notApplicable,
    missing: values.length - known - notApplicable,
    min: sorted[0] ?? null,
    median: quantile(0.5),
    p90: quantile(0.9),
    max: sorted.at(-1) ?? null,
    mean: known ? sorted.reduce((n, v) => n + v, 0) / known : null,
  };
}
export function analyzeCodeObservations(
  tasks: readonly InputTask[],
): CodeObservationInsights | null {
  const counts = codeObservationCounts(tasks);
  if (!counts.attachedTasks) return null;
  const groups = new Map<
    string,
    (Observation & { status: 'measured' | 'partial' | 'unavailable' })[]
  >();
  for (const task of tasks) {
    const c = task.observations?.codeMeasurements;
    if (!c) continue;
    const observations = [
      ...c.snapshots.flatMap((s) =>
        snapshotObservations(s).map((o) => ({ ...o, status: s.status })),
      ),
      ...c.patches.map((p) => ({ ...patchObservation(p), status: p.status })),
    ];
    for (const o of observations) {
      const key = JSON.stringify(o.meta),
        group = groups.get(key) ?? [];
      group.push(o);
      groups.set(key, group);
    }
  }
  const limited = groups.size > 64;
  return CodeObservationInsightsSchema.parse({
    version: 'code-observation-insights-1',
    inference: 'descriptive_task_snapshots',
    status: limited ? 'group_limit' : 'measured',
    counts,
    groupCount: groups.size,
    groups: limited
      ? []
      : [...groups.entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'en'))
          .map(([, group]) => ({
            ...group[0].meta,
            tasks: group.length,
            reports: {
              measured: group.filter((o) => o.status === 'measured').length,
              partial: group.filter((o) => o.status === 'partial').length,
              unavailable: group.filter((o) => o.status === 'unavailable').length,
            },
            metrics: (group[0].meta.kind === 'patch' ? patchFields : snapshotFields)
              .filter(([key]) => key !== 'sloc' || group[0].meta.language === 'python')
              .map(([key, label, unit]) => ({
                key,
                label,
                unit,
                distribution: distribution(group.map((o) => o.values[key])),
              })),
          })),
    note:
      '只描述本次附加代码记录。语言、解析版本、阶段、覆盖和差异生成条件分别分组；每行分布的观测单位是一项任务的快照或补丁摘要。' +
      '函数P90的中位数或P90不是合并全部函数后的P90，没有平均文件或任务分位数来冒充函数总体分位数。' +
      '同一文件可出现在多个任务中，不计算唯一文件、唯一代码量、完成量或生产率；阶段、范围、绑定与来源均未独立认证。' +
      '没有函数或没有已知文本改动时相应指标不适用；未测得不填零。前后阶段分别展示，不自动声称同范围配对变化。' +
      '这些字段不改变实际费用、验收、任务难度、公开排名或社区推荐。',
  });
}

export function codeObservationInsightLines(report: CodeObservationInsights): string[] {
  const c = report.counts;
  return [
    `代码与补丁观察：本次${c.totalTasks}项根目标中${c.attachedTasks}项附有数值，${c.snapshots}份代码快照、${c.patches}份补丁；` +
      `部分测得${c.partialReports}份、未测得${c.unavailableReports}份。`,
    `执行前快照涉及${c.beforeTasks}项目标、执行后快照涉及${c.afterTasks}项目标、补丁提案涉及${c.proposedPatchTasks}项目标；阶段可重叠，不增加完成量。`,
    report.status === 'group_limit'
      ? `条件组合${report.groupCount}组超过64组上限，未选择部分分布冒充完整结果。`
      : `按语言、解析版本、阶段、覆盖及差异生成条件分成${report.groupCount}组；完整数值与缺项见本人的反馈JSON或网页/应用代码分析。`,
    report.note,
  ];
}
