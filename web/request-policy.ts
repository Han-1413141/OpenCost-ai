/** Data kept only for the lifetime of one public page component, with no background refresh. */
export class PageRequests<T> {
  private readonly values = new Map<string, T>();
  private pending: { key: string; controller: AbortController; promise: Promise<T> } | null = null;

  constructor(
    private readonly load: (key: string, signal: AbortSignal) => Promise<T>,
    private readonly capacity = 1,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2)
      throw new Error('Page request capacity must be 1 or 2');
  }

  get busy() {
    return this.pending !== null;
  }

  read(key: string): Promise<T> {
    if (this.pending?.key === key) return this.pending.promise;
    this.cancel();
    if (this.values.has(key)) return Promise.resolve(this.values.get(key)!);
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return this.load(key, controller.signal);
      })
      .then((value) => {
        // Some loaders finish despite cancellation. Never retain that stale response.
        controller.signal.throwIfAborted();
        this.values.set(key, value);
        while (this.values.size > this.capacity)
          this.values.delete(this.values.keys().next().value!);
        return value;
      })
      .finally(() => {
        if (this.pending?.controller === controller) this.pending = null;
      });
    this.pending = { key, controller, promise };
    return promise;
  }

  invalidate(key: string) {
    this.values.delete(key);
  }

  cancel() {
    const current = this.pending;
    this.pending = null;
    current?.controller.abort();
  }
}

export function usesExplorePage(page: string) {
  return [
    'overview',
    'compare',
    'ranking',
    'plans',
    'harness',
    'process',
    'trends',
    'recommend',
  ].includes(page);
}

export function resolveExploreSource(search: string, previewEnabled: unknown) {
  return new URLSearchParams(search).get('preview') === '1' && previewEnabled === true
    ? 'demo'
    : 'community';
}
