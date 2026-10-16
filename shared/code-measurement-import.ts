import {
  CodeMeasurementSetSchema,
  type CodeMeasurementSet,
} from './code-measurement-set-schema.js';
import {
  PythonCodeMeasurementSchema,
  type PythonCodeMeasurement,
} from './python-code-measurement-schema.js';
import {
  PatchMeasurementReportSchema,
  type PatchMeasurementReport,
} from './patch-measurement-schema.js';

export const CODE_REPORT_IMPORT_BYTES = 256 * 1024;
export type ImportedCodeMeasurement =
  CodeMeasurementSet | PythonCodeMeasurement | PatchMeasurementReport;
export type CodeMeasurementImport =
  | { status: 'disabled' }
  | { status: 'ready'; report: ImportedCodeMeasurement }
  | { status: 'invalid'; reason: 'size' | 'read' | 'json' | 'schema' };
export const codeReportImportMessages = {
  size: '请选择不超过256 KiB的本地代码数值报告。',
  read: '本地报告读取失败；未采用文件内容。',
  json: '文件不是有效JSON；请选择代码测量输出的数值报告。',
  schema: '报告字段、版本或数量校验未通过；请导入Python、JS/TS多文件或补丁数值报告。',
};
export function parseCodeMeasurementReport(input: unknown): ImportedCodeMeasurement | null {
  const patch = PatchMeasurementReportSchema.safeParse(input);
  if (patch.success) return patch.data;
  const python = PythonCodeMeasurementSchema.safeParse(input);
  if (python.success) return python.data;
  const code = CodeMeasurementSetSchema.safeParse(input);
  return code.success ? code.data : null;
}
export function parseCodeMeasurementImport(text: string, enabled = false): CodeMeasurementImport {
  if (!enabled) return { status: 'disabled' };
  if (
    text.length > CODE_REPORT_IMPORT_BYTES ||
    new TextEncoder().encode(text).length > CODE_REPORT_IMPORT_BYTES
  )
    return { status: 'invalid', reason: 'size' };
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { status: 'invalid', reason: 'json' };
  }
  const report = parseCodeMeasurementReport(input);
  return report ? { status: 'ready', report } : { status: 'invalid', reason: 'schema' };
}
export async function readCodeMeasurementFile(
  file: Pick<File, 'size' | 'text'>,
  enabled = false,
): Promise<CodeMeasurementImport> {
  if (!enabled) return { status: 'disabled' };
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > CODE_REPORT_IMPORT_BYTES)
    return { status: 'invalid', reason: 'size' };
  try {
    return parseCodeMeasurementImport(await file.text(), true);
  } catch {
    return { status: 'invalid', reason: 'read' };
  }
}

