import './vbti.css';
export function VBTIMark() {
  return (
    <span className="vbti-wordmark" aria-label="VBTI">
      <b>VB</b>
      <i>TI</i>
    </span>
  );
}
export function VBTIEntry() {
  return (
    <aside className="vbti-side-entry" aria-label="VBTI 活动入口">
      <span className="vbti-event-label">OPEN COST · VIBE CODING</span>
      <VBTIMark />
      <div className="vbti-question-pixel" aria-hidden="true">
        ?
      </div>
      <h2>你的 Vibe coding 类型是什么？</h2>
      <p>用工作记录解锁角色，顺便看看 AI 花得值不值。</p>
      <span className="vbti-side-meta">32 种角色 · 六维工作画像</span>
      <a href="#vbti" className="vbti-button">
        进入 VBTI →
      </a>
      <small>模型、套餐推荐与额度对比，一起看。</small>
    </aside>
  );
}
