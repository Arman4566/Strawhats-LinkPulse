'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { tx } = require('./db');
const { effectiveStatus } = require('./links');
const { RESERVED_ALIASES } = require('./validate');
const { HttpError, escapeHtml, nowIso, baseUrl } = require('./util');

// Link-in-bio pages: one per user, at /@handle. Every button is one of the user's own short links,
// so every tap is counted in that link's analytics (source "bio").

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const MAX_ITEMS = 25;
const THEMES = {
  ocean:    { label: 'Ocean',    bg: 'linear-gradient(160deg,#0b3b66 0%,#0e8fd0 55%,#7dd3fc 100%)', fg: '#ffffff', card: 'rgba(255,255,255,.18)', hover: 'rgba(255,255,255,.30)', line: 'rgba(255,255,255,.35)' },
  sunset:   { label: 'Sunset',   bg: 'linear-gradient(160deg,#7c2d12 0%,#e11d48 50%,#fbbf24 100%)', fg: '#ffffff', card: 'rgba(255,255,255,.18)', hover: 'rgba(255,255,255,.30)', line: 'rgba(255,255,255,.35)' },
  forest:   { label: 'Forest',   bg: 'linear-gradient(160deg,#052e16 0%,#15803d 55%,#86efac 100%)', fg: '#ffffff', card: 'rgba(255,255,255,.16)', hover: 'rgba(255,255,255,.28)', line: 'rgba(255,255,255,.32)' },
  midnight: { label: 'Midnight', bg: 'linear-gradient(160deg,#0b1220 0%,#312e81 60%,#7c3aed 100%)', fg: '#f1f5f9', card: 'rgba(255,255,255,.10)', hover: 'rgba(255,255,255,.20)', line: 'rgba(255,255,255,.22)' },
  paper:    { label: 'Paper',    bg: 'linear-gradient(160deg,#f8fafc 0%,#e2e8f0 100%)',             fg: '#0f172a', card: '#ffffff',               hover: '#f1f5f9',               line: '#cbd5e1' },
};

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');   // safe inside an inline <script>

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

async function ownLinks(db, userId) {
  const rows = await db.all('SELECT id, short_code::text AS short_code, title, destination_url, status, expires_at, click_limit, click_count FROM links WHERE owner_id = ? ORDER BY id DESC LIMIT 1000', [userId]);
  return rows.map((l) => ({ id: l.id, short_code: l.short_code, title: l.title, destination_url: l.destination_url, effective_status: effectiveStatus(l) }));
}

/** The signed-in user's bio page (or null), the items on it, and the links they can still add. */
async function getBio(db, user, req) {
  const page = await db.get('SELECT id, handle::text AS handle, display_name, bio, theme, published, views, updated_at FROM bio_pages WHERE owner_id = ?', [user.id]);
  const links = await ownLinks(db, user.id);
  const base = baseUrl(req, config.BASE_URL);
  const out = { page: null, items: [], links, themes: Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, bg: t.bg, fg: t.fg, card: t.card, line: t.line })), suggested_handle: suggestHandle(user) };
  if (page) {
    const byId = new Map(links.map((l) => [l.id, l]));
    const items = await db.all('SELECT link_id, label FROM bio_items WHERE page_id = ? ORDER BY position, id', [page.id]);
    out.page = { ...page, published: !!page.published, url: `${base}/@${page.handle}` };
    out.items = items.filter((i) => byId.has(i.link_id)).map((i) => ({ link_id: i.link_id, label: i.label, ...byId.get(i.link_id) }));
  }
  return out;
}

