import { canonical } from './schema.js';

export type ModelIdentityMember = { provider: string; model: string; version: string };
export type ModelIdentity = {
  version: 'model-identity-1';
  members: ModelIdentityMember[];
};

const compare = (a: ModelIdentityMember, b: ModelIdentityMember) => {
  for (const key of ['provider', 'model', 'version'] as const) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
};

// A product identifier can itself contain ':' and '+'. Delimited display labels
// are therefore never an identity or a source from which to reconstruct one.
export function modelIdentity(models: readonly ModelIdentityMember[]): ModelIdentity {
  const sorted = models
    .map(({ provider, model, version }) => ({ provider, model, version }))
    .sort(compare);
  return {
    version: 'model-identity-1',
    members: sorted.filter((member, index) => index === 0 || compare(sorted[index - 1], member)),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isProductId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 72 &&
  /^[a-z0-9][a-z0-9._:+-]*$/.test(value);

export function isModelIdentity(value: unknown): value is ModelIdentity {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 2 ||
    value.version !== 'model-identity-1' ||
    !Array.isArray(value.members) ||
    value.members.length < 1 ||
    value.members.length > 64
  )
    return false;
  let previous: ModelIdentityMember | undefined;
  for (const member of value.members) {
    if (
      !isObject(member) ||
      Object.keys(member).length !== 3 ||
      !isProductId(member.provider) ||
      !isProductId(member.model) ||
      !isProductId(member.version)
    )
      return false;
    const current = member as ModelIdentityMember;
    if (previous && compare(previous, current) >= 0) return false;
    previous = current;
  }
  return true;
}

// A null key deliberately keeps legacy aggregate labels out of new comparisons.
// Raw historical records can instead be recompiled from their original triples.
export function modelIdentityKey(value: unknown): string | null {
  return isModelIdentity(value) ? canonical(value) : null;
}
