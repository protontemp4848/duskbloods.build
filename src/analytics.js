// Privacy-preserving page view counting: one structured log line per page a person loads, which a Cloud Logging
// sink copies into BigQuery (see `./deploy.sh setup`). No cookies, no client script, and nothing that identifies a
// visitor: no IP, no full user agent, and other sites' referrers cut down to their hostname.

// Every browser's user agent starts with "Mozilla/"; scripts (curl, python, node) don't. These are the crawlers,
// link unfurlers and monitors that claim to be a browser anyway (AdSense's Mediapartners-Google has no "bot").
const BOT = /bot|crawl|spider|slurp|mediapartners|google-inspectiontool|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|monitor|uptime/i;

export function isBot(ua) {
  return !ua.startsWith('Mozilla/') || BOT.test(ua);
}

export function device(ua) {
  if (/iPad|Tablet|Android(?!.*Mobi)/i.test(ua)) return 'tablet';
  return /Mobi|iPhone|iPod|Android/i.test(ua) ? 'mobile' : 'desktop';
}

// Hostname of another site that linked here; '' for direct visits, our own pages, and anything unparseable.
export function referrerHost(referer, ownHosts) {
  try {
    const { protocol, hostname } = new URL(referer);
    if (!/^https?:$/.test(protocol)) return '';
    const host = hostname.replace(/^www\./, '');
    return ownHosts.some((h) => h.replace(/^www\./, '') === host) ? '' : host;
  } catch { return ''; }
}

// The event for one rendered page, or null when it shouldn't count (HEAD, bots, browser prefetches).
// extra: { q, results } on searches.
export function pageview(req, path, status, origin, extra = {}) {
  const ua = String(req.headers['user-agent'] ?? '');
  const purpose = String(req.headers['sec-purpose'] ?? req.headers.purpose ?? '');
  if (req.method !== 'GET' || isBot(ua) || /prefetch|prerender/i.test(purpose)) return null;
  const ownHosts = [String(req.headers.host ?? '').replace(/:\d+$/, '')];
  try { ownHosts.push(new URL(origin).hostname); } catch {}
  const event = { path, status, ref: referrerHost(String(req.headers.referer ?? ''), ownHosts), device: device(ua) };
  if (extra.q) Object.assign(event, { q: extra.q.toLowerCase().replace(/\s+/g, ' ').trim(), results: extra.results });
  return event;
}

// Cloud Run turns a JSON line on stdout into a structured log entry; the BigQuery sink matches message="pageview".
export function logPageview(event) {
  console.log(JSON.stringify({ severity: 'INFO', message: 'pageview', pageview: event }));
}
