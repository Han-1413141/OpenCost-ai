import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileJson,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { labels } from '../../shared/schema';
import type { ContributionDetail, ContributionIndexEntry } from '../../shared/contribution-history';
import type { SourceManifest } from '../../shared/source';
import { api, download, money } from '../api';
import { GithubAccountPanel } from '../GithubAccount';
import { Button, Empty, Notice, SectionTitle, Tag } from '../components';
import type { Page } from '../App';
import { PersonalFeedbackSchema, type PersonalFeedback } from '../../shared/personal-feedback';
import { DeferredFeedbackPanel, QuotaReplayEntry } from '../../shared/DeferredPanels';
import {
  PrivateRecordDetails,
  mergePrivateIndex,
  parsePrivateIndex,
  summarizePrivateIndex,
} from '../private-records';

function UploadedFeedback({ recordId, ownerKey }: { recordId: string; ownerKey: string }) {
  const [result, setResult] = useState<PersonalFeedback | null>(null),
    [error, setError] = useState(''),
    [requestNumber, setRequestNumber] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError('');
    setLoading(true);
    void api<{ feedback: unknown }>(
      `/api/feedback?kind=contribution&recordId=${encodeURIComponent(recordId)}`,
      {
        headers: { Authorization: `Bearer ${ownerKey}` },
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          const parsed = PersonalFeedbackSchema.parse(data.feedback);
          if (parsed.recordId !== recordId || parsed.kind !== 'contribution')
            throw new Error('反馈不属于这份记录');
          setResult(parsed);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [recordId, ownerKey, requestNumber]);
  return (
    <>
      {result ? (
        <DeferredFeedbackPanel report={result} />
      ) : (
        <p role="status">
          {error ? `记录已保存，反馈暂未取得：${error}` : '正在读取上传后的个人反馈…'}
        </p>
      )}
      {(result?.provisional || error) && (
        <Button disabled={loading} onClick={() => setRequestNumber((n) => n + 1)}>
          <RefreshCw size={14} /> 再次读取这份反馈
        </Button>
      )}
    </>
  );
}

type Props = {
  projectSource: SourceManifest | null;
  mode: 'workspace' | 'contribute';
  ownerKey: string;
  setOwnerKey: (key: string) => void;
  go: (page: Page) => void;
  toast: (message: string) => void;
};

export function Contribution(props: Props) {
  return props.mode === 'contribute' ? (
    <ContributionGuide toast={props.toast} source={props.projectSource} />
  ) : (
    <Workspace {...props} />
  );
}

function ContributionGuide({
  toast,
  source,
}: {
  toast: (message: string) => void;
  source: SourceManifest | null;
}) {
  const [copied, setCopied] = useState(false);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const skillLink =
    source?.repository && source.revision
      ? `${source.repository}/blob/${source.revision}/skills/opencost-contribute/SKILL.md`
      : '待补充';
  const prompt = `请读取下面 GitHub 链接中的 Skill，按其中的步骤整理工作记录、脱敏、校验并上传至 OpenCost。上传前向我确认内容和公开范围，完成后保存回执。

GitHub 链接：${skillLink}`;
  useEffect(() => {
    const field = promptField.current;
    if (!field) return;
    const resize = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + 2}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [prompt]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2400);
      toast('提示词已复制');
    } catch {
      promptField.current?.focus();
      promptField.current?.select();
      toast('请复制已选中的提示词');
    }
  };
  return (
    <div className="submission-page">
      <header className="page-heading">
        <div>
          <h1>脱敏工作摘要收集计划</h1>
        </div>
        <a href="#workspace" className="submission-history-link">
          查看我的记录 <ArrowUpRight size={15} />
        </a>
      </header>
      <section className="contribution-copy">
        <div className="contribution-copy-toolbar">
          <p>复制提示词，发送给你正在使用的 AI。</p>
          <Button onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? '已复制' : '复制提示词'}
          </Button>
        </div>
        <textarea
          ref={promptField}
          className="contribution-prompt"
          aria-label="加入计划提示词"
          readOnly
          spellCheck={false}
          value={prompt}
          rows={4}
        />
      </section>
    </div>
  );
}

