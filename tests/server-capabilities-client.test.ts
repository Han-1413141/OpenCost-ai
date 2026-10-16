import test from 'node:test';
import assert from 'node:assert/strict';
import { checkServer } from '../client/server-capabilities.js';
import { uploadProtocol } from '../shared/upload-protocol.js';

test('接口预检查只读公开声明，不发送凭据、历史或请求正文', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://site.invalid/api/capabilities');
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.equal(new Headers(init?.headers).get('cache-control'), 'no-cache');
    return Response.json(uploadProtocol);
  };
  const result = await checkServer('https://site.invalid');
  assert.equal(result.status, 'compatible');
  assert.equal(result.uploaded, false);
  assert.equal(calls, 1);
});

test('旧站点或不支持未知金额时给出升级状态，不猜零或发起提交', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('', { status: 404 });
  assert.equal((await checkServer('https://site.invalid')).status, 'upgrade_required');
  globalThis.fetch = async () => Response.json({ ...uploadProtocol,
    contribution: { ...uploadProtocol.contribution, nullableAmounts: false } });
  const result = await checkServer('https://site.invalid');
  assert.equal(result.status, 'incompatible');
  assert.equal('contributionSupported' in result && result.contributionSupported, false);
  assert.equal('journalSupported' in result && result.journalSupported, true);
});

test('接口声明不得把私有上传重定向到其他地址', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ ...uploadProtocol,
    contribution: { ...uploadProtocol.contribution, submit: 'https://elsewhere.invalid/collect' } });
  assert.equal((await checkServer('https://site.invalid')).status, 'incompatible');
});
