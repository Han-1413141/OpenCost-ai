import { jsx as originalJsx, jsxs as originalJsxs } from 'react/jsx-runtime';
import { localizeProps } from './props';
export { Fragment } from 'react/jsx-runtime';
export type { JSX } from 'react/jsx-runtime';
export const jsx: typeof originalJsx = (type, props, key) => originalJsx(type, localizeProps(type, props), key);
export const jsxs: typeof originalJsxs = (type, props, key) => originalJsxs(type, localizeProps(type, props), key);
