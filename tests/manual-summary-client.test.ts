import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManualSummary, manualSummaryTemplate, prepareJournal } from '../client/manual-summary.js';
import { LocalUsageSchema } from '../client/usage-facts.js';
import { evaluatePriceMetering } from '../shared/price-metering.js';

const window = { day: '2026-10-10', timeZone: 'UTC', startAt: '2026-10-10T00:00:00Z', endAt: '2026-10-10T12:00:00Z' };
test('最少任务直接生成私有摘要，不依赖插件，不虚构计量', () => {
  const facts = { ...manualSummaryTemplate(window, 'dsh'), tasks: [{ localId: 'local-goal', kind: 'bugfix', unit: 'requirement' }] };
  const { summary } = compileManualSummary(facts);
  assert.equal(summary.tasks.length, 1);
  assert.equal(summary.tasks[0].reportedCompleted, null);
  assert.equal(summary.measurements.inputTokens, null);
  assert.equal(summary.processing.costMinor, null);
  assert.equal(summary.processing.durationMs, null);
  assert.equal(summary.consent.store, false);
  assert.ok(!JSON.stringify(summary).includes('local-goal'));
  assert.ok(!JSON.stringify(summary).includes(facts.salt));
  const preview = prepareJournal(summary);
  assert.equal(preview.ranked, false);
  assert.equal(preview.digest, prepareJournal(summary).digest);
});
test('原始调用自动补未知值，部分用量去重后保留小计', () => {
  const call = { id: 'local-call', agentId: 'local-agent', sequence: 0,
    usage: { provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1000, outputTokens: 200 } };
  const facts = { ...manualSummaryTemplate(window, 'dsh'), tasks: [{ localId: 'goal', kind: 'bugfix', unit: 'requirement' }], calls: [call, structuredClone(call)] };
  const { summary, report } = compileManualSummary(facts);
  assert.equal(report.duplicatesRemoved, 1);
  assert.equal(summary.measurements.knownTokenSubtotals!.inputTokens, 1000);
  assert.equal(summary.measurements.inputTokens, null);
  assert.equal(summary.measurements.modelTimeline!.switches, null);
  const usage = LocalUsageSchema.parse(call.usage);
  assert.equal(usage.cachedInputTokens, null);
  assert.equal(evaluatePriceMetering(usage, 'USD').comparableMinor, null);
  facts.calls[1].usage.outputTokens++;
  assert.throws(() => compileManualSummary(facts), /相同本地事实标识/);
});
