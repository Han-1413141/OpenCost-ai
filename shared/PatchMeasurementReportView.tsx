import {
  patchRoles,
  patchFlags,
  patchKinds,
  type PatchMeasurementReport,
} from './patch-measurement-schema.js';

const number = (value: number | null) =>
  value === null ? '不适用或未知' : value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const roles = {
  implementation: '实现代码',
  test: '测试',
  documentation: '文档',
  configuration: '配置',
  data: '数据',
  other: '其他',
  unknown: '用途未知',
};
const flags = { yes: '声明是', no: '声明否', unknown: '未声明' };
const kinds = {
  added: '新增',
  deleted: '删除',
  renamed: '重命名',
  copied: '复制',
  modified: '内容修改',
  metadata_only: '仅元数据',
};
const stages = {
  proposed: '补丁提案',
  during_execution: '执行中',
  after_execution: '执行后',
  unknown: '阶段未知',
};
const scopeLabels = {
  complete: '完整所选范围（用户声明）',
  partial: '部分范围或有未测得内容',
  unknown: '范围未知',
};
const statusLabels = {
  disabled: '生成时未开启测量',
  measured: '所选补丁解析完成',
  partial: '已解析文件结构，部分内容未测得',
  unavailable: '未得到可用数值',
};
const reasons: Record<string, string> = {
  invalid_manifest: '选择清单无效',
  source_unavailable: '所选补丁无法稳定读取',
  source_changed: '读取期间补丁改变',
  input_limit: '所选补丁超过容量',
  unsupported_format: '存在未支持的补丁格式',
  invalid_patch: '完整输入、修改块或文件关系校验未通过',
  classification_mismatch: '用途声明未能准确关联所选文件',
  parser_unavailable: '固定版本解析器不可用',
  parse_error: '解析或结果校验未通过',
  operation_limit: '文件、行或修改块超出本次处理容量',
};
type Metrics = NonNullable<PatchMeasurementReport['metrics']>;
function classificationTable(
  axis: Metrics['classifications']['byRole'],
  labels: Record<string, string>,
  title: string,
) {
  return (
    <div className="code-measurement-scroll">
      <table>
        <caption>{title} · 均为用户声明</caption>
        <thead>
          <tr>
            <th>声明类别</th>
            <th>文件</th>
            <th>文本可计量</th>
            <th>内容未测得</th>
            <th>已知新增</th>
            <th>已知删除</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(axis).map(([key, b]) => (
            <tr key={key}>
              <th>{labels[key]}</th>
              <td>{number(b.files)}</td>
              <td>{number(b.knownTextFiles)}</td>
              <td>{number(b.unmeasuredFiles)}</td>
              <td>{number(b.addedLines)}</td>
              <td>{number(b.deletedLines)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function PatchMeasurementReportView({
  report,
  title,
}: {
  report: PatchMeasurementReport;
  title: string;
}) {
  const m = report.metrics;
  return (
    <article className="code-measurement-report" aria-label={title}>
      <h4>{title} · 补丁结构</h4>
      <p>
        <strong>{statusLabels[report.status]}</strong>
      </p>
      <p>
        方法{report.algorithm}，解析器jsdiff {report.parser.version}
        。只统计所选差异文本，没有应用补丁、执行代码或核对原文件。
        补丁可能尚未应用，不计为已完成目标，不进入难度或性价比排名。
      </p>
      {report.status !== 'disabled' && (
        <>
          <p>
            {stages[report.stage]} · 阶段依据：用户声明 · 原要求修订：
            {report.requirementRevision ? '已记录，仅在本地关联' : '未记录'}
            <br />
            测量时间：{report.measuredAt ?? '未知'} · 输入{number(report.inputBytes)}
            字节。输入大小不是源码工作量。
          </p>
          {report.scope && (
            <p>
              覆盖：{scopeLabels[report.scope.coverage]}
              。只描述用户所选补丁，不证明整个项目、所有改动或实际任务完整。
            </p>
          )}
          {report.status === 'unavailable' && (
            <p role="status">
              原因：{reasons[report.reason] ?? '本次未测得'}。未采用可解析部分作为完整结果。
            </p>
          )}
          {report.generation && (
            <details>
              <summary>差异生成条件</summary>
              <p>
                声明的上下文行数：{number(report.generation.contextLines)}；算法：
                {report.generation.algorithm}； 空白忽略：
                {
                  { none: '未忽略', some: '忽略了部分空白差异', unknown: '未知' }[
                    report.generation.whitespaceIgnored
                  ]
                }
                ； 重命名检测：
                {
                  { enabled: '开启', disabled: '关闭', unknown: '未知' }[
                    report.generation.renameDetection
                  ]
                }
                。 修改块数量与生成设置有关；忽略、过滤或未包含的改动没有被补算。
              </p>
            </details>
          )}
        </>
      )}
      {m && (
        <>
          <div className="code-measurement-facts">
            {[
              ['文件', m.totalFiles],
              ['文本可计量文件', m.knownTextFiles],
              ['二进制内容未测得', m.binaryFiles],
              ['内容未测得文件', m.unmeasuredContentFiles],
              ['有文本改动文件', m.filesWithTextChanges],
              ['已知新增行', m.addedLines],
              ['已知删除行', m.deletedLines],
              ['增删条目', m.changedLineEntries],
              ['净行数变化', m.netLineChange],
              ['修改块', m.hunks],
              ['连续改动段', m.editRuns],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{number(value as number)}</strong>
              </div>
            ))}
          </div>
          <p>
            增删条目为新增加删除，一行替换通常贡献两条，不是独立语义改动数。二进制文件的文本增删未知，不按零合入分布。
            内容未测得还包括只有内容变化元数据、缺少修改块或空文件依据的记录。
            已知没有文本改动的文件{number(m.knownFilesWithoutTextChanges)}
            个，保留为已知零；纯重命名不制造文本工作量。
          </p>
          <div className="code-measurement-scroll">
            <table>
              <caption>文件操作类型（每个文件恰属一类）</caption>
              <thead>
                <tr>
                  <th>操作</th>
                  <th>文件</th>
                </tr>
              </thead>
              <tbody>
                {patchKinds.map((k) => (
                  <tr key={k}>
                    <th>{kinds[k]}</th>
                    <td>{number(m.fileKinds[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            另有权限或模式变化{number(m.modeChanges)}个、符号链接或子模块模式
            {number(m.specialModeEntries)}个；这些计数可以和文件类型重叠。
          </p>
          <div className="code-measurement-scroll">
            <table>
              <caption>按可计量文本文件汇总的分布；P90为第90百分位</caption>
              <thead>
                <tr>
                  <th>指标</th>
                  <th>文件数</th>
                  <th>总量</th>
                  <th>中位数</th>
                  <th>P90</th>
                  <th>最大值</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['addedLines', '新增行'],
                    ['deletedLines', '删除行'],
                    ['changedLineEntries', '增删条目'],
                    ['hunks', '修改块'],
                    ['editRuns', '连续改动段'],
                  ] as const
                ).map(([key, label]) => {
                  const d = m.fileDistributions[key];
                  return (
                    <tr key={key}>
                      <th>{label}</th>
                      <td>{number(d.count)}</td>
                      <td>{number(d.sum)}</td>
                      <td>{number(d.median)}</td>
                      <td>{number(d.p90)}</td>
                      <td>{number(d.max)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details>
            <summary>改动分散程度与空白观察</summary>
            <p>
              仅以已知文本的增删条目为分母：最大文件占比
              {m.dispersion.largestFileShare === null
                ? '不适用'
                : `${number(m.dispersion.largestFileShare * 100)}%`}
              ， 占比平方和{number(m.dispersion.concentration)}，其倒数
              {number(m.dispersion.effectiveFileCount)}。
              例如两份文件各占一半，平方和为0.5、倒数为2；没有领域阈值或好坏判断，也不表示两项任务或依赖耦合。
            </p>
            <p>
              新增空白行{number(m.blankAddedLines)}、删除空白行{number(m.blankDeletedLines)}
              ；上下文行{number(m.contextLines)}。{number(m.asciiWhitespaceEquivalentRuns)}
              个改动段在移除ASCII空格、制表、回车和换行后文本相同。
              这不能证明仅格式化：字符串中的空格、Python缩进或其他空白也可能改变行为。
            </p>
          </details>
          <details>
            <summary>文件用途、生成代码与格式化声明</summary>
            <p>
              精确关联到本地声明{number(m.classifications.mappedFiles)}个文件，未提供声明
              {number(m.classifications.unmappedFiles)}个。
              不按文件名自动猜用途，没有推断代码作者，也没有扣除“生成”或“仅格式化”的工作量。三张表是同一批文件的不同分类，不能跨表相加。
            </p>
            {classificationTable(
              m.classifications.byRole,
              Object.fromEntries(patchRoles.map((k) => [k, roles[k]])),
              '用途',
            )}
            {classificationTable(
              m.classifications.generated,
              Object.fromEntries(patchFlags.map((k) => [k, flags[k]])),
              '是否生成代码',
            )}
            {classificationTable(
              m.classifications.formattingOnly,
              Object.fromEntries(patchFlags.map((k) => [k, flags[k]])),
              '是否仅格式化',
            )}
          </details>
        </>
      )}
    </article>
  );
}
