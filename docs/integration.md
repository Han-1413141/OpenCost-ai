# 上传与 Harness 接入

网站：<https://opencost-ai.com>。源码：<https://github.com/Han-1413141/OpenCost>。

OpenCost 提供通用 Skill、CLI 和 TypeScript SDK。DSH、Codex、Claude Code、OpenCode、Aider、Cursor、Cline 或自研工具可映射同一协议；具体自动采集能力由对应适配器提供。

## 1. 安装

需要 Node.js 24。在工具包或公开仓库目录执行 `npm install`，让 Harness 读取 `skills/opencost-contribute/SKILL.md`。执行 `npm run contribute -- source --verify` 可核对 GitHub 固定版本与提示词哈希。

## 2. 选择范围

首次选择近 3 天、近 24 小时、近 7 天、近 30 天或历史最多 90 天。推荐近 3 天；AI 整理旧对话按实际模型用量计费。增量和自动运行分别设置，自动运行默认关闭。

用户选择近 3 天、开启增量、关闭自动运行后：

```sh
npm run contribute -- init --out .local/capture.json --range 3d --incremental on --automation off
npm run contribute -- schema --format capture --out .local/capture-schema.json
```

按 Schema 整理授权范围内的记录，再生成待上传数据与预览：

```sh
npm run contribute -- capture --input .local/capture.json --out .local/record.json
npm run contribute -- prepare --input .local/record.json --out .local/preview.json --share private
```

`private` 保存个人记录；`statistics` 允许分组统计；`summary` 额外允许公开分组摘要。预览在本地生成，可检查全部字段。

## 3. 确认上传

```sh
npm run contribute -- submit --preview .local/preview.json --endpoint https://opencost-ai.com
```

交互终端会要求确认本次摘要。AI 在获得用户确认后可传入对应的 `--confirmed-digest`；自动上传使用单独授权的 `--automatic` 流程。重试复用原预览和幂等键，收到成功回执后推进增量位置。间隔超过 3 天时重新选择时间范围。

GitHub 登录用户可在“我的记录 → 连接本地 Harness”下载账号凭证，通过 `--credential` 使用。独立身份按站点分开保存；访问旧身份时指定原凭证。`access.json` 和完整回执含访问权限，请保存在本地。

## 采集内容

任务类别、完成量、验收、Token、轮次、全部后代代理、资源用量和费用。费用保留当时价格及折扣；缺失数值用 `null` 或 `unknown`。当前难度分级关闭。原始对话、源码、路径、账号和账单留在本机。

## 扩展接入

- [DSH 适配](dsh-cost-meter.md)
- [后台监控与每日上传](monitoring.md)
- [字段标准](data-standard.md)
- [接口约定](backend-api.md)
- [累计费用核对](charge-reconciliation.md)
- [代码结构观察](code-observations-upload.md)
- [结算修订](settlement-revision-design.md)

上传大小上限为 512 KiB。CLI 按 Schema 校验，服务端重新计算汇总和证据等级。费用、工作量和额度分别核验。
