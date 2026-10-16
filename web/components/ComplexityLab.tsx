import { useEffect, useMemo, useRef, useState } from 'react';
import { EnvelopeSchema, TaskSchema, labels, type Task } from '../../shared/schema';
import { Button, Notice, Tag } from '../components';
import { download } from '../api';
import { computeTaskComplexity, type ComputedTaskComplexity } from '../../shared/task-complexity';
import { CodeMeasurementEntry } from '../../shared/CodeMeasurementEntry';
import {
  createComplexityReviewPacket,
  validateComplexityReview,
  COMPLEXITY_REVIEW_MAX_BYTES,
} from '../../shared/complexity-review';

export const complexityLabLimits = {
  inputBytes: 1024 * 1024,
  tasks: 20,
  reviewBytes: 64 * 1024,
} as const;
type ParsedTasks =
  | { status: 'disabled'; tasks: [] }
  | { status: 'ready'; tasks: Task[] }
  | { status: 'invalid'; message: string };

// Deliberately return fixed messages: schema errors can contain supplied text.
export function parseComplexityLabInput(text: string, enabled = false): ParsedTasks {
  if (!enabled) return { status: 'disabled', tasks: [] };
  if (
    text.length > complexityLabLimits.inputBytes ||
    new TextEncoder().encode(text).length > complexityLabLimits.inputBytes
  )
    return { status: 'invalid', message: '文件超过 1 MiB，请仅保留这次需要试算的脱敏任务。' };
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { status: 'invalid', message: '文件不是有效 JSON；请导入脱敏 Task 或 Envelope 文件。' };
  }
  if (input && typeof input === 'object' && !Array.isArray(input) && 'tasks' in input) {
    if (
      !Array.isArray(input.tasks) ||
      !input.tasks.length ||
      input.tasks.length > complexityLabLimits.tasks
    )
      return { status: 'invalid', message: '一次需要 1–20 项任务；请缩小本地导出范围。' };
    const envelope = EnvelopeSchema.safeParse(input);
    return envelope.success
      ? { status: 'ready', tasks: envelope.data.tasks }
      : { status: 'invalid', message: 'Envelope 未通过脱敏字段和一致性校验；未开始试算。' };
  }
  const task = TaskSchema.safeParse(input);
  return task.success
    ? { status: 'ready', tasks: [task.data] }
    : { status: 'invalid', message: 'Task 未通过脱敏字段和一致性校验；未开始试算。' };
}

export async function readComplexityLabFile(
  file: Pick<File, 'size' | 'text'>,
  enabled = false,
): Promise<ParsedTasks> {
  if (!enabled) return { status: 'disabled', tasks: [] };
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > complexityLabLimits.inputBytes
  )
    return { status: 'invalid', message: '请选择不超过 1 MiB 的脱敏 JSON 文件。' };
  try {
    return parseComplexityLabInput(await file.text(), true);
  } catch {
    return { status: 'invalid', message: '本地文件读取失败；未开始试算。' };
  }
}

