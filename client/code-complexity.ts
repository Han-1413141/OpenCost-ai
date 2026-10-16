import { createRequire } from 'node:module';
import type { parseSync as parseSource } from 'rolldown/utils';

export type CodeLanguage = 'javascript' | 'typescript' | 'jsx' | 'tsx';
export const CODE_COMPLEXITY_LIMITS = Object.freeze({
  inputBytes: 1024 * 1024,
  astNodes: 100000,
  astDepth: 256,
  scopes: 10000,
});

// NIST SP 500-235, sections 2.2 and 4.1: CFG complexity and decision counting.
// These are explicit syntax approximations, not construction of a complete CFG.
// The decision and implicit-scope boundaries follow ESLint's classic complexity
// rule. No ESLint implementation is copied or threshold applied.
export const codeDecisionKinds = Object.freeze([
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
] as const);
type DecisionKind = (typeof codeDecisionKinds)[number];
type DecisionCounts = Record<DecisionKind, number>;
type Distribution = {
  count: number;
  sum: number;
  min: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
  mean: number | null;
};
type Scope = {
  decisions: DecisionCounts;
  decisionCount: number;
  maxControlNesting: number;
  parameters: number;
  callNodes: number;
  constructionNodes: number;
  taggedTemplateNodes: number;
};
type ScopeSummary = {
  count: number;
  decisions: DecisionCounts;
  decisionCount: Distribution;
  cyclomaticApproximation: Distribution;
  controlNesting: Distribution;
  parameters: Distribution;
  callNodes: Distribution;
  constructionNodes: Distribution;
  taggedTemplateNodes: Distribution;
};
type Metrics = {
  functionCount: number;
  functions: ScopeSummary;
  implicitScopes: ScopeSummary & { fieldInitializers: number; staticBlocks: number };
  module: Omit<Scope, 'parameters'>;
  totalCallNodes: number;
  totalConstructionNodes: number;
  totalTaggedTemplateNodes: number;
};
type UnavailableReason =
  | 'invalid_input'
  | 'unsupported_language'
  | 'input_too_large'
  | 'parser_unavailable'
  | 'parse_error'
  | 'parser_error'
  | 'ast_limit';
export type CodeComplexityReport = {
  version: 'code-complexity-1';
  algorithm: 'eslint_classic_syntax_approximation_v1';
  parser: { name: 'rolldown_oxc'; version: string };
  language: CodeLanguage | 'unknown';
  inference: 'syntax_only';
  algorithmicComplexity: 'not_inferred';
  taskDifficulty: 'not_inferred';
  sourceBytes: number | null;
  diagnosticCount: number | null;
  limits: typeof CODE_COMPLEXITY_LIMITS;
  rules: {
    nesting: 'if_loops_switch_catch_conditional_ast_depth';
    elseIf: 'nested_if';
    parameters: 'formal_parameters_excluding_typescript_this';
    calls: 'call_expression_nodes';
    module: 'outside_functions_and_implicit_scopes';
    typeSyntax: 'excluded';
    decorators: 'excluded';
    reachability: 'not_analyzed';
    quantiles: 'hyndman_fan_type_7';
  };
} & (
  | { status: 'measured'; reason: 'none'; metrics: Metrics }
  | { status: 'unavailable'; reason: UnavailableReason; metrics: null }
);

type Node = { type: string; [key: string]: unknown };
type Frame = { node: Node; scope: Scope; controlDepth: number; astDepth: number };
const require = createRequire(import.meta.url);
const languages = { javascript: 'js', typescript: 'ts', jsx: 'jsx', tsx: 'tsx' } as const;
const isNode = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && typeof (value as Node).type === 'string';
const emptyDecisions = () =>
  Object.fromEntries(codeDecisionKinds.map((kind) => [kind, 0])) as DecisionCounts;
