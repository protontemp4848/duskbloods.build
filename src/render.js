// Server-rendered HTML. Everything from the sheet goes through esc(); URLs through safeUrl() upstream.

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const paragraphs = (text) =>
  String(text).split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

const isNumeric = (v) => /^-?\d+(\.\d+)?%?$/.test(String(v).trim());
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

function layout({ content, title, body, active = '', q = '' }) {
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
<meta name="description" content="${esc(site.tagline)}">
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
      <input type="search" name="q" value="${esc(q)}" placeholder="Search" aria-label="Search the compendium">
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
  <a href="/c/${esc(c.slug)}">${esc(c.name)}</a>
  <span class="index-cols">${esc(c.fields.slice(0, 4).join(' · '))}</span>
  <span class="mono">${c.items.length}</span>
</li>`).join('')}</ul>`;
}

export function homePage(content, now = new Date()) {
  const { site, news, categories } = content;
  const days = daysUntil(site.release_date, now);
  const release = site.release_date ? `<dl class="release">
    <div><dt>Release</dt><dd class="mono">${esc(formatDate(site.release_date))}</dd></div>
    ${days !== null && days > 0 ? `<div><dt>Days until release</dt><dd class="mono">${days}</dd></div>` : ''}
  </dl>` : '';

  const body = `
<section class="masthead${site.hero_image ? ' masthead--image' : ''}">
  <div>
    <h1 class="display">${wordmark(site.title)}</h1>
    <p class="lede">${esc(site.tagline)}</p>
    ${release}
  </div>
  ${site.hero_image ? `<img class="masthead-img" src="${esc(site.hero_image)}" alt="">` : ''}
</section>
<div class="home-cols">
  <section>
    <header class="section-head"><h2>Updates</h2>${news.length > 5 ? '<a href="/updates">All updates</a>' : ''}</header>
    ${updateLog(news.slice(0, 5))}
  </section>
  <section>
    <header class="section-head"><h2>Compendium</h2><span class="mono muted">${plural(categories.reduce((n, c) => n + c.items.length, 0), 'entry', 'entries')}</span></header>
    ${categoryIndex(categories)}
  </section>
</div>`;
  return layout({ content, body });
}

function tabs(categories, current) {
  return `<nav class="tabs" aria-label="Categories">${categories.map((c) =>
    `<a href="/c/${esc(c.slug)}"${c === current ? ' aria-current="page"' : ''}>${esc(c.name)} <span class="mono">${c.items.length}</span></a>`).join('')}</nav>`;
}

export function compendiumPage(content) {
  const body = `
<header class="page-head"><h1>Compendium</h1></header>
${categoryIndex(content.categories)}`;
  return layout({ content, title: 'Compendium', body, active: 'compendium' });
}

function entryTable(rows, fieldLabels, { extraHead = '', extraCell = () => '' } = {}) {
  const cols = fieldLabels.slice(0, 5);
  // A column is numeric when every filled cell is a number; numeric columns align right, header included.
  const numeric = cols.map((label) => {
    const vals = rows.map(({ item }) => item.fields.find((f) => f.label === label)?.value).filter(Boolean);
    return vals.length > 0 && vals.every(isNumeric);
  });
  return `<div class="table-wrap"><table class="entries" data-entries>
<thead><tr>
  <th scope="col"><button type="button" data-sort="0">Name</button></th>
  ${extraHead}
  ${cols.map((label, i) => `<th scope="col"${numeric[i] ? ' class="num"' : ''}><button type="button" data-sort="${i + 1 + (extraHead ? 1 : 0)}">${esc(label)}</button></th>`).join('')}
</tr></thead>
<tbody>${rows.map(({ item, href, category }) => {
  const values = new Map(item.fields.map((f) => [f.label, f.value]));
  const search = [item.title, item.summary, category, ...item.tags, ...item.fields.map((f) => f.value)].join(' ').toLowerCase();
  return `<tr data-search="${esc(search)}" data-tags="${esc(item.tags.join('|').toLowerCase())}">
  <td class="entry-name"><a href="${href}">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : ''}<span><strong>${esc(item.title)}</strong>${item.summary ? `<small>${esc(item.summary)}</small>` : ''}</span></a></td>
  ${extraCell({ item, category })}
  ${cols.map((label, i) => `<td${numeric[i] ? ' class="num"' : ''}>${esc(values.get(label) ?? '')}</td>`).join('')}
