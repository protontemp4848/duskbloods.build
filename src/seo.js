// SEO: per-page titles, descriptions, canonicals, JSON-LD, plus sitemap.xml and robots.txt.
// Everything is derived from the sheet so new tabs and rows are optimised automatically.

const MAX_TITLE = 65;
const MAX_DESCRIPTION = 158;
const PLACEHOLDER = /^\s*(todo|tbd|tba|wip|placeholder|coming soon|lorem ipsum.*|x+|-+|\?+)\s*[.!]*\s*$/i;

export const isPlaceholder = (s) => !s || PLACEHOLDER.test(String(s));
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s) => oneLine(s).toLowerCase();

/** Public origin for absolute URLs: SITE_URL if set, else the request's (proxy-aware) host. */
export function originFor(req, env = process.env) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

// Cut at a word boundary and add an ellipsis.
export function clip(text, max = MAX_DESCRIPTION) {
  const s = oneLine(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:.–—-]+$/, '')}…`;
}

// Title with the site name appended when it still fits.
export function fullTitle(title, site) {
  const withSite = `${title} | ${site.title}`;
  return withSite.length <= MAX_TITLE ? withSite : title;
}

// "Characters" -> "Character", "Enemies" -> "Enemy"
export function singular(name) {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y');
  if (/(ss|us)$/i.test(name)) return name;
  return name.replace(/s$/i, '');
}

const sentence = (s) => { const t = oneLine(s); return t && !/[.!?…]$/.test(t) ? `${t}.` : t; };
const listOf = (names) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Meta description for an entry, built from its real data when the summary is missing, short or a placeholder. */
export function describeItem(item, category, site) {
  const parts = [];
  if (!isPlaceholder(item.summary)) parts.push(sentence(item.summary));
  const total = () => parts.join(' ').length;
  if (total() < 110) {
    if (!parts.length) parts.push(`${item.title}, ${singular(category.name).toLowerCase()} in ${site.game}.`);
    const fields = item.fields.filter((f) => !isPlaceholder(f.value)).slice(0, 3).map((f) => `${f.label}: ${f.value}`);
    if (fields.length) parts.push(sentence(fields.join('; ')));
    const groups = new Map();
    for (const a of item.abilities) if (a.name) groups.set(a.group, [...(groups.get(a.group) ?? []), a.name]);
    for (const [group, names] of groups) parts.push(sentence(`${group}: ${names.join(', ')}`));
    for (const s of item.sections) if (total() < 110 && !isPlaceholder(s.value)) parts.push(`${s.label}: ${sentence(s.value)}`);
  }
  return clip(parts.join(' '));
}

export function describeCategory(category, site) {
  if (!isPlaceholder(category.description) && oneLine(category.description).length >= 50) return clip(category.description);
  const intro = isPlaceholder(category.description) ? '' : `${sentence(category.description)} `;
  const names = category.items.slice(0, 6).map((i) => i.title);
  const more = category.items.length > names.length ? ', …' : '';
  const n = category.items.length;
  const count = n === 1 ? `1 ${singular(category.name).toLowerCase()} in ${site.game}` : `All ${n} ${category.name.toLowerCase()} in ${site.game}`;
  return clip(`${intro}${count}${names.length ? `: ${names.join(', ')}${more}` : ''}.`);
}

export function describeHome(content) {
  const { site, categories } = content;
  const counts = categories.filter((c) => c.items.length).map((c) => `${c.items.length} ${c.items.length === 1 ? singular(c.name).toLowerCase() : c.name.toLowerCase()}`);
  const tagline = isPlaceholder(site.tagline) ? `An unofficial compendium for ${site.game}.` : sentence(site.tagline);
  return clip(counts.length ? `${tagline} Browse ${listOf(counts)}, with every skill, weapon and stat.` : tagline);
}

/* ---------- Duplicate entries ---------- */

// The same entity listed in several tabs (Albert in Characters, Weapons, Skills, Aspects). A page whose content is a
// subset of a fuller page with the same title declares that page canonical, so search engines index one Albert.
function isSubset(small, big) {
  const has = (list, key) => (x) => list.some((y) => key(y) === key(x));
  const field = (f) => `${norm(f.label)}=${norm(f.value)}`;
  const ability = (a) => `${norm(a.name)}=${norm(a.text)}`;
  const section = (s) => `${norm(s.label)}=${norm(s.value)}`;
  return small.fields.every(has(big.fields, field)) && small.abilities.every(has(big.abilities, ability))
    && small.sections.every(has(big.sections, section)) && (!small.summary || norm(small.summary) === norm(big.summary))
    && (!small.image || small.image === big.image);
}

const canonicalCache = new WeakMap();
/** Map of item -> { category, item } it should canonicalise to (only for subset duplicates). */
export function canonicalEntries(content) {
  if (canonicalCache.has(content.categories)) return canonicalCache.get(content.categories);
  const byTitle = new Map();
  for (const category of content.categories) for (const item of category.items) {
    const k = norm(item.title);
    byTitle.set(k, [...(byTitle.get(k) ?? []), { category, item }]);
  }
  const weight = ({ item }) => item.fields.length + item.abilities.length + item.sections.length + (item.image ? 1 : 0) + (item.summary ? 1 : 0);
  const map = new Map();
  for (const list of byTitle.values()) {
    if (list.length < 2) continue;
    // Heaviest first, so each entry points at the fullest page that contains it (not just the heaviest page overall).
    const sorted = [...list].sort((a, b) => weight(b) - weight(a));
    for (const e of list) {
      const best = sorted.find((o) => o !== e && weight(o) > weight(e) && isSubset(e.item, o.item));
      if (best) map.set(e.item, best);
    }
  }
  canonicalCache.set(content.categories, map);
  return map;
}

export const entryPath = (category, item) => `/c/${category.slug}/${item.slug}`;

export function canonicalPathFor(content, category, item) {
  const target = canonicalEntries(content).get(item);
  return target ? entryPath(target.category, target.item) : entryPath(category, item);
}

/* ---------- JSON-LD ---------- */

export function siteGraph(content) {
  const { site, origin } = content;
  return [
    { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: site.title, description: describeHome(content), inLanguage: 'en', about: { '@id': `${origin}/#game` } },
    { '@type': 'VideoGame', '@id': `${origin}/#game`, name: site.game, gamePlatform: site.game_platform, author: { '@type': 'Organization', name: site.game_developer }, publisher: { '@type': 'Organization', name: site.game_publisher } },
  ];
}