function Workspace({ ownerKey, setOwnerKey, go, toast }: Props) {
  const [owned, setOwned] = useState<{
    key: string;
    rows: ContributionIndexEntry[];
    nextCursor: string | null;
    revision?: number;
  }>({ key: '', rows: [], nextCursor: null });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const identity = useRef(ownerKey);
  const fileVersion = useRef(0);
  const mounted = useRef(true);
  const seenCursors = useRef(new Set<string>());
  const [details] = useState(() => new PrivateRecordDetails());
  const [detail, setDetail] = useState<{
    owner: string;
    id: string;
    digest: string;
    value: ContributionDetail | null;
    error: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadRequest = useRef<{ owner: string; id: string; controller: AbortController } | null>(
    null,
  );
  identity.current = ownerKey;
  const records = owned.key === ownerKey ? owned.rows : [];
  const selectedRecord = records.find((record) => record.id === selected);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      fileVersion.current++;
      request.current?.abort();
      downloadRequest.current?.controller.abort();
      details.reset();
    };
  }, [details]);
  useEffect(() => {
    request.current?.abort();
    details.reset(ownerKey);
    downloadRequest.current?.controller.abort();
    downloadRequest.current = null;
    setDownloading(null);
    seenCursors.current = new Set();
    setOwned({ key: ownerKey, rows: [], nextCursor: null });
    setSelected(null);
    setDetail(null);
    setError('');
    setLoading(false);
    setLoadingMore(false);
    if (!ownerKey) return;
    const controller = new AbortController();
    request.current = controller;
    const access = ownerKey;
    setLoading(true);
    void api<unknown>('/api/contributions/index?limit=25', {
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((body) => {
        if (!controller.signal.aborted && identity.current === access) {
          const result = parsePrivateIndex(body);
          setOwned({
            key: access,
            rows: result.records,
            nextCursor: result.nextCursor,
            revision: result.revision,
          });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted && identity.current === access)
          setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted && identity.current === access) setLoading(false);
        if (request.current === controller) request.current = null;
      });
    return () => request.current?.abort();
  }, [ownerKey, refresh, details]);
  useEffect(() => {
    if (!selectedRecord || !ownerKey) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    const entry = selectedRecord;
    const access = ownerKey;
    setDetail({ owner: access, id: entry.id, digest: entry.digest, value: null, error: '' });
    void details
      .consume(
        access,
        entry,
        (value) => {
          if (!controller.signal.aborted && mounted.current && identity.current === access)
            setDetail({ owner: access, id: entry.id, digest: entry.digest, value, error: '' });
        },
        controller.signal,
      )
      .catch((cause) => {
        if (!controller.signal.aborted && mounted.current && identity.current === access)
          setDetail({
            owner: access,
            id: entry.id,
            digest: entry.digest,
            value: null,
            error: (cause as Error).message,
          });
      });
    return () => controller.abort();
  }, [selectedRecord, ownerKey, details]);
  const loadMore = async () => {
    const cursor = owned.key === ownerKey ? owned.nextCursor : null;
    if (!ownerKey || !cursor || loading || loadingMore || request.current) return;
    const access = ownerKey;
    const controller = new AbortController();
    request.current = controller;
    setLoadingMore(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '25', cursor });
      const body = await api<unknown>(`/api/contributions/index?${query}`, {
        headers: { Authorization: `Bearer ${access}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!controller.signal.aborted && identity.current === access) {
        const result = parsePrivateIndex(body, cursor, seenCursors.current, owned.revision);
        const combined = mergePrivateIndex(owned.rows, result.records);
        seenCursors.current.add(cursor);
        setOwned((previous) => {
          if (previous.key !== access || previous.nextCursor !== cursor) return previous;
          return {
            key: access,
            rows: combined,
            nextCursor: result.nextCursor,
            revision: result.revision,
          };
        });
      }
    } catch (cause) {
      if (!controller.signal.aborted && identity.current === access)
        setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted && identity.current === access) setLoadingMore(false);
      if (request.current === controller) request.current = null;
    }
  };
  const downloadRecord = async (entry: ContributionIndexEntry) => {
    if (!ownerKey || downloadRequest.current) return;
    const action = { owner: ownerKey, id: entry.id, controller: new AbortController() };
    downloadRequest.current = action;
    setDownloading(entry.id);
    setError('');
    try {
      await details.consume(
        action.owner,
        entry,
        (value) => {
          if (
            mounted.current &&
            identity.current === action.owner &&
            downloadRequest.current === action
          )
            download(`OpenCost-record-${entry.id}.json`, value.record.envelope);
        },
        action.controller.signal,
      );
    } catch (cause) {
      if (!action.controller.signal.aborted && mounted.current && identity.current === action.owner)
        setError((cause as Error).message);
    } finally {
      if (downloadRequest.current === action) {
        downloadRequest.current = null;
        if (mounted.current) setDownloading(null);
      }
    }
  };
  const importCredential = async (file: File) => {
    const version = ++fileVersion.current;
    try {
      if (file.size > 50000) throw new Error('凭证文件过大');
      const credential = JSON.parse(await file.text());
      if (!mounted.current || fileVersion.current !== version) return;
      if (
        !credential ||
        typeof credential !== 'object' ||
        credential.format !== 'opencost-access-1' ||
        typeof credential.accessKey !== 'string' ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(credential.accessKey)
      ) {
        throw new Error('不是有效的 OpenCost 访问凭证');
      }
      if (credential.origin !== location.origin)
        throw new Error('此凭证属于其他站点，请在签发凭证的 OpenCost 站点导入。');
      request.current?.abort();
      identity.current = credential.accessKey;
      details.reset();
      downloadRequest.current?.controller.abort();
      downloadRequest.current = null;
      setDownloading(null);
      setDetail(null);
      setSelected(null);
      setOwned({ key: '', rows: [], nextCursor: null });
      setError('');
      setOwnerKey(credential.accessKey);
      setRefresh((value) => value + 1);
      toast('已载入访问凭证，正在读取当前站点的记录。');
    } catch (cause) {
      if (mounted.current && fileVersion.current === version) setError((cause as Error).message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>我的记录</h1>
        </div>
        <Button secondary onClick={() => input.current?.click()}>
          <KeyRound size={16} /> 导入访问凭证
        </Button>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        hidden
        ref={input}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importCredential(file);
          event.target.value = '';
        }}
      />
      <GithubAccountPanel />
      <section className="panel feedback-entry">
        <div><h2>上传后的个人反馈</h2><p>统一查看工作与费用、每日工作摘要、订阅额度的反馈。已关联的旧凭证也会出现在同一列表。</p></div>
        <a href="#feedback" className="button">查看个人反馈</a>
      </section>
      {error && <Notice tone="orange">{error}</Notice>}
      <section className="panel owned-panel">
        <SectionTitle
          title="已提交记录"
          action={
            <Button
              secondary
              disabled={!ownerKey || loading || loadingMore}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw size={14} /> {loading ? '正在读取…' : '刷新记录'}
            </Button>
          }
        />
        {loading ? (
          <p role="status">正在读取记录…</p>
        ) : records.length ? (
          <div className="owned-records">
            {records.map((record) => {
              const summary = record.summary;
              const current =
                detail?.owner === ownerKey &&
                detail.id === record.id &&
                detail.digest === record.digest
                  ? detail
                  : null;
              return (
                <div className="owned-readonly" key={record.id}>
                  <div className="owned-record">
                    <span className="document-icon">
                      <FileJson size={20} />
                    </span>
                    <div>
                      <strong>
                        {summary
                          ? `${summary.month} · ${summary.taskCount} 项任务`
                          : '这条记录的摘要暂不可读取'}
                      </strong>
                      <Tag tone={record.status === 'quarantined' ? 'orange' : 'neutral'}>
                        {record.status === 'quarantined' ? '待核查' : '已保存'}
                      </Tag>
                      {record.settlement && (
                        <Tag
                          tone={
                            ['conflict', 'unknown'].includes(record.settlement.state)
                              ? 'orange'
                              : 'neutral'
                          }
                        >
                          修订 {record.settlement.revision} ·{' '}
                          {
                            {
                              active: '当前版本',
                              superseded: '已被替代',
                              conflict: '关系冲突',
                              unknown: '关系待确认',
                            }[record.settlement.state]
                          }
                        </Tag>
                      )}
                      <span>
                        {summary
                          ? `${summary.currency} · ${labels.billing[summary.billing]} · ${summary.statistics ? '同意参与统计' : '仅个人分析'}`
                          : '可尝试查看或下载原记录，当前摘要未计入月度统计。'}
                      </span>
                    </div>
                    <strong>{summary ? money(summary.netMinor, summary.currency) : '—'}</strong>
                    <Button
                      secondary
                      onClick={() => setSelected(selected === record.id ? null : record.id)}
                    >
                      {selected === record.id ? '收起' : '查看'}
                    </Button>
                    <button
                      className="icon-button"
                      aria-label={downloading === record.id ? '正在准备该记录的下载' : '下载该记录'}
                      disabled={downloading !== null}
                      onClick={() => void downloadRecord(record)}
                    >
                      <Download size={18} />
                    </button>
                  </div>
                  {selected === record.id && (
                    <div className="record-readonly-detail">
                      <UploadedFeedback recordId={record.id} ownerKey={ownerKey} />
                      {current?.value ? (
                        <>
                          <div>
                            <Tag>
                              {current.value.record.evidence.cost === 'C2'
                                ? '费用已核验'
                                : '费用待核验'}
                            </Tag>
                            <Tag>
                              {current.value.record.evidence.work === 'W2'
                                ? '验收已核验'
                                : '验收待核验'}
                            </Tag>
                          </div>
                          <pre>{JSON.stringify(current.value.record.envelope, null, 2)}</pre>
                          <Button
                            secondary
                            onClick={() =>
                              download(`OpenCost-revision-basis-${record.id}.json`, current.value)
                            }
                          >
                            下载修订依据
                          </Button>
                          <p>
                            包含当前详情、父回执和校验依据，不含访问密钥。使用本地客户端准备完整修订，预览确认后上传。
                          </p>
                        </>
                      ) : (
                        <p role="status">
                          {current?.error
                            ? `详情暂未取得：${current.error}。可收起后重新查看。`
                            : '正在读取这份记录的完整详情…'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title={ownerKey ? '暂无已提交记录' : '登录或导入访问凭证以查看记录'}
            action={
              <Button secondary onClick={() => go('contribute')}>
                加入收集计划 <ArrowUpRight size={14} />
              </Button>
            }
          >
            {null}
          </Empty>
        )}
        {records.length > 0 && (
          <p role="status">
            已载入 {records.length} 条记录，其中待核查{' '}
            {records.filter((record) => record.status === 'quarantined').length} 条。
            已保存不代表已核验；完整任务仅在查看或下载时读取。
          </p>
        )}
        {owned.key === ownerKey && owned.nextCursor && (
          <Button secondary disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? '正在读取…' : '加载更多记录'}
          </Button>
        )}
      </section>
      {records.length > 0 && <PersonalHistory records={records} partial={!!owned.nextCursor} />}
      <QuotaReplayEntry />
    </>
  );
}

export function PersonalHistory({
  records,
  partial,
}: {
  records: ContributionIndexEntry[];
  partial: boolean;
}) {
  const { rows, missing, excluded } = summarizePrivateIndex(records);
  const quarantinedMissing = records.filter(
    (record) => record.status === 'quarantined' && record.summary === null,
  ).length;
  return (
    <section className="panel owned-panel">
      <SectionTitle title={partial || missing > 0 ? '已读取摘要的月度统计' : '我的月度记录'} />
      <p>
        以下合计包含当前有效版本的待核查记录，按申报账期月份和币种分别统计，不表示费用或验收已经独立核验。
        待核查记录保留在个人历史中，暂不参与公开排名。
        金额是记录申报的实付减退款，包含尚未分摊到任务的费用；任务量是摘要条目合计。
        明确被替代的完整快照不重复相加；没有明确修订关系的记录区间重叠时，金额和任务仍可能重复，不能视为去重后的账单或独立任务总量。
      </p>
      {excluded && (
        <Notice tone="orange">
          已被替代的 {excluded.superseded} 条记录只保留在历史中；另有 {excluded.unresolved}{' '}
          条修订关系待确认或冲突，未归入金额和任务合计。未归入不表示费用为零。
        </Notice>
      )}
      {partial && <p>下面按已载入的记录计算，加载后续记录后继续更新。</p>}
      {missing > 0 && (
        <Notice tone="orange">
          有 {missing}{' '}
          条记录的摘要暂不可读取，月份、费用和任务量无法归入下表。下表仅统计可读取的摘要，不是完整月度统计。
          {quarantinedMissing > 0 &&
            `其中 ${quarantinedMissing} 条为待核查记录，其金额未知，未作为零支出处理。`}
        </Notice>
      )}
      {rows.length ? (
        <div className="table-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>申报账期月份</th>
                <th>币种</th>
                <th>记录净实付合计</th>
                <th>其中待核查（已读摘要）</th>
                <th>任务 / 声明已验收</th>
                <th>额外尝试</th>
                <th>人工投入</th>
                <th>声明连续完整的记录</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.month}</td>
                  <td>{row.currency}</td>
                  <td>{money(row.netMinor, row.currency)}</td>
                  <td>
                    {row.quarantinedRecords} 条 / {money(row.quarantinedNetMinor, row.currency)}
                    <br />
                    {row.quarantinedTasks ?? '—'} 项任务
                  </td>
                  <td>
                    {row.tasks ?? '—'} / {row.accepted ?? '—'}
                  </td>
                  <td>{row.retries === null ? '—' : `${row.retries} 次`}</td>
                  <td>
                    {row.humanMinutes === null
                      ? '尚有缺失或超出计算范围'
                      : `${row.humanMinutes} min`}
                  </td>
                  <td>
                    {row.completeCycles} / {row.records}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            “声明连续完整”只表示该记录声明覆盖完整且连续选择，分母为可读取的记录数；
            不表示整个自然月、套餐账期或采集范围已经独立核验。
          </p>
        </div>
      ) : (
        <Empty title={missing > 0 ? '已载入记录的摘要暂不可读取' : '暂无历史记录'} />
      )}
    </section>
  );
}
