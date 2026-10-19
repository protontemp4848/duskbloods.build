// Server-rendered HTML. Everything from the sheet goes through esc(); URLs through safeUrl() upstream.
import { badgeHtml } from './icons.js';
import { asset } from './assets.js';
import * as seo from './seo.js';
import { isNumeric } from './content.js';

// Google AdSense publisher ID: loads the ad script on every page and backs /ads.txt.
export const ADSENSE_CLIENT = 'ca-pub-3267360964563410';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const paragraphs = (text) =>
  String(text).split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

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
  if (!indexCache.has(content.categories)) {
    const index = new Map();
    for (const category of content.categories) {
      for (const item of category.items) {
        const key = normTitle(item.title);
        index.set(key, [...(index.get(key) ?? []), { category, item }]);
      }
    }
    for (const list of index.values()) list.sort((a, b) => richness(b.item) - richness(a.item));
    indexCache.set(content.categories, index);
  }
  return indexCache.get(content.categories);
}

// The same name listed in other tabs (e.g. "Albert" in Characters, Weapons and Skills).
const alsoIn = (content, self) => (titleIndex(content).get(normTitle(self.title)) ?? []).filter((e) => e.item !== self);

// The entry carrying this item's picture: itself, else the same name in another tab (an Attributes row with no
// image column shows the Characters portrait, like the Weapons and Aspects rows do). Carries imageSize too.
function pictureOf(content, item) {
  if (item.image) return item;
  return (titleIndex(content).get(normTitle(item.title)) ?? []).find((e) => e.item.image)?.item ?? item;
}

// A cell whose whole value is another entry's name links to that entry.
function linked(content, value, self) {
  const hit = (titleIndex(content).get(normTitle(value)) ?? []).find((e) => e.item !== self);
  return hit ? `<a class="xref" href="${hrefOf(hit.category, hit.item)}">${esc(value)}</a>` : esc(value);
}

/* ---------- Layout ---------- */

