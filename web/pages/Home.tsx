import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, BarChart3, Download } from 'lucide-react';
import { DomainTabs } from '../DomainTabs';
import { quotaChanges } from '../../shared/plans';
import { nameHarness, nameModel } from '../../shared/catalog';
import { harnessCompositionLabel } from '../../shared/harness-composition';
import { labels, workloadLabels, type TaskKind } from '../../shared/schema';
import { workClassificationLabel } from '../../shared/work-labels';
import {
  download,
  number,
  percent,
  publicErrorState,
  type ExploreData,
  type RequestError,
} from '../api';
import {
  publicBoards,
  matchesBoardScope,
  type DashboardFilters,
  type UpdateFilters,
  type ModelBoard,
} from '../filters';
import { Button, Empty } from '../components';
import type { Page } from '../App';
import { useDisplayCurrency } from '../Currency';
import { RankingChart, type ChartRankItem } from '../RankingChart';
import { modelIdentityDetails } from '../model-identity';
import { modelIdentityKey } from '../../shared/model-identity';
import { HarnessCostMargin, RankingTradeoffs } from '../RankingTradeoffs';
import '../statistical-notes.css';
import { RankingIndependentEvaluation } from '../RankingIndependentEvaluation';

export function observedRank(
  values: readonly (number | null)[],
  value: number | null,
): number | '—' {
  const observed = values.filter((item): item is number => item !== null && Number.isFinite(item));
  return value === null || !Number.isFinite(value) || observed.length < 2
    ? '—'
    : observed.filter((item) => item < value).length + 1;
}

// Keep task-specific winners visible; the server's overall basket is not a
// substitute for a task's own comparison conditions.
export function taskModelBoards(boards: ModelBoard[]) {
  return boards.flatMap((board) =>
    board.taskResults?.length
      ? board.taskResults.map((task) => ({
          ...board,
          ...task,
          id: `${board.id}:task:${task.kind}`,
          taskKind: task.kind as TaskKind | undefined,
        }))
      : [{ ...board, taskKind: undefined as TaskKind | undefined }],
  );
}

