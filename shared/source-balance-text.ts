import type { SourceBalance } from './ranking-source-balance.js';

export type SourceBalanceTextOptions = {
  modelLabels?: Record<string, string>;
  historical?: boolean;
};
export type SourceBalanceText = {
  heading: string;
  introduction: string[];
  models: { id: string; label: string; lines: string[] }[];
  limitations: string[];
};
const magnitudes = {
  up_to_5pct: '不超过 5%',
  '5_to_20pct': '超过 5%，不超过 20%',
  '20_to_50pct': '超过 20%，不超过 50%',
  over_50pct: '超过 50%',
  not_applicable: '不适用',
};
const reasons = {
  complete: '已完成来源等权对照。',
  base_incomplete: '基础评价缺少完整条件，未展示来源等权结果，也没有删除缺项后重新合成。',
  few_groups: '至少一个条件的已知关联组不足 20，未展示来源等权结果。',
  distribution_support: '分布的公开支持不足，未展示来源等权结果。',
  work_budget: '计算达到处理容量，未保留部分来源等权结果。',
  numeric_range: '数值超出支持的计算范围，未展示有限变化。',
};

/** Render public bands only; exact alternative costs never enter this formatter. */
export function sourceBalanceText(
  result?: SourceBalance,
  options: SourceBalanceTextOptions = {},
): SourceBalanceText {
  const text: SourceBalanceText = {
    heading: '来源等权对照 · 完整固定组合',
    introduction: [],
    models: [],
    limitations: [],
  };
  if (!result) {
    text.introduction.push(
      options.historical
        ? '生成此反馈时未保存来源等权对照；缺项不表示来源权重没有影响，也不表示当前没有开展分析。'
        : '生成这份公开报告时未保存来源等权对照；缺项不表示来源权重没有影响。',
    );
    return text;
  }
  text.introduction = [
    '每个任务条件内，让各已知关联组占相同权重，再按原任务条件权重合成完整固定组合。原模型与各条件的 Harness 保持不变，不重新选择配置，也不改变榜单名次。',
    '计算时，先分别平均各组的支出 / 已结束根目标数（C/N）和验收数 / 已结束根目标数（A/N），再按原任务权重合成两者，最后用合成支出除以合成验收；没有直接平均各组的 C/A。零验收组的支出继续计入。',
    '下面只展示相对原先按目标量汇总结果的预设幅度档位，变化超过 5% 才细分升降方向。它描述整个固定组合的来源权重变化，不能当成某个单项工作或本次目标的预计费用。',
  ];
  text.models = result.models.map((model) => {
    const lines: string[] = [];
    if (model.state === 'zero_acceptance_paid') {
      lines.push('来源等权后验收数为零且有支出，无法计算有限单位验收费用，未报告变化百分比。');
    } else if (model.state === 'undefined_zero_over_zero') {
      lines.push(
        '来源等权后验收数与支出均为零，0/0 未定义；不能解释为免费完成，也未报告变化百分比。',
      );
    } else if (model.state === 'numeric_unavailable') {
      lines.push(reasons.numeric_range);
    } else if (model.state === 'capacity') {
      lines.push(reasons.work_budget);
    } else if (model.state === 'suppressed') {
      lines.push(reasons[model.reason]);
    } else if (model.comparison) {
      const comparison = model.comparison;
      if (comparison.direction === 'zero_baseline') {
        lines.push('已知观察的基础费用为零，相对变化百分比不适用；这不是未来免费完成的承诺。');
      } else if (comparison.direction === 'within_5pct') {
        lines.push('变化不超过 5%，不细分方向；不能据此认定变化为零、数值相同或统计相等。');
      } else {
        lines.push(
          `相对原固定组合，来源等权后的单位验收费用${comparison.direction === 'lower' ? '较低' : '较高'}；变化幅度档位：${magnitudes[comparison.magnitude]}。`,
        );
      }
    }
    if (model.minGroupsPerCell !== null)
      lines.push(
        `该模型各条件的已知关联组数最少为 ${model.minGroupsPerCell}；关联组不等于独立用户。`,
      );
    return {
      id: model.modelId,
      label: options.modelLabels?.[model.modelId] ?? model.modelId,
      lines,
    };
  });
  text.limitations = [
    '等权只发生在各条件内，同一组跨多个条件的总权重未必相同。来源等权不是独立用户平均，不是对总体偏差的纠正、模型能力排名、胜率或区间估计。不同模型的来源构成不同，不能按这些档位比较模型名次。',
    '公开只保留固定幅度档位，超过 5% 时附升降方向；精确对照费用与原始总量组合可能反推出单组信息，因此不展示精确对照值、精确差额、逐组数值或精确相同的结论。档位也不构成匿名保证。',
    '每个条件至少需要 20 个已知关联组，并通过任务量、集中度和验收分布的发布支持检查。20 组是工程发布门槛，不证明样本独立或已经匿名。比例值 1e-10 仅用于档位边界的数值处理，不是统计相等标准；缺项、超出容量与数值不可用都不当作零变化。',
  ];
  return text;
}

export function sourceBalanceLines(
  result?: SourceBalance,
  options: SourceBalanceTextOptions = {},
): string[] {
  const text = sourceBalanceText(result, options);
  return [
    text.heading,
    ...text.introduction,
    ...text.models.flatMap((model) => [model.label, ...model.lines]),
    ...text.limitations,
  ];
}
