import { useRef, useState } from 'react';
import { PixelPersona } from '../../shared/PixelPersona.js';
import { personaCatalog } from '../../shared/feedback-persona.js';
import type { SourceManifest } from '../../shared/source.js';
import { VBTIMark } from '../VBTIEntry.js';
import { t } from '../i18n/locale.js';
import '../vbti.css';
const benefits = [
  ['01', '你的 VBTI 类型', '解锁像素角色和六维工作画像，看看你怎么带 AI 干活。'],
  ['02', '适合你的模型', '结合你的工作类型，比较模型与 Harness 的实际成本。'],
  ['03', '值得买的套餐', '按工作量和已记录费用，寻找性价比更合适的套餐。'],
  ['04', '额度有没有缩水', '对比同一套餐的历史额度，区分额度变化、使用和重置。'],
  ['05', '同套餐里什么水平', '看你的额度与同类样本平均值差多少，处于什么位置。'],
] as const;
export function VBTI({ source, test = false }: { source: SourceManifest | null; test?: boolean }) {
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
    t('我想参加 OpenCost 的 VBTI 活动，请使用下面的开源 Skill 整理当前 Harness 的真实工作记录。'),
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
      '自动运行和自动上传保持关闭。上传成功后给我程序生成的私人反馈链接，再引导我点击“VBTI 类型结果”。不要把凭证放进公开摘要。',
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
    <div className="vbti-page">
      <nav className="vbti-subnav">
        <a href={test ? '#vbti' : '#overview'}>{test ? '← VBTI 活动首页' : '← OpenCost 首页'}</a>
        <a href="#vbti-result">我的 VBTI 结果 →</a>
      </nav>
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
                  ? '范围越长，AI 整理可能消耗更多额度。建议先从近三天开始。'
                  : 'AI 整理会使用你当前 Harness 的额度；网站计算结果不额外调用模型。'}
              </p>
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
                  <small>默认开启，可关闭。整理任务要求、结构和已选代码数值；原文与源码不上传。</small>
                </span>
              </label>
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
                  <b>了解套餐额度监测</b>
                  <small>查看额度变化与同套餐位置；具体来源由你选择。</small>
                </span>
              </label>
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
                  <small>允许选定数据进入性价比、用量或额度汇总。默认只保存私人记录。</small>
                </span>
              </label>
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
                <p role="status">正在读取开源 Skill 来源，取得固定版本后即可复制。</p>
              )}
              <p>上传完成后，打开私人反馈链接，再点击“VBTI 类型结果”。</p>
              <a className="vbti-text-link" href="#vbti-result">
                已有上传记录，查看结果 →
              </a>
            </section>
            <aside className="vbti-privacy">
              <h2>你的记录，用在这些地方</h2>
              <p>
                生成你的 VBTI
                类型、工作画像和个人反馈；你同意参与统计的数据，用于模型与套餐性价比、用量和额度比较。
              </p>
              <div className="vbti-privacy-item">
                <b>上传的是结构摘要</b>
                <p>
                  工作类别、数量、Token、轮次、代理参与和公开产品型号。费用、套餐额度及附加分析按你的选择记录。
                </p>
              </div>
              <div className="vbti-privacy-item">
                <b>业务原文不上传本站</b>
                <p>
                  不收集任务原文、完整对话、源代码、文件路径、账号密码和 API 密钥。先在当前 Harness
                  整理，再用字段白名单和程序校验检查上传内容。
                </p>
              </div>
              <details>
                <summary>隐私保护与数据用途</summary>
                <p>
                  上传前可以检查完整字段和预览。你的结果通过访问凭证或已关联账号读取；私人链接请自己保管。
                </p>
                <p>
                  我们不出售个人记录，不把私人摘要公开给其他用户，也不把它用于与上述用途无关的画像。参与统计是单独选项；公开展示的是符合条件的汇总，样本不足就不显示位置。
                </p>
                <p>
                  脱敏保留了工作类型、用量等统计信息，并非完全不含个人特征。原始材料如何处理，还取决于你使用的
                  Harness 及其模型服务。
                </p>
              </details>
              <details>
                <summary>开源，可以自己审查</summary>
                <p>
                  前端、后端和 Skills 提示词都在公开仓库。下面的 Skill
                  链接固定到具体提交，上传前可以检查它会读取什么、生成什么。
                </p>
                {sourceReady ? (
                  <>
                    <a href={skill} target="_blank" rel="noreferrer">
                      查看这版 Skill ↗
                    </a>
                    <a href={source!.repository!} target="_blank" rel="noreferrer">
                      查看完整源码 ↗
                    </a>
                    <code>{source!.revision!.slice(0, 12)}</code>
                  </>
                ) : (
                  <p>开源地址正在读取。</p>
                )}
              </details>
              <details>
                <summary>多久能看到结果</summary>
                <p>
                  上传后先得到本次记录能支持的类型与指标。七日和月度称号分别累计 7 个、28
                  个不同日期；模型、套餐和额度比较需要足够的同条件记录，暂缺时显示“稍后再看”。
                </p>
              </details>
            </aside>
          </div>
        </>
      ) : (
        <>
          <header className="vbti-hero">
            <div className="vbti-hero-copy">
              <span className="vbti-event-label">OPEN COST · VIBE CODING ACTIVITY</span>
              <VBTIMark />
              <span className="vbti-expansion">
                <b>Vibe coding</b> Type Indicator
              </span>
              <h1>你把 AI 带成了什么画风？</h1>
              <p>
                从真实工作里，找出你的类型。
                <br />
                32 个像素角色，等你的记录来点亮。
              </p>
              <div className="vbti-hero-actions">
                <a className="vbti-button" href="#vbti-test">
                  开始测试 →
                </a>
                <a href="#vbti-result">查看我的结果</a>
              </div>
              <small>Skills 整理 · 脱敏预览 · 程序计算</small>
            </div>
            <div className="vbti-hero-art" aria-label="等待解锁的神秘角色">
              <div className="vbti-hero-orbit" />
              {[0, 3, 30].map((index, i) => (
                <div className={`vbti-mystery mystery-${i}`} key={index}>
                  <PixelPersona index={index} />
                  <span>?</span>
                </div>
              ))}
              <div className="vbti-hero-sticker">
                32 TYPES
                <br />
                <b>WHO ARE YOU?</b>
              </div>
            </div>
          </header>
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
            <small>比较只使用同条件记录。样本不足时显示“稍后再看”，不编造排名和推荐。</small>
          </section>
          <section className="vbti-public-collection">
            <div className="vbti-section-heading">
              <span>角色图鉴</span>
              <h2>名字先见面，真身靠记录解锁。</h2>
            </div>
            {selected !== null && (
              <div className="vbti-character-rule">
                <b>{personaCatalog[selected][1]}</b>
                <span>{personaCatalog[selected][3]}</span>
                <a href="#vbti-test">去解锁 →</a>
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
                  <b>{name}</b>
                  <small>未解锁</small>
                </button>
              ))}
            </div>
          </section>
          <section className="vbti-bottom-cta">
            <div>
              <h2>不填问卷，把你做过的事带来。</h2>
              <p>一次看本次特点，一周看重复出现的工作方式。</p>
            </div>
            <a className="vbti-button" href="#vbti-test">
              用 Skills 开始 →
            </a>
          </section>
        </>
      )}
    </div>
  );
}
