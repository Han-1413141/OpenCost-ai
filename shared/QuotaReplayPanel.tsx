import { useEffect, useRef, useState } from 'react';
import type { QuotaReplayResult } from './quota-replay.js';
import type { QuotaObservationImportResult } from './quota-observation-import.js';
import { QuotaObservationImportPreview } from './QuotaObservationImportPreview.js';
import type { QuotaPlanComparisonResult } from './quota-plan-comparison.js';
import type { QuotaPlanComparison } from './quota-plan-comparison-schema.js';
import { QuotaPlanComparisonView, QuotaPlanPreferences } from './QuotaPlanComparisonView.js';
import { quotaReplayIssueLabels as issueLabels } from './quota-replay-labels.js';
import { QuotaReplayShell } from './QuotaReplayShell.js';
import type { QuotaPortfolioResult } from './quota-portfolio.js';
import type { QuotaPortfolio } from './quota-portfolio-schema.js';
import { QuotaPortfolioView } from './QuotaPortfolioView.js';
import type { MonitorHistoryExportPreview as HistoryExport } from './monitor-history-export-schema.js';
import { MonitorHistoryExportPreview } from './MonitorHistoryExportPreview.js';

type Meta =
  | {
      plan: string;
      version: string;
      basis: string;
      requests: number;
      pools: number;
      events: number;
      horizonMs: number;
      currency: string;
    }
  | {
      kind: 'plan_comparison';
      candidates: number;
      requests: number;
      horizonMs: number;
      currency: string;
      preferences: QuotaPlanComparison['preferences'];
    }
  | {
      kind: 'portfolio';
      purchases: number;
      groups: number;
      requests: number;
      horizonMs: number;
      currency: string;
      preferences: QuotaPlanComparison['preferences'];
    };
