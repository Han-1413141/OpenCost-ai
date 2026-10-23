import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseSync, Visitor } from 'rolldown/utils';

/** Build-artifact bytes only; this does not measure browser or Electron startup time. */
export function analyzeRendererImports(directory) {
  const root = realpathSync(directory);
  const localFile = (base, specifier) => {
    const rooted = specifier.startsWith('/') && !specifier.startsWith('//');
    if (!rooted && !specifier.startsWith('./') && !specifier.startsWith('../'))
      throw new Error('Renderer assets must use relative local paths.');
    const file = rooted ? resolve(root, '.' + specifier) : resolve(base, specifier);
    if (!file.startsWith(root + sep) || realpathSync(file) !== file || !statSync(file).isFile())
      throw new Error('Renderer asset is outside the local build.');
    return file;
  };
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/g)].map(
    (match) => localFile(root, match[1]),
  );
  if (scripts.length !== 1) throw new Error('Expected one renderer entry.');
  const links = [
    ...html.matchAll(/<link\b[^>]*rel="(?:stylesheet|modulepreload)"[^>]*href="([^"]+)"[^>]*>/g),
  ].map((match) => localFile(root, match[1]));
  const initial = new Set(),
    dynamic = new Set();
  const visit = (file) => {
    if (initial.has(file)) return;
    initial.add(file);
    if (!file.endsWith('.js')) return;
    const parsed = parseSync(file, readFileSync(file, 'utf8'));
    if (parsed.errors.length) throw new Error('Renderer JavaScript could not be parsed.');
    const follow = (node) => {
      if (node.source) visit(localFile(dirname(file), node.source.value));
    };
    new Visitor({
      ImportDeclaration: follow,
      ExportNamedDeclaration: follow,
      ExportAllDeclaration: follow,
      ImportExpression(node) {
        const specifier =
          node.source.type === 'TemplateLiteral' && !node.source.expressions.length
            ? node.source.quasis[0].value.cooked
            : node.source.value;
        if (typeof specifier !== 'string') throw new Error('Non-literal dynamic import.');
        dynamic.add(localFile(dirname(file), specifier));
      },
    }).visit(parsed.program);
  };
  [...scripts, ...links].forEach(visit);
  const asset = (file) => {
    const bytes = readFileSync(file);
    return {
      path: relative(root, file).replaceAll('\\', '/'),
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes).length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const assets = [...initial].sort().map(asset);
  return {
    format: 'opencost-renderer-import-analysis-1',
    measurement: 'static import closure and HTML-linked assets; not runtime timing',
    entry: asset(scripts[0]),
    initialAssets: assets,
    initialBytes: assets.reduce((sum, file) => sum + file.bytes, 0),
    initialGzipBytes: assets.reduce((sum, file) => sum + file.gzipBytes, 0),
    deferredFromInitial: [...dynamic]
      .filter((file) => !initial.has(file))
      .sort()
      .map(asset),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3)
    throw new Error('Usage: node scripts/analyze-renderer-imports.mjs <renderer-directory>');
  console.log(JSON.stringify(analyzeRendererImports(resolve(process.argv[2])), null, 2));
}
