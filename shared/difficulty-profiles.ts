import { z } from 'zod';
import { workDomains, workTypeIds } from './work-taxonomy.js';

// These questions describe required work. They neither select a level nor score it.
const checks: Record<string, Record<string, string>> = {
  software: {
    requirements: '目标是否独立；验收边界、例外及需求冲突是否需要澄清',
    architecture: '接口边界、共享状态、故障传播与替代方案的成立条件',
    frontend: '静态展示还是状态交互；权限、异常、无障碍和跨端一致性要求',
    backend: '分支规则、数据不变量、幂等、事务及失败恢复义务',
    mobile: '设备与平台差异、离线状态、生命周期、交互与恢复约束',
    database: '模式与旧数据变更；并存、完整性、回滚及不停机要求',
    integration: '外部契约是否已知；认证、重放、限流及失败补偿条件',
    concurrency: '共享状态、执行顺序、竞争条件、一致性和恢复义务',
    debugging: '原因已知还是待定位；可复现性、候选原因及因果链证据',
    performance: '目标负载、瓶颈证据、性能约束与正确性保持',
    security: '角色与租户边界、威胁假设、敏感动作和权限不变量',
    refactoring: '行为保持、接口兼容、数据迁移和回退边界',
    testing: '执行已有用例还是构造边界；不变量、故障注入及覆盖要求',
    devops: '环境依赖、部署状态、配置来源、回滚和停机边界',
    observability: '信号与事件对应、原因辨别、告警条件及恢复验证',
    developer_tools: '输入协议、状态及错误恢复；权限、版本与可复现执行',
    documentation: '来源与接口对应、适用版本、例外及迁移步骤保持',
    maintenance: '升级范围、兼容契约、变更影响与回退条件',
    algorithm: '问题形式化与输入边界；正确性证明、时间空间界及近似保证是否必需',
    algorithm_design: '是否已有可用方案；表示、算法选型或新构造、正确性与资源保证',
    algorithm_analysis: '算法和计算模型是否给定；最坏、期望、摊还界及终止、精确或近似保证',
    parsing: '语法与语义是否给定；歧义、嵌套、错误恢复与往返保持条件',
    static_analysis: '分析对象和性质；路径、别名、跨过程关系及可靠性与完备性边界',
    numerical: '数学模型与适用域；舍入、收敛、病态输入、误差容限和资源界',
    networking: '协议状态和消息顺序；丢失、重放、超时、兼容及恢复义务',
    compilation: '语言或中间表示的语义保持；优化、跨平台、链接及可复现构建条件',
    formal_verification: '前提、状态空间与待证性质；安全或活性义务、抽象假设与反例范围',
    game: '实时交互与状态规则；物理、动画、网络同步、延迟及可恢复行为',
  },
  data: {
    streaming: '事件时间与到达顺序；窗口、迟到数据、状态恢复及恰好一次语义要求',
    text_mining: '语言单位与标签定义；语义歧义、多语言、标注一致与领域迁移',
    graph_analysis: '实体与边的语义；多关系、时序、缺边偏差及算法条件',
    privacy: '允许披露的范围与攻击假设；去标识、链接风险、信息保持及验证依据',
    sampling: '目标人群、抽样框与设计；选择机制、依赖、代表性及权重适用性',
    ingestion: '来源协议、更新边界、增量归属、重放和漏读条件',
    parsing: '结构是否稳定；嵌套、歧义、编码和损坏输入的处理',
    cleaning: '规则是否已定；缺失机制、异常与来源口径差异',
    deduplication: '唯一标识是否存在；实体消歧、误合并及重复范围',
    labeling: '标签定义、边界案例、冲突处理与一致性检查',
    transformation: '变换依据、单位及尺度、时间归属和信息保持',
    sql: '指标口径、连接粒度、空值、时间窗口与计数守恒',
    pipeline: '阶段依赖、迟到数据、重放、幂等及恢复义务',
    quality: '粒度、缺失、重复、关联完整性及已知基准',
    exploration: '问题是否已定；关系探索、偏差与结论范围',
    inference: '样本依赖、假设、缺失机制、效应与区间成立条件',
    forecasting: '时间依赖、预测目标、泄漏、分布变化与验证范围',
    causal: '竞争解释、混杂、识别假设及可识别边界',
    visualization: '数值来源、编码关系、尺度与受众理解要求',
    dashboard: '指标定义、刷新粒度、筛选条件和跨视图一致性',
    geospatial: '坐标系、空间关系、分辨率及边界误差',
  },
  ai: {
    speech: '语音任务与评价单位；说话者、噪声、语言、时序对齐及延迟要求',
    vision: '视觉目标与标注关系；遮挡、尺度、多视角、场景变化及独立验证',
    recommendation: '排序目标与曝光机制；冷启动、选择偏差、多目标及离线到线上适用性',
    time_series: '信息可用时点与预测范围；非平稳、异常标签、泄漏及滚动验证',
    distributed_training: '并行划分与目标保持；通信、同步、数值误差、资源及故障恢复',
    problem_definition: '学习目标、指标代理、约束与真实行为是否对应',
    dataset: '来源与标签、近似重复、时间切分及评估泄漏',
    feature: '构造依据、可用时点、泄漏与稳定性要求',
    classical_model: '目标和样本关系、模型假设、比较基线与验证',
    neural_model: '结构是否给定；目标、训练条件与泛化义务',
    finetuning: '原模型保持、目标适配、遗忘和独立评价条件',
    retrieval: '来源粒度、检索与重排、引用和失败归因',
    agent: '状态依赖、外部动作、权限、幂等及恢复义务',
    multimodal: '模态时空对应、缺失与冲突信息和独立评价',
    evaluation: '任务与指标、切分、泄漏、错误类型及比较条件',
    robustness: '扰动或攻击边界、失效模式与独立检验范围',
    inference: '精度保持、延迟与内存约束、算子及环境兼容',
    monitoring: '信号与分布变化、反馈延迟、触发依据和误报',
    experiment_design: '待区分的机制、控制条件、消融及样本切分',
  },
  mathematics: {
    probability: '随机对象、依赖与分布前提；条件化、极限、随机过程及证明义务',
    differential_equations: '初值或边值与方程类型；存在唯一性、稳定性、离散误差及验证',
    geometry: '对象、维度与位置关系；退化、坐标变换、构造或证明要求',
    scheduling: '任务、时间与资源约束；先后、容量、动态信息及可行或最优性保证',
    formulation: '目标、变量、假设、约束及表示等价性',
    formalization: '自然语言命题到形式系统的陈述；定义、前提、库、语义保持与机器检查',
    symbolic: '适用域、分支、变换条件及结果恒等性',
    proof: '待证命题、前提、关键构造与反例范围',
    numerical: '误差源、收敛、病态输入及精度要求',
    linear_optimization: '可行域、结构、对偶及是否要求最优性证明',
    discrete_optimization: '离散结构、耦合约束、可行解或最优性界要求',
    nonlinear_optimization: '非凸结构、局部或全局目标、条件及验证',
    stochastic: '随机来源、分布依据、信息时点及稳健范围',
    multiobjective: '目标定义、偏好、约束和权衡方案比较',
    graph: '节点边语义、权重、容量、时序及目标性质',
    simulation: '状态转移、事件时序、随机性及基准验证',
    inverse: '可识别性、观测误差、先验及解的不唯一性',
    uncertainty: '误差传播、依赖、假设范围及敏感性',
    validation: '基准、可行性、残差、适用域和失效条件',
  },
  research: {
    qualitative: '分析单位与编码框架；情境、研究者影响、竞争解释及记录可追溯性',
    survey: '测量构念与人群；抽样、题项、效度、偏差及跨群体可比性',
    synthesis: '跨学科定义与证据类型；纳排、异质性、冲突及综合结论的成立范围',
    science_communication: '受众与关键主张；事实、条件、不确定性、例子及来源关系保持',
    evidence_gap_map: '问题框架与纳排规则；证据单元、重复、研究设计及缺口定义',
    mixed_methods: '定性与定量证据的角色；情境、机制、异质性和相互解释关系',
    textual_criticism: '文本见证、版本和语境；异文、来源独立性、校勘依据与解释范围',
    search: '来源已给还是需检索；纳排规则、重复与检索范围',
    review: '证据质量、来源独立性、冲突结果及综合规则',
    novelty: '最接近工作、贡献边界、重合及实质差异',
    hypothesis: '可证伪性、竞争解释和区分它们的观察',
    protocol: '控制条件、混杂、因素交互及区分机制的能力',
    experiment: '协议执行、随机化、测量、偏离与异常解释',
    replication: '材料与环境对应、独立复现及差异定位',
    interpretation: '证据与主张、效应范围、替代解释和因果界限',
    fact_check: '主张、原始出处、时间适用性与矛盾材料',
    writing: '研究问题、方法、结果与结论的证据对应',
    response: '意见与修改对应、证据补充及范围保持',
    data_management: '来源、版本、实验条件、变更与复现映射',
  },
  engineering: {
    communication: '信道与信号模型；噪声、编码、频谱、同步及性能验证条件',
    chemistry: '物质、反应与过程边界；守恒、动力学、实验条件及测量不确定度',
    environmental: '空间时间范围与观测口径；传递、暴露、生态依赖和实测验证',
    aerospace: '任务与工况、坐标和动力模型；结构、控制、极端条件及验证层级',
    mechanical: '载荷、边界、材料、结构关系及误差范围',
    electronics: '信号、器件及电源约束、容差和保护条件',
    embedded: '硬件时序、资源、接口与故障恢复',
    control: '状态、稳定性、工况、约束及动态反馈',
    robotics: '感知、规划与执行对应、动态环境及安全边界',
    energy: '守恒、传递、效率、工况和多过程关系',
    civil: '荷载、材料、规范条件、边界和可靠性',
    manufacturing: '工艺步骤、容差、设备条件和质量验证',
    materials: '配方或结构、机制、试验条件及性质验证',
    simulation: '物理假设、离散误差、校准与实测对应',
    reliability: '失效机制、依赖、极端工况和证据范围',
    verification: '试验目标、标准、测量误差与仿真区别',
    systems: '专业接口、反馈、工况及整体整合义务',
  },
  writing: {
    humanities: '文本与历史语境；概念、诠释、竞争解释及证据到论点的关系',
    documentation_review: '各文档的身份和版本；定义、数字、引用、条件与修改范围的一致性',
    outline: '现成提纲还是构造结构；材料、主张及阅读关系',
    drafting: '给定材料范围、内容构造、受众与事实约束',
    explanation: '前置知识、适用条件、例子与解释完整性',
    argument: '主张、前提、证据、反例及结论范围',
    narrative: '叙事线、人物或事件关系、连续性与事实约束',
    rewriting: '结构变化、原意、条件例外及范围保持',
    line_editing: '措辞、语气、术语、受众和原意保持',
    proofreading: '明确错误规则、交叉引用、数字与格式一致性',
    summarization: '信息取舍、条件例外、覆盖与压缩范围',
    technical: '接口或方法来源、版本、步骤与异常条件',
    academic: '主张与证据、方法、引用及结论强度保持',
    copywriting: '受众、目的、表达约束及事实可证实性',
  },
  translation: {
    interpretation_materials: '交流场景与受众；术语、口语表达、歧义、顺序及信息保持',
    general: '上下文、指代、歧义及语气对应',
    technical: '术语稳定性、跨专业关系与条件例外保持',
    literary: '叙事、隐含意义、风格及多义保持',
    localization: '占位符、界面长度、状态、语言与平台适配',
    transcreation: '文化语用、功能、受众与事实约束共同保持',
    terminology: '定义、来源、对应关系与跨文档一致性',
    revision: '源文覆盖、意义、术语与格式的双语核对',
    subtitles: '语义覆盖、时间对应、阅读长度与音画关系',
  },
  design: {
    service: '用户与服务角色；触点、流程、等待、异常及前后台交付关系',
    spatial: '空间尺度与使用条件；动线、可视性、无障碍、结构约束和呈现方式',
    brief: '受众、目标任务、冲突要求及交付边界',
    brand: '身份语义、组件及多载体规则一致性',
    layout: '阅读顺序、内容关系、层次与布局约束',
    illustration: '语义主体、构图关系、表达约束与素材条件',
    presentation: '叙述关系、页面连续、图文对应与阅读距离',
    information: '数值与关系、视觉编码、尺度和可理解性',
    interface: '内容层次、交互状态、异常与跨端适配',
    interaction: '角色、路径、状态转移、例外与恢复',
    prototype: '目标用户任务、关键状态及使用检验',
    design_system: '组件规则、变体、内容与多载体一致性',
    accessibility: '使用条件、输入方式、感知与操作约束',
    asset: '内容范围、格式适配、引用及导出一致性',
  },
  media: {
    restoration: '损坏或噪声类型；细节保持、伪影、时间一致和原内容真实性',
    music: '结构、节奏、音色与声部；风格、连续性、约束及可听验收',
    audio_understanding: '声音事件与语言内容；说话者、时间、因果或情境关系及独立核验',
    video_understanding: '镜头、对象和动作；长程时序、空间、音画关系及证据定位',
    script: '事件、镜头、节奏、叙事连续与素材边界',
    transcription: '语音内容、说话关系、噪声及时间对齐',
    editing: '片段关系、多轨、节奏与叙事连续性',
    audio: '噪声、频谱、动态、通道与视听对应',
    color: '场景一致、损坏范围、细节和真实性保持',
    compositing: '空间、遮挡、运动、光照及时间连续',
    animation: '运动关系、节奏、状态及跨镜头连续',
    subtitles: '时间、版式、覆盖、音画与阅读条件',
    encoding: '源内容保持、格式、码率及多平台一致性',
    generative: '约定内容、跨片段一致、视听关系与来源条件',
  },
  office: {
    knowledge: '信息身份、来源与版本；层次、检索、权限、重复及更新传播',
    document: '结构、表格引用、版式、数字与内容保持',
    spreadsheet: '公式、跨表依赖、口径、空值与对账',
    presentation: '材料关系、页面连续、可编辑性与数值对应',
    conversion: '内容、布局、公式与多软件兼容保持',
    forms: '字段、单据身份、校验和目标状态',
    correspondence: '对象与目的、事实、语气及权限边界',
    meetings: '决策、行动归属、时间与原记录对应',
    scheduling: '时区、冲突、资源、顺序与变更条件',
    automation: '条件流程、权限、幂等、异常与补偿',
    reconciliation: '来源、粒度、身份与差异处理',
  },
  business: {
    economics: '研究问题与经济口径；时点、样本、识别条件、假设及结论边界',
    public_policy: '政策对象、地区和版本；目标冲突、证据、受影响群体及执行条件',
    social_research: '人群与构念；抽样、情境、测量偏差和定性或定量证据关系',
    community: '成员角色与运营规则；内容、权限、例外、冲突处理和成效口径',
    configuration_quote: '产品组合与版本规则；兼容、数量、折扣资格、币种及报价有效期',
    market: '来源独立性、比较条件、口径与证据范围',
    strategy: '目标冲突、假设、情景和决策依据',
    product: '用户目标、范围、资源约束与交付依赖',
    project: '任务依赖、资源、里程碑与变化处理',
    content: '受众、内容规则、来源及交付范围',
    customer: '事实与请求、适用规则、异常与升级边界',
    sales: '需求与方案对应、条件及可证实主张',
    procurement: '规格、总成本、约束与供应商可比条件',
    logistics: '时空、容量、依赖、异常与服务约束',
    process: '当前流程、原因证据、条件与效果验证',
    incident: '事件边界、权限、证据、协调与恢复',
    reporting: '指标、归属、粒度、异常与解释范围',
  },
  education: {
    assessment_design: '目标构念与题项；评分准则、内容效度、信度及群体可比性',
    curriculum: '前置关系、目标、受众与课程顺序',
    lesson: '知识与材料对应、受众及表达约束',
    explanation: '前置概念、推导、例子与适用条件',
    tutoring: '回答证据、缺项与竞争错误概念',
    exercises: '考查目标、独立场景、解答与评分标准',
    assessment: '过程、正确性、评分一致与反馈依据',
    adaptation: '基础差异、表达方式、无障碍和冲突需求',
    learning_plan: '目标、前置知识、时间与进度依据',
    evaluation: '迁移任务、提示影响与真实理解证据',
  },
  legal: {
    privacy: '地区、日期与数据行为；主体权利、处理依据、例外及专业复核',
    intellectual_property: '权利类型、材料身份与地区；引用、许可、归属及专业复核',
    issue_spotting: '给定事实与候选问题；相关要素、缺失事实及适用地区和时点',
    rule_application: '规则成立条件与例外；事实到条件的对应、冲突证据及专业复核',
    rule_conclusion: '给定规则与事实到结论的推理；未确定事项、替代解释及结论范围',
    interpretation: '术语、上下文与引用关系；多种解释、权利义务及专业复核',
    rhetorical_understanding: '主张、修辞与论证目的；前提、证据、反驳及表达作用',
    retrieval: '规则来源、地区、日期、层级和检索范围',
    comparison: '版本、定义、引用、权利义务与例外',
    drafting: '给定事实、适用条件、条款关系与专业复核',
    review: '覆盖、冲突义务、适用边界与专业复核',
    compliance: '控制要求、条件、证据与材料覆盖',
    evidence: '事实与来源对应、冲突和未确定事项',
    filing: '材料清单、时点、格式与可追溯依据',
  },
  health: {
    bioinformatics: '样本、测量平台与参考版本；批次、组学依赖、误差及独立验证',
    epidemiology: '人群、时间与研究设计；暴露、结局、混杂、选择偏差及因果边界',
    literature: '研究或指南来源、时点、质量与适用人群',
    evidence: '研究设计、偏差、异质性及冲突结果',
    education: '受众、准确性、适用范围及专业复核',
    terminology: '定义、上下文、对应关系与术语一致性',
    data: '粒度、测量、缺失机制与研究口径',
    protocol: '研究问题、混杂、测量和证据边界',
    documentation: '原始事实、覆盖、引用与专业复核',
  },
  finance: {
    insurance: '风险对象与期间；事件依赖、赔付规则、分布假设及精算材料复核',
    portfolio: '资产、时点与约束；收益风险依赖、交易条件、稳健性及样本外验证',
    extraction: '文本和表格的对应；单位、期间、币种、符号、合并项与来源定位',
    textual_analysis: '金融事实与观点的区分；事件时间、主体指代、情绪、来源及标签规则',
    evidence_qa: '问题中的财务口径；多跳来源、表格关系、计算步骤及可追溯证据',
    accounting: '账户、凭据、分类规则与期间归属',
    reconciliation: '身份、金额、粒度、差异与例外',
    budgeting: '目标、假设、依赖、时点与情景范围',
    statements: '跨报表勾稽、调整、披露口径与专业复核',
    valuation: '现金流、假设、条件、情景与敏感性',
    risk: '风险对象、依赖、尾部条件与模型边界',
    tax_materials: '期间、规则适用、凭据与专业复核',
    research: '来源、市场时点、假设与结论边界',
    controls: '控制对象、证据、异常及复核范围',
  },
};

