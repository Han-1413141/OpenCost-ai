# 软件、算法、数学、数据与 AI：难度要求研究依据

核验日期：2026-10-12（Asia/Shanghai）。本文件与 [difficulty-computing.json](difficulty-computing.json) 配套。共纳入 21 条原始研究论文、作者稿或官方资料；各条的作者、年份、版本、查询、实际阅读范围、限制与应用建议在 JSON 中保存。

这是一轮有界查证，不是穷尽检索，也未把所有论文逐页读完。使用 paper-search 从 arXiv、Crossref 检索 1976–2026 年的指定主题，取得 50 条来源记录，跨库合并 3 条重复后有 47 个候选；再通过原始网页、论文 PDF 和官方资料补充并筛选。词面排序不用于判断权威性。实际失败的 HTML/PDF、验证页与元数据入口均已记录；不能用未成功取得的全文作依据。

本项目的具体审阅问题是依据文献概念编写的工程设计。文献没有替本项目证明任何难度分界、权重、成本系数或综合分数。当前难度仍默认关闭；本地要求向量用于描述，不参与上传、排行榜或价格计算。

## 必须区分的五类信息

| 信息 | 描述对象 | 不能替代什么 |
| --- | --- | --- |
| 原任务要求 | 用户事先要求的成果、方法、精度、约束和验证 | 不能用实际失败或费用补写 |
| 算法计算复杂度 | 问题族、计算模型、输入参数下的时间/空间或其他资源性质 | 不能直接等同设计、实现该算法的任务难度 |
| 现有代码结构 | 控制流、调用、共享状态、兼容关系和测试路径 | 不能等同算法问题复杂度或原任务难度 |
| 执行表现 | 固定模型、Harness、预算、数据和判定方式下的成功、耗时、成本 | 不能成为脱离执行条件的固有难度 |
| 工作量与质量 | 不同内容的成果数量及其完成/验收情况 | 数量不等于困难程度；完成不等于独立验收 |

算法的 O(n)、O(n log n) 或 NP-hard 标签、程序行数、圈复杂度、调用数、Token、实际耗时与通过率，均不能自动映射为难度等级。这里的区分来自不同测量对象，不是否认这些指标在各自用途中的作用。

## 分领域核验与应用

### 软件工程

