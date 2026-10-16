# 脱敏任务数据的统计分析与个人反馈设计

研究日期：2026-10-13。本文是面向 OpenCost 当前实现的第一轮定向研究，核验了 18 项原始论文、作者材料或官方统计资料。它不是覆盖所有领域的系统综述，不把摘要阅读写成全文评审。逐项 URL、DOI、读取层级、适用范围和访问限制见 [来源记录](statistical-feedback.sources.json)。文中的新算法、字段和阈值是设计建议，除“现有实现”外均不代表已经部署。

## 1. 先确定用户能够得到什么结论

应把反馈分成四层，后一层需要额外证据，不能因为可以计算一个数字就自动升级结论。

| 层次 | 可以回答的问题 | 需要的数据 | 不能声称的内容 |
| --- | --- | --- | --- |
| 记录描述 | 这次有多少验收目标、费用在哪里、多少测量缺失、重试和人工介入是多少 | 本人上传的闭合字段、明确的观察截止和分母 | 本人优于其他人；任务本身很难；费用高就是浪费 |
| 同条件比较 | 在已观察的相同任务条件和费用口径中，这次数值处于什么位置 | 排除本人后的公开合格记录、任务条件、时间和计费匹配 | 相似字段证明任务完全相同；配置百分位就是用户排名 |
| 统计推断 | 差异有多稳定、换一批来源还会不会出现、下一期费用分布是什么 | 来源簇充分统计量、明确的抽样对象、足够支持、验证过的区间算法 | 大量相关任务等于大量独立证据；观察范围等于置信区间 |
| 方案推荐 | 此类目标有哪些历史上更省的模型与 Harness、哪些套餐与工作组合相符 | 上述证据，加候选覆盖、当前适用性、选择过程和未来回测 | 历史最低一定最优；换模型必然节省；观察比较就是因果效果 |

