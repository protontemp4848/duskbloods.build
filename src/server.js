import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { createSource } from './sheet.js';
import * as render from './render.js';
import { assetHash } from './assets.js';
import { originFor, sitemapXml, robotsTxt } from './seo.js';
import { parseFormUrl, createReporter, isSitePath } from './feedback.js';
import { pageview, logPageview } from './analytics.js';

const STATIC_DIR = new URL('../public/', import.meta.url);
const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml)|image\/svg)/;
const YEAR = 'public, max-age=31536000, immutable';

// Compressed static files, keyed by name + encoding (they only change on deploy).
const staticCache = new Map();

function compress(body, encoding, isStatic) {
  if (encoding === 'br') {
    // Dynamic HTML at a fast level; static files once at max level.
    return brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: isStatic ? 11 : 5 } });
  }
  return gzipSync(body, { level: isStatic ? 9 : 6 });
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' https: data:",
    // AdSense adds <style> blocks and loads scripts and ad frames from many Google hosts (country-specific ones too),
    // so those are any https origin; inline scripts stay blocked.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "script-src 'self' https:",
    "frame-src https:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function search(content, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const phrase = terms.join(' ');
  const results = [];
  for (const category of content.categories) {
    for (const item of category.items) {
      // [label, text, isName, snippet]: names (stats, ability names) outrank prose when they hold the phrase.
      const parts = [
        ['', item.summary, false], ['', item.body, false], ...item.tags.map((t) => ['', t, true]),
        ...item.fields.map((f) => [f.label, f.value, true]),
        ...item.abilities.flatMap((a) => [[a.label, a.name, true, `${a.name} — ${a.text}`], [a.label, a.text, false, `${a.name} — ${a.text}`]]),
        ...item.sections.map((s) => [s.label, s.value, false]),
      ].filter(([, v]) => v);
      const hay = [item.title, ...parts.map(([, v]) => v)].join(' ').toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;

      const score = ([, v, isName]) => {
        const text = v.toLowerCase();
        return (text.includes(phrase) ? 100 : 0) + terms.filter((t) => text.includes(t)).length * 10 + (isName ? 5 : 0);
      };
      const best = parts.reduce((a, b) => (score(b) > score(a) ? b : a), parts[0]);
      const title = item.title.toLowerCase();
      const rank =
        terms.every((t) => title.includes(t)) ? 5
        : best && best[2] && best[1].toLowerCase().includes(phrase) ? 4
        : hay.includes(phrase) ? 3
        : terms.some((t) => title.includes(t)) ? 2 : 1;
      const snippet = rank === 5 || !best ? item.summary : `${best[0] ? `${best[0]}: ` : ''}${best[3] ?? best[1]}`;
      results.push({ item: { ...item, summary: snippet }, category: category.name, href: `/c/${category.slug}/${item.slug}`, rank, weight: item.fields.length + item.abilities.length + (item.image ? 2 : 0) });
    }
  }
  // Best rank first; between equals, the fuller entry. The same name + match from a duplicate tab is dropped.
  results.sort((a, b) => b.rank - a.rank || b.weight - a.weight);
  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.item.title.toLowerCase()}|${r.item.summary}`;
    return seen.has(key) ? false : seen.add(key);
  }).slice(0, 100);
}

// Reads an application/x-www-form-urlencoded body, refusing anything over `max` bytes with a 413. The body is
// drained rather than the socket destroyed, so the client actually receives the 413.
function readForm(req, max = 8192) {
  const tooLarge = () => Object.assign(new Error('too large'), { status: 413 });
  if (Number(req.headers['content-length'] ?? 0) > max) return Promise.reject(tooLarge());
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => (size > max ? reject(tooLarge()) : resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));
    req.on('error', reject);
  });
}

// report: the problem-report submitter from feedback.js, or null when FEEDBACK_FORM_URL isn't set (form hidden).
// track: receives a page view event from analytics.js for each page a person loads, or null to count nothing.
export function createApp(source, { report = null, track = null } = {}) {
  return async function handler(req, res) {
    const accepts = String(req.headers['accept-encoding'] ?? '');
    const encoding = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : '';
    const https = String(req.headers['x-forwarded-proto'] ?? '').startsWith('https');
    const send = (status, body, type = 'text/html; charset=utf-8', extra = {}, cacheKey = null) => {
      const headers = { 'Content-Type': type, ...SECURITY_HEADERS, ...extra };
      if (https) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
      let out = body;
      if (COMPRESSIBLE.test(type)) {
        headers.Vary = 'Accept-Encoding';
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        if (encoding && raw.length > 1024) {
          const key = cacheKey && `${cacheKey}|${encoding}`;
          out = (key && staticCache.get(key)) ?? compress(raw, encoding, Boolean(cacheKey));
          if (key) staticCache.set(key, out);
          headers['Content-Encoding'] = encoding;
        } else out = raw;
      }
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : out);
    };

    const url = new URL(req.url, 'http://localhost');

    // "Report a problem" form: JSON for the in-page script, a redirect back to the page without JavaScript.
    if (url.pathname === '/report' && req.method === 'POST') {
      let form;
      try { form = await readForm(req); } catch (err) {
        return send(err.status ?? 400, err.status === 413 ? 'Report too large' : 'Bad request', 'text/plain', { Connection: 'close' });
      }
      const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';
      const page = form.get('page') ?? '';
      const result = report
        ? await report({ ip, page, entry: form.get('entry') ?? '', message: form.get('message') ?? '', trap: form.get('website') ?? '' })
        : { status: 404, error: 'Reporting is not configured.' };
      if (String(req.headers.accept ?? '').includes('application/json')) {
        return send(result.status, JSON.stringify({ ok: result.status === 200, error: result.error }), 'application/json', { 'Cache-Control': 'no-store' });
      }
      const back = isSitePath(page) ? page : '/';
      return send(303, '', 'text/plain', { Location: `${back}${back.includes('?') ? '&' : '?'}reported=${result.status === 200 ? 'sent' : 'failed'}#report`, 'Cache-Control': 'no-store' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });

    const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });

    try {
      // Not /healthz: Cloud Run reserves some paths ending in z, and never forwards them to the container.
      if (url.pathname === '/health') return send(200, JSON.stringify({ ok: true, ...source.status() }), 'application/json');

      // One URL per page: /c/items/ -> /c/items (301 keeps the ranking signals).
      if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
        return send(301, '', 'text/plain', { Location: url.pathname.replace(/\/+$/, '') + url.search });
      }

      // Root-level files crawlers and browsers ask for by convention.
      const rootFiles = { '/favicon.ico': 'favicon.ico', '/apple-touch-icon.png': 'apple-touch-icon.png' };
      const staticName = rootFiles[url.pathname] ?? (parts[0] === 'static' && parts.length === 2 ? parts[1] : null);
      if (staticName) {
        const ext = staticName.slice(staticName.lastIndexOf('.'));
        if (!STATIC_TYPES[ext] || !/^[\w.-]+$/.test(staticName)) return send(404, 'Not found', 'text/plain');
        try {
          const file = await readFile(fileURLToPath(new URL(staticName, STATIC_DIR)));
          // Fingerprinted URLs (?v=<hash>) and fonts never change in place, so they can be cached for a year.
          const v = url.searchParams.get('v');
          const cache = (v && v === assetHash(staticName)) || ext === '.woff2' ? YEAR : 'public, max-age=3600';
          return send(200, file, STATIC_TYPES[ext], { 'Cache-Control': cache }, staticName);
        } catch { return send(404, 'Not found', 'text/plain'); }
      }

      const raw = await source.get();
      // Per-request view: same content plus the public origin for canonical/og/sitemap URLs.
      const reported = url.searchParams.get('reported');
      const content = {
        ...raw,
        origin: originFor(req),
        // Problem-report form: which page it's on, and the result after a no-JavaScript submit.
        report: report ? { path: url.pathname, state: ['sent', 'failed'].includes(reported) ? reported : '' } : null,
      };
      // Pictures placed in the sheet, by content hash, so they never change in place.
      const mediaKey = /^\/media\/([0-9a-f]{16}\.(?:png|jpg|gif|webp))$/.exec(url.pathname)?.[1];
      if (mediaKey) {
        const file = raw.media?.get(mediaKey);
        return file ? send(200, file.data, file.type, { 'Cache-Control': YEAR }) : send(404, 'Not found', 'text/plain');
      }
      if (url.pathname === '/robots.txt') return send(200, robotsTxt(content.origin), 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
      if (url.pathname === '/ads.txt') return send(200, `google.com, ${render.ADSENSE_CLIENT.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`, 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
      if (url.pathname === '/sitemap.xml') return send(200, sitemapXml(content), 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=600' });
      const view = (status, extra) => {
        const event = track && pageview(req, url.pathname.slice(0, 200), status, content.origin, extra);
        if (event) track(event);
      };
      const page = (html, extra) => {
        view(200, extra);
        return send(200, html, undefined, { 'Cache-Control': 'public, max-age=60' });
      };
      const notFound = () => {
        view(404);
        return send(404, render.notFoundPage(content));
      };

      if (url.pathname === '/api/content') return send(200, JSON.stringify(raw), 'application/json', { 'Cache-Control': 'public, max-age=60' });
      if (parts.length === 0) return page(render.homePage(content));
      if (url.pathname === '/privacy') return page(render.privacyPage(content));
      if (parts[0] === 'compendium' && parts.length === 1) return page(render.compendiumPage(content));
      if (parts[0] === 'search' && parts.length === 1) {
        const q = (url.searchParams.get('q') ?? '').slice(0, 100);
        const results = search(content, q);
        return page(render.searchPage(content, q, results), { q, results: results.length });
      }
      if (parts[0] === 'updates') {
        if (parts.length === 1) return page(render.updatesPage(content));
        const post = parts.length === 2 && content.news.find((p) => p.slug === parts[1]);
        return post ? page(render.postPage(content, post)) : notFound();
      }
      if (parts[0] === 'c' && (parts.length === 2 || parts.length === 3)) {
        const category = content.categories.find((c) => c.slug === parts[1]);
        if (!category) return notFound();
        if (parts.length === 2) return page(render.categoryPage(content, category));
        const item = category.items.find((i) => i.slug === parts[2]);
        return item ? page(render.itemPage(content, category, item)) : notFound();
      }
      return notFound();
    } catch (err) {
      console.error(JSON.stringify({ severity: 'ERROR', message: err.stack ?? String(err), path: url.pathname }));
      return send(503, '<!doctype html><title>Unavailable</title><p>The compendium is temporarily unavailable. Please try again shortly.</p>', undefined, { 'Retry-After': '30' });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  const source = createSource({
    sheetId: process.env.SHEET_ID,
    file: process.env.SHEET_FILE,
    ttlMs: Number(process.env.CACHE_SECONDS ?? 60) * 1000,
  });
  const form = parseFormUrl(process.env.FEEDBACK_FORM_URL);
  if (process.env.FEEDBACK_FORM_URL && !form) {
    console.error(JSON.stringify({ severity: 'WARNING', message: 'FEEDBACK_FORM_URL is not a pre-filled Google Form link with PAGE, ENTRY and MESSAGE; problem reports are disabled' }));
  }
  const server = createServer(createApp(source, { report: form ? createReporter(form) : null, track: logPageview }));
  server.listen(port, () => console.log(JSON.stringify({ severity: 'INFO', message: `Listening on :${port}` })));
  // Warm the cache so the first visitor doesn't wait on Google.
  source.get().catch(() => {});
  // server.close() alone waits on browsers' keep-alive/preconnect sockets indefinitely, so drop idle
  // connections now, give in-flight requests 3s (Cloud Run allows 10s after SIGTERM), and exit on a second signal.
  let stopping = false;
  const shutdown = () => {
    if (stopping) process.exit(1);
    stopping = true;
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 3000).unref();
  };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, shutdown);
}
