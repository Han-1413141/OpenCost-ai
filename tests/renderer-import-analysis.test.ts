import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error Local build-analysis module has no declaration file.
import { analyzeRendererImports } from '../scripts/analyze-renderer-imports.mjs';

test('初始体积包含共享静态依赖、HTML预加载和CSS，不只看入口文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencost-import-graph-'));
  try {
    const files: Record<string, string> = {
      'index.html':
        '<script type="module" src="./main.js"></script><link rel="stylesheet" href="./main.css"><link rel="modulepreload" href="./preloaded.js">',
      'main.js':
        'import "./shared.js"; export { value } from "./exported.js"; import(`./deferred.js`); import("./preloaded.js");',
      'shared.js': 'import "./exported.js"; console.log("shared");',
      'exported.js': 'export const value = 1;',
      'preloaded.js': 'console.log("already requested");',
      'deferred.js': 'console.log("manual only");',
      'main.css': 'body { color: blue; }',
    };
    for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
    const result = analyzeRendererImports(dir);
    assert.deepEqual(
      result.initialAssets.map((f: { path: string }) => f.path),
      ['exported.js', 'main.css', 'main.js', 'preloaded.js', 'shared.js'],
    );
    assert.equal(
      result.initialBytes,
      ['main.js', 'main.css', 'shared.js', 'exported.js', 'preloaded.js'].reduce(
        (sum, path) => sum + Buffer.byteLength(files[path]),
        0,
      ),
    );
    assert.deepEqual(
      result.deferredFromInitial.map((f: { path: string }) => f.path),
      ['deferred.js'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('无法解释的动态路径不生成完整体积结论', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencost-import-unknown-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="./main.js"></script>');
    writeFileSync(join(dir, 'main.js'), 'import(window.modulePath);');
    assert.throws(() => analyzeRendererImports(dir), /Non-literal dynamic import/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('网页根路径资源参与统计，外站和越界路径不读取', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencost-import-web-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/main.js"></script>');
    writeFileSync(join(dir, 'main.js'), 'import "/shared.js";');
    writeFileSync(join(dir, 'shared.js'), 'export const value = 1;');
    assert.equal(analyzeRendererImports(dir).initialAssets.length, 2);
    for (const path of ['//external.example/main.js', '/../outside.js']) {
      writeFileSync(join(dir, 'index.html'), `<script type="module" src="${path}"></script>`);
      assert.throws(() => analyzeRendererImports(dir), /local paths|outside the local build/);
    }
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  }
});
