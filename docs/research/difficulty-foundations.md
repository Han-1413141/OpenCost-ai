# 难度与工作量的测量基础

检索日期：2026-10-12（Asia/Shanghai）。本文件研究测量理论，不是 OpenCost 的校准结果。难度采集、上传及评分继续默认关闭，阈值和总分保持为空。机器可读来源、检索词、实际读取范围及限制见 [difficulty-foundations.json](difficulty-foundations.json)。

共核对 14 条原始论文、作者发布文本及官方材料。其中有完整正文的选定段落、短方法正文、摘要以及书籍封面目录。只读摘要或目录的条目不扩展为全文方法；正文没有读到的来源不用于证明具体规则。

## 权威直接分级研究

[OECD 2025 能力指标第 2 章](https://www.oecd.org/en/publications/introducing-the-oecd-ai-capability-indicators_be745f04-en/full-report/component-5.html)提供九项能力、各五级的官方专家框架，可参考分级设计。其总体能力前沿等级不能直接赋给 OpenCost 的单次工作；已在来源 JSON 保存范围与限制。

[OECD 2022 分类框架](https://www.oecd.org/en/publications/oecd-framework-for-the-classification-of-ai-systems_cb6d9eca-en.html)分类政策情境中的 AI 系统，五个维度与难度五级是不同对象。

## 应分开记录的四种对象

任务要求画像描述原始要求必须成立的条件；完成量描述实际交付的数量；主观工作负荷描述执行者体验；经验难度是在固定实验框架下估计的题目参数。它们不能互换。Wood 的必要行为定义排除了因执行者技能及资源改变的耗时和努力，并把组成、协调及动态复杂度分开。[Wood，1986](https://www.researchgate.net/publication/222383252_Task_complexity_Definition_of_the_construct)

例如，清洗一百万条同规则记录有较大处理规模，但不能仅凭记录数判定推理要求高；单条不明确实体匹配可能包含更多需要同时协调的条件。这个例子是项目应用推论，需要按领域核对条件，不能直接据此给难度等级。

认知负荷也不是独立于执行者的绝对难度。Sweller 等人的正文明确区分必要信息关系、呈现方式及已有知识；专业程度会改变要素交互和方法效果。将这一人类学习理论用于 AI，只能作为结构设计参考。[Sweller 等，2019](https://link.springer.com/article/10.1007/s10648-019-09465-5)

## 可采用的分类，不能直接采用的分数

Bloom 修订版可帮助描述知识对象和认知过程。原论文允许类别重叠，因此不能把“记忆到创造”编号当成等距难度，单个动词也不能代替具体条件。[Krathwohl，2002](https://dl.icdst.org/pdfs/files3/10b8768d0d2206d85af6938ade606a3c.pdf)

SOLO 原书的对象是观察到的学习结果及质量。本轮仅读到封面与目录，不复述未读正文的各档定义，也不把它当成已经标定的事前任务难度。[Biggs 与 Collis，1982](https://pdfs.semanticscholar.org/238b/3817e92cd5a7e442f9c7bc5eb07e5efab1a5.pdf)

NASA-TLX 的六维包含表现、努力和挫败，是操作者主观工作负荷工具。将来如使用，应由人自愿填写，单列体验；模型不能代填并将结果写成固有难度或完成量。[NASA 官方 TLX](https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/)

## 程序现在能可靠计算什么

1. 保留稳定根目标以及原始组成部分；分别计算各状态目标数、已完成部分、已验收部分和整合验收。
2. 按单位保存计划量、去重完成量及验收量；不同单位不相加。覆盖不足时提供已知小计，将总量留空。
3. 对将来可选的结构记录，检查自环、重复边及不存在的部分；区分有向依赖、共享状态组与反馈。可算强连通分量、最大反馈组以及凝聚图深度，但不自动换成难度分。
4. 保留 Token、费用、调用、对话轮次、代理及后代代理的执行消耗；这些不改变事前要求描述。

第 3 点由项目依据 DSM 表示方法提出，具体指标仍需验证。DSM 文献强调拆分与整合关系，并区分静态结构和时序活动依赖；它本身没有发布通用难度量尺。[Browning，2001](https://www.researchgate.net/publication/3076682_Applying_the_design_structure_matrix_to_system_decomposition_and_integration_problems_a_review_and_new_directions)

## 将来怎样校准经验难度

Rasch 的参数分离和“特定客观性”限于规定的参考框架。[Rasch，1977](https://www.rasch.org/memo18.htm) 二值模型可写为 `P(通过)=exp(能力−题目难度)/(1+exp(能力−题目难度))`，公式不表示任何任务都已经符合其条件。[Wright 与 Linacre，1987](https://www.rasch.org/rmt/rmt11a.htm)

项目可执行的研究方案是：先冻结某领域、子类型及验收标准；为多个模型与 Harness 配置安排共同任务；独立核验反应；按任务家族和来源保留检验集；检查模型适配、参数不确定性、不同配置条件的影响及跨组可比性。没有共同任务或连接设计的任务集合不能硬拼。配置参数也不能解释为裸模型的固有能力。这是将来单独的标定实验，不能从用户日志的一次失败回填当前难度。

相同名称不证明相同量尺；测量不变性需要另外论证。[Meredith，1993，出版社摘要](https://link.springer.com/article/10.1007/BF02294825) 官方测试标准要求针对用途和人群说明效度，并为等值、模型适配和分数连接提供证据。[AERA、APA 与 NCME，2014，已核对 1.0/1.1 及 5.16–5.20 等条款](https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf)

启用前还应检查：打乱费用及执行结果不改变要求画像；换用复杂方法不提高原要求档次；重复导出、重试、代理拆分不增加最终成果量；未知和冲突不能默认填最低档。以上是项目拟实施的防偏差条件，尚未形成真实校准等级。旧记录、原环境入口和默认授权边界均不因这份研究改变。
