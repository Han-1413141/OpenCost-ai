import { z } from 'zod';

export const SourceManifestSchema = z
  .object({
    format: z.literal('opencost-source-1'),
    repository: z
      .string()
      .regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .nullable(),
    revision: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    license: z.literal('MIT'),
    files: z
      .array(
        z
          .object({
            path: z.enum([
              'skills/opencost-contribute/SKILL.md',
              'skills/opencost-contribute/references/collection-contract.md',
              'skills/opencost-contribute/references/first-use.md',
              'skills/opencost-contribute/references/work-measurement.md',
              'skills/opencost-contribute/references/analysis-observations.md',
              'skills/opencost-contribute/references/complexity-assessment.md',
            ]),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(3)
      .max(6),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Boolean(value.repository) !== Boolean(value.revision))
      ctx.addIssue({ code: 'custom', message: '公开仓库地址与固定提交版本必须同时填写' });
    const paths = new Set(value.files.map((file) => file.path));
    if (
      paths.size !== value.files.length ||
      ![
        'skills/opencost-contribute/SKILL.md',
        'skills/opencost-contribute/references/collection-contract.md',
        'skills/opencost-contribute/references/first-use.md',
      ].every((path) => paths.has(path as (typeof value.files)[number]['path']))
    )
      ctx.addIssue({ code: 'custom', message: '提示词来源清单不能重复或缺少文件' });
  });
export type SourceManifest = z.infer<typeof SourceManifestSchema>;

export function sourceUrl(source: SourceManifest, path: SourceManifest['files'][number]['path']) {
  if (!source.repository || !source.revision) throw new Error('公开 GitHub 仓库尚未配置');
  return `https://raw.githubusercontent.com/${source.repository.slice('https://github.com/'.length)}/${source.revision}/${path}`;
}