export type CodeReportDistribution = {
  count: number;
  sum: number;
  min: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
  mean: number | null;
};
export type CodeReportGroup = {
  language: string;
  files: number;
  method: string;
  parserVersion: string;
  runtimeVersion: string | null;
  functions: number;
  cyclomatic: CodeReportDistribution;
  nesting: CodeReportDistribution;
  parameters: CodeReportDistribution;
  scalars: { key: string; label: string; value: number }[];
  extraDistributions: { label: string; distribution: CodeReportDistribution }[];
  decisionScopes: { label: string; counts: Record<string, number> }[];
};
export function codeReportGroups(report: ImportedCodeMeasurement): CodeReportGroup[] {
  if (report.version === 'patch-measurement-1') return [];
  if (report.version === 'python-code-measurement-1') {
    const m = report.metrics;
    return m && report.scope
      ? [
          {
            language: 'Python',
            files: report.scope.measuredFiles,
            method: report.algorithm,
            parserVersion: report.parser.version,
            runtimeVersion: report.parser.pythonVersion,
            functions: m.functionCount,
            cyclomatic: m.cyclomatic,
            nesting: m.controlNesting,
            parameters: m.parameters,
            scalars: [
              { key: 'loc', label: '物理行LOC', value: m.raw.loc },
              { key: 'lloc', label: '逻辑行LLOC', value: m.raw.lloc },
              { key: 'sloc', label: '源码行SLOC', value: m.raw.sloc },
              { key: 'comments', label: '含注释行', value: m.raw.comments },
              { key: 'multi', label: '多行字符串行', value: m.raw.multi },
              { key: 'blank', label: '空行', value: m.raw.blank },
              { key: 'single_comments', label: '整行注释', value: m.raw.single_comments },
              { key: 'calls', label: '调用表达式节点', value: m.syntax.callExpressions },
              { key: 'async', label: '异步具名函数', value: m.syntax.asyncFunctions },
              { key: 'sync', label: '普通具名函数', value: m.syntax.functions },
              { key: 'classes', label: '类', value: m.syntax.classes },
              { key: 'lambdas', label: 'lambda表达式', value: m.syntax.lambdas },
              { key: 'comprehensions', label: '推导式', value: m.syntax.comprehensions },
              { key: 'with', label: '上下文管理语句', value: m.syntax.withStatements },
              { key: 'match', label: '模式匹配语句', value: m.syntax.matchStatements },
              { key: 'handlers', label: '异常处理节点', value: m.syntax.exceptionHandlers },
            ],
            extraDistributions: [],
            decisionScopes: [],
          },
        ]
      : [];
  }
  if (report.status === 'disabled') return [];
  return report.languageGroups.map((g) => ({
    language: g.language,
    files: g.files,
    method: g.algorithm,
    parserVersion: g.parser.version,
    runtimeVersion: null,
    functions: g.metrics.functionCount,
    cyclomatic: g.metrics.functions.cyclomaticApproximation,
    nesting: g.metrics.functions.controlNesting,
    parameters: g.metrics.functions.parameters,
    extraDistributions: [
      { label: '函数语法决策', distribution: g.metrics.functions.decisionCount },
      { label: '函数调用节点', distribution: g.metrics.functions.callNodes },
      { label: '函数构造节点', distribution: g.metrics.functions.constructionNodes },
      { label: '函数标签模板节点', distribution: g.metrics.functions.taggedTemplateNodes },
      {
        label: '类隐式单元圈复杂度近似',
        distribution: g.metrics.implicitScopes.cyclomaticApproximation,
      },
      { label: '类隐式单元语法决策', distribution: g.metrics.implicitScopes.decisionCount },
      { label: '类隐式单元控制嵌套', distribution: g.metrics.implicitScopes.controlNesting },
      { label: '类隐式单元调用节点', distribution: g.metrics.implicitScopes.callNodes },
      { label: '类隐式单元构造节点', distribution: g.metrics.implicitScopes.constructionNodes },
      {
        label: '类隐式单元标签模板节点',
        distribution: g.metrics.implicitScopes.taggedTemplateNodes,
      },
      { label: '模块语法决策', distribution: g.metrics.moduleScopes.decisionCount },
      { label: '模块控制嵌套', distribution: g.metrics.moduleScopes.controlNesting },
      { label: '模块调用节点', distribution: g.metrics.moduleScopes.callNodes },
      { label: '模块构造节点', distribution: g.metrics.moduleScopes.constructionNodes },
      { label: '模块标签模板节点', distribution: g.metrics.moduleScopes.taggedTemplateNodes },
    ],
    decisionScopes: [
      { label: '函数', counts: g.metrics.functions.decisions },
      { label: '类隐式单元', counts: g.metrics.implicitScopes.decisions },
      { label: '模块', counts: g.metrics.moduleScopes.decisions },
    ],
    scalars: [
      { key: 'sourceBytes', label: '已解析文本字节', value: g.sourceBytes },
      { key: 'implicit', label: '类隐式执行单元', value: g.metrics.implicitScopes.count },
      { key: 'fields', label: '字段初始化', value: g.metrics.implicitScopes.fieldInitializers },
      { key: 'static', label: '类静态块', value: g.metrics.implicitScopes.staticBlocks },
      { key: 'calls', label: '调用表达式节点', value: g.metrics.totalCallNodes },
      { key: 'new', label: '构造表达式节点', value: g.metrics.totalConstructionNodes },
      { key: 'tagged', label: '标签模板节点', value: g.metrics.totalTaggedTemplateNodes },
      {
        key: 'moduleDecisions',
        label: '模块语法决策',
        value: g.metrics.moduleScopes.decisionCount.sum,
      },
    ],
  }));
}
export const codeComparisonReasonLabels = {
  not_structure_report: '补丁报告已描述一次改动，不能代替执行前后的代码快照。',
  invalid_report: '至少一份报告未通过数值协议校验。',
  not_fully_measured: '至少一份报告有未测得文件，或没有可用的数值。',
  scope_incomplete: '至少一份报告的代码范围未声明并测得完整。',
  requirement_missing: '至少一份报告没有原要求修订关联；请使用带修订的文件清单。',
  requirement_changed: '两份报告的原要求修订不同，应分别查看。',
  wrong_stage: '需要分别声明为执行前和执行后的报告。',
  scope_not_confirmed: '请先确认两份报告针对相同要求及代码范围。',
  language_changed: '两份报告的语言范围不同；缺失语言不补为零。',
  method_changed: '解析方法、解析器或Python版本不同，数值不能直接作差。',
} as const;
type ComparisonReason = keyof typeof codeComparisonReasonLabels;
export type CodeStructureComparison =
  | { status: 'disabled' }
  | { status: 'blocked'; reasons: ComparisonReason[] }
  | {
      status: 'compared';
      method: 'code-structure-comparison-1';
      scopeBasis: 'user_confirmation';
      inference: 'descriptive_distributions_not_matched_functions';
      groups: {
        language: string;
        rows: {
          label: string;
          before: number | null;
          after: number | null;
          delta: number | null;
        }[];
      }[];
    };
