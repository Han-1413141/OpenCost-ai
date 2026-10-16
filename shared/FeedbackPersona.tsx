import { useState } from 'react';
import type { PersonalFeedback } from './personal-feedback.js';
import { feedbackPersonas, personaCatalog } from './feedback-persona.js';
import { getLocale } from '../web/i18n/locale.js';

import { PixelPersona } from './PixelPersona.js';
import { FeedbackRadar } from './FeedbackRadar.js';
export function FeedbackPersona({ report }: { report: PersonalFeedback }) {
  const matches = feedbackPersonas(report),
    persona = matches[0],
    activity = report.activity,
    history = report.personaHistory;
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const catalogIndex = selected ? personaCatalog.findIndex((p) => p[0] === selected) : -1;
  const preview = catalogIndex >= 0 ? personaCatalog[catalogIndex] : null;
  const selectedMatch = matches.find((p) => p.code === selected);
  const revealed = (code: string) =>
    matches.some((p) => p.code === code) ||
    (history?.status === 'available' && history.types.some((p) => p.code === code && p.days > 0));
  const best = history?.types[0],
    days = best?.days ?? 0;
  const unlocked = history?.status === 'available';
  const weekly = unlocked && days >= 7,
    monthly = unlocked && days >= 28;
  const longName = best ? personaCatalog.find((p) => p[0] === best.code)?.[1] : null;
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
              <span className="pf-eyebrow">本次工作称号</span>
              <h3>{persona.name}</h3>
              <p>{persona.line}</p>
              <details>
                <summary>为什么是这个称号</summary>
                {persona.evidence.map((text, i) => (
                  <p key={i}>{text}</p>
                ))}
                <small>来自本次记录的工作特点，不代表能力评分或人格测试。</small>
              </details>
            </div>
          </>
        ) : (
          <div className="pf-persona-copy">
            <h3>角色还在加载人生</h3>
            <p>这份记录还没有明确的类型特征，先逛逛图鉴。</p>
          </div>
        )}
      </div>
      {matches.length > 1 && (
        <div className="pf-persona-badges">
          <span>你还有这些属性</span>
          {matches.slice(1, 6).map((p) => (
            <button
              type="button"
              key={p.code}
              onClick={() => {
                setOpen(true);
                setSelected(p.code);
              }}
            >
              {p.name}
            </button>
          ))}
          {matches.length > 6 && (
            <button type="button" onClick={() => setOpen(true)}>
              查看其余 {matches.length - 6} 种
            </button>
          )}
        </div>
      )}
      <FeedbackRadar report={report} />
      <div className="pf-persona-unlocks">
        <div>
          <span>长期称号</span>
          <strong>
            {monthly ? '月度常驻' : weekly ? '七日常驻' : '正在积累'}
            {(weekly || monthly) && longName ? <> · {longName}</> : null}
          </strong>
          <small>
            {history?.status === 'incomplete' ? (
              '历史读取未完整，暂不授予长期称号'
            ) : history?.status === 'invalid' ? (
              '记录日期需核对，暂不累计天数'
            ) : history ? (
              <>
                {longName ?? '类型'} · 已出现 {days} 天，近 30 天有 {history.observedDays} 天记录
              </>
            ) : (
              '上传每日摘要后，按不同日期累计称号。'
            )}
          </small>
        </div>
        <div className="pf-persona-progress">
          <div>
            <span>七日常驻</span>
            <b>{Math.min(days, 7)} / 7</b>
          </div>
          <progress value={Math.min(days, 7)} max={7} aria-label="七日称号进度" />
          <div>
            <span>月度常驻</span>
            <b>{Math.min(days, 28)} / 28</b>
          </div>
          <progress value={Math.min(days, 28)} max={28} aria-label="月度称号进度" />
        </div>
        <details>
          <summary>称号怎么累计</summary>
          <p>
            同一类型在最近 30 天内出现至少 7 个不同日期，获得七日常驻；出现至少 28
            个日期，获得月度常驻。同一天只取最后一份有效修订，缺少记录不补算，不要求连续签到。
          </p>
        </details>
      </div>
      {open && (
        <div className="pf-persona-collection">
          <p>点开剪影看解锁条件。记录命中后，角色就会亮起。</p>
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
                <h4>{preview[1]}</h4>
                <p>{preview[2]}</p>
                <p>{preview[3]}</p>
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
                  <strong>{name}</strong>
                  <small>{matched ? '本次已匹配' : revealed(code) ? '历史已解锁' : '未解锁'}</small>
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
