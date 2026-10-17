'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linkpulse-test-'));
process.env.DATA_DIR = tmp;
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.CREATE_LIMIT_PER_MIN = '20';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const { openDb } = require('../server/db');
const { createServer, ensureAdmin } = require('../server/index');
const clicks = require('../server/clicks');
const ratelimit = require('../server/ratelimit');
const cache = require('../server/cache');

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
let db, server, base;
let userToken, otherToken, adminToken;

async function api(method, url, { token, body, raw } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': raw } : {}) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
const visit = (code, ua = BROWSER, extra = {}) => fetch(`${base}/${code}`, { redirect: 'manual', headers: { 'User-Agent': ua, ...extra } });
const clickRows = (linkId) => db.prepare('SELECT * FROM clicks WHERE link_id = ?').all(linkId);

async function register(email) {
  const r = await api('POST', '/api/auth/register', { body: { email, name: email.split('@')[0], password: 'password123' } });
  assert.equal(r.status, 201, r.text);
  return r.json.token;
}
async function makeLink(token, body) {
  const r = await api('POST', '/api/links', { token, body });
  assert.equal(r.status, 201, r.text);
  return r.json.link;
}

before(async () => {
  db = openDb(config.DB_PATH);
  ensureAdmin(db);
  server = createServer(db);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  userToken = await register('alice@example.test');
  otherToken = await register('bob@example.test');
  const login = await api('POST', '/api/auth/login', { body: { email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD } });
  adminToken = login.json.token;
});
beforeEach(() => ratelimit.resetAll());
after(() => { clicks.flush(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// ---------------------------------------------------------------- the four proofs from the deck
test('PROOF 1: a link capped at 3 clicks lets exactly 3 through, even when 12 visitors arrive at once', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/cap', click_limit: 3 });
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => visit(link.short_code, `${BROWSER} visitor/${i}`)));
  const codes = results.map((r) => r.status).sort();
  assert.equal(codes.filter((c) => c === 302).length, 3, `statuses: ${codes}`);
  assert.equal(codes.filter((c) => c === 410).length, 9);
  clicks.flush();
  assert.equal(db.prepare('SELECT click_count FROM links WHERE id = ?').get(link.id).click_count, 3);
  assert.equal(clickRows(link.id).filter((c) => !c.is_bot).length, 3);
  const after4 = await visit(link.short_code);
  assert.equal(after4.status, 410);
});

test('PROOF 2: bots are logged but never counted, and never use up a click', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/bots', click_limit: 1 });
  for (const ua of ['curl/8.4.0', 'python-requests/2.31', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'WhatsApp/2.23', '']) {
    const r = await visit(link.short_code, ua);
    assert.equal(r.status, 302, `bot ua ${ua}`);
  }
  assert.equal((await visit(link.short_code, PHONE)).status, 302);       // first human takes the one allowed click
  assert.equal((await visit(link.short_code, PHONE)).status, 410);       // limit reached
  clicks.flush();
  const rows = clickRows(link.id);
  assert.equal(rows.filter((r) => r.is_bot).length, 5);
  assert.equal(rows.filter((r) => !r.is_bot).length, 1);
  const a = await api('GET', `/api/links/${link.id}/analytics`, { token: userToken });
  assert.equal(a.json.totals.clicks, 1);
  assert.equal(a.json.totals.bots_filtered, 5);
});

test('PROOF 3: an admin takedown stops redirects at once and keeps the history', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/takedown' });
  assert.equal((await visit(link.short_code)).status, 302);              // warms the cache
  assert.equal((await visit(link.short_code, PHONE)).status, 302);
  clicks.flush();
  const off = await api('POST', `/api/admin/links/${link.id}/disable`, { token: adminToken, body: { reason: 'Reported as abusive' } });
  assert.equal(off.status, 200);
  const blocked = await visit(link.short_code);
  assert.equal(blocked.status, 410);                                     // very next request, no waiting for the cache
  const a = await api('GET', `/api/links/${link.id}/analytics`, { token: userToken });
  assert.equal(a.json.totals.clicks, 2);                                 // history kept
  assert.equal(a.json.link.effective_status, 'disabled');
  const normal = await api('POST', `/api/admin/links/${link.id}/disable`, { token: userToken, body: {} });
  assert.equal(normal.status, 403);                                      // ordinary users cannot do this
  await api('POST', `/api/admin/links/${link.id}/enable`, { token: adminToken });
  assert.equal((await visit(link.short_code)).status, 302);
});

