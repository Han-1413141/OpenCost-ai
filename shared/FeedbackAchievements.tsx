import type { PersonalFeedback } from './personal-feedback.js';
import { feedbackAchievements } from './feedback-achievements.js';
import { frequentTool } from './feedback-toolbox.js';
import { ProductIcon } from './ProductIcon.js';
import { nameHarness, nameModel } from './catalog.js';
const atlas = new URL('./assets/vbti-achievements-01.webp', import.meta.url).href;
export function FeedbackAchievements({ report }: { report: PersonalFeedback }) {
  const achievements = feedbackAchievements(report),
    box = report.toolbox;
  return (
    <div className="vbti-extras">
      <section className="vbti-toolbox" aria-label="使用标签">
        <header>
          <span>LOADOUT</span>
          <h3>你的 AI 搭子</h3>
        </header>
        {box?.items.length ? (
          <div className="vbti-product-tags">
            {box.items.map((item) => (
              <div
                className="vbti-product-tag"
                key={JSON.stringify([item.kind, item.provider, item.id, item.version])}
                data-frequent={frequentTool(box, item)}
              >
                <ProductIcon kind={item.kind} id={item.id} />
                <div>
                  <span>
                    {item.kind === 'harness' ? 'Harness' : '模型'} ·{' '}
                    {frequentTool(box, item)
                      ? '常用搭档'
                      : box.unit === 'day'
                        ? '近期使用'
                        : '本次使用'}
                  </span>
                  <b>{item.kind === 'harness' ? nameHarness(item.id) : nameModel(item.id)}</b>
                  <small>
                    {item.provider ? `${item.provider} · ` : ''}
                    {item.version === 'unknown' ? '' : `@${item.version} · `}
                    {box.unit === 'day'
                      ? `${item.count} / ${box.total} 个记录日`
                      : `${item.count} / ${box.total} 项任务`}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>暂无模型或 Harness 使用记录。</p>
        )}
        <details>
          <summary>使用标签怎么算</summary>
          <p>
            常用搭档：近 30 天使用至少 7
            天，并覆盖半数以上记录日。同一天重复上传只计一天；多个搭档可同时上榜。
          </p>
        </details>
      </section>
      <section className="vbti-achievements" aria-label="成就收藏柜">
        <header>
          <div>
            <span>ACHIEVEMENTS</span>
            <h3>成就收藏柜</h3>
          </div>
          <b>
            {achievements.filter((a) => a.value !== null && a.value >= a.target).length} /{' '}
            {achievements.length}
          </b>
        </header>
        <div className="vbti-achievement-grid">
          {achievements.map((a) => {
            const earned = a.value !== null && a.value >= a.target;
            return (
              <article key={a.id} data-earned={earned}>
                <span
                  className="vbti-badge-art"
                  aria-hidden="true"
                  style={{
                    backgroundImage: `url("${atlas}")`,
                    backgroundPosition: `${((a.icon % 4) * 100) / 3}% ${(Math.floor(a.icon / 4) * 100) / 3}%`,
                  }}
                />
                <div>
                  <span className="vbti-achievement-status">
                    {earned ? '已获得' : a.value === null ? '等待记录' : '积累中'}
                  </span>
                  <h4>{a.name}</h4>
                  <p>{a.description}</p>
                  <div className="vbti-achievement-value">
                    <b>
                      {a.value === null ? '—' : Math.min(a.value, a.target)} / {a.target}
                    </b>
                    <small>{a.unit}</small>
                  </div>
                  <progress
                    value={Math.min(a.value ?? 0, a.target)}
                    max={a.target}
                    aria-label={a.name}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
