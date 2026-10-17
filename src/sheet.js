// Downloads the workbook at image build time, and loads the baked-in copy once at startup.
// The running app never contacts Google: sheet edits go live with the next deploy.
import { readFile, stat } from 'node:fs/promises';
import { readWorkbook } from './xlsx.js';
import { buildContent } from './content.js';

export function exportUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=xlsx`;
}

export async function fetchXlsx(sheetId, timeoutMs = 60_000) {
  const res = await fetch(exportUrl(sheetId), { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`Google Sheets export returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // A private sheet answers 200 with an HTML sign-in page rather than an error.
  if (buf.subarray(0, 2).toString() !== 'PK') {
    throw new Error('Sheet export was not an xlsx file. Is the sheet shared as "Anyone with the link can view"?');
  }
  return buf;
}

/**
 * Reads and parses the .xlsx at `file` once. Throws if it's missing or unreadable, so the server never starts
 * (and never passes its health check) without data.
 * Returns { get(): Promise<content>, status() }.
 */
export async function loadSource({ file, log = console } = {}) {
  if (!file) throw new Error('Set SHEET_FILE to the .xlsx to serve (the image sets it to the sheet downloaded at build time)');
  const content = buildContent(readWorkbook(await readFile(file)));
  const loadedAt = (await stat(file)).mtime.toISOString();
  log.log(JSON.stringify({ severity: 'INFO', message: `Sheet loaded from ${file} (downloaded ${loadedAt})` }));
  return {
    get: async () => content,
    status: () => ({ loadedAt, error: null }),
  };
}