const methodCodes: Record<string, string[]> = {
  software: [
    'contracts',
    'state_invariants',
    'diagnosis',
    'transactions',
    'concurrency',
    'migration',
    'threat_model',
    'profiling',
  ],
  data: [
    'mapping',
    'constraints',
    'entity_resolution',
    'inference',
    'temporal_validation',
    'identification',
    'spatial',
  ],
  ai: [
    'supervision',
    'representation',
    'finetuning',
    'retrieval',
    'orchestration',
    'ablation',
    'deployment',
    'drift',
  ],
  mathematics: [
    'symbolic',
    'proof',
    'convex',
    'integer',
    'stochastic',
    'dynamics',
    'discretization',
    'simulation',
  ],
  research: [
    'source_quality',
    'citation',
    'synthesis',
    'screening',
    'hypotheses',
    'controlled_experiment',
    'replication',
  ],
  engineering: [
    'conservation',
    'structure',
    'circuits',
    'identification',
    'control',
    'reliability',
    'calibration',
  ],
  writing: ['structure', 'argument', 'facts', 'narrative', 'style', 'scope_preservation'],
  translation: ['alignment', 'terminology', 'culture', 'placeholders', 'timing', 'review'],
  design: ['hierarchy', 'composition', 'interaction', 'components', 'usability', 'accessibility'],
  media: ['editing', 'timing', 'mixing', 'color', 'compositing', 'animation', 'encoding'],
  office: ['layout', 'reconciliation', 'mapping', 'conversion', 'automation', 'receipts'],
  business: ['market', 'decision', 'comparison', 'planning', 'escalation', 'service'],
  education: ['prerequisites', 'examples', 'diagnosis', 'practice', 'assessment', 'transfer'],
  legal: ['retrieval', 'applicability', 'comparison', 'evidence', 'conflicts'],
  health: ['retrieval', 'evidence', 'design', 'terminology', 'scope'],
  finance: ['reconciliation', 'statements', 'cash_flow', 'scenarios', 'valuation', 'risk'],
};

