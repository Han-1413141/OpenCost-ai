import type { SelectionStability } from './selection-stability.js';
const reasons = {
  base_incomplete: '原独立评价缺少完整支持',
  few_groups: '至少一个候选配置少于20个已知来源组',
  distribution_support: '候选配置的验收与失败来源分布不满足发布条件',
  work_budget: '整份计算超过工作容量',
  complete: '已计算',
};
const frequency = (v: { lower: number; upper: number } | null) =>
  !v ? '未计算' : v.lower === v.upper ? `${v.lower}%` : `${v.lower}%—${v.upper}%`;
export function selectionStabilityLines(
  result?: SelectionStability,
  options: {
    modelLabels?: Record<string, string>;
    conditionLabels?: Record<string, string>;
    showConditions?: boolean;
  } = {},
) {
  if (!result) return ['该历史报告没有记录选择侧重选；缺项不能解释为选型稳定。'];
  const lines = [
    '只在原选择集按已知来源关联组重采样1000次，并为每个任务条件重新选择最低单位验收费用的Harness；配置并列沿用原规则。独立评价集不参与重选。',
    '频率范围包含无法完成重选的重复，并向外取整到10个百分点；不是置信区间、真实获胜概率或未来价格保证。最低模型集合包含并列，多个模型的频率不必相加为100%。',
  ];
  for (const model of result.models) {
    const label = options.modelLabels?.[model.modelId] ?? model.modelId;
    if (model.state !== 'measured') {
      lines.push(`${label}：${reasons[model.reason]}，未展示重选频率。`);
      continue;
    }
    lines.push(
      `${label}：原Harness配置组合仍被选中 ${frequency(model.route)}；在原可比候选集合中仍属最低费用模型 ${model.leader ? frequency(model.leader) : '候选集合不完整或不足两个，未计算'}；无法完成整组重选 ${frequency(model.unresolved)}。`,
    );
    if (options.showConditions)
      for (const condition of model.conditions)
        lines.push(
          `${options.conditionLabels?.[condition.conditionId] ?? '匹配任务条件'}：原配置仍被选中 ${frequency(condition.exactChoice)}；原配置仍属最低费用配置（含并列）${frequency(condition.costMinimum)}。`,
        );
  }
  lines.push(
    '这些结果以现有支持配置、来源关系、任务组合和历史价格为条件；未观察到的配置、未来变化及未识别依赖不在其中。选型变化不会删除原排名，也不改变冻结的独立评价费用。',
  );
  return lines;
}
