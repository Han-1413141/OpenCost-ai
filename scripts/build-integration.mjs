import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { makeSourceManifest } from './source-manifest.mjs';

// Whitelist only the public client and its required definitions. No fixtures or runtime data.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.OPENCOST_RELEASE === 'true') {
  execFileSync(process.execPath, [join(root, 'scripts/check-public-source.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/check-release.ts')], {
    cwd: root,
    stdio: 'inherit',
  });
}
const source = makeSourceManifest(root);
const output = join(root, 'public', 'integrations');
const temporaryRoot = realpathSync(tmpdir());
const temporary = mkdtempSync(join(temporaryRoot, 'opencost-client-'));
const kit = join(temporary, 'opencost-contribute');
const sourcePackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
try {
  for (const file of [
    'client/cli.ts',
    'client/account.ts',
    'docs/account-connection.md',
    'shared/model-timeline.ts',
    'client/code-complexity.ts',
    'client/code-measurement-set.ts',
    'client/python-code-measurement.ts',
    'client/python-code-helper.py',
    'client/patch-measurement.ts',
    'client/code-observations.ts',
    'shared/journal-analysis.ts',
    'shared/semantic-extensions.ts',
    'client/journal-analysis-input.ts',
    'shared/journal-analysis-schema.ts',
    'shared/requirement-anchor-catalog.ts',
    'shared/python-code-measurement-schema.ts',
    'shared/code-measurement-set-schema.ts',
    'shared/code-measurement-import.ts',
    'shared/patch-measurement-schema.ts',
    'shared/code-observations-schema.ts',
    'shared/code-observations-project.ts',
    'shared/code-observation-counts.ts',
    'shared/code-observation-insights.ts',
    'shared/economic-history-schema.ts',
    'shared/economic-history.ts',
    'shared/economic-history-example.ts',
    'docs/economic-history.md',
    'third_party/jsdiff-9.0.0/LICENSE',
    'third_party/jsdiff-9.0.0/SOURCE.json',
    'third_party/radon-6.0.1/radon/__init__.py',
    'third_party/radon-6.0.1/radon/visitors.py',
    'third_party/radon-6.0.1/radon/raw.py',
    'third_party/radon-6.0.1/radon/complexity.py',
    'third_party/radon-6.0.1/LICENSE',
    'third_party/radon-6.0.1/SOURCE.json',
    'client/sdk.ts',
    'client/capture.ts',
    'client/manual-summary.ts',
    'client/usage-facts.ts',
    'client/work-journal.ts',
    'shared/payment.ts',
    'shared/usage-calculation.ts',
    'shared/feedback-toolbox.ts',
    'shared/public-models.ts',
    'skills/opencost-contribute/references/adapter-free-summary.md',
    'client/charge-coverage.ts',
    'client/settlement-revision.ts',
    'client/work-ledger.ts',
    'client/requirement-history.ts',
    'client/requirement-history-example.ts',
    'shared/requirement-history-values.ts',
    'client/template.ts',
    'client/dsh.ts',
    'client/session.ts',
    'client/session-storage.ts',
    'client/local-file.ts',
    'client/receipt-file.ts',
    'client/source.ts',
    'client/subscriptions.ts',
    'client/monitor.ts',
    'client/monitor-cli.ts',
    'client/quota-collection.ts',
    'client/codex-quota.ts',
    'client/monitor-runtime.ts',
    'client/monitor-stop.ts',
    'client/monitor-diagnostics.ts',
    'client/monitor-authorization.ts',
    'client/monitor-config.ts',
    'client/monitor-storage-options.ts',
    'client/monitor-store.ts',
    'client/monitor-history-export.ts',
    'shared/monitor-history-export-schema.ts',
    'shared/monitor-history-export-text.ts',
    'shared/sqlite-storage-budget.ts',
    'shared/sqlite-connection.ts',
    'shared/sqlite-backup.ts',
    'shared/http-retry.ts',
    'shared/schema.ts',
    'shared/task-labels.ts',
    'shared/analysis.ts',
    'shared/model-identity.ts',
    'shared/harness-composition.ts',
    'shared/source-support.ts',
    'shared/task-observations.ts',
    'shared/task-insights.ts',
    'shared/task-progress.ts',
    'shared/progress-labels.ts',
    'shared/task-lifecycle.ts',
    'shared/settlement-revision-schema.ts',
    'shared/settlement-revision.ts',
    'shared/difficulty-calibration.ts',
    'shared/calibration-design.ts',
    'shared/task-complexity.ts',
    'shared/complexity-review.ts',
    'shared/personal-feedback.ts',
    'shared/quota-peer-feedback.ts',
    'shared/feedback-task-profile.ts',
    'shared/feedback-activity.ts',
    'shared/feedback-persona.ts',
    'shared/feedback-persona-history.ts',
    'shared/feedback-radar.ts',

    'shared/feedback-reference-matching.ts',
    'shared/feedback-public-studies.ts',
    'shared/feedback-public-studies-text.ts',
    'shared/feedback-next-steps.ts',
    'shared/cost-attribution.ts',
    'shared/charge-reconciliation.ts',
    'shared/quota-replay-schema.ts',
    'shared/quota-replay.ts',
    'shared/quota-replay-labels.ts',
    'shared/quota-plan-comparison-schema.ts',
    'shared/quota-plan-comparison.ts',
    'shared/quota-plan-metrics.ts',
    'shared/quota-portfolio-schema.ts',
    'shared/quota-portfolio.ts',
    'shared/quota-portfolio-example.ts',
    'shared/quota-plan-comparison-example.ts',
    'shared/quota-plan-comparison-text.ts',
    'shared/quota-observation-import-schema.ts',
    'shared/quota-observation-import.ts',
    'shared/quota-observation-import-example.ts',
    'shared/price-metering.ts',
    'shared/contribution-history.ts',
    'shared/plans.ts',
    'shared/ranking.ts',
    'shared/ranking-target.ts',
    'shared/ranking-selection.ts',
    'shared/ranking-study-report.ts',
    'shared/ranking-resampling.ts',
    'shared/selection-stability.ts',
    'shared/selection-stability-text.ts',
    'shared/ranking-source-sensitivity.ts',
    'shared/ranking-source-balance.ts',
    'shared/source-balance-text.ts',
    'shared/ranking-weight-sensitivity.ts',
    'shared/task-weight-sensitivity-text.ts',
    'shared/comparison-eligibility.ts',
    'shared/ranking-diagnostics.ts',
    'shared/desktop-summary.ts',
    'shared/summary-task-labels.ts',
    'shared/journal-time.ts',
    'shared/evaluation.ts',
    'shared/work-taxonomy.ts',
    'shared/work-structure.ts',
    'shared/work-subjects.ts',
    'shared/work-classification.ts',
    'shared/work-labels.ts',
    'shared/difficulty-framework.ts',
    'shared/difficulty-profiles.ts',
    'shared/difficulty-review.ts',
    'shared/difficulty-evidence.ts',
    'shared/difficulty-research.json',
    'shared/collection.ts',
    'shared/source.ts',
    'shared/subscriptions.ts',
    'shared/feedback-link.ts',
    'shared/quota-consistency.ts',
    'skills/opencost-contribute/SKILL.md',
    'skills/opencost-contribute/references/collection-contract.md',
    'skills/opencost-contribute/references/first-use.md',
    'skills/opencost-contribute/references/work-measurement.md',
    'skills/opencost-contribute/references/analysis-observations.md',
    'skills/opencost-contribute/references/complexity-assessment.md',
    'skills/opencost-contribute/references/quota-collection.md',
    'docs/data-standard.md',
    'docs/charge-reconciliation.md',
    'docs/settlement-revision-design.md',
    'docs/requirement-history.md',
    'docs/python-code-measurement.md',
    'docs/code-measurement-view.md',
    'docs/patch-measurement.md',
    'docs/code-observations-upload.md',
    'docs/journal-task-analysis.md',
    'docs/quota-replay.md',
    'docs/quota-plan-comparison.md',
    'docs/quota-portfolio.md',
    'docs/quota-observation-import.md',
    'docs/monitor-history-export.md',
    'docs/ranking-targets.md',
    'docs/ranking-independent-evaluation.md',
    'docs/ranking-resampling.md',
    'docs/selection-stability.md',
    'docs/ranking-source-sensitivity.md',
    'docs/ranking-source-balance.md',
    'docs/ranking-weight-sensitivity.md',
    'docs/difficulty-framework.md',
    'docs/difficulty-research.md',
    'docs/research/difficulty-classification.json',
    'docs/research/difficulty-foundations.json',
    'docs/research/difficulty-foundations.md',
    'docs/research/difficulty-computing.json',
    'docs/research/difficulty-computing.md',
    'docs/research/difficulty-science.json',
    'docs/research/difficulty-science.md',
    'docs/research/difficulty-humanities.json',
    'docs/research/difficulty-humanities.md',
    'docs/research/difficulty-professional.json',
    'docs/research/difficulty-professional.md',
    'docs/integrity.md',
    'docs/integration.md',
    'docs/dsh-cost-meter.md',
    'docs/backend-api.md',
    'docs/personal-feedback.md',
    'docs/feedback-public-studies.md',
    'docs/analysis-methodology.md',
    'docs/code-complexity.md',
    'docs/research/coding-difficulty-20261014.md',
    'docs/research/pro-reference-adoption-20261014.md',
    'docs/research/analysis-20261013/README.md',
    'docs/research/analysis-20261013/task-measurement.md',
    'docs/research/analysis-20261013/task-measurement.sources.json',
    'docs/research/analysis-20261013/statistical-feedback.md',
    'docs/research/analysis-20261013/statistical-feedback.sources.json',
    'docs/research/analysis-20261013/privacy-telemetry.md',
    'docs/research/analysis-20261013/privacy-telemetry.sources.json',
    'docs/research/analysis-20261013/ghfind-transfer.md',
    'docs/research/analysis-20261013/ghfind-transfer.sources.json',
    'docs/monitoring.md',
    'scripts/Start-Monitor.ps1',
    'LICENSE',
  ]) {
    const target = join(kit, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target);
  }
  writeFileSync(join(kit, 'source.json'), JSON.stringify(source, null, 2) + '\n', 'utf8');
  writeFileSync(
    join(kit, 'package.json'),
    JSON.stringify(
      {
        name: 'opencost-contribute',
        version: sourcePackage.version,
        private: true,
        type: 'module',
        engines: sourcePackage.engines,
        scripts: { contribute: 'tsx client/cli.ts', monitor: 'tsx client/monitor-cli.ts' },
        dependencies: {
          diff: sourcePackage.dependencies.diff,
          zod: sourcePackage.dependencies.zod,
          tsx: sourcePackage.devDependencies.tsx,
        },
        optionalDependencies: {
          rolldown: JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages[
            'node_modules/rolldown'
          ].version,
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  writeFileSync(join(kit, '.gitignore'), '.local/\nnode_modules/\n*.key\n', 'utf8');
  writeFileSync(
    join(kit, 'README.md'),
    `# OpenCost 贡献 Skill 与客户端

需要 Node.js 24。解压后在本目录运行 npm install，读取 skills/opencost-contribute/SKILL.md。
把该 Skill 添加到你使用的 Harness；如果工具不支持 Skill，请让 AI 先读取该文件并按其步骤执行。

没有 DSH 或其他适配器时，AI 直接整理授权会话与成果，再通过 summary-template、summarize、journal-prepare、journal-submit 生成并上传私有工作日记。缺失实付、Token 和后代信息保持未知。具体命令见 skills/opencost-contribute/references/adapter-free-summary.md。

首次由 AI 带入当前 Harness 和已授权来源，一次确认推荐方案：近 3 天、开启增量、自动运行及监控关闭，先生成本地预览。用户只需说“开始”或修改一项。AI 整理旧对话会消耗模型额度，其他范围按需展开，最多 90 天。接受推荐方案后：

    npm run contribute -- init --out .local/capture.json --recommended
    npm run contribute -- schema --format capture --out .local/capture-schema.json
    npm run contribute -- capture --input .local/capture.json --out record.json

    npm run contribute -- prepare --input record.json --out preview.json --share private

核对预览、站点和分享范围后提交。缺失测量保持未知；上传成功后推进增量位置。间隔超过 3 天时重新选择范围。自动上传需要用户单独开启，调度安装方法见 docs/monitoring.md。

源码：https://github.com/Han-1413141/OpenCost-ai 。source.json 记录固定提交和提示词 SHA-256，source --verify 可核对版本。

work-summary-1 记录任务类别、完成量、验收、Token、轮次、全部后代代理和费用，难度分级关闭。已有结构字段直接复用；旧对话的分类和摘要由本地 AI 整理。npm run monitor 监控额度并按授权上传现成预览，默认关闭，不调用模型。使用方法见 docs/monitoring.md。

包内不包含模拟费用、示例排名、服务器密钥、数据库或用户记录。
`,
    'utf8',
  );
  // Validate the distributed runtime, not just the full repository checkout.
  for (const folder of ['client', 'shared'])
    for (const name of readdirSync(join(kit, folder), { recursive: true })) {
      if (!/\.[cm]?tsx?$/.test(name)) continue;
      const file = join(kit, folder, name);
      const contents = readFileSync(file, 'utf8');
      for (const match of contents.matchAll(/\b(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
        const imported = resolve(dirname(file), match[1]);
        const candidates = [imported, imported.replace(/\.js$/, '.ts'), imported.replace(/\.js$/, '.tsx'), imported.replace(/\.mjs$/, '.mts')];
        if (!candidates.some(existsSync)) throw new Error(`Missing client package dependency: ${folder}/${name} → ${match[1]}`);
      }
    }
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'source.json'), JSON.stringify(source, null, 2) + '\n', 'utf8');
  execFileSync('tar', [
    '-czf',
    join(output, 'opencost-contribute.tar.gz'),
    '-C',
    temporary,
    'opencost-contribute',
  ]);
  mkdirSync(join(output, 'opencost-contribute'), { recursive: true });
  cpSync(
    join(root, 'skills/opencost-contribute/SKILL.md'),
    join(output, 'opencost-contribute/SKILL.md'),
  );
  console.log('OpenCost public contribution kit created (no synthetic data).');
  mkdirSync(join(output, 'opencost-contribute/references'), { recursive: true });
  for (const reference of [
    'adapter-free-summary.md',
    'collection-contract.md',
    'first-use.md',
    'work-measurement.md',
    'analysis-observations.md',
    'complexity-assessment.md',
    'quota-collection.md',
  ])
    cpSync(
      join(root, 'skills/opencost-contribute/references', reference),
      join(output, 'opencost-contribute/references', reference),
    );
} finally {
  const target = realpathSync(temporary);
  if (
    dirname(target) !== temporaryRoot ||
    !target.startsWith(temporaryRoot + sep + 'opencost-client-')
  ) {
    throw new Error('Unexpected temporary directory; cleanup stopped.');
  }
  rmSync(target, { recursive: true, force: true });
}
