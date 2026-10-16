import { useEffect, useRef, useState } from 'react';
import { PixelPersona } from '../../shared/PixelPersona.js';
import { personaCatalog } from '../../shared/feedback-persona.js';
import type { SourceManifest } from '../../shared/source.js';
import { VBTIMark } from '../VBTIEntry.js';
import { VBTIPersonaCarousel } from '../VBTIPersonaCarousel.js';
import { useVbtiMotion } from '../useVbtiMotion.js';
import { t } from '../i18n/locale.js';
import { RedactionExample } from '../RedactionExample.js';
import { useVbtiCommunity } from '../useVbtiCommunity.js';
import { communityUsers, publiclyRevealed } from '../../shared/vbti-community.js';
import '../vbti.css';
import '../vbti-motion.css';
const benefits = [
  ['01', '你的 VBTI 类型', '解锁像素角色和六维工作画像，看看你怎么带 AI 干活。'],
  ['02', '适合你的模型', '结合你的工作类型，比较模型与 Harness 的实际成本。'],
  ['03', '值得买的套餐', '按工作量和已记录费用，寻找性价比更合适的套餐。'],
  ['04', '额度有没有缩水', '对比同一套餐的历史额度，区分额度变化、使用和重置。'],
  ['05', '同套餐里什么水平', '看你的额度与同类样本平均值差多少，处于什么位置。'],
] as const;
export function VBTI({ source, test = false }: { source: SourceManifest | null; test?: boolean }) {
  const [motion, setMotion] = useState(
    () =>
      !test &&
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('motion') === '1',
  );
  const [motionPaused, setMotionPaused] = useState(false);
  useEffect(() => {
    const updateMode = () => {
      setMotion(!test && new URLSearchParams(location.search).get('motion') === '1');
      setMotionPaused(false);
    };
    updateMode();
    window.addEventListener('popstate', updateMode);
    return () => window.removeEventListener('popstate', updateMode);
  }, [test]);
  const motionRoot = useVbtiMotion(motion, motionPaused);
  const community = useVbtiCommunity(!test);
  const [range, setRange] = useState('3d'),
    [analysis, setAnalysis] = useState(true),
    [quota, setQuota] = useState(false),
    [statistics, setStatistics] = useState(false),
    [copied, setCopied] = useState(false),
    [selected, setSelected] = useState<number | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const sourceReady = !!(source?.repository && source.revision);
  const skill = sourceReady
    ? `${source!.repository}/blob/${source!.revision}/skills/opencost-contribute/SKILL.md`
    : '';
  const destination = typeof location === 'undefined' ? '' : location.origin;
  const ranges: Record<string, string> = {
    '1d': '近一天',
    '3d': '近三天',
    '7d': '近一周',
    '30d': '近一个月',
  };
  const prompt = [
    t(
      '我想参加 OpenCost-AI 的 VBTI 活动，请使用下面的开源 Skill 整理当前 Harness 的真实工作记录。',
    ),
    `${t('站点')}：${destination}`,
    `Skill：${skill}`,
    `${t('采集范围')}：${t(ranges[range])}。`,
    t('先说明可读取的来源和预计消耗，再生成脱敏预览；我确认内容后再上传。不要增加或美化任务量。'),
    analysis
      ? t(
          '开启扩展分析：在已授权范围内提取任务要求、方法和结构，附加已选择的代码数值报告。只保留固定分类和数值，不上传原文、源码、路径或身份信息；未知项留空，不额外启动模型难度评审。',
        )
      : t('附加任务分析保持关闭，只整理已有工作类型、用量和代理记录。'),
    quota
      ? t(
          '我选择了解套餐额度监测，请先让我选择具体订阅来源；只读已授权的额度信息，保留历史和重置记录。',
        )
      : t('套餐额度监测保持关闭。'),
    statistics
      ? t('我选择参与脱敏统计；上传前请分别展示工作摘要和订阅额度的统计选项，按我的选择准备预览。')
      : t('本次只保存私人摘要，不参与公开统计。'),
    t(
      '自动运行和自动上传保持关闭。上传工作摘要成功后，给我回执中直接进入 VBTI 类型结果的 vbtiUrl；不要使用订阅额度报告链接代替。仅上传订阅记录时，说明还需要工作摘要。不要把凭证放进公开摘要。',
    ),
  ].join('\n\n');
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      field.current?.focus();
      field.current?.select();
    }
  }
  return (
    <div className={motion ? 'vbti-page vbti-motion' : 'vbti-page'} ref={motionRoot}>
      {motion && (
        <div className="vbti-motion-switch">
          <span>VBTI / MOTION EDITION</span>
          <div>
            <span>动效版</span>
            <button
              type="button"
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused((value) => !value)}
            >
              {motionPaused ? '继续动效' : '暂停动效'}
            </button>
            <a href="/vbti/">查看原版 ↗</a>
          </div>
        </div>
      )}
      {test ? (
        <>
          <header className="vbti-test-header">
            <VBTIMark />
            <div>
              <span className="vbti-event-label">VIBE CODING · TYPE INDICATOR</span>
              <h1>让真实记录，替你作答。</h1>
              <p>复制提示词到你常用的 Harness，查看预览，再决定上传。</p>
            </div>
          </header>
          <div className="vbti-test-layout">
            <section className="vbti-setup">
              <h2>选好范围，开始整理</h2>
              <label className="vbti-range">
                采集范围
                <select
                  value={range}
                  onChange={(e) => {
                    setRange(e.target.value);
                    setCopied(false);
                  }}
                >
                  {Object.entries(ranges).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="vbti-cost-note">
                {range === '7d' || range === '30d'
                  ? '范围越长，整理摘要消耗的额度通常越多。'
                  : '整理摘要会使用当前 Harness 的额度。'}
              </p>
              <div className="vbti-option-row">
                <label className="vbti-option">
                  <input
                    type="checkbox"
                    checked={analysis}
                    onChange={(e) => {
                      setAnalysis(e.target.checked);
                      setCopied(false);
                    }}
                  />
                  <span>
                    <b>扩展脱敏分析</b>
                    <small>分析任务要求、拆解方式，以及你选定的代码统计指标。</small>
                  </span>
                </label>
                <button
                  type="button"
                  className="vbti-option-benefit"
                  data-selected={analysis}
                  aria-pressed={analysis}
                  aria-label="扩展脱敏分析"
                  onClick={() => {
                    setAnalysis((value) => !value);
                    setCopied(false);
                  }}
                >
                  <span>{analysis ? '已选择' : '开启后可获得'}</span>
                  <b>看清你的 AI 工作风格</b>
                  <span className="vbti-option-benefit-description">
                    从任务特点、拆解方式、工具使用和代理协作中，识别你的 VBTI
                    类型，绘制六维工作画像。
                  </span>
                </button>
              </div>
              <div className="vbti-option-row">
                <label className="vbti-option">
                  <input
                    type="checkbox"
                    checked={quota}
                    onChange={(e) => {
                      setQuota(e.target.checked);
                      setCopied(false);
                    }}
                  />
                  <span>
                    <b>套餐额度监测</b>
                    <small>选择订阅来源后，记录额度变化和重置。</small>
                  </span>
                </label>
                <button
                  type="button"
                  className="vbti-option-benefit"
                  data-selected={quota}
                  aria-pressed={quota}
                  aria-label="套餐额度监测"
                  onClick={() => {
                    setQuota((value) => !value);
                    setCopied(false);
                  }}
                >
                  <span>{quota ? '已选择' : '开启后可获得'}</span>
                  <b>同套餐中你的额度是否暗中削减或高于平均额度</b>
                  <span className="vbti-option-benefit-description">
                    对比同一套餐的历史额度和其他用户的额度，查看变化趋势、所在位置，以及与平均值相差多少。
                  </span>
                </button>
              </div>
              <div className="vbti-option-row">
                <label className="vbti-option">
                  <input
                    type="checkbox"
                    checked={statistics}
                    onChange={(e) => {
                      setStatistics(e.target.checked);
                      setCopied(false);
                    }}
                  />
                  <span>
                    <b>参与脱敏统计</b>
                    <small>将选定的脱敏数据用于公开汇总；关闭后仍可查看个人反馈。</small>
                  </span>
                </label>
                <button
                  type="button"
                  className="vbti-option-benefit"
                  data-selected={statistics}
                  aria-pressed={statistics}
                  aria-label="参与脱敏统计"
                  onClick={() => {
                    setStatistics((value) => !value);
                    setCopied(false);
                  }}
                >
                  <b>获得性价比建议</b>
                  <span className="vbti-option-benefit-description">
                    结合你的工作类型、Token 用量和费用，比较不同模型与 Harness
                    的使用成本，推荐更划算的模型组合和订阅套餐。
                  </span>
                </button>
              </div>
              <div className="vbti-prompt-head">
                <h3>发给你正在用的 AI</h3>
                <button className="vbti-button" disabled={!sourceReady} onClick={() => void copy()}>
                  {copied ? '已复制' : '复制提示词'}
                </button>
              </div>
              {sourceReady ? (
                <textarea
                  ref={field}
                  readOnly
                  value={prompt}
                  aria-label="VBTI 收集提示词"
                  rows={12}
                  spellCheck={false}
                />
              ) : (
                <p role="status">正在读取 Skill…</p>
              )}
              <a className="vbti-text-link" href="/vbti/result/">
                已有上传记录，查看结果 →
              </a>
            </section>
            <aside className="vbti-privacy">
              <RedactionExample />
              <section className="vbti-privacy-highlight" aria-label="隐私保护与开源审查">
                <div className="vbti-privacy-heading">
                  <svg viewBox="0 0 24 28" aria-hidden="true" shapeRendering="crispEdges">
                    <path fill="#547a65" d="M8 1h8v3h7v12h-3v5h-4v4h-4v3H8v-3H4v-4H1V4h7z" />
                    <path fill="#eaf6e5" d="M5 12h3v3h3v-3h3V9h4v4h-3v3h-3v3H8v-3H5z" />
                  </svg>
                  <div>
                    <span>隐私保护</span>
                    <h2>原文、源码不上传本站</h2>
                  </div>
                </div>
                <p>只上传工作分类、数量与用量。</p>
                <div className="vbti-source-review">
                  <strong>开源，随时可以审查</strong>
                  {sourceReady ? (
                    <div className="vbti-review-links">
                      <a href={skill} target="_blank" rel="noreferrer">
                        审查 Skill 提示词 ↗
                      </a>
                      <a href={source!.repository!} target="_blank" rel="noreferrer">
                        审查用户端源码 ↗
                      </a>
                    </div>
                  ) : (
                    <p role="status">开源地址正在读取。</p>
                  )}
                </div>
              </section>
              <details>
                <summary>上传哪些信息</summary>
                <p>
                  工作类别、数量、Token、轮次、代理参与和公开产品型号。费用、套餐额度及附加分析按你的选择记录。
                </p>
              </details>
              <details>
                <summary>隐私保护与数据用途</summary>
                <p>摘要用于生成你的类型、个人反馈，以及你选择参与的性价比和额度统计。</p>
                <p>私人记录通过凭证或已关联账号访问，不对其他用户公开。我们不出售个人记录。</p>
                <p>
                  任务原文、完整对话、源代码、文件路径、账号密码和 API
                  密钥不上传本站。原始材料由你选择的 Harness 和模型服务处理。
                </p>
              </details>
              <details>
                <summary>多久能看到结果</summary>
                <p>
                  上传后查看本次结果。七日和月度成就分别需要 7 个、28
                  个记录日；同类样本不足的比较显示“稍后再看”。
                </p>
              </details>
            </aside>
          </div>
        </>
      ) : (
        <>
          <header className="vbti-hero">
            <div className="vbti-hero-copy">
              <span className="vbti-event-label vbti-level-label">
                <span aria-hidden="true">✦</span> VIBE CODING · PLAYER SELECT
              </span>
              <h1 className="vbti-main-title">
                <span>Vibe Coding</span>
                <strong>人格测试</strong>
              </h1>
              <p>
                根据你与 AI 的真实工作记录，分析你的协作风格。
                <br />
                找到你的 VBTI 类型，解锁对应的像素角色。
              </p>
              <div className="vbti-hero-signature">
                <VBTIMark />
                <span className="vbti-expansion">
                  <b>Vibe coding</b> Type Indicator
                </span>
              </div>
              <div className="vbti-hero-actions">
                <a className="vbti-button" href="/vbti/test/">
                  开始测试
                </a>
                <a href="/vbti/result/">查看我的结果</a>
                {!motion && (
                  <a className="vbti-motion-link" href="/vbti/?motion=1">
                    体验动效版 ↗
                  </a>
                )}
              </div>
              <small>先在本机整理脱敏摘要，确认后再上传。</small>
            </div>
            <VBTIPersonaCarousel motion={motion} motionPaused={motionPaused} />
          </header>
          <div className="vbti-quest-steps" aria-label="测试流程">
            <span>
              <b>01</b> 选择 AI 工作记录
            </span>
            <i aria-hidden="true">→</i>
            <span>
              <b>02</b> 确认脱敏摘要
            </span>
            <i aria-hidden="true">→</i>
            <span>
              <b>03</b> 查看你的类型与建议
            </span>
          </div>
          <section className="vbti-benefits">
            <div className="vbti-section-heading">
              <span>不止一个称号</span>
              <h2>测完之后，你能看到什么</h2>
            </div>
            <div>
              {benefits.map(([n, title, body]) => (
                <article key={n}>
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="vbti-public-collection">
            <div className="vbti-section-heading">
              <span>角色图鉴</span>
              <h2>下一位神秘角色，等你发现。</h2>
            </div>
            <p>每种角色满 100 人解锁后，公开名称与条件。</p>
            {selected !== null && (
              <div className="vbti-character-rule">
                <b>
                  {publiclyRevealed(community, personaCatalog[selected][0])
                    ? personaCatalog[selected][1]
                    : '？？？'}
                </b>
                <span>
                  {publiclyRevealed(community, personaCatalog[selected][0])
                    ? personaCatalog[selected][3]
                    : '？？？'}
                </span>
                <a href="/vbti/test/">去解锁 →</a>
              </div>
            )}
            <div className="vbti-character-grid">
              {personaCatalog.map(([code, name], i) => (
                <button
                  type="button"
                  className="locked"
                  key={code}
                  aria-pressed={selected === i}
                  onClick={() => setSelected(i)}
                >
                  <PixelPersona index={i} small />
                  <b>{publiclyRevealed(community, code) ? name : '？？？'}</b>
                  <small>
                    {communityUsers(community, code) === null
                      ? '人数统计中'
                      : `${communityUsers(community, code)} 人解锁`}
                  </small>
                </button>
              ))}
            </div>
            <small>仅统计同意参与统计的已关联账号；同一账号每种角色计一次。</small>
          </section>
          <section className="vbti-bottom-cta">
            <div>
              <h2>不填问卷，把你做过的事带来。</h2>
              <p>一次看本次特点，一周看重复出现的工作方式。</p>
            </div>
            <a className="vbti-button" href="/vbti/test/">
              用 Skills 开始 →
            </a>
          </section>
        </>
      )}
    </div>
  );
}
