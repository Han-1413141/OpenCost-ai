import { Fragment } from 'react';
import { getLocale, t } from './locale';

const presentation = ['title', 'placeholder', 'alt', 'aria-label', 'aria-description'] as const;
const children = (value: unknown): unknown => typeof value === 'string' ? t(value) : Array.isArray(value) ? value.map(children) : value;
export function localizeProps(type: unknown, value: unknown) {
  if (getLocale() === 'zh-CN' || !value || typeof value !== 'object' || (typeof type !== 'string' && type !== Fragment)) return value;
  const props = value as Record<string, unknown>;
  if (props['data-no-translate'] || ['pre', 'code', 'textarea', 'script', 'style'].includes(String(type))) return props;
  let result = props;
  const assign = (key: string, value: unknown) => { if (value !== props[key]) { if (result === props) result = { ...props }; result[key] = value; } };
  if ('children' in props) assign('children', children(props.children));
  for (const attribute of presentation) if (typeof props[attribute] === 'string') assign(attribute, t(props[attribute]));
  return result;
}
