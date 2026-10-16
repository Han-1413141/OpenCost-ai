import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../web/api.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GithubAccountProvider, GithubLoginButton } from '../web/GithubAccount.js';
import { authReturnTo, authRedirect } from '../shared/auth-navigation.js';

test('OAuth return destinations accept VBTI pages and locale, never keys or external URLs', () => {
  assert.equal(authReturnTo('/vbti/test/?lang=en'), '/vbti/test/?lang=en');
  assert.equal(authRedirect('/vbti/', 'cancelled'), '/vbti/?login=cancelled');
  for (const path of [
    'https://evil.invalid',
    '//evil.invalid',
    '/vbti/?key=secret',
    '/vbti/#key=secret',
    '/vbti/?lang=en&lang=ja',
    '/api/auth/access',
    '/vbti/../private',
  ])
    assert.equal(authReturnTo(path), null, path);
});

test('Header GitHub icon opens personal feedback without initiating OAuth', () => {
  const html = renderToStaticMarkup(
    createElement(GithubAccountProvider, {
      ownerKey: '',
      setOwnerKey: () => {},
      children: createElement(GithubLoginButton, { header: true }),
    }),
  );
  assert.match(html, /href="#feedback"/);
  assert.ok(!html.includes('/api/auth/github/start'));
  assert.match(html, /个人反馈/);
});

test('Cookie identity never becomes a Bearer credential; explicit local credentials remain intact', async (t) => {
  const seen: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    seen.push(init);
    return Response.json({ ready: true });
  });
  await api('/api/contributions/index', {
    headers: { Authorization: 'Bearer github-session:someone' },
  });
  assert.equal(new Headers(seen[0].headers).get('Authorization'), null);
  assert.equal(seen[0].credentials, 'same-origin');
  const key = 'a'.repeat(43);
  await api('/api/contributions/index', { headers: { Authorization: `Bearer ${key}` } });
  assert.equal(new Headers(seen[1].headers).get('Authorization'), `Bearer ${key}`);
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  assert.equal(new Headers(seen[2].headers).get('X-OpenCost-CSRF'), '1');
  assert.equal(new Headers(seen[2].headers).get('Content-Type'), 'application/json');
});
