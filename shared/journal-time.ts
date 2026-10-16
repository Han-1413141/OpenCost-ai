type JournalWindow = { day: string; timeZone: string; startAt: string; endAt: string };
type JournalIdentity = JournalWindow & { id: string };
const dayMs = 86400000;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isJournalDay(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!timeZone.length || timeZone.length > 80) return null;
  const saved = formatters.get(timeZone);
  if (saved) return saved;
  try {
    const value = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, value);
    return value;
  } catch {
    return null;
  }
}

function calendarDay(value: number, format: Intl.DateTimeFormat) {
  const parts = format.formatToParts(value);
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}

export type JournalWindowStatus =
  'valid' | 'invalid_day' | 'invalid_timezone' | 'invalid_interval' | 'day_mismatch';
export function journalWindowCheck(window: JournalWindow): {
  status: JournalWindowStatus;
  timeZone: string | null;
} {
  if (!isJournalDay(window.day)) return { status: 'invalid_day', timeZone: null };
  const format = formatter(window.timeZone);
  if (!format) return { status: 'invalid_timezone', timeZone: null };
  const timeZone = format.resolvedOptions().timeZone;
  const start = Date.parse(window.startAt),
    end = Date.parse(window.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > dayMs * 1.1)
    return { status: 'invalid_interval', timeZone };
  // Daily windows are half-open. End may be next midnight, including 23/25-hour
  // DST days; an arbitrary rolling 24 hours need not be one local calendar day.
  return {
    status:
      calendarDay(start, format) === window.day && calendarDay(end - 1, format) === window.day
        ? 'valid'
        : 'day_mismatch',
    timeZone,
  };
}

export const journalWindowError =
  '日记日期、时区与采集区间不一致；请选择有效的本地日期，区间起点包含、终点不含。';

/** Inspect bounded caller-supplied history; no fetching, database reads or timers. */
export function journalCoverage(summary: JournalIdentity, history: JournalIdentity[]) {
  const current = journalWindowCheck(summary);
  const excluded = { invalidWindow: 0, differentTimeZone: 0, outsidePeriod: 0 };
  if (current.status !== 'valid')
    return {
      version: 'journal-coverage-1' as const,
      currentWindow: current.status,
      timeZone: current.timeZone,
      inspectedRecords: 0,
      eligibleRecords: 0,
      coveredDays: null,
      excluded,
    };
  const records = new Map(history.map((record) => [record.id, record]));
  records.set(summary.id, summary);
  const dates = new Set<string>();
  let eligibleRecords = 0;
  const cutoff = Date.parse(summary.day + 'T00:00:00.000Z');
  for (const record of records.values()) {
    const checked = journalWindowCheck(record);
    if (checked.status !== 'valid') {
      excluded.invalidWindow++;
      continue;
    }
    if (checked.timeZone !== current.timeZone) {
      excluded.differentTimeZone++;
      continue;
    }
    const distance = cutoff - Date.parse(record.day + 'T00:00:00.000Z');
    if (distance < 0 || distance >= 30 * dayMs) {
      excluded.outsidePeriod++;
      continue;
    }
    eligibleRecords++;
    dates.add(record.day);
  }
  return {
    version: 'journal-coverage-1' as const,
    currentWindow: current.status,
    timeZone: current.timeZone,
    inspectedRecords: records.size,
    eligibleRecords,
    coveredDays: dates.size,
    excluded,
  };
}
