import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsx } from '../web/i18n/jsx-runtime.js';
import { registerHooks } from 'node:module';
import { feedbackRadar } from '../shared/feedback-radar.js';
import { feedbackTaskProfile } from '../shared/feedback-task-profile.js';
import { feedbackVisualFixture } from './personal-feedback-fixture.js';
import { journalAnalysisInput } from './journal-analysis-fixture.js';
import { analyzeJournalTask } from '../shared/journal-analysis.js';
import { journalFeedback } from '../shared/personal-feedback.js';
import { setLocale, t } from '../web/i18n/locale.js';
import { personaCatalog } from '../shared/feedback-persona.js';
import { readFileSync } from 'node:fs';
import { internalPageHref, readVbtiPage } from '../web/vbti-navigation.js';
registerHooks({
  load(url, context, nextLoad) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : nextLoad(url, context);
  },
});
const { VBTI } = await import('../web/pages/VBTI.js');
const { VBTIEntry } = await import('../web/VBTIEntry.js');
const { VBTIHeader } = await import('../web/VBTIHeader.js');

test('standalone VBTI pages, legacy bookmarks and private in-app navigation resolve without carrying credentials', () => {
  assert.equal(readVbtiPage('/vbti'), 'vbti');
  assert.equal(readVbtiPage('/vbti/test/'), 'vbti-test');
  assert.equal(readVbtiPage('/vbti/result/'), 'vbti-result');
  assert.equal(readVbtiPage('/vbti/not-a-page'), null);
  const from = 'https://opencost-ai.com/#feedback';
  assert.equal(internalPageHref('/vbti/', from), '/vbti/');
  assert.equal(internalPageHref('#vbti-result', from), '/vbti/result/');
  assert.equal(
    internalPageHref('/#feedback', 'https://opencost-ai.com/vbti/result/'),
    '/#feedback',
  );
  assert.equal(internalPageHref('https://external.example/vbti/', from), null);
  assert.equal(internalPageHref('/api/feedback', from), null);
  assert.equal(internalPageHref('/#feedback?accessKey=private', from), null);
  assert.equal(internalPageHref('/vbti/?accessKey=private', from), null);
  const header = renderToStaticMarkup(jsx(VBTIHeader, { page: 'vbti' }));
  assert.ok(header.includes('href="/vbti/test/"'));
  assert.ok(header.includes('href="/#overview"'));
  assert.ok(!header.includes('class="site-header"'));
});

test('VBTI entry, benefits, private-by-default setup and original navigation remain available', () => {
  const home = renderToStaticMarkup(jsx(VBTI, { source: null }));
  for (const phrase of [
    '你的 VBTI 类型',
    '适合你的模型',
    '值得买的套餐',
    '额度有没有缩水',
    '同套餐里什么水平',
  ])
    assert.ok(home.includes(phrase));
  assert.equal((home.match(/class="locked"/g) ?? []).length, 32);
  assert.ok(home.includes('href="/vbti/test/"'));
  assert.ok(renderToStaticMarkup(jsx(VBTIEntry, {})).includes('href="/vbti/"'));
  const setup = renderToStaticMarkup(jsx(VBTI, { source: null, test: true }));
  assert.equal((setup.match(/type="checkbox"/g) ?? []).length, 3);
  assert.equal((setup.match(/checked=""/g) ?? []).length, 1);
  assert.ok(setup.includes('任务原文、完整对话、源代码、文件路径'));
  assert.ok(setup.includes('disabled=""'));
});
test('radar uses per-turn and per-task transformations, no fabricated zero for unknown fields', () => {
  const { summary, input } = journalAnalysisInput();
  summary.tasks[0].analysis = analyzeJournalTask(input).analysis;
  Object.assign(summary.measurements, {
    agentCount: 5,
    rootAgentCount: 1,
    maxAgentDepth: 2,
    toolCalls: 20,
    userTurns: 5,
  });
  const report = journalFeedback(summary, []);
  let axes = feedbackRadar(report);
  assert.equal(axes.find((a) => a.id === 'tools')?.score, 50);
  assert.equal(axes.find((a) => a.id === 'delegation')?.score, 80);
  assert.equal(axes.find((a) => a.id === 'exploration')?.score, 0);
  report.metrics.find((m) => m.id === 'turns')!.value = 0;
  assert.equal(feedbackRadar(report).find((a) => a.id === 'tools')?.score, null);
  const empty = feedbackVisualFixture();
  empty.metrics = [];
  delete empty.taskProfile;
  assert.ok(feedbackRadar(empty).every((a) => a.score === null));
  const requirements = structuredClone(summary.tasks[0].analysis!.requirements!);
  requirements.methodFamilies = ['retrieval', 'simulation', 'statistical_inference'];
  requirements.knowledge = 'research';
  const profile = feedbackTaskProfile([{ requirements }, { requirements }])!;
  assert.deepEqual(profile.behaviorSignals?.exploration, { matched: 2, known: 2 });
  report.taskProfile = profile;
  axes = feedbackRadar(report);
  assert.equal(axes.find((a) => a.id === 'exploration')?.score, 100);
  const unknown = structuredClone(requirements);
  delete unknown.methodFamilies;
  unknown.knowledge = 'specialist';
  assert.deepEqual(feedbackTaskProfile([{ requirements: unknown }])!.behaviorSignals?.exploration, {
    matched: 0,
    known: 0,
  });
});
test('all 32 persona names, radar labels and VBTI UI are localized in each published locale', async () => {
  for (const lang of ['en', 'ja', 'zh-TW'] as const) {
    await setLocale(lang, false);
    for (const [, name, line, rule] of personaCatalog)
      for (const text of [name, line, rule]) {
        const catalog = JSON.parse(
          readFileSync(new URL('../web/i18n/locales/' + lang + '.json', import.meta.url), 'utf8'),
        );
        assert.ok(catalog[text], lang + ': ' + text);
        if (lang === 'en') assert.ok(!/[\u3400-\u9fff]/.test(t(text)), text);
      }
    const html = renderToStaticMarkup(jsx(VBTI, { source: null, test: true }));
    if (lang === 'en')
      assert.ok(!/[\u3400-\u9fff]/.test(html), 'English setup should not fall back to Chinese');
  }
  await setLocale('zh-CN', false);
});
