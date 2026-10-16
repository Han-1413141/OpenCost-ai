import { useState } from 'react';
import { difficultyFramework } from './difficulty-framework';
import { workUnitDefinitions, workUnits } from './work-taxonomy';
import { workSubjectCatalogue } from './work-subjects';
import { difficultyResearch, researchForWorkType } from './difficulty-evidence';
import { requirementFacets, requirementFacetGroups } from './difficulty-review';
import { CodeMeasurementEntry } from './CodeMeasurementEntry.js';
import { EconomicHistoryEntry } from './EconomicHistoryEntry.js';
import './work-standards.css';

export function WorkStandards() {
  const [domainId, setDomainId] = useState('software');
  const [typeId, setTypeId] = useState('software.frontend');
  const domain = difficultyFramework.domains.find((d) => d.domain === domainId)!;
  const profile =
    domain.subtypeProfiles.find((p) => p.workType === typeId) ?? domain.subtypeProfiles[0];
  const references = researchForWorkType(profile.workType, domain.domain);
  const sources = [...references.taskSources, ...references.domainSources].slice(0, 10);
  return (
    <section className="work-standards" aria-label="分领域工作标准">
      <h3>按具体工作查看判断方法与计量标准</h3>
      <p>
        难度评分保持关闭。下面按原任务要求说明判断依据，不把
        Token、耗时、轮次、失败或采用复杂方法变成难度分。
      </p>
      <CodeMeasurementEntry />
      <EconomicHistoryEntry />
      <div className="work-standard-selectors">
        <label>
          工作领域
          <select
            value={domain.domain}
            onChange={(e) => {
              setDomainId(e.target.value);
              setTypeId('');
            }}
          >
            {difficultyFramework.domains.map((d) => (
              <option key={d.domain} value={d.domain}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          具体工作
          <select value={profile.workType} onChange={(e) => setTypeId(e.target.value)}>
            {domain.subtypeProfiles.map((p) => (
              <option key={p.workType} value={p.workType}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="work-standard-focus">
        <strong>{profile.label}：先核对这些要求</strong>
        {profile.requirementChecks.map((q) => (
          <p key={q}>{q}</p>
        ))}
        <p>
          没有依据的条目为未知；“不适用”也要有原要求依据。混合工作分别看各部分，再核对整体整合验收。
        </p>
      </div>
      <details>
        <summary>领域判断条目与描述</summary>
        <p>四段描述用于逐条审阅，尚未标定成等级。不同领域的序号不能相加或直接比较。</p>
        {domain.criteria.map((c) => (
          <div className="work-standard-criterion" key={c.id}>
            <strong>{c.label}</strong>
            <ol>
              {c.anchors.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          </div>
        ))}
      </details>
      <details>
        <summary>完成量单位与去重规则</summary>
        <div className="table-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>单位</th>
                <th>计量依据</th>
                <th>重复处理</th>
              </tr>
            </thead>
            <tbody>
              {profile.units.map((unit) => (
                <tr key={unit}>
                  <th>{workUnits[unit]}</th>
                  <td>{workUnitDefinitions[unit].basis}</td>
                  <td>{workUnitDefinitions[unit].duplicateRule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>代码、算法与跨领域要求</summary>
        <p>
          同一学科可以涉及代码、算法、研究或创作。逐项根据原要求判断适用性，没有依据保持未知；这些条目不相加成难度分。
        </p>
        {requirementFacetGroups.map((group) => (
          <div className="work-standard-criterion" key={group.id}>
            <strong>{group.label}</strong>
            <ul>
              {requirementFacets
                .filter((f) => f.group === group.id)
                .map((f) => (
                  <li key={f.id}>
                    <b>{f.label}</b>：{f.requirement}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </details>
      <details>
        <summary>学科与使用场景</summary>
        <p>
          “做什么工作”“涉及什么学科”“用于工作、学习还是个人事务”分别记录。学科名称、职业和学历不会自动提高难度。
        </p>
        {workSubjectCatalogue.groups.map((group) => (
          <div className="work-standard-criterion" key={group.id}>
            <strong>{group.label}</strong>
            <p>{group.fields.map(([, label]) => label).join('、')}</p>
          </div>
        ))}
        <p>
          农业、地理、历史等主题可与算法、数据、研究、写作等活动组合。材料与模拟完成，需要与真实设备、环境中的动作证据区分。
        </p>
      </details>
      <details>
        <summary>论文、官方资料与覆盖缺口</summary>
        <p>
          已整理 {difficultyResearch.counts.uniqueSources} 个来源条目；
          {difficultyResearch.counts.typesWithTaskReferences} /{' '}
          {difficultyResearch.counts.workTypes}{' '}
          个细类匹配了任务或验收资料，未匹配的细类保留研究缺口。所有细类的难度规则均未完成真实任务校准。
        </p>
        <p>
          当前细类：
          {references.taskSources.length
            ? '有对应任务或验收资料'
            : '目前使用领域背景资料，专项研究待补'}
          。来源支持设计依据，不证明这些自编判断条目的识别准确率。
        </p>
        <ul>
          {sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>
              {source.year ? `（${source.year}）` : ''}
              <small className="work-source-reading">
                阅读范围：{source.readings.map((r) => r.readScope).join('；')}
              </small>
            </li>
          ))}
        </ul>
        <p>
          任务结构参考 Wood、Rasch/IRT 等研究；OECD 五级指标描述 AI
          整体能力。它们的适用对象不同，不能直接合成单次工作难度分。
        </p>
        <details>
          <summary>全部来源与阅读范围</summary>
          <ul>
            {difficultyResearch.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                <small className="work-source-reading">
                  {source.readings.map((r) => r.readScope).join('；')}
                </small>
              </li>
            ))}
          </ul>
        </details>
      </details>
      <details>
        <summary>方法与验收义务</summary>
        <p>
          先确定必须成立的条件，再选择适合的方法。这里列出候选方法，不表示这些方法都是本次任务的必要要求。
        </p>
        <p>{domain.methodCatalogue.map((m) => m.label).join('、')}</p>
        <ul>
          {profile.acceptanceObligations.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
