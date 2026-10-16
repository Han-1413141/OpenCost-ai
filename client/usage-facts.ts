import { z } from 'zod';
import { UsageSchema } from '../shared/schema.js';

// Local inputs need only measured fields. Defaults describe missing information,
// never absent consumption. This does not relax the uploaded protocol.
export const LocalUsageSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  const snapshot = raw.priceSnapshot as { version?: unknown } | undefined;
  return {
    version: 'unknown', inputTokens: null, outputTokens: null,
    cachedInputTokens: null, cacheWriteTokens: null, reasoningTokens: null,
    apiEquivalentMinor: null, priceVersion: snapshot?.version ?? null, priceSnapshot: null,
    ...raw,
  };
}, UsageSchema);
