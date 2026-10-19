// Stats section: numeric columns drawn as bars on entry pages, scaled to the tab's best value.
// Uses the network-test character stats (templates/Stats.csv) on top of the live sheet's Characters layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';
import * as render from '../src/render.js';
import { search } from '../src/server.js';

const STATS = ['Health', 'Stamina', 'Strength', 'Dex', 'Mind', 'Blood Caliber', 'Arcane'];
const ROWS = readFileSync(new URL('../templates/Stats.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const byName = new Map(ROWS.map(([name, ...vals]) => [name, vals.map(Number)]));

// The live snapshot's tabs, with the stat columns appended to Characters and the CSV imported as a Stats tab.
const snapshot = readWorkbook(readFileSync(new URL('./fixtures/google-snapshot.xlsx', import.meta.url)));
const tabs = snapshot.map((tab) => {
  if (tab.name !== 'Characters') return tab;
  const [header, ...body] = tab.rows;
  const width = header.findIndex((h) => !String(h ?? '').trim());
  const rows = [[...header.slice(0, width), ...STATS], ...body.map((r) => [...r.slice(0, width), ...(byName.get(String(r[0] ?? '').trim()) ?? [])])];
  return { ...tab, rows };
});
tabs.push({ name: 'Stats', hidden: false, rows: [['Character Name', ...STATS], ...ROWS] });
const content = buildContent(tabs);
const cat = (name) => content.categories.find((c) => c.name === name);
const characters = cat('Characters');
const albert = characters.items[0];
const bar = (html, label) => new RegExp(`<dt>${label}</dt><dd><span class="stat-track" aria-hidden="true"><span class="stat-fill" style="width:(\\d+)%"></span></span><span class="stat-value mono">(\\d+)</span></dd>`).exec(html);

test('every character row got its seven stats and the Characters tab lists them as stats', () => {
  assert.deepEqual(characters.statLabels, STATS);
  assert.deepEqual(characters.fields, ['Primary Weapon', 'Secondary Weapon', ...STATS]);
  for (const item of characters.items) {
    const vals = byName.get(item.title);
    assert.ok(vals, `${item.title} has a row in templates/Stats.csv`);
    assert.deepEqual(item.fields.filter((f) => STATS.includes(f.label)).map((f) => Number(f.value)), vals, item.title);
  }
  assert.equal(characters.view, 'grid', 'still a portrait grid');
});

test('character page: weapons stay in the field list, stats become a bar section scaled to the roster best', () => {
  const html = render.itemPage(content, characters, albert);
  const [list] = /<dl class="stats">[\s\S]*?<\/dl>/.exec(html);
  assert.match(list, /^<dl class="stats"><div><dt>Primary Weapon<\/dt><dd>Lorrik&#39;s Jeweled Saber<\/dd><\/div><div><dt>Secondary Weapon<\/dt><dd>Submachine Gun<\/dd><\/div><\/dl>$/, 'only the text fields');
  const [section] = /<section class="entry-section entry-stats">[\s\S]*?<\/section>/.exec(html);
  assert.match(section, /<h2 class="with-badge"><span class="badge badge--teal"[^>]*><svg[\s\S]*?<\/svg><\/span>Stats<\/h2>/, 'heading wears the Stats tab badge');
  assert.deepEqual(STATS.map((s) => bar(section, s).slice(1)), [
    ['84', '16'], // Health 16 of Zork's 19
    ['100', '16'], // Stamina 16 is the roster max
    ['83', '15'], // Strength 15 of Jan's 18
    ['70', '14'], // Dex 14 of Samir's 20
    ['75', '12'], // Mind 12 of Samir's 16
    ['100', '20'], // Blood Caliber 20
    ['60', '12'], // Arcane 12 of 20
  ]);
  assert.ok(html.indexOf('entry-stats') < html.indexOf('>Skills</h2>'), 'stats come before skills');
});

test('a Stats tab is a sortable, right-aligned table; its pages are canonicalised to Characters', () => {
  const stats = cat('Stats');
  assert.equal(stats.view, 'table');
  assert.deepEqual(stats.badge, { icon: 'chart', text: '', color: 'teal' });
  const html = render.categoryPage(content, stats);
  assert.match(html, /<th scope="col" class="num"><button type="button" data-sort="1">Health<\/button><\/th>/);
  assert.match(html, /<td class="num">19<\/td>/, 'Zork\'s health');
  const page = render.itemPage(content, stats, stats.items[0]);
  assert.match(page, /<link rel="canonical" href="[^"]*\/c\/characters\/albert">/);
  assert.match(page, /<section class="entry-section entry-stats">/);
  assert.doesNotMatch(page, /<dl class="stats">/, 'nothing but stats, so no plain list');
});

test('a tab with no image column borrows the portrait from the same name in Characters, in rows and on the page', () => {
  const stats = cat('Stats');
  assert.ok(stats.items.every((i) => !i.image), 'the Stats tab has no pictures of its own');
  const albert = characters.items.find((i) => i.title === 'Albert');
  assert.match(albert.image, /^https:\/\/media\.fromsoftware\.jp\//);
  const html = render.categoryPage(content, stats);
  assert.match(html, new RegExp(`<td class="entry-name"><a href="/c/stats/albert"><img src="${albert.image}" alt="" width="40" height="40" loading="lazy"><span><strong>Albert</strong>`));
  assert.equal((html.match(/<td class="entry-name"><a href="[^"]*"><img /g) ?? []).length, stats.items.length, 'every row has its portrait');
  const page = render.itemPage(content, stats, stats.items[0]);
  assert.match(page, /<article class="entry entry--image">/);
  assert.match(page, new RegExp(`<img class="detail-img" src="${albert.image}" alt="Albert"`));
});

test('portrait cards show the weapons, not the numbers', () => {
  const html = render.categoryPage(content, characters);
  assert.match(html, /<strong>Zork<\/strong>\s*<small>Undersea Cable · Speargun<\/small>/);
  assert.doesNotMatch(html, /<small>19 · 16<\/small>/);
});

test('news posts have no category, so no stats section', () => {
  assert.doesNotMatch(render.postPage(content, content.news[0]), /entry-stats/);
});

test('stat values are in the search index and the client filter text', () => {
  assert.ok(search(content, 'speargun 19').some((r) => r.item.title === 'Zork'), 'Zork: Speargun, Health 19');
  assert.match(render.categoryPage(content, characters), /data-search="[^"]*undersea cable · speargun[^"]*"|data-search="[^"]*speargun 19 16 16 12 10 10 20[^"]*"/);
});
