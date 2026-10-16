/** RFC 9110 Retry-After: delay-seconds or an HTTP-date. No retry scheduling. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (typeof value !== 'string' || value.length > 128 || !Number.isSafeInteger(nowMs))
    return undefined;
  const text = value.trim();
  const maxDateMs = 8_640_000_000_000_000;
  if (Math.abs(nowMs) > maxDateMs) return undefined;
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    const delay = seconds * 1000;
    return seconds > 0 && Number.isSafeInteger(delay) && nowMs + delay <= maxDateMs
      ? delay
      : undefined;
  }

  // Date.parse alone accepts non-HTTP values such as "1.5" and ISO dates.
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const shortDays = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ');
  const longDays = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
  const standard = /^(\w{3}), (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text);
  const obsolete = /^(\w+), (\d{2})-(\w{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text);
  const asctime = /^(\w{3}) (\w{3}) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text);
  const parts = standard ?? obsolete;
  if (!parts && !asctime) return undefined;
  let year = Number(parts ? parts[4] : asctime![7]);
  if (obsolete) {
    const currentYear = new Date(nowMs).getUTCFullYear();
    year += Math.floor(currentYear / 100) * 100;
  }
  const month = months.indexOf(parts ? parts[3] : asctime![2]);
  const day = Number(parts ? parts[2] : asctime![3]);
  const hour = Number(parts ? parts[5] : asctime![4]);
  const minute = Number(parts ? parts[6] : asctime![5]);
  const second = Number(parts ? parts[7] : asctime![6]);
  const weekday = (obsolete ? longDays : shortDays).indexOf((parts ?? asctime)![1]);
  if (year < 1601 || month < 0 || weekday < 0) return undefined;
  let timestamp = Date.UTC(year, month, day, hour, minute, second);
  if (obsolete) {
    const fiftyYearsAhead = new Date(nowMs);
    fiftyYearsAhead.setUTCFullYear(fiftyYearsAhead.getUTCFullYear() + 50);
    if (timestamp > fiftyYearsAhead.getTime()) {
      year -= 100;
      timestamp = Date.UTC(year, month, day, hour, minute, second);
    }
  }
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCDay() !== weekday
  )
    return undefined;
  const delay = timestamp - nowMs;
  return delay > 0 && Number.isSafeInteger(delay) ? delay : undefined;
}
