import type { ReactNode } from 'react';
import './quota-replay.css';

export function QuotaReplayShell({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return (
    <section className="qr-panel" aria-label="本地共享额度回放">
      <div className="qr-heading">
        <div>
          <span className="qr-eyebrow">套餐与共享额度</span>
          <h2>按整段工作时间线检查额度</h2>
        </div>
        <span className="qr-badge">{enabled ? '仅本地 · 手动运行' : '默认关闭'}</span>
      </div>
      <p>
        将多个任务放进同一个额度池，观察重置、赠额、到期和等待对费用的影响。这里使用明确规则计算情景，结果不代表任务已经验收。
      </p>
      {children}
    </section>
  );
}

export function QuotaReplayClosed({ onEnable }: { onEnable: () => void }) {
  return (
    <QuotaReplayShell enabled={false}>
      <button className="qr-primary" onClick={onEnable}>
        开启本地额度回放
      </button>
    </QuotaReplayShell>
  );
}
