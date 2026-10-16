export const monitorHistoryExportNotice =
  '这是用户选定订阅与观察时间范围的本地只读导出，保留当时原始额度与价格记录；记录中的账期或流水可能早于所选起点。没有读取授权、密钥或上传进度，也没有启动监控、调用模型或上传。存储范围读完不证明请求、流水或共享账户范围完整；余额差不作为任务量。';
export const monitorHistoryExportDiagnostics = {
  invalid_selection: '订阅、时间范围或导出参数无效。',
  source_unavailable: '选定数据库不能只读打开，未创建或替换原库。',
  source_busy: '历史库正在占用，未读取完成；可稍后手动重试，不会自动密集重试。',
  unsupported_storage: '历史库缺少支持的时间索引或表结构，未自动迁移。',
  unindexed_time: '该订阅存在未建立时间索引的记录，无法确认范围完整。',
  observation_capacity: '范围内观察超过导出上限，未输出部分观察作为完整输入。',
  byte_capacity: '原始观察或完整导出超过字节预算，未输出可运行前缀。',
  invalid_history: '观察、时间索引、内容摘要或结构不一致。',
  ambiguous_observed_time: '存在同一毫秒的多份观察或高于毫秒的有效时间，未猜测其先后。',
  source_changed: '读取期间选定文件被替换，导出已停止。',
  no_observations: '该订阅在选定范围内没有存储观察。',
  mapping_not_attached: '没有附带请求与规则映射；可保留观察，但尚不能运行完整回放。',
} as const;
