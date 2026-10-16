# 来源与版本

## 开源代码

<https://github.com/Han-1413141/OpenCost-ai> 公开网页、桌面应用、上传工具、Skills 及其用户端依赖，采用 MIT 许可。服务端数据处理、数据库和线上配置单独维护。

`source.json` 记录固定 Git 提交及提示词 SHA-256；`npm run contribute -- source --verify` 下载该提交的提示词并逐文件核对。核对成功后读取同一版本，网络或哈希错误时显示实际结果并保留包内文件。

## 价格与额度

- [OpenRouter 模型目录](https://openrouter.ai/docs/api-reference/list-available-models)：公开 API 价格与模型元数据。
- 供应商官方定价及公告：记录来源、观察时间、适用时间、折扣和赠额条件。
- 用户授权的本地导出或只读 API：记录订阅额度、消耗、重置与恢复事件。

价格和公告源按配置刷新，默认每 15 分钟检查。历史价格保留原版本；新增报价不改写已经记录的实付金额。额度监控默认关闭，逐项选择来源。

## 外部评测

[Artificial Analysis](https://artificialanalysis.ai/) 的模型评测作为独立参考展示。工作成本排名采用用户上传的可比工作记录，评测分数与实际工作费用分别展示。
