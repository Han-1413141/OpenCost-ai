import { parseCodeMeasurementReport } from './code-measurement-import.js';
import {
  CodeMeasurementObservationsSchema,
  type CodeMeasurementObservations,
  type CodeSnapshotObservation,
  type PatchObservation,
} from './code-observations-schema.js';

/** Explicit field projection. Raw UUIDs, time, debug bytes, rules and limits stay local. */
export function projectCodeReports(reports: unknown[]): CodeMeasurementObservations {
  const snapshots: CodeSnapshotObservation[] = [],
    patches: PatchObservation[] = [];
  for (const input of reports) {
    const r = parseCodeMeasurementReport(input);
    if (!r || r.status === 'disabled')
      throw new Error('代码报告无效或未开启测量，不能附加为已采集证据。');
    const source = 'unverified_client_program_report' as const;
    if (r.version === 'patch-measurement-1') {
      patches.push({
        kind: 'patch',
        sourceVersion: r.version,
        source,
        algorithm: r.algorithm,
        parser: { name: r.parser.name, version: r.parser.version },
        status: r.status,
        reason: r.reason,
        stage: r.stage,
        format: r.format,
        scope: r.scope ? { declared: r.scope.declared, coverage: r.scope.coverage } : null,
        generation: r.generation ? structuredClone(r.generation) : null,
        metrics: r.metrics ? structuredClone(r.metrics) : null,
      });
    } else if (r.version === 'python-code-measurement-1') {
      snapshots.push({
        kind: 'python_snapshot',
        sourceVersion: r.version,
        source,
        stage: r.stage,
        status: r.status,
        algorithm: r.algorithm,
        parser: {
          name: r.parser.name,
          version: r.parser.version,
          pythonVersion: r.parser.pythonVersion,
        },
        reason: r.reason,
        scope: r.scope
          ? {
              declared: r.scope.declared,
              coverage: r.scope.coverage,
              selectedEntries: r.scope.selectedEntries,
              measuredFiles: r.scope.measuredFiles,
              duplicateEntries: r.scope.duplicateEntries,
              unavailableEntries: r.scope.unavailableEntries,
            }
          : null,
        excluded: r.excluded ? structuredClone(r.excluded) : null,
        metrics: r.metrics ? structuredClone(r.metrics) : null,
      });
    } else {
      snapshots.push({
        kind: 'js_ts_snapshot',
        sourceVersion: r.version,
        source,
        stage: r.stage,
        status: r.status,
        scope: {
          declared: r.scope.declared,
          coverage: r.scope.coverage,
          selectedEntries: r.scope.selectedEntries,
          measuredFiles: r.scope.measuredFiles,
          duplicateEntries: r.scope.duplicateEntries,
          unavailableEntries: r.scope.unavailableEntries,
        },
        excluded: structuredClone(r.excluded),
        languageGroups: structuredClone(r.languageGroups).sort((a, b) =>
          a.language.localeCompare(b.language, 'en'),
        ),
      });
    }
  }
  // Canonical slots make local input order irrelevant without selecting a new snapshot.
  snapshots.sort((a, b) => `${a.kind}:${a.stage}`.localeCompare(`${b.kind}:${b.stage}`, 'en'));
  patches.sort((a, b) => a.stage.localeCompare(b.stage, 'en'));
  return CodeMeasurementObservationsSchema.parse({
    version: 'code-measurement-observations-1',
    binding: 'user_declared_task_and_requirement',
    inference: 'descriptive_only',
    snapshots,
    patches,
  });
}
