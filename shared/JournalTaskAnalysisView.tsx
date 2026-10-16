import { useEffect, useMemo, useRef, useState } from 'react';
import type { JournalTaskAnalysis, JournalAnalysisAttachment } from './journal-analysis-schema.js';
import {
  JOURNAL_ANALYSIS_LIMITS,
  JournalAnalysisAttachmentSchema,
} from './journal-analysis-schema.js';
import { difficultyFramework } from './difficulty-framework.js';
import { CodeObservationInsightsView } from './CodeObservationInsightsView.js';
import { analyzeCodeObservations } from './code-observation-insights.js';
import './feedback.css';
import './journal-analysis.css';

const requirementFields=[['clarity','需求明确程度'],['inputCondition','原始材料条件'],['solutionNovelty','方案构造要求'],['knowledge','知识要求'],['reasoning','推理与论证'],['methodFamilies','必要方法'],['constraintKinds','必须保持的约束'],['contextReuse','原有材料复用']] as const;
const valueLabels:Record<string,string>={specified:'明确',incomplete:'不完整',conflicting:'有冲突',clean:'完整一致',missing:'材料缺失',inconsistent:'材料不一致',noisy:'存在噪声',mixed:'多种情况',repeat:'复用已知方案',adaptation:'适配已有方案',new_solution:'构造新方案',general:'通用知识',specialist:'专业知识',research:'研究性知识',routine:'常规推理',multi_step:'多步推理',formal:'形式化论证',open_ended:'开放式推断',retrieval:'检索',transformation:'转换',construction:'构造',diagnosis:'诊断',formal_verification:'形式验证',statistical_inference:'统计推断',optimization:'优化',simulation:'仿真',multimodal_alignment:'多模态对齐',cross_system_integration:'跨系统集成',correctness:'正确性',performance:'性能',security:'安全',compatibility:'兼容',format:'格式',accessibility:'无障碍',source_traceability:'来源可追溯',resource_limit:'资源上限',deadline:'截止时间',fresh:'从新材料开始',continued:'沿用已有上下文',template_based:'采用已有模板',complete:'完整（声明）',partial:'部分',before_execution:'执行前',approved_change:'已批准的要求变更',during_execution:'执行中',after_execution:'执行后',retrospective:'事后回顾',followup:'后续观察',unknown:'未知'};
const requirementValue=(value:unknown):string=>value===null||value===undefined?'未知':Array.isArray(value)?value.length?value.map(v=>valueLabels[v]??'未知').join('、'):'无（已明确记录）':valueLabels[String(value)]??'未知';

export function JournalTaskAnalysisView({ analysis }: { analysis: JournalTaskAnalysis }) {
  const s = analysis.structure;
  const missing = analysis.requirementLevels.missingCriteria;
  const code = analysis.codeMeasurements;
  const insights = useMemo(()=>code
    ? analyzeCodeObservations([{ observations: { codeMeasurements: code } }])
    : null,[code]);
  return (
    <section aria-label="任务分析详情" className="journal-task-analysis">
      <h3>要求、结构与代码分析</h3>
      <p>客户端程序报告，供本人分析；难度尚未校准，不参与正式排名。字段缺失保留未知。</p>
      <p>
        结构来源：
        {s.status === 'computed_graph'
          ? '按原要求图计算'
          : s.status === 'declared_summary'
            ? '摘要中的结构声明'
            : '未提供'}
        ；覆盖：
        {s.coverage === 'complete' ? '声明完整' : s.coverage === 'partial' ? '部分' : '未知'}。
      </p>
      <dl className="journal-analysis-metrics">
        {[
          ['组成部分', s.componentCount],
          ['依赖边', s.dependencyEdges],
          ['依赖深度', s.dependencyDepth],
          ['循环依赖组', s.cyclicDependencyGroups],
          ['共享状态组', s.sharedStateGroups],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{value ?? '未知'}</dd>
          </div>
        ))}
      </dl>
      <h4>分项要求描述（实验）</h4>
      <p>缺少要求判断的条目：{missing ?? '未知'}。未填写不代表最低要求，没有跨领域总等级。</p>
      <ul>
        {analysis.requirementLevels.criteria.map((c) => {
          const domain = difficultyFramework.domains.find((d) => d.domain === c.domain);
          const criterion = domain?.criteria.find((r) => `${c.domain}.${r.id}` === c.criterionId);
          return (
            <li key={`${c.workType}:${c.criterionId}`}>
              {criterion?.label ?? c.criterionId}：
              {criterion?.anchors[c.anchorIndex] ?? '描述不可用'}（条目位置 {c.anchorIndex + 1}/4）
            </li>
          );
        })}
      </ul>
      {analysis.requirements && (
        <details><summary>查看八项要求记录</summary>
          <p>材料覆盖：{requirementValue(analysis.requirements.meta.coverage)}；记录时点：{requirementValue(analysis.requirements.meta.timing)}。事后观察不作为事前复杂度依据。</p>
          <dl className="journal-analysis-requirements">{requirementFields.map(([field,label])=><div key={field}><dt>{label}</dt><dd>{requirementValue(analysis.requirements![field])}</dd></div>)}</dl>
        </details>
      )}
      {insights && <CodeObservationInsightsView report={insights} />}
    </section>
  );
}

