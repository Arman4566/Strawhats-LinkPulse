'use strict';
/**
 * "Smart" features. Everything here works offline with local rules and statistics, so the demo never depends on
 * an outside service. If GEMINI_API_KEY is set, the written summary can also
 * use Google Gemini; if that call fails or is slow, the local answer is used instead.
 */
const { RESERVED_ALIASES, ALIAS_RE } = require('./validate');
const { localDaySql, localPartSql } = require('./db');

// ------------------------------------------------------------------ link safety scan
const BRANDS = {
  paypal: 'paypal.com', google: 'google.com', amazon: 'amazon.com', microsoft: 'microsoft.com', apple: 'apple.com', facebook: 'facebook.com',
  instagram: 'instagram.com', netflix: 'netflix.com', whatsapp: 'whatsapp.com', paytm: 'paytm.com', phonepe: 'phonepe.com', hdfcbank: 'hdfcbank.com',
  icicibank: 'icicibank.com', sbi: 'sbi.co.in', linkedin: 'linkedin.com', github: 'github.com',
};
const BAD_TLDS = new Set(['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'click', 'country', 'work', 'support', 'rest', 'icu', 'buzz']);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'cutt.ly', 'rb.gy', 'shorturl.at']);
const WORDS = ['login', 'signin', 'verify', 'secure', 'update', 'account', 'wallet', 'prize', 'winner', 'free', 'otp', 'kyc', 'password', 'bonus', 'claim', 'giveaway', 'recover', 'suspend'];
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

function registered(host) {
  const p = host.split('.');
  if (p.length <= 2) return host;
  return (p.length >= 3 && SECOND_LEVEL.has(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3) : p.slice(-2)).join('.');
}
const deLeet = (s) => s.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/\$/g, 's');

function scanUrl(raw) {
  const reasons = [];
  let score = 0;
  const add = (pts, why) => { score += pts; reasons.push({ points: pts, text: why }); };
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { score: 0, level: 'unknown', reasons: [{ points: 0, text: 'Not a valid address yet' }] }; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const reg = registered(host);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) add(35, 'Uses a raw IP address instead of a domain name');
  if (host.includes('xn--')) add(25, 'Domain uses look-alike (punycode) characters');
  if (u.username || u.password) add(30, 'Address contains a hidden "user@" part that can disguise the real site');
  if (host.split('.').length >= 5) add(10, 'Unusually many sub-domains');
  if ((host.match(/-/g) || []).length >= 3) add(10, 'Domain has many hyphens');
  const tld = host.split('.').pop();
  if (BAD_TLDS.has(tld)) add(15, `".${tld}" is a domain ending often used for throw-away sites`);
  if (SHORTENERS.has(reg)) add(15, 'Destination is another link shortener, which hides where it really goes');
  if (u.protocol === 'http:') add(10, 'Not encrypted (http)');
  if (u.port && !['80', '443'].includes(u.port)) add(10, `Unusual port ${u.port}`);
  if (String(raw).length > 200) add(8, 'Very long address');
  const flat = deLeet(host.replace(/[-.]/g, ''));
  for (const [brand, official] of Object.entries(BRANDS)) {
    if (flat.includes(brand) && reg !== official && !host.endsWith('.' + official)) { add(40, `Looks like ${official} but is not ${official}`); break; }
  }
  const hay = `${host}${u.pathname}`.toLowerCase();
  const hits = WORDS.filter((w) => hay.includes(w));
  if (hits.length) add(Math.min(24, hits.length * 8), `Pressure words in the address: ${hits.slice(0, 3).join(', ')}`);
  score = Math.min(100, score);
  const level = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  if (!reasons.length) reasons.push({ points: 0, text: 'No warning signs found in the address' });
  return { score, level, reasons, host };
}

