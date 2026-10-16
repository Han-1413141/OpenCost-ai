import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronDown, Info, SearchX, X } from 'lucide-react';
import type { Comparison } from '../shared/analysis';
import { colors, nameModel, nameHarness } from '../shared/catalog';
import { modelIdentityDetails } from './model-identity';
import { harnessCompositionLabel } from '../shared/harness-composition';
import { percent } from './api';
import { useDisplayCurrency } from './Currency';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? 'brand-small' : ''}`}>
      <img src="/brand/opencost-ai-wordmark.png" alt="OpenCost-AI" width="1200" height="160" />
    </span>
  );
}
export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
export function Button({
  children,
  onClick,
  secondary,
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      className={`button ${secondary ? 'button-secondary' : ''} ${className}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <div>
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </div>
    </label>
  );
}
export function SectionTitle({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title = '还没有符合条件的记录',
  children,
  action,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <SearchX size={27} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <div className={`notice notice-${tone}`}>
      <Info size={17} />
      <div>{children}</div>
    </div>
  );
}
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
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭详情">
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function CheckLine({ children }: { children: ReactNode }) {
  return (
    <div className="check-line">
      <Check size={15} />
      <span>{children}</span>
    </div>
  );
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
