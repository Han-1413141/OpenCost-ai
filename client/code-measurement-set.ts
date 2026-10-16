import { lstatSync, realpathSync, type BigIntStats } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { readLocalTextSync } from './local-file.js';
import { CODE_COMPLEXITY_LIMITS, createCodeMeasurementAccumulator } from './code-complexity.js';

export const CODE_MEASUREMENT_SET_LIMITS = Object.freeze({
  manifestBytes: 64 * 1024,
  entries: 64,
  totalInputBytes: 8 * 1024 * 1024,
  perFileBytes: CODE_COMPLEXITY_LIMITS.inputBytes,
});

export const CodeMeasurementManifestSchema = z
  .object({
    version: z.literal('code-measurement-manifest-1'),
    requirementRevision: z.uuid(),
    stage: z.enum(['before_execution', 'during_execution', 'after_execution', 'unknown']),
    scope: z.enum(['complete', 'partial', 'unknown']),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(4096)
              .refine((path) => !path.includes('\0')),
            language: z.enum(['javascript', 'typescript', 'jsx', 'tsx', 'other']),
          })
          .strict(),
      )
      .min(1)
      .max(CODE_MEASUREMENT_SET_LIMITS.entries),
  })
  .strict();

const reasons = [
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
const stable = (before: BigIntStats, after: BigIntStats) =>
  before.dev === after.dev &&
  before.ino === after.ino &&
  before.size === after.size &&
  before.mtimeNs === after.mtimeNs &&
  before.ctimeNs === after.ctimeNs &&
  after.isFile();

/** The manifest is local-only. Every path must be selected by the user; no discovery,
 * project config loading, source execution, network calls or automatic uploading. */
export function measureCodeSet(manifestPath: string, options: { enabled?: boolean } = {}) {
  if (options.enabled !== true)
    return {
      version: 'code-measurement-set-1' as const,
      status: 'disabled' as const,
      languageGroups: null,
    };
  const path = resolve(manifestPath);
  let input: unknown;
  try {
    input = JSON.parse(readLocalTextSync(path, CODE_MEASUREMENT_SET_LIMITS.manifestBytes));
  } catch {
    throw new Error(
      '代码测量清单无法读取或解析；请核对 UTF-8 格式、权限和大小，路径及原文未输出。',
    );
  }
  const parsed = CodeMeasurementManifestSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      '代码测量清单字段无效；请核对清单版本、修订 UUID、阶段和文件列表，原始内容未输出。',
    );
  const manifest = parsed.data;
  const seen = new Map<string, string>();
  const excluded = Object.fromEntries(reasons.map((reason) => [reason, 0])) as Record<
    (typeof reasons)[number],
    number
  >;
  const accumulator = createCodeMeasurementAccumulator();
  let bytesRead = 0,
    readBudgetUsed = 0,
    measuredFiles = 0;
  for (const item of manifest.files) {
    // Unsupported languages do not cause a file read or a guessed zero result.
    if (item.language === 'other') {
      excluded.unsupported_language++;
      continue;
    }
    const file = resolve(dirname(path), item.path);
    let before: BigIntStats;
    try {
      before = lstatSync(file, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink()) throw new Error();
    } catch {
      excluded.source_unavailable++;
      continue;
    }
    let identity: string;
    try {
      identity =
        before.ino === 0n ? `path:${realpathSync.native(file)}` : `${before.dev}:${before.ino}`;
    } catch {
      excluded.source_unavailable++;
      continue;
    }
    const previousLanguage = seen.get(identity);
    if (previousLanguage !== undefined) {
      if (previousLanguage !== item.language)
        throw new Error('同一个文件指定了不同语言；请修正本地清单后重新测量。');
      excluded.duplicate_file++;
      continue;
    }
    seen.set(identity, item.language);
    if (before.size > BigInt(CODE_MEASUREMENT_SET_LIMITS.perFileBytes)) {
      excluded.input_too_large++;
      continue;
    }
    // A failed decode/read still consumed resources. Reserve the possible read,
    // including the reader's one-byte growth probe; only refund on a stable success.
    const readLimit = Math.max(1, Number(before.size));
    const reserved = readLimit + 1;
    if (readBudgetUsed + reserved > CODE_MEASUREMENT_SET_LIMITS.totalInputBytes) {
      excluded.total_input_limit++;
      continue;
    }
    readBudgetUsed += reserved;
    let source: string;
    try {
      source = readLocalTextSync(file, readLimit);
    } catch {
      excluded.source_unavailable++;
      continue;
    }
    try {
      if (!stable(before, lstatSync(file, { bigint: true }))) {
        excluded.source_changed++;
        continue;
      }
    } catch {
      excluded.source_changed++;
      continue;
    }
    bytesRead += Number(before.size);
    readBudgetUsed -= reserved - Number(before.size);
    const report = accumulator.measure(source, item.language);
    if (report.status === 'measured') measuredFiles++;
    else excluded[report.reason]++;
  }
  const unavailableEntries = manifest.files.length - measuredFiles - excluded.duplicate_file;
  return {
    version: 'code-measurement-set-1' as const,
    status:
      measuredFiles === 0
        ? ('unavailable' as const)
        : unavailableEntries
          ? ('partial' as const)
          : ('measured' as const),
    measuredAt: new Date().toISOString(),
    requirementRevision: manifest.requirementRevision,
    stage: manifest.stage,
    stageBasis: 'user_declaration' as const,
    scope: {
      declared: manifest.scope,
      basis: 'user_selected_manifest' as const,
      coverage:
        measuredFiles === 0
          ? ('unknown' as const)
          : unavailableEntries
            ? ('partial' as const)
            : manifest.scope,
      selectedEntries: manifest.files.length,
      measuredFiles,
      duplicateEntries: excluded.duplicate_file,
      unavailableEntries,
    },
    knownInputBytesRead: bytesRead,
    inputReadBudgetUsed: readBudgetUsed,
    snapshotConsistency: 'per_file_checked_not_atomic_project_snapshot' as const,
    excluded,
    limits: CODE_MEASUREMENT_SET_LIMITS,
    languageGroups: accumulator.result(),
    inference: 'syntax_only' as const,
    taskDifficulty: 'not_inferred' as const,
    algorithmicComplexity: 'not_inferred' as const,
    independentVerification: 'not_verified' as const,
  };
}
