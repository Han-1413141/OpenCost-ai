import { useMemo, useState } from 'react';
import { DomainTabs } from '../DomainTabs';
import { ChoiceTabs } from '../ChoiceTabs';
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Filter,
  Gauge,
  GitCompareArrows,
  Layers,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  Users,
  Zap,
} from 'lucide-react';
import {
  type Comparison,
  recommendationWithDiagnostics,
  recommendationExclusionLabels,
  type RecommendationExclusion,
} from '../../shared/analysis';
import {
  labels,
  workloadLabels,
  eventLabels,
  canonical,
  domainLabels,
  taskDomain,
  type WorkDomain,
  type TaskKind,
  type EventKind,
} from '../../shared/schema';
import { colors, harnessNames, modelNames, nameHarness, nameModel } from '../../shared/catalog';
import { modelRankingEligible } from '../../shared/ranking';
import { harnessCompositionLabel } from '../../shared/harness-composition';
import { modelIdentityKey } from '../../shared/model-identity';
import {
  comparisonModelChoice,
  comparisonModelVersion,
  modelIdentityDetails,
} from '../model-identity';
import { workClassificationLabel } from '../../shared/work-labels';
import { trendSeries } from '../../shared/trends';
import { recommendPlans, planRankingEligible } from '../../shared/plans';
import {
  RankingBasis,
  RankingScopeNote,
  RankingTargetNote,
  rankingCompletion,
  RankingMethodDetails,
  rankingHarnessLabel,
  rankingConditionLabel,
  taskModelBoards,
  observedRank,
} from './Home';
import '../statistical-notes.css';
import {
  Button,
  Empty,
  ModelMark,
  Modal,
  Notice,
  Scatter,
  SectionTitle,
  Tag,
  TextLink,
} from '../components';
import {
  download,
  money,
  number,
  percent,
  publicErrorState,
  type ExploreData,
  type PlanRow,
  type RequestError,
} from '../api';
import type { Page } from '../App';
import { useDisplayCurrency } from '../Currency';
import {
  publicBoards,
  matchesBoardScope,
  comparisonGroups,
  type ModelBoard,
  type DashboardFilters,
  type UpdateFilters,
} from '../filters';

