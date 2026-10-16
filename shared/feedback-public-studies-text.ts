import type { FeedbackPublicStudy } from './feedback-public-studies.js';
import { labels } from './schema.js';
import { taskWeightSensitivityLines } from './task-weight-sensitivity-text.js';
import { sourceBalanceLines } from './source-balance-text.js';

const unavailableText = {
  not_configured: '生成此反馈时未配置公开评价目标，未附加相关公开评价。',
  capacity: '生成此反馈时附加评价超过处理或展示容量，未采用部分结果。',
  target_not_found: '生成此反馈时没有与这项工作条件完全匹配的公开固定目标。',
  report_not_found: '生成此反馈时匹配的固定目标尚无已加载的公开评价报告。',
  snapshot_changed: '公开评价与生成此反馈时的事实版本不同，未套用旧评价数值。',
  report_mismatch: '公开评价与固定目标的条件、权重或统计范围不一致，未附加评价数值。',
  model_not_selected: '匹配的公开评价没有冻结选择此模型，未附加其他模型的结果。',
  model_incomplete: '匹配模型缺少完整公开支持，未披露分项、重采样范围或来源影响。',
  configuration_not_selected:
    '这项推荐的完整 Harness 配置与公开评价冻结的配置不同，未附加评价数值。',
} satisfies Record<Exclude<FeedbackPublicStudy['status'], 'available'>, string>;
const resamplingReasons = {
  base_incomplete: '基础评价缺项，分布未披露',
  few_groups: '已知关联组较少，分布未披露',
  distribution_support: '分布公开支持不足，分布未披露',
  work_budget: '计算达到处理容量，未采用部分重采样结果',
  all_accepted: '观测全部通过验收，未观测失败的波动未知',
  all_zero_acceptance: '观测全部零验收，无法估计有限范围',
  observed_values_identical: '观测组重采样值相同，未将其展示为零宽度置信区间',
  complete: '保留了有限、无界和未知重复',
};
const influenceNames = {
  up_to_5pct: '不超过 5%',
  '5_to_20pct': '超过 5%，不超过 20%',
  '20_to_50pct': '超过 20%，不超过 50%',
  over_50pct: '超过 50%',
  unknown: '无法判断：存在缺失条件或 0/0',
  unbounded: '无有限上界：删除后出现零验收且有支出',
  zero_baseline: '基础费用为零，相对变化不适用',
  zero_acceptance: '基础验收数为零，无法计算有限单位费用',
};
const sensitivityReasons = {
  complete: '所有逐组删除均满足发布支持要求',
  base_incomplete: '基础评价缺项，未披露来源影响',
  few_groups: '已知关联组不足 20，未披露来源影响',
  distribution_support: '原始分布公开支持不足，未披露来源影响',
  residual_support: '至少一次删除后支持不足，整项来源影响与占比均隐藏',
  work_budget: '计算达到处理容量，未采用部分来源影响结果',
};
const shareNames = {
  up_to_10pct: '不超过 10%',
  '10_to_20pct': '超过 10%，不超过 20%',
  '20_to_35pct': '超过 20%，不超过 35%',
  '10_to_25pct': '超过 10%，不超过 25%',
  '25_to_50pct': '超过 25%，不超过 50%',
  '50_to_75pct': '超过 50%，不超过 75%',
  over_75pct: '超过 75%',
  no_positive_total: '无正总量，占比不适用',
};
const surfaceNames = {
  cli: '命令行',
  desktop: '桌面',
  ide: '编辑器',
  web: '网页',
  api: 'API',
  custom: '自定义环境',
  unknown: '环境未记录',
};
const money = (n: number, currency: string) =>
  `${(n / 100).toLocaleString('zh-CN', { maximumFractionDigits: 4 })} ${currency}`;
