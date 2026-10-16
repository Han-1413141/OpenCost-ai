import type { CostCompletionTradeoff } from '../shared/ranking-diagnostics';
import { number, percent } from './api';
import { useDisplayCurrency } from './Currency';

export function HarnessCostMargin({
  margin,
  currency,
}: {
  margin?: {
    eligibleCandidates: number;
    lowestCostTies: number;
    nextCandidateCost: number | null;
    gapMinor: number | null;
    gapFractionOfNext: number | null;
  };
  currency: string;
}) {
  const { format: money } = useDisplayCurrency();
  if (!margin) return null;
  if (margin.eligibleCandidates < 2) return <> · 合格候选不足两个，暂无价差比较</>;
  if (margin.lowestCostTies > 1) return <> · {margin.lowestCostTies} 个合格候选并列最低成本</>;
  return (
    <>
      {' · '}下一候选 {money(margin.nextCandidateCost, currency)} / 验收任务
      {' · '}当前少 {money(margin.gapMinor, currency)}
      {margin.gapFractionOfNext !== null &&
        `（相对下一候选低 ${percent(margin.gapFractionOfNext)}）`}
    </>
  );
}

export function RankingTradeoffs({
  rows,
  currency,
}: {
  rows: { id: string; name: string; tradeoff?: CostCompletionTradeoff }[];
  currency: string;
}) {
  const { format: money } = useDisplayCurrency();
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const eligible = rows.filter((row) => row.tradeoff && row.tradeoff.status !== 'unavailable');
  return (
    <details className="statistical-basis">
      <summary>成本与完成率：哪些方案有取舍，哪些有更好选择</summary>
      <p>
        在相同任务构成和费用口径下，寻找成本不更高、完成率不更低，且至少一项更好的方案。
        两项各有优势的方案同时保留，不增加主观权重，也不改变原有成本名次。
      </p>
      {!eligible.length ? (
        <p>至少需要两个具备完整比较条件的方案；这份结果暂无可用的权衡分析。</p>
      ) : (
        <ul className="ranking-tradeoffs">
          {eligible.map((row) => {
            const alternative = row.tradeoff!.alternative;
            return (
              <li key={row.id}>
                <strong>{row.name}</strong>
                {'：'}
                {alternative ? (
                  <>
                    {names.get(alternative.id) ?? '另一可比方案'} 成本
                    {alternative.costDifference === 0
                      ? '相同'
                      : `少 ${money(alternative.costDifference, currency)} / 验收任务`}
                    {'，'}完成率
                    {alternative.completionDifference === 0
                      ? '相同'
                      : `高 ${number(alternative.completionDifference * 100, 1)} 个百分点`}
                    。
                  </>
                ) : (
                  '当前没有其他方案同时满足“成本不更高、完成率不更低”且至少一项更好。'
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p>
        仅描述这批记录中的成本与完成率，不代表整体质量、速度或未来表现，也不表示差异已被统计证实。
        页面金额会四舍五入，比较使用原始数值。
      </p>
    </details>
  );
}
