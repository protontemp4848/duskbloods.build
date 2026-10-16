// Server-rendered HTML. Everything from the sheet goes through esc(); URLs through safeUrl() upstream.
import { badgeHtml } from './icons.js';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const paragraphs = (text) =>
  String(text).split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

const isNumeric = (v) => /^-?\d+(\.\d+)?%?$/.test(String(v).trim());
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-09-25" -> "25 Sep 2026"; anything else is shown as typed.
function formatDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m && MONTHS[m[2] - 1] ? `${Number(m[3])} ${MONTHS[m[2] - 1]} ${m[1]}` : s;
}

function daysUntil(s, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s ?? '')) return null;
  const days = Math.ceil((Date.parse(`${s.slice(0, 10)}T00:00:00Z`) - now.getTime()) / 86400000);
  return Number.isFinite(days) ? days : null;
}

// "Duskbloods.build" -> Duskbloods<span>.build</span>, so the domain suffix can be quieter.
function wordmark(title) {
  const i = title.lastIndexOf('.');
  return i > 0 ? `${esc(title.slice(0, i))}<span>${esc(title.slice(i))}</span>` : esc(title);
}

const badge = (b) => badgeHtml(b, esc);

// Badge for a name that matches a category (singular or plural), e.g. the "Skills" heading on a character page.
function badgeForName(content, name) {
  const key = name.toLowerCase().replace(/s$/, '');
  return content.categories.find((c) => c.name.toLowerCase().replace(/s$/, '') === key)?.badge;
}

/* ---------- Cross-references ---------- */

const hrefOf = (category, item) => `/c/${esc(category.slug)}/${esc(item.slug)}`;
const normTitle = (s) => oneLine(s).toLowerCase();
const richness = (i) => i.fields.length + i.abilities.length + i.sections.length + (i.image ? 2 : 0) + (i.summary ? 1 : 0);

// Entry title -> every { category, item } with that title, richest first. Built once per content snapshot.
const indexCache = new WeakMap();
function titleIndex(content) {
  if (!indexCache.has(content)) {
    const index = new Map();
    for (const category of content.categories) {
      for (const item of category.items) {
        const key = normTitle(item.title);
        index.set(key, [...(index.get(key) ?? []), { category, item }]);
      }
    }
    for (const list of index.values()) list.sort((a, b) => richness(b.item) - richness(a.item));
    indexCache.set(content, index);
  }
  return indexCache.get(content);
}

// The same name listed in other tabs (e.g. "Albert" in Characters, Weapons and Skills).
const alsoIn = (content, self) => (titleIndex(content).get(normTitle(self.title)) ?? []).filter((e) => e.item !== self);

// A cell whose whole value is another entry's name links to that entry.
function linked(content, value, self) {
  const hit = (titleIndex(content).get(normTitle(value)) ?? []).find((e) => e.item !== self);
  return hit ? `<a class="xref" href="${hrefOf(hit.category, hit.item)}">${esc(value)}</a>` : esc(value);
}

/* ---------- Layout ---------- */

function layout({ content, title, body, active = '', q = '', description = '' }) {
  const { site } = content;
  const pageTitle = title ? `${title} — ${site.title}` : site.title;
  const nav = [['/compendium', 'Compendium', 'compendium'], ['/updates', 'Updates', 'updates']]
    .map(([href, label, key]) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(oneLine(description || site.tagline))}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,500;1,400&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
</head>
<body>
<header class="bar">
  <div class="wrap bar-inner">
    <a class="brand" href="/">${wordmark(site.title)}</a>
    <nav class="nav">${nav}</nav>
    <form class="search" action="/search" role="search">
      <input type="search" name="q" value="${esc(q)}" placeholder="Search  /" aria-label="Search the compendium" data-search-box>
    </form>
  </div>
</header>
<main class="wrap">${body}</main>
<footer class="foot">
  <div class="wrap foot-inner">
    <p>Unofficial fan site. Not affiliated with FromSoftware or Nintendo.${site.discord_url ? ` <a href="${esc(site.discord_url)}" rel="noopener">Discord</a>` : ''}</p>
    <p class="mono">Synced ${esc(content.fetchedAt.slice(0, 16).replace('T', ' '))} UTC</p>
  </div>
</footer>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

const empty = (message) => `<p class="empty">${esc(message)}</p>`;
const pageIntro = (text) => (text ? `<div class="page-desc">${paragraphs(text)}</div>` : '');

// Attributes the client-side filter reads.
function filterAttrs(item, extra = []) {
  const text = [item.title, item.summary, ...extra, ...item.tags, ...item.fields.map((f) => f.value),
    ...item.abilities.flatMap((a) => [a.name, a.text]), ...item.sections.map((s) => s.value)].join(' ').toLowerCase();
  return `data-entry data-search="${esc(oneLine(text))}" data-tags="${esc(item.tags.join('|').toLowerCase())}"`;
}

/* ---------- Home ---------- */

function updateLog(posts) {
  if (!posts.length) return empty('Nothing posted yet.');
  return `<ol class="log">${posts.map((p) => `<li>
  <time class="mono" datetime="${esc(p.date)}">${esc(p.date ? formatDate(p.date) : '')}</time>
  <div><a href="/updates/${esc(p.slug)}">${esc(p.title)}</a>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}</div>
</li>`).join('')}</ol>`;
}

