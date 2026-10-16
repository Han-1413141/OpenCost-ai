# 工程、自然科学与医学任务：资料依据与覆盖范围

检索日期：2026 年 10 月 12 日（Asia/Shanghai）。结构化来源保存在 [difficulty-science.json](difficulty-science.json)，含 30 条来源、作者与年份、原始网址、实际阅读范围、领域与子类型、可支持的主张、限制及 OpenCost 应用建议。原始多库候选保存在 [science-search-raw-20261012.json](science-search-raw-20261012.json)。

本轮完成有范围的资料检索与字段设计依据整理，没有完成预注册系统综述或真实任务难度标定。“目录可以表达一个专业”和“该专业已有可直接采用的难度等级”分别统计。

## 可以直接采用的结论

NASA 技术评估把技术成熟度 TRL 和将技术推进到下一成熟度的 AD2 分开，并以系统、子系统、组件的分解结构开展评估。它支持记录原要求、组件依赖、时序和状态义务、使用环境以及验证方式；不能把低成熟度直接当作所有 AI 工作的高难度。[NASA Systems Engineering Handbook 附录 C–I](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)

SciCode 同时包含学科背景、子问题实现和主问题整合。它支持“独立目标、组成部分、领域条件、整合验收”分别记录，以及 `subject × activity` 交叉分类；未支持用一个跨专业分数覆盖全部科研工作。[SciCode 原始论文](https://arxiv.org/html/2407.13168v1)

工程计算要区分数值验证、实验确认与不确定度。ASME V&V 20 的公开范围还限定在指定变量和验证点，不能由少量验证点推到所有运行条件。本轮只读取标准公开范围，不声称符合付费标准全文。[ASME V&V 10 官方范围](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-solid-mechanics)、[ASME V&V 20 官方范围](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-fluid-dynamics-and-heat-transfer)

医学资料支持按用途、人群、数据、预测时点、结局、评价设计、人机角色等条件记录。报告清单不能按勾选数量换算难度；STROBE 原文明示该清单不是研究质量评分工具。[TRIPOD+AI 官方扩展清单](https://www.tripod-statement.org/wp-content/uploads/2024/04/TRIPODAI-Supplement.pdf)、[STROBE 原文](https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0040296)

## 工程子类型映射

下表“建议记录”是 OpenCost 的字段设计推断。来源是任务条件和验证方法依据，未给这些子类型建立数字难度阈值。

| 现有工作子类型 | 建议记录的专业条件与义务 | 原始资料 | 本轮边界 |
| --- | --- | --- | --- |
| `engineering.mechanical` 机械与结构 | 几何、装配、载荷、公差、数值/实验验证 | [Text2CAD](https://arxiv.org/abs/2409.17106)、[ASME V&V 10](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-solid-mechanics) | CAD 形状正确不能代替力学与可制造性验证 |
| `engineering.electronics` 电路与电子 | 组合/时序行为、复位、接口、时序及物理约束 | [VerilogEval](https://arxiv.org/abs/2309.07544)、[CircuitNet](https://arxiv.org/abs/2208.01040) | 仿真教学题与工业签核分开 |
| `engineering.embedded` 嵌入式与固件 | 平台、资源上限、时延、能耗、状态与接口 | [MLPerf Tiny](https://arxiv.org/abs/2106.07597)、[NASA](https://www.nasa.gov/reference/system-engineering-handbook-appendix/) | 推理性能不等于固件可靠性 |
| `engineering.control` 控制系统 | 动力学、稳定/跟踪、观测、扰动与约束 | [safe-control-gym](https://arxiv.org/abs/2109.06325)、[NASA](https://www.nasa.gov/reference/system-engineering-handbook-appendix/) | 有限仿真不能证明任意实机安全 |
| `engineering.robotics` 机器人与机电集成 | 感知模态、多阶段依赖、动作和接触、闭环验证 | [RLBench](https://arxiv.org/abs/1909.12271)、[safe-control-gym](https://arxiv.org/abs/2109.06325) | 仿真、硬件在环、实机证据分开 |
| `engineering.energy` 能源与热流 | 网络/流热模型、资源/设备约束、目标和可行性 | [PGLib-OPF](https://arxiv.org/abs/1908.02788)、[ASME V&V 20](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-fluid-dynamics-and-heat-transfer) | 电网优化与热设备仅有代表资料；现场验收未覆盖 |
| `engineering.civil` 土木与建造 | 材料/结构、荷载、边界、验证对象与不确定度 | [ASME V&V 10](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-solid-mechanics)、[NASA 系统方法](https://www.nasa.gov/reference/system-engineering-handbook-appendix/) | 目前是计算与通用系统方法；建造现场专属难度证据待补 |
| `engineering.manufacturing` 制造与工艺 | 参数/工艺、几何、缺陷检测/定位、检验环境 | [Text2CAD](https://arxiv.org/abs/2409.17106)、[MVTec AD](https://www.mvtec.com/research-teaching/datasets/mvtec-ad) | 工艺操作、设备实物与图像基准不能混比 |
| `engineering.materials` 材料与配方 | 成分/结构、目标性质、计算/实测来源、外推 | [Matbench](https://arxiv.org/abs/2005.00707)、[MoleculeNet](https://arxiv.org/abs/1703.00564) | 性质预测不是制备、寿命或安全实绩 |
| `engineering.simulation` 工程仿真 | 假设、单位、边界、误差/收敛、验证变量与点 | [ASME V&V 10](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-solid-mechanics)、[ASME V&V 20](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-fluid-dynamics-and-heat-transfer) | 运行成功与模型可信程度分开 |
| `engineering.reliability` 可靠性与故障分析 | 失效条件、恢复、环境、证据与生命周期 | [NASA](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)、[NIST AI RMF](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/) | 本轮未建立寿命试验或故障难度专属标定 |
| `engineering.verification` 试验与工程核验 | 验证矩阵、成功条件、方法、对象和证据层级 | [NASA](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)、[ASME V&V 10](https://www.asme.org/codes-standards/find-codes-standards/standard-for-verification-and-validation-in-computational-solid-mechanics) | 生成报告不等于独立验收通过 |
| `engineering.systems` 系统工程与多专业集成 | 要求分解、接口、整合依赖、状态/时序、多阶段验证 | [NASA](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)、[NIST AI RMF](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/) | 不能把专业数量直接乘成难度加分 |
| `engineering.communication` 通信与信号 | 信道、场景、噪声、系统参数、泛化与物理指标 | [DeepMIMO](https://arxiv.org/abs/1902.06435)、[NASA 接口方法](https://www.nasa.gov/reference/system-engineering-handbook-appendix/) | 本轮有无线信道代表，未覆盖全部通信协议与信号业务 |
| `engineering.chemistry` 化学过程与实验材料 | 分子/物性、物理约束、数据稀缺、不平衡与实验核对 | [MoleculeNet](https://arxiv.org/abs/1703.00564)、[SciCode](https://arxiv.org/html/2407.13168v1) | 工业化学工艺与实验安全的专属要求仍需补 |
| `engineering.environmental` 环境与监测工程 | 时空、过程模型、测量、预测时效、环境目标 | [WeatherBench](https://arxiv.org/abs/2002.00469)、[CropGym](https://arxiv.org/abs/2104.04326) | 气象/农业仿真代表不能覆盖全部生态与监测 |
| `engineering.aerospace` 航空航天系统材料 | 状态、时序、环境、接口、多阶段验证 | [NASA](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)、[safe-control-gym](https://arxiv.org/abs/2109.06325) | 系统材料、飞行仿真、实物验证、飞行许可分别记录 |

## 健康与医学材料子类型映射

| 现有工作子类型 | 建议记录的条件与义务 | 原始资料 | 本轮边界 |
| --- | --- | --- | --- |
| `health.literature` 文献与指南 | 文献问答/检索/综合用途、来源、适用时点、主张依据 | [MultiMedQA](https://arxiv.org/abs/2212.13138)、[TRIPOD+AI](https://pubmed.ncbi.nlm.nih.gov/38626948/) | 医学检索和系统综述标准需结合研究工作资料，不能由问答替代完整综述 |
| `health.evidence` 临床证据综合 | 研究设计、偏倚、目标人群、结局、评价与适用性 | [PROBAST+AI](https://www.probast.org/)、[STROBE](https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0040296) | 完成材料不等于证据强或诊疗有效 |
| `health.education` 健康教育 | 受众、专业知识、事实、精确程度和解释要求 | [MedQA](https://arxiv.org/abs/2009.13081)、[MultiMedQA](https://arxiv.org/abs/2212.13138) | 考试答题、健康解释和真实患者决策分开 |
| `health.terminology` 术语与翻译 | 语言、专业语义、否定/时序和一致性 | [MedQA](https://arxiv.org/abs/2009.13081) | 仅有多语医学问答代表；术语翻译规范和专属难度证据待补 |
| `health.data` 医学研究数据 | 数据来源/分割、结局、预测时点、缺失、依赖与泄漏 | [TRIPOD+AI](https://www.tripod-statement.org/wp-content/uploads/2024/04/TRIPODAI-Supplement.pdf)、[DOME](https://arxiv.org/abs/2006.16189) | 上传仅用抽象状态与数量，患者资料留本地 |
| `health.protocol` 研究方案材料 | 用途、设计、输入纳排、算法版本、评价阶段与人工角色 | [CONSORT-AI](https://pure-oai.bham.ac.uk/ws/portalfiles/portal/104472749/PIIS2589750020302181.pdf)、[DECIDE-AI](https://discovery.ucl.ac.uk/id/eprint/10152188/) | 方案或报告通过不等于完成临床试验 |
| `health.documentation` 医学文档 | 报告目的、版本、输入/输出、参与者和证据关系 | [CONSORT-AI](https://pure-oai.bham.ac.uk/ws/portalfiles/portal/104472749/PIIS2589750020302181.pdf)、[TRIPOD+AI](https://pubmed.ncbi.nlm.nih.gov/38626948/) | 报告规范有代表，日常病历/护理文档专属难度未标定 |
| `health.bioinformatics` 生物信息与组学 | 数据/优化/模型/评价，专业软件、多步分析与结果解释 | [DOME](https://arxiv.org/abs/2006.16189)、[BixBench](https://arxiv.org/html/2503.00096v3) | 计算结果解释与实验生物学确认分开 |
| `health.epidemiology` 人群研究 | 队列/病例对照/横断面、选择、测量、混杂、时序与解释 | [STROBE](https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0040296)、[PROBAST+AI](https://www.probast.org/) | 预测、描述、因果与干预分别记录；清单完整不能代替质量判断 |

## 自然科学和农业的表达方式

保留学科标签，复用确实对应的工作活动。物理、地球科学、农业等不能因为名称听起来专业就自动升级难度。

| 学科举例 | 实际工作可映射到 | 专业条件代表 | 依据与缺口 |
| --- | --- | --- | --- |
| 物理、天文、量子 | 符号推导、数值计算、科学编码、仿真、数据分析 | 维度、对称性、边界、误差、可识别性 | [SciCode](https://arxiv.org/html/2407.13168v1)、[AI Feynman](https://arxiv.org/abs/1905.11481)；天文观测流程仅有科学编码代表 |
| 化学、材料 | 分子建模、性质预测、数值算法、实验方案 | 分子/结构表示、物理性质、样本条件与实验核对 | [MoleculeNet](https://arxiv.org/abs/1703.00564)、[Matbench](https://arxiv.org/abs/2005.00707)；完整化学实验及工艺未覆盖 |
| 生物、遗传、生态 | 生物数据分析、模型评价、科学代码、结果解释 | 数据依赖、多步分析、专业环境和实验验证 | [DOME](https://arxiv.org/abs/2006.16189)、[BixBench](https://arxiv.org/html/2503.00096v3)、[SciCode](https://arxiv.org/html/2407.13168v1)；不能证明覆盖全部生物学 |
| 地球、气象、环境 | 预测、时空数据、过程模型、仿真 | 变量、分辨率、预测时效、时空切分和测量条件 | [WeatherBench](https://arxiv.org/abs/2002.00469)；海洋、地质等专属代表待补 |
| 农业、植物生产 | 动态决策、仿真、优化、实验设计 | 状态、资源、环境目标、过程模型与外推 | [CropGym](https://arxiv.org/abs/2104.04326)；林业、兽医、渔业与食品未各自取得专属难度依据 |

## 对纯程序统计的影响

程序能确定已提供的任务结构、数量、依赖、事件、Token 和费用，并保留未知。程序不能仅凭脱敏字段推断任意科学/医学成果是否正确。

ScienceAgentBench 区分有效执行与任务成功，同时有任务专用验证和图像 LLM 评判；BixBench 开放答案也使用额外模型判定。可参考其环境、目标、执行和成本分开记录，不能声称它们已经证明全部任务可零模型验收。[ScienceAgentBench §2.3](https://arxiv.org/html/2410.05080v1)、[BixBench §3](https://arxiv.org/html/2503.00096v3)

难度自动运行和上传维持关闭。后续校准需按工作子类型与必要条件取得真实任务标注，验证模型和 Harness 改变时原要求难度是否保持稳定；风险、质量、工作量、执行费用与难度不能混作一个未经标定的总分。

## 检索与阅读限制

- 多库脚本检索范围为 2000—2026 年，4 个明确查询，Crossref 返回 24 条候选，去重后候选合计 22 条；Semantic Scholar 的 4 个查询均遇到 HTTP 429 限流，返回 0 条。网页补充了早期标准和专项检索，不能把 2000 年下限当作权威方法起点。
- 首选原始论文、官方机构、标准组织和作者/大学存储。未以论坛、媒体、模型生成摘要或第三方排行榜作为结论依据。
- 逐条保存实际阅读范围：摘要、已读全文章节、官方范围、可取得的清单分开标注。ASME 未读取付费全文，部分医学出版平台受访问限制。
- 30 条来源是代表性依据集合。工程/健康每个目录项已作映射，但映射中明确保留通用方法依据、部分覆盖和待补项，未宣称每个子类型已有两项直接难度研究。
- “全专业分类目录”可以通过持续维护扩展；“所有任务难度均准确”必须通过真实校准检验，当前没有这一证据。
