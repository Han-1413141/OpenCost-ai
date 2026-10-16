import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { z } from 'zod';
import { api, number } from '../api';
import { Button, Empty, Notice, SectionTitle, Select } from '../components';

const streams = [
  ['catalog', 'OpenRouter 模型与公开标价'],
  ['aa', 'Artificial Analysis 评测'],
  ['exchange-rates:ecb', '欧洲中央银行参考汇率'],
  ['market:openai-news', 'OpenAI 公告'],
  ['market:anthropic-news', 'Anthropic 公告'],
  ['market:openrouter-news', 'OpenRouter 公告'],
] as const;
type Stream = (typeof streams)[number][0];
const pageSchema = z.object({
  stream: z.enum(streams.map(([value]) => value)),
  snapshots: z
    .array(
      z.object({
        sequence: z.number().int().safe().positive(),
        version: z.string().regex(/^(?:[a-f0-9]{64}|legacy)$/),
        observedAt: z.iso.datetime({ offset: true }),
        dataBytes: z.number().int().safe().nonnegative(),
        dataIncluded: z.literal(false),
      }),
    )
    .max(20),
  nextBeforeSequence: z.number().int().safe().positive().nullable(),
  truncated: z.boolean(),
  historicalCoverage: z.literal('only_snapshots_actually_observed'),
});
type HistoryPage = z.infer<typeof pageSchema>;

function validatePage(body: unknown, stream: Stream, beforeSequence: number | undefined) {
  const page = pageSchema.parse(body);
  if (
    page.stream !== stream ||
    page.truncated !== (page.nextBeforeSequence !== null) ||
    (page.truncated && page.nextBeforeSequence !== page.snapshots.at(-1)?.sequence) ||
    page.snapshots.some(
      (snapshot, index) =>
        (beforeSequence !== undefined && snapshot.sequence >= beforeSequence) ||
        (index > 0 && snapshot.sequence >= page.snapshots[index - 1].sequence),
    )
  )
    throw new Error('历史快照分页信息不一致，请重试。');
  return page;
}

function downloadPath(stream: Stream, snapshot: HistoryPage['snapshots'][number]) {
  const query = new URLSearchParams({ stream, version: snapshot.version });
  return `/api/history/${snapshot.sequence}/download?${query}`;
}

export function PublicHistory({ refresh }: { refresh: number }) {
  const [navigation, setNavigation] = useState<{
    stream: Stream;
    cursors: (number | undefined)[];
    index: number;
  }>({ stream: 'catalog', cursors: [undefined], index: 0 });
  const { stream, cursors, index } = navigation;
  const beforeSequence = cursors[index];
  const requestKey = `${stream}:${beforeSequence ?? 'first'}`;
  const [loaded, setLoaded] = useState<{ key: string; page: HistoryPage } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const requestBusy = useRef(true);
  const refreshCurrent = () => {
    if (requestBusy.current || loading) return;
    requestBusy.current = true;
    setLoading(true);
    setRetry((value) => value + 1);
  };
  const current = loaded?.key === requestKey ? loaded.page : null;
  useEffect(() => {
    const controller = new AbortController();
    requestBusy.current = true;
    const query = new URLSearchParams({ stream, limit: '20' });
    if (beforeSequence !== undefined) query.set('beforeSequence', String(beforeSequence));
    setLoading(true);
    setError('');
    api<unknown>(`/api/history?${query}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((body) => {
        const page = validatePage(body, stream, beforeSequence);
        if (!controller.signal.aborted) setLoaded({ key: requestKey, page });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof z.ZodError
              ? '历史快照格式不符合预期，请重试。'
              : cause instanceof Error
                ? cause.message
                : '历史快照读取失败，请重试。',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          requestBusy.current = false;
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [stream, beforeSequence, requestKey, refresh, retry]);

  return (
    <section className="panel" aria-busy={loading}>
      <SectionTitle
        title="历史快照"
        sub="按页查看实际采集并保存的公开数据，每页最多 20 条。"
        action={
          <>
            <Select
              label="数据来源"
              value={stream}
              options={streams.map(([value, label]) => [value, label])}
              onChange={(value) => {
                const selected = streams.find(([id]) => id === value);
                if (selected) {
                  setNavigation({ stream: selected[0], cursors: [undefined], index: 0 });
                  setError('');
                }
              }}
            />
            <Button secondary disabled={loading} onClick={refreshCurrent}>
              {loading ? '正在读取…' : '刷新本页'}
            </Button>
          </>
        }
      />
      <Notice>
        时间表示服务实际观察到这份数据的时间，不代表价格或活动的生效时间。历史仅从开始采集时记录，未观察到的变动无法补全。公开标价不等于用户实际付款；汇率与评测也保留各自口径。页面只读取当前页信息，不会自动刷新全部历史。
      </Notice>
      {error && (
        <Notice tone="orange">
          <p role="alert">
            {error}
            {current ? ' 以下保留上次成功读取的当前页。' : ''}
          </p>
          <Button secondary disabled={loading} onClick={refreshCurrent}>
            重试本页
          </Button>
        </Notice>
      )}
      {loading && <p role="status">正在读取历史快照…</p>}
      {current?.snapshots.length ? (
        <div className="table-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>观察时间（北京时间）</th>
                <th>版本标识</th>
                <th>完整数据大小</th>
                <th>下载</th>
              </tr>
            </thead>
            <tbody>
              {current.snapshots.map((snapshot) => (
                <tr key={snapshot.sequence}>
                  <td>
                    <time dateTime={snapshot.observedAt}>
                      {new Date(snapshot.observedAt).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                      })}
                    </time>
                  </td>
                  <td>
                    <code title={snapshot.version}>
                      {snapshot.version === 'legacy'
                        ? '早期保留快照'
                        : `${snapshot.version.slice(0, 16)}…`}
                    </code>
                  </td>
                  <td>{number(snapshot.dataBytes)} 字节</td>
                  <td>
                    <a
                      className="text-link"
                      href={downloadPath(stream, snapshot)}
                      download={`opencost-${stream.replaceAll(':', '-')}-${snapshot.sequence}.json`}
                      aria-label={`下载 ${snapshot.observedAt} 的完整快照`}
                    >
                      <Download size={15} /> 完整 JSON
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && !error && <Empty title="该来源暂无已保存的历史快照" />
      )}
      <p className="attribution">
        下载保留完整数据，不在页面内加载文件正文。版本标识用于识别规范化后的内容，不能当作下载文件的原始字节校验值。
      </p>
      <div className="pagination">
        <span>
          第 {index + 1} 页{current ? ` · 本页 ${current.snapshots.length} 条` : ''}
        </span>
        <Button
          secondary
          disabled={loading || index === 0}
          onClick={() => setNavigation((value) => ({ ...value, index: value.index - 1 }))}
        >
          上一页
        </Button>
        <Button
          secondary
          disabled={loading || error !== '' || !current?.truncated}
          onClick={() => {
            if (current?.nextBeforeSequence !== null && current?.nextBeforeSequence !== undefined)
              setNavigation((value) => ({
                ...value,
                cursors: [...value.cursors.slice(0, value.index + 1), current.nextBeforeSequence!],
                index: value.index + 1,
              }));
          }}
        >
          下一页
        </Button>
      </div>
    </section>
  );
}
