import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { lstatSync, type BigIntStats } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { StructuredPatch } from 'diff';
import { readLocalTextSync } from './local-file.js';
import {
  PATCH_MEASUREMENT_LIMITS as limits,
  PatchMeasurementManifestSchema,
  PatchMeasurementReportSchema,
  patchMetricRules,
  patchRoles,
  patchFlags,
  patchKinds,
  type PatchMetrics,
  type PatchMeasurementManifest,
  type PatchMeasurementReport,
} from '../shared/patch-measurement-schema.js';

const require = createRequire(import.meta.url);
const emptyBlobIds = ['sha1', 'sha256'].map((algorithm) =>
  createHash(algorithm).update('blob 0\0').digest('hex'),
);
const emptyBlob = (id: string | undefined) =>
  id !== undefined && id.length >= 7 && emptyBlobIds.some((value) => value.startsWith(id));
type Failure = Exclude<PatchMeasurementReport['reason'], 'none' | 'not_enabled'>;
class PatchFailure extends Error {
  constructor(readonly reason: Failure) {
    super(reason);
  }
}
const fail = (reason: Failure): never => {
  throw new PatchFailure(reason);
};
const stable = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  b.isFile() &&
  !b.isSymbolicLink();
type Bounds = { oldStart: number; oldLines: number; newStart: number; newLines: number };
type Section = {
  git: boolean;
  hunks: Bounds[];
  headers: boolean;
  metadata: Map<string, string>;
  binary: boolean;
};

/** The upstream parser tolerates surrounding prose. This complete-input pass
 * rejects skipped content and budgets work before invoking the fixed parser. */