const percent = (n: number) =>
  `${(n * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
export type FeedbackPublicStudyText = {
  heading: string;
  introduction: string[];
  matched: string[];
  target: string[];
  configuration: string[];
  provenance: string[];
};

/** Shared wording for the web, desktop, and exported feedback. No reads or recalculation. */
export function feedbackPublicStudyText(study?: FeedbackPublicStudy): FeedbackPublicStudyText {
  const sections: FeedbackPublicStudyText = {
    heading: '相关公开评价',
    introduction: [],
    matched: [],
    target: [],
    configuration: [],
    provenance: [],
  };
  if (!study || study.status !== 'available') {
    sections.introduction = [
      study
        ? unavailableText[study.status]
        : '生成此反馈时未保存相关公开评价；这不表示当前没有开展评价。',
    ];
    return sections;
  }
  const condition = study.matchedCondition,
    target = study.targetResult;
  sections.introduction = [
    '这份附加评价采用整个公开社区的数据，没有排除本人及确认同源记录；本次私人推荐的参照已另行排除这些记录。',
    '它只提供相关公开观察，不是本次推荐的独立验证，不改变推荐顺序、预计费用或节省比例。',
  ];
  sections.matched = [
    `匹配工作条件：${condition.count} 项已结束根目标，${condition.accepted} 项验收，${condition.groups} 个已知关联组；关联组不等于独立用户。`,
    `该条件公开评价支出 ${money(condition.spendMinor, study.currency)}；${
      condition.costPerAccepted === null
        ? '验收数为零，无法计算有限单位验收费用，不能解释为免费完成'
        : `单位验收费用 ${money(condition.costPerAccepted, study.currency)}`
    }。`,
    '这里的点值属于匹配工作条件与冻结配置，不是本人的实际费用，也不自动乘以本次目标数作为预计费用。',
  ];
  sections.target = [
    `固定目标任务类型：${target.kind === null ? '涵盖目标中已固定的各任务类型' : (labels.kind[target.kind as keyof typeof labels.kind] ?? target.kind)}。`,
    `完整公开固定组合包含 ${target.conditions} 个条件；本条件的固定权重为 ${percent(condition.weight)}。${
      target.conditions > 1
        ? '以下组合费用、重采样和来源影响涵盖全部条件，不能解释为上面单项工作的结果。'
        : '以下结果对应这个单条件固定目标，仍不能作为本次推荐的独立验证。'
    }`,
    `完整组合：每项已结束根目标支出 ${money(target.perRootSpend, study.currency)}，验收比例 ${percent(target.acceptedPerRoot)}；${
      target.costPerAccepted === null
        ? '组合验收为零，无法计算有限单位验收费用'
        : `单位验收费用 ${money(target.costPerAccepted, study.currency)}`
    }。`,
  ];
  const distribution = target.resampling?.models[0];
  if (!distribution)
    sections.target.push('此公开报告未记录观测组重采样；旧格式或缺项不表示波动为零。');
  else {
    const range = distribution.range;
    sections.target.push(
      `完整组合的观测组重采样范围：${
        !range
          ? '未展示'
          : range.lower.kind === 'unbounded'
            ? '本次中间范围没有有限费用值'
            : `${money(range.lower.value, study.currency)} 至 ${range.upper.kind === 'unbounded' ? '无有限上界' : money(range.upper.value, study.currency)}`
      }。${resamplingReasons[distribution.reason]}。`,
    );
    if (distribution.counts)
      sections.target.push(
        `重采样共 ${target.resampling!.replicates} 次：有限 ${distribution.counts.finite} 次，零验收有支出 ${distribution.counts.zeroAcceptancePaid} 次，缺条件 ${distribution.counts.missingCondition} 次，0/0 未定义 ${distribution.counts.undefinedZeroOverZero} 次。`,
      );
    sections.target.push(
      '范围描述观测组重采样结果的中间 95%，不是已校准的 95% 置信区间或未来费用保证；模型、Harness 与任务权重保持冻结，没有计入重新选型的不确定性。',
    );
  }
  const sensitivity = target.sourceSensitivity?.models[0];
  if (!sensitivity) sections.target.push('此公开报告未记录来源影响分析，不能解释为来源影响为零。');
  else {
    sections.target.push(
      `完整组合的来源影响：${
        sensitivity.costInfluence
          ? influenceNames[sensitivity.costInfluence]
          : sensitivityReasons[sensitivity.reason]
      }。`,
    );
    if (sensitivity.concentration) {
      const share = sensitivity.concentration;
      sections.target.push(
        `各条件内单组最高占比：任务量 ${shareNames[share.taskBand]}；归属支出 ${shareNames[share.spendBand]}；验收目标 ${shareNames[share.acceptanceBand]}。三项最高值可能来自不同组。`,
      );
    }
    sections.target.push(
      '来源影响每次删除一个已知关联组，保持完整组合的任务权重与配置不变，公开单位验收费用最大相对变化的固定档位。它不是置信区间、未来风险或模型排名；不同模型的组数与构成不同，不能按档位比较名次。',
    );
  }
  sections.target.push(
    ...sourceBalanceLines(target.sourceBalance, {
      historical: true,
      modelLabels: { [study.modelId]: '当前推荐模型' },
    }),
  );
  sections.target.push(
    ...taskWeightSensitivityLines(target.weightSensitivity, study.currency, {
      historical: true,
      modelLabels: { [study.modelId]: '当前推荐模型' },
    }),
  );
  const c = study.configuration;
  sections.target.push(
    ...selectionStabilityLines(target.selectionStability, {
      modelLabels: { [study.modelId]: '当前推荐模型' },
      showConditions: true,
      conditionLabels: { [condition.id]: '上方匹配的单项工作条件' },
    }),
  );
  sections.configuration = [
    `Harness ${c.harness}；版本 ${c.harnessVersion}；型号 ${c.harnessVariant ?? '未记录'}；运行环境 ${surfaceNames[c.harnessSurface]}。`,
    `套餐 ${c.plan}；套餐版本 ${c.planVersion}；模式 ${c.mode === 'agent' ? '自主执行' : '辅助执行'}；工具 ${c.tools === 'standard' ? '标准' : '扩展'}；推理 ${{ low: '低', medium: '中', high: '高', auto: '自动' }[c.reasoning]}；缓存 ${{ on: '启用', off: '关闭', mixed: '混合' }[c.cache]}。`,
  ];
  sections.provenance = [
    `公开评价月份 ${study.month}；选择准备时间 ${study.preparedAt}；评价时间 ${study.evaluatedAt}；来源更新时间 ${study.sourceUpdatedAt ?? '未记录'}。`,
    `报告 ${study.reportId}；固定目标 ${study.targetId}；事实版本 ${study.dataVersion}。`,
    '以上是生成此反馈时保存的公开评价摘要；之后的数据、目标或价格变化不会改写这份历史反馈。',
  ];
  return sections;
}

export function feedbackPublicStudyLines(study?: FeedbackPublicStudy): string[] {
  const text = feedbackPublicStudyText(study);
  return [
    text.heading,
    ...text.introduction,
    ...text.matched,
    ...text.target,
    ...text.configuration,
    ...text.provenance,
  ];
}
import { selectionStabilityLines } from './selection-stability-text.js';
