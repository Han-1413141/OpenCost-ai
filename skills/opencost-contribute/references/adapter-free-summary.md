# 没有适配器时直接整理摘要

DSH 适配器、插件开关和 `dsh-opencost-export-1` 导出都不是生成工作摘要的前提。找不到时直接使用本流程，不要求用户等待安装或停止整个上传。不要把 dsh-cost-meter 的版本当作 DSH Harness 版本。

## 选择记录形式

- 已有任务验收、尝试次数、公开 Harness 配置等贡献必填事实：直接填写通用 `capture`。实付与退款可为 `null`，此时 `billing/payment=unknown`、`allocation=unallocated`、`directCostMinor=null`、`costScope=partial/unknown`。程序仍计算已有 Token 和 API 等价金额，未知实付不进入费用排名。
- 只有会话、成果和任务状态，缺少贡献必填事实：生成下面的私有工作日记。不得为了通过贡献校验，把尝试次数填 1、验收填通过、缺失金额填 0。日记提供完成量和已观察用量反馈，费用排名需要相应证据。

先沿用用户已选择的来源和时间范围。只从这些会话、日志或成果整理任务，不搜索整台电脑。AI 自己提取类别和状态，不再调用一个模型做同样的摘要。生成文字所用的模型额度按实际记录保留，拿不到为 `null`。

## 本地生成

按实际时区和日期拆成每天一份；例子中的时间须替换为用户授权范围与该日期的交集。时间为 UTC，起点包含、终点不含；最后一天截至本次采集时刻，不填未来结束时间。

```sh
npm run contribute -- summary-template --day 2026-10-16 --time-zone Asia/Shanghai --start 2026-10-15T16:00:00Z --end 2026-10-16T15:00:00Z --harness dsh --out .local/day-facts.json
npm run contribute -- schema --format summary-facts --out .local/day-schema.json
```

模板的 `tasks` 和 `calls` 为空。AI 根据本次授权材料填写 `tasks`，不要直接上传模板。保留程序生成的 `id`、`salt`、`createdAt`，失败重试复用同一文件。

每项目标的字段示例（只说明格式，不可作为真实工作上传）：

```json
{
  "localId": "local-goal-1",
  "kind": "bugfix",
  "workType": "unknown",
  "reportedStatus": "completed",
  "unit": "requirement",
  "reportedCompleted": 1
}
```

`localId` 是本地稳定目标标识；同一目标的多轮交互、重试、修订和子代理成果只算一次。实际无法核对完成量时使用 `null`。类别与单位查机器协议；不得以代码行数、工具调用数替代完成目标数。未做完是 `in_progress`，部分产出是 `partial`，确定无法完成才是 `failed`；暂停、等待等可加 `progress`，遵守原有状态规则。任务业务名称、正文、代码、路径和账号不填进上传字段。

`calls` 可留空。有实际逐次请求读数才填，每条包含稳定 `id`、本地 `agentId`、可取得的 `at` 或 `sequence`、`usage`。父子日志重复出现同一调用时复用相同 `id`。每个代理独立排序，模型切换不能跨代理计算。调用中的模型不在公开型号白名单时，程序不上传内部别名。

```json
{
  "id": "local-request-1",
  "agentId": "local-agent-1",
  "sequence": 0,
  "usage": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "inputTokens": 1000,
    "outputTokens": 200,
    "cachedInputTokens": 400
  }
}
```

这些 Token 必须来自真实计量，不能让 AI 估算。`inputTokens` 含缓存输入，`outputTokens` 含推理 Token；缓存和推理不再加到总量中。DSH 的非缓存 input 应先与实际 cacheRead/cacheWrite 相加，OpenAI 等来源若已包含则不能再次相加。累计计数先按同一会话、代理、模型和计数器的连续区间做差；起点缺失、重置或归属不清时不能当成整段用量。不同来源重复计量先核对稳定调用 ID，不按文本相似猜测去重。

```sh
npm run contribute -- summarize --input .local/day-facts.json --out .local/day-summary.json
npm run contribute -- journal-prepare --input .local/day-summary.json --out .local/day-preview.json
```

程序完成去重、冲突检查、字段校验、加盐来源摘要、分代理模型阶段及已知 Token 小计。没有覆盖全部调用和后代时，完整 Token、轮次和代理总数为 `null`；已有小计仍保留。`processing` 可记录本次 AI 整理的已知开销，未知时程序填 `null`。仅整理任务事实也能通过，费用和额度记录无需等待它们齐全。

## 确认上传与回执

展示 `day-preview.json` 的全部 `summary`、未知项、观察小计和私有范围。用户确认后：

```sh
npm run contribute -- journal-submit --preview .local/day-preview.json --endpoint https://opencost-ai.com --confirmed-digest 本次预览摘要
```

只发送结构化 `summary`，不发送 `day-facts.json`、原始对话、来源清单或整个目录。复用同一站点已有 `--credential` 或 `--identity`，工作日记和其他贡献汇总到同一身份；关联 GitHub 后归入同一账号。成功回执及访问凭证留在本地，按回执显示反馈。

这条备用路径不更改自动上传授权或标准贡献的增量位置。多天逐份确认、上传并保存回执；重试沿用原日记 ID，不重复造记录。用户已经授权自动生成时可生成本地预览，备用日记的上传仍使用上述确认流程。

## 通用 capture 的本地计价

`events[].usage` 允许只填实际拿到的公开模型标识和读数，其余计量字段由程序补为未知。取得唯一历史 `priceSnapshot`（含 `snapshotId`）时，程序可自动生成 `priceMetering`，不要求 AI 算金额。普通输入为总输入减缓存读入减缓存写入；各项数量乘对应历史单价，先合计再舍入。不同价格时期要保留逐调用快照，不拿今天的价格覆盖历史。跨币种需要相应历史汇率。

`capture → prepare` 的 `usageCalculation` 会列出本地总量、各模型读数、API 等价金额及缺少的字段；云端预览使用同一算法。价格、缓存读数或汇率不够时显示具体原因，仍能提交已知工作与用量。API 等价金额不是实付，也不能据此反推出订阅余额或套餐容量。
