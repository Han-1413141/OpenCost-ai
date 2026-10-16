import { canonical, type Envelope, type Task } from './schema.js';
import type { StoredRecord } from './analysis.js';

export const settlementRevisionPolicy = 'settlement-revision-1';
export type SettlementState = 'active' | 'superseded' | 'conflict' | 'unknown';

export function settlementPeriodIdentity(e: Envelope) {
  const p = e.period;
  return canonical([
    e.origin,
    p.id,
    p.month,
    p.currency,
    p.billing,
    p.plan,
    p.planVersion,
    p.subscriptionRef ?? null,
  ]);
}
// Required structure only: results, usage, price and execution configuration may change.
export function settlementTaskRequirements(t: Task) {
  const e = t.evaluation,
    s = e?.version === 'work-summary-1' ? e.workStructure : null;
  const structure = s
    ? {
        basis: s.basis,
        coverage: s.coverage,
        componentCount: s.componentCount,
        requiredComponentCount: s.requiredComponentCount,
        dependencyEdges: s.dependencyEdges,
        dependencyDepth: s.dependencyDepth,
        sharedStateGroups: s.sharedStateGroups,
        feedbackLinks: s.feedbackLinks,
        feedbackCycles: s.feedbackCycles,
        integrationRequired: s.integrationRequired,
        coupling: s.coupling,
        observed: s.observed,
      }
    : null;
  return {
    id: t.id,
    kind: t.kind,
    scope: t.scope,
    context: t.context,
    acceptance: t.acceptance,
    acceptanceTotal: t.acceptanceTotal,
    dependencies: t.dependencies,
    requirementsLocked: t.requirementsLocked,
    workload: t.workload ?? null,
    classification: t.requirementClassification ?? null,
    evaluation: e
      ? {
          version: e.version,
          requirements: e.requirements,
          structure,
          planned:
            e.version === 'work-summary-1'
              ? (e.completedWork
                  ?.map((w) => ({
                    kind: w.kind,
                    workType: w.workType,
                    unit: w.unit,
                    planned: w.planned,
                  }))
                  .sort((a, b) => canonical(a).localeCompare(canonical(b))) ?? null)
              : null,
        }
      : null,
    requirementsObservation: t.observations?.requirements ?? null,
  };
}
export function settlementRequirementsIdentity(e: Envelope) {
  return canonical(
    e.tasks.map(settlementTaskRequirements).sort((a, b) => a.id.localeCompare(b.id)),
  );
}
export function validateSettlementReplacement(
  parent: Pick<StoredRecord, 'id' | 'owner' | 'envelope' | 'digest'>,
  child: Pick<StoredRecord, 'owner' | 'envelope'>,
): string | null {
  const s = child.envelope.settlement,
    previous = parent.envelope.settlement;
  if (!s?.replaces || s.replaces.recordId !== parent.id) return 'missing_parent_reference';
  if (child.owner !== parent.owner) return 'owner_mismatch';
  if (parent.digest === undefined) return 'parent_digest_unknown';
  if (s.replaces.digest !== parent.digest) return 'parent_digest_mismatch';
  if (
    s.replaces.revision !== (previous?.revision ?? 0) ||
    s.revision !== (previous?.revision ?? 0) + 1
  )
    return 'revision_mismatch';
  if (settlementPeriodIdentity(parent.envelope) !== settlementPeriodIdentity(child.envelope))
    return 'period_mismatch';
  if (
    settlementRequirementsIdentity(parent.envelope) !==
    settlementRequirementsIdentity(child.envelope)
  )
    return 'requirements_mismatch';
  if (
    previous &&
    canonical([...previous.requirements].sort((a, b) => a.taskId.localeCompare(b.taskId))) !==
      canonical([...s.requirements].sort((a, b) => a.taskId.localeCompare(b.taskId)))
  )
    return 'requirements_reference_mismatch';
  return null;
}

