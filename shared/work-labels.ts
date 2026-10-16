import { workActivities } from './work-taxonomy.js';
import { workSubjects } from './work-subjects.js';

export function workTypeLabel(id: string | null | undefined) {
  if (id === 'mixed') return '组合任务';
  return workActivities.find((t) => t.id === id)?.label ?? '细分类型未记录';
}
export function workClassificationLabel(value: {
  workType?: string;
  subjects?: string[];
  componentTypes?: { workType: string; count: number }[] | null;
  useContext?: string;
}) {
  const items =
    value.workType && value.workType !== 'unknown' ? [workTypeLabel(value.workType)] : [];
  const subjects = (value.subjects ?? [])
    .map((id) => workSubjects.find((s) => s.id === id)?.label)
    .filter(Boolean);
  if (subjects.length) items.push(subjects.join('、'));
  if (value.workType === 'mixed' && value.componentTypes?.length)
    items.push(
      value.componentTypes.map((p) => `${workTypeLabel(p.workType)} ${p.count} 部分`).join('、'),
    );
  const contexts: Record<string, string> = {
    occupational: '工作用途',
    education: '学习用途',
    personal: '个人用途',
  };
  if (value.useContext && contexts[value.useContext]) items.push(contexts[value.useContext]);
  return items.join(' · ');
}