export function breadcrumbs(origin, trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(path ? { item: `${origin}${path}` } : {}) })),
  };
}

// JSON in a <script> tag: escape "<" so content can never close the tag.
export function jsonLdTag(nodes) {
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/* ---------- sitemap.xml / robots.txt ---------- */

// Sheet-placed pictures are served from this site (/media/...); everything public needs absolute URLs.
export const absUrl = (origin, url) => (url && url.startsWith('/') ? `${origin}${url}` : url);

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Every indexable canonical page. lastmod only where the sheet has a real date (posts). */
export function sitemapXml(content) {
  const { origin } = content;
  const urls = [{ path: '/' }, { path: '/compendium' }, { path: '/updates' }, { path: '/privacy' }];
  for (const category of content.categories) {
    urls.push({ path: `/c/${category.slug}` });
    const dupes = canonicalEntries(content);
    for (const item of category.items) if (!dupes.has(item)) urls.push({ path: entryPath(category, item), image: item.image, imageTitle: item.title });
  }
  for (const post of content.news) urls.push({ path: `/updates/${post.slug}`, lastmod: /^\d{4}-\d{2}-\d{2}$/.test(post.date) ? post.date : '', image: post.image, imageTitle: post.title });
  const body = urls.map((u) => `  <url><loc>${xmlEsc(origin + u.path)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${
    u.image ? `<image:image><image:loc>${xmlEsc(absUrl(origin, u.image))}</image:loc></image:image>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>
`;
}

export function robotsTxt(origin) {
  return `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
}
