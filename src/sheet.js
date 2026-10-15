// Loads the workbook (from Google Sheets or a local .xlsx) and caches the parsed content.
import { readFile } from 'node:fs/promises';
import { readWorkbook } from './xlsx.js';
import { buildContent } from './content.js';

export function exportUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=xlsx`;
}

async function fetchXlsx(sheetId, timeoutMs) {
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
 * Returns { get(): Promise<content>, status() }.
 * Content is refreshed at most every ttlMs; if a refresh fails the last good copy keeps being served.
 */
export function createSource({ sheetId, file, ttlMs = 60_000, timeoutMs = 10_000, log = console } = {}) {
  if (!sheetId && !file) throw new Error('Set SHEET_ID (or SHEET_FILE for a local .xlsx)');
  const load = file ? () => readFile(file) : () => fetchXlsx(sheetId, timeoutMs);

  let cached = null;
  let loadedAt = 0;
  let nextRefresh = 0;
  let inflight = null;
  let lastError = null;

  async function refresh() {
    // Failures also wait a full TTL so a broken sheet doesn't get hammered on every request.
    nextRefresh = Date.now() + ttlMs;
    try {
      const content = buildContent(readWorkbook(await load()));
      cached = content;
      loadedAt = Date.now();
      lastError = null;
      return content;
    } catch (err) {
      lastError = err;
      log.error(JSON.stringify({ severity: 'ERROR', message: `Sheet refresh failed: ${err.message}` }));
      if (cached) return cached;
      nextRefresh = 0; // nothing to serve yet, so let the next request retry
      throw err;
    } finally {
      inflight = null;
    }
  }

  return {
    async get() {
      if (cached && Date.now() < nextRefresh) return cached;
      inflight ??= refresh();
      // Serve stale content immediately while a background refresh runs.
      return cached ?? inflight;
    },
    status: () => ({ loadedAt: loadedAt ? new Date(loadedAt).toISOString() : null, error: lastError?.message ?? null }),
  };
}
