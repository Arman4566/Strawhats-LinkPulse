'use strict';
const auth = require('./auth');
const config = require('./config');
const ratelimit = require('./ratelimit');
const analytics = require('./analytics');
const links = require('./links');
const clicks = require('./clicks');
const cache = require('./cache');
const qr = require('./qr');
const { checkCsv } = require('./csv');
const ai = require('./ai');
const { recentDecideMs } = require('./redirect');
const { HttpError, readJson, readBody, clientIp, baseUrl, nowIso } = require('./util');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAGE_SIZE = 20;

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

const int = (v, name = 'id') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(404, `${name} not found`);   // ids are 32-bit integers
  return n;
};
const intOr0 = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : 0; };   // 0 matches nothing
const selfHostOf = (req) => String(req.headers.host || '').split(':')[0];
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

// ------------------------------------------------------------------ auth
route('POST', '/api/auth/register', async ({ db, req }) => {
  ratelimit.hit(`auth:${clientIp(req)}`, 10, 60_000);
  const b = await readJson(req);
  const errors = {};
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  const password = String(b.password || '');
  if (!EMAIL_RE.test(email) || email.length > 120) errors.email = 'Enter a valid email address';
  if (!name || name.length > 80) errors.name = 'Enter your name (up to 80 characters)';
  if (password.length < 8 || password.length > 128) errors.password = 'Password must be 8 to 128 characters';
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', { errors });
  const r = await db.run('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING RETURNING id',
    [email, name, auth.hashPassword(password), 'user', nowIso()]);
  if (!r.id) {
    throw new HttpError(422, 'Please fix the highlighted fields', { errors: { email: 'An account with this email already exists' } });
  }
  const user = { id: r.id, email, name, role: 'user' };
  return { status: 201, body: { token: auth.signToken(user), user } };
});

route('POST', '/api/auth/login', async ({ db, req }) => {
  ratelimit.hit(`auth:${clientIp(req)}`, 10, 60_000);
  const b = await readJson(req);
  const row = await db.get('SELECT * FROM users WHERE email = ?', [String(b.email || '').trim().toLowerCase().slice(0, 200)]);
  const ok = auth.verifyPassword(String(b.password || ''), row ? row.password_hash : '0'.repeat(32) + '$' + '0'.repeat(64));
  if (!row || !ok) throw new HttpError(401, 'Email or password is incorrect');
  const user = { id: row.id, email: row.email, name: row.name, role: row.role };
  return { token: auth.signToken(user), user };
});

route('GET', '/api/me', async ({ db, req }) => ({ user: await auth.requireUser(db, req) }));

// ------------------------------------------------------------------ links
route('GET', '/api/links', async ({ db, req, url }) => {
  const user = await auth.requireUser(db, req);
  const q = url.searchParams;
  const where = [];
  const p = [];
  if (user.role !== 'admin' || q.get('scope') !== 'all') { where.push('l.owner_id = ?'); p.push(user.id); }
  const search = (q.get('search') || '').trim();
  if (search) {
    where.push('(l.short_code::text ILIKE ? OR l.destination_url ILIKE ? OR l.title ILIKE ?)');
    const like = `%${search.replace(/[%_]/g, '')}%`;
    p.push(like, like, like);
  }
  if (q.get('campaign')) { where.push('l.campaign_id = ?'); p.push(intOr0(q.get('campaign'))); }
  if (q.get('tag')) {
    where.push('l.id IN (SELECT lt.link_id FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE t.name = ?)');
    p.push(String(q.get('tag')).toLowerCase());
  }
  await clicks.flush();      // so the click counts shown are up to date
  let rows = await db.all(`${links.LINK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT 5000`, p);
  const status = q.get('status');
  if (status) rows = rows.filter((r) => links.effectiveStatus(r) === status);
  const total = rows.length;
  const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
  const base = baseUrl(req, config.BASE_URL);
  return {
    total, page, page_size: PAGE_SIZE,
    links: await links.serializeLinks(db, rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), base),
  };
});

