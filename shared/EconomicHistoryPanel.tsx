import { useEffect, useRef, useState } from 'react';
import {
  EconomicHistoryReportSchema,
  economicHistoryLimits,
  type EconomicHistoryReport,
} from './economic-history-schema.js';
import { EconomicHistoryReportView } from './EconomicHistoryReportView.js';
import './economic-history.css';

export function EconomicHistoryPanel({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<EconomicHistoryReport | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const worker = useRef<Worker | null>(null),
    generation = useRef(0);
  const cancel = () => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
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
    setReport(null);
    setError('');
  };
  const close = () => {
    clear();
    onClose();
  };
  const select = async (file: File) => {
    clear();
    const token = generation.current;
    setBusy(true);
    try {
      if (
        !Number.isSafeInteger(file.size) ||
        file.size < 1 ||
        file.size > economicHistoryLimits.bytes
      )
        throw new Error();
      const bytes = await file.arrayBuffer();
      if (token !== generation.current) return;
      if (bytes.byteLength !== file.size || bytes.byteLength > economicHistoryLimits.bytes)
        throw new Error();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const job = new Worker(new URL('./economic-history.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.current = job;
      job.onmessage = (e) => {
        if (token !== generation.current || worker.current !== job) return;
        try {
          if (e.data?.ok !== true) throw new Error();
          const parsed = EconomicHistoryReportSchema.parse(e.data.report);
          setReport(parsed);
        } catch {
          setError('没有生成可用分析，请核对经济事件JSON。原文、文件名及错误片段没有输出。');
        } finally {
          job.terminate();
          worker.current = null;
          setBusy(false);
        }
      };
      job.onerror = () => {
        if (token !== generation.current || worker.current !== job) return;
        job.terminate();
        worker.current = null;
        setBusy(false);
        setError('本地计算未完成，可以重新选择文件。');
      };
      job.postMessage({ text });
    } catch {
      if (token === generation.current) {
        worker.current?.terminate();
        worker.current = null;
        setBusy(false);
        setError('请选择不超过4 MiB的UTF-8经济事件JSON；原文和文件名没有输出。');
      }
    }
  };
  return (
    <section className="economic-history-panel" aria-label="本地历史费用核对">
      <h3>选择账本，核对跨月退款与要求费用</h3>
      <p>
        只读取你主动选择的JSON，不访问账号、支付软件或其他文件。没有模型调用、上传、存储或自动执行。此账本含准确金额、时间与本地关联号，不能直接当作匿名摘要上传。
      </p>
      <label>
        选择经济事件JSON并在本地分析
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void select(file);
          }}
        />
      </label>
      <div className="economic-history-actions">
        {busy && <button onClick={clear}>取消计算</button>}
        <button onClick={clear}>清空结果</button>
        <button onClick={close}>关闭</button>
      </div>
      {busy && (
        <p role="status" aria-busy="true">
          正在本地计算所选经济事件…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {report && <EconomicHistoryReportView report={report} />}
    </section>
  );
}
