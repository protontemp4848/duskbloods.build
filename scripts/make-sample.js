// Writes sample.xlsx: a fuller demo workbook for running the site locally without the Google Sheet.
// All entries are invented placeholders, not real Duskbloods information.
//   npm run sample && SHEET_FILE=sample.xlsx npm start
import { writeFileSync } from 'node:fs';
import { makeXlsx } from '../test/make-xlsx.js';

const img = (seed) => `https://picsum.photos/seed/${seed}/600/600`;

const tabs = [
  { name: '_site', rows: [
    ['key', 'value'],
    ['title', 'Duskbloods.build'],
    ['tagline', 'Sample data. Every entry here is a placeholder, not real game information.'],
    ['release_date', { date: 46387 }],
  ] },
  { name: '_pages', rows: [
    ['Page', 'Description'],
    ['Compendium', 'Sample intro for the compendium page. Every tab in the sheet becomes a category below.'],
    ['Updates', 'Sample intro for the updates page.'],
    ['Weapons', 'Sample category intro. Click a column header to sort; numeric columns sort by value.'],
  ] },
  { name: 'News', rows: [
    ['Date', 'Title', 'Summary', 'Body'],
    [{ date: 46310 }, 'Sample update: compendium structure', 'Categories now come straight from the sheet tabs.', 'Each tab is a category.\n\nEach row is an entry.'],
    [{ date: 46301 }, 'Sample update: weapons table', 'Weapon stats are sortable by any column.', ''],
    [{ date: 46290 }, 'Sample update: site launched', 'Placeholder post to show the update log.', ''],
  ] },
  { name: 'Bloodsworn', rows: [
    ['Name', 'Image', 'Summary', 'Tags', 'Role', 'Weapon', 'Difficulty', 'Body'],
    ['Sample Bloodsworn A', img('dusk-a'), 'Placeholder flavour text, set in italics like an in-game description.', 'Melee, Agile', 'Striker', 'Sabre', 2, 'Longer body text appears below the stats.'],
    ['Sample Bloodsworn B', img('dusk-b'), 'Placeholder flavour text for a second character.', 'Ranged', 'Marksman', 'Rifle', 3, ''],
    ['Sample Bloodsworn C', img('dusk-c'), 'Placeholder flavour text for a third character.', 'Melee, Tank', 'Vanguard', 'Greatsword', 1, ''],
    ['Sample Bloodsworn D', '', 'An entry without an image.', 'Arcane', 'Support', 'Catalyst', 3, ''],
  ] },
  { name: 'Weapons', rows: [
    ['Name', 'Image', 'Summary', 'Type', 'Damage', 'Weight', 'Scaling'],
    ...['Sabre', 'Rifle', 'Greatsword', 'Catalyst', 'Hatchet', 'Spear', 'Whip', 'Pistol'].map((w, i) =>
      [`Sample ${w}`, img(`dusk-w${i}`), `Placeholder description for the sample ${w.toLowerCase()}.`,
        i % 3 === 0 ? 'Light' : i % 3 === 1 ? 'Firearm' : 'Heavy', 80 + ((i * 37) % 90), (2 + i * 1.5).toFixed(1), 'STR / DEX'.split(' / ')[i % 2]]),
  ] },
  { name: 'Locations', rows: [['Name', 'Summary', 'Region'], ['Sample Cathedral', 'Placeholder location.', 'North'], ['Sample Harbour', 'Placeholder location.', 'West']] },
  { name: 'Enemies', rows: [['Name', 'Summary', 'Location', 'Weakness']] },
];

writeFileSync('sample.xlsx', makeXlsx(tabs));
console.log('Wrote sample.xlsx');
