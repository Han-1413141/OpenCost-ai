import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleDollarSign,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileJson,
  Fingerprint,
  GitBranch,
  Layers,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Users,
  Zap,
} from 'lucide-react';
import { api, download, number } from '../api';
import { Button, CheckLine, Empty, Notice, SectionTitle, Tag } from '../components';
import { PublicHistory } from '../components/PublicHistory';
import { PageRequests } from '../request-policy';
export function Methods() {
  return (
    <>
      <div className="page-heading"><h1>数据与方法</h1></div>
      <article className="panel method-article method-overview">
        <p className="method-intro">用脱敏工作记录，比较完成同类任务的成本与效率。</p>
        <div className="method-cards">
          <div><FileJson size={22} /><h3>记录什么</h3><p>任务类别、完成量、验收情况、Token、轮次、代理用量与费用。原始对话、源码、路径和账号留在本机。</p></div>
          <div><CircleDollarSign size={22} /><h3>如何比较</h3><p>对齐任务类型、时间和费用口径，分别比较模型与 Harness。失败、重试和返工的支出一并计入。</p></div>
          <div><Zap size={22} /><h3>费用与额度</h3><p>实付、套餐分摊和 API 等价金额分别展示。额度记录区分使用、重置、赠额与恢复，并保留当时价格。</p></div>
          <div><Users size={22} /><h3>怎样看结果</h3><p>结合样本量、完成情况和记录时间阅读排名。单次上传用于初步反馈，连续记录一周或一个月更适合比较。</p></div>
          <div><LockKeyhole size={22} /><h3>分享由你决定</h3><p>上传前预览全部字段，分别选择保存、参与统计和分享摘要。个人记录与公开分组统计分开显示。</p></div>
          <div><Code2 size={22} /><h3>用户端开源</h3><p>网页、桌面应用、上传工具、Skills 及必要依赖统一公开，代码采用 MIT 许可。</p><a href="https://github.com/Han-1413141/OpenCost-ai" target="_blank" rel="noreferrer">查看 GitHub 仓库 <ArrowUpRight size={14} /></a></div>
        </div>
        <p className="method-footnote">缺失测量显示“—”。正在进行的任务与已结束但未完成的任务分别记录。当前难度分级关闭。</p>
      </article>
    </>
  );
}

export function Connections({ toast }: { toast: (text: string) => void }) {
  const command = 'npm run contribute -- prepare --input ./record.json --out ./preview.json';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast('已复制本地预览命令。');
    } catch {
      toast('浏览器不允许复制，请选中命令手动复制。');
    }
  };
  return (
    <div className="connection-page">
      <div className="page-heading">
        <h1>接入 OpenCost-AI</h1>
        <a className="button button-secondary" href="#contribute">
          <Copy size={16} /> 获取参与提示词
        </a>
      </div>
      <section className="connection-command">
        <h2>本地预览</h2>
        <div className="code-line">
          <code>{command}</code>
          <button className="icon-button" onClick={() => void copy()} aria-label="复制本地预览命令">
            <Copy size={17} />
          </button>
        </div>
      </section>
      <div className="connection-options">
        {[
          ['TypeScript SDK', '通用接入', '校验、预览与提交'],
          ['OpenAI / Anthropic 用量', '字段转换', '输入、缓存、输出与思考 Token'],
          ['DSH Cost Meter', '记录转换', '已有用量记录'],
          ['Codex / Claude Code / OpenCode', '贡献 Skill', '原生自动采集器需单独集成'],
        ].map(([title, status, detail]) => (
          <div className="connection-option" key={title}>
            <h3>{title}</h3>
            <span>{detail}</span>
            <Tag>{status}</Tag>
          </div>
        ))}
      </div>
      <ol className="connection-flow" aria-label="提交流程">
        {['指定范围', '本地整理', '预览确认', '提交并保存回执'].map((step, i) => (
          <li key={step}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            {step}
          </li>
        ))}
      </ol>
      <div className="reference-links">
        <a href="https://github.com/Han-1413141/dsh-cost-meter" target="_blank" rel="noreferrer">
          <GitBranch size={17} /> DSH Cost Meter <ExternalLink size={13} />
        </a>
        <a href="/api/schema" target="_blank" rel="noreferrer">
          <FileJson size={17} /> JSON Schema <ExternalLink size={13} />
        </a>
        <a href="#method">
          <BookOpen size={17} /> 数据标准 <ArrowUpRight size={13} />
        </a>
      </div>
    </div>
  );
}