const scope = (): Scope => ({
  decisions: emptyDecisions(),
  decisionCount: 0,
  maxControlNesting: 0,
  parameters: 0,
  callNodes: 0,
  constructionNodes: 0,
  taggedTemplateNodes: 0,
});
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const controls = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'CatchClause',
  'ConditionalExpression',
]);
const runtimeTypeScript = new Set([
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSInstantiationExpression',
  'TSParameterProperty',
  'TSEnumDeclaration',
  'TSEnumBody',
  'TSEnumMember',
  'TSModuleDeclaration',
  'TSModuleBlock',
  'TSExportAssignment',
  'TSImportEqualsDeclaration',
]);
const ignoredProperties = new Set([
  'typeAnnotation',
  'typeParameters',
  'typeArguments',
  'returnType',
  'implements',
  'superTypeArguments',
  'decorators',
  'comments',
  'parent',
  'loc',
  'range',
]);
const decisions: Record<string, DecisionKind> = {
  IfStatement: 'if',
  ForStatement: 'for',
  ForInStatement: 'for_in',
  ForOfStatement: 'for_of',
  WhileStatement: 'while',
  DoWhileStatement: 'do_while',
  CatchClause: 'catch',
  ConditionalExpression: 'conditional',
  AssignmentPattern: 'default_value',
};
function decision(node: Node): DecisionKind | undefined {
  if (node.type === 'SwitchCase') return node.test === null ? undefined : 'case';
  if (node.type === 'LogicalExpression')
    return ({ '&&': 'logical_and', '||': 'logical_or', '??': 'nullish' } as const)[
      node.operator as '&&'
    ];
  if (node.type === 'AssignmentExpression')
    return (
      {
        '&&=': 'logical_assignment_and',
        '||=': 'logical_assignment_or',
        '??=': 'nullish_assignment',
      } as const
    )[node.operator as '&&='];
  if (node.type === 'MemberExpression' && node.optional === true) return 'optional_member';
  if (node.type === 'CallExpression' && node.optional === true) return 'optional_call';
  return decisions[node.type];
}
function distribution(values: number[]): Distribution {
  const sorted = values.sort((a, b) => a - b),
    count = sorted.length;
  const sum = sorted.reduce((total, value) => total + value, 0);
  const quantile = (p: number) => {
    if (!count) return null;
    const at = (count - 1) * p,
      low = Math.floor(at);
    return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
  };
  return {
    count,
    sum,
    min: sorted[0] ?? null,
    median: quantile(0.5),
    p90: quantile(0.9),
    max: sorted.at(-1) ?? null,
    mean: count ? sum / count : null,
  };
}
function summarize(scopes: Scope[]): ScopeSummary {
  const counts = emptyDecisions();
  for (const item of scopes)
    for (const kind of codeDecisionKinds) counts[kind] += item.decisions[kind];
  return {
    count: scopes.length,
    decisions: counts,
    decisionCount: distribution(scopes.map((s) => s.decisionCount)),
    cyclomaticApproximation: distribution(scopes.map((s) => 1 + s.decisionCount)),
    controlNesting: distribution(scopes.map((s) => s.maxControlNesting)),
    parameters: distribution(scopes.map((s) => s.parameters)),
    callNodes: distribution(scopes.map((s) => s.callNodes)),
    constructionNodes: distribution(scopes.map((s) => s.constructionNodes)),
    taggedTemplateNodes: distribution(scopes.map((s) => s.taggedTemplateNodes)),
  };
}

/** Explicit local invocation only. No discovery, filesystem access to user files,
 * project resolution, execution, network requests, or automatic uploading. */
export function measureCodeComplexity(
  source: string,
  language: CodeLanguage,
): CodeComplexityReport {
  return measure(source, language);
}

