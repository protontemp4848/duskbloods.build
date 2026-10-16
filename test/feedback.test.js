import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseFormUrl, createReporter, isSitePath, LIMITS } from '../src/feedback.js';
import { createApp } from '../src/server.js';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';
import { sampleXlsx } from './fixtures.js';

const PREFILL = 'https://docs.google.com/forms/d/e/1FAIpQLSexample/viewform?usp=pp_url&entry.111=PAGE&entry.222=Entry&entry.333=message';

test('parseFormUrl reads the pre-filled link (placeholders case-insensitive)', () => {
  assert.deepEqual(parseFormUrl(PREFILL), {
    action: 'https://docs.google.com/forms/d/e/1FAIpQLSexample/formResponse',
    fields: { page: 'entry.111', entry: 'entry.222', message: 'entry.333' },
  });
  assert.equal(parseFormUrl(PREFILL.replace('&entry.333=message', '')), null, 'all three placeholders required');
  assert.equal(parseFormUrl(PREFILL.replace('https:', 'http:')), null, 'https only');
  assert.equal(parseFormUrl('not a url'), null);
  assert.equal(parseFormUrl(''), null);
});

test('isSitePath only allows same-site paths (no open redirects)', () => {
  for (const ok of ['/', '/c/items/goldblood-stake', '/search?q=blood']) assert.ok(isSitePath(ok), ok);
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'c/items', '/a b', '', null]) assert.ok(!isSitePath(bad), String(bad));
});

function fakeFetch(status = 200) {
  const calls = [];
  return { calls, fetchImpl: async (url, opts) => { calls.push({ url, body: Object.fromEntries(opts.body) }); if (status === 0) throw new Error('offline'); return { status }; } };
}
const quiet = { error() {} };
const form = parseFormUrl(PREFILL);

test('reporter forwards page, entry and message to the form', async () => {
  const f = fakeFetch();
  const submit = createReporter(form, { fetchImpl: f.fetchImpl, log: quiet });
  assert.deepEqual(await submit({ ip: '1', page: '/c/items/x', entry: 'Items › X', message: '  Wrong stat  ' }), { status: 200 });
  assert.deepEqual(f.calls, [{ url: form.action, body: { 'entry.111': '/c/items/x', 'entry.222': 'Items › X', 'entry.333': 'Wrong stat' } }]);
});

test('reporter: honeypot, validation, rate limit, delivery failure', async () => {
  const f = fakeFetch();
  let t = 0;
  const submit = createReporter(form, { fetchImpl: f.fetchImpl, now: () => t, log: quiet });
  assert.equal((await submit({ ip: 'bot', page: '/', message: 'buy pills', trap: 'http://spam' })).status, 200, 'bots get a fake success');
  assert.equal((await submit({ ip: 'a', page: '/', message: 'hi' })).status, 400, 'too short');
  assert.equal((await submit({ ip: 'a', page: '/', message: 'x'.repeat(LIMITS.message + 1) })).status, 400, 'too long');
  assert.equal((await submit({ ip: 'a', page: '//evil.com', message: 'hello there' })).status, 400, 'off-site page');
  assert.equal(f.calls.length, 0, 'nothing invalid is forwarded');

  for (let i = 0; i < LIMITS.perWindow; i++) assert.equal((await submit({ ip: 'a', page: '/', message: `report ${i}` })).status, 200);
  assert.equal((await submit({ ip: 'a', page: '/', message: 'one more' })).status, 429);
  assert.equal((await submit({ ip: 'b', page: '/', message: 'other visitor' })).status, 200, 'per visitor');
  t += LIMITS.windowMs + 1;
  assert.equal((await submit({ ip: 'a', page: '/', message: 'later' })).status, 200, 'window expires');

  const down = createReporter(form, { fetchImpl: fakeFetch(0).fetchImpl, log: quiet });
  assert.equal((await down({ ip: 'c', page: '/', message: 'google is down' })).status, 502);
  const rejected = createReporter(form, { fetchImpl: fakeFetch(400).fetchImpl, log: quiet });
  assert.equal((await rejected({ ip: 'c', page: '/', message: 'form changed' })).status, 502);
});

