import { useState } from 'react';
import type { PersonalFeedback } from './personal-feedback.js';
import {
  feedbackPersonas,
  personaCatalog,
  dominantPersonas,
  personaTendencyRule,
} from './feedback-persona.js';
import { getLocale } from '../web/i18n/locale.js';

import { PixelPersona } from './PixelPersona.js';
import { FeedbackRadar } from './FeedbackRadar.js';
import { FeedbackAchievements } from './FeedbackAchievements.js';
import { useVbtiCommunity } from '../web/useVbtiCommunity.js';
import { communityUsers, publiclyRevealed } from './vbti-community.js';
export function FeedbackPersona({ report }: { report: PersonalFeedback }) {
  const matches = feedbackPersonas(report),
    leaders = dominantPersonas(matches),
    persona = leaders[0],
    activity = report.activity,
    history = report.personaHistory;
  const community = useVbtiCommunity(report.kind !== 'subscription');
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const catalogIndex = selected ? personaCatalog.findIndex((p) => p[0] === selected) : -1;
  const preview = catalogIndex >= 0 ? personaCatalog[catalogIndex] : null;
  const selectedMatch = matches.find((p) => p.code === selected);
  const revealed = (code: string) =>
    matches.some((p) => p.code === code) ||
    (history?.status === 'available' && history.types.some((p) => p.code === code && p.days > 0));
  const labels = {
    accepted: '已验收工作量',
    tokens: '工作 Token 用量',
    equivalent: 'API 等值价值',
  };
  if (report.kind === 'subscription') return null;
  return (
    <section className="pf-persona" aria-label="AI 打工人图鉴">
      <div className="pf-persona-topline">
        <span>AI 打工人图鉴</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setSelected(null);
          }}
        >
          {open ? '收起图鉴' : '查看 32 种类型'}
        </button>
      </div>
      <div className="pf-persona-main">
        {persona ? (
          <>
            <div className="pf-pixel-stage">
              <PixelPersona index={persona.sprite} />
              <span className="pf-pixel-code">{persona.code}</span>
            </div>
            <div className="pf-persona-copy">
              <span className="pf-eyebrow">
                {leaders.length > 1 ? '并列工作倾向' : '本次主类型'}
              </span>
              <h3>
                {leaders
                  .slice(0, 2)
                  .map((p) => p.name)
                  .join(' × ')}
              </h3>
              {leaders.length > 2 && <small>还有 {leaders.length - 2} 个接近方向</small>}
              <p>{persona.line}</p>
              <details>
                <summary>为什么是这个类型</summary>
                {persona.evidence.map((text, i) => (
                  <p key={i}>{text}</p>
                ))}
                <p>
                  排序分 = 倾向值 × 已知覆盖率 × n /（n + 3）。n 是对应记录数；占比、密度转换为
                  0–100，缺失不记零。
                </p>
                <p>
                  最高分相差不超过 5 分且达到最高分的
                  85%，展示并列倾向。分数描述工作方式，不是能力或人群排名。
                </p>
                <small>来自本次记录的工作特点，不代表能力评分或人格测试。</small>
              </details>
            </div>
          </>
        ) : (
          <div className="pf-persona-copy">
            <h3>角色还在加载人生</h3>
            <p>这份记录还不足以计算主类型。已记录的特点仍会保留。</p>
          </div>
        )}
      </div>
      {matches.some((p) => p.score !== null) && (
        <div className="vbti-tendency-list" aria-label="角色倾向数值">
          {matches
            .filter((p) => p.score !== null)
            .slice(0, 5)
            .map((p) => (
              <div key={p.code}>
                <span>{p.name}</span>
                <meter min={0} max={100} value={p.score!} aria-label={p.name} />
                <b>{p.score!.toFixed(1)}</b>
              </div>
            ))}
          <small>倾向占比结合记录覆盖率与样本量，数值接近时并列展示。</small>
        </div>
      )}
      <div className="vbti-trait-tags" aria-label="工作特点标签">
        {matches.slice(0, 8).map((p) => (
          <button
            key={p.code}
            onClick={() => {
              setOpen(true);
              setSelected(p.code);
            }}
          >
            <span aria-hidden="true">✦</span>
            {p.name}
          </button>
        ))}
        {matches.length > 8 && <button onClick={() => setOpen(true)}>查看全部特点</button>}
      </div>
      <FeedbackRadar report={report} />
      <FeedbackAchievements report={report} />
      {open && (
        <div className="pf-persona-collection">
          <p>你的已解锁角色可以直接查看；其他角色满 100 人后公开名称与条件。</p>
          {preview && (
            <div
              className={revealed(preview[0]) ? 'pf-persona-preview' : 'pf-persona-preview locked'}
            >
              <PixelPersona index={catalogIndex} />
              <div>
                <small>
                  {selectedMatch
                    ? '本次已匹配'
                    : revealed(preview[0])
                      ? '历史已解锁'
                      : '未解锁 · 神秘角色'}
                </small>
                <h4>
                  {revealed(preview[0]) || publiclyRevealed(community, preview[0])
                    ? preview[1]
                    : '？？？'}
                </h4>
                <p>
                  {revealed(preview[0]) || publiclyRevealed(community, preview[0])
                    ? preview[2]
                    : '？？？'}
                </p>
                <p>
                  {revealed(preview[0]) || publiclyRevealed(community, preview[0])
                    ? personaTendencyRule(preview[0])
                    : '？？？'}
                </p>
                {selectedMatch?.evidence.map((e, i) => (
                  <small key={i}>{e}</small>
                ))}
              </div>
            </div>
          )}
          <div className="pf-persona-catalog">
            {personaCatalog.map(([code, name], index) => {
              const matched = matches.some((p) => p.code === code);
              return (
                <button
                  type="button"
                  key={code}
                  className={matched ? 'matched' : revealed(code) ? 'revealed' : 'locked'}
                  aria-pressed={selected === code}
                  onClick={() => setSelected(code)}
                >
                  <PixelPersona index={index} small />
                  <strong>
                    {revealed(code) || publiclyRevealed(community, code) ? name : '？？？'}
                  </strong>
                  <small>{matched ? '本次已匹配' : revealed(code) ? '历史已解锁' : '未解锁'}</small>
                  <small>
                    {communityUsers(community, code) === null
                      ? '人数统计中'
                      : `${communityUsers(community, code)} 人解锁`}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {activity && (
        <div className="pf-activity-grid">
          {activity.metrics.map((m) => (
            <div key={m.id}>
              <span>{labels[m.id]}</span>
              {m.abovePercent !== null ? (
                <>
                  <strong>
                    高于 {m.abovePercent.toLocaleString(getLocale(), { maximumFractionDigits: 1 })}%
                  </strong>
                  <small>{m.sources} 个同条件来源</small>
                </>
              ) : (
                <>
                  <strong>排名积累中</strong>
                  <small>{m.value === null ? '本次用量未记录' : '可比样本不足，稍后再看'}</small>
                </>
              )}
            </div>
          ))}
          <details>
            <summary>比较范围</summary>
            <p>
              按相同任务条件、完全相同采集起止时间的已核验来源比较，每个来源取一份完整记录，排除本人及已知同源。至少
              5 个来源才显示位置；相同数值不算超过。
            </p>
            <p>Token 和等值金额描述使用规模，不代表效率或实际赚到的钱。</p>
            {activity.window && (
              <p>
                {new Date(activity.window.startAt).toLocaleString(getLocale())} —{' '}
                {new Date(activity.window.endAt).toLocaleString(getLocale())}
              </p>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
