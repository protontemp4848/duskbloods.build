// Turns raw sheet tabs into the site's content model.
//
// Sheet conventions:
//   _site       key | value rows: title, tagline, release_date, hero_image, discord_url, ...
//               (keys ending in _url/_image must be http(s) URLs)
//   _pages      page | description | view | icon | color rows, for "Compendium", "Updates" or any category tab's
//               name: intro text, layout override (grid | list | table), and the section badge (see icons.js)
//   News        dated posts shown as "Latest updates" (a tab named "Updates" also works)
//   <any other> a compendium category; first row is the header row
//   _anything   tabs starting with "_" (and hidden tabs) are never shown as categories
//
// Recognised columns (case-insensitive, spaces/dashes ignored):
//   name|title (else any "... Name")  slug  image|picture|portrait (else any "... Picture/Image")
//   summary|description  body|details|content  tags|type  date  link|url|source  draft (TRUE hides the row)
//
// Paired columns: "X" next to "X Description" (e.g. "Skill 2 (Level 12)" + "Skill 2 Description") become an
// ability { group: "Skills", name, note: "Level 12", text }. Columns whose text is long on average become
// prose sections; the rest are short stats.

import { resolveBadge } from './icons.js';

const ALIASES = {
  title: ['name', 'title'],
  slug: ['slug', 'id'],
  image: ['image', 'imageurl', 'icon', 'thumbnail', 'picture', 'profilepicture', 'portrait', 'avatar', 'photo'],
  summary: ['summary', 'description', 'short'],
  body: ['body', 'details', 'content', 'notes'],
  tags: ['tags', 'type', 'category'],
  date: ['date', 'published', 'publishedat'],
  link: ['link', 'url', 'source'],
  draft: ['draft', 'hidden'],
};

// Override any of these with _site rows (game, game_platform, game_developer, game_publisher feed structured data).
export const DEFAULT_SITE = {
  title: 'Duskbloods.build',
  tagline: 'An unofficial compendium for The Duskbloods.',
  game: 'The Duskbloods',
  game_platform: 'Nintendo Switch 2',
  game_developer: 'FromSoftware',
  game_publisher: 'Nintendo',
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

const LONG_TEXT = 80; // average characters above which a column is prose, not a stat

// "Skill 2 (Level 12)" -> { base: "Skill 2", note: "Level 12" }
function splitNote(label) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(label);
  return m ? { base: m[1], note: m[2] } : { base: label, note: '' };
}

// "Skill 2" -> "Skills"; "Passive" -> "Passive"
function groupName(base) {
  const stripped = base.replace(/\s*\d+$/, '');
  return stripped === base || /s$/i.test(stripped) ? stripped : `${stripped}s`;
}

function findPairs(columns, taken) {
  const pairs = [];
  for (const desc of columns) {
    if (taken.has(desc.i) || !/\sdescription$/i.test(desc.label)) continue;
    const baseKey = normKey(desc.label.replace(/\s*description$/i, ''));
    const nameCol = columns.find((c) => c !== desc && !taken.has(c.i) && normKey(splitNote(c.label).base) === baseKey);
    if (!nameCol) continue;
    const { base, note } = splitNote(nameCol.label);
    pairs.push({ nameCol, descCol: desc, label: nameCol.label, group: groupName(base), note });
    taken.add(nameCol.i).add(desc.i);
  }
  return pairs;
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
  role.title ??= columns.find((c) => c.key.endsWith('name'));
  role.image ??= columns.find((c) => /(picture|portrait|image)$/.test(c.key));
  const titleCol = role.title ?? columns[0];
  const special = new Set(Object.values(role).filter(Boolean).map((c) => c.i));
  if (titleCol) special.add(titleCol.i);

  const pairs = findPairs(columns, new Set(special));
  for (const p of pairs) special.add(p.nameCol.i).add(p.descCol.i);

  const rest = columns.filter((c) => !special.has(c.i));
  const filled = body.filter((r) => r.some(Boolean));
  const avgLength = (c) => {
    const vals = filled.map((r) => r[c.i] ?? '').filter(Boolean);
    return vals.length ? vals.reduce((n, v) => n + v.length, 0) / vals.length : 0;
  };
  const longCols = new Set(rest.filter((c) => avgLength(c) > LONG_TEXT).map((c) => c.i));

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
      fields: rest.filter((c) => !longCols.has(c.i) && get(c)).map((c) => ({ label: c.label, value: get(c) })),
      sections: rest.filter((c) => longCols.has(c.i) && get(c)).map((c) => ({ label: c.label, value: get(c) })),
      abilities: pairs.filter((p) => get(p.nameCol) || get(p.descCol))
        .map((p) => ({ group: p.group, label: p.label, name: get(p.nameCol), note: p.note, text: get(p.descCol) })),
    });
  }
  return {
    columns: columns.map((c) => c.label),
    // Short "other" columns in sheet order (table headers), and the paired ability columns.
    fields: rest.filter((c) => !longCols.has(c.i)).map((c) => c.label),
    abilityLabels: pairs.map((p) => p.label),
    tagLabel: role.tags?.label ?? 'Tags',
    items,
  };
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

