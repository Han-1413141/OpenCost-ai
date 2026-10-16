import { useRef, useState } from 'react';
import type { QuotaPlanComparison } from './quota-plan-comparison-schema.js';
import type { QuotaPlanComparisonResult } from './quota-plan-comparison.js';
import {
  quotaPlanObjectiveLabels,
  quotaPlanReason,
  parseQuotaPreference,
} from './quota-plan-comparison-text.js';

type Preferences = QuotaPlanComparison['preferences'];
export function QuotaPlanPreferences({
  preferences,
  currency,
  disabled,
  onChange,
  onValidityChange,
}: {
  preferences: Preferences;
  currency: string;
  disabled: boolean;
  onChange: (p: Preferences) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [errors, setErrors] = useState({ budget: false, wait: false });
  const budgetInput = useRef<HTMLInputElement | null>(null),
    waitInput = useRef<HTMLInputElement | null>(null);
  const applyConstraints = () => {
    const budget = parseQuotaPreference(budgetInput.current?.value ?? '', 'money'),
      wait = parseQuotaPreference(waitInput.current?.value ?? '', 'seconds');
    const next = { budget: budget === 'invalid', wait: wait === 'invalid' };
    setErrors(next);
    onValidityChange(!next.budget && !next.wait);
    if (budget !== 'invalid' && wait !== 'invalid')
      onChange({ ...preferences, budgetMinor: budget, maxWaitMs: wait });
  };
  const edit = (field: 'budget' | 'wait', value: string, commit: boolean) => {
    if (!commit) {
      onValidityChange(false);
      return;
    }
    const parsed = parseQuotaPreference(value, field === 'budget' ? 'money' : 'seconds');
    const next = { ...errors, [field]: parsed === 'invalid' };
    setErrors(next);
    onValidityChange(!next.budget && !next.wait);
    if (parsed !== 'invalid')
      onChange({ ...preferences, [field === 'budget' ? 'budgetMinor' : 'maxWaitMs']: parsed });
  };
  return (
    <div className="qr-preferences" aria-label="套餐比较偏好">
      <label>
        优先目标
        <select
          disabled={disabled}
          value={preferences.objective}
          onChange={(e) =>
            onChange({
              ...preferences,
              objective: e.currentTarget.value as Preferences['objective'],
            })
          }
        >
          {Object.entries(quotaPlanObjectiveLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        覆盖要求
        <select
          disabled={disabled}
          value={preferences.coverage}
          onChange={(e) =>
            onChange({ ...preferences, coverage: e.currentTarget.value as Preferences['coverage'] })
          }
        >
          <option value="all_requests">覆盖全部请求</option>
          <option value="required_requests">覆盖已标记的必需请求</option>
        </select>
      </label>
      <label>
        完整费用预算（{currency}，留空不限）
        <input
          type="text"
          ref={budgetInput}
          inputMode="decimal"
          maxLength={24}
          disabled={disabled}
          defaultValue={
            preferences.budgetMinor === null ? '' : (preferences.budgetMinor / 100).toFixed(2)
          }
          onChange={(e) => edit('budget', e.currentTarget.value, false)}
          onBlur={(e) => edit('budget', e.currentTarget.value, true)}
        />
      </label>
      <label>
        必需请求最长等待（秒，留空不限）
        <input
          type="text"
          ref={waitInput}
          inputMode="decimal"
          maxLength={24}
          disabled={disabled}
          defaultValue={preferences.maxWaitMs === null ? '' : String(preferences.maxWaitMs / 1000)}
          onChange={(e) => edit('wait', e.currentTarget.value, false)}
          onBlur={(e) => edit('wait', e.currentTarget.value, true)}
        />
      </label>
      <button type="button" disabled={disabled} onClick={applyConstraints}>
        应用预算与等待设置
      </button>
      {(errors.budget || errors.wait) && (
        <p role="alert" className="qr-attention">
          请输入非负数；费用最多两位小数，等待最多三位小数。超过支持范围时不能运行旧条件。
        </p>
      )}
    </div>
  );
}
const money = (value: number | null, currency: string) =>
  value === null ? '未知' : `${(value / 100).toFixed(2)} ${currency}`;
const wait = (value: number | null) =>
  value === null
    ? '未完整覆盖，无法比较'
    : `${(value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 秒`;
export function QuotaPlanComparisonView({ report }: { report: QuotaPlanComparisonResult }) {
  const input = report.snapshot,
    names = new Map(
      report.candidates.map((c, i) => [
        c.candidateRef,
        `候选 ${i + 1} · ${c.plan} (${c.policyVersion})`,
      ]),
    );
  return (
    <div className="qr-output" aria-label="候选套餐比较结果">
      <h3>
        {report.status === 'capacity'
          ? '比较超出容量，未选择方案'
          : report.status === 'invalid'
            ? '比较输入不符合协议'
            : '指定候选套餐的比较'}
      </h3>
      <p>{report.notice}</p>
      <p className="qr-note">
        回放方法：{report.replayMethodVersion}；比较方法：{report.comparisonMethodVersion}
        ，完整输入随报告保存。
      </p>
      {input && (
        <>
          <p>
            固定配置：{input.execution.provider} / {input.execution.model}{' '}
            {input.execution.modelVersion} · {input.execution.harness}{' '}
            {input.execution.harnessVersion}。目标：
            {quotaPlanObjectiveLabels[input.preferences.objective]}；
            {input.preferences.coverage === 'all_requests'
              ? '要求覆盖全部请求'
              : '要求覆盖已标记的必需请求'}
            。完整费用预算{' '}
            {input.preferences.budgetMinor === null
              ? '不限'
              : money(input.preferences.budgetMinor, input.currency)}
            ；最长等待{' '}
            {input.preferences.maxWaitMs === null ? '不限' : wait(input.preferences.maxWaitMs)}。
          </p>
          <div className="qr-input-summary">
            <strong>
              {report.selection.state === 'best_among_evaluated'
                ? `已评估且满足偏好候选中的较优方案：${report.selection.candidateRefs.map((ref) => names.get(ref)).join('、')}`
                : report.selection.state === 'none_meets_preferences'
                  ? '当前没有可确认满足全部偏好的方案'
                  : '本次未作方案选择'}
            </strong>
            <span>
              满足偏好的可比较候选 {report.selection.eligible} 个；额度尚未完整评估{' '}
              {report.selection.unassessed} 个。并列最优全部保留，未知费用不按零处理。
            </span>
          </div>
          <div className="qr-table">
            <table>
              <thead>
                <tr>
                  <th>候选 / 规则版本</th>
                  <th>覆盖请求</th>
                  <th>必需请求</th>
                  <th>完整购买费用</th>
                  <th>窗口现金</th>
                  <th>必需总等待</th>
                  <th>必需最长等待</th>
                  <th>费用与等待的取舍</th>
                </tr>
              </thead>
              <tbody>
                {report.candidates.map((c) => (
                  <tr key={c.candidateRef}>
                    <th>
                      {c.plan}
                      <small>{c.policyVersion}</small>
                    </th>
                    <td>
                      {c.metrics ? `${c.metrics.scheduled}/${c.metrics.requests}` : '未完整评估'}
                    </td>
                    <td>
                      {c.metrics
                        ? `${c.metrics.requiredScheduled}/${c.metrics.requiredCount}`
                        : '未知'}
                    </td>
                    <td>{money(c.metrics?.wholePeriodCostMinor ?? null, input.currency)}</td>
                    <td>{money(c.metrics?.windowCashMinor ?? null, input.currency)}</td>
                    <td>{wait(c.metrics?.requiredWaitTotalMs ?? null)}</td>
                    <td>{wait(c.metrics?.requiredWaitMaxMs ?? null)}</td>
                    <td>
                      {c.tradeoff === 'frontier'
                        ? '保留取舍'
                        : c.tradeoff === 'dominated'
                          ? `存在全面较优候选：${c.dominatedBy.map((ref) => names.get(ref)).join('、')}`
                          : '费用或回放不完整，未判断'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="qr-note">
            等待只比较同一组必需请求，未全部安排时不展示较小的部分等待。取舍判断要求另一方案费用不高、覆盖本方案全部已安排请求且逐请求不更慢，并至少一项更好；仅在完整费用与回放均已知的{' '}
            {report.frontier.assessed} 个候选中判断，另有 {report.frontier.unassessed} 个未判断。
          </p>
          <details>
            <summary>查看各候选的条件、缺口和价格记录</summary>
            {report.candidates.map((c) => (
              <div className="statistical-selection" key={c.candidateRef}>
                <strong>
                  {c.plan} · {c.policyVersion}
                </strong>
                <ul>
                  {[...c.reasons, ...c.replayIssues, ...c.preferenceReasons].map((code, i) => (
                    <li key={i}>{quotaPlanReason(code)}</li>
                  ))}
                </ul>
                <p>
                  价格记录时间：{c.priceRecord.capturedAt ?? '未记录'}；来源：
                  {
                    {
                      provider_export: '供应商导出声明',
                      provider_page: '供应商页面声明',
                      user_input: '用户输入情景',
                      unknown: '未知',
                    }[c.priceRecord.source]
                  }
                  。这些是所选输入的记录，不表示已在线核验当前报价。
                </p>
                <p className="qr-note">
                  {c.assumptions.includes('resource_conversion_assumed')
                    ? '需求换算含明确假设。'
                    : ''}
                  队列和规则来自本次输入，费用范围不足、资格或用量未知均按原因保留；详情和完整输入可随结果一起保存。
                </p>
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
