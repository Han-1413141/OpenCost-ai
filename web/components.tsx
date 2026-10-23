import type { Comparison } from '../shared/analysis';
import { colors, nameModel, nameHarness } from '../shared/catalog';
import { modelIdentityDetails } from './model-identity';
import { harnessCompositionLabel } from '../shared/harness-composition';
import { percent } from './api';
import { useDisplayCurrency } from './Currency';
export {
  Brand,
  Tag,
  Button,
  Select,
  SectionTitle,
  Empty,
  Notice,
  Modal,
  CheckLine,
  TextLink,
} from './ui';

export function ModelMark({ id, tiny = false }: { id: string; tiny?: boolean }) {
  const label = id.startsWith('deepseek')
    ? 'D'
    : id.startsWith('qwen')
      ? 'Q'
      : id.startsWith('kimi')
        ? 'K'
        : id.startsWith('glm')
          ? 'G'
          : id.startsWith('gpt')
            ? '◎'
            : id.startsWith('claude')
              ? '✳'
              : id.slice(0, 1).toUpperCase();
  return (
    <span
      className={`model-mark ${tiny ? 'tiny' : ''}`}
      style={{ color: colors[id] ?? '#59728a', background: `${colors[id] ?? '#59728a'}12` }}
    >
      {label}
    </span>
  );
}
export function Scatter({
  rows,
  onSelect,
  compact = false,
}: {
  rows: Comparison[];
  onSelect: (r: Comparison) => void;
  compact?: boolean;
}) {
  const { format: money } = useDisplayCurrency();
  const plotted = rows.filter((r) => r.metrics.costPerAccepted !== null);
  const max = Math.max(...plotted.map((r) => r.metrics.costPerAccepted!), 100) * 1.22;
  const minCompletion =
    Math.floor(Math.min(0.7, ...plotted.map((r) => r.metrics.completion)) * 10) / 10;
  const completionRange = 1 - minCompletion;
  const width = 520,
    height = compact ? 180 : 250;
  const top = 20,
    bottom = height - 34,
    left = 45,
    right = width - 18;
  return (
    <div className="scatter">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="任务成本与完成率散点图，左上角表示花费较低且完成率较高"
      >
        <defs>
          <linearGradient id="chart-wash" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#eef6ed" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
        </defs>
        <rect
          x={left}
          y={top}
          width={(right - left) * 0.4}
          height={(bottom - top) * 0.43}
          fill="url(#chart-wash)"
          rx="5"
        />
        {[0, 1 / 3, 2 / 3, 1].map((step) => {
          const y = minCompletion + step * completionRange;
          const pos = top + ((1 - y) / completionRange) * (bottom - top);
          return (
            <g key={step}>
              <line x1={left} x2={right} y1={pos} y2={pos} stroke="#e8eaed" strokeDasharray="3 4" />
              <text x={left - 8} y={pos + 4} textAnchor="end" className="chart-tick">
                {Math.round(y * 100)}%
              </text>
            </g>
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((x) => (
          <g key={x}>
            <line
              x1={left + x * (right - left)}
              x2={left + x * (right - left)}
              y1={top}
              y2={bottom}
              stroke="#eff0f2"
            />
            <text
              x={left + x * (right - left)}
              y={bottom + 21}
              textAnchor="middle"
              className="chart-tick"
            >
              {money(max * x, rows[0]?.cohort.currency)}
            </text>
          </g>
        ))}
        <text x={left + 9} y={top + 16} className="chart-hint">
          更低成本 · 更高完成率
        </text>
        {plotted.map((r, i) => {
          const x = left + (r.metrics.costPerAccepted! / max) * (right - left),
            y = top + ((1 - r.metrics.completion) / completionRange) * (bottom - top);
          const identity = modelIdentityDetails(r.cohort.modelIdentity);
          const title = `${r.modelIds.map(nameModel).join(' + ')} · ${identity} · ${harnessCompositionLabel(r.cohort, nameHarness)}；${money(r.metrics.costPerAccepted, r.cohort.currency)}/验收目标；完成率 ${percent(r.metrics.completion)}；${r.metrics.count} 项目标，${r.metrics.sources} 个来源`;
          return (
            <g
              key={r.id}
              className="plot-point"
              role="button"
              tabIndex={0}
              aria-label={title}
              onClick={() => onSelect(r)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(r);
              }}
            >
              <title>{title}</title>
              <circle cx={x} cy={y} r={8} fill={colors[r.modelIds[0]] ?? '#67758a'} opacity=".14" />
              <circle cx={x} cy={y} r={4.5} fill={colors[r.modelIds[0]] ?? '#67758a'} />
              {!compact && (
                <text x={x + 8} y={y + (i % 2 ? 15 : -9)} className="point-label">
                  {nameModel(r.modelIds[0]).replace('Claude ', '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
