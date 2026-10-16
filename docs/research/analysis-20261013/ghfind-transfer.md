# ghfind 与公开评价项目：源码核验和迁移设计

核验日期：2026-10-13。范围：ghfind 的确定性评分、风险规则、快照物化，以及 Inspect、HELM、SWE-bench 的相关统计和验收实现。下面把“外部项目实际实现”与“OpenCost 建议”分开；这不是已经完成的 OpenCost 代码迁移，也不是对任务难度的实证验证。

## 结论

ghfind 适合借鉴的是可复算的分维度评分、饱和函数、证据结构、风险门槛及规则版本。它评估 GitHub 公开账号足迹，不能把账号信用分、仓库星标、粉丝、账号年龄迁移成 AI 任务难度。OpenCost 应自行实现任务评价公式：先保存匿名事实和缺失状态，再按任务、领域、资源条件及证据等级匹配参照，最后给出结果与不确定性。文案生成器不能改变这些结果。

已经只读获取四个公开仓库，未安装依赖、执行项目脚本或加载项目提示词。所有源码链接固定 commit，避免后续修改改变本报告依据。来源登记见 [ghfind-transfer.sources.json](./ghfind-transfer.sources.json)。

| 项目 | 固定 commit | 许可证 | 本次实际核验范围 |
| --- | --- | --- | --- |
| ghfind | `38f7ea6a4814f552c23b44c627ba744ca831b5fd` | AGPL-3.0 | score、risk v10、score materialization、roast 路由、公开说明 |
| Inspect | `d7495e8020d362f22aa7ac8ae238c3c9c6ca5602` | MIT | accuracy、标准误、置信区间、scoring policy |
| HELM | `63754d05db6f874e41a395880fb573890a13e791` | Apache-2.0 | 可合并统计量、效率指标、原始论文 |
| SWE-bench | `02e7a74ffd0b707aab73d203fe87bdc7c76afc8e` | MIT | grading.py 的执行证据、验收与回归判定、原始论文 |

## 1. ghfind 当前代码究竟怎么评分

### 1.1 基础分与饱和函数

