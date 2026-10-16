# 难度与工作量：资料依据和实施边界

检索日期：2026-10-12。采用经典测量研究、原始 AI 评测论文和官方标准，五个子代理分领域检索、核对原始页面，再由主代理整合。检索是跨领域定向检索，不是穷尽性系统综述。原始候选、查询、访问失败和每条实际阅读范围保存在 `docs/research/`；没有把摘要阅读写成通读全文。

当前目录有 **16 个工作领域、249 个活动、30 种成果单位**，另有 OECD FORD 的 **6 组、42 个二级学科**。工作活动、学科和职业/教育/个人用途独立记录。这样生物学文献检索、生物学统计、生物学算法和生物学报告不必共用一种判断方法，农业、地理、历史等主题也不会因没有独立活动领域而消失。[OECD Frascati Manual，Table 2.2](https://www.oecd.org/content/dam/oecd/en/publications/reports/2015/10/frascati-manual-2015_g1g57dcb/9789264239012-en.pdf)

## 找到了哪些分级和测量研究

| 来源                                         | 研究对象与可采用的部分                                       | 本项目不直接复制的部分                                     |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Wood（1986）、DSM                            | 任务组成、必要行为、协调关系、动态变化与整合                 | 不用实际工具步骤替代必要部分；没有全域通用权重             |
| Rasch/IRT、测量不变性、AERA/APA/NCME测试标准 | 在明确参考框架与共同任务中估计能力、题目难度，核对用途与效度 | 单次结果不能分离模型能力与任务参数，未经连接不能跨领域合并 |
| OECD AI Capability Indicators（2025）        | 九项能力、各五级，以专家论证描述AI整体能力边界               | 不能把一次工作自动定为五级中的一级，也不作费用乘数         |
| Bloom修订、Webb DOK                          | 知识、认知过程、连接、迁移与表征要求                         | 不是等距难度分；同一动词和类别编号不决定实际任务难度       |
| WorkArena++                                  | 组合工作流、指令显式程度、知识检索、流程条件                 | 分级绑定其任务分布；步骤多、人类难或机器难不是同一含义     |
| ConceptMix                                   | 图像任务中事先指定的概念、属性与空间关系，并逐项核验         | 概念数不是所有领域的难度权重                               |
| 翻译难度实证研究                             | 专门研究源文与任务的难度及指标适用性                         | 译文质量、耗时、可读性不能单独充当通用难度                 |
| NASA AD2、工程V&V、医学报告规范              | 推进困难与成熟度分开，原要求、工况、测量、验证证据分别记录   | 成熟度、风险、质量或清单勾选数不能直接作为工作难度         |

对应原文：[Wood](https://www.researchgate.net/publication/222383252_Task_complexity_Definition_of_the_construct)、[Rasch](https://www.rasch.org/memo18.htm)、[测试标准](https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf)、[OECD五级方法](https://www.oecd.org/en/publications/introducing-the-oecd-ai-capability-indicators_be745f04-en/full-report/component-5.html)、[翻译难度](https://benjamins.com/catalog/target.26.1.04sun)、[ConceptMix](https://arxiv.org/abs/2408.14339v1)。各来源的读取范围与限制以结构化清单为准。

## 领域资料及落实方式

- **软件、算法、数学、数据、AI**：MIT算法课程、NIST结构测试、SWE-bench/SWE-agent、LiveCodeBench、MATH、miniF2F、DLMF、MIPLIB、DS-1000、BIRD、HELM、BIG-bench、MLPerf。补算法实现、设计、分析、形式系统陈述编码；区分正确性、终止、时间、空间、近似、随机、在线、动态和数值要求。[计算领域资料](research/difficulty-computing.md)
- **工程、自然科学、农业、健康**：NASA、ASME V&V、SciCode、科学代理评测、材料/分子/气象/通信/机器人基准、DOME、TRIPOD/CONSORT/DECIDE/STROBE。学科主题与活动交叉，材料、模拟和实物执行证据分开，保留单位、模型边界、校准和误差。[科学与工程资料](research/difficulty-science.md)
- **写作、翻译、设计、媒体、教育、人文**：写作过程研究、MQM、设计问题与方案共同发展、WCAG、ConceptMix、AudioBench、Video-MME、TEI、Bloom、DOK。补音视频理解与文本校勘；语义保持、创作约束、时序、交互和受众分别判断。[人文与创作资料](research/difficulty-humanities.md)
- **办公、商业、法律、金融、研究**：WorkArena/WorkArena++、OSWorld、SpreadsheetBench、τ-bench、LegalBench/LexGLUE/CUAD、FinQA/FinanceBench/FinBen、PRISMA/Cochrane、AAPOR、GEO-Bench及农业资料。补法律推理、金融提取和证据问答、配置报价、证据缺口图与混合证据。任务成功与授权/规则符合分别记录。[专业服务资料](research/difficulty-professional.md)
- **跨领域范围**：O*NET、ESCO、ISCO、FORD、ANZSRC和ACM CCS用于查漏；这些分类不向单次任务提供难度分。[分类资料](research/difficulty-classification.json)

每个活动的具体审阅问题由项目编写，依据上述资料设计；不是论文直接给出的量表，也没有被这些论文验证。程序生成的 `shared/difficulty-research.json` 将领域背景来源和细类对应资料分别登记。某细类匹配论文，表示存在任务材料或验收设计参考，不表示有经过验证的难度等级。

## 当前程序如何处理

1. **原要求分类**：`task.requirementClassification` 可选记录固定工作子类型、学科代码、用途、依据与覆盖。缺失时不补写历史。成果的 `completedWork.workType` 是另一字段，不能用最终成果或成功失败修改原要求类型。
2. **混合工作**：`componentTypes` 保存原计划的各细类部分数，程序核对总数和原计划领域的可分配性。完整且已知的不同组成分别比较；组成缺失的混合任务保留个人记录，不进入模型排名或精确推荐。
3. **本地要求审阅**：`computeDifficultyReview` 默认 `off`，不读取输入。显式 `local_review` 解析已经形成的结构化原要求标注，计算描述向量、已知/未知/冲突/不适用覆盖，各部分独立保留。23 个跨领域要求项单列代码、算法、科学、证据、语义、创作、多模态、流程及专业条件。它不从自由文本自动识别难度，不读取原日志，不调用模型，不上传标注。
4. **工作量**：独立根目标、原计划部分、去重成果量、执行与消耗分别统计。修订、格式变体、父子代理重复登记不新增成果，实际重试和全部后代消耗仍保留。依赖、共享状态和反馈分别记录；只为依赖深度凝聚强连通分量，循环事实保留。
5. **费用比较**：全部归属实付包含失败与重试，除以已验收根目标数；完成率不分档筛选，也不重复乘入。每种可比任务条件为每个模型独立选择最低验收单位成本的Harness，并展示该配置。费用不除以自编难度数值。
6. **缺项与可信度**：未知总量为 `null`，已有观测小计另列。哈希与签名证明内容一致或签发者，不能证明最初工作量真实；自报和AI提取不升级为独立验收。

未来经验难度实验可考虑 `P(Y=1)=sigmoid(θ配置−β任务)`，但必须预先固定任务、模型/Harness版本、工具、预算、评判协议，建立共同任务的交叉反应矩阵，检查模型适配、局部依赖、参数不确定性和跨组不变性。当前没有拟合该模型，也没有发布等级阈值。[Rasch方法原文](https://www.rasch.org/rmt/rmt11a.htm)

## 查漏与当前开关

`/api/difficulty-research` 返回来源、阅读记录、按领域/细类的对应和未建立验证的状态；`/api/work-subjects` 返回学科目录；`/api/difficulty-framework/facets` 返回跨领域要求项。网页“工作标准”和桌面“统计标准”共用这些内容，查看不启用采集或评分。

目录覆盖、资料对应、语义识别验证、真实实验标定是四种不同进度。当前全部细类 `calibrated=false`，`score/level/globalRating=null`。未知新工作保留未知并登记待扩展，不强行归到邻近领域。音乐创作、实时口译、部分细专业、抽样设计等的专项难度研究仍待补；没有声称所有语言、职业与新兴AI用途均无遗漏。

生产难度采集、评分、分级与排名分层继续关闭；没有开始扫描真实数据、额外调用模型或自动上传。本轮资料研究和代码实现不更改原有授权开关。
