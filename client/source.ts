import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceManifestSchema, sourceUrl, type SourceManifest } from '../shared/source.js';

export const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function readSource(root = clientRoot): SourceManifest | null {
  const path = [join(root, 'source.json'), join(root, 'public/integrations/source.json')].find(
    existsSync,
  );
  if (!path) return null;
  return SourceManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

// Fixed public GitHub origins, pinned commits and bounded text only; never execute fetched code.
export async function fetchPromptSource(source: SourceManifest, fetcher: typeof fetch = fetch) {
  SourceManifestSchema.parse(source);
  if (!source.repository || !source.revision) throw new Error('仓库尚未发布，当前使用本地提示词');
  const files: { path: string; content: string }[] = [];
  for (const file of source.files) {
    const response = await fetcher(sourceUrl(source, file.path), {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok || !response.body)
      throw new Error(`GitHub 提示词读取失败（HTTP ${response.status}）`);
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 256 * 1024) throw new Error('GitHub 提示词超过 256 KiB');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error('GitHub 提示词与发布清单的 SHA-256 不一致，请停止使用该下载内容');
    files.push({
      path: file.path,
      content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    });
  }
  return files;
}

export async function sourceIntroduction(cacheDirectory: string) {
  const source = readSource();
  console.log('OpenCost 的网页、桌面应用、上传工具及 Skills 按 MIT 许可开源。');
  if (!source?.repository) {
    console.log(
      '当前使用工具包内的提示词；配置公开来源后可核对 GitHub 固定版本。',
    );
    return;
  }
  console.log(`源码仓库：${source.repository}；提示词固定版本：${source.revision}`);
  try {
    const files = await fetchPromptSource(source);
    for (const file of files) {
      const target = resolve(cacheDirectory, source.revision!, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { mode: 0o600 });
    }
    console.log(
      `提示词已从上述 GitHub 提交拉取，并逐文件核对 SHA-256；审阅副本：${resolve(cacheDirectory, source.revision!)}`,
    );
  } catch (error) {
    console.log(
      `本次未完成 GitHub 提示词核对：${error instanceof Error ? error.message : '网络失败'}。当前使用包内本地版本，不将其标为本次已拉取。`,
    );
  }
}
