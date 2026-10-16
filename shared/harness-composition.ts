import { z } from 'zod';
import { canonical, HarnessIdentitySchema } from './schema.js';

type Harness = z.infer<typeof HarnessIdentitySchema>;
const member = (h: Harness) => ({
  id: h.id,
  version: h.version,
  variant: h.variant ?? null,
  surface: h.surface ?? 'unknown',
});
const CompositionSchema = z
  .object({
    version: z.literal('harness-composition-1'),
    members: z.array(HarnessIdentitySchema).min(2).max(64),
  })
  .strict();
export type HarnessComposition = {
  version: 'harness-composition-1';
  members: ReturnType<typeof member>[];
};

/** Public product identities only; collection order and duplicate entries are irrelevant. */
export function harnessComposition(harnesses: readonly Harness[]): HarnessComposition {
  const members = new Map(harnesses.map((h) => [canonical(member(h)), member(h)]));
  return {
    version: 'harness-composition-1',
    members: [...members].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, h]) => h),
  };
}

export function isHarnessComposition(value: unknown): value is HarnessComposition {
  const parsed = CompositionSchema.safeParse(value);
  return parsed.success && canonical(value) === canonical(harnessComposition(parsed.data.members));
}

type HarnessCohort = {
  harness: string;
  harnessVersion: string;
  harnessVariant?: string | null;
  harnessSurface?: Harness['surface'];
  harnessAttribution?: string;
  harnessComposition?: HarnessComposition;
};

export function hasComparableHarnessComposition(c: HarnessCohort): boolean {
  if (c.harnessAttribution === 'unknown') return false;
  if (c.harnessAttribution !== 'mixed') return c.harnessComposition === undefined;
  if (!isHarnessComposition(c.harnessComposition)) return false;
  const primary = canonical(
    member({
      id: c.harness,
      version: c.harnessVersion,
      variant: c.harnessVariant,
      surface: c.harnessSurface,
    }),
  );
  return c.harnessComposition.members.some((h) => canonical(h) === primary);
}

/** Bounded display text; the structured field retains the full participating list. */
export function harnessCompositionLabel(
  c: HarnessCohort,
  name: (id: string) => string = (id) => id,
) {
  if (c.harnessAttribution === 'mixed') {
    if (!hasComparableHarnessComposition(c)) return '多 Harness（参与名单未完整记录）';
    const members = c.harnessComposition!.members;
    const label = members
      .slice(0, 2)
      .map(
        (h) =>
          `${name(h.id)} ${h.version}${h.variant ? ` / ${h.variant}` : ''}${h.surface !== 'unknown' ? ` / ${h.surface}` : ''}`,
      )
      .join(' + ');
    return `多 Harness：${label}${members.length > 2 ? `，另有 ${members.length - 2} 个` : ''}`;
  }
  return `${name(c.harness)} ${c.harnessVersion}${c.harnessAttribution === 'unknown' ? '（参与范围未知）' : ''}`;
}
