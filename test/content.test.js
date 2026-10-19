import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook } from '../src/xlsx.js';
import { readFileSync } from 'node:fs';
import { buildContent, tabToItems, slugify, safeUrl } from '../src/content.js';
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
  const [w] = c.categories;
  assert.deepEqual({ ...w }, { name: 'Weapons', slug: 'weapons', columns: ['Name', 'Damage'], fields: ['Damage'], statLabels: [], abilityLabels: [], tagLabel: 'Tags', items: [], description: '', view: 'table', badge: { icon: 'sword', text: '', color: 'red' } });
});

test('_pages tab: descriptions for top-level pages and categories, matched case-insensitively', () => {
  assert.deepEqual(content.pages, { compendium: 'Every <entry> catalogued.', updates: 'News from the dusk.' });
  assert.equal(content.categories[0].description, 'The playable hunters.\n\nSecond paragraph.');
  assert.equal(content.categories[1].description, '', 'no row for Weapons');
  assert.ok(!content.categories.some((c) => c.name === '_pages'), '_pages is not a category');
});

test('_pages works without a header row; blank descriptions are ignored', () => {
  const c = buildContent([
    { name: '_pages', hidden: false, rows: [['updates', 'Patch notes'], ['Compendium', '']] },
    { name: 'Weapons', hidden: false, rows: [['Name'], ['Axe']] },
  ]);
  assert.deepEqual(c.pages, { compendium: '', updates: 'Patch notes' });
  assert.equal(c.categories[0].description, '');
});

test('"X" + "X Description" columns pair into grouped abilities, with bracketed notes', () => {
  const { items, fields, abilityLabels } = tabToItems([
    ['Character Name', 'Weapon', 'Skill 1', 'Skill 1 Description', 'Skill 2 (Level 12)', 'Skill 2 Description', 'Aspect', 'Aspect Description', 'Orphan Description'],
    ['Albert', 'Saber', 'Blood Blade', 'Fires a blade.', 'Light', 'Shines.', 'Upriser', 'Staggers.', 'No partner'],
  ]);
  assert.equal(items[0].title, 'Albert', '"Character Name" is the title column');
  assert.deepEqual(abilityLabels, ['Skill 1', 'Skill 2 (Level 12)', 'Aspect']);
  assert.deepEqual(items[0].abilities, [
    { group: 'Skills', label: 'Skill 1', name: 'Blood Blade', note: '', text: 'Fires a blade.' },
    { group: 'Skills', label: 'Skill 2 (Level 12)', name: 'Light', note: 'Level 12', text: 'Shines.' },
    { group: 'Aspect', label: 'Aspect', name: 'Upriser', note: '', text: 'Staggers.' },
  ]);
  assert.deepEqual(fields, ['Weapon', 'Orphan Description'], 'an unpaired "... Description" stays a normal column');
});

test('long-text columns become prose sections, short ones stay stats', () => {
  const long = 'x'.repeat(120);
  const { items, fields } = tabToItems([['Item Name', 'Description', 'Effect', 'Lore'], ['Stake', 'A stake.', 'Heals.', long]]);
  assert.equal(items[0].summary, 'A stake.');
  assert.deepEqual(items[0].fields, [{ label: 'Effect', value: 'Heals.' }]);
  assert.deepEqual(items[0].sections, [{ label: 'Lore', value: long }]);
  assert.deepEqual(fields, ['Effect']);
});

test('numeric columns are listed as stats; mixed, blank and long columns are not', () => {
  const { items, fields, statLabels } = tabToItems([
    ['Character Name', 'Weapon', 'Health', 'Dex', 'Crit', 'Level', 'Empty', 'Notes Text'],
    ['Albert', 'Saber', '16', '14', '5%', '12 (base)', '', 'x'.repeat(100)],
    ['Zork', 'Cable', 19, 12, '7%', '', '', ''],
  ]);
  assert.deepEqual(statLabels, ['Health', 'Dex', 'Crit'], 'percentages count; "12 (base)" makes Level text; an empty column is not a stat');
  assert.deepEqual(fields, ['Weapon', 'Health', 'Dex', 'Crit', 'Level', 'Empty'], 'stats stay in the ordinary field list too');
  assert.deepEqual(items[1].fields, [{ label: 'Weapon', value: 'Cable' }, { label: 'Health', value: '19' }, { label: 'Dex', value: '12' }, { label: 'Crit', value: '7%' }]);
});

