import type { CSSProperties, ReactNode } from 'react';
import { ModelMark } from './components';
export type ChartRankItem = {
  id: string;
  position: number | string;
  name: string;
  meta: string;
  model?: string;
  value: number | null;
  valueLabel: string;
  eligible: boolean;
  metrics: ReactNode[];
};
export function RankingChart({
  rows,
  columns,
  label,
  unit,
  max,
  signed = false,
}: {
  rows: ChartRankItem[];
  columns: { title: string; unit: string }[];
  label: string;
  unit: string;
  max: number;
  signed?: boolean;
}) {
  return (
    <div
      className={`rank-chart ${signed ? 'rank-chart-signed' : ''}`}
      role="table"
      aria-label={label}
      style={{ '--chart-metrics': columns.length } as CSSProperties}
    >
      <div className="rank-chart-grid rank-chart-head" role="row">
        <span role="columnheader">#</span>
        <span role="columnheader" className="rank-chart-visual-head">
          <span>{label.includes('套餐') ? '套餐' : '模型'}</span>
          <small>{unit}</small>
        </span>
        {columns.map((column) => (
          <span key={column.title} role="columnheader" className="rank-chart-side">
            {column.title}
            <small>{column.unit}</small>
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          role="row"
          className={`rank-chart-grid rank-chart-row ${row.eligible ? '' : 'rank-chart-ineligible'}`}
        >
          <span role="cell" className="rank-chart-position">
            {row.position}
          </span>
          <div role="cell" className="rank-chart-visual">
            <div className="rank-chart-name">
              {row.model && <ModelMark id={row.model} tiny />}
              <div>
                <strong title={row.name}>{row.name}</strong>
                <small title={row.meta}>{row.meta}</small>
              </div>
            </div>
            <span
              className={`rank-chart-track ${signed && (row.value ?? 0) < 0 ? 'negative' : ''}`}
              aria-hidden="true"
            >
              {row.value !== null && Number.isFinite(row.value) && (
                <span
                  className="rank-chart-fill"
                  style={{
                    width: `${Math.min(signed ? 50 : 100, (Math.abs(row.value) / Math.max(max, Number.EPSILON)) * (signed ? 50 : 100))}%`,
                  }}
                />
              )}
            </span>
            <strong className="rank-chart-value">{row.valueLabel}</strong>
          </div>
          {row.metrics.map((metric, i) => (
            <span role="cell" className="rank-chart-side" key={i}>
              {metric}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
