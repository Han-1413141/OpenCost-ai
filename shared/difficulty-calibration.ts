import { z } from 'zod';
import {
  diagnoseCalibrationDesign,
  type CalibrationDesignDiagnostic,
} from './calibration-design.js';

// Opt-in, local research only. This module has no collector, database or network dependency.
export const DIFFICULTY_CALIBRATION_VERSION = 'difficulty-calibration-research-2' as const;
export const calibrationLimits = {
  configurations: 16,
  anchors: 64,
  cells: 1024,
  trialsPerCell: 1000,
  totalTrials: 1_000_000,
  iterations: 100,
} as const;

const publicId = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/);
const versionedId = z.object({ id: publicId, version: publicId }).strict();
const referenceUrl = z
  .string()
  .max(500)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }, 'Only a public HTTPS reference without credentials, query or fragment is allowed');

export const DifficultyAnchorMatrixSchema = z
  .object({
    version: z.literal('difficulty-anchor-matrix-1'),
    reference: z
      .object({
        dataset: publicId,
        datasetVersion: publicId,
        url: referenceUrl,
        manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
        declaredProvenance: z.enum([
          'public_benchmark',
          'published_study',
          'unverified_public_declaration',
        ]),
        repetitions: z.enum(['declared_distinct_runs', 'unknown']),
      })
      .strict(),
    // One common domain and one frozen measurement protocol per fit.
    scope: z
      .object({
        domain: publicId,
        rubricVersion: publicId,
        validatorVersion: publicId,
        taskProtocolVersion: publicId,
        requirementsVersion: publicId,
      })
      .strict(),
    configurations: z
      .array(
        z
          .object({
            id: publicId,
            model: z.object({ provider: publicId, model: publicId, version: publicId }).strict(),
            harness: versionedId,
            configurationVersion: publicId,
          })
          .strict(),
      )
      .min(2)
      .max(calibrationLimits.configurations),
    anchors: z
      .array(z.object({ id: publicId, taskFamily: publicId }).strict())
      .min(2)
      .max(calibrationLimits.anchors),
    cells: z
      .array(
        z
          .object({
            configurationId: publicId,
            anchorId: publicId,
            successes: z.number().int().min(0).max(calibrationLimits.trialsPerCell),
            trials: z.number().int().min(1).max(calibrationLimits.trialsPerCell),
          })
          .strict()
          .refine((cell) => cell.successes <= cell.trials, 'Successes cannot exceed trials'),
      )
      .min(1)
      .max(calibrationLimits.cells),
  })
  .strict()
  .superRefine((matrix, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const configurations = new Set(matrix.configurations.map((item) => item.id));
    const anchors = new Set(matrix.anchors.map((item) => item.id));
    if (configurations.size !== matrix.configurations.length) fail('Duplicate configuration ID');
    if (anchors.size !== matrix.anchors.length) fail('Duplicate anchor ID');
    const identities = matrix.configurations.map(({ model, harness, configurationVersion }) =>
      JSON.stringify([
        model.provider,
        model.model,
        model.version,
        harness.id,
        harness.version,
        configurationVersion,
      ]),
    );
    if (new Set(identities).size !== identities.length)
      fail('Duplicate model and harness configuration identity');
    const cells = new Set<string>();
    let trials = 0;
    for (const cell of matrix.cells) {
      if (!configurations.has(cell.configurationId) || !anchors.has(cell.anchorId))
        fail('Unknown cell reference');
      const key = JSON.stringify([cell.configurationId, cell.anchorId]);
      if (cells.has(key)) fail('Duplicate response cell; aggregate declared distinct runs once');
      cells.add(key);
      trials += cell.trials;
    }
    if (trials > calibrationLimits.totalTrials)
      fail('Total trials exceed research computation limit');
  });

export type DifficultyAnchorMatrix = z.infer<typeof DifficultyAnchorMatrixSchema>;
const OptionsSchema = z
  .object({
    enabled: z.literal(true),
    lambda: z.number().finite().min(0.001).max(1000).default(1),
    maxIterations: z.number().int().min(1).max(calibrationLimits.iterations).default(60),
    tolerance: z.number().finite().min(1e-10).max(1e-4).default(1e-7),
  })
  .strict();
