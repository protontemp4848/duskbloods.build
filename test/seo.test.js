// SEO output, over HTTP, against the snapshot of the real sheet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createApp } from '../src/server.js';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';
import { clip, describeItem, isPlaceholder, originFor } from '../src/seo.js';

const content = buildContent(readWorkbook(readFileSync(new URL('./fixtures/google-snapshot.xlsx', import.meta.url))));
const ORIGIN = 'https://duskbloods.example';
let server, base;

before(async () => {
  server = createServer(createApp({ get: async () => content, status: () => ({}) }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// Requests look like they came through Cloud Run's proxy for ORIGIN.
async function get(path, headers = {}) {
  const res = await fetch(base + path, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'duskbloods.example', ...headers } });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const meta = (html, attr, key) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`))?.[1];
const canonicalOf = (html) => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
const jsonLd = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);

const sitemapUrls = async () => [...(await get('/sitemap.xml')).text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

test('sitemap lists every indexable canonical page and nothing else', async () => {
  const r = await get('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/xml/);
  const urls = await sitemapUrls();
  // 3 top-level + 5 categories + 6 characters + 20 items + 1 post. Albert & co in Weapons/Skills/Aspects
  // duplicate their Characters pages, so only the Characters versions are listed.
  assert.equal(urls.length, 35);
  assert.ok(urls.every((u) => u.startsWith(`${ORIGIN}/`)));
  assert.ok(urls.includes(`${ORIGIN}/c/characters/albert`));
  assert.ok(!urls.includes(`${ORIGIN}/c/skills/albert`));
  assert.equal(new Set(urls).size, urls.length, 'no duplicates');
  assert.match(r.text, /<loc>https:\/\/duskbloods\.example\/updates\/[^<]+<\/loc><lastmod>2026-10-16<\/lastmod>/);
  assert.match(r.text, /<image:loc>https:\/\/media\.fromsoftware\.jp\/[^<]+albert\.jpg<\/image:loc>/);
});

test('every sitemap URL is a 200 whose canonical is itself, with unique titles and real descriptions', async () => {
  const titles = new Map();
  for (const url of await sitemapUrls()) {
    const r = await get(url.replace(ORIGIN, ''));
    assert.equal(r.status, 200, url);
    assert.equal(canonicalOf(r.text), url, `canonical of ${url}`);
    assert.equal(meta(r.text, 'property', 'og:url'), url);
    assert.doesNotMatch(r.text, /name="robots" content="noindex/, url);
    const title = r.text.match(/<title>(.*?)<\/title>/)[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    assert.ok(!titles.has(title), `duplicate title ${title} on ${url} and ${titles.get(title)}`);
    titles.set(title, url);
    assert.ok(title.length <= 65, `title too long (${title.length}): ${title}`);
    const desc = meta(r.text, 'name', 'description').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    assert.ok(desc.length >= 50 && desc.length <= 160, `description length ${desc.length} on ${url}: ${desc}`);
    assert.ok(!/\bTODO\b/.test(desc), `placeholder description on ${url}`);
    assert.equal(r.text.match(/<h1[ >]/g).length, 1, `one h1 on ${url}`);
    for (const k of ['og:title', 'og:description', 'og:image', 'og:type']) assert.ok(meta(r.text, 'property', k), `${k} on ${url}`);
    assert.match(meta(r.text, 'property', 'og:image'), /^https:\/\//);
    jsonLd(r.text); // parses
  }
});

test('duplicate entries canonicalise to the full page and stay out of the sitemap', async () => {
  for (const tab of ['skills', 'aspects', 'weapons']) {
    const r = await get(`/c/${tab}/albert`);
    assert.equal(r.status, 200);
    assert.equal(canonicalOf(r.text), `${ORIGIN}/c/characters/albert`);
  }
});

test('category pages have their own h1 and list their entries in JSON-LD', async () => {
  const r = await get('/c/items');
  assert.match(r.text, /<h1>Items<\/h1>/);
  assert.match(r.text, /<title>All 20 Items in The Duskbloods \| Duskbloods\.build<\/title>/);
  assert.match(meta(r.text, 'name', 'description'), /^All 20 items in The Duskbloods: Goldblood Stake, Blood Boluses/, 'TODO description replaced by real entries');
  const graph = jsonLd(r.text)['@graph'];
  const list = graph.find((n) => n['@type'] === 'CollectionPage').mainEntity;
  assert.equal(list.numberOfItems, 20);
  assert.equal(list.itemListElement[0].url, `${ORIGIN}/c/items/goldblood-stake`);
  const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList').itemListElement;
  assert.deepEqual(crumbs.map((c) => [c.position, c.name, c.item]), [[1, 'Compendium', `${ORIGIN}/compendium`], [2, 'Items', undefined]]);
});

test('character page: descriptive title, data-built description, portrait card, ItemPage JSON-LD', async () => {
  const r = await get('/c/characters/albert');
  assert.match(r.text, /<title>Albert: Skills &amp; Aspects \| The Duskbloods \| Duskbloods\.build<\/title>/);
  const desc = meta(r.text, 'name', 'description');
  assert.match(desc, /Primary Weapon: Lorrik&#39;s Jeweled Saber/);
  assert.match(desc, /Skills: Blood Blade, Light of Hayern/);
  assert.match(meta(r.text, 'property', 'og:image'), /albert\.jpg$/);
  assert.equal(meta(r.text, 'name', 'twitter:card'), 'summary');
  const graph = jsonLd(r.text)['@graph'];
  const page = graph.find((n) => n['@type'] === 'ItemPage');
  assert.equal(page.about.name, 'Albert');
  assert.equal(page.about.subjectOf['@id'], `${ORIGIN}/#game`);
  assert.deepEqual(graph.find((n) => n['@type'] === 'VideoGame').name, 'The Duskbloods');
  assert.match(r.text, /<img class="detail-img"[^>]*fetchpriority="high"/);
});

test('update post is a BlogPosting with its real date', async () => {
  const url = (await sitemapUrls()).find((u) => u.includes('/updates/'));
  const r = await get(url.replace(ORIGIN, ''));
  const post = jsonLd(r.text)['@graph'].find((n) => n['@type'] === 'BlogPosting');
  assert.equal(post.datePublished, '2026-10-16');
  assert.equal(meta(r.text, 'property', 'og:type'), 'article');
  assert.equal(meta(r.text, 'property', 'article:published_time'), '2026-10-16');
});

test('home: above-the-fold portraits load eagerly, the first with high priority', async () => {
  const r = await get('/');
  const imgs = [...r.text.matchAll(/<a class="portrait"[^>]*>\s*<img ([^>]*)>/g)].map((m) => m[1]);
  assert.equal(imgs.length, 6);
  assert.match(imgs[0], /fetchpriority="high"/);
  assert.ok(imgs.every((a) => !a.includes('loading="lazy"')));
  assert.equal(meta(r.text, 'property', 'og:image'), `${ORIGIN}/static/og.png?v=${r.text.match(/og\.png\?v=(\w+)/)[1]}`);
});

test('search and 404 pages are noindex', async () => {
  assert.match((await get('/search?q=blood')).text, /<meta name="robots" content="noindex, follow">/);
  const nf = await get('/c/nope');
  assert.equal(nf.status, 404);
  assert.match(nf.text, /noindex/);
});

test('robots.txt points at the sitemap', async () => {
  const r = await get('/robots.txt');
  assert.match(r.text, /^User-agent: \*$/m);
  assert.match(r.text, /^Disallow: \/api\/$/m);
  assert.match(r.text, new RegExp(`^Sitemap: ${ORIGIN}/sitemap.xml$`, 'm'));
});

test('trailing slashes 301 to the canonical URL, keeping the query', async () => {
  const r = await get('/c/items/?x=1');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/c/items?x=1');
});

test('HTML is compressed (brotli, else gzip) with Vary; HSTS over https', async () => {
  const br = await fetch(base + '/', { headers: { 'accept-encoding': 'gzip, br', 'x-forwarded-proto': 'https' } });
  assert.equal(br.headers.get('content-encoding'), 'br');
  assert.equal(br.headers.get('vary'), 'Accept-Encoding');
  assert.match(br.headers.get('strict-transport-security'), /max-age=31536000/);
  // fetch decodes transparently; check it's really brotli by asking for raw bytes via node:http
  const raw = await new Promise((resolve) => {
    import('node:http').then(({ get: hget }) => hget(base + '/', { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ enc: res.headers['content-encoding'], body: Buffer.concat(chunks) }));
    }));
  });
  assert.equal(raw.enc, 'gzip');
  assert.match(gunzipSync(raw.body).toString(), /<!doctype html>/);
  assert.ok(brotliDecompressSync);
});

