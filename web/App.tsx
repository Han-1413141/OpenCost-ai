import { lazy, useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  Search,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { api, type ExploreData, type RequestError } from './api';
import { Brand } from './components';
import { Home } from './pages/Home';
import { defaultFilters, type DashboardFilters } from './filters';
import { CurrencySelector } from './Currency';
import { SourceManifestSchema, type SourceManifest } from '../shared/source';
import { RepositoryLink } from './RepositoryLink';
import { PageRequests, resolveExploreSource, usesExplorePage } from './request-policy';
import { PageBoundary } from './PageBoundary';
import { GithubAccountProvider, GithubLoginButton } from './GithubAccount';
import { LanguageSelector } from './i18n/LanguageSelector';
import { t, useLocale } from './i18n/locale';
import type { FeedbackTarget } from '../shared/feedback-link';
import { consumeFeedbackAccess } from './feedback-access';
import { VBTIEntry } from './VBTIEntry';
import { VBTIHeader } from './VBTIHeader';
import {
  internalPageHref,
  navigateInApp,
  readVbtiPage,
  vbtiRoutes,
  type VbtiPage,
} from './vbti-navigation';
const VBTI = lazy(() => import('./pages/VBTI').then((m) => ({ default: m.VBTI })));

const Explorer = lazy(() => import('./pages/Explorer').then((m) => ({ default: m.Explorer })));
const Contribution = lazy(() =>
  import('./pages/Contribution').then((m) => ({ default: m.Contribution })),
);
const Methods = lazy(() => import('./pages/Information').then((m) => ({ default: m.Methods })));
const Connections = lazy(() =>
  import('./pages/Information').then((m) => ({ default: m.Connections })),
);
const AAReference = lazy(() =>
  import('./pages/Information').then((m) => ({ default: m.AAReference })),
);
const Feedback = lazy(() => import('./pages/Feedback').then((m) => ({ default: m.Feedback })));

export type Page =
  | 'overview'
  | 'compare'
  | 'ranking'
  | 'plans'
  | 'harness'
  | 'process'
  | 'trends'
  | 'recommend'
  | 'workspace'
  | 'feedback'
  | 'vbti'
  | 'vbti-test'
  | 'vbti-result'
  | 'contribute'
  | 'method'
  | 'connect'
  | 'aa';
const titles: Record<Page, string> = {
  overview: '首页排行',
  compare: '模型比较',
  ranking: '模型总排名',
  plans: '套餐比较',
  harness: 'Harness 比较',
  process: '任务过程与速度',
  trends: '成本趋势',
  recommend: '按预算选方案',
  workspace: '我的记录',
  feedback: '个人反馈',
  vbti: 'VBTI · 你的 Vibe coding 类型',
  'vbti-test': 'VBTI · 开始测试',
  'vbti-result': 'VBTI · 我的类型结果',
  contribute: '脱敏工作摘要收集计划',
  method: '数据与方法',
  connect: '工具接入',
  aa: '模型目录与评测',
};
const modelPages: Page[] = ['compare', 'harness', 'ranking', 'process', 'recommend'];
const infoPages: Page[] = ['method', 'aa', 'connect'];
const nav = [
  { id: 'overview', title: '首页排行', icon: LayoutDashboard },
  { id: 'compare', title: '模型比较', icon: BarChart3 },
  { id: 'plans', title: '套餐比较', icon: Wallet },
  { id: 'trends', title: '成本趋势', icon: TrendingUp },
  { id: 'method', title: '数据与方法', icon: BookOpen },
] as const;
function readPage(): Page {
  const id = location.hash.slice(1);
  return Object.hasOwn(titles, id) ? (id as Page) : (readVbtiPage(location.pathname) ?? 'overview');
}

export function App({
  initialFeedbackAccess = null,
}: {
  initialFeedbackAccess?: { accessKey: string; target: FeedbackTarget | null } | null;
}) {
  const locale = useLocale();
  const [page, setPage] = useState<Page>(readPage);
  const [projectSource, setProjectSource] = useState<SourceManifest | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<unknown>('/integrations/source.json', { signal: controller.signal })
      .then((value) => {
        const manifest = SourceManifestSchema.safeParse(value);
        if (!controller.signal.aborted && manifest.success) setProjectSource(manifest.data);
      })
      .catch(() => {
        /* Unpublished or unavailable source keeps the repository entry pending. */
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    try {
      localStorage.setItem('opencost.theme', 'light');
    } catch {
      /* Appearance remains usable without browser storage. */
    }
  }, []);
  const [source, setSource] = useState<'demo' | 'community'>('community');
  const [sourceReady, setSourceReady] = useState(false);
  const [ownerKey, setOwnerKey] = useState(initialFeedbackAccess?.accessKey ?? '');
  const [feedbackTarget, setFeedbackTarget] = useState(initialFeedbackAccess?.target ?? null);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ previewEnabled?: boolean; localWorkspace?: boolean }>('/api/health', {
      signal: controller.signal,
    })
      .then(async (health) => {
        if (controller.signal.aborted) return;
        setSource(resolveExploreSource(location.search, health.previewEnabled));
        setSourceReady(true);
        if (
          health.localWorkspace &&
          location.protocol === 'http:' &&
          location.hostname === '127.0.0.1'
        ) {
          const session = await api<{ format: string; origin: string; accessKey: string }>(
            '/api/local-workspace/session',
            { signal: controller.signal },
          );
          if (
            !controller.signal.aborted &&
            session.format === 'opencost-access-1' &&
            session.origin === location.origin &&
            /^[A-Za-z0-9_-]{43,128}$/.test(session.accessKey)
          )
            setOwnerKey(session.accessKey);
        }
      })
      .catch(() => {
        /* A failed status request must not expose preview tools. */
        if (!controller.signal.aborted) setSourceReady(true);
      });
    return () => controller.abort();
  }, []);
  const evidence = 'verified';
  const [data, setData] = useState<ExploreData | null>(null);
  const [error, setError] = useState<RequestError>('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [exploreRequests] = useState(
    () => new PageRequests<ExploreData>((path, signal) => api(path, { signal })),
  );
  const isExplorer = usesExplorePage(page);
  const explorePath = `/api/explore?source=${source}&evidence=${evidence}`;
  const refreshExplore = () => {
    if (exploreRequests.busy) return;
    exploreRequests.invalidate(explorePath);
    setReload((value) => value + 1);
  };
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const updateFilters = (patch: Partial<DashboardFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  useEffect(() => {
    const update = () => {
      const incoming = consumeFeedbackAccess(location, history);
      if (incoming) {
        setOwnerKey(incoming.accessKey);
        setFeedbackTarget(incoming.target);
      }
      setPage(readPage());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || link.target || link.hasAttribute('download')) return;
      const href = internalPageHref(link.href, location.href);
      if (!href) return;
      event.preventDefault();
      navigateInApp(href);
    };
    document.addEventListener('click', click);
    const legacy = location.hash.slice(1);
    if (Object.hasOwn(vbtiRoutes, legacy)) navigateInApp(vbtiRoutes[legacy as VbtiPage], true);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      document.removeEventListener('click', click);
    };
  }, []);
  useEffect(() => {
    if (!sourceReady || !isExplorer) return;
    let active = true;
    setLoading(true);
    setError('');
    exploreRequests
      .read(explorePath)
      .then((d) => {
        if (!active) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e : new Error('公开统计读取失败，请稍后重试。'));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      exploreRequests.cancel();
    };
  }, [sourceReady, isExplorer, explorePath, reload, exploreRequests]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    document.title = `${source === 'demo' ? t('本地预览') + ' · ' : ''}${t(titles[page])} · OpenCost`;
  }, [page, source, locale]);
  const go = useCallback((p: Page) => {
    navigateInApp(Object.hasOwn(vbtiRoutes, p) ? vbtiRoutes[p as VbtiPage] : `/#${p}`);
  }, []);
  const isVbti = Object.hasOwn(vbtiRoutes, page);
  const activeNav = modelPages.includes(page)
    ? 'compare'
    : infoPages.includes(page)
      ? 'method'
      : page;
  const tabs = modelPages.includes(page) ? modelPages : infoPages.includes(page) ? infoPages : [];
  return (
    <GithubAccountProvider ownerKey={ownerKey} setOwnerKey={setOwnerKey}>
      <div className={`app-shell page-${page}${isVbti ? ' vbti-standalone' : ''}`}>
        {isVbti ? (
          <VBTIHeader page={page as VbtiPage} />
        ) : (
          <header className="site-header">
            <div className="header-inner">
              <a href="#overview" className="header-brand" aria-label="OpenCost 首页">
                <Brand />
              </a>
              <nav className="header-nav" aria-label="主要导航">
                {nav.map((n) => (
                  <a
                    href={`#${n.id}`}
                    key={n.id}
                    className={activeNav === n.id ? 'active' : ''}
                    aria-current={activeNav === n.id ? 'page' : undefined}
                  >
                    {n.title}
                  </a>
                ))}
                <RepositoryLink repository={projectSource?.repository ?? null} />
              </nav>
              <div className="header-actions">
                <LanguageSelector />
                <GithubLoginButton header />
                <a
                  href="#workspace"
                  aria-label="我的记录"
                  className={page === 'workspace' ? 'account-link active' : 'account-link'}
                >
                  <UserRound size={16} />
                  <span>我的记录</span>
                </a>
                <a
                  className="button header-submit header-join"
                  aria-label="加入脱敏工作摘要收集计划，获得订阅额度监控与性价比建议"
                  href="#contribute"
                >
                  <span>加入脱敏工作摘要收集计划</span>
                  <small>获得订阅额度监控与性价比建议</small>
                </a>
              </div>
            </div>
          </header>
        )}
        {!isVbti && <VBTIEntry />}
        <div className="main-shell">
          <main className="main-content" id="main-content">
            {(tabs.length > 0 || isExplorer || page === 'aa') && (
              <div className="content-toolbar">
                {tabs.length > 0 && (
                  <nav
                    className="context-tabs"
                    aria-label={modelPages.includes(page) ? '模型比较分类' : '数据与方法分类'}
                  >
                    {tabs.map((id) => (
                      <a
                        key={id}
                        href={`#${id}`}
                        className={page === id ? 'active' : ''}
                        aria-current={page === id ? 'page' : undefined}
                      >
                        {titles[id]}
                      </a>
                    ))}
                  </nav>
                )}
                {(isExplorer || page === 'aa') && (
                  <div className="utility-tools">
                    {isExplorer && <CurrencySelector />}
                    <label className="search-box">
                      <Search size={15} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索模型、套餐或 Harness"
                        aria-label="搜索模型、套餐或 Harness"
                      />
                      {search && (
                        <button onClick={() => setSearch('')} aria-label="清除搜索">
                          <X size={13} />
                        </button>
                      )}
                    </label>
                  </div>
                )}
              </div>
            )}
            <PageBoundary page={page} title={titles[page]}>
              {page === 'overview' && (
                <Home
                  filters={filters}
                  updateFilters={updateFilters}
                  data={data}
                  loading={loading}
                  error={error}
                  search={search}
                  go={go}
                  refresh={refreshExplore}
                />
              )}
              {isExplorer && page !== 'overview' && (
                <Explorer
                  filters={filters}
                  updateFilters={updateFilters}
                  page={page}
                  data={data}
                  loading={loading}
                  error={error}
                  search={search}
                  source={source}
                  go={go}
                  refresh={refreshExplore}
                  toast={setToast}
                />
              )}
              {(page === 'contribute' || page === 'workspace') && (
                <Contribution
                  projectSource={projectSource}
                  mode={page}
                  ownerKey={ownerKey}
                  setOwnerKey={setOwnerKey}
                  go={go}
                  toast={setToast}
                />
              )}
              {(page === 'feedback' || page === 'vbti-result') && (
                <Feedback
                  ownerKey={ownerKey}
                  setOwnerKey={setOwnerKey}
                  target={feedbackTarget}
                  vbti={page === 'vbti-result'}
                />
              )}
              {(page === 'vbti' || page === 'vbti-test') && (
                <VBTI source={projectSource} test={page === 'vbti-test'} />
              )}
              {page === 'method' && <Methods />}
              {page === 'connect' && <Connections toast={setToast} />}
              {page === 'aa' && <AAReference search={search} />}
            </PageBoundary>
          </main>
          {!isVbti && (
            <footer className="footer">
              <span>
                <Brand small />
              </span>
              <div>
                <a href="#method">计算方法</a>
                <a href="#connect">工具接入</a>
                <a href="#contribute">加入收集计划</a>
              </div>
            </footer>
          )}
        </div>
        {toast && (
          <div className="toast" role="status">
            <ShieldCheck size={18} />
            {toast}
          </div>
        )}
      </div>
    </GithubAccountProvider>
  );
}
