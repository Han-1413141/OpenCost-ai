export const progressPhaseLabels = {
  running: '仍在执行',
  paused: '暂时暂停',
  waiting_user: '等待用户',
  waiting_external: '等待外部条件',
  blocked: '遇到阻碍，尚未结束',
  awaiting_acceptance: '已交付，等待验收',
  ended: '已经结束',
  unknown: '结束情况未记录',
} as const;
export const progressReasonLabels = {
  none: '没有记录阻碍',
  model_limit: '记录称模型无法完成',
  tool_failure: '工具故障',
  environment: '环境条件不足',
  resource_limit: '额度、时间或资源不足',
  user_cancelled: '用户取消',
  requirement_changed: '需求改变',
  unknown: '原因未确定',
} as const;
