'use strict';
const { HttpError } = require('./util');
const { effectiveStatus } = require('./links');
const { localDaySql } = require('./db');

/** Parse ?days= and ?tz= (minutes east of UTC, e.g. 330 for India). Counts are always real visits: bots excluded. */
function range(q) {
  const days = Math.min(365, Math.max(1, parseInt(q.get('days') || '30', 10) || 30));
  let tz = parseInt(q.get('tz') || '0', 10);
  if (!Number.isFinite(tz) || Math.abs(tz) > 14 * 60) tz = 0;
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return { days, tz, since };
}

/** Fill every day in the range so charts show zeros instead of gaps. */
function fillDays(rows, days, tz) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const nowLocal = new Date(Date.now() + tz * 60_000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowLocal.getTime() - i * 86400_000).toISOString().slice(0, 10);
    const r = map.get(d);
    out.push({ day: d, clicks: r ? r.clicks : 0, visitors: r ? r.visitors : 0 });
  }
  return out;
}

function breakdown(db, where, params, column, limit = 8) {
  return db.all(`
    SELECT ${column} AS label, COUNT(*) AS clicks FROM clicks c
    WHERE ${where} AND c.is_bot = 0 GROUP BY ${column} ORDER BY clicks DESC, label LIMIT ${limit}`, params);
}

/** Analytics for one link. */
async function linkAnalytics(db, linkId, q) {
  const { days, tz, since } = range(q);
  const where = 'c.link_id = ? AND c.clicked_at >= ?';
  const p = [linkId, since];
  const rc = "CASE WHEN c.referrer = '' THEN 'Direct / none' ELSE c.referrer END";
  // The independent queries run at the same time: each one is a network round trip to the database.
  const [totals, series, recent, referrers, devices, browsers, countries, sources] = await Promise.all([
    db.get(`
      SELECT SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS clicks,
             COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END) AS visitors,
             SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bots,
             SUM(CASE WHEN is_bot = 0 AND source = 'qr' THEN 1 ELSE 0 END) AS qr_scans
      FROM clicks c WHERE ${where}`, p),
    db.all(`
      SELECT ${localDaySql('clicked_at')} AS day, COUNT(*) AS clicks, COUNT(DISTINCT visitor_hash) AS visitors
      FROM clicks c WHERE ${where} AND is_bot = 0 GROUP BY day`, [tz, ...p]),
    db.all(`
      SELECT clicked_at, referrer, device, browser, os, country, source, is_bot
      FROM clicks c WHERE c.link_id = ? ORDER BY c.id DESC LIMIT 15`, [linkId]),
    breakdown(db, where, p, rc),
    breakdown(db, where, p, 'c.device'),
    breakdown(db, where, p, 'c.browser'),
    breakdown(db, where, p, 'c.country'),
    breakdown(db, where, p, 'c.source'),
  ]);
  return {
    days,
    totals: { clicks: totals.clicks || 0, visitors: totals.visitors || 0, bots_filtered: totals.bots || 0, qr_scans: totals.qr_scans || 0 },
    series: fillDays(series, days, tz),
    referrers, devices, browsers, countries, sources,
    recent,
  };
}

/**
 * Dashboard summary for a user (or everyone, for admins).
 * Expired and disabled links stay in the numbers: their history is never dropped.
 */
