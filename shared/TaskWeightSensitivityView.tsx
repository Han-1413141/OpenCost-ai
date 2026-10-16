import type { TaskWeightExcerpt, TaskWeightSensitivity } from './ranking-weight-sensitivity.js';
import {
  taskWeightSensitivityText,
  type TaskWeightTextOptions,
} from './task-weight-sensitivity-text.js';

export function TaskWeightSensitivityView({
  result,
  currency,
  modelLabels,
  conditionLabels,
  historical,
}: {
  result?: TaskWeightSensitivity | TaskWeightExcerpt;
  currency: string;
} & TaskWeightTextOptions) {
  const text = taskWeightSensitivityText(result, currency, {
    modelLabels,
    conditionLabels,
    historical,
  });
  const paragraphs = (lines: string[]) => lines.map((line, i) => <p key={i}>{line}</p>);
  return (
    <details className="statistical-basis pf-public-study">
      <summary>{text.heading}</summary>
      {paragraphs(text.introduction)}
      {paragraphs(text.summary)}
      {text.models.map((model) => (
        <div className="statistical-selection pf-section" key={model.id}>
          <strong>{model.label}</strong>
          {paragraphs(model.lines)}
        </div>
      ))}
      {text.limitations.length > 0 && (
        <details>
          <summary>比较规则与未覆盖的任务构成</summary>
          {paragraphs(text.limitations)}
        </details>
      )}
    </details>
  );
}
