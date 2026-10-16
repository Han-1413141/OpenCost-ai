# 写作、翻译、设计、媒体、教育与人文任务的难度研究依据

检索日期：2026-10-12（Asia/Shanghai）。本分支整理 25 条原始论文、原始报告、官方规范或作者项目资料。对应的机器可读记录在 [difficulty-humanities.json](difficulty-humanities.json)。这是为了设计字段而做的资料映射，尚未在 OpenCost 的真实任务上标定难度等级；生产难度评分继续关闭。

采用 `subject × workType × context`：学科主题、执行活动和工作/教育/个人场景分别记录。同一翻译活动可以处理医学、文学或工程材料，同一学科也可以涉及检索、解释、创作、编码、核验等不同活动。新增学科标签不会自动提高难度，也不为每个学科复制一套相同规则。

## 直接回答：确实存在难度和测量研究

翻译已有直接研究难度测量的实证论文。Sun 与 Shreve 使用人类译者的工作负荷测量，发现可读性只解释部分翻译难度，译文质量分不能可靠表示难度，耗时也仅弱相关。因此，任务要求、成果质量和实际消耗必须分别保留；本文没有提供可直接用于 AI 的通用权重。[原始出版社摘要](https://benjamins.com/catalog/target.26.1.04sun)

图像生成也有可控难度研究。ConceptMix 预先选择对象与若干视觉概念，控制组合条件，再逐项检查要求；其意义是“事先定义可验收条件”，不能将概念数量直接换算成所有设计活动的统一等级。该研究的构题和评审依赖模型，OpenCost 的日常统计没有必要复制模型调用。[原始论文](https://arxiv.org/abs/2408.14339v1)

教育研究中，Bloom 修订分类采用知识维度与认知过程维度，而且明确允许类别重叠：某些解释活动可以比某些执行活动更复杂。Webb 强调具体任务中的概念连接、迁移、多表征与推理要求。不能只看到“分析”“创造”动词就填高难度。[Bloom 原始论文](https://www.upgrade.chemnet.edu.au/sites/default/files/files/Blooms_taxonomy_2002_Krathwohl.pdf)、[Webb 原始报告](https://files.eric.ed.gov/fulltext/ED414305.pdf)

项目反应理论（IRT）可把能力与项目参数分开，但依赖模型假设、合适数据和拟合检查。它为后续真实标定提供方法方向；不支持把一次完成率或单个模型的失败率直接称为客观难度。[NCME 原始方法论文](https://ncme.org/wp-content/uploads/2025/10/Module-16-Comparison-of-CTT-and-IRT-Hambleton-J-1.pdf)

## 各领域的可登记要求

| 分支 | 现有活动覆盖 | 应从原要求或已有材料登记的条件 | 必须分开的信息 |
| --- | --- | --- | --- |
| 写作与编辑 | 提纲、起草、说明、论证、叙事、改写、语句编辑、校对、摘要、技术/学术/宣传写作、文档一致性 | 受众与体裁；材料使用；论证/叙事结构；原意、作者风格和事实保留；格式/篇幅约束；跨页与跨文档引用一致性 | 字符数属于工作量；修改轮数和模型输出长度属于执行；质量评价不替代难度 |
| 翻译与本地化 | 通用、专业、文学、创译、术语、审校、字幕、软件本地化、口译准备 | 语言方向；术语/风格规范；文化和受众适配；源文歧义或残缺；长度/界面/字幕时序限制；不同条件是否必须共同保持 | 译文质量、错误严重度、译者负荷、耗时分别记录；实时口译尚未纳入已验证覆盖 |
| 设计 | 要求分析、品牌、版式、插画、演示、信息图、界面、交互、原型、设计系统、无障碍、资产、服务、空间 | 必须出现的对象/属性/关系；内容层次；交互状态；适配要求；使用情境；用户验收；无障碍义务；不同部分的整合 | 美观、创新性、可用性分别验收；候选稿和导出副本不增加最终成果；符合性等级不等于难度 |
| 媒体 | 脚本分镜、转写、剪辑、音频、调色、合成、动画、字幕、编码、生成、修复、音乐 | 必需模态；说话人/声音场景；跨时段事件关系；时间对齐；主体/运动/空间一致性；技术交付条件；人工观看或听音协议 | 媒体秒数属于材料规模/最终成果；感知质量和理解正确性分开；生成、理解、制作不能混成同一种活动 |
| 教育 | 课程、材料、讲解、辅导、习题、批改、适配、学习计划、成效评价、评价工具 | 知识类型和认知操作集合；先修知识；迁移情境；表示转换；步骤与解释义务；学习者条件；评分证据 | 教学材料完成与学习有效分开；题目通过率依赖答题者；Bloom 和 DOK 不能直接当 AI 等级 |
| 人文与定性研究 | 人文论述、文本分析、主题编码、结果解释、问卷、事实核对、证据综合 | 来源与版本关系；异文与残缺；分析单位；解释与原文对应；事前框架；竞争解释/反例；研究问题与材料边界 | 出现频率不等于主题重要性；编码量不等于解释质量；规范完整不证明解释唯一正确 |

表中条件是根据研究和规范提出的设计建议，不是文献已经验证的 OpenCost 因果模型、难度权重或等级阈值。

写作的规划、表达和审阅可以交互进行；字符长度并不能完整描述这些操作。职业编辑规范进一步区分结构编辑、风格编辑、文字编辑及校对，支持把“润色”拆成具体活动。[Flower 与 Hayes 原始论文](https://publicationsncte.org/content/journals/10.58680/ccc198115885)、[Editors Canada 官方规范](https://editors.ca/publications/professional-editorial-standards/fundamentals-editing/)

WritingBench 提供跨主题与活动的写作目录和具体要求，EssayBench 补充中文体裁与开放/约束条件。两者是写作评价研究，本文只把它们用于目录与验收条件设计，没有照搬模型评分为任务难度。[WritingBench 论文正文](https://arxiv.org/html/2503.05244v4)、[EssayBench 摘要](https://arxiv.org/abs/2506.02596v1)

MQM 的术语、准确性、风格、受众适配和设计/标记目录可用来登记翻译义务；MQM 自身评价成果质量。XMI 则说明翻译方向与目标语言生成条件影响比较，但它需要模型概率，不能作为无需模型调用的默认统计算法。[MQM 官方目录](https://www.themqm.org/mqm-pillars/typology/)、[XMI 原始 ACL 论文摘要](https://aclanthology.org/2020.acl-main.149/)

Dorst 与 Cross 的原始设计研究展示了问题与方案共同演进和多方面整合。ISO 9241-210 提供人本设计范围，WCAG 提供可核验的具体无障碍义务；这些过程规范不把设计工作划成 AI 难度等级。[设计原始论文](https://doi.org/10.1016/S0142-694X(01)00009-6)、[ISO 官方范围](https://www.iso.org/standard/77520.html)、[WCAG 2.2](https://www.w3.org/TR/2024/REC-WCAG22-20241212/)

AudioBench 区分语音内容、声音场景和副语言理解；Video-MME 分别处理视频时长、多模态输入和内容类别。它们支持补上“理解”活动与模态条件，不能证明片段长就必然难。[AudioBench 摘要](https://arxiv.org/abs/2406.16020v5)、[Video-MME 摘要](https://arxiv.org/abs/2405.21075v3)

VBench 支持将视频一致性分项检查，ITU-T 的 P.800/P.910 用于主观传输或视频质量评价。质量测试的任务义务可以登记，测试结果仍保留在质量指标。[VBench 作者项目](https://vchitect.github.io/VBench-project/)、[P.800 官方版本](https://www.itu.int/rec/T-REC-P.800-199608-I/en)、[P.910 官方版本](https://www.itu.int/rec/T-REC-P.910-202607-P/en)

TEI 将异文、见证来源、解释跨度和确定程度分开表示；定性主题分析区分语义描述、潜在解释和理论立场。COREQ 只针对访谈与焦点小组的报告，不能当全部人文方法的通用评价。[TEI 校勘规范](https://www.tei-c.org/Vault/P5/current/doc/tei-p5-doc/en/html/TC.html)、[TEI 分析规范](https://www.tei-c.org/Vault/P5/current/doc/tei-p5-doc/en/html/AI.html)、[Braun 与 Clarke 原始论文](https://doi.org/10.1191/1478088706qp063oa)、[COREQ 原始摘要](https://pubmed.ncbi.nlm.nih.gov/17872937/)

## 真正缺失的活动，以及适合做成条件的差异

建议在现有领域下补四种活动或方法，而不是按每个学科新建领域：

1. `media.audio_understanding`：现有清理/混音不能完整表达声音内容、场景及副语言理解。
2. `media.video_understanding`：现有剪辑/转写/字幕不能完整表达跨时段推理、事件次序和视觉证据定位。
3. `research.textual_criticism`：版本校勘、见证关系和异文核对是明确操作，不只是“人文”主题。
4. `research.interpretive_analysis`：解释跨度、理论框架和竞争解释可作为 `research.qualitative` 的方法条件，是否新增活动由任务边界决定。

文学体裁、历史/宗教/哲学/艺术史主题、学校学科和职场场景应放入正交的主题/条件目录。音乐创作、3D 空间、实时口译等仍需专项来源，不能因为存在宽泛标签就宣布覆盖完成。

## 程序计算的边界

建议程序先处理无需模型的新信息：枚举合法性、已知与未知项、要求覆盖、去重数量、组成依赖、必需整合、验收守恒、费用与 Token 归集。领域的要求描述保留为向量，不能把不同单位、认知类别或未经标定的序号相加成“难度总分”。

同一个十页设计任务可以包含不同数量的必须保持关系、交互状态或无障碍条件。工作量仍是十个独立最终页面，条件向量反映要求差异；不依据生成结果中出现的复杂效果抬高原任务。

后续验证必须使用要求冻结的真实任务、多种模型/Harness、专业独立标注、同类锚题和保留数据。需要检查同一要求在更换执行方法、加入无关提示、增加重试或改变子代理数量之后不变。单次评审一致不能替代实际准确率。

所有原文、参与者、客户、馆藏位置、语言材料、任务名称和可识别案例留在本地。公开信息只考虑版本化活动枚举、经过用户预览的条件类别、数量与证据覆盖状态。细分类组合也可能暴露特殊任务，稀有类别应回退到上级或 unknown，保留本地细节而非追求公开枚举无条件无限细分。

## 实际阅读范围与尚未覆盖

本次没有将“打开论文页面”写成“读过全文”：JSON 的 `readScope` 逐条注明摘要、官方范围或原始全文中的具体章节。ISO 9241-210 正文、P.910 (07/2026) 预发布正文和部分出版社全文受限；没有从未读取的正文提取参数。

还有未完成的专项覆盖：实时口译，音乐创作/表演与谱面，3D/CAD 和空间设计，声音/视频修复与编码制作，以及各个人文学科的专业验证。学科扩展目录可以广，但上述来源尚未证明所有细分活动具有可互换难度等级。这些缺口已存入 JSON 的 `coverageGaps`。

## 资料索引

- `humanities-writing-flower-hayes-1981`：1981，[A Cognitive Process Theory of Writing](https://publicationsncte.org/content/journals/10.58680/ccc198115885)。阅读范围：original_full_text_selected_sections: process model, planning, audience, reviewing; publisher metadata。
- `humanities-writing-hayes-2012`：2012，[Modeling and Remodeling Writing](https://journals.sagepub.com/doi/10.1177/0741088312451260)。阅读范围：publisher_abstract_and_metadata_only。
- `humanities-writing-editorial-2024`：2024，[Professional Editorial Standards 2024 — Fundamentals of Editing and Proofreading](https://editors.ca/publications/professional-editorial-standards/)。阅读范围：official_full_web_sections: fundamentals A1–A4, proofreading E1–E2。
- `humanities-writing-writingbench-2025`：2025，[WritingBench: A Comprehensive Benchmark for Generative Writing](https://arxiv.org/abs/2503.05244v4)。阅读范围：abstract_and_full_text_selected_sections: 1, 3.1, 3.2。
- `humanities-writing-essaybench-2025`：2025，[EssayBench: Evaluating Large Language Models in Multi-Genre Chinese Essay Writing](https://arxiv.org/abs/2506.02596v1)。阅读范围：abstract_and_metadata_only。
- `humanities-translation-sun-shreve-2014`：2014，[Measuring translation difficulty: An empirical study](https://benjamins.com/catalog/target.26.1.04sun)。阅读范围：publisher_abstract_and_article_outline_only。
- `humanities-translation-xmi-2020`：2020，[It’s Easier to Translate out of English than into it: Measuring Neural Translation Difficulty by Cross-Mutual Information](https://aclanthology.org/2020.acl-main.149/)。阅读范围：official_conference_abstract_and_metadata_only。
- `humanities-translation-mqm`：版本日期未明确，[MQM Error Typology and MQM Terminology](https://www.themqm.org/mqm-pillars/typology/)。阅读范围：official_full_web_typology_and_terminology_sections。
- `humanities-design-dorst-cross-2001`：2001，[Creativity in the design process: co-evolution of problem–solution](https://doi.org/10.1016/S0142-694X(01)00009-6)。阅读范围：original_full_text_selected_sections: protocol, design brief, co-evolution and quality vs creativity。
- `humanities-design-iso-9241-210-2019`：2019，[ISO 9241-210:2019 — Human-centred design for interactive systems](https://www.iso.org/standard/77520.html)。阅读范围：official_scope_abstract_and_current_status_only。
- `humanities-design-wcag-2.2`：2024，[Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/2024/REC-WCAG22-20241212/)。阅读范围：official_full_web_selected_sections: introduction, success criteria, conformance。
- `humanities-design-t2i-compbench-2023`：2023，[T2I-CompBench: A Comprehensive Benchmark for Open-world Compositional Text-to-image Generation](https://arxiv.org/abs/2307.06350v1)。阅读范围：abstract_and_metadata_only。
- `humanities-design-conceptmix-2024`：2024，[ConceptMix: A Compositional Image Generation Benchmark with Controllable Difficulty](https://arxiv.org/abs/2408.14339v1)。阅读范围：abstract_and_full_text_selected_sections: overview and benchmark construction。
- `humanities-media-audiobench-2024`：2024，[AudioBench: A Universal Benchmark for Audio Large Language Models](https://arxiv.org/abs/2406.16020v5)。阅读范围：abstract_and_metadata_only。
- `humanities-media-videomme-2024`：2024，[Video-MME: The First-Ever Comprehensive Evaluation Benchmark of Multi-modal LLMs in Video Analysis](https://arxiv.org/abs/2405.21075v3)。阅读范围：abstract_and_metadata_only。
- `humanities-media-vbench-2024`：2024，[VBench: Comprehensive Benchmark Suite for Video Generative Models](https://vchitect.github.io/VBench-project/)。阅读范围：author_project_abstract_and_dimension_overview; publisher PDF blocked。
- `humanities-media-itu-p800-1996`：1996，[ITU-T P.800 — Methods for subjective determination of transmission quality](https://www.itu.int/rec/T-REC-P.800-199608-I/en)。阅读范围：official_full_text_selected_sections: scope and test design headings; current catalogue status。
- `humanities-media-itu-p910-2026`：2026，[ITU-T P.910 — Subjective video quality assessment methods for multimedia applications](https://www.itu.int/rec/T-REC-P.910-202607-P/en)。阅读范围：official_catalogue_and_summary_only; prepublished full text restricted。
- `humanities-education-krathwohl-2002`：2002，[A Revision of Bloom’s Taxonomy: An Overview](https://doi.org/10.1207/s15430421tip4104_2)。阅读范围：original_full_text_selected_sections: knowledge and cognitive-process dimensions, relaxed hierarchy。
- `humanities-education-webb-1997`：1997，[Criteria for Alignment of Expectations and Assessments in Mathematics and Science Education. Research Monograph No. 6](https://eric.ed.gov/?id=ED414305)。阅读范围：original_full_text_selected_sections: depth of knowledge consistency, pp. 15–17。
- `humanities-education-hambleton-jones-1993`：1993，[Comparison of Classical Test Theory and Item Response Theory and Their Applications to Test Development](https://doi.org/10.1111/j.1745-3992.1993.tb00543.x)。阅读范围：NCME-hosted_original_full_text_selected_sections: item parameters, assumptions, calibration and fit。
- `humanities-tei-critical-apparatus-2026`：2026，[TEI P5 Guidelines 4.12.0 — Critical Apparatus](https://www.tei-c.org/Vault/P5/current/doc/tei-p5-doc/en/html/TC.html)。阅读范围：official_full_web_selected_sections: readings, witnesses, witness references, fragmentary witnesses。
- `humanities-tei-analysis-2026`：2026，[TEI P5 Guidelines 4.12.0 — Simple Analytic Mechanisms](https://www.tei-c.org/Vault/P5/current/doc/tei-p5-doc/en/html/AI.html)。阅读范围：official_full_web_selected_sections: spans and interpretations, responsibility and certainty, linguistic annotation。
- `humanities-braun-clarke-2006`：2006，[Using thematic analysis in psychology](https://doi.org/10.1191/1478088706qp063oa)。阅读范围：original_full_text_selected_sections: semantic/latent analysis, questions, six phases and importance vs frequency。
- `humanities-coreq-2007`：2007，[Consolidated criteria for reporting qualitative research (COREQ): a 32-item checklist for interviews and focus groups](https://pubmed.ncbi.nlm.nih.gov/17872937/?format=pubmed)。阅读范围：original_abstract_via_NLM_and_official_guideline_registry_scope。

