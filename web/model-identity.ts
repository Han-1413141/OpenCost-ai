import type { Comparison } from '../shared/analysis';
import { nameModel } from '../shared/catalog';
import { isModelIdentity, modelIdentityKey } from '../shared/model-identity';
import { canonical } from '../shared/schema';

export const legacyModelIdentityLabel = '旧口径 · 模型身份未记录';

// Identity fields come from the producer. Display strings and ranking IDs are never parsed.
export function modelIdentityDetails(value: unknown) {
  if (!isModelIdentity(value)) return legacyModelIdentityLabel;
  return value.members.map((member) => `${member.provider} · ${member.version}`).join(' + ');
}

export function comparisonModelChoice(row: Comparison) {
  const identityKey = modelIdentityKey(row.cohort.modelIdentity);
  return {
    key: identityKey ?? canonical({ legacyModelRecord: row.id }),
    label: `${row.modelIds.map(nameModel).join(' + ')} · ${modelIdentityDetails(row.cohort.modelIdentity)}`,
  };
}

export function comparisonModelVersion(row: Comparison) {
  if (!isModelIdentity(row.cohort.modelIdentity))
    return `${row.cohort.models} · ${legacyModelIdentityLabel}`;
  return row.cohort.models;
}