</tr>`;
}).join('')}</tbody>
</table></div>`;
}

export function categoryPage(content, category) {
  const tags = [...new Set(category.items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));
  const rows = category.items.map((item) => ({ item, href: `/c/${esc(category.slug)}/${esc(item.slug)}` }));
  const hasTags = tags.length > 0;
  const body = `
<header class="page-head"><h1>Compendium</h1></header>
${tabs(content.categories, category)}
${category.items.length ? `
<div class="filters" data-filters>
  <input type="search" placeholder="Filter ${esc(category.name)}" aria-label="Filter ${esc(category.name)}" data-filter-text>
  ${hasTags ? `<select aria-label="Filter by ${esc(category.tagLabel.toLowerCase())}" data-filter-tag><option value="">Any ${esc(category.tagLabel.toLowerCase())}</option>${tags.map((t) => `<option value="${esc(t.toLowerCase())}">${esc(t)}</option>`).join('')}</select>` : ''}
  <span class="mono muted" data-count>${plural(category.items.length, 'entry', 'entries')}</span>
</div>
${entryTable(rows, category.fields, hasTags ? {
  extraHead: `<th scope="col"><button type="button" data-sort="1">${esc(category.tagLabel)}</button></th>`,
  extraCell: ({ item }) => `<td class="tags-cell">${esc(item.tags.join(', '))}</td>`,
} : {})}
<p class="empty" hidden data-empty>No entries match.</p>` : empty(`Nothing in ${category.name} yet.`)}`;
  return layout({ content, title: category.name, body, active: 'compendium' });
}

function entry(item, { crumbs, pager = '' }) {
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
    ${item.fields.length ? `<dl class="stats">${item.fields.map((f) => `<div><dt>${esc(f.label)}</dt><dd${isNumeric(f.value) ? ' class="mono"' : ''}>${esc(f.value)}</dd></div>`).join('')}</dl>` : ''}
    ${item.body ? `<div class="prose">${paragraphs(item.body)}</div>` : ''}
    ${item.link ? `<p><a class="source" href="${esc(item.link)}" rel="noopener">Source ↗</a></p>` : ''}
  </div>
</article>
${pager}`;
}

function pagerFor(list, index, hrefOf) {
  const prev = list[index - 1], next = list[index + 1];
  if (!prev && !next) return '';
  return `<nav class="pager">
  ${prev ? `<a href="${hrefOf(prev)}" rel="prev"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}
  ${next ? `<a href="${hrefOf(next)}" rel="next"><small>Next</small>${esc(next.title)}</a>` : '<span></span>'}
</nav>`;
}

export function itemPage(content, category, item) {
  const href = (i) => `/c/${esc(category.slug)}/${esc(i.slug)}`;
  return layout({
    content, title: item.title, active: 'compendium',
    body: entry(item, {
      crumbs: `<a href="/compendium">Compendium</a><span aria-hidden="true">/</span><a href="/c/${esc(category.slug)}">${esc(category.name)}</a>`,
      pager: pagerFor(category.items, category.items.indexOf(item), href),
    }),
  });
}

export function updatesPage(content) {
  const body = `<header class="page-head"><h1>Updates</h1></header>${updateLog(content.news)}`;
  return layout({ content, title: 'Updates', body, active: 'updates' });
}

export function postPage(content, post) {
  return layout({
    content, title: post.title, active: 'updates',
    body: entry(post, {
      crumbs: '<a href="/updates">Updates</a>',
      pager: pagerFor(content.news, content.news.indexOf(post), (p) => `/updates/${esc(p.slug)}`),
    }),
  });
}

export function searchPage(content, q, results) {
  const body = `
<header class="page-head"><h1>Search</h1>
${q ? `<p class="mono muted">${plural(results.length, 'result')} for “${esc(q)}”</p>` : ''}</header>
${results.length ? entryTable(results, [], {
  extraHead: '<th scope="col"><button type="button" data-sort="1">Category</button></th>',
  extraCell: ({ category }) => `<td>${esc(category)}</td>`,
}) : q ? empty('No matches.') : empty('Type a name, tag or stat into the search box.')}`;
  return layout({ content, title: q ? `Search: ${q}` : 'Search', body, q });
}

export function notFoundPage(content) {
  return layout({ content, title: 'Not found', body: `<header class="page-head"><h1>Not found</h1></header><p>That page doesn’t exist. <a href="/">Go home</a>.</p>` });
}
