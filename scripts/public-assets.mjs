import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const br = promisify(brotliCompress),
  gz = promisify(gzip);

/** Compress immutable JS/CSS at build time, with no per-request compression cost. */
export function publicAssets() {
  return {
    name: 'opencost-precompressed-public-assets',
    apply: 'build',
    // Vite rewrites preload maps during generateBundle. Only final on-disk
    // bytes may be compressed, after every generateBundle hook has completed.
    writeBundle: {
      order: 'post',
      sequential: true,
      async handler(options, bundle) {
        if (!options.dir) throw new Error('Public asset output directory is required');
        for (const entry of Object.values(bundle)) {
          if (!/^assets\/.+-[\w-]{8}\.(?:js|css)$/.test(entry.fileName)) continue;
          const file = resolve(options.dir, entry.fileName);
          const source = await readFile(file);
          if (source.length < 1024) continue;
          const variants = await Promise.all([
            br(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
            gz(source, { level: 6 }),
          ]);
          for (const [index, body] of variants.entries()) {
            if (body.length > source.length * 0.9) continue;
            await writeFile(file + (index ? '.gz' : '.br'), body);
          }
        }
      },
    },
  };
}