`score.ts:373–504` 从六个维度计算基础分，再扣风险分，截断到 `[0,100]`。六个上限为账号成熟度 10、原创项目质量 18、贡献质量 27、生态影响 20、社区影响 8、活动真实性 17。上限来自 [score-presentation.ts:3–11](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score-presentation.ts#L3-L11)，主计算见 [score.ts:373–504](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score.ts#L373-L504)。

大量计数使用 `L(x;F)=min(log10(1+x)/log10(1+F),1)`，`x≤0` 时为 0。它降低极端计数的边际加分；它不是估计工作量的物理定律。主评分使用与 Python 一致的 half-even 舍入，便于跨实现复算。[score.ts:18–40](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score.ts#L18-L40)

贡献计数区分外部 PR 和自有仓库 PR：外部量最多 12 分，自有最多 4 分；外部低星仓库折算权重 0.6；满足样本条件后用外部已合并与维护者关闭数计算接受率。作者自己关闭的 PR 不当作维护者拒绝。这里可迁移“不同事件有不同语义、明确分母”，不能迁移“低星仓库任务价值较低”。[score.ts:220–228](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score.ts#L220-L228)、[score.ts:313–370](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score.ts#L313-L370)

### 1.2 风险分不是见到异常就扣分

`risk.ts` 与基础六维评分分开。每个风险保存 `observed`、`sample_size`、`threshold`、`coverage`、`window`、`severity`、`confidence`、`disposition`、`penalty`。覆盖度分别记录仓库、合并 PR、全部 PR 的已采集比例。[risk.ts:64–117](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/risk.ts#L64-L117)

当前 v10 规则可归纳为：

- 采用 `(x+1)/(n+2)` 平滑比例；样本因子为 `min(n/40,1)`。贡献、拒绝和洪泛的最小样本均为 20；这些是该项目的规则值，不是通用统计常数。
- 拒绝异常使用 Wilson 95% 下界，且只统计已经明确由维护者关闭的 PR。缺少关闭归因时不推定拒绝。
- 模板化集中提交需要第二项质量证据，不能仅凭“很多相似动作”判定刷量；关注或星标单项异常也只提示。
- 公开足迹少、仓库多、Fork 多、长期不活跃都可以只作为背景说明，不扣风险分。
- 同一风险族合计封顶，贡献风险 16 分、社交风险 9 分、总扣分 25 分，避免相关迹象重复扣分。

以上分别见 [risk-rules-v10.json:1–37](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/config/risk-rules-v10.json#L1-L37)、[risk.ts:40–61](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/risk.ts#L40-L61)、[risk.ts:192–317](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/risk.ts#L192-L317)、[risk.ts:319–390](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/risk.ts#L319-L390)。

其 `confidence` 是按覆盖度和样本因子构造的启发式分值，不是已经校准的“异常真实概率”。不能在 OpenCost 界面把它改写成“有 90% 的概率作弊”。Wilson 针对比例的区间也不能证明个体作弊。

### 1.3 缺失处理与版本差异

该项目不同规则的缺失行为并不统一。例如星标互动比例缺失时倍率为 1，而项目实质分缺失可能为 0；小样本或缺少 PR 归因时又抑制风险扣分。[score.ts:44–56](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score.ts#L44-L56)、[score.ts:389–411](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score.ts#L389-L411)、[risk.ts:262–283](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/risk.ts#L262-L283)

OpenCost 应采用更明确的测量状态：`observed`、`unknown`、`not_applicable`、`unavailable`、`conflicting`，每个指标单独给已知分母。不能把未采集 Token、未测量延迟、未知验收当作 0，也不能用已知项重新归一化后伪装成完整得分。

源码与公开文档存在时间差：2026-07 的博客把若干足迹现象描述成扣分，当前 v10 已改为只提示；README 的流程图仍提及 LLM ±10 校准，但当前 Web 路由 `scoreSummary`、历史回放与生成结束均固定 `delta=0`。[博客固定版本](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/content/blog/how-we-score-github-accounts/en.md#L60-L95)、[当前路由:533–576](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/app/api/roast/route.ts#L533-L576)、[当前路由:1015](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/app/api/roast/route.ts#L1015)

### 1.4 最值得迁移的快照机制

`materializeCanonicalScore` 校验 SHA-256、评分版本、采集版本、身份和结构后，重新从事实计算评分，覆盖快照中嵌入的分数，并清空调用者提供的标签与报告文字。这正适合防止“提示词直接声称分数高”。但哈希只证明收到的字节一致；若采集器本身虚构事实，哈希仍然一致。[score-materialization.ts:408–465](https://github.com/hikariming/ghfind/blob/38f7ea6a4814f552c23b44c627ba744ca831b5fd/src/lib/score-materialization.ts#L408-L465)

迁移方法是从本地可验证事件生成白名单字段，在上传端记录版本和摘要，在服务端拒绝客户端评分并重算。运行日志、用户验收、服务商计量、可信签名是不同来源，不能因为都带哈希就视为同等可信。

## 2. 另外三个项目提供的补充

### Inspect：明确分母、误差归因与成组不确定性

Inspect 将“模型答错”“评分器失败”“无法给出判定”分开。已给出正确或错误判定的样本进入该评分器分母；评分器异常和 unscored 不伪装成答错，同时保留缺失计数。OpenCost 应同时给出端到端完成率与有判定样本中的通过率，防止排除大量失败记录后只展示漂亮比例。[scoring-policy.qmd:14–39](https://github.com/UKGovernmentBEIS/inspect_ai/blob/d7495e8020d362f22aa7ac8ae238c3c9c6ca5602/docs/scoring-policy.qmd#L14-L39)

其聚类标准误为 `SE = sqrt[G/(G−1) × Σg(Σi∈g(yi−ȳ))²]/N`；cluster bootstrap 每次抽取整个簇，保留簇内相关。OpenCost 的“一个根任务及其所有层级子代理”必须视为一组；同一上传者/同一运行批次也可能有关联，不能把几十个子代理当成几十个独立用户。[std.py:57–118](https://github.com/UKGovernmentBEIS/inspect_ai/blob/d7495e8020d362f22aa7ac8ae238c3c9c6ca5602/src/inspect_ai/scorer/_metrics/std.py#L57-L118)、[std.py:406–434](https://github.com/UKGovernmentBEIS/inspect_ai/blob/d7495e8020d362f22aa7ac8ae238c3c9c6ca5602/src/inspect_ai/scorer/_metrics/std.py#L406-L434)

Inspect 还提供 Wilson 区间和聚类调整。迁移时不能照搬其部分函数对单个样本返回零标准误/点区间的数值兜底：产品应显示“无法估计区间”，而不是零不确定性。[std.py:237–240](https://github.com/UKGovernmentBEIS/inspect_ai/blob/d7495e8020d362f22aa7ac8ae238c3c9c6ca5602/src/inspect_ai/scorer/_metrics/std.py#L237-L240)、[std.py:261–303](https://github.com/UKGovernmentBEIS/inspect_ai/blob/d7495e8020d362f22aa7ac8ae238c3c9c6ca5602/src/inspect_ai/scorer/_metrics/std.py#L261-L303)

相应统计论文是 Evan Miller 的 [Adding Error Bars to Evals（2024，预印本）](https://arxiv.org/abs/2411.00640)。它支持报告误差、差值和实验设计；它不能让观察性上传数据自动成为随机试验。

### HELM：多指标及实际、估计值分离

HELM 强调在相同场景同时评价多个指标，并明确缺失的场景。适配方式会改变模型比较，因此 OpenCost 应把 Harness 及配置保留在比较对象中。[HELM 论文](https://arxiv.org/abs/2211.09110)、[Stanford 官方说明](https://crfm.stanford.edu/2022/11/17/helm.html)

代码把实际推理时间、去除争用影响的估计时间、理想化运行时间分别记录，保留 batch size；缺少模型效率资料时返回未知。OpenCost 对实际付款、套餐分摊、API 等价成本也必须采取这种分离方式；实测延迟不能用理论 Token 吞吐替代。[efficiency_metrics.py:63–86](https://github.com/stanford-crfm/helm/blob/63754d05db6f874e41a395880fb573890a13e791/src/helm/benchmark/metrics/efficiency_metrics.py#L63-L86)、[efficiency_metrics.py:122–164](https://github.com/stanford-crfm/helm/blob/63754d05db6f874e41a395880fb573890a13e791/src/helm/benchmark/metrics/efficiency_metrics.py#L122-L164)

`Stat` 保存 count/sum/sum_squared/min/max 并可合并，适合服务端增量物化，避免每份反馈重读全部原文；不过它的方差是总体方差，不能拿来冒充抽样标准误。数值跨度大时 OpenCost 实现宜用稳定的在线/合并方差算法，并为分位数另存排序事实或受控近似草图。[statistic.py:8–56](https://github.com/stanford-crfm/helm/blob/63754d05db6f874e41a395880fb573890a13e791/src/helm/benchmark/metrics/statistic.py#L8-L56)、[statistic.py:83–93](https://github.com/stanford-crfm/helm/blob/63754d05db6f874e41a395880fb573890a13e791/src/helm/benchmark/metrics/statistic.py#L83-L93)

### SWE-bench：完成需求还要检查回归

SWE-bench 使用真实代码仓库问题，评价修复后是否满足目标及保留原行为。[SWE-bench 论文，ICLR 2024](https://arxiv.org/abs/2310.06770)

当前实现将 Fail-to-Pass 和 Pass-to-Pass 分开：目标测试全部通过且既有测试维持通过才判完整解决；目标部分通过且无回归才判部分解决。OpenCost 可推广为“目标验收”和“保留约束验收”，适用于代码、表格核对、文稿事实保持和数据转换守恒。[grading.py:288–326](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/swebench/harness/grading.py#L288-L326)

当前代码还检查测试是否真正执行、状态与退出码是否冲突。空日志、运行器未启动不能被理解成全部通过。OpenCost 上传可只保留测试数量、执行成功标记、退出状态分类及验证器版本，不上传测试名、源码或日志正文。[grading.py:25–46](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/swebench/harness/grading.py#L25-L46)、[grading.py:147–176](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/swebench/harness/grading.py#L147-L176)

不能直接搬用其空测试分母返回 1 的约定：开放式真实任务可能根本没有充分测试，应显示未测量。也不能把文稿/图片/咨询任务硬套代码测试通过率。

## 3. OpenCost 的可实施设计

以下是结合上述项目提出的工程设计，需要由 OpenCost 数据校准，不是外部论文已经证明的权重。

### 3.1 匿名摘要只增加有明确统计用途的字段

| 事实组 | 可上传的白名单计数/枚举 | 能回答的问题 | 必须保留的边界 |
| --- | --- | --- | --- |
| 原始要求 | 主领域、子类型、目标数量/区间、输入模态、输入规模区间、约束类别、验收方式、需求是否预先固定 | 是否同类、复杂性来源、任务结构 | 不上传需求原文、主题、客户名；事后推断注明来源 |
| 任务结构 | 根任务数量、组成部分数量、子类型计数、依赖深度区间、依赖边数区间、串行/并行、跨系统数量区间 | 组合任务与耦合负担 | 子代理数量是执行策略，不自动提高难度或成果量 |
| 交互过程 | 用户轮次、澄清轮次、需求变更、用户纠正、人工接管、重试、无效重试 | 成本来自沟通、模型、环境还是任务变化 | 只上传事件类别/计数；归因未知不能硬分配 |
| 验收结果 | 预先声明的验收总数、通过数、未执行数、阻塞数、回归项、独立审核是否一致 | 完成质量及验收覆盖 | 状态不可由摘要文字直接证明；不同验收类型分开 |
| 资源与协作 | 根及全部后代 Token、缓存/推理 Token、外部工具账单类别、模型/Harness 版本、调用/失败次数、采集覆盖 | 真实端到端费用、重复计算、代理开销 | 区分互斥明细与父级合计，避免重复加总 |
| 时间 | 活跃执行、模型等待、工具等待、排队、人工干预、总历时及各项测量覆盖 | 时间瓶颈、并行收益 | 并行耗时不得相加为墙钟时间；不上传精确作息轨迹 |
| 证据 | 采集器/规则/验证器版本、来源类别、受保护本地摘要、可信签名状态、窗口完整性 | 可复算程度、缺失、异常冲突 | 哈希不是真实性证明；低熵原文不可直接无盐哈希 |

准确图结构、精确时间线、稀有技术组合也可能重新识别项目。默认上传计数/区间与封闭枚举；去重和根任务归属可用本地随机标识，公开聚合再做小样本隐藏。无法采集的字段明确 unknown，不能让 AI 补数字。

### 3.2 不把“做得慢”当作“任务难”

任务描述性难度应从开始前可得到的因素构造：知识/方法要求、推理依赖、约束冲突、验证难度、信息不完备、跨领域/系统依赖、交付规模。难度与执行结果分开；Token、失败、耗时只用来研究实际执行负担。否则弱模型用更多 Token 会反过来把同一任务判得更难。

先保存维度向量和规则版本；领域内校准后再汇总。在没有盲审标注、跨模型重复题或可连接的共同任务样本时，不能声称得到了模型无关的潜在难度。未标注数据可提供描述统计，不能替代校准。复合任务同时保留各部分和耦合因素；工作量统计不得把根任务、组件和子代理产物重复计为三个成果。

### 3.3 成果、可信程度、性价比分别计算

对任务 `i`，先记录 `a_i=passed_i/declared_i`（只在分母真实存在且验收可解释时），完整交付另用明确的最终验收状态。预先固定且独立检验的验收项可作为成果单位；随意拆分的条目只能作为描述，不能增加公共排名分数。

主要费用指标用 `Σcost_i / Σaccepted_i`，分子包括该可比样本内失败、重试、所有层级代理及其他可归属支出。零成功时成本仍展示，单位成功成本为不可估计/无成功交付，不输出 0。完成率作为结果维度进入同一个样本的评价，不按事后完成率筛选比较对象。通过率、费用、等待、人工负担共同展示；没有已验证的共同效用权重时，不把它们强行加成一个“总能力分”。

用户希望每类任务为每个模型选择最划算的 Harness：应先固定任务条件、成本口径和窗口，在该模型的所有合格 Harness 中按单位验收成本比较，再展示模型与 Harness。样本不足、仅有一位贡献者、采集不完整的便宜配置不能自动成为赢家。跨很多 Harness 选最小值会有选择偏差，应显示候选数量、样本、区间和差异是否明确，并用后续时间窗检验推荐。

### 3.4 反馈至少回答六类问题

1. **做了什么**：任务构成、成果单位、完成与未完成、复合任务、人工接管；按领域展示，不用一个任务数代表所有工作。
2. **花在哪里**：总费用和费用覆盖、缓存、推理、重试、失败、子代理、工具、套餐闲置和额度到期。各种金额口径独立展示。
3. **卡在哪里**：模型/工具/排队/人工时间、澄清与需求变更、环境失败及未知归因。相关关系不解释成原因。
4. **处于什么位置**：同领域/类型/规模/验收与证据条件、同货币/成本口径/价格时期的公开分布；排除用户自身贡献。显示参照来自多少配置、贡献者、时期和任务，不能把配置百分位说成用户百分位。
5. **可以怎样改进**：针对重复失败、缓存利用、较高等待和套餐闲置给出程序触发的建议，每条列出观察值、参照、适用条件和缺失信息。单次异常只提示，不定义用户能力。
6. **推荐有多可靠**：按用户任务组合估计候选模型/Harness/套餐的费用区间、覆盖到的任务比例和额度约束。没有覆盖的任务不外推；公共样本不足时明确不推荐。

每条反馈用固定结构保存 `metric/value/unit/numerator/denominator/coverage/reference/filter/window/version/uncertainty/reason`。证据数量、采集完整性、验证方式和数据新鲜度分别呈现；它们不是可互相补偿的一个信任分。

### 3.5 低开销与校准

统计层沿用增量事实和版本快照。计数、总和、金额、分组覆盖、合并方差在写入时更新；较贵的分位数或 cluster bootstrap 按发布版本计算并缓存，不因页面刷新重复运行。新评分版本创建新派生结果，不改写历史事实和当时价格。

上线前的必要验证围绕实际失败模式：缺失不变成 0；重复上传/子代理递归不刷成果；增加无效重试不提高难度；身份或 Harness 版本不混并；费用口径不串用；范围扩大会增加真实样本但不凭空减少不确定性；小样本不出现精确冠军。校准使用按贡献者/项目隔离及按时间留出的样本，检查领域间误差、评分者一致性、推荐后费用偏差与推荐失效率。

## 4. 迁移优先级和许可证处理

第一批迁移确定性规则版本、匿名事实与评分分离、缺失与覆盖、风险只提示/证据门槛、子代理聚类和用户反馈依据。第二批在样本足够后加入领域校准、成组区间和推荐效果回测。账号声望、星标、粉丝、账号年龄、贬损性等级、自动人格评判不迁移。

本次没有复制 ghfind 源码进 OpenCost 产品；文档提炼算法思想并链接固定源码。若后续直接移植 AGPL 实现，需要保留相应版权、来源和许可证义务；本报告不是许可证兼容性结论。Inspect、HELM、SWE-bench 的直接代码复用同样应保留其许可要求。
