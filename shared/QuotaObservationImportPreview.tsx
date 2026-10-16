import type { QuotaObservationImportResult } from './quota-observation-import.js';

const labels: Record<string, string> = {
  invalid_structure: '文件结构不符合观测导入格式，请使用观测导入模板。',
  mapping_missing: '缺少请求、池规则和原始事件的对应说明；余额读数不能直接还原历史。',
  time_precision_or_range: '时间范围无效或精度高于毫秒，需要保留明确的时间与顺序。',
  subscription_mismatch: '观察不属于同一个选定订阅。',
  observation_id_conflict: '相同观察标识的内容不同，请保留并核对原记录。',
  window_horizon_mismatch: '观察起止时间与情景时长不一致。',
  request_coverage_gap: '请求历史未完整覆盖所选时段，或中间存在缺口。',
  external_consumption_scope_unknown: '未确认覆盖其他设备、Harness 或成员的全部共享消费。',
  request_requirements_incomplete: '没有完整记录每个请求涉及的全部额度池及需求。',
  pool_rules_unknown: '缺少可确认的额度池规则。',
  same_time_order_unknown: '缺少同一时刻操作的明确顺序。',
  eligibility_unknown: '未说明套餐资格依据。',
  eligibility_not_confirmed: '套餐资格未确认可用。',
  pool_scope_mismatch: '规则或映射遗漏了观察中的额度池，或多出了未观察的池。',
  subscription_rule_identity_changed: '订阅产品或套餐版本发生变化，需要明确分段规则。',
  source_event_conflict: '相同额度事件出现不同内容。',
  state_observation_missing: '缺少期初或期末状态对应的原始观察。',
  state_time_mismatch: '状态对应时间与边界不一致，或晚于实际观察时间。',
  state_time_basis_unknown: '没有说明额度状态实际对应哪个时点。',
  absolute_state_not_exact: '缺少准确的绝对余额和单位；百分比、估计数不能补成数量。',
  pool_counter_conflict: '精确额度、余额或百分比相互矛盾。保留原始观察，核对来源后再用于额度回放。',
  finite_capacity_unknown: '容量未知、动态、无限或不符合当前数值范围。',
  ledger_quantity_meaning_unknown: '未说明流水数量代表额度扣除、发放、重置、退回或到期。',
  pool_policy_unknown: '观察没有记录额度规则版本。',
  pool_policy_mismatch: '观察与情景采用的额度规则版本不同。',
  pool_currency_mismatch: '货币额度的币种不一致。',
  pool_unit_mismatch: '观察与情景的计量单位不一致。',
  pool_rule_not_supported: '该额度类型缺少可等价转换的明确规则。',
  rolling_window_mismatch: '滚动恢复时长与观察记录不同。',
  rolling_window_unknown: '缺少准确的滚动恢复时长。',
  pool_applicability_unknown: '额度批次适用于哪些模型或类别尚未明确。',
  overage_rule_unknown: '选择了付费补足，但缺少可用的明确超额规则；不能改成免费或只等待。',
  request_duration_unknown: '请求占用并发额度的时长未知。',
  initial_history_missing: '缺少期初额度批次、滚动占用、并发占用或补充规则。',
  opening_state_mismatch: '声明的期初批次或占用与观察余额不符。',
  capacity_changed_without_rule: '容量发生变化，当前规则没有完整表达该变化。',
  ledger_coverage_gap: '准确的完整额度流水未连续覆盖所选时段。',
  complete_ledgers_disagree: '重叠流水均声明完整，但其中一份遗漏了另一份记录的事件。',
  source_event_missing: '映射引用的原始额度事件不存在。',
  source_event_reused: '同一额度事件或同一次记账被重复使用。',
  source_event_kind_mismatch: '映射的事件类型与原记录不同。',
  source_event_units_unknown: '原事件数量未知、不是整数或超出支持范围。',
  request_mapping_scope_mismatch: '请求映射有缺项、重复或范围不同。',
  request_arrival_mismatch: '请求到达时间与情景不同，不能用扣除时间或观察时间替代。',
  request_arrival_basis_unknown: '没有请求到达时间的依据。',
  consumption_outcome_unknown: '未确认请求是否实际消耗额度。',
  request_units_unknown: '请求需要的额度数量未知。',
  unconsumed_request_has_charge: '标为未消耗的请求仍关联了扣除。',
  charge_time_or_order_missing: '缺少实际扣除时间或顺序，或扣除早于请求到达。',
  request_pool_charge_repeated: '同一请求对一个额度池关联了多笔扣除。',
  request_pool_charge_missing: '同一请求尚未关联全部额度池的扣除。',
  charge_time_or_units_mismatch: '实际扣除时间或数量与请求映射不符。',
  usage_counter_mismatch: '扣除数量与同一事件的前后已用计数不符。',
  charge_outside_request_scope: '扣除涉及了请求需求中没有登记的池。',
  boundary_mapping_scope_mismatch: '重置、赠额或退回的映射有缺项或重复。',
  boundary_event_missing: '找不到对应的重置、赠额或退回事件。',
  unmapped_source_event: '原始流水仍有未对应的事件，不能丢掉后继续计算。',
  observed_charge_order_conflict: '实际扣除与边界操作的同刻顺序冲突。',
  unrecorded_accounting_event: '声明的规则产生了流水没有记录的消耗、到期或恢复。',
  accounting_event_repeated: '同一次账目操作被重复核对。',
  accounting_event_mismatch: '规则重现的事件时间或数量与原始流水不同。',
  accounting_could_not_complete: '按声明规则无法完整核对实际账目。',
  observed_charge_not_affordable: '在记录的扣除时点，声明的池规则无法提供对应额度。',
  source_event_not_reproduced: '原始事件没有被声明规则重现。',
  closing_state_mismatch: '全部事件处理后的余额与期末观察不同。',
};
const assumptions: Record<string, string> = {
  pool_rules: '额度池规则含情景假设',
  same_time_order: '同刻顺序含情景假设',
  eligibility: '资格含情景假设',
  no_external_consumption: '假设没有其他共享消费',
  cost_is_explicit_scenario: '费用由用户明确设定，未作为实际付款核验',
  state_time: '状态时间含情景假设',
  request_arrival: '请求到达时间含情景假设',
};
export function QuotaObservationImportPreview({
  report,
}: {
  report: QuotaObservationImportResult;
}) {
  const statuses = {
    disabled: '默认关闭',
    ready: '记录与映射核对通过，可运行调度情景',
    incomplete: '资料不完整，暂不能转换',
    conflict: '记录与映射存在冲突',
    capacity: '超出处理容量，未返回部分情景',
  };
  return (
    <div className="qr-input-summary" aria-label="额度观测导入核对">
      <strong>{statuses[report.status]}</strong>
      {report.window && (
        <span>
          所选范围：{report.window.startAt} 至 {report.window.endAt}（UTC）
        </span>
      )}
      {report.counts && (
        <span>
          {report.counts.observations} 份观察 · {report.counts.pools} 个池 ·{' '}
          {report.counts.requests} 个请求 · {report.counts.sourceEvents} 个原始事件
        </span>
      )}
      {report.assumptions.length > 0 && (
        <ul>
          {report.assumptions.map((a) => (
            <li key={a}>{assumptions[a] ?? '存在需要保留的情景假设'}</li>
          ))}
        </ul>
      )}
      {report.diagnostics.length > 0 && (
        <ul>
          {report.diagnostics.slice(0, 30).map((d, i) => (
            <li key={i}>
              {d.severity === 'conflict' ? '冲突：' : '待补充：'}
              {labels[d.code] ?? '缺少可核对的信息，请查看本地核对报告。'}
            </li>
          ))}
        </ul>
      )}
      {report.diagnostics.length > 30 && (
        <span>其余 {report.diagnostics.length - 30} 项请查看保存的核对报告。</span>
      )}
      <p className="qr-note">
        核对会按实际扣除时点处理一遍额度账目；完整调度情景需要另行点击运行。结果只表示本地数据和声明一致，不认证来源真实或任务完成。费用没有依据时保留未知。
      </p>
    </div>
  );
}
