// AdSense placement: the ad script only loads on screens with the editor's own writing (an entry's Commentary, a
// news post's body), never on copied game text alone or on navigation, search and error screens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';
import { MIN_OWN_WORDS } from '../src/render.js';
import { sampleTabs } from './fixtures.js';

const AD_SCRIPT = /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-3267360964563410/;
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

// Every page path a content model has, so nothing slips through as new pages are added.
function allPaths(content) {
  return [
    '/', '/compendium', '/updates', '/privacy', '/search', '/search?q=a', '/no-such-page',
    ...content.news.map((p) => `/updates/${p.slug}`),
    ...content.categories.flatMap((c) => [`/c/${c.slug}`, ...c.items.map((i) => `/c/${c.slug}/${i.slug}`)]),
  ];
}

async function serve(content) {
  const server = createServer(createApp({ get: async () => content, status: () => ({}) }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, get: async (path) => (await fetch(base + path)).text() };
}

// The live sheet as Google reviewed it: copied game text and art, no commentary.
const live = buildContent(readWorkbook(readFileSync(new URL('./fixtures/google-snapshot.xlsx', import.meta.url))));

// The sample sheet plus a Commentary column (one entry long enough, one too short), one long news post, a long intro
// for Weapons, a short one for Bloodsworn, and a long one for an empty category.
const withCommentary = buildContent([...sampleTabs.map((tab) => {
  if (tab.name === 'Weapons') {
    return { ...tab, rows: [['Name', 'Damage', 'Commentary'], ['Long Take', 120, words(MIN_OWN_WORDS)], ['Short Take', 90, words(MIN_OWN_WORDS - 1)], ['No Take', 80, '']] };
  }
  if (tab.name === 'News') return { ...tab, rows: [...tab.rows, [{ date: 46320 }, 'Long post', 'Summary', words(MIN_OWN_WORDS)]] };
  if (tab.name === '_pages') return { ...tab, rows: [...tab.rows, ['Weapons', words(MIN_OWN_WORDS)], ['Empty', words(MIN_OWN_WORDS)]] };
  return tab;
}), { name: 'Empty', rows: [['Name']] }]);

let liveSite, site;
before(async () => { [liveSite, site] = await Promise.all([serve(live), serve(withCommentary)]); });
after(() => { liveSite.server.close(); site.server.close(); });

test('the live sheet as reviewed has no page that loads ads', async () => {
  const paths = allPaths(live);
  assert.ok(paths.length > 40, `covers every page (${paths.length})`);
  for (const path of paths) assert.doesNotMatch(await liveSite.get(path), AD_SCRIPT, path);
});

test('ads load only on entries, posts and categories with enough of the editor\'s own words', async () => {
  assert.ok(withCommentary.categories.find((c) => c.slug === 'bloodsworn').description, 'Bloodsworn has a short intro');
  assert.ok(withCommentary.categories.find((c) => c.slug === 'empty'), 'the empty category is rendered');
  const withAds = [];
  for (const path of allPaths(withCommentary)) if (AD_SCRIPT.test(await site.get(path))) withAds.push(path);
  assert.deepEqual(withAds.sort(), ['/c/weapons', '/c/weapons/long-take', '/updates/long-post']);
});

test('commentary is shown under its own heading and is searchable', async () => {
  const html = await site.get('/c/weapons/short-take');
  assert.match(html, /<section class="entry-section"><h2>Commentary<\/h2><div class="prose"><p>word0 word1/);
  assert.doesNotMatch(await site.get('/c/weapons/no-take'), /<h2>Commentary<\/h2>/);
  assert.match(await site.get('/search?q=word148'), /href="\/c\/weapons\/short-take"/);
});