test('views: auto grid/list/table, overridable from _pages', () => {
  const img = 'https://x.test/a.png';
  const c = buildContent([
    { name: '_pages', hidden: false, rows: [['Page', 'Description', 'View'], ['Forced', '', 'Cards']] },
    { name: 'Portraits', hidden: false, rows: [['Name', 'Portrait'], ['A', img], ['B', img], ['C', '']] },
    { name: 'Abilities', hidden: false, rows: [['Name', 'Skill', 'Skill Description'], ['A', 'S', 'D']] },
    { name: 'Stats', hidden: false, rows: [['Name', 'Damage'], ['A', '1']] },
    { name: 'Forced', hidden: false, rows: [['Name', 'Damage'], ['A', '1']] },
    // Pictures plus stats and abilities (a character roster) is still a grid...
    { name: 'Roster', hidden: false, rows: [['Name', 'Portrait', 'Weapon', 'Skill', 'Skill Description'], ['A', 'https://x.test/r.png', 'W', 'S', 'D']] },
    // ...but pictures plus abilities and nothing else would be a wall of names, so it's a list.
    { name: 'Pictured Abilities', hidden: false, rows: [['Name', 'Portrait', 'Skill', 'Skill Description'], ['A', img, 'S', 'D'], ['B', img, 'S', 'D']] },
    // Reusing an earlier tab's pictures (each character's weapons, with their portrait) is a list of icons, not a second gallery.
    { name: 'Loadouts', hidden: false, rows: [['Name', 'Portrait', 'Weapon'], ['A', img, 'W'], ['B', img, 'W']] },
    { name: 'Own Pictures', hidden: false, rows: [['Name', 'Portrait', 'Weapon'], ['A', 'https://x.test/b.png', 'W']] },
  ]);
  assert.deepEqual(c.categories.map((x) => [x.name, x.view]),
    [['Portraits', 'grid'], ['Abilities', 'list'], ['Stats', 'table'], ['Forced', 'grid'], ['Roster', 'grid'],['Pictured Abilities', 'list'], ['Loadouts', 'list'], ['Own Pictures', 'grid']]);
  assert.equal(c.categories[0].items[0].image, img, '"Portrait" column is the image');
});

test('real Google Sheets export with data (snapshot of the live sheet, 2026-10-16)', () => {
  const live = buildContent(readWorkbook(readFileSync(new URL('./fixtures/google-snapshot.xlsx', import.meta.url))));
  assert.deepEqual(live.categories.map((c) => [c.name, c.items.length, c.view]),
    [['Characters', 6, 'grid'], ['Items', 20, 'list'], ['Aspects', 6, 'list'], ['Weapons', 6, 'table'], ['Skills', 6, 'list']]);
  const albert = live.categories[0].items[0];
  assert.equal(albert.title, 'Albert');
  assert.match(albert.image, /^https:\/\/media\.fromsoftware\.jp\//);
  assert.deepEqual(albert.fields.map((f) => f.label), ['Primary Weapon', 'Secondary Weapon']);
  assert.deepEqual(albert.abilities.map((a) => [a.group, a.name, a.note]),
    [['Skills', 'Blood Blade', ''], ['Skills', 'Light of Hayern', 'Level 12'], ['Aspects', 'High Lorrik Blood', ''], ['Aspects', 'Upriser', '']]);
  assert.equal(live.news[0].date, '2026-10-16');
  assert.match(live.categories[1].items[0].sections.find((s) => s.label === 'Lore').value, /Golden blood/);
});

test('_pages Icon/Color: icon names, emoji or short text, named colours only; columns in any order', () => {
  const c = buildContent([
    { name: '_pages', hidden: false, rows: [
      ['Color', 'Page', 'Icon'],
      ['teal', 'Weapons', 'Skull'],
      ['hotpink', 'Bats', '🦇'],
      ['', 'Runes', 'iv'],
      ['', 'Daggers', 'dagger'],
      ['', 'Updates', 'moon'],
    ] },
    ...['Weapons', 'Bats', 'Runes', 'Daggers', 'Misc'].map((name) => ({ name, hidden: false, rows: [['Name'], ['x']] })),
  ]);
  assert.deepEqual(c.categories.map((x) => [x.name, x.badge]), [
    ['Weapons', { icon: 'skull', text: '', color: 'teal' }],
    ['Bats', { icon: '', text: '🦇', color: 'amber' }], // invalid colour -> palette
    ['Runes', { icon: '', text: 'IV', color: 'green' }],
    ['Daggers', { icon: '', text: 'D', color: 'teal' }], // unknown icon word -> no keyword match -> first letter
    ['Misc', { icon: '', text: 'M', color: 'blue' }],
  ]);
  assert.equal(c.badges.updates.icon, 'moon');
});

test('slugify and safeUrl', () => {
  assert.equal(slugify('  Ça va? Blood-Moon  Sword! '), 'ca-va-blood-moon-sword');
  assert.equal(slugify('???'), 'item');
  assert.equal(safeUrl('data:text/html,hi'), '');
  assert.equal(safeUrl('not a url'), '');
  assert.equal(safeUrl('https://x.test/a b'), 'https://x.test/a%20b');
});
