import { useState } from 'react';
import type { ReactNode } from 'react';
import type { QuotaPortfolioResult } from './quota-portfolio.js';
import type { QuotaReplayResult } from './quota-replay.js';
import { quotaPlanObjectiveLabels, quotaPlanReason } from './quota-plan-comparison-text.js';

const reasons: Record<string, string> = {
  portfolio_structure_invalid: '订阅、费用、额度或分配引用不符合协议',
  portfolio_search_capacity: '允许的分配组合超过搜索预算；请明确部分分配后再比较',
  portfolio_reference_capacity: '构造的额度引用达到本次容量，未采用已处理前缀选择方案',
  portfolio_allocation_capacity: '分配记录达到本次容量，未采用已处理前缀选择方案',
  portfolio_replay_capacity: '回放步骤达到本次预算，未采用已处理前缀选择方案',
  portfolio_purchase_ineligible: '选中订阅不满足资格或不支持当前执行配置',
  portfolio_purchase_unknown: '选中订阅资格或执行配置是否匹配尚未确定',
  portfolio_overage_unknown: '额外按量计费规则不完整，不能只填一份单价后比较',
  portfolio_route_meter_missing: '该分配缺少订阅要求的计量项',
};
const reason = (code: string) => reasons[code] ?? quotaPlanReason(code);
const money = (value: number | null | undefined, currency: string) =>
  value == null
    ? '未知'
    : `${(value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const wait = (value: number | null | undefined) =>
  value == null ? '未知' : `${(value / 1000).toLocaleString('zh-CN')} 秒`;

export function QuotaPortfolioView({
  report,
  renderReplay,
}: {
  report: QuotaPortfolioResult;
  renderReplay?: (replay: QuotaReplayResult) => ReactNode;
}) {
  const [page, setPage] = useState(0),
    [replayIndex, setReplayIndex] = useState(0),
    [allocationPage, setAllocationPage] = useState(0);
  const input = report.snapshot;
  const names = new Map(input?.purchases.map((p) => [p.purchaseRef, p.plan]));
  const chosen = report.selectedReplays[replayIndex];
  const chosenRow = report.configurations.find(
    (row) => row.configurationRef === chosen?.configurationRef,
  );
  const groups = new Map(
    input?.routingGroups.map((group, index) => [group.groupRef, { ...group, number: index + 1 }]),
  );
  return (
    <div className="qr-output" aria-label="多订阅组合比较结果">
      <h3>
        {report.status === 'capacity'
          ? '组合搜索超出容量，未选择方案'
          : report.status === 'invalid'
            ? '组合输入不符合协议'
            : '购买组合与请求分配'}
      </h3>
      <p>{report.notice}</p>
      <p className="qr-note">
        计算方法：{report.methodVersion}；额度回放：{report.replayMethodVersion}
        。完整输入、价格记录和分配随报告保存。
      </p>
      {input && (
        <p>
          固定 {input.execution.model} / {input.execution.harness} 配置；目标：
          {quotaPlanObjectiveLabels[input.preferences.objective]}。共 {input.purchases.length}{' '}
          项可选订阅，已购买或必须保留 {input.search.requiredPurchaseRefs.length} 项，最多同时选{' '}
          {input.search.maxPurchases} 项。
        </p>
      )}
      <div className="qr-input-summary">
        <strong>
          {report.selection.state === 'best_among_evaluated'
            ? `已评估且满足偏好的较优分配：${report.selection.configurationRefs.length} 个精确并列`
            : report.selection.state === 'none_meets_preferences'
              ? '没有可确认满足全部偏好的购买与分配'
              : '本次未作方案选择'}
        </strong>
        <span>
          允许的购买集合 {report.search.admissiblePurchaseSets} 个；分配组合{' '}
          {report.search.assignmentConfigurations} 个；已处理{' '}
          {report.search.evaluatedConfigurations} 个，未处理{' '}
          {report.search.unprocessedConfigurations} 个。
        </span>
      </div>
      <p className="qr-note">
        搜索{report.search.complete ? '已覆盖本次完整允许集合' : '尚未完成'}；构造额度引用{' '}
        {report.search.constructedReferences}，回放步骤 {report.search.replaySteps}。
        {input && `预算为${input.search.maxEvaluations}个分配、${input.search.maxReplaySteps}步。`}
        资格、规则或必要费用条件不足的 {report.selection.unassessed}{' '}
        个分配不能据此认定更差；完整购买费用与窗口现金分开。
      </p>
      {report.issues.length > 0 && (
        <ul className="qr-attention" role="status">
          {report.issues.map((code) => (
            <li key={code}>{reason(code)}</li>
          ))}
        </ul>
      )}
      {input && report.configurations.length > 0 && (
        <>
          <div className="qr-table">
            <table>
              <thead>
                <tr>
                  <th>分配与订阅</th>
                  <th>安排请求</th>
                  <th>必需覆盖</th>
                  <th>完整购买费用</th>
                  <th>窗口现金</th>
                  <th>必需总等待</th>
                  <th>必需最长等待</th>
                  <th>条件</th>
                </tr>
              </thead>
              <tbody>
                {report.configurations.slice(page * 20, page * 20 + 20).map((row) => (
                  <tr key={row.configurationRef}>
                    <th>
                      {row.configurationRef}
                      <small>{row.purchaseRefs.map((ref) => names.get(ref)).join(' + ')}</small>
                      <small>
                        {row.paymentRefs.length} 个费用项目 / {row.poolRefs.length} 个共享池 /{' '}
                        {row.allocations.length} 个分配组
                      </small>
                    </th>
                    <td>
                      {row.metrics
                        ? `${row.metrics.scheduled}/${row.metrics.requests}`
                        : row.state === 'excluded'
                          ? '资格或配置不符，已排除'
                          : '未完整评估'}
                    </td>
                    <td>
                      {row.metrics
                        ? `${row.metrics.requiredScheduled}/${row.metrics.requiredCount}`
                        : '未知'}
                    </td>
                    <td>{money(row.metrics?.wholePeriodCostMinor, input.currency)}</td>
                    <td>{money(row.metrics?.windowCashMinor, input.currency)}</td>
                    <td>{wait(row.metrics?.requiredWaitTotalMs)}</td>
                    <td>{wait(row.metrics?.requiredWaitMaxMs)}</td>
                    <td>
                      {row.reasons.length ? row.reasons.map(reason).join('；') : '满足已检查的条件'}
                      {report.selection.configurationRefs.includes(row.configurationRef) && (
                        <small>本次较优并列分配</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.configurations.length > 20 && (
            <div className="qr-actions">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span>
                {page + 1} / {Math.ceil(report.configurations.length / 20)}
              </span>
              <button
                disabled={(page + 1) * 20 >= report.configurations.length}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
      {chosen && chosenRow && (
        <>
          <label>
            查看本次较优分配的额度明细{' '}
            <select
              value={replayIndex}
              onChange={(e) => {
                setReplayIndex(Number(e.currentTarget.value));
                setAllocationPage(0);
              }}
            >
              {report.selectedReplays.map((item, i) => (
                <option key={item.configurationRef} value={i}>
                  {item.configurationRef}
                </option>
              ))}
            </select>
          </label>
          <div className="qr-table">
            <table>
              <thead>
                <tr>
                  <th>分配组</th>
                  <th>请求数量</th>
                  <th>使用订阅</th>
                </tr>
              </thead>
              <tbody>
                {chosenRow.allocations
                  .slice(allocationPage * 50, allocationPage * 50 + 50)
                  .map((allocation) => (
                    <tr key={allocation.groupRef}>
                      <th>组 {groups.get(allocation.groupRef)?.number}</th>
                      <td>{groups.get(allocation.groupRef)?.requestRefs.length}</td>
                      <td>{names.get(allocation.purchaseRef)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {chosenRow.allocations.length > 50 && (
            <div className="qr-actions">
              <button
                disabled={allocationPage === 0}
                onClick={() => setAllocationPage((p) => p - 1)}
              >
                上一组
              </button>
              <span>
                {allocationPage + 1} / {Math.ceil(chosenRow.allocations.length / 50)}
              </span>
              <button
                disabled={(allocationPage + 1) * 50 >= chosenRow.allocations.length}
                onClick={() => setAllocationPage((p) => p + 1)}
              >
                下一组
              </button>
            </div>
          )}
          <p className="qr-note">
            选中方案的费用只合并以下唯一费用项目；来源与价格记录是所选输入的声明，未在线核验。
          </p>
          <ul>
            {input?.payments
              .filter((payment) => chosenRow.paymentRefs.includes(payment.paymentRef))
              .map((payment, index) => (
                <li key={payment.paymentRef}>
                  费用项目 {index + 1}：完整购买 {money(payment.wholePeriodMinor, input.currency)}
                  ，窗口付款 {money(payment.inWindowMinor, input.currency)}；记录时间{' '}
                  {payment.priceRecord.capturedAt ?? '未记录'}。
                </li>
              ))}
          </ul>
          {renderReplay && <div key={chosen.configurationRef}>{renderReplay(chosen.replay)}</div>}
        </>
      )}
    </div>
  );
}