export type CalibrationOptions = {
  enabled?: boolean;
  lambda?: number;
  maxIterations?: number;
  tolerance?: number;
};
type Boundary = 'all_success' | 'all_failure' | null;
type IndexedCell = { configuration: number; anchor: number; successes: number; trials: number };
type Totals = { successes: number; trials: number; cells: number };
type Counts = {
  distinctAnchors: number;
  configurations: number;
  taskFamilies: number;
  cells: number;
  trials: number;
  successes: number;
};
type Diagnostics = {
  converged: boolean;
  iterations: number;
  projectedGradientMax: number;
  penalizedLoss: number;
  tolerance: number;
  stopReason: 'gradient_tolerance' | 'iteration_limit' | 'line_search_failed' | 'numerical_failure';
};
const limitations = [
  'within_domain_reference_configuration_only',
  'reference_and_distinct_runs_not_verified',
  'training_only_no_holdout_no_confidence_intervals',
  'task_family_and_repeat_correlation_not_estimated',
  'one_dimensional_rasch_assumptions_not_validated',
  'regularization_is_not_observational_evidence',
  'not_a_production_difficulty_grade_or_cross_domain_ranking',
] as const;
type Common = {
  version: typeof DIFFICULTY_CALIBRATION_VERSION;
  counts: Counts;
  scope: DifficultyAnchorMatrix['scope'];
  reference: DifficultyAnchorMatrix['reference'] & { verification: 'not_verified_by_this_module' };
  lambda: number;
  identification: 'mean_configuration_theta_zero';
  referenceProbabilityBasis: 'hypothetical_zero_theta_not_mean_probability_or_real_configuration';
  limitations: typeof limitations;
  designDiagnostics: CalibrationDesignDiagnostic;
};
export type DifficultyCalibrationResult =
  | { version: typeof DIFFICULTY_CALIBRATION_VERSION; status: 'disabled' }
  | { version: typeof DIFFICULTY_CALIBRATION_VERSION; status: 'invalid'; issues: string[] }
  | (Common & {
      status: 'insufficient';
      reasons: (
        | 'anchor_requires_two_configurations'
        | 'configuration_requires_two_anchors'
        | 'disconnected_response_graph'
        | 'requires_success_and_failure'
      )[];
    })
  | (Common & { status: 'not_converged'; diagnostics: Diagnostics })
  | (Common & {
      status: 'fitted';
      use: 'local_research_only';
      diagnostics: Diagnostics;
      configurations: {
        id: string;
        observations: Totals;
        boundary: Boundary;
        theta: number | null;
      }[];
      anchors: {
        id: string;
        taskFamily: string;
        observations: Totals;
        boundary: Boundary;
        difficulty: { relativeLogit: number; referenceSuccessProbability: number } | null;
      }[];
      trainingMetrics: {
        scope: 'training_only';
        logLoss: number;
        brierScore: number;
        validation: 'not_validated';
      };
    });

function sigmoid(value: number) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}
function softplus(value: number) {
  return Math.max(value, 0) + Math.log1p(Math.exp(-Math.abs(value)));
}
export function raschSuccessProbability(theta: number, beta: number): number {
  if (!Number.isFinite(theta) || !Number.isFinite(beta))
    throw new RangeError('Finite logits required');
  return sigmoid(theta - beta);
}
function boundary(value: Totals): Boundary {
  return value.successes === 0
    ? 'all_failure'
    : value.successes === value.trials
      ? 'all_success'
      : null;
}
function loss(x: Float64Array, cells: IndexedCell[], configurations: number, lambda: number) {
  let value = 0;
  for (const cell of cells) {
    const logit = x[cell.configuration] - x[configurations + cell.anchor];
    // Equivalent to n*softplus(logit)-successes*logit, without cancellation.
    value += cell.successes * softplus(-logit) + (cell.trials - cell.successes) * softplus(logit);
  }
  for (const item of x) value += (lambda / 2) * item * item;
  return value;
}
function derivatives(
  x: Float64Array,
  cells: IndexedCell[],
  configurations: number,
  lambda: number,
) {
  const n = x.length;
  const gradient = Float64Array.from(x, (item) => lambda * item);
  const hessian = new Float64Array(n * n);
  for (let index = 0; index < n; index++) hessian[index * n + index] = lambda;
  for (const cell of cells) {
    const a = cell.configuration,
      b = configurations + cell.anchor;
    const p = sigmoid(x[a] - x[b]);
    const residual = cell.trials * p - cell.successes;
    const weight = cell.trials * p * (1 - p);
    gradient[a] += residual;
    gradient[b] -= residual;
    hessian[a * n + a] += weight;
    hessian[b * n + b] += weight;
    hessian[a * n + b] -= weight;
    hessian[b * n + a] -= weight;
  }
  let mean = 0;
  for (let index = 0; index < configurations; index++) mean += gradient[index] / configurations;
  let projectedGradientMax = 0;
  for (let index = 0; index < n; index++)
    projectedGradientMax = Math.max(
      projectedGradientMax,
      Math.abs(gradient[index] - (index < configurations ? mean : 0)),
    );
  return { gradient, hessian, projectedGradientMax };
}
function cholesky(matrix: Float64Array, n: number): Float64Array | null {
  const lower = new Float64Array(n * n);
  for (let row = 0; row < n; row++)
    for (let column = 0; column <= row; column++) {
      let value = matrix[row * n + column];
      for (let index = 0; index < column; index++)
        value -= lower[row * n + index] * lower[column * n + index];
      if (row === column) {
        if (!(value > 0) || !Number.isFinite(value)) return null;
        lower[row * n + column] = Math.sqrt(value);
      } else lower[row * n + column] = value / lower[column * n + column];
    }
  return lower;
}
function solve(lower: Float64Array, rhs: Float64Array): Float64Array {
  const n = rhs.length,
    result = new Float64Array(n);
  for (let row = 0; row < n; row++) {
    let value = rhs[row];
    for (let column = 0; column < row; column++) value -= lower[row * n + column] * result[column];
    result[row] = value / lower[row * n + row];
  }
  for (let row = n - 1; row >= 0; row--) {
    let value = result[row];
    for (let column = row + 1; column < n; column++)
      value -= lower[column * n + row] * result[column];
    result[row] = value / lower[row * n + row];
  }
  return result;
}

