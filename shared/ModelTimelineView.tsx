import type { ModelTimeline } from './model-timeline.js';

const number = (value: number | null) => value === null ? '未知' : value.toLocaleString();
export function ModelTimelineView({ timeline }: { timeline?: ModelTimeline }) {
  if (!timeline || !timeline.streams.length) return null;
  return <section className="model-timeline" aria-label="模型切换与分段用量">
    <h3>模型切换与分段用量</h3>
    <p>{timeline.switches === null ? `已观察到 ${timeline.observedSwitches} 次切换，完整次数未知` : `共 ${timeline.switches} 次切换`} · 各代理会话分别统计</p>
    {timeline.unsequencedObservations > 0 && <p>{timeline.unsequencedObservations} 条观察缺少可靠顺序，未生成时间线。</p>}
    {timeline.streams.map(stream => <details key={stream.stream} open={timeline.streams.length === 1}>
      <summary>会话 {stream.stream + 1} · {stream.segments.map(s => s.model?.model ?? '模型未知').join(' → ') || '顺序未知'}</summary>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>阶段</th><th>模型</th><th>观察时间</th><th>输入 Token</th><th>输出 Token</th><th>已知输入 / 输出小计</th></tr></thead>
        <tbody>{stream.segments.map(s => <tr key={s.ordinal}><td>{s.ordinal + 1}</td><td>{s.model?.model ?? '未知'}</td>
          <td>{s.firstAt ? new Date(s.firstAt).toLocaleString() : '未知'}{s.lastAt && s.lastAt !== s.firstAt ? ` — ${new Date(s.lastAt).toLocaleString()}` : ''}</td>
          <td>{number(s.tokens.inputTokens)}</td><td>{number(s.tokens.outputTokens)}</td><td>{number(s.knownTokens.inputTokens)} / {number(s.knownTokens.outputTokens)}</td>
        </tr>)}</tbody></table></div>
    </details>)}
    <p>时间为已记录的调用或用量观察时间；等待时长不计作模型运行时长。缺失用量不按比例分摊。</p>
  </section>;
}
