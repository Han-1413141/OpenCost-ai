import type { SelectionStability } from './selection-stability.js';
import { selectionStabilityLines } from './selection-stability-text.js';
import { useState } from 'react';
function Conditions({
  model,
  label,
  conditionLabels,
  configurationLabels,
}: {
  model: SelectionStability['models'][number];
  label: string;
  conditionLabels?: Record<string, string>;
  configurationLabels?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    size = 16;
  const bounds = (b: { lower: number; upper: number }) =>
    b.lower === b.upper ? `${b.lower}%` : `${b.lower}%—${b.upper}%`;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label} · 各任务条件的配置变化</summary>
      {open && (
        <>
          <table>
            <thead>
              <tr>
                <th>任务条件</th>
                <th>原配置仍被选中</th>
                <th>仍为最低费用，含并列</th>
              </tr>
            </thead>
            <tbody>
              {model.conditions.slice(page * size, (page + 1) * size).map((c) => (
                <tr key={c.conditionId}>
                  <td>
                    {conditionLabels?.[c.conditionId] ?? `条件 ${c.conditionId.slice(0, 12)}`}
                    <br />
                    <small>
                      {configurationLabels?.[`${model.modelId}/${c.conditionId}`] ??
                        '原Harness详见冻结配置'}
                    </small>
                  </td>
                  <td>{bounds(c.exactChoice)}</td>
                  <td>{bounds(c.costMinimum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {model.conditions.length > size && (
            <p>
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                上一页
              </button>{' '}
              {page + 1} / {Math.ceil(model.conditions.length / size)}{' '}
              <button
                type="button"
                disabled={(page + 1) * size >= model.conditions.length}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </p>
          )}
        </>
      )}
    </details>
  );
}
export function SelectionStabilityView({
  result,
  modelLabels,
  conditionLabels,
  configurationLabels,
}: {
  result?: SelectionStability;
  modelLabels?: Record<string, string>;
  conditionLabels?: Record<string, string>;
  configurationLabels?: Record<string, string>;
}) {
  return (
    <details className="statistical-selection">
      <summary>模型与Harness的选型变化</summary>
      {selectionStabilityLines(result, { modelLabels }).map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {result?.models
        .filter((m) => m.state === 'measured')
        .map((m) => (
          <Conditions
            key={`${result.seedDigest}:${m.modelId}`}
            model={m}
            label={modelLabels?.[m.modelId] ?? m.modelId}
            conditionLabels={conditionLabels}
            configurationLabels={configurationLabels}
          />
        ))}
    </details>
  );
}