test('PROOF 4: the redirect is sent before the click is written', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/fast' });
  clicks.flush();
  const before = clickRows(link.id).length;
  const res = await visit(link.short_code);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('server-timing') || '', /decide;dur=/);
  assert.equal(clickRows(link.id).length, before, 'click must not be in the database yet');
  assert.ok(clicks.pending() >= 1, 'click should be waiting in the queue');
  assert.equal(clicks.flush() >= 1, true);
  assert.equal(clickRows(link.id).length, before + 1);
});

// ---------------------------------------------------------------- creation and validation
test('wizard validation: bad URLs, schemes, reserved and duplicate aliases, blocklist, self-links', async () => {
  const bad = async (body, field) => {
    const r = await api('POST', '/api/links', { token: userToken, body });
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.ok(r.json.errors[field], `expected error on ${field}: ${r.text}`);
  };
  await bad({ destination_url: 'not a url' }, 'destination_url');
  await bad({ destination_url: 'javascript:alert(1)' }, 'destination_url');
  await bad({ destination_url: 'ftp://example.com/file' }, 'destination_url');
  await bad({ destination_url: 'https://user:pw@example.com/' }, 'destination_url');
  await bad({ destination_url: 'https://intranet/' }, 'destination_url');
  await bad({ destination_url: 'https://example.com', alias: 'ab' }, 'alias');
  await bad({ destination_url: 'https://example.com', alias: 'has space' }, 'alias');
  await bad({ destination_url: 'https://example.com', alias: 'admin' }, 'alias');
  await bad({ destination_url: 'https://example.com', click_limit: 0 }, 'click_limit');
  await bad({ destination_url: 'https://example.com', expires_at: '2001-01-01' }, 'expires_at');
  await bad({ destination_url: 'https://example.com', password: 'abc' }, 'password');
  await bad({ destination_url: `${base}/something` }, 'destination_url');

  await makeLink(userToken, { destination_url: 'https://example.com/a', alias: 'My-Alias' });
  await bad({ destination_url: 'https://example.com/b', alias: 'my-alias' }, 'alias');          // case-insensitive duplicate
  await bad({ destination_url: 'https://example.com/b', alias: 'MY-ALIAS' }, 'alias');

  const blocked = await api('POST', '/api/admin/blocklist', { token: adminToken, body: { domain: 'https://www.Evil-Site.test/path' } });
  assert.equal(blocked.status, 201);
  assert.equal(blocked.json.domain, 'evil-site.test');
  await bad({ destination_url: 'https://evil-site.test/x' }, 'destination_url');
  await bad({ destination_url: 'https://cdn.evil-site.test/x' }, 'destination_url');           // subdomains too
});

