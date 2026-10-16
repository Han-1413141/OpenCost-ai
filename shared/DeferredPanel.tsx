import { Component, Suspense, lazy, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import './deferred-panel.css';

type BoundaryProps = {
  title: string;
  onRetry: () => void;
  onCancel?: () => void;
  children: ReactNode;
};

export class PanelLoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="deferred-panel" role="alert" aria-label={this.props.title}>
        <p>{this.props.title}暂时无法显示。可以重试，其他页面仍可使用。</p>
        <button onClick={this.props.onRetry}>重试加载</button>
        {this.props.onCancel && <button onClick={this.props.onCancel}>关闭</button>}
      </section>
    ) : (
      this.props.children
    );
  }
}

export type PanelLoader<P extends object> = () => Promise<{ default: ComponentType<P> }>;

/** A stable loader keeps panel state through snapshot updates; only manual retry replaces it. */
export function DeferredPanel<P extends object>({
  load,
  panelProps,
  title,
  onCancel,
}: {
  load: PanelLoader<P>;
  panelProps: P;
  title: string;
  onCancel?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const Loaded = useMemo(() => lazy(load), [load, attempt]);
  return (
    <PanelLoadBoundary
      key={attempt}
      title={title}
      onRetry={() => setAttempt((n) => n + 1)}
      onCancel={onCancel}
    >
      <Suspense
        fallback={
          <section className="deferred-panel" role="status" aria-label={title} aria-busy="true">
            <p>正在加载{title}…</p>
            {onCancel && <button onClick={onCancel}>取消加载</button>}
          </section>
        }
      >
        <Loaded {...panelProps} />
      </Suspense>
    </PanelLoadBoundary>
  );
}