// ------------------------------------------------------------------ alias suggestions
const STOP = new Set(['www', 'com', 'org', 'net', 'the', 'and', 'for', 'with', 'http', 'https', 'html', 'index', 'page', 'form', 'in', 'co', 'of', 'to', 'a']);
function words(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));
}
async function suggestAliases(db, { destination_url, title }) {
  const cand = [];
  const push = (s) => { s = s.replace(/^-+|-+$/g, '').slice(0, 24); if (s && !cand.includes(s)) cand.push(s); };
  const tw = words(title).slice(0, 4);
  let host = ''; let pw = [];
  try { const u = new URL(destination_url); host = u.hostname.replace(/^www\./, ''); pw = words(u.pathname).slice(-3); } catch { /* ignore */ }
  const hw = words(host.split('.').slice(0, -1).join(' '));
  if (tw.length) { push(tw.slice(0, 2).join('-')); push(tw.slice(0, 3).join('-')); push(tw.map((w) => w[0]).join('') + '-' + tw[0]); }
  if (pw.length) { push(pw.slice(-2).join('-')); push(pw[pw.length - 1]); }
  if (hw.length && pw.length) push(`${hw[0]}-${pw[pw.length - 1]}`);
  if (hw.length) push(hw.join('-') + (tw[0] ? '-' + tw[0] : ''));
  const year = String(new Date().getFullYear()).slice(2);
  if (tw.length) push(`${tw[0]}${year}`);
  if (pw.length) push(`${pw[pw.length - 1]}-${year}`);
  const free = [];
  // one query for every code we might want to check (case-insensitive: short_code is citext)
  const wanted = [];
  for (const c of cand) { wanted.push(c); for (let n = 2; n < 6; n++) wanted.push(`${c}-${n}`); }
  const used = new Set((await db.all('SELECT short_code FROM links WHERE short_code = ANY(?::citext[])', [wanted])).map((r) => String(r.short_code).toLowerCase()));
  const taken = (code) => used.has(code.toLowerCase());
  for (const c of cand) {
    if (c.length < 3 || !ALIAS_RE.test(c) || RESERVED_ALIASES.has(c)) continue;
    if (taken(c)) { for (let n = 2; n < 6; n++) if (!taken(`${c}-${n}`)) { free.push(`${c}-${n}`); break; } continue; }
    free.push(c);
  }
  return [...new Set(free)].slice(0, 5);
}