async function summary(db, user, q) {
  const { days, tz, since } = range(q);
  const scopeAll = user.role === 'admin' && q.get('scope') === 'all';
  const ownerSql = scopeAll ? '1=1' : 'l.owner_id = ?';
  const ownerP = scopeAll ? [] : [user.id];
  let campaignSql = '1=1';
  const campaignP = [];
  if (q.get('campaign')) {
    campaignSql = 'l.campaign_id = ?';
    campaignP.push(Number.isInteger(Number(q.get('campaign'))) ? Number(q.get('campaign')) : 0);
  }
  const base = `FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${ownerSql} AND ${campaignSql} AND c.clicked_at >= ?`;
  const bp = [...ownerP, ...campaignP, since];

  const scopeLinks = `c.link_id IN (SELECT l.id FROM links l WHERE ${ownerSql} AND ${campaignSql}) AND c.clicked_at >= ?`;
  const rc = "CASE WHEN c.referrer = '' THEN 'Direct / none' ELSE c.referrer END";

  // Independent queries run together (each is a round trip to the database).
  const [totals, linkRows, series, topRaw, campaigns, referrers, devices, browsers, countries] = await Promise.all([
    db.get(`
      SELECT SUM(CASE WHEN c.is_bot = 0 THEN 1 ELSE 0 END) AS clicks,
             COUNT(DISTINCT CASE WHEN c.is_bot = 0 THEN c.visitor_hash END) AS visitors,
             SUM(CASE WHEN c.is_bot = 1 THEN 1 ELSE 0 END) AS bots,
             SUM(CASE WHEN c.is_bot = 0 AND c.source = 'qr' THEN 1 ELSE 0 END) AS qr_scans ${base}`, bp),
    db.all(`SELECT l.* FROM links l WHERE ${ownerSql} AND ${campaignSql}`, [...ownerP, ...campaignP]),
    db.all(`
      SELECT ${localDaySql('c.clicked_at')} AS day, COUNT(*) AS clicks, COUNT(DISTINCT c.visitor_hash) AS visitors
      ${base} AND c.is_bot = 0 GROUP BY day`, [tz, ...bp]),
    db.all(`
      SELECT l.id, l.short_code, l.title, l.destination_url, l.status, l.expires_at, l.click_limit, l.click_count, COUNT(*) AS clicks
      ${base} AND c.is_bot = 0 GROUP BY l.id ORDER BY clicks DESC, l.id LIMIT 8`, bp),
    db.all(`
      SELECT cp.id, cp.name,
        (SELECT COUNT(*) FROM links x WHERE x.campaign_id = cp.id) AS links,
        (SELECT COUNT(*) FROM clicks k JOIN links x ON x.id = k.link_id
           WHERE x.campaign_id = cp.id AND k.is_bot = 0 AND k.clicked_at >= ?) AS clicks,
        (SELECT x.short_code FROM links x JOIN clicks k ON k.link_id = x.id
           WHERE x.campaign_id = cp.id AND k.is_bot = 0 AND k.clicked_at >= ?
           GROUP BY x.id ORDER BY COUNT(*) DESC, x.id LIMIT 1) AS top_link
      FROM campaigns cp WHERE ${scopeAll ? '1=1' : 'cp.owner_id = ?'} ORDER BY clicks DESC, cp.name`, [since, since, ...ownerP]),
    breakdown(db, scopeLinks, [...ownerP, ...campaignP, since], rc),
    breakdown(db, scopeLinks, [...ownerP, ...campaignP, since], 'c.device'),
    breakdown(db, scopeLinks, [...ownerP, ...campaignP, since], 'c.browser'),
    breakdown(db, scopeLinks, [...ownerP, ...campaignP, since], 'c.country'),
  ]);

  const counts = { total: linkRows.length, active: 0, expired: 0, disabled: 0, limit_reached: 0 };
  for (const r of linkRows) counts[effectiveStatus(r)] += 1;
  const topLinks = topRaw.map((r) => ({ ...r, effective_status: effectiveStatus(r) }));
  const traffic = { referrers, devices, browsers, countries };

  return {
    days,
    scope: scopeAll ? 'all' : 'mine',
    totals: { clicks: totals.clicks || 0, visitors: totals.visitors || 0, bots_filtered: totals.bots || 0, qr_scans: totals.qr_scans || 0 },
    links: counts,
    series: fillDays(series, days, tz),
    top_links: topLinks,
    campaigns,
    traffic,
    alerts: await alerts(db, linkRows),
  };
}

/** Links that need attention: expiring soon, close to their click limit, or suddenly busy. */
async function alerts(db, linkRows) {
  const out = [];
  const now = Date.now();
  const dayAgo = new Date(now - 86400_000).toISOString();
  const weekAgo = new Date(now - 8 * 86400_000).toISOString();
  // spike check for every link in ONE query: clicks in the last 24h and in the 7 days before that
  const recent = new Map();
  if (linkRows.length) {
    const rows = await db.all(`
      SELECT link_id,
             SUM(CASE WHEN clicked_at >= ? THEN 1 ELSE 0 END) AS last,
             SUM(CASE WHEN clicked_at < ? THEN 1 ELSE 0 END) AS prev
      FROM clicks WHERE is_bot = 0 AND clicked_at >= ? AND link_id = ANY(?::int[]) GROUP BY link_id`,
    [dayAgo, dayAgo, weekAgo, linkRows.map((l) => l.id)]);
    for (const r of rows) recent.set(r.link_id, r);
  }
  for (const l of linkRows) {
    const st = effectiveStatus(l);
    if (st === 'disabled') continue;
    if (l.expires_at && st !== 'expired') {
      const ms = new Date(l.expires_at).getTime() - now;
      if (ms > 0 && ms <= 7 * 86400_000) out.push({ type: 'expiring', severity: ms < 86400_000 ? 'high' : 'medium', link_id: l.id, short_code: l.short_code, message: `Expires in ${ms < 86400_000 ? `${Math.max(1, Math.round(ms / 3600_000))} hours` : `${Math.round(ms / 86400_000)} days`}` });
    }
    if (l.click_limit && st === 'active' && l.click_count / l.click_limit >= 0.8) {
      out.push({ type: 'near_limit', severity: 'medium', link_id: l.id, short_code: l.short_code, message: `${l.click_count} of ${l.click_limit} clicks used` });
    }
    if (st === 'limit_reached') {
      out.push({ type: 'limit_reached', severity: 'high', link_id: l.id, short_code: l.short_code, message: 'Click limit reached; the link has stopped redirecting' });
    }
    // spike: last 24h at least 10 clicks and over 3x the daily average of the 7 days before
    const r = recent.get(l.id);
    if (r && r.last >= 10 && r.last > (r.prev / 7) * 3) {
      out.push({ type: 'spike', severity: 'info', link_id: l.id, short_code: l.short_code, message: `${r.last} clicks in the last 24 hours, well above normal` });
    }
  }
  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 12);
}

module.exports = { linkAnalytics, summary, HttpError };
