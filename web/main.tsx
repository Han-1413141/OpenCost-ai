import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CurrencyProvider } from './Currency';
import './styles.css';
import './design.css';
import './workspace.css';
import { initializeLocale } from './i18n/locale';
import { consumeFeedbackAccess } from './feedback-access';

const initialFeedbackAccess = consumeFeedbackAccess(location, history);

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>页面暂时无法显示</h1>
        <p>请重新加载页面。</p>
        <button onClick={() => location.reload()}>重新打开 OpenCost</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
void initializeLocale().catch(() => {}).finally(() => createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <CurrencyProvider>
      <App initialFeedbackAccess={initialFeedbackAccess} />
    </CurrencyProvider>
  </ErrorBoundary>,
));
