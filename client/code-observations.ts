import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { lstatSync } from 'node:fs';
import { canonical, type Envelope } from '../shared/schema.js';
import { CodeMeasurementSetSchema } from '../shared/code-measurement-set-schema.js';
import { PythonCodeMeasurementSchema } from '../shared/python-code-measurement-schema.js';
import { PatchMeasurementReportSchema } from '../shared/patch-measurement-schema.js';
import { CODE_OBSERVATION_LIMITS as limits } from '../shared/code-observations-schema.js';
import { projectCodeReports } from '../shared/code-observations-project.js';
import { readLocalTextSync } from './local-file.js';

const reportSchema = z.union([
  CodeMeasurementSetSchema,
  PythonCodeMeasurementSchema,
  PatchMeasurementReportSchema,
]);
const taskBinding = { taskId: z.uuid(), requirementRevision: z.uuid() };
export const LocalCodeEvidenceSchema = z
  .object({
    version: z.literal('opencost-local-code-evidence-1'),
    tasks: z
      .array(z.object({ ...taskBinding, reports: z.array(reportSchema).min(1).max(12) }).strict())
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.tasks.map((t) => t.taskId.toLowerCase())).size !== v.tasks.length ||
      new Set(v.tasks.map((t) => t.requirementRevision.toLowerCase())).size !== v.tasks.length ||
      v.tasks.reduce((n, t) => n + t.reports.length, 0) > limits.reports
    )
      ctx.addIssue({ code: 'custom', message: '代码报告任务绑定重复或超过本批容量' });
  });
export type LocalCodeEvidence = z.infer<typeof LocalCodeEvidenceSchema>;
export const LocalCodeAttachmentManifestSchema = z
  .object({
    version: z.literal('code-observation-attachment-manifest-1'),
    tasks: z
      .array(
        z
          .object({
            ...taskBinding,
            reports: z
              .array(
                z
                  .string()
                  .min(1)
                  .max(4096)
                  .refine((p) => !p.includes('\0')),
              )
              .min(1)
              .max(12),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.tasks.reduce((n, t) => n + t.reports.length, 0) > limits.reports)
      ctx.addIssue({ code: 'custom', message: '代码报告文件选择超过本批容量' });
  });
export type CodeAttachmentCounts = {
  tasks: number;
  snapshots: number;
  patches: number;
  unavailable: number;
  partial: number;
};
/** Mutates only the caller's local clone; never changes completion, cost or requirements. */
export function applyCodeEvidence(envelope: Envelope, input: unknown): CodeAttachmentCounts {
  const evidence = LocalCodeEvidenceSchema.parse(input);
  const taskMap = new Map(envelope.tasks.map((t) => [t.id.toLowerCase(), t]));
  if (taskMap.size !== envelope.tasks.length)
    throw new Error('本地根目标标识存在大小写冲突，不能附加代码观察。');
  const counts: CodeAttachmentCounts = {
    tasks: 0,
    snapshots: 0,
    patches: 0,
    unavailable: 0,
    partial: 0,
  };
  const pending: {
    task: Envelope['tasks'][number];
    observation: ReturnType<typeof projectCodeReports>;
  }[] = [];
  for (const binding of evidence.tasks) {
    const task = taskMap.get(binding.taskId.toLowerCase());
    if (!task) throw new Error('代码报告绑定未对应本次根目标，未采用部分绑定。');
    const anchor = envelope.settlement?.requirements.find(
      (r) => r.taskId.toLowerCase() === task.id.toLowerCase(),
    );
    if (anchor && anchor.requirementRef.toLowerCase() !== binding.requirementRevision.toLowerCase())
      throw new Error('代码报告要求修订与本次结算要求不同，请选择对应要求的报告。');
    for (const report of binding.reports) {
      if (report.status === 'disabled')
        throw new Error('未开启测量的代码报告不能附加为已采集事实。');
      const revision = report.requirementRevision;
      if (
        revision
          ? revision.toLowerCase() !== binding.requirementRevision.toLowerCase()
          : report.status !== 'unavailable'
      )
        throw new Error('代码报告缺少或使用了不同要求修订；测得结果须使用带修订的文件清单。');
      if (report.status === 'unavailable') counts.unavailable++;
      if (report.status === 'partial') counts.partial++;
    }
    const observation = projectCodeReports(binding.reports);
    if (
      task.observations?.codeMeasurements &&
      canonical(task.observations.codeMeasurements) !== canonical(observation)
    )
      throw new Error('本次任务已有不同代码观察，原记录保留；请明确整理对应要求和阶段后另存。');
    pending.push({ task, observation });
    counts.tasks++;
    counts.snapshots += observation.snapshots.length;
    counts.patches += observation.patches.length;
  }
  // Validate every task before adopting any binding.
  const oldCount = envelope.tasks.reduce(
    (n, t) =>
      n +
      (t.observations?.codeMeasurements?.snapshots.length ?? 0) +
      (t.observations?.codeMeasurements?.patches.length ?? 0),
    0,
  );
  const replacedCount = pending.reduce(
    (n, { task }) =>
      n +
      (task.observations?.codeMeasurements?.snapshots.length ?? 0) +
      (task.observations?.codeMeasurements?.patches.length ?? 0),
    0,
  );
  if (oldCount - replacedCount + counts.snapshots + counts.patches > limits.reports)
    throw new Error('已有和新增代码报告合计超过单批256份，未采用部分绑定。');
  for (const { task, observation } of pending)
    task.observations = {
      ...task.observations,
      version: 'task-observations-1',
      codeMeasurements: observation,
    };
  return counts;
}
export function loadCodeAttachmentManifest(
  pathInput: string,
  options: { enabled?: boolean } = {},
): { status: 'disabled' } | { status: 'ready'; evidence: LocalCodeEvidence } {
  if (options.enabled !== true) return { status: 'disabled' };
  const path = resolve(pathInput);
  let manifest: z.infer<typeof LocalCodeAttachmentManifestSchema>;
  try {
    manifest = LocalCodeAttachmentManifestSchema.parse(
      JSON.parse(readLocalTextSync(path, limits.manifestBytes)),
    );
  } catch {
    throw new Error('代码报告附加清单无效；请核对版本、任务绑定和有界文件列表，原文未输出。');
  }
  const cache = new Map<string, z.infer<typeof reportSchema>>();
  let reserved = 0;
  const tasks = manifest.tasks.map((task) => ({
    ...task,
    reports: task.reports.map((file) => {
      try {
        const selected = resolve(dirname(path), file),
          before = lstatSync(selected, { bigint: true });
        if (!before.isFile() || before.isSymbolicLink() || before.size > 262144n) throw new Error();
        const key = `${selected}:${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}:${before.ctimeNs}`;
        const old = cache.get(key);
        if (old) return old;
        reserved += Number(before.size) + 1;
        if (reserved > limits.localBytes) throw new Error();
        const raw: unknown = JSON.parse(
          readLocalTextSync(selected, Math.max(1, Number(before.size))),
        );
        const after = lstatSync(selected, { bigint: true });
        if (
          !after.isFile() ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        )
          throw new Error();
        const report = reportSchema.parse(raw);
        cache.set(key, report);
        return report;
      } catch {
        throw new Error(
          '所选代码数值报告读取、版本或容量校验未通过，未附加部分结果；不读取源码或原始补丁。',
        );
      }
    }),
  }));
  return {
    status: 'ready',
    evidence: LocalCodeEvidenceSchema.parse({ version: 'opencost-local-code-evidence-1', tasks }),
  };
}
