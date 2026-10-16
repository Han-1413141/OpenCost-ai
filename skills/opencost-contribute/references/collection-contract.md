# 采集与评价约定

本文件配合 OpenCost-AI 1.1 协议。完整 JSON 字段由 CLI init/schema 生成，不手工维护另一套字段名。

## 采集时间与范围

先执行 [首次说明](first-use.md)，取得时间范围、增量及自动运行选择。推荐近 3 天，历史最多近 90 天。增量起点是上次成功上传的采集终点；间隔超过 3 天重新选择，不自动扩展历史。上传必须包含固定的 collectionWindow、时区和批次份数，起点包含、终点不含。API 核对结构与范围上限，不声称已读取原始日志证明时间归属。

原始来源在本地先按时间筛选；跨界日志只读取授权区间内的相关条目。无法区分跨界费用或缺失前期任务记录时保留 partial，不能未经选择扩大读取范围，也不能将本次截面标作 lifecycle_complete。处理时新产生的日志留给下次增量。订阅费用不能随每个窗口重复记账，跨窗口任务沿用稳定 UUID。一次范围拆成多份时共享批次 ID 并完整登记 total，全部回执成功才推进位置。

## 分类与任务边界

可选的 task.requirementClassification 只来自现成原要求或已批准变更，保存固定workType、subjects学科代码、useContext用途、basis和coverage。混合目标componentTypes是各细类的计划部分数，程序核对数量及原计划领域的可分配性。未知学科在比较中统一为未记录；不完整混合类型保留mixed，不冒充普通未知类型参与排名。分类来源仍为声明，不是独立验收证明。原文、题目和证据定位留本地，没有依据保持null，不为细分类增加扫描范围。

先确认独立验收目标，再选主要工作类型。调研、清理数据、画图、写报告若共同交付一份报告且共同验收，是一个根任务；parts 分别记录这些类型和计划数量。多个独立目标可以复用同一份输入材料；划分后执行、费用和最终成果不得重复记账。树的层级、代理数量和文件数不是任务数量。

当前 `evaluation.version='work-summary-1'`，只填写 requirements.parts 和 integration 等已有任务组成事实；没有可靠原始计划时 parts 为 null。历史 work-1 中的耦合、依赖和主观判断继续保存，但不要求当前采集补写，也不用于难度分组。

partsCompleted 是产出完成的计划部分数，partsAccepted 是通过该部分验收标准的部分数。根目标只在所有必需条件通过时 accepted；九个部分通过、最后一项整合失败仍不算一项完整成功。跨账期缺少前期成本时 costScope 不能是 lifecycle_complete。
已有结构化事实时按 [工作量与任务组成](work-measurement.md) 使用可选 workItems/workGraphs。workStructure 将全部部分数与必需部分数分别记录；根目标只要求必需部分及必需整合通过，可选部分未完成不阻止验收。原图仅在本地，上传固定类型与结构汇总，不是难度采集。

## 当前完成量与关闭的难度分级

completedWork 逐条记录 kind、workType、unit、planned、completed、accepted、source、acceptance 和 coverage。类别来自封闭目录；单位必须为该领域允许的单位。可以只使用主要 kind，细分类未知时 workType 为 unknown。没有测量记录时整个 completedWork 为 null；检查后没有成果时可为 []。

completed 来自实际成果或执行记录，accepted 仅指已通过对应验收的数量，不得超过 completed。未知量为 null；来源或覆盖未知时不能填写确切完成量。部分日志只能声明 partial；人工报告保留 human_report，不自动升级为独立证明。媒体秒数可有小数，其他工作量为整数。原定数量和完成数量可以不同，追加需求的依据留在本地，不能为凑数改写计划。

不同单位分别汇总。同一最终内容的改写过程、重复导出、父子代理重复记录要先在本地去重。混合任务可以列多种成果，但根任务的成功计数不增加；失败、返工和未验收工作的费用仍保留。部分完成时不按比例推测各类完成量。公开接口不发布个人细分清单。

难度采集、评分、分级、筛选和排名分层全部关闭。当前模板不包含 reasoning、knowledge、novelty、clarity、confidence 或 future requiredMethods，不要求 AI 填这些字段。分领域草案由 `/api/difficulty-framework` 和开发文档保存，日常整理不需要读取草案。历史原始评价不删除；修改旧难度标签不能影响当前完成量、费用或分组。

材料份数、字符/行/单元格/像素/时长等按既有 data-standard 的单位和区间记录。实际输出长度、Token、调用数不作价值或难度奖励。

预览的 evaluation.summary 返回根任务状态、分单位完成量与覆盖、Token、轮次和代理数量。total 为完整总量，knownSubtotal 只是已有观测小计，measured/expected 说明缺项；不把 null 显示成零。缓存量已包含在输入 Token，思考量已包含在输出 Token。最大深度和每任务最大并行数不求和。

