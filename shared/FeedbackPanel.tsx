import {
  referenceUnavailableNote,
  feedbackReferenceCountsText,
  feedbackReferenceExclusionsText,
  legacyJournalCoverageNotice,
  referenceExclusionNote,
  type PersonalFeedback,
} from './personal-feedback';
import { isModelIdentity } from './model-identity';
import { ModelTimelineView } from './ModelTimelineView';
import { workUnits } from './work-taxonomy';
import { taskInsightUnitLabels } from './task-insights';
import { chargeReconciliationLines } from './charge-reconciliation';
import './feedback.css';
import { feedbackNextSteps } from './feedback-next-steps';
import { FeedbackPublicStudy } from './FeedbackPublicStudy.js';
import { FeedbackTaskProfile } from './FeedbackTaskProfile.js';
import { FeedbackPersona } from './FeedbackPersona.js';
import { getLocale, t } from '../web/i18n/locale.js';
const value = (n: number | null, unit: string) =>
  n === null
    ? '未记录'
    : unit.endsWith('_minor')
      ? `${(n / 100).toLocaleString(getLocale(), { maximumFractionDigits: 2 })} ${unit.replace('_minor', '')}`
      : unit === 'milliseconds'
        ? `${(n / (n >= 60000 ? 60000 : 1000)).toLocaleString(getLocale(), { maximumFractionDigits: 2 })} ${n >= 60000 ? '分钟' : '秒'}`
        : `${n.toLocaleString(getLocale(), { maximumFractionDigits: 2 })} ${t(taskInsightUnitLabels[unit] ?? unit)}`;