test('warnings are returned before publishing', async () => {
  await makeLink(userToken, { destination_url: 'https://example.com/warn' });
  const soon = new Date(Date.now() + 20 * 60_000).toISOString();
  const r = await api('POST', '/api/links/validate', { token: userToken, body: { destination_url: 'http://example.com/warn', expires_at: soon, click_limit: 2 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const text = r.json.warnings.join(' | ');
  assert.match(text, /http, not https/);
  assert.match(text, /less than an hour/);
  assert.match(text, /after 2 clicks/);
  const dup = await api('POST', '/api/links/validate', { token: userToken, body: { destination_url: 'https://example.com/warn' } });
  assert.match(dup.json.warnings.join(' '), /already have a short link/);
});

test('auto-generated codes are unique, 7 characters, base62', async () => {
  const codes = new Set();
  for (let i = 0; i < 15; i++) codes.add((await makeLink(userToken, { destination_url: `https://example.com/auto/${i}` })).short_code);
  assert.equal(codes.size, 15);
  for (const c of codes) assert.match(c, /^[0-9A-Za-z]{7}$/);
});

// ---------------------------------------------------------------- redirect rules
test('expired links stop redirecting but keep their analytics', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/exp', expires_at: new Date(Date.now() + 3600_000 * 5).toISOString() });
  assert.equal((await visit(link.short_code)).status, 302);
  clicks.flush();
  db.prepare('UPDATE links SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), link.id);
  cache.clear();
  const r = await visit(link.short_code);
  assert.equal(r.status, 410);
  const a = await api('GET', `/api/links/${link.id}/analytics`, { token: userToken });
  assert.equal(a.json.totals.clicks, 1);
  assert.equal(a.json.link.effective_status, 'expired');
});

test('password-protected links ask first, reject wrong passwords, then redirect', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/secret', password: 'open-sesame' });
  const form = await visit(link.short_code);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /type="password"/);
  const post = (pw) => fetch(`${base}/unlock/${link.short_code}`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER }, body: `password=${encodeURIComponent(pw)}`,
  });
  assert.equal((await post('wrong')).status, 401);
  const ok = await post('open-sesame');
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), 'https://example.com/secret');
  clicks.flush();
  assert.equal(db.prepare('SELECT click_count FROM links WHERE id = ?').get(link.id).click_count, 1);   // the form view and wrong guess did not count
  for (let i = 0; i < 10; i++) await post('guess');
  assert.equal((await post('open-sesame')).status, 429);                                              // guessing is rate limited
});

test('unknown codes show a not-found page', async () => {
  const r = await visit('nope1234');
  assert.equal(r.status, 404);
  assert.match(await r.text(), /Link not found/);
});

// ---------------------------------------------------------------- tracking details
test('click details, QR marker, unique visitors and referrers are recorded', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/track' });
  await fetch(`${base}/${link.short_code}`, { redirect: 'manual', headers: { 'User-Agent': PHONE, Referer: 'https://www.instagram.com/some/post' } });
  await fetch(`${base}/${link.short_code}`, { redirect: 'manual', headers: { 'User-Agent': PHONE } });          // same visitor again
  await fetch(`${base}/${link.short_code}?src=qr`, { redirect: 'manual', headers: { 'User-Agent': BROWSER, 'x-vercel-ip-country': 'IN' } });
  clicks.flush();
  const rows = clickRows(link.id);
  assert.equal(rows.length, 3);
  const mobile = rows.find((r) => r.device === 'mobile');
  assert.equal(mobile.browser, 'Safari');
  assert.equal(mobile.os, 'iOS');
  assert.ok(!JSON.stringify(rows).includes('127.0.0.1'), 'raw IP addresses are never stored');
  const a = await api('GET', `/api/links/${link.id}/analytics`, { token: userToken });
  assert.equal(a.json.totals.clicks, 3);
  assert.equal(a.json.totals.visitors, 2);
  assert.equal(a.json.totals.qr_scans, 1);
  assert.ok(a.json.referrers.some((r) => r.label === 'www.instagram.com'));
  assert.ok(a.json.countries.some((r) => r.label === 'IN'));
  assert.equal(a.json.series.length, 30);
  assert.equal(a.json.series.at(-1).clicks, 3);
});

// ---------------------------------------------------------------- QR, CSV
test('QR codes are served as SVG and PNG and point at the short URL', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/qr', alias: 'qr-test' });
  const svg = await api('GET', `/api/links/${link.id}/qr.svg`, { token: userToken });
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(svg.text, /<svg/);
  const png = await fetch(`${base}/api/links/${link.id}/qr.png`, { headers: { Authorization: `Bearer ${userToken}` } });
  const buf = Buffer.from(await png.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(path.join(tmp, 'qr-test.png'), buf);
  const other = await api('GET', `/api/links/${link.id}/qr.svg`, { token: otherToken });
  assert.equal(other.status, 404);
});

