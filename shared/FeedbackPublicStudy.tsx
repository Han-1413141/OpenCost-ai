import type { FeedbackPublicStudy as PublicStudy } from './feedback-public-studies.js';
import { feedbackPublicStudyText } from './feedback-public-studies-text.js';

/** The same small saved evidence view is used by the web and desktop. */
export function FeedbackPublicStudy({ study }: { study?: PublicStudy }) {
  const text = feedbackPublicStudyText(study);
  const paragraphs = (lines: string[]) => lines.map((line, index) => <p key={index}>{line}</p>);
  return (
    <details className="pf-public-study">
      <summary>{text.heading}</summary>
      {paragraphs(text.introduction)}
      {text.matched.length > 0 && (
        <div className="pf-section">
          <strong>匹配单项工作 · 公开评价点值</strong>
          {paragraphs(text.matched)}
        </div>
      )}
      {text.target.length > 0 && (
        <div className="pf-section">
          <strong>完整固定组合 · 描述性观察</strong>
          {paragraphs(text.target)}
        </div>
      )}
      {text.configuration.length > 0 && (
        <details>
          <summary>匹配的完整 Harness 配置</summary>
          {paragraphs(text.configuration)}
        </details>
      )}
      {text.provenance.length > 0 && (
        <details>
          <summary>报告时间与版本</summary>
          {paragraphs(text.provenance)}
        </details>
      )}
    </details>
  );
}
