// Display labels and taxonomy helpers; no validation or runtime collection.
export const domainLabels = {
  software: '软件开发',
  writing: '写作与翻译',
  research: '研究与检索',
  data: '数据处理',
  design: '设计与媒体',
  office: '办公与流程',
  operations: '运营与支持',
  education: '教学与学习',
  other: '其他工作',
} as const;
export type WorkDomain = keyof typeof domainLabels;
export const labels = {
  kind: {
    feature: '功能开发',
    bugfix: '问题修复',
    refactor: '代码重构',
    test: '测试编写',
    docs: '文档工作',
    tooling: '工具配置',
    writing_draft: '文章起草',
    writing_edit: '文字编辑',
    translation: '翻译与本地化',
    research_search: '资料检索',
    research_synthesis: '研究综合',
    fact_check: '事实与来源核对',
    data_cleaning: '数据清理',
    data_analysis: '数据分析',
    data_visualization: '数据可视化',
    visual_design: '视觉设计',
    media_editing: '音视频编辑',
    product_design: '产品与交互设计',
    office_document: '办公文档',
    office_workflow: '办公流程',
    content_operation: '内容运营',
    support_case: '支持与事务处理',
    project_planning: '项目与活动规划',
    learning_material: '教学材料',
    learning_support: '学习辅导',
    other_work: '其他工作',
  },
  scope: {
    component: '单个组件',
    module: '多个组件',
    service: '多个服务',
    single: '单一成果',
    collection: '关联成果',
    cross_system: '跨系统或跨流程',
    unknown: '未记录',
  },
  context: { existing: '已有材料或项目', new: '新建材料或项目', unknown: '未记录' },
  acceptance: { automatic: '自动检查', human: '人工验收', both: '自动与人工', unknown: '未记录' },
  status: {
    accepted: '已验收',
    partial: '部分完成',
    failed: '已结束，未通过',
    abandoned: '已放弃',
    in_progress: '进行中',
  },
  billing: { api: 'API 实付', subscription: '套餐分摊', mixed: '混合付费', unknown: '计费方式未知' },
  payment: { regular: '常规付费', promotion: '促销', trial: '试用', grant: '赠送', unknown: '付款类别未知' },
  allocation: {
    direct: '逐任务实付',
    tokens: '按 Token 分摊',
    equal: '按任务均摊',
    unallocated: '暂不分摊',
    itemized: '逐项归属与共享分摊',
  },
  source: { demo: '演示数据', community: '真实社区' },
} as const;

