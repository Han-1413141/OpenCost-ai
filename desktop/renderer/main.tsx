import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeLocale, useLocale } from '../../web/i18n/locale';
import { LanguageSelector } from '../../web/i18n/LanguageSelector';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clipboard,
  CloudUpload,
  GitBranch,
  Grid2X2,
  Layers3,
  Link2,
  List,
  Maximize2,
  Minus,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
  Pause,
  ChartNoAxesCombined,
  RefreshCw,
  KeyRound,
  BookOpen,
} from 'lucide-react';
import type { Snapshot, Settings } from '../model.js';
import type { DailySummary, SummaryTask } from '../../shared/desktop-summary.js';
import { summaryTaskStatusLabel } from '../../shared/summary-task-labels.js';
import { labels, domainLabels, taskDomain } from '../../shared/task-labels.js';
import { workActivities, workDomainForType, workUnits } from '../../shared/work-taxonomy.js';
import './style.css';
import './daylight.css';
import { DeferredFeedbackPanel, QuotaReplayEntry } from '../../shared/DeferredPanels.js';
import { JournalAnalysisEntry } from '../../shared/JournalAnalysisEntry.js';
import { JournalTaskAnalysisSchema } from '../../shared/journal-analysis-schema.js';
const WorkStandards = React.lazy(() =>
  import('../../shared/WorkStandards.js').then((m) => ({ default: m.WorkStandards })),
);

const names: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  dsh: 'DSH',
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmt = (n: number | null) => (n === null ? '未知' : n.toLocaleString('zh-CN'));
const taskName = (t: SummaryTask) =>
  workActivities.find((a) => a.id === t.workType)?.label ?? labels.kind[t.kind];
const taskGroup = (t: SummaryTask) =>
  workDomainForType(t.workType)?.label ?? domainLabels[taskDomain(t.kind)];
const amount = (t: SummaryTask) =>
  t.reportedCompleted === null
    ? '完成量未记录'
    : `${fmt(t.reportedCompleted)} ${workUnits[t.unit]}`;
const shortDate = (day: string) => day.slice(5).replace('-', '.');
const hue = ['#6b9c79', '#679bb0', '#b99a60', '#9d88b4', '#b28a9e', '#7f9bba'];

