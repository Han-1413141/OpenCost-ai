import { randomUUID } from 'node:crypto';
import { sampleEnvelope } from '../shared/demo.js';
import { journalFixture } from './desktop-fixture.js';
import { codeReportFixture, codeRevision } from './code-measurement-import-fixture.js';
export function journalAnalysisInput() {
  const summary = journalFixture();
  summary.tasks[0].workType = 'software.backend';
  const task = structuredClone(sampleEnvelope().tasks[0]);
  task.kind = 'feature';
  task.requirementClassification = {
    version: 'task-classification-1',
    workType: 'software.backend',
    subjects: ['unknown'],
    useContext: 'occupational',
    basis: 'original_request',
    coverage: 'complete',
  };
  task.observations = {
    version: 'task-observations-1',
    requirements: {
      meta: {
        source: 'human_report',
        coverage: 'complete',
        timing: 'before_execution',
        missingReason: null,
      },
      clarity: 'specified',
      inputCondition: 'clean',
      solutionNovelty: 'adaptation',
      knowledge: 'specialist',
      reasoning: 'multi_step',
      methodFamilies: ['construction'],
      constraintKinds: ['correctness'],
      contextReuse: 'fresh',
    },
  };
  const a = randomUUID(),
    b = randomUUID(),
    alias = randomUUID(),
    u = randomUUID(),
    v = randomUUID();
  const input = {
    format: 'journal-analysis-input-1',
    target: { summaryId: summary.id, sourceRefs: summary.tasks[0].sourceRefs },
    task,
    requirementRevision: codeRevision,
    domainReview: {
      version: 'difficulty-local-review-1',
      root: {
        componentId: task.id,
        requirementVersion: codeRevision,
        annotation: {
          version: 'domain-difficulty-draft-2',
          requirementVersion: codeRevision,
          phase: 'original_request_review',
          domain: 'software',
          workType: 'software.backend',
          classificationState: 'supported',
          criteria: [
            {
              criterionId: 'software.behavior',
              applicability: 'applicable',
              state: 'supported',
              anchorIndex: 2,
              evidenceKind: 'original_requirement',
              coverage: 'complete',
              review: 'unreviewed',
            },
          ],
          requiredMethods: null,
          usedMethods: null,
          inputConditions: { missing: 'unknown', conflict: 'unknown', ambiguity: 'unknown' },
        },
      },
      parts: [],
    },
    dependencyGraph: {
      version: 'task-requirement-graph-1',
      taskId: task.id,
      requirementRevision: codeRevision,
      basis: 'original_request',
      source: 'human_report',
      coverage: 'complete',
      nodes: [
        { partId: a, requirementUnitId: u },
        { partId: b, requirementUnitId: v },
        { partId: alias, requirementUnitId: u },
      ],
      edges: [
        { from: a, to: b, kind: 'dependency' },
        { from: alias, to: b, kind: 'dependency' },
      ],
      sharedStateGroups: [
        [a, b],
        [alias, b],
      ],
    },
    reports: [
      codeReportFixture(
        'function private_task(x:number){if(x>0)return x;return 0;}',
        'before_execution',
      ),
      codeReportFixture(
        'function private_task(x:number){return Math.max(x,0);}',
        'after_execution',
      ),
    ],
  };
  return { summary, input };
}