const valueLabels: Record<string, string> = {
  specified: '要求已明确',
  incomplete: '要求不完整',
  conflicting: '要求存在冲突',
  clean: '材料完整一致',
  missing: '材料有缺失',
  inconsistent: '材料不一致',
  noisy: '材料含噪声',
  mixed: '多种材料问题',
  repeat: '复用已知方案',
  adaptation: '适配已有方案',
  new_solution: '构造新方案',
  general: '通用知识',
  specialist: '专业知识',
  research: '研究性知识',
  routine: '常规推理',
  multi_step: '多步推理',
  formal: '形式化论证',
  open_ended: '开放式推断',
  retrieval: '检索',
  transformation: '转换',
  construction: '构造',
  diagnosis: '诊断',
  formal_verification: '形式化验证',
  statistical_inference: '统计推断',
  optimization: '优化',
  simulation: '仿真',
  multimodal_alignment: '多模态对齐',
  cross_system_integration: '跨系统整合',
  correctness: '正确性',
  performance: '性能',
  security: '安全',
  compatibility: '兼容性',
  format: '格式',
  accessibility: '可访问性',
  source_traceability: '来源可追溯',
  resource_limit: '资源限制',
  deadline: '期限',
  fresh: '从头开始',
  continued: '延续已有工作',
  template_based: '基于已有模板',
  recorded_log: '日志记录声明',
  artifact_parser: '成果解析声明',
  human_report: '人工填报',
  local_model: '本地模型声明',
  local_rule: '本地规则声明',
  unknown: '未知',
  before_execution: '执行前记录',
  approved_change: '已批准的要求变更',
  during_execution: '执行中记录',
  after_execution: '执行后记录',
  retrospective: '事后补录',
  followup: '后续随访',
  complete: '完整记录',
  partial: '部分记录',
  not_recorded: '未记录',
  unsupported: '暂不支持',
  not_applicable: '不适用',
  not_consented: '未获采集授权',
  source_unavailable: '来源不可用',
  redacted: '已脱敏省略',
  not_eligible: '不符合事前要求依据',
  reviewer_abstained: '评审未作判断',
};
export function complexityValueLabel(value: string | readonly string[] | null) {
  if (value === null) return '未知';
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => valueLabels[item] ?? '未识别分类').join('、')
      : '已记录为空';
  return valueLabels[value as string] ?? '未识别分类';
}
function missingLabel(reason: string | null) {
  if (reason === null) return '无缺项';
  return valueLabels[reason] ?? '未在执行前或已批准变更时登记';
}

