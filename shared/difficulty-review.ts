import { z } from 'zod';
import { DifficultyAnnotationDraftSchema, difficultyFramework } from './difficulty-framework.js';
import { difficultyResearch } from './difficulty-evidence.js';

// These references inform this project's requirement checklist. They do not validate
// a difficulty scale, and a structural code metric is not a task-difficulty score.
export const requirementFacetReferences = [
  {
    title: 'MIT 6.006 Introduction to Algorithms — Syllabus',
    url: 'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/pages/syllabus/',
    use: '计算问题的形式化、算法与数据结构、性能分析分别记录',
  },
  {
    title: 'NIST SP 500-235 — Structured Testing',
    url: 'https://www.nist.gov/publications/structured-testing-testing-methodology-using-cyclomatic-complexity-metric',
    use: '区分控制流、路径覆盖与行为核验；不把圈复杂度转换为任务等级',
  },
  {
    title: 'NIST AI RMF Core',
    url: 'https://airc.nist.gov/airmf-resources/airmf/5-sec-core/',
    use: '记录适用情境、证据、测量限制、独立核验与职责边界',
  },
] as const;

const mit = requirementFacetReferences[0].url;
const structuredTesting = requirementFacetReferences[1].url;
const aiRmf = requirementFacetReferences[2].url;
function sourceUrl(id: string) {
  const source = difficultyResearch.sources.find((s) =>
    s.readings.some((r) => r.reference.endsWith(':' + id)),
  );
  if (!source) throw new Error('要求条目的公开来源未登记：' + id);
  return source.url;
}
const nasa = sourceUrl('sci-nasa-se-2016');
const gum = sourceUrl('jcgm-gum-2008');
const numerical = sourceUrl('computing-dlmf-conditioning');
const semantics = sourceUrl('humanities-translation-mqm');
const creative = sourceUrl('humanities-design-dorst-cross-2001');
const multimodal = sourceUrl('humanities-media-videomme-2024');
const causal = sourceUrl('pearl-causal-2009');
const workflow = sourceUrl('tau-bench-2024');
const integration = sourceUrl('browning-2001-design-structure-matrix');

export const requirementFacetGroups = [
  { id: 'code', label: '代码要求' },
  { id: 'algorithm', label: '算法要求' },
  { id: 'science', label: '科学与工程要求' },
  { id: 'evidence', label: '证据与推断要求' },
  { id: 'semantic', label: '语义要求' },
  { id: 'creative', label: '创作要求' },
  { id: 'multimodal', label: '多模态要求' },
  { id: 'process', label: '流程要求' },
  { id: 'professional', label: '专业适用要求' },
] as const;

type FacetGroup = (typeof requirementFacetGroups)[number]['id'];
type FacetDefinition = {
  id: string;
  group: FacetGroup;
  label: string;
  requirement: string;
  referenceUrls: readonly string[];
};

