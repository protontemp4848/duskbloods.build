import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import { isBot, device, referrerHost, pageview } from '../src/analytics.js';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';
import { sampleXlsx } from './fixtures.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

test('bots, scripts and missing user agents are not counted; browsers are', () => {
  for (const ua of ['', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mediapartners-Google', 'Mozilla/5.0 (Linux; Android 6.0.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Mediapartners-Google/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    'curl/8.5.0', 'python-requests/2.32.3', 'node', 'Discordbot/2.0']) {
    assert.equal(isBot(ua), true, ua || '(empty)');
  }
  for (const ua of [CHROME, IPHONE, ANDROID_TABLET]) assert.equal(isBot(ua), false, ua);
});

test('device is a coarse bucket', () => {
  assert.equal(device(CHROME), 'desktop');
  assert.equal(device(IPHONE), 'mobile');
  assert.equal(device(ANDROID_PHONE), 'mobile');
  assert.equal(device(ANDROID_TABLET), 'tablet');
  assert.equal(device('Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X)'), 'tablet');
});

test('referrer keeps only another site\'s hostname', () => {
  const own = ['duskbloods.build', 'duskbloods-abc-ew.a.run.app'];
  assert.equal(referrerHost('https://www.reddit.com/r/duskbloods/comments/abc/secret_title/?utm=x', own), 'reddit.com');
  assert.equal(referrerHost('https://www.google.com/', own), 'google.com');
  assert.equal(referrerHost('https://duskbloods.build/c/weapons', own), '');
  assert.equal(referrerHost('https://www.duskbloods.build/', own), '');
  assert.equal(referrerHost('', own), '');
  assert.equal(referrerHost('android-app://com.reddit.frontpage/', own), '');
  assert.equal(referrerHost('not a url', own), '');
});

test('pageview skips HEAD and prefetches, and normalises search terms', () => {
  const req = (headers, method = 'GET') => ({ method, headers: { 'user-agent': CHROME, host: 'localhost:8080', ...headers } });
  assert.equal(pageview(req({}, 'HEAD'), '/', 200, 'http://localhost:8080'), null);
  assert.equal(pageview(req({ 'sec-purpose': 'prefetch;prerender' }), '/', 200, 'http://localhost:8080'), null);
  assert.equal(pageview(req({ purpose: 'prefetch' }), '/', 200, 'http://localhost:8080'), null);
  assert.deepEqual(pageview(req({ referer: 'https://duskbloods.build/' }), '/search', 200, 'https://duskbloods.build', { q: '  Blood   BLADE ', results: 0 }),
    { path: '/search', status: 200, ref: '', device: 'desktop', q: 'blood blade', results: 0 });
  assert.deepEqual(pageview(req({}), '/search', 200, 'http://localhost:8080', { q: '', results: 0 }),
    { path: '/search', status: 200, ref: '', device: 'desktop' });
});

// Over HTTP: which requests produce an event, and that the event holds nothing identifying.
const content = buildContent(readWorkbook(sampleXlsx()));
const events = [];
let server, base;

before(async () => {
  server = createServer(createApp({ get: async () => content, status: () => ({}) }, { track: (e) => events.push(e) }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const visit = async (path, headers = {}, method = 'GET') => {
  events.length = 0;
  const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'user-agent': IPHONE, ...headers } });
  await res.arrayBuffer();
  return { status: res.status, events: [...events], setCookie: res.headers.get('set-cookie') };
};

test('each page a person loads logs one event, with no cookie', async () => {
  const r = await visit('/c/bloodsworn/example-hunter?utm_source=x', { referer: 'https://old.reddit.com/r/duskbloods/x', 'x-forwarded-for': '203.0.113.9' });
  assert.equal(r.status, 200);
  assert.equal(r.setCookie, null);
  assert.deepEqual(r.events, [{ path: '/c/bloodsworn/example-hunter', status: 200, ref: 'old.reddit.com', device: 'mobile' }]);
  assert.doesNotMatch(JSON.stringify(r.events), /203\.0\.113\.9|iPhone|utm/);
  for (const path of ['/', '/compendium', '/c/bloodsworn', '/updates', '/updates/newer-post', '/privacy']) {
    assert.deepEqual((await visit(path)).events.map((e) => [e.path, e.status]), [[path, 200]], path);
  }
});

test('searches log the normalised query and how many results it found', async () => {
  assert.deepEqual((await visit('/search?q=Example%20HUNTER')).events[0], { path: '/search', status: 200, ref: '', device: 'mobile', q: 'example hunter', results: 2 });
  assert.equal((await visit('/search?q=zzzz')).events[0].results, 0);
});

test('missing pages log a 404 event', async () => {
  assert.deepEqual((await visit('/c/bloodsworn/nobody')).events, [{ path: '/c/bloodsworn/nobody', status: 404, ref: '', device: 'mobile' }]);
  assert.deepEqual((await visit('/nope')).events.map((e) => e.status), [404]);
});

test('files, feeds, redirects, health checks, bots, HEAD and own-site referrers are handled', async () => {
  for (const path of ['/static/style.css', '/robots.txt', '/sitemap.xml', '/ads.txt', '/api/content', '/health', '/favicon.ico', '/c/bloodsworn/']) {
    assert.deepEqual((await visit(path)).events, [], path);
  }
  assert.deepEqual((await visit('/', { 'user-agent': 'Googlebot/2.1' })).events, []);
  assert.deepEqual((await visit('/', {}, 'HEAD')).events, []);
  const host = new URL(base).host;
  assert.equal((await visit('/compendium', { referer: `http://${host}/` })).events[0].ref, '');
});
