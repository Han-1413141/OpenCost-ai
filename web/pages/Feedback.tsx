import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { GithubAccountPanel, useGithubAccount } from '../GithubAccount';
import { DeferredFeedbackPanel, DeferredPersonaPanel } from '../../shared/DeferredPanels';
import '../../shared/feedback.css';
import { getLocale } from '../i18n/locale';
import { PersonalFeedbackSchema, type PersonalFeedback } from '../../shared/personal-feedback';
import { feedbackLink, type FeedbackTarget } from '../../shared/feedback-link';
import {
  WorkspacePageSchema,
  feedbackKindLabels,
  type WorkspaceEntry,
} from '../../shared/workspace-feedback';

type Selected = FeedbackTarget & { source?: string };
const entryId = (entry: Selected) => `${entry.kind}:${entry.recordId}:${entry.source ?? ''}`;
export function Feedback({
  ownerKey,
  setOwnerKey,
  target,
  vbti = false,
}: {
  ownerKey: string;
  setOwnerKey: (key: string) => void;
  target: FeedbackTarget | null;
  vbti?: boolean;
}) {
  const account = useGithubAccount(),
    input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<{
    owner: string;
    entries: WorkspaceEntry[];
    cursor: string | null;
  }>({ owner: '', entries: [], cursor: null });
  const [selection, setSelection] = useState<{ owner: string; vbti: boolean; entry: Selected | null }>(
    { owner: ownerKey, vbti, entry: vbti && target?.kind === 'subscription' ? null : target },
  );
  const selected = selection.owner === ownerKey && selection.vbti === vbti ? selection.entry : null;
  const setSelected = (entry: Selected | null) => setSelection({ owner: ownerKey, vbti, entry });
  const [report, setReport] = useState<{
    owner: string;
    id: string;
    value: PersonalFeedback;
  } | null>(null);
  const [error, setError] = useState(''),
    [reportError, setReportError] = useState('');
  const [loading, setLoading] = useState(false),
    [reading, setReading] = useState(false),
    [more, setMore] = useState(false);
  const [refresh, setRefresh] = useState(0),
    [readVersion, setReadVersion] = useState(0),
    [copied, setCopied] = useState(false);
  const currentOwner = useRef(ownerKey);
  const [related, setRelated] = useState<{
    owner: string;
    quota: PersonalFeedback['quota'];
  } | null>(null);
  const latestQuota =
    page.owner === ownerKey ? page.entries.find((e) => e.kind === 'subscription') : undefined;
  useEffect(() => {
    setRelated(null);
    if (vbti || !ownerKey || !latestQuota || selected?.kind === 'subscription') return;
    const controller = new AbortController();
    const query = new URLSearchParams({ kind: 'subscription', recordId: latestQuota.recordId });
    if (latestQuota.source) query.set('source', latestQuota.source);
    void api<{ feedback: unknown }>(`/api/workspace/feedback?${query}`, {
      headers: { Authorization: `Bearer ${ownerKey}` },
      signal: controller.signal,
    })
      .then((body) => {
        const feedback = PersonalFeedbackSchema.parse(body.feedback);
        if (
          !controller.signal.aborted &&
          feedback.kind === 'subscription' &&
          feedback.recordId === latestQuota.recordId
        )
          setRelated({ owner: ownerKey, quota: feedback.quota });
      })
      .catch(() => {
        /* The current report stays usable if the optional related record is unavailable. */
      });
    return () => controller.abort();
  }, [ownerKey, latestQuota?.recordId, latestQuota?.source, selected?.kind, vbti]);
  currentOwner.current = ownerKey;
  useEffect(() => {
    setSelected(vbti && target?.kind === 'subscription' ? null : target);
    setReport(null);
    setReportError('');
    setCopied(false);
  }, [ownerKey, target, vbti]);
  useEffect(() => {
    setPage({ owner: ownerKey, entries: [], cursor: null });
    setError('');
    if (!ownerKey) return;
    const controller = new AbortController();
    setLoading(true);
    void api<unknown>('/api/workspace/records?limit=20', {
      headers: { Authorization: `Bearer ${ownerKey}` },
      signal: controller.signal,
    })
      .then((body) => {
        if (controller.signal.aborted) return;
        const result = WorkspacePageSchema.parse(body);
        setPage({ owner: ownerKey, entries: result.entries, cursor: result.nextCursor });
        setSelection((current) => ({
          owner: ownerKey, vbti,
          entry: (current.owner === ownerKey && current.vbti === vbti ? current.entry : null) ??
            (vbti ? result.entries.find((e) => e.kind !== 'subscription') : result.entries[0]) ?? null,
        }));
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ownerKey, refresh, vbti]);
  useEffect(() => {
    setReport(null);
    setReportError('');
    setReading(false);
    if (!ownerKey || !selected) return;
    const controller = new AbortController(),
      id = entryId(selected);
    setReading(true);
    const query = new URLSearchParams({ kind: selected.kind, recordId: selected.recordId });
    if (selected.source) query.set('source', selected.source);
    void api<{ feedback: unknown; persisted: boolean }>(`/api/workspace/feedback?${query}`, {
      headers: { Authorization: `Bearer ${ownerKey}` },
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        const value = PersonalFeedbackSchema.parse(result.feedback);
        if (value.recordId !== selected.recordId || value.kind !== selected.kind)
          throw new Error('反馈与所选记录不一致，请刷新列表。');
        setReport({
          owner: ownerKey,
          id,
          value: result.persisted ? value : { ...value, provisional: true },
        });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setReportError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReading(false);
      });
    return () => controller.abort();
  }, [ownerKey, selected, readVersion, vbti]);
  const importAccess = async (file: File) => {
    setError('');
    try {
      if (file.size > 50000) throw new Error('凭证文件过大。');
      const value = JSON.parse(await file.text());
      if (
        value.format !== 'opencost-access-1' ||
        value.origin !== location.origin ||
        typeof value.accessKey !== 'string' ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(value.accessKey)
      )
        throw new Error('请选择当前站点的 OpenCost-AI 访问凭证。');
      setOwnerKey(value.accessKey);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const loadMore = async () => {
    if (more || !page.cursor || page.owner !== ownerKey) return;
    const actor = ownerKey;
    setMore(true);
    try {
      const result = WorkspacePageSchema.parse(
        await api(`/api/workspace/records?limit=20&cursor=${encodeURIComponent(page.cursor)}`, {
          headers: { Authorization: `Bearer ${actor}` },
        }),
      );
      if (currentOwner.current === actor)
        setPage((current) => ({
          owner: actor,
          entries: [...current.entries, ...result.entries],
          cursor: result.nextCursor,
        }));
    } catch (cause) {
      if (currentOwner.current === actor) setError((cause as Error).message);
    } finally {
      setMore(false);
    }
  };
  const copyLink = async () => {
    setError('');
    const actor = ownerKey;
    try {
      const key = actor.startsWith('github-session:')
        ? (await api<{ accessKey: string }>('/api/auth/access', { method: 'POST', body: '{}' }))
            .accessKey
        : actor;
      if (currentOwner.current !== actor) return;
      // Account links open the full account list; an alias record stays accessible through the signed-in account.
      const targetForLink = actor.startsWith('github-session:')
        ? undefined
        : (selected ?? undefined);
      await navigator.clipboard.writeText(
        feedbackLink(location.origin, key, targetForLink, vbti ? 'vbti' : 'feedback'),
      );
      setCopied(true);
    } catch {
      setError('私人链接未复制，请使用原访问凭证查看。');
    }
  };
  const entries =
    page.owner === ownerKey ? page.entries.filter((e) => !vbti || e.kind !== 'subscription') : [];
  const visibleReport =
    report?.owner === ownerKey && selected && report.id === entryId(selected) ? report.value : null;
  return (
    <div className="feedback-workspace">
      <div className="feedback-toolbar">
        <div className="feedback-toolbar-title">
          <a className="feedback-back" href="/#workspace">
            <ArrowLeft size={15} />
            我的记录
          </a>
          <h1>{vbti ? 'VBTI 类型结果' : '个人反馈'}</h1>
        </div>
        <div className="feedback-toolbar-actions">
          <a className="button secondary" href={vbti ? '/#feedback' : '/vbti/result/'}>
            {vbti ? '查看费用与套餐反馈' : 'VBTI 类型结果'}
          </a>
          <button className="button secondary" onClick={() => input.current?.click()}>
            <KeyRound size={14} />
            导入凭证
          </button>
          {!!ownerKey && (
            <details className="feedback-account-settings">
              <summary>账号与凭证</summary>
              <GithubAccountPanel />
            </details>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importAccess(file);
          event.target.value = '';
        }}
      />
      {!ownerKey && <GithubAccountPanel />}
      {!ownerKey && (
        <section className="panel feedback-empty">
          <h2>从一份上传回执开始</h2>
          <p>
            打开上传成功后的私人反馈链接，即可直接查看；也可以导入 access.json，或使用已关联的
            GitHub 账号登录。
          </p>
          <ol>
            <li>上传成功后保留回执</li>
            <li>点击回执中的“查看反馈”</li>
            <li>查看本次工作、用量与可比较结果</li>
          </ol>
          <p>数据不足时会显示“稍后再看”，已保存的摘要不需要重复上传。</p>
        </section>
      )}
      {error && (
        <p className="notice orange" role="alert">
          {error}
        </p>
      )}
      {!!ownerKey && (
        <div className="feedback-layout">
          <aside className="panel feedback-history">
            <div className="feedback-history-heading">
              <h2>全部上传</h2>
              <button
                className="button secondary"
                disabled={loading}
                onClick={() => setRefresh((n) => n + 1)}
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </div>
            <p>按上传时间排列</p>
            {loading && <p role="status">正在读取上传记录…</p>}
            {!loading && !entries.length && (
              <div className="feedback-empty">
                <h3>{vbti && latestQuota ? '订阅记录已保存，还需要工作摘要' : '还没有找到上传记录'}</h3>
                <p>
                  {vbti && latestQuota
                    ? '额度和余额不能用于判断工作类型。上传脱敏工作摘要后，这里会展示 VBTI 角色与六维图。'
                    : '若刚刚上传，请稍后刷新；也可核对站点与上传凭证。'}
                </p>
                {vbti && latestQuota && <a href="/#feedback">查看已上传的订阅额度反馈</a>}
                <a href={vbti ? '/vbti/test/' : '/#contribute'}>查看上传方法</a>
              </div>
            )}
            {entries.map((entry) => (
              <button
                key={entryId(entry)}
                className={`feedback-record ${selected && selected.recordId === entry.recordId && selected.kind === entry.kind && (!selected.source || selected.source === entry.source) ? 'active' : ''}`}
                onClick={() => {
                  setSelected(entry);
                  setCopied(false);
                }}
              >
                <span>{feedbackKindLabels[entry.kind]}</span>
                <strong>{new Date(entry.receivedAt).toLocaleString(getLocale())}</strong>
                <small>记录 {entry.recordId.slice(0, 8)}</small>
              </button>
            ))}
            {page.cursor && (
              <button className="button secondary" disabled={more} onClick={() => void loadMore()}>
                {more ? '正在读取…' : '加载更多'}
              </button>
            )}
          </aside>
          <section className="feedback-detail">
            <div className="feedback-detail-actions">
              <span>本次上传的反馈</span>
              <button
                className="button secondary"
                disabled={!ownerKey || account?.linkBusy}
                onClick={() => void copyLink()}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}{' '}
                {copied ? '已复制' : '复制私人链接'}
              </button>
            </div>
            <details className="feedback-link-note">
              <summary>链接与隐私</summary>
              <small>
                私人链接含此身份的访问凭证，持有者可访问相应记录。打开后，凭证立即从地址栏移除；请只在自己的设备保存。
              </small>
              <small>
                关联统一访问入口，保留各份报告原来的上传身份与生成时点，不合并费用或重写历史比较。
              </small>
            </details>
            {reading && (
              <section className="panel" role="status">
                正在生成或读取这份反馈…
              </section>
            )}
            {reportError && (
              <section className="panel feedback-empty">
                <h2>反馈暂时未取得，稍后再看</h2>
                <p>{reportError}</p>
                <p>已经保存的摘要无需重复上传。</p>
                <button className="button secondary" onClick={() => setReadVersion((n) => n + 1)}>
                  再次读取反馈
                </button>
              </section>
            )}
            {visibleReport && (
              <>
                {vbti ? (
                  <DeferredPersonaPanel report={visibleReport} />
                ) : (
                  <DeferredFeedbackPanel
                    report={visibleReport}
                    relatedQuota={related?.owner === ownerKey ? related.quota : undefined}
                  />
                )}
                <button
                  className="button secondary"
                  disabled={reading}
                  onClick={() => setReadVersion((n) => n + 1)}
                >
                  再次读取这份反馈
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
