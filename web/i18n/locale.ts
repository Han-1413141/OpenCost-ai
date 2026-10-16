import { useSyncExternalStore } from 'react';

export const languages = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'],
] as const;
export type Locale = (typeof languages)[number][0];
type Catalog = Record<string, string>;
let current: Locale = 'zh-CN';
let catalog: Catalog = {};
let generation = 0;
const listeners = new Set<() => void>();
const cache = new Map<string, string>();
let templates: { regex: RegExp; atom: string; translated: string }[] = [];
const loaders: Record<Exclude<Locale, 'zh-CN'>, () => Promise<{ default: Catalog }>> = {
  'zh-TW': () => import('./locales/zh-TW.json'),
  en: () => import('./locales/en.json'),
  ja: () => import('./locales/ja.json'),
};
export const getLocale = () => current;
export function preferredLocale(value: string): Locale {
  if (/^zh[-_](?:TW|HK|MO|Hant)/i.test(value)) return 'zh-TW';
  if (/^zh/i.test(value)) return 'zh-CN';
  if (/^ja/i.test(value)) return 'ja';
  return 'en';
}
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export async function setLocale(locale: Locale, persist = true) {
  if (!languages.some(([key]) => key === locale)) throw new Error('Unsupported language');
  const version = ++generation;
  const next = locale === 'zh-CN' ? {} : (await loaders[locale]()).default;
  if (version !== generation) return;
  catalog = next; current = locale; cache.clear();
  templates = Object.entries(next).filter(([key]) => /\{\d+\}/.test(key)).map(([key, translated]) => {
    const parts = key.split(/\{\d+\}/);
    const atom = parts.filter((part) => /[\u3400-\u9fff]/.test(part)).sort((a, b) => b.length - a.length)[0] ?? '';
    return { atom, translated, regex: new RegExp(`^${parts.map(escaped).join('(.*?)')}$`, 'u') };
  }).filter((item) => item.atom).sort((a, b) => b.atom.length - a.atom.length);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  if (persist) {
    try { localStorage.setItem('opencost.language', locale); } catch { /* Session selection remains available. */ }
    if (typeof location !== 'undefined' && typeof history !== 'undefined') {
      try {
        const url = new URL(location.href);
        url.searchParams.set('lang', locale);
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
      } catch { /* Desktop schemes can keep the preference without changing their URL. */ }
    }
  }
  for (const listener of listeners) listener();
}
export async function initializeLocale() {
  if (typeof navigator === 'undefined') return;
  let locale = preferredLocale(navigator.languages?.[0] ?? navigator.language);
  try {
    const saved = localStorage.getItem('opencost.language');
    if (languages.some(([key]) => key === saved)) locale = saved as Locale;
  } catch { /* Browser language is the default. */ }
  if (typeof location !== 'undefined') {
    const selected = new URLSearchParams(location.search).get('lang');
    if (languages.some(([key]) => key === selected)) locale = selected as Locale;
  }
  await setLocale(locale, false);
}
export function useLocale() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLocale, () => 'zh-CN' as Locale);
}
/** Only rendered text is translated. Protocol values, user input and downloaded data stay intact. */
export function t(value: string, depth = 0): string {
  if (current === 'zh-CN' || !/[\u3400-\u9fff]/.test(value) || value.length > 20_000) return value;
  const saved = cache.get(value);
  if (saved !== undefined) return saved;
  const key = normalize(value);
  let translated = catalog[key];
  if (translated === undefined && depth < 2) {
    for (const pattern of templates) {
      if (!key.includes(pattern.atom)) continue;
      const matched = pattern.regex.exec(key);
      if (!matched) continue;
      translated = pattern.translated.replace(/\{(\d+)\}/g, (_all, index) => t(matched[Number(index) + 1] ?? '', depth + 1));
      break;
    }
  }
  const result = translated === undefined ? value : `${value.match(/^\s*/)?.[0] ?? ''}${translated}${value.match(/\s*$/)?.[0] ?? ''}`;
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
  cache.set(value, result);
  return result;
}
