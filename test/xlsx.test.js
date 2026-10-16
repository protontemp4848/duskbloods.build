import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWorkbook, serialToDate, decodeXml } from '../src/xlsx.js';
import { makeXlsx } from './make-xlsx.js';

test('reads the real (empty) Google Sheets export', () => {
  const tabs = readWorkbook(readFileSync(new URL('./fixtures/google-empty.xlsx', import.meta.url)));
  assert.deepEqual(tabs, [{ name: 'Sheet1', hidden: false, rows: [], images: [] }]);
});

test('reads strings, numbers, booleans, dates, sparse cells and hidden tabs', () => {
  const buf = makeXlsx([
    { name: 'A & B', rows: [
      ['Name', null, 'Notes'],
      ['Tom & "Jerry" <x>', 3.5, true],
      [null, { date: 46387 }, 'ünïcödé ✶'],
    ] },
    { name: 'Hidden', hidden: true, rows: [['x']] },
  ]);
  const [a, b] = readWorkbook(buf);
  assert.equal(a.name, 'A & B');
  assert.equal(a.hidden, false);
  assert.deepEqual(a.rows, [
    ['Name', '', 'Notes'],
    ['Tom & "Jerry" <x>', '3.5', 'TRUE'],
    ['', '2026-12-31', 'ünïcödé ✶'],
  ]);
  assert.equal(b.hidden, true);
});

test('serialToDate handles dates and datetimes', () => {
  assert.equal(serialToDate(45658), '2025-01-01');
  assert.equal(serialToDate(45658.5), '2025-01-01 12:00');
});

test('decodeXml handles named and numeric entities', () => {
  assert.equal(decodeXml('&lt;a&gt; &amp;amp; &#39; &#x2736;'), "<a> &amp; ' ✶");
});

test('rejects non-xlsx input with a clear error', () => {
  assert.throws(() => readWorkbook(Buffer.from('<!doctype html><title>Sign in</title>')), /Not a zip/);
});