// ------------------------------------------------------------------ insights (statistics, written in plain words)
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? ' am' : ' pm'}`;
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

async function insightsFor(db, scopeSql, scopeParams, { days = 30, tz = 0 } = {}) {
  tz = Math.max(-840, Math.min(840, Math.trunc(Number(tz)) || 0));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const base = `FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${scopeSql} AND c.clicked_at >= ?`;
  const bp = [...scopeParams, since];
  const out = [];
  const total = (await db.get(`SELECT COUNT(*) n ${base} AND c.is_bot = 0`, bp)).n;
  const bots = (await db.get(`SELECT COUNT(*) n ${base} AND c.is_bot = 1`, bp)).n;
  if (!total) return [{ kind: 'info', icon: 'spark', title: 'Waiting for the first visits', text: 'Share a link or print its QR code. Insights appear as soon as people start clicking.' }];

  // trend: last 7 days against the 7 before
  const w1 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const w2 = new Date(Date.now() - 14 * 86400_000).toISOString();
  const cur = (await db.get(`SELECT COUNT(*) n FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${scopeSql} AND c.is_bot = 0 AND c.clicked_at >= ?`, [...scopeParams, w1])).n;
  const prev = (await db.get(`SELECT COUNT(*) n FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${scopeSql} AND c.is_bot = 0 AND c.clicked_at >= ? AND c.clicked_at < ?`, [...scopeParams, w2, w1])).n;
  if (prev >= 5) {
    const ch = Math.round(((cur - prev) / prev) * 100);
    if (Math.abs(ch) >= 10) out.push({ kind: ch > 0 ? 'good' : 'warn', icon: ch > 0 ? 'up' : 'down', title: `Traffic is ${ch > 0 ? 'up' : 'down'} ${Math.abs(ch)}%`, text: `${cur} clicks in the last 7 days, against ${prev} in the 7 days before.` });
    else out.push({ kind: 'info', icon: 'flat', title: 'Traffic is steady', text: `${cur} clicks this week, about the same as last week (${prev}).` });
  }

  // best time to share
  const hours = await db.all(`SELECT ${localPartSql('HOUR', 'c.clicked_at')} AS h, COUNT(*) AS n ${base} AND c.is_bot = 0 GROUP BY h ORDER BY n DESC, h`, [tz, ...bp]);
  const dows = await db.all(`SELECT ${localPartSql('DOW', 'c.clicked_at')} AS d, COUNT(*) AS n ${base} AND c.is_bot = 0 GROUP BY d ORDER BY n DESC, d`, [tz, ...bp]);
  if (hours.length && total >= 30) {
    const top = hours.slice(0, 3).map((x) => x.h).sort((a, b) => a - b);
    out.push({ kind: 'tip', icon: 'clock', title: `Best time to share: ${DAYS[dows[0].d]}s around ${hourLabel(hours[0].h)}`, text: `Most clicks arrive around ${top.map(hourLabel).join(', ')}. ${DAYS[dows[0].d]} is your busiest day (${pctOf(dows[0].n, total)}% of clicks).` });
  }

  // QR vs direct and device mix
  const mix = await db.get(`SELECT SUM((c.source = 'qr')::int) AS qr, SUM((c.device = 'mobile')::int) AS mob ${base} AND c.is_bot = 0`, bp);
  if (mix.qr / total >= 0.25) out.push({ kind: 'info', icon: 'qr', title: `${pctOf(mix.qr, total)}% of visits come from QR codes`, text: 'Printed codes are working. Keep the destination page quick on a phone and check that every code is still readable.' });
  if (mix.mob / total >= 0.6) out.push({ kind: 'tip', icon: 'phone', title: `${pctOf(mix.mob, total)}% of visitors are on phones`, text: 'Make sure destination pages load fast on mobile data and are easy to use with one thumb.' });

  // where visitors come from
  const refs = await db.all(`SELECT c.referrer AS r, COUNT(*) AS n ${base} AND c.is_bot = 0 GROUP BY c.referrer ORDER BY n DESC, r`, bp);
  const direct = refs.find((x) => x.r === '');
  const named = refs.filter((x) => x.r);
  if (named.length) out.push({ kind: 'info', icon: 'globe', title: `${named[0].r} sends the most referred traffic`, text: `${named[0].n} clicks (${pctOf(named[0].n, total)}%).${direct && direct.n / total > 0.4 ? ` ${pctOf(direct.n, total)}% have no referrer, which usually means messaging apps, email or QR codes.` : ''}` });

  // best / worst link
  const links = await db.all(`SELECT l.short_code::text AS code, COUNT(*) AS n ${base} AND c.is_bot = 0 GROUP BY l.id ORDER BY n DESC, l.id`, bp);
  if (links.length >= 3) out.push({ kind: 'good', icon: 'trophy', title: `/${links[0].code} is your top link`, text: `${links[0].n} clicks, ${pctOf(links[0].n, total)}% of everything. The weakest active link with traffic is /${links[links.length - 1].code} (${links[links.length - 1].n}).` });

  // bots
  if (bots && bots / (bots + total) > 0.08) out.push({ kind: 'info', icon: 'shield', title: `${bots} bot visits were filtered out`, text: `${pctOf(bots, bots + total)}% of raw hits came from crawlers and link previews. They are not counted in any number you see.` });

  // links needing action
  const soon = (await db.get(`SELECT COUNT(*) n FROM links l WHERE ${scopeSql} AND l.status = 'active' AND l.expires_at IS NOT NULL AND l.expires_at > ? AND l.expires_at <= ?`, [...scopeParams, new Date().toISOString(), new Date(Date.now() + 7 * 86400_000).toISOString()])).n;
  if (soon) out.push({ kind: 'warn', icon: 'hourglass', title: `${soon} link${soon === 1 ? '' : 's'} will expire within a week`, text: 'Extend them now if the campaign is still running.' });
  return out;
}

// ------------------------------------------------------------------ ask your data (plain-English questions)
const BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'opera', 'samsung'];
const OSES = { android: 'Android', ios: 'iOS', iphone: 'iOS', windows: 'Windows', mac: 'macOS', macos: 'macOS', linux: 'Linux' };

function parseQuestion(q, ctx) {
  const t = ` ${String(q).toLowerCase().replace(/[?.,!]/g, ' ')} `;
  const has = (...w) => w.some((x) => t.includes(` ${x} `) || t.includes(x + ' ') && x.length > 4);
  const p = { metric: 'clicks', filters: [], group: null, days: 30, label: 'last 30 days', notes: [] };
  if (/ (unique|visitors|people|users|audience) /.test(t)) p.metric = 'visitors';
  if (/ (qr|scan|scans|scanned) /.test(t)) { p.filters.push(['c.source = ?', 'qr', 'from QR scans']); if (p.metric === 'clicks') p.metric = 'clicks'; }
  if (/ bots? | crawlers? /.test(t)) p.metric = 'bots';

  let m;
  if (/ today /.test(t)) { p.days = 1; p.label = 'today'; }
  else if (/ yesterday /.test(t)) { p.range = 'yesterday'; p.label = 'yesterday'; }
  else if ((m = t.match(/ (?:last|past) (\d{1,3}) days? /))) { p.days = Math.min(365, +m[1]); p.label = `last ${p.days} days`; }
  else if (/ (this|last|past) week /.test(t)) { p.days = 7; p.label = 'last 7 days'; }
  else if (/ (this|last|past) month /.test(t)) { p.days = 30; p.label = 'last 30 days'; }
  else if (/ (this|last|past) year /.test(t)) { p.days = 365; p.label = 'last year'; }

  if (/ (mobile|phone|phones|android|iphone) /.test(t) && !/ desktop /.test(t)) p.filters.push(['c.device = ?', 'mobile', 'on mobile']);
  if (/ (desktop|laptop|computer|pc) /.test(t)) p.filters.push(['c.device = ?', 'desktop', 'on desktop']);
  for (const b of BROWSERS) if (t.includes(` ${b} `)) p.filters.push(['LOWER(c.browser) = LOWER(?)', b, `in ${b[0].toUpperCase() + b.slice(1)}`]);
  for (const [k, v] of Object.entries(OSES)) if (t.includes(` ${k} `)) { p.filters.push(['c.os = ?', v, `on ${v}`]); break; }
  for (const c of ctx.countries) if (t.includes(` ${c.toLowerCase()} `)) { p.filters.push(['LOWER(c.country) = LOWER(?)', c, `from ${c}`]); break; }
  for (const r of ctx.referrers) if (r && t.includes(r.toLowerCase().replace(/\.com$/, ''))) { p.filters.push(['c.referrer = ?', r, `referred by ${r}`]); break; }
  for (const cp of ctx.campaigns) if (t.includes(cp.name.toLowerCase()) || t.includes(cp.name.toLowerCase().replace(/[\s\d]+$/, '').trim())) { p.filters.push(['l.campaign_id = ?', cp.id, `in campaign "${cp.name}"`]); break; }
  const code = ctx.codes.find((c) => t.includes(` /${c.toLowerCase()} `) || t.includes(` ${c.toLowerCase()} `));
  if (code) p.filters.push(['l.short_code = ?', code, `for /${code}`]);

  if (/ (by|per) (day|date) | daily | each day | trend | over time /.test(t)) p.group = 'day';
  else if (/ (top|best|most|which) .*(link|links) | links? (by|ranking) /.test(t) || / top links? /.test(t)) p.group = 'link';
  else if (/ (by|per) (country|countries) | which countr/.test(t)) p.group = 'country';
  else if (/ (by|per) device | which device /.test(t)) p.group = 'device';
  else if (/ (by|per) browser | which browser /.test(t)) p.group = 'browser';
  else if (/ (by|per) (referrer|source) | where .*(from|come) | which (referrer|source) /.test(t)) p.group = 'referrer';
  else if (/ (by|per) campaign | which campaign /.test(t)) p.group = 'campaign';
  else if (/ (by|per) hour | what time | which hour | peak /.test(t)) p.group = 'hour';
  else if (/ (by|per) (weekday|day of week) | which day /.test(t)) p.group = 'weekday';
  p.understood = p.filters.length > 0 || p.group !== null || / (click|clicks|visit|visits|visitor|visitors|traffic|scan|scans|views|hits|bots?) /.test(t) || p.range || p.days !== 30;
  return p;
}

async function buildContext(db, user) {
  const [countries, referrers, campaigns, codes] = await Promise.all([
    db.all('SELECT DISTINCT c.country FROM clicks c JOIN links l ON l.id = c.link_id WHERE l.owner_id = ? AND c.country != ?', [user.id, 'Unknown']),
    db.all("SELECT DISTINCT c.referrer FROM clicks c JOIN links l ON l.id = c.link_id WHERE l.owner_id = ? AND c.referrer != ''", [user.id]),
    db.all('SELECT id, name FROM campaigns WHERE owner_id = ?', [user.id]),
    db.all('SELECT short_code::text AS short_code FROM links WHERE owner_id = ?', [user.id]),
  ]);
  return { countries: countries.map((r) => r.country), referrers: referrers.map((r) => r.referrer), campaigns, codes: codes.map((r) => r.short_code) };
}

// ---- Gemini turns a free-form question into a small JSON filter. It never writes SQL: every value is checked
// ---- against what exists in this user's data, then run through the same safe query builder as the local parser.
const GROUPS = ['day', 'link', 'country', 'device', 'browser', 'referrer', 'campaign', 'hour', 'weekday'];
async function geminiParse(question, ctx) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || 'gemini-2.5-flash';
  const prompt = `Turn the question into a JSON filter for a link-click analytics database. Reply with JSON only.
