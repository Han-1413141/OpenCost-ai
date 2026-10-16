import type { PersonalFeedback } from './personal-feedback.js';
import { requirementValueLabels } from './feedback-task-profile.js';
import { CodeObservationInsightsView } from './CodeObservationInsightsView.js';

export function FeedbackTaskProfile({ report }: { report: PersonalFeedback }) {
  const profile = report.taskProfile;
  const code = report.analytics?.codeMeasurements ?? report.journalAnalysis?.codeMeasurements;
  if (!profile && !code && !report.journalAnalysis) return null;
  const stageLabels = {
    before_execution: '执行前',
    during_execution: '执行中',
    after_execution: '执行后',
    proposed: '补丁提案',
    unknown: '时点未记录',
  };
  const snapshot = code?.groups.find((g) => g.kind === 'snapshot');
  const highlights = report.journalAnalysis?.requirementHighlights ?? [];
  const requirements =
    profile?.requirements.filter((r) =>
      ['knowledge', 'reasoning', 'solutionNovelty', 'methodFamilies', 'constraintKinds'].includes(
        r.field,
      ),
    ) ?? [];
  return (
    <section className="pf-section pf-task-profile" aria-label="任务难度与复杂度分析">
      <div className="pf-section-heading">
        <h3>这次工作难在哪里</h3>
        <span>任务结构 · 难度要求 · 代码复杂度</span>
      </div>
      <div className="pf-profile-grid">
        <article className="pf-profile-card">
          <span className="pf-eyebrow">任务结构复杂度</span>
          <h4>要协调多少部分</h4>
          {profile && profile.structureTasks > 0 ? (
            <>
              <dl className="pf-profile-numbers">
                <div>
                  <dt>已记录组成部分</dt>
                  <dd>{profile.components.value ?? '未记录'}</dd>
                </div>
                <div>
                  <dt>已观察最长依赖</dt>
                  <dd>
                    {profile.depth.value ?? '未记录'}
                    <small>步</small>
                  </dd>
                </div>
                <div>
                  <dt>需要整体整合</dt>
                  <dd>
                    {profile.integration.value ?? '未记录'}
                    <small>项</small>
                  </dd>
                </div>
              </dl>
              <small>
                结构覆盖 {profile.structureTasks}/{profile.totalTasks} 项 ·{' '}
                {profile.computedGraphTasks} 项由要求图计算
              </small>
              <details>
                <summary>计数范围</summary>
                <p>
                  组成部分有数值的任务 {profile.components.known} 项，依赖深度 {profile.depth.known}{' '}
                  项，整合要求 {profile.integration.known}{' '}
                  项。只汇总已知部分，不增加独立完成任务数。
                </p>
              </details>
            </>
          ) : (
            <p>没有附加任务结构记录</p>
          )}
        </article>
        <article className="pf-profile-card">
          <span className="pf-eyebrow">任务难度要求</span>
          <h4>需要哪些知识和方法</h4>
          {requirements.length ? (
            <div className="pf-requirement-tags">
              {requirements.slice(0, 6).map((r) => (
                <span key={`${r.field}:${r.value}`}>
                  {requirementValueLabels[r.value] ?? r.value}
                  <b>{r.tasks} 项</b>
                </span>
              ))}
            </div>
          ) : (
            <p>{highlights.length ? '已附加领域要求判断' : '没有附加难度要求记录'}</p>
          )}
          {profile && (
            <small>
              要求覆盖 {profile.requirementTasks}/{profile.totalTasks} 项 · 执行前或批准变更{' '}
              {profile.beforeExecutionTasks} 项
            </small>
          )}
          {requirements.length > 6 && (
            <details>
              <summary>全部知识、方法与约束</summary>
              {requirements.slice(6).map((r) => (
                <p key={`${r.field}:${r.value}`}>
                  {requirementValueLabels[r.value] ?? r.value} · {r.tasks} 项
                </p>
              ))}
            </details>
          )}
          {highlights.length > 0 && (
            <details>
              <summary>领域要求描述 · {report.journalAnalysis?.knownCriteria} 条已记录</summary>
              {highlights.map((h, i) => (
                <p key={i}>
                  <b>{h.label}</b> · {h.tasks} 项<br />
                  {h.description}
                </p>
              ))}
              <small>展示覆盖任务较多的前 12 种要求描述。</small>
            </details>
          )}
          <small>按记录展示知识、方法和约束，不生成总难度等级。</small>
        </article>
        <article className="pf-profile-card">
          <span className="pf-eyebrow">代码复杂度</span>
          <h4>代码本身有多复杂</h4>
          {code?.status === 'group_limit' ? (
            <p>已记录 {code.counts.snapshots} 份快照；分组超出展示上限，原始数据保留。</p>
          ) : snapshot ? (
            <>
              <small>
                {snapshot.language} · {stageLabels[snapshot.stage]} · {snapshot.tasks} 项任务快照
              </small>
              <dl className="pf-profile-numbers">
                {snapshot.metrics
                  .filter((m) => ['cc_median', 'cc_max', 'nesting_max'].includes(m.key))
                  .map((m) => (
                    <div key={m.key}>
                      <dt>
                        {m.key === 'cc_median'
                          ? '函数圈复杂度中位数'
                          : m.key === 'cc_max'
                            ? '函数圈复杂度最大值'
                            : '最大嵌套层数'}
                      </dt>
                      <dd>
                        {(m.key === 'cc_median' ? m.distribution.median : m.distribution.max) ??
                          '未测得'}
                      </dd>
                    </div>
                  ))}
              </dl>
              <small>中位数按任务快照汇总；最大值取本组已测快照。不同语言、工具和时点分开。</small>
            </>
          ) : (
            <p>
              {code?.counts.patches
                ? `已附加 ${code.counts.patches} 份补丁，未测代码快照`
                : '没有附加代码测量'}
            </p>
          )}
        </article>
      </div>
      {code && (
        <details className="pf-section">
          <summary>代码测量明细 · {code.groupCount} 组</summary>
          <CodeObservationInsightsView report={code} />
        </details>
      )}
    </section>
  );
}
