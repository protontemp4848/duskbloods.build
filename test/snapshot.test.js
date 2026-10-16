// Rendering and search against a snapshot of the real sheet (test/fixtures/google-snapshot.xlsx, 2026-10-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';
import * as render from '../src/render.js';
import { search } from '../src/server.js';

const content = buildContent(readWorkbook(readFileSync(new URL('./fixtures/google-snapshot.xlsx', import.meta.url))));
const cat = (name) => content.categories.find((c) => c.name === name);
const stripBadges = (html) => html.replace(/<span class="badge [^"]*" aria-hidden="true">(?:<svg[\s\S]*?<\/svg>|<span>[^<]*<\/span>)<\/span>/g, '');

test('every section gets an automatic badge matching its name', () => {
  assert.deepEqual(content.categories.map((c) => [c.name, c.badge.icon, c.badge.color]), [
    ['Characters', 'person', 'violet'], ['Items', 'flask', 'green'], ['Aspects', 'drop', 'rose'], ['Weapons', 'sword', 'red'], ['Skills', 'bolt', 'amber'],
  ]);
  assert.deepEqual(content.badges.updates, { icon: 'page', text: '', color: 'blue' });
});

test('home shows the character roster with portraits', () => {
  const html = render.homePage(content);
  assert.match(html, /<section class="home-roster">[\s\S]*<h2 class="with-badge"><span class="badge badge--violet"[^>]*><svg[\s\S]*?<\/svg><\/span>Characters<\/h2>/);
  assert.equal(html.match(/class="portrait"/g).length, 6);
  assert.match(html, /<strong>Zork<\/strong>\s*<small>Undersea Cable · Speargun<\/small>/);
  assert.doesNotMatch(html, /class="release/, 'no release_date in the sheet, so no release line');
  assert.match(html, /<main class="wrap">\s*<h1 class="visually-hidden">[^<]*<\/h1>\s*<section class="home-roster">/, 'roster is the first thing on the page');
});

test('Characters renders as a portrait grid; every entry is filterable', () => {
  const html = render.categoryPage(content, cat('Characters'));
  assert.match(html, /<div class="portraits">/);
  assert.doesNotMatch(html, /<table/);
  assert.equal(html.match(/data-entry /g).length, 6);
  assert.match(html, /data-search="[^"]*blood blade[^"]*"/, 'skill names are filterable');
});

test('Items renders as a list with flavour text, effect stat and collapsible lore', () => {
  const html = render.categoryPage(content, cat('Items'));
  assert.match(html, /<div class="list">/);
  assert.match(html, /<h2><a href="\/c\/items\/goldblood-stake">Goldblood Stake<\/a><\/h2>/);
  assert.match(html, /<p class="flavor flavor--sm">An aged wooden stake/);
  assert.match(html, /<dt>Effect<\/dt><dd>Fill by collecting Goldblood/);
  assert.match(html, /<details class="more"><summary>Lore<\/summary>/);
});

test('placeholder descriptions ("TODO") are never shown on the page', () => {
  const html = render.categoryPage(content, cat('Items'));
  assert.doesNotMatch(html, /TODO/);
  assert.doesNotMatch(render.compendiumPage(content), /TODO/);
  assert.doesNotMatch(render.homePage(content), /TODO/);
});

test('Weapons (short values only) stays a table', () => {
  assert.match(render.categoryPage(content, cat('Weapons')), /<table class="entries"/);
});

test('character page: stats, grouped abilities with level note, and links to the same name in other tabs', () => {
  const albert = cat('Characters').items[0];
  const html = render.itemPage(content, cat('Characters'), albert);
  assert.match(html, /<dt>Primary Weapon<\/dt><dd>Lorrik&#39;s Jeweled Saber<\/dd>/);
  const plain = stripBadges(html);
  assert.match(plain, /<h2 class="with-badge">Skills<\/h2>[\s\S]*Skill 1[\s\S]*<h3>Blood Blade<\/h3>[\s\S]*Skill 2 · Level 12[\s\S]*<h3>Light of Hayern<\/h3>/);
  assert.match(plain, /<h2 class="with-badge">Aspects<\/h2>[\s\S]*<h3>High Lorrik Blood<\/h3>/);
  assert.match(plain, /Also in <a class="with-badge" href="\/c\/aspects\/albert">Aspects<\/a> <a class="with-badge" href="\/c\/weapons\/albert">Weapons<\/a> <a class="with-badge" href="\/c\/skills\/albert">Skills<\/a>/);
  // The Skills/Aspects headings reuse the badges of the Skills/Aspects categories.
  assert.match(html, /<h2 class="with-badge"><span class="badge badge--amber"[^>]*>[\s\S]*?<\/span>Skills<\/h2>/);
  assert.match(html, /<h2 class="with-badge"><span class="badge badge--rose"[^>]*>[\s\S]*?<\/span>Aspects<\/h2>/);
});

test('item page: lore is a prose section', () => {
  const stake = cat('Items').items[0];
  assert.match(render.itemPage(content, cat('Items'), stake), /<h2>Lore<\/h2><div class="prose prose--lore"><p>Golden blood/);
});

test('search: an exact skill name ranks first, shows where it matched, and isn\'t duplicated from the Skills tab', () => {
  const results = search(content, 'blood blade');
  assert.equal(results[0].item.title, 'Albert');
  assert.equal(results[0].category, 'Characters');
  assert.match(results[0].item.summary, /^Skill 1: Blood Blade — Fires off a blade/);
  assert.equal(results.filter((r) => r.item.title === 'Albert').length, 1);
});

test('search: names still win', () => {
  assert.equal(search(content, 'zork')[0].item.title, 'Zork');
  assert.equal(search(content, 'zork')[0].category, 'Characters');
  assert.equal(search(content, 'goldblood stake')[0].item.title, 'Goldblood Stake');
});
