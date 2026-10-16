import type { RankingStudyView } from '../shared/ranking-study-report';
import { nameHarness, nameModel } from '../shared/catalog';
import { percent } from './api';
import { modelIdentityDetails } from './model-identity';
import { useDisplayCurrency } from './Currency';
import type { GroupResampling } from '../shared/ranking-resampling';
import { SelectionStabilityView } from '../shared/SelectionStabilityView';
import type { SourceSensitivity } from '../shared/ranking-source-sensitivity';
import { TaskWeightSensitivityView } from '../shared/TaskWeightSensitivityView.js';
import { SourceBalanceView } from '../shared/SourceBalanceView.js';

const influenceNames = {
  up_to_5pct: '不超过 5%',
  '5_to_20pct': '超过 5%，不超过 20%',
  '20_to_50pct': '超过 20%，不超过 50%',
  over_50pct: '超过 50%',
  unknown: '无法判断：有缺失条件或 0/0',
  unbounded: '无有限上界：删除后出现零验收且有支出',
  zero_baseline: '基础费用为零，相对变化不适用',
  zero_acceptance: '基础验收数为零，无法计算有限单位费用',
} satisfies Record<NonNullable<SourceSensitivity['models'][number]['costInfluence']>, string>;
const sourceReasons = {
  complete: '所有逐组删除均满足发布支持要求',
  base_incomplete: '基础评价缺项，未披露来源影响',
  few_groups: '已知关联组不足 20，未披露来源影响',
  distribution_support: '原始分布的公开支持不足，未披露来源影响',
  residual_support: '至少一次删除后支持不足，整项影响与占比均隐藏',
  work_budget: '本次计算超出处理容量，未使用部分结果',
} satisfies Record<SourceSensitivity['models'][number]['reason'], string>;
const shareNames = {
  up_to_10pct: '不超过 10%',
  '10_to_20pct': '超过 10%，不超过 20%',
  '20_to_35pct': '超过 20%，不超过 35%',
  '10_to_25pct': '超过 10%，不超过 25%',
  '25_to_50pct': '超过 25%，不超过 50%',
  '50_to_75pct': '超过 50%，不超过 75%',
  over_75pct: '超过 75%',
  no_positive_total: '无正总量，占比不适用',
};
export function RankingSourceSensitivity({
  result,
  modelLabels = {},
}: {
  result?: SourceSensitivity;
  modelLabels?: Record<string, string>;
}) {
  return (
    <details className="ranking-source-sensitivity">
      <summary>来源影响 · 固定选型，逐组删除</summary>
      {!result ? (
        <p>这份报告未生成来源影响分析，不能将缺项解释为影响为零。</p>
      ) : (
        <>
          <p>
            每次删除一个已知关联组在该模型下的全部观测，保持任务权重和 Harness 不变。
            下列档位表示单位验收费用相对原结果的最大变化，方向可能上升或下降。它不是置信区间、未来风险或模型能力排名；
            不同模型的来源数量和构成不同，不能按这些档位比较名次。
          </p>
          {result.models.map((m) => (
            <div className="statistical-selection" key={m.modelId}>
              <strong>{modelLabels[m.modelId] ?? m.modelId}</strong>
              <p>{m.costInfluence ? influenceNames[m.costInfluence] : sourceReasons[m.reason]}</p>
              {m.concentration && (
                <ul>
                  <li>任务量的单组最高占比：{shareNames[m.concentration.taskBand]}</li>
                  <li>归属支出的单组最高占比：{shareNames[m.concentration.spendBand]}</li>
                  <li>验收目标的单组最高占比：{shareNames[m.concentration.acceptanceBand]}</li>
                </ul>
              )}
            </div>
          ))}
          <p>
            占比在各任务条件内计算，再分别取最高值，可能来自不同组。关联组不等于独立用户。
            每次删除后每个条件须保留至少 20
            组，并通过任务量、集中度及验收分布检查；有一次不满足，就隐藏整项结果。
            这些是发布规则，不证明统计独立。页面只公布固定档位，不提供逐组结果或精确极值。
          </p>
        </>
      )}
    </details>
  );
}

