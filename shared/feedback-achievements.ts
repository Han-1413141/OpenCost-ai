import type { PersonalFeedback } from './personal-feedback.js';
export type Achievement = {
  id: string;
  name: string;
  description: string;
  icon: number;
  value: number | null;
  target: number;
  unit: string;
};
export function feedbackAchievements(report: PersonalFeedback): Achievement[] {
  const history = report.personaHistory;
  const days = history?.status === 'available' ? history.observedDays : null;
  const box = report.toolbox;
  const products = (kind: 'harness' | 'model') =>
    box ? box.items.filter((i) => i.kind === kind) : [];
  const frequent = (kind: 'harness' | 'model') =>
    box?.complete && box.unit === 'day' && products(kind).length > 0
      ? Math.max(
          0,
          ...products(kind)
            .filter((i) => i.count / box.total >= 0.5)
            .map((i) => i.count),
        )
      : null;
  const variety = (kind: 'harness' | 'model') =>
    box
      ? new Set(products(kind).map((i) => JSON.stringify([i.provider, i.id]))).size || null
      : null;
  const sameType =
    history?.status === 'available' ? Math.max(0, ...history.types.map((t) => t.days)) : null;
  return [
    {
      id: 'first',
      name: '开档成功',
      description: '留下第一个日期的工作记录',
      icon: 0,
      value: days,
      target: 1,
      unit: '天',
    },
    {
      id: 'week',
      name: '这周没白忙',
      description: '近 30 天记录 7 个不同日期',
      icon: 1,
      value: days,
      target: 7,
      unit: '天',
    },
    {
      id: 'month',
      name: '月度常驻嘉宾',
      description: '近 30 天记录 28 个不同日期',
      icon: 2,
      value: days,
      target: 28,
      unit: '天',
    },
    {
      id: 'signature',
      name: '这很像你',
      description: '同一工作特点出现于 7 个不同日期',
      icon: 3,
      value: sameType,
      target: 7,
      unit: '天',
    },
    {
      id: 'harness-regular',
      name: '老地方见',
      description: '同一 Harness 使用至少 7 天，覆盖半数记录日',
      icon: 4,
      value: frequent('harness'),
      target: 7,
      unit: '天',
    },
    {
      id: 'model-regular',
      name: '老搭档上线',
      description: '同一模型使用至少 7 天，覆盖半数记录日',
      icon: 5,
      value: frequent('model'),
      target: 7,
      unit: '天',
    },
    {
      id: 'harness-many',
      name: '工位随身带',
      description: '记录中使用过 3 种 Harness',
      icon: 6,
      value: variety('harness'),
      target: 3,
      unit: '种',
    },
    {
      id: 'model-many',
      name: '模型串门王',
      description: '记录中使用过 3 种模型',
      icon: 7,
      value: variety('model'),
      target: 3,
      unit: '种',
    },
  ];
}