Fields (all optional, omit what the question does not mention):
metric: "clicks" | "visitors" | "bots"
days: integer 1-365 (time window ending now), or range: "today" | "yesterday"
device: "mobile" | "desktop"
browser: one of ${JSON.stringify(BROWSERS)}
os: one of ${JSON.stringify(Object.values(OSES).filter((v, i, a) => a.indexOf(v) === i))}
country: one of ${JSON.stringify(ctx.countries)}
referrer: one of ${JSON.stringify(ctx.referrers)}
campaign: one of ${JSON.stringify(ctx.campaigns.map((c) => c.name))}
link: one of ${JSON.stringify(ctx.codes.slice(0, 200))}
qr: true if only QR-code scans are meant
group: one of ${JSON.stringify(GROUPS)} (use when the question asks "by", "which", "top", "when", "trend")
Question: ${JSON.stringify(question)}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = ((data.candidates?.[0]?.content?.parts) || []).map((x) => x.text || '').join('');
    return JSON.parse(text);
  } catch { return null; }
}

function paramsFromJson(j, ctx) {
  if (!j || typeof j !== 'object') return null;
  const p = { metric: 'clicks', filters: [], group: null, days: 30, label: 'last 30 days', understood: true };
  if (['clicks', 'visitors', 'bots'].includes(j.metric)) p.metric = j.metric;
  if (j.range === 'today') { p.days = 1; p.label = 'today'; } else if (j.range === 'yesterday') { p.range = 'yesterday'; p.label = 'yesterday'; }
  else if (Number.isInteger(j.days) && j.days >= 1 && j.days <= 365) { p.days = j.days; p.label = `last ${j.days} days`; }
  if (j.device === 'mobile' || j.device === 'desktop') p.filters.push(['c.device = ?', j.device, `on ${j.device}`]);
  if (BROWSERS.includes(String(j.browser).toLowerCase())) p.filters.push(['LOWER(c.browser) = LOWER(?)', String(j.browser).toLowerCase(), `in ${j.browser}`]);
  if (Object.values(OSES).includes(j.os)) p.filters.push(['c.os = ?', j.os, `on ${j.os}`]);
  if (ctx.countries.includes(j.country)) p.filters.push(['c.country = ?', j.country, `from ${j.country}`]);
  if (ctx.referrers.includes(j.referrer)) p.filters.push(['c.referrer = ?', j.referrer, `referred by ${j.referrer}`]);
  const cp = ctx.campaigns.find((c) => c.name === j.campaign);
  if (cp) p.filters.push(['l.campaign_id = ?', cp.id, `in campaign "${cp.name}"`]);
  if (ctx.codes.includes(j.link)) p.filters.push(['l.short_code = ?', j.link, `for /${j.link}`]);
  if (j.qr === true) p.filters.push(['c.source = ?', 'qr', 'from QR scans']);
  if (GROUPS.includes(j.group)) p.group = j.group;
  return p;
}