type Rubric = { methods: string[]; criteria: { id: string; label: string }[] };
export function subtypeProfiles(domainId: string, rubric: Rubric) {
  const domain = workDomains.find((d) => d.id === domainId)!;
  const codes = methodCodes[domainId];
  if (codes.length !== rubric.methods.length) throw new Error('方法目录与版本不一致');
  return {
    methodCatalogue: codes.map((code, i) => ({
      id: `${domainId}.${code}`,
      label: rubric.methods[i],
    })),
    subtypeProfiles: domain.activities.map((activity) => {
      const check = checks[domainId]?.[activity.id.split('.')[1]];
      if (!check) throw new Error('工作子类型缺少具体要求检查：' + activity.id);
      return {
        workType: activity.id,
        label: activity.label,
        requirementChecks: check.split('；'),
        criterionIds: rubric.criteria.map((c) => `${domainId}.${c.id}`),
        units: domain.units,
        acceptanceObligations: domain.acceptance,
        applicability:
          'decide_from_requirement_evidence_per_criterion; never_auto_apply_all_criteria',
        methodSelection:
          'candidate_methods_only; justified_obligation_precedes_method_choice; alternatives_allowed',
      };
    }),
  };
}

type DraftDomain = {
  domain: string;
  criteria: { id: string }[];
  methodCatalogue: { id: string }[];
};
export function draftAnnotationSchema(domains: DraftDomain[]) {
  const evidenceKind = z.enum([
    'original_requirement',
    'provided_material',
    'task_property',
    'execution_log',
    'unknown',
  ]);
  return z
    .object({
      version: z.literal('domain-difficulty-draft-2'),
      requirementVersion: z.string().uuid(),
      phase: z.enum(['before_execution', 'original_request_review', 'unavailable']),
      domain: z.enum(['unknown', ...workDomains.map((d) => d.id)] as [string, ...string[]]),
      workType: z.enum(['unknown', ...workTypeIds]),
      classificationState: z.enum(['supported', 'mixed', 'unknown']),
      criteria: z
        .array(
          z
            .object({
              criterionId: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
              applicability: z.enum(['applicable', 'not_applicable', 'unknown']),
              state: z.enum([
                'supported',
                'insufficient_evidence',
                'conflicting_evidence',
                'not_reviewed',
              ]),
              anchorIndex: z.number().int().min(0).max(3).nullable(),
              evidenceKind,
              coverage: z.enum(['complete', 'partial', 'unknown']),
              review: z.enum(['unreviewed', 'human_reviewed', 'independently_reviewed']),
            })
            .strict(),
        )
        .max(64),
      requiredMethods: z
        .array(
          z
            .object({
              obligationId: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
              methodId: z
                .string()
                .regex(/^[a-z_]+\.[a-z_]+$/)
                .nullable(),
              necessity: z.enum(['explicit', 'justified', 'proposed']),
              evidenceKind,
              coverage: z.enum(['complete', 'partial', 'unknown']),
            })
            .strict(),
        )
        .max(64)
        .nullable(),
      usedMethods: z
        .array(
          z
            .object({
              methodId: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
              status: z.enum(['applied', 'attempted_abandoned']),
            })
            .strict(),
        )
        .max(64)
        .nullable(),
      inputConditions: z
        .object({
          missing: z.enum(['none', 'required_material_missing', 'unknown']),
          conflict: z.enum(['none', 'source_conflict', 'requirement_conflict', 'unknown']),
          ambiguity: z.enum(['none', 'resolvable', 'unresolved', 'unknown']),
        })
        .strict(),
    })
    .strict()
    .superRefine((v, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (
        v.phase === 'unavailable' &&
        (v.classificationState !== 'unknown' ||
          v.domain !== 'unknown' ||
          v.workType !== 'unknown' ||
          Object.values(v.inputConditions).some((value) => value !== 'unknown'))
      )
        fail('未取得原要求时分类与材料条件保持 unknown，不能声称已核对没有缺失或冲突');
      const domain = domains.find((d) => d.domain === v.domain);
      const criteria = new Set(domain?.criteria.map((c) => `${v.domain}.${c.id}`) ?? []);
      const methods = new Set(
        (domain ? [domain] : domains).flatMap((d) => d.methodCatalogue.map((m) => m.id)),
      );
      if (
        v.classificationState === 'supported' &&
        (v.domain === 'unknown' || v.workType === 'unknown')
      )
        fail('已识别分类需要明确领域与子类型');
      if (v.workType !== 'unknown' && !v.workType.startsWith(v.domain + '.'))
        fail('领域与工作子类型不一致');
      if (
        v.classificationState !== 'supported' &&
        (v.criteria.some((c) => c.anchorIndex !== null) || v.requiredMethods !== null)
      )
        fail('分类未知或根目标跨领域时不输出确定描述与必要方法；混合任务按部分分别标注');
      if (new Set(v.criteria.map((c) => c.criterionId)).size !== v.criteria.length)
        fail('判断条目不能重复');
      for (const c of v.criteria) {
        if (!criteria.has(c.criterionId)) fail('判断条目不属于当前领域');
        if (
          v.phase === 'unavailable' &&
          (c.applicability !== 'unknown' ||
            c.state === 'supported' ||
            c.evidenceKind !== 'unknown' ||
            c.coverage !== 'unknown')
        )
          fail('没有原要求时不能声称已取得完整适用性依据');
        if (
          c.anchorIndex !== null &&
          (c.applicability !== 'applicable' ||
            c.state !== 'supported' ||
            c.coverage !== 'complete' ||
            !['original_requirement', 'provided_material', 'task_property'].includes(
              c.evidenceKind,
            ) ||
            v.phase === 'unavailable')
        )
          fail('描述序号需要完整的事前要求依据；不适用、冲突及缺依据时为 null');
        if (
          c.applicability === 'not_applicable' &&
          (c.state !== 'supported' ||
            c.coverage !== 'complete' ||
            !['original_requirement', 'provided_material', 'task_property'].includes(
              c.evidenceKind,
            ))
        )
          fail('不适用也需要原要求依据，不能用于跳过严格条目');
      }
      for (const m of v.requiredMethods ?? []) {
        if (!criteria.has(m.obligationId) || (m.methodId !== null && !methods.has(m.methodId)))
          fail('方法或义务不在当前领域目录');
        if (m.necessity === 'explicit' && m.evidenceKind !== 'original_requirement')
          fail('明确指定的方法必须来自原要求，属性推导应标 justified');
        if (
          m.necessity !== 'proposed' &&
          (m.coverage !== 'complete' ||
            !['original_requirement', 'provided_material', 'task_property'].includes(
              m.evidenceKind,
            ))
        )
          fail('必要方法不能用执行日志、名称或未完整依据推断');
      }
      if ((v.usedMethods ?? []).some((m) => !methods.has(m.methodId)))
        fail('实际方法不在当前领域目录');
      if (v.phase === 'unavailable' && v.requiredMethods !== null)
        fail('未取得原要求时必要方法为 null');
    });
}
