import { analyzeEconomicHistory } from './economic-history.js';
import { economicHistoryLimits } from './economic-history-schema.js';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
scope.onmessage = (event) => {
  try {
    const text = event.data?.text;
    if (
      typeof text !== 'string' ||
      new TextEncoder().encode(text).length > economicHistoryLimits.bytes
    )
      throw new Error();
    scope.postMessage({
      ok: true,
      report: analyzeEconomicHistory(JSON.parse(text), { enabled: true }),
    });
  } catch {
    scope.postMessage({ ok: false });
  }
};
