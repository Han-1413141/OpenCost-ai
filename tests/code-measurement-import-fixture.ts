import { createCodeMeasurementAccumulator } from '../client/code-complexity.js';
export const codeRevision = 'd2a2a61f-dd81-43ed-9a6d-90ee20d5a54e';
export function codeReportFixture(
  source = 'function private_simple() {}',
  stage: 'before_execution' | 'after_execution' = 'before_execution',
) {
  const acc = createCodeMeasurementAccumulator();
  const measured = acc.measure(source, 'typescript');
  if (measured.status !== 'measured') throw new Error('Fixture parser unavailable');
  const languageGroups = acc.result();
  return {
    version: 'code-measurement-set-1' as const,
    status: 'measured' as 'measured' | 'partial' | 'unavailable',
    measuredAt: '2026-10-15T04:00:00.000Z',
    requirementRevision: codeRevision,
    stage,
    stageBasis: 'user_declaration' as const,
    scope: {
      declared: 'complete' as 'complete' | 'partial' | 'unknown',
      basis: 'user_selected_manifest' as const,
      coverage: 'complete' as 'complete' | 'partial' | 'unknown',
      selectedEntries: 1,
      measuredFiles: 1,
      duplicateEntries: 0,
      unavailableEntries: 0,
    },
    knownInputBytesRead: Buffer.byteLength(source),
    inputReadBudgetUsed: Buffer.byteLength(source),
    snapshotConsistency: 'per_file_checked_not_atomic_project_snapshot' as const,
    excluded: {
      duplicate_file: 0,
      unsupported_language: 0,
      source_unavailable: 0,
      source_changed: 0,
      input_too_large: 0,
      total_input_limit: 0,
      parser_unavailable: 0,
      parse_error: 0,
      parser_error: 0,
      ast_limit: 0,
      invalid_input: 0,
    },
    limits: { manifestBytes: 65536, entries: 64, totalInputBytes: 8388608, perFileBytes: 1048576 },
    languageGroups,
    inference: 'syntax_only' as const,
    taskDifficulty: 'not_inferred' as const,
    algorithmicComplexity: 'not_inferred' as const,
    independentVerification: 'not_verified' as const,
  };
}
