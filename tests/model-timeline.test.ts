import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelTimeline, combineModelTimelines, emptyTimelineTokens, ModelTimelineSchema, type ModelObservation } from '../shared/model-timeline.js';
import { LogModelUsage } from '../desktop/model-usage.js';
import { accountConnectLink, parseAccountConnect } from '../shared/feedback-link.js';
import { consumeFeedbackAccess } from '../web/feedback-access.js';

const a = { provider: 'openai', model: 'gpt-6.1-sol', version: 'v1' };
const b = { ...a, model: 'gpt-6-astra' };
const observation = (model = a, sequence = 0, stream = 'private-project/agent') : ModelObservation => ({
  stream, model, sequence, tokens: { ...emptyTimelineTokens(), inputTokens: 100, outputTokens: 20 },
  at: `2026-10-16T01:00:0${sequence}.000Z`, apiEquivalentMinor: 5, currency: 'CNY',
});
test('A B A keeps three phases and two switches, independent descendants never cause switches', () => {
  const rows = [observation(a, 0), observation(b, 1), observation(a, 2), observation(b, 0, 'child'), observation(a, 0, 'grandchild')];
  const timeline = buildModelTimeline(rows.reverse(), true);
  assert.equal(timeline.switches, 2);
  const primary = timeline.streams.find(s => s.observations === 3)!;
  assert.deepEqual(primary.segments.map(s => s.model?.model), [a.model, b.model, a.model]);
  assert.equal(primary.segments.reduce((n,s) => n+s.tokens.inputTokens!,0), 300);
  assert.equal(primary.segments.reduce((n,s) => n+s.apiEquivalentMinor!,0), 15);
  assert.doesNotMatch(JSON.stringify(timeline), /private-project|grandchild/);
  assert.equal(combineModelTimelines([timeline,timeline]).switches, 4);
});
test('unknown order, models, or coverage cannot produce a complete switch count', () => {
  assert.equal(buildModelTimeline([],true).switches,0);
  assert.equal(buildModelTimeline([],false).switches,null);
  const missing = [observation(),observation(b,1)].map(({ sequence, at, ...r }) => r);
  assert.equal(buildModelTimeline(missing,true).switches, null);
  assert.equal(buildModelTimeline(missing,true).unsequencedObservations, 2);
  const sameTime = [observation(),{...observation(b,1),at:observation().at}].map(({ sequence,...r })=>r);
  assert.equal(buildModelTimeline(sameTime,true).observedSwitches, 0);
  assert.equal(buildModelTimeline([observation(),{...observation(b,1),model:null},observation(a,2)],true).observedSwitches,0);
  assert.equal(buildModelTimeline([observation(),observation(b,1)],false).switches,null);
  assert.equal(combineModelTimelines([buildModelTimeline([observation()],true),undefined]).coverage,'partial');
});
test('partial token data and mixed currencies are not filled or added as one cost', () => {
  const timeline = buildModelTimeline([observation(),{...observation(a,1),tokens:emptyTimelineTokens(),currency:'USD'}],true);
  assert.equal(timeline.streams[0].segments[0].tokens.inputTokens,null);
  assert.equal(timeline.streams[0].segments[0].knownTokens.inputTokens,100);
  assert.equal(timeline.streams[0].segments[0].apiEquivalentMinor,null);
  assert.equal(ModelTimelineSchema.safeParse({...timeline,switches:900}).success,false);
});
const from = Date.parse('2026-10-16T00:00:00Z'), through = from+86400000;
const codex = () => new LogModelUsage('codex',from,through);
const context = (model: string) => ({type:'turn_context',timestamp:'2026-10-16T01:00:00Z',payload:{model}});
const usage = (input:number,output:number) => ({type:'event_msg',timestamp:'2026-10-16T01:00:01Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,output_tokens:output,cached_input_tokens:0,reasoning_output_tokens:0}}}});
test('Codex cumulative usage uses deltas across model changes and ignores repeated notifications', () => {
  const log=codex();
  log.feed({type:'session_meta',timestamp:'2026-10-16T00:00:00Z',payload:{}});
  log.feed(context(a.model)); log.feed(usage(100,20)); log.feed(usage(100,20));
  log.feed(context(b.model)); log.feed(usage(160,30));
  log.feed(context(a.model)); log.feed(usage(200,40));
  const result=log.finish();
  assert.equal(result.switches,2);
  assert.deepEqual(result.streams[0].segments.map(s=>s.tokens.inputTokens),[100,60,40]);
});
test('missing baseline, counter reset, and private model aliases retain unknown values', () => {
  const log=codex();
  log.feed(context(a.model)); log.feed(usage(100,20));
  log.feed(context(b.model)); log.feed(usage(10,2)); log.feed(usage(30,4));
  log.feed(context('private-client-secret-alias')); log.feed(usage(40,6));
  const result=log.finish();
  assert.equal(result.switches,null);
  assert.equal(result.streams[0].segments[0].tokens.inputTokens,null);
  assert.equal(result.streams[0].segments[1].tokens.inputTokens,null);
  assert.equal(result.streams[0].segments[1].knownTokens.inputTokens,20);
  assert.doesNotMatch(JSON.stringify(result),/private-client/);
});
test('DSH missing agent identities never create false cross-agent switches; duplicate calls counted once', () => {
  const log=new LogModelUsage('dsh',from,through);
  const call=(id:string,model:string)=>({type:'call',id,at:'2026-10-16T01:00:00Z',model,tokens:{input:10,output:5,cacheRead:2,cacheWrite:3}});
  log.feed(call('1',a.model)); log.feed(call('1',a.model)); log.feed(call('2',b.model));
  const result=log.finish();
  assert.equal(result.observedSwitches,0);
  assert.equal(result.switches,null);
  assert.equal(result.streams.reduce((n,s)=>n+s.observations,0),2);
});
test('account connection token is removed from address before page initialization', () => {
  const url = new URL(accountConnectLink('https://opencost.invalid','t'.repeat(43)));
  assert.equal(url.search,'');
  assert.equal(parseAccountConnect(url.hash),'t'.repeat(43));
  assert.equal(parseAccountConnect(url.hash+'&token='+ 'x'.repeat(43)),null);
  let replaced='';
  const result=consumeFeedbackAccess(url,{state:null,replaceState:(_s:unknown,_unused:string,u?:string|URL|null)=>{replaced=String(u);}});
  assert.equal(result?.connectToken,'t'.repeat(43));
  assert.equal(result?.accessKey,'');
  assert.equal(replaced,'/#feedback');
});
