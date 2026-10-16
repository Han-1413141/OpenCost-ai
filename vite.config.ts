import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { publicAssets } from './scripts/public-assets.mjs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react({ jsxImportSource: '@opencost/i18n' }), publicAssets()],
  resolve: { alias: { '@opencost/i18n/jsx-runtime': resolve('web/i18n/jsx-runtime.ts'), '@opencost/i18n/jsx-dev-runtime': resolve('web/i18n/jsx-dev-runtime.ts') } },
  root: '.',
  json: { namedExports: false, stringify: true },
  build: { outDir: 'dist/public', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
    proxy: { '/api': { target: process.env.OPENCOST_API_PROXY || 'https://opencost-ai.com', changeOrigin: true } },
  },
});
