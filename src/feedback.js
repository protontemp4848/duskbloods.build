// "Report a problem" submissions, forwarded to a Google Form so they land as rows in a Google Sheet.
//
// FEEDBACK_FORM_URL is the form's pre-filled link (Form editor > ⋮ > Get pre-filled link), made by typing PAGE,
// ENTRY and MESSAGE into the three questions:
//   https://docs.google.com/forms/d/e/<id>/viewform?usp=pp_url&entry.111=PAGE&entry.222=ENTRY&entry.333=MESSAGE
// From that we know where to post (…/formResponse) and which entry.N field is which. No credentials are involved:
// the form is public, and the site submits exactly what a visitor could submit on the form itself.

// A same-site path: starts with one "/" (not "//" or "/\", which browsers treat as another host), no whitespace.
export const isSitePath = (p) => typeof p === 'string' && p.length <= 500 && /^\/(?![/\\])[^\s\\]*$/.test(p);

export const LIMITS = { message: 2000, minMessage: 5, entry: 200, page: 500, perWindow: 5, windowMs: 10 * 60_000 };

/** Parses the pre-filled link into { action, fields: { page, entry, message } }, or null if it isn't usable. */
export function parseFormUrl(raw) {
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
  const fields = {};
  for (const [key, value] of url.searchParams) {
    const role = { page: 'page', entry: 'entry', message: 'message' }[value.trim().toLowerCase()];
    if (/^entry\.\d+$/.test(key) && role) fields[role] = key;
  }
  if (!fields.page || !fields.entry || !fields.message) return null;
  return { action: `${url.origin}${url.pathname.replace(/\/viewform$/, '/formResponse')}`, fields };
}

/**
 * submit({ ip, page, entry, message, trap }) -> { status, error? }
 *   200 sent · 200 trap (pretend success to bots) · 400 invalid · 429 rate limited · 502 form unreachable
 */
export function createReporter(form, { fetchImpl = fetch, now = Date.now, log = console } = {}) {
  const recent = new Map(); // ip -> [timestamps]

  return async function submit({ ip = '', page = '', entry = '', message = '', trap = '' }) {
    if (!form) return { status: 404, error: 'Reporting is not configured.' };
    if (trap) return { status: 200 }; // honeypot field filled in: a bot

    const text = String(message).trim();
    if (text.length < LIMITS.minMessage) return { status: 400, error: 'Please describe the problem.' };
    if (text.length > LIMITS.message) return { status: 400, error: `Please keep it under ${LIMITS.message} characters.` };
    const path = String(page).trim();
    if (!isSitePath(path)) return { status: 400, error: 'Unknown page.' };

    const t = now();
    const hits = (recent.get(ip) ?? []).filter((x) => t - x < LIMITS.windowMs);
    if (hits.length >= LIMITS.perWindow) return { status: 429, error: 'Thanks! That’s a lot of reports in a short time; please try again later.' };
    hits.push(t);
    recent.set(ip, hits);
    if (recent.size > 5000) for (const [k, v] of recent) if (t - v.at(-1) > LIMITS.windowMs) recent.delete(k);

    const body = new URLSearchParams({
      [form.fields.page]: path,
      [form.fields.entry]: String(entry).trim().slice(0, LIMITS.entry),
      [form.fields.message]: text,
    });
    try {
      const res = await fetchImpl(form.action, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(8000) });
      // Google answers 200 with a "response recorded" page; anything else means the form rejected it.
      if (res.status !== 200) throw new Error(`Google Form answered HTTP ${res.status}`);
      return { status: 200 };
    } catch (err) {
      hits.pop(); // don't count a failed attempt against the visitor
      log.error(JSON.stringify({ severity: 'ERROR', message: `Problem report not delivered: ${err.message}`, page: path }));
      return { status: 502, error: 'Sorry, the report couldn’t be sent. Please try again in a moment.' };
    }
  };
}
