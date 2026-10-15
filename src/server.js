import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSource } from './sheet.js';
import * as render from './render.js';

const STATIC_DIR = new URL('../public/', import.meta.url);
const STATIC_TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function search(content, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const category of content.categories) {
    for (const item of category.items) {
      const hay = [item.title, item.summary, item.body, ...item.tags, ...item.fields.map((f) => f.value)].join(' ').toLowerCase();
      if (terms.every((t) => hay.includes(t))) {
        const title = item.title.toLowerCase();
        // Rank: every term in the title, then some term in the title, then matches in other text.
        const rank = terms.every((t) => title.includes(t)) ? 2 : terms.some((t) => title.includes(t)) ? 1 : 0;
        results.push({ item, category: category.name, href: `/c/${category.slug}/${item.slug}`, rank });
      }
    }
  }
  return results.sort((a, b) => b.rank - a.rank).slice(0, 100);
}

export function createApp(source) {
  return async function handler(req, res) {
    const send = (status, body, type = 'text/html; charset=utf-8', extra = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });

    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });

    try {
      if (url.pathname === '/healthz') return send(200, JSON.stringify({ ok: true, ...source.status() }), 'application/json');

      if (parts[0] === 'static' && parts.length === 2) {
        const ext = parts[1].slice(parts[1].lastIndexOf('.'));
        if (!STATIC_TYPES[ext] || !/^[\w.-]+$/.test(parts[1])) return send(404, 'Not found', 'text/plain');
        try {
          const file = await readFile(fileURLToPath(new URL(parts[1], STATIC_DIR)));
          return send(200, file, STATIC_TYPES[ext], { 'Cache-Control': 'public, max-age=300' });
        } catch { return send(404, 'Not found', 'text/plain'); }
      }

      const content = await source.get();
      const page = (html) => send(200, html, undefined, { 'Cache-Control': 'public, max-age=60' });
      const notFound = () => send(404, render.notFoundPage(content));

      if (url.pathname === '/api/content') return send(200, JSON.stringify(content), 'application/json', { 'Cache-Control': 'public, max-age=60' });
      if (parts.length === 0) return page(render.homePage(content));
      if (parts[0] === 'compendium' && parts.length === 1) return page(render.compendiumPage(content));
      if (parts[0] === 'search' && parts.length === 1) {
        const q = (url.searchParams.get('q') ?? '').slice(0, 100);
        return page(render.searchPage(content, q, search(content, q)));
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
  const server = createServer(createApp(source));
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