function categoryIndex(categories) {
  if (!categories.length) return empty('No categories yet.');
  return `<ul class="index">${categories.map((c) => `<li>
  <a class="with-badge" href="/c/${esc(c.slug)}">${badge(c.badge)}${esc(c.name)}</a>
  <span class="index-cols">${esc(oneLine(c.description || [...c.fields, ...new Set(c.abilityLabels.map((l) => l.replace(/\s*\d+.*$/, '')))].slice(0, 4).join(' · ')))}</span>
  <span class="mono">${c.items.length}</span>
</li>`).join('')}</ul>`;
}

export function homePage(content, now = new Date()) {
  const { site, news, categories } = content;
  const days = daysUntil(site.release_date, now);
  // Only shown when _site has a release_date; the header already carries the site name.
  const release = site.release_date ? `<p class="release mono">Release ${esc(formatDate(site.release_date))}${
    days !== null && days > 0 ? ` · <strong>${days}</strong> day${days === 1 ? '' : 's'} to go` : ''}</p>` : '';
  const roster = categories.find((c) => c.view === 'grid' && c.items.some((i) => i.image));
  const total = categories.reduce((n, c) => n + c.items.length, 0);

  const body = `
<h1 class="visually-hidden">${esc(site.title)}</h1>
${release}
${roster ? `<section class="home-roster">
  <header class="section-head"><h2 class="with-badge">${badge(roster.badge)}${esc(roster.name)}</h2><a href="/c/${esc(roster.slug)}">View all</a></header>
  ${portraitGrid(roster, roster.items.slice(0, 12))}
</section>` : ''}
<div class="home-cols">
  <section>
    <header class="section-head"><h2 class="with-badge">${badge(content.badges.updates)}Updates</h2>${news.length > 5 ? '<a href="/updates">All updates</a>' : ''}</header>
    ${updateLog(news.slice(0, 5))}
  </section>
  <section>
    <header class="section-head"><h2>Compendium</h2><span class="mono muted">${plural(total, 'entry', 'entries')}</span></header>
    ${categoryIndex(categories)}
  </section>
</div>`;
  return layout({ content, body });
}

/* ---------- Category views ---------- */

function tabs(categories, current) {
  return `<nav class="tabs" aria-label="Categories">${categories.map((c) =>
    `<a class="with-badge" href="/c/${esc(c.slug)}"${c === current ? ' aria-current="page"' : ''}>${badge(c.badge)}${esc(c.name)} <span class="mono">${c.items.length}</span></a>`).join('')}</nav>`;
}

export function compendiumPage(content) {
  const body = `
<header class="page-head"><h1>Compendium</h1>${pageIntro(content.pages.compendium)}</header>
${categoryIndex(content.categories)}`;
  return layout({ content, title: 'Compendium', body, active: 'compendium', description: content.pages.compendium });
}

// Character-select style: tall portraits, name, and the first two short stats.
function portraitGrid(category, items) {
  return `<div class="portraits">${items.map((item) => `<a class="portrait" href="${hrefOf(category, item)}" ${filterAttrs(item)}>
  ${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : `<span class="portrait-blank" aria-hidden="true">${esc(item.title.slice(0, 1))}</span>`}
  <span class="portrait-text">
    <strong>${esc(item.title)}</strong>
    ${item.fields.length ? `<small>${esc(item.fields.slice(0, 2).map((f) => f.value).join(' · '))}</small>` : ''}
  </span>
</a>`).join('')}</div>`;
}

function abilityBlock(content, a, self, { compact = false } = {}) {
  const label = [a.label.replace(/\s*\([^)]*\)\s*$/, ''), a.note].filter(Boolean).join(' · ');
  return `<div class="ability">
  <p class="ability-label">${esc(label)}</p>
  ${a.name ? `<h3>${linked(content, a.name, self)}</h3>` : ''}
  ${a.text ? (compact ? `<p>${esc(a.text)}</p>` : `<div class="prose">${paragraphs(a.text)}</div>`) : ''}
</div>`;
}

function groupedAbilities(content, item, opts) {
  const groups = new Map();
  for (const a of item.abilities) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
  return [...groups].map(([group, list]) => ({ group, html: `<div class="abilities">${list.map((a) => abilityBlock(content, a, item, opts)).join('')}</div>` }));
}