// Over HTTP, with a local stand-in for Google's formResponse endpoint.
let google, site, siteBase, received = [];
before(async () => {
  google = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push({ path: req.url, form: Object.fromEntries(new URLSearchParams(body)) }); res.end('<p>Your response has been recorded.</p>'); });
  });
  await new Promise((r) => google.listen(0, r));
  const prefill = `http://127.0.0.1:${google.address().port}/forms/d/e/abc/viewform?entry.1=PAGE&entry.2=ENTRY&entry.3=MESSAGE`;
  const content = buildContent(readWorkbook(sampleXlsx()));
  site = createServer(createApp({ get: async () => content, status: () => ({}) }, { report: createReporter(parseFormUrl(prefill), { log: quiet }) }));
  await new Promise((r) => site.listen(0, r));
  siteBase = `http://127.0.0.1:${site.address().port}`;
});
after(() => { google.close(); site.close(); });

const post = (body, headers = {}) => fetch(`${siteBase}/report`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(body), headers });

test('every page carries the form, labelled with what it is', async () => {
  const html = await (await fetch(`${siteBase}/c/bloodsworn/example-hunter`)).text();
  assert.match(html, /<details class="report" id="report">/);
  assert.match(html, /<input type="hidden" name="page" value="\/c\/bloodsworn\/example-hunter">/);
  assert.match(html, /<input type="hidden" name="entry" value="Bloodsworn › Example Hunter">/);
  assert.match(html, /<input name="website" tabindex="-1" autocomplete="off">/);
  assert.match(await (await fetch(`${siteBase}/c/nope`)).text(), /name="page" value="\/c\/nope"/, 'even the 404 page');
});

test('in-page (JSON) submit reaches the Google Form', async () => {
  received = [];
  const res = await post({ page: '/c/bloodsworn/example-hunter', entry: 'Bloodsworn › Example Hunter', message: 'Role should be Duelist', website: '' }, { Accept: 'application/json' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(received, [{ path: '/forms/d/e/abc/formResponse', form: { 'entry.1': '/c/bloodsworn/example-hunter', 'entry.2': 'Bloodsworn › Example Hunter', 'entry.3': 'Role should be Duelist' } }]);
});

test('no-JavaScript submit redirects back to the page with a confirmation', async () => {
  const res = await post({ page: '/c/weapons', entry: 'Weapons', message: 'Axe damage is 130' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/c/weapons?reported=sent#report');
  const html = await (await fetch(`${siteBase}/c/weapons?reported=sent`)).text();
  assert.match(html, /<details class="report" id="report" open>/);
  assert.match(html, /Thanks, your report was sent\./);
  assert.match(html, /<link rel="canonical" href="[^"]*\/c\/weapons">/, 'the confirmation URL still canonicalises to the page');
});

test('errors: invalid input, off-site redirect target, oversized body, other methods', async () => {
  const bad = await post({ page: '/', message: 'x' }, { Accept: 'application/json' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Please describe the problem.');
  const evil = await post({ page: '//evil.com', message: 'hello there' });
  assert.equal(evil.headers.get('location'), '/?reported=failed#report', 'never redirects off-site');
  const big = await post({ page: '/', message: 'x'.repeat(10_000) });
  assert.equal(big.status, 413);
  assert.equal((await fetch(`${siteBase}/c/weapons`, { method: 'POST' })).status, 405);
});

test('without FEEDBACK_FORM_URL the form is hidden and /report is a 404', async () => {
  const content = buildContent(readWorkbook(sampleXlsx()));
  const off = createServer(createApp({ get: async () => content, status: () => ({}) }));
  await new Promise((r) => off.listen(0, r));
  const b = `http://127.0.0.1:${off.address().port}`;
  assert.doesNotMatch(await (await fetch(`${b}/`)).text(), /class="report"/);
  assert.equal((await fetch(`${b}/report`, { method: 'POST', body: 'message=hello+there&page=/', headers: { Accept: 'application/json' } })).status, 404);
  off.close();
});
