// Section badges: a small coloured square with a glyph, used wherever a category is named.
// Glyphs are 24x24 stroke paths (Lucide-style) so they read at 13px.

const ICONS = {
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>',
  flask: '<path d="M10 2v7.5a2 2 0 0 1-.2.9l-5.1 10.2a1 1 0 0 0 .9 1.4h12.8a1 1 0 0 0 .9-1.4l-5.1-10.2a2 2 0 0 1-.2-.9V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  page: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.2 4.2 3 5.3V20h10v-3.7c1.8-1.1 3-2.7 3-5.3a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M10 20v-2"/><path d="M14 20v-2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1z"/>',
  crown: '<path d="M2 18h20"/><path d="M3 18 2 7l6 4 4-7 4 7 6-4-1 11"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V7"/><path d="M18 17v-3"/>',
};

export const COLORS = ['red', 'amber', 'green', 'teal', 'blue', 'violet', 'rose', 'grey'];

const DEFAULT_COLOR = {
  person: 'violet', people: 'amber', sword: 'red', flask: 'green', bolt: 'amber', drop: 'rose', page: 'blue', map: 'teal',
  skull: 'grey', shield: 'blue', book: 'amber', star: 'violet', crown: 'amber', moon: 'teal', gem: 'rose', chart: 'teal',
};

// Section name keywords -> icon. First match wins; matched against the lowercased name.
const KEYWORDS = [
  [/character|bloodsworn|class|hero|hunter|npc/, 'person'],
  [/budd|companion|ally|allies|partner|friend|summon|follower|party/, 'people'],
  [/weapon|arm(s|ament)/, 'sword'],
  [/item|consumable|tool|potion/, 'flask'],
  [/skill|abilit|move/, 'bolt'],
  [/aspect|passive|trait|perk|blood/, 'drop'],
  [/update|news|patch|changelog/, 'page'],
  [/location|map|area|region|place/, 'map'],
  [/enem|monster|boss|vampire|creature/, 'skull'],
  [/armou?r|gear|equipment/, 'shield'],
  [/lore|story|book|guide/, 'book'],
  [/spell|magic|sorcer|arcane/, 'star'],
  [/achievement|trophy|rank/, 'crown'],
  [/relic|gem|material|upgrade/, 'gem'],
  [/stat|attribute/, 'chart'],
];

export const ICON_NAMES = Object.keys(ICONS);

/**
 * Resolves a section's badge: { icon, text, color }.
 * `icon` from the sheet: an icon name, or an emoji / 1-2 characters shown as-is. Anything else (blank, or a word
 * that isn't an icon name) is picked from the section name, falling back to its first letter.
 */
export function resolveBadge(name, { icon = '', color = '' } = {}, index = 0) {
  const wanted = icon.trim();
  const custom = !ICONS[wanted.toLowerCase()] && (Array.from(wanted).length <= 2 || /\p{Extended_Pictographic}/u.test(wanted)) ? wanted : '';
  const iconName = ICONS[wanted.toLowerCase()] ? wanted.toLowerCase()
    : custom ? '' : KEYWORDS.find(([re]) => re.test(name.toLowerCase()))?.[1] ?? '';
  const text = iconName ? '' : (custom ? Array.from(custom).slice(0, 2) : Array.from(name.trim()).slice(0, 1)).join('').toUpperCase();
  const pickedColor = color.trim().toLowerCase();
  return {
    icon: iconName,
    text,
    color: COLORS.includes(pickedColor) ? pickedColor : DEFAULT_COLOR[iconName] ?? COLORS[index % COLORS.length],
  };
}

// HTML for a badge. Decorative: the section name is always written next to it.
export function badgeHtml(badge, esc) {
  if (!badge) return '';
  const inner = badge.icon
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${ICONS[badge.icon]}</svg>`
    : `<span>${esc(badge.text)}</span>`;
  return `<span class="badge badge--${badge.color}" aria-hidden="true">${inner}</span>`;
}
