// Turns raw sheet tabs into the site's content model.
//
// Sheet conventions:
//   _site       key | value rows: title, tagline, release_date, discord_url, game, ...
//               (keys ending in _url/_image must be http(s) URLs)
//   _pages      page | description | view | icon | color rows, for "Compendium", "Updates" or any category tab's
//               name: intro text, layout override (grid | list | table), and the section badge (see icons.js)
//   News        dated posts shown as "Latest updates" (a tab named "Updates" also works)
//   <any other> a compendium category; first row is the header row
//   _anything   tabs starting with "_" (and hidden tabs) are never shown as categories
//
// Recognised columns (case-insensitive, spaces/dashes ignored):
//   name|title (else any "... Name")  slug  image|picture|portrait (else any "... Picture/Image")
//   summary|description  body|details|caption (else any "... Body/Details/Caption")  tags|type  date  link|url|source
//   draft (TRUE hides the row). CamelCase headers ("BuddyInfo") are shown with spaces ("Buddy Info").
//
// Images: a URL in the image column, or a picture placed in the row (Insert > Image in Google Sheets; best in the
// image column). Placed pictures are served from /media/<content-hash>.<ext>.
//
// Paired columns: "X" next to "X Description" (e.g. "Skill 2 (Level 12)" + "Skill 2 Description") become an
// ability { group: "Skills", name, note: "Level 12", text }. Columns whose text is long on average become
// prose sections; the rest are short stats. Short columns whose every value is a number (Health, Stamina, ...)
// are listed in statLabels: entry pages show them as a Stats section with bars, scaled to the tab's highest value.

import { createHash } from 'node:crypto';
import { resolveBadge } from './icons.js';

const ALIASES = {
  title: ['name', 'title'],
  slug: ['slug', 'id'],
  image: ['image', 'imageurl', 'icon', 'thumbnail', 'picture', 'profilepicture', 'portrait', 'avatar', 'photo'],
  summary: ['summary', 'description', 'short'],
  body: ['body', 'details', 'content', 'notes', 'caption'],
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
// "BuddyInfo" -> "Buddy Info", for labels; keys ignore spacing anyway.
const humanize = (s) => String(s).trim().replace(/([a-z0-9])([A-Z])/g, '$1 $2');

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

// Lines like "- Lv.4: Firestorm" / "Lv.3 Master's Shield" in a Body become a levels table ({ level, text } rows), pulled out
// of the prose. The line right before the first one, if it ends with ":", is the table's caption.
const LEVEL_LINE = /^[-\u2022*]?\s*(?:lv\.?|level)\s*(\d+)\s*[:\-\u2013]?\s*(\S.*?)\s*$/iu;
function extractLevels(text) {
  const keep = [];
  const levels = [];
  let caption = '';
  for (const line of String(text).split(/\r?\n/)) {
    const m = LEVEL_LINE.exec(line.trim());
    if (!m) { keep.push(line); continue; }
    if (!levels.length) {
      const last = keep.findLastIndex((l) => l.trim());
      if (last >= 0 && /:$/.test(keep[last].trim())) caption = keep.splice(last)[0].trim().replace(/:$/, '');
    }
    levels.push({ level: Number(m[1]), text: m[2] });
  }
  return { body: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), levels, levelsCaption: caption };
}
export const isNumeric = (v) => /^-?\d+(\.\d+)?%?$/.test(String(v).trim());

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

// Pictures placed on the sheet: stored once by content hash, served at /media/<key>.
function storeImage(media, img) {
  const key = `${createHash('sha256').update(img.data).digest('hex').slice(0, 16)}.${img.ext}`;
  media.set(key, { type: img.type, data: img.data });
  return `/media/${key}`;
}