HELM 支持多场景、多指标和明确缺项；AgentBench 支持按交互环境与失败机制拆解；它们没有提供一个能直接衡量全部真实工作的统一难度公式。[HELM](https://arxiv.org/abs/2211.09110)、[AgentBench](https://arxiv.org/abs/2308.03688)

成本与成功率需要联合观察，固定优化成本、运行成本和当时价格也应分开。保留 Token 后可以另做当前价格重算，但重算结果不能覆盖历史实付。这里迁移的是评估原则，不迁移论文里的模型排名或数值。[AI Agents That Matter，正文第 2—4 节](https://arxiv.org/html/2407.01502v1)

## 2. 当前代码已经做到什么，差距在哪里

2026-10-13 阅读范围：`shared/personal-feedback.ts`、`shared/analysis.ts`、`server/public-fact-queries.ts`，并检查 `shared/schema.ts`、`shared/evaluation.ts`、`shared/ranking.ts` 的相关定义。以下对应读取时的实现，其他代理同时推进的变更以最终代码为准。

| 现有实现 | 应保留的理由 | 进一步改进 |
| --- | --- | --- |
| `costPerAccepted = 全部费用 / 已验收根目标数` | 已将未成功目标的费用纳入成本 | 不再额外乘一次完成率惩罚；验收数为零时显示无单位验收成本 |
| `workKey` 匹配任务类型、规模档位、验收方式、依赖、需求是否锁定等 | 防止直接混合不同工作 | 记录匹配覆盖和拒绝原因；档位相同仍不是任务等价证明 |
| 同月、同币种、费用覆盖和分摊口径限制 | 费用具有明确含义 | 明确当前价格与历史价格；跨计费只做方案参考 |
| 公开参照排除本人，使用已经通过公开门槛的事实聚合 | 防止本人影响自己的参照；避免读原始正文 | 不能把“整个数据库”解释为合并全部不同条件的数据 |
| 配置等权百分位，明确不是用户排名 | 当前聚合结果的真实分母是配置 | 增加 `referenceUnit = published_configuration`；不要用任务数给配置百分位伪造精度 |
| 指标有部分测量覆盖检查 | 缺失不能当零 | 所有分析统一输出 `known / eligible / total` 和缺失原因 |
| 来源平衡单位成本及来源观察极值 | 能看出大量任务来源是否主导结果 | 明确它与汇总比值是不同估计对象；极值不是置信或预测区间 |
| 每种任务独立为每个模型挑最省 Harness | 符合用户指定的排名定义 | 披露参与筛选的 Harness 数、选择不确定性和样本外验证状态 |
| 只对完整套餐账期展示购买费用和历史容量 | 避免将均摊单位成本当购买价 | 套餐共享额度、多类工作混合与重置频率需有独立建模依据 |
| 难度关闭，记录完成量 | 没有经过标定的难度分数不会污染排名 | 新增需求前特征和结果后特征，先做剖面，不从 Token、耗时反推固有难度 |

两项需要优先纠正的潜在误读：`sources` 是来源标识数，不证明独立真人或独立组织；`MIN_TASKS=20`、`MIN_SOURCES=5`、`MAX_SOURCE_SHARE=35%` 是公开展示治理条件，不是统计显著性或可靠性保证。来源之间是否独立，是研究设计问题。[Cameron & Miller，II、IV、VI 节](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf)

## 3. 脱敏摘要还应扩展什么

所有新字段应是可选的闭合枚举、计数、区间或摘要统计，保留 `unknown`。不新增任务名称、用户提示词、路径、项目名、账号、原始代码、检索正文或自由文本原因。精确业务时间可留本地；上传只保留计算必需的相对时长、日期粒度或时间档位。来源匿名标识和跨期关联本身会增加可链接性，应单独授权、限制用途和保留期；去掉姓名不等于数学意义上的完全匿名。

### 3.1 在执行前记录的条件

`Task.analysis.before` 应与结果隔离，建议包含：

| 字段组 | 建议字段 | 为什么有用 | 采集依据 |
| --- | --- | --- | --- |
| 任务归类 | taxonomyVersion、domain、subtype、classificationBasis、classificationCoverage | 区分算法证明、应用实现、数据清理、文献检索等同领域不同工作 | 已有请求归类；未知保留未知 |
| 任务规模 | inputUnit、inputBand、plannedOutputUnit、plannedOutputBand | 比较材料和目标规模 | 本地程序计数或任务确认 |
| 验收规格 | acceptanceMethod、requiredCriterionCount、criterionVersion、requirementLocked | 将目标改变和真正失败分开 | 执行前清单或验收器 |
| 结构 | requiredComponentCount、optionalComponentCount、dependencyEdges、dependencyDepth、coupling、integrationRequired | 描述任务耦合，防止只看子任务数 | 结构化计划或确认后的依赖图 |
| 方法需求 | reasoningForm、novelty、specialistKnowledge、ambiguity、inputQuality | 区分已知流程与开放研究 | 只记录可解释分类与来源；不让模型填无依据精确分数 |
| 环境 | preparationState、toolAccess、networkState、contextReuse、externalDependencyCountBand | 控制环境准备和外部等待差异 | Harness 或采集器 |
| 目标条件 | deadlineClass、qualityTarget、riskClass | 区分赶时间与高质量约束 | 用户明确要求；不从费用倒推 |

`before` 必须有 `observedBeforeExecution`、`origin`、`schemaVersion`、`evidenceBasis`；回顾补录标为 `retrospective`，不能混同执行前信息。哈希只证明对应快照未变，不证明任务量真实。

### 3.2 在执行后记录的结果和资源

| 字段组 | 建议补充 | 可做分析 | 不可替代的内容 |
| --- | --- | --- | --- |
| 生命周期 | observedDurationMs、terminalStatus、isClosed、acceptanceObserved、censoringReason | 终态闭合度、在制目标、延迟验收 | 不能把仍在进行的任务判为最终失败 |
| 尝试 | attemptCount、firstAttemptAccepted、retryReasonCounts、attemptCostKnown、retryCostMinor | 首次验收、重试负担、重试费用 | `attempts` 不能推算每次费用或独立试验概率 |
| 质量 | criteriaPassed、criteriaTotal、mandatoryCriteriaPassed、reopened、regressionDetected、acceptanceSource | 检查项完成、返工、验收后缺陷 | 不同标准的通过比例不能当相同质量分 |
| 时间 | activeWallMs、userWaitMs、queueMs、toolExclusiveMs、modelExclusiveMs、overlapMs、timingSemantics | 真正的时间瓶颈 | 累计代理时间不可直接加成经过时间 |
| 资源 | 子代理树总用量、最大深度、峰值并行、外部 API/搜索/图像/音视频/计算/存储计数 | 工具与代理开销、外部资源占比 | 计数不是费用；缺价不补零 |
| 成本 | actualPaid、refund、creditsConsumed、modelCost、toolCost、infraCost、unallocated、priceVersion、priceObservedAt | 费用组成、活动与常规价差、原价重算 | API 等价费用不能替代订阅实付 |
| 提取开销 | collectionProcessing 的费用、Token、调用数、代理树范围、是否计入本账期 | 展示采集本身的成本 | 不得再把已经计入账期的整理费用加一次 |
| 测量状态 | measured、unsupported、not_collected、redacted、not_applicable、invalid；measuredTaskCount | 统一覆盖率与缺失诊断 | 缺失原因不能靠空值猜测 |

缺失可能与失败、复杂任务或特定 Harness 有关，因此“已测任务的均值”不能自动推广到全部任务；只做完整案例分析也不能自动消除偏差。[Rubin 1976，原始摘要](https://academic.oup.com/biomet/article-abstract/63/3/581/270932)

## 4. 第一阶段：现有字段即可计算的 `report.analytics`

无需额外 LLM，也不需要新增原始历史全库扫描。直接从当前已校验 Envelope、`allocate()`、`summarize()` 和已经取得的公开聚合计算。建议版本 `personal-analytics-1`，所有数组设定上限，结果限定私人可见。

```ts
type MeasurementSupport = {
  total: number;
  eligible: number;
  known: number;
  missing: number;
  coverage: number | null;
  applicability: 'all_tasks' | 'measured_subset' | 'not_applicable';
};

type AnalyticValue = {
  id: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  unit: string;
  support: MeasurementSupport;
  inference: 'descriptive_only';
  reason: string | null; // 实现时改成封闭枚举
};
```

最终契约可按 UI 调整，但不能丢掉单位、分母、覆盖和缺项原因。不要用一个合成“可信度 87 分”替代这些可核对的信息。

### 4.1 工作、验收和在制任务

令根目标数为 `N`，已验收为 `A`，各状态计数为 `N_s`。

- 状态结构：`N_s / N`，分别显示 accepted、partial、failed、abandoned、in_progress。
- 观察时验收比例：`A / N`。名称保留“本次观察”，不称未来完成概率。
- 明确终态比例：`(accepted + failed + abandoned) / N`。`partial` 是否已经结束没有可靠字段时单独保留。
- 完成工作按量纲分别累计：页面、记录、测试、图像、音视频秒数不能相加成同一种工作量。
- 已测分量验收比例：同一任务、同一 `component definition` 的 `accepted / planned`；同时报告该任务是否整体验收、必需分量是否全部验收。不能通过拆成更多小分量提高根目标得分。
- 任务构成：各 subtype 的根目标占比、已分配费用占比和验收数；最多展示若干组时保留“其余”及确切数量，展示截断不等于未分析。

生命周期还未闭合时，历史中短任务先完成、长任务仍在进行，会改变观察结果。以后有开始时间、截止时间和删失原因时，可研究时间到验收；放弃或失败通常是竞争终态，不能简单当作无信息的删失。Kaplan–Meier 的迁移需要满足相应删失假设，当前仅增加可观测字段，不直接上线生存概率。[Kaplan & Meier 1958，原始摘要](https://www.tandfonline.com/doi/abs/10.1080/01621459.1958.10501452)

### 4.2 费用分解

使用现有整数分摊结果 `c_i`，不另造分摊方法。

\[
C_{net}=paid-refund,
\quad C_s=\sum_{i:status_i=s}c_i,
\quad C_{unallocated}=C_{net}-\sum_i c_i.
\]

- `C_s` 的名称是“该状态目标已分配费用”。失败根目标中的支出不等于全部无价值；partial、in_progress 的费用更不能统一叫浪费。
- 分配覆盖：`Σ c_i / C_net`，仅当 `C_net > 0`；零净支出单独显示，不能除以零。
- 单位验收成本：`C_net/A`。`A=0` 时保留净费用和零验收信息，不输出有限值，也不偷偷删除该样本。
- 已验收根目标的条件均价 `Σ_{accepted}c_i/A` 与包含所有失败的单位验收成本不同，应使用不同名称。
- 重试成本只能来自实际逐尝试费用或可信费用分解。不能按 `attempts-1` 比例分摊，因为不同尝试的 Token、缓存和工具费用不同。
- 总费用覆盖、分摊方式和证据等级不同的数字不得直接作节省百分比。

### 4.3 重试、交互和工具诊断

- 发生重试的目标占比：`count(attempts > 1)/N`；平均额外尝试：`Σ(attempts-1)/N`。
- 每项验收成果额外尝试：`Σ(attempts-1)/A`，分母为零则未知。这是过程负担，不是成功概率。
- 工具失败率：只在 `toolCalls` 和 `toolFailures` 同时已知的任务集合 `M` 中算 `Σ_M failures / Σ_M calls`；调用总数为零时显示不适用。
- 人工介入、上下文重置/压缩、模型切换、Harness 切换、需求变更分别统计。频繁变更不自动归咎于模型，不依据归因枚举生成因果结论。
- 每种资源、轮次或事件均显示测量任务数。Token、检索调用和计算用量不存在可通用加总的自然单位。
- 最大代理深度和峰值并行度只描述执行结构；代理数多不自动加工作量，峰值并行高不自动证明加速。

### 4.4 时间和瓶颈

当前 `wallMs`、`modelWallMs`、`toolWallMs` 不能默认是互斥时间。多代理并行时，模型和工具累计时长可以超过实际经过时长。因此先展示各自数值及测量语义；只有记录了互斥区段、重叠量和完整范围，才能给出相加为 100% 的时间组成。

TTFT 的请求加权均值与根目标加权均值不同。输出速度 `Σ可见输出 Token/Σ对应输出时长` 是吞吐率，不能改写为平均用户体验。等待、排队、输出速度和整体完成时间分别展示。

### 4.5 参照覆盖和推荐支持

```ts
type MatchSupport = {
  tasks: number;
  matchedTasks: number;
  unmatchedTasks: number;
  matchedShare: number | null;
  comparableConfigurations: number;
  referenceUnit: 'published_configuration';
  outcome: 'available' | 'insufficient' | 'reference_unavailable';
  excludedReasons: Array<{ reason: string; tasks: number }>;
  displayedGroups: number;
  totalGroups: number;
};
```

`matchedTasks` 按本人根目标去重计数。不同原因可能同时发生时，要么提供互斥的首要原因，要么明确各项重叠；不能把重叠原因计数相加当未匹配总数。服务暂不可用与数据不够必须分开。不能把 UI 只显示前 24 组写成“其他组没有参照”。

推荐增加 `candidateHarnessCount`、`selectionBasis=observed_minimum`、`selectionUncertainty=not_estimated`、`sampleOutOfTimeValidated=false`。已有数据支持时，可展示每个模型在该类任务选中的 Harness、历史最低值与其他 Harness 的数量；不能把参与候选越多带来的极值优势说成能力优势。

## 5. 第二阶段：同条件比较与任务构成标准化

### 5.1 公开数据库的使用规则

全库参与生成事实层，但个人报告仍按相关条件查询或读取已经缓存的合格汇总。保留隐私门槛、证据等级、时间截止、币种、费用范围、计费方式、分摊方式和任务条件。服务内部可使用合法的来源聚合，但不可为个人反馈暴露其他人的原始摘要、单来源值或来源标识。

最细条件不足时，可以显示“更宽任务分类的背景统计”，但必须换名称、显示哪些条件放宽；不能悄悄放宽后仍声称同条件比较。更宽组也必须重新通过公开门槛，不能用小组差分推回单个贡献者。

### 5.2 配置百分位与来源平衡不是同一件事

已有配置百分位可继续用中秩：

\[
P(x)=100\frac{\#\{v_j<x\}+0.5\#\{v_j=x\}}{K}.
\]

它表示 `K` 个已发布配置的数值位置，每个配置一个值，没有统计独立性承诺。只有三个配置时仍可计算描述位置，但不应用精细百分位制造精度；可优先显示“低于参照中位数”和完整 `K`。

来源平衡成本 `K_s^{-1}Σ_s(C_s/A_s)` 与汇总成本 `Σ_s C_s/Σ_s A_s` 的差别可以反映来源权重敏感性。若任一来源 `A_s=0`，来源比值没有有限定义，不能删掉它来显得更便宜。当前 `sourceBalancedCost` 对这种情况返回空值应保留。可输出两种结果和 `pooledToBalancedRatio`，但不能把该比例叫公平性分数或偏差修正值。

### 5.3 任务构成必须明确权重分母

如果 `w_g` 是本人**已发起目标**的类型占比，参照类型 `g` 的每个发起目标费用为 `c_g=C_g/N_g`，验收比例为 `p_g=A_g/N_g`，则标准化单位验收成本是：

\[
R_{attemptMix}=\frac{\sum_g w_gc_g}{\sum_g w_gp_g}.
\]

不能直接算 `Σ_g w_g(C_g/A_g)`，后者只有在 `w_g` 表示希望获得的**验收成果**占比时才对应那种目标。展示完整匹配覆盖 `Σ_{g∈matched}w_g`；不足 100% 时不给整体节省值，除非明确把结论限定为已匹配部分。不能将未匹配类型补成平均值。

整体排名和分组排名可能反向，所以同时保留分组和标准化结果。[Simpson 1951，原始摘要](https://academic.oup.com/jrsssb/article/13/2/238/7026675) 标准化只是对已测条件作分布调整，仍可能有能力、任务质量、用户经验等未测混杂；不能写“使用某模型导致节省”。[Hernán & Robins，作者书籍入口](https://miguelhernan.org/whatifbook)

## 6. 第三阶段：可靠性和区间，不能靠聚合均值补出来

### 6.1 最小内部充分统计量

事实 Worker 以后可按 `来源 × 条件 × 观察周期` 增量维护：

```ts
type SourceCellStats = {
  source: string; // 仅服务内部，不返回客户端
  conditionKey: string;
  periodKey: string;
  tasks: number;
  accepted: number;
  costMinor: number;
  metricKnown: Record<string, number>;
  metricSum: Record<string, number>;
  metricSumSquares: Record<string, number>;
};
```

成本与验收同簇保存，避免将分子分母独立重采样。重复根目标、重传批次、子代理及其后代先去重归属；它们不是独立重复。来源标识无法识别同一公司、多账号或共用代理时，明确独立性尚未建立。任务量权重集中度 `1/Σ_s w_s²` 可以作为集中度描述，但不能改名为已验证的有效独立样本量。[MacKinnon、Nielsen & Webb，来源异质性与报告要求](https://arxiv.org/pdf/2205.03285)

### 6.2 簇重采样的可实现算法

估计对象先限定为“已观察来源所代表的同条件任务分布”。对来源簇重采样，保留被抽中来源的全部周期与目标贡献；若推断的是未来周期，还需另建时间块或未来过程模型，不能混用同一算法。

1. 取得每个来源的 `(C_s,A_s,N_s)`，目标 `R=ΣC_s/ΣA_s`。
2. 用固定种子从 `S` 个来源有放回抽 `S` 次；每次重新计算比值。
3. 如果一次重采样的验收分母为零，保留该次为无有限上界，不能静默剔除。
4. 对有效设计下的重采样分布计算区间，并同时输出来源数、集中度、零分母比例、算法版本、种子、次数和重采样单位。
5. 检查删除任一来源后的比值变化，显示是否由个别来源主导；它是敏感性分析，不是自动删异常值的依据。

可用 TypedArray 加确定性 PRNG 在 Worker 完成，初始 999 次并缓存。`S≥20`、无过度集中、完整覆盖等可作为产品试运行门槛，但必须标注为待回测的工程门槛，不是论文保证。来源少或高度不均衡时，即使 50 个来源也不能自动声称准确；优先只展示描述和敏感性。[Cameron & Miller，II.F 与 VI.C](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf)

当前只有 `count/sources/sourceRange` 的接口无法恢复上述分布。因此本轮不应在前端“补一个 95% 区间”。禁止将来源最小最大值、任务 P25/P75 或配置中位数乘任务数，改名为未来费用的置信区间。

### 6.3 完成率与重复可靠性

独立同分布二项试验条件成立时，Wilson 区间可由成功数和试验数直接计算：

\[
\frac{\hat p+z^2/(2n)\pm z\sqrt{\hat p(1-\hat p)/n+z^2/(4n^2)}}{1+z^2/n}.
\]

`z=1.96` 对应通常的双侧 95% 水平，但不应对相关真实历史任务直接套这个公式；换成来源数作 `n` 也不能修复。该公式可用于受控复测或明确的二项观测设计。[NIST，Wilson 区间公式](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)

τ-bench 区分找到一次成功与多次都成功：同一任务 `n` 次可比独立试验中 `c` 次成功，`pass^k = C(c,k)/C(n,k)`，`pass@k = 1-C(n-c,k)/C(n,k)`，再按任务平均。历史重试往往修改上下文、工具、要求或策略，不能当独立复测，也不能把整体完成率直接取 `k` 次方当可靠性。[τ-bench，评价指标小节](https://arxiv.org/html/2406.12045v1)

### 6.4 层级模型可作为后续研究，不能用少量伪计数包装可靠性

可选模型是二项成功率的层级 logistic 模型：

\[
Y_i\sim Bernoulli(p_i),\quad
logit(p_i)=\alpha_{type(i)}+\beta_{configuration(i)}+\gamma^TX_i+u_{source(i)}.
\]

类型和来源部分汇聚减少稀疏组极端估计，不能消除漏测混杂或虚构上传。对数费用另建模型并正确处理零费用，不与完成率强行合成一个 0—100 分。TypeScript 可实现带惩罚的最大似然与数值积分，但需要收敛、识别性、后验/预测校准和时间外验证；当前阶段不建议用未经验证的自写求解器向用户提供精准节省概率。[Gelman、Hill & Yajima，部分汇聚小节](https://sites.stat.columbia.edu/gelman/research/published/multiple2f.pdf)

## 7. 推荐算法：保留“每类任务选择该模型最省 Harness”，但记录选择过程

用户指定的展示规则可以继续保留：每个模型、每个任务条件下，选取观察到的最低单位验收成本，并展示具体 Harness 版本、模式和工具条件。

这种最小值会随候选数增加而更容易偏低。推荐应同时展示：历史最低值、候选数量、覆盖任务、来源数、验证状态和选择不确定性；“最便宜的已观察方案”与“未来更省的可靠方案”不是同一结论。[Cawley & Talbot，选择偏差与嵌套验证](https://jmlr.org/papers/volume11/cawley10a/cawley10a.pdf)

后续验证应在较早时间或训练来源中选择 Harness，再在未参与选择的较晚周期或保留来源中评价；如果同一来源跨两组出现，不能声称是独立来源验证。比较同一套任务的多个模型可以按任务配对；普通社区数据没有配对执行，不能直接套 Friedman 或 Wilcoxon 配对检验。[Demšar，独立数据集和配对比较范围](https://jmlr.org/papers/volume7/demsar06a/demsar06a.pdf)

套餐推荐以完整账期实付、退款、赠送、购买资格和额度重置窗口为对象。过去一个月完成 100 项任务，不代表套餐硬上限就是 100 项。混合任务共享额度时，缺乏完整组合记录就只给逐类模型候选，不捏造一个整体最优套餐。若将人工时间折成钱，单独接受用户本地输入的时薪情景，保留原始现金费用并明确这是情景估计。

## 8. 分析越多，越需要控制多重比较和筛选

第一阶段只输出描述，不生成显著性星号。将 50 个指标全部比较后挑出最惊艳的三项，不能按三个检验计算误报率。

未来确需“异常”或“显著更省”标签时，先固定检验族、主指标、实际有意义的差值和时间窗。具有有效单项 p 值且满足条件时，可用 BH 控制 FDR；依赖条件不清楚时不能默认 BH 总是有效。BY 在任意依赖下使用 `q/H_m`（`H_m=Σ_{j=1}^m 1/j`）的修正，但它也不能修复错误分母、选择偏差或无效单项检验。[BH 1995](https://academic.oup.com/jrsssb/article/57/1/289/7035855)、[BY 2001，原文](https://www.math.tau.ac.il/~yekutiel/papers/dep_annals.pdf)

“连续每天反复查看直到有改善”还是序贯选择问题。当前产品可固定周/月窗口并保留每次报告版本，先不生成显著性宣称；未来若上线连续统计告警，需要另外验证相应序贯方法。

## 9. 如何验证反馈真的可靠

未来对推荐进行时间外回测时，保存当时可见的事实快照、算法版本、候选集合和预测，随后只用新发生且匹配的观测检验。不能用新数据改写旧预测后再说预测准确。

- 概率预测：使用 Brier loss `mean((p-y)^2)`，并显示分组校准。模型自称“高置信”不能替代校准。
- 区间预测：同时记录实际覆盖率和区间宽度；可用区间分数 `U-L + 2/α·(L-y)·1[y<L] + 2/α·(y-U)·1[y>U]`，不能靠无限加宽区间取得好看的覆盖率。[Gneiting & Raftery，第 3、6 节](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf)
- 未来费用区间必须包含未来个体或周期波动，不只包含均值估计误差；均值置信区间不能冒充未来付款范围。[NIST，预测区间](https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd512.htm)
- 用户采纳推荐后结果改变只能记录为跟踪观察；用户是否采纳、熟练度、任务变化和价格活动都会影响结果，不能归因成产品带来的全部收益。
- 报告稳定性：检查移除单一来源、变化时间窗、改用来源平衡权重后方向是否改变；不同设定不是反复试到喜欢的结果，而是预先固定的敏感性报告。

## 10. 向用户提供更多有用反馈的组织方式

每一条反馈由确定性模板生成，包含“观察事实 → 对应范围 → 影响解释 → 可采取的下一步”。不要为凑数量生成无证据建议。

1. **本次工作**：目标、验收、在制任务、工作类型和量纲明确的完成量。
2. **费用构成**：状态费用、未分配费用、整理开销、模型/外部资源费用覆盖；区分实付和估算。
3. **过程负担**：重试、返工、人工介入、工具失败、需求变化、上下文重置和子代理范围。
4. **时间体验**：排队、首字等待、输出速度、整体时长、用户等待，逐项覆盖。
5. **数据完整性**：有多少任务缺费用、Token、验收或时间；哪些结论因此不能计算。
6. **同条件参照**：配置中位数、四分位与本人位置，公开来源范围和观察时间；不是用户能力排名。
7. **匹配范围**：数据库覆盖了本人哪几类工作、多少比例，哪些类型没有足够参照。
8. **模型/Harness 候选**：按该类目标的历史单位验收成本选择，显示选择依据和不确定性。
9. **套餐与额度**：完整账期支出、赠送/折扣、重置、容量变化，未知或多义变化明确标注。
10. **连续观察**：至少一周、最好一个月有助于看到波动，但时间长不自动提升证据等级；保持周/月任务构成一致时才解释趋势。

可自动给出的行动提示应针对可确认的记录，例如“本次时间测量只覆盖 8/20 个目标，开启对应采集器后可比较等待情况”，而不是“你应减少代理数量”或“这个模型导致返工”。

## 11. 落地顺序与性能约束

**当前优先**：扩展可选摘要字段；实现私人 `analytics` 的描述层；全指标覆盖、任务状态和费用分解、匹配覆盖、推荐选择依据；网页、桌面、CLI 共用数据契约。难度仍不默认启动，不将新字段加入既有排名权重。

**下一阶段**：事实 Worker 增量写入来源簇统计，按参考快照/算法版本/条件生成缓存；来源敏感性、任务构成标准化、候选筛选验证。请求处理只读取合格聚合，不扫描全库正文。

**后续研究**：簇区间、层级模型、预测回测、复杂套餐优化、连续统计告警。每项单独验证后开放，不能因为已有公式就标为完成。

统计计算使用固定预算、单次事件触发、合并更新、版本化缓存和现有 Worker；无常驻高频轮询。99/999 次重采样是模拟次数，不是新用户任务或模型请求，不能计为有效样本。保留完整原记录和历史价格，重算新报告时写新算法版本，不改旧报告的事实含义。

最低验证集应覆盖：全零/零验收、全缺失、同源大量任务、未闭合任务、部分代理树、不同计费口径、任务构成反转、任一来源零验收、全部成本未分配、重复上传、UI 分组截断和候选数差异。只运行与新增算法相关的检查；不需要为研究文档重复运行全项目测试。
