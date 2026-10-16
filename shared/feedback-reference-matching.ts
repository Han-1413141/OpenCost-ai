import type { Comparison, StoredRecord } from './analysis.js';
import { canonical } from './schema.js';
import { hasComparableCostAttribution } from './cost-attribution.js';
import { hasComparableHarnessComposition } from './harness-composition.js';
import { workloadComparisonEligibility } from './comparison-eligibility.js';
import { isModelIdentity } from './model-identity.js';

export function feedbackWorkKey(c: Comparison['cohort']) {
  return canonical({
    evaluation: c.evaluation,
    domain: c.domain,
    kind: c.kind,
    workType: c.workType ?? 'unknown',
    subjects: c.subjects ?? [],
    componentTypes: c.componentTypes ?? null,
    useContext: c.useContext ?? 'unknown',
    classificationBasis: c.classificationBasis ?? 'unknown',
    scope: c.scope,
    context: c.context,
    acceptance: c.acceptance,
    acceptanceBand: c.acceptanceBand,
    dependencies: c.dependencies,
    requirementsLocked: c.requirementsLocked,
    workloadUnit: c.workloadUnit,
    inputUnits: c.inputUnits,
    outputUnits: c.outputUnits,
    constraintCount: c.constraintCount,
    verification: c.verification,
    inputSizeUnit: c.inputSizeUnit,
    inputSizeBand: c.inputSizeBand,
  });
}
function sameCosts(
  candidate: Comparison['cohort'],
  own: Comparison['cohort'],
  allowCrossBilling: boolean,
) {
  return (
    hasComparableCostAttribution(candidate) &&
    hasComparableCostAttribution(own) &&
    candidate.currency === own.currency &&
    candidate.costCoverage === own.costCoverage &&
    ((candidate.allocation === own.allocation &&
      canonical(candidate.costAttributionPolicy ?? null) ===
        canonical(own.costAttributionPolicy ?? null)) ||
      (allowCrossBilling && candidate.billing !== own.billing)) &&
    candidate.month <= own.month
  );
}
export function sameFeedbackConditions(
  candidate: Comparison['cohort'],
  own: Comparison['cohort'],
  allowCrossBilling = false,
) {
  return (
    feedbackWorkKey(candidate) === feedbackWorkKey(own) &&
    sameCosts(candidate, own, allowCrossBilling)
  );
}
export function sameFeedbackEvidence(
  evidence: Comparison['evidence'],
  own: StoredRecord['evidence'],
  mode: 'verified' | 'recorded',
) {
  return mode === 'verified'
    ? evidence.cost === 'C2' && evidence.work === 'W2' && evidence.coverage === 'verified'
    : evidence.cost === own.cost &&
        evidence.work === own.work &&
        evidence.coverage === own.coverage;
}
function eligible(row: Comparison) {
  return (
    isModelIdentity(row.cohort.modelIdentity) &&
    workloadComparisonEligibility(row.cohort).eligible &&
    hasComparableHarnessComposition(row.cohort)
  );
}
export function selectFeedbackReferences(
  rows: Comparison[],
  own: Comparison['cohort'],
  evidence: StoredRecord['evidence'],
  mode: 'verified' | 'recorded',
) {
  const key = feedbackWorkKey(own);
  return rows.filter(
    (row) =>
      eligible(row) &&
      feedbackWorkKey(row.cohort) === key &&
      sameCosts(row.cohort, own, true) &&
      sameFeedbackEvidence(row.evidence, evidence, mode),
  );
}

export const feedbackReferenceIndexLimits = { rows: 10000, bytes: 4 * 1024 * 1024 } as const;
const encoder = new TextEncoder();

/** Positions only; source arrays are weakly referenced and never retained. */
export class FeedbackReferenceIndex {
  private constructor(
    private readonly source: WeakRef<Comparison[]>,
    private readonly length: number,
    private readonly buckets: Map<string, Uint32Array>,
    readonly bytes: number,
    readonly indexedRows: number,
  ) {}

  static create(
    rows: Comparison[],
    maxBytes: number = feedbackReferenceIndexLimits.bytes,
  ): FeedbackReferenceIndex | null {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new RangeError('反馈参照索引容量无效');
    if (rows.length > feedbackReferenceIndexLimits.rows) return null;
    const groups = new Map<string, number[]>();
    let bytes = 0,
      indexedRows = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!eligible(row)) continue;
      const key = feedbackWorkKey(row.cohort);
      let positions = groups.get(key);
      if (!positions) {
        bytes += encoder.encode(key).byteLength + 48;
        if (bytes > maxBytes) return null;
        positions = [];
        groups.set(key, positions);
      }
      bytes += Uint32Array.BYTES_PER_ELEMENT;
      if (bytes > maxBytes) return null;
      positions.push(index);
      indexedRows++;
    }
    return new FeedbackReferenceIndex(
      new WeakRef(rows),
      rows.length,
      new Map([...groups].map(([key, positions]) => [key, Uint32Array.from(positions)])),
      bytes,
      indexedRows,
    );
  }

  /** Callers reusing an index must supply the same immutable analytical snapshot. */
  select(
    rows: Comparison[],
    own: Comparison['cohort'],
    evidence: StoredRecord['evidence'],
    mode: 'verified' | 'recorded',
  ): Comparison[] | null {
    if (this.source.deref() !== rows || rows.length !== this.length) return null;
    const positions = this.buckets.get(feedbackWorkKey(own));
    if (!positions) return [];
    const selected: Comparison[] = [];
    for (const index of positions) {
      const row = rows[index];
      if (
        eligible(row) &&
        sameCosts(row.cohort, own, true) &&
        sameFeedbackEvidence(row.evidence, evidence, mode)
      )
        selected.push(row);
    }
    return selected;
  }
}