test('CSV import: preview finds errors and duplicates, import creates only the valid rows', async () => {
  await makeLink(userToken, { destination_url: 'https://example.com/already' });
  const csv = [
    'destination_url,alias,campaign,tags,expires_at,click_limit',
    'https://example.com/one,csv-one,Fest,"poster, qr",,',
    'https://example.com/two,,Fest,,2099-01-01,50',
    'not-a-url,csv-bad,,,,',
    'https://example.com/three,csv-one,,,,',            // alias repeated in file
    'https://example.com/one,,,,,',                      // duplicate destination in file
    'https://example.com/already,,,,,',                  // duplicate of an existing link
    'https://example.com/five,admin,,,,',                // reserved alias
    'https://example.com/six,,,,,abc',                   // bad click limit
    '"https://example.com/seven?a=1,2",csv-seven,,,,',   // comma inside quotes
  ].join('\r\n');
  const dry = await api('POST', '/api/links/import?dryRun=1', { token: userToken, body: csv, raw: 'text/csv' });
  assert.equal(dry.status, 200, dry.text);
  assert.deepEqual(dry.json.summary, { total: 9, valid: 3, duplicates: 2, errors: 4 });
  const status = (n) => dry.json.rows.find((r) => r.row === n).status;
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8, 9, 10].map(status), ['valid', 'valid', 'error', 'error', 'duplicate', 'duplicate', 'error', 'error', 'valid']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM links WHERE short_code = 'csv-one'").get().n, 0, 'preview writes nothing');

  const real = await api('POST', '/api/links/import', { token: userToken, body: csv, raw: 'text/csv' });
  assert.equal(real.json.imported, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM links WHERE short_code IN ('csv-one','csv-seven')").get().n, 2);
  const camps = await api('GET', '/api/campaigns', { token: userToken });
  assert.ok(camps.json.campaigns.some((c) => c.name === 'Fest' && c.links === 2));
  const tags = await api('GET', '/api/tags', { token: userToken });
  assert.deepEqual(tags.json.tags.map((t) => t.name).filter((n) => ['poster', 'qr'].includes(n)).sort(), ['poster', 'qr']);

  const empty = await api('POST', '/api/links/import?dryRun=1', { token: userToken, body: 'url\n', raw: 'text/csv' });
  assert.equal(empty.status, 422);
  const nocol = await api('POST', '/api/links/import?dryRun=1', { token: userToken, body: 'foo,bar\n1,2', raw: 'text/csv' });
  assert.equal(nocol.status, 422);
});

// ---------------------------------------------------------------- access, limits, dashboard
test('roles: anonymous, user and admin see exactly what they should', async () => {
  const mine = await makeLink(userToken, { destination_url: 'https://example.com/private' });
  assert.equal((await api('GET', '/api/links')).status, 401);
  assert.equal((await api('GET', `/api/links/${mine.id}`, { token: otherToken })).status, 404);
  assert.equal((await api('PATCH', `/api/links/${mine.id}`, { token: otherToken, body: { title: 'hijack' } })).status, 404);
  assert.equal((await api('GET', `/api/links/${mine.id}/analytics`, { token: otherToken })).status, 404);
  assert.equal((await api('GET', '/api/admin/users', { token: userToken })).status, 403);
  assert.equal((await api('GET', '/api/admin/blocklist')).status, 401);
  const list = await api('GET', '/api/links?scope=all', { token: otherToken });          // a normal user cannot widen scope
  assert.ok(list.json.links.every((l) => l.owner_email === 'bob@example.test'));
  const adminList = await api('GET', '/api/admin/links', { token: adminToken });
  assert.ok(adminList.json.links.some((l) => l.id === mine.id));
  assert.equal((await api('GET', `/api/links/${mine.id}`, { token: adminToken })).status, 200);
  const forged = `${userToken.split('.')[0]}.${Buffer.from(JSON.stringify({ sub: 1, role: 'admin', exp: 9999999999 })).toString('base64url')}.${userToken.split('.')[2]}`;
  assert.equal((await api('GET', '/api/admin/users', { token: forged })).status, 401);   // a tampered token is rejected
  const adminReg = await api('POST', '/api/auth/register', { body: { email: 'evil@example.test', name: 'Evil', password: 'password123', role: 'admin' } });
  assert.equal(adminReg.json.user.role, 'user');                                          // nobody can sign up as admin
});

test('creating links is rate limited', async () => {
  let limited = null;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await api('POST', '/api/links', { token: otherToken, body: { destination_url: `https://example.com/rl/${i}` } });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'expected a 429 within 25 creations');
  assert.ok(limited.headers.get('retry-after'));
});

