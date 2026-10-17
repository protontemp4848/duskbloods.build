// Downloads the Google Sheet as .xlsx. Run at image build time; exits non-zero (failing the build) on any error.
//   SHEET_ID=<id> node scripts/fetch-sheet.js sheet.xlsx
import { writeFileSync } from 'node:fs';
import { fetchXlsx } from '../src/sheet.js';
import { readWorkbook } from '../src/xlsx.js';
import { buildContent } from '../src/content.js';

const [out] = process.argv.slice(2);
const sheetId = process.env.SHEET_ID;
if (!out || !sheetId) {
  console.error('Usage: SHEET_ID=<id> node scripts/fetch-sheet.js <out.xlsx>');
  process.exit(1);
}
const started = Date.now();
const buf = await fetchXlsx(sheetId);
// Parse it here too, so a sheet the site can't render fails the build rather than the deploy.
const content = buildContent(readWorkbook(buf));
writeFileSync(out, buf);
console.log(`Sheet downloaded to ${out}: ${buf.length} bytes, ${content.categories.length} categories, in ${Date.now() - started}ms`);
