# Python代码结构测量

日期：2026-10-15。对应清单 M-05 的Python适配。新增默认关闭的 `python-code-measurement-1`，使用本地Python AST与固定Radon 6.0.1核心。没有自动发现项目、安装包、执行所选源码、模型调用或上传。JS/TS原方法和历史格式保持。

## 用途与范围

这份报告描述用户所选代码的结构，包含具名函数的圈复杂度分布、声明参数、控制嵌套、语法数量和代码行统计。它不衡量完成目标数量、任务价值、算法大O、实际运行次数、Sonar认知复杂度或可维护性，也不启用生产难度分级。网页/应用已提供同一个主动导入面板和有条件的前后比较，见 [代码报告面板](code-measurement-view.md)。

当前提供本地测量、机器协议和网页/桌面主动导入，没有自动采集或上传。用户选择已有报告后，可按[代码观察上传](code-observations-upload.md)生成本人可选数值字段。同要求、完整范围和方法版本符合条件并由用户确认范围一致后，程序可以比较前后数量与分布；自动任务绑定及经验校准仍分别推进，不能把后验代码复杂度填成事前任务难度。混合语言分别保留JS/TS报告和Python报告，不将不同定义的复杂度数值合成同一分数。

## 使用命令

```powershell
# 默认关闭：不需要源文件或解释器。
npm run contribute -- measure-code --language python --out NEW-python-disabled.json
npm run contribute -- measure-python-set --out NEW-set-disabled.json

# 主动测量：将参数替换为用户选择的受信任解释器绝对路径。
npm run contribute -- measure-code --language python --input selected.py --python "C:/Python312/python.exe" --out NEW-python.json --enabled
npm run contribute -- measure-python-set --manifest selected-python.json --python "C:/Python312/python.exe" --out NEW-python-set.json --enabled

# 只导出机器结构，不读取源码或启动解释器。
npm run contribute -- schema --format python-code-report --out NEW-python-report-schema.json
npm run contribute -- schema --format python-code-manifest --out NEW-python-manifest-schema.json
```

解释器不会自动寻找或安装。未选 `--python` 时返回 `runtime_not_selected`，不读取源码或清单；无效路径同样不继续读取。当前在本机CPython 3.12.14验证。协议接受3.10至3.15的版本标识；这不等于已经在每个小版本和平台完成验证。`-I -S -B -X utf8` 分别用于隔离导入、禁用site启动、禁止字节码缓存和UTF-8；这些参数不是操作系统沙箱。

多文件清单：

```json
{
  "version": "python-code-measurement-manifest-1",
  "requirementRevision": "00000000-0000-4000-8000-000000000001",
  "stage": "after_execution",
  "scope": "partial",
  "files": ["src/service.py", "tests/test_service.py"]
}
```

这是格式示例，使用时填写真实本地随机修订UUID、测量阶段和用户选择的相对/绝对路径。阶段与整个相关范围由用户声明，程序不认证它们。逐文件身份和时间检查不证明整个项目的原子快照。相同物理文件、路径别名和硬链接去重；同内容的独立文件仍是不同被测文件，不用源码哈希合并。

所有输出写到新文件，不覆盖历史。程序调用成功只表示报告已经写出；读取 `status`、`reason` 和 `scope` 判断是否测得完整选定范围，不能只看CLI退出码。

## 数值定义

方法标识 `radon_6_0_1_named_function_cc_v1`。先由Python解析并编译做上下文合法性检查，编译产生的代码对象不执行；再调用固定核心的AST访问器和 `raw.analyze`。

- 每个 `def` 和 `async def` 定义恰好观察一次，包括方法和嵌套闭包。类的汇总复杂度不再加入函数分布；lambda单列语法数量，不作为新的具名函数。
- 具名函数圈复杂度使用该版本 `ComplexityVisitor.from_ast(..., no_assert=False)` 的实际值。没有调用Radon的字母等级或阈值功能。
- 参数数包含显式self/cls、位置限定、普通、关键字限定参数，以及各一个 `*args`、`**kwargs`。
- 控制嵌套是本地AST结构观察：函数体内if、循环、try、with、match、条件表达式和推导式；elif保留嵌套if。嵌套函数和类另行测量，不把内部结构再算给外层。这不是认知复杂度。
- 语法数量包含普通/异步函数、类、lambda、调用表达式、推导式、with、match和异常处理节点；调用节点数不是实际调用次数。
- 行统计分别为LOC、LLOC、SLOC、注释、多行字符串、空行及整行注释，按该版本原定义保存。校验 `SLOC + multi + blank + single_comments = LOC`。