export function ComplexityProfileView({ result }: { result: ComputedTaskComplexity }) {
  return (
    <section aria-label="程序复杂度画像">
      <div className="detail-tags">
        <Tag>本地研究试算</Tag>
        <Tag>尚未校准</Tag>
        <Tag>不进入正式排名</Tag>
      </div>
      <h3>程序路线：按已记录的要求计算</h3>
      <p>
        <strong>{result.judgement.headline}</strong>
      </p>
      <p>
        已知维度 {result.coverage.known} / {result.coverage.expected}；缺项{' '}
        {result.coverage.unknown}，其中 {result.coverage.excludedTiming}{' '}
        项因记录时点不符而排除。来源标签是输入声明，一致性校验不能证明原任务真实。
      </p>
      <div className="table-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>要求维度</th>
              <th>已记录要求</th>
              <th>规则位置</th>
              <th>依据与缺项</th>
            </tr>
          </thead>
          <tbody>
            {result.dimensions.map((dimension) => (
              <tr key={dimension.id}>
                <th>{dimension.label}</th>
                <td>{complexityValueLabel(dimension.value)}</td>
                <td>
                  {dimension.ordinalPosition === null
                    ? '无统一次序'
                    : `本维度位置 ${dimension.ordinalPosition + 1}`}
                </td>
                <td>
                  {complexityValueLabel(dimension.source)} ·{' '}
                  {complexityValueLabel(dimension.timing)} ·{' '}
                  {complexityValueLabel(dimension.coverage)}
                  <br />
                  {dimension.status === 'known'
                    ? '已记录；尚未独立核验'
                    : missingLabel(dimension.missingReason)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        规则位置只在同一维度内有含义，不是难度总分。方法、约束与输入条件分别保留，不按数量加分；缺项不补成最低要求。
      </p>
      <details>
        <summary>组成部分、依赖与整合要求</summary>
        <p>
          {result.structure.status === 'computed_graph'
            ? '来自已导入的要求依赖图计算。'
            : result.structure.status === 'declared_summary'
              ? '来自已有脱敏结构摘要；没有结构图的项目保持未知。'
              : '未提供可用的结构记录。'}
        </p>
        <div className="table-scroll">
          <table className="matrix-table">
            <tbody>
              {(
                [
                  ['组成部分', result.structure.componentCount],
                  ['依赖边', result.structure.dependencyEdges],
                  ['依赖深度', result.structure.dependencyDepth],
                  ['循环依赖组', result.structure.cyclicDependencyGroups],
                  ['最大循环包含的要求单元', result.structure.largestDependencyCycle],
                  ['反馈关系', result.structure.feedbackLinks],
                  ['含反馈的循环组', result.structure.feedbackCyclicGroups],
                  ['共享状态组', result.structure.sharedStateGroups],
                ] as const
              ).map(([label, value]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{value === null ? '未知' : value}</td>
                </tr>
              ))}
              <tr>
                <th>需要整体整合验收</th>
                <td>
                  {result.structure.integrationRequired === null
                    ? '未知'
                    : result.structure.integrationRequired
                      ? '需要'
                      : '未要求'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {result.structure.notes.map((note, index) => (
          <p key={index}>{note}</p>
        ))}
      </details>
      <details>
        <summary>判断范围与规则版本</summary>
        <p>
          {result.version}；{result.frameworkVersion}
        </p>
        {result.limitations.map((item, index) => (
          <p key={index}>{item}</p>
        ))}
      </details>
    </section>
  );
}

type ReviewResult = ReturnType<typeof validateComplexityReview>;
const reviewReasonLabels: Record<string, string> = {
  invalid_schema: '答卷字段、大小或维度格式不符合协议',
  task_mismatch: '答卷不属于当前任务',
  revision_mismatch: '答卷不属于当前要求修订',
  snapshot_mismatch: '答卷中的要求快照与当前记录不一致',
};
export function ComplexityReviewView({ result }: { result: ReviewResult }) {
  if (result.status === 'disabled') return null;
  if (result.status === 'invalid')
    return (
      <Notice tone="warning">
        模型答卷未通过校验。
        {result.reasons.map((reason) => reviewReasonLabels[reason] ?? '答卷校验失败').join('；')}。
        程序画像保持原结果。
      </Notice>
    );
  const statuses = {
    agreed: '映射一致',
    agreed_unknown: '一致保留未知',
    abstained: '评审未判断',
    mismatch: '与程序依据冲突',
  };
  const domain =
    result.domainAssessment?.result.mode === 'local_review'
      ? result.domainAssessment.result.root.domainReview
      : null;
  return (
    <section aria-label="模型答卷核验">
      <h3>模型辅助路线：字段复核与领域要求判断</h3>
      <Notice tone={result.status === 'rejected' ? 'warning' : 'neutral'}>
        {result.status === 'rejected'
          ? '答卷存在冲突，未采用模型判断。'
          : '答卷通过结构与字段映射一致性检查。'}
        这不证明模型判断正确、原任务真实或难度已校准；程序画像没有被模型改写。
      </Notice>
      <p>
        映射一致 {result.coverage.agreed}；一致保留未知 {result.coverage.agreedUnknown}；未判断{' '}
        {result.coverage.abstained}；冲突 {result.coverage.mismatches}。共{' '}
        {result.coverage.expected} 个维度，不计算一致率总分。
      </p>
      <div className="table-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>维度</th>
              <th>程序依据</th>
              <th>模型声明</th>
              <th>核验结果</th>
            </tr>
          </thead>
          <tbody>
            {result.comparisons.map((comparison) => (
              <tr key={comparison.dimensionId}>
                <th>{comparison.label}</th>
                <td>{complexityValueLabel(comparison.expected.value)}</td>
                <td>{complexityValueLabel(comparison.declared.value)}</td>
                <td>{statuses[comparison.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {domain && (
        <section aria-label="模型声明的领域要求">
          <h4>模型声明的领域要求，尚未人工复核</h4>
          <p>
            下面的描述由模型根据其获准读取的本地原要求选择，程序只校验字段、任务和修订绑定。
            原要求没有导入本页面，模型声明也没有成为程序已知维度或真实难度证明。
          </p>
          <p>
            有依据的条目声明 {domain.coverage.known} / {domain.coverage.expected ?? '未确定'}； 未知{' '}
            {domain.coverage.unknown ?? '未确定'}；冲突 {domain.coverage.conflicting}。
            条目内描述不能相加、求平均或换算成本。
          </p>
          {domain.criteria.length ? (
            <div className="table-scroll">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>领域条目</th>
                    <th>模型选择的要求描述</th>
                    <th>缺项与复核状态</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.criteria.map((criterion) => (
                    <tr key={criterion.criterionId}>
                      <th>{criterion.label}</th>
                      <td>
                        {criterion.description ??
                          (criterion.applicability === 'not_applicable'
                            ? '声明不适用'
                            : '未知，可能描述尚未排除')}
                      </td>
                      <td>
                        {criterion.anchorIndex === null
                          ? '未选择规则描述'
                          : `本条目描述 ${criterion.anchorIndex + 1} / ${criterion.descriptions.length}`}{' '}
                        · 未人工复核
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>任务细类尚未完整确定，领域条目保持未知。</p>
          )}
        </section>
      )}
    </section>
  );
}

type LocalTask = { task: Task; revision: string };
export function ComplexityLab() {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const operation = useRef(0);
  const taskInput = useRef<HTMLInputElement>(null),
    reviewInput = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<LocalTask[]>([]),
    [selected, setSelected] = useState(0);
  const [reading, setReading] = useState(false),
    [error, setError] = useState('');
  const [review, setReview] = useState<ReviewResult | null>(null);
  useEffect(
    () => () => {
      enabledRef.current = false;
      operation.current++;
    },
    [],
  );
  const current = enabled ? entries[selected] : undefined;
  const calculated = useMemo(() => {
    if (!current) return null;
    try {
      return computeTaskComplexity(current.task, {
        enabled: true,
        requirementRevision: current.revision,
      });
    } catch {
      return null;
    }
  }, [current]);
  const clear = () => {
    operation.current++;
    setEntries([]);
    setSelected(0);
    setReading(false);
    setError('');
    setReview(null);
  };
  const toggle = (next: boolean) => {
    enabledRef.current = next;
    setEnabled(next);
    clear();
  };
  const loadTasks = async (file: File | undefined) => {
    if (!enabledRef.current || !file) return;
    const token = ++operation.current;
    setEntries([]);
    setSelected(0);
    setReview(null);
    setError('');
    setReading(true);
    const parsed = await readComplexityLabFile(file, true);
    if (!enabledRef.current || token !== operation.current) return;
    setReading(false);
    if (parsed.status !== 'ready') {
      if (parsed.status === 'invalid') setError(parsed.message);
      return;
    }
    try {
      setEntries(parsed.tasks.map((task) => ({ task, revision: crypto.randomUUID() })));
    } catch {
      setError('当前环境无法生成本地要求修订标识，请使用支持安全随机数的浏览器。');
    }
  };
  const loadReview = async (file: File | undefined) => {
    if (!enabledRef.current || !current || !file) return;
    const token = ++operation.current;
    setReview(null);
    setError('');
    if (
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      file.size > COMPLEXITY_REVIEW_MAX_BYTES
    ) {
      setError('模型答卷不得超过 64 KiB。');
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (!enabledRef.current || token !== operation.current) return;
      if (
        text.length > COMPLEXITY_REVIEW_MAX_BYTES ||
        new TextEncoder().encode(text).length > COMPLEXITY_REVIEW_MAX_BYTES
      )
        throw new Error('size');
      const answer: unknown = JSON.parse(text);
      const checked = validateComplexityReview(current.task, answer, {
        enabled: true,
        requirementRevision: current.revision,
      });
      if (enabledRef.current && token === operation.current) setReview(checked);
    } catch {
      if (enabledRef.current && token === operation.current)
        setError('模型答卷无法读取或未符合有界 JSON 协议；没有采用其判断。');
    } finally {
      if (token === operation.current) setReading(false);
    }
  };
  const exportPacket = () => {
    if (!enabledRef.current || !current) return;
    try {
      const packet = createComplexityReviewPacket(current.task, {
        enabled: true,
        requirementRevision: current.revision,
      });
      if (packet.status === 'ready') download('OpenCost-complexity-review-packet.json', packet);
    } catch {
      setError('当前记录未能生成模型核验包；请检查脱敏字段。');
    }
  };
  return (
    <section aria-label="本地复杂度实验">
      <h2>用两条路线检查任务要求</h2>
      <CodeMeasurementEntry />
      <p>
        程序根据脱敏字段生成要求画像；模型辅助路线按细则复核字段并单列领域要求判断，再由程序核验答卷结构与修订绑定。
        两条路线均未校准真实难度，不生成跨领域总分，不进入正式排名。
      </p>
      <Notice>
        默认关闭。启用后只处理你主动选择的本地文件，不上传、不调用模型、不扫描历史记录、不写入浏览器存储。关闭会清空本次页面中的任务与答卷。
      </Notice>
      <label className="ranking-optional-filter">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        允许在本浏览器进行复杂度试算
      </label>
      <div className="result-actions">
        <Button secondary disabled={!enabled || reading} onClick={() => taskInput.current?.click()}>
          选择脱敏任务文件
        </Button>
        <Button secondary disabled={!entries.length && !review} onClick={clear}>
          清空本次结果
        </Button>
      </div>
      <input
        hidden
        ref={taskInput}
        type="file"
        accept=".json,application/json"
        disabled={!enabled || reading}
        aria-label="导入脱敏任务 JSON"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          void loadTasks(file);
        }}
      />
      <input
        hidden
        ref={reviewInput}
        type="file"
        accept=".json,application/json"
        disabled={!current || reading}
        aria-label="导入模型答卷 JSON"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          void loadReview(file);
        }}
      />
      <p>
        支持单项 Task 或含 1–20 项任务的 Envelope JSON，最多 1 MiB。仅展示固定分类与计数，不展示原始
        JSON、任务内容或身份标识；多项任务逐项查看，不累加成难度总分。
      </p>
      {reading && <p role="status">正在本地读取与校验…</p>}
      {error && <Notice tone="warning">{error}</Notice>}
      {entries.length > 0 && (
        <label>
          选择本次任务
          <select
            value={selected}
            onChange={(event) => {
              operation.current++;
              setSelected(Number(event.target.value));
              setReview(null);
              setError('');
              setReading(false);
            }}
          >
            {entries.map((entry, index) => (
              <option key={index} value={index}>
                任务 {index + 1} · {labels.kind[entry.task.kind]}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && calculated?.status !== 'computed_unvalidated' && (
        <Notice tone="warning">当前任务未通过复杂度规则校验，未生成结果。</Notice>
      )}
      {calculated?.status === 'computed_unvalidated' && (
        <>
          <ComplexityProfileView result={calculated} />
          <h3>让模型按细则检查本地要求</h3>
          <p>
            下载包仅含允许的要求分类、来源声明、修订绑定、细则和空白答卷模板，不含费用、模型身份或任务原文。
            你可以自行交给已授权的本地
            Harness，允许其结合本地原要求选择领域条目，只输出固定分类与描述位置，不能复制原文；这一步可能消耗模型额度。本页面不会发送请求。
            将模型填好的 responseTemplate 对象另存为 JSON 后导入，程序会检查修订、快照和每个维度。
          </p>
          <div className="result-actions">
            <Button secondary disabled={reading} onClick={exportPacket}>
              下载模型核验包
            </Button>
            <Button secondary disabled={reading} onClick={() => reviewInput.current?.click()}>
              导入模型答卷
            </Button>
          </div>
          <p>
            答卷上限 64
            KiB。切换任务或重新导入任务后须使用相应核验包；未知字段应保留未知，模型不能自行补写工作量或覆盖程序结果。
          </p>
        </>
      )}
      {review && <ComplexityReviewView result={review} />}
    </section>
  );
}