route('POST', '/api/links/validate', async ({ db, req }) => {
  const user = await auth.requireUser(db, req);
  const v = await require('./validate').validateLink(db, await readJson(req), { ownerId: user.id, selfHost: selfHostOf(req) });
  return { ok: v.ok, errors: v.errors, warnings: v.warnings };
});

route('POST', '/api/links', async ({ db, req }) => {
  const user = await auth.requireUser(db, req);
  ratelimit.hit(`create:${user.id}`, config.CREATE_LIMIT_PER_MIN, 60_000);
  ratelimit.hit(`create-ip:${clientIp(req)}`, config.CREATE_LIMIT_PER_MIN * 3, 60_000);
  const { id, warnings } = await links.createLink(db, user, await readJson(req), { selfHost: selfHostOf(req) });
  const row = await links.getLinkFor(db, user, id);
  return { status: 201, body: { link: await links.serializeLink(db, row, baseUrl(req, config.BASE_URL)), warnings } };
});

route('POST', '/api/links/import', async ({ db, req, url }) => {
  const user = await auth.requireUser(db, req);
  const dryRun = url.searchParams.get('dryRun') === '1';
  if (!dryRun) ratelimit.hit(`import:${user.id}`, 5, 60_000);
  const raw = await readBody(req, 1024 * 1024);
  let text = raw;
  if (String(req.headers['content-type'] || '').includes('json')) {
    try { text = String(JSON.parse(raw).csv || ''); } catch { throw new HttpError(400, 'Body must be valid JSON'); }
  }
  const result = await checkCsv(db, user, text, { selfHost: selfHostOf(req) });
  if (result.fatal) throw new HttpError(422, result.fatal);
  if (dryRun) return { ...result, imported: 0, dry_run: true };

  let imported = 0;
  for (const r of result.rows) {
    if (r.status !== 'valid') continue;
    try {
      await links.createLink(db, user, r.input, { selfHost: selfHostOf(req) });
      imported++;
      r.status = 'imported';
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;      // e.g. the alias was taken a moment ago
      r.status = 'error';
      r.messages = e.extra?.errors ? Object.values(e.extra.errors) : [e.message];
    }
  }
  result.summary.imported = imported;
  result.summary.errors = result.rows.filter((r) => r.status === 'error').length;
  return { ...result, imported, dry_run: false };
});

route('GET', '/api/links/:id', async ({ db, req, params }) => {
  const user = await auth.requireUser(db, req);
  await clicks.flush();
  const row = await links.getLinkFor(db, user, int(params.id));
  return { link: await links.serializeLink(db, row, baseUrl(req, config.BASE_URL)) };
});

route('PATCH', '/api/links/:id', async ({ db, req, params }) => {
  const user = await auth.requireUser(db, req);
  const id = int(params.id);
  const { warnings } = await links.updateLink(db, user, id, await readJson(req), { selfHost: selfHostOf(req) });
  const row = await links.getLinkFor(db, user, id);
  return { link: await links.serializeLink(db, row, baseUrl(req, config.BASE_URL)), warnings };
});

route('GET', '/api/links/:id/analytics', async ({ db, req, params, url }) => {
  const user = await auth.requireUser(db, req);
  await clicks.flush();
  const row = await links.getLinkFor(db, user, int(params.id));
  return { link: await links.serializeLink(db, row, baseUrl(req, config.BASE_URL)), ...(await analytics.linkAnalytics(db, row.id, url.searchParams)) };
});