## 事件与递归代理

本地 agents 保留真实树，根 parentId=null；一个目标可以由多个真实根会话共同完成，同一代理也可以顺序参与多个目标。此时用 taskIds 明确参与映射，祖先保留后代参与范围；每条事件、费用和资源仍只归属一个根目标，不能复制分摊。代理 ID、parentId 和参与映射只存在本地；输出仅保留 executionScope 的全局去重数、每目标参与数、最大深度和公开 Harness 列表。完整树不等于完整事件，两者单独声明。缺父代理且范围为 partial 时保留可取得的记录与未知总量，不制造虚拟父代理。

| 事件                               | 计数边界                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| user_turn                          | 一条真人主动发送的请求；不含系统消息、工具回包、代理之间消息                     |
| assistant_turn                     | 一次面向其交互对象的完整助手回复；流式片段去重，不按 token 或工具回包数计        |
| model_call                         | 一次实际计量的模型请求；失败请求若发生计费也保留；同一请求在多处日志出现只计一次 |
| tool_call / tool_failure           | 一次工具执行及其中失败的执行；失败是调用的子集                                   |
| context_reset / context_compaction | 真实发生的上下文重建或压缩，不从 Token 突降猜测                                  |
| human_intervention                 | 一次实际人工接管、修正或操作，不等同所有用户消息                                 |
| requirement_change                 | 原验收要求发生实质变化，不能一律归因模型理解错误                                 |

coverage.events 逐类提供 complete/partial/unknown；单一供应商账单通常只能证明模型调用范围，不能把其余事件补零。maxParallelAgents 必须来自重叠活动区间，不能用代理总数替代。modelSwitches/harnessSwitches 需要真实路由序列，未知为 null。

resources 记录实际 CPU/GPU 秒、内存 GiB 小时、存储 GiB 天、网络字节、搜索与外部 API 请求、图像数量和媒体秒数。资源消耗与实际付费分开；免费或自有资源的用量不自动折算成付款。代理树未覆盖时这些汇总同样不能声明完整。

本地 resources 数组的每条事实包含 id、agentId（非代理资源可为 null）、根 taskId、direct/aggregate 与完整 usage 字段。只将互不重叠的直接增量设为 direct，父进程或平台的累计展示设为 aggregate。共享资源先按有记录的分配依据归属，不能给每个任务各记整台机器的消耗。coverage.resources 逐项声明完整性；程序汇总全部后代并去重，不完整或含未知用量时该项为 null。

## 费用与历史信息

charges 的稳定 ID 使用供应商/账单体系中的唯一事实加本地来源命名空间，同一事实不能因出现在不同代理中生成新 ID。direct 是本层发生的新增费用；aggregate 是已经含后代的累计展示值，旧采集只用它供对账，不再次累加。工具和计算节点没有 agentId 时可为 null；任务归属未知时 taskId 为 null，不能猜测。

同一净实付中的 model、harness、tool、compute、storage、network、other 各占一份；套餐含内置模型费用时不能再把 API 等价金额加到实付。完整账本合计必须等于 paidMinor-refundMinor。退款、抵扣和共享套餐的原始对应留在 manifest；原始账单内容不上传。

独有费用与共享费用同时存在时，可在 `init` 中显式选择 `--itemized-costs`，生成 `period.allocation=itemized` 和部分、空的 `costAttribution`。默认不选择，不修改历史。填写本地 `charges`：独有费用沿用 taskId；共享费用的 taskId、agentId 为 null，另填 `allocation={method:equal|tokens,taskIds:[明确的目标UUID],unassignedWeight:非负整数}`。未知归属不得猜测目标或自动均摊，退款已包含在净金额中。

编译器只从 direct 费用生成新归属，排除 aggregate，合并相同规则并生成脱敏 UUID；完整本地费用须对齐净实付及每项目标，已知零费用显式登记。已有逐项归属与本地事实逐组核对，部分采集保留已有金额；不把全额对齐当作每项目标归属正确。程序检查金额、引用与结构，不证明账单真实或父子经济事件没有重复。字段定义、500 行及 5000 引用上限见工具包 `docs/data-standard.md` 的“逐项费用归属”。

以上是旧采集规则。有明确账单包含依据时，可以另外选择 `init --charge-coverage`，按工具包 `docs/charge-reconciliation.md` 填写本地 `chargeCoverage`。只处理同一费用覆盖期、币种和净额；不能把代理树当成费用包含图，也不能将付款日期当成覆盖期。父级累计数与后代不能一起相加，未知金额填 null；父金额减未知子范围下界不能直接归属父自身或套用父的差额分摊规则。整组归属与差额归属分开填写。

