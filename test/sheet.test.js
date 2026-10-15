import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSource, exportUrl } from '../src/sheet.js';
import { sampleXlsx } from './fixtures.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const quiet = { error() {} };

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(next.body, { status: next.status ?? 200 });
  };
  return calls;
}

test('fetches the xlsx export URL and caches for the TTL', async () => {
  const calls = mockFetch([{ body: sampleXlsx() }]);
  const source = createSource({ sheetId: 'abc', ttlMs: 60_000, log: quiet });
  const a = await source.get();
  const b = await source.get();
  assert.equal(a, b);
  assert.deepEqual(calls, [exportUrl('abc')]);
  assert.equal(calls[0], 'https://docs.google.com/spreadsheets/d/abc/export?format=xlsx');
  assert.equal(a.categories[0].name, 'Bloodsworn');
});

test('a private sheet (HTML sign-in page) gives a helpful error', async () => {
  mockFetch([{ body: '<!doctype html><title>Sign in</title>' }]);
  const source = createSource({ sheetId: 'abc', log: quiet });
  await assert.rejects(source.get(), /Anyone with the link/);
});

test('keeps serving stale content when a refresh fails, and records the error', async () => {
  mockFetch([{ body: sampleXlsx() }, new Error('network down')]);
  const source = createSource({ sheetId: 'abc', ttlMs: 0, log: quiet });
  const first = await source.get();
  const second = await source.get(); // TTL expired: triggers a background refresh, returns stale immediately
  assert.equal(second, first);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(source.status().error, 'network down');
  assert.equal(await source.get(), first);
});

test('with nothing cached, the next request retries after a failure', async () => {
  const calls = mockFetch([{ body: 'nope', status: 500 }, { body: sampleXlsx() }]);
  const source = createSource({ sheetId: 'abc', ttlMs: 60_000, log: quiet });
  await assert.rejects(source.get(), /HTTP 500/);
  const ok = await source.get();
  assert.equal(ok.categories.length, 3);
  assert.equal(calls.length, 2);
});

test('requires SHEET_ID or SHEET_FILE', () => {
  assert.throws(() => createSource({}), /SHEET_ID/);
});
