import { Component, Suspense, type ReactNode } from 'react';
import { Button, Empty } from './ui';

type Props = { page: string; title: string; children: ReactNode };
type State = { page: string; failed: boolean };

/** Keep navigation usable after a failed chunk or page render. Recovery is user initiated. */
export class PageBoundary extends Component<Props, State> {
  state: State = { page: this.props.page, failed: false };

  static getDerivedStateFromProps(props: Props, state: State) {
    return props.page === state.page ? null : { page: props.page, failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section role="alert" aria-label={`${this.props.title}加载失败`}>
          <Empty
            title="页面暂时无法显示"
            action={<Button onClick={() => location.reload()}>重新加载页面</Button>}
          >
            请检查网络后重新加载，也可以通过上方导航打开其他页面。
          </Empty>
        </section>
      );
    }
    return (
      <Suspense
        fallback={
          <section role="status" aria-live="polite" aria-busy="true">
            <Empty title={`正在打开${this.props.title}`} />
          </section>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