function App() {
  useLocale();
  const [s, setS] = useState<Snapshot | null>(null),
    [error, setError] = useState('');
  const [view, setView] = useState('journal'),
    [day, setDay] = useState(today()),
    [mode, setMode] = useState('map');
  const [selected, setSelected] = useState<number | null>(null),
    [promptOpen, setPromptOpen] = useState(false),
    [copied, setCopied] = useState(false);
  const load = () =>
    window.opencost
      .snapshot()
      .then(setS)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    return window.opencost.subscribe(load);
  }, []);
  const act = async (cmd: string, data?: unknown) => {
    setError('');
    try {
      const r = await window.opencost.invoke(cmd, data);
      await load();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  };
  if (!s)
    return (
      <div className="loading">
        <span className="brand-symbol">◎</span> 正在打开工作日记…{error}
      </div>
    );
  if (location.hash === '#/approval') return <Approval s={s} act={act} error={error} />;
  const summary = s.summaries.find((v) => v.day === day),
    current = selected === null ? undefined : summary?.tasks[selected];
  const total =
    summary &&
    summary.measurements.inputTokens !== null &&
    summary.measurements.outputTokens !== null
      ? summary.measurements.inputTokens + summary.measurements.outputTokens
      : null;
  const pair = async () => {
    await act('pair-prompt');
    setPromptOpen(true);
    setCopied(false);
  };
  const shiftDay = (n: number) => {
    const d = new Date(day + 'T12:00:00');
    d.setDate(d.getDate() + n);
    setDay(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
    setSelected(null);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">◎</span>
          <div>
            OpenCost<small>WORK JOURNAL</small>
          </div>
        </div>
        <div className="workspace-tag">
          <span className="live-dot" />
          本机工作空间 <ShieldCheck size={15} />
        </div>
        <div className="nav-label">我的记录</div>
        <button
          className={'nav-item ' + (view === 'journal' ? 'active' : '')}
          onClick={() => setView('journal')}
        >
          <GitBranch size={19} />
          工作画布<span className="nav-count">{s.summaries.length}</span>
        </button>
        <button
          className={'nav-item ' + (view === 'days' ? 'active' : '')}
          onClick={() => setView('days')}
        >
          <CalendarDays size={19} />
          每日回顾
        </button>
        <button
          className={'nav-item ' + (view === 'feedback' ? 'active' : '')}
          onClick={() => setView('feedback')}
        >
          <ChartNoAxesCombined size={19} />
          个人反馈
          {!!s.feedbackHistory?.length && (
            <span className="nav-count">{s.feedbackHistory.length}</span>
          )}
        </button>
        <div className="nav-label space-top">环境与授权</div>
        <button
          className={'nav-item ' + (view === 'standards' ? 'active' : '')}
          onClick={() => setView('standards')}
        >
          <BookOpen size={19} />
          统计标准
        </button>
        <button
          className={'nav-item ' + (view === 'bindings' ? 'active' : '')}
          onClick={() => setView('bindings')}
        >
          <Link2 size={19} />
          绑定 Harness
          <span className="nav-count">{s.bindings.filter((b) => b.enabled).length}</span>
        </button>
        <button
          className={'nav-item ' + (view === 'settings' ? 'active' : '')}
          onClick={() => setView('settings')}
        >
          <Settings2 size={19} />
          设置
        </button>
        <div className="sidebar-bottom">
          <div className="privacy-icon">
            <ShieldCheck size={20} />
          </div>
          <strong>记录留在本机</strong>
          <p>
            上传另行授权
            <br />
            难度分级保持关闭
          </p>
          <div className="disk">
            <span>本地存储</span>
            <b>{(s.storageBytes / 1048576).toFixed(1)} MB</b>
          </div>
        </div>
      </aside>
      <main className="main">
        <header>
          <div className="breadcrumbs">
            个人空间 <ChevronRight size={13} />{' '}
            {view === 'settings'
              ? '应用设置'
              : view === 'bindings'
                ? 'Harness 环境'
                : view === 'feedback'
                  ? '个人反馈'
                  : view === 'standards'
                    ? '统计标准'
                    : '工作日记'}
          </div>
          <div className="header-right">
            <LanguageSelector />
            <span className="reminder">
              <CircleDot size={13} />
              每天 {s.settings.dailyTime}
            </span>
            <span className="local-badge">LOCAL</span>
          </div>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {s.message && (
          <div className="notice">
            <Activity size={15} />
            {s.message}
          </div>
        )}
        {s.feedback && view === 'journal' && (
          <div className="notice">
            <ChartNoAxesCombined size={16} />
            上传后的工作与用量分析已保存
            <button onClick={() => setView('feedback')}>查看个人反馈</button>
          </div>
        )}
        {s.pending && (
          <div className="notice pending">
            <Sparkles size={16} />
            有一项{s.pending.kind === 'generate' ? '摘要生成' : '上传'}请求等待允许
            <button onClick={() => act('approve', s.pending!.id)}>允许本次</button>
            <button onClick={() => act('deny', s.pending!.id)}>跳过</button>
          </div>
        )}
        {view === 'standards' ? (
          <div className="standards-page">
            <React.Suspense fallback={<p>正在加载统计标准…</p>}>
              <WorkStandards />
            </React.Suspense>
          </div>
        ) : view === 'feedback' ? (
          <PersonalFeedbackView s={s} act={act} />
        ) : view === 'settings' ? (
          <SettingsView s={s} act={act} />
        ) : view === 'bindings' ? (
          <Bindings s={s} act={act} pair={pair} />
        ) : view === 'days' ? (
          <Days
            s={s}
            open={(d) => {
              setDay(d);
              setView('journal');
              setSelected(null);
            }}
          />
        ) : (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">YOUR WORK, CONNECTED</div>
                <h1>把今天的工作，连成一幅图。</h1>
                <p>沿着分支回看成果、用量与进展，让每一天都有迹可循。</p>
              </div>
              <button
                className="primary"
                disabled={s.busy || !!s.pending || day > today()}
                onClick={() => act('generate', day)}
              >
                <Sparkles size={17} />
                {s.busy ? '正在整理…' : '整理这一天'}
              </button>
            </section>
            <section className="stats-grid">
              <Metric
                icon={<Layers3 size={17} />}
                label="工作条目"
                value={summary ? String(summary.tasks.length) : '—'}
                note="合并同一来源，不等同验收任务量"
              />
              <Metric
                icon={<Zap size={17} />}
                label="已观察 Token"
                value={summary ? fmt(total) : '—'}
                note={
                  summary
                    ? `输入 ${fmt(summary.measurements.inputTokens)} · 输出 ${fmt(summary.measurements.outputTokens)}`
                    : '生成后从日志读取'
                }
              />
              <Metric
                icon={<Link2 size={17} />}
                label="已绑定环境"
                value={String(s.bindings.filter((b) => b.enabled).length)}
                note="支持绑定多个 Harness"
              />
              <Metric
                icon={<Activity size={17} />}
                label="活动跨度"
                value={
                  summary && summary.measurements.observedSpanMs !== null
                    ? `${(summary.measurements.observedSpanMs / 3600000).toFixed(1)} h`
                    : '—'
                }
                note="首末事件间隔，包含等待与空闲"
              />
            </section>
            <section className="canvas-section">
              <div className="canvas-bar">
                <div className="date-controls">
                  <button aria-label="前一天" onClick={() => shiftDay(-1)}>
                    <ChevronLeft size={17} />
                  </button>
                  <input
                    aria-label="选择摘要日期"
                    type="date"
                    value={day}
                    min={new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}
                    max={today()}
                    onChange={(e) => {
                      setDay(e.target.value);
                      setSelected(null);
                    }}
                  />
                  <button aria-label="后一天" disabled={day >= today()} onClick={() => shiftDay(1)}>
                    <ChevronRight size={17} />
                  </button>
                  <span className="date-label">
                    {day === today()
                      ? '今天的工作'
                      : `工作日记 · ${summary ? '修订 ' + summary.revision : '未整理'}`}
                  </span>
                </div>
                <div className="segmented">
                  <button
                    className={mode === 'map' ? 'selected' : ''}
                    onClick={() => setMode('map')}
                  >
                    <GitBranch size={15} />
                    思维导图
                  </button>
                  <button
                    className={mode === 'board' ? 'selected' : ''}
                    onClick={() => setMode('board')}
                  >
                    <Grid2X2 size={15} />
                    自由画布
                  </button>
                  <button
                    className={mode === 'list' ? 'selected' : ''}
                    onClick={() => setMode('list')}
                  >
                    <List size={15} />
                    时间线
                  </button>
                </div>
              </div>
              {mode === 'list' ? (
                <Timeline summary={summary} choose={setSelected} />
              ) : (
                <WorkCanvas
                  summary={summary}
                  day={day}
                  mode={mode}
                  choose={setSelected}
                  selected={selected}
                />
              )}
              <div className="canvas-footer">
                <span>
                  <ShieldCheck size={13} />
                  上传仅含固定类别与数值 · 对话整理结果 · 覆盖范围部分已知
                </span>
                {summary && (
                  <div>
                    <button onClick={() => act('export', summary.id)}>
                      <ArrowDownToLine size={14} />
                      导出 JSON
                    </button>
                    <button
                      disabled={s.busy || !!s.pending}
                      onClick={() => act('upload', summary.id)}
                    >
                      <CloudUpload size={14} />
                      {s.uploaded.includes(summary.id) ? '已上传' : '选择上传'}
                    </button>
                  </div>
                )}
              </div>
            </section>
            <section className="bottom-grid">
              <Heatmap
                summaries={s.summaries}
                open={(d) => {
                  setDay(d);
                  setSelected(null);
                }}
              />
              <div className="sources-card">
                <div className="section-title">
                  来源环境
                  <button onClick={() => setView('bindings')}>
                    管理 <ArrowRight size={13} />
                  </button>
                </div>
                {s.bindings.length ? (
                  s.bindings.slice(0, 4).map((b) => (
                    <div className="source-line" key={b.id}>
                      <span className={'harness-logo ' + b.harness}>{names[b.harness][0]}</span>
                      <div>
                        <strong>{names[b.harness]}</strong>
                        <small>{b.enabled ? '已绑定 · 按授权读取' : '已暂停'}</small>
                      </div>
                      <span className={b.enabled ? 'live-dot' : 'muted-dot'} />
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">
                    还没有绑定来源。复制提示词到常用 Harness，或手动选择会话日志目录。
                  </p>
                )}
                <button className="text-button" onClick={pair}>
                  <Plus size={14} />
                  复制绑定提示词
                </button>
              </div>
            </section>
          </>
        )}
      </main>
      {current && summary && (
        <div className="detail-panel">
          <div className="section-title">
            工作条目{' '}
            <button aria-label="关闭详情" onClick={() => setSelected(null)}>
              <X size={18} />
            </button>
          </div>
          <span className="eyebrow">{taskGroup(current)}</span>
          <h2>{taskName(current)}</h2>
          <JournalAnalysisEntry key={summary.id+current.sourceRefs.join(':')} summaryId={summary.id} sourceRefs={current.sourceRefs} analysis={current.analysis} onRead={async()=>JournalTaskAnalysisSchema.nullable().parse(await window.opencost.invoke('analysis-read',{summaryId:summary.id,sourceRefs:current.sourceRefs}))} onApply={async attachment=>{
            await window.opencost.invoke('analysis-attach',attachment);await load();
          }}/>
          <span className={'status ' + current.reportedStatus}>
            {summaryTaskStatusLabel(current)}
          </span>
          <div className="detail-value">
            <span>对话报告完成量</span>
            <strong>{amount(current)}</strong>
          </div>
          <div className="detail-value">
            <span>来源会话</span>
            <strong>{current.sourceRefs.length} 个匿名来源</strong>
          </div>
          <div className="detail-value">
            <span>来源 Harness</span>
            <strong>
              {summary.harnesses
                .map(
                  (h) =>
                    `${names[h.id] ?? h.id} · ${h.version === 'unknown' ? '版本未知' : h.version}`,
                )
                .join(' / ')}
            </strong>
          </div>
          <div className="detail-value">
            <span>已观察对话与工具</span>
            <strong>
              用户 {fmt(summary.measurements.userTurns)} 轮 · 助手{' '}
              {fmt(summary.measurements.assistantTurns)} 轮<br />
              工具调用 {fmt(summary.measurements.toolCalls)} 次
            </strong>
          </div>
          {summary.measurements.knownTokenSubtotals && (
            <div className="detail-value">
              <span>已观察 Token 与可计量小计</span>
              <strong>
                输入 {fmt(summary.measurements.inputTokens)} · 输出{' '}
                {fmt(summary.measurements.outputTokens)}
                <br />
                可计量小计：输入 {fmt(summary.measurements.knownTokenSubtotals.inputTokens)} · 输出{' '}
                {fmt(summary.measurements.knownTokenSubtotals.outputTokens)}
              </strong>
              <p>请求用量缺失时完整值为未知，小计不能代表完整消耗。</p>
            </div>
          )}
          <div className="detail-value">
            <span>已观察代理（含各层级）</span>
            <strong>
              {fmt(summary.measurements.agentCount)} 个 · 最大层级{' '}
              {fmt(summary.measurements.maxAgentDepth)}
              <br />
              仅限已识别的日志，不代表完整覆盖
            </strong>
          </div>
          <div className="detail-value">
            <span>本次摘要生成消耗</span>
            <strong>
              输入 {fmt(summary.processing.inputTokens)} · 输出{' '}
              {fmt(summary.processing.outputTokens)} Token
              <br />
              费用{' '}
              {summary.processing.costMinor === null ? '未知' : fmt(summary.processing.costMinor)}
            </strong>
          </div>
          <p>
            状态和完成量由模型根据对话整理，尚无独立验收证据。当天 Token
            仅按日志统一记录，不猜测每个条目的用量。未统计到的子代理、费用与版本保留未知。
          </p>
          <div className="source-hashes">
            {current.sourceRefs.map((r) => (
              <code key={r}>来源 {r.slice(0, 12)}…</code>
            ))}
          </div>
          <details>
            <summary>查看完整脱敏上传字段</summary>
            <pre>
              {JSON.stringify(
                { ...summary, consent: { ...summary.consent, store: true } },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
      {!s.settings.introduced && (
        <div className="modal-backdrop">
          <div className="welcome">
            <div className="welcome-art">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <span className="welcome-node node-a">工作</span>
              <span className="welcome-node node-b">Token</span>
              <span className="welcome-node node-c">Harness</span>
              <span className="welcome-core">◎</span>
              <span className="eyebrow">A LITTLE SPACE FOR EVERY DAY</span>
            </div>
            <div className="welcome-copy">
              <span className="eyebrow">欢迎来到 OPENCOST</span>
              <h1>
                工作有记录，
                <br />
                成果有脉络。
              </h1>
              <p>
                把已完成的工作整理成思维导图与自由画布。默认每天 <b>17:30</b>{' '}
                提醒，允许后才读取绑定日志和调用本地 Harness。
              </p>
              <div className="welcome-points">
                <div>
                  <Link2 size={18} />
                  <span>可在常用 Harness 中发送绑定提示词，支持绑定多个环境。</span>
                </div>
                <div>
                  <ShieldCheck size={18} />
                  <span>
                    上传只有固定工作类别、数量、状态、Token 与匿名来源标识，原始对话和路径不会上传。
                  </span>
                </div>
                <div>
                  <Layers3 size={18} />
                  <span>
                    网页、桌面应用、上传工具及 Skills 已开源，源码见 github.com/Han-1413141/OpenCost。
                  </span>
                </div>
              </div>
              <p className="fine-print">
                生成摘要可能消耗所选 Harness
                的额度。输入片段先在本地遮盖，名称等内容仍需由你判断；自动生成、自动上传、开机启动默认关闭。
              </p>
              <div className="welcome-actions">
                <button
                  className="primary"
                  onClick={async () => {
                    await act('finish-intro');
                    await pair();
                  }}
                >
                  复制绑定提示词 <ArrowRight size={16} />
                </button>
                <button onClick={() => act('finish-intro')}>进入工作日记</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {promptOpen && (
        <div className="modal-backdrop">
          <div className="prompt-modal">
            <div className="section-title">
              <h2>在常用 Harness 中绑定</h2>
              <button aria-label="关闭绑定提示词" onClick={() => setPromptOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <p>
              将下方提示词发到 Codex、Claude Code、OpenCode 或
              DSH，让它识别当前环境并登记日志目录。每个绑定码仅用一次，15
              分钟有效；绑定多个环境时重新生成提示词。
            </p>
            <textarea readOnly value={s.pairPrompt} />
            <div className="modal-actions">
              <button onClick={() => act('pair-prompt')}>生成新绑定码</button>
              <button
                className="primary"
                onClick={async () => {
                  await act('copy-prompt');
                  setCopied(true);
                }}
              >
                {copied ? <Check size={16} /> : <Clipboard size={16} />}{' '}
                {copied ? '已复制' : '复制提示词'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="metric">
      <div>
        {icon}
        {label}
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

type Node = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'root' | 'group' | 'task';
  label: string;
  subtitle: string;
  color: string;
  task?: number;
  parent?: string;
};
function WorkCanvas({
  summary,
  day,
  mode,
  choose,
  selected,
}: {
  summary?: DailySummary;
  day: string;
  mode: string;
  choose: (n: number) => void;
  selected: number | null;
}) {
  const area = useRef<HTMLDivElement>(null),
    [transform, setTransform] = useState({ x: 50, y: 65, z: 0.86 }),
    [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
    node?: string;
    nx?: number;
    ny?: number;
    moved: boolean;
  } | null>(null);
  const nodes = useMemo(() => {
    const tasks = summary?.tasks ?? [],
      groups = [...new Set(tasks.map(taskGroup))];
    const result: Node[] = [
      {
        id: 'root',
        x: 45,
        y: Math.max(170, groups.length * 105),
        w: 242,
        h: 112,
        type: 'root',
        label: `${shortDate(day)} · 工作日记`,
        subtitle: summary
          ? `${tasks.length} 条工作记录 · ${summary.harnesses.length} 个环境`
          : '等待整理今天的工作',
        color: '#6b9c79',
      },
    ];
    let row = 30;
    groups.forEach((g, gi) => {
      const children = tasks.map((t, i) => ({ t, i })).filter((v) => taskGroup(v.t) === g),
        color = hue[gi % hue.length],
        gid = 'group-' + gi,
        gy = row + (children.length - 1) * 65;
      result.push({
        id: gid,
        x: 340,
        y: gy,
        w: 196,
        h: 76,
        type: 'group',
        label: g,
        subtitle: `${children.length} 条工作记录`,
        color,
        parent: 'root',
      });
      children.forEach(({ t, i }, j) =>
        result.push({
          id: 'task-' + i,
          x: mode === 'board' ? 330 + (i % 2) * 375 : 590,
          y: mode === 'board' ? 60 + Math.floor(i / 2) * 146 : row + j * 130,
          w: 300,
          h: 108,
          type: 'task',
          label: taskName(t),
          subtitle: amount(t),
          color,
          task: i,
          parent: gid,
        }),
      );
      row += Math.max(150, children.length * 130) + 24;
    });
    if (mode === 'board') {
      result[0].x = 25;
      result[0].y = 50;
      result.forEach((n) => {
        if (n.type === 'group') {
          n.x = 30;
          n.y = 215 + groups.indexOf(n.label) * 145;
        }
      });
    }
    result[0].y = mode === 'map' ? Math.max(120, (row - 60) / 2 - 56) : 50;
    return result;
  }, [summary, day, mode]);
  const actual = nodes.map((n) => ({ ...n, ...positions[n.id] }));
  const fit = () => {
    const el = area.current;
    if (!el) return;
    if (!summary) return;
    const minX = Math.min(...actual.map((n) => n.x)),
      minY = Math.min(...actual.map((n) => n.y));
    const maxX = Math.max(...actual.map((n) => n.x + n.w)),
      maxY = Math.max(...actual.map((n) => n.y + n.h));
    const z = Math.max(
      0.12,
      Math.min(1, (el.clientWidth - 80) / (maxX - minX), (el.clientHeight - 70) / (maxY - minY)),
    );
    setTransform({
      x: (el.clientWidth - (maxX - minX) * z) / 2 - minX * z,
      y: (el.clientHeight - (maxY - minY) * z) / 2 - minY * z,
      z,
    });
  };
  useEffect(() => {
    const saved = localStorage.getItem('canvas:' + day + ':' + mode);
    try {
      setPositions(saved ? JSON.parse(saved) : {});
    } catch {
      setPositions({});
    }
    setTransform({ x: 45, y: 55, z: 0.86 });
  }, [day, mode, summary?.id]);
  useEffect(() => {
    const handle = setTimeout(fit, 50);
    return () => clearTimeout(handle);
  }, [nodes]);
  const zoom = (z: number, cx?: number, cy?: number) =>
    setTransform((t) => {
      const next = Math.max(0.12, Math.min(2, z));
      const x = cx ?? (area.current?.clientWidth ?? 600) / 2,
        y = cy ?? (area.current?.clientHeight ?? 400) / 2;
      return { x: x - ((x - t.x) * next) / t.z, y: y - ((y - t.y) * next) / t.z, z: next };
    });
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.node) {
      setPositions((p) => ({
        ...p,
        [d.node!]: { x: d.nx! + dx / transform.z, y: d.ny! + dy / transform.z },
      }));
    } else setTransform((t) => ({ ...t, x: d.tx + dx, y: d.ty + dy }));
  };
  useEffect(() => {
    const el = area.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect(),
        cx = e.clientX - box.left,
        cy = e.clientY - box.top;
      setTransform((t) => {
        const next = Math.max(0.12, Math.min(2, t.z * Math.exp(-e.deltaY * 0.0015)));
        return { x: cx - ((cx - t.x) * next) / t.z, y: cy - ((cy - t.y) * next) / t.z, z: next };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const end = () => {
    if (drag.current?.node && drag.current.moved)
      localStorage.setItem('canvas:' + day + ':' + mode, JSON.stringify(positions));
    drag.current = null;
  };
  return (
    <div
      className="work-canvas"
      ref={area}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          tx: transform.x,
          ty: transform.y,
          moved: false,
        };
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="canvas-space"
        style={{ transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.z})` }}
      >
        <svg className="connections" width="1" height="1" style={{ overflow: 'visible' }}>
          {actual
            .filter((n) => n.parent)
            .map((n) => {
              const p = actual.find((x) => x.id === n.parent)!;
              return (
                <path
                  key={n.id}
                  d={`M ${p.x + p.w} ${p.y + p.h / 2} C ${p.x + p.w + 50} ${p.y + p.h / 2}, ${n.x - 70} ${n.y + n.h / 2}, ${n.x} ${n.y + n.h / 2}`}
                  fill="none"
                  stroke={n.color}
                  strokeOpacity={mode === 'map' ? 0.6 : 0.24}
                  strokeWidth={2}
                />
              );
            })}
        </svg>
        {actual.map((n) => (
          <div
            key={n.id}
            className={'graph-node ' + n.type + (selected === n.task ? ' highlighted' : '')}
            style={
              {
                left: n.x,
                top: n.y,
                width: n.w,
                height: n.h,
                '--node-color': n.color,
              } as React.CSSProperties
            }
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                tx: transform.x,
                ty: transform.y,
                node: n.id,
                nx: n.x,
                ny: n.y,
                moved: false,
              };
            }}
            onPointerUp={() => {
              if (!drag.current?.moved && n.task !== undefined) choose(n.task);
              end();
            }}
          >
            <div className="node-top">
              {n.type === 'root' ? (
                <span className="node-logo">◎</span>
              ) : n.type === 'group' ? (
                <GitBranch size={16} />
              ) : (
                <CircleDot size={13} />
              )}
              <span>
                {n.type === 'root'
                  ? 'DAILY WORK'
                  : n.type === 'group'
                    ? '工作类别'
                    : summaryTaskStatusLabel(summary!.tasks[n.task!])}
              </span>
              {n.type === 'task' && <ArrowRight size={13} />}
            </div>
            <strong>{n.label}</strong>
            <small>{n.subtitle}</small>
            <span className="node-port" />
          </div>
        ))}
      </div>
      {!summary && (
        <div className="empty-canvas">
          <Sparkles size={22} />
          <strong>从今天的第一条工作记录开始</strong>
          <p>
            绑定环境后，点击「整理这一天」。允许调用后，
            <br />
            工作条目会自动连成分支。这里没有演示数据。
          </p>
        </div>
      )}
      {summary && !summary.tasks.length && (
        <div className="empty-canvas">
          <strong>已记录用量，没有可分类的工作片段</strong>
          <p>Token 仍保留在日记中，不编造工作条目。</p>
        </div>
      )}
      <div className="canvas-hint">
        <span className="live-dot" />
        拖动画布 · 滚轮缩放 · 拖动节点 · 点开详情
      </div>
      <div className="canvas-tools">
        <button aria-label="缩小" onClick={() => zoom(transform.z / 1.15)}>
          <Minus size={16} />
        </button>
        <span>{Math.round(transform.z * 100)}%</span>
        <button aria-label="放大" onClick={() => zoom(transform.z * 1.15)}>
          <Plus size={16} />
        </button>
        <i />
        <button aria-label="适配画布" onClick={fit}>
          <Maximize2 size={16} />
        </button>
        <button
          aria-label="重置节点排列"
          onClick={() => {
            setPositions({});
            localStorage.removeItem('canvas:' + day + ':' + mode);
          }}
        >
          <Layers3 size={16} />
        </button>
      </div>
    </div>
  );
}
function Timeline({ summary, choose }: { summary?: DailySummary; choose: (n: number) => void }) {
  return (
    <div className="timeline">
      {summary?.tasks.length ? (
        summary.tasks.map((t, i) => (
          <button key={i} className="timeline-row" onClick={() => choose(i)}>
            <span className="timeline-dot" style={{ background: hue[i % hue.length] }} />
            <div>
              <small>{taskGroup(t)}</small>
              <strong>{taskName(t)}</strong>
              <span>{amount(t)}</span>
            </div>
            <span className={'status ' + t.reportedStatus}>{summaryTaskStatusLabel(t)}</span>
            <ArrowRight size={16} />
          </button>
        ))
      ) : (
        <p>这一天还没有工作条目。时间线按条目分组展示；未记录准确时间时不猜先后顺序。</p>
      )}
      <div className="timeline-note">当前日志覆盖部分已知；时间线展示整理顺序，条目时间未知。</div>
    </div>
  );
}
function Heatmap({ summaries, open }: { summaries: DailySummary[]; open: (d: string) => void }) {
  const days = Array.from({ length: 91 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 90 + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  return (
    <div className="heatmap-card">
      <div className="section-title">
        工作足迹<span>过去 13 周 · 本地日记</span>
      </div>
      <div className="heatmap-layout">
        <div className="week-labels">
          <span>一</span>
          <span>三</span>
          <span>五</span>
          <span>日</span>
        </div>
        <div className="heatmap">
          {days.map((d) => {
            const s = summaries.find((x) => x.day === d);
            return (
              <button
                key={d}
                aria-label={d}
                title={`${d} · ${s?.tasks.length ?? 0} 个工作条目`}
                style={{
                  background: s
                    ? `rgba(169,237,153,${Math.min(0.9, 0.25 + s.tasks.length * 0.08)})`
                    : '',
                }}
                onClick={() => open(d)}
              />
            );
          })}
        </div>
      </div>
      <div className="heatmap-legend">
        <span>点击日期，回到当日画布</span>
        <div>
          少<i />
          <i />
          <i />
          <i />多
        </div>
      </div>
    </div>
  );
}
function Bindings({
  s,
  act,
  pair,
}: {
  s: Snapshot;
  act: (cmd: string, d?: unknown) => Promise<unknown>;
  pair: () => void;
}) {
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">YOUR HARNESSES</div>
          <h1>一个日记，连接多个环境。</h1>
          <p>绑定只登记会话来源，生成前仍按授权读取。</p>
        </div>
        <button className="primary" onClick={pair}>
          <Clipboard size={16} />
          复制绑定提示词
        </button>
      </section>
      <div className="binding-catalog">
        {s.harnesses.map((h) => (
          <div className="binding-option" key={h.id}>
            <span className={'harness-logo large ' + h.id}>{h.label[0]}</span>
            <div>
              <h2>{h.label}</h2>
              <p>{h.available ? '已检测到本地 CLI' : '未检测到 CLI；仍可绑定导出日志'}</p>
              <small>
                {h.id === 'opencode'
                  ? '请选择 session export 的专用 JSON 目录'
                  : h.id === 'dsh'
                    ? '支持会话 JSONL 或成本插件脱敏导出目录'
                    : '请选择会话 JSONL 日志目录'}
              </small>
            </div>
            <button onClick={() => act('bind', h.id)}>
              <Plus size={16} />
              绑定来源
            </button>
          </div>
        ))}
      </div>
      <div className="settings-card">
        <h2>已绑定来源</h2>
        {s.bindings.length ? (
          s.bindings.map((b) => (
            <div className="binding-row" key={b.id}>
              <span className={'harness-logo ' + b.harness}>{names[b.harness][0]}</span>
              <div>
                <strong>{names[b.harness]}</strong>
                <code>{b.source}</code>
              </div>
              <button
                className={b.enabled ? 'toggle on' : 'toggle'}
                aria-label={b.enabled ? '暂停来源' : '启用来源'}
                onClick={() => act('toggle-binding', { id: b.id, enabled: !b.enabled })}
              >
                <span />
              </button>
            </div>
          ))
        ) : (
          <p>复制提示词到你的常用 Harness，或选择来源目录。目录路径只保存在本机。</p>
        )}
        <p className="fine-print">
          增加或切换来源会恢复为每次询问。DSH 当前用于采集来源，摘要可由 Codex、Claude Code 或
          OpenCode 生成；不会修改 dsh-cost-meter 的开关。
        </p>
      </div>
    </>
  );
}
function SettingsView({
  s,
  act,
}: {
  s: Snapshot;
  act: (cmd: string, d?: unknown) => Promise<unknown>;
}) {
  const [form, setForm] = useState<Settings>(s.settings),
    [saved, setSaved] = useState(false);
  useEffect(() => setForm(s.settings), [s.settings]);
  const change = (key: keyof Settings, value: unknown) => {
    setForm((v) => ({ ...v, [key]: value }));
    setSaved(false);
  };
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">YOU ARE IN CONTROL</div>
          <h1>时间、来源、授权，都由你选择。</h1>
          <p>开机启动、自动生成与自动上传分别控制。</p>
        </div>
        <button
          className="primary"
          onClick={async () => {
            const ok = await act('settings', form);
            setSaved(ok === true);
          }}
        >
          <Check size={16} />
          {saved ? '已保存' : '保存设置'}
        </button>
      </section>
      <div className="settings-card">
        <h2>每天的提醒</h2>
        <div className="setting-row">
          <div>
            <strong>提醒时间</strong>
            <p>按本机时区，默认每天 17:30；休眠期间不重复补跑。</p>
          </div>
          <input
            type="time"
            value={form.dailyTime}
            onChange={(e) => change('dailyTime', e.target.value)}
          />
        </div>
        <SettingToggle
          label="启用每日提醒"
          note="默认在右下角弹窗。跳过后，当天不会反复提醒。"
          value={form.reminderEnabled}
          change={(v) => change('reminderEnabled', v)}
        />
        <SettingToggle
          label="系统登录时启动"
          note="应用驻留托盘。关闭窗口后继续等待提醒；托盘可完全退出。"
          value={form.startAtLogin}
          change={(v) => change('startAtLogin', v)}
        />
      </div>
      <div className="settings-card">
        <h2>生成脱敏摘要</h2>
        <div className="setting-row">
          <div>
            <strong>整理摘要的 Harness</strong>
            <p>复用本机现有登录和模型设置。所有已绑定来源可由同一个环境整理。</p>
          </div>
          <select value={form.engine} onChange={(e) => change('engine', e.target.value)}>
            {s.harnesses
              .filter((h) => h.id !== 'dsh')
              .map((h) => (
                <option key={h.id} value={h.id} disabled={!h.available}>
                  {h.label}
                  {h.available ? '' : '（未检测到）'}
                </option>
              ))}
          </select>
        </div>
        <SettingToggle
          label="授权自动生成"
          note="关闭时每次询问；开启后按时读取日志并调用模型，可能消耗额度。超过 3 天未成功运行会重新询问。"
          value={form.generationMode === 'automatic'}
          change={(v) => change('generationMode', v ? 'automatic' : 'ask')}
        />
        <SettingToggle
          label="扩展脱敏分析"
          note="默认开启，可关闭。整理任务要求、结构和已选代码数值；原文与源码不上传。"
          value={form.extendedObservations}
          change={(v) => change('extendedObservations', v)}
        />
        <p className="fine-print">
          输入在本地移除常见密钥、链接、路径、邮箱、代码块，再交给已配置的模型服务；不能保证自动识别所有名称。上传输出严格限制为固定类别和数值。难度分级关闭。
        </p>
      </div>
      <div className="settings-card">
        <h2>选择上传</h2>
        {s.attempts?.length > 0 && (
          <details className="attempt-history">
            <summary>摘要生成记录（最近 {s.attempts.length} 次）</summary>
            <p className="fine-print">成功、失败与异常中断均保留；消耗与工作 Token 分开。</p>
            {s.attempts.map((a) => (
              <div className="setting-row" key={a.id}>
                <div>
                  <strong>
                    {a.day} · {names[a.harness]} ·{' '}
                    {
                      {
                        running: '运行中',
                        completed: '已完成',
                        failed: '失败',
                        interrupted: '异常中断',
                      }[a.status]
                    }
                  </strong>
                  <p>
                    输入 {fmt(a.inputTokens)} · 输出 {fmt(a.outputTokens)} Token · 费用{' '}
                    {a.costMinor === null ? '未知' : fmt(a.costMinor)}
                  </p>
                </div>
                <span className="fine-print">
                  {a.durationMs === null ? '时长未知' : `${Math.round(a.durationMs / 1000)} 秒`}
                </span>
              </div>
            ))}
          </details>
        )}
        <div className="setting-row">
          <div>
            <strong>OpenCost 站点地址</strong>
            <p>开发版未配置线上站点。填 HTTPS Origin，或本机 http://127.0.0.1:4318。</p>
          </div>
          <input
            className="endpoint"
            placeholder="https://你的站点"
            value={form.endpoint}
            onChange={(e) => change('endpoint', e.target.value)}
          />
        </div>
        <SettingToggle
          label="授权自动上传"
          note="关闭时每份摘要单独选择；开启后生成成功即上传为私有工作日记，不进入公开排名。"
          value={form.uploadMode === 'automatic'}
          change={(v) => change('uploadMode', v ? 'automatic' : 'ask')}
        />
        <p className="fine-print">
          换站点或新增来源后重新授权。访问密钥由系统安全存储加密，固定上传字段可在日记详情中预览或导出。
        </p>
      </div>
      <div className="settings-card">
        <div className="setting-row">
          <div>
            <strong>备份完整工作日记</strong>
            <p>保留所有历史修订、处理记录、上传回执、反馈和本机配置，不调用模型。</p>
          </div>
          <button disabled={s.busy || !!s.pending} onClick={() => act('backup')}>
            <ArrowDownToLine size={16} />
            保存完整备份
          </button>
        </div>
        <p className="fine-print">
          完整备份可能包含本机路径和加密凭证，不是脱敏上传文件。请选择个人存储位置；已有备份不会被覆盖。
        </p>
      </div>
    </>
  );
}
function PersonalFeedbackView({
  s,
  act,
}: {
  s: Snapshot;
  act: (command: string, data?: unknown) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const reports = s.feedbackHistory ?? (s.feedback ? [s.feedback] : []);
  const report = reports.find((r) => `${r.kind}:${r.recordId}` === selected) ?? reports[0];
  const uploaded = new Set(s.uploaded);
  const missingReports = s.summaries.filter(
    (summary) =>
      uploaded.has(summary.id) &&
      !reports.some((entry) => entry.kind === 'journal' && entry.recordId === summary.id),
  );
  const missingReceipt =
    missingReports.find((summary) => summary.id === receiptId) ?? missingReports[0];
  const read = async (kind: string, recordId: string) => {
    const result = await act('feedback-read', { kind, recordId });
    if (
      result &&
      typeof result === 'object' &&
      'kind' in result &&
      'recordId' in result &&
      typeof result.kind === 'string' &&
      typeof result.recordId === 'string'
    )
      setSelected(`${result.kind}:${result.recordId}`);
  };
  const kindNames = {
    contribution: '工作与费用',
    journal: '每日工作日记',
    subscription: '订阅额度',
  };
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORK, IN PERSPECTIVE</div>
          <h1>了解投入，选择更合适的方案。</h1>
          <p>用上传的脱敏记录观察工作量、成本、额度和同类方案。反馈由程序计算，不额外调用模型。</p>
        </div>
        <button
          className="primary"
          disabled={s.busy || !!s.pending || !s.settings.endpoint}
          onClick={() => act('feedback-refresh')}
        >
          <RefreshCw size={17} />
          读取已保存的反馈列表
        </button>
      </section>
      <div className="settings-card">
        <div className="setting-row">
          <div>
            <strong>桌面应用与 Skill 共用私人记录</strong>
            <p>
              保存同一个站点，并导入 Skill 上传时保存的访问凭证。也可以导出应用凭证给 Skill
              使用。切换身份后，原来的反馈历史仍保存在本机。
            </p>
          </div>
          <div className="feedback-actions">
            <button
              disabled={s.busy || !!s.pending || !s.settings.endpoint}
              onClick={() => act('credential-import')}
            >
              <KeyRound size={16} />
              导入访问凭证
            </button>
            <button
              disabled={s.busy || !!s.pending || !s.settings.endpoint}
              onClick={() => act('credential-export')}
            >
              <ArrowDownToLine size={16} />
              导出我的凭证
            </button>
          </div>
        </div>
        <p className="fine-print">
          凭证在系统安全存储中加密，不会传给整理摘要的模型。导出的凭证能读取你的私人记录，请自行保管。页面读取按需进行，不新增后台轮询。
        </p>
      </div>
      {missingReceipt && (
        <div className="settings-card">
          <h2>按上传回执读取反馈</h2>
          <p>每次只读取所选日记的反馈，不重新上传；重复上传的回执会读取对应的原记录。</p>
          <div className="feedback-selection">
            <label htmlFor="feedback-receipt">选择已上传日记</label>
            <select
              id="feedback-receipt"
              value={missingReceipt.id}
              onChange={(event) => setReceiptId(event.target.value)}
            >
              {missingReports.map((summary) => (
                <option key={summary.id} value={summary.id}>
                  {summary.day} · 第 {summary.revision} 版 · {summary.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <button
              disabled={s.busy || !!s.pending || !s.settings.endpoint}
              onClick={() => read('journal', missingReceipt.id)}
            >
              读取这份日记的反馈
            </button>
          </div>
        </div>
      )}
      {report ? (
        <>
          <div className="feedback-selection">
            <label htmlFor="feedback-record">选择历史反馈</label>
            <select
              id="feedback-record"
              value={`${report.kind}:${report.recordId}`}
              onChange={(e) => setSelected(e.target.value)}
            >
              {reports.map((r) => (
                <option key={`${r.kind}:${r.recordId}`} value={`${r.kind}:${r.recordId}`}>
                  {new Date(r.generatedAt).toLocaleString('zh-CN')} · {kindNames[r.kind]} ·{' '}
                  {r.recordId.slice(0, 8)}
                </option>
              ))}
            </select>
            <span>保留生成时的价格和参照</span>
            <button
              disabled={s.busy || !!s.pending || !s.settings.endpoint}
              onClick={() => read(report.kind, report.recordId)}
            >
              <RefreshCw size={16} />
              {report.provisional ? '重新读取这份临时反馈' : '读取这份反馈'}
            </button>
          </div>
          <DeferredFeedbackPanel report={report} />
        </>
      ) : (
        <div className="settings-card">
          <h2>上传后，反馈会出现在这里</h2>
          <p>
            本机上传的每日摘要会直接保存反馈。通过 Skill
            上传的费用和验收记录，可在导入同一身份的凭证后读取。
          </p>
          <p>
            单次结果可能波动，建议连续记录一周，最好一个月。缺少实付、验收或可比样本时，相关指标保留未知，等待后续记录。
          </p>
        </div>
      )}
      <QuotaReplayEntry />
    </>
  );
}
function SettingToggle({
  label,
  note,
  value,
  change,
}: {
  label: string;
  note: string;
  value: boolean;
  change: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <p>{note}</p>
      </div>
      <button
        role="switch"
        aria-checked={value}
        className={'toggle ' + (value ? 'on' : '')}
        onClick={() => change(!value)}
      >
        <span />
      </button>
    </div>
  );
}
function Days({ s, open }: { s: Snapshot; open: (d: string) => void }) {
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">DAY BY DAY</div>
          <h1>让每一天的工作，留下坐标。</h1>
          <p>按日保存所有修订，重新整理会创建新的记录。</p>
        </div>
      </section>
      <Heatmap summaries={s.summaries} open={open} />
      <div className="days-grid">
        {s.summaries.length ? (
          s.summaries.map((d) => (
            <button className="day-card" key={d.id} onClick={() => open(d.day)}>
              <span className="eyebrow">{d.day}</span>
              <h2>{d.tasks.length} 个工作条目</h2>
              <p>{[...new Set(d.tasks.map(taskGroup))].join(' · ') || '只有日志用量'}</p>
              <div>
                {d.harnesses.map((h) => (
                  <span key={h.id + ':' + h.version}>{names[h.id] ?? h.id}</span>
                ))}
                <ArrowRight size={17} />
              </div>
            </button>
          ))
        ) : (
          <div className="settings-card empty-copy">
            还没有工作日记。绑定环境后，从今天开始整理。
          </div>
        )}
      </div>
    </>
  );
}
function Approval({
  s,
  act,
  error,
}: {
  s: Snapshot;
  act: (cmd: string, d?: unknown) => Promise<unknown>;
  error: string;
}) {
  const p = s.pending;
  if (!p)
    return (
      <div className="approval">
        <Check size={28} />
        <h2>请求已处理</h2>
        <button onClick={() => act('show')}>打开工作日记</button>
      </div>
    );
  return (
    <div className="approval">
      <div className="approval-head">
        <span className="brand-symbol">◎</span>
        <strong>
          OpenCost <small>工作日记</small>
        </strong>
        <span className="local-badge">需允许</span>
      </div>
      <div className="eyebrow">
        {p.day} · {p.kind === 'generate' ? p.engine : '私有上传'}
      </div>
      <h2>
        {p.kind === 'generate'
          ? p.day === today()
            ? '整理今天的工作？'
            : '整理这一天的工作？'
          : '上传这份脱敏摘要？'}
      </h2>
      <p>
        {p.kind === 'generate'
          ? `将读取 ${p.bindings} 个已绑定来源，把本地遮盖后的片段交给 ${p.engine} 整理。可能消耗模型额度；名称等内容仍可能保留在输入中。`
          : `向 ${p.endpoint} 上传固定工作类别、状态、数量、Token 与匿名来源标识。原始对话、路径和账号不上传，记录仅对持有访问密钥的人可见。`}
      </p>
      {s.message.includes('超过 3 天') && <p className="fine-print">{s.message}</p>}
      {p.kind==='upload'&&p.analysis&&<p className="fine-print">另含 {p.analysis.items} 条工作分析、{p.analysis.reports} 份代码或补丁数值，约 {(p.analysis.bytes/1024).toFixed(1)} KiB。要求描述为实验结果，仅供本人查看，不参与正式排名。</p>}
      <div className="approval-scope">
        <ShieldCheck size={15} />
        {p.kind === 'generate'
          ? '仅此日期 · 难度分级关闭 · 上传另行选择'
          : '仅此修订 · 不加入公开排名'}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="approval-actions">
        <button onClick={() => act('deny', p.id)}>本次跳过</button>
        <button className="primary" onClick={() => act('approve', p.id)}>
          允许本次 <ArrowRight size={16} />
        </button>
      </div>
      <button className="text-button" onClick={() => act('show')}>
        打开应用查看来源与字段
      </button>
    </div>
  );
}
void initializeLocale().catch(() => {}).finally(() => createRoot(document.getElementById('root')!).render(<App />));