SWE-bench 将仓库上下文定位、跨位置修改与回归测试放到同一问题解决过程中；原始数据受 Python 仓库、可运行测试与筛选条件限制。SWE-agent 又表明接口与执行设置需要作为比较条件记录。由此，本项目分别描述代码理解、变更影响、整合、兼容与验证要求；SWE-bench 的模型解决率不作为用户原要求的标签。[SWE-bench 原论文](https://arxiv.org/html/2310.06770v3)、[SWE-agent 原论文](https://arxiv.org/html/2405.15793v3)

NIST SP 500-235 中的圈复杂度服务于控制流与结构测试。它可提示检查哪些路径，但不说明寻找一个新算法或理解业务规则有多难。[NIST 结构测试报告](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf)

### 代码与算法

MIT 6.006 的官方验收要求分别包含算法描述、例子、正确性依据和时间/相关空间分析；6.046 的选择算法、在线分析与近似算法材料进一步区分证明、运行情形和质量保证。因此要求项应互相独立。[6.006 课程要求](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/pages/syllabus/)、[6.046 官方讲义](https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2012/b1e5ac3c8f7d60db9b8d5b66c40bc55e_MIT6_046JS12_Notes.pdf)

LiveCodeBench 分开代码生成、修复、执行输出预测与测试输出预测；其竞赛来源、题型筛选、测试和时间窗口都需保留。Codeforces 官方评级面向典型比赛中的参赛者表现，且作者说明使用比赛内结果。平台的 easy/medium/hard 或人类评级不能直接导入实际开发任务的难度。[LiveCodeBench 原论文](https://arxiv.org/pdf/2403.07974)、[Codeforces 官方说明](https://codeforces.com/blog/entry/62865)

下面每项都是项目自编的审阅问题，来源支持其概念分离，不为本项目提供已标定等级：

| 要求项 | 应记录的事实 | 主要来源 ID |
| --- | --- | --- |
| 问题定义 | 合法输入、输出关系、约束和边界是否明确 | computing-mit-6006-computation |
| 算法设计 | 已给方案的实现、成熟方法的适配/组合，或需要设计新方法 | computing-mit-6006-assessment、computing-mit-6046-analysis |
| 正确性 | 有限场景测试、非形式化论证、终止/普适正确性证明，或机器检查证明 | computing-mit-6006-assessment、computing-minif2f |
| 时间 | 最坏、期望、摊还或经验运行条件；参数与计算模型是否确定 | computing-mit-6046-analysis |
| 空间 | 额外空间、原地、流式或访问限制是否属于原要求 | computing-mit-6006-assessment |
| 近似与随机性 | 精确/近似目标、加性/乘性误差、可行/最优性及随机保证 | computing-mit-6046-analysis、computing-miplib-paper |
| 在线与动态 | 到达后处理、更新/查询保证或竞争分析是否被要求 | computing-mit-6046-analysis |
| 数值 | 容差、问题条件与稳定性分析是否被要求 | computing-dlmf-error、computing-dlmf-conditioning |
| 代码与整合 | 理解既有行为、跨模块改动、接口兼容和回归义务 | computing-swe-bench、computing-nist-structured-testing |

这些选项应使用明确枚举与证据状态。类别之间没有统一自然顺序；既不能按枚举序号加分，也不能把“要求机器检查证明”自动解释成比所有其他任务更难。

### 数学、数值与优化

MATH 按题目学科与来源等级分别描述竞赛任务。miniF2F 明确指出陈述形式化可能承担原题的大部分困难，给出答案后再证明也可能改变原任务；不同证明系统与库还会改变证明步骤。应分别记录求答案、推导、形式化和证明，而非用统一“数学题”代替。[MATH 原论文](https://arxiv.org/pdf/2103.03874)、[miniF2F 原论文](https://arxiv.org/pdf/2109.00110)

数值任务要区分绝对/相对误差、问题对扰动的条件和算法误差控制。矩阵大、输出位数多或计算慢都不足以表示这些要求。[NIST DLMF 误差量](https://dlmf.nist.gov/3.1)、[NIST DLMF 条件与敏感性](https://dlmf.nist.gov/3.2)

优化方法比较必须保留实例、精度、停止准则与失败；性能曲线描述求解器条件下的相对表现。MIPLIB 的不同实例集及更新记录也提示：经验求解标签有版本，而“建立正确模型”与“求解已给实例”有不同交付要求。[Dolan–Moré 作者预印本](https://optimization-online.org/wp-content/uploads/2001/03/300.pdf)、[MIPLIB 官方资料](https://miplib.zib.de/)

### 数据工程与分析

DS-1000 将执行正确性与指定方法/API约束分开；BIRD 将数据库内容理解、脏数据、外部知识与有效查询效率纳入任务。程序跑通不自动证明口径、连接、过滤、统计方法及结论都正确。[DS-1000 原论文](https://proceedings.mlr.press/v202/lai23b/lai23b.pdf)、[BIRD 原论文](https://arxiv.org/html/2305.03111v3)

DiscoveryBench 提供真实数据调查的流程和上下文/变量/关系结构，但其自然语言假设对齐评价使用大模型。本项目可借鉴描述结构，不能把这一评判器直接变成“纯程序已证明结论正确”的日常功能。[DiscoveryBench 原论文](https://arxiv.org/pdf/2407.01725)

数据要求还应包括来源/粒度、缺失与重复、连接口径、样本构造、方法条件、随机性、因果主张及复现。需要这些要求的依据；不因读到很多行就自动填困难。

### AI 与模型系统

HELM 将场景、适配和指标分开，并公开覆盖不足；BIG-bench 展示表述与窄指标可能影响结果。跨领域能力不能由单一汇总分证明，提示、工具和评判方式必须留作条件。[HELM 原论文](https://arxiv.org/html/2211.09110v2)、[BIG-bench 原论文](https://arxiv.org/pdf/2206.04615)

MLPerf Training 的原论文把质量目标、训练随机性、数值和系统实现差异作为比较条件。吞吐提升不保证更快达到目标质量；更多训练轮和更多算力也不表示研究设计更困难。[MLPerf Training 原论文](https://arxiv.org/pdf/1910.01500)

在本项目中，训练/评测数据协议、质量目标、随机重复、模型复现、鲁棒性及系统资源是分开的要求与投入。资源支出继续进入费用统计，不能变成难度奖励。

## 与现有工作类型的对应及查漏

已核读 work-taxonomy-2。算法作为计算学科 subject，可交叉对应 software.algorithm、software.formal_verification、software.numerical，以及 mathematics.graph/discrete_optimization 等活动，无需新建一个重复的软件领域。

| 范围 | 当前可对应的活动 | 需要保留的细分要求 |
| --- | --- | --- |
| 软件 | debugging、testing、static_analysis、integration、concurrency、performance、security等 | 原要求与上下文、兼容及验证边界 |
| 算法 | software.algorithm、numerical、formal_verification等 | 设计/实现、正确性、时间/空间、精确/近似、在线/动态 |
| 数学 | proof、symbolic、numerical、各类optimization、formulation、validation等 | 陈述形式化、证明、建模、数值求解分别描述 |
| 数据 | cleaning、deduplication、sql、inference、causal、geospatial等 | 样本、口径、假设、方法、解释和复现 |
| AI | neural_model、finetuning、evaluation、robustness、distributed_training等 | 数据/质量协议、模型与系统条件、随机性及覆盖 |

可考虑新增四个活动，但本文件只提出建议，没有修改共享目录：software.algorithm_design、software.algorithm_analysis、mathematics.formalization、data.sampling。前两项将现有 algorithm 的设计、实现与分析边界展开；数学形式化与给定陈述后证明分开；抽样仅在交付边界确实不同于推断时新增。优先用已有 workType 加要求项，不能为了增加类别数量而重复同一规则。

## 程序实现边界与校准条件

- 原要求向量、工作组成图、实际成果量、执行过程和外部基准表现分别保存。来源未明、材料不全或非适用项目保持 unknown / not_applicable；不是零分或容易。
- 每个审阅问题记录依据、覆盖、适用性和要求类型；证据定位与原材料留本地。公开白名单不新增任务正文、代码、业务名或自由文本。
- 若将来估计经验难度，应固定模型版本、Harness、工具、预算、数据与评判协议，再用重复观测估计；该结果不能覆盖原要求。
- 未经同类案例、多名独立评阅者、分歧分析与外部验证，不发布等级阈值或难度乘数。当前任何等级草案都应标为项目自编、未经标定。
- 工作日记仍只有对话声明，根目标与成果量不能因来源论文或字段校验而升级成独立验收。难度默认关闭，原环境和已有成本/工作量计算保持其原有口径。

