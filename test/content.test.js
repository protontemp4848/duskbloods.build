import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent, slugify, safeUrl } from '../src/content.js';
import { sampleXlsx } from './fixtures.js';

const content = buildContent(readWorkbook(sampleXlsx()), { fetchedAt: new Date('2026-10-16T00:00:00Z') });

test('_site tab populates site settings and strips unsafe URLs', () => {
  assert.equal(content.site.title, 'Duskbloods.build');
  assert.equal(content.site.release_date, '2026-12-31');
  assert.equal(content.site.hero_image, '');
  assert.equal(content.site.discord_url, 'https://discord.gg/example');
});

test('only visible, non-underscore, non-news tabs become categories', () => {
  assert.deepEqual(content.categories.map((c) => [c.name, c.slug]), [
    ['Bloodsworn', 'bloodsworn'],
    ['Weapons', 'weapons'],
    ['Search', 'search-2'], // must not shadow the /search route
  ]);
});

test('News is sorted newest first', () => {
  assert.deepEqual(content.news.map((n) => [n.title, n.date]), [['Newer post', '2026-10-15'], ['Older post', '2026-10-05']]);
});

test('items: drafts and untitled rows skipped, duplicate slugs made unique, extra columns become fields', () => {
  const items = content.categories[0].items;
  assert.deepEqual(items.map((i) => i.slug), ['example-hunter', 'example-hunter-2', 'script-alert-1-script']);
  const [hunter] = items;
  assert.deepEqual(hunter.tags, ['Melee', 'Agile']);
  assert.equal(hunter.image, 'https://example.com/hunter.png');
  assert.deepEqual(hunter.fields, [{ label: 'Role', value: 'Striker' }, { label: 'Weapon', value: 'Blade' }]);
  assert.equal(items[2].image, '', 'javascript: URL must be dropped');
});

test('header row may start below blank rows; numbers and booleans come through as text', () => {
  const [axe] = content.categories[1].items;
  assert.deepEqual(axe.fields, [{ label: 'Damage', value: '120' }, { label: 'Two Handed', value: 'TRUE' }]);
});

test('an empty sheet produces an empty but valid site', () => {
  const empty = buildContent([{ name: 'Sheet1', hidden: false, rows: [] }]);
  assert.equal(empty.site.title, 'Duskbloods.build');
  assert.deepEqual(empty.news, []);
  assert.deepEqual(empty.categories, [], 'a blank tab is not a category');
});

test('a tab with headers but no rows is an empty category', () => {
  const c = buildContent([{ name: 'Weapons', hidden: false, rows: [['Name', 'Damage']] }]);
  assert.deepEqual(c.categories, [{ name: 'Weapons', slug: 'weapons', columns: ['Name', 'Damage'], fields: ['Damage'], tagLabel: 'Tags', items: [] }]);
});

test('slugify and safeUrl', () => {
  assert.equal(slugify('  Ça va? Blood-Moon  Sword! '), 'ca-va-blood-moon-sword');
  assert.equal(slugify('???'), 'item');
  assert.equal(safeUrl('data:text/html,hi'), '');
  assert.equal(safeUrl('not a url'), '');
  assert.equal(safeUrl('https://x.test/a b'), 'https://x.test/a%20b');
});
