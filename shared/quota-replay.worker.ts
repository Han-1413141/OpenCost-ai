import { replayQuota } from './quota-replay.js';
import { QuotaReplayInputSchema, quotaReplayLimits } from './quota-replay-schema.js';
import { prepareQuotaReplayFromObservations } from './quota-observation-import.js';
import { QuotaPlanComparisonSchema } from './quota-plan-comparison-schema.js';
import { compareQuotaPlans } from './quota-plan-comparison.js';
import { QuotaPortfolioSchema } from './quota-portfolio-schema.js';
import { compareQuotaPortfolio } from './quota-portfolio.js';
import {
  MonitorHistoryExportSchema,
  monitorHistoryExportPreview,
} from './monitor-history-export-schema.js';

// A new short-lived worker is created only after a local user action.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
scope.onmessage = (event) => {
  try {
    const { action, text } = event.data ?? {};
    if (
      !['inspect', 'run'].includes(action) ||
      typeof text !== 'string' ||
      new TextEncoder().encode(text).length > quotaReplayLimits.bytes
    )
      throw new Error();
    let raw = JSON.parse(text);
    let exportReport;
    if (raw?.format === 'opencost-monitor-history-export-1') {
      const exported = MonitorHistoryExportSchema.parse(raw);
      exportReport = monitorHistoryExportPreview(exported);
      if (exported.status !== 'complete' || !exported.input) {
        scope.postMessage({
          ok: true,
          action,
          exportReport,
          meta: null,
          preparedText: null,
          importReport: null,
        });
        return;
      }
      raw = exported.input;
    }
    if (raw?.version === 'quota-portfolio-1') {
      const input = QuotaPortfolioSchema.parse(raw);
      scope.postMessage(
        action === 'inspect'
          ? {
              ok: true,
              action,
              meta: {
                kind: 'portfolio',
                purchases: input.purchases.length,
                groups: input.routingGroups.length,
                requests: input.requests.length,
                horizonMs: input.window.horizonMs,
                currency: input.currency,
                preferences: input.preferences,
              },
            }
          : { ok: true, action, portfolio: compareQuotaPortfolio(input, { enabled: true }) },
      );
      return;
    }
    if (raw?.version === 'quota-plan-comparison-1') {
      const input = QuotaPlanComparisonSchema.parse(raw);
      if (action === 'inspect')
        scope.postMessage({
          ok: true,
          action,
          meta: {
            kind: 'plan_comparison',
            candidates: input.candidates.length,
            requests: input.requests.length,
            horizonMs: input.window.horizonMs,
            currency: input.currency,
            preferences: input.preferences,
          },
        });
      else
        scope.postMessage({
          ok: true,
          action,
          comparison: compareQuotaPlans(input, { enabled: true }),
        });
      return;
    }
    const imported =
      raw?.format === 'quota-observation-import-1'
        ? prepareQuotaReplayFromObservations(raw, { enabled: true })
        : null;
    if (imported && imported.status !== 'ready') {
      scope.postMessage({
        ok: true,
        action,
        importReport: imported,
        ...(exportReport ? { exportReport } : {}),
        meta: null,
        preparedText: null,
      });
      return;
    }
    const input = QuotaReplayInputSchema.parse(imported ? imported.input : raw);
    if (action === 'inspect') {
      scope.postMessage({
        ok: true,
        action,
        ...(exportReport ? { exportReport } : {}),
        ...(imported
          ? { importReport: { ...imported, input: null }, preparedText: JSON.stringify(input) }
          : {}),
        meta: {
          plan: input.plan,
          version: input.policyVersion,
          basis: input.basis,
          requests: input.requests.length,
          pools: input.pools.length,
          events: input.events.length,
          horizonMs: input.horizonMs,
          currency: input.cost.currency,
        },
      });
    } else scope.postMessage({ ok: true, action, result: replayQuota(input, { enabled: true }) });
  } catch {
    // No source text, account identifiers or exception details are reflected.
    scope.postMessage({
      ok: false,
      message: '输入结构或大小不符合额度回放协议；请按模板核对本地文件。',
    });
  }
};
