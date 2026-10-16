import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { GithubAccountPanel, useGithubAccount } from '../GithubAccount';
import { DeferredFeedbackPanel } from '../../shared/DeferredPanels';
import { PersonalFeedbackSchema, type PersonalFeedback } from '../../shared/personal-feedback';
import { feedbackLink, type FeedbackTarget } from '../../shared/feedback-link';
import { WorkspacePageSchema, feedbackKindLabels, type WorkspaceEntry } from '../../shared/workspace-feedback';

type Selected = FeedbackTarget & { source?: string };
const entryId = (entry: Selected) => `${entry.kind}:${entry.recordId}:${entry.source ?? ''}`;
export function Feedback({ ownerKey, setOwnerKey, target }: { ownerKey: string; setOwnerKey: (key: string)=>void; target: FeedbackTarget | null }) {
  const account = useGithubAccount(), input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<{ owner: string; entries: WorkspaceEntry[]; cursor: string | null }>({ owner: '', entries: [], cursor: null });
  const [selected, setSelected] = useState<Selected | null>(target);
  const [report, setReport] = useState<{ owner: string; id: string; value: PersonalFeedback } | null>(null);
  const [error, setError] = useState(''), [reportError, setReportError] = useState('');
  const [loading, setLoading] = useState(false), [reading, setReading] = useState(false), [more, setMore] = useState(false);
  const [refresh, setRefresh] = useState(0), [readVersion, setReadVersion] = useState(0), [copied, setCopied] = useState(false);
  const currentOwner = useRef(ownerKey); currentOwner.current = ownerKey;
  useEffect(() => { setSelected(target); setReport(null); setReportError(''); setCopied(false); },[ownerKey,target]);
  useEffect(() => {
    setPage({ owner: ownerKey, entries: [], cursor: null }); setError('');
    if (!ownerKey) return;
    const controller = new AbortController(); setLoading(true);
    void api<unknown>('/api/workspace/records?limit=20',{headers:{Authorization:`Bearer ${ownerKey}`},signal:controller.signal}).then(body => {
      if (controller.signal.aborted) return;
      const result = WorkspacePageSchema.parse(body);
      setPage({owner:ownerKey,entries:result.entries,cursor:result.nextCursor});
      setSelected(current => current ?? result.entries[0] ?? null);
    }).catch(cause=>{ if(!controller.signal.aborted) setError((cause as Error).message); }).finally(()=>{ if(!controller.signal.aborted) setLoading(false); });
    return ()=>controller.abort();
  },[ownerKey,refresh]);
  useEffect(() => {
    setReport(null); setReportError('');
    if (!ownerKey || !selected) return;
    const controller = new AbortController(), id=entryId(selected); setReading(true);
    const query = new URLSearchParams({kind:selected.kind,recordId:selected.recordId});
    if(selected.source) query.set('source',selected.source);
    void api<{feedback:unknown;persisted:boolean}>(`/api/workspace/feedback?${query}`,{headers:{Authorization:`Bearer ${ownerKey}`},signal:controller.signal}).then(result=>{
      if(controller.signal.aborted) return;
      const value=PersonalFeedbackSchema.parse(result.feedback);
      if(value.recordId!==selected.recordId || value.kind!==selected.kind) throw new Error('反馈与所选记录不一致，请刷新列表。');
      setReport({owner:ownerKey,id,value: result.persisted ? value : {...value,provisional:true}});
    }).catch(cause=>{if(!controller.signal.aborted) setReportError((cause as Error).message);}).finally(()=>{if(!controller.signal.aborted) setReading(false);});
    return ()=>controller.abort();
  },[ownerKey,selected,readVersion]);
  const importAccess=async(file:File)=>{
    setError('');
    try {
      if(file.size>50000) throw new Error('凭证文件过大。');
      const value=JSON.parse(await file.text());
      if(value.format!=='opencost-access-1' || value.origin!==location.origin || typeof value.accessKey!=='string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value.accessKey)) throw new Error('请选择当前站点的 OpenCost 访问凭证。');
      setOwnerKey(value.accessKey);
    } catch(cause){setError((cause as Error).message);}
  };
  const loadMore=async()=>{
    if(more || !page.cursor || page.owner!==ownerKey) return;
    const actor=ownerKey; setMore(true);
    try {
      const result=WorkspacePageSchema.parse(await api(`/api/workspace/records?limit=20&cursor=${encodeURIComponent(page.cursor)}`,{headers:{Authorization:`Bearer ${actor}`}}));
      if(currentOwner.current===actor) setPage(current=>({owner:actor,entries:[...current.entries,...result.entries],cursor:result.nextCursor}));
    } catch(cause){if(currentOwner.current===actor)setError((cause as Error).message);} finally{setMore(false);}
  };
  const copyLink=async()=>{
    setError('');
    const actor=ownerKey;
    try {
      const key=actor.startsWith('github-session:') ? (await api<{accessKey:string}>('/api/auth/access',{method:'POST',body:'{}'})).accessKey : actor;
      if(currentOwner.current!==actor) return;
      // Account links open the full account list; an alias record stays accessible through the signed-in account.
      const targetForLink=actor.startsWith('github-session:') ? undefined : selected ?? undefined;
      await navigator.clipboard.writeText(feedbackLink(location.origin,key,targetForLink)); setCopied(true);
    }catch{setError('私人链接未复制，请使用原访问凭证查看。');}
  };
  const entries=page.owner===ownerKey?page.entries:[];
  const visibleReport=report?.owner===ownerKey && selected && report.id===entryId(selected)?report.value:null;
  return <div className="feedback-workspace">
    <a className="feedback-back" href="#workspace"><ArrowLeft size={15}/>我的记录</a>
    <div className="page-heading"><div><p className="feedback-kicker">上传之后，查看工作与投入</p><h1>个人反馈</h1><p>工作贡献、每日摘要和订阅额度，在同一个地方查看。</p></div><button className="button secondary" onClick={()=>input.current?.click()}><KeyRound size={16}/>导入访问凭证</button></div>
    <input ref={input} type="file" hidden accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];if(file)void importAccess(file);event.target.value='';}}/>
    <GithubAccountPanel/>
    {!ownerKey && <section className="panel feedback-empty"><h2>从一份上传回执开始</h2><p>打开上传成功后的私人反馈链接，即可直接查看；也可以导入 access.json，或使用已关联的 GitHub 账号登录。</p><ol><li>上传成功后保留回执</li><li>点击回执中的“查看反馈”</li><li>查看本次工作、用量与可比较结果</li></ol><p>数据不足时会显示“稍后再看”，已保存的摘要不需要重复上传。</p></section>}
    {error&&<p className="notice orange" role="alert">{error}</p>}
    {!!ownerKey&&<div className="feedback-layout"><aside className="panel feedback-history"><div className="feedback-history-heading"><h2>全部上传</h2><button className="button secondary" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14}/>刷新</button></div>
      <p>按上传时间排列 · 仅当前身份与已验证关联</p>{loading&&<p role="status">正在读取上传记录…</p>}
      {!loading&&!entries.length&&<div className="feedback-empty"><h3>还没有找到上传记录</h3><p>若刚刚上传，请稍后刷新；也可核对站点与上传凭证。</p><a href="#contribute">查看上传方法</a></div>}
      {entries.map(entry=><button key={entryId(entry)} className={`feedback-record ${selected&&selected.recordId===entry.recordId&&selected.kind===entry.kind&&(!selected.source||selected.source===entry.source)?'active':''}`} onClick={()=>{setSelected(entry);setCopied(false);}}><span>{feedbackKindLabels[entry.kind]}</span><strong>{new Date(entry.receivedAt).toLocaleString('zh-CN')}</strong><small>记录 {entry.recordId.slice(0,8)}</small></button>)}
      {page.cursor&&<button className="button secondary" disabled={more} onClick={()=>void loadMore()}>{more?'正在读取…':'加载更多'}</button>}
    </aside><section className="feedback-detail">
      <div className="feedback-detail-actions"><span>个人报告 · 历史原文保留</span><button className="button secondary" disabled={!ownerKey||account?.linkBusy} onClick={()=>void copyLink()}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'已复制':'复制私人访问链接'}</button></div>
      <small className="feedback-link-note">私人链接含此身份的访问凭证，持有者可访问相应记录。打开后，凭证立即从地址栏移除；请只在自己的设备保存。</small>
      {reading&&<section className="panel" role="status">正在生成或读取这份反馈…</section>}
      {reportError&&<section className="panel feedback-empty"><h2>反馈暂时未取得，稍后再看</h2><p>{reportError}</p><p>已经保存的摘要无需重复上传。</p><button className="button secondary" onClick={()=>setReadVersion(n=>n+1)}>再次读取反馈</button></section>}
      {visibleReport&&<><DeferredFeedbackPanel report={visibleReport}/><button className="button secondary" disabled={reading} onClick={()=>setReadVersion(n=>n+1)}>再次读取这份反馈</button></>}
    </section></div>}
  </div>;
}
