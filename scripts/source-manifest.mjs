import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function makeSourceManifest(root, env = process.env) {
  const path = join(root, 'source.json');
  const saved = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const repository = env.OPENCOST_SOURCE_REPOSITORY?.trim().replace(/\/$/, '') || saved.repository || null;
  const revision = env.OPENCOST_SOURCE_REVISION?.trim() || saved.revision || null;
  if (
    (repository && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) ||
    (revision && !/^[a-f0-9]{40}$/.test(revision)) ||
    Boolean(repository) !== Boolean(revision)
  ) {
    throw new Error('发布来源需要真实 GitHub 仓库 URL 和对应的 40 位小写提交 SHA，必须同时填写');
  }
  return {
    format: 'opencost-source-1',
    repository,
    revision,
    license: 'MIT',
    files: [
      'skills/opencost-contribute/SKILL.md',
      'skills/opencost-contribute/references/collection-contract.md',
      'skills/opencost-contribute/references/first-use.md',
      'skills/opencost-contribute/references/work-measurement.md',
      'skills/opencost-contribute/references/analysis-observations.md',
      'skills/opencost-contribute/references/complexity-assessment.md',
    ].map((path) => ({
      path,
      sha256: createHash('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex'),
    })),
  };
}