const maxBytes = 2 * 1024 * 1024;
const amount = (n: number | null, currency: string) =>
  n === null
    ? '未知'
    : `${(n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const count = (n: number | null) =>
  n === null
    ? '未知'
    : n !== 0 && Math.abs(n) < 0.000001
      ? `${n.toExponential(4)}（近似）`
      : n.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const elapsed = (n: number | null) =>
  n === null
    ? '未知'
    : n < 1000
      ? `${n} 毫秒`
      : n < 60000
        ? `${(n / 1000).toFixed(1)} 秒`
        : n < 3600000
          ? `${(n / 60000).toFixed(1)} 分钟`
          : `${(n / 3600000).toFixed(2)} 小时`;
const kindLabels: Record<string, string> = {
  balance: '批次余额',
  rolling: '滚动窗口',
  concurrency: '并发占用',
  token_bucket: '连续补充',
  unsupported: '未支持规则',
};
const reasonLabels: Record<string, string> = {
  capacity_available: '额度条件满足',
  deadline: '截至最晚开始时间尚未安排',
  horizon: '窗口结束时尚未安排',
  exceeds_hard_capacity: '需求超过固定硬容量',
  input_unknown: '输入条件未知',
  operation_budget: '处理预算已到达',
  event_conflict: '事件存在冲突',
};
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

export function QuotaReplayOutput({ result }: { result: QuotaReplayResult }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [result]);
  const c = result.cost,
    start = page * 50,
    requests = result.requests.slice(start, start + 50);
  const status = {
    complete: '已完成规则回放',
    not_evaluated: '条件不足，尚未回放',
    incomplete: '仅处理部分范围',
    conflict: '回放遇到事件冲突',
  }[result.status];
  const finished = result.requests.filter(
    (r) =>
      r.status === 'scheduled' &&
      r.serviceEndsAtMs !== null &&
      r.serviceEndsAtMs <= result.horizonMs,
  ).length;
  const serviceUnknown = result.requests.filter(
    (r) => r.status === 'scheduled' && r.serviceEndsAtMs === null,
  ).length;
  return (
    <div className="qr-output">
      <div className="qr-result-heading">
        <h3>{status}</h3>
        <button onClick={() => downloadJson(result, 'opencost-quota-result.json')}>
          保存完整结果
        </button>
      </div>
      <p>{result.notice}</p>
      <p className="qr-note">
        计算方法：{result.methodVersion ?? '历史结果未记录方法版本'}
        。原保存结果保留，重新运行使用当前方法。
      </p>
      {result.status !== 'complete' && (
        <p className="qr-attention" role="status">
          以下信息只代表已经处理的范围。处理至 {elapsed(result.processedThroughMs)}
          ；该时点未完整结算，池余额和占用保留未知。整期费用和未处理需求不补零。
        </p>
      )}
      <div className="qr-metrics">
        <div>
          <small>已安排请求</small>
          <strong>
            {count(result.summary.scheduled)} <em>/ {result.summary.requests}</em>
          </strong>
        </div>
        <div>
          <small>窗口内未覆盖</small>
          <strong>{count(result.summary.unmet)}</strong>
        </div>
        <div>
          <small>结果未知</small>
          <strong>{result.summary.unknown}</strong>
        </div>
        <div>
          <small>已安排请求的最长等待</small>
          <strong>{elapsed(result.summary.waitMaximumMs)}</strong>
        </div>
      </div>
      <p>
        需求对应 {result.summary.rootTasks} 个根目标。{finished} 个请求的声明服务时长落在窗口内，
        {serviceUnknown} 个获准请求未提供服务时长；这些均不是任务完成量或验收率。
      </p>
      <div className="qr-costs">
        <div>
          <small>覆盖情景的整期费用</small>
          <strong>{amount(c.wholePeriodTotalMinor, c.currency)}</strong>
        </div>
        <div>
          <small>窗口现金发生额</small>
          <strong>{amount(c.inWindowCashMinor, c.currency)}</strong>
        </div>
        <div>
          <small>额外按量费用</small>
          <strong>{amount(c.overageMinor, c.currency)}</strong>
        </div>
      </div>
      <p className="qr-note">{c.note}</p>
      {result.issues.length > 0 && (
        <ul className="qr-attention">
          {result.issues.map((code) => (
            <li key={code}>{issueLabels[code] ?? '存在尚未解释的输入条件，请查阅结果原因码。'}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>回放采用的需求和调度条件</summary>
        <ul>
          {result.assumptions.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </details>
      <h3>各额度池的消耗与恢复</h3>
      <div className="qr-table">
        <table>
          <thead>
            <tr>
              <th>额度池</th>
              <th>剩余</th>
              <th>请求总需求</th>
              <th>到期未用</th>
              <th>重置舍弃</th>
              <th>滚动恢复</th>
              <th>退回 / 失效</th>
            </tr>
          </thead>
          <tbody>
            {result.pools.map((p, i) => (
              <tr key={p.poolRef}>
                <th>
                  {i + 1} · {kindLabels[p.kind]}
                  <small>单位：{p.unit}</small>
                </th>
                <td>{count(p.remainingUnits)}</td>
                <td>{count(p.consumedUnits)}</td>
                <td>{count(p.expiredUnusedUnits)}</td>
                <td>{count(p.resetDiscardedUnits)}</td>
                <td>{count(p.rollingRecoveredUnits)}</td>
                <td>
                  {count(p.returnedUnits)} / {count(p.returnLostUnits)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>请求时间线</h3>
      <p className="qr-note">
        各时点是情景开始后的相对时间。截止尚未安排的等待是下界；同池按到达顺序排队，无关池可以继续处理。
      </p>
      <div className="qr-table">
        <table>
          <thead>
            <tr>
              <th>请求</th>
              <th>到达</th>
              <th>安排</th>
              <th>等待</th>
              <th>结果与原因</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r, i) => (
              <tr key={r.requestRef}>
                <th>{start + i + 1}</th>
                <td>{elapsed(r.arrivedAtMs)}</td>
                <td>{r.startedAtMs === null ? '未安排' : elapsed(r.startedAtMs)}</td>
                <td>
                  {r.waitMs === null
                    ? '未知'
                    : `${r.waitIsLowerBound ? '至少 ' : ''}${elapsed(r.waitMs)}`}
                </td>
                <td>
                  {reasonLabels[r.reason]}
                  {r.blockedPools.length > 0 && (
                    <small>涉及 {r.blockedPools.length} 个额度约束</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.requests.length > 50 && (
        <div className="qr-actions">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>
            {start + 1}–{Math.min(start + 50, result.requests.length)} / {result.requests.length}
          </span>
          <button
            disabled={start + 50 >= result.requests.length}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

export function QuotaReplayPanel({
  initiallyEnabled = false,
  onClose,
}: {
  initiallyEnabled?: boolean;
  onClose?: () => void;
} = {}) {
  const [enabled, setEnabled] = useState(initiallyEnabled),
    [busy, setBusy] = useState(false),
    [text, setText] = useState<string | null>(null),
    [meta, setMeta] = useState<Meta | null>(null),
    [result, setResult] = useState<QuotaReplayResult | null>(null),
    [comparison, setComparison] = useState<QuotaPlanComparisonResult | null>(null),
    [portfolio, setPortfolio] = useState<QuotaPortfolioResult | null>(null),
    [preferenceInvalid, setPreferenceInvalid] = useState(false),
    [importReport, setImportReport] = useState<QuotaObservationImportResult | null>(null),
    [exportReport, setExportReport] = useState<HistoryExport | null>(null),
    [error, setError] = useState('');
  const worker = useRef<Worker | null>(null),
    generation = useRef(0),
    input = useRef<HTMLInputElement | null>(null);
  const cancel = () => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
  };
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
    },
    [],
  );
  const clear = () => {
    cancel();
    setBusy(false);
    setText(null);
    setMeta(null);
    setResult(null);
    setComparison(null);
    setPortfolio(null);
    setPreferenceInvalid(false);
    setImportReport(null);
    setExportReport(null);
    setError('');
    if (input.current) input.current.value = '';
  };
  const execute = (action: 'inspect' | 'run', contents: string, epoch: number) => {
    try {
      const w = new Worker(new URL('./quota-replay.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.current = w;
      const fail = (message: string) => {
        if (generation.current !== epoch) return;
        w.terminate();
        worker.current = null;
        setBusy(false);
        setError(message);
        setResult(null);
        setComparison(null);
        setPortfolio(null);
        if (action === 'inspect') {
          setText(null);
          setMeta(null);
          setImportReport(null);
          setExportReport(null);
        }
      };
      w.onerror = () => fail('本地计算模块无法运行；请核对应用版本或重新选择文件。');
      w.onmessage = (event) => {
        if (generation.current !== epoch) return;
        if (!event.data?.ok) {
          fail('输入结构或大小不符合额度回放协议；请按模板核对本地文件。');
          return;
        }
        w.terminate();
        worker.current = null;
        setBusy(false);
        setError('');
        if (action === 'inspect') {
          setMeta(event.data.meta);
          setImportReport(event.data.importReport ?? null);
          setExportReport(event.data.exportReport ?? null);
          setText(
            event.data.importReport || event.data.exportReport
              ? (event.data.preparedText ?? null)
              : contents,
          );
        } else if (event.data.portfolio) {
          setPortfolio(event.data.portfolio);
          setComparison(null);
          setResult(null);
        } else if (event.data.comparison) {
          setComparison(event.data.comparison);
          setPortfolio(null);
          setResult(null);
        } else {
          setResult(event.data.result);
          setComparison(null);
          setPortfolio(null);
        }
      };
      w.postMessage({ action, text: contents });
    } catch {
      setBusy(false);
      setError('当前环境无法启动本地计算模块。');
      setResult(null);
      setComparison(null);
      setPortfolio(null);
    }
  };
  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    clear();
    const epoch = generation.current;
    if (file.size > maxBytes) {
      setError('文件超过 2 MiB；请选择有界的额度、观测或套餐比较文件。');
      return;
    }
    setBusy(true);
    try {
      const contents = await file.text();
      if (generation.current === epoch) execute('inspect', contents, epoch);
    } catch {
      if (generation.current === epoch) {
        setBusy(false);
        setError('所选文件无法读取；原始内容未输出。');
      }
    }
  };
  const example = async (variant: 'replay' | 'observations' | 'plans' | 'portfolio' = 'replay') => {
    clear();
    const epoch = generation.current;
    setBusy(true);
    try {
      const data =
        variant === 'portfolio'
          ? (await import('./quota-portfolio-example.js')).quotaPortfolioExample()
          : variant === 'plans'
            ? (await import('./quota-plan-comparison-example.js')).quotaPlanComparisonExample()
            : variant === 'observations'
              ? (
                  await import('./quota-observation-import-example.js')
                ).quotaObservationImportExample()
              : (await import('./quota-replay.js')).quotaReplayExample();
      if (generation.current === epoch) execute('inspect', JSON.stringify(data), epoch);
    } catch {
      if (generation.current === epoch) {
        setBusy(false);
        setError('示例无法载入。');
      }
    }
  };
  const updatePreferences = (preferences: QuotaPlanComparison['preferences']) => {
    if (!text || !meta || !('kind' in meta)) return;
    const data = JSON.parse(text) as QuotaPlanComparison | QuotaPortfolio;
    data.preferences = preferences;
    setText(JSON.stringify(data));
    setMeta({ ...meta, preferences });
    setComparison(null);
    setPortfolio(null);
    setResult(null);
  };
  return (
    <QuotaReplayShell enabled={enabled}>
      {!enabled ? (
        <button className="qr-primary" onClick={() => setEnabled(true)}>
          开启本地额度回放
        </button>
      ) : (
        <>
          <div className="qr-actions">
            <label className="qr-file">
              选择情景或观测 JSON
              <input
                ref={input}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void selectFile(e.currentTarget.files?.[0])}
              />
            </label>
            <button onClick={() => void example()}>查看共享额度示例</button>
            <button onClick={() => void example('observations')}>查看观测导入示例</button>
            <button onClick={() => void example('plans')}>查看套餐比较示例</button>
            <button onClick={() => void example('portfolio')}>查看多订阅组合示例</button>
            <button
              onClick={() => {
                clear();
                setEnabled(false);
                onClose?.();
              }}
            >
              关闭并清空
            </button>
          </div>
          <p className="qr-note">
            文件最多 2
            MiB。观测文件会先核对记录、映射和额度账目，点击计算才运行调度情景；没有账号读取、模型调用或上传。数据仅在本页面内保留，关闭即清空。
          </p>
          {exportReport && <MonitorHistoryExportPreview report={exportReport} />}
          {importReport && (
            <>
              <QuotaObservationImportPreview report={importReport} />
              <button
                onClick={() => downloadJson(importReport, 'opencost-quota-import-check.json')}
              >
                保存核对报告
              </button>
            </>
          )}
          {meta && (
            <div className="qr-input-summary">
              {'kind' in meta ? (
                <>
                  <strong>
                    {meta.kind === 'portfolio'
                      ? `指定 ${meta.purchases} 项订阅、${meta.groups} 个分配组`
                      : `指定 ${meta.candidates} 个候选套餐`}
                  </strong>
                  <span>
                    固定同一组 {meta.requests} 个请求与 {elapsed(meta.horizonMs)}{' '}
                    时间范围；价格和规则来自所选文件。
                  </span>
                  <QuotaPlanPreferences
                    key={generation.current}
                    preferences={meta.preferences}
                    currency={meta.currency}
                    disabled={busy}
                    onChange={updatePreferences}
                    onValidityChange={(valid) => {
                      setPreferenceInvalid(!valid);
                      if (!valid) {
                        setComparison(null);
                        setPortfolio(null);
                        setResult(null);
                      }
                    }}
                  />
                </>
              ) : (
                <>
                  <strong>
                    {meta.plan} · {meta.version}
                  </strong>
                  <span>
                    {meta.basis === 'explicit_scenario' ? '明确情景' : '观察需求的调度情景'} ·{' '}
                    {meta.requests} 个请求 · {meta.pools} 个池 · {meta.events} 个事件 ·{' '}
                    {elapsed(meta.horizonMs)}
                  </span>
                </>
              )}
              <button
                onClick={() => downloadJson(JSON.parse(text!), 'opencost-quota-scenario.json')}
              >
                保存所选情景
              </button>
            </div>
          )}
          <div className="qr-actions">
            <button
              className="qr-primary"
              disabled={busy || text === null || preferenceInvalid}
              onClick={() => {
                if (text !== null) {
                  cancel();
                  setBusy(true);
                  setError('');
                  setResult(null);
                  setComparison(null);
                  setPortfolio(null);
                  execute('run', text, generation.current);
                }
              }}
            >
              {busy ? '正在本地处理…' : '计算共享额度与费用'}
            </button>
            {busy && <button onClick={clear}>取消</button>}
          </div>
          {error && (
            <p className="qr-attention" role="alert">
              {error}
            </p>
          )}
          {result && <QuotaReplayOutput result={result} />}
          {portfolio && (
            <>
              <QuotaPortfolioView
                report={portfolio}
                renderReplay={(replay) => (
                  <QuotaReplayOutput key={replay.scenarioRef} result={replay} />
                )}
              />
              <button onClick={() => downloadJson(portfolio, 'opencost-portfolio-result.json')}>
                保存组合报告、价格与分配
              </button>
            </>
          )}
          {comparison && (
            <>
              <QuotaPlanComparisonView report={comparison} />
              <button
                onClick={() => downloadJson(comparison, 'opencost-plan-comparison-result.json')}
              >
                保存套餐比较报告与输入
              </button>
            </>
          )}
        </>
      )}
    </QuotaReplayShell>
  );
}
