import test from 'node:test';
import assert from 'node:assert/strict';
import { numberFormatter } from '../web/number-format.js';

test('reused formatters preserve each locale, currency, rounding and small amounts', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja']) {
    for (const currency of [undefined, 'CNY', 'USD', 'JPY']) {
      for (const digits of currency ? [2, 4] : [0, 2, 4]) {
        const expected = new Intl.NumberFormat(locale, {
          ...(currency === undefined
            ? {}
            : { style: 'currency', currency, minimumFractionDigits: 2 }),
          maximumFractionDigits: digits,
        });
        for (const value of [0, -0, -1.25, 0.000123, 123456.789, Number.MAX_SAFE_INTEGER])
          assert.equal(
            numberFormatter(locale, digits, currency).format(value),
            expected.format(value),
          );
        assert.equal(
          numberFormatter(locale, digits, currency),
          numberFormatter(locale, digits, currency),
        );
      }
    }
  }
});
