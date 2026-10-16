# 脱敏工作摘要：观测字段、隐私边界与分析用途

检索与代码核对日期：2026-10-13。本文是字段设计研究，新增字段尚不等于已经采集或上线；不改变当前默认关闭的难度、自动生成、监控或上传开关。来源清单见 [privacy-telemetry.sources.json](./privacy-telemetry.sources.json)。本次围绕与产品直接相关的 12 项原始论文、标准或官方技术资料检索，不声称穷尽所有领域、语言和文献。

## 1. 实施结论

优先扩展有明确分析用途的观测事实：需求在执行前是什么、实际覆盖了哪些验收、后续是否重开、时间花在执行还是等待，以及这些数值从哪里取得。现有 Token、费用、代理树和任务组成字段已经较完整，继续增加同义字段会制造冲突。先补观测的来源、时点、覆盖和缺失原因，能比新增一批主观评分更直接地提高反馈可信度。

建议新增可选 `Task.observations`，所有对象使用严格闭合 schema；旧记录不补造值，默认模板不主动采集。客户端填写 `source=recorded_log` 或 `independence=separate_tool` 只说明其声称的取得方式，不产生新的可信证据等级。计算结果需要同时显示：本次值、已观察分母、覆盖、同条件参照数、统计区间、取得方式以及无法判断的原因。