/** Explicitly enabled inputs must be public anchor matrices, never inferred private task labels. */
export function calibrateDifficulty(
  input: unknown,
  options?: CalibrationOptions,
): DifficultyCalibrationResult {
  const version = DIFFICULTY_CALIBRATION_VERSION;
  // Keep this before all parsing, enumeration, getters or coercion of input.
  if (options?.enabled !== true) return { version, status: 'disabled' };
  const parsedOptions = OptionsSchema.safeParse(options);
  if (!parsedOptions.success)
    return {
      version,
      status: 'invalid',
      issues: parsedOptions.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  // Zod's array maximum validates size but still visits entries. Reject large arrays first.
  if (input !== null && typeof input === 'object') {
    for (const [key, maximum] of [
      ['configurations', calibrationLimits.configurations],
      ['anchors', calibrationLimits.anchors],
      ['cells', calibrationLimits.cells],
    ] as const) {
      const value = (input as Record<string, unknown>)[key];
      if (Array.isArray(value) && value.length > maximum)
        return {
          version,
          status: 'invalid',
          issues: [`${key}: research computation limit exceeded`],
        };
    }
  }
  const parsed = DifficultyAnchorMatrixSchema.safeParse(input);
  if (!parsed.success)
    return {
      version,
      status: 'invalid',
      issues: parsed.error.issues
        .slice(0, 20)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  const matrix = parsed.data;
  const { lambda, tolerance, maxIterations } = parsedOptions.data;
  const c = matrix.configurations.length,
    a = matrix.anchors.length,
    n = c + a;
  const configurationIndex = new Map(matrix.configurations.map((item, index) => [item.id, index]));
  const anchorIndex = new Map(matrix.anchors.map((item, index) => [item.id, index]));
  const cells = matrix.cells.map((cell): IndexedCell => ({
    configuration: configurationIndex.get(cell.configurationId)!,
    anchor: anchorIndex.get(cell.anchorId)!,
    successes: cell.successes,
    trials: cell.trials,
  }));
  const observations: Totals[] = Array.from({ length: n }, () => ({
    successes: 0,
    trials: 0,
    cells: 0,
  }));
  const graph: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const cell of cells) {
    const task = c + cell.anchor;
    graph[cell.configuration].add(task);
    graph[task].add(cell.configuration);
    for (const index of [cell.configuration, task]) {
      observations[index].successes += cell.successes;
      observations[index].trials += cell.trials;
      observations[index].cells++;
    }
  }
  const trials = cells.reduce((sum, cell) => sum + cell.trials, 0);
  const successes = cells.reduce((sum, cell) => sum + cell.successes, 0);
  const common: Common = {
    version,
    counts: {
      distinctAnchors: a,
      configurations: c,
      taskFamilies: new Set(matrix.anchors.map((item) => item.taskFamily)).size,
      cells: cells.length,
      trials,
      successes,
    },
    scope: matrix.scope,
    reference: { ...matrix.reference, verification: 'not_verified_by_this_module' },
    lambda,
    identification: 'mean_configuration_theta_zero',
    referenceProbabilityBasis: 'hypothetical_zero_theta_not_mean_probability_or_real_configuration',
    limitations,
    designDiagnostics: diagnoseCalibrationDesign(matrix),
  };
  const reasons: Extract<DifficultyCalibrationResult, { status: 'insufficient' }>['reasons'] = [];
  if (graph.slice(c).some((neighbors) => neighbors.size < 2))
    reasons.push('anchor_requires_two_configurations');
  if (graph.slice(0, c).some((neighbors) => neighbors.size < 2))
    reasons.push('configuration_requires_two_anchors');
  const visited = new Set([0]),
    queue = [0];
  for (let index = 0; index < queue.length; index++)
    for (const neighbor of graph[queue[index]]) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  if (visited.size !== n) reasons.push('disconnected_response_graph');
  if (successes === 0 || successes === trials) reasons.push('requires_success_and_failure');
  if (reasons.length) return { ...common, status: 'insufficient', reasons };

  let x = new Float64Array(n),
    objective = loss(x, cells, c, lambda),
    iterations = 0;
  let stopReason: Diagnostics['stopReason'] = 'iteration_limit';
  const constraint = Float64Array.from({ length: n }, (_, index) => (index < c ? 1 : 0));
  for (; iterations < maxIterations; iterations++) {
    const { gradient, hessian, projectedGradientMax } = derivatives(x, cells, c, lambda);
    if (projectedGradientMax <= tolerance) {
      stopReason = 'gradient_tolerance';
      break;
    }
    const lower = cholesky(hessian, n);
    if (!lower) {
      stopReason = 'numerical_failure';
      break;
    }
    const u = solve(lower, gradient),
      v = solve(lower, constraint);
    let numerator = 0,
      denominator = 0;
    for (let index = 0; index < c; index++) {
      numerator += u[index];
      denominator += v[index];
    }
    const direction = Float64Array.from(
      u,
      (item, index) => -item + (v[index] * numerator) / denominator,
    );
    let slope = 0;
    for (let index = 0; index < n; index++) slope += gradient[index] * direction[index];
    if (!Number.isFinite(slope) || slope >= 0) {
      stopReason = 'numerical_failure';
      break;
    }
    let accepted = false;
    for (let backtrack = 0; backtrack < 24; backtrack++) {
      const step = 2 ** -backtrack;
      const candidate = Float64Array.from(x, (item, index) => item + step * direction[index]);
      // Remove only floating-point constraint drift; the direction already solves the KKT system.
      let mean = 0;
      for (let index = 0; index < c; index++) mean += candidate[index] / c;
      for (let index = 0; index < c; index++) candidate[index] -= mean;
      const candidateLoss = loss(candidate, cells, c, lambda);
      if (
        Number.isFinite(candidateLoss) &&
        candidateLoss <= objective + 1e-4 * step * slope + 1e-12 * Math.max(1, objective)
      ) {
        x = candidate;
        objective = candidateLoss;
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      stopReason = 'line_search_failed';
      break;
    }
  }
  const residual = derivatives(x, cells, c, lambda).projectedGradientMax;
  const converged = Number.isFinite(residual) && residual <= tolerance;
  if (converged) stopReason = 'gradient_tolerance';
  const diagnostics: Diagnostics = {
    converged,
    iterations,
    projectedGradientMax: residual,
    penalizedLoss: objective,
    tolerance,
    stopReason,
  };
  if (!converged) return { ...common, status: 'not_converged', diagnostics };
  let logLoss = 0,
    brier = 0;
  for (const cell of cells) {
    const logit = x[cell.configuration] - x[c + cell.anchor],
      probability = sigmoid(logit);
    logLoss += cell.successes * softplus(-logit) + (cell.trials - cell.successes) * softplus(logit);
    // Trial-level Brier score, not squared error against an aggregated success fraction.
    brier +=
      cell.successes * (1 - probability) ** 2 + (cell.trials - cell.successes) * probability ** 2;
  }
  return {
    ...common,
    status: 'fitted',
    use: 'local_research_only',
    diagnostics,
    configurations: matrix.configurations.map((item, index) => ({
      id: item.id,
      observations: observations[index],
      boundary: boundary(observations[index]),
      theta: boundary(observations[index]) ? null : x[index],
    })),
    anchors: matrix.anchors.map((item, index) => ({
      ...item,
      observations: observations[c + index],
      boundary: boundary(observations[c + index]),
      difficulty: boundary(observations[c + index])
        ? null
        : { relativeLogit: x[c + index], referenceSuccessProbability: sigmoid(-x[c + index]) },
    })),
    trainingMetrics: {
      scope: 'training_only',
      logLoss: logLoss / trials,
      brierScore: brier / trials,
      validation: 'not_validated',
    },
  };
}
