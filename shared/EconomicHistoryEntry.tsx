import { useState } from 'react';
import { DeferredPanel } from './DeferredPanel.js';

const load = () =>
  import('./EconomicHistoryPanel.js').then((m) => ({ default: m.EconomicHistoryPanel }));
export function EconomicHistoryEntry() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return open ? (
    <DeferredPanel
      load={load}
      panelProps={{ onClose: close }}
      title="本地历史费用核对"
      onCancel={close}
    />
  ) : (
    <section className="deferred-panel" aria-label="本地历史费用入口">
      <h3>跨月退款与要求费用</h3>
      <p>
        主动选择经济事件JSON，分开查看本期现金和各要求的已记录费用。默认关闭，文件只在本地分析。
      </p>
      <button onClick={() => setOpen(true)}>打开本地历史费用</button>
    </section>
  );
}
