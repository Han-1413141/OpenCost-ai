import type { DifficultyAnchorMatrix } from './difficulty-calibration.js';

const rankTolerance = 1e-10;
type DesignReason =
  | 'model_factor_constant'
  | 'harness_factor_constant'
  | 'model_harness_graph_disconnected'
  | 'model_harness_task_design_rank_deficient'
  | 'unobserved_configuration'
  | 'unobserved_anchor'
  | 'multiple_configurations_per_model_harness';

function rank(rows: Float64Array[], columns: number): number {
  let pivotRow = 0;
  for (let column = 0; column < columns && pivotRow < rows.length; column++) {
    let best = pivotRow;
    for (let row = pivotRow + 1; row < rows.length; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[best][column])) best = row;
    if (Math.abs(rows[best][column]) <= rankTolerance) continue;
    [rows[pivotRow], rows[best]] = [rows[best], rows[pivotRow]];
    const pivot = rows[pivotRow];
    for (let row = pivotRow + 1; row < rows.length; row++) {
      const factor = rows[row][column] / pivot[column];
      rows[row][column] = 0;
      for (let next = column + 1; next < columns; next++) rows[row][next] -= factor * pivot[next];
    }
    pivotRow++;
  }
  return pivotRow;
}

function components(graph: Set<number>[]): number {
  const visited = new Set<number>();
  let count = 0;
  for (let root = 0; root < graph.length; root++) {
    if (visited.has(root)) continue;
    count++;
    visited.add(root);
    const queue = [root];
    for (let next = 0; next < queue.length; next++)
      for (const neighbor of graph[queue[next]]) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
  }
  return count;
}

function addGroup(groups: Map<string, Set<number>>, key: string, level: number) {
  if (!groups.has(key)) groups.set(key, new Set());
  groups.get(key)!.add(level);
}

/** Only called after the opt-in gate, schema validation and bounded-array checks. */
export function diagnoseCalibrationDesign(matrix: DifficultyAnchorMatrix) {
  const identities = matrix.configurations.map((configuration) => ({
    id: configuration.id,
    model: JSON.stringify([
      configuration.model.provider,
      configuration.model.model,
      configuration.model.version,
    ]),
    harness: JSON.stringify([configuration.harness.id, configuration.harness.version]),
  }));
  const models = [...new Set(identities.map((item) => item.model))].sort();
  const harnesses = [...new Set(identities.map((item) => item.harness))].sort();
  const anchors = matrix.anchors.map((item) => item.id).sort();
  const m = models.length,
    h = harnesses.length;
  // Fix one model and one Harness parameter to zero. These remove the two
  // location invariances of theta_model + theta_harness - beta_task.
  const columns = m - 1 + h - 1 + anchors.length;
  const modelIndex = new Map(models.map((key, index) => [key, index]));
  const harnessIndex = new Map(harnesses.map((key, index) => [key, index]));
  const anchorIndex = new Map(anchors.map((key, index) => [key, index]));
  const configurations = new Map(
    identities.map((item) => [
      item.id,
      {
        model: modelIndex.get(item.model)!,
        harness: harnessIndex.get(item.harness)!,
      },
    ]),
  );
  const observedConfigurations = new Set<string>(),
    observedAnchors = new Set<string>();
  const pairs = new Map<string, Set<string>>();
  const uniqueRows = new Map<string, Float64Array>();
  const graph = Array.from({ length: m + h }, () => new Set<number>());
  const modelAnchorGroups = new Map<string, Set<number>>();
  const harnessAnchorGroups = new Map<string, Set<number>>();
  for (const cell of matrix.cells) {
    const { model, harness } = configurations.get(cell.configurationId)!;
    const anchor = anchorIndex.get(cell.anchorId)!;
    observedConfigurations.add(cell.configurationId);
    observedAnchors.add(cell.anchorId);
    const pair = JSON.stringify([model, harness]);
    if (!pairs.has(pair)) pairs.set(pair, new Set());
    pairs.get(pair)!.add(cell.configurationId);
    graph[model].add(m + harness);
    graph[m + harness].add(model);
    addGroup(modelAnchorGroups, JSON.stringify([model, anchor]), harness);
    addGroup(harnessAnchorGroups, JSON.stringify([harness, anchor]), model);
    const key = JSON.stringify([model, harness, anchor]);
    if (uniqueRows.has(key)) continue;
    const row = new Float64Array(columns);
    if (model > 0) row[model - 1] = 1;
    if (harness > 0) row[m - 1 + harness - 1] = 1;
    row[m - 1 + h - 1 + anchor] = -1;
    uniqueRows.set(key, row);
  }
  const designRank = rank(
    [...uniqueRows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row),
    columns,
  );
  const connectedComponents = components(graph);
  const variantPairs = [...pairs.values()].filter((items) => items.size > 1).length;
  const reasons: DesignReason[] = [];
  if (m < 2) reasons.push('model_factor_constant');
  if (h < 2) reasons.push('harness_factor_constant');
  if (connectedComponents > 1) reasons.push('model_harness_graph_disconnected');
  if (designRank < columns) reasons.push('model_harness_task_design_rank_deficient');
  if (observedConfigurations.size < matrix.configurations.length)
    reasons.push('unobserved_configuration');
  if (observedAnchors.size < anchors.length) reasons.push('unobserved_anchor');
  if (variantPairs) reasons.push('multiple_configurations_per_model_harness');
  return {
    version: 'calibration-design-1' as const,
    use: 'local_design_diagnostic_only' as const,
    hypotheticalModel: 'logit_p_equals_model_plus_harness_minus_task' as const,
    modelHarnessEffects: 'not_estimated' as const,
    configurationEffects: 'not_controlled_in_hypothetical_design' as const,
    assessment:
      designRank === columns
        ? ('additive_design_full_rank' as const)
        : ('additive_design_rank_deficient' as const),
    reasons,
    counts: {
      declaredModels: m,
      declaredHarnesses: h,
      declaredAnchors: anchors.length,
      observedConfigurations: observedConfigurations.size,
      unobservedConfigurations: matrix.configurations.length - observedConfigurations.size,
      observedAnchors: observedAnchors.size,
      observedCells: matrix.cells.length,
      distinctModelHarnessTaskCells: uniqueRows.size,
      observedModelHarnessPairs: pairs.size,
      possibleModelHarnessPairs: m * h,
      modelHarnessConnectedComponents: connectedComponents,
      pairsWithMultipleConfigurations: variantPairs,
      // Counts of matched groups, not independent samples or effect estimates.
      sameModelTaskGroupsWithMultipleHarnesses: [...modelAnchorGroups.values()].filter(
        (items) => items.size > 1,
      ).length,
      sameHarnessTaskGroupsWithMultipleModels: [...harnessAnchorGroups.values()].filter(
        (items) => items.size > 1,
      ).length,
    },
    additiveDesign: {
      columnsAfterTwoLocationConstraints: columns,
      rank: designRank,
      unresolvedDimensions: columns - designRank,
      method: 'partial_pivot_gaussian_elimination' as const,
      tolerance: rankTolerance,
      weighting: 'distinct_observed_cells_no_success_or_trial_weight' as const,
    },
    limitations: [
      'full_rank_does_not_establish_precision_or_calibration',
      'constant_factor_has_no_estimable_between_level_contrast',
      'common_protocol_and_configuration_equivalence_not_verified',
      'model_harness_interactions_not_estimated',
      'not_causal_attribution_or_permission_to_split_configuration_theta',
    ],
  };
}

export type CalibrationDesignDiagnostic = ReturnType<typeof diagnoseCalibrationDesign>;
