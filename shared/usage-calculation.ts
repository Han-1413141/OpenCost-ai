import type { Envelope } from './schema.js';
import { analyze } from './analysis.js';
import { evaluatePriceMetering, summarizePriceMetering } from './price-metering.js';

/** Identical deterministic diagnostics in the local preview and cloud preview. */
export function calculateUsage(envelope: Envelope) {
  const analysis = analyze(envelope);
  return {
    version: 'usage-calculation-1' as const,
    totalTokens: analysis.tokens,
    tokenRule: 'input_includes_cache_output_includes_reasoning' as const,
    actualNetMinor: analysis.net,
    actualPaymentKnown: analysis.net !== null,
    currency: envelope.period.currency,
    apiEquivalentMinor: analysis.equivalentMinor,
    pricing: summarizePriceMetering(envelope.tasks.flatMap(t => t.models), envelope.period.currency),
    rows: envelope.tasks.flatMap(task => task.models.map(usage => ({
      taskId: task.id, provider: usage.provider, model: usage.model,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens ?? null,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.inputTokens !== null && usage.outputTokens !== null ? usage.inputTokens + usage.outputTokens : null,
      pricing: evaluatePriceMetering(usage, envelope.period.currency),
    }))),
  };
}
