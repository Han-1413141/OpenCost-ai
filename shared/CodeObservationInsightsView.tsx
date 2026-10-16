import { useEffect, useState } from 'react';
import type { CodeObservationInsights } from './code-observation-insights.js';

const n = (value: number | null) =>
  value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const stages = {
  before_execution: '执行前',
  during_execution: '执行中',
  after_execution: '执行后',
  proposed: '补丁提案',
  unknown: '阶段未知',
};
const coverage = { complete: '完整所选范围（声明）', partial: '部分范围', unknown: '范围未知' };
const languages = {
  javascript: 'JavaScript',
  jsx: 'JSX',
  typescript: 'TypeScript',
  tsx: 'TSX',
  python: 'Python',
  unknown: '语言未测得',
  patch: '补丁结构',
};
const pageSize = 8;
export function CodeObservationInsightsView({ report }: { report: CodeObservationInsights }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [report]);
  const c = report.counts,
    pages = Math.ceil(report.groups.length / pageSize),
    safePage = Math.min(page, Math.max(0, pages - 1));
  return (
    <section className="pf-section pf-code-observations" aria-label="本人的代码测量分析">
      <h3>代码与补丁：测得了哪些结构</h3>
      <p>
        本次{c.totalTasks}项根目标中，{c.attachedTasks}项附有代码数值，含{c.snapshots}份快照和
        {c.patches}份补丁。
        {c.totalTasks - c.attachedTasks}项未附加；{c.partialReports}份报告部分测得，
        {c.unavailableReports}份未测得。
      </p>
      <p>
        有执行前快照的目标{c.beforeTasks}项，有执行后快照的目标{c.afterTasks}项，有补丁提案的目标
        {c.proposedPatchTasks}项。
        同一目标可同时出现，不相加成完成量；这些阶段、绑定和范围是客户端声明。
      </p>
      <p>{report.note}</p>
      {report.status === 'group_limit' ? (
        <p role="status">
          本次形成{c.snapshots + c.patches}份报告、{report.groupCount}个不同条件组，
          超过64组显示和计算范围；保留整体覆盖，不挑选部分分布展示。原始数值保留在本人的上传记录中。
        </p>
      ) : (
        <>
          {report.groups.slice(safePage * pageSize, (safePage + 1) * pageSize).map((g, i) => (
            <section key={`${safePage}:${i}`}>
              <h4>
                {languages[g.language]} · {stages[g.stage]} · {coverage[g.coverage]}
              </h4>
              <p>
                {g.tasks}项任务摘要；测得{g.reports.measured}份、部分测得{g.reports.partial}
                份、未测得{g.reports.unavailable}份。 方法{g.algorithm}，报告中的解析器版本
                {g.parserVersion === 'unknown' ? '未测得' : g.parserVersion}
                {g.pythonVersion ? `，Python ${g.pythonVersion}` : ''}。
              </p>
              {g.generation && (
                <p>
                  差异格式
                  {
                    {
                      git_unified: 'Git统一差异',
                      unified: '普通统一差异',
                      empty: '空差异',
                      unknown: '未知',
                    }[g.generation.format]
                  }
                  ， 上下文{g.generation.contextLines ?? '未知'}行，算法
                  {g.generation.algorithm === 'unknown' ? '未知' : g.generation.algorithm}，
                  空白忽略
                  {
                    { none: '未忽略', some: '忽略部分空白', unknown: '未知' }[
                      g.generation.whitespaceIgnored
                    ]
                  }
                  ， 重命名检测
                  {
                    { enabled: '开启', disabled: '关闭', unknown: '未知' }[
                      g.generation.renameDetection
                    ]
                  }
                  。
                </p>
              )}
              <div className="table-scroll">
                <table className="matrix-table">
                  <caption>每项任务摘要数值的分布；不合并为全体函数分布</caption>
                  <thead>
                    <tr>
                      <th>指标与单位</th>
                      <th>已知 / 应观察</th>
                      <th>不适用</th>
                      <th>未知</th>
                      <th>中位数</th>
                      <th>P90</th>
                      <th>最小值</th>
                      <th>最大值</th>
                      <th>均值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.metrics.map((m) => {
                      const d = m.distribution;
                      return (
                        <tr key={m.key}>
                          <th>
                            {m.label}（{m.unit}）
                          </th>
                          <td>
                            {d.known} / {d.expected}
                          </td>
                          <td>{d.notApplicable}</td>
                          <td>{d.missing}</td>
                          <td>{n(d.median)}</td>
                          <td>{n(d.p90)}</td>
                          <td>{n(d.min)}</td>
                          <td>{n(d.max)}</td>
                          <td>{n(d.mean)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {pages > 1 && (
            <div className="pf-actions" aria-label="代码分析分组分页">
              <button disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span>
                第{safePage + 1} / {pages}页，每页8组
              </span>
              <button disabled={safePage + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
