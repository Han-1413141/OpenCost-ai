import { useState } from 'react';
import { Languages } from 'lucide-react';
import { languages, setLocale, useLocale, type Locale } from './locale';

export function LanguageSelector() {
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const change = async (value: Locale) => {
    setLoading(true); setError('');
    try { await setLocale(value); } catch { setError('语言资源加载失败，请重试。'); }
    finally { setLoading(false); }
  };
  return <label className="language-selector" title={error || '界面语言'}>
    <Languages size={15} aria-hidden="true" />
    <select aria-label="界面语言" value={locale} disabled={loading} onChange={(event) => void change(event.target.value as Locale)}>
      {languages.map(([id, name]) => <option key={id} value={id} data-no-translate>{name}</option>)}
    </select>
    {error && <span role="status">{error}</span>}
  </label>;
}
