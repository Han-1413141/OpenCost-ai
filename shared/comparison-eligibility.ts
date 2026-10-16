import type { Comparison } from './analysis.js';
import { workDomainForType } from './work-taxonomy.js';

export const WORKLOAD_COMPARISON_VERSION = 'workload-comparison-1';
const requiredFields = [
  'workloadUnit',
  'inputUnits',
  'outputUnits',
  'inputSizeUnit',
  'inputSizeBand',
] as const;

export const workloadExclusionLabels = {
  task_domain: '任务所属领域及分类依据',
  mixed_components: '混合任务的细类组成',
  workloadUnit: '工作量单位',
  inputUnits: '输入数量档位',
  outputUnits: '输出数量档位',
  inputSizeUnit: '输入材料规模单位',
  inputSizeBand: '输入材料规模档位',
} as const;
export type WorkloadExclusion = keyof typeof workloadExclusionLabels;

// A minimum for matching recorded workload, not a difficulty or quality score.
// Preserve descriptive statistics even when a cohort cannot enter comparisons.
export function workloadComparisonEligibility(c: Comparison['cohort']) {
  const reasons: WorkloadExclusion[] = [];
  if (
    c.domain === 'other' &&
    (!workDomainForType(c.workType ?? '')?.parentDomains.includes('other') ||
      !['original_request', 'approved_change'].includes(c.classificationBasis))
  )
    reasons.push('task_domain');
  if (
    c.workType === 'mixed' &&
    (!c.componentTypes?.length ||
      c.componentTypes.some((part) => !workDomainForType(part.workType)))
  )
    reasons.push('mixed_components');
  for (const field of requiredFields) {
    const value = c[field];
    // Missing fields in an old response are unknown, never known zero.
    if (typeof value !== 'string' || value.length === 0 || value === 'unknown') reasons.push(field);
  }
  return { version: WORKLOAD_COMPARISON_VERSION, eligible: reasons.length === 0, reasons };
}