// meta: { title, ogTitle, description, path (canonical), image, imageAlt, card, type, noindex, jsonld: [nodes], published, lcpImage }
function layout({ content, meta, body, active = '', q = '' }) {
  const { site, origin } = content;
  const canonical = meta.path ? `${origin}${meta.path}` : '';
  const image = meta.image || `${origin}${asset('og.png')}`;
  const ogTitle = meta.ogTitle || meta.title;
  const nav = [['/compendium', 'Compendium', 'compendium'], ['/updates', 'Updates', 'updates']]
    .map(([href, label, key]) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(oneLine(meta.description))}">
${meta.noindex ? '<meta name="robots" content="noindex, follow">' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:type" content="${meta.type ?? 'website'}">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(oneLine(meta.description))}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(image)}">
${meta.image ? (meta.imageSize ? `<meta property="og:image:width" content="${meta.imageSize[0]}">\n<meta property="og:image:height" content="${meta.imageSize[1]}">` : '') : '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">'}
<meta property="og:image:alt" content="${esc(meta.imageAlt ?? `${site.title}: ${site.tagline}`)}">
${meta.published ? `<meta property="article:published_time" content="${esc(meta.published)}">` : ''}
<meta name="twitter:card" content="${meta.card ?? 'summary_large_image'}">
<meta name="theme-color" content="#0b0b0c">
<link rel="preload" href="/static/ibm-plex-sans.woff2" as="font" type="font/woff2" crossorigin>
${meta.lcpImage ? `${new URL(meta.lcpImage, origin || 'http://localhost').origin !== new URL(origin || 'http://localhost').origin ? `<link rel="preconnect" href="${esc(new URL(meta.lcpImage).origin)}">\n` : ''}<link rel="preload" as="image" href="${esc(meta.lcpImage)}" fetchpriority="high">` : ''}
<link rel="stylesheet" href="${asset('style.css')}">
<link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="${asset('apple-touch-icon.png')}">
${seo.jsonLdTag([...seo.siteGraph(content), ...(meta.jsonld ?? [])])}
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
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
<main class="wrap">${body}${reportBox(content, meta.reportLabel ?? meta.title)}</main>
<footer class="foot">
  <div class="wrap foot-inner">
    <p>Unofficial fan site. Not affiliated with FromSoftware or Nintendo. <a href="/privacy">Privacy</a> <a href="https://x.com/Duskbloodsbuild" rel="noopener">X</a>${site.discord_url ? ` <a href="${esc(site.discord_url)}" rel="noopener">Discord</a>` : ''}</p>
    <p class="mono">Synced ${esc(content.fetchedAt.slice(0, 16).replace('T', ' '))} UTC</p>
  </div>
</footer>
<script src="${asset('app.js')}" defer></script>
</body>
</html>`;
}

// "Report a problem" on every page; posts to /report, which forwards to the maintainers' Google Form.
function reportBox(content, label) {
  const r = content.report;
  if (!r) return '';
  const status = { sent: 'Thanks, your report was sent.', failed: 'Sorry, that didn’t send. Please try again in a moment.' }[r.state] ?? '';
  return `
<details class="report" id="report"${r.state ? ' open' : ''}>
  <summary>Report a problem with this page</summary>
  <form method="post" action="/report" data-report>
    <input type="hidden" name="page" value="${esc(r.path)}">
    <input type="hidden" name="entry" value="${esc(label)}">
    <label for="report-message">What’s wrong? <span class="muted">A typo, a wrong stat, something missing, a broken image…</span></label>
    <textarea id="report-message" name="message" rows="3" minlength="5" maxlength="2000" required></textarea>
    <div class="report-trap" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="report-actions">
      <button type="submit">Send report</button>
      <p class="report-note">Anonymous. Goes straight to the people who edit this site.</p>
    </div>
    <p class="report-status${r.state === 'failed' ? ' report-status--error' : ''}" role="status" aria-live="polite" data-report-status>${status}</p>
  </form>
</details>`;
}

const empty = (message) => `<p class="empty">${esc(message)}</p>`;
// Placeholder text ("TODO") from the sheet is never shown to visitors or crawlers.
const pageIntro = (text) => (seo.isPlaceholder(text) ? '' : `<div class="page-desc">${paragraphs(text)}</div>`);

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
  <span class="index-cols">${esc(oneLine((!seo.isPlaceholder(c.description) && c.description) || [...c.fields, ...new Set(c.abilityLabels.map((l) => l.replace(/\s*\d+.*$/, '')))].slice(0, 4).join(' · ')))}</span>
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

  const sections = categories.filter((c) => c.items.length).slice(0, 3).map((c) => c.name);
  const body = `
<h1 class="visually-hidden">${esc(site.game)} compendium${sections.length ? `: ${esc(sections.join(', '))} and more` : ''}</h1>
${release}
<div class="home-cols">
  <section>
    <header class="section-head"><h2 class="with-badge">${badge(content.badges.updates)}Updates</h2>${news.length > 5 ? '<a href="/updates">All updates</a>' : ''}</header>
    ${updateLog(news.slice(0, 5))}
  </section>
  <section>
    <header class="section-head"><h2>Compendium</h2><span class="mono muted">${plural(total, 'entry', 'entries')}</span></header>
    ${categoryIndex(categories)}
  </section>
</div>
${roster ? `<section class="home-roster">
  <header class="section-head"><h2 class="with-badge">${badge(roster.badge)}${esc(roster.name)}</h2><a href="/c/${esc(roster.slug)}">View all</a></header>
  ${portraitGrid(roster, roster.items.slice(0, 12), { eager: 6 })}
</section>` : ''}`;
  const meta = {
    title: `${site.title} - A build tool and companion for ${site.game}`,
    reportLabel: 'Home',
    description: seo.describeHome(content),
    path: '/',
    lcpImage: seo.absUrl(content.origin, roster?.items.find((i) => i.image)?.image),
  };
  return layout({ content, meta, body });
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
  const counts = content.categories.map((c) => `${c.items.length} ${c.name.toLowerCase()}`).join(', ');
  const meta = {
    title: seo.fullTitle(`${content.site.game} Compendium: Every Category`, content.site),
    description: seo.isPlaceholder(content.pages.compendium) ? seo.clip(`Every category in the ${content.site.game} compendium: ${counts}.`) : seo.clip(content.pages.compendium),
    path: '/compendium',
    jsonld: [seo.breadcrumbs(content.origin, [['Compendium']])],
  };
  return layout({ content, meta, body, active: 'compendium' });
}

/* ---------- Stats (numeric columns) ---------- */

// A category's numeric columns are drawn as bars on entry pages, so they're left out of the plain field list.
const isStat = (category, f) => Boolean(category?.statLabels?.includes(f.label));
const textFields = (category, item) => item.fields.filter((f) => !isStat(category, f));

// Bar scale per stat: the highest value of that column in the tab (so the best in the roster fills the bar).
function statScale(category) {
  const max = new Map();
  for (const item of category.items) {
    for (const f of item.fields) {
      if (!isStat(category, f)) continue;
      const n = parseFloat(f.value);
      if (Number.isFinite(n)) max.set(f.label, Math.max(max.get(f.label) ?? 0, n));
    }
  }
  return max;
}

function statBars(content, category, item) {
  const stats = item.fields.filter((f) => isStat(category, f));
  if (!stats.length) return '';
  const scale = statScale(category);
  const bar = (f) => {
    const n = parseFloat(f.value), top = scale.get(f.label) ?? 0;
    const pct = Number.isFinite(n) && top > 0 ? Math.round(Math.max(0, Math.min(1, n / top)) * 100) : 0;
    return `<div><dt>${esc(f.label)}</dt><dd><span class="stat-track" aria-hidden="true"><span class="stat-fill" style="width:${pct}%"></span></span><span class="stat-value mono">${esc(f.value)}</span></dd></div>`;
  };
  return `<section class="entry-section entry-stats"><h2 class="with-badge">${badge(badgeForName(content, 'Stats'))}Stats</h2><dl class="stat-bars">${stats.map(bar).join('')}</dl></section>`;
}

// Character-select style: tall portraits, name, and the first two short (non-numeric) stats.
// width/height attributes: the real size when known (pictures placed in the sheet), else a fallback shape.
const sizeAttrs = (item, fallback) => { const [w, h] = item.imageSize ?? fallback ?? []; return w ? `width="${w}" height="${h}"` : ''; };
// Icons and other roughly square images are shown whole; tall portraits are cropped to the card.
const isSquarish = (item) => Boolean(item.imageSize && item.imageSize[1] / item.imageSize[0] < 1.4);

// eager: how many leading portraits are above the fold (loaded eagerly, the first with high priority, for LCP).
function portraitGrid(category, items, { eager = 0 } = {}) {
  const loading = (i) => (i === 0 && eager ? ' fetchpriority="high"' : i < eager ? '' : ' loading="lazy"');
  return `<div class="portraits">${items.map((item, i) => `<a class="portrait${isSquarish(item) ? ' portrait--square' : ''}" href="${hrefOf(category, item)}" ${filterAttrs(item)}>
  ${item.image ? `<img src="${esc(item.image)}" alt="" ${sizeAttrs(item, [427, 990])} decoding="async"${loading(i)}>` : `<span class="portrait-blank" aria-hidden="true">${esc(item.title.slice(0, 1))}</span>`}
  <span class="portrait-text">
    <strong>${esc(item.title)}</strong>
    ${textFields(category, item).length ? `<small>${esc(textFields(category, item).slice(0, 2).map((f) => f.value).join(' · '))}</small>` : ''}
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
  // The first few thumbnails are above the fold: load them eagerly.
  return `<div class="list">${category.items.map((item, i) => { const pic = pictureOf(content, item); return `<article class="list-entry${pic.image ? ' list-entry--image' : ''}" id="${esc(item.slug)}" ${filterAttrs(item)}>
  ${pic.image ? `<img class="list-thumb${isSquarish(pic) ? ' list-thumb--square' : ''}" src="${esc(pic.image)}" alt="" ${sizeAttrs(pic)}${i < 3 ? '' : ' loading="lazy"'}>` : ''}
  <div class="list-main">
    <h2><a href="${hrefOf(category, item)}">${esc(item.title)}</a></h2>
    ${item.tags.length ? `<p class="entry-tags">${item.tags.map(esc).join(' · ')}</p>` : ''}
    ${item.summary ? `<p class="flavor flavor--sm">${esc(item.summary)}</p>` : ''}
    ${item.fields.length ? `<dl class="inline-stats">${item.fields.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${linked(content, f.value, item)}</dd></div>`).join('')}</dl>` : ''}
    ${groupedAbilities(content, item, { compact: true }).map((g) => g.html).join('')}
    ${item.sections.map((s) => `<details class="more"><summary>${esc(s.label)}</summary><div class="prose">${paragraphs(s.value)}</div></details>`).join('')}
  </div>
</article>`; }).join('')}</div>`;
}

function entryTable(content, rows, category, { extraHead = '', extraCell = () => '' } = {}) {
  const cols = category?.fields ?? [];
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
  const pic = pictureOf(content, item);
  return `<tr ${filterAttrs(item, [cat ?? ''])}>
  <td class="entry-name"><a href="${href}">${pic.image ? `<img src="${esc(pic.image)}" alt="" width="40" height="40" loading="lazy">` : ''}<span><strong>${esc(item.title)}</strong>${item.summary ? `<small>${esc(item.summary)}</small>` : ''}</span></a></td>
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
  if (category.view === 'grid') view = portraitGrid(category, category.items, { eager: 6 });
  else if (category.view === 'list') view = entryList(content, category);
  else {
    view = entryTable(content, category.items.map((item) => ({ item, href: hrefOf(category, item) })), category, hasTags ? {
      extraHead: `<th scope="col"><button type="button" data-sort="1">${esc(category.tagLabel)}</button></th>`,
      extraCell: ({ item }) => `<td class="tags-cell">${esc(item.tags.join(', '))}</td>`,
    } : {});
  }
  const body = `
<header class="page-head"><p class="eyebrow"><a href="/compendium">Compendium</a></p><h1>${esc(category.name)}</h1></header>
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
  const { site, origin } = content;
  const path = `/c/${category.slug}`;
  const meta = {
    reportLabel: category.name,
    lcpImage: category.view === 'grid' ? seo.absUrl(origin, category.items.find((i) => i.image)?.image) : undefined,
    title: seo.fullTitle(category.items.length > 1 ? `All ${category.items.length} ${category.name} in ${site.game}` : `${category.name} in ${site.game}`, site),
    description: seo.describeCategory(category, site),
    path,
    jsonld: [
      seo.breadcrumbs(origin, [['Compendium', '/compendium'], [category.name]]),
      { '@type': 'CollectionPage', '@id': `${origin}${path}#page`, url: `${origin}${path}`, name: category.name, isPartOf: { '@id': `${origin}/#website` },
        mainEntity: { '@type': 'ItemList', numberOfItems: category.items.length,
          itemListElement: category.items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.title, url: `${origin}${seo.canonicalPathFor(content, category, item)}` })) } },
    ],
  };
  return layout({ content, meta, body, active: 'compendium' });
}

/* ---------- Entry pages ---------- */

// category: the entry's category (sets which fields are drawn as stat bars); news posts have none.
function entry(content, item, { crumbs, pager = '', category = null }) {
  const related = alsoIn(content, item);
  const fields = textFields(category, item);
  const pic = pictureOf(content, item);
  return `
<nav class="crumbs">${crumbs}</nav>
<article class="entry${pic.image ? ' entry--image' : ''}${isSquarish(pic) ? ' entry--icon' : ''}">
  <header class="entry-head">
    ${item.date ? `<time class="mono" datetime="${esc(item.date)}">${esc(formatDate(item.date))}</time>` : ''}
    <h1>${esc(item.title)}</h1>
    ${item.tags.length ? `<p class="entry-tags">${item.tags.map(esc).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
  </header>
  ${pic.image ? `<figure class="entry-figure"><img class="detail-img" src="${esc(pic.image)}" alt="${esc(item.title)}" ${sizeAttrs(pic, [427, 990])} fetchpriority="high"></figure>` : ''}
  <div class="entry-body">
    ${item.summary ? `<p class="flavor">${esc(item.summary)}</p>` : ''}
    ${fields.length ? `<dl class="stats">${fields.map((f) => `<div><dt>${esc(f.label)}</dt><dd${isNumeric(f.value) ? ' class="mono"' : ''}>${linked(content, f.value, item)}</dd></div>`).join('')}</dl>` : ''}
    ${category ? statBars(content, category, item) : ''}
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
  const { site, origin } = content;
  const groups = [...new Set(item.abilities.map((a) => a.group))];
  const subject = groups.length ? `${item.title}: ${groups.join(' & ')}` : `${item.title}: ${seo.singular(category.name)}`;
  const path = seo.canonicalPathFor(content, category, item);
  const description = seo.describeItem(item, category, site);
  const meta = {
    // "Albert: Skills & Aspects | The Duskbloods | Duskbloods.build", dropping suffixes that don't fit.
    title: `${subject} | ${site.game}`.length <= 65 ? seo.fullTitle(`${subject} | ${site.game}`, site) : seo.fullTitle(subject, site),
    ogTitle: `${item.title} · ${category.name}`,
    reportLabel: `${category.name} › ${item.title}`,
    description,
    path,
    image: seo.absUrl(origin, item.image),
    imageSize: item.imageSize,
    lcpImage: seo.absUrl(origin, item.image),
    imageAlt: item.image ? item.title : undefined,
    card: item.image ? 'summary' : undefined, // portraits crop badly in large cards
    jsonld: [
      seo.breadcrumbs(origin, [['Compendium', '/compendium'], [category.name, `/c/${category.slug}`], [item.title]]),
      { '@type': 'ItemPage', '@id': `${origin}${path}#page`, url: `${origin}${path}`, name: item.title, description, isPartOf: { '@id': `${origin}/#website` },
        about: { '@type': 'Thing', name: item.title, description, ...(item.image ? { image: seo.absUrl(origin, item.image) } : {}), subjectOf: { '@id': `${origin}/#game` } },
        ...(item.image ? { primaryImageOfPage: { '@type': 'ImageObject', url: seo.absUrl(origin, item.image), ...(item.imageSize ? { width: item.imageSize[0], height: item.imageSize[1] } : {}) } } : {}) },
    ],
  };
  return layout({
    content, meta, active: 'compendium',
    body: entry(content, item, {
      category,
      crumbs: `<a href="/compendium">Compendium</a><span aria-hidden="true">/</span><a class="with-badge" href="/c/${esc(category.slug)}">${badge(category.badge)}${esc(category.name)}</a>`,
      pager: pagerFor(category.items, category.items.indexOf(item), (i) => hrefOf(category, i)),
    }),
  });
}

export function updatesPage(content) {
  const body = `<header class="page-head"><h1>Updates</h1>${pageIntro(content.pages.updates)}</header>${updateLog(content.news)}`;
  const { site, news } = content;
  const meta = {
    title: seo.fullTitle(`${site.game} Updates & Patch Notes`, site),
    description: !seo.isPlaceholder(content.pages.updates) ? seo.clip(content.pages.updates)
      : seo.clip(news.length ? `Latest ${site.title} updates for ${site.game}: ${news.slice(0, 3).map((p) => p.title).join('; ')}.` : `News and site updates for the ${site.game} compendium.`),
    path: '/updates',
    jsonld: [seo.breadcrumbs(content.origin, [['Updates']])],
  };
  return layout({ content, meta, body, active: 'updates' });
}

export function postPage(content, post) {
  const { site, origin } = content;
  const path = `/updates/${post.slug}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(post.date) ? post.date : undefined;
  const description = seo.clip(!seo.isPlaceholder(post.summary) ? post.summary : post.body || post.title);
  const meta = {
    title: seo.fullTitle(post.title, site), description, path, type: 'article', published: date,
    reportLabel: `Updates › ${post.title}`,
    image: seo.absUrl(origin, post.image) || undefined,
    jsonld: [
      seo.breadcrumbs(origin, [['Updates', '/updates'], [post.title]]),
      { '@type': 'BlogPosting', headline: post.title, description, url: `${origin}${path}`, mainEntityOfPage: `${origin}${path}`,
        ...(date ? { datePublished: date, dateModified: date } : {}), image: [seo.absUrl(origin, post.image) || `${origin}${asset('og.png')}`],
        author: { '@type': 'Organization', name: site.title, url: `${origin}/` }, publisher: { '@type': 'Organization', name: site.title, url: `${origin}/` } },
    ],
  };
  return layout({
    content, meta, active: 'updates',
    body: entry(content, post, {
      crumbs: `<a class="with-badge" href="/updates">${badge(content.badges.updates)}Updates</a>`,
      pager: pagerFor(content.news, content.news.indexOf(post), (p) => `/updates/${esc(p.slug)}`),
    }),
  });
}

// Required for AdSense: says what Google's ad cookies do and how to opt out. Edit PRIVACY_UPDATED when the text changes.
const PRIVACY_UPDATED = '2026-10-17';

export function privacyPage(content) {
  const { site } = content;
  const link = (href, text) => `<a href="${href}" rel="noopener">${text}</a>`;
  const body = `<header class="page-head"><h1>Privacy policy</h1><p class="mono muted">Last updated ${formatDate(PRIVACY_UPDATED)}</p></header>
<div class="prose legal">
<p>${esc(site.title)} is an unofficial fan site. This page explains what information is collected when you visit it, and by whom.</p>

<h2>Advertising</h2>
<p>This site shows ads served by Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites.</p>
<p>Google’s use of advertising cookies enables it and its partners to serve ads to you based on your visit to this site and/or other sites on the Internet. ${link('https://policies.google.com/technologies/partner-sites', 'How Google uses information from sites that use its services')}.</p>
<p>You can opt out of personalised advertising in ${link('https://myadcenter.google.com/', 'Google’s My Ad Center')}, and opt out of some third-party vendors’ use of cookies for personalised advertising at ${link('https://www.aboutads.info/choices/', 'aboutads.info')} or, in Europe, ${link('https://www.youronlinechoices.eu/', 'youronlinechoices.eu')}.</p>
<p>If you are in the European Economic Area, the UK or Switzerland, you are asked for consent before personalised ads or ad cookies are used, and you can change your choice at any time from the privacy link in that message.</p>

<h2>What this site itself collects</h2>
<ul>
<li><strong>No accounts and no cookies of our own.</strong> The site sets no cookies itself; any cookies come from the ad services above.</li>
<li><strong>Anonymous page counts.</strong> To see which pages are read, our server records each page view: the page address (without anything after the “?”), the date and time, whether you’re on a phone, tablet or computer, the name of the website that linked you here (e.g. “reddit.com”, not the page on it), and for searches, what was searched and how many results it found. It does not record your IP address, your browser details or anything that links one visit to another, and nothing is stored in your browser. These counts are kept for up to 400 days.</li>
<li><strong>Server logs.</strong> Like any website, our hosting provider (Google Cloud) records standard request details such as your IP address, the page requested, the time and your browser’s user agent. These are used to keep the site running and secure and are deleted automatically after a limited time.</li>
<li><strong>“Report a problem” form.</strong> If you send a report, the page it was sent from, the entry name and your message are stored in a Google Sheet that the site’s editors read. We don’t ask for your name or email, so please don’t include personal details in the message. Your IP address is held in memory for up to 10 minutes to stop spam and is not stored with the report.</li>
<li><strong>Images from other sites.</strong> Some pictures may be loaded from other websites, which then receive the usual request details from your browser.</li>
</ul>

<h2>Changes and contact</h2>
<p>If this policy changes, the date at the top of this page will change too. Questions or requests about your data can be sent with the “Report a problem” form at the bottom of any page${site.discord_url ? ` or on our ${link(esc(site.discord_url), 'Discord')}` : ''}.</p>
</div>`;
  const meta = {
    title: seo.fullTitle('Privacy Policy', site),
    description: `How ${site.title} and its advertising partners handle cookies and data.`,
    path: '/privacy',
    reportLabel: 'Privacy policy',
    jsonld: [seo.breadcrumbs(content.origin, [['Privacy policy']])],
  };
  return layout({ content, meta, body });
}

export function searchPage(content, q, results) {
  const body = `
<header class="page-head"><h1>Search</h1>
${q ? `<p class="mono muted">${plural(results.length, 'result')} for “${esc(q)}”</p>` : ''}</header>
${results.length ? entryTable(content, results, null, {
  extraHead: '<th scope="col"><button type="button" data-sort="1">Category</button></th>',
  extraCell: ({ category }) => `<td><span class="with-badge">${badge(badgeForName(content, category))}${esc(category)}</span></td>`,
}) : q ? empty('No matches.') : empty('Type a name, skill, stat or any text into the search box.')}`;
  const meta = { title: seo.fullTitle(q ? `Search: ${q}` : 'Search', content.site), description: `Search the ${content.site.game} compendium.`, noindex: true };
  return layout({ content, meta, body, q });
}

export function notFoundPage(content) {
  const meta = { title: seo.fullTitle('Page not found', content.site), description: `That page doesn’t exist in the ${content.site.game} compendium.`, noindex: true };
  return layout({ content, meta, body: `<header class="page-head"><h1>Not found</h1></header>
<p>That page doesn’t exist. Try the <a href="/compendium">compendium</a>, the <a href="/updates">updates</a>, or <a href="/">go home</a>.</p>` });
}