// Stacked entries with everything visible: for prose and paired abilities.
function entryList(content, category) {
  return `<div class="list">${category.items.map((item) => `<article class="list-entry${item.image ? ' list-entry--image' : ''}" id="${esc(item.slug)}" ${filterAttrs(item)}>
  ${item.image ? `<img class="list-thumb" src="${esc(item.image)}" alt="" loading="lazy">` : ''}
  <div class="list-main">
    <h2><a href="${hrefOf(category, item)}">${esc(item.title)}</a></h2>
    ${item.tags.length ? `<p class="entry-tags">${item.tags.map(esc).join(' · ')}</p>` : ''}
    ${item.summary ? `<p class="flavor flavor--sm">${esc(item.summary)}</p>` : ''}
    ${item.fields.length ? `<dl class="inline-stats">${item.fields.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${linked(content, f.value, item)}</dd></div>`).join('')}</dl>` : ''}
    ${groupedAbilities(content, item, { compact: true }).map((g) => g.html).join('')}
    ${item.sections.map((s) => `<details class="more"><summary>${esc(s.label)}</summary><div class="prose">${paragraphs(s.value)}</div></details>`).join('')}
  </div>
</article>`).join('')}</div>`;
}

function entryTable(content, rows, category, { extraHead = '', extraCell = () => '' } = {}) {
  const cols = (category?.fields ?? []).slice(0, 5);
  const abilityCols = (category?.abilityLabels ?? []).slice(0, 4);
  // A column is numeric when every filled cell is a number; numeric columns align right, header included.
  const numeric = cols.map((label) => {
    const vals = rows.map(({ item }) => item.fields.find((f) => f.label === label)?.value).filter(Boolean);
    return vals.length > 0 && vals.every(isNumeric);
  });
  let n = extraHead ? 2 : 1;
  const th = (label, cls = '') => `<th scope="col"${cls ? ` class="${cls}"` : ''}><button type="button" data-sort="${n++}">${esc(label)}</button></th>`;
  return `<div class="table-wrap"><table class="entries" data-entries>
<thead><tr>
  <th scope="col"><button type="button" data-sort="0">Name</button></th>
  ${extraHead}
  ${cols.map((label, i) => th(label, numeric[i] ? 'num' : '')).join('')}
  ${abilityCols.map((label) => th(label)).join('')}
</tr></thead>
<tbody>${rows.map(({ item, href, category: cat }) => {
  const values = new Map(item.fields.map((f) => [f.label, f.value]));
  const abilities = new Map(item.abilities.map((a) => [a.label, a]));
  return `<tr ${filterAttrs(item, [cat ?? ''])}>
  <td class="entry-name"><a href="${href}">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : ''}<span><strong>${esc(item.title)}</strong>${item.summary ? `<small>${esc(item.summary)}</small>` : ''}</span></a></td>
  ${extraCell({ item, category: cat })}
  ${cols.map((label, i) => `<td${numeric[i] ? ' class="num"' : ''}>${linked(content, values.get(label) ?? '', item)}</td>`).join('')}
  ${abilityCols.map((label) => { const a = abilities.get(label); return `<td class="ability-cell">${a ? `<strong>${esc(a.name)}</strong><small>${esc(a.text)}</small>` : ''}</td>`; }).join('')}
</tr>`;
}).join('')}</tbody>
</table></div>`;
}

export function categoryPage(content, category) {
  const tags = [...new Set(category.items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));
  const hasTags = tags.length > 0;
  let view;
  if (category.view === 'grid') view = portraitGrid(category, category.items);
  else if (category.view === 'list') view = entryList(content, category);
  else {
    view = entryTable(content, category.items.map((item) => ({ item, href: hrefOf(category, item) })), category, hasTags ? {
      extraHead: `<th scope="col"><button type="button" data-sort="1">${esc(category.tagLabel)}</button></th>`,
      extraCell: ({ item }) => `<td class="tags-cell">${esc(item.tags.join(', '))}</td>`,
    } : {});
  }
  const body = `
<header class="page-head"><h1>Compendium</h1></header>
${tabs(content.categories, category)}
${pageIntro(category.description)}
${category.items.length ? `
<div class="filters" data-filters>
  <input type="search" placeholder="Filter ${esc(category.name)}" aria-label="Filter ${esc(category.name)}" data-filter-text>
  ${hasTags ? `<select aria-label="Filter by ${esc(category.tagLabel.toLowerCase())}" data-filter-tag><option value="">Any ${esc(category.tagLabel.toLowerCase())}</option>${tags.map((t) => `<option value="${esc(t.toLowerCase())}">${esc(t)}</option>`).join('')}</select>` : ''}
  <span class="mono muted" data-count>${plural(category.items.length, 'entry', 'entries')}</span>
</div>
${view}
<p class="empty" hidden data-empty>No entries match.</p>` : empty(`Nothing in ${category.name} yet.`)}`;
  return layout({ content, title: category.name, body, active: 'compendium', description: category.description });
}

/* ---------- Entry pages ---------- */

function entry(content, item, { crumbs, pager = '' }) {
  const related = alsoIn(content, item);
  return `
