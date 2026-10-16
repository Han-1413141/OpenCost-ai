import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { Modal } from './components';
import { getLocale } from './i18n/locale';
import {
  convertMinor,
  displayCurrencies,
  preferredCurrency,
  type ExchangeRates,
} from './currency-math';

const unavailable: ExchangeRates = {
  base: 'EUR',
  rates: {},
  date: null,
  fetchedAt: null,
  sourceUrl:
    'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
  status: 'unavailable',
};
const CurrencyContext = createContext<{
  preference: string;
  setPreference: (value: string) => void;
  currency: string;
  automatic: string;
  rates: ExchangeRates;
  loading: boolean;
  refresh: () => void;
} | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(() => {
    try {
      const saved = localStorage.getItem('opencost.currency');
      return saved && displayCurrencies.includes(saved) ? saved : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [automatic, setAutomatic] = useState(() =>
    preferredCurrency(navigator.languages?.[0] ?? navigator.language),
  );
  const [rates, setRates] = useState<ExchangeRates>(unavailable);
  const [loading, setLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  useEffect(() => {
    const changed = () =>
      setAutomatic(preferredCurrency(navigator.languages?.[0] ?? navigator.language));
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('opencost.currency', preference);
    } catch {
      /* Display selection remains available. */
    }
  }, [preference]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const load = async () => {
      try {
        const result = await api<ExchangeRates>('/api/exchange-rates', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (controller.signal.aborted) return;
        setRates(result);
      } catch {
        if (controller.signal.aborted) return;
        setRates(unavailable);
      }
      setLoading(false);
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [refreshCount]);
  return (
    <CurrencyContext.Provider
      value={{
        preference,
        setPreference,
        currency: preference === 'auto' ? automatic : preference,
        automatic,
        rates,
        loading,
        refresh: () => setRefreshCount((n) => n + 1),
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useDisplayCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) throw new Error('CurrencyProvider is required');
  const convert = (amount: number | null | undefined, from: string, to = context.currency) =>
    convertMinor(amount, from, to, context.rates.rates);
  const effectiveCurrency = (from: string) =>
    convert(100, from) === null ? from : context.currency;
  const format = (amount: number | null | undefined, from = 'CNY') => {
    if (amount == null) return '—';
    const converted = convert(amount, from);
    const value = (converted ?? amount) / 100;
    return new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency: converted === null ? from : context.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 4 : 2,
    }).format(value);
  };
  return { ...context, convert, effectiveCurrency, format };
}

export function CurrencySelector() {
  const { preference, setPreference, automatic, currency, rates } = useDisplayCurrency();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="currency-button" onClick={() => setOpen(true)} aria-label="显示货币">
        {currency}
      </button>
      {open && (
        <Modal title="显示货币" onClose={() => setOpen(false)}>
          <div className="currency-options" role="group" aria-label="货币">
            {['auto', ...displayCurrencies].map((code) => (
              <button
                key={code}
                aria-pressed={preference === code}
                onClick={() => {
                  setPreference(code);
                  setOpen(false);
                }}
              >
                {code === 'auto' ? `自动 · ${automatic}` : code}
              </button>
            ))}
          </div>
          {rates.date && (
            <p className="currency-rate-source">
              <a href={rates.sourceUrl} target="_blank" rel="noreferrer">
                ECB · {rates.date}
              </a>
              {rates.status === 'stale' && ' · 汇率待更新'}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

export function CurrencyNotice({ recorded }: { recorded: string }) {
  const { currency, rates, loading, effectiveCurrency, refresh } = useDisplayCurrency();
  if (currency === recorded) return null;
  return (
    <div className="currency-notice" role="status">
      {effectiveCurrency(recorded) !== currency ? (
        <>
          {loading ? '正在读取参考汇率' : '参考汇率暂不可用'}，金额保留原币 {recorded}。
          {!loading && <button onClick={refresh}>重试</button>}
        </>
      ) : (
        <>
          {recorded} → {currency} ·{' '}
          <a href={rates.sourceUrl} target="_blank" rel="noreferrer">
            ECB {rates.date}
          </a>
          {rates.status === 'stale' && '（汇率待更新）'}
        </>
      )}
    </div>
  );
}