const VIEWS = { grid: 'grid', cards: 'grid', gallery: 'grid', list: 'list', table: 'table' };

// Page name -> { description, view, icon, color }. With a "Page | Description | View | Icon | Color" header row the
// columns can be in any order; without one they're read in that order.
function readPagesTab(rows) {
  const trimmed = trimRows(rows);
  const header = trimmed[0]?.map(normKey) ?? [];
  const hasHeader = header.includes('page');
  const col = (name, fallback) => (hasHeader ? header.indexOf(name) : fallback);
  const at = { page: col('page', 0), description: col('description', 1), view: col('view', 2), icon: col('icon', 3), color: col('color', col('colour', 4)) };
  const pages = new Map();
  for (const row of hasHeader ? trimmed.slice(1) : trimmed) {
    const get = (k) => (at[k] >= 0 ? row[at[k]] ?? '' : '');
    if (!get('page')) continue;
    pages.set(normKey(get('page')), { description: get('description'), view: VIEWS[normKey(get('view'))] ?? '', icon: get('icon'), color: get('color') });
  }
  return pages;
}

// Portrait grid when most entries have pictures; stacked list when there's prose or abilities; else a table.
function autoView({ items, abilityLabels }) {
  if (items.length && items.filter((i) => i.image).length >= items.length / 2) return 'grid';
  if (abilityLabels.length || items.some((i) => i.sections.length)) return 'list';
  return 'table';
}

/** Builds the full site model from readWorkbook() output. */
export function buildContent(tabs, { fetchedAt = new Date() } = {}) {
  let site = { ...DEFAULT_SITE };
  let news = [];
  let pages = new Map();
  const categories = [];
  const usedSlugs = new Set(['search', 'updates', 'compendium', 'api', 'health', 'static']);

  for (const tab of tabs) {
    const name = tab.name.trim();
    const key = normKey(name);
    if (name.toLowerCase() === '_site') {
      site = { ...site, ...readSiteTab(tab.rows) };
      continue;
    }
    if (name.toLowerCase() === '_pages') {
      pages = readPagesTab(tab.rows);
      continue;
    }
    if (tab.hidden || name.startsWith('_')) continue;
    if (key === 'news' || key === 'updates') {
      news = tabToItems(tab.rows).items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      continue;
    }
    const parsed = tabToItems(tab.rows);
    if (!parsed.columns.length) continue; // blank tab, e.g. the default "Sheet1"
    categories.push({ name, slug: uniqueSlug(slugify(name), usedSlugs), ...parsed });
  }
  categories.forEach((c, i) => {
    const page = pages.get(normKey(c.name));
    c.description = page?.description ?? '';
    c.view = page?.view || autoView(c);
    c.badge = resolveBadge(c.name, page, i);
  });
  return {
    site, news, categories,
    pages: { compendium: pages.get('compendium')?.description ?? '', updates: pages.get('updates')?.description ?? '' },
    badges: { updates: resolveBadge('Updates', pages.get('updates')) },
    origin: '', // the server sets the public origin per request
    fetchedAt: fetchedAt.toISOString(),
  };
}
