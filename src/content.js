// Turns raw sheet tabs into the site's content model.
//
// Sheet conventions:
//   _site       key | value rows: title, tagline, release_date, hero_image, discord_url, ...
//               (keys ending in _url/_image must be http(s) URLs)
//   News        dated posts shown as "Latest updates" (a tab named "Updates" also works)
//   <any other> a compendium category; first row is the header row
//   _anything   tabs starting with "_" (and hidden tabs) are never shown as categories
//
// Recognised columns (case-insensitive, spaces/dashes ignored):
//   name|title  slug  image|image_url|icon  summary|description  body|details|content
//   tags|type   date  link|url|source  draft (TRUE hides the row)

const ALIASES = {
  title: ['name', 'title'],
  slug: ['slug', 'id'],
  image: ['image', 'imageurl', 'icon', 'thumbnail'],
  summary: ['summary', 'description', 'short'],
  body: ['body', 'details', 'content', 'notes'],
  tags: ['tags', 'type', 'category'],
  date: ['date', 'published', 'publishedat'],
  link: ['link', 'url', 'source'],
  draft: ['draft', 'hidden'],
};

export const DEFAULT_SITE = {
  title: 'Duskbloods.build',
  tagline: 'An unofficial compendium for The Duskbloods.',
};

const normKey = (s) => String(s).toLowerCase().replace(/[\s_\-]+/g, '');

export function slugify(s) {
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

const isTruthy = (v) => /^(true|yes|y|1|x)$/i.test(String(v).trim());

export function safeUrl(v) {
  const s = String(v ?? '').trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}

function trimRows(rows) {
  const out = rows.map((r) => r.map((c) => String(c ?? '').trim()));
  const first = out.findIndex((r) => r.some(Boolean));
  return first < 0 ? [] : out.slice(first);
}

function uniqueSlug(base, used) {
  let slug = base, n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

/** Converts a tab's rows (header row first) into item objects. */
export function tabToItems(rows) {
  const [header = [], ...body] = trimRows(rows);
  const columns = header.map((label, i) => ({ label, key: normKey(label), i })).filter((c) => c.label);
  const role = {};
  for (const [r, names] of Object.entries(ALIASES)) {
    const col = names.map((n) => columns.find((c) => c.key === n)).find(Boolean);
    if (col) role[r] = col;
  }
  const titleCol = role.title ?? columns[0];
  const special = new Set(Object.values(role).map((c) => c.i));
  if (titleCol) special.add(titleCol.i);

  const used = new Set();
  const items = [];
  for (const row of body) {
    const get = (col) => (col ? row[col.i] ?? '' : '');
    const title = get(titleCol);
    if (!title || isTruthy(get(role.draft))) continue;
    items.push({
      title,
      slug: uniqueSlug(slugify(get(role.slug) || title), used),
      image: safeUrl(get(role.image)),
      summary: get(role.summary),
      body: get(role.body),
      tags: get(role.tags).split(',').map((t) => t.trim()).filter(Boolean),
      date: get(role.date),
      link: safeUrl(get(role.link)),
      fields: columns.filter((c) => !special.has(c.i) && get(c)).map((c) => ({ label: c.label, value: get(c) })),
    });
  }
  // fields: the "other" columns, in sheet order, used as table headers.
  const fields = columns.filter((c) => !special.has(c.i)).map((c) => c.label);
  return { columns: columns.map((c) => c.label), fields, tagLabel: role.tags?.label ?? 'Tags', items };
}

function readSiteTab(rows) {
  const site = {};
  for (const [k = '', v = ''] of trimRows(rows)) {
    const key = k.toLowerCase().replace(/[\s\-]+/g, '_');
    if (key && v && key !== 'key') site[key] = v;
  }
  for (const k of Object.keys(site)) if (k.endsWith('_url') || k.endsWith('_image')) site[k] = safeUrl(site[k]);
  return site;
}

/** Builds the full site model from readWorkbook() output. */
export function buildContent(tabs, { fetchedAt = new Date() } = {}) {
  let site = { ...DEFAULT_SITE };
  let news = [];
  const categories = [];
  const usedSlugs = new Set(['search', 'updates', 'compendium', 'api', 'healthz', 'static']);

  for (const tab of tabs) {
    const name = tab.name.trim();
    const key = normKey(name);
    if (name.toLowerCase() === '_site') {
      site = { ...site, ...readSiteTab(tab.rows) };
      continue;
    }
    if (tab.hidden || name.startsWith('_')) continue;
    if (key === 'news' || key === 'updates') {
      news = tabToItems(tab.rows).items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      continue;
    }
    const { columns, fields, tagLabel, items } = tabToItems(tab.rows);
    if (!columns.length) continue; // blank tab, e.g. the default "Sheet1"
    categories.push({ name, slug: uniqueSlug(slugify(name), usedSlugs), columns, fields, tagLabel, items });
  }
  return { site, news, categories, fetchedAt: fetchedAt.toISOString() };
}
