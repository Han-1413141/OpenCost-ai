# 首次历史用量与单次额度采集

工作用量与订阅额度分别采集。会话中的 Token 是该来源的调用记录；账号额度还可能被其他设备、会话和应用使用，两者不能互相替代。首次可以读取来源已经保存的历史，不需要先开后台；来源未保存的历史不能倒推。

## 选择与来源

先复用用户已选的来源和时段。可在首次方案中增加一句：“也可以读取已有额度历史和当前额度，先在本地预览，不开启后台。”用户未选择时不执行单次额度采集。只接受明确的文件列表、已绑定来源及指定只读接口，不扫描整个用户目录、不读取浏览器 Cookie、不让用户发送密钥。推荐近 3 天，最多 90 天；跨次复用同一个本地随机 subscriptionRef，不能用账号、邮箱、API Key 或它们的普通哈希代替。

| 来源 | 可以取得 | 不能补造 |
| --- | --- | --- |
| Codex JSONL 中 `event_msg` / `token_count` / `rate_limits` | 已记录的已用百分比、窗口时长、重置时间；可识别的 Codex 版本 | 缺失的历史读数、真实总额度、付款、百分比对应的 Token |
| dsh-cost-meter 标准导出 | 导出中已有的额度历史；工作 Token 继续走 import-dsh | 插件启用前没有保存的记录 |
| SubscriptionSnapshot JSON 单条或数组 | 来源提供的额度、套餐、历史价格及事件流水 | 账单中没有的付款或未披露总额度 |
| 已配置的只读 JSON API / 快照文件 | 对选定来源读取一次，保留真实观察时间 | API 未返回的历史、未接入供应商的后台数据 |

Codex 只投影结构额度字段，原文、私有路由名称、目录、账号及余额字符串不进入输出。缺少版本时为 unknown。多个代理或日志副本中的同一账号额度去重，不能逐代理相加。不同账号必须使用不同 subscriptionRef；同一账号也可能存在不同额度池。已有来源导入保留其订阅与额度池标识，跨来源对应关系不明确时不擅自合并。

## 单次执行

先在新的本地私有目录生成配置：

```sh
npm run monitor -- collect-template --out .local/quota-sources.json
npm run monitor -- schema --format quota-collection --out .local/quota-config-schema.json
```

配置示例，路径相对于配置文件。UUID 由程序在本机生成并保存，示例中的值只说明格式；不能作为多位用户共用的订阅标识。

```json
{
  "format": "opencost-quota-collection-1",
  "history": [
    {
      "id": "codex-history",
      "kind": "codex",
      "files": ["selected-session.jsonl", "selected-child.jsonl"],
      "subscriptionRef": "9b453d5a-9209-4a0e-a221-0762069c71b6"
    },
    { "id": "export-history", "kind": "snapshots", "files": ["quota-history.json"] }
  ],
  "current": null
}
```

已有监控配置但不想开启后台时，可把 current 改成 `{"configPath":"monitor-config.json","sourceIds":["selected-provider"]}`。只读取列表中的来源一次，不执行 grant/run，不打开监控数据库。HTTP 映射、凭据的环境变量与 Origin 绑定沿用 [监控说明](../../../docs/monitoring.md)；AI 先向用户说明选定接口，密钥不进入配置正文或模型上下文。接口须是读取额度的接口，不配置具有写入作用的 URL。

用户选择后运行：

```sh
npm run monitor -- collect --config .local/quota-sources.json --out .local/quota-run-YYYYMMDD-HHMM --range 3d --enabled
```

可选 `--range 1d/7d/30d/90d`，或 `--since ISO --through ISO` 指定明确区间，最长 90 天。已经有工作 capture 时使用其中的起止时间。指定历史终点时，current 仍表示本次额外读取，不能冒充历史终点的读数。未提供 `--enabled` 不读取配置、历史或接口，也不创建输出。单次命令不调用模型、不上传、不设置调度、不改变增量位置。

## 预览与缺口

输出目录包含：

- `report.json`：各来源成功与失败数、重复数、冲突位置、实际观察起止、UTC 日期缺失数、最长未观察时段、跨重置次数和计数下降次数。观察间隔不等于没有使用；计数下降不转换成负消耗。
- `observations.json`：规范化的完整观察；有冲突时保留冲突双方供本地核对。
- `preview-N.json`：最多 500 条且请求体不超过 512 KiB 的固定批次，保留摘要与幂等键。内容只含订阅协议字段，报告、配置、原文和来源路径不上传。

`ready` 只表示所选来源读取成功并已生成预览，不表示拥有完整历史。`partial` 表示存在失败文件或无效事件，必须先说明缺口；用户可选择只上传已有有效观察。`empty` 不上传空批次。`needs_resolution` 表示同一观察身份或时间存在冲突，不生成上传批次；核对原始来源后用新目录重做，不能删除失败读数伪装完整。

每个额度池分别报告覆盖。`declaredCompleteLedgerSeconds` 只统计来源声明完整的流水区间并去除重叠，仍是 Q0；它不证明来源真实，也不表示整个账号消费完整。只有快照时，重置前的未观察使用、滚动恢复、赠额和到期都可能缺失，报告保持 `consumptionCoverage=not_established`。额度百分比绝不直接换算成 Token 或金额。

同一时间、同一池的相同观察去重；互不重叠的池在订阅元数据一致时合并；不同值保留冲突。单个来源失败不覆盖其他成功来源。读取最多 128 个明确文件、单文件 16 MiB、合计 128 MiB、保留最多 20,000 条观察；达到上限记录失败，不截断后声称完整。较大导出应在来源端按已授权区间分段。

## 确认上传与后续监控

给用户展示来源、时段、读数、缺口和批次数。额度默认私人保存，参与分组统计须用户选择后添加 `--share-quota-statistics` 重新生成预览。用户确认内容和站点后，逐个提交固定批次：

```sh
npm run monitor -- submit --input .local/quota-run-YYYYMMDD-HHMM/preview-1.json --endpoint https://opencost-ai.com --identity <本站本地凭证路径> --confirm-digest <该预览中的digest>
```

由 AI 传入确认过的摘要，不让用户手填。保存每份完整回执到本地私有目录；超时重试使用同一 preview 与幂等键，不重新生成。回执可能含私人反馈链接，不能公开。多批全部成功才报告完整上传。单次额度补录不推进工作摘要的成功位置。

默认后台监控和自动上传继续关闭。用户另行选择持续监控后才配置 grant/run 与调度；它能补充未来读数，不能恢复过去未记录的使用。当前未提供通用供应商历史 API 分页或自动登录能力；有历史导出时按快照/DSH 导入，没有时明确缺口，不声称已经接通全部套餐。

Codex 字段依据：[官方 rate_limits.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs)。本适配器按明确字段解析，未知结构保留缺项，不调用模型猜字段。
