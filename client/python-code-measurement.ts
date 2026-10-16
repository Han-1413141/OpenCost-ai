import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, type BigIntStats } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PythonHelperResultSchema,
  PythonMeasurementManifestSchema,
  pythonMeasurementReasons,
  PYTHON_CODE_LIMITS,
  pythonCodeRules,
  type PythonCodeMeasurement,
} from '../shared/python-code-measurement-schema.js';
import { readLocalTextSync } from './local-file.js';

export const PYTHON_MEASUREMENT_LIMITS = PYTHON_CODE_LIMITS;
export type { PythonCodeMeasurement } from '../shared/python-code-measurement-schema.js';
type Options = { enabled?: boolean; python?: string };
const rules = pythonCodeRules;
function empty(
  status: PythonCodeMeasurement['status'],
  reason: PythonCodeMeasurement['reason'],
): PythonCodeMeasurement {
  return {
    version: 'python-code-measurement-1',
    language: 'python',
    algorithm: 'radon_6_0_1_named_function_cc_v1',
    status,
    reason,
    parser: { name: 'python_ast_radon', version: '6.0.1', pythonVersion: null },
    measuredAt: null,
    requirementRevision: null,
    stage: 'unknown',
    scope: null,
    knownInputBytesRead: null,
    inputReadBudgetUsed: null,
    excluded: null,
    metrics: null,
    limits: PYTHON_MEASUREMENT_LIMITS,
    rules,
    stageBasis: 'user_declaration',
    snapshotConsistency: 'per_file_checked_not_atomic_project_snapshot',
    taskDifficulty: 'not_inferred',
    algorithmicComplexity: 'not_inferred',
    codeQuality: 'not_inferred',
  };
}
function runtime(options: Options) {
  if (!options.python) return 'runtime_not_selected';
  if (
    !isAbsolute(options.python) ||
    (process.platform === 'win32' && !options.python.toLowerCase().endsWith('.exe'))
  )
    return 'invalid_runtime';
  try {
    if (!lstatSync(realpathSync(options.python)).isFile()) return 'runtime_unavailable';
  } catch {
    return 'runtime_unavailable';
  }
  return null;
}
function analyze(
  files: string[],
  base: string,
  meta: {
    revision: string | null;
    stage: PythonCodeMeasurement['stage'];
    scope: NonNullable<PythonCodeMeasurement['scope']>['declared'];
  },
  options: Options,
): PythonCodeMeasurement {
  const result = empty('unavailable', 'none'),
    excluded = Object.fromEntries(pythonMeasurementReasons.map((r) => [r, 0])) as NonNullable<
      PythonCodeMeasurement['excluded']
    >;
  result.requirementRevision = meta.revision;
  result.stage = meta.stage;
  result.knownInputBytesRead = 0;
  result.excluded = excluded;
  const seen = new Set<string>(),
    sources: string[] = [];
  let reserved = 0;
  for (const selected of files) {
    const path = resolve(base, selected);
    let before: BigIntStats;
    try {
      before = lstatSync(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink()) throw new Error();
    } catch {
      excluded.source_unavailable++;
      continue;
    }
    let key: string;
    try {
      key = before.ino === 0n ? realpathSync(path) : `${before.dev}:${before.ino}`;
    } catch {
      excluded.source_unavailable++;
      continue;
    }
    if (seen.has(key)) {
      excluded.duplicate_file++;
      continue;
    }
    seen.add(key);
    if (before.size > BigInt(PYTHON_MEASUREMENT_LIMITS.perFileBytes)) {
      excluded.input_too_large++;
      continue;
    }
    const size = Number(before.size),
      limit = Math.max(1, size),
      budget = limit + 1;
    if (reserved + budget > PYTHON_MEASUREMENT_LIMITS.totalInputBytes) {
      excluded.total_input_limit++;
      continue;
    }
    reserved += budget;
    try {
      const source = readLocalTextSync(path, limit),
        after = lstatSync(path, { bigint: true });
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs ||
        !after.isFile() ||
        after.isSymbolicLink()
      ) {
        excluded.source_changed++;
        continue;
      }
      result.knownInputBytesRead += size;
      reserved -= budget - size;
      sources.push(source);
    } catch {
      excluded.source_unavailable++;
    }
  }
  const finish = (measured: number) => {
    const unavailable = files.length - measured - excluded.duplicate_file;
    result.scope = {
      declared: meta.scope,
      coverage: measured === 0 ? 'unknown' : unavailable ? 'partial' : meta.scope,
      selectedEntries: files.length,
      measuredFiles: measured,
      duplicateEntries: excluded.duplicate_file,
      unavailableEntries: unavailable,
    };
    result.measuredAt = new Date().toISOString();
    result.inputReadBudgetUsed = reserved;
    return result;
  };
  if (!sources.length) {
    result.reason = 'no_measured_sources';
    return finish(0);
  }
  const input = JSON.stringify({ format: 'opencost-python-input-1', sources });
  if (Buffer.byteLength(input) > PYTHON_MEASUREMENT_LIMITS.transportBytes) {
    result.reason = 'transport_limit';
    return finish(0);
  }
  const helper = fileURLToPath(new URL('./python-code-helper.py', import.meta.url));
  const vendor = fileURLToPath(new URL('../third_party/radon-6.0.1/', import.meta.url));
  try {
    const manifest = JSON.parse(readFileSync(resolve(vendor, 'SOURCE.json'), 'utf8'));
    if (
      manifest.sha256 !== '632cc032364a6f8bb1010a2f6a12d0f14bc7e5ede76585ef29dc0cecf4cd8859' ||
      manifest.version !== '6.0.1' ||
      !Array.isArray(manifest.includedFiles) ||
      manifest.includedFiles.length !== 5
    )
      throw new Error();
    const allowed = new Set([
      'radon/__init__.py',
      'radon/visitors.py',
      'radon/raw.py',
      'radon/complexity.py',
      'LICENSE',
    ]);
    for (const entry of manifest.includedFiles) {
      if (
        !allowed.delete(entry.path) ||
        createHash('sha256')
          .update(readFileSync(resolve(vendor, entry.path)))
          .digest('hex') !== entry.sha256
      )
        throw new Error();
    }
    if (allowed.size) throw new Error();
  } catch {
    result.reason = 'tool_unavailable';
    return finish(0);
  }
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'])
    if (process.env[key]) env[key] = process.env[key];
  const call = spawnSync(options.python!, ['-I', '-S', '-B', '-X', 'utf8', helper], {
    input,
    encoding: 'utf8',
    cwd: dirname(helper),
    env,
    windowsHide: true,
    shell: false,
    timeout: PYTHON_MEASUREMENT_LIMITS.timeoutMs,
    maxBuffer: PYTHON_MEASUREMENT_LIMITS.outputBytes,
    killSignal: 'SIGKILL',
  });
  if (call.error || call.status !== 0) {
    result.reason =
      (call.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
        ? 'runtime_timeout'
        : 'runtime_failed';
    return finish(0);
  }
  let parsed;
  try {
    parsed = PythonHelperResultSchema.safeParse(JSON.parse(call.stdout));
  } catch {
    result.reason = 'invalid_runtime_output';
    return finish(0);
  }
  if (!parsed.success || parsed.data.results.length !== sources.length) {
    result.reason = 'invalid_runtime_output';
    return finish(0);
  }
  const data = parsed.data;
  for (const file of data.results) if (file.reason !== 'none') excluded[file.reason]++;
  result.parser.pythonVersion = data.pythonVersion;
  result.metrics = data.metrics;
  result.status =
    data.measuredFiles === 0
      ? 'unavailable'
      : files.length - data.measuredFiles - excluded.duplicate_file > 0
        ? 'partial'
        : 'measured';
  result.reason = data.measuredFiles === 0 ? 'no_measured_sources' : 'none';
  return finish(data.measuredFiles);
}
export function measurePythonFile(file: string, options: Options = {}): PythonCodeMeasurement {
  if (options.enabled !== true) return empty('disabled', 'not_enabled');
  const reason = runtime(options);
  if (reason) return empty('unavailable', reason);
  return analyze(
    [file],
    process.cwd(),
    { revision: null, stage: 'unknown', scope: 'unknown' },
    options,
  );
}
export function measurePythonSet(
  manifestPath: string,
  options: Options = {},
): PythonCodeMeasurement {
  if (options.enabled !== true) return empty('disabled', 'not_enabled');
  const reason = runtime(options);
  if (reason) return empty('unavailable', reason);
  const path = resolve(manifestPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readLocalTextSync(path, PYTHON_MEASUREMENT_LIMITS.manifestBytes));
  } catch {
    return empty('unavailable', 'invalid_manifest');
  }
  const parsed = PythonMeasurementManifestSchema.safeParse(raw);
  if (!parsed.success) return empty('unavailable', 'invalid_manifest');
  const input = parsed.data;
  return analyze(
    input.files,
    dirname(path),
    { revision: input.requirementRevision, stage: input.stage, scope: input.scope },
    options,
  );
}
