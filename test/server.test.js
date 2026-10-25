import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';
import { sampleXlsx } from './fixtures.js';

const content = buildContent(readWorkbook(sampleXlsx()));
let server, base;

before(async () => {
  server = createServer(createApp({ get: async () => content, status: () => ({ loadedAt: 'now', error: null }) }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, type: res.headers.get('content-type'), csp: res.headers.get('content-security-policy'), text: await res.text() };
};

test('home page renders site, countdown, news and categories', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.csp, /script-src 'self' https:;/);
  assert.doesNotMatch(r.text, /adsbygoogle/, 'no ads on the home page: it is navigation (see ads.test.js)');
  assert.match(r.text, /<title>Duskbloods\.build - A build tool and companion for The Duskbloods<\/title>/);
  assert.match(r.text, /<meta property="og:title" content="Duskbloods\.build - A build tool and companion for The Duskbloods">/);
  assert.match(r.text, /Sample tagline &lt;b&gt;escaped&lt;\/b&gt;/);
  assert.match(r.text, /<p class="release mono">Release 31 Dec 2026 · <strong>\d+<\/strong> days to go<\/p>/);
  assert.match(r.text, /<h1 class="visually-hidden">The Duskbloods compendium: Bloodsworn, Weapons, Search and more<\/h1>/);
  assert.doesNotMatch(r.text, /class="(masthead|display|lede)/, 'no big title block');
  assert.match(r.text, /href="\/updates\/newer-post"/);
  assert.match(r.text, /href="\/c\/bloodsworn"/);
  assert.doesNotMatch(r.text, /Secret|Internal note|hero-bg/);
});

test('category page renders a sortable table with the sheet columns and a tag filter', async () => {
  const r = await get('/c/bloodsworn');
  assert.equal(r.status, 200);
  assert.match(r.text, /<option value="melee">Melee<\/option>/);
  assert.match(r.text, /<option value="">Any tags<\/option>/);
  assert.match(r.text, /data-sort="1">Tags<\/button>[\s\S]*data-sort="2">Role<\/button>[\s\S]*data-sort="3">Weapon<\/button>/);
  assert.match(r.text, /<td class="tags-cell">Melee, Agile<\/td>\s*<td>Striker<\/td>\s*<td>Blade<\/td>/);
  assert.match(r.text, /aria-current="page"><span class="badge badge--violet" aria-hidden="true"><svg[^>]*>[\s\S]*?<\/svg><\/span>Bloodsworn <span class="mono">3<\/span>/);
  assert.match(r.text, /href="\/c\/bloodsworn\/example-hunter-2"/);
  assert.doesNotMatch(r.text, /Secret Draft/);
});

test('sheet content is HTML-escaped and unsafe URLs never rendered', async () => {
  const r = await get('/c/bloodsworn/script-alert-1-script');
  assert.equal(r.status, 200);
  assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(r.text, /<script>alert|javascript:/);
});

test('item detail shows fields and tags', async () => {
  const r = await get('/c/bloodsworn/example-hunter');
  assert.match(r.text, /<dt>Role<\/dt><dd>Striker<\/dd>/);
  assert.match(r.text, /<img class="detail-img" src="https:\/\/example.com\/hunter.png"/);
  assert.match(r.text, /<p class="flavor">A placeholder character.<\/p>/);
  assert.match(r.text, /rel="next"><small>Next<\/small>Example Hunter<\/a>/);
  assert.doesNotMatch(r.text, /rel="prev"/);
});

test('numeric columns align right (header too); the tag column keeps the sheet\'s own label', async () => {
  const r = (await get('/c/weapons')).text;
  assert.match(r, /<th scope="col" class="num"><button type="button" data-sort="1">Damage<\/button>/);
  assert.match(r, /<td class="num">120<\/td>/);
  const typed = buildContent([{ name: 'Gear', hidden: false, rows: [['Name', 'Type'], ['Axe', 'Heavy']] }]);
  const html = await (await import('../src/render.js')).categoryPage(typed, typed.categories[0]);
  assert.match(html, /data-sort="1">Type<\/button>/);
  assert.match(html, /<option value="">Any type<\/option>/);
});

test('updates list and post detail', async () => {
  assert.match((await get('/updates')).text, /Newer post[\s\S]*Older post/);
  const post = await get('/updates/older-post');
  assert.match(post.text, /<p>Line one<\/p><p>Line two<\/p>/);
});

test('search finds items across categories, and the colliding "Search" tab is still reachable', async () => {
  const r = await get('/search?q=placeholder');
  assert.match(r.text, /2 results/);
  assert.match(r.text, /Placeholder Axe/);
  assert.equal((await get('/c/search-2')).status, 200);
});

test('404s, static files and path traversal', async () => {
  assert.equal((await get('/c/nope')).status, 404);
  assert.equal((await get('/c/bloodsworn/nope')).status, 404);
  assert.equal((await get('/updates/nope')).status, 404);
  const css = await get('/static/style.css');
  assert.equal(css.status, 200);
  assert.match(css.type, /text\/css/);
  assert.equal((await get('/static/..%2Fpackage.json')).status, 404);
  assert.equal((await get('/static/../src/server.js')).status, 404);
});

test('health and JSON API', async () => {
  assert.deepEqual(JSON.parse((await get('/health')).text), { ok: true, loadedAt: 'now', error: null });
  const api = JSON.parse((await get('/api/content')).text);
  assert.equal(api.categories.length, 3);
});

test('search ranks entries whose title has every term first', async () => {
  const { search } = await import('../src/server.js');
  const c = buildContent([{ name: 'Gear', hidden: false, rows: [['Name', 'Weapon'], ['Hunter', 'Blood Rifle'], ['Blood Rifle', '']] }]);
  assert.deepEqual(search(c, 'blood rifle').map((r) => r.item.title), ['Blood Rifle', 'Hunter']);
});

test('_pages descriptions render on their pages, escaped, and become the meta description', async () => {
  const comp = (await get('/compendium')).text;
  assert.match(comp, /<div class="page-desc"><p>Every &lt;entry&gt; catalogued.<\/p><\/div>/);
  assert.match(comp, /<meta name="description" content="Every &lt;entry&gt; catalogued.">/);
  assert.match(comp, /<span class="index-cols">The playable hunters\. Second paragraph\.<\/span>/, 'index shows the description on one line');
  assert.match((await get('/updates')).text, /<div class="page-desc"><p>News from the dusk.<\/p><\/div>/);
  const cat = (await get('/c/bloodsworn')).text;
  assert.match(cat, /<\/nav>\s*<div class="page-desc"><p>The playable hunters.<\/p><p>Second paragraph.<\/p><\/div>/);
  // Under 50 chars, so it's extended with the real entries rather than shipped thin.
  assert.match(cat, /<meta name="description" content="The playable hunters. Second paragraph. All 3 bloodsworn in The Duskbloods: Example Hunter, Example Hunter, &lt;script&gt;alert\(1\)&lt;\/script&gt;.">/);
  const weapons = (await get('/c/weapons')).text;
  assert.doesNotMatch(weapons, /page-desc/);
  assert.match(weapons, /<meta name="description" content="1 weapon in The Duskbloods: Placeholder Axe.">/, 'no description in the sheet: built from the entries');
  assert.match(weapons, /<title>Weapons in The Duskbloods \| Duskbloods\.build<\/title>/);
});

test('non-GET methods are rejected', async () => {
  const res = await fetch(base + '/', { method: 'POST' });
  assert.equal(res.status, 405);
});

test('ads.txt authorises the AdSense publisher', async () => {
  const r = await get('/ads.txt');
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/plain/);
  assert.equal(r.text, 'google.com, pub-3267360964563410, DIRECT, f08c47fec0942fa0\n');
});

