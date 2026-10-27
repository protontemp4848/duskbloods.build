// A tab whose columns are "<Tab> Name" / "<Tab>Caption" (the Buddies tab): the caption is the entry body, the page is
// a list showing it, and the section gets the "people" badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContent, tabToItems } from '../src/content.js';
import * as render from '../src/render.js';
import { describeItem } from '../src/seo.js';

const CAPTION = 'An imprisoned former opera singer. One of the Ring kin.\n\nHis singing boosts defense for nearby allies.\n\nCore skills earned through leveling up:\n- Lv.2: Sing a Melody';
const buddies = { name: 'Buddies', hidden: false, rows: [
  ['BuddyName', 'BuddyInfo', 'BuddyCaption'],
  ['Baritone', 'Ring kin', CAPTION],
  ['Gargoyle', '', 'A half-petrified woman of the cloth.\nOne of the Eye kin.'],
] };
const content = buildContent([buddies]);
const cat = content.categories[0];

test('BuddyName is the title, BuddyCaption the body (no prose section), BuddyInfo a spaced-out field label', () => {
  const [baritone, gargoyle] = cat.items;
  assert.equal(baritone.title, 'Baritone');
  assert.equal(baritone.body, CAPTION.split('\n\nCore skills')[0], 'the level lines are pulled out of the body');
  assert.deepEqual(baritone.sections, []);
  assert.deepEqual(baritone.fields, [{ label: 'Buddy Info', value: 'Ring kin' }]);
  assert.deepEqual(cat.fields, ['Buddy Info']);
  assert.deepEqual(gargoyle.fields, []);
  assert.equal(gargoyle.body, 'A half-petrified woman of the cloth.\nOne of the Eye kin.');
});

test('a plain "Caption" column is the body too; "Body" still wins when both exist', () => {
  const t = tabToItems([['Name', 'Caption'], ['x', 'long caption text here']]);
  assert.equal(t.items[0].body, 'long caption text here');
  const both = tabToItems([['Name', 'Caption', 'Body'], ['x', 'cap', 'body']]);
  assert.equal(both.items[0].body, 'body');
  assert.deepEqual(both.items[0].fields, [{ label: 'Caption', value: 'cap' }]);
});

test('a body-only tab is a list (not a names-only table) and Buddies gets the people badge', () => {
  assert.equal(cat.view, 'list');
  assert.deepEqual(cat.badge, { icon: 'people', text: '', color: 'amber' });
  assert.equal(buildContent([{ name: 'Companions', hidden: false, rows: [['Name'], ['x']] }]).categories[0].badge.icon, 'people');
  assert.equal(buildContent([{ name: 'Characters', hidden: false, rows: [['Name'], ['x']] }]).categories[0].badge.icon, 'person', 'person keyword still wins for characters');
});

test('list page shows the whole body, level lines included, with nothing folded; the body is filterable', () => {
  const html = render.categoryPage(content, cat);
  assert.match(html, /<div class="list">/);
  assert.match(html, /<h2><a href="\/c\/buddies\/baritone">Baritone<\/a><\/h2>[\s\S]*?<div class="prose prose--list"><p>An imprisoned former opera singer\. One of the Ring kin\.<\/p><p>His singing boosts defense for nearby allies\.<\/p><\/div>/);
  assert.doesNotMatch(html, /<details/, 'nothing is folded away');
  assert.match(html, /data-search="[^"]*sing a melody[^"]*"/);
  assert.doesNotMatch(html, /BuddyCaption|Caption</);
});

test('entry page renders the body as paragraphs under no heading, and the meta description uses it', () => {
  const html = render.itemPage(content, cat, cat.items[0]);
  assert.match(html, /<div class="prose entry-section"><p>An imprisoned former opera singer\. One of the Ring kin\.<\/p><p>His singing boosts defense for nearby allies\.<\/p><\/div>/);
  assert.doesNotMatch(html, /<h2>Buddy ?Caption<\/h2>/);
  assert.match(describeItem(cat.items[0], cat, content.site), /^Baritone, buddy in The Duskbloods. Buddy Info: Ring kin. An imprisoned former opera singer. One of the Ring kin. His singing boosts/);
});

test('"Lv.N" lines come out of the body as a captioned levels table, in all the spellings the sheet uses', () => {
  const wulf = tabToItems([['Name', 'Caption'], ['Wulf', 'A black wolf.\n\nCore skills earned through leveling up:\n- Lv.4 Whirlwind Fang\n- Lv.4 Howl of the Beastlord (Subjugates beasts)\n- Lv.5 Mantle of Storm']]).items[0];
  assert.equal(wulf.body, 'A black wolf.');
  assert.equal(wulf.levelsCaption, 'Core skills earned through leveling up');
  assert.deepEqual(wulf.levels, [{ level: 4, text: 'Whirlwind Fang' }, { level: 4, text: 'Howl of the Beastlord (Subjugates beasts)' }, { level: 5, text: 'Mantle of Storm' }]);
  const loose = tabToItems([['Name', 'Body'], ['x', 'Intro.\n• Level 2: Poison Flask\nLv 3 - Suicide Attack\nOutro.']]).items[0];
  assert.deepEqual(loose.levels, [{ level: 2, text: 'Poison Flask' }, { level: 3, text: 'Suicide Attack' }]);
  assert.equal(loose.levelsCaption, '', 'no caption when the line before is not a "...:" line');
  assert.equal(loose.body, 'Intro.\nOutro.');
  assert.deepEqual(tabToItems([['Name', 'Body'], ['x', 'Reach level 3 first.']]).items[0].levels, [], 'prose mentioning a level is left alone');
  assert.equal(cat.items[1].levels.length, 0);
});

test('the levels table renders on list cards and entry pages, and its rows are searchable', () => {
  const table = '<table class="levels"><caption>Core skills earned through leveling up</caption><thead><tr><th class="num">Lv.</th><th>Unlocks</th></tr></thead><tbody><tr><td class="num">2</td><td>Sing a Melody</td></tr></tbody></table>';
  const list = render.categoryPage(content, cat);
  assert.ok(list.includes(`<p>His singing boosts defense for nearby allies.</p></div>\n    ${table}`), 'list: table right after the body, which no longer holds the Lv line');
  assert.doesNotMatch(list, /<p>Core skills|<p>- Lv/);
  assert.match(list, /data-search="[^"]*lv\.2 sing a melody[^"]*"/);
  const page = render.itemPage(content, cat, cat.items[0]);
  assert.ok(page.includes(`<p>His singing boosts defense for nearby allies.</p></div>\n    ${table}`), 'entry page: same table under the body');
  assert.equal(buildContent([{ name: 'Tales', hidden: false, rows: [['Name', 'Body'], ['x', 'Lv.1: Only levels here']] }]).categories[0].view, 'list', 'levels alone still make a list, not a names-only table');
});
