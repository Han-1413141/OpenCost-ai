// Cache formatter configuration, never amounts or user records.
const formatters = new Map<string, Intl.NumberFormat>();
const MAX_FORMATTERS = 64;

export function numberFormatter(locale: string, digits: number, currency?: string) {
  const key = JSON.stringify([locale, digits, currency ?? null]);
  let formatter = formatters.get(key);
  if (formatter) {
    formatters.delete(key);
  } else {
    formatter = new Intl.NumberFormat(locale, {
      ...(currency === undefined ? {} : { style: 'currency', currency, minimumFractionDigits: 2 }),
      maximumFractionDigits: digits,
    });
  }
  formatters.set(key, formatter);
  if (formatters.size > MAX_FORMATTERS) formatters.delete(formatters.keys().next().value!);
  return formatter;
}