export function JournalAnalysisPanel({
  summaryId,
  sourceRefs,
  analysis,
  onApply,
  onClose,
}: {
  summaryId: string;
  sourceRefs: string[];
  analysis?: JournalTaskAnalysis;
  onApply: (attachment: JournalAnalysisAttachment) => Promise<unknown>;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    busy: boolean;
    message: string;
    attachment?: JournalAnalysisAttachment;
  }>({ busy: false, message: '' });
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
      worker.current?.terminate();
    },
    [],
  );
  useEffect(() => {
    sequence.current++;
    worker.current?.terminate();
    worker.current = null;
    setState({ busy: false, message: '' });
  }, [summaryId, sourceRefs.join(':')]);
  const read = async (file: File) => {
    if (state.busy) return;
    const id = ++sequence.current;
    if (file.size < 1 || file.size > JOURNAL_ANALYSIS_LIMITS.inputBytes) {
      setState({ busy: false, message: '请选择不超过1 MiB的任务分析输入或数值附件' });
      return;
    }
    setState({ busy: true, message: '正在工作线程中校验、分析和生成上传字段…' });
    try {
      const text = await file.text();
      if (id !== sequence.current) return;
      if (!worker.current)
        worker.current = new Worker(new URL('./journal-analysis-worker.ts', import.meta.url), {
          type: 'module',
        });
      const instance = worker.current;
      instance.onerror = () => {
        if (id === sequence.current) {
          instance.terminate();
          worker.current = null;
          setState({ busy: false, message: '工作线程未完成，请重新选择数值报告' });
        }
      };
      instance.onmessage = (e) => {
        if (id !== sequence.current || e.data.id !== id) return;
        const parsed = JournalAnalysisAttachmentSchema.safeParse(e.data.attachment);
        if (
          e.data.status !== 'ready' ||
          !parsed.success ||
          parsed.data.target.summaryId !== summaryId ||
          JSON.stringify([...parsed.data.target.sourceRefs].sort()) !==
            JSON.stringify([...sourceRefs].sort())
        ) {
          setState({ busy: false, message: '分析无效或不属于这个工作条目，未保存' });
          return;
        }
        setState({
          busy: false,
          message: e.data.cacheHit
            ? '已复用相同输入的校验结果，请检查后保存新修订'
            : '分析完成，请检查后保存新修订',
          attachment: parsed.data,
        });
      };
      instance.postMessage({ id, text });
    } catch {
      if (id === sequence.current)
        setState({ busy: false, message: '数值报告读取失败，原日记保留' });
    }
  };
  return (
    <section aria-label="附加任务分析">
      <h3>附加任务分析</h3>
      <p>
        选择已授权的任务分析输入，或程序生成的数值附件。文件在本地校验；仅保存下面展示的枚举与数值，不上传原要求、源码、路径或
        Diff。保存后另行预览上传。
      </p>
      <input
        aria-label="选择任务分析文件"
        type="file"
        accept="application/json,.json"
        disabled={state.busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void read(file);
        }}
      />
      <p role="status">{state.message}</p>
      {(state.attachment?.analysis ?? analysis) && (
        <JournalTaskAnalysisView analysis={(state.attachment?.analysis ?? analysis)!} />
      )}
      {state.attachment && (
        <button
          disabled={state.busy}
          onClick={async () => {
            setState({ ...state, busy: true });
            try {
              await onApply(state.attachment!);
              setState({ busy: false, message: '分析已保存为新修订，旧日记保留' });
            } catch {
              setState({ ...state, busy: false, message: '保存未完成，原日记保留' });
            }
          }}
        >
          保存分析为新修订
        </button>
      )}
      <button onClick={onClose}>关闭分析</button>
    </section>
  );
}