type Props = {
  filters: DashboardFilters;
  updateFilters: UpdateFilters;
  page: Page;
  data: ExploreData | null;
  loading: boolean;
  error: RequestError;
  search: string;
  source: string;
  go: (p: Page) => void;
  refresh: () => void;
  toast: (message: string) => void;
};
const pageInfo: Partial<Record<Page, string>> = {
  compare: '模型成本比较',
  ranking: '各类任务的模型性价比',
  harness: 'Harness 成本比较',
  plans: '套餐成本与额度',
  process: '任务过程与速度',
  trends: '成本与用量趋势',
  recommend: '按预算选择模型或套餐',
};
export function Explorer({
  filters,
  updateFilters,
  page,
  data,
  loading,
  error,
  search,
  source,
  go,
  refresh,
  toast,
}: Props) {
  const failure = publicErrorState(error);
  const { domain } = filters;
  const boards = publicBoards(data, domain);
  const [target, setTarget] = useState('');
  const [detail, setDetail] = useState<Comparison | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [compareOpen, setCompareOpen] = useState(false);
  const all = (data?.rows ?? []).filter((r) => taskDomain(r.cohort.kind) === domain);
  const harnessView = page === 'harness';
  const availableGroups = comparisonGroups(all, harnessView ? 'harness' : 'model');
  const objectId = (r: Comparison) =>
    harnessView ? comparisonModelChoice(r).key : r.cohort.harness;
  const objectCounts = new Map<string, number>();
  const objectLabels = new Map<string, string>();
  availableGroups.forEach((g) => {
    const id = objectId(g.rows[0]);
    objectLabels.set(id, harnessView ? comparisonModelChoice(g.rows[0]).label : nameHarness(id));
    objectCounts.set(id, Math.max(objectCounts.get(id) ?? 0, g.rows.length));
  });
  const objectIds = [...objectCounts.keys()].sort(
    (a, b) => objectCounts.get(b)! - objectCounts.get(a)! || a.localeCompare(b),
  );
  const activeTarget = objectIds.includes(target) ? target : (objectIds[0] ?? '');
  const allGroups = availableGroups.filter((g) => objectId(g.rows[0]) === activeTarget);
  const matches = (r: Comparison) =>
    !search ||
    [...r.modelIds.map(nameModel), nameHarness(r.cohort.harness), r.cohort.models]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase());
  const groups = allGroups
    .map((g) => ({ ...g, rows: g.rows.filter(matches), history: g.history.filter(matches) }))
    .filter((g) => g.rows.length);
  const rows = groups.flatMap((g) => g.rows);
  const selectedRows =
    groups.find((g) => g.id === selectedGroup)?.rows.filter((r) => selected.includes(r.id)) ?? [];
  const toggle = (id: string, group: string) => {
    setSelected((prev) =>
      group !== selectedGroup
        ? [id]
        : prev.includes(id)
          ? prev.filter((x) => x !== id)
          : prev.length < 4
            ? [...prev, id]
            : prev,
    );
    setSelectedGroup(group);
  };
  const exportRows = () => {
    download(`OpenCost-${page}.json`, {
      source,
      domain,
      groups,
      ...(['ranking', 'plans'].includes(page) ? { boards } : {}),
      statisticsVersion: data?.statisticsVersion ?? null,
      rankingTargetsVersion: data?.rankingTargetsVersion ?? null,
      rankingStudiesVersion: data?.rankingStudiesVersion ?? null,
      updatedAt: data?.updatedAt,
      exportedAt: new Date().toISOString(),
    });
    toast('数据已导出');
  };
  const showObjects = ['compare', 'harness', 'process', 'trends'].includes(page);
  const planGroups = boards.plans.map((b) => ({
    ...b,
    records: (data?.plans ?? []).filter(
      (p) =>
        p.month === b.month &&
        matchesBoardScope(p, b.scope) &&
        (!search ||
          [p.plan, ...p.modelIds.map(nameModel)]
            .join(' ')
            .toLowerCase()
            .includes(search.toLowerCase())),
    ),
  }));
  const unavailable = (
    <Empty
      title={search ? '没有匹配的记录' : '暂无公开数据'}
      action={
        <Button secondary onClick={() => go('contribute')}>
          加入收集计划
        </Button>
      }
    >
      {null}
    </Empty>
  );
  return (
    <div className="explorer-page direct-results">
      <div className="page-heading">
        <h1>{pageInfo[page]}</h1>
        {showObjects && (
          <button className="quiet-button" onClick={exportRows} disabled={!rows.length}>
            <Download size={15} />
            导出
          </button>
        )}
      </div>
      {loading ? (
        <div className="loading-grid" aria-label="正在加载比较数据">
          <div />
          <div />
          <div />
          <div />
        </div>
      ) : error ? (
        <Empty
          title={failure.title}
          action={failure.retryable ? <Button onClick={refresh}>重新加载</Button> : undefined}
        >
          {failure.message}
          {failure.actionNote && <span> {failure.actionNote}</span>}
        </Empty>
      ) : (
        <>
          <DomainTabs
            value={domain}
            onChange={(domain) => {
              updateFilters({ domain });
              setTarget('');
              setSelected([]);
            }}
          />
          {data && (
            <p className="statistics-meta">
              {data.source === 'demo' ? '示例统计数据' : '公开观察数据'} ·{' '}
              {data.updatedAt ? `数据更新 ${data.updatedAt.slice(0, 10)}` : '更新时间未提供'} ·
              {data.statisticsVersion && (
                <span title={data.statisticsVersion}>
                  结果版本 {data.statisticsVersion.slice(0, 12)} ·{' '}
                </span>
              )}
              历史价格与实付，不等于当前报价
            </p>
          )}
          {showObjects && objectIds.length > 0 && (
            <ChoiceTabs
              label={harnessView ? '比较模型' : '比较 Harness'}
              value={activeTarget}
              options={objectIds.map((id) => [id, objectLabels.get(id)!])}
              onChange={(id) => {
                setTarget(id);
                setSelected([]);
              }}
            />
          )}
          {page === 'ranking' ? (
            <>
              {taskModelBoards(boards.models)
                .filter((b) => b.rows.length || b.target?.mode === 'fixed')
                .map((b) => (
                  <section className="result-section" key={b.id}>
                    <div className="result-section-heading">
                      <h2>
                        {b.taskKind ? labels.kind[b.taskKind] + ' · ' : ''}
                        {b.costBasis}
                      </h2>
                      <span>
                        {b.scope.currency} · {b.month}
                      </span>
                    </div>
                    <OverallRanking result={b} currency={b.scope.currency} search={search} />
                  </section>
                ))}
              {!taskModelBoards(boards.models).some(
                (b) => b.rows.length || b.target?.mode === 'fixed',
              ) && unavailable}
            </>
          ) : page === 'plans' ? (
            <>
              {planGroups
                .filter((g) => g.records.length || g.target?.mode === 'fixed')
                .map((g) => (
                  <section className="result-section" key={g.id}>
                    <div className="result-section-heading">
                      <h2>{g.costBasis}</h2>
                      <span>
                        {g.scope.currency} · {g.month}
                      </span>
                    </div>
                    <RankingTargetNote target={g.target} />
                    {g.reason && <p className="statistics-unavailable">{g.reason}</p>}
                    <div className="table-scroll">
                      <table className="ranking-table">
                        <thead>
                          <tr>
                            <th>套餐</th>
                            <th>标准化成本 / 验收任务</th>
                            <th>完成率</th>
                            <th>目标条件覆盖</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows
                            .filter(
                              (r) =>
                                !search ||
                                [r.plan, ...r.modelIds.map(nameModel)]
                                  .join(' ')
                                  .toLowerCase()
                                  .includes(search.toLowerCase()),
                            )
                            .map((r) => (
                              <PlanTargetRow key={r.id} row={r} currency={g.scope.currency} />
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="statistics-note">
                      以下为各工作条件的账期观察值；与上方指定任务构成的标准化成本分别展示。
                    </p>
                    <Plans plans={g.records} currency={g.scope.currency} go={go} />
                  </section>
                ))}
              {!planGroups.some((g) => g.records.length || g.target?.mode === 'fixed') &&
                unavailable}
            </>
          ) : page === 'recommend' ? (
            <Recommendations
              rows={comparisonGroups(all, 'model').flatMap((g) => g.rows)}
              plans={(data?.plans ?? []).filter(
                (p) =>
                  p.cohort.domain === domain &&
                  (!search ||
                    [p.plan, ...p.modelIds.map(nameModel)]
                      .join(' ')
                      .toLowerCase()
                      .includes(search.toLowerCase())),
              )}
              currency={all[0]?.cohort.currency ?? 'CNY'}
              onSelect={setDetail}
            />
          ) : page === 'trends' ? (
            <>
              {groups.map((g) => (
                <section className="result-section" key={g.id}>
                  <div className="result-section-heading">
                    <h2>
                      {labels.kind[g.cohort.kind]} · {g.costBasis}
                      {workClassificationLabel(g.cohort)
                        ? ' · ' + workClassificationLabel(g.cohort)
                        : ''}
                    </h2>
                    <span>{g.cohort.currency}</span>
                  </div>
                  <Trends rows={g.history} plans={data?.plans ?? []} currency={g.cohort.currency} />
                </section>
              ))}
              {!groups.length && unavailable}
            </>
          ) : (
            <>
              {groups.map((g) => (
                <section className="panel comparison-panel result-section" key={g.id}>
                  <div className="result-section-heading">
                    <h2>
                      {labels.kind[g.cohort.kind]}
                      {workClassificationLabel(g.cohort)
                        ? ' · ' + workClassificationLabel(g.cohort)
                        : ''}
                      <span>{labels.scope[g.cohort.scope]}</span>
                    </h2>
                    <span>
                      {g.costBasis} · {g.cohort.currency} · {g.month}
                    </span>
                  </div>
                  <details className="statistical-basis">
                    <summary>比较条件与测量口径</summary>
                    <p>
                      {rankingConditionLabel(g.cohort)}；{labels.context[g.cohort.context]}；
                      {labels.payment[g.cohort.payment]}。费用依据 {g.scope.evidence.cost}，验收依据{' '}
                      {g.scope.evidence.work}。
                    </p>
                    <p>
                      每项验收成本包含全部失败与重试支出。人工时间、返工和修改按已记录任务计算，缺测显示“—”；不同记录覆盖比例的数值不能直接认定高低。来源是匿名统计来源，不等于独立用户。
                    </p>
                  </details>
                  <CostTable
                    rows={g.rows}
                    selected={selectedGroup === g.id ? selected : []}
                    toggle={(id) => toggle(id, g.id)}
                    onSelect={setDetail}
                    process={page === 'process'}
                    harnessView={harnessView}
                    source={source}
                  />
                </section>
              ))}
              {!groups.length && unavailable}
              {selectedRows.length > 0 && (
                <div className="compare-tray">
                  <span>
                    <GitCompareArrows size={18} />
                    {selectedRows.length} 个方案已选择
                  </span>
                  <button className="quiet-button" onClick={() => setSelected([])}>
                    清空
                  </button>
                  <Button onClick={() => setCompareOpen(true)} disabled={selectedRows.length < 2}>
                    并排比较 <ArrowRight size={16} />
                  </Button>
                </div>
              )}
              {page === 'process' && rows.length > 0 && (
                <>
                  <ProcessSummary rows={rows} />
                  <EventBreakdown rows={rows} />
                </>
              )}
            </>
          )}
        </>
      )}
      {detail && <Detail row={detail} source={source} onClose={() => setDetail(null)} />}
      {compareOpen && (
        <Modal title="方案并排比较" onClose={() => setCompareOpen(false)}>
          <CompareGrid rows={selectedRows} />
        </Modal>
      )}
    </div>
  );
}
export type ComparisonSortKey =
  | 'costPerAccepted'
  | 'completion'
  | 'rework'
  | 'humanMinutes'
  | 'outputTps'
  | 'ttftMs'
  | 'intentErrors'
  | 'count'
  | 'wallMinutes';

export function comparisonMeasurementComplete(row: Comparison, key: ComparisonSortKey) {
  const samples = {
    rework: row.metrics.reworkSamples,
    humanMinutes: row.metrics.humanSamples,
    outputTps: row.metrics.speedSamples,
    ttftMs: row.metrics.ttftTaskSamples,
    intentErrors: row.metrics.eventSamples,
    wallMinutes: row.metrics.wallSamples,
  };
  return (
    row.metrics[key] !== null &&
    Number.isFinite(row.metrics[key]) &&
    (!(key in samples) || samples[key as keyof typeof samples] === row.metrics.count)
  );
}

export function sortComparisonRows(
  rows: Comparison[],
  key: ComparisonSortKey,
  descending: boolean,
) {
  return [...rows].sort((a, b) => {
    const completeA = comparisonMeasurementComplete(a, key),
      completeB = comparisonMeasurementComplete(b, key);
    if (completeA !== completeB) return Number(completeB) - Number(completeA);
    if (!completeA) return a.id.localeCompare(b.id);
    return (a.metrics[key]! - b.metrics[key]!) * (descending ? -1 : 1) || a.id.localeCompare(b.id);
  });
}

function CostTable({
  rows: inputRows,
  selected,
  toggle,
  onSelect,
  process,
  harnessView,
  source,
}: {
  rows: Comparison[];
  selected: string[];
  toggle: (id: string) => void;
  onSelect: (r: Comparison) => void;
  process: boolean;
  harnessView: boolean;
  source: string;
}) {
  const { format: money, convert, effectiveCurrency } = useDisplayCurrency();
  const [sort, setSort] = useState<{ key: ComparisonSortKey; descending: boolean }>({
    key: 'costPerAccepted',
    descending: false,
  });
  const rows = sortComparisonRows(inputRows, sort.key, sort.descending);
  const sortHead = (key: ComparisonSortKey, title: string) => (
    <th aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
      <button
        className="table-sort"
        onClick={() =>
          setSort({
            key,
            descending:
              sort.key === key
                ? !sort.descending
                : ['completion', 'outputTps', 'count'].includes(key),
          })
        }
      >
        {title}
        {sort.key === key && (
          <ArrowDown
            size={11}
            style={{ transform: sort.descending ? undefined : 'rotate(180deg)' }}
          />
        )}
      </button>
    </th>
  );
  const max = Math.max(...rows.map((r) => r.metrics.costPerAccepted ?? 0), 1);
  const priced = rows.filter((r) => r.metrics.accepted > 0 && r.metrics.costPerAccepted !== null);
  const min = Math.min(...priced.map((r) => r.metrics.costPerAccepted!));
  const cheapestCount = priced.filter((r) => r.metrics.costPerAccepted === min).length;
  return (
    <div className="table-scroll">
      <p className="statistics-meta">
        过程指标先展示完整测量的记录。部分测量仅反映已测子集，列出覆盖数并放在后面，不据此比较整组表现。
      </p>
      <table className="cost-table">
        <thead>
          <tr>
            <th className="check-cell">
              <GitCompareArrows size={15} />
            </th>
            <th>{harnessView ? 'Harness / 模型' : '模型 / Harness'}</th>
            {sortHead('costPerAccepted', '每项达标成本')}
            {process ? (
              <>
                {sortHead('rework', '返工 / 修改')}
                {sortHead('intentErrors', '意图错误')}
                {sortHead('outputTps', '输出速度')}
                {sortHead('ttftMs', '首字延迟')}
              </>
            ) : (
              <>
                {sortHead('completion', '完成率')}
                {sortHead('rework', '返工 / 修改')}
                {sortHead('humanMinutes', '人工投入')}
                {sortHead('count', '样本数')}
              </>
            )}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={`选择 ${nameModel(r.modelIds[0])} ${nameHarness(r.cohort.harness)}`}
                />
              </td>
              <td>
                <div className="model-cell">
                  <ModelMark id={r.modelIds[0]} />
                  <div>
                    <button className="model-name" onClick={() => onSelect(r)}>
                      {harnessView
                        ? nameHarness(r.cohort.harness)
                        : r.modelIds.map(nameModel).join(' + ')}
                    </button>
                    <span>
                      {harnessView ? nameModel(r.modelIds[0]) + ' · ' : ''}
                      {harnessCompositionLabel(r.cohort, nameHarness)}
                    </span>
                  </div>
                  {priced.length >= 2 && r.metrics.costPerAccepted === min && (
                    <span className="small-cheap">
                      {cheapestCount > 1 ? '并列观测最低' : '本组观测最低'}
                    </span>
                  )}
                </div>
              </td>
              <td>
                <div className="cost-value">
                  {money(r.metrics.costPerAccepted, r.cohort.currency)}
                  <span>/ 项</span>
                </div>
                {r.metrics.costPerAccepted !== null && (
                  <div className="cost-bar">
                    <span
                      style={{
                        width: `${(r.metrics.costPerAccepted / max) * 100}%`,
                        background:
                          r.metrics.costPerAccepted === min ? 'var(--accent)' : 'var(--bar)',
                      }}
                    />
                  </div>
                )}
              </td>
              {process ? (
                <>
                  <td>
                    {decimal(r.metrics.rework)} <span className="muted">/</span>{' '}
                    {decimal(r.metrics.revisions)}
                    <small>
                      覆盖 {r.metrics.reworkSamples} / {r.metrics.count}；
                      {r.metrics.revisionSamples} / {r.metrics.count} 项
                    </small>
                  </td>
                  <td>
                    {decimal(r.metrics.intentErrors)} <span className="muted">次</span>
                    <small>
                      覆盖 {r.metrics.eventSamples} / {r.metrics.count} 项
                    </small>
                  </td>
                  <td>
                    <strong>{decimal(r.metrics.outputTps)}</strong>
                    <small>
                      Token/s · 覆盖 {r.metrics.speedSamples} / {r.metrics.count} 项
                      {!comparisonMeasurementComplete(r, 'outputTps') && ' · 仅已测子集'}
                    </small>
                  </td>
                  <td>
                    {r.metrics.ttftMs === null ? '—' : (r.metrics.ttftMs / 1000).toFixed(2)}{' '}
                    <span className="muted">s</span>
                    <small>
                      覆盖 {r.metrics.ttftTaskSamples ?? '未知'} / {r.metrics.count} 项
                      {!comparisonMeasurementComplete(r, 'ttftMs') && ' · 仅已测子集'}
                    </small>
                  </td>
                </>
              ) : (
                <>
                  <td>
                    <div className="completion-cell">
                      <span className="completion-dot" />
                      {percent(r.metrics.completion)}
                    </div>
                    <small>
                      {r.metrics.accepted} / {r.metrics.count} 项已验收
                    </small>
                  </td>
                  <td>
                    {decimal(r.metrics.rework)} <span className="muted">/</span>{' '}
                    {decimal(r.metrics.revisions)}
                    <small>
                      次 / 已记录任务 · 覆盖 {r.metrics.reworkSamples} / {r.metrics.count}；
                      {r.metrics.revisionSamples} / {r.metrics.count}
                    </small>
                  </td>
                  <td>
                    {decimal(r.metrics.humanMinutes)} <span className="muted">min</span>
                    <small>
                      {r.metrics.humanSamples} / {r.metrics.count} 项已记录
                      {!comparisonMeasurementComplete(r, 'humanMinutes') && ' · 仅已测子集'}
                    </small>
                  </td>
                  <td>
                    <strong className="sample-count">{number(r.metrics.count)}</strong>
                    <small>{r.metrics.sources} 个来源</small>
                    <SourceSupportSummary row={r} />
                  </td>
                </>
              )}
              <td>
                <button
                  className="icon-button detail-arrow"
                  onClick={() => onSelect(r)}
                  aria-label={`查看 ${nameModel(r.modelIds[0])} 详情`}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const decimal = (v: number | null) => (v === null ? '—' : v.toFixed(1));
export function SourceSupportSummary({ row }: { row: Comparison }) {
  const { format: money } = useDisplayCurrency();
  const support = row.metrics.sourceSupport;
  return (
    <details className="statistical-source">
      <summary>来源与分布</summary>
      {support ? (
        <>
          <p>
            最大来源贡献 {percent(support.maxTaskShare)} 的任务；按任务权重折算的来源数为{' '}
            {number(support.effectiveSources, 1)}
            。这一数值反映集中程度，不是独立用户数或统计置信度。
          </p>
          {support.distributionCoverage === 'suppressed' ? (
            <p>有验收来源的成本分布未披露：可能没有验收结果，或未满足公开门槛。</p>
          ) : (
            <p>
              有验收来源的单位成本中间 50%：{money(support.costPerAcceptedP25, row.cohort.currency)}{' '}
              – {money(support.costPerAcceptedP75, row.cohort.currency)}；来源中位数{' '}
              {money(support.costPerAcceptedP50, row.cohort.currency)}
              。这是来源间观察分布，不是置信区间。
            </p>
          )}
          {support.zeroAcceptedSources > 0 && (
            <p>
              {support.zeroAcceptedSources}{' '}
              个来源没有验收结果，不进入上述来源单位成本分布；其全部支出仍计入整组验收成本。
            </p>
          )}
        </>
      ) : (
        <p>这份历史结果未记录来源集中度，不能从任务数推断样本独立性。</p>
      )}
    </details>
  );
}
function Detail({
  row: r,
  source,
  onClose,
}: {
  row: Comparison;
  source: string;
  onClose: () => void;
}) {
  const { format: money, convert, effectiveCurrency } = useDisplayCurrency();
  return (
    <Modal
      title={`${r.modelIds.map(nameModel).join(' + ')} · ${nameHarness(r.cohort.harness)}`}
      onClose={onClose}
    >
      <div className="detail-tags">
        <Tag tone="orange">{source === 'demo' ? '模拟数据' : '社区观察'}</Tag>
        <Tag>{r.cohort.month}</Tag>
        <Tag>{labels.billing[r.cohort.billing]}</Tag>
        <Tag>
          {r.evidence.cost} / {r.evidence.work}
        </Tag>
      </div>
      <div className="detail-main">
        <span>每项达标成本</span>
        <strong>{money(r.metrics.costPerAccepted, r.cohort.currency)}</strong>
        <p>
          全部支出 {money(r.metrics.spendMinor, r.cohort.currency)} ÷ {r.metrics.accepted}{' '}
          项已验收任务
        </p>
      </div>
      <div className="detail-grid">
        {[
          ['全部任务', `${r.metrics.count} 项`],
          ['未验收任务', `${r.metrics.count - r.metrics.accepted} 项`],
          ['单任务费用中位数', money(r.metrics.median, r.cohort.currency)],
          [
            '单任务费用 25%–75% 区间',
            `${money(r.metrics.p25, r.cohort.currency)} – ${money(r.metrics.p75, r.cohort.currency)}`,
          ],
          ['平均额外重试', `${decimal(r.metrics.retries)} 次`],
          ['平均人工投入', `${decimal(r.metrics.humanMinutes)} 分钟`],
          ['平均返工 / 修改', `${decimal(r.metrics.rework)} / ${decimal(r.metrics.revisions)} 次`],
          ['平均意图理解错误', `${decimal(r.metrics.intentErrors)} 次`],
          ['平均任务经过时间', `${decimal(r.metrics.wallMinutes)} 分钟`],
          ['输出阶段速度', `${decimal(r.metrics.outputTps)} Token/s`],
          ['模型请求时间', `${decimal(r.metrics.modelMinutes)} 分钟`],
          ['工具执行时间', `${decimal(r.metrics.toolMinutes)} 分钟`],
          ['排队时间', `${decimal(r.metrics.queueSeconds)} 秒`],
          ['缓存输入占比', percent(r.metrics.cacheRate)],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <SourceSupportSummary row={r} />
      <p className="statistics-note">
        任务数 {r.metrics.count}
        ；费用范围描述单任务支出，包含未验收任务，不能当作验收单位成本的置信区间。人工时间覆盖{' '}
        {r.metrics.humanSamples} / {r.metrics.count}，经过时间覆盖 {r.metrics.wallSamples} /{' '}
        {r.metrics.count}，输出速度覆盖 {r.metrics.speedSamples} / {r.metrics.count} 项。
      </p>
      <details className="technical-details">
        <summary>完整比较条件与数据口径</summary>
        <pre>
          {JSON.stringify({ ...r.cohort, evidence: r.evidence, metrics: r.metrics }, null, 2)}
        </pre>
      </details>
    </Modal>
  );
}
function CompareGrid({ rows }: { rows: Comparison[] }) {
  const { format: money, convert, effectiveCurrency } = useDisplayCurrency();
  const dimensions: [string, (r: Comparison) => string][] = [
    ['Harness', (r) => nameHarness(r.cohort.harness)],
    ['每项达标成本', (r) => money(r.metrics.costPerAccepted, r.cohort.currency)],
    ['完成率', (r) => percent(r.metrics.completion)],
    ['返工 / 修改', (r) => `${decimal(r.metrics.rework)} / ${decimal(r.metrics.revisions)}`],
    ['意图错误', (r) => decimal(r.metrics.intentErrors)],
    ['人工投入', (r) => `${decimal(r.metrics.humanMinutes)} min`],
    ['输出速度', (r) => `${decimal(r.metrics.outputTps)} Token/s`],
    ['样本数', (r) => String(r.metrics.count)],
    [
      '来源数 / 最大来源占比',
      (r) =>
        `${r.metrics.sources} / ${r.metrics.sourceSupport ? percent(r.metrics.sourceSupport.maxTaskShare) : '未记录'}`,
    ],
    [
      '人工 / 速度覆盖',
      (r) =>
        `${r.metrics.humanSamples}/${r.metrics.count} · ${r.metrics.speedSamples}/${r.metrics.count}`,
    ],
    ['观察月份', (r) => r.cohort.month],
    ['模型版本', comparisonModelVersion],
    ['参与 Harness 与版本', (r) => harnessCompositionLabel(r.cohort, nameHarness)],
  ];
  return (
    <div className="table-scroll">
      <table className="matrix-table">
        <thead>
          <tr>
            <th>比较项目</th>
            {rows.map((r) => (
              <th key={r.id}>{r.modelIds.map(nameModel).join(' + ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dimensions.map(([label, fn]) => (
            <tr key={label}>
              <th>{label}</th>
              {rows.map((r) => (
                <td key={r.id}>{fn(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const planName = (id: string) =>
  ({
    'sample-coder-plan': 'Coder Plan',
    'sample-code-plan': 'Code Plan',
    'sample-coding-plan': 'Coding Plan',
  })[id] ?? id;
function PlanTargetRow({
  row,
  currency,
}: {
  row: ReturnType<typeof import('../../shared/plans').rankPlans>['rows'][number];
  currency: string;
}) {
  const { format: money } = useDisplayCurrency();
  return (
    <tr>
      <td>
        {planName(row.plan)} · {row.version}
        <small>{row.modelIds.map(nameModel).join(' + ')}</small>
      </td>
      <td>{money(row.cost, currency)}</td>
      <td>{percent(rankingCompletion(row))}</td>
      <td>
        {row.support?.matchedConditions ?? '—'} / {row.support?.requiredTargetConditions ?? '—'} ·
        权重 {percent(row.support?.targetWeightCoverage)}
      </td>
    </tr>
  );
}
function Plans({
  plans,
  currency,
  go,
}: {
  plans: PlanRow[];
  currency: string;
  go: (p: Page) => void;
}) {
  const { format: money, convert, effectiveCurrency } = useDisplayCurrency();
  return (
    <>
      {plans.length ? (
        <div className="plans-grid">
          {plans.map((p, i) => (
            <div className="panel plan-card" key={p.id}>
              <div className="plan-heading">
                <div>
                  <h2>{planName(p.plan)}</h2>
                  <p>
                    {p.modelIds.map(nameModel).join(' + ')} · {p.planVersion}
                  </p>
                  <p>
                    {harnessCompositionLabel(p.cohort, nameHarness)} · {p.month}
                  </p>
                </div>
                <Tag>
                  {p.evidence.cost} / {p.evidence.work}
                </Tag>
              </div>
              <div className="plan-cost">
                <span>每项达标分摊成本</span>
                <strong>{money(p.costPerAccepted, currency)}</strong>
              </div>
              <div className="plan-line">
                <span>周期实付合计</span>
                <strong>{money(p.totalMinor, currency)}</strong>
              </div>
              <div className="plan-line">
                <span>单周期实付中位数</span>
                <strong>{money(p.cycleCostMedian, currency)}</strong>
              </div>
              <div className="plan-line">
                <span>单周期达标任务 P25</span>
                <strong>{number(p.cycleAcceptedP25, 1)} 项</strong>
              </div>
              <div className="plan-line">
                <span>每 1% 额度对应 Token</span>
                <strong>{p.tokensPerPercent === null ? '—' : number(p.tokensPerPercent)}</strong>
              </div>
              <div className="plan-line">
                <span>每 1% 额度 API 等价金额</span>
                <strong>{money(p.equivalentPerPercent, currency)}</strong>
              </div>
              <div className="plan-line">
                <span>固定额度窗口</span>
                <strong>{p.windowHours ?? '—'} 小时</strong>
              </div>
              <div className="plan-foot">
                {p.periods} 条账期记录 · {p.sources} 个来源 · {p.quotaSamples} 个额度样本
              </div>
              <details className="statistical-basis">
                <summary>套餐观察依据</summary>
                <p>
                  {rankingConditionLabel(p.cohort)}；{labels.allocation[p.cohort.allocation]}
                  。单周期验收量 P25 是历史下四分位数，不是承诺容量。
                </p>
                <p>
                  API 等价价格版本：{p.apiEquivalentPriceVersion ?? '未记录'}；额度等价价格版本：
                  {p.quotaPriceVersion ?? '未记录'}
                  。额度效率受任务、模型和计费规则影响，不能据此单独判定套餐变更。
                </p>
              </details>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          action={
            <Button secondary onClick={() => go('contribute')}>
              加入收集计划
            </Button>
          }
        >
          {null}
        </Empty>
      )}
    </>
  );
}
function WalletIcon({ index }: { index: number }) {
  return index % 2 ? <Layers size={24} /> : <CircleDollarSign size={24} />;
}
function ProcessSummary({ rows }: { rows: Comparison[] }) {
  const count = rows.reduce((s, r) => s + r.metrics.count, 0),
    valid = rows.reduce((s, r) => s + r.metrics.eventSamples, 0);
  return (
    <div className="process-coverage">
      <span>
        过程记录覆盖{' '}
        <strong>
          {number(valid)} / {number(count)}
        </strong>{' '}
        项任务
      </span>
      <span>
        <strong>{Object.keys(eventLabels).length}</strong> 类工作事件
      </span>
      <a href="#method">
        事件与计时规则 <ArrowUpRight size={13} />
      </a>
    </div>
  );
}
function EventBreakdown({ rows }: { rows: Comparison[] }) {
  const samples = rows.reduce((sum, row) => sum + row.metrics.eventSamples, 0);
  const counts: Partial<Record<EventKind, number>> = {};
  rows.forEach((r) =>
    Object.entries(r.metrics.events).forEach(([key, value]) => {
      const k = key as EventKind;
      counts[k] = (counts[k] ?? 0) + (value ?? 0);
    }),
  );
  const max = Math.max(...Object.values(counts).map((v) => v ?? 0), 1);
  return (
    <div className="panel">
      <SectionTitle title="工作过程事件" sub="已记录次数" />
      <div className="event-grid">
        {Object.entries(eventLabels).map(([id, label]) => (
          <div className="event-item" key={id}>
            <div>
              <span>{label}</span>
              <strong>{samples ? number(counts[id as EventKind] ?? 0) : '—'}</strong>
            </div>
            <div className="event-track">
              <span style={{ width: `${((counts[id as EventKind] ?? 0) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export function OverallRanking({
  result,
  currency,
  search,
}: {
  result: ModelBoard;
  currency: string;
  search: string;
}) {
  const { format: money } = useDisplayCurrency();
  return (
    <>
      {result.rows.length ? (
        <div className="panel">
          {result.reason && <p className="statistics-unavailable">{result.reason}</p>}
          <RankingScopeNote result={result} />
          <div className="table-scroll">
            <table className="ranking-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>模型</th>
                  <th>标准化成本 / 验收任务</th>
                  <th>完成率</th>
                  <th>采用的 Harness</th>
                  <th>任务数</th>
                </tr>
              </thead>
              <tbody>
                {result.rows
                  .filter(
                    (r) =>
                      !search ||
                      [nameModel(r.model), r.id, ...r.harnesses.map(nameHarness)]
                        .join(' ')
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span
                          className={`rank-number ${
                            result.comparable &&
                            observedRank(
                              result.rows
                                .filter((entry) => entry.qualified)
                                .map((entry) => entry.cost),
                              r.cost,
                            ) === 1 &&
                            r.qualified
                              ? 'first'
                              : ''
                          }`}
                        >
                          {result.comparable && r.qualified
                            ? observedRank(
                                result.rows
                                  .filter((entry) => entry.qualified)
                                  .map((entry) => entry.cost),
                                r.cost,
                              )
                            : '—'}
                        </span>
                      </td>
                      <td>
                        <div className="model-cell">
                          <ModelMark id={r.model} />
                          <span>
                            {nameModel(r.model)}
                            <small>{modelIdentityDetails(r.modelIdentity)}</small>
                          </span>
                        </div>
                        {!r.qualified && (
                          <small>
                            {r.excludedReason === 'zero_acceptance'
                              ? '部分条件尚无验收结果'
                              : r.excludedReason === 'missing_or_invalid_measurement'
                                ? '费用或任务数量缺测、无效'
                                : '共同任务条件覆盖不足'}
                          </small>
                        )}
                        <small>
                          {r.cells} / {r.requiredCells} 组目标条件
                        </small>
                        {r.support && (
                          <small>
                            已观察条件进入本次比较：{r.support.matchedConditions} /{' '}
                            {r.support.availableConditions}；不是全部实际任务的覆盖率
                          </small>
                        )}
                      </td>
                      <td>
                        <strong
                          title={
                            r.cost === null
                              ? '未记录完整成本'
                              : `排名原值：${r.cost / 100} ${currency} / 验收任务`
                          }
                        >
                          {money(r.cost, currency)}
                        </strong>
                      </td>
                      <td>{percent(rankingCompletion(r))}</td>
                      <td>{rankingHarnessLabel(r)}</td>
                      <td>
                        {number(r.count)}
                        <small>每组至少 {r.sourcesMin} 个来源</small>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="statistics-meta">
            金额显示经过四舍五入，名次按原始数值计算；悬停金额可查看原值。同值并列，不把显示精度当作实际差异。
          </p>
          <RankingBasis result={result} />
          <RankingMethodDetails result={result} />
        </div>
      ) : (
        <div>
          <RankingScopeNote result={result} />
          <Empty title="数据不足">{result.reason}</Empty>
        </div>
      )}
    </>
  );
}
// Preserve task, accounting and evidence conditions while choosing models and Harnesses.
export function recommendationGroups(rows: Comparison[], plans: PlanRow[]) {
  const groups = new Map<
    string,
    { cohort: Comparison['cohort']; rows: Comparison[]; plans: PlanRow[] }
  >();
  function add(row: Comparison | PlanRow, kind: 'rows' | 'plans') {
    const {
      models,
      modelIdentity,
      harness,
      harnessVersion,
      harnessVariant,
      harnessSurface,
      plan,
      planVersion,
      mode,
      tools,
      reasoning,
      cache,
      harnessAttribution,
      harnessComposition,
      month,
      ...conditions
    } = row.cohort;
    const id = canonical({
      ...conditions,
      evidence: {
        cost: row.evidence.cost,
        work: row.evidence.work,
        coverage: row.evidence.coverage,
      },
    });
    let group = groups.get(id);
    if (!group) {
      group = { cohort: row.cohort, rows: [], plans: [] };
      groups.set(id, group);
    }
    if (month > group.cohort.month) group.cohort = row.cohort;
    if (kind === 'rows') group.rows.push(row as Comparison);
    else group.plans.push(row as PlanRow);
  }
  rows.filter(modelRankingEligible).forEach((row) => add(row, 'rows'));
  plans.filter(planRankingEligible).forEach((row) => add(row, 'plans'));
  return [...groups]
    .map(([id, group]) => ({
      id,
      ...group,
      rows: group.rows.filter((row) => row.cohort.month === group.cohort.month),
      plans: group.plans.filter((row) => row.cohort.month === group.cohort.month),
    }))
    .sort((a, b) => b.cohort.month.localeCompare(a.cohort.month) || a.id.localeCompare(b.id));
}
function Recommendations({
  rows,
  plans,
  currency: defaultCurrency,
  onSelect,
}: {
  rows: Comparison[];
  plans: PlanRow[];
  currency: string;
  onSelect: (r: Comparison) => void;
}) {
  const { format: money, convert, effectiveCurrency } = useDisplayCurrency();
  const [selectedConditions, setSelectedConditions] = useState('');
  const groups = recommendationGroups(rows, plans);
  const activeGroup = groups.find((group) => group.id === selectedConditions) ?? groups[0];
  const activeEvidence = activeGroup?.rows[0]?.evidence ?? activeGroup?.plans[0]?.evidence;
  const currency = activeGroup?.cohort.currency ?? defaultCurrency;
  const [budget, setBudget] = useState(100),
    [tasks, setTasks] = useState(50),
    [human, setHuman] = useState(10);
  const [limitHuman, setLimitHuman] = useState(false);
  const candidateDiagnostics = recommendationWithDiagnostics(
    (activeGroup?.rows ?? []).filter((row) => row.cohort.billing === 'api'),
    { budget: budget * 100, tasks, maxHuman: limitHuman ? human : undefined },
  );
  const eligibleResults = candidateDiagnostics.rows.sort(
    (a, b) =>
      convert(a.projected, a.cohort.currency, currency)! -
        convert(b.projected, b.cohort.currency, currency)! ||
      canonical(a.cohort).localeCompare(canonical(b.cohort)) ||
      a.id.localeCompare(b.id),
  );
  // Each model keeps the least expensive qualifying Harness for the selected task conditions.
  const selectedModels = new Set<string>();
  const results = eligibleResults.filter((row) => {
    const key = modelIdentityKey(row.cohort.modelIdentity);
    if (key === null || selectedModels.has(key)) return false;
    selectedModels.add(key);
    return true;
  });
  const planResults = (activeGroup?.plans ?? [])
    .flatMap((p) => {
      const originalBudget = convert(budget * 100, currency, p.currency);
      return originalBudget === null
        ? []
        : recommendPlans([p], {
            budget: originalBudget,
            tasks,
            maxHuman: limitHuman ? human : undefined,
          });
    })
    .sort(
      (a, b) =>
        convert(a.cycleCostMedian, a.currency, currency)! -
          convert(b.cycleCostMedian, b.currency, currency)! || a.id.localeCompare(b.id),
    );
  return (
    <div className="recommend-layout">
      <div className="panel needs-panel">
        <h2>预算与任务要求</h2>
        {groups.length > 0 && (
          <label>
            工作与费用条件
            <select
              value={activeGroup.id}
              onChange={(event) => setSelectedConditions(event.target.value)}
            >
              {groups.map((group, index) => (
                <option key={group.id} value={group.id}>
                  {index + 1}. {labels.kind[group.cohort.kind]}
                  {workClassificationLabel(group.cohort)
                    ? ` · ${workClassificationLabel(group.cohort)}`
                    : ''}
                  {' · '}
                  {labels.scope[group.cohort.scope]} · {labels.acceptance[group.cohort.acceptance]}
                  {' · 输入 '}
                  {workloadLabels.inputUnits[group.cohort.inputUnits]}
                  {' · 输出 '}
                  {workloadLabels.outputUnits[group.cohort.outputUnits]}
                  {' · '}
                  {labels.billing[group.cohort.billing]} · {group.cohort.currency} ·{' '}
                  {group.cohort.month}
                </option>
              ))}
            </select>
          </label>
        )}
        {activeGroup && (
          <p>
            {labels.context[activeGroup.cohort.context]}； 输入{' '}
            {workloadLabels.inputUnits[activeGroup.cohort.inputUnits]}， 输出{' '}
            {workloadLabels.outputUnits[activeGroup.cohort.outputUnits]}
            {activeGroup.cohort.workloadUnit === 'unknown'
              ? '（成果单位未记录）'
              : workloadLabels.unit[activeGroup.cohort.workloadUnit]}
            。约束 {workloadLabels.constraintCount[activeGroup.cohort.constraintCount]}，
            {workloadLabels.verification[activeGroup.cohort.verification]}；
            {labels.payment[activeGroup.cohort.payment]} ·{' '}
            {labels.allocation[activeGroup.cohort.allocation]}； 费用依据 {activeEvidence?.cost} /
            验收依据 {activeEvidence?.work}。
            仅在相同任务规模、验收、费用与证据条件内比较，每个模型展示符合要求时成本最低的 Harness。
          </p>
        )}
        <label>
          预算上限（{effectiveCurrency(currency)}）
          <input
            type="number"
            min="1"
            value={Number(((convert(budget * 100, currency) ?? budget * 100) / 100).toFixed(2))}
            onChange={(e) => {
              const entered = Math.max(0, Number(e.target.value));
              setBudget(
                (convert(entered * 100, effectiveCurrency(currency), currency) ?? entered * 100) /
                  100,
              );
            }}
          />
        </label>
        <label>
          计划完成任务数<strong>{tasks} 项</strong>
          <input
            type="range"
            min="1"
            max="200"
            step="1"
            value={tasks}
            onChange={(e) => setTasks(Number(e.target.value))}
          />
        </label>
        <label className="ranking-optional-filter">
          <input
            type="checkbox"
            checked={limitHuman}
            onChange={(event) => setLimitHuman(event.target.checked)}
          />
          限制每项验收任务的人工投入
        </label>
        <label>
          {limitHuman
            ? `人工投入上限：${human} 分钟`
            : '人工投入上限未启用；缺测记录仍可按成本展示'}
          <input
            type="range"
            min="0"
            max="60"
            value={human}
            disabled={!limitHuman}
            onChange={(e) => setHuman(Number(e.target.value))}
          />
        </label>
        <p>
          失败与重试支出计入验收单位成本，完成率单独展示，不按完成率门槛筛选。API
          按历史单位成本的点估计筛选；套餐按历史最高账期支出筛选，两者预算口径不同，都不是下次付款保证。
        </p>
      </div>
      <div>
        <SectionTitle title="历史估算符合预算的模型" />
        <p className="statistics-note">
          本组共 {candidateDiagnostics.total} 条 API 配置记录，{candidateDiagnostics.eligible}{' '}
          条符合当前筛选； 按模型展示最低成本配置，同价配置可展开。
          {Object.entries(candidateDiagnostics.excluded).map(([reason, count]) => (
            <span key={reason}>
              {' '}
              {recommendationExclusionLabels[reason as RecommendationExclusion]}：{count} 条。
            </span>
          ))}
        </p>
        {results.length ? (
          results.slice(0, 6).map((r, i) => (
            <div className="recommend-card panel" key={r.id}>
              <div className="recommend-top">
                <ModelMark id={r.modelIds[0]} />
                <div>
                  <h3>{r.modelIds.map(nameModel).join(' + ')}</h3>
                  <span>
                    {nameHarness(r.cohort.harness)} · {labels.kind[r.cohort.kind]} ·{' '}
                    {r.metrics.count} 项记录 · {r.metrics.sources} 个来源 · {r.cohort.month}
                  </span>
                  <small>
                    {modelIdentityDetails(r.cohort.modelIdentity)} · Harness{' '}
                    {r.cohort.harnessVersion}
                  </small>
                </div>
              </div>
              <div className="recommend-cost">
                <span>完成 {tasks} 项的估算</span>
                <strong>{money(r.projected, r.cohort.currency)}</strong>
                {r.metrics.sourceRange ? (
                  <small>
                    来源间观察范围 {money(r.projectedLow, r.cohort.currency)} –{' '}
                    {money(r.projectedHigh, r.cohort.currency)}
                  </small>
                ) : (
                  <small>来源间观察范围未提供。</small>
                )}
                <small>按历史验收单位成本估算；来源差异不是置信区间，下次支出可能超过预算。</small>
                <small>
                  该模型有{' '}
                  {
                    (activeGroup?.rows ?? []).filter(
                      (candidate) =>
                        modelIdentityKey(candidate.cohort.modelIdentity) ===
                        modelIdentityKey(r.cohort.modelIdentity),
                    ).length
                  }{' '}
                  条候选配置记录；展示符合当前条件的观察最低成本，尚未经独立复测。
                </small>
                {eligibleResults.filter(
                  (candidate) =>
                    modelIdentityKey(candidate.cohort.modelIdentity) ===
                      modelIdentityKey(r.cohort.modelIdentity) &&
                    candidate.projected === r.projected,
                ).length > 1 && (
                  <details className="statistical-source">
                    <summary>同模型有多个同价配置，查看时间与人工投入</summary>
                    <p>同价时按配置名称稳定展示一个，不表示它更快或人工投入更少。</p>
                    {eligibleResults
                      .filter(
                        (candidate) =>
                          modelIdentityKey(candidate.cohort.modelIdentity) ===
                            modelIdentityKey(r.cohort.modelIdentity) &&
                          candidate.projected === r.projected,
                      )
                      .map((candidate) => (
                        <p key={candidate.id}>
                          {nameHarness(candidate.cohort.harness)} {candidate.cohort.harnessVersion}{' '}
                          · 总用时{' '}
                          {decimal(
                            candidate.metrics.wallSamples === candidate.metrics.count &&
                              candidate.metrics.wallMinutes !== null
                              ? candidate.metrics.wallMinutes / candidate.metrics.completion
                              : null,
                          )}{' '}
                          分钟 / 验收任务 · 人工{' '}
                          {decimal(
                            candidate.metrics.humanSamples === candidate.metrics.count &&
                              candidate.metrics.humanMinutes !== null
                              ? candidate.metrics.humanMinutes / candidate.metrics.completion
                              : null,
                          )}{' '}
                          分钟 / 验收任务
                        </p>
                      ))}
                  </details>
                )}
              </div>
              <SourceSupportSummary row={r} />
              <div className="recommend-bottom">
                <span>
                  <Check size={14} />
                  完成率 {percent(r.metrics.completion)}
                </span>
                <span>
                  <Clock3 size={14} />
                  人工{' '}
                  {decimal(
                    r.metrics.humanMinutes === null ||
                      !r.metrics.completion ||
                      r.metrics.humanSamples !== r.metrics.count
                      ? null
                      : r.metrics.humanMinutes / r.metrics.completion,
                  )}{' '}
                  min/验收任务
                  {r.metrics.humanSamples !== r.metrics.count &&
                    `（人工测量 ${r.metrics.humanSamples} / ${r.metrics.count} 项）`}
                </span>
                <button className="text-link" onClick={() => onSelect(r)}>
                  查看依据 <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <Empty title="暂无符合当前条件的方案">
            查看上方排除原因；费用缺测、暂无验收和超预算分别统计。
          </Empty>
        )}
        <SectionTitle title="历史支出符合预算的套餐" />
        {planResults.length ? (
          planResults.map((plan) => (
            <div className="recommend-card panel" key={plan.id}>
              <div className="recommend-top">
                <ModelMark id={plan.model} />
                <div>
                  <h3>{planName(plan.plan)}</h3>
                  <span>
                    {plan.modelIds.map(nameModel).join(' + ')} ·{' '}
                    {harnessCompositionLabel(plan.cohort, nameHarness)} · {plan.planVersion}
                  </span>
                </div>
                <Tag>
                  {plan.evidence.cost} / {plan.evidence.work}
                </Tag>
              </div>
              <div className="recommend-cost">
                <span>一个已观察周期的实付中位数</span>
                <strong>{money(plan.cycleCostMedian, plan.currency)}</strong>
                <small>
                  历史周期支出范围 {money(plan.cycleCostRange[0], plan.currency)} –{' '}
                  {money(plan.cycleCostRange[1], plan.currency)}
                </small>
                <small>历史支出范围不保证下次价格或交付量。</small>
              </div>
              <div className="recommend-bottom">
                <span>历史周期验收量下四分位：{number(plan.cycleAcceptedP25, 1)} 项</span>
                <span>完成率 {percent(plan.completion)}</span>
                <span>
                  {plan.periods} 个周期 · {plan.sources} 个来源
                </span>
              </div>
              <small>
                {plan.month} · {plan.currency} ·
                历史验收量不等于套餐额度或承诺容量；来源不等于独立用户。
              </small>
            </div>
          ))
        ) : (
          <Empty title="暂无符合预算的套餐" />
        )}
      </div>
    </div>
  );
}
export function statisticalTrendValue(
  row: Comparison,
  metric: string,
  plans: PlanRow[] = [],
  requireComplete = true,
): number | null {
  const m = row.metrics;
  const measured = (value: number | null, samples: number | undefined) =>
    requireComplete && (samples === undefined || samples !== m.count) ? null : value;
  if (metric === 'completion') return m.completion;
  if (metric === 'retries') return m.retries;
  if (metric === 'rework') return measured(m.rework, m.reworkSamples);
  if (metric === 'human') return measured(m.humanMinutes, m.humanSamples);
  if (metric === 'wall') return measured(m.wallMinutes, m.wallSamples);
  if (metric === 'speed') return measured(m.outputTps, m.speedSamples);
  if (metric === 'ttft') return measured(m.ttftMs, m.ttftTaskSamples);
  if (metric === 'quota')
    return (
      plans.find(
        (plan) =>
          canonical(plan.cohort) === canonical(row.cohort) &&
          plan.evidence.cost === row.evidence.cost &&
          plan.evidence.work === row.evidence.work &&
          plan.evidence.coverage === row.evidence.coverage,
      )?.tokensPerPercent ?? null
    );
  return m.costPerAccepted;
}

export function statisticalTrendChange(start: number | null, end: number | null, metric: string) {
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end))
    return '无法比较';
  if (metric === 'completion') {
    const delta = (end - start) * 100;
    return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} 个百分点`;
  }
  if (start === 0) return end === 0 ? '持平' : '基期为 0，不计算相对变化';
  const delta = ((end - start) / start) * 100;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

export function Trends({
  rows,
  plans,
  currency,
  initialMetric = 'cost',
}: {
  rows: Comparison[];
  plans: PlanRow[];
  currency: string;
  initialMetric?: string;
}) {
  const { format: money, convert, effectiveCurrency } = useDisplayCurrency();
  const [metric, setMetric] = useState(initialMetric);
  const options: [string, string][] = [
    ['cost', '每项达标成本'],
    ['completion', '任务完成率'],
    ['retries', '额外尝试次数'],
    ['rework', '返工次数'],
    ['human', '人工投入时间'],
    ['wall', '任务经过时间'],
    ['speed', '可见输出速度'],
    ['ttft', '首字等待'],
    ['quota', '每 1% 额度 Token'],
  ];
  const value = (row: Comparison) => statisticalTrendValue(row, metric, plans);
  const partial = rows.filter(
    (row) => value(row) === null && statisticalTrendValue(row, metric, plans, false) !== null,
  );
  const formatValue = (n: number | null) =>
    n === null
      ? '—'
      : metric === 'cost'
        ? money(n, currency)
        : metric === 'completion'
          ? percent(n)
          : metric === 'ttft'
            ? `${(n / 1000).toFixed(2)} s`
            : `${number(n, 1)}${metric === 'human' || metric === 'wall' ? ' min' : metric === 'speed' ? ' Token/s' : metric === 'quota' ? ' Token' : ' 次'}`;
  const label = options.find(([key]) => key === metric)![1];
  const { series, months } = trendSeries(rows, value);
  const max =
    Math.max(...rows.map((r) => value(r) ?? 0), metric === 'completion' ? 1 : 0.01) *
    (metric === 'completion' ? 1 : 1.15);
  return (
    <div className="panel">
      <SectionTitle title={`${label}的月度变化`} />
      <ChoiceTabs label="趋势指标" value={metric} onChange={setMetric} options={options} />
      <details className="statistical-basis">
        <summary>趋势依据 · 固定任务条件与配置，逐月观察</summary>
        <p>
          每条线固定模型身份、Harness
          版本、任务条件及证据口径；至少两个有效月份才展示。缺少月份时断开连线；月度样本变化可能影响结果，不能单凭走势归因于模型进步或套餐调整。
        </p>
        <p>
          完成率变化用百分点表示，其他指标按相对变化表示；基期为 0
          时不计算相对变化。计时和过程指标只对全部任务均有测量的月份连线。
        </p>
        {partial.length > 0 && (
          <p>
            {partial.length} 条月度记录测量不完整，保留以下观察值，不参与趋势比较：
            {partial
              .map(
                (row) =>
                  `${nameModel(row.modelIds[0])} ${row.cohort.month} ${formatValue(statisticalTrendValue(row, metric, plans, false))}`,
              )
              .join('；')}
            。
          </p>
        )}
      </details>
      {series.length ? (
        <>
          <div className="trend-chart">
            <svg viewBox="0 0 920 320" role="img" aria-label={`${label}月度折线图`}>
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <g key={v}>
                  <line
                    x1="65"
                    x2="880"
                    y1={270 - v * 230}
                    y2={270 - v * 230}
                    stroke="#e7e9ec"
                    strokeDasharray="4 4"
                  />
                  <text x="53" y={274 - v * 230} textAnchor="end" className="chart-tick">
                    {formatValue(max * v)}
                  </text>
                </g>
              ))}
              {months.map((m, i) => (
                <text
                  key={m}
                  x={65 + (i / Math.max(months.length - 1, 1)) * 815}
                  y="298"
                  textAnchor="middle"
                  className="chart-tick"
                >
                  {m}
                </text>
              ))}
              {series.map((series, i) => {
                const x = (r: Comparison) =>
                  65 + (months.indexOf(r.cohort.month) / Math.max(months.length - 1, 1)) * 815;
                const y = (r: Comparison) => 270 - ((value(r) ?? 0) / max) * 230;
                return (
                  <g key={i}>
                    {series.map((row, index) => {
                      const previous = series[index - 1];
                      if (
                        !previous ||
                        value(row) === null ||
                        value(previous) === null ||
                        months.indexOf(row.cohort.month) - months.indexOf(previous.cohort.month) !==
                          1
                      )
                        return null;
                      return (
                        <line
                          key={row.id}
                          x1={x(previous)}
                          y1={y(previous)}
                          x2={x(row)}
                          y2={y(row)}
                          stroke={colors[row.modelIds[0]] ?? '#777'}
                          strokeWidth="2.5"
                        />
                      );
                    })}
                    {series
                      .filter((r) => value(r) !== null)
                      .map((r) => (
                        <circle
                          key={r.id}
                          cx={x(r)}
                          cy={y(r)}
                          r="4"
                          fill="white"
                          stroke={colors[r.modelIds[0]] ?? '#777'}
                          strokeWidth="2"
                        >
                          <title>
                            {`${nameModel(r.modelIds[0])} · ${nameHarness(r.cohort.harness)} ${r.cohort.month}: ${formatValue(value(r))} · ${r.metrics.count} 项任务 / ${r.metrics.sources} 个来源`}
                          </title>
                        </circle>
                      ))}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="trend-legend">
            {series.map((s, i) => (
              <span key={i}>
                <i style={{ background: colors[s[0].modelIds[0]] }} />
                {nameModel(s[0].modelIds[0])}
                <small>
                  {harnessCompositionLabel(s[0].cohort, nameHarness)} ·{' '}
                  {modelIdentityDetails(s[0].cohort.modelIdentity)} · {s[0].evidence.cost} /{' '}
                  {s[0].evidence.work}
                </small>
              </span>
            ))}
          </div>
          <div className="trend-cards">
            {series.map((s, i) => {
              const observed = s.filter((row) => value(row) !== null);
              const start = observed[0],
                end = observed.at(-1)!;
              return (
                <div key={i}>
                  <ModelMark id={start.modelIds[0]} tiny />
                  <span>{nameModel(start.modelIds[0])}</span>
                  <strong>{statisticalTrendChange(value(start), value(end), metric)}</strong>
                  <small>
                    {start.cohort.month} → {end.cohort.month} · 两端观察差
                  </small>
                  <small>
                    {observed.length} 个有效月份 · 两端 {start.metrics.count} / {end.metrics.count}{' '}
                    项任务，{start.metrics.sources} / {end.metrics.sources} 个来源
                  </small>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <Empty title="暂无可比较的月度数据" />
      )}
    </div>
  );
}