// Applicability must be reviewed against original requirements. Domain, method
// name, produced code, execution cost and outcome never select an entry here.
export const requirementFacets = [
  {
    id: 'code.behavior',
    group: 'code',
    label: '行为与边界',
    requirement: '原要求是否规定输入输出、异常分支、边界条件及可观察行为必须保持或改变？',
    referenceUrls: [structuredTesting],
  },
  {
    id: 'code.state',
    group: 'code',
    label: '状态与不变量',
    requirement: '原要求是否涉及持久状态、并发、事务、状态迁移或必须保持的不变量？',
    referenceUrls: [structuredTesting],
  },
  {
    id: 'code.compatibility',
    group: 'code',
    label: '兼容与接口约束',
    requirement: '原要求是否规定历史行为、数据格式、接口、运行环境或版本兼容范围？',
    referenceUrls: [sourceUrl('computing-swe-bench')],
  },
  {
    id: 'algorithm.formalization',
    group: 'algorithm',
    label: '问题形式化',
    requirement: '是否必须明确输入域、输出、可行条件、目标函数及计算问题的假设？',
    referenceUrls: [mit],
  },
  {
    id: 'algorithm.structure',
    group: 'algorithm',
    label: '结构与数据表示',
    requirement: '问题本身是否要求处理图、组合、递归、动态状态或特殊数据结构及其性质？',
    referenceUrls: [mit],
  },
  {
    id: 'algorithm.correctness',
    group: 'algorithm',
    label: '正确性义务',
    requirement: '原要求是否需要证明正确性、终止性、可行性、最优性或近似保证？',
    referenceUrls: [mit],
  },
  {
    id: 'algorithm.design',
    group: 'algorithm',
    label: '设计与方案构造',
    requirement: '原要求是实现给定方案，还是需要选择、适配、改进或构造算法并论证成立条件？',
    referenceUrls: [
      'https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2012/',
    ],
  },
  {
    id: 'algorithm.approximation_randomness',
    group: 'algorithm',
    label: '近似与随机保证',
    requirement: '原要求是否规定精确或近似结果、误差界、成功概率或随机算法的保证条件？',
    referenceUrls: [
      'https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2012/',
    ],
  },
  {
    id: 'algorithm.online_dynamic',
    group: 'algorithm',
    label: '在线与动态要求',
    requirement: '原要求是否涉及在线到达、增量更新、动态查询、时点可用信息或竞争分析义务？',
    referenceUrls: [
      'https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2012/',
    ],
  },
  {
    id: 'algorithm.time_bound',
    group: 'algorithm',
    label: '时间界',
    requirement: '原要求是否规定渐近时间界、最坏情况、摊还界或输入规模下的计算期限？',
    referenceUrls: [mit],
  },
  {
    id: 'algorithm.space_bound',
    group: 'algorithm',
    label: '空间界',
    requirement: '原要求是否规定额外空间、存储、流式处理或输入规模下的内存限制？',
    referenceUrls: [mit],
  },
  {
    id: 'algorithm.numerical_precision',
    group: 'algorithm',
    label: '数值精度与稳定性',
    requirement: '原要求是否规定误差容限、收敛、条件数、稳定性或有限精度下的有效性？',
    referenceUrls: [numerical],
  },
  {
    id: 'science.physical_validity',
    group: 'science',
    label: '物理有效性',
    requirement: '是否必须满足物理规律、守恒关系、量纲、边界条件及模型适用范围？',
    referenceUrls: [nasa, sourceUrl('sci-asme-vv10')],
  },
  {
    id: 'science.measurement_error',
    group: 'science',
    label: '测量误差',
    requirement: '是否必须处理测量定义、校准、误差来源、误差传播或可辨识性？',
    referenceUrls: [gum],
  },
  {
    id: 'evidence.independence',
    group: 'evidence',
    label: '证据独立性',
    requirement: '原要求是否需要区分共同来源、重复样本、独立验证或证据之间的依赖？',
    referenceUrls: [aiRmf],
  },
  {
    id: 'evidence.causal_conditions',
    group: 'evidence',
    label: '因果条件',
    requirement: '原要求是否需要因果判断，并说明混杂、识别假设、对照及替代解释？',
    referenceUrls: [causal],
  },
  {
    id: 'semantic.preservation',
    group: 'semantic',
    label: '语义保持',
    requirement: '原要求是否规定事实、含义、术语、引用、结论强度或局部修改边界必须保持？',
    referenceUrls: [semantics],
  },
  {
    id: 'creative.constraints',
    group: 'creative',
    label: '创作约束',
    requirement: '原要求是否同时规定受众、叙事、风格、原创性、表现形式或可编辑性？',
    referenceUrls: [creative],
  },
  {
    id: 'multimodal.temporal_alignment',
    group: 'multimodal',
    label: '多模态时序',
    requirement: '原要求是否规定图像、声音、字幕、动画或交互的时序、同步与跨模态一致性？',
    referenceUrls: [multimodal],
  },
  {
    id: 'process.authorization',
    group: 'process',
    label: '流程与授权',
    requirement: '原要求是否包含权限、审批、外部操作、责任分工或必须保留的确认步骤？',
    referenceUrls: [workflow, aiRmf],
  },
  {
    id: 'process.integration',
    group: 'process',
    label: '部分间整合',
    requirement: '原要求是否包含跨部分依赖、共享状态、反馈或需要单独验证的整合义务？',
    referenceUrls: [integration],
  },
  {
    id: 'professional.applicability',
    group: 'professional',
    label: '专业适用条件',
    requirement: '原要求是否依赖明确的人群、行业、司法管辖、会计口径、时点或专业规则？',
    referenceUrls: [aiRmf],
  },
  {
    id: 'professional.review',
    group: 'professional',
    label: '专业复核义务',
    requirement: '原要求是否指定具备相应资格或独立性的人员复核，以及结论的使用边界？',
    referenceUrls: [aiRmf],
  },
] as const satisfies readonly FacetDefinition[];

const evidenceKinds = [
  'original_requirement',
  'provided_material',
  'task_property',
  'execution_log',
  'unknown',
] as const;
const originalEvidence = new Set<string>([
  'original_requirement',
  'provided_material',
  'task_property',
]);
const assessmentStates = [
  'supported',
  'insufficient_evidence',
  'conflicting_evidence',
  'not_reviewed',
] as const;