route('GET', '/api/links/:id/qr.:fmt', async ({ db, req, params, url }) => {
  const user = await auth.requireUser(db, req);
  const row = await links.getLinkFor(db, user, int(params.id));
  const target = `${baseUrl(req, config.BASE_URL)}/${row.short_code}?src=qr`;
  const q = url.searchParams;
  if (params.fmt === 'svg') {
    return { raw: true, type: 'image/svg+xml; charset=utf-8', body: qr.toSvg(target, { dark: q.get('dark') || undefined, light: q.get('light') || undefined }), filename: `${row.short_code}-qr.svg` };
  }
  if (params.fmt === 'png') return { raw: true, type: 'image/png', body: qr.toPng(target), filename: `${row.short_code}-qr.png` };
  throw new HttpError(404, 'Use .svg or .png');
});

// ------------------------------------------------------------------ campaigns, tags
route('GET', '/api/campaigns', async ({ db, req }) => {
  const user = await auth.requireUser(db, req);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = await db.all(`
    SELECT c.id, c.name, c.description, c.created_at,
      (SELECT COUNT(*) FROM links l WHERE l.campaign_id = c.id) AS links,
      (SELECT COUNT(*) FROM clicks k JOIN links l ON l.id = k.link_id WHERE l.campaign_id = c.id AND k.is_bot = 0 AND k.clicked_at >= ?) AS clicks_30d
    FROM campaigns c WHERE c.owner_id = ? ORDER BY c.name`, [since, user.id]);
  return { campaigns: rows };
});

route('POST', '/api/campaigns', async ({ db, req }) => {
  const user = await auth.requireUser(db, req);
  const b = await readJson(req);
  const name = String(b.name || '').trim();
  if (!name || name.length > 80) throw new HttpError(422, 'Please fix the highlighted fields', { errors: { name: 'Enter a campaign name (up to 80 characters)' } });
  const r = await db.run('INSERT INTO campaigns (owner_id, name, description, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (owner_id, name) DO NOTHING RETURNING id',
    [user.id, name, String(b.description || '').slice(0, 300), nowIso()]);
  if (!r.id) throw new HttpError(422, 'Please fix the highlighted fields', { errors: { name: 'You already have a campaign with this name' } });
  return { status: 201, body: { campaign: { id: r.id, name, description: String(b.description || ''), links: 0, clicks_30d: 0 } } };
});

route('GET', '/api/tags', async ({ db, req }) => {
  const user = await auth.requireUser(db, req);
  return { tags: await db.all(`
    SELECT t.name, COUNT(lt.link_id) AS links FROM tags t LEFT JOIN link_tags lt ON lt.tag_id = t.id
    WHERE t.owner_id = ? GROUP BY t.id ORDER BY t.name`, [user.id]) };
});

// ------------------------------------------------------------------ analytics
route('GET', '/api/analytics/summary', async ({ db, req, url }) => {
  const user = await auth.requireUser(db, req);
  await clicks.flush();
  return analytics.summary(db, user, url.searchParams);
});

// ------------------------------------------------------------------ smart features
route('POST', '/api/ai/scan', async ({ db, req }) => {
  await auth.requireUser(db, req);
  const b = await readJson(req);
  const r = ai.scanUrl(b.destination_url);
  return { ...r, blocked: undefined };
});

route('POST', '/api/ai/suggest-alias', async ({ db, req }) => {
  await auth.requireUser(db, req);
  const b = await readJson(req);
  return { suggestions: await ai.suggestAliases(db, { destination_url: String(b.destination_url || ''), title: String(b.title || '') }) };
});

route('GET', '/api/ai/insights', async ({ db, req, url }) => {
  const user = await auth.requireUser(db, req);
  await clicks.flush();
  const q = url.searchParams;
  const days = Math.min(365, Math.max(7, parseInt(q.get('days') || '30', 10) || 30));
  const tz = parseInt(q.get('tz') || '0', 10) || 0;
  let scope = 'l.owner_id = ?'; const sp = [user.id];
  if (q.get('link')) { const row = await links.getLinkFor(db, user, int(q.get('link'))); scope = 'l.id = ?'; sp.length = 0; sp.push(row.id); }
  else if (q.get('campaign')) { scope += ' AND l.campaign_id = ?'; sp.push(intOr0(q.get('campaign'))); }
  const insights = await ai.insightsFor(db, scope, sp, { days, tz });
  const totals = await db.get(`SELECT COUNT(*) AS clicks FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${scope} AND c.is_bot = 0`, sp);
  const written = await ai.llmSummary(insights, totals);
  return { insights, summary: written || ai.localSummary(insights), summary_by: written ? 'gemini' : 'local' };
});

