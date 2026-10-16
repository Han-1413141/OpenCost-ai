import {
  referenceUnavailableNote,
  feedbackReferenceCountsText,
  feedbackReferenceExclusionsText,
  legacyJournalCoverageNotice,
  referenceExclusionNote,
  type PersonalFeedback,
} from './personal-feedback';
import { isModelIdentity } from './model-identity';
import { workUnits } from './work-taxonomy';
import { taskInsightUnitLabels } from './task-insights';
import { chargeReconciliationLines } from './charge-reconciliation';
import './feedback.css';
import { feedbackNextSteps } from './feedback-next-steps';
import { FeedbackPublicStudy } from './FeedbackPublicStudy.js';
import { CodeObservationInsightsView } from './CodeObservationInsightsView.js';
const value = (n: number | null, unit: string) =>
  n === null
    ? '未记录'
    : unit.endsWith('_minor')
      ? `${(n / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${unit.replace('_minor', '')}`
      : unit === 'milliseconds'
        ? `${(n / (n >= 60000 ? 60000 : 1000)).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${n >= 60000 ? '分钟' : '秒'}`
        : `${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${taskInsightUnitLabels[unit] ?? unit}`;
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
function Metrics({ items }: { items: PersonalFeedback['metrics'] }) {
  return (
    <div className="pf-metrics">
      {items.map((m, i) => {
        const comparison = metricComparison(m);
        return (
          <div className="pf-metric" key={`${m.id}-${i}`}>
            <span>{m.label}</span>
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
              </>
            ) : null}
            {m.note && <small>{m.note}</small>}
          </div>
        );
      })}
    </div>
  );
}
export function FeedbackPanel({ report }: { report: PersonalFeedback }) {
  const nextSteps = report.nextSteps ?? feedbackNextSteps(report);
  const insufficient =
    report.kind === 'journal' ||
    !!report.referenceUnavailable ||
    !!report.provisional ||
    (report.kind === 'contribution' &&
      (!report.recommendations.length ||
        (!!report.comparisonCoverage &&
          report.comparisonCoverage.comparedTasks < report.comparisonCoverage.totalTasks))) ||
    (report.kind === 'subscription' && report.quota.some((q) => q.consumption === null));
  const progress = (
    report.analytics?.groups.find((group) => group.id === 'progress')?.metrics ?? report.metrics
  ).filter((metric) => metric.id.startsWith('phase_') && (metric.value ?? 0) > 0);
  const primaryMetrics =
    report.kind === 'journal'
      ? report.metrics.filter((metric) =>
          ['items', 'turns', 'processing_input', 'processing_output', 'cost'].includes(metric.id),
        )
      : report.metrics.slice(0, 8);
  const primaryIds = new Set(primaryMetrics.map((metric) => metric.id));
  const moreMetrics = report.metrics.filter((metric) => !primaryIds.has(metric.id));
  return (
    <section className="personal-feedback" aria-label="上传后的个人反馈">
      <div className="pf-heading">
        <div>
          <span className="pf-eyebrow">
            仅你可见 · 程序计算{report.provisional ? ' · 临时反馈' : ''}
          </span>
          <h2>{report.headline}</h2>
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
      {report.referenceUnavailable && (
        <p className="pf-reminder" role="status">
          {referenceUnavailableNote[report.referenceUnavailable]}
        </p>
      )}
      <p className="pf-overview">
        已记录覆盖天数：{' '}
        {report.sample.coveredDays === null ? '天数待确认' : `${report.sample.coveredDays} 天`}。
        {report.sample.coveredDays !== null && report.sample.coveredDays < 7
          ? '建议连续记录至少一周，最好一个月。'
          : '采集范围和比较依据可在下方展开查看。'}
      </p>
      <Metrics items={primaryMetrics} />
      <details className="pf-section pf-context">
        <summary>采集范围与比较前提</summary>
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
            本次记录：{new Date(report.sample.currentRecordWindow.startAt).toLocaleString('zh-CN')}
            {' 至 '}
            {new Date(report.sample.currentRecordWindow.endAt).toLocaleString('zh-CN')}。
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
      {nextSteps.actions.length > 0 && (
        <details className="pf-next-steps" aria-label="可以做的下一步">
          <summary>可以做的下一步 · {nextSteps.actions.length} 项</summary>
          <p>根据这份报告已记录的事实和缺项给出；保留原指标及生成时点。</p>
          <small>
            {report.nextSteps ? '随报告保存的行动规则' : '按当前规则解读历史报告，原报告未补写'} ·{' '}
            {nextSteps.version}
          </small>
          <ol>
            {nextSteps.actions.map((a) => (
              <li key={a.code}>
                <strong>{a.title}</strong>
                <p>{a.reason}</p>
                <p>{a.action}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
      {insufficient && (
        <div className="pf-insufficient" role="status">
          <strong>数据不足，稍后再看</strong>
          <p>
            {report.referenceUnavailable || report.provisional
              ? '部分分析或公开参照暂未准备好，可稍后手动再次读取。'
              : report.kind === 'journal'
                ? '本日工作与用量已保存。成本比较还需要完整费用、验收和同类样本；可在后续记录补齐。'
                : '部分比较条件、额度边界或同类样本不足，已知结果仍正常展示。积累更多依据后，可查看后续反馈。'}
            已保存的摘要不需要重复上传。
          </p>
        </div>
      )}
      {progress.length > 0 && (
        <div className="pf-reminder" aria-label="任务进度与结束情况">
          {progress
            .map(
              (metric) =>
                `${metric.label} ${metric.value} ${report.kind === 'journal' ? '条' : '项'}`,
            )
            .join('；')}
          。 尚未结束不等于失败，最终未通过也不自动代表模型做不到。
        </div>
      )}
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
      {report.analytics?.codeMeasurements && (
        <CodeObservationInsightsView report={report.analytics.codeMeasurements} />
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
                        计算依据：{metric.numerator.toLocaleString('zh-CN')} /{' '}
                        {metric.denominator.toLocaleString('zh-CN')}
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
      {report.work.length > 0 && (
        <details className="pf-section">
          <summary>完成量与验收量（单位分别记录）</summary>
          <div className="pf-work">
            {report.work.map((w, i) => (
              <div key={i}>
                <strong>{w.label}</strong>
                <span>
                  完成 {value(w.completed, workUnits[w.unit as keyof typeof workUnits] ?? w.unit)} ·
                  验收 {value(w.accepted, workUnits[w.unit as keyof typeof workUnits] ?? w.unit)}
                </span>
                <small>{w.note}</small>
              </div>
            ))}
          </div>
        </details>
      )}
      {report.groups.map((g, i) => (
        <details className="pf-section" key={i} open={i === 0}>
          <summary>
            {g.label} · {g.tasks} 项目标的社区参照
          </summary>
          <Metrics items={g.metrics} />
        </details>
      ))}
      <div className="pf-section">
        <h3>这些工作可参考的模型与套餐</h3>
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
                {isModelIdentity(r.modelIdentity) ? (
                  r.modelIdentity.members.map((member, memberIndex) => (
                    <small className="pf-model-identity" key={memberIndex}>
                      供应商 {member.provider} · 模型 {member.model} · 版本 {member.version}
                    </small>
                  ))
                ) : (
                  <small className="pf-model-identity">旧口径 · 模型身份未记录</small>
                )}
                <p>
                  {r.harness} · {r.work}
                </p>
                {r.harnessComposition && (
                  <details>
                    <summary>全部参与 Harness（{r.harnessComposition.members.length} 个）</summary>
                    {r.harnessComposition.members.map((member, index) => (
                      <p key={index}>
                        {member.id} · 版本 {member.version} · 型号 {member.variant ?? '未记录'} ·
                        环境 {member.surface}
                      </p>
                    ))}
                    <p>这是整套协作配置的记录，不能拆成单个 Harness 的效果或费用。</p>
                  </details>
                )}
                <strong>
                  {value(r.projectedMinor, r.currency + '_minor')}{' '}
                  <small>
                    / {r.targetTasks} 项目标{r.kind === 'plan' ? '，购买一个完整账期' : ''}
                  </small>
                </strong>
                {r.capacityP25 !== null && (
                  <p>
                    历史周期验收量下四分位：{r.capacityP25.toLocaleString('zh-CN')} 项
                    <small>这是历史工作完成量，不是套餐额度或承诺容量。</small>
                  </p>
                )}
                {r.evidence && (
                  <div className="pf-evidence">
                    <span>
                      {r.evidence.taskCount === null
                        ? '任务总数未单独记录'
                        : `${r.evidence.taskCount.toLocaleString('zh-CN')} 项任务`}
                      {' · '}
                      {r.evidence.acceptedCount.toLocaleString('zh-CN')} 项验收
                      {' · '}
                      {r.evidence.sources.toLocaleString('zh-CN')} 个来源
                      {r.evidence.periods !== null &&
                        ` · ${r.evidence.periods.toLocaleString('zh-CN')} 个完整周期`}
                    </span>
                    <span>
                      验收完成率{' '}
                      {(r.evidence.completion * 100).toLocaleString('zh-CN', {
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
                        {value(r.evidence.sourceSupport.costPerAcceptedP75, r.currency + '_minor')}
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
              </div>
            ))}
          </div>
        ) : (
          <p>
            {report.referenceUnavailable
              ? '公开参照暂不可用，暂不提供模型或套餐推荐。'
              : '暂缺符合这些工作条件的可比数据，无法确定最优模型或套餐。'}
          </p>
        )}
      </div>
      {report.quota.length > 0 && (
        <div className="pf-section">
          <h3>额度变化与消费</h3>
          <div className="pf-work">
            {report.quota.map((q, i) => (
              <div key={i}>
                <strong>{q.label}</strong>
                <span>
                  总额度变化：
                  {q.capacityChange === null
                    ? '未确定'
                    : `${q.capacityChange > 0 ? '+' : ''}${q.capacityChange} ${q.unit}`}
                  {q.changePercent === null
                    ? ''
                    : `（${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(1)}%）`}{' '}
                  · 区间消费 {value(q.consumption, q.unit)}
                </span>
                <small>{q.note}</small>
              </div>
            ))}
          </div>
        </div>
      )}
      <details className="pf-section">
        <summary>
          比较依据与限制 · {new Date(report.generatedAt).toLocaleDateString('zh-CN')}
        </summary>
        {report.notices.slice(1).map((n, i) => (
          <p key={i}>{n}</p>
        ))}
        {report.referenceSnapshot && (
          <p>
            公开参照更新时间：
            {new Date(report.referenceSnapshot.publishedAt).toLocaleString('zh-CN')}； 版本{' '}
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