export function rankingConditionLabel(condition: ModelBoard['strata'][number]['conditions']) {
  if (!condition) return '目标条件暂不可用';
  return [
    labels.kind[condition.kind as keyof typeof labels.kind],
    workClassificationLabel(condition),
    labels.scope[condition.scope as keyof typeof labels.scope],
    labels.acceptance[condition.acceptance as keyof typeof labels.acceptance],
    `输入 ${workloadLabels.inputUnits[condition.inputUnits as keyof typeof workloadLabels.inputUnits] ?? '未知'}`,
    `输出 ${workloadLabels.outputUnits[condition.outputUnits as keyof typeof workloadLabels.outputUnits] ?? '未知'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function rankingHarnessLabel(row: ModelBoard['rows'][number]) {
  const configurations = row.selections.flatMap((selection) => {
    const config = selection.configuration ?? selection.observedConfiguration;
    return config ? [`${nameHarness(config.harness)} ${config.harnessVersion}`] : [];
  });
  return (
    [...new Set(configurations)].join(' / ') || row.harnesses.map(nameHarness).join(' / ') || '—'
  );
}

export const rankingCompletion = (row: {
  completion: number;
  aggregation?: { acceptedPerAttempt: number | null };
}) => (row.aggregation ? row.aggregation.acceptedPerAttempt : row.completion);

export function RankingTargetNote({ target }: { target?: ModelBoard['target'] }) {
  return target?.mode === 'fixed' ? (
    <div className="statistics-note ranking-target-note">
      <strong>固定比较范围 · {target.name}</strong>
      <p>
        目标共 {target.requiredConditions} 组条件，当前有公开数据 {target.observedConditions}{' '}
        组，暂不可用 {target.unavailableConditions}{' '}
        组。缺失条件保留原权重，不重新分配。每个候选必须覆盖完整目标才参与排名。
      </p>
      <p>
        版本 {target.id?.slice(0, 12)} · 选择数据截止 {target.selectionCutoff}
        。后续数据会更新观察成本，固定版本只保存任务构成，不冻结名次。
      </p>
    </div>
  ) : (
    <p className="statistics-note ranking-target-note">
      按候选共有的任务条件比较，比较范围随候选更新。
    </p>
  );
}

export function RankingScopeNote({ result }: { result: ModelBoard }) {
  const eligible = result.rows.filter((row) => row.qualified).length;
  return (
    <div className="ranking-scope-note">
      <div className="ranking-scope-facts" aria-label="本组排名范围">
        <span>{result.strata.length} 组目标任务条件</span>
        <span>
          {eligible} / {result.rows.length} 个模型具备完整比较条件
        </span>
        <span>成本越低越靠前</span>
      </div>
      <p>
        按同类任务、同月份和费用口径比较，每组条件分别选择该模型成本最低的 Harness。缺测显示“—”。
      </p>
      <RankingTargetNote target={result.target} />
    </div>
  );
}

export function RankingBasis({ result }: { result: ModelBoard }) {
  const { format: money } = useDisplayCurrency();
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="statistical-basis"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>计算方法、适用范围与采用的 Harness</summary>
      {result.reason && <p className="statistics-unavailable">{result.reason}</p>}
      <p>
        {result.methodology?.method === 'equal-task-attempt-mix-v1'
          ? '先为每组条件选择单位验收成本最低的 Harness，再以同一发起任务构成分别汇总每次发起支出与验收率，两者相除得到主排名成本。若包含多类任务，先按任务类型等权、再在类型内按条件等权。'
          : '这份历史结果按各条件的单位验收成本等权汇总；尚未提供发起任务构成及其敏感性结果。'}
        各条件分别选择最低成本配置，再按统一任务构成汇总。失败和重试支出均计入，完成率不重复扣分。
        按原始成本判断并列，显示金额四舍五入。
      </p>
      <p>
        观察月份 {result.month}；{result.costBasis}，原币 {result.scope.currency}；费用依据{' '}
        {result.scope.evidence.cost}，验收依据 {result.scope.evidence.work}
        。记录期价格已计入历史费用，不能当作今天的报价。
      </p>
      <p>
        名次反映本期已观察配置。来源数按采集来源统计；统计显著性以独立复测为依据。
      </p>
      {result.methodology?.workloadEligibility === 'workload-comparison-1' && (
        <p>
          比较要求完整记录工作量单位、输入与输出数量档位、材料规模单位与档位。缺项保留在描述统计中，当前难度分级关闭。
        </p>
      )}
      {expanded &&
        result.rows.map((row) => (
          <div className="statistical-selection" key={row.id}>
            <strong>
              {nameModel(row.model)} · {row.count} 项任务 · {row.candidateCount} 个候选配置记录
            </strong>
            {row.support && (
              <p>
                目标条件覆盖 {row.support.matchedConditions} /{' '}
                {row.support.requiredTargetConditions ?? result.strata.length} · 权重覆盖{' '}
                {percent(row.support.targetWeightCoverage)}
              </p>
            )}
            {row.selections.map((selection, index) => {
              const config = selection.configuration ?? selection.observedConfiguration;
              return (
                <p key={index}>
                  {rankingConditionLabel(selection.conditions)}
                  <br />
                  {config
                    ? `${nameHarness(config.harness)} · ${config.harnessVersion}`
                    : '尚无匹配 Harness'}
                  {' · '}
                  {selection.count} 项任务 / {selection.sources} 个来源
                  {' · '}从 {selection.candidateCount} 个候选中选择
                  {' · '}
                  {money(selection.cost, result.scope.currency)} / 验收任务
                  {' · '}条件权重 {percent(selection.weight)}
                  <HarnessCostMargin
                    margin={selection.costMargin}
                    currency={result.scope.currency}
                  />
                  {!selection.qualified && ' · 当前条件不参与排名'}
                </p>
              );
            })}
          </div>
        ))}
    </details>
  );
}

export function RankingMethodDetails({ result }: { result: ModelBoard }) {
  const { format: money } = useDisplayCurrency();
  const available = result.methodology?.method === 'equal-task-attempt-mix-v1';
  return (
    <>
      <RankingIndependentEvaluation
        view={result.independentEvaluation}
        currency={result.scope.currency}
        conditionLabels={Object.fromEntries(
          result.strata.flatMap((s) =>
            s.targetConditionId && s.conditions
              ? [[s.targetConditionId, rankingConditionLabel(s.conditions)]]
              : [],
          ),
        )}
      />
      <details className="statistical-basis ranking-method-details">
        <summary>任务构成敏感性与成本、时间权衡</summary>
        <p>
          主排名让各模型面对相同的发起任务构成。对照值让验收成果保持相同构成，回答的是另一个工作需求。
          这两种结果的差异不是误差区间，也不表示统计显著性；应按自己的任务构成选择适用口径。
        </p>
        <p className="ranking-method-status">
          {!available
            ? '这份历史结果未提供任务构成敏感性数据。'
            : result.sensitivity?.orderChanged === true
              ? '任务构成改变后，观察名次发生变化。'
              : result.sensitivity?.orderChanged === false
                ? '本次两种任务构成下观察名次一致，不能据此保证未来名次。'
                : '可比模型不足，暂不比较两种构成的名次。'}
        </p>
        <div className="table-scroll">
          <table className="ranking-method-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>发起任务构成成本 / 验收任务</th>
                <th>验收成果构成成本 / 验收任务</th>
                <th>主排名 → 对照排名</th>
                <th>总用时 / 验收任务</th>
                <th>人工投入 / 验收任务</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {nameModel(row.model)}
                    <small>{rankingHarnessLabel(row)}</small>
                  </td>
                  <td>{available ? money(row.cost, result.scope.currency) : '—'}</td>
                  <td>
                    {money(
                      available ? row.sensitivity?.acceptedMixCost : row.cost,
                      result.scope.currency,
                    )}
                  </td>
                  <td>
                    {row.sensitivity?.primaryRank ?? '—'} →{' '}
                    {row.sensitivity?.acceptedMixRank ?? '—'}
                  </td>
                  <td>
                    {row.wallPerAccepted === null
                      ? '—（未完整测量）'
                      : `${number(row.wallPerAccepted, 1)} 分钟`}
                  </td>
                  <td>
                    {row.humanPerAccepted === null
                      ? '—（未完整测量）'
                      : `${number(row.humanPerAccepted, 1)} 分钟`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          时间与人工采用主排名选中的相同配置，仅在所有共同条件中完整记录时计算。成本最低未必耗时最短；
          不同目标分别展示，不将缺测或主观权重合成一个分数。并行子任务的时长不能直接当作任务总用时相加。
        </p>
      </details>
      <RankingTradeoffs
        rows={result.rows.map((row) => ({
          id: row.id,
          name: nameModel(row.model),
          tradeoff: row.tradeoff,
        }))}
        currency={result.scope.currency}
      />
    </>
  );
}

const planName = (id: string) =>
  ({
    'sample-coder-plan': 'Coder Plan',
    'sample-code-plan': 'Code Plan',
    'sample-coding-plan': 'Coding Plan',
  })[id] ?? id;
type Board = 'models' | 'plans' | 'time' | 'quota' | 'multiple';
type Column = { title: string; unit: string };
type DetailRow = {
  id: string;
  position: number | string;
  name: string;
  meta: string;
  cells: ReactNode[];
  values: (number | null)[];
};
type ChartGroup = {
  displayCurrency: string;
  id: string;
  label: string;
  rows: ChartRankItem[];
  detail: DetailRow[];
  columns: Column[];
  tableColumns: Column[];
  basis?: ReactNode;
  overview?: ReactNode;
  reason?: string | null;
  keepEmpty?: boolean;
};
type Chart = {
  id: Board;
  title: string;
  unit: string;
  subtitle: string;
  groups: ChartGroup[];
  signed?: boolean;
};

export function Home({
  data,
  loading,
  error,
  search,
  refresh,
  filters,
  updateFilters,
}: {
  data: ExploreData | null;
  loading: boolean;
  error: RequestError;
  search: string;
  go: (page: Page) => void;
  refresh: () => void;
  filters: DashboardFilters;
  updateFilters: UpdateFilters;
}) {
  const { format: money, convert, effectiveCurrency } = useDisplayCurrency();
  const failure = publicErrorState(error);
  const [board, setBoard] = useState<Board>('models');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [showCollectionStats, setShowCollectionStats] = useState(false);
  const [timeMetric, setTimeMetric] = useState<'wallPerAccepted' | 'humanPerAccepted'>(
    'wallPerAccepted',
  );
  const boards = publicBoards(data, filters.domain);
  const matches = (...values: string[]) =>
    !search || values.join(' ').toLowerCase().includes(search.trim().toLowerCase());
  const modelGroups: ChartGroup[] = [],
    timeGroups: ChartGroup[] = [],
    planGroups: ChartGroup[] = [],
    quotaGroups: ChartGroup[] = [],
    multipleGroups: ChartGroup[] = [];
  const costColumns = (currency: string): Column[] => [
    { title: '标准化成本', unit: effectiveCurrency(currency) },
    { title: '完成率', unit: '%' },
  ];
  const displayedCost = (cost: number | null, currency: string) => convert(cost, currency) ?? cost;
  const scopeLabel = (b: {
    costBasis: string;
    month: string;
    scope: { currency: string; payment: string };
  }) =>
    [
      b.costBasis,
      b.scope.currency,
      b.month,
      b.scope.payment !== 'regular'
        ? labels.payment[b.scope.payment as keyof typeof labels.payment]
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  for (const b of taskModelBoards(boards.models)) {
    const currency = b.scope.currency;
    const rows = b.rows.filter((r) =>
      matches(nameModel(r.model), r.id, ...r.harnesses.map(nameHarness)),
    );
    const meta = (r: (typeof rows)[number]) =>
      [
        modelIdentityDetails(r.modelIdentity),
        rankingHarnessLabel(r),
        `${r.count} 项任务 · 每组至少 ${r.sourcesMin} 个来源`,
        `目标覆盖 ${r.cells}/${r.requiredCells}`,
      ]
        .filter(Boolean)
        .join(' · ');
    const position = (r: (typeof rows)[number]) =>
      b.comparable && r.qualified
        ? observedRank(
            b.rows.filter((x) => x.qualified).map((x) => x.cost),
            r.cost,
          )
        : '—';
    modelGroups.push({
      id: b.id,
      label: [b.taskKind ? labels.kind[b.taskKind] : '共同任务组合', scopeLabel(b)].join(' · '),
      basis: (
        <>
          <RankingBasis result={b} />
          <RankingMethodDetails result={b} />
        </>
      ),
      overview: <RankingScopeNote result={b} />,
      reason: b.reason,
      keepEmpty: b.target?.mode === 'fixed',
      displayCurrency: effectiveCurrency(currency),
      columns: costColumns(currency),
      tableColumns: [
        { title: '标准化成本', unit: effectiveCurrency(currency) + ' / 验收任务' },
        { title: '完成率', unit: '%' },
        { title: '总用时', unit: 'min / 验收任务' },
        { title: '人工投入', unit: 'min / 验收任务' },
        { title: '返工', unit: '次 / 任务' },
        { title: '修改', unit: '次 / 任务' },
        { title: '意图误解', unit: '次 / 任务' },
        { title: '输出速度', unit: 'Token/s' },
        { title: '样本', unit: '任务数' },
      ],
      rows: rows.map((r) => ({
        id: r.id,
        position: position(r),
        name: nameModel(r.model),
        meta: meta(r),
        model: r.model,
        value: r.qualified ? displayedCost(r.cost, currency) : null,
        valueLabel: money(r.cost, currency),
        eligible: b.comparable && r.qualified,
        metrics: [money(r.cost, currency), percent(rankingCompletion(r))],
      })),
      detail: rows.map((r) => ({
        id: r.id,
        position: position(r),
        name: nameModel(r.model),
        meta: meta(r),
        cells: [
          money(r.cost, currency),
          percent(rankingCompletion(r)),
          number(r.wallPerAccepted, 1),
          number(r.humanPerAccepted, 1),
          number(r.reworkPerTask, 2),
          number(r.revisionsPerTask, 2),
          number(r.intentErrorsPerTask, 2),
          number(r.outputTps, 1),
          number(r.count),
        ],
        values: [
          r.cost,
          rankingCompletion(r),
          r.wallPerAccepted,
          r.humanPerAccepted,
          r.reworkPerTask,
          r.revisionsPerTask,
          r.intentErrorsPerTask,
          r.outputTps,
          r.count,
        ],
      })),
    });
    const timed = b.rows
      .filter((r) => r.qualified && r[timeMetric] !== null)
      .sort((a, b) => a[timeMetric]! - b[timeMetric]!);
    const visible = timed.filter((r) =>
      matches(nameModel(r.model), r.id, ...r.harnesses.map(nameHarness)),
    );
    timeGroups.push({
      id: b.id,
      label: [b.taskKind ? labels.kind[b.taskKind] : '共同任务组合', scopeLabel(b)].join(' · '),
      basis: (
        <p className="statistics-note">
          按成本榜采用的 Harness 比较时间；并非从全部 Harness
          中重新寻找最快配置。仅展示计时覆盖全部任务的观察值；时间缺测不记为 0。
        </p>
      ),
      displayCurrency: effectiveCurrency(currency),
      columns: [
        { title: '人工投入', unit: 'min / 项' },
        { title: '输出速度', unit: 'Token/s' },
      ],
      tableColumns: [
        { title: '总用时', unit: 'min / 验收任务' },
        { title: '人工投入', unit: 'min / 验收任务' },
        { title: '输出速度', unit: 'Token/s' },
        { title: '完成率', unit: '%' },
        { title: '标准化成本', unit: effectiveCurrency(currency) + ' / 验收任务' },
        { title: '样本', unit: '任务数' },
      ],
      rows: visible.map((r) => ({
        id: r.id,
        position: observedRank(
          timed.map((row) => row[timeMetric]),
          r[timeMetric],
        ),
        name: nameModel(r.model),
        meta: meta(r),
        model: r.model,
        value: r[timeMetric],
        valueLabel: number(r[timeMetric], 1),
        eligible: true,
        metrics: [number(r.humanPerAccepted, 1), number(r.outputTps, 1)],
      })),
      detail: visible.map((r) => ({
        id: r.id,
        position: observedRank(
          timed.map((row) => row[timeMetric]),
          r[timeMetric],
        ),
        name: nameModel(r.model),
        meta: meta(r),
        cells: [
          number(r.wallPerAccepted, 1),
          number(r.humanPerAccepted, 1),
          number(r.outputTps, 1),
          percent(rankingCompletion(r)),
          money(r.cost, currency),
          number(r.count),
        ],
        values: [
          r.wallPerAccepted,
          r.humanPerAccepted,
          r.outputTps,
          rankingCompletion(r),
          r.cost,
          r.count,
        ],
      })),
    });
  }
  for (const b of boards.plans) {
    const currency = b.scope.currency;
    const history = (data?.plans ?? []).filter((r) => matchesBoardScope(r, b.scope));
    const rows = b.rows.filter((r) =>
      matches(planName(r.plan), r.version, ...r.modelIds.map(nameModel)),
    );
    const meta = (r: (typeof rows)[number]) =>
      [
        r.modelIds.map(nameModel).join(' + '),
        r.version,
        r.support
          ? `目标覆盖 ${r.support.matchedConditions}/${r.support.requiredTargetConditions ?? b.strata}`
          : '目标覆盖未提供',
        ...new Set(
          history
            .filter(
              (record) =>
                record.month === b.month &&
                record.plan === r.plan &&
                record.planVersion === r.version &&
                modelIdentityKey(record.cohort.modelIdentity) === modelIdentityKey(r.modelIdentity),
            )
            .map(
              (record) =>
                `${harnessCompositionLabel(record.cohort, nameHarness)} · ${labels.kind[record.cohort.kind]}`,
            ),
        ),
      ].join(' · ');
    const position = (r: (typeof rows)[number]) =>
      r.qualified && b.rows.filter((x) => x.qualified).length >= 2
        ? observedRank(
            b.rows.filter((x) => x.qualified).map((x) => x.cost),
            r.cost,
          )
        : '—';
    planGroups.push({
      id: b.id,
      label: scopeLabel(b),
      basis: (
        <>
          <p className="statistics-note">
            按共同任务条件比较历史账期，至少两个可比套餐才生成名次。样本单位为账期记录。
          </p>
          <RankingTradeoffs
            rows={b.rows.map((row) => ({
              id: row.id,
              name: `${planName(row.plan)} ${row.version}`,
              tradeoff: row.tradeoff,
            }))}
            currency={currency}
          />
        </>
      ),
      overview: <RankingTargetNote target={b.target} />,
      reason: b.reason,
      keepEmpty: b.target?.mode === 'fixed',
      displayCurrency: effectiveCurrency(currency),
      columns: costColumns(currency),
      tableColumns: [
        { title: '标准化成本', unit: effectiveCurrency(currency) + ' / 验收任务' },
        { title: '完成率', unit: '%' },
        { title: '账期实付范围', unit: effectiveCurrency(currency) },
        { title: '样本', unit: '账期记录' },
      ],
      rows: rows.map((r) => ({
        id: r.id,
        position: position(r),
        name: planName(r.plan),
        meta: meta(r),
        value: r.qualified ? displayedCost(r.cost, currency) : null,
        valueLabel: money(r.cost, currency),
        eligible: r.qualified,
        metrics: [money(r.cost, currency), percent(rankingCompletion(r))],
      })),
      detail: rows.map((r) => ({
        id: r.id,
        position: position(r),
        name: planName(r.plan),
        meta: meta(r),
        cells: [
          money(r.cost, currency),
          percent(rankingCompletion(r)),
          money(r.cycleCostRange[0], currency) + ' – ' + money(r.cycleCostRange[1], currency),
          number(r.periods),
        ],
        values: [r.cost, rankingCompletion(r), r.cycleCostRange[0], r.periods],
      })),
    });
    const changes = quotaChanges(history, b.month).filter((r) =>
      matches(planName(r.plan), ...r.modelIds.map(nameModel)),
    );
    quotaGroups.push({
      id: b.id,
      label: scopeLabel(b),
      basis: (
        <p className="statistics-note">
          每 1% 额度对应的 Token
          变化来自已观察区间，受模型、缓存、任务和计量规则影响，不能单独认定套餐扩容或缩水；缺少可比上月时显示“—”。
        </p>
      ),
      displayCurrency: effectiveCurrency(currency),
      columns: [{ title: '样本', unit: '额度区间' }],
      tableColumns: [
        { title: '额度变化', unit: '相对上月' },
        { title: '比较月份', unit: '' },
        { title: '样本', unit: '额度区间' },
      ],
      rows: changes.map((r) => ({
        id: r.id,
        position: '·',
        name: planName(r.plan),
        meta: [
          r.modelIds.map(nameModel).join(' + '),
          r.planVersion,
          nameHarness(r.cohort.harness),
          labels.kind[r.cohort.kind],
        ].join(' · '),
        value: r.change === null ? null : r.change * 100,
        valueLabel: r.change === null ? '—' : (r.change > 0 ? '+' : '') + percent(r.change),
        eligible: true,
        metrics: [number(r.quotaSamples)],
      })),
      detail: changes.map((r) => ({
        id: r.id,
        position: '·',
        name: planName(r.plan),
        meta: [
          r.modelIds.map(nameModel).join(' + '),
          nameHarness(r.cohort.harness),
          labels.kind[r.cohort.kind],
        ].join(' · '),
        cells: [
          r.change === null ? '—' : (r.change > 0 ? '+' : '') + percent(r.change),
          r.previousMonth + ' → ' + r.month,
          number(r.quotaSamples),
        ],
        values: [r.change, null, r.quotaSamples],
      })),
    });
    const multiples = history.filter(
      (r) =>
        r.month === b.month &&
        r.apiEquivalentMultiple !== null &&
        matches(planName(r.plan), ...r.modelIds.map(nameModel)),
    );
    multipleGroups.push({
      id: b.id,
      label: scopeLabel(b),
      basis: (
        <p className="statistics-note">
          按记录中的 API
          价格版本折算，与净实付相除。倍数是费用换算，不代表能力倍数、节省承诺或当前折扣；不能跨币种合并。
        </p>
      ),
      displayCurrency: effectiveCurrency(currency),
      columns: [{ title: '样本', unit: '账期记录' }],
      tableColumns: [
        { title: '等价金额倍数', unit: '倍' },
        { title: 'API 等价费用', unit: effectiveCurrency(currency) },
        { title: '实付合计', unit: effectiveCurrency(currency) },
        { title: '价格版本', unit: '' },
        { title: '样本', unit: '账期记录' },
      ],
      rows: multiples.map((r) => ({
        id: r.id,
        position: '·',
        name: planName(r.plan),
        meta: [
          r.modelIds.map(nameModel).join(' + '),
          nameHarness(r.cohort.harness),
          labels.kind[r.cohort.kind],
        ].join(' · '),
        value: r.apiEquivalentMultiple,
        valueLabel: number(r.apiEquivalentMultiple, 2) + '×',
        eligible: true,
        metrics: [number(r.periods)],
      })),
      detail: multiples.map((r) => ({
        id: r.id,
        position: '·',
        name: planName(r.plan),
        meta: [
          r.modelIds.map(nameModel).join(' + '),
          nameHarness(r.cohort.harness),
          labels.kind[r.cohort.kind],
        ].join(' · '),
        cells: [
          number(r.apiEquivalentMultiple, 2) + '×',
          money(r.apiEquivalentMinor, currency),
          money(r.observedPaidMinor, currency),
          r.apiEquivalentPriceVersion,
          number(r.periods),
        ],
        values: [
          r.apiEquivalentMultiple,
          r.apiEquivalentMinor,
          r.observedPaidMinor,
          null,
          r.periods,
        ],
      })),
    });
  }
  const shownCurrency = effectiveCurrency(
    boards.models[0]?.scope.currency ?? boards.plans[0]?.scope.currency ?? 'CNY',
  );
  const charts: Chart[] = [
    {
      id: 'models',
      title: '模型性价比',
      unit: '单位验收成本',
      subtitle: `${shownCurrency} / 验收任务 · 越低越好`,
      groups: modelGroups,
    },
    {
      id: 'plans',
      title: '套餐性价比',
      unit: '单位验收成本',
      subtitle: `${shownCurrency} / 验收任务 · 越低越好`,
      groups: planGroups,
    },
    {
      id: 'time',
      title: '时间成本',
      unit: '分钟',
      subtitle: '分钟 / 验收任务 · 越低越好',
      groups: timeGroups,
    },
    {
      id: 'quota',
      title: '套餐额度变化',
      unit: '变化 %',
      subtitle: '每 1% 额度对应 Token 的月度变化',
      groups: quotaGroups,
      signed: true,
    },
    {
      id: 'multiple',
      title: '套餐等价金额倍数',
      unit: '倍数',
      subtitle: 'API 等价费用 / 套餐实付',
      groups: multipleGroups,
    },
  ];
  const timeSwitch = (
    <div className="chart-time-switch" role="group" aria-label="时间成本指标">
      <button
        aria-pressed={timeMetric === 'wallPerAccepted'}
        onClick={() => setTimeMetric('wallPerAccepted')}
      >
        总用时
      </button>
      <button
        aria-pressed={timeMetric === 'humanPerAccepted'}
        onClick={() => setTimeMetric('humanPerAccepted')}
      >
        人工投入
      </button>
    </div>
  );
  return (
    <div className="home-page dense-home direct-results">
      <header className="leaderboard-heading">
        <h1>AI 性价比排行</h1>
        <div className="result-actions">
          <button
            className={`collection-stats-toggle${showCollectionStats ? ' active' : ''}`}
            aria-label={showCollectionStats ? '隐藏收集统计' : '显示收集统计'}
            aria-expanded={showCollectionStats}
            aria-controls="collection-statistics"
            title={showCollectionStats ? '隐藏收集统计' : '显示收集统计'}
            onClick={() => setShowCollectionStats((value) => !value)}
          >
            <BarChart3 size={16} />
            <span>统计</span>
          </button>
          <div className="leaderboard-view-switch" role="group" aria-label="排行榜视图">
            <button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
              图表
            </button>
            <button aria-pressed={view === 'table'} onClick={() => setView('table')}>
              数据
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="下载排名数据"
            disabled={!data}
            onClick={() =>
              download('OpenCost-overview.json', {
                source: data?.source,
                domain: filters.domain,
                exportedAt: new Date().toISOString(),
                statisticsVersion: data?.statisticsVersion ?? null,
                rankingTargetsVersion: data?.rankingTargetsVersion ?? null,
                rankingStudiesVersion: data?.rankingStudiesVersion ?? null,
                updatedAt: data?.updatedAt,
                ...boards,
              })
            }
          >
            <Download size={16} />
          </button>
        </div>
      </header>
      {showCollectionStats && (
        <section className="collection-statistics" id="collection-statistics" aria-label="收集统计">
          {[
            ['已收到工作摘要', number(data?.communityStats?.summaries), '份'],
            [
              '已记录任务时长',
              number(
                data?.communityStats?.wallMs == null ? null : data.communityStats.wallMs / 3600000,
                1,
              ),
              '小时',
            ],
            ['工作任务', number(data?.communityStats?.tasks), '项'],
          ].map(([label, value, unit]) => (
            <div className="collection-stat" key={label}>
              <span>{label}</span>
              <div>
                <strong>{value}</strong>
                <small>{unit}</small>
              </div>
            </div>
          ))}
        </section>
      )}
      <DomainTabs value={filters.domain} onChange={(domain) => updateFilters({ domain })} />
      {data && (
        <p className="statistics-meta">
          {data.source === 'demo' ? '示例统计数据' : '公开观察数据'} ·{' '}
          {data.updatedAt ? `数据更新 ${data.updatedAt.slice(0, 10)}` : '更新时间未提供'} ·
          {data.statisticsVersion && (
            <span title={data.statisticsVersion}>
              结果版本 {data.statisticsVersion.slice(0, 12)} ·{' '}
            </span>
          )}
          费用按记录期口径比较，币种分别排名
        </p>
      )}
      {view === 'table' && (
        <nav className="leaderboard-tabs" aria-label="首页排名分类">
          {charts.map((c) => (
            <button key={c.id} aria-pressed={board === c.id} onClick={() => setBoard(c.id)}>
              {c.title}
            </button>
          ))}
        </nav>
      )}
      {loading ? (
        <div className="leaderboard-loading" role="status">
          正在加载排名…
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
        <div className={view === 'chart' ? 'overview-charts' : 'overview-tables'}>
          {charts
            .filter((c) => view === 'chart' || c.id === board)
            .map((c) => (
              <section
                key={c.id}
                className={'overview-chart chart-' + c.id}
                aria-labelledby={'chart-title-' + c.id}
              >
                <header className="overview-chart-heading">
                  <div>
                    <span className="chart-index" aria-hidden="true" />
                    <h2 id={'chart-title-' + c.id}>{c.title}</h2>
                    <span className="chart-count">
                      {c.groups.reduce((n, g) => n + g.rows.length, 0)}
                    </span>
                  </div>
                  <div className="chart-heading-actions">
                    {c.id === 'time' && timeSwitch}
                    {view === 'chart' && (
                      <button
                        onClick={() => {
                          setBoard(c.id);
                          setView('table');
                        }}
                      >
                        详细数据 <ArrowUpRight size={13} />
                      </button>
                    )}
                  </div>
                </header>
                {c.groups
                  .filter((g) => g.rows.length || (g.keepEmpty && !search))
                  .map((g) => (
                    <div className="chart-result-group" key={g.id}>
                      <div className="result-scope">
                        <span>{g.label}</span>
                        <span>
                          {['models', 'plans'].includes(c.id)
                            ? `${g.displayCurrency} / 验收任务 · 越低越好`
                            : c.subtitle}
                        </span>
                      </div>
                      {g.reason && <p className="statistics-unavailable">{g.reason}</p>}
                      {g.overview}
                      {view === 'chart' ? (
                        <RankingChart
                          rows={g.rows}
                          columns={g.columns}
                          label={c.title}
                          unit={c.unit}
                          max={Math.max(0, ...g.rows.map((r) => Math.abs(r.value ?? 0)))}
                          signed={c.signed}
                        />
                      ) : (
                        <RankingTable group={g} label={c.title} />
                      )}
                      {c.id === 'models' ? (
                        g.basis
                      ) : (
                        <details className="statistical-basis">
                          <summary>指标口径</summary>
                          {g.basis}
                        </details>
                      )}
                    </div>
                  ))}
                {!c.groups.some((g) => g.rows.length || (g.keepEmpty && !search)) && (
                  <div className="chart-empty">
                    <strong>{search ? '没有匹配的记录' : '数据不足'}</strong>
                    {!search && (
                      <small>
                        {['models', 'plans'].includes(c.id)
                          ? '排名需要至少两个可比对象；不同任务、月份、费用口径和币种分别计算。'
                          : '所需的计时、额度区间或历史价格记录不足；缺测不按 0 计算。'}
                      </small>
                    )}
                  </div>
                )}
              </section>
            ))}
        </div>
      )}
      <section className="home-collection-invite" aria-label="加入脱敏工作摘要收集计划">
        <div className="collection-invite-heading">
          <div><h2>加入脱敏工作摘要收集计划</h2><p>获得工作统计、订阅额度监控与性价比建议。</p></div>
          <a className="collection-invite-action" href="#contribute">加入计划 <ArrowUpRight size={18} /></a>
        </div>
        <div className="collection-privacy">
          <h3>关于您的隐私</h3>
          <p>本站只接收结构化脱敏摘要，不接收原始对话、源码、文件路径和账号凭据。上传前由您确认全部字段和分享范围。</p>
          <p>数据采集与摘要工具已开源：<a href="https://github.com/Han-1413141/OpenCost-ai" target="_blank" rel="noreferrer">GitHub 仓库 <ArrowUpRight size={13} /></a>。您可以审查代码；私人记录不公开，参与统计由您选择。</p>
        </div>
        <h3 className="collection-benefits-heading">您能获得什么</h3>
        <ol className="collection-benefits">
          {[
            ['模型与套餐建议', '按您的工作类型比较模型、Harness 和套餐，找到更省的方案。'],
            ['订阅额度监控', '跟踪消耗、重置和赠额，了解套餐额度的变化。'],
            ['个人费用与用量分析', '查看实付、Token、对话轮次，以及失败、重试和返工开销。'],
            ['同类工作参照', '了解同类任务中的成本、效率和额度使用水平。'],
            ['工作量与效率回顾', '回看完成量、验收和耗时，结合历史记录观察变化。'],
          ].map(([title, detail]) => <li key={title}><strong>{title}</strong><span>{detail}</span></li>)}
        </ol>
        <p className="collection-data-status">网站初期参照数据不足，模型与套餐建议、同类对比将在数据积累充足后生成。个人工作量、用量和费用可先行查看。</p>
      </section>
    </div>
  );
}

function RankingTable({ group, label }: { group: ChartGroup; label: string }) {
  const [sort, setSort] = useState<{ index: number; descending: boolean } | null>(null);
  const rows = sort
    ? [...group.detail].sort((a, b) => {
        const x = a.values[sort.index],
          y = b.values[sort.index];
        if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
        return (x - y) * (sort.descending ? -1 : 1);
      })
    : group.detail;
  return (
    <div className="table-scroll leaderboard-scroll" tabIndex={0} aria-label={label}>
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th scope="col">排名</th>
            <th scope="col" className="leader-name">
              {label.includes('套餐') ? '套餐' : '模型'}
            </th>
            {group.tableColumns.map((c, i) => (
              <th
                key={c.title}
                scope="col"
                aria-sort={
                  sort?.index === i ? (sort.descending ? 'descending' : 'ascending') : 'none'
                }
              >
                <button
                  onClick={() =>
                    setSort({
                      index: i,
                      descending:
                        sort?.index === i
                          ? !sort.descending
                          : ['完成率', '输出速度', '样本', '等价金额倍数'].includes(c.title),
                    })
                  }
                  aria-label={'按' + c.title + '排序'}
                >
                  <span>
                    {c.title}
                    {sort?.index === i &&
                      (sort.descending ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                  </span>
                  <small>{c.unit}</small>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="leader-position">{r.position}</td>
              <td className="leader-name">
                <strong>{r.name}</strong>
                <small>{r.meta}</small>
              </td>
              {r.cells.map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