export type TaskKind = keyof typeof labels.kind;
export const taskKinds = Object.keys(labels.kind) as [TaskKind, ...TaskKind[]];
export const workloadLabels = {
  unit: {
    code_change: '独立代码改动',
    document_section: '文档章节',
    source: '来源或核对项',
    dataset: '数据集',
    chart: '图表',
    visual_asset: '视觉成果',
    media_segment: '媒体片段',
    workflow_step: '流程步骤',
    case: '事务',
    lesson: '教学单元',
    deliverable: '其他成果',
  },
  inputUnits: {
    '0': '无输入材料',
    '1': '1 份',
    '2-5': '2–5 份',
    '6-20': '6–20 份',
    '21+': '21 份以上',
    unknown: '未记录',
  },
  outputUnits: {
    '1': '1 个',
    '2-5': '2–5 个',
    '6-20': '6–20 个',
    '21+': '21 个以上',
    unknown: '未记录',
  },
  constraintCount: {
    '0': '无附加约束',
    '1-3': '1–3 项',
    '4-7': '4–7 项',
    '8+': '8 项以上',
    unknown: '未记录',
  },
  verification: {
    test_suite: '测试执行',
    checklist: '交付清单',
    source_crosscheck: '来源交叉核对',
    reconciliation: '数据核对',
    rubric: '评分标准',
    execution: '流程实测',
    mixed: '多种核查',
    unknown: '未记录',
  },
} as const;
const domainsByKind: Record<TaskKind, WorkDomain> = {
  feature: 'software',
  bugfix: 'software',
  refactor: 'software',
  test: 'software',
  docs: 'software',
  tooling: 'software',
  writing_draft: 'writing',
  writing_edit: 'writing',
  translation: 'writing',
  research_search: 'research',
  research_synthesis: 'research',
  fact_check: 'research',
  data_cleaning: 'data',
  data_analysis: 'data',
  data_visualization: 'data',
  visual_design: 'design',
  media_editing: 'design',
  product_design: 'design',
  office_document: 'office',
  office_workflow: 'office',
  content_operation: 'operations',
  support_case: 'operations',
  project_planning: 'operations',
  learning_material: 'education',
  learning_support: 'education',
  other_work: 'other',
};
export const taskDomain = (kind: TaskKind): WorkDomain => domainsByKind[kind];
export const taskUnits: Record<TaskKind, keyof typeof workloadLabels.unit> = {
  feature: 'code_change',
  bugfix: 'code_change',
  refactor: 'code_change',
  test: 'code_change',
  docs: 'document_section',
  tooling: 'workflow_step',
  writing_draft: 'document_section',
  writing_edit: 'document_section',
  translation: 'document_section',
  research_search: 'source',
  research_synthesis: 'document_section',
  fact_check: 'source',
  data_cleaning: 'dataset',
  data_analysis: 'dataset',
  data_visualization: 'chart',
  visual_design: 'visual_asset',
  media_editing: 'media_segment',
  product_design: 'visual_asset',
  office_document: 'document_section',
  office_workflow: 'workflow_step',
  content_operation: 'deliverable',
  support_case: 'case',
  project_planning: 'deliverable',
  learning_material: 'lesson',
  learning_support: 'lesson',
  other_work: 'deliverable',
};
export const inputSizeUnits = {
  source_lines: '源材料有效代码行',
  characters: '材料字符',
  cells: '数据单元格',
  pixels: '图像像素',
  seconds: '媒体时长（秒）',
  items: '待处理条目',
} as const;
export type InputSizeUnit = keyof typeof inputSizeUnits;
export const inputSizeBands = [
  'none',
  'small',
  'medium',
  'large',
  'very_large',
  'unknown',
] as const;
export const inputSizeLabels: Record<
  InputSizeUnit,
  Record<(typeof inputSizeBands)[number], string>
> = {
  source_lines: {
    none: '无代码材料',
    small: '1–200 行',
    medium: '201–2,000 行',
    large: '2,001–20,000 行',
    very_large: '20,000 行以上',
    unknown: '未记录',
  },
  characters: {
    none: '无文字材料',
    small: '1–4,000 字符',
    medium: '4,001–40,000 字符',
    large: '40,001–400,000 字符',
    very_large: '400,000 字符以上',
    unknown: '未记录',
  },
  cells: {
    none: '无数据材料',
    small: '1–1,000 个单元格',
    medium: '1,001–100,000 个单元格',
    large: '100,001–10,000,000 个单元格',
    very_large: '10,000,000 个单元格以上',
    unknown: '未记录',
  },
  pixels: {
    none: '无图像材料',
    small: '1–200 万像素',
    medium: '200 万–2,000 万像素',
    large: '2,000 万–2 亿像素',
    very_large: '2 亿像素以上',
    unknown: '未记录',
  },
  seconds: {
    none: '无音视频材料',
    small: '1–60 秒',
    medium: '61–600 秒',
    large: '601–3,600 秒',
    very_large: '3,600 秒以上',
    unknown: '未记录',
  },
  items: {
    none: '无待处理条目',
    small: '1–20 条',
    medium: '21–200 条',
    large: '201–2,000 条',
    very_large: '2,000 条以上',
    unknown: '未记录',
  },
};
export const taskInputUnits: Record<TaskKind, InputSizeUnit> = Object.fromEntries(
  taskKinds.map((kind) => [
    kind,
    ['feature', 'bugfix', 'refactor', 'test', 'tooling'].includes(kind)
      ? 'source_lines'
      : ['data_cleaning', 'data_analysis', 'data_visualization'].includes(kind)
        ? 'cells'
        : ['visual_design', 'product_design'].includes(kind)
          ? 'pixels'
          : kind === 'media_editing'
            ? 'seconds'
            : ['office_workflow', 'other_work'].includes(kind)
              ? 'items'
              : 'characters',
  ]),
) as Record<TaskKind, InputSizeUnit>;
