# 用程序测量任务与代码复杂度

更新：2026-10-15。生产难度分级仍关闭。这些工具只做用户明确选择的本地研究，不自动扫描项目、不调用模型、不上传源码。Python现已接入固定Radon 6.0.1，完整规则和命令见 [Python测量](python-code-measurement.md)；下文JS/TS方法和旧结果不因此改变。网页与应用可主动导入两类数值报告，执行符合条件的前后比较，见 [代码报告面板](code-measurement-view.md)。

## 三种问题分别测量

1. **任务要求有多复杂**：已有 `assess-complexity` 从原要求和脱敏依赖图计算组成、依赖深度、循环与共享状态。一个需求拆成多份文件或多次尝试，不增加根目标数。没有原图时只报告摘要声明。
2. **代码结构有多复杂**：`measure-code` 在本地解析指定文件的 AST；`measure-code-set` 根据用户选择的文件清单，按语言合并函数、分支、嵌套、参数和调用结构。它们不运行代码。
3. **完成这个任务实际上有多难**：需要固定要求、验收条件、资源与多次独立结果。现有锚点校准研究保留；代码指标、模型自述和一次失败均不能直接代替经验难度。

新代码可能是任务结果。把结果中的代码复杂度用于事前任务分组，会产生结果泄漏；当前不把它并入成本排名。以后比较修改难度时，必须区分执行前与修改后代码，保留原要求及版本。代码变复杂不是工作量奖励。

2026-10-14 补充的 [Agent Psychometrics、diffmodel-esem、BRIDGE 等论文核对](research/coding-difficulty-20261014.md)进一步区分这些用途；模型与 Harness 的分解先检查交叉设计，不根据代码结构直接拆分能力。

## 成熟项目的借鉴与取舍

本轮读取官方文档、ESLint 规则源码和 Lizard 理论页，没有把工具告警等级直接转成任务难度。