test('privacy policy has the AdSense disclosures and is linked from every page', async () => {
  const r = await get('/privacy');
  assert.equal(r.status, 200);
  assert.match(r.text, /<h1>Privacy policy<\/h1>/);
  assert.match(r.text, /Third-party vendors, including Google, use cookies to serve ads based on your prior visits/);
  assert.match(r.text, /Google’s use of advertising cookies enables it and its partners to serve ads/);
  assert.match(r.text, /href="https:\/\/myadcenter\.google\.com\/"/);
  assert.match(r.text, /href="https:\/\/www\.aboutads\.info\/choices\/"/);
  assert.match(r.text, /href="https:\/\/policies\.google\.com\/technologies\/partner-sites"/);
  assert.match(r.text, /Anonymous page counts\.[\s\S]*does not record your IP address/);
  assert.doesNotMatch(r.text, /no analytics/);
  assert.match(r.text, /<link rel="canonical" href="[^"]*\/privacy">/);
  assert.doesNotMatch(r.text, /noindex/);
  for (const path of ['/', '/compendium', '/updates', '/c/weapons', '/nope']) {
    const page = (await get(path)).text;
    assert.match(page, /<footer[\s\S]*<a href="\/privacy">Privacy<\/a>/, path);
    assert.match(page, /<footer[\s\S]*<a href="https:\/\/x\.com\/Duskbloodsbuild" rel="noopener">X<\/a>/, path);
  }
});