export function receivedBy(record: StoredRecord, cutoff: StoredRecord) {
  if (cutoff.receivedSequence !== undefined && record.receivedSequence !== undefined)
    return record.receivedSequence <= cutoff.receivedSequence;
  return Date.parse(record.createdAt) <= Date.parse(cutoff.createdAt);
}

/** Relation resolution precedes public/evidence/complete-cost filters. */
export function settlementStates(
  records: readonly StoredRecord[],
  options: { acceptedHeads?: boolean } = {},
): Map<StoredRecord, SettlementState> {
  const states = new Map<StoredRecord, SettlementState>();
  if (
    !records.some(
      (r) => r.envelope.settlement || r.settlementVerified === false || r.acceptedSettlementState,
    )
  ) {
    for (const r of records) states.set(r, 'active');
    return states;
  }
  const key = (r: Pick<StoredRecord, 'owner' | 'id'>) => canonical([r.owner, r.id]);
  const nodes = new Map<string, StoredRecord>(),
    duplicates = new Map<string, StoredRecord[]>();
  for (const r of records) {
    const k = key(r),
      old = nodes.get(k);
    if (old) {
      if (canonical(old.envelope) !== canonical(r.envelope)) {
        duplicates.set(k, [...(duplicates.get(k) ?? [old]), r]);
      } else states.set(r, 'active');
    } else nodes.set(k, r);
  }
  const parentOf = new Map<string, string>(),
    children = new Map<string, string[]>(),
    invalid = new Set<string>();
  for (const [k, r] of nodes) {
    states.set(r, duplicates.has(k) ? 'conflict' : 'active');
    if (options.acceptedHeads && r.acceptedSettlementState && !duplicates.has(k)) {
      states.set(r, r.acceptedSettlementState);
      continue;
    }
    if (r.settlementVerified === false) {
      states.set(r, 'unknown');
      invalid.add(k);
    }
    const link = r.envelope.settlement?.replaces;
    if (!link) continue;
    const pkey = canonical([r.owner, link.recordId]),
      parent = nodes.get(pkey);
    if (!parent) {
      states.set(r, 'unknown');
      invalid.add(k);
      continue;
    }
    parentOf.set(k, pkey);
    children.set(pkey, [...(children.get(pkey) ?? []), k]);
    const failure = validateSettlementReplacement(parent, r);
    if (failure) {
      states.set(r, failure === 'parent_digest_unknown' ? 'unknown' : 'conflict');
      invalid.add(k);
    }
  }
  const parents = new Map([...nodes.keys()].map((k) => [k, k]));
  const find = (key: string) => {
    let root = key;
    while (parents.get(root) !== root) root = parents.get(root)!;
    let cursor = key;
    while (parents.get(cursor) !== cursor) {
      const next = parents.get(cursor)!;
      parents.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const [child, parent] of parentOf) {
    const a = find(child),
      b = find(parent);
    if (a !== b) parents.set(a, b);
  }
  const brokenRoots = new Map<string, SettlementState>();
  for (const [k, r] of nodes) {
    const root = find(k);
    if (invalid.has(k) || duplicates.has(k)) {
      const next = states.get(r) === 'unknown' && !duplicates.has(k) ? 'unknown' : 'conflict';
      if (brokenRoots.get(root) !== 'conflict') brokenRoots.set(root, next);
    }
    if ((children.get(k)?.length ?? 0) > 1) brokenRoots.set(root, 'conflict');
  }
  for (const [k, r] of nodes) {
    const root = find(k),
      broken = brokenRoots.get(root);
    states.set(
      r,
      duplicates.has(k)
        ? 'conflict'
        : options.acceptedHeads && r.acceptedSettlementState
          ? r.acceptedSettlementState
          : (broken ?? ((children.get(k)?.length ?? 0) > 0 ? 'superseded' : 'active')),
    );
    for (const duplicate of duplicates.get(k) ?? []) states.set(duplicate, 'conflict');
  }
  // Identical repeated snapshots share the resolved state, not an independent attempt.
  for (const r of records) {
    const original = nodes.get(key(r));
    if (original && !duplicates.has(key(r))) states.set(r, states.get(original)!);
  }
  return states;
}