export const RequirementFacetAnnotationSchema = z
  .object({
    facetId: z.enum(requirementFacets.map((f) => f.id)),
    applicability: z.enum(['applicable', 'not_applicable', 'unknown']),
    requirementState: z.enum(['explicit', 'justified', 'unknown']),
    assessmentState: z.enum(assessmentStates),
    evidenceKind: z.enum(evidenceKinds),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    review: z.enum(['unreviewed', 'human_reviewed', 'independently_reviewed']),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.assessmentState === 'supported') {
      if (
        v.applicability === 'unknown' ||
        v.requirementState === 'unknown' ||
        v.coverage !== 'complete' ||
        !originalEvidence.has(v.evidenceKind)
      )
        fail('已知要求必须有完整的原要求、既有材料或任务属性依据');
    } else if (v.applicability !== 'unknown' || v.requirementState !== 'unknown') {
      fail('证据不足、冲突或未审阅时，适用性和要求状态必须保留 unknown');
    }
    if (v.requirementState === 'explicit' && v.evidenceKind !== 'original_requirement')
      fail('explicit 只表示原要求明确规定，属性推导必须标 justified');
    if (
      v.assessmentState === 'not_reviewed' &&
      (v.evidenceKind !== 'unknown' || v.coverage !== 'unknown')
    )
      fail('尚未审阅不能声明已完成证据覆盖');
    if (
      v.assessmentState === 'conflicting_evidence' &&
      (!originalEvidence.has(v.evidenceKind) || v.coverage === 'unknown')
    )
      fail('冲突状态必须指向原要求、既有材料或任务属性中的冲突证据');
  });

// Tighten the draft for computation: a supported entry must describe a known
// requirement, never just a method mentioned in an execution record.
const LocalDomainAnnotationSchema = DifficultyAnnotationDraftSchema.superRefine((v, ctx) => {
  for (const [index, c] of v.criteria.entries()) {
    const fail = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['criteria', index], message });
    if (
      c.applicability !== 'unknown' &&
      (v.classificationState !== 'supported' ||
        c.coverage !== 'complete' ||
        !originalEvidence.has(c.evidenceKind))
    )
      fail('已知适用性需要已识别分类与完整的原要求依据');
    if (
      c.state === 'supported' &&
      (c.applicability === 'unknown' ||
        (c.applicability === 'applicable' && c.anchorIndex === null))
    )
      fail('supported 必须给出原描述或有依据的不适用状态');
    if (
      c.state === 'conflicting_evidence' &&
      (!originalEvidence.has(c.evidenceKind) || c.coverage === 'unknown')
    )
      fail('冲突描述必须有原要求、既有材料或任务属性中的冲突证据');
  }
});

export const DifficultyReviewComponentSchema = z
  .object({
    componentId: z.string().uuid().toLowerCase(),
    requirementVersion: z.string().uuid().toLowerCase(),
    annotation: LocalDomainAnnotationSchema,
    facets: z.array(RequirementFacetAnnotationSchema).max(requirementFacets.length).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.requirementVersion !== v.annotation.requirementVersion.toLowerCase())
      ctx.addIssue({
        code: 'custom',
        path: ['requirementVersion'],
        message: '同一部分的要求版本与领域标注版本冲突',
      });
    if (new Set(v.facets?.map((f) => f.facetId)).size !== (v.facets?.length ?? 0))
      ctx.addIssue({ code: 'custom', path: ['facets'], message: '同一要求版本的 facet 不能重复' });
    if (
      v.annotation.phase === 'unavailable' &&
      v.facets?.some(
        (f) =>
          f.applicability !== 'unknown' ||
          f.requirementState !== 'unknown' ||
          f.assessmentState === 'supported' ||
          f.evidenceKind !== 'unknown' ||
          f.coverage !== 'unknown',
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['facets'],
        message: '未取得原要求时，facet 不能声称已有要求依据',
      });
  });

export const DifficultyReviewSchema = z
  .object({
    version: z.literal('difficulty-local-review-1'),
    root: DifficultyReviewComponentSchema,
    parts: z.array(DifficultyReviewComponentSchema).max(256).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>([v.root.componentId]);
    for (const [index, part] of v.parts.entries()) {
      if (seen.has(part.componentId))
        ctx.addIssue({
          code: 'custom',
          path: ['parts', index, 'componentId'],
          message: 'componentId 必须唯一；同一部分不能重复或混用要求版本',
        });
      seen.add(part.componentId);
    }
  });

export type RequirementFacetAnnotation = z.infer<typeof RequirementFacetAnnotationSchema>;
export type DifficultyReviewInput = z.infer<typeof DifficultyReviewSchema>;
type ReviewComponent = z.infer<typeof DifficultyReviewComponentSchema>;
type CoverageEntry = {
  applicability: 'applicable' | 'not_applicable' | 'unknown';
  assessmentState: (typeof assessmentStates)[number];
};