const resamplingReasons = {
  base_incomplete: '基础评价缺项，分布未披露',
  few_groups: '已知关联组较少，仅显示点估计',
  distribution_support: '分布公开支持不足',
  work_budget: '本次未完成重采样计算',
  all_accepted: '观测全部通过验收，未观测失败的波动未知',
  all_zero_acceptance: '观测全部零验收，无法估计有限范围',
  observed_values_identical: '观测组重采样值相同，未显示范围',
  complete: '保留无界和未知重复',
};
export function RankingResamplingRange({
  result,
  currency,
}: {
  result?: GroupResampling['models'][number];
  currency: string;
}) {
  const { format: money } = useDisplayCurrency();
  if (!result) return <span>—（旧报告未生成）</span>;
  return (
    <>
      {result.range ? (
        <span>
          {result.range.lower.kind === 'unbounded' ? (
            '本次中间范围没有有限费用值'
          ) : (
            <>
              {money(result.range.lower.value, currency)} —{' '}
              {result.range.upper.kind === 'unbounded'
                ? '无有限上界'
                : money(result.range.upper.value, currency)}
            </>
          )}
        </span>
      ) : (
        <span>—</span>
      )}
      <small>{resamplingReasons[result.reason]}</small>
      {result.counts && (
        <small>
          有限 {result.counts.finite}/1000 · 零验收有支出 {result.counts.zeroAcceptancePaid} ·
          缺条件 {result.counts.missingCondition} · 0/0 未定义 {result.counts.undefinedZeroOverZero}
        </small>
      )}
    </>
  );
}

