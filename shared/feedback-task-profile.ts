import { z } from 'zod';
import { RequirementObservationsSchema } from './task-observations.js';

const count = z.number().int().nonnegative().max(1e9);
const measurement = z.object({ value: count.nullable(), known: count }).strict();
export const FeedbackTaskProfileSchema = z
  .object({
    version: z.literal('feedback-task-profile-1'),
    rulesVersion: z.literal('vbti-rules-2').optional(),
    totalTasks: count,
    structureTasks: count,
    computedGraphTasks: count,
    components: measurement,
    componentMaximum: count.nullable().optional(),
    decompositionIndex: z.number().min(0).max(100).nullable().optional(),
    sources: z
      .array(
        z
          .object({ source: RequirementObservationsSchema.shape.meta.shape.source, tasks: count })
          .strict(),
      )
      .max(6)
      .optional(),
    depth: measurement,
    integration: measurement,
    requirementTasks: count,
    beforeExecutionTasks: count,
    completeRequirementTasks: count,
    behaviorSignals: z
      .object({
        exploration: z.object({ matched: count, known: count }).strict(),
        verification: z.object({ matched: count, known: count }).strict(),
        integration: z.object({ matched: count, known: count }).strict(),
      })
      .strict()
      .optional(),
    requirements: z
      .array(
        z
          .object({
            field: z.string().max(40),
            value: z.string().max(60),
            tasks: count,
            known: count.optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((p, ctx) => {
    const signals = Object.values(p.behaviorSignals ?? {});
    if (
      signals.some((s) => s.matched > s.known || s.known > p.totalTasks) ||
      p.requirements.some(
        (r) => r.tasks > (r.known ?? p.totalTasks) || (r.known ?? 0) > p.totalTasks,
      ) ||
      p.components.known > p.totalTasks
    )
      ctx.addIssue({ code: 'custom', message: '画像计数不能超过对应任务范围' });
  });
export type FeedbackTaskProfile = z.infer<typeof FeedbackTaskProfileSchema>;
type Input = {
  requirements?: z.infer<typeof RequirementObservationsSchema>;
  structure?: {
    componentCount: number | null;
    dependencyDepth: number | null;
    integrationRequired: boolean | null;
    status?: string;
    coverage?: string;
  } | null;
};
export function feedbackTaskProfile(tasks: Input[]): FeedbackTaskProfile | undefined {
  if (!tasks.some((t) => t.requirements || t.structure)) return undefined;
  const structs = tasks.flatMap((t) =>
    t.structure &&
    t.structure.coverage !== 'partial' &&
    t.structure.coverage !== 'unknown' &&
    [t.structure.componentCount, t.structure.dependencyDepth, t.structure.integrationRequired].some(
      (v) => v !== null,
    )
      ? [t.structure]
      : [],
  );
  const summarize = (values: (number | null)[], maximum = false) => {
    const known = values.filter((v): v is number => v !== null);
    return {
      value: known.length
        ? maximum
          ? Math.max(...known)
          : known.reduce((a, b) => a + b, 0)
        : null,
      known: known.length,
    };
  };
  const requirements = tasks.flatMap((t) =>
    t.requirements &&
    t.requirements.meta.source !== 'unknown' &&
    t.requirements.meta.coverage !== 'unknown' &&
    Object.entries(t.requirements).some(
      ([k, v]) =>
        k !== 'meta' &&
        (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v !== 'unknown'),
    )
      ? [t.requirements]
      : [],
  );
  const categories = new Map<
    string,
    { field: string; value: string; tasks: number; known?: number }
  >();
  const signal = (classify: (r: NonNullable<Input['requirements']>) => boolean | null) => {
    const values = tasks
      .flatMap((t) => {
        const r = t.requirements;
        if (!r || r.meta.source === 'unknown' || r.meta.coverage === 'unknown') return [];
        const value = classify(r);
        return [value === false && r.meta.coverage !== 'complete' ? null : value];
      })
      .filter((v) => v !== null);
    return { matched: values.filter(Boolean).length, known: values.length };
  };
  const present = (value: unknown) => value !== null && value !== undefined && value !== 'unknown';
  const behaviorSignals = {
    exploration: signal((r) =>
      r.knowledge === 'research' ||
      r.methodFamilies?.some((m) =>
        ['retrieval', 'statistical_inference', 'simulation'].includes(m),
      )
        ? true
        : present(r.knowledge) && present(r.methodFamilies)
          ? false
          : null,
    ),
    verification: signal((r) =>
      r.reasoning === 'formal' ||
      r.methodFamilies?.includes('formal_verification') ||
      r.constraintKinds?.includes('source_traceability')
        ? true
        : present(r.reasoning) && present(r.methodFamilies) && present(r.constraintKinds)
          ? false
          : null,
    ),
    integration: signal((r) =>
      present(r.methodFamilies)
        ? r.methodFamilies!.some((m) =>
            ['cross_system_integration', 'multimodal_alignment'].includes(m),
          )
        : null,
    ),
  };
  for (const r of requirements)
    for (const [field, values] of Object.entries(r)) {
      if (field === 'meta') continue;
      for (const value of new Set<unknown>(Array.isArray(values) ? values : [values])) {
        if (typeof value !== 'string' || value === 'unknown') continue;
        const key = `${field}:${value}`;
        const item = categories.get(key) ?? { field, value, tasks: 0 };
        item.tasks++;
        categories.set(key, item);
      }
    }
  for (const item of categories.values())
    item.known = requirements.filter((r) => {
      const value = r[item.field as keyof typeof r];
      return Array.isArray(value)
        ? value.includes(item.value as never) || r.meta.coverage === 'complete'
        : typeof value === 'string' && value !== 'unknown';
    }).length;
  const components = structs.flatMap((s) =>
    s.componentCount !== null && s.componentCount > 0 ? [s.componentCount] : [],
  );
  const sourceCounts = new Map<NonNullable<Input['requirements']>['meta']['source'], number>();
  for (const r of requirements)
    sourceCounts.set(r.meta.source, (sourceCounts.get(r.meta.source) ?? 0) + 1);
  return FeedbackTaskProfileSchema.parse({
    version: 'feedback-task-profile-1',
    rulesVersion: 'vbti-rules-2',
    totalTasks: tasks.length,
    behaviorSignals,
    structureTasks: structs.length,
    computedGraphTasks: structs.filter((s) => s.status === 'computed_graph').length,
    components: summarize(
      structs.map((s) =>
        s.componentCount !== null && s.componentCount > 0 ? s.componentCount : null,
      ),
    ),
    componentMaximum: components.length ? Math.max(...components) : null,
    decompositionIndex: components.length
      ? Math.round(
          components.reduce((sum, n) => sum + (100 * (n - 1)) / (n + 3), 0) / components.length,
        )
      : null,
    sources: [...sourceCounts].map(([source, tasks]) => ({ source, tasks })),
    depth: summarize(
      structs.map((s) => s.dependencyDepth),
      true,
    ),
    integration: summarize(
      structs.map((s) => (s.integrationRequired === null ? null : Number(s.integrationRequired))),
    ),
    requirementTasks: requirements.length,
    beforeExecutionTasks: requirements.filter((r) =>
      ['before_execution', 'approved_change'].includes(r.meta.timing),
    ).length,
    completeRequirementTasks: requirements.filter((r) => r.meta.coverage === 'complete').length,
    requirements: [...categories.values()].sort(
      (a, b) => b.tasks - a.tasks || a.field.localeCompare(b.field),
    ),
  });
}
export const requirementValueLabels: Record<string, string> = {
  specified: '需求明确',
  incomplete: '需求待补充',
  conflicting: '需求有冲突',
  clean: '材料完整一致',
  missing: '材料缺失',
  inconsistent: '材料不一致',
  noisy: '材料有噪声',
  mixed: '多种材料条件',
  repeat: '复用已知方案',
  adaptation: '适配已有方案',
  new_solution: '构造新方案',
  general: '通用知识',
  specialist: '专业知识',
  research: '研究性知识',
  routine: '常规推理',
  multi_step: '多步推理',
  formal: '形式化论证',
  open_ended: '开放式推断',
  retrieval: '检索',
  transformation: '转换',
  construction: '构造',
  diagnosis: '诊断',
  formal_verification: '形式验证',
  statistical_inference: '统计推断',
  optimization: '优化',
  simulation: '仿真',
  multimodal_alignment: '多模态对齐',
  cross_system_integration: '跨系统集成',
  correctness: '正确性',
  performance: '性能',
  security: '安全',
  compatibility: '兼容性',
  format: '格式',
  accessibility: '无障碍',
  source_traceability: '来源可追溯',
  resource_limit: '资源上限',
  deadline: '截止时间',
  fresh: '从新材料开始',
  continued: '沿用已有上下文',
  template_based: '采用已有模板',
};
