import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { getLocale, preferredLocale, setLocale, t } from '../web/i18n/locale.js';
import { jsx, Fragment } from '../web/i18n/jsx-runtime.js';

test('Language selection recognizes browser variants and validates supported locales', async () => {
  for (const value of ['zh-TW', 'zh-Hant', 'zh-HK']) assert.equal(preferredLocale(value), 'zh-TW');
  assert.equal(preferredLocale('zh-CN'), 'zh-CN');
  assert.equal(preferredLocale('ja-JP'), 'ja');
  assert.equal(preferredLocale('fr-FR'), 'en');
  await assert.rejects(setLocale('other' as 'en', false), /Unsupported/);
});

test('Every catalogue covers the same phrases and preserves numbered variables', () => {
  const catalogs = ['en', 'ja', 'zh-TW'].map((locale) => JSON.parse(readFileSync(new URL(`../web/i18n/locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>);
  assert.ok(Object.keys(catalogs[0]).length > 4000);
  for (const catalog of catalogs) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs[0]).sort());
    for (const [source, translated] of Object.entries(catalog)) {
      assert.ok(translated.trim(), source);
      assert.deepEqual((translated.match(/\{\d+\}/g) ?? []).sort(), (source.match(/\{\d+\}/g) ?? []).sort(), source);
    }
  }
});

test('Rendered labels and accessibility attributes translate; protocol values and event handlers stay intact', async () => {
  await setLocale('en', false);
  const click = () => {};
  const element = jsx('button', { children: '我的记录', 'aria-label': '我的记录', title: '我的记录', value: '我的记录', 'data-id': '我的记录', onClick: click });
  const props = element.props as Record<string, unknown>;
  assert.notEqual(props.children, '我的记录');
  assert.equal(props.children, props['aria-label']);
  assert.equal(props.value, '我的记录');
  assert.equal(props['data-id'], '我的记录');
  assert.equal(props.onClick, click);
  assert.ok(!renderToStaticMarkup(element).includes('aria-label="我的记录"'));
});

test('Raw code, user input and downloadable records remain unchanged', async () => {
  await setLocale('en', false);
  const value = '我的记录';
  for (const tag of ['pre', 'code', 'textarea'] as const) assert.equal((jsx(tag, { children: value }).props as Record<string, unknown>).children, value);
  assert.equal((jsx('option', { children: value, 'data-no-translate': true }).props as Record<string, unknown>).children, value);
  assert.equal((jsx('input', { value, placeholder: value }).props as Record<string, unknown>).value, value);
  assert.equal(JSON.stringify({ schemaVersion: '1.1', label: value, cost: 123 }), '{"schemaVersion":"1.1","label":"我的记录","cost":123}');
});

test('Dynamic phrases preserve measurements and translate labels inside fragments', async () => {
  await setLocale('en', false);
  assert.notEqual(t('已登录 · someone'), '已登录 · someone');
  assert.ok(t('已登录 · someone').includes('someone'));
  const html = renderToStaticMarkup(jsx(Fragment, { children: ['我的记录', ' / ', 123] }));
  assert.ok(!html.includes('我的记录') && html.includes('123'));
});

test('Japanese, Traditional Chinese and Simplified Chinese restore independently', async () => {
  await setLocale('ja', false);
  assert.equal(getLocale(), 'ja');
  assert.notEqual(t('退出登录'), '退出登录');
  await setLocale('zh-TW', false);
  assert.notEqual(t('订阅额度'), '订阅额度');
  await setLocale('zh-CN', false);
  assert.equal(t('我的记录'), '我的记录');
  assert.equal(t('未知的用户输入'), '未知的用户输入');
});
