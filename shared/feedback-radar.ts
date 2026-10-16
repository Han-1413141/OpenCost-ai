import type { PersonalFeedback } from './personal-feedback.js';
export type RadarDimension = {
  id: string;
  label: string;
  score: number | null;
  value: number | null;
  unit: string;
  basis: string;
  coverage: string;
  sample: string;
};
/** Descriptive display indices, not task difficulty, personality or ability estimates. */
export function feedbackRadar(report: PersonalFeedback): RadarDimension[] {
  const m = (id: string) => report.metrics.find((x) => x.id === id)?.value ?? null;
  const profile = report.taskProfile,
    agents = m('agents'),
    roots = m('root_agents'),
    depth = m('depth'),
    tools = m('tool_calls'),
    turns = m('user_turns') ?? m('turns');
  const saturation = (n: number, k: number) => Math.round((100 * n) / (n + k));
  const subagents =
    agents !== null && roots !== null && roots >= 1 && agents >= roots ? agents - roots : null;
  const delegation =
    agents !== null && agents > 0 && depth !== null
      ? depth === 0
        ? 0
        : subagents !== null
          ? Math.round((100 * subagents) / agents)
          : null
      : null;
  const toolRatio = tools !== null && turns !== null && turns > 0 ? tools / turns : null;
  const parts =
    profile?.components.value != null && profile.components.known > 0
      ? profile.components.value / profile.components.known
      : null;
  const ratio = (
    id: 'exploration' | 'verification' | 'integration',
    label: string,
    basis: string,
  ): RadarDimension => {
    const x = profile?.behaviorSignals?.[id];
    return {
      id,
      label,
      score: x && x.known > 0 ? Math.round((100 * x.matched) / x.known) : null,
      value: x && x.known > 0 ? x.matched : null,
      unit: '项',
      basis,
      coverage: x ? `已知要求 ${x.known} 项 / ${profile!.totalTasks} 项` : '未记录相应要求',
      sample: x && x.known >= 3 ? '本次记录' : x && x.known > 0 ? '少量记录' : '等待记录',
    };
  };
  return [
    {
      id: 'delegation',
      label: '分身指数',
      score: delegation,
      value: subagents,
      unit: '个子代理',
      basis:
        '全部层级子代理数 ÷ 去重代理总数 × 100。各场会话的根代理分别扣除；未记录根代理数时不推算。',
      coverage:
        roots !== null && agents !== null
          ? `${roots} 个根代理 / ${agents} 个代理`
          : '根代理数量未记录',
      sample: delegation === null ? '等待记录' : '本次记录',
    },
    {
      id: 'tools',
      label: '工具密度',
      score: toolRatio === null ? null : saturation(toolRatio, 4),
      value: toolRatio,
      unit: '次 / 轮',
      basis:
        '工具调用数 ÷ 用户轮次；指数为 100 × 每轮调用数 ÷（每轮调用数 + 4）。没有对话轮次时留空。',
      coverage:
        tools !== null && turns !== null
          ? `${tools} 次工具调用 / ${turns} 轮用户对话`
          : '工具或对话记录不完整',
      sample: toolRatio === null ? '等待记录' : turns! < 3 ? '少量记录' : '本次记录',
    },
    {
      id: 'decomposition',
      label: '任务拆解度',
      score:
        profile?.decompositionIndex ??
        (parts === null || profile?.components.known !== 1
          ? null
          : saturation(Math.max(0, parts - 1), 4)),
      value: parts,
      unit: '部分 / 项',
      basis:
        '每项任务先按 100 ×（部分数 − 1）÷（部分数 + 3）转换，再取平均。每个任务权重相同，单项大量拆分不会主导整份画像。',
      coverage: profile
        ? `结构数值覆盖 ${profile.components.known} 项 / ${profile.totalTasks} 项`
        : '没有附加结构记录',
      sample: parts === null ? '等待记录' : profile!.components.known < 3 ? '少量记录' : '本次记录',
    },
    ratio(
      'exploration',
      '探索浓度',
      '含研究性知识、检索、统计推断或仿真要求的任务，占相应要求已知任务的比例。',
    ),
    ratio(
      'verification',
      '较真指数',
      '含形式验证、形式化论证或来源可追溯要求的任务，占相应要求已知任务的比例。',
    ),
    ratio(
      'integration',
      '跨界浓度',
      '含跨系统集成或多模态对齐要求的任务，占方法要求已知任务的比例。',
    ),
  ];
}
