import { useEffect, useMemo, useState } from 'react';
import type { EconomicHistoryReport } from './economic-history-schema.js';
const amount = (n: number | null) =>
  n === null
    ? '未知'
    : (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pageSize = 16;
export function EconomicHistoryReportView({ report }: { report: EconomicHistoryReport }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [report]);
  const labels = useMemo(() => {
    const tasks = new Map<string, number>(),
      requirements = new Map<string, number>();
    for (const r of report.requirements) {
      if (!tasks.has(r.taskId)) tasks.set(r.taskId, tasks.size + 1);
      const key = `${r.taskId}:${r.requirementRef}`;
      if (!requirements.has(key)) requirements.set(key, requirements.size + 1);
    }
    return { tasks, requirements };
  }, [report]);
  const pages = Math.ceil(report.requirements.length / pageSize),
    safePage = Math.min(page, Math.max(0, pages - 1));
  const c = report.counts;
  return (
    <section className="economic-history-report" aria-label="本地经济事件分析结果">
      <h3>现金与要求费用分别看</h3>
      {report.dataUse === 'method_example' && <p role="status">方法示例，不是用户的实际账单。</p>}
      {report.status !== 'computed' ? (
        <p role="alert">
          未生成有效金额结果：{report.status}。请核对事件关系和字段；原文及关联号没有回显。
        </p>
      ) : (
        <>
          <p>
            现金窗口：{report.window!.from} 至 {report.window!.to}（不含结束时刻）；记录截止：
            {report.window!.recordedAtOrBefore}。仅按当时已记录的观察计算。
          </p>
          <p>
            {c.inputObservations}条输入观察，截止内{c.selectedObservations}条，去掉同值重复
            {c.duplicateObservations}条；对应{c.operations}项经济事件、{c.distinctTasks}项根目标、
            {c.distinctRequirements}份要求。根目标及要求数量不是完成量。
          </p>
          <p>
            待处理{c.pending}项，失败{c.failed}项，取消{c.cancelled}项，状态未知{c.unknown}
            项，来源未说明{c.sourceUnknown}项。待处理、失败和取消不当作现金到账。
          </p>
          <div className="economic-history-table">
            <table>
              <caption>窗口内已结算现金；币种分别计算</caption>
              <thead>
                <tr>
                  <th>币种</th>
                  <th>已知付款</th>
                  <th>已知退款</th>
                  <th>现金净支出</th>
                  <th>金额未知/状态未知</th>
                  <th>另列非现金赠额（已知部分）</th>
                </tr>
              </thead>
              <tbody>
                {report.cash.map((r) => (
                  <tr key={r.currency}>
                    <th>{r.currency}</th>
                    <td>{amount(r.knownPaidMinor)}</td>
                    <td>{amount(r.knownRefundedMinor)}</td>
                    <td>
                      {amount(r.netCashMinor)}
                      {r.netCashMinor === null && (
                        <small>已知部分 {amount(r.knownNetCashMinor)}</small>
                      )}
                    </td>
                    <td>
                      {r.unknownSettledAmounts} / {r.unknownStates}
                    </td>
                    <td>
                      {amount(r.knownCreditGrantedMinor)}
                      {r.unknownCreditAmounts > 0 && (
                        <small>另有{r.unknownCreditAmounts}项金额未知</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            负现金净支出表示这个窗口退款多于付款，不是负任务成本。赠额不算付款或现金退款；没有进行汇率换算。
          </p>
          {c.unlinkedRefunds > 0 && (
            <p role="status">
              有{c.unlinkedRefunds}
              项已结算退款缺少原收费记录；保留已知现金，不猜测原要求费用。本窗口其中未关联原收费的已知退款：
              {report.cash
                .map((r) => `${r.currency} ${amount(r.knownUnlinkedRefundMinor)}`)
                .join('；')}
              。
            </p>
          )}
          <h4>归回原要求的已分配费用</h4>
          <p>
            按明确的任务、要求引用和工作月份归属；同一根目标多个要求分别显示。退款未明确分配时计算可行金额范围，不按比例猜测。范围只覆盖明确分配的部分，不是概率区间，也不是完整任务费用范围。
          </p>
          {!report.mappingComplete && (
            <p role="status">
              提供事件或费用归属仍有缺项，未给出完整的已记录要求费用点值；
              {c.incompleteChargeMappings}项收费归属不完整，{c.unknownRefundAmounts}
              项已结算退款金额未知。
            </p>
          )}
          {report.requirements.length ? (
            <>
              <div className="economic-history-table">
                <table>
                  <caption>已分配部分的金额；不是工作量或成本排名</caption>
                  <thead>
                    <tr>
                      <th>本地根目标/要求</th>
                      <th>工作月份</th>
                      <th>币种</th>
                      <th>已知分配收费</th>
                      <th>明确分配退款</th>
                      <th>该部分净额可行范围</th>
                      <th>已完整确定的记录净额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.requirements
                      .slice(safePage * pageSize, (safePage + 1) * pageSize)
                      .map((r) => (
                        <tr key={`${r.currency}:${r.taskId}:${r.requirementRef}:${r.workMonth}`}>
                          <th title={`本地根目标 ${r.taskId}；要求 ${r.requirementRef}`}>
                            目标{labels.tasks.get(r.taskId)} / 要求
                            {labels.requirements.get(`${r.taskId}:${r.requirementRef}`)}
                          </th>
                          <td>{r.workMonth}</td>
                          <td>{r.currency}</td>
                          <td>{amount(r.knownAllocatedChargeMinor)}</td>
                          <td>{amount(r.explicitAllocatedRefundMinor)}</td>
                          <td>
                            {amount(r.allocatedNetRangeMinor.lower)}～
                            {amount(r.allocatedNetRangeMinor.upper)}
                          </td>
                          <td>{amount(r.recordedAllocatedNetMinor)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="economic-history-actions" aria-label="要求费用分页">
                  <button disabled={safePage === 0} onClick={() => setPage((n) => n - 1)}>
                    上一页
                  </button>
                  <span>
                    第{safePage + 1}/{pages}页，每页16项
                  </span>
                  <button disabled={safePage + 1 >= pages} onClick={() => setPage((n) => n + 1)}>
                    下一页
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>没有明确归属到要求的已结算收费；没有把缺项填为零成本。</p>
          )}
        </>
      )}
      <p>{report.note}</p>
    </section>
  );
}
