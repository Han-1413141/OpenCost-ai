import type { PersonalFeedback } from './personal-feedback.js';
import { feedbackRadar } from './feedback-radar.js';
import { getLocale, t } from '../web/i18n/locale.js';
export function FeedbackRadar({ report }: { report: PersonalFeedback }) {
  const axes = feedbackRadar(report),
    cx = 160,
    cy = 140,
    radius = 86;
  const point = (i: number, r: number) => [
    cx + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * r,
    cy + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * r,
  ];
  const points = axes.map((a, i) => (a.score === null ? null : point(i, (radius * a.score) / 100)));
  const complete = points.every((p) => p !== null);
  return (
    <section className="pf-radar" aria-label="VBTI 六维工作画像">
      <div>
        <span className="pf-eyebrow">VBTI · 六维工作画像</span>
        <h3>你的工作，哪一面最突出</h3>
        <p>点击数值查看计算依据。</p>
      </div>
      <div className="pf-radar-layout">
        <svg viewBox="0 0 320 280" role="img" aria-label={t('六维工作雷达图；缺少记录的维度留空')}>
          {[0.25, 0.5, 0.75, 1].map((k) => (
            <polygon
              key={k}
              points={axes.map((_, i) => point(i, radius * k).join(',')).join(' ')}
              fill={k === 1 ? '#f8f5fc' : 'none'}
              stroke="#ddd5e9"
              strokeWidth="1"
              style={k === 1 ? { fill: 'none' } : undefined}
            />
          ))}
          {axes.map((a, i) => {
            const p = point(i, radius),
              label = point(i, radius + 29);
            return (
              <g key={a.id}>
                <line x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#e4ddef" />
                <text x={label[0]} y={label[1]} textAnchor="middle" dominantBaseline="middle">
                  {t(a.label)}
                </text>
              </g>
            );
          })}
          {complete && (
            <polygon
              points={points.map((p) => p!.join(',')).join(' ')}
              fill="#a58bd94d"
              stroke="#8666b9"
              strokeWidth="2"
            />
          )}
          {!complete &&
            points.map((p, i) => {
              const next = points[(i + 1) % 6];
              return p && next ? (
                <line
                  key={i}
                  x1={p[0]}
                  y1={p[1]}
                  x2={next[0]}
                  y2={next[1]}
                  stroke="#8666b9"
                  strokeWidth="2"
                />
              ) : null;
            })}
          {points.map(
            (p, i) =>
              p && (
                <circle key={i} cx={p[0]} cy={p[1]} r="4" fill="#8666b9">
                  <title>
                    {t(axes[i].label)}: {axes[i].score}
                  </title>
                </circle>
              ),
          )}
        </svg>
        <div className="pf-radar-values">
          {axes.map((a) => (
            <details key={a.id}>
              <summary>
                <span>{a.label}</span>
                <b>{a.score ?? '—'}</b>
              </summary>
              <p>
                {a.value === null ? (
                  '未记录'
                ) : (
                  <>
                    {a.value.toLocaleString(getLocale(), { maximumFractionDigits: 1 })} {a.unit}
                  </>
                )}
              </p>
              <small>{a.coverage}</small>
              <small>{a.sample}</small>
              <small>{a.basis}</small>
            </details>
          ))}
        </div>
      </div>
      <small>工作特点指数 · 0–100</small>
      {!!report.taskProfile?.sources?.length && (
        <details>
          <summary>数据从哪里来</summary>
          {report.taskProfile.sources.map((s) => (
            <p key={s.source}>
              {
                {
                  recorded_log: '日志记录',
                  artifact_parser: '程序解析',
                  human_report: '用户填写',
                  local_model: '模型提取',
                  local_rule: '本地规则',
                  unknown: '来源未知',
                }[s.source]
              }{' '}
              · {s.tasks} 项
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