test('editing a link takes effect immediately (cache is invalidated)', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/old', alias: 'edit-me' });
  assert.equal((await visit('edit-me')).headers.get('location'), 'https://example.com/old');
  const r = await api('PATCH', `/api/links/${link.id}`, { token: userToken, body: { destination_url: 'https://example.com/new' } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await visit('edit-me')).headers.get('location'), 'https://example.com/new');
  await api('PATCH', `/api/links/${link.id}`, { token: userToken, body: { status: 'disabled' } });
  assert.equal((await visit('edit-me')).status, 410);
  const pw = await api('PATCH', `/api/links/${link.id}`, { token: userToken, body: { status: 'active', password: 'hunter22' } });
  assert.equal(pw.json.link.has_password, true);
  const rm = await api('PATCH', `/api/links/${link.id}`, { token: userToken, body: { password: null } });
  assert.equal(rm.json.link.has_password, false);
});

test('dashboard summary: totals, campaigns, top links and alerts use live data', async () => {
  const camp = await api('POST', '/api/campaigns', { token: userToken, body: { name: 'Dash Test' } });
  assert.equal(camp.status, 201);
  const l1 = await makeLink(userToken, { destination_url: 'https://example.com/d1', campaign_id: camp.json.campaign.id, expires_at: new Date(Date.now() + 2 * 86400_000).toISOString() });
  const l2 = await makeLink(userToken, { destination_url: 'https://example.com/d2', campaign_id: camp.json.campaign.id, click_limit: 5 });
  for (let i = 0; i < 4; i++) await visit(l1.short_code, `${BROWSER} d${i}`);
  for (let i = 0; i < 5; i++) await visit(l2.short_code, `${BROWSER} e${i}`);
  await visit(l2.short_code, 'curl/8');
  const s = await api('GET', `/api/analytics/summary?days=30&campaign=${camp.json.campaign.id}`, { token: userToken });
  assert.equal(s.status, 200);
  assert.equal(s.json.totals.clicks, 9);
  assert.equal(s.json.links.total, 2);
  assert.equal(s.json.links.limit_reached, 1);
  const c = s.json.campaigns.find((x) => x.name === 'Dash Test');
  assert.equal(c.links, 2);
  assert.equal(c.clicks, 9);
  assert.equal(c.top_link, l2.short_code);
  assert.equal(s.json.top_links[0].short_code, l2.short_code);
  assert.ok(s.json.alerts.some((a) => a.type === 'expiring' && a.short_code === l1.short_code));
  assert.ok(s.json.alerts.some((a) => a.type === 'limit_reached' && a.short_code === l2.short_code));
  const perf = await api('GET', '/api/admin/perf', { token: adminToken });
  assert.ok(perf.json.redirect_decide_ms.samples > 0);
});

test('reports from visitors reach the admin', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://example.com/report' });
  assert.equal((await api('POST', '/api/report', { body: { code: link.short_code, reason: 'Looks like phishing' } })).status, 201);
  assert.equal((await api('POST', '/api/report', { body: { code: link.short_code, reason: '' } })).status, 422);
  const list = await api('GET', '/api/admin/reports', { token: adminToken });
  assert.ok(list.json.reports.some((r) => r.short_code === link.short_code && r.reason === 'Looks like phishing'));
});

test('blocking a domain can disable links that already point at it', async () => {
  const link = await makeLink(userToken, { destination_url: 'https://later-bad.test/page', alias: 'later-bad' });
  assert.equal((await visit('later-bad')).status, 302);
  const r = await api('POST', '/api/admin/blocklist', { token: adminToken, body: { domain: 'later-bad.test', disable_existing: true } });
  assert.equal(r.json.disabled_links, 1);
  assert.equal((await visit('later-bad')).status, 410);
  assert.equal(db.prepare('SELECT status FROM links WHERE id = ?').get(link.id).status, 'disabled');
});

test('static app and security basics', async () => {
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-security-policy') || '', /default-src 'self'/);
  const traversal = await fetch(`${base}/..%2Fserver%2Fconfig.js`);
  assert.notEqual(traversal.status, 200);
});
