# OpenCost-AI

AI 工作成本比较、订阅额度监控与模型性价比建议。

[网站](https://opencost-ai.com) · [English](README.md) · [贡献 Skill](skills/opencost-contribute/SKILL.md)

## 仓库内容

| 目录 | 内容 |
| --- | --- |
| `web/` | 网站界面、图表、GitHub 登录入口和语言切换 |
| `desktop/` | 本地工作日记、Harness 绑定、画布与提醒 |
| `client/` | 上传 CLI、SDK、额度监控与本地适配器 |
| `skills/` | 贡献 Skill、采集说明和提示词 |
| `shared/` | 用户端协议、校验、预览与展示依赖 |
| `docs/` | 安装、字段和接入说明 |

本仓库公开分发给用户的代码。服务端聚合、数据存储、鉴权服务、线上配置及用户记录单独维护。本地校验和预览所需的共享代码一并提供，可独立构建客户端。

## 网页开发

需要 Node.js 24。

```sh
npm ci
npm run dev
npm run build
```

开发页面为 `http://127.0.0.1:4317`，公开 API 默认连接 OpenCost-AI 服务。通过 `OPENCOST_API_PROXY` 可切换到自己的兼容服务。GitHub 登录请使用正式网站，其回调地址绑定正式域名。

界面支持简体中文、繁體中文、English 和日本語，自动识别浏览器语言并记住手动选择。翻译随网页提供，切换语言不调用模型。语言切换只改变显示，协议键值、金额、输入内容和导出记录保持原值。

## 上传工作摘要

没有适配器也能生成摘要：Skill 直接整理授权的会话和成果，程序汇总已知用量。任务事实不足以生成费用贡献时，使用私有工作日记；未知 Token、付款和代理覆盖保留为空。见 [无适配器摘要与本地计量](skills/opencost-contribute/references/adapter-free-summary.md)。

把 `skills/opencost-contribute/SKILL.md` 添加到常用 Harness，或下载网站提供的客户端工具包。按顺序选择来源和时间范围、整理本地记录、检查脱敏预览，再确认站点和分享范围。

```sh
npm run contribute -- help
npm run monitor -- help
```

首次推荐近 3 天，历史最多 90 天。增量和自动运行由用户选择；额度监控与自动上传默认关闭。从旧对话提取任务摘要会消耗所选模型的用量，现成结构字段由程序汇总。

首次也可选择[单次额度采集](skills/opencost-contribute/references/quota-collection.md)：导入 Codex 额度日志、DSH 导出或标准历史快照，并对已配置的只读接口读取一次。程序生成覆盖报告、缺口说明和分批上传预览，不开启后台、不调用模型。未保存的历史保持缺失，额度百分比不换算成 Token 或实际付款。

在桌面“个人反馈”点击“关联 GitHub 账号”，或在 Skill 中执行 `account-connect`，可将已有和后续上传的摘要、额度记录与反馈汇总到账号。不同 Harness 可关联同一账号；未上传的日记仍由用户选择是否上传。详见[账号关联与模型切换记录](docs/account-connection.md)。

## 桌面应用

```sh
npm run desktop:build
npm run desktop:start
```

应用支持本地日记、多个 Harness、每日回顾、思维导图和自由画布，默认每天 17:30 提醒，时间可调。公开构建使用用户授权的真实来源，内部汇报环境单独维护。

## 来源与隐私

`source.json` 记录贡献提示词的固定 Git 提交和 SHA-256。执行 `npm run contribute -- source --verify` 可核对公开版本。仓库不包含模型凭据、浏览器 Cookie、本地日志、数据库、用户材料或生产配置。

代码采用 [MIT 许可](LICENSE)，用户贡献数据和第三方材料的权利分别保留。OpenCost-AI 与 Kubernetes 成本项目 OpenCost 无隶属关系。
