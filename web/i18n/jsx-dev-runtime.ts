import { jsxDEV as original } from 'react/jsx-dev-runtime';
import { localizeProps } from './props';
export { Fragment } from 'react/jsx-dev-runtime';
export type { JSX } from 'react/jsx-dev-runtime';
export const jsxDEV: typeof original = (type, props, key, isStatic, source, self) => original(type, localizeProps(type, props), key, isStatic, source, self);