<nav class="crumbs">${crumbs}</nav>
<article class="entry${item.image ? ' entry--image' : ''}">
  <header class="entry-head">
    ${item.date ? `<time class="mono" datetime="${esc(item.date)}">${esc(formatDate(item.date))}</time>` : ''}
    <h1>${esc(item.title)}</h1>
    ${item.tags.length ? `<p class="entry-tags">${item.tags.map(esc).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
  </header>
  ${item.image ? `<figure class="entry-figure"><img class="detail-img" src="${esc(item.image)}" alt="${esc(item.title)}"></figure>` : ''}
  <div class="entry-body">
    ${item.summary ? `<p class="flavor">${esc(item.summary)}</p>` : ''}
    ${item.fields.length ? `<dl class="stats">${item.fields.map((f) => `<div><dt>${esc(f.label)}</dt><dd${isNumeric(f.value) ? ' class="mono"' : ''}>${linked(content, f.value, item)}</dd></div>`).join('')}</dl>` : ''}
    ${groupedAbilities(content, item).map((g) => `<section class="entry-section"><h2 class="with-badge">${badge(badgeForName(content, g.group))}${esc(g.group)}</h2>${g.html}</section>`).join('')}
    ${item.sections.map((s) => `<section class="entry-section"><h2>${esc(s.label)}</h2><div class="prose${/lore/i.test(s.label) ? ' prose--lore' : ''}">${paragraphs(s.value)}</div></section>`).join('')}
    ${item.body ? `<div class="prose entry-section">${paragraphs(item.body)}</div>` : ''}
    ${item.link ? `<p><a class="source" href="${esc(item.link)}" rel="noopener">Source ↗</a></p>` : ''}
    ${related.length ? `<p class="also-in">Also in ${related.map((r) => `<a class="with-badge" href="${hrefOf(r.category, r.item)}">${badge(r.category.badge)}${esc(r.category.name)}</a>`).join(' ')}</p>` : ''}
  </div>
</article>
${pager}`;
}

function pagerFor(list, index, hrefFor) {
  const prev = list[index - 1], next = list[index + 1];
  if (!prev && !next) return '';
  return `<nav class="pager">
  ${prev ? `<a href="${hrefFor(prev)}" rel="prev"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}
  ${next ? `<a href="${hrefFor(next)}" rel="next"><small>Next</small>${esc(next.title)}</a>` : '<span></span>'}
</nav>`;
}

export function itemPage(content, category, item) {
  return layout({
    content, title: item.title, active: 'compendium', description: item.summary || category.description,
    body: entry(content, item, {
      crumbs: `<a href="/compendium">Compendium</a><span aria-hidden="true">/</span><a class="with-badge" href="/c/${esc(category.slug)}">${badge(category.badge)}${esc(category.name)}</a>`,
      pager: pagerFor(category.items, category.items.indexOf(item), (i) => hrefOf(category, i)),
    }),
  });
}

export function updatesPage(content) {
  const body = `<header class="page-head"><h1>Updates</h1>${pageIntro(content.pages.updates)}</header>${updateLog(content.news)}`;
  return layout({ content, title: 'Updates', body, active: 'updates', description: content.pages.updates });
}

export function postPage(content, post) {
  return layout({
    content, title: post.title, active: 'updates', description: post.summary,
    body: entry(content, post, {
      crumbs: `<a class="with-badge" href="/updates">${badge(content.badges.updates)}Updates</a>`,
      pager: pagerFor(content.news, content.news.indexOf(post), (p) => `/updates/${esc(p.slug)}`),
    }),
  });
}

export function searchPage(content, q, results) {
  const body = `
<header class="page-head"><h1>Search</h1>
${q ? `<p class="mono muted">${plural(results.length, 'result')} for “${esc(q)}”</p>` : ''}</header>
${results.length ? entryTable(content, results, null, {
  extraHead: '<th scope="col"><button type="button" data-sort="1">Category</button></th>',
  extraCell: ({ category }) => `<td><span class="with-badge">${badge(badgeForName(content, category))}${esc(category)}</span></td>`,
}) : q ? empty('No matches.') : empty('Type a name, skill, stat or any text into the search box.')}`;
  return layout({ content, title: q ? `Search: ${q}` : 'Search', body, q });
}

export function notFoundPage(content) {
  return layout({ content, title: 'Not found', body: `<header class="page-head"><h1>Not found</h1></header><p>That page doesn’t exist. <a href="/">Go home</a>.</p>` });
}