export type ReviewCoverage = {
  expected: number | null;
  known: number;
  unknown: number | null;
  conflicting: number;
  notApplicable: number;
  status: 'complete' | 'incomplete' | 'conflicting' | 'unclassified';
};

// These are counts of reviewed catalogue entries, not quantities of work or
// difficulty points. notApplicable is a subset of known, not an extra addend.
function coverage(entries: CoverageEntry[], classified = true): ReviewCoverage {
  if (!classified)
    return {
      expected: null,
      known: 0,
      unknown: null,
      conflicting: 0,
      notApplicable: 0,
      status: 'unclassified',
    };
  const known = entries.filter((e) => e.assessmentState === 'supported').length;
  const conflicting = entries.filter((e) => e.assessmentState === 'conflicting_evidence').length;
  const unknown = entries.length - known - conflicting;
  return {
    expected: entries.length,
    known,
    unknown,
    conflicting,
    notApplicable: entries.filter((e) => e.applicability === 'not_applicable').length,
    status: conflicting ? 'conflicting' : unknown ? 'incomplete' : 'complete',
  };
}

function reviewComponent(component: ReviewComponent) {
  const a = component.annotation;
  const domain = difficultyFramework.domains.find((d) => d.domain === a.domain);
  const recorded = new Map(a.criteria.map((c) => [c.criterionId, c]));
  const criteria = (domain?.criteria ?? []).map((c) => {
    const criterionId = `${a.domain}.${c.id}`;
    const entry = recorded.get(criterionId);
    const anchorIndex = entry?.anchorIndex ?? null;
    return {
      criterionId,
      label: c.label,
      descriptions: [...c.anchors],
      applicability: entry?.applicability ?? ('unknown' as const),
      assessmentState: entry?.state ?? ('not_reviewed' as const),
      anchorIndex,
      description: anchorIndex === null ? null : c.anchors[anchorIndex],
      evidenceKind: entry?.evidenceKind ?? ('unknown' as const),
      coverage: entry?.coverage ?? ('unknown' as const),
      review: entry?.review ?? ('unreviewed' as const),
    };
  });
  const recordedFacets = new Map(component.facets?.map((f) => [f.facetId, f]));
  const facetGroups = requirementFacetGroups.map((group) => {
    const entries = requirementFacets
      .filter((facet) => facet.group === group.id)
      .map((facet) => {
        const entry = recordedFacets.get(facet.id);
        return {
          facetId: facet.id,
          label: facet.label,
          requirement: facet.requirement,
          referenceUrls: [...facet.referenceUrls],
          applicability: entry?.applicability ?? ('unknown' as const),
          requirementState: entry?.requirementState ?? ('unknown' as const),
          assessmentState: entry?.assessmentState ?? ('not_reviewed' as const),
          evidenceKind: entry?.evidenceKind ?? ('unknown' as const),
          coverage: entry?.coverage ?? ('unknown' as const),
          review: entry?.review ?? ('unreviewed' as const),
        };
      });
    return { ...group, entries, coverage: coverage(entries) };
  });
  return {
    componentId: component.componentId,
    requirementVersion: component.requirementVersion,
    phase: a.phase,
    domain: a.domain,
    workType: a.workType,
    classificationState: a.classificationState,
    domainReview: { criteria, coverage: coverage(criteria, !!domain) },
    facetReview: {
      groups: facetGroups,
      coverage: coverage(facetGroups.flatMap((group) => group.entries)),
    },
    // null means unrecorded. Arrays only enumerate supplied records: an empty
    // filtered list does not prove that no further method obligation exists.
    methods: {
      required: a.requiredMethods?.filter((m) => m.necessity !== 'proposed') ?? null,
      proposed: a.requiredMethods?.filter((m) => m.necessity === 'proposed') ?? null,
      used: a.usedMethods,
    },
    inputConditions: a.inputConditions,
    score: null,
    level: null,
  };
}

export function computeDifficultyReview(
  input?: unknown,
  options: { mode?: 'off' | 'local_review' } = {},
) {
  // Do not inspect input, validate it, perform I/O, or call a model on this path.
  if (options.mode !== 'local_review')
    return {
      mode: 'off',
      status: 'disabled',
      enabled: false,
      productionIntake: false,
      score: null,
      level: null,
      globalRating: null,
    } as const;

  const data = DifficultyReviewSchema.parse(input);
  return {
    version: data.version,
    frameworkVersion: difficultyFramework.version,
    mode: 'local_review',
    status: 'draft_unvalidated',
    enabled: false,
    productionIntake: false,
    root: reviewComponent(data.root),
    parts: data.parts.map(reviewComponent),
    aggregation: 'none',
    score: null,
    level: null,
    globalRating: null,
  } as const;
}
