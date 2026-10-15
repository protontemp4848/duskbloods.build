// Sample workbook used by tests and `npm run sample`. Placeholder content only, not real game data.
import { makeXlsx } from './make-xlsx.js';

export const sampleTabs = [
  { name: '_site', rows: [
    ['key', 'value'],
    ['title', 'Duskbloods.build'],
    ['tagline', 'Sample tagline <b>escaped</b>'],
    ['release_date', { date: 46387 }], // 2026-12-31
    ['hero_image', 'javascript:alert(1)'],
    ['discord_url', 'https://discord.gg/example'],
  ] },
  { name: 'News', rows: [
    ['date', 'title', 'summary', 'body'],
    [{ date: 46300 }, 'Older post', 'First summary', 'Line one\n\nLine two'],
    [{ date: 46310 }, 'Newer post', 'Second summary', ''],
  ] },
  { name: 'Bloodsworn', rows: [
    ['Name', 'Image', 'Summary', 'Tags', 'Role', 'Weapon', 'Draft'],
    ['Example Hunter', 'https://example.com/hunter.png', 'A placeholder character.', 'Melee, Agile', 'Striker', 'Blade', ''],
    ['Example Hunter', '', 'Duplicate name gets a unique slug.', 'Ranged', '', 'Bow', ''],
    ['<script>alert(1)</script>', 'javascript:alert(1)', 'XSS probe', '', '', '', ''],
    ['Secret Draft', '', 'Should not appear', '', '', '', 'TRUE'],
    ['', '', 'Row with no name is skipped', '', '', '', ''],
  ] },
  { name: 'Weapons', rows: [
    [null, null],
    ['Name', 'Damage', 'Two Handed'],
    ['Placeholder Axe', 120, true],
  ] },
  { name: 'Search', rows: [['Name'], ['Collides with a reserved route']] },
  { name: 'Secret Tab', hidden: true, rows: [['Name'], ['Hidden tab item']] },
  { name: '_notes', rows: [['Name'], ['Internal note']] },
];

export const sampleXlsx = () => makeXlsx(sampleTabs);