“不上传原文”与“无法关联个人”是两个不同承诺。服务端私人反馈本身就需要把同一持有人的多次记录关联起来。高维的稀有任务组合、精确时间、金额和版本也能形成关联线索。因此产品应说明“本地删除内容和直接身份，只上传经选择的结构化统计；私人记录受访问控制，公开只发布满足规则的汇总”，不能把哈希、随机 UUID 或去掉姓名称为数学意义上的完全匿名。NIST 讨论了间接标识与公开方式选择；稀疏数据的去匿名化研究也证明，多项普通属性结合外部资料可以识别记录。[NIST SP 800-188](https://csrc.nist.gov/pubs/sp/800/188/final)、[Narayanan 与 Shmatikov, 2008](https://www.cs.cornell.edu/~shmat/shmat_oak08netflix.pdf)。

## 2. 论文与标准能迁移什么

以下“迁移”是本项目据资料作出的设计，不表示来源已经验证了 OpenCost 的评分。

| 来源 | 原始结论或规范范围 | 本项目采用与边界 |
| --- | --- | --- |
| [OpenTelemetry GenAI](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) | 描述模型、工具、代理操作、用量和耗时；内容字段敏感，默认不捕获；逻辑操作可能包含多次请求重试。该文档当前标注 Development。 | 借用操作、用量、重试的语义，适配器固定版本。禁止直接转发完整 OTLP 属性。请求地址、工具参数、输入输出、检索文档 ID、用户与会话 ID 均不上传。 |
| [W3C PROV-O, 2013](https://www.w3.org/TR/prov-o/) | 用实体、活动、代理及派生、生成、责任关系表示来源。 | 本地保存事实如何生成，上传来源类别、覆盖和规则版本；不上传实体 URI、人员、工件关系图。来源图可解释数据变换，不证明原始输入真实。 |
| [NIST SP 800-188, 2023](https://csrc.nist.gov/pubs/sp/800/188/final) | 去标识需要选择处理和发布方式，并考虑重识别风险。 | 私人准确数值与公开汇总分开。对新维度联合分组重新检查稀有性，不把去掉直接标识作为唯一措施。 |
| [NIST Privacy Framework 1.0, 2020](https://www.nist.gov/privacy-framework/privacy-framework) | 隐私处理包括最小必要采集、降低可观察性和可链接性，以及选择性披露。本文明确采用 1.0 对应原则，不称其为当前最新版本。 | 每个字段绑定具体分析问题；由用户选择字段组；敏感体验和基线信息默认留本地。 |
| [Dwork 与 Roth, 2014](https://www.cis.upenn.edu/~aaroth/Papers/privacybook.pdf) | 差分隐私为相邻数据库提供可组合的发布保证；重复查询需累计隐私损失。 | 未来公开统计可以考虑受限贡献、固定查询与预算管理。未实现预算、敏感度和噪声机制前不称“已差分隐私”；私人账目不得为了展示好看而加噪。 |
| [Datasheets for Datasets](https://arxiv.org/abs/1803.09010) | 数据说明应记录动机、组成、取得方式、适用与维护。 | 每个统计快照保存采集范围、选择偏差、版本、缺失情况与许可用途；不只保存一个总分。 |
| [Data Cards, 2022](https://research.google/pubs/data-cards-purposeful-and-transparent-dataset-documentation-for-responsible-ai/) | 数据生命周期中的来源、采集、注释和使用目的应能被使用者理解。 | 反馈附可读的证据卡，说明哪些信息直接观察、人工声明或模型推断；旧记录保留当时规则。 |
| [Model Cards for Model Reporting](https://arxiv.org/abs/1810.03993) | 性能报告应明确评测条件、适用情境和限制。 | 推荐展示任务条件、模型与 Harness、月份、费用口径和候选范围；没有样本的条件不外推“最优”。 |
| [Measurement and Fairness](https://arxiv.org/abs/1912.05511) | 不可直接观察的概念需要操作化；代理测量与概念错位会造成无效结论。 | 难度是待验证的构念；Token、轮次、代码行不能直接定义难度。将事前要求与事后失败、消耗分开，防止循环评分。 |
| [NASA-TLX 官方量表材料](https://ntrs.nasa.gov/api/citations/20000021488/downloads/20000021488.pdf) | 主观负荷涉及心理、身体、时间要求及表现、努力、挫折；由完成任务的人按规定过程报告。 | 若将来需要体验调查，只作为可选人工报告。AI 不代填情绪和负荷，删改维度后的自定义问卷也不冒称标准 NASA-TLX。 |
| [SPACE, 2021](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/) | 开发生产率跨多个维度，不能由单个活动量指标概括。 | 分别报告成果、质量、效率、沟通与等待；不把大量调用、文件或代理当作用户更优秀的证据。跨行业应用需各自验证。 |
| [Robust De-anonymization of Large Sparse Datasets, 2008](https://www.cs.cornell.edu/~shmat/shmat_oak08netflix.pdf) | 高维稀疏记录能与少量背景信息关联。 | 不公开任务级完整多维向量；属性越来越多时减少公开交叉分组，不把“多字段”自动等同“更多可安全公开的信息”。 |

OTel 的原站页面本次已提示 GenAI 文档迁至独立仓库，因此采用其指向的官方仓库，不使用旧博客示例作为当前 schema。NASA 与去匿名化论文的旧地址抓取失败，已换用 NASA NTRS 和作者 Cornell 页面核对；失败地址记录在来源 JSON。

## 3. 当前代码覆盖

本节以实际读取的 `shared/schema.ts`、`shared/work-structure.ts`、`shared/evaluation.ts`、`docs/backend-api.md`、`skills/opencost-contribute/SKILL.md` 为准。

| 已有字段或规则 | 已能回答 | 仍缺什么 |
| --- | --- | --- |
| kind、requirementClassification、subjects、componentTypes、scope、context | 大类、细类、学科、混合组成、原要求依据 | 需求的清晰度、输入质量、方法要求，且需明确执行前或回顾性取得 |
| completedWork 的 planned/completed/accepted、单位、来源与覆盖 | 不同单位的实际工作量与验收量 | 验收检查是否覆盖了原定条件，关键条件是否真的执行 |
| workStructure 的必需部分、边数、深度、共享状态、反馈回路与整合验收 | 任务耦合及完整根目标是否验收 | 图统计需要更稳定的观测口径；不需要上传原图 |
| executionScope 与 agentCount/maxAgentDepth/maxParallelAgents、后代遍历 | 所有层级代理、共享代理及统计范围 | 缺日志原因、具体适配器支持能力；代理数量不等于任务难度 |
| acceptanceTotal/Passed、status、attempts、rework/revision、封闭事件类别 | 完成、失败、返工、切换、错误类型 | 一次验收后的重开和延迟缺陷观察窗；错误原因目前是来源声明 |
| wall/model/tool/queue 时间、人工分钟、Token 和资源 | 费用和耗时的部分构成 | 等待用户、外部依赖、暂停与未归因时间；并行耗时不能直接相加 |
| 价格快照、费用分量、分摊、退款、优惠、私人额度历史 | 当时价格和实际付款口径 | 无需新增原始账单、账号或交易 ID；这些应继续只在本地 |
| collectionWindow、collectionProcessing、coverage、C/Q 证据边界 | 采集范围、摘要本身开销及证据边界 | 每个新增字段组的具体来源、时点、缺失原因与能力支持 |

现有 `work-summary-1` 有意不包含旧 `work-1` 的 reasoning、knowledge、novelty、clarity 等评分输入。新增同名概念必须使用新的可选观测协议，不能让旧主观评分在迁移时悄悄生效。仍应保持难度默认关闭，并保留“原始值—规则版本—当时反馈”。

## 4. 建议的严格字段契约

### 4.1 所有新增节的元数据

建议 `Task.observations={version:'task-observations-1',requirements?,validation?,followup?,time?}`。以下是建议名称，最终编码可以调整，但语义不能合并丢失。

每节具有 `source`、`coverage`、`timing`；缺值同时有 `missingReason`。允许来源混合时使用闭合字段来源映射或拆节，不把整节标为最强的一项来源。

- `source`：`recorded_log | artifact_parser | human_report | local_model | local_rule | unknown`。
- `coverage`：`complete | partial | unknown`，表示声明的采集范围，不表示独立真实性认证。
- `timing`：`before_execution | approved_change | during_execution | after_execution | retrospective | followup | unknown`。
- `missingReason`：`not_recorded | unsupported | not_applicable | not_consented | source_unavailable | redacted | unknown`。不得提供自由文本原因。
- 有效值应同时满足来源、时点和字段约束。`not_applicable` 不是 0；`redacted` 不是失败；空数组不能同时表示“未观察”和“确认没有”。
- 对累计量保留 `observedCount/eligibleCount` 的适用分母；覆盖不完整时只显示已知小计，不以缺失项补零。元数据可按节复用，避免为每个数值复制大对象。
- 不接受客户端的 `verified`、`trusted` 或 `independent=true` 来升级证据。独立证据沿用服务器已登记签发方、用途与有效期校验。

隐私标记：**A** 为低基数结构值，可进入已授权私人记录，并经公开汇总门槛处理；**B** 为可关联的数量或时间，只在私人记录保留准确值，公开用桶或分组；**L** 为默认本地且需单独选择的体验/背景信息；**X** 为禁止上传。A/B 都不代表单条记录天然匿名。

### 4.2 优先新增字段

“额外模型”列的“否”表示有现成结构来源时可纯程序取得；“可选”表示从自由原文判定需要已授权的 AI 提取，会消耗额度，缺省不因此追加调用。人工选择不计模型调用，但有用户操作成本。下表为本项目设计，非引用论文给出的通用量表。

| 字段 | 闭合取值/计量 | 用途 | 隐私 | 取得方式、时点 | 缺失含义 | 易作弊性/校验 | 额外模型 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| requirements.clarity | specified/incomplete/conflicting/unknown | 区分明确执行与需求澄清 | A | 人工、已有结构或模型；before/approved | 原要求未分类 | 高；不得用返工多倒推冲突 | 可选 |
| requirements.inputCondition | clean/missing/inconsistent/noisy/mixed/unknown | 区分方法难度与材料问题 | A | 解析器或声明；before/approved | 未检查输入 | 中高；不上传样本 | 可选 |
| requirements.solutionNovelty | repeat/adaptation/new_solution/unknown | 区分重复流程和新方案 | A | 人工/已有计划；before | 对本任务方案没有可核查说明 | 高；不能当作个人创新能力 | 可选 |
| requirements.knowledge | general/specialist/research/unknown | 表达知识要求 | A | 人工/已有计划；before | 要求未明确 | 高；领域名不自动决定级别 | 可选 |
| requirements.reasoning | routine/multi_step/formal/open_ended/unknown | 表达推理约束 | A | 人工/已有计划；before | 未取得推理要求 | 高；思考 Token 不补标签 | 可选 |
| requirements.methodFamilies | 见 4.3，去重最多 8 项 | 跨领域方法需求 | A | 已有结构、人工或模型；before/approved | 不知方法要求，不是没用方法 | 高；不得用结果算法回填要求 | 可选 |
| requirements.constraintKinds | correctness/performance/security/compatibility/format/accessibility/source_traceability/resource_limit/deadline/unknown，最多 9 项 | 比较相同质量约束 | A | 清单/人工；before/approved | 约束没结构化 | 中高；项数不直接加难度分 | 可选 |
| requirements.contextReuse | fresh/continued/template_based/unknown | 区分上下文/模板优势 | A | Harness 元数据；before | 没有复用信息 | 中；不上传模板 ID 或正文 | 否 |
| validation.criteriaPlanned | 非负整数或 null | 验收覆盖分母 | B | 执行前清单计数；before/approved 来源，after汇总 | 没有完整清单 | 中；本地去重条件，不能临时拆项刷分 | 否 |
| validation.criteriaExecuted | 非负整数或 null | 实际检查覆盖 | B | 验收运行器/人工；after | 检查日志不全 | 中；不超过 planned，只数唯一条件 | 否 |
| validation.criteriaPassed | 非负整数或 null | 满足要求的条件数 | B | 验收运行器/人工；after | 未取得结果 | 中高；passed≤executed，非测试断言数 | 否 |
| validation.criticalCriteriaPlanned | 非负整数或 null | 必须满足的关键条件 | B | 执行前清单；before/approved 来源 | 未标关键性 | 高；关键性不能在失败后降低 | 否 |
| validation.criticalCriteriaPassed | 非负整数或 null | 防止总体通过掩盖关键缺陷 | B | 验收运行器/人工；after | 关键条件未验收 | 中；不超过 criticalPlanned 和 criteriaPassed | 否 |
| validation.independence | self_check/separate_human/separate_tool/mixed/unknown | 描述复核方式 | A | 验收流程事实；after | 不清楚由谁/什么复核 | 高；只描述方式，不授信 | 否 |
| followup.windowDays | 7/30 | 统一延迟问题观察窗 | A | 用户选择/规则；followup | 未启用跟进 | 低；不反复扩大窗择优 | 否 |
| followup.observedDays | 0..windowDays 或 null | 区分未发现与尚未观察 | B | 已授权本地事件；followup | 无可证实观察范围 | 中；不是“距验收多少天”自动等价 | 否 |
| followup.status | complete/right_censored/not_observed | 正确处理未结束观察 | A | 规则；followup | 未采集为 not_observed | 中；complete要求足够观察而非单纯时间经过 | 否 |
| followup.reopenedCount | 非负整数或 null | 已验收根目标重新打开次数 | B | 状态转移；followup | 没有连续状态记录 | 中；保持同根目标，不新增成功任务 | 否 |
| followup.delayedDefectCount | 非负整数或 null | 验收后发现的已确认缺陷 | B | 问题事件去重/人工；followup | 缺陷通道未覆盖 | 中高；不是所有新需求都叫缺陷 | 否 |
| time.partition | exclusive/overlapping/unknown | 防止并行时长相加 | A | 计时器语义；during/after | 无法确认时间区间关系 | 低；服务器按枚举改变求和逻辑 | 否 |
| time.activeMs | 非负整数或 null | 有任务推进活动的墙钟区间并集 | B | 事件时间区间；during | 未持续计时 | 中；不是CPU时间，也不等于真人劳动 | 否 |
| time.waitingUserMs | 非负整数或 null | 用户输入/批准等待 | B | 显式等待开始结束；during | 无边界不能以长消息间隔代替 | 中；未知部分另存 | 否 |
| time.waitingExternalMs | 非负整数或 null | 外部系统/队列依赖等待 | B | 显式挂起记录；during | 没记录外部等待 | 中；允许子类工具但不上传URL | 否 |
| time.pausedMs | 非负整数或 null | 明确用户暂停/调度暂停 | B | 显式状态；during | 闲置不能猜暂停 | 中；与 abandoned 状态区分 | 否 |
| time.unknownMs | 非负整数或 null | 已知墙钟中无法归类部分 | B | 程序余量；after | 总墙钟本身也未知 | 低；需同一跨度与 complete partition | 否 |

计划条件与事后验收在同一个节内时，必须另记计划快照的时点，或者把计划子对象单独加元数据；不能因为验收在 after_execution 取得就丢失“计划在执行前锁定”的依据。`criticalCriteriaExecuted` 值得作为补充字段加入，便于区分“关键条件未通过”与“根本没检查”。各检查方式的覆盖分解可用固定 `methods` 条目；同一条件被多种方式重复检查时不能将方法计数加成更多条件。

`exclusive` 要求来自同一根任务、同一时间跨度，构成相互排斥且合计不超过 `wallMs`；只有完整分类时才计算余量并使合计等于墙钟。若所有代理并行耗时相加，必须为 `overlapping`，不能据此说用户一天工作超过 24 小时，也不能得到“有多少比例花在等待”。来源没有精确时间边界时可以上传粗桶而不伪造毫秒数。

### 4.3 方法类别与跨领域应用

第一版只允许以下方法族，细分类继续由已有 `workType` 和 `subjects` 表达：`retrieval`、`transformation`、`construction`、`diagnosis`、`formal_verification`、`statistical_inference`、`optimization`、`simulation`、`multimodal_alignment`、`cross_system_integration`、`unknown`。最多 8 项；unknown 不与确定值混列。方法族是原要求的性质，不是使用了几个命令或模型自述采用什么“高级算法”。

这些族能表达软件、数学与研究、数据分析、检索写作、翻译、图像音视频、设计、教学、办公自动化和运营支持中的常见方法，但不能保证覆盖所有 AI 工作。临床、法律、金融、工程控制等高后果领域仍可采用已有粗领域代码；不得为评分采集患者、案号、账户、设备位置或个案属性。未匹配任务进入 `unknown` 并记录覆盖缺口，之后依据真实匿名化样例修订分类，而不是给 `other` 默认最低难度。

静态方法名称不直接产生通用难度分：简单排序与证明排序算法性质、套用线性回归与设计可识别因果研究，即使名称接近，要求仍不同。需要在开启实验评分后结合事前输入条件、方法要求、约束和领域锚点校准；事后 Token、失败和耗时用于模型表现分析，不能反过来提高该模型面对的“事前难度”。

## 5. 第二阶段候选：仅在有来源和明确用途时启用

| 字段组 | 结构建议与用途 | 隐私/时点/取得 | 缺失与作弊处理 | 额外模型 |
| --- | --- | --- | --- | --- |
| 图统计派生 | 用已有完整图统计计算 edgeDensityBand、cyclePresence；若补充 condensationLayerWidthBand，仅在本地图按固定拓扑层规则生成，不称精确并行宽度 | A；before；local_rule | 图不全为未知；不上传节点标签、邻接表或图哈希；不重复上传可由已有值算出的密度 | 否 |
| 工件修改范围 | changedArtifactCountBand、changedLogicalUnitCountBand、generatedFractionBand，标明排除自动生成文件；只诊断变更范围 | B；after；artifact_parser | 无解析器支持则null；复制、格式化与重导出不增加工作价值 | 否 |
| 验证稳定性 | repeatedCheckCount、inconsistentResultCount、heldOutCriteriaCount；识别不稳定验收与只过公开示例 | B；after；runner日志 | 相同条件多次执行是稳定性样本，不是更多独立任务；自报不能变可信证明 | 否 |
| 请求重试 | requestsAttempted、logicalOperations、retryRequests，transport/timeout/rate_limit/provider/unknown 分类 | B；during；Harness/SDK日志 | 复用已有事件分类，区分请求重发与根目标attempt；重叠SDK span不能重复计费 | 否 |
| 失败归因依据 | failureAttributionBasis=provider_code/tool_exit/human_review/model_inference/unknown | A；after；固定状态/声明 | 不是见timeout就归因模型；无证据归因unknown | 否/可选 |
| 环境约束 | networkAccess=offline/restricted/online/unknown，toolAccess=none/read_only/read_write/external_actions/unknown，setup=ready/required/unknown | A；before；配置读取/人工 | 只读取授权能力状态，不读内部服务名、路径、代理或凭据 | 否 |
| 输入/输出模态 | modalitySet=text/code/table/image/audio/video/structured/mixed/unknown；数量沿用现有单位 | A；before/after分别标明；适配器 | 不上传EXIF、内容向量、语音特征、语言中的个人信息 | 否 |
| 需求变更规模 | approvedRequirementChanges 的 added/removed/modified 数量桶；区分需求扩展与修错 | B；approved_change；本地清单差异 | 没有原计划不能猜；后验随意增加条件不能抬高原难度 | 可选 |
| 基线经验 | familiarity=first_time/occasional/routine/unknown，按任务类填写，不采工作年限、公司和学历 | L；before；仅human_report | 默认只用于本地个人纵向分析，不跨人打分，不让AI推断 | 否 |
| 人工负荷 | 可选规范量表或自定义体验字段，版本清楚，保留自报身份 | L；after；human_report | 不自动推断心理状态，不作为全站能力评分；缺省不问每次任务 | 否 |
| 多模态质量 | 固定验收类别下的检查覆盖与通过，不上传图像、声音、嵌入；客观任务指标需注明来源及适用单位 | A/B；after；特定领域运行器 | 不混合OCR字符错误率、图像偏好票数和代码测试比例成一个质量分 | 否/可选 |

“派生”字段应优先服务端或本地计算而不重复采集；如果可以由已上传的充分统计量确定，就不新增传输字段。增加字段前必须回答：它能改变哪一条反馈，是否已有字段可以回答，能否由低成本程序取得，是否会形成新的身份关联。

## 6. 闭合白名单与隐私抑制

1. **绝不上传 X 类**：原文提示词、系统提示词、思维过程、代码和文稿、业务标题、路径、文件名、源 URL、工具参数、终端输出、模型原始错误、检索文档 ID、调用 request ID、账号、邮箱、IP、账单或发票、合同、客户名称、内容嵌入、图结构以及它们的稳定哈希。原始来源与验证映射留本地。
2. 公开模型、Harness、套餐与版本只允许可核对的公开目录标识。自由格式符合 `publicId` 正则仍不代表公开产品；内部别名必须映射，不能映射时 unknown。价格版本哈希只引用公共价格快照，不能借此上传账单哈希。
3. 私人接收层只接受本文批准的字段组及 schema 枚举；不提供任意 `metadata`/`attributes` 字典。错误响应不能回显被拒绝输入。默认关闭新字段组，旧 consent 不应默许新增敏感背景问卷。
4. 公开输出单独建立白名单：原则上按月、粗任务族、公开模型与 Harness 输出汇总。新增方法、学科、输入质量、失败类型等维度，逐个检验来源数、任务数和单来源占比，不能继承父组已通过的发布许可。已有 MIN_TASKS=20、MIN_SOURCES=5、MAX_SOURCE_SHARE=0.35 是治理阈值，不是匿名性证明。
5. 精确时间仅留私人计算需要的范围；公开不暴露日历上的任务节奏。金额、罕见规模、长尾图特征公开时采用版本固定的桶或合并层次；极端值保留私有原值，公开展示上界桶。不要用截断后的桶中点冒充精确均值。
6. 禁止任意子集筛选、导出逐任务高维向量和无限细分交叉表；固定公开查询和快照，考虑互补单元抑制，避免用户通过前后差分推断小组。私人反馈也不能绕过公开参照发布规则，把其他用户的单条数据泄露给上传者。
7. 排除当前贡献者后重新判断参照发布门槛，不能先发布含本人的汇总再简单减去自身数据。私人分析保留本人准确值，参照只来自合规聚合结果。加密传输、访问控制和清除密钥不等同于匿名化，但仍是私人记录必须有的措施。
8. 若将来引入差分隐私，先选用户级还是任务级邻接、贡献上限、每期预算、重复请求复用与跨快照组合规则，并呈现噪声误差。当前不能用少量随机抖动、哈希或单个k阈值宣称获得差分隐私保证。

这套抑制策略属于本项目的设计建议。它降低可关联风险，不承诺在任意辅助信息和无限查询下“绝对无法识别”。

## 7. 数据真实性、成本与性能

- 来源优先顺序表达的是可复核程度：独立签发方核验、可复查本地仪器事实、人工报告、模型提取、未知分别展示。不能因为记录由程序生成，就把客户端可编辑日志当作独立证明。
- 本地随机标识用于同根目标去重、全部层级代理与修订关联。账单事实、代理节点、请求重试和工作产出使用不同去重域。哈希链只能发现已记录内容的变动，不能阻止一开始虚构内容或多账号重复声明。
- 计划快照在执行前或批准变更时保留；后验补录单列 retrospective。高频返工不能据此把原任务改判更难；相同变更的格式导出不能增加产出。
- 统计不做无声插补：缺少验收分母不给通过率；缺少完整时间区间不给等待占比；随访尚未成熟不给“零缺陷率”；未知实付不给节约金额。
- 优先消费 Harness 已有事件，在任务结束时产生结构值并按增量聚合。解析图只遍历已授权的现成节点边；不为新增字段扫描整个磁盘、全部账户或所有历史。
- 时间区间和计数在本地累积为固定大小结构，合并后丢弃传输用原事件；每批有体积和记录预算，超限分片且保留 partial 状态。没有持续新事件就不轮询。
- 从原始对话识别要求、方法和工作量仍可能需要模型；复用现有分类、只处理增量并计入 collectionProcessing。不能承诺“这些字段免费取得”。没有可靠结构来源时，少收一项比让模型补全更可靠。

## 8. 能够支持的用户反馈，以及不能支持的结论

| 反馈 | 最小输入与适用条件 | 可用表述 | 不成立的表述 |
| --- | --- | --- | --- |
| 质量覆盖 | 独特验收条件 planned/executed/passed、关键条件 | “本次检查覆盖了已登记条件的x%；关键条件仍有y项未检查。” | “测了很多次，所以质量高。” |
| 返工与需求变化 | 原目标稳定ID、返工事件、批准变更 | “返工主要出现在已记录的某类事件；同时发生若干需求变更。” | “返工都是模型能力差造成的。” |
| 时间构成 | exclusive完整分量、同墙钟跨度 | “等待外部依赖占x%，这部分不能归因模型输出速度。” | 将全部子代理运行时长之和称总工作时长 |
| 稳定交付 | 相同7/30天观察窗、右删失、重开/缺陷 | “已有n个任务完成7天观察，观察到m个重开；其余尚未完成观察。” | “昨天完成的任务今天无缺陷，因此长期可靠性更高。” |
| 任务结构 | 同类输入、事前要求、已有耦合统计 | “本次包含更多相互依赖部分，直接成本比较缺少对应同类样本。” | 因耗费更多Token就给用户更高难度分 |
| 个人趋势 | 相同单位、采集覆盖、任务构成、价格版本 | “同类工作中的验收成本下降；任务组成变化另列。” | 不校正任务变化就说能力提高 |
| 模型/套餐建议 | 同任务条件、证据等级、月份、原币与费用口径 | “在可比的n种配置中，此模型+Harness的观察成本较低；历史促销单列。” | “全球最优”“保证省x元”或跨币种混算 |
| 数据改进建议 | 关键缺项与适配器能力 | “补齐验收清单能计算覆盖；无需上传清单内容。” | 为取得更多评分要求上传原对话或账单 |

优先实现字段覆盖与验收/等待/随访诊断，再在真实同条件样本上校准实验难度。没有公开参照时，照常给出本人工作量、消耗构成、缺项和可采取的记录改进，不编造社区排名。更多维度应该表现为更多可解释事实与有条件结论，而不是越来越精确的个人总分。
