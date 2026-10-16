# OpenCost

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

开发页面为 `http://127.0.0.1:4317`，公开 API 默认连接 OpenCost 服务。通过 `OPENCOST_API_PROXY` 可切换到自己的兼容服务。GitHub 登录请使用正式网站，其回调地址绑定正式域名。

界面支持简体中文、繁體中文、English 和日本語，自动识别浏览器语言并记住手动选择。翻译随网页提供，切换语言不调用模型。语言切换只改变显示，协议键值、金额、输入内容和导出记录保持原值。

## 上传工作摘要

把 `skills/opencost-contribute/SKILL.md` 添加到常用 Harness，或下载网站提供的客户端工具包。按顺序选择来源和时间范围、整理本地记录、检查脱敏预览，再确认站点和分享范围。

```sh
npm run contribute -- help
npm run monitor -- help
```

首次推荐近 3 天，历史最多 90 天。增量和自动运行由用户选择；额度监控与自动上传默认关闭。从旧对话提取任务摘要会消耗所选模型的用量，现成结构字段由程序汇总。

GitHub 登录用户可在“我的记录 → 连接本地 Harness”下载账号凭证。旧凭证继续访问原有记录。

## 桌面应用

```sh
npm run desktop:build
npm run desktop:start
```

应用支持本地日记、多个 Harness、每日回顾、思维导图和自由画布，默认每天 17:30 提醒，时间可调。公开构建使用用户授权的真实来源，内部汇报环境单独维护。

## 来源与隐私

`source.json` 记录贡献提示词的固定 Git 提交和 SHA-256。执行 `npm run contribute -- source --verify` 可核对公开版本。仓库不包含模型凭据、浏览器 Cookie、本地日志、数据库、用户材料或生产配置。

代码采用 [MIT 许可](LICENSE)，用户贡献数据和第三方材料的权利分别保留。OpenCost 与同名 Kubernetes 项目无隶属关系。
