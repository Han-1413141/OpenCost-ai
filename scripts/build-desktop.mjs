import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve('desktop-dist');
await mkdir(out, { recursive: true });
await build({
  entryPoints: { main: 'desktop/main.ts' },
  bundle: true,
  outdir: out,
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  define: { 'import.meta.url': '__opencostBundleUrl' },
  banner: {
    js: 'const __opencostBundleUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  external: ['electron'],
  logLevel: 'info',
});
await build({
  entryPoints: ['desktop/preload.ts'],
  outfile: resolve(out, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'info',
});
await build({
  entryPoints: ['desktop/backup-worker.ts'],
  outfile: resolve(out, 'backup-worker.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  logLevel: 'info',
});

await viteBuild({ configFile: resolve('vite.desktop.config.ts') });
// The desktop and main site share the OpenCost-AI icon.
const png = await readFile('public/brand/opencost-ai-icon-64.png');
await writeFile(resolve(out, 'icon.png'), png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 64;
ico[7] = 64;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
await writeFile(resolve(out, 'icon.ico'), Buffer.concat([ico, png]));
await writeFile(
  resolve(out, 'package.json'),
  JSON.stringify(
    {
      name: 'opencost-work-journal',
      productName: 'OpenCost-AI Work Journal',
      version: '0.1.0',
      main: 'main.cjs',
      license: 'MIT',
    },
    null,
    2,
  ),
);
await copyFile('LICENSE', resolve(out, 'LICENSE'));