export function compareCodeMeasurementReports(
  beforeInput: unknown,
  afterInput: unknown,
  options: { enabled?: boolean; sameScopeConfirmed?: boolean } = {},
): CodeStructureComparison {
  if (options.enabled !== true) return { status: 'disabled' };
  const before = parseCodeMeasurementReport(beforeInput),
    after = parseCodeMeasurementReport(afterInput);
  if (!before || !after) return { status: 'blocked', reasons: ['invalid_report'] };
  if (before.version === 'patch-measurement-1' || after.version === 'patch-measurement-1')
    return { status: 'blocked', reasons: ['not_structure_report'] };
  if (before.status !== 'measured' || after.status !== 'measured')
    return { status: 'blocked', reasons: ['not_fully_measured'] };
  const reasons: ComparisonReason[] = [];
  if (
    !before.scope ||
    !after.scope ||
    before.scope.coverage !== 'complete' ||
    after.scope.coverage !== 'complete'
  )
    reasons.push('scope_incomplete');
  if (!before.requirementRevision || !after.requirementRevision)
    reasons.push('requirement_missing');
  else if (before.requirementRevision.toLowerCase() !== after.requirementRevision.toLowerCase())
    reasons.push('requirement_changed');
  if (before.stage !== 'before_execution' || after.stage !== 'after_execution')
    reasons.push('wrong_stage');
  if (options.sameScopeConfirmed !== true) reasons.push('scope_not_confirmed');
  const a = codeReportGroups(before),
    b = codeReportGroups(after),
    byLanguage = new Map(b.map((g) => [g.language, g]));
  if (a.length !== b.length || a.some((g) => !byLanguage.has(g.language)))
    reasons.push('language_changed');
  else if (
    a.some((g) => {
      const next = byLanguage.get(g.language)!;
      return (
        g.method !== next.method ||
        g.parserVersion !== next.parserVersion ||
        g.runtimeVersion !== next.runtimeVersion
      );
    })
  )
    reasons.push('method_changed');
  if (reasons.length) return { status: 'blocked', reasons };
  return {
    status: 'compared',
    method: 'code-structure-comparison-1',
    scopeBasis: 'user_confirmation',
    inference: 'descriptive_distributions_not_matched_functions',
    groups: a.map((g) => {
      const next = byLanguage.get(g.language)!;
      const row = (label: string, old: number | null, value: number | null) => ({
        label,
        before: old,
        after: value,
        delta: old === null || value === null ? null : value - old,
      });
      const rows = [row('测得文件', g.files, next.files), row('函数', g.functions, next.functions)];
      for (const [key, label] of [
        ['cyclomatic', '函数圈复杂度'],
        ['nesting', '控制嵌套'],
        ['parameters', '参数数'],
      ] as const)
        for (const [stat, text] of [
          ['median', '中位数'],
          ['p90', 'P90'],
          ['max', '最大值'],
          ['mean', '均值'],
        ] as const)
          rows.push(row(label + text, g[key][stat], next[key][stat]));
      for (const value of g.scalars)
        rows.push(
          row(
            value.label,
            value.value,
            next.scalars.find((s) => s.key === value.key)?.value ?? null,
          ),
        );
      return { language: g.language, rows };
    }),
  };
}
