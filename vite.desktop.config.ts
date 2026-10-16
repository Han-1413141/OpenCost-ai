import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('desktop/renderer'),
  base: './',
  json: { namedExports: false, stringify: true },
  plugins: [react({ jsxImportSource: '@opencost/i18n' })],
  resolve: { alias: { '@opencost/i18n/jsx-runtime': resolve('web/i18n/jsx-runtime.ts'), '@opencost/i18n/jsx-dev-runtime': resolve('web/i18n/jsx-dev-runtime.ts') } },
  build: { outDir: resolve('desktop-dist/renderer'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4320 },
});
