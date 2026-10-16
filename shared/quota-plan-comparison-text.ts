import { quotaReplayIssueLabels } from './quota-replay-labels.js';
import { quotaReplayLimits } from './quota-replay-schema.js';
export const quotaPlanObjectiveLabels = {
  whole_period_cost: '完整购买费用更低',
  required_wait_total: '必需请求总等待更少',
  required_wait_max: '必需请求最长等待更短',
} as const;
const reasons: Record<string, string> = {
  pool_binding_scope_mismatch: '额度池与共同计量项的对应缺失或重复',
  meter_unit_unknown: '计量单位未知',
  foreign_currency_meter_unsupported: '货币需求与比较币种不同，未自动换汇',
  conversion_unknown: '计费换算规则未知',
  common_demand_not_mapped: '候选遗漏了共同需求中的计量项',
  candidate_currency_mismatch: '候选费用币种不同',
  converted_quantity_out_of_range: '换算后的需求超出支持范围',
  common_quantity_unknown: '共同需求数量未知',
  candidate_reference_capacity: '构造需求的引用数超过容量',
  constructed_scenario_invalid: '构造后的规则、引用或顺序不一致',
  replay_not_complete: '条件不足或事件冲突，未得到完整回放',
  comparison_work_capacity: '本次比较达到容量，未采用部分候选决定结果',
  no_required_requests: '没有需要据此选择方案的必需请求',
  required_requests_unmet: '没有覆盖本次指定的全部必需请求',
  purchase_cost_coverage_incomplete: '费用没有覆盖全部必需购买、税费和手续费',
  budget_cannot_be_checked: '完整费用未知，无法核对预算',
  over_budget: '完整费用超过预算',
  wait_limit_not_met: '未达到指定等待上限',
  purchase_cost_unknown: '完整购买费用未知',
};
export const quotaPlanReason = (code: string) =>
  reasons[code] ?? quotaReplayIssueLabels[code] ?? '存在未解释的条件，请查看保存的报告原因';
/** Decimal user input to exact minor units/milliseconds; no float multiplication. */
export function parseQuotaPreference(
  value: string,
  kind: 'money' | 'seconds',
): number | null | 'invalid' {
  const text = value.trim();
  if (text === '') return null;
  const digits = kind === 'money' ? 2 : 3;
  if (text.length > 24 || !new RegExp('^\\d+(?:\\.\\d{0,' + digits + '})?$').test(text))
    return 'invalid';
  const [whole, fraction = ''] = text.split('.');
  const scale = kind === 'money' ? 100n : 1000n;
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(digits, '0'));
  const maximum = kind === 'money' ? 10000000000n : BigInt(quotaReplayLimits.horizonMs);
  return result <= maximum ? Number(result) : 'invalid';
}