function measure(
  source: string,
  language: CodeLanguage,
  collect?: (
    groups: {
      functions: Scope[];
      implicit: Scope[];
      module: Scope;
      fieldInitializers: number;
      staticBlocks: number;
    },
    parserVersion: string,
    sourceBytes: number,
  ) => void,
): CodeComplexityReport {
  let parserVersion = 'unavailable',
    sourceBytes: number | null = null;
  const validLanguage = typeof language === 'string' && Object.hasOwn(languages, language);
  const base = () => ({
    version: 'code-complexity-1' as const,
    algorithm: 'eslint_classic_syntax_approximation_v1' as const,
    parser: { name: 'rolldown_oxc' as const, version: parserVersion },
    language: validLanguage ? language : ('unknown' as const),
    inference: 'syntax_only' as const,
    algorithmicComplexity: 'not_inferred' as const,
    taskDifficulty: 'not_inferred' as const,
    sourceBytes,
    limits: CODE_COMPLEXITY_LIMITS,
    rules: {
      nesting: 'if_loops_switch_catch_conditional_ast_depth' as const,
      elseIf: 'nested_if' as const,
      parameters: 'formal_parameters_excluding_typescript_this' as const,
      calls: 'call_expression_nodes' as const,
      module: 'outside_functions_and_implicit_scopes' as const,
      typeSyntax: 'excluded' as const,
      decorators: 'excluded' as const,
      reachability: 'not_analyzed' as const,
      quantiles: 'hyndman_fan_type_7' as const,
    },
  });
  const unavailable = (
    reason: UnavailableReason,
    diagnosticCount: number | null = null,
  ): CodeComplexityReport => ({
    ...base(),
    status: 'unavailable',
    reason,
    diagnosticCount,
    metrics: null,
  });
  if (typeof source !== 'string') return unavailable('invalid_input');
  if (!validLanguage) return unavailable('unsupported_language');
  if (source.length > CODE_COMPLEXITY_LIMITS.inputBytes) return unavailable('input_too_large');
  sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > CODE_COMPLEXITY_LIMITS.inputBytes) return unavailable('input_too_large');
  let parse: typeof parseSource;
  try {
    // Lazy loading keeps the feature off until explicitly requested. TypeScript 7
    // no longer exposes the old in-memory parser; this parser already ships with Vite.
    parse = (require('rolldown/utils') as { parseSync: typeof parseSource }).parseSync;
    const version: unknown = require('rolldown/package.json').version;
    if (
      typeof parse !== 'function' ||
      typeof version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)
    )
      return unavailable('parser_unavailable');
    parserVersion = version;
  } catch {
    return unavailable('parser_unavailable');
  }
  try {
    const parsed = parse(`input.${languages[language]}`, source, {
      lang: languages[language],
      sourceType: 'unambiguous',
      preserveParens: false,
    });
    if (parsed.errors.length) return unavailable('parse_error', parsed.errors.length);
    const root = parsed.program as unknown as Node;
    if (!isNode(root) || root.type !== 'Program') return unavailable('parser_error');
    const module = scope(),
      explicit: Scope[] = [],
      implicit: Scope[] = [];
    let fieldInitializers = 0,
      staticBlocks = 0,
      scheduled = 0;
    const stack: Frame[] = [];
    const push = (node: unknown, owner: Scope, controlDepth: number, astDepth: number) => {
      if (!isNode(node)) return;
      if (
        ++scheduled > CODE_COMPLEXITY_LIMITS.astNodes ||
        astDepth > CODE_COMPLEXITY_LIMITS.astDepth
      )
        throw new RangeError('ast_limit');
      stack.push({ node, scope: owner, controlDepth, astDepth });
    };
    const newScope = (target: Scope[]) => {
      if (explicit.length + implicit.length >= CODE_COMPLEXITY_LIMITS.scopes)
        throw new RangeError('ast_limit');
      const value = scope();
      target.push(value);
      return value;
    };
    push(root, module, 0, 0);
    while (stack.length) {
      const frame = stack.pop()!;
      const node = frame.node;
      if (
        node.declare === true ||
        (node.type.startsWith('TS') && !runtimeTypeScript.has(node.type))
      )
        continue;
      let owner = frame.scope,
        depth = frame.controlDepth;
      if (functions.has(node.type)) {
        if (!isNode(node.body)) continue; // Signatures and overload declarations have no body.
        owner = newScope(explicit);
        depth = 0;
        const params = Array.isArray(node.params) ? node.params.filter(isNode) : [];
        const runtimeParams = params.filter((p) => !(p.type === 'Identifier' && p.name === 'this'));
        owner.parameters = runtimeParams.length;
        push(node.body, owner, 0, frame.astDepth + 1);
        for (const param of runtimeParams) push(param, owner, 0, frame.astDepth + 1);
        continue;
      }
      if (node.type === 'PropertyDefinition' || node.type === 'AccessorProperty') {
        if (node.computed === true) push(node.key, owner, depth, frame.astDepth + 1);
        if (isNode(node.value)) {
          const initializer = newScope(implicit);
          fieldInitializers++;
          push(node.value, initializer, 0, frame.astDepth + 1);
        }
        continue;
      }
      if (node.type === 'StaticBlock') {
        owner = newScope(implicit);
        staticBlocks++;
        depth = 0;
      }
      const kind = decision(node);
      if (kind) {
        owner.decisions[kind]++;
        owner.decisionCount++;
      }
      if (controls.has(node.type)) depth++;
      owner.maxControlNesting = Math.max(owner.maxControlNesting, depth);
      if (node.type === 'CallExpression') owner.callNodes++;
      if (node.type === 'NewExpression') owner.constructionNodes++;
      if (node.type === 'TaggedTemplateExpression') owner.taggedTemplateNodes++;
      for (const [key, value] of Object.entries(node)) {
        if (ignoredProperties.has(key)) continue;
        if (Array.isArray(value)) {
          for (const child of value) push(child, owner, depth, frame.astDepth + 1);
        } else push(value, owner, depth, frame.astDepth + 1);
      }
    }
    const all = [module, ...explicit, ...implicit];
    const { parameters: _, ...moduleMetrics } = module;
    collect?.(
      { functions: explicit, implicit, module, fieldInitializers, staticBlocks },
      parserVersion,
      sourceBytes,
    );
    return {
      ...base(),
      status: 'measured',
      reason: 'none',
      diagnosticCount: 0,
      metrics: {
        functionCount: explicit.length,
        functions: summarize(explicit),
        implicitScopes: { ...summarize(implicit), fieldInitializers, staticBlocks },
        module: moduleMetrics,
        totalCallNodes: all.reduce((sum, s) => sum + s.callNodes, 0),
        totalConstructionNodes: all.reduce((sum, s) => sum + s.constructionNodes, 0),
        totalTaggedTemplateNodes: all.reduce((sum, s) => sum + s.taggedTemplateNodes, 0),
      },
    };
  } catch (error) {
    // Never expose parser messages, code frames, offsets, file names, or source.
    return unavailable(
      error instanceof RangeError && error.message === 'ast_limit' ? 'ast_limit' : 'parser_error',
    );
  }
}

