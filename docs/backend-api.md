# 公共接口约定

服务地址：`https://opencost-ai.com`。上传使用 1.1 协议，字段定义见 `/api/schema`。

## 用户记录

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/contributions/preview` | 校验工作记录，返回确认摘要 |
| `POST /api/contributions` | 保存已确认的工作记录 |
| `GET /api/contributions/index` | 分页读取本人的记录摘要 |
| `GET /api/contributions/:id` | 读取本人记录详情 |
| `POST /api/subscriptions/preview` | 预览额度观察 |
| `POST /api/subscriptions` | 保存额度观察 |
| `GET /api/subscriptions/mine` | 读取本人的额度记录 |
| `POST /api/work-summaries/preview` | 预览工作日记 |
| `POST /api/work-summaries` | 保存工作日记 |
| `GET /api/work-summaries/mine` | 读取本人日记 |
| `GET /api/feedback` | 读取指定记录的个人反馈 |
| `GET /api/feedback/mine` | 读取近期个人反馈 |

客户端使用 `Authorization: Bearer <accessKey>`。GitHub 网站会话使用私有 Cookie；本地 Harness 使用用户下载的账号凭证。凭证绑定具体站点。

## 提交流程

本地校验 → 完整预览 → 确认摘要与分享范围 → 保存回执。重试沿用原始预览、内容摘要和幂等键。内容或分享范围改变后，生成新的预览并重新确认。

上传正文最多 512 KiB。成功回执保存在本地，上传成功后推进增量位置；网络中断时保留原预览，重新确认请求结果。

## 公开读取

`/api/explore`、`/api/rankings`、`/api/comparisons`、`/api/summaries` 提供分组统计；`/api/market`、`/api/catalog` 和 `/api/aa` 提供公开价格或评测资料。公开响应保留数据来源及记录时间，个人接口返回私有数据。

## 错误处理

| 状态 | 处理 |
| --- | --- |
| 400 / 422 | 按错误字段修正本地草稿 |
| 401 / 403 | 检查身份、目标站点和授权 |
| 404 | 检查记录编号及其所属身份 |
| 409 | 保留原预览，核对重复记录或修订关系 |
| 413 | 拆分符合协议的采集批次 |
| 429 / 503 | 按 `Retry-After` 和 `retryable` 决定何时重试 |

接口接受 `GET`、`HEAD`、`POST`，读取请求不携带正文。原始账单、源码、对话及账号信息留在本机。
