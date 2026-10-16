# dsh-cost-meter 接入

插件的「费用 → 统计 → OpenCost 适配」提供本地采集和订阅额度采样两个开关，均默认关闭。用户选择后只采集新观察，不回扫历史对话；关闭保留历史。OpenCost 本身的上传、额度监控、每日自动运行均另行授权，导入不会开启这些功能。

插件生成 dsh-opencost-export-1，只含公开产品名、未知标记、Token、历史价格、匿名代理关系与可选额度读数。导出不调用 AI。开启前的价格和使用细节不做推算；模型及 Harness 版本未核对时保留 unknown，插件版本仅用于 collector。其他 Harness 和外部账单未取到时保持 partial，不能借本地哈希获得独立证明或排名资格。

公开模型目录中带命名空间的标识使用可逆字符编码，例如 google/gemini-3.8-flash 对应 dsh:google:002fgemini-3.8-flash。编码先核对公开目录，私有别名仍为 unknown，不靠字符串清洗放行。价格快照中的 reasoning_surcharge_million_tokens 表示在输出价格以外的附加推理单价；它不会增加 Token 数量。

## 使用步骤

1. 用户在插件面板选择开启本地采集，可选开启套餐额度记录。首次说明开源范围和真实发布状态；本项目尚未设置公开仓库，不能声称已经从 GitHub 拉取。原 dsh-cost-contribute Skill 指向旧社区服务，OpenCost 使用本项目 opencost-contribute Skill。
2. 选择导出范围，推荐近 3 天，选项为 1、3、7、30、90 天。导出保存为本地文件。较长范围可能增加后续 AI 摘要的额度消耗，程序导出和导入本身不调用 AI。
3. 按 OpenCost 首次流程选择时间范围、默认增量和自动运行。示例仅展示已经由用户选择关闭增量和自动运行后的命令：

```text
npm run contribute -- init --out .local/capture.json --range 3d --incremental off --automation off
npm run contribute -- inspect-dsh --input .local/dsh-export.json --out .local/dsh-inspect.json
```

4. inspect 文件的 rootMapping 列出匿名根。AI 根据用户授权范围内的事实，将代理根对应到 capture 中已有根目标 UUID，另存为 JSON 对象 .local/dsh-mapping.json。多轮会话完成同一根目标可映射到同一任务；子代理会继承根映射。不要把会话当完成任务、自动填已验收或自动扩充任务数。未映射和无会话调用会保存在本地 manifest 并在报告中列明。

```text
npm run contribute -- import-dsh --input .local/dsh-export.json --capture .local/capture.json --mapping .local/dsh-mapping.json --out .local/dsh-capture.json --quota-out .local/dsh-quota-draft.json
```

没有可靠映射时可先省略 --mapping，只保留本地事实，不会假定归属。import-dsh 对调用和额度分别按已选时间窗过滤。记录按插件观察完成时间划入区间，开始时间仍用于历史价核查。使用已有宿主 RPC 调用 exportOpenCost 时，直接传入 init 生成的 collectionWindow.startAt/endAt 可使两边时间一致；UI 手动导出范围不足时仍保持 partial，不补造边界数据。原导出和上一版草稿保留，重复导入按事实 ID 去重，冲突直接拒绝。

5. 补齐公开 Harness 版本、实际根目标类别、分单位完成量、验收依据、账期和实付事实。难度继续关闭。DSH 的 input 不含缓存，导入程序以 input + cacheRead + cacheWrite 得到 OpenCost 的总输入；缓存不再重复加入总 Token，reasoning 不再加到 output。没有读数保持 null。记录中的 Token 只代表已观察小计，不能宣称整个生命周期用量。
6. 相同价格版本保留首次观察快照；所有逐调用报价仍保存在本地 manifest，不用新价覆盖历史。只有全部已选报价币种与账期一致时才按汇总金额四舍五入到分，避免逐调用舍入误差；跨币种或未知报价保留 null。无论是否有 API 等价金额，paidMinor、退款和实付 charges 都不自动填写。完成量和验收同样不由 Token 推算。

```text
npm run contribute -- capture --input .local/dsh-capture.json --out .local/record.json
npm run contribute -- prepare --input .local/record.json --out .local/preview.json --share private
```

模板未补齐时校验会说明缺项，这是本地草稿状态。用户核对本版预览和目标站点后，使用既有 submit 流程。上传仅发送校验后的 envelope，不能发送 DSH 原导出、capture 或 manifest。上传失败不推进增量位置，间隔超过 3 天重新选择；自动上传仍以 OpenCost 保存的授权为准。

## 订阅额度草稿

--quota-out 仅输出选定时间内的 SubscriptionSnapshot 结构草稿，consent.store=false，不上传。总额、套餐名称、订阅价格、周期类型和席位等未从来源取得的字段保持 unknown/null。百分比和重置时间只作为 harness_meter 读数，不认定确切消费或套餐容量增减；账号/凭据切换生成不同池，无法识别账号就不作连续比较。

用户选择额度监控后，可将已核对的单个最新 snapshots 条目作为 docs/monitoring.md 所述的本地文件来源。保留旧 snapshots 供历史核对，不把旧快照伪装实时读数。独立后台的来源授权、运行和每日上传流程沿用原机制，不因导入而启动。此适配不会新增任何供应商网络请求。