/** Converts a tab's rows (header row first) into item objects. `images` are the tab's placed pictures. */
export function tabToItems(rows, { images = [], media = new Map() } = {}) {
  const [header = [], ...body] = trimRows(rows);
  // Sheet row index of body[0], to match pictures (anchored by sheet row) to entries.
  const firstBodyRow = rows.findIndex((r) => r.some((c) => String(c ?? '').trim())) + 1;
  const columns = header.map((label, i) => ({ label: humanize(label), key: normKey(label), i })).filter((c) => c.label);
  const role = {};
  for (const [r, names] of Object.entries(ALIASES)) {
    const col = names.map((n) => columns.find((c) => c.key === n)).find(Boolean);
    if (col) role[r] = col;
  }
  role.title ??= columns.find((c) => c.key.endsWith('name'));
  role.image ??= columns.find((c) => /(picture|portrait|image)$/.test(c.key));
  role.body ??= columns.find((c) => /(body|details|caption)$/.test(c.key));
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
  // Numeric columns: every filled cell is a number (so "12", "20%", "-3"; not "12 (base)"), and at least one is filled.
  const numericCols = rest.filter((c) => {
    const vals = filled.map((r) => r[c.i] ?? '').filter(Boolean);
    return !longCols.has(c.i) && vals.length > 0 && vals.every(isNumeric);
  });

  const used = new Set();
  const items = [];
  // A row's picture: the one in the image column if there is one, else any picture anchored in that row.
  const pictureFor = (sheetRow) => {
    const inRow = images.filter((img) => img.row === sheetRow);
    return inRow.find((img) => role.image && img.col === role.image.i) ?? inRow[0];
  };
  for (const [k, row] of body.entries()) {
    const get = (col) => (col ? row[col.i] ?? '' : '');
    const title = get(titleCol);
    if (!title || isTruthy(get(role.draft))) continue;
    const url = safeUrl(get(role.image));
    const picture = url ? null : pictureFor(firstBodyRow + k);
    items.push({
      title,
      slug: uniqueSlug(slugify(get(role.slug) || title), used),
      image: url || (picture ? storeImage(media, picture) : ''),
      imageSize: picture?.size ?? null, // [width, height] when known
      summary: get(role.summary),
      ...extractLevels(get(role.body)), // body, levels, levelsCaption
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
    // The numeric subset of `fields`, in sheet order. Each item still carries these in item.fields (tables, search,
    // /api/content); entry pages and portrait cards pull them out and draw them as bars.
    statLabels: numericCols.map((c) => c.label),
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

// Portrait grid when most entries have pictures and there's no long prose (prose reads better as a list);
// stacked list when there's prose or abilities; else a table. A grid card shows only the name and first stats,
// so abilities with no stats (e.g. a Skills tab with the character's portrait) are a list, with the picture as an icon.
// Likewise when the pictures are mostly an earlier tab's (a Weapons tab reusing the Characters portraits): one gallery is enough.
function autoView({ items, fields, abilityLabels }, reused) {
  const prose = items.some((i) => i.sections.length || i.body || i.levels.length);
  const onlyAbilities = abilityLabels.length && !fields.length;
  const pictured = items.filter((i) => i.image);
  const borrowed = pictured.filter((i) => reused.has(i.image)).length > pictured.length / 2;
  if (items.length && !prose && !onlyAbilities && !borrowed && pictured.length >= items.length / 2) return 'grid';
  if (borrowed) return 'list';
  if (abilityLabels.length || prose) return 'list';
  return 'table';
}

/** Builds the full site model from readWorkbook() output. */
export function buildContent(tabs, { fetchedAt = new Date() } = {}) {
  const media = new Map();
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
      news = tabToItems(tab.rows, { images: tab.images, media }).items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      continue;
    }
    const parsed = tabToItems(tab.rows, { images: tab.images, media });
    if (!parsed.columns.length) continue; // blank tab, e.g. the default "Sheet1"
    categories.push({ name, slug: uniqueSlug(slugify(name), usedSlugs), ...parsed });
  }
  const seenImages = new Set(); // pictures used by earlier tabs, in sheet order
  categories.forEach((c, i) => {
    const page = pages.get(normKey(c.name));
    c.description = page?.description ?? '';
    c.view = page?.view || autoView(c, seenImages);
    for (const item of c.items) if (item.image) seenImages.add(item.image);
    c.badge = resolveBadge(c.name, page, i);
  });
  const content = {
    site, news, categories,
    pages: { compendium: pages.get('compendium')?.description ?? '', updates: pages.get('updates')?.description ?? '' },
    badges: { updates: resolveBadge('Updates', pages.get('updates')) },
    origin: '', // the server sets the public origin per request
    fetchedAt: fetchedAt.toISOString(),
  };
  // Image bytes for /media/<key>; non-enumerable so /api/content's JSON stays small.
  Object.defineProperty(content, 'media', { value: media, enumerable: false });
  return content;
}
