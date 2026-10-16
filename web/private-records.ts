import {
  ContributionDetailSchema,
  ContributionIndexPageSchema,
  type ContributionDetail,
  type ContributionIndexEntry,
} from '../shared/contribution-history';
import { api } from './api';

type DetailLoader = (owner: string, id: string, signal: AbortSignal) => Promise<unknown>;

const cancelled = () => new DOMException('访问身份或页面已改变。', 'AbortError');

/** Private details live only in this workspace instance. Never use persistent/shared caching. */
export class PrivateRecordDetails {
  private owner = '';
  private generation = 0;
  private readonly values = new Map<string, ContributionDetail>();
  private readonly pending = new Map<
    string,
    { controller: AbortController; promise: Promise<ContributionDetail>; consumers: Set<symbol> }
  >();

  constructor(
    private readonly load: DetailLoader = (owner, id, signal) =>
      api(`/api/contributions/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${owner}` },
        signal,
      }),
  ) {}

  reset(owner = '') {
    this.generation++;
    this.owner = owner;
    for (const { controller } of this.pending.values()) controller.abort(cancelled());
    this.pending.clear();
    this.values.clear();
  }

  private read(owner: string, entry: Pick<ContributionIndexEntry, 'id' | 'digest'>) {
    if (!owner || owner !== this.owner) return Promise.reject(cancelled());
    const key = `${entry.id}:${entry.digest}`;
    const existing = this.pending.get(key);
    if (existing) return existing.promise;
    const saved = this.values.get(key);
    if (saved) {
      this.values.delete(key);
      this.values.set(key, saved);
      return Promise.resolve(saved);
    }
    if (this.pending.size >= 2) return Promise.reject(new Error('正在读取其他记录，请稍后重试。'));
    const generation = this.generation;
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return this.load(owner, entry.id, controller.signal);
      })
      .then((value) => {
        controller.signal.throwIfAborted();
        if (this.generation !== generation || this.owner !== owner) throw cancelled();
        const parsed = ContributionDetailSchema.safeParse(value);
        if (!parsed.success) throw new Error('记录详情格式不符合预期。');
        const detail = parsed.data;
        if (detail.record.id !== entry.id || detail.record.digest !== entry.digest)
          throw new Error('详情与当前记录索引不匹配，请刷新记录。');
        this.values.set(key, detail);
        while (this.values.size > 2) this.values.delete(this.values.keys().next().value!);
        return detail;
      })
      .finally(() => {
        if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
      });
    this.pending.set(key, { controller, promise, consumers: new Set() });
    return promise;
  }

  /** Check immediately before any side effect, including a cached download's microtask. */
  async consume(
    owner: string,
    entry: Pick<ContributionIndexEntry, 'id' | 'digest'>,
    use: (detail: ContributionDetail) => void,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const generation = this.generation;
    const key = `${entry.id}:${entry.digest}`;
    const reading = this.read(owner, entry);
    const request = this.pending.get(key);
    const consumer = Symbol();
    request?.consumers.add(consumer);
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const abort = () =>
      rejectAbort(signal?.reason ?? request?.controller.signal.reason ?? cancelled());
    signal?.addEventListener('abort', abort, { once: true });
    request?.controller.signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await Promise.race([reading, aborted]);
      signal?.throwIfAborted();
      if (this.generation !== generation || this.owner !== owner) throw cancelled();
      use(result);
    } finally {
      signal?.removeEventListener('abort', abort);
      request?.controller.signal.removeEventListener('abort', abort);
      request?.consumers.delete(consumer);
      if (request && request.consumers.size === 0 && this.pending.get(key) === request) {
        this.pending.delete(key);
        request.controller.abort(cancelled());
      }
    }
  }
}

export function parsePrivateIndex(
  value: unknown,
  previousCursor: string | null = null,
  seenCursors: ReadonlySet<string> = new Set(),
  expectedRevision?: number,
) {
  const parsed = ContributionIndexPageSchema.safeParse(value);
  if (!parsed.success) throw new Error('记录索引格式不符合预期。');
  const page = parsed.data;
  if (expectedRevision !== undefined && page.revision !== expectedRevision)
    throw new Error('历史记录或当前结算已变化，请刷新记录后重新加载分页。');
  if (
    page.records.length > 25 ||
    new Set(page.records.map((record) => record.id)).size !== page.records.length ||
    (page.nextCursor !== null &&
      (page.records.length === 0 ||
        page.nextCursor === previousCursor ||
        seenCursors.has(page.nextCursor)))
  )
    throw new Error('记录分页信息不一致，请刷新记录。');
  return page;
}

export function mergePrivateIndex(
  existing: ContributionIndexEntry[],
  incoming: ContributionIndexEntry[],
) {
  const known = new Set(existing.map((entry) => entry.id));
  if (incoming.some((entry) => known.has(entry.id))) throw new Error('记录分页重复，请刷新记录。');
  return [...existing, ...incoming];
}

export function summarizePrivateIndex(records: ContributionIndexEntry[]) {
  type ReadableEntry = ContributionIndexEntry & {
    summary: NonNullable<ContributionIndexEntry['summary']>;
  };
  const groups = new Map<string, ReadableEntry[]>();
  let missing = 0;
  let superseded = 0,
    unresolved = 0;
  for (const record of records) {
    if (record.settlement?.state === 'superseded') {
      superseded++;
      continue;
    }
    if (record.settlement && record.settlement.state !== 'active') {
      unresolved++;
      continue;
    }
    const { summary } = record;
    if (!summary) {
      missing++;
      continue;
    }
    const key = `${summary.month}|${summary.currency}`;
    const group = groups.get(key) ?? [];
    group.push({ ...record, summary });
    groups.set(key, group);
  }
  const rows = [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([id, entries]) => {
      const values = entries.map((entry) => entry.summary);
      const quarantined = entries
        .filter((entry) => entry.status === 'quarantined')
        .map((entry) => entry.summary);
      const sum = (
        read: (value: (typeof values)[number]) => number | null,
        integer = true,
        subset = values,
      ) => {
        const amounts = subset.map(read);
        if (amounts.some(value => value === null)) return null;
        const total = amounts.reduce<number>((result, value) => result + value!, 0);
        return Number.isFinite(total) && (!integer || Number.isSafeInteger(total)) ? total : null;
      };
      return {
        id,
        month: values[0].month,
        currency: values[0].currency,
        records: values.length,
        quarantinedRecords: quarantined.length,
        quarantinedNetMinor: sum((value) => value.netMinor, true, quarantined),
        quarantinedTasks: sum((value) => value.taskCount, true, quarantined),
        netMinor: sum((value) => value.netMinor),
        tasks: sum((value) => value.taskCount),
        accepted: sum((value) => value.accepted),
        retries: sum((value) => value.retries),
        humanMinutes: values.every((value) => value.humanMinutes !== null)
          ? sum((value) => value.humanMinutes!, false)
          : null,
        completeCycles: values.filter((value) => value.completeCycle).length,
      };
    });
  return {
    rows,
    missing,
    ...(superseded || unresolved ? { excluded: { superseded, unresolved } } : {}),
  };
}