route('POST', '/api/ai/ask', async ({ db, req }) => {
  const user = await auth.requireUser(db, req);
  ratelimit.hit(`ask:${user.id}`, 40, 60_000);
  await clicks.flush();
  const b = await readJson(req);
  const question = String(b.question || '').trim().slice(0, 300);
  if (question.length < 3) throw new HttpError(422, 'Ask a question, for example: clicks from mobile last week');
  return await ai.runQuestion(db, user, question, parseInt(b.tz || '0', 10) || 0);
});

// ------------------------------------------------------------------ public: report a link
route('POST', '/api/report', async ({ db, req }) => {
  ratelimit.hit(`report:${clientIp(req)}`, 5, 60_000);
  const b = await readJson(req);
  const code = String(b.code || '').trim();
  const reason = String(b.reason || '').trim().slice(0, 300);
  const link = await db.get('SELECT id FROM links WHERE short_code = ?', [code.slice(0, 64)]);
  if (!link) throw new HttpError(404, 'Link not found');
  if (reason.length < 3) throw new HttpError(422, 'Please tell us what is wrong with this link');
  await db.run('INSERT INTO reports (link_id, reason, created_at) VALUES (?, ?, ?)', [link.id, reason, nowIso()]);
  return { status: 201, body: { ok: true } };
});

// ------------------------------------------------------------------ admin
route('GET', '/api/admin/links', async ({ db, req, url }) => {
  const user = await auth.requireAdmin(db, req);
  url.searchParams.set('scope', 'all');
  return routes.find((r) => r.method === 'GET' && r.re.test('/api/links')).handler({ db, req, url, params: {}, user });
});

route('POST', '/api/admin/links/:id/disable', async ({ db, req, params }) => {
  await auth.requireAdmin(db, req);
  const b = await readJson(req);
  await links.setStatus(db, int(params.id), 'disabled', b.reason);
  return { ok: true };
});

route('POST', '/api/admin/links/:id/enable', async ({ db, req, params }) => {
  await auth.requireAdmin(db, req);
  await links.setStatus(db, int(params.id), 'active');
  return { ok: true };
});

route('GET', '/api/admin/blocklist', async ({ db, req }) => {
  await auth.requireAdmin(db, req);
  return { domains: await db.all('SELECT id, domain, created_at FROM blocked_domains ORDER BY domain') };
});

