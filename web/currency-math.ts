export type ExchangeRates = {
  base: 'EUR';
  rates: Record<string, number>;
  date: string | null;
  fetchedAt: string | null;
  sourceUrl: string;
  status: 'ok' | 'stale' | 'unavailable';
};
export const displayCurrencies = [
  'CNY',
  'USD',
  'EUR',
  'JPY',
  'HKD',
  'KRW',
  'GBP',
  'CHF',
  'CAD',
  'AUD',
  'SGD',
];
export function preferredCurrency(language: string): string {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(language);
  } catch {
    return 'USD';
  }
  if (locale.language === 'en') return 'USD';
  const regional: Record<string, string> = {
    CN: 'CNY',
    HK: 'HKD',
    MO: 'HKD',
    JP: 'JPY',
    KR: 'KRW',
    GB: 'GBP',
    CH: 'CHF',
    CA: 'CAD',
    AU: 'AUD',
    SG: 'SGD',
  };
  if (locale.region && regional[locale.region]) return regional[locale.region];
  if (
    locale.region &&
    [
      'AT',
      'BE',
      'CY',
      'DE',
      'EE',
      'ES',
      'FI',
      'FR',
      'GR',
      'HR',
      'IE',
      'IT',
      'LT',
      'LU',
      'LV',
      'MT',
      'NL',
      'PT',
      'SI',
      'SK',
    ].includes(locale.region)
  )
    return 'EUR';
  return (
    (
      {
        zh: 'CNY',
        ja: 'JPY',
        ko: 'KRW',
        de: 'EUR',
        fr: 'EUR',
        es: 'EUR',
        it: 'EUR',
        nl: 'EUR',
        pt: 'EUR',
        el: 'EUR',
        fi: 'EUR',
      } as Record<string, string>
    )[locale.language] ?? 'USD'
  );
}
// All original amounts use 1/100 of their recorded currency, including API fractions.
export function convertMinor(
  amount: number | null | undefined,
  from: string,
  to: string,
  rates: Record<string, number>,
): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const source = rates[from],
    target = rates[to];
  if (!Number.isFinite(source) || !Number.isFinite(target) || source <= 0 || target <= 0)
    return null;
  const result = (amount * target) / source;
  return Number.isFinite(result) ? result : null;
}
