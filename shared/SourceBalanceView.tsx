import type { SourceBalance } from './ranking-source-balance.js';
import { sourceBalanceText, type SourceBalanceTextOptions } from './source-balance-text.js';

export function SourceBalanceView({
  result,
  modelLabels,
  historical,
}: {
  result?: SourceBalance;
} & SourceBalanceTextOptions) {
  const text = sourceBalanceText(result, { modelLabels, historical });
  const paragraphs = (lines: string[]) => lines.map((line, i) => <p key={i}>{line}</p>);
  return (
    <details className="statistical-basis pf-public-study">
      <summary>{text.heading}</summary>
      {paragraphs(text.introduction)}
      {text.models.map((model) => (
        <div className="statistical-selection pf-section" key={model.id}>
          <strong>{model.label}</strong>
          {paragraphs(model.lines)}
        </div>
      ))}
      {text.limitations.length > 0 && (
        <details>
          <summary>来源权重的含义与发布规则</summary>
          {paragraphs(text.limitations)}
        </details>
      )}
    </details>
  );
}