function preflight(text: string) {
  if (text.includes('\0')) fail('unsupported_format');
  const normalized = text.replace(/\r\n/g, '\n'),
    lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > limits.lines) fail('operation_limit');
  for (const line of lines) if (Buffer.byteLength(line) > limits.lineBytes) fail('operation_limit');
  const sections: Section[] = [];
  let section: Section | null = null,
    format: 'git_unified' | 'unified' | 'empty' = 'empty',
    i = 0,
    hunks = 0,
    changes = 0;
  const start = (git: boolean) => {
    if (sections.length >= limits.files) fail('operation_limit');
    const nextFormat = git ? 'git_unified' : 'unified';
    if (format !== 'empty' && format !== nextFormat) fail('unsupported_format');
    format = nextFormat;
    const value: Section = { git, hunks: [], headers: false, metadata: new Map(), binary: false };
    sections.push(value);
    return value;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line === '') {
      i++;
      continue;
    }
    if (/^(?:diff --(?:cc|combined)|@@@|GIT binary patch|Index:|\*\*\*)/.test(line))
      fail('unsupported_format');
    if (line.startsWith('diff --git ')) {
      section = start(true);
      i++;
      continue;
    }
    if (line.startsWith('--- ')) {
      if (!section || !section.git) section = start(false);
      else if (section.headers || section.hunks.length || section.binary) fail('invalid_patch');
      if (!lines[i + 1]?.startsWith('+++ ')) fail('invalid_patch');
      section!.headers = true;
      i += 2;
      continue;
    }
    if (!section) fail('unsupported_format');
    if (line.startsWith('@@ ')) {
      if (!section!.headers || section!.binary) fail('invalid_patch');
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
      if (!m) fail('invalid_patch');
      const oldLines = m![2] === undefined ? 1 : Number(m![2]),
        newLines = m![4] === undefined ? 1 : Number(m![4]);
      const oldRaw = Number(m![1]),
        newRaw = Number(m![3]);
      if (
        [oldRaw, newRaw, oldLines, newLines].some(
          (n) => !Number.isSafeInteger(n) || n < 0 || n > limits.coordinate,
        ) ||
        (oldLines > 0 && oldRaw === 0) ||
        (newLines > 0 && newRaw === 0)
      )
        fail('invalid_patch');
      if (++hunks > limits.hunks) fail('operation_limit');
      section!.hunks.push({
        oldStart: oldRaw + (oldLines === 0 ? 1 : 0),
        oldLines,
        newStart: newRaw + (newLines === 0 ? 1 : 0),
        newLines,
      });
      let oldLeft = oldLines,
        newLeft = newLines,
        canMark = false,
        changed = false;
      i++;
      while (oldLeft > 0 || newLeft > 0 || lines[i]?.startsWith('\\')) {
        const body = lines[i];
        if (body === undefined) fail('invalid_patch');
        if (body.startsWith('\\')) {
          if (!canMark || body !== '\\ No newline at end of file') fail('invalid_patch');
          canMark = false;
          i++;
          continue;
        }
        const op = body[0];
        if (op === '-') {
          oldLeft--;
          changed = true;
          changes++;
        } else if (op === '+') {
          newLeft--;
          changed = true;
          changes++;
        } else if (op === ' ') {
          oldLeft--;
          newLeft--;
        } else fail('invalid_patch');
        if (oldLeft < 0 || newLeft < 0) fail('invalid_patch');
        if (changes > limits.changedLines) fail('operation_limit');
        canMark = true;
        i++;
      }
      if (!changed) fail('invalid_patch');
      continue;
    }
    if (!section!.git || section!.headers || section!.hunks.length) fail('invalid_patch');
    let match: RegExpExecArray | null;
    if (
      (match = /^(old mode|new mode|new file mode|deleted file mode) ([0-7]{6})$/.exec(line)) ||
      (match = /^(rename from|rename to|copy from|copy to) (.+)$/.exec(line)) ||
      (match = /^(index) ([0-9a-f]{1,64}\.\.[0-9a-f]{1,64}(?: [0-7]{6})?)$/.exec(line))
    ) {
      if (section!.metadata.has(match[1])) fail('invalid_patch');
      section!.metadata.set(match[1], match[2]);
      i++;
      continue;
    }
    if ((match = /^(similarity index|dissimilarity index) (\d{1,3})%$/.exec(line))) {
      if (Number(match[2]) > 100 || section!.metadata.has(match[1])) fail('invalid_patch');
      section!.metadata.set(match[1], match[2]);
      i++;
      continue;
    }
    if (/^Binary files .+ differ$/.test(line) && !section!.binary) {
      section!.binary = true;
      i++;
      continue;
    }
    fail('invalid_patch');
  }
  for (const s of sections) {
    for (const [a, b] of [
      ['rename from', 'rename to'],
      ['copy from', 'copy to'],
      ['old mode', 'new mode'],
    ])
      if (s.metadata.has(a) !== s.metadata.has(b)) fail('invalid_patch');
    if (
      (s.metadata.has('rename from') && s.metadata.has('copy from')) ||
      (s.metadata.has('new file mode') && s.metadata.has('deleted file mode'))
    )
      fail('invalid_patch');
  }
  return { text: normalized, sections, format };
}
function distribution(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b),
    count = sorted.length,
    sum = sorted.reduce((n, x) => n + x, 0);
  const q = (p: number) => {
    if (!count) return null;
    const index = (count - 1) * p;
    return (
      sorted[Math.floor(index)] +
      (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index - Math.floor(index))
    );
  };
  return {
    count,
    sum,
    min: sorted[0] ?? null,
    median: q(0.5),
    p90: q(0.9),
    max: sorted.at(-1) ?? null,
    mean: count ? sum / count : null,
  };
}
const bucket = () => ({
  files: 0,
  knownTextFiles: 0,
  unmeasuredFiles: 0,
  addedLines: 0,
  deletedLines: 0,
  changedLineEntries: 0,
});
function aggregate(
  parsed: StructuredPatch[],
  sections: Section[],
  manifest: PatchMeasurementManifest,
): PatchMetrics {
  if (parsed.length !== sections.length) fail('invalid_patch');
  const classes = new Map(manifest.classifications.map((v) => [v.path, v])),
    matched = new Set<string>();
  const oldNames = new Set<string>(),
    newNames = new Set<string>();
  const perFile: {
    addedLines: number;
    deletedLines: number;
    changedLineEntries: number;
    hunks: number;
    editRuns: number;
  }[] = [];
  const result: PatchMetrics = {
    totalFiles: parsed.length,
    knownTextFiles: 0,
    binaryFiles: 0,
    unmeasuredContentFiles: 0,
    filesWithTextChanges: 0,
    knownFilesWithoutTextChanges: 0,
    modeChanges: 0,
    specialModeEntries: 0,
    fileKinds: Object.fromEntries(patchKinds.map((k) => [k, 0])),
    addedLines: 0,
    deletedLines: 0,
    changedLineEntries: 0,
    netLineChange: 0,
    contextLines: 0,
    hunks: 0,
    editRuns: 0,
    asciiWhitespaceEquivalentRuns: 0,
    blankAddedLines: 0,
    blankDeletedLines: 0,
    fileDistributions: {
      addedLines: distribution([]),
      deletedLines: distribution([]),
      changedLineEntries: distribution([]),
      hunks: distribution([]),
      editRuns: distribution([]),
    },
    dispersion: {
      basis: 'known_text_changed_line_entries',
      largestFileShare: null,
      concentration: null,
      effectiveFileCount: null,
    },
    classifications: {
      basis: 'user_declaration',
      mappedFiles: 0,
      unmappedFiles: 0,
      byRole: Object.fromEntries(patchRoles.map((k) => [k, bucket()])),
      generated: Object.fromEntries(patchFlags.map((k) => [k, bucket()])),
      formattingOnly: Object.fromEntries(patchFlags.map((k) => [k, bucket()])),
    },
  };
  for (let index = 0; index < parsed.length; index++) {
    const file = parsed[index],
      s = sections[index];
    if (
      Boolean(file.isGit) !== s.git ||
      file.hunks.length !== s.hunks.length ||
      Boolean(file.isBinary) !== s.binary
    )
      fail('invalid_patch');
    if (
      [file.oldFileName, file.newFileName].some(
        (name) => !name || name.length > 4096 || name.includes('\0'),
      )
    )
      fail('invalid_patch');
    const bare = (name: string) =>
      name === '/dev/null' ? null : s.git && /^[ab]\//.test(name) ? name.slice(2) : name;
    const oldPath = file.isCreate ? null : bare(file.oldFileName!),
      newPath = file.isDelete ? null : bare(file.newFileName!);
    if (
      (!oldPath && !newPath) ||
      (oldPath && !file.isCopy && oldNames.has(oldPath)) ||
      (newPath && newNames.has(newPath))
    )
      fail('invalid_patch');
    if (oldPath && !file.isCopy) oldNames.add(oldPath);
    if (newPath) newNames.add(newPath);
    const name = newPath ?? oldPath!;
    const ids = s.metadata.get('index')?.split(' ')[0].split('..');
    const created = Boolean(file.isCreate || file.oldFileName === '/dev/null');
    const deleted = Boolean(file.isDelete || file.newFileName === '/dev/null');
    const contentGap =
      !s.binary &&
      file.hunks.length === 0 &&
      (created
        ? !emptyBlob(ids?.[1])
        : deleted
          ? !emptyBlob(ids?.[0])
          : Boolean(
              (ids && ids[0] !== ids[1]) ||
              (s.metadata.has('similarity index') &&
                Number(s.metadata.get('similarity index')) < 100) ||
              (s.metadata.has('dissimilarity index') &&
                Number(s.metadata.get('dissimilarity index')) > 0),
            ));
    const unknownContent = s.binary || contentGap;
    if (
      s.headers &&
      ((file.isCreate && file.oldFileName !== '/dev/null') ||
        (file.isDelete && file.newFileName !== '/dev/null'))
    )
      fail('invalid_patch');
    const kind = file.isRename
      ? 'renamed'
      : file.isCopy
        ? 'copied'
        : file.isCreate || file.oldFileName === '/dev/null'
          ? 'added'
          : file.isDelete || file.newFileName === '/dev/null'
            ? 'deleted'
            : file.hunks.length || unknownContent
              ? 'modified'
              : 'metadata_only';
    const modeChanged =
      file.oldMode !== undefined && file.newMode !== undefined && file.oldMode !== file.newMode;
    if ((file.isRename || file.isCopy) && (!oldPath || !newPath || oldPath === newPath))
      fail('invalid_patch');
    if (
      !s.binary &&
      file.hunks.length === 0 &&
      !file.isCreate &&
      !file.isDelete &&
      !file.isRename &&
      !file.isCopy &&
      !modeChanged &&
      !contentGap
    )
      fail('invalid_patch');
    result.fileKinds[kind]++;
    if (modeChanged) result.modeChanges++;
    const indexMode = s.metadata.get('index')?.split(' ')[1];
    if (
      [file.oldMode, file.newMode, indexMode].some((mode) => mode === '120000' || mode === '160000')
    )
      result.specialModeEntries++;
    const numbers = {
      addedLines: 0,
      deletedLines: 0,
      changedLineEntries: 0,
      hunks: file.hunks.length,
      editRuns: 0,
    };
    let oldEnd = 0,
      newEnd = 0;
    for (let h = 0; h < file.hunks.length; h++) {
      const hunk = file.hunks[h],
        expected = s.hunks[h];
      if (
        Object.keys(expected).some(
          (k) => hunk[k as keyof Bounds] !== expected[k as keyof Bounds],
        ) ||
        hunk.oldStart < oldEnd ||
        hunk.newStart < newEnd
      )
        fail('invalid_patch');
      oldEnd = hunk.oldStart + hunk.oldLines;
      newEnd = hunk.newStart + hunk.newLines;
      let removed: string[] = [],
        added: string[] = [],
        inRun = false;
      const flush = () => {
        if (!inRun) return;
        numbers.editRuns++;
        if (
          removed.join('\n').replace(/[ \t\r\n]/g, '') ===
          added.join('\n').replace(/[ \t\r\n]/g, '')
        )
          result.asciiWhitespaceEquivalentRuns++;
        removed = [];
        added = [];
        inRun = false;
      };
      for (const line of hunk.lines) {
        if (line.startsWith('-')) {
          inRun = true;
          numbers.deletedLines++;
          removed.push(line.slice(1));
          if (line.slice(1).trim() === '') result.blankDeletedLines++;
        } else if (line.startsWith('+')) {
          inRun = true;
          numbers.addedLines++;
          added.push(line.slice(1));
          if (line.slice(1).trim() === '') result.blankAddedLines++;
        } else if (line.startsWith(' ')) {
          flush();
          result.contextLines++;
        }
      }
      flush();
    }
    numbers.changedLineEntries = numbers.addedLines + numbers.deletedLines;
    if (s.binary) result.binaryFiles++;
    if (unknownContent) result.unmeasuredContentFiles++;
    else {
      result.knownTextFiles++;
      if (numbers.changedLineEntries) result.filesWithTextChanges++;
      else result.knownFilesWithoutTextChanges++;
      perFile.push(numbers);
    }
    for (const key of [
      'addedLines',
      'deletedLines',
      'changedLineEntries',
      'hunks',
      'editRuns',
    ] as const)
      result[key] += numbers[key];
    const declaration = classes.get(name);
    if (declaration) {
      matched.add(name);
      result.classifications.mappedFiles++;
    } else result.classifications.unmappedFiles++;
    for (const b of [
      result.classifications.byRole[declaration?.role ?? 'unknown'],
      result.classifications.generated[declaration?.generated ?? 'unknown'],
      result.classifications.formattingOnly[declaration?.formattingOnly ?? 'unknown'],
    ]) {
      b.files++;
      if (unknownContent) b.unmeasuredFiles++;
      else b.knownTextFiles++;
      b.addedLines += numbers.addedLines;
      b.deletedLines += numbers.deletedLines;
      b.changedLineEntries += numbers.changedLineEntries;
    }
  }
  if (matched.size !== classes.size) fail('classification_mismatch');
  for (const key of [
    'addedLines',
    'deletedLines',
    'changedLineEntries',
    'hunks',
    'editRuns',
  ] as const)
    result.fileDistributions[key] = distribution(perFile.map((v) => v[key]));
  result.netLineChange = result.addedLines - result.deletedLines;
  if (result.changedLineEntries) {
    const shares = perFile.map((f) => f.changedLineEntries / result.changedLineEntries),
      concentration = shares.reduce((n, p) => n + p * p, 0);
    result.dispersion.largestFileShare = Math.max(...shares);
    result.dispersion.concentration = concentration;
    result.dispersion.effectiveFileCount = Math.min(
      result.filesWithTextChanges,
      Math.max(1, 1 / concentration),
    );
  }
  return result;
}
export function measurePatchManifest(
  manifestPath: string,
  options: { enabled?: boolean } = {},
): PatchMeasurementReport {
  const result: PatchMeasurementReport = {
    version: 'patch-measurement-1',
    algorithm: 'jsdiff_9_0_0_unified_patch_counts_v1',
    parser: { name: 'jsdiff', version: '9.0.0' },
    status: 'disabled',
    reason: 'not_enabled',
    requirementRevision: null,
    stage: 'unknown',
    stageBasis: 'user_declaration',
    measuredAt: null,
    inputBytes: null,
    format: 'unknown',
    scope: null,
    generation: null,
    metrics: null,
    limits,
    rules: patchMetricRules,
    taskDifficulty: 'not_inferred',
    codeQuality: 'not_inferred',
    completedWork: 'not_inferred',
  };
  if (options.enabled !== true) return result;
  result.status = 'unavailable';
  result.reason = 'invalid_manifest';
  result.measuredAt = new Date().toISOString();
  const path = resolve(manifestPath);
  let manifest: PatchMeasurementManifest;
  try {
    manifest = PatchMeasurementManifestSchema.parse(
      JSON.parse(readLocalTextSync(path, limits.manifestBytes)),
    );
  } catch {
    return PatchMeasurementReportSchema.parse(result);
  }
  result.requirementRevision = manifest.requirementRevision;
  result.stage = manifest.stage;
  result.generation = manifest.generation;
  result.scope = { declared: manifest.scope, coverage: 'unknown' };
  try {
    const patchPath = resolve(dirname(path), manifest.patchFile);
    let before: BigIntStats;
    try {
      before = lstatSync(patchPath, { bigint: true });
    } catch {
      fail('source_unavailable');
    }
    if (!before!.isFile() || before!.isSymbolicLink()) fail('source_unavailable');
    if (before!.size > BigInt(limits.inputBytes)) fail('input_limit');
    let text: string;
    try {
      text = readLocalTextSync(patchPath, limits.inputBytes);
    } catch {
      fail('source_unavailable');
    }
    try {
      if (!stable(before!, lstatSync(patchPath, { bigint: true }))) fail('source_changed');
    } catch (error) {
      if (error instanceof PatchFailure) throw error;
      fail('source_changed');
    }
    result.inputBytes = Number(before!.size);
    const checked = preflight(text!);
    result.format = checked.format;
    let parse: typeof import('diff').parsePatch;
    try {
      if (require('diff/package.json').version !== '9.0.0') fail('parser_unavailable');
      parse = require('diff/lib/patch/parse.js').parsePatch;
      if (typeof parse !== 'function') fail('parser_unavailable');
    } catch {
      fail('parser_unavailable');
    }
    let files: StructuredPatch[];
    try {
      files = checked.sections.length === 0 ? [] : parse!(checked.text);
    } catch {
      fail('parse_error');
    }
    result.metrics = aggregate(files!, checked.sections, manifest);
    result.status = result.metrics.unmeasuredContentFiles > 0 ? 'partial' : 'measured';
    result.reason = 'none';
    result.scope.coverage = result.metrics.unmeasuredContentFiles > 0 ? 'partial' : manifest.scope;
    return PatchMeasurementReportSchema.parse(result);
  } catch (error) {
    result.reason = error instanceof PatchFailure ? error.reason : 'parse_error';
    result.status = 'unavailable';
    result.metrics = null;
    result.scope!.coverage = 'unknown';
    return PatchMeasurementReportSchema.parse(result);
  }
}