// Quantiles cannot be merged by averaging per-file medians or percentiles.
// Retain only numeric frequencies while each file's AST and scopes are released.
function numericDistribution() {
  const counts = new Map<number, number>();
  let count = 0,
    sum = 0;
  return {
    add(value: number) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      count++;
      sum += value;
    },
    result(): Distribution {
      const entries = [...counts].sort(([a], [b]) => a - b);
      const at = (index: number) => {
        let end = 0;
        for (const [value, frequency] of entries) {
          end += frequency;
          if (index < end) return value;
        }
        throw new Error('Missing measured rank');
      };
      const quantile = (p: number) => {
        if (!count) return null;
        const index = (count - 1) * p;
        const low = at(Math.floor(index));
        return low + (at(Math.ceil(index)) - low) * (index - Math.floor(index));
      };
      return {
        count,
        sum,
        min: entries[0]?.[0] ?? null,
        median: quantile(0.5),
        p90: quantile(0.9),
        max: entries.at(-1)?.[0] ?? null,
        mean: count ? sum / count : null,
      };
    },
  };
}

function scopeAccumulator() {
  const counts = emptyDecisions();
  const metrics = {
    decisionCount: numericDistribution(),
    cyclomaticApproximation: numericDistribution(),
    controlNesting: numericDistribution(),
    parameters: numericDistribution(),
    callNodes: numericDistribution(),
    constructionNodes: numericDistribution(),
    taggedTemplateNodes: numericDistribution(),
  };
  let count = 0;
  return {
    add(item: Scope) {
      count++;
      for (const kind of codeDecisionKinds) counts[kind] += item.decisions[kind];
      metrics.decisionCount.add(item.decisionCount);
      metrics.cyclomaticApproximation.add(1 + item.decisionCount);
      metrics.controlNesting.add(item.maxControlNesting);
      metrics.parameters.add(item.parameters);
      metrics.callNodes.add(item.callNodes);
      metrics.constructionNodes.add(item.constructionNodes);
      metrics.taggedTemplateNodes.add(item.taggedTemplateNodes);
    },
    result(): ScopeSummary {
      return {
        count,
        decisions: { ...counts },
        decisionCount: metrics.decisionCount.result(),
        cyclomaticApproximation: metrics.cyclomaticApproximation.result(),
        controlNesting: metrics.controlNesting.result(),
        parameters: metrics.parameters.result(),
        callNodes: metrics.callNodes.result(),
        constructionNodes: metrics.constructionNodes.result(),
        taggedTemplateNodes: metrics.taggedTemplateNodes.result(),
      };
    },
  };
}

