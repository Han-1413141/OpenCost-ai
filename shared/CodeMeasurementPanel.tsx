import { useEffect, useMemo, useRef, useState } from 'react';
import {
  codeComparisonReasonLabels,
  codeReportGroups,
  codeReportImportMessages,
  compareCodeMeasurementReports,
  readCodeMeasurementFile,
  type CodeReportDistribution,
  type ImportedCodeMeasurement,
  type CodeStructureComparison,
} from './code-measurement-import.js';
import './code-measurement.css';
import { PatchMeasurementReportView } from './PatchMeasurementReportView.js';

const n = (value: number | null) =>
  value === null ? '不适用或未知' : value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const delta = (value: number | null) =>
  value === null ? '不作差' : `${value > 0 ? '+' : ''}${n(Object.is(value, -0) ? 0 : value)}`;
const stages = {
  before_execution: '执行前',
  during_execution: '执行中',
  after_execution: '执行后',
  unknown: '阶段未知',
};
const coverage = { complete: '完整（用户声明）', partial: '部分范围', unknown: '范围未知' };
const statuses = {
  disabled: '生成时未开启测量',
  measured: '所选文件测量完成',
  partial: '部分文件未测得',
  unavailable: '没有可用数值',
};
const exclusions: Record<string, string> = {
  duplicate_file: '物理重复文件',
  unsupported_language: '不支持的语言',
  source_unavailable: '来源无法读取',
  source_changed: '读取时文件改变',
  input_too_large: '单文件过大',
  total_input_limit: '读取预算用尽',
  parser_unavailable: '解析器不可用',
  parse_error: '语法未通过',
  parser_error: '解析失败',
  ast_limit: '结构容量限制',
  invalid_input: '输入无效',
  unsupported_syntax: '尚未支持的语法',
};
const unavailableReasons: Record<string, string> = {
  runtime_not_selected: '尚未选择Python解释器',
  invalid_runtime: '解释器路径不符合要求',
  runtime_unavailable: '解释器不可用',
  invalid_manifest: '选择清单无效',
  no_measured_sources: '没有测得可用源码',
  transport_limit: '传输容量已达到',
  tool_unavailable: '本地测量工具不可用或一致性检查未通过',
  runtime_timeout: '解析超过运行时限',
  runtime_failed: '解析进程未完成',
  invalid_runtime_output: '解析输出未通过协议检查',
};
const decisionLabels: Record<string, string> = {
  if: 'if分支',
  for: 'for循环',
  for_in: 'for-in循环',
  for_of: 'for-of循环',
  while: 'while循环',
  do_while: 'do-while循环',
  catch: 'catch处理',
  case: 'case分支',
  conditional: '条件表达式',
  logical_and: '逻辑与',
  logical_or: '逻辑或',
  nullish: '空值合并',
  default_value: '默认参数或解构值',
  logical_assignment_and: '逻辑与赋值',
  logical_assignment_or: '逻辑或赋值',
  nullish_assignment: '空值合并赋值',
  optional_member: '可选成员访问',
  optional_call: '可选调用',
};
const distributions = (
  values: { label: string; distribution: CodeReportDistribution }[],
  functionOnly = true,
) => (
  <div className="code-measurement-scroll">
    <table>
      <caption>{functionOnly ? '函数分布' : '按执行单元分别记录的分布'}；P90为第90百分位数</caption>
      <thead>
        <tr>
          {['指标', '数量', '最小值', '中位数', 'P90', '最大值', '均值'].map((s) => (
            <th key={s}>{s}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {values.map(({ label, distribution: d }) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{n(d.count)}</td>
            {[d.min, d.median, d.p90, d.max, d.mean].map((v, i) => (
              <td key={i}>{d.count === 0 ? (functionOnly ? '无函数' : '无该类单元') : n(v)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
export function CodeMeasurementReportView({
  report,
  title,
}: {
  report: ImportedCodeMeasurement;
  title: string;
}) {
  if (report.version === 'patch-measurement-1')
    return <PatchMeasurementReportView report={report} title={title} />;
  const groups = codeReportGroups(report),
    active = report.status !== 'disabled';
  const scope = active ? report.scope : null;
  const excluded = active ? report.excluded : null;
  return (
    <article className="code-measurement-report" aria-label={title}>
      <h4>{title}</h4>
      <p>
        <strong>{statuses[report.status]}</strong>
      </p>
      {active && (
        <>
          <p>
            {stages[report.stage]} · 阶段依据：用户声明 · 原要求修订：
            {report.requirementRevision ? '已记录，仅在本地关联' : '未记录'}
            <br />
            测量时间：{report.measuredAt ?? '未测得'}。测量时间不能证明代码来自执行前。
          </p>
          {report.version === 'python-code-measurement-1' && report.status === 'unavailable' && (
            <p>原因：{unavailableReasons[report.reason] ?? '本次没有得到完整数值'}。</p>
          )}
          {scope && (
            <p>
              范围：{coverage[scope.coverage]}；选择{n(scope.selectedEntries)}条，测得
              {n(scope.measuredFiles)}个文件， 重复{n(scope.duplicateEntries)}条，未测得
              {n(scope.unavailableEntries)}条。逐文件稳定读取，不是全项目原子快照。
            </p>
          )}
          {excluded && Object.values(excluded).some((value) => value > 0) && (
            <ul>
              {Object.entries(excluded)
                .filter(([, value]) => value > 0)
                .map(([key, value]) => (
                  <li key={key}>
                    {exclusions[key] ?? '未测得'}：{n(value)}
                  </li>
                ))}
            </ul>
          )}
          <details>
            <summary>读取数量与观察边界</summary>
            <p>
              已知稳定读取{n(report.knownInputBytesRead)}字节，读取预算占用
              {n(report.inputReadBudgetUsed)}字节。
              失败读取也可能占用预算；这些数字不是源码工作量，也不是任务价值。
            </p>
          </details>
        </>
      )}
      {groups.map((g) => (
        <section key={g.language} aria-label={`${g.language}测量分布`}>
          <h4>
            {g.language} · {n(g.files)}个文件 · {n(g.functions)}个函数
          </h4>
          <p>
            方法：{g.method}；解析器{g.parserVersion}
            {g.runtimeVersion ? `；Python ${g.runtimeVersion}` : ''}。
          </p>
          {distributions([
            {
              label: g.language === 'Python' ? 'Radon具名函数圈复杂度' : '函数语法圈复杂度近似',
              distribution: g.cyclomatic,
            },
            { label: 'AST控制嵌套', distribution: g.nesting },
            { label: '声明参数数', distribution: g.parameters },
          ])}
          <div className="code-measurement-facts">
            {g.scalars.map((s) => (
              <div key={s.key}>
                <span>{s.label}</span>
                <strong>{n(s.value)}</strong>
              </div>
            ))}
          </div>
          {g.extraDistributions.length > 0 && (
            <details>
              <summary>函数、类隐式执行与模块的更多结构</summary>
              {distributions(g.extraDistributions, false)}
              <p>
                下列只列非零语法决策；未列出的受支持决策类型已测得为0。没有运行所选代码，未分析可达性。
              </p>
              {g.decisionScopes.map((s) => (
                <div key={s.label}>
                  <h4>{s.label}语法决策</h4>
                  {Object.values(s.counts).some((v) => v > 0) ? (
                    <ul>
                      {Object.entries(s.counts)
                        .filter(([, v]) => v > 0)
                        .map(([k, v]) => (
                          <li key={k}>
                            {decisionLabels[k] ?? k}：{n(v)}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p>已测得0个受支持语法决策。</p>
                  )}
                </div>
              ))}
            </details>
          )}
          {g.language === 'Python' ? (
            <p>
              具名函数包含方法与闭包，lambda单列。行数指标存在交叠，不把所有行统计相加；控制嵌套不是认知复杂度。
            </p>
          ) : (
            <p>
              模块、类隐式执行与函数分别统计；函数分布不包括模块与字段初始化。调用表达式节点不是运行时调用次数。
            </p>
          )}
        </section>
      ))}
    </article>
  );
}
export function CodeMeasurementComparisonView({
  comparison,
}: {
  comparison: CodeStructureComparison;
}) {
  if (comparison.status === 'disabled') return null;
  if (comparison.status === 'blocked')
    return (
      <div className="code-measurement-note" role="status">
        <p>暂不计算前后差值：</p>
        <ul>
          {comparison.reasons.map((r) => (
            <li key={r}>{codeComparisonReasonLabels[r]}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <section aria-label="前后代码结构变化">
      <h3>同一代码范围的前后变化</h3>
      <p>
        范围一致来自你的确认。按语言比较总体函数分布，不能定位同一函数的变化。正负仅表示后值减前值，不评价质量、工作价值或难度；不进入排名。
      </p>
      {comparison.groups.map((g) => (
        <div className="code-measurement-scroll" key={g.language}>
          <table>
            <caption>
              {g.language} · 描述性变化 · {comparison.method}
            </caption>
            <thead>
              <tr>
                <th>指标</th>
                <th>执行前</th>
                <th>执行后</th>
                <th>后减前</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  <td>{n(r.before)}</td>
                  <td>{n(r.after)}</td>
                  <td>{delta(r.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p>
        新建或删除函数会改变总体分布；中位数、P90或最大值下降不证明原函数变简单。测量值均不证明任务完成或测试通过。
      </p>
    </section>
  );
}
export function CodeMeasurementPanel({ onClose }: { onClose: () => void }) {
  const [reports, setReports] = useState<
    [ImportedCodeMeasurement | null, ImportedCodeMeasurement | null]
  >([null, null]);
  const [errors, setErrors] = useState<[string, string]>(['', '']);
  const [reading, setReading] = useState<[boolean, boolean]>([false, false]);
  const [confirmed, setConfirmed] = useState(false);
  const tokens = useRef([0, 0]),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      tokens.current = tokens.current.map((v) => v + 1);
    };
  }, []);
  const clear = () => {
    tokens.current = tokens.current.map((v) => v + 1);
    setReports([null, null]);
    setErrors(['', '']);
    setReading([false, false]);
    setConfirmed(false);
  };
  const load = async (slot: 0 | 1, file?: File) => {
    if (!file) return;
    const token = ++tokens.current[slot];
    setConfirmed(false);
    setReports((old) => {
      const next = [...old] as typeof old;
      next[slot] = null;
      return next;
    });
    setErrors((old) => {
      const next = [...old] as typeof old;
      next[slot] = '';
      return next;
    });
    setReading((old) => {
      const next = [...old] as typeof old;
      next[slot] = true;
      return next;
    });
    const result = await readCodeMeasurementFile(file, true);
    if (!alive.current || token !== tokens.current[slot]) return;
    setReading((old) => {
      const next = [...old] as typeof old;
      next[slot] = false;
      return next;
    });
    if (result.status === 'ready')
      setReports((old) => {
        const next = [...old] as typeof old;
        next[slot] = result.report;
        return next;
      });
    else if (result.status === 'invalid')
      setErrors((old) => {
        const next = [...old] as typeof old;
        next[slot] = codeReportImportMessages[result.reason];
        return next;
      });
  };
  const comparison = useMemo(
    () =>
      reports[0] && reports[1]
        ? compareCodeMeasurementReports(reports[0], reports[1], {
            enabled: true,
            sameScopeConfirmed: confirmed,
          })
        : null,
    [reports, confirmed],
  );
  return (
    <section className="code-measurement-panel" aria-label="本地代码数值报告">
      <header>
        <div>
          <h3>代码结构与前后变化</h3>
          <p>主动选择本地数值报告，每份最多256 KiB。内容只保留在当前页面内存。</p>
        </div>
        <button
          onClick={() => {
            clear();
            onClose();
          }}
        >
          关闭并清空
        </button>
      </header>
      <div className="code-measurement-note">
        不选择源码、原始补丁或路径清单。支持Python、JS/TS多文件及patch-measurement-1数值报告；
        本面板不扫描目录、不调用模型、不上传、不写入浏览器存储。
      </div>
      <p>
        Python：使用measure-python-set；JS/TS：使用measure-code-set；补丁：使用measure-patch。单份报告可以独立查看，前后比较需要原要求修订和完整范围。
        各语言、解析方法分别展示，不能混成一个难度总分。
      </p>
      <div className="code-measurement-inputs">
        {([0, 1] as const).map((slot) => (
          <label key={slot}>
            {slot === 0 ? '报告一（比较时选执行前）' : '报告二（比较时选执行后）'}
            <input
              type="file"
              accept=".json,application/json"
              disabled={reading[slot]}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                void load(slot, file);
              }}
            />
            {reading[slot] && <span role="status">正在本地读取…</span>}
            {errors[slot] && <span role="alert">{errors[slot]}</span>}
          </label>
        ))}
      </div>
      <button
        disabled={!reports.some(Boolean) && !reading.some(Boolean) && !errors.some(Boolean)}
        onClick={clear}
      >
        清空本次结果
      </button>
      <div className="code-measurement-reports">
        {reports.map(
          (report, i) =>
            report && <CodeMeasurementReportView key={i} report={report} title={`报告${i + 1}`} />,
        )}
      </div>
      {reports.every((r) => r && r.version !== 'patch-measurement-1') && (
        <label className="code-measurement-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          确认两份报告对应相同原要求及相同模块范围，已包含该范围内的新增和删除文件。
        </label>
      )}
      {comparison && <CodeMeasurementComparisonView comparison={comparison} />}
    </section>
  );
}