const unavailable = {
  not_evaluated: '尚未独立评价',
  target_not_fixed: '尚未固定比较目标',
  snapshot_changed: '事实版本已变化，原评价不适用于当前数据',
  target_changed: '比较目标已变化，需要按新目标评价',
} as const;
const surfaceNames = {
  cli: '命令行',
  desktop: '桌面',
  ide: '编辑器',
  web: '网页',
  api: 'API',
  custom: '自定义环境',
  unknown: '环境未记录',
};
const reasoningNames = { low: '低', medium: '中', high: '高', auto: '自动' };
const cacheNames = { on: '启用', off: '关闭', mixed: '混合' };
export function RankingIndependentEvaluation({
  view,
  currency,
  conditionLabels = {},
}: {
  view?: RankingStudyView;
  currency: string;
  conditionLabels?: Record<string, string>;
}) {
  const { format: money } = useDisplayCurrency();
  const report = view?.status === 'available' ? view.report : null;
  const resampling =
    report?.format === 'ranking-source-holdout-public-2' ? report.resampling : null;
  const resamplingModels = new Map(resampling?.models.map((m) => [m.modelId, m]));
  return (
    <details className="statistical-basis ranking-independent-evaluation">
      <summary>
        独立评价 ·{' '}
        {report
          ? report.state === 'complete'
            ? '已取得完整留出结果'
            : report.state === 'partial'
              ? '部分模型支持不足'
              : '评价样本支持不足'
          : unavailable[
              view?.status === 'available' ? 'not_evaluated' : (view?.status ?? 'not_evaluated')
            ]}
      </summary>
      {!report ? (
        <p>
          当前名次来自历史观察中的选择。独立评价按已知来源关联整组划分，先固定模型和各任务条件的
          Harness，再评价未参与选择的数据；尚无适用结果时不能称为复测通过。
        </p>
      ) : (
        <>
          <p>
            这份结果评价选择集已固定的模型与
            Harness。下表保留原选择顺序，不在评价集重新挑赢家，也不改变上方使用全量数据计算的历史名次。
          </p>
          <p>
            同月 {report.month} · 已知来源关联分组留出 · 验收依据 {report.scope.evidence.work} ·
            费用依据 {report.scope.evidence.cost}
            。置信区间尚未估计；未知任务族的相关性仍可能存在，组数不等于独立用户数。
          </p>
          <div className="table-scroll">
            <table className="ranking-method-table">
              <thead>
                <tr>
                  <th>固定候选模型</th>
                  <th>选择集费用 / 验收目标</th>
                  <th>评价集费用 / 验收目标</th>
                  <th>评价集支出 / 已结束目标</th>
                  <th>评价集验收比例</th>
                  <th>支持状态</th>
                  <th>观测组重采样范围 / 验收目标</th>
                </tr>
              </thead>
              <tbody>
                {report.models.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {nameModel(m.identity.members[0].model)}
                      <small>{modelIdentityDetails(m.identity)}</small>
                      {m.primarySelection && (
                        <small className="ranking-primary-selection">选择集原最低费用模型</small>
                      )}
                    </td>
                    <td>{money(m.selectionCost, currency)}</td>
                    <td>
                      {m.status === 'zero_acceptance'
                        ? '全部零验收，无法计算有限费用'
                        : money(m.costPerAccepted, currency)}
                    </td>
                    <td>{money(m.perRootSpend, currency)}</td>
                    <td>{m.acceptedPerRoot === null ? '—' : percent(m.acceptedPerRoot)}</td>
                    <td>
                      {m.status === 'incomplete'
                        ? '缺少完整公开支持，隐藏分项与费用'
                        : m.status === 'zero_acceptance'
                          ? '支出已知，验收数为零'
                          : '完整固定条件'}
                    </td>
                    <td>
                      <RankingResamplingRange
                        result={resamplingModels.get(m.id)}
                        currency={currency}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resampling && (
            <p>
              上表范围取1000次整组重采样结果的中间95%，仅描述本次观测组的变化，不是已校准的95%置信区间或未来费用保证。各模型和任务条件共享同一组抽样权重；缺条件及0/0按完整非负范围处理，零验收有支出允许无有限上界。少于20组的条件不公开分布；20组是本项目的发布规则，不是可靠性证明。范围没有计入选择集选型的不确定性、未识别的来源依赖、未来价格和任务变化。
            </p>
          )}
          <RankingSourceSensitivity
            result={
              report.format === 'ranking-source-holdout-public-2'
                ? report.sourceSensitivity
                : undefined
            }
            modelLabels={Object.fromEntries(
              report.models.map((m) => [
                m.id,
                `${nameModel(m.identity.members[0].model)} · ${modelIdentityDetails(m.identity)}`,
              ]),
            )}
          />
          <SelectionStabilityView
            conditionLabels={conditionLabels}
            configurationLabels={Object.fromEntries(
              report.models.flatMap((m) =>
                m.cells.map((c) => [
                  `${m.id}/${c.conditionId}`,
                  `${nameHarness(c.configuration.harness)} · ${c.configuration.harnessVersion} · ${c.configuration.harnessVariant ?? '型号未记录'}`,
                ]),
              ),
            )}
            result={
              report.format === 'ranking-source-holdout-public-2'
                ? report.selectionStability
                : undefined
            }
            modelLabels={Object.fromEntries(
              report.models.map((m) => [
                m.id,
                `${nameModel(m.identity.members[0].model)} · ${modelIdentityDetails(m.identity)}`,
              ]),
            )}
          />
          <SourceBalanceView
            result={
              report.format === 'ranking-source-holdout-public-2' ? report.sourceBalance : undefined
            }
            modelLabels={Object.fromEntries(
              report.models.map((m) => [
                m.id,
                `${nameModel(m.identity.members[0].model)} · ${modelIdentityDetails(m.identity)}`,
              ]),
            )}
          />
          <TaskWeightSensitivityView
            result={view?.weightSensitivity}
            currency={currency}
            conditionLabels={conditionLabels}
            modelLabels={Object.fromEntries(
              report.models.map((m) => [
                m.id,
                `${nameModel(m.identity.members[0].model)} · ${modelIdentityDetails(m.identity)}`,
              ]),
            )}
          />
          <details>
            <summary>各任务条件采用的 Harness 与样本</summary>
            {report.models
              .filter((m) => m.status !== 'incomplete')
              .map((m) => (
                <div className="statistical-selection" key={m.id}>
                  <strong>{nameModel(m.identity.members[0].model)}</strong>
                  {m.cells.map((c) => (
                    <p key={c.conditionId}>
                      {conditionLabels[c.conditionId] ?? `条件 ${c.conditionId.slice(0, 12)}`} ·
                      权重 {percent(c.weight)}
                      <br />
                      {nameHarness(c.configuration.harness)} {c.configuration.harnessVersion} ·{' '}
                      {c.configuration.harnessVariant ?? '型号未记录'} ·{' '}
                      {surfaceNames[c.configuration.harnessSurface]} · 套餐 {c.configuration.plan}{' '}
                      {c.configuration.planVersion}
                      <br />
                      {c.configuration.mode === 'agent' ? '自动执行' : '辅助协作'} ·{' '}
                      {c.configuration.tools === 'standard' ? '标准工具' : '扩展工具'} · 推理{' '}
                      {reasoningNames[c.configuration.reasoning]} · 缓存{' '}
                      {cacheNames[c.configuration.cache]}
                      <br />
                      {c.count} 个已结束根目标，{c.accepted} 个通过验收，{c.groups} 个已知关联组 ·
                      归属支出 {money(c.spendMinor, currency)}
                    </p>
                  ))}
                </div>
              ))}
          </details>
          <p>
            分母包含已结束的失败目标与其重试支出；仍在进行中的目标不在该验收比例中。缺项保留原权重，零验收保留已知支出，不把缺测当零。
          </p>
          <p className="ranking-study-provenance">
            准备 {report.preparedAt} · 评价 {report.evaluatedAt} · 数据更新{' '}
            {report.sourceUpdatedAt ?? '未知'}
            <br />
            目标版本 {report.targetId.slice(0, 12)} · 事实版本 {report.dataVersion.slice(0, 12)} ·
            报告 {report.id.slice(0, 12)}
          </p>
        </>
      )}
    </details>
  );
}