/** Local collection accumulator. Callers bound selected files and total bytes.
 * No identifiers, source text, ASTs or per-file summaries are retained. */
export function createCodeMeasurementAccumulator() {
  const groups = new Map<
    CodeLanguage,
    {
      files: number;
      sourceBytes: number;
      parserVersion: string;
      functions: ReturnType<typeof scopeAccumulator>;
      implicit: ReturnType<typeof scopeAccumulator>;
      modules: ReturnType<typeof scopeAccumulator>;
      fieldInitializers: number;
      staticBlocks: number;
    }
  >();
  return {
    measure(source: string, language: CodeLanguage) {
      return measure(source, language, (measured, parserVersion, sourceBytes) => {
        let group = groups.get(language);
        if (!group) {
          group = {
            files: 0,
            sourceBytes: 0,
            parserVersion,
            functions: scopeAccumulator(),
            implicit: scopeAccumulator(),
            modules: scopeAccumulator(),
            fieldInitializers: 0,
            staticBlocks: 0,
          };
          groups.set(language, group);
        }
        group.files++;
        group.sourceBytes += sourceBytes;
        for (const item of measured.functions) group.functions.add(item);
        for (const item of measured.implicit) group.implicit.add(item);
        group.modules.add(measured.module);
        group.fieldInitializers += measured.fieldInitializers;
        group.staticBlocks += measured.staticBlocks;
      });
    },
    result() {
      return [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([language, group]) => {
          const functions = group.functions.result();
          const implicit = group.implicit.result();
          const modules = group.modules.result();
          // Splitting the same module across files must not add a claimed global
          // complexity baseline. There is no inter-file control-flow graph here.
          const { cyclomaticApproximation: _, parameters: __, ...moduleSummary } = modules;
          return {
            language,
            files: group.files,
            sourceBytes: group.sourceBytes,
            parser: { name: 'rolldown_oxc' as const, version: group.parserVersion },
            algorithm: 'eslint_classic_syntax_approximation_v1' as const,
            quantiles: 'hyndman_fan_type_7' as const,
            metrics: {
              functionCount: functions.count,
              functions,
              implicitScopes: {
                ...implicit,
                fieldInitializers: group.fieldInitializers,
                staticBlocks: group.staticBlocks,
              },
              moduleScopes: moduleSummary,
              totalCallNodes:
                functions.callNodes.sum + implicit.callNodes.sum + modules.callNodes.sum,
              totalConstructionNodes:
                functions.constructionNodes.sum +
                implicit.constructionNodes.sum +
                modules.constructionNodes.sum,
              totalTaggedTemplateNodes:
                functions.taggedTemplateNodes.sum +
                implicit.taggedTemplateNodes.sum +
                modules.taggedTemplateNodes.sum,
            },
          };
        });
    },
  };
}