已核对旧文档与实际6.0.1源码的差别：with本身不直接加圈复杂度；assert加语句分支，但其访问器不继续给assert内部布尔表达式加分。循环else、异常else、推导式过滤等依版本规则计数，不用旧网页表格另补分。

当前不完整支持except*、模板字符串及带守卫的match；含这些结构的整个文件标 `unsupported_syntax`，不删除该结构后继续称完整。普通match和f-string已有用例；未覆盖语法不能被解释成零复杂度。

多文件收集所有测得具名函数的数值，再计算统一分布，使用Hyndman–Fan第7型分位数。不能平均文件中位数或P90。例如 `[1,1,1,9]` 的均值为3、中位数1、P90为6.6。空文件得到已知零函数与空分布；完全未测得时整个metrics为null。

## 脱敏、资源与失败

用户源码只通过标准输入进入一个解析子进程，不在命令参数或临时源码文件中传递。所选项目的模块、sitecustomize、装饰器和默认参数均不执行；不加载项目配置。子进程只接收少量系统运行环境，不继承API凭据等完整环境。受信任解释器由用户明确选择；程序不能认证任意被替换的解释器。

输出只有固定枚举、数量、分布、版本、本地随机修订UUID、时间、范围声明和缺项。没有源码、文件路径、函数/类/变量名、字符串内容、错误片段或源码哈希。`parser.name` 是公开工具名称，不是用户代码标识。解析异常与子进程标准错误均不回显。

最多64条选择、单文件1MiB、源码读取预算8MiB、传输JSON16MiB、清单64KiB；整个解析批次最多100000个AST节点、深度256、10000个具名函数，进程最长10秒、输出256KiB。这些是工作边界，不是整个进程RSS硬上限或生产性能保证。不能通过拆文件绕过批次AST预算；未测得文件保留固定原因。子进程失败、超时或不完整输出时不采用其结果前缀。

读取失败仍预留可能消耗的字节预算，稳定成功后才退回未使用预留；`knownInputBytesRead` 与 `inputReadBudgetUsed` 分别表示已知稳定读取物理字节及预算占用。UTF-8 BOM计入前者但不进入解析文本；其他编码没有自动转码。部分成功报告明确partial，选定范围全部测得也不自动证明整个项目完整。

## 来源和验证

[PyPI固定版本Radon 6.0.1](https://pypi.org/project/radon/6.0.1/) 的wheel SHA-256为 `632cc032364a6f8bb1010a2f6a12d0f14bc7e5ede76585ef29dc0cecf4cd8859`。只包含未修改的四个核心模块，保留 `third_party/radon-6.0.1/LICENSE` 和 `SOURCE.json`；不包含CLI、setup、项目依赖安装或第三方测试。源码规则可在[固定标签访问器](https://github.com/rubik/radon/blob/v6.0.1/radon/visitors.py)核对。运行前核对本地模块摘要用于一致性检查，不当作来源真实性或工作量认证。

[Python AST官方文档](https://docs.python.org/3/library/ast.html)说明解析与编译是不同步骤；本工具只编译校验，不执行代码。Radon输出属于该工具定义，不因其名称被改成真实任务难度、人工完成时间或缺陷数量。

隔离用例覆盖手算圈复杂度、参数、闭包/类去重、分位数、普通match/f-string、未支持语法、空文件、BOM、非法编码、上下文错误、路径/硬链接、源码与AST容量，以及模块/装饰器/默认值和项目启动模块不执行。CLI默认关闭、保留旧输出及机器Schema单独检查。精确结果、工具包与构建记录见 `status.md`。
