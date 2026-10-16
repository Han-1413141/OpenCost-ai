import { monitorHistoryExportDiagnostics } from './monitor-history-export-text.js';
import type { MonitorHistoryExportPreview as Preview } from './monitor-history-export-schema.js';

export function MonitorHistoryExportPreview({ report }: { report: Preview }) {
  const status = {
    complete: '已读完选定的本地存储范围',
    empty: '所选范围没有存储观察',
    incomplete: '历史导出条件不足',
    conflict: '本地历史核对未通过',
    capacity: '导出超出容量',
    unavailable: '历史库无法读取',
    disabled: '历史导出未开启',
  }[report.status];
  return (
    <section className="qr-import" aria-label="监控历史导出概览">
      <h3>{status}</h3>
      {report.selection && (
        <p>
          观察范围：{report.selection.startAt} 至 {report.selection.endAt}，包含两端的观察时刻。
        </p>
      )}
      <p>
        选中观察{report.counts.matchedRowsIsLowerBound ? '至少' : ''} {report.counts.matchedRows}{' '}
        份；原存储内容
        {report.counts.bodyBytes === null
          ? '字节数未知'
          : ` ${report.counts.bodyBytes.toLocaleString('zh-CN')} 字节`}
        。
      </p>
      <p className="qr-note">{report.notice}</p>
      <p>存储观察齐全不表示源请求、全部共享消费或事件流水齐全；还须完成下方映射与记账核对。</p>
      {report.diagnostics.length > 0 && (
        <ul className="qr-attention" role="status">
          {report.diagnostics.map((code) => (
            <li key={code}>{monitorHistoryExportDiagnostics[code]}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
