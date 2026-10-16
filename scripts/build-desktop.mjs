import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
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
// Original application icon, generated without external assets.
const crc = (buffer) => {
  let n = 0xffffffff;
  for (const v of buffer) {
    n ^= v;
    for (let j = 0; j < 8; j++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    c = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
const size = 64,
  pixels = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const p = y * (size * 4 + 1) + 1 + x * 4,
      r = Math.hypot(x - 31.5, y - 31.5);
    const orbit = (r > 18 && r < 22) || (r > 8 && r < 11);
    const dot = Math.hypot(x - 45, y - 17) < 5;
    pixels[p] = orbit || dot ? 183 : 23;
    pixels[p + 1] = orbit || dot ? 239 : 33;
    pixels[p + 2] = orbit || dot ? 165 : 43;
    pixels[p + 3] = r < 31 ? 255 : 0;
  }
const head = Buffer.alloc(13);
head.writeUInt32BE(size, 0);
head.writeUInt32BE(size, 4);
head[8] = 8;
head[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', head),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
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
      productName: 'OpenCost Work Journal',
      version: '0.1.0',
      main: 'main.cjs',
      license: 'MIT',
    },
    null,
    2,
  ),
);
await copyFile('LICENSE', resolve(out, 'LICENSE'));