function suggestHandle(user) {
  const h = String(user.name || user.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return HANDLE_RE.test(h) && !RESERVED_ALIASES.has(h) ? h : '';
}

/** Create or update the user's page from the editor: profile fields plus the ordered list of link ids. */
async function saveBio(db, user, b) {
  const errors = {};
  const handle = clean(b.handle, 40).toLowerCase().replace(/^@/, '');
  if (!HANDLE_RE.test(handle)) errors.handle = 'Use 3 to 30 characters: letters, numbers, - or _ (start with a letter or number)';
  else if (RESERVED_ALIASES.has(handle)) errors.handle = 'This name is reserved. Choose another.';
  const display_name = clean(b.display_name, 60);
  if (!display_name) errors.display_name = 'Enter the name shown at the top of your page';
  const bio = clean(b.bio, 240);
  const theme = THEMES[b.theme] ? b.theme : 'ocean';
  const published = b.published === false ? 0 : 1;

  const raw = Array.isArray(b.items) ? b.items : [];
  if (raw.length > MAX_ITEMS) errors.items = `A page can show up to ${MAX_ITEMS} links`;
  const items = [];
  for (const it of raw) {
    const id = Number(it && it.link_id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || items.some((x) => x.link_id === id)) continue;
    items.push({ link_id: id, label: clean(it.label, 60) });
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', { errors });

  return tx(db, async (t) => {
    if (items.length) {
      const own = await t.all('SELECT id FROM links WHERE owner_id = ? AND id = ANY(?::int[])', [user.id, items.map((i) => i.link_id)]);
      if (own.length !== items.length) throw new HttpError(422, 'Please fix the highlighted fields', { errors: { items: 'You can only add your own links' } });
    }
    const now = nowIso();
    const row = await t.get(`
      INSERT INTO bio_pages (owner_id, handle, display_name, bio, theme, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner_id) DO UPDATE SET handle = EXCLUDED.handle, display_name = EXCLUDED.display_name, bio = EXCLUDED.bio,
        theme = EXCLUDED.theme, published = EXCLUDED.published, updated_at = EXCLUDED.updated_at
      RETURNING id`, [user.id, handle, display_name, bio, theme, published, now, now]).catch((e) => {
      if (e.code === '23505') throw new HttpError(422, 'Please fix the highlighted fields', { errors: { handle: 'This page name is already taken' } });   // handle unique violation
      throw e;
    });
    await t.run('DELETE FROM bio_items WHERE page_id = ?', [row.id]);
    for (let i = 0; i < items.length; i++) {
      await t.run('INSERT INTO bio_items (page_id, link_id, label, position) VALUES (?, ?, ?, ?)', [row.id, items[i].link_id, items[i].label, i]);
    }
    return row.id;
  });
}

async function deleteBio(db, user) {
  await db.run('DELETE FROM bio_pages WHERE owner_id = ?', [user.id]);   // bio_items go with it (ON DELETE CASCADE)
}

// ------------------------------------------------------------------ the public page
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · LinkPulse</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7fa;color:#14171a;font-family:system-ui,sans-serif;text-align:center}main{padding:24px}h1{margin:0 0 8px}p{color:#5b6470}</style></head>
<body><main><h1>Page not found</h1><p>There is no page at this address.</p></main></body></html>`);
}

async function handleBioPage(db, req, res, handle) {
  const page = HANDLE_RE.test(handle.toLowerCase())
    ? await db.get('SELECT id, handle::text AS handle, display_name, bio, theme, published FROM bio_pages WHERE handle = ?', [handle])
    : null;
  if (!page || !page.published) return notFound(res);

  const rows = await db.all(`
    SELECT i.label, l.short_code::text AS short_code, l.title, l.destination_url, l.status, l.expires_at, l.click_limit, l.click_count, l.password_hash
    FROM bio_items i JOIN links l ON l.id = i.link_id WHERE i.page_id = ? ORDER BY i.position, i.id`, [page.id]);
  // Only links a visitor could actually open are shown: switched off, expired or used-up links quietly disappear.
  const live = rows.filter((r) => effectiveStatus(r) === 'active');

  if (!/bot|crawl|spider|preview|curl|wget/i.test(String(req.headers['user-agent'] || ''))) {
    db.run('UPDATE bio_pages SET views = views + 1 WHERE id = ?', [page.id]).catch(() => {});   // fire and forget
  }

  const base = baseUrl(req, config.BASE_URL);
  const t = THEMES[page.theme] || THEMES.ocean;
  const nonce = crypto.randomBytes(16).toString('base64');
  const initial = escapeHtml((page.display_name || page.handle).slice(0, 1).toUpperCase());
  const pageUrl = `${base}/@${page.handle}`;
  const buttons = live.map((r) => {
    const text = r.label || r.title || `/${r.short_code}`;
    return `<a class="b" href="${escapeHtml(`${base}/${encodeURIComponent(r.short_code)}?src=bio`)}" rel="noopener"><span class="t">${escapeHtml(text)}${r.password_hash ? ' <i title="Password protected">🔒</i>' : ''}</span><span class="h">${escapeHtml(hostOf(r.destination_url))}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg></a>`;
  }).join('');

  const title = `${page.display_name} (@${page.handle})`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(page.bio || `Links from ${page.display_name}`)}">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(page.bio || `Links from ${page.display_name}`)}"><meta property="og:type" content="profile">
<meta name="theme-color" content="#0b1220">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:${t.bg};background-attachment:fixed;color:${t.fg};font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;padding:44px 18px 28px}
main{width:100%;max-width:560px;text-align:center;animation:in .6s cubic-bezier(.2,.8,.2,1) both}
.av{width:92px;height:92px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;font-size:38px;font-weight:800;background:${t.card};border:2px solid ${t.line};backdrop-filter:blur(8px)}
h1{margin:0;font-size:26px;letter-spacing:-.02em}
.at{opacity:.75;font-size:14px;margin-top:2px}
.bio{margin:12px auto 0;max-width:42ch;line-height:1.5;opacity:.92;white-space:pre-line}
.list{display:grid;gap:12px;margin:28px 0 22px}
.b{position:relative;display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;column-gap:12px;align-items:center;text-align:left;padding:15px 18px;border-radius:16px;background:${t.card};border:1px solid ${t.line};color:inherit;text-decoration:none;backdrop-filter:blur(10px);transition:transform .2s,background .2s;animation:in .5s cubic-bezier(.2,.8,.2,1) both}
.b:nth-child(2){animation-delay:.05s}.b:nth-child(3){animation-delay:.1s}.b:nth-child(4){animation-delay:.15s}.b:nth-child(n+5){animation-delay:.2s}
.b:hover,.b:focus-visible{transform:translateY(-2px) scale(1.01);background:${t.hover};outline:none}
.b .t{font-weight:700;font-size:16px;grid-column:1}
.b .h{grid-column:1;font-size:12.5px;opacity:.7;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b svg{grid-column:2;grid-row:1/3;opacity:.8}
.empty{opacity:.8;padding:28px 0}
.actions{display:flex;gap:10px;justify-content:center}
button{font:inherit;font-weight:600;font-size:14px;color:inherit;background:${t.card};border:1px solid ${t.line};padding:9px 16px;border-radius:99px;cursor:pointer;backdrop-filter:blur(8px)}
button:hover{background:${t.hover}}
footer{margin-top:auto;padding-top:34px;font-size:12.5px;opacity:.7}
footer a{color:inherit}
@keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head>
<body><main>
<div class="av" aria-hidden="true">${initial}</div>
<h1>${escapeHtml(page.display_name)}</h1>
<div class="at">@${escapeHtml(page.handle)}</div>
${page.bio ? `<p class="bio">${escapeHtml(page.bio)}</p>` : ''}
<div class="list">${buttons || '<div class="empty">No links to show yet.</div>'}</div>
<div class="actions"><button type="button" id="share">Share this page</button></div>
</main>
<footer>Made with <a href="${escapeHtml(base)}" rel="noopener">LinkPulse</a></footer>
<script nonce="${nonce}">
document.getElementById('share').addEventListener('click', async function () {
  var b = this, data = { title: ${safeJson(title)}, url: ${safeJson(pageUrl)} };
  try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(data.url); b.textContent = 'Link copied'; } catch (e) { b.textContent = data.url; }
  setTimeout(function () { b.textContent = 'Share this page'; }, 2200);
});
</script></body></html>`;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer-when-downgrade',
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}

module.exports = { getBio, saveBio, deleteBio, handleBioPage, THEMES, HANDLE_RE };
