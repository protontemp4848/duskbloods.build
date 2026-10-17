import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSource, fetchXlsx, exportUrl } from '../src/sheet.js';
import { sampleXlsx } from './fixtures.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const quiet = { error() {}, log() {} };
const dir = mkdtempSync(join(tmpdir(), 'sheet-test-'));

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

test('fetchXlsx downloads the xlsx export URL', async () => {
  const calls = mockFetch([{ body: sampleXlsx() }]);
  const buf = await fetchXlsx('abc');
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.deepEqual(calls, ['https://docs.google.com/spreadsheets/d/abc/export?format=xlsx']);
  assert.equal(calls[0], exportUrl('abc'));
});

test('a private sheet (HTML sign-in page) gives a helpful error', async () => {
  mockFetch([{ body: '<!doctype html><title>Sign in</title>' }]);
  await assert.rejects(fetchXlsx('abc'), /Anyone with the link/);
});

test('an HTTP error from Google fails the download', async () => {
  mockFetch([{ body: 'nope', status: 500 }]);
  await assert.rejects(fetchXlsx('abc'), /HTTP 500/);
});

test('loads the file once, logs it, and never touches the network', async () => {
  const file = join(dir, 'ok.xlsx');
  writeFileSync(file, sampleXlsx());
  globalThis.fetch = () => assert.fail('the running app must not fetch');
  const lines = [];
  const source = await loadSource({ file, log: { log: (m) => lines.push(JSON.parse(m)) } });
  const a = await source.get();
  const b = await source.get();
  assert.equal(a, b);
  assert.equal(a.categories[0].name, 'Bloodsworn');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].severity, 'INFO');
  assert.match(lines[0].message, /^Sheet loaded from .*ok\.xlsx \(downloaded \d{4}-\d\d-\d\dT/);
  assert.equal(source.status().error, null);
  assert.match(source.status().loadedAt, /^\d{4}-\d\d-\d\dT/);
});

test('a missing or broken file throws, so the server never starts', async () => {
  await assert.rejects(loadSource({ file: join(dir, 'missing.xlsx'), log: quiet }), /ENOENT/);
  const bad = join(dir, 'bad.xlsx');
  writeFileSync(bad, '<!doctype html>');
  await assert.rejects(loadSource({ file: bad, log: quiet }));
});

test('requires SHEET_FILE', async () => {
  await assert.rejects(loadSource({ log: quiet }), /SHEET_FILE/);
});