async function runQuestion(db, user, question, tz = 0) {
  tz = Math.max(-840, Math.min(840, Math.trunc(Number(tz)) || 0));
  const ctx = await buildContext(db, user);
  let p = parseQuestion(question, ctx);
  let by = 'rules';
  if (!p.understood) {
    const g = paramsFromJson(await geminiParse(question, ctx), ctx);
    if (g && (g.filters.length || g.group || g.label !== 'last 30 days')) { p = g; by = 'gemini'; }
  }
  if (!p.understood) return { understood: false, answer: 'I could not work out what to look up. Try something like "clicks from mobile last week", "top links this month" or "which country visits Tech Fest most".' };

  let from; let to = new Date(Date.now() + 60_000).toISOString();
  if (p.range === 'yesterday') { const d = new Date(Date.now() + tz * 60000); d.setUTCHours(0, 0, 0, 0); to = new Date(d.getTime() - tz * 60000).toISOString(); from = new Date(d.getTime() - tz * 60000 - 86400_000).toISOString(); }
  else if (p.label === 'today') { const d = new Date(Date.now() + tz * 60000); d.setUTCHours(0, 0, 0, 0); from = new Date(d.getTime() - tz * 60000).toISOString(); }
  else from = new Date(Date.now() - p.days * 86400_000).toISOString();

  const where = ['l.owner_id = ?', 'c.clicked_at >= ?', 'c.clicked_at < ?', p.metric === 'bots' ? 'c.is_bot = 1' : 'c.is_bot = 0'];
  const params = [user.id, from, to];
  for (const [sql, val] of p.filters) { where.push(sql); params.push(val); }
  const measure = p.metric === 'visitors' ? 'COUNT(DISTINCT c.visitor_hash)' : 'COUNT(*)';
  const noun = p.metric === 'visitors' ? 'unique visitors' : p.metric === 'bots' ? 'bot hits' : 'clicks';
  const scope = [...p.filters.map((f) => f[2]), p.label].join(', ');
  const W = where.join(' AND ');
  const groups = {
    day: [localDaySql('c.clicked_at'), 'day'], link: ["'/' || l.short_code::text", 'link'], country: ['c.country', 'country'], device: ['c.device', 'device'],
    browser: ['c.browser', 'browser'], referrer: ["CASE WHEN c.referrer = '' THEN 'Direct / none' ELSE c.referrer END", 'referrer'],
    campaign: ["COALESCE((SELECT name FROM campaigns WHERE id = l.campaign_id), 'No campaign')", 'campaign'],
    hour: [localPartSql('HOUR', 'c.clicked_at'), 'hour'], weekday: [localPartSql('DOW', 'c.clicked_at'), 'weekday'],
  };
  if (p.group) {
    const [expr] = groups[p.group];
    // day / hour / weekday expressions carry one "?" for the time-zone shift, which comes before the WHERE values
    const tzParam = ['day', 'hour', 'weekday'].includes(p.group) ? [tz] : [];
    let rows = await db.all(`SELECT ${expr} AS label, ${measure} AS value FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${W} GROUP BY label ${p.group === 'day' ? 'ORDER BY label' : p.group === 'hour' || p.group === 'weekday' ? 'ORDER BY label' : 'ORDER BY value DESC, label'} LIMIT ${p.group === 'day' ? 400 : 12}`, [...tzParam, ...params]);
    if (p.group === 'hour') rows = rows.map((r) => ({ label: hourLabel(r.label), value: r.value, _h: r.label }));
    if (p.group === 'weekday') rows = rows.map((r) => ({ label: DAYS[r.label], value: r.value }));
    const sum = (await db.get(`SELECT ${measure} AS n FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${W}`, params)).n;
    const best = rows.slice().sort((a, b) => b.value - a.value)[0];
    const answer = rows.length ? `${sum} ${noun} (${scope}). ${p.group === 'day' ? `Busiest day: ${best.label} with ${best.value}.` : `Top ${p.group}: ${best.label} with ${best.value} (${pctOf(best.value, sum)}%).`}` : `No ${noun} found (${scope}).`;
    return { understood: true, by, answer, interpreted: { metric: noun, filters: p.filters.map((f) => f[2]), period: p.label, group: p.group }, chart: p.group === 'day' ? 'line' : 'bars', rows };
  }
  const n = (await db.get(`SELECT ${measure} AS n FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${W}`, params)).n;
  return { understood: true, by, answer: `${n} ${noun} (${scope}).`, interpreted: { metric: noun, filters: p.filters.map((f) => f[2]), period: p.label, group: null }, number: n, rows: [] };
}

// ------------------------------------------------------------------ optional: Gemini writes the summary
async function llmSummary(insights, totals) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || !insights.length) return null;
  const model = process.env.AI_MODEL || 'gemini-2.5-flash';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `You write the weekly note for a small team that runs short links and QR codes. Using only these facts, write 3 short sentences in plain English: what is going well, what needs attention, and one thing to do next. No hype, no markdown.\n\nTotals: ${JSON.stringify(totals)}\nFacts: ${insights.map((i) => `${i.title}. ${i.text}`).join(' ')}` }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return ((parts || []).map((x) => x.text || '').join('').trim()) || null;
  } catch { return null; }
}

/** One plain-English paragraph built locally, used when no API key is configured. */
function localSummary(insights) {
  const pick = (k) => insights.find((i) => i.kind === k);
  const parts = [];
  const good = pick('good'); const warn = pick('warn'); const tip = pick('tip');
  if (good) parts.push(`${good.title}.`);
  if (warn) parts.push(`${warn.title}.`);
  if (tip) parts.push(`${tip.title}.`);
  return parts.join(' ') || null;
}

module.exports = { scanUrl, suggestAliases, insightsFor, runQuestion, parseQuestion, llmSummary, localSummary };
