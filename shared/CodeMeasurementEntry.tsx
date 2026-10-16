import { useState } from 'react';
import { DeferredPanel } from './DeferredPanel.js';

const load = () =>
  import('./CodeMeasurementPanel.js').then((m) => ({ default: m.CodeMeasurementPanel }));
export function CodeMeasurementEntry() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return open ? (
    <DeferredPanel
      load={load}
      panelProps={{ onClose: close }}
      title="本地代码结构"
      onCancel={close}
    />
  ) : (
    <section aria-label="本地代码结构入口" className="deferred-panel">
      <h3>查看代码数值与前后变化</h3>
      <p>
        主动导入Python、JS/TS多文件或补丁数值报告，分别查看范围、分布与改动。默认关闭，文件留在本地。
      </p>
      <button onClick={() => setOpen(true)}>打开本地代码结构</button>
    </section>
  );
}