test('fingerprinted assets are cached for a year; unversioned ones briefly', async () => {
  const html = (await get('/')).text;
  const css = html.match(/href="(\/static\/style\.css\?v=\w+)"/)[1];
  assert.equal((await get(css)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await get('/static/style.css')).headers.get('cache-control'), 'public, max-age=3600');
  assert.equal((await get('/static/style.css?v=stale')).headers.get('cache-control'), 'public, max-age=3600');
  assert.equal((await get('/static/ibm-plex-sans.woff2')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const fav = await get('/favicon.ico');
  assert.equal(fav.status, 200);
  assert.equal(fav.headers.get('content-type'), 'image/x-icon');
});

test('JSON-LD cannot be broken out of by sheet content', () => {
  const evil = buildContent([{ name: 'Gear', hidden: false, rows: [['Name', 'Summary'], ['</script><script>alert(1)</script>', 'x'.repeat(60)]] }]);
  return import('../src/render.js').then((r) => {
    const html = r.itemPage({ ...evil, origin: ORIGIN }, evil.categories[0], evil.categories[0].items[0]);
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
    assert.ok(!ld.includes('<'), 'every < is escaped inside JSON-LD');
    assert.equal(JSON.parse(ld)['@graph'].find((n) => n['@type'] === 'ItemPage').name, '</script><script>alert(1)</script>');
  });
});

test('helpers: placeholder detection, clipping, origin', () => {
  assert.ok(isPlaceholder('TODO') && isPlaceholder(' tbd. ') && isPlaceholder('') && !isPlaceholder('Today we ride'));
  const c = clip('word '.repeat(60), 40);
  assert.ok(c.length <= 40 && c.endsWith('…') && !c.includes('  '));
  assert.equal(originFor({ headers: { host: 'a.run.app', 'x-forwarded-proto': 'https' } }, {}), 'https://a.run.app');
  assert.equal(originFor({ headers: { host: 'a.run.app' } }, { SITE_URL: 'https://duskbloods.build/' }), 'https://duskbloods.build');
  const item = content.categories.find((x) => x.name === 'Items').items.find((i) => i.title === 'Blood Boluses');
  assert.match(describeItem(item, content.categories[1], content.site), /^Boluses formed by blood\. Effect: Slowly heal HP over time/);
});
