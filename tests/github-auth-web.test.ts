import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../web/api.js';

test('Cookie identity never becomes a Bearer credential; explicit local credentials remain intact', async (t) => {
  const seen: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { seen.push(init); return Response.json({ ready: true }); });
  await api('/api/contributions/index', { headers: { Authorization: 'Bearer github-session:someone' } });
  assert.equal(new Headers(seen[0].headers).get('Authorization'), null);
  assert.equal(seen[0].credentials, 'same-origin');
  const key = 'a'.repeat(43);
  await api('/api/contributions/index', { headers: { Authorization: `Bearer ${key}` } });
  assert.equal(new Headers(seen[1].headers).get('Authorization'), `Bearer ${key}`);
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  assert.equal(new Headers(seen[2].headers).get('X-OpenCost-CSRF'), '1');
  assert.equal(new Headers(seen[2].headers).get('Content-Type'), 'application/json');
});
