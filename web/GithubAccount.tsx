import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, LogOut } from 'lucide-react';
import { api, download } from './api';
import { authReturnTo } from '../shared/auth-navigation';
import { getLocale } from './i18n/locale';

type Session = {
  githubEnabled: boolean;
  linkedCredentials?: number;
  user: { provider: 'github'; login: string; expiresAt: string } | null;
};
type Account = Session & {
  loading: boolean;
  error: string;
  ownerKey: string;
  linkMessage: string;
  linkBusy: boolean;
  useAccount: () => void;
  logout: () => Promise<void>;
};
const Context = createContext<Account | null>(null);
export const useGithubAccount = () => useContext(Context);
function Github({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
export const githubIdentity = (login: string) => `github-session:${login}`;

export function GithubAccountProvider({
  children,
  ownerKey,
  setOwnerKey,
  connectToken,
}: {
  children: ReactNode;
  ownerKey: string;
  setOwnerKey: (key: string) => void;
  connectToken?: string;
}) {
  const [session, setSession] = useState<Session>({ githubEnabled: false, user: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [linkMessage, setLinkMessage] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const attempted = useRef(new Set<string>());
  const acceptedConnections = useRef(new Set<string>());
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  useEffect(() => {
    const controller = new AbortController();
    let running = false,
      lastRead = 0;
    const refresh = () => {
      if (running || Date.now() - lastRead < 3000) return;
      running = true;
      void api<Session>('/api/auth/session', { signal: controller.signal })
        .then((value) => {
          if (controller.signal.aborted) return;
          setSession(value);
          setError('');
          if (value.user && !currentOwner.current) setOwnerKey(githubIdentity(value.user.login));
          else if (!value.user && currentOwner.current.startsWith('github-session:'))
            setOwnerKey('');
        })
        .catch(() => {
          if (!controller.signal.aborted) setError('登录状态暂未取得，请刷新页面重试。');
        })
        .finally(() => {
          running = false;
          lastRead = Date.now();
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [setOwnerKey]);
  useEffect(() => {
    if (loading || !session.githubEnabled || !connectToken || acceptedConnections.current.has(connectToken)) return;
    acceptedConnections.current.add(connectToken);
    setLinkBusy(true);
    setLinkMessage('正在关联这台电脑的上传身份…');
    let disposed = false;
    void api<{ linked: boolean; pending: boolean }>('/api/auth/connect/accept', {
      method: 'POST', body: JSON.stringify({ token: connectToken }),
    }).then(async result => {
      if (disposed) return;
      if (result.linked) {
        const value = await api<Session>('/api/auth/session');
        if (disposed) return;
        setSession(value);
        if (value.user) setOwnerKey(githubIdentity(value.user.login));
        setLinkMessage('本机上传身份已关联，已有和后续上传的摘要、额度记录及反馈会汇总到这个账号。');
      } else setLinkMessage('本机身份已准备好。请在 10 分钟内使用 GitHub 登录，完成账号关联。');
    }).catch(cause => { if (!disposed) setLinkMessage((cause as Error).message); })
      .finally(() => { if (!disposed) setLinkBusy(false); });
    return () => { disposed = true; };
  }, [connectToken, loading, session.githubEnabled, setOwnerKey]);
  useEffect(() => {
    const attemptKey = `${ownerKey}:${session.user?.login ?? 'anonymous'}`;
    if (
      loading ||
      !session.githubEnabled ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(ownerKey) ||
      attempted.current.has(attemptKey)
    )
      return;
    attempted.current.add(attemptKey);
    const controller = new AbortController();
    setLinkBusy(true);
    setLinkMessage('正在验证凭证与账号关联…');
    void api<{ linked: boolean; pending: boolean }>('/api/auth/link', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerKey}` },
      body: '{}',
      signal: controller.signal,
    })
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (result.linked) {
          const value = await api<Session>('/api/auth/session', { signal: controller.signal });
          if (controller.signal.aborted) return;
          setSession(value);
          setLinkMessage('已自动关联。今后使用这个 GitHub 账号可查看旧凭证的上传与反馈。');
          if (value.user) setOwnerKey(githubIdentity(value.user.login));
        } else
          setLinkMessage(
            '已载入凭证，可立即查看反馈。10 分钟内完成 GitHub 登录，将自动关联这份凭证。',
          );
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setLinkMessage((cause as Error).message + ' 当前仍可使用原凭证查看反馈。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLinkBusy(false);
      });
    return () => {
      controller.abort();
      setLinkBusy(false);
    };
  }, [ownerKey, loading, session.githubEnabled, session.user?.login, setOwnerKey]);
  const useAccount = () => {
    if (session.user) setOwnerKey(githubIdentity(session.user.login));
  };
  const logout = async () => {
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
      setSession((previous) => ({ ...previous, user: null }));
      // Also release any currently imported private credential and in-memory details.
      setOwnerKey('');
      setLinkMessage('');
      attempted.current.clear();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Context.Provider
      value={{ ...session, loading, error, ownerKey, linkMessage, linkBusy, useAccount, logout }}
    >
      {children}
    </Context.Provider>
  );
}

export function GithubLoginButton({
  header = false,
  vbti = false,
}: {
  header?: boolean;
  vbti?: boolean;
}) {
  const account = useContext(Context);
  if (!account) return null;
  const path = typeof location === 'undefined' ? '' : location.pathname;
  const vbtiContext = vbti || path.startsWith('/vbti/');
  const returnTo = vbtiContext
    ? authReturnTo(`${path.startsWith('/vbti/') ? path : '/vbti/result/'}?lang=${getLocale()}`)
    : null;
  const recordsHref = vbtiContext ? '/vbti/result/' : header ? '#feedback' : '#workspace';
  if (account.loading && !header)
    return (
      <button className="button secondary" disabled aria-busy="true">
        正在读取账号…
      </button>
    );
  if (account.user)
    return (
      <a
        className={header ? 'account-link github-login' : 'button secondary'}
        href={recordsHref}
        aria-label={header ? '个人反馈' : '查看 GitHub 账号记录'}
        onClick={account.useAccount}
      >
        <Github size={16} />
        <span>
          {header
            ? account.user.login
            : vbtiContext
              ? '已登录 · 查看我的类型'
              : '查看 GitHub 账号记录'}
        </span>
      </a>
    );
  return (
    <a
      className={header ? 'account-link github-login' : 'button github-login-button'}
      href={
        header
          ? recordsHref
          : account.githubEnabled
            ? '/api/auth/github/start' +
              (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '')
            : vbtiContext
              ? '/vbti/result/'
              : '#workspace'
      }
      aria-label={header ? '个人反馈' : 'GitHub 登录'}
      aria-busy={account.loading}
    >
      <Github size={16} />
      <span>{header ? '个人反馈' : '使用 GitHub 登录'}</span>
    </a>
  );
}

export function GithubAccountPanel() {
  const account = useContext(Context);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [links, setLinks] = useState<{ id: string; created: number }[] | null>(null);
  const [loginMessage] = useState(() => {
    const query = new URLSearchParams(location.search);
    const result = query.get('login');
    const linked = query.get('link');
    if (!result) return '';
    query.delete('login');
    query.delete('link');
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`,
    );
    return linked === 'success'
      ? 'GitHub 登录成功，旧凭证已自动关联，可查看全部上传与反馈。'
      : linked === 'conflict'
        ? 'GitHub 已登录，但凭证已关联其他账号或关联数量已满；请使用原凭证查看。'
        : ((
            {
              success: 'GitHub 登录成功。',
              cancelled: '已取消 GitHub 授权。',
              expired: '登录请求已过期，请重新登录。',
              failed: 'GitHub 登录未完成，请重试。',
              unconfigured: 'GitHub 登录正在配置，暂时可导入访问凭证查看记录。',
            } as Record<string, string>
          )[result] ?? '');
  });
  if (!account) return null;
  const exportCredential = async () => {
    setExporting(true);
    setError('');
    try {
      const access = await api('/api/auth/access', { method: 'POST', body: '{}' });
      download('OpenCost-AI-access.json', access);
      setExportReady(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="panel github-account-panel" aria-label="GitHub 账号">
      <div className="github-account-intro">
        <Github size={26} />
        <div>
          <h2>{account.user ? `已登录 · ${account.user.login}` : '用 GitHub 连接个人记录'}</h2>
          <p>
            {account.user
              ? '登录后，跨设备查看上传记录和个人反馈。'
              : '使用 GitHub 公开身份登录，无需仓库或邮箱权限。公开统计不展示账号身份。'}
          </p>
        </div>
      </div>
      {account.user ? (
        <div className="github-account-actions">
          {account.ownerKey !== githubIdentity(account.user.login) && <GithubLoginButton />}
          <button className="button secondary" onClick={() => setExportReady((v) => !v)}>
            <Download size={15} />
            连接本地 Harness
          </button>
          <button
            className="button secondary"
            disabled={account.loading}
            onClick={() => void account.logout()}
          >
            <LogOut size={15} />
            退出登录
          </button>
        </div>
      ) : (
        <GithubLoginButton />
      )}
      {!account.loading && !account.githubEnabled && (
        <p className="muted">管理员正在配置 GitHub 登录；现有访问凭证可以继续使用。</p>
      )}
      <p className="github-account-note">
        打开私人反馈链接或导入凭证后，会验证并关联到当前登录的 GitHub
        账号。原始记录和原凭证继续有效，关联不会改变公开范围。
      </p>
      {account.user && (
        <p>
          已关联 {account.linkedCredentials ?? 0} 个旧凭证。
          <a href="#feedback">查看全部上传与反馈</a>
        </p>
      )}
      {(account.linkMessage || account.linkBusy) && <p role="status">{account.linkMessage}</p>}
      {account.user && (
        <div>
          <button
            className="button secondary"
            onClick={() => {
              void api<{ links: { id: string; created: number }[] }>('/api/auth/links')
                .then((r) => setLinks(r.links))
                .catch(() => setError('关联列表暂未取得，请稍后再看。'));
            }}
          >
            管理已关联凭证
          </button>
          {links?.map((link, index) => (
            <p key={link.id}>
              凭证 {index + 1} · {new Date(link.created).toLocaleDateString('zh-CN')}{' '}
              <button
                className="button secondary"
                onClick={() => {
                  void api('/api/auth/unlink', {
                    method: 'POST',
                    body: JSON.stringify({ id: link.id }),
                  })
                    .then(() => {
                      setLinks((current) => current?.filter((row) => row.id !== link.id) ?? null);
                      account.useAccount();
                      location.reload();
                    })
                    .catch(() => setError('解除关联未完成，请重试。'));
                }}
              >
                解除关联
              </button>
            </p>
          ))}
        </div>
      )}
      {exportReady && account.user && (
        <div className="github-export-note">
          <p>
            凭证用于本地 Harness 读取和上传账号记录，请妥善保管。退出登录后，已导出的凭证仍有效。
          </p>
          <button className="button" disabled={exporting} onClick={() => void exportCredential()}>
            {exporting ? '正在生成…' : '下载本账号的访问凭证'}
          </button>
        </div>
      )}
      {(error || account.error || loginMessage) && (
        <p role="status">{error || account.error || loginMessage}</p>
      )}
    </section>
  );
}
