import type {
  TaskWeightExcerpt,
  TaskWeightModel,
  TaskWeightSensitivity,
  WeightScenario,
} from './ranking-weight-sensitivity.js';

export type TaskWeightTextOptions = {
  modelLabels?: Record<string, string>;
  conditionLabels?: Record<string, string>;
  historical?: boolean;
};
export type TaskWeightText = {
  heading: string;
  introduction: string[];
  summary: string[];
  models: { id: string; label: string; lines: string[] }[];
  limitations: string[];
};
const money = (value: number, currency: string) =>
  value > 0 && value < 0.01
    ? `小于 0.0001 ${currency}`
    : `${(value / 100).toLocaleString('zh-CN', { maximumFractionDigits: 4 })} ${currency}`;
const percent = (value: number) =>
  value > 0 && value < 0.0001
    ? '小于 0.01%'
    : `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
const unavailable = {
  zero_acceptance_paid: '验收数为零且有支出，无法计算有限单位验收费用，未纳入有限费用模型对比较。',
  undefined_zero_over_zero:
    '验收数与支出均为零，0/0 未定义；不能解释为免费完成，未纳入有限费用模型对比较。',
  incomplete: '完整固定条件缺项，未计算情景范围或模型对比较；没有删除缺项后重新归一化。',
  capacity: '任务构成情景达到处理容量，未保留部分结果，也不将未计算解释为没有变化。',
  numeric_unavailable:
    '这份报告的数值未能完成一致的情景计算，整份附加结果未计算；原公开报告和主榜保留，不将缺项解释为零。',
} satisfies Record<Exclude<TaskWeightModel['state'], 'measured'>, string>;

export function taskWeightScenarioText(
  scenario: WeightScenario,
  labels: Record<string, string> = {},
): string {
  if (scenario.kind === 'baseline') return '原固定基准';
  if (scenario.kind === 'equal_conditions') return '全部条件等权';
  const condition = labels[scenario.conditionId] ?? `条件 ${scenario.conditionId.slice(0, 12)}`;
  return `${condition} 的原权重乘以 ${scenario.factor}，其他条件原权重不变，再将全部权重归一化`;
}

/** Describe existing deterministic results; this formatter performs no estimation. */
export function taskWeightSensitivityText(
  result: TaskWeightSensitivity | TaskWeightExcerpt | undefined,
  currency: string,
  options: TaskWeightTextOptions = {},
): TaskWeightText {
  const text: TaskWeightText = {
    heading: '任务构成情景 · 完整固定组合',
    introduction: [],
    summary: [],
    models: [],
    limitations: [],
  };
  if (!result) {
    text.introduction.push(
      options.historical
        ? '生成此反馈时未保存任务构成情景，不能解释为权重变化没有影响，也不表示当前没有开展分析。'
        : '此评价未附任务构成情景，不能将缺项解释为权重变化没有影响。',
    );
    return text;
  }
  const models = 'models' in result ? result.models : [result.result];
  text.introduction = [
    '这些情景仅使用已公开的评价分项，保持每个条件的模型、Harness 和验收结果不变，只改变完整固定组合的任务权重；不重新选择 Harness，不改变榜单名次。',
    result.conditions === 1
      ? '组合只有 1 个条件，仅保留原固定基准这 1 个配方；归一化后没有额外的权重变化情景。'
      : result.conditions > 1
        ? `组合包含 ${result.conditions} 个条件，预设 ${result.scenarioCount} 个配方：原固定基准、全部条件等权，以及每次只把一个条件的原权重乘以 0.5 或 2，再将全部权重归一化。倍率是相对其他条件的变化，不是最终占比。`
        : '没有获得支持的完整固定条件，未生成可比较的权重情景。',
    '配方可能得到重复的权重向量；配方数量不是独立样本数、获胜次数或胜率。极值配方只列出预设顺序中的一个，不代表它是唯一配方。这里的费用和变化属于完整组合，不能套用为某一个条件或本次目标的预计费用。',
  ];
  text.introduction.push(
    '原基准指本份公开评价在原固定权重下的费用。条件等权与任务类型等权含义不同，不代表用户实际需求或更加公平；原选择集费用和当前全量榜单费用未参与这项情景计算。',
  );
  if ('state' in result) {
    if (result.state === 'capacity')
      text.summary.push('整份任务构成分析达到处理容量，未保留部分模型或部分配方的结果。');
    else if (result.state === 'numeric_unavailable')
      text.summary.push(
        '这份公开报告未能完成数值一致的情景计算，整份附加结果未计算，原报告仍保留。',
      );
    else if (result.state === 'no_complete_models')
      text.summary.push('没有完整模型可用于组合分析，保留缺项状态，不给出虚假的零变化。');
    else
      text.summary.push(
        `具有有限费用的模型共形成 ${result.comparedPairs} 对比较：${result.reversedPairs} 对在至少一个相同配方下出现严格方向反转；${result.separatedBaselineTies} 对从基准数值接近相等变为分开。每对最多计一次，不按配方数量重复计数。`,
      );
  }
  text.models = models.map((model) => {
    const label = options.modelLabels?.[model.modelId] ?? model.modelId;
    if (model.state !== 'measured')
      return { id: model.modelId, label, lines: [unavailable[model.state]] };
    const lines = [
      `原固定基准：${money(model.baselineCost!, currency)} / 验收目标。`,
      ...(model.reportedBaselineCost !== model.baselineCost
        ? [
            `原公开报告保存值为 ${money(model.reportedBaselineCost!, currency)}；本情景的基准从公开分项重新计算。两者在原报告允许的数值容差内，原报告未被改写。`,
          ]
        : []),
      ...(result.conditions > 1
        ? [`全部条件等权：${money(model.equalConditionCost!, currency)} / 验收目标。`]
        : []),
      `已检查配方中的费用范围：${money(model.minimumCost!, currency)} 至 ${money(model.maximumCost!, currency)} / 验收目标。`,
      `相对原基准的最大绝对变化：${money(model.maxAbsoluteChange!, currency)}；最大相对变化：${model.maxRelativeChange === null ? '原基准为零，不适用' : percent(model.maxRelativeChange)}。`,
      ...(result.conditions > 1
        ? [
            `最低值配方：${taskWeightScenarioText(model.minimumScenario!, options.conditionLabels)}。`,
            `最高值配方：${taskWeightScenarioText(model.maximumScenario!, options.conditionLabels)}。`,
          ]
        : []),
      `与 ${model.comparedModels} 个具有有限费用的模型比较：${model.reversedComparisons} 个比较出现严格方向反转；${model.separatedBaselineTies} 个比较从基准数值接近相等变为分开。每个对手最多计一次，不是胜率。`,
    ];
    return { id: model.modelId, label, lines };
  });
  text.limitations = [
    `方向反转要求同一模型对在同一配方下从较低变为较高或相反；单纯范围重叠不计为反转。基准接近相等后来分开单独计数。数值接近采用相对容差 ${result.relativeEqualityTolerance}，这是计算比较规则，不代表统计等效或严格数学并列。`,
    '费用范围仅覆盖这些预设配方，不是置信区间、未来费用上下界或全部可能任务构成的范围。逐个条件改变权重没有遍历多个条件同时变化，未出现反转不能证明联合变化下仍保持顺序。',
    '方法边界例子：四条件原本等权且验收率相同，A 的单位费用为 [11, 11, 25, 25]，B 为 [20, 20, 20, 20]。原基准 A 为 18、B 为 20；逐项采用 0.5 或 2 的倍率没有反转，但同时将前两项乘以 0.5、后两项乘以 2，归一化后 A 为 22.2、B 为 20，就会反转。这是方法说明，不是实际模型观测。',
  ];
  return text;
}

export function taskWeightSensitivityLines(
  result: TaskWeightSensitivity | TaskWeightExcerpt | undefined,
  currency: string,
  options: TaskWeightTextOptions = {},
): string[] {
  const text = taskWeightSensitivityText(result, currency, options);
  return [
    text.heading,
    ...text.introduction,
    ...text.summary,
    ...text.models.flatMap((model) => [model.label, ...model.lines]),
    ...text.limitations,
  ];
}
