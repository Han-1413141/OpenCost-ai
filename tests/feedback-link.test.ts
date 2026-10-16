import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackLink, parseFeedbackLink } from '../shared/feedback-link.js';
import { consumeFeedbackAccess } from '../web/feedback-access.js';
const key = 'a'.repeat(43),
  recordId = 'a4d38aad-c626-460b-a441-c72479f35c63';
test('Private feedback URLs carry credentials only in fragments and clear them before rendering', () => {
  for (const kind of ['contribution', 'journal', 'subscription'] as const) {
    const url = new URL(feedbackLink('https://opencost.invalid', key, { kind, recordId }));
    assert.equal(url.search, '');
    assert.ok(!url.pathname.includes(key));
    assert.deepEqual(parseFeedbackLink(url.hash), { accessKey: key, target: { kind, recordId } });
    const calls: unknown[][] = [];
    assert.deepEqual(
      consumeFeedbackAccess(url, {
        state: null,
        replaceState: (...args) => {
          calls.push(args);
        },
      }),
      { accessKey: key, target: { kind, recordId } },
    );
    assert.equal(url.pathname, kind === 'subscription' ? '/' : '/vbti/result/');
    assert.equal(calls[0][2], kind === 'subscription' ? '/#feedback' : '/vbti/result/');
    assert.ok(!JSON.stringify(calls).includes(key));
  }
});

test('Old general and work links enter VBTI after consuming the key; explicit cost links keep their page', () => {
  for (const kind of [null, 'journal', 'contribution'] as const) {
    const url = new URL('https://opencost.invalid/#feedback?key=' + key + (kind ? `&kind=${kind}&recordId=${recordId}` : ''));
    let clean = '';
    const access = consumeFeedbackAccess(url, { state: null, replaceState: (_s, _t, value) => { clean = String(value); } });
    assert.equal(access?.accessKey, key);
    assert.equal(clean, '/vbti/result/');
    assert.ok(!clean.includes(key));
  }
  const url = new URL(feedbackLink('https://opencost.invalid', key, undefined, 'feedback'));
  assert.equal(url.pathname, '/');
  let clean = '';
  consumeFeedbackAccess(url, { state: null, replaceState: (_s, _t, value) => { clean = String(value); } });
  assert.equal(clean, '/#feedback');
  const direct = new URL(feedbackLink('https://opencost.invalid', key));
  assert.equal(direct.pathname, '/vbti/result/');
});
test('Malformed or ambiguous private links never import a credential; sensitive fragments are still cleared', () => {
  for (const hash of [
    `#feedback?key=${key}&key=${key}`,
    `#feedback?key=${key}&recordId=invalid`,
    `#feedback?key=${key}&redirect=https://other.invalid`,
    '#feedback?key=bad',
  ]) {
    let clean = '';
    assert.equal(
      consumeFeedbackAccess(
        { hash, pathname: '/', search: '' },
        {
          state: null,
          replaceState: (_s, _t, url) => {
            clean = String(url);
          },
        },
      ),
      null,
    );
    assert.equal(clean, '/#feedback');
  }
  assert.throws(() => feedbackLink('https://user:password@opencost.invalid', key));
  assert.throws(() => feedbackLink('https://opencost.invalid/private', key));
  assert.throws(() => feedbackLink('https://opencost.invalid/?key=x', key));
});