| 项目或资料                                                                                                                                            | 借鉴内容                                                                 | 在 OpenCost 中的处理                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [ESLint complexity](https://eslint.org/docs/latest/rules/complexity) 与[规则源码](https://github.com/eslint/eslint/blob/main/lib/rules/complexity.js) | 函数分开统计；默认值、短路赋值、可选链也有分支；类初始化与静态块单独统计 | 对齐语法计数边界；不采用其默认告警阈值作为任务难度                     |
| [Sonar Cognitive Complexity](https://www.sonarsource.com/blog/cognitive-complexity-because-testability-understandability/)                            | 测试路径结构与阅读理解负担不是同一维度                                   | 嵌套深度单列；不声称实现了 Sonar 认知复杂度或可维护性分数              |
| [Radon](https://pypi.org/project/radon/6.0.1/)                                                                                            | Python AST 逐语法计数，各项指标分别呈现                                  | 固定6.0.1核心模块测量Python；不套用维护性指数或告警等级 |
| [Lizard](https://github.com/terryyin/lizard) 与[理论说明](https://github.com/terryyin/lizard/blob/master/theory.rst)                                  | 多语言支持、函数级指标及语言测量差异                                     | 保留语言和方法版本；当前未接入其多语言测量                             |
| [NIST SP 500-235](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf)                                                      | 控制流结构与路径测试的基础                                               | 作为圈复杂度概念来源；当前 AST 语法测量不是完整控制流图或测试覆盖证明  |

JS/TS方法按核对后的定义独立实现。Python适配包含未修改的Radon 6.0.1核心，保留MIT许可、PyPI分发校验和及逐文件摘要，直接调用对应数值方法；不采用其等级告警或维护性评分。解析器与本地方法分别记录版本，避免升级后无声改变口径。

## 本地命令

```powershell
# 默认关闭：不读取 input，不加载解析器
npm run contribute -- measure-code --out .local/code-disabled.json

# 用户选择单个 UTF-8 文件后，在本地分析
npm run contribute -- measure-code --enabled --language typescript --input selected.ts --out .local/code-result-001.json
```

支持 `javascript`、`typescript`、`jsx`、`tsx`。输出使用新文件，不覆盖历史。源码只交给内存解析器，输出不带文件名、路径、函数名、字符串、源码或源码哈希。工具包中解析器是可选依赖，缺少它时不能运行代码测量，普通贡献流程不加载它。

当前复用 Vite 已安装的 Rolldown/Oxc AST 解析能力，不启动编译器服务、不加载项目配置、不解析导入文件。输入为单个不超过 1 MiB 的文件，AST 遍历有节点和深度边界。失败只记录固定原因，指标保持未知；语法错误和不支持的语言不能当作零复杂度。

## 多文件任务的结构测量

先由用户选择要测量的文件，保存本地清单 `selected-files.json`。相对路径以清单所在目录为起点；文件路径和清单本身始终留在本地。`requirementRevision` 使用原要求的随机修订 UUID，要求改变时换新版本；下列 UUID 仅用于展示格式。

```json
{
  "version": "code-measurement-manifest-1",
  "requirementRevision": "44c4912b-c6d6-4c7f-aeae-2d1eb4d730c3",
  "stage": "after_execution",
  "scope": "partial",
  "files": [
    { "path": "src/selected.ts", "language": "typescript" },
    { "path": "src/selected-view.tsx", "language": "tsx" },
    { "path": "scripts/selected.py", "language": "other" }
  ]
}
```

```powershell
# 默认关闭，不读取清单或源码、不加载解析器
npm run contribute -- measure-code-set --out .local/code-set-disabled.json

# 主动测量，结果写入新文件
npm run contribute -- measure-code-set --enabled --manifest selected-files.json --out .local/code-set-001.json
```

`stage` 为 `before_execution`、`during_execution`、`after_execution` 或 `unknown`，`scope` 为 `complete`、`partial` 或 `unknown`。阶段和范围明确记录为用户声明：工具不能证明清单覆盖全部相关代码，也不能凭文件时间证明它来自任务执行前。这里逐文件核对读取前后的身份、大小和修改时间，不提供整个项目同一时点的原子快照；需要比较历史版本时，应选择用户保存的固定版本。

最多处理 64 条文件选择，每个文件最多 1 MiB，总源码读取预算 8 MiB；清单自身最多 64 KiB。逐个读取和解析，汇总只保存数值频数，处理下一个文件时不保留前一个文件的 AST。失败读取也扣减预算，不能利用编码错误重复读取无限内容。`knownInputBytesRead` 是稳定读取成功的物理字节数，包含 UTF-8 BOM；`inputReadBudgetUsed` 还包含失败读取预留的预算，两者不互换。语言组中的 `sourceBytes` 是实际交给解析器的 UTF-8 文本字节数，不含解码移除的 BOM。

相同文件路径、相对路径别名和可识别的硬链接只计算一次；两个内容相同的独立文件保留为两个文件，不生成源码哈希。最终文件是符号链接、设备或目录时不读取。相同物理文件声明不同语言会报出固定错误，要求修正清单。`other` 不读取、不尝试用 JavaScript 规则推断；解析失败、文件缺失或预算不足分别保留未测得数量。没有测得文件时覆盖为未知，部分测得时不补零或声称完整。

结果为 `code-measurement-set-1`，保留清单条数、测得文件数、重复数、未测得数和固定原因，以及各语言的独立分布。跨文件先合并每个函数的数值频数，再计算整体均值、中位数和 P90，不平均文件均值或百分位。例如四个函数的圈复杂度近似为 `[1,1,1,9]`，整体均值为 3、中位数为 1、P90 为 6.6。模块只统计决策、嵌套和调用等观察，不因每增加一个文件就增加所谓整体程序复杂度。

输出不含文件名、路径、函数名、源码片段、字符串、源码哈希或逐文件定位信息。本地命令、下载工具包及网页/应用主动导入面板已接入。原报告不直接上传；用户选择后可由程序生成[可选白名单观察](code-observations-upload.md)，供本人分析，不进入生产评分。相同要求、完整范围、阶段与解析方法符合条件且用户确认范围一致后，可以比较前后数量和分布；不匹配时分别展示。测量阶段、数量与本地修订关联为后续校准提供输入，不证明任务难度、验收质量、算法大 O 或实际工作价值。

## 指标解读

补丁计量已另设 [本地数值协议与说明](patch-measurement.md)，记录原始差异中的文件操作、增删、修改块、分布、分散程度与声明。它没有原源文件关联，不替代代码前后快照或验收。网页/应用可主动导入数值报告，原始差异正文和路径仍留在本地。

语法圈复杂度近似从每个执行单元的 1 条基础路径开始，按明确分支规则累加。嵌套函数独立计算；模块执行与类隐式执行单元分别保存。函数数量、最大值、中位数和 P90 一起展示，避免大量简单函数稀释平均值。

嵌套、参数和调用节点数是结构观察。`await` 不自动增加圈复杂度，调用节点数不是调用图，循环层数不是算法大 O 复杂度。动态分派、跨文件依赖、反射、并发协议及外部系统行为需要其他证据。没有函数时不虚构平均函数复杂度。

后续先用固定公开样例与成熟工具核对差异，再扩展语言。Python、Java、C/C++ 等应使用各自解析器或成熟工具适配，不能机械套用 JavaScript 规则。不同语言、方法版本或代码阶段的数据不直接排名。