`reconcile-charges` 可保存冲突诊断；`capture` 在冲突时不生成上传文件。新上传只保留固定数值摘要和原有费用归属，不保留原费用 ID、关系边、账户、原文或自由文本。旧归属可以与新图部分明细同时保留，本次尚未映射金额不否定另有依据的旧金额，也不能表示本次归属已核对完整。没有包含依据时继续原流程，不编造关系。模板、诊断不授予额外读取或上传权限。

period.billingBenefits 保留账单提供的标价等价额、折扣实减、已用抵扣、获赠及剩余额度、已含税费/平台费、赠额到期时间和公开活动快照。全部使用账期原币。已含税费是实付的组成，不再加一次；赠额余额不视为已花费成本；宣传但未到账的赠额不填入 creditGrantedMinor。没有测量或账单依据为 null。

costCoverage=total_execution 仅表示本次声明覆盖全部付费执行项，model_only 和 unknown 分组保存；C1 不验证这个声明。agentCoverage、costScope 不完整的整期保留个人记录，不进入公开成本排名。失败、放弃、正在进行和没有归属的费用不得丢掉。

价格快照保留公开来源代号、币种、实际抓取时间、已知生效时间、单价和快照版本；没有公开生效时间为 null。priceHistory 保留任务跨越的多个价格版本。抓取时间不是公告生效时间，也不是用户实际享受优惠的证明。历史汇率与价格仅用于相应时点的等价金额；网站显示货币转换不改写原币记录。

## 脱敏与准入

不提供任务标题、总结正文、源码、提示词、路径、业务对象名称、代理名称或真实账单 ID 字段。UUID 为本地映射，来源摘要包含不上传的随机 salt。公开产品标识必须核对其公开身份，不能把内部别名伪装成产品 ID。预览检查处理字段之外的语义泄露；字段白名单和哈希不能证明无法重新识别。

历史 1.0 可读，新上传要求 1.1。私有记录保留实际字段；公开接口仅发布达到 20 项、5 个来源、单来源不超过 35% 的固定组。对话与资源等可选指标各自满足发布门槛才公开，不把只有一个人的观测藏在大组里发布。原始数据不足不能用模拟数据补榜。

## 任务是否结束

成果状态 `status` 和执行阶段 `progress` 分开填写。`progress={phase,reason,basis}` 仅使用 schema 中枚举，不加入说明原文。phase 区分 running、paused、waiting_user、waiting_external、blocked、awaiting_acceptance、ended、unknown；reason 区分 none、model_limit、tool_failure、environment、resource_limit、user_cancelled、requirement_changed、unknown。

仍在执行、暂停、等待、阻塞或待验收时，status 使用 in_progress 或 partial；明确最终失败才使用 failed，明确放弃才用 abandoned。partial 只有 progress.phase=ended 才表示“已经结束但只完成部分”。旧 partial 没有结束记录时保持未知，不擅自补齐历史。

会话退出、采集按日截断、记录省略、单次工具错误、检查失败和额度耗尽不能推断最终失败。failed 不能自动归因为模型做不到，model_limit 必须有明确说明。依据来自模型提取填 model_report，用户直接确认填 user_report，结构化终止事件或固定验收器才可填 harness_event/validator；来源字段本身不会提升核验等级。依据不明用 unknown。

仍在做与结束未知目标保留全部成本和 Token，整批不进入最终比较；不通过删除它们或改成失败来补齐完成率。


## 历史计量数量（price-metering-1）

有可核对的原始用量时，可生成 `Usage.cacheWriteTokens` 及 `priceMetering`。每段引用已保存的价格快照；跨币种还须引用已有、方向明确的历史 FX。分别保存普通输入、缓存读取、缓存写入、输出和收费推理的原始 Token 数量；普通输入不包含缓存，输出已包含推理。计价单位含百万 Token 时数量仍填 Token，不填百万。非 Token 数量使用费率指定的单位。

缺少的数量、费率、汇率不得由模型推测或补零。每段四个输入/缓存/输出桶明确且对账，收费推理和图片、请求、时长等适用费率有数量，才可声明完整；声明只覆盖这条模型用量。DSH 明确的零推理附加费规则不能推广到其他来源。数量和费率留给程序计算，不要求模型心算费用。

保留来源报告的 `apiEquivalentMinor`；程序另算历史等价金额。来源缺失、金额差异、覆盖不完整分别说明，不改写实际付款。原始价格段不得换成今天的价格，超过 128 段应缩小采集范围，不能删除超出的历史段。任何单次计量冲突都应先核对，不能合并成看似正确的总数。首次范围选择、预览确认、自动运行与上传开关沿用既有规则。
