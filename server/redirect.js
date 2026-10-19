'use strict';
const { verifyPassword } = require('./auth');
const { parseUserAgent } = require('./ua');
const clicks = require('./clicks');
const cache = require('./cache');
const ratelimit = require('./ratelimit');
const { readBody, clientIp, escapeHtml, nowIso, HttpError } = require('./util');

// Redirect timings (ms) for the admin "latency" panel: time spent deciding, before the click is logged.
const decideTimes = [];
const recentDecideMs = () => decideTimes.slice();

const CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;
const SOURCES = new Set(['qr', 'bio']);          // ?src= values that are recorded as the click source
const srcOf = (req) => { const s = new URL(req.url, 'http://x').searchParams.get('src'); return SOURCES.has(s) ? s : 'direct'; };
const srcMark = (req) => { const s = srcOf(req); return s === 'direct' ? '' : `?src=${s}`; };

function page(res, status, title, message, extraHtml = '') {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · LinkPulse</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7fa;color:#14171a;font-family:Montserrat,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 main{max-width:440px;margin:24px;background:#fff;border:1px solid #dde3e8;border-radius:16px;padding:36px;text-align:center}
 h1{font-size:24px;margin:0 0 8px} p{color:#5b6470;line-height:1.5;margin:0 0 16px}
 a.b,button{display:inline-block;background:#0e8fd0;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:600 15px inherit;text-decoration:none;cursor:pointer}
 input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #c5ced6;border-radius:10px;font:inherit;margin-bottom:12px}
 .err{color:#c8102e;font-weight:600}
 small{color:#8a94a0}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${message}</p>${extraHtml}<small>LinkPulse</small></main></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

async function lookup(db, code) {
  let row = cache.get(code);
  if (row === undefined) {
    row = (await db.get('SELECT id, short_code, destination_url, status, expires_at, click_limit, password_hash FROM links WHERE short_code = ?', [code])) || null;
    if (row) cache.set(code, row);
  }
  return row;
}

/**
 * The redirect engine. Checks run in this order and stop at the first failure:
 *   1 code exists -> 2 not disabled -> 3 not expired -> 4 password (if set) -> 5 click limit -> redirect.
 * The click is logged AFTER the response has been sent.
 */
async function handleRedirect(db, req, res, code, { unlocked = false } = {}) {
  const t0 = performance.now();
  if (!CODE_RE.test(code)) return page(res, 404, 'Link not found', 'This short link does not exist.');
  const link = await lookup(db, code);
  if (!link) return page(res, 404, 'Link not found', 'This short link does not exist. Check the address and try again.');
  if (link.status === 'disabled') {
    return page(res, 410, 'Link disabled', 'This link has been switched off and no longer redirects.');
  }
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
    return page(res, 410, 'Link expired', 'This link has expired and no longer redirects.');
  }
  if (link.password_hash && !unlocked) {
    const qrMark = srcMark(req);   // keep the QR / bio marker through the password form
    return page(res, 200, 'Password required', 'This link is protected. Enter the password to continue.',
      `<form method="post" action="/unlock/${encodeURIComponent(link.short_code)}${qrMark}">
         <input type="password" name="password" placeholder="Password" autofocus required>
         <button type="submit">Continue</button></form>`);
  }

  const ua = String(req.headers['user-agent'] || '');
  const parsed = parseUserAgent(ua);

  // Click limit: one atomic UPDATE, so two visitors can never both take the last click.
  // Bots never use up a click, but a link that has hit its limit refuses everyone.
  // Links without a limit are counted when the click is saved (a moment after the redirect), so no database wait.
  let countIt = false;
  if (link.click_limit !== null) {
    if (parsed.isBot) {
      const cur = await db.get('SELECT click_count FROM links WHERE id = ?', [link.id]);
      if (cur.click_count >= link.click_limit) return page(res, 410, 'Click limit reached', 'This link has reached its click limit and no longer redirects.');
    } else {
      const r = await db.run('UPDATE links SET click_count = click_count + 1 WHERE id = ? AND click_count < ?', [link.id, link.click_limit]);
      if (r.changes === 0) return page(res, 410, 'Click limit reached', 'This link has reached its click limit and no longer redirects.');
    }
  } else if (!parsed.isBot) {
    countIt = true;
  }

  const decideMs = performance.now() - t0;
  decideTimes.push(decideMs);
  if (decideTimes.length > 200) decideTimes.shift();

  res.writeHead(302, {
    Location: link.destination_url,
    'Cache-Control': 'no-store',
    'Server-Timing': `decide;dur=${decideMs.toFixed(2)}`,
  });
  res.end();

  // Everything below happens after the visitor has been sent on.
  setImmediate(() => {
    try {
      const url = new URL(req.url, 'http://x');
      const ref = String(req.headers.referer || req.headers.referrer || '');
      let referrer = '';
      if (ref) { try { referrer = new URL(ref).hostname; } catch { referrer = ''; } }
      clicks.logClick({
        link_id: link.id,
        clicked_at: nowIso(),
        referrer,
        device: parsed.device,
        browser: parsed.browser,
        os: parsed.os,
        country: String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'] || 'Unknown').slice(0, 40),
        source: srcOf(req),
        visitor_hash: clicks.visitorHash(clientIp(req), ua),
        is_bot: parsed.isBot,
        count_it: countIt,
      });
    } catch (e) { console.error('click log failed', e.message); }
  });
}

/** POST /unlock/:code with the form field "password". */
async function handleUnlock(db, req, res, code) {
  const ip = clientIp(req);
  try { ratelimit.hit(`unlock:${ip}:${code.toLowerCase()}`, 8, 60_000); } catch (e) {
    if (e instanceof HttpError) return page(res, 429, 'Too many attempts', 'Please wait a minute and try again.');
    throw e;
  }
  const link = CODE_RE.test(code) ? await lookup(db, code) : null;
  if (!link || !link.password_hash) return handleRedirect(db, req, res, code);
  const body = new URLSearchParams(await readBody(req, 8 * 1024));
  if (!verifyPassword(body.get('password') || '', link.password_hash)) {
    return page(res, 401, 'Wrong password', '<span class="err">That password is not correct.</span>',
      `<form method="post" action="/unlock/${encodeURIComponent(link.short_code)}${srcMark(req)}">
         <input type="password" name="password" placeholder="Password" autofocus required>
         <button type="submit">Try again</button></form>`);
  }
  // Re-run every other check (status, expiry, limit) and answer the POST with a redirect.
  const wrapped = {
    writeHead: (status, headers) => res.writeHead(status === 302 ? 303 : status, headers),
    end: (...a) => res.end(...a),
  };
  return handleRedirect(db, req, wrapped, code, { unlocked: true });
}

module.exports = { handleRedirect, handleUnlock, recentDecideMs, CODE_RE };