const stages = {
  single: '单次观察',
  short: '短期观察',
  weekly: '已积累一周范围',
  monthly: '已积累一个月范围',
};
const comparisonReasons = {
  available: '已有可比指标',
  reference_unavailable: '公开参照暂不可用',
  record_incomplete: '记录、费用或历史结算条件不足',
  workload_unknown: '工作量或材料规模缺项',
  no_same_conditions: '没有相同条件的公开配置',
  too_few_configurations: '可比配置少于三个',
  missing_measurements: '可比指标的测量不足',
};
const position = { lower: '较低', typical: '参考区间内', higher: '较高', unavailable: '暂不比较' };
const lowerIsBetter = new Set(['cost', 'unit_cost', 'human', 'wall', 'retries', 'rework', 'ttft']);
const higherIsBetter = new Set(['completion', 'speed']);
function metricComparison(m: PersonalFeedback['metrics'][number]) {
  if (!m.reference || m.position === 'unavailable' || m.position === 'typical')
    return { tone: 'neutral', explanation: '' };
  if (!lowerIsBetter.has(m.id) && !higherIsBetter.has(m.id))
    return { tone: 'neutral', explanation: '数量比较，不代表优劣' };
  const favorable = lowerIsBetter.has(m.id) ? m.position === 'lower' : m.position === 'higher';
  const explanation =
    m.id === 'completion'
      ? favorable
        ? '验收比例较高'
        : '验收比例较低'
      : m.id === 'speed'
        ? favorable
          ? '输出较快'
          : '输出较慢'
        : favorable
          ? '同类工作投入较少'
          : '同类工作投入较多';
  return { tone: favorable ? 'favorable' : 'unfavorable', explanation };
}
const metricLabels: Record<string, string> = {
  items: '工作条目',
  turns: '沟通轮次',
  cost: '实际费用',
  paid: '实际支出',
  accepted: '已验收任务',
  unit_cost: '每项验收成本',
  completion: '当前验收比例',
};
function Metrics({
  items,
  compact = false,
}: {
  items: PersonalFeedback['metrics'];
  compact?: boolean;
}) {
  return (
    <div className={`pf-metrics${compact ? ' pf-key-metrics' : ''}`}>
      {items.map((m, i) => {
        const comparison = metricComparison(m);
        return (
          <div className="pf-metric" key={`${m.id}-${i}`}>
            <span>{compact ? (metricLabels[m.id] ?? m.label) : m.label}</span>
            <strong>{value(m.value, m.unit)}</strong>
            {m.measurement && (
              <small>
                测量覆盖：{m.measurement.tasks ?? '未记录'} / {m.measurement.totalTasks} 项目标
              </small>
            )}
            {m.reference ? (
              <>
                <span className={'pf-position ' + comparison.tone}>
                  {feedbackReferenceCountsText(m.reference)}
                </span>
                {m.reference.counts && (
                  <div className="pf-comparison-bar" aria-hidden="true">
                    {(['below', 'equal', 'above'] as const).map((key) => (
                      <span key={key} className={key} style={{ flex: m.reference!.counts![key] }} />
                    ))}
                  </div>
                )}
                <details className="pf-reference-details">
                  <summary>比较样本与计算方法</summary>
                  <small>
                    {m.reference.options} 个已公开配置 · {m.reference.month}；中位{' '}
                    {value(m.reference.median, m.unit)}。这里比较方案数值，不是用户排名。
                  </small>
                  {m.reference.p25 !== null && m.reference.p75 !== null && (
                    <small>
                      中间 50% 配置值范围：{value(m.reference.p25, m.unit)} –{' '}
                      {value(m.reference.p75, m.unit)}。
                    </small>
                  )}
                  <small>{feedbackReferenceExclusionsText(m.reference)}</small>
                  <details>
                    <summary>描述性位置与百分位</summary>
                    <small>
                      {position[m.position]} · 数值第 {m.reference.percentile}{' '}
                      百分位，按本组配置中秩计算。 仅描述这 {m.reference.options}{' '}
                      个配置，不能确认总体位置、统计显著差异或未来表现。
                    </small>
                    {comparison.explanation && <small>{comparison.explanation}</small>}
                  </details>
                </details>
              </>
            ) : null}
            {m.note &&
              (compact ? (
                <details className="pf-metric-note">
                  <summary>说明</summary>
                  <small>{m.note}</small>
                </details>
              ) : (
                <small>{m.note}</small>
              ))}
          </div>
        );
      })}
    </div>
  );
}
const quotaUnits: Record<string, string> = {
  token: 'Token',
  message: '条消息',
  request: '次请求',
  image: '张',
  second: '秒',
  byte: '字节',
  gib_hour: 'GiB·小时',
  credit: '积分',
  count: '次',
  unknown: '单位未记录',
};
function Quotas({
  items,
  related = false,
}: {
  items: PersonalFeedback['quota'];
  related?: boolean;
}) {
  return (
    <section className="pf-section pf-quota" aria-label="套餐额度水平">
      <div className="pf-section-heading">
        <h3>额度用量</h3>
        <span>{related ? '关联记录中的最近一次上传' : '每个额度池展示本批最近一次读数'}</span>
      </div>
      <div className="pf-quota-grid">
        {items.map((q, i) => {
          const current = q.current;
          const peers = q.peers?.statistics;
          const unit =
            q.unit === 'currency_minor' && current?.currency
              ? `${current.currency}_minor`
              : (quotaUnits[q.unit] ?? q.unit);
          return (
            <div className="pf-quota-card" key={i}>
              <h4>{q.label}</h4>
              {peers ? (
                <div className="pf-peer-verdict">
                  <span>与同套餐平均额度相比</span>
                  <strong>
                    {peers.difference === 0
                      ? '与平均值相同'
                      : `${peers.difference > 0 ? '多' : '少'} ${value(Math.abs(peers.difference), unit)}`}
                  </strong>
                  <b>
                    {peers.differencePercent === null
                      ? '平均值为零，不计算百分比'
                      : `${peers.differencePercent > 0 ? '+' : ''}${peers.differencePercent.toFixed(1)}%`}
                  </b>
                  <div
                    className="pf-peer-range"
                    role="img"
                    aria-label={`本次额度在参照样本中处于第 ${peers.percentile.toFixed(1)} 百分位`}
                  >
                    <span style={{ left: `${peers.percentile}%` }} />
                  </div>
                  <div className="pf-peer-scale">
                    <span>较少</span>
                    <span>样本位置 {peers.percentile.toFixed(0)}%</span>
                    <span>较多</span>
                  </div>
                  <dl className="pf-peer-figures">
                    <div>
                      <dt>同套餐平均</dt>
                      <dd>{value(peers.mean, unit)}</dd>
                    </div>
                    <div>
                      <dt>中位数</dt>
                      <dd>{value(peers.median, unit)}</dd>
                    </div>
                  </dl>
                  <small>{peers.sources} 个授权统计来源 · 最近 30 天 · 已排除本人</small>
                </div>
              ) : null}
              <div className="pf-quota-total">
                <strong>
                  {current?.capacityStatus === 'unlimited'
                    ? '不限量'
                    : current?.total == null && current?.usedPercent != null
                      ? `已用 ${current.usedPercent.toLocaleString(getLocale(), { maximumFractionDigits: 1 })}%`
                      : value(current?.total ?? null, unit)}
                </strong>
                <span>{current?.window ?? '周期未记录'}</span>
              </div>
              {current && (
                <>
                  {(current.remaining !== null || current.used !== null) && (
                    <div className="pf-quota-balance">
                      <span>
                        剩余 <b>{value(current.remaining, unit)}</b>
                      </span>
                      <span>
                        已用 <b>{value(current.used, unit)}</b>
                      </span>
                    </div>
                  )}
                  {current.usedPercent !== null && (
                    <>
                      <div
                        className="pf-quota-meter"
                        aria-label={`已用约 ${current.usedPercent.toFixed(1)}%`}
                      >
                        <span style={{ width: `${current.usedPercent}%` }} />
                      </div>
                      <small>
                        已用 {current.usedPercent.toFixed(1)}% · 剩余{' '}
                        {(100 - current.usedPercent).toFixed(1)}%
                      </small>
                    </>
                  )}
                  {current.capacityStatus === 'undisclosed' && (
                    <small>服务商未披露总额度，按实际百分比展示。</small>
                  )}
                  {current.resetsAt && (
                    <small>重置时间 {new Date(current.resetsAt).toLocaleString(getLocale())}</small>
                  )}
                  <small>记录时间 {new Date(current.observedAt).toLocaleString(getLocale())}</small>
                  {(q.observations ?? 0) > 1 && (
                    <small>{q.observations} 次历史读数已合并展示。</small>
                  )}
                  {!current.consistent && <small>额度记录有冲突，请核对原始记录。</small>}
                  {current.freshness === 'stale' && <small>历史读数，不代表当前余额。</small>}
                </>
              )}
              {q.capacityChange !== null && (
                <div className="pf-quota-level">
                  <span>与此前同一套餐相比</span>
                  <strong>
                    {q.capacityChange === null
                      ? '缺少历史基线'
                      : q.capacityChange === 0
                        ? '总额度不变'
                        : `总额度${q.capacityChange > 0 ? '增加' : '减少'} ${value(Math.abs(q.capacityChange), unit)}${q.changePercent === null ? '' : `（${Math.abs(q.changePercent).toFixed(1)}%）`}`}
                  </strong>
                </div>
              )}
              {['message', 'request', 'credit'].includes(q.unit) && (
                <p className="pf-quota-peers">
                  这是套餐原生限制；Token 和 API 等值费用按实际用量单独统计。
                </p>
              )}
              <details>
                <summary>比较依据与记录详情</summary>
                {peers && (
                  <>
                    <p>
                      中间 50% 来源额度：{value(peers.p25, unit)} – {value(peers.p75, unit)}
                      。按各来源最新观察等权计算，不按上传次数加权。
                    </p>
                    <p>
                      匹配套餐版本、账期、席位、额度池、共享方式、模型、Harness
                      和额度周期。这是参与来源的上报数据，不是全体用户排名。
                    </p>
                  </>
                )}
                {!peers && <p>同套餐比较需要明确的套餐版本、额度规则，以及至少 5 个同条件来源。</p>}
                {q.capacityChange === null && <p>总额度变化：缺少可比较的历史容量。</p>}
                <p>参与匿名额度统计为可选项，默认关闭。仅上传时明确选择的记录会进入参照。</p>
                <p>区间消费 {value(q.consumption, unit)}</p>
                {current && (
                  <p>观察时间 {new Date(current.observedAt).toLocaleString(getLocale())}</p>
                )}
                <small>{q.note}</small>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function FeedbackPanel({
  report,
  relatedQuota,
}: {
  report: PersonalFeedback;
  relatedQuota?: PersonalFeedback['quota'];
}) {
  // Refresh presentation copy from report facts without changing saved historical reports.
  const nextSteps = feedbackNextSteps(report);
  const insufficient =
    report.kind === 'journal' ||
    !!report.referenceUnavailable ||
    (report.kind === 'contribution' &&
      (!report.recommendations.length ||
        (!!report.comparisonCoverage &&
          report.comparisonCoverage.comparedTasks < report.comparisonCoverage.totalTasks))) ||
    (report.kind === 'subscription' && report.quota.some((q) => q.consumption === null));
  const progress = (
    report.analytics?.groups.find((group) => group.id === 'progress')?.metrics ?? report.metrics
  ).filter((metric) => metric.id.startsWith('phase_') && (metric.value ?? 0) > 0);
  const priority =
    report.kind === 'journal'
      ? ['items', 'turns', 'cost']
      : ['accepted', 'paid', 'unit_cost', 'completion'];
  const primaryMetrics = priority.flatMap((id) => report.metrics.filter((m) => m.id === id));
  const primaryIds = new Set([...priority, ...progress.map((m) => m.id)]);
  const moreMetrics = report.metrics.filter((m) => !primaryIds.has(m.id));
  const recommendationStatus = report.referenceUnavailable
    ? '比较数据准备中，稍后刷新。'
    : report.kind === 'journal'
      ? '补充实付费用和验收结果后，可匹配同类方案。'
      : report.kind === 'subscription'
        ? '补充工作与费用记录后，可匹配同类方案。'
        : report.lifecycle?.status === 'conflict'
          ? '先核对重复账目，再比较方案。'
          : report.lifecycle && ['pending', 'unknown'].includes(report.lifecycle.status)
            ? '历史账目还在整理，稍后刷新。'
            : report.comparisonCoverage?.reasons.some(
                  (r) =>
                    ['record_incomplete', 'workload_unknown', 'missing_measurements'].includes(
                      r.reason,
                    ) && r.tasks > 0,
                )
              ? '补齐任务规模、费用和验收记录后，可匹配同类方案。'
              : '同类样本还不够，稍后再看后续反馈。';
  return (
    <section className="personal-feedback" aria-label="上传后的个人反馈">
      <div className="pf-heading">
        <div>
          <span className="pf-eyebrow">私人反馈{report.provisional ? ' · 临时反馈' : ''}</span>
          <h2>
            {report.kind === 'journal'
              ? '这份日记的工作'
              : report.kind === 'subscription'
                ? '套餐额度一览'
                : '本次工作与成本'}
          </h2>
        </div>
        <span className="pf-stage">
          {report.sample.journalCoverage && report.sample.journalCoverage.currentWindow !== 'valid'
            ? '日记日期待核对'
            : report.sample.historyCoverage === 'partial'
              ? '历史范围不完整'
              : report.sample.historyCoverage === 'unknown'
                ? '历史范围待确认'
                : stages[report.sample.stage]}
        </span>
      </div>
      <p className="pf-overview">
        以下为本次上传 ·{' '}
        {report.sample.coveredDays === null
          ? '覆盖天数待确认'
          : `累计观察 ${report.sample.coveredDays} 天`}
      </p>
      <Metrics items={primaryMetrics} compact />
      <ModelTimelineView timeline={report.modelTimeline} />
      {(report.quota.length > 0 || !!relatedQuota?.length) && (
        <Quotas
          items={report.quota.length ? report.quota : relatedQuota!}
          related={!report.quota.length}
        />
      )}
      <FeedbackPersona report={report} />
      {progress.length > 0 && (
        <div className="pf-progress" aria-label="任务进度与结束情况">
          <span className="pf-progress-title">任务进度</span>
          {progress.map((m) => (
            <span
              className={`pf-progress-item ${m.id === 'phase_ended' ? 'ended' : ''}`}
              key={m.id}
            >
              {m.label.replace('的工作条目', '')} <b>{m.value}</b>{' '}
              {report.kind === 'journal' ? '条' : '项'}
            </span>
          ))}
          <details>
            <summary>状态说明</summary>
            <small>尚未结束不等于失败；已结束包含完成、失败或主动停止，验收结果单独记录。</small>
          </details>
        </div>
      )}
      {report.work.length > 0 && (
        <section className="pf-section pf-results" aria-label="完成量与验收量">
          <div className="pf-section-heading">
            <h3>做了什么</h3>
            <span>不同单位分别统计</span>
          </div>
          <div className="pf-work-grid">
            {report.work.map((w, i) => (
              <div className="pf-work-card" key={i}>
                <span>{w.label}</span>
                <strong>
                  {value(w.completed, workUnits[w.unit as keyof typeof workUnits] ?? w.unit)}
                </strong>
                <small>
                  {w.completed === null ? '完成量未记录' : '已完成'} ·{' '}
                  {w.accepted === null
                    ? '验收未记录'
                    : `已验收 ${value(w.accepted, workUnits[w.unit as keyof typeof workUnits] ?? w.unit)}`}
                </small>
                <details>
                  <summary>统计说明</summary>
                  <small>{w.note}</small>
                </details>
              </div>
            ))}
          </div>
        </section>
      )}
      {report.groups.length > 0 && (
        <section className="pf-section pf-comparisons" aria-label="同类任务成本比较">
          <div className="pf-section-heading">
            <h3>成本处于什么水平</h3>
            <span>与相同任务条件的方案比较</span>
          </div>
          {report.groups.map((g, i) => {
            const keyMetrics = g.metrics.filter((m) =>
              ['cost', 'unit_cost', 'completion', 'human', 'wall'].includes(m.id),
            );
            const featured = (keyMetrics.length ? keyMetrics : g.metrics).slice(0, 4);
            const rest = g.metrics.filter((m) => !featured.includes(m));
            return (
              <div className="pf-comparison-group" key={i}>
                <h4>
                  {g.label} <span>· {g.tasks} 项任务</span>
                </h4>
                <Metrics items={featured} />
                {rest.length > 0 && (
                  <details>
                    <summary>其他指标比较</summary>
                    <Metrics items={rest} />
                  </details>
                )}
              </div>
            );
          })}
        </section>
      )}
      <FeedbackTaskProfile report={report} />
      {(report.usageValue ||
        report.metrics.some(
          (m) =>
            ['input', 'output', 'input_tokens', 'output_tokens', 'tokens'].includes(m.id) &&
            m.value !== null,
        )) && (
        <section className="pf-section pf-usage-value" aria-label="Token 与等值费用">
          <div className="pf-section-heading">
            <h3>用了多少 Token，等值多少钱</h3>
            <span>工作用量 · 历史价格</span>
          </div>
          <Metrics
            compact
            items={report.metrics.filter((m) =>
              ['tokens', 'input', 'output', 'input_tokens', 'output_tokens'].includes(m.id),
            )}
          />
          {report.usageValue && (
            <div className="pf-equivalent">
              <span>已记录用量的 API 等值费用</span>
              <strong>
                {value(report.usageValue.equivalentMinor, `${report.usageValue.currency}_minor`)}
              </strong>
              <small>
                按记录的历史价格计算，实付费用单列。计价覆盖 {report.usageValue.pricedRecords}/
                {report.usageValue.usageRecords} 条用量。
              </small>
              <details>
                <summary>价格版本</summary>
                <p>{report.usageValue.priceVersions.join('、') || '未记录'}</p>
              </details>
            </div>
          )}
        </section>
      )}
      <div className="pf-section">
        <h3>适合这些工作的模型与套餐</h3>
        {report.recommendations.length ? (
          <div className="pf-recommendations">
            {report.recommendations.map((r, i) => (
              <div className="pf-recommendation" key={i}>
                <span className="pf-eyebrow">
                  {r.kind === 'plan' ? '完整账期套餐' : '按用量模型'} · {r.candidates}
                  {r.kind === 'plan' ? ' 个候选套餐配置' : ' 个候选模型'} · {r.month}
                </span>
                <h3>{r.plan ?? r.model}</h3>
                {r.kind === 'plan' && <p>模型：{r.model}</p>}
                <p>
                  {r.harness} · {r.work}
                </p>
                <strong>
                  {value(r.projectedMinor, r.currency + '_minor')}{' '}
                  <small>
                    / {r.targetTasks} 项目标{r.kind === 'plan' ? '，购买一个完整账期' : ''}
                  </small>
                </strong>
                <details className="pf-recommendation-evidence">
                  <summary>方案详情与比较依据</summary>
                  {isModelIdentity(r.modelIdentity) ? (
                    r.modelIdentity.members.map((member, memberIndex) => (
                      <small className="pf-model-identity" key={memberIndex}>
                        供应商 {member.provider} · 模型 {member.model} · 版本 {member.version}
                      </small>
                    ))
                  ) : (
                    <small className="pf-model-identity">旧口径 · 模型身份未记录</small>
                  )}
                  {r.harnessComposition && (
                    <details>
                      <summary>
                        全部参与 Harness（{r.harnessComposition.members.length} 个）
                      </summary>
                      {r.harnessComposition.members.map((member, index) => (
                        <p key={index}>
                          {member.id} · 版本 {member.version} · 型号 {member.variant ?? '未记录'} ·
                          环境 {member.surface}
                        </p>
                      ))}
                      <p>这是整套协作配置的记录，不能拆成单个 Harness 的效果或费用。</p>
                    </details>
                  )}
                  {r.capacityP25 !== null && (
                    <p>
                      历史周期验收量下四分位：{r.capacityP25.toLocaleString(getLocale())} 项
                      <small>这是历史工作完成量，不是套餐额度或承诺容量。</small>
                    </p>
                  )}
                  {r.evidence && (
                    <div className="pf-evidence">
                      <span>
                        {r.evidence.taskCount === null
                          ? '任务总数未单独记录'
                          : `${r.evidence.taskCount.toLocaleString(getLocale())} 项任务`}
                        {' · '}
                        {r.evidence.acceptedCount.toLocaleString(getLocale())} 项验收
                        {' · '}
                        {r.evidence.sources.toLocaleString(getLocale())} 个来源
                        {r.evidence.periods !== null &&
                          ` · ${r.evidence.periods.toLocaleString(getLocale())} 个完整周期`}
                      </span>
                      <span>
                        验收完成率{' '}
                        {(r.evidence.completion * 100).toLocaleString(getLocale(), {
                          maximumFractionDigits: 1,
                        })}
                        %{' · '}费用依据 {r.evidence.cost} / 验收依据 {r.evidence.work}
                        {' · '}覆盖{r.evidence.coverage === 'verified' ? '已核验' : '由来源声明'}
                      </span>
                      {r.evidence.projectedRangeMinor && (
                        <span>
                          {r.evidence.rangeBasis === 'source_cost_per_accepted'
                            ? '来源间观察范围'
                            : '历史账期支出范围'}{' '}
                          {value(r.evidence.projectedRangeMinor[0], r.currency + '_minor')}
                          {' – '}
                          {value(r.evidence.projectedRangeMinor[1], r.currency + '_minor')}
                          <small>范围描述已观察差异，不是置信区间，也不保证下次支出。</small>
                        </span>
                      )}
                    </div>
                  )}
                  {r.evidence?.sourceSupport && (
                    <small>
                      按任务权重折算来源数 {r.evidence.sourceSupport.effectiveSources.toFixed(1)}；
                      最大来源占比 {(r.evidence.sourceSupport.maxTaskShare * 100).toFixed(1)}%；
                      零验收来源 {r.evidence.sourceSupport.zeroAcceptedSources}{' '}
                      个。这些描述来源集中程度，不证明来源独立。
                      {r.evidence.sourceSupport.distributionCoverage !== 'suppressed' && (
                        <>
                          有验收来源的单位验收成本中间 50% 范围：
                          {value(
                            r.evidence.sourceSupport.costPerAcceptedP25,
                            r.currency + '_minor',
                          )}{' '}
                          –{' '}
                          {value(
                            r.evidence.sourceSupport.costPerAcceptedP75,
                            r.currency + '_minor',
                          )}
                          ；不是置信区间。
                        </>
                      )}
                    </small>
                  )}
                  {r.evidence?.candidateHarnesses !== undefined && (
                    <small>
                      从该模型的 {r.evidence.candidateHarnesses} 个可比 Harness
                      配置选择历史最低观察值；尚未估计这种选择的不确定性。
                    </small>
                  )}
                  <small>{r.note}</small>
                  {r.kind === 'model' && <FeedbackPublicStudy study={r.publicStudyEvidence} />}
                </details>
              </div>
            ))}
          </div>
        ) : (
          <p>{recommendationStatus}</p>
        )}
      </div>
      {insufficient && (
        <div className="pf-insufficient" role="status">
          <strong>数据不足，稍后再看</strong>
          <span>
            {report.referenceUnavailable
              ? '比较数据尚未准备好，稍后刷新即可。'
              : report.kind === 'journal'
                ? '成本比较还缺实付费用、验收结果和同类样本。'
                : '部分项目缺少同类样本或完整记录。'}
          </span>
        </div>
      )}
      {nextSteps.actions.length > 0 && (
        <details className="pf-next-steps" aria-label="接下来">
          <summary>接下来 · {nextSteps.actions.length} 个建议</summary>
          <ol>
            {nextSteps.actions.map((a) => (
              <li key={a.code}>
                <strong>{a.title}</strong>
                <p>{a.action}</p>
                <details>
                  <summary>为什么需要这一步</summary>
                  <small>{a.reason}</small>
                </details>
              </li>
            ))}
          </ol>
        </details>
      )}
      <details className="pf-section pf-context">
        <summary>采集范围与比较前提</summary>
        <p>{report.headline}</p>
        {report.referenceUnavailable && (
          <p>{referenceUnavailableNote[report.referenceUnavailable]}</p>
        )}
        <p className="pf-sample">{report.sample.note}</p>
        {report.kind === 'journal' && !report.sample.journalCoverage && (
          <p className="pf-sample">{legacyJournalCoverageNotice}</p>
        )}
        {report.sample.journalCoverage?.currentWindow === 'valid' && (
          <p className="pf-sample">
            按 {report.sample.journalCoverage.timeZone} 计算，近 30 个本地日期中有{' '}
            {report.sample.journalCoverage.coveredDays} 天的有效日记。
          </p>
        )}
        {report.sample.currentRecordWindow && (
          <p className="pf-sample">
            本次记录：
            {new Date(report.sample.currentRecordWindow.startAt).toLocaleString(getLocale())}
            {' 至 '}
            {new Date(report.sample.currentRecordWindow.endAt).toLocaleString(getLocale())}。
            以下投入与完成量属于本次记录，累计覆盖天数用于说明观察范围。
          </p>
        )}
        {report.lifecycle && <div className="pf-reminder">{report.lifecycle.note}</div>}
        {report.kind === 'contribution' && !report.lifecycle && (
          <div className="pf-reminder">
            此历史反馈尚未检查重复完整结算，原报告保留；不能据此认定历史没有重复。
          </div>
        )}
        <div className="pf-reminder">{report.notices[0]}</div>
      </details>
      {moreMetrics.length > 0 && (
        <details className="pf-section">
          <summary>更多用量、轮次与资源</summary>
          <Metrics items={moreMetrics} />
        </details>
      )}
      {report.comparisonCoverage && (
        <details className="pf-section">
          <summary>
            社区比较覆盖 · {report.comparisonCoverage.comparedTasks} /{' '}
            {report.comparisonCoverage.totalTasks} 项目标
          </summary>
          <p>{report.comparisonCoverage.note}</p>
          <div className="pf-work">
            {report.comparisonCoverage.reasons.map((item) => (
              <div key={item.reason}>
                <strong>{comparisonReasons[item.reason]}</strong>
                <span>{item.tasks} 项目标</span>
              </div>
            ))}
          </div>
          {report.comparisonCoverage.unreviewedTasks > 0 && (
            <p>
              另有 {report.comparisonCoverage.unreviewedTasks}{' '}
              项目标超出本次详细比较的组数范围，未将它们判为缺少参照。
            </p>
          )}
        </details>
      )}
      {report.journalAnalysis && (
        <details className="pf-section" aria-label="日记任务分析覆盖">
          <summary>本日任务分析</summary>
          <h3>本日任务分析</h3>
          <p>
            {report.journalAnalysis.analyzedItems} 条工作附有分析，其中{' '}
            {report.journalAnalysis.graphItems} 条按要求图计算结构；已记录{' '}
            {report.journalAnalysis.knownCriteria} 项要求描述，缺少{' '}
            {report.journalAnalysis.missingCriteria ?? '未知'} 项。
          </p>
          <p>这些是客户端提供的要求与程序测量，不代表独立验收；实验难度未校准，不参与正式排名。</p>
        </details>
      )}
      {report.analytics && (
        <details className="pf-section">
          <summary>深入分析 · 结果、成本、过程与观察覆盖</summary>
          <p>
            以下分析属于本次记录。数值描述已观察情况，不把相关性解释为原因，也不自动生成难度等级。
          </p>
          <div className="pf-work">
            {report.analytics.costByStatus.map((item) => (
              <div key={item.status}>
                <strong>
                  {item.label} · {item.tasks} 项目标
                </strong>
                <span>
                  已归属费用 {value(item.allocatedMinor, report.analytics!.currency + '_minor')}
                </span>
                <small>
                  费用覆盖 {item.known} / {item.expected} 项目标
                </small>
              </div>
            ))}
          </div>
          <p>
            未验收支出包含部分完成和仍在进行的工作，不能全部解释为浪费；未分摊费用在“费用与归属”中单列。
          </p>
          {report.analytics.chargeReconciliation && (
            <div className="pf-section" aria-label="累计费用与子项核对">
              <h3>累计费用与子项核对</h3>
              {chargeReconciliationLines(
                report.analytics.chargeReconciliation,
                report.analytics.currency,
              ).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
          {report.analytics.priceMetering && (
            <div className="pf-section" aria-label="历史价格分段复核">
              <h3>历史 API 等价费用复核</h3>
              <p>
                来源报告{' '}
                {value(
                  report.analytics.priceMetering.reportedMinor,
                  report.analytics.currency + '_minor',
                )}
                ； 分段重算{' '}
                {value(
                  report.analytics.priceMetering.recomputedMinor,
                  report.analytics.currency + '_minor',
                )}
                。
              </p>
              <p>
                已完成分段重算 {report.analytics.priceMetering.recomputed} /{' '}
                {report.analytics.priceMetering.usages} 条模型用量； 缺项{' '}
                {report.analytics.priceMetering.incomplete} 条，冲突{' '}
                {report.analytics.priceMetering.conflicts} 条， 越界{' '}
                {report.analytics.priceMetering.outOfRange} 条，旧记录{' '}
                {report.analytics.priceMetering.legacy} 条。
              </p>
              {report.analytics.priceMetering.reasons.length > 0 && (
                <p>{report.analytics.priceMetering.reasons.join('；')}。</p>
              )}
              <p>{report.analytics.priceMetering.note}</p>
            </div>
          )}
          {report.analytics.costAttribution && (
            <div className="pf-section" aria-label="逐项费用归属">
              <h3>独有费用与共享费用</h3>
              <p>
                直接归属{' '}
                {value(
                  report.analytics.costAttribution.directMinor,
                  report.analytics.currency + '_minor',
                )}
                ； 共享分摊{' '}
                {value(
                  report.analytics.costAttribution.sharedMinor,
                  report.analytics.currency + '_minor',
                )}
                ； 未归属{' '}
                {value(
                  report.analytics.costAttribution.unallocatedMinor,
                  report.analytics.currency + '_minor',
                )}
                。
              </p>
              <p>
                {report.analytics.costAttribution.coverage === 'complete' ? '完整' : '部分'}明细，
                {report.analytics.costAttribution.entries} 条，覆盖{' '}
                {report.analytics.costAttribution.coveredTasks} /{' '}
                {report.analytics.costAttribution.totalTasks} 项目标。
              </p>
              <p>{report.analytics.costAttribution.note}</p>
            </div>
          )}
          {report.analytics.groups.map((group) => (
            <details className="pf-section" key={group.id}>
              <summary>{group.label}</summary>
              <div className="pf-metrics">
                {group.metrics.map((metric) => (
                  <div className="pf-metric" key={metric.id}>
                    <span>{metric.label}</span>
                    <strong>
                      {metric.id === 'final_completion' && metric.value === null
                        ? '尚不能计算'
                        : value(metric.value, metric.unit)}
                    </strong>
                    <small>
                      已知观察 {metric.known} / {metric.expected}
                    </small>
                    {metric.numerator != null && metric.denominator != null && (
                      <small>
                        计算依据：{metric.numerator.toLocaleString(getLocale())} /{' '}
                        {metric.denominator.toLocaleString(getLocale())}
                      </small>
                    )}
                    <small>{metric.note}</small>
                  </div>
                ))}
              </div>
            </details>
          ))}
          {report.analytics.limitations.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </details>
      )}
      <details className="pf-section">
        <summary>
          比较依据与限制 · {new Date(report.generatedAt).toLocaleDateString(getLocale())}
        </summary>
        {report.notices.slice(1).map((n, i) => (
          <p key={i}>{n}</p>
        ))}
        {report.referenceSnapshot && (
          <p>
            公开参照更新时间：
            {new Date(report.referenceSnapshot.publishedAt).toLocaleString(getLocale())}； 版本{' '}
            {report.referenceSnapshot.version}。{referenceExclusionNote(report.referenceSnapshot)}
          </p>
        )}
        <p>
          {report.provisional
            ? '这是尚未保存的临时反馈。你可以稍后手动再次读取反馈，不需要重复上传。'
            : '这是生成时保存的历史反馈，价格与公开样本之后可能变化。所列方案是已观察数据中的参考，不自动改变你的环境或订阅。'}
        </p>
      </details>
    </section>
  );
}