route('POST', '/api/admin/blocklist', async ({ db, req }) => {
  const admin = await auth.requireAdmin(db, req);
  const b = await readJson(req);
  let host = '';
  try { host = new URL(/^[a-z]+:\/\//i.test(String(b.domain)) ? String(b.domain).trim() : `http://${String(b.domain || '').trim()}`).hostname.toLowerCase(); } catch { host = ''; }
  host = host.replace(/^www\./, '');
  if (!host.includes('.')) throw new HttpError(422, 'Enter a domain such as bad-site.example', { errors: { domain: 'Enter a domain such as bad-site.example' } });
  const added = await db.run('INSERT INTO blocked_domains (domain, added_by, created_at) VALUES (?, ?, ?) ON CONFLICT (domain) DO NOTHING RETURNING id', [host, admin.id, nowIso()]);
  if (!added.id) throw new HttpError(422, 'This domain is already blocked', { errors: { domain: 'This domain is already blocked' } });
  let disabled = 0;
  if (b.disable_existing) {
    const rows = await db.all("SELECT id, destination_url FROM links WHERE status = 'active'");
    for (const r of rows) {
      let h = '';
      try { h = new URL(r.destination_url).hostname.toLowerCase(); } catch { continue; }
      if (h === host || h.endsWith(`.${host}`)) { await links.setStatus(db, r.id, 'disabled', `Domain ${host} was blocked`); disabled++; }
    }
  }
  return { status: 201, body: { ok: true, domain: host, disabled_links: disabled } };
});

route('DELETE', '/api/admin/blocklist/:id', async ({ db, req, params }) => {
  await auth.requireAdmin(db, req);
  await db.run('DELETE FROM blocked_domains WHERE id = ?', [int(params.id)]);
  return { ok: true };
});

route('GET', '/api/admin/users', async ({ db, req }) => {
  await auth.requireAdmin(db, req);
  return { users: await db.all(`
    SELECT u.id, u.email, u.name, u.role, u.created_at, (SELECT COUNT(*) FROM links l WHERE l.owner_id = u.id) AS links
    FROM users u ORDER BY u.id`) };
});

route('GET', '/api/admin/reports', async ({ db, req }) => {
  await auth.requireAdmin(db, req);
  return { reports: await db.all(`
    SELECT r.id, r.reason, r.created_at, r.resolved, l.id AS link_id, l.short_code, l.destination_url, l.status
    FROM reports r JOIN links l ON l.id = r.link_id ORDER BY r.resolved, r.id DESC LIMIT 100`) };
});

route('POST', '/api/admin/reports/:id/resolve', async ({ db, req, params }) => {
  await auth.requireAdmin(db, req);
  await db.run('UPDATE reports SET resolved = 1 WHERE id = ?', [int(params.id)]);
  return { ok: true };
});

route('GET', '/api/admin/risk', async ({ db, req }) => {
  await auth.requireAdmin(db, req);
  const rows = await db.all("SELECT l.id, l.short_code, l.destination_url, l.click_count, u.email AS owner_email FROM links l LEFT JOIN users u ON u.id = l.owner_id WHERE l.status = 'active' ORDER BY l.id DESC LIMIT 3000");
  const risky = [];
  for (const r of rows) {
    const s = ai.scanUrl(r.destination_url);
    if (s.score >= 25) risky.push({ ...r, score: s.score, level: s.level, reasons: s.reasons.map((x) => x.text) });
  }
  risky.sort((a, b) => b.score - a.score);
  return { scanned: rows.length, risky: risky.slice(0, 50) };
});

route('GET', '/api/admin/perf', async ({ db, req }) => {
  await auth.requireAdmin(db, req);
  const d = recentDecideMs();
  const f = clicks.recentFlushMs();
  return {
    redirect_decide_ms: { samples: d.length, avg: avg(d), p95: pct(d, 0.95) },
    click_flush_ms: { samples: f.length, avg: avg(f), p95: pct(f, 0.95) },
    queued_clicks: clicks.pending(),
    note: 'Redirects are sent before clicks are written. The visitor only waits for the first number.',
  };
});

route('GET', '/health', async ({ db }) => ({ ok: true, time: nowIso(), links: (await db.get('SELECT COUNT(*) n FROM links')).n }));

// ------------------------------------------------------------------ dispatcher
async function handleApi(db, req, res, url, send) {
  const path = url.pathname;
  const hit = routes.find((r) => r.method === req.method && r.re.test(path));
  if (!hit) {
    if (path.startsWith('/api/')) throw new HttpError(404, 'Unknown API route');
    return false;
  }
  const m = path.match(hit.re);
  const params = {};
  hit.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const out = await hit.handler({ db, req, res, url, params });
  if (out && out.raw) {
    const headers = { 'Content-Type': out.type, 'Cache-Control': 'no-store' };
    if (out.filename) headers['Content-Disposition'] = `inline; filename="${out.filename}"`;
    res.writeHead(200, headers);
    res.end(out.body);
  } else if (out && out.status && out.body) send(res, out.status, out.body);
  else send(res, 200, out);
  return true;
}

module.exports = { handleApi, cache };