type AAModel = {
  id: string;
  name: string;
  provider: string;
  intelligence: number | null;
  coding: number | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  outputTps: number | null;
  indexVersion?: number;
  benchmarkCostPerTaskUsd?: number | null;
  benchmarkTotalCostUsd?: number | null;
  use?: string;
  source?: string;
};
type CatalogModel = {
  id: string;
  name: string;
  context: number | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  source: string;
};
type AAData = { status: string; data: AAModel[]; fetchedAt: string | null };
type CatalogData = { status: string; models: CatalogModel[]; fetchedAt: string | null };
export function AAReference({ search }: { search: string }) {
  const [aa, setAA] = useState<AAData | null>(null);
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [tab, setTab] = useState<'aa' | 'catalog' | 'history'>('aa'),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const refreshPending = useRef(false);
  const [requests] = useState(
    () => new PageRequests<AAData | CatalogData>((path, signal) => api(path, { signal }), 2),
  );
  const refreshCurrent = () => {
    if (tab === 'history' || requests.busy || refreshPending.current) return;
    refreshPending.current = true;
    requests.invalidate(`/api/${tab}`);
    setRefresh((value) => value + 1);
  };
  useEffect(() => {
    refreshPending.current = false;
    setError('');
    if (tab === 'history') {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    requests
      .read(`/api/${tab}`)
      .then((result) => {
        if (!active) return;
        if (tab === 'aa') setAA(result as AAData);
        else setCatalog(result as CatalogData);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      requests.cancel();
    };
  }, [refresh, tab, requests]);
  useEffect(() => setPage(0), [search, tab]);
  const matching = (value: string) => value.toLowerCase().includes(search.toLowerCase());
  const aaRows = aa?.data.filter((m) => matching(m.name + ' ' + m.provider)) ?? [];
  const catalogRows = catalog?.models.filter((m) => matching(m.name + ' ' + m.id)) ?? [];
  const awaitingFirstResponse = !error && (tab === 'aa' ? aa === null : catalog === null);
  const readingCurrent = loading || awaitingFirstResponse;
  const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toFixed(3)}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>模型目录与公开评测</h1>
        </div>
        {tab !== 'history' && (
          <Button secondary disabled={readingCurrent} onClick={refreshCurrent}>
            <RefreshCw size={15} />
            {readingCurrent ? '正在读取…' : '刷新状态'}
          </Button>
        )}
      </div>
      <div className="info-tabs">
        <button className={tab === 'aa' ? 'active' : ''} onClick={() => setTab('aa')}>
          Artificial Analysis
        </button>
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>
          公开模型与价格目录
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          历史快照
        </button>
      </div>
      {error && tab !== 'history' && <Notice tone="orange">{error}</Notice>}
      {readingCurrent && tab !== 'history' && (
        <p role="status">正在读取{tab === 'aa' ? '公开评测' : '模型目录'}…</p>
      )}
      {tab === 'history' ? (
        <PublicHistory refresh={refresh} />
      ) : tab === 'aa' ? (
        <div className="panel">
          <SectionTitle
            title="Artificial Analysis 公开评测"
            sub={
              aa?.fetchedAt
                ? `同步时间 ${new Date(aa.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）`
                : undefined
            }
            action={
              <a
                className="text-link"
                href="https://artificialanalysis.ai/methodology/intelligence-benchmarking"
                target="_blank"
                rel="noreferrer"
              >
                官方方法 <ExternalLink size={14} />
              </a>
            }
          />
          {aa?.status === 'stale' && <Notice tone="orange">评测数据超过 3 天未更新。</Notice>}
          <p className="statistics-note">
            AA 是其任务、环境与预算下的外部评测。指数和基准费用不进入 OpenCost-AI
            的任务难度、实际验收成本或个人排名；空值表示未提供。不同指数版本不能直接比较。
          </p>
          {aaRows.length ? (
            <div className="table-scroll">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>提供商</th>
                    <th>智能指数</th>
                    <th>编码指数</th>
                    <th>指数版本</th>
                    <th>基准每任务成本</th>
                    <th>基准总成本</th>
                    <th>输入 / 百万 Token</th>
                    <th>输出 / 百万 Token</th>
                  </tr>
                </thead>
                <tbody>
                  {aaRows.slice(page * 20, (page + 1) * 20).map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.source && /^https:\/\/artificialanalysis\.ai\//.test(m.source) ? (
                          <a href={m.source} target="_blank" rel="noreferrer">
                            {m.name}
                          </a>
                        ) : (
                          m.name
                        )}
                      </td>
                      <td>{m.provider}</td>
                      <td>{m.intelligence ?? '—'}</td>
                      <td>{m.coding ?? '—'}</td>
                      <td>{m.indexVersion ?? '—'}</td>
                      <td>{usd(m.benchmarkCostPerTaskUsd)}</td>
                      <td>{usd(m.benchmarkTotalCostUsd)}</td>
                      <td>{usd(m.inputUsdPerMillion)}</td>
                      <td>{usd(m.outputUsdPerMillion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !readingCurrent && !error ? (
            <Empty
              title={
                search
                  ? '没有匹配的模型'
                  : aa?.status === 'not_configured'
                    ? 'AA 数据尚未接通'
                    : '暂无评测数据'
              }
            />
          ) : null}
          <div className="attribution">
            数据来源{' '}
            <a href="https://artificialanalysis.ai/" target="_blank" rel="noreferrer">
              Artificial Analysis
            </a>
          </div>
        </div>
      ) : (
        <div className="panel">
          <SectionTitle
            title="公开模型与标价"
            sub={
              catalog?.fetchedAt
                ? `来源 OpenRouter · ${catalog.models.length} 个条目 · 更新于 ${new Date(catalog.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
                : undefined
            }
            action={<Tag>USD / 百万 Token</Tag>}
          />
          {catalog?.status === 'stale' && (
            <Notice tone="orange">最近更新失败或已超过刷新有效期，以下为最后成功快照。</Notice>
          )}
          <p className="statistics-note">
            这里是目录抓取时的公开标价，不是用户实付。抓取时间不等于价格生效时间；缓存、活动、税费及实际账户折扣另记，历史任务不能用今日标价补写。
          </p>
          {catalogRows.length ? (
            <div className="table-scroll">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>公开标识</th>
                    <th>上下文长度</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogRows.slice(page * 20, (page + 1) * 20).map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>
                        <code>{m.id}</code>
                      </td>
                      <td>{m.context === null ? '—' : number(m.context)}</td>
                      <td>{usd(m.inputUsdPerMillion)}</td>
                      <td>{usd(m.outputUsdPerMillion)}</td>
                      <td>
                        <a
                          className="text-link"
                          href={m.source}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`查看 ${m.name} 的价格来源`}
                        >
                          <ExternalLink size={15} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !readingCurrent && !error ? (
            <Empty title={search ? '没有匹配的模型' : '暂无模型目录'} />
          ) : null}
        </div>
      )}
      {tab !== 'history' && (tab === 'aa' ? aaRows.length : catalogRows.length) > 20 && (
        <div className="pagination">
          <span>共 {tab === 'aa' ? aaRows.length : catalogRows.length} 个条目</span>
          <Button secondary disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span>{page + 1}</span>
          <Button
            secondary
            disabled={(page + 1) * 20 >= (tab === 'aa' ? aaRows.length : catalogRows.length)}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </>
  );
}
