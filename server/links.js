'use strict';
const { tx } = require('./db');
const { hashPassword } = require('./auth');
const { validateLink, isBlockedHost } = require('./validate');
const { randomCode, HttpError, nowIso } = require('./util');
const cache = require('./cache');
const config = require('./config');

/** The status a visitor would actually meet. */
function effectiveStatus(row, now = Date.now()) {
  if (row.status === 'disabled') return 'disabled';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expired';
  if (row.click_limit !== null && row.click_count >= row.click_limit) return 'limit_reached';
  return 'active';
}

/** Tags for many links in one query: Map(linkId -> [names]). */
async function tagsForMany(db, linkIds) {
  const map = new Map(linkIds.map((id) => [id, []]));
  if (!linkIds.length) return map;
  const rows = await db.all(
    'SELECT lt.link_id, t.name FROM tags t JOIN link_tags lt ON lt.tag_id = t.id WHERE lt.link_id = ANY(?::int[]) ORDER BY t.name', [linkIds]);
  for (const r of rows) map.get(r.link_id).push(r.name);
  return map;
}

function shape(row, base, tags) {
  return {
    id: row.id,
    short_code: row.short_code,
    short_url: `${base}/${row.short_code}`,
    destination_url: row.destination_url,
    title: row.title,
    status: row.status,
    effective_status: effectiveStatus(row),
    disabled_reason: row.disabled_reason,
    disabled_by: row.disabled_by ?? null,
    locked_by_admin: row.status === 'disabled' && row.disabled_by === 'admin',   // only an admin can switch it back on
    expires_at: row.expires_at,
    click_limit: row.click_limit,
    click_count: row.click_count,
    has_password: !!row.password_hash,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name ?? null,
    owner_id: row.owner_id,
    owner_email: row.owner_email,
    tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function serializeLinks(db, rows, base) {
  const tags = await tagsForMany(db, rows.map((r) => r.id));
  return rows.map((r) => shape(r, base, tags.get(r.id)));
}
async function serializeLink(db, row, base) { return (await serializeLinks(db, [row], base))[0]; }

const LINK_SELECT = `
  SELECT l.*, c.name AS campaign_name, u.email AS owner_email
  FROM links l
  LEFT JOIN campaigns c ON c.id = l.campaign_id
  LEFT JOIN users u ON u.id = l.owner_id`;

async function getLinkFor(db, user, id) {
  const row = await db.get(`${LINK_SELECT} WHERE l.id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Link not found');
  if (user.role !== 'admin' && row.owner_id !== user.id) throw new HttpError(404, 'Link not found');
  return row;
}

function normalizeTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,;|]/);
  const out = [];
  for (const t of list) {
    const name = String(t).trim().toLowerCase().slice(0, 30);
    if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, 10);
}

async function setTags(db, ownerId, linkId, names) {
  await db.run('DELETE FROM link_tags WHERE link_id = ?', [linkId]);
  for (const name of names) {
    const tag = await db.get('INSERT INTO tags (owner_id, name) VALUES (?, ?) ON CONFLICT (owner_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [ownerId, name]);
    await db.run('INSERT INTO link_tags (link_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [linkId, tag.id]);
  }
}

/** Resolve a campaign by id (must belong to the owner) or by name (created if missing). */
async function resolveCampaign(db, ownerId, { campaign_id, campaign }) {
  if (campaign_id !== undefined && campaign_id !== null && campaign_id !== '') {
    const n = Number(campaign_id);
    const c = Number.isInteger(n) && n > 0 && n < 2 ** 31 ? await db.get('SELECT id FROM campaigns WHERE id = ? AND owner_id = ?', [n, ownerId]) : null;
    if (!c) throw new HttpError(400, 'Campaign not found', { errors: { campaign_id: 'Campaign not found' } });
    return c.id;
  }
  const name = String(campaign || '').trim().slice(0, 80);
  if (!name) return null;
  const row = await db.get('INSERT INTO campaigns (owner_id, name, created_at) VALUES (?, ?, ?) ON CONFLICT (owner_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [ownerId, name, nowIso()]);
  return row.id;
}

/** Validate and create a link. Throws HttpError(422) with field errors on bad input. */
async function createLink(db, user, input, { selfHost } = {}) {
  const v = await validateLink(db, input, { ownerId: user.id, selfHost });
  if (!v.ok) throw new HttpError(422, 'Please fix the highlighted fields', { errors: v.errors, warnings: v.warnings });
  const c = v.clean;
  const now = nowIso();

  const id = await tx(db, async (t) => {
    const campaignId = await resolveCampaign(t, user.id, input);
    // ON CONFLICT DO NOTHING (rather than catching the error) keeps the transaction usable after a clash.
    const insert = async (code) => (await t.get(`
      INSERT INTO links (owner_id, campaign_id, short_code, destination_url, title, expires_at, click_limit, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (short_code) DO NOTHING RETURNING id`, [
      user.id, campaignId, code, c.destination_url, c.title || '', c.expires_at ?? null, c.click_limit ?? null,
      c.password ? hashPassword(c.password) : null, now, now]))?.id;

    let linkId;
    if (c.alias) {
      linkId = await insert(c.alias);
      if (!linkId) throw new HttpError(422, 'Please fix the highlighted fields', { errors: { alias: 'This alias is already taken' } });
    } else {
      for (let attempt = 0; attempt < 8 && !linkId; attempt++) linkId = await insert(randomCode(config.CODE_LENGTH));
      if (!linkId) throw new HttpError(503, 'Could not generate a unique short code. Please try again.');
    }
    await setTags(t, user.id, linkId, normalizeTags(input.tags));
    return linkId;
  });
  return { id, warnings: v.warnings };
}

async function updateLink(db, user, id, input, { selfHost } = {}) {
  const row = await getLinkFor(db, user, id);
  const v = await validateLink(db, input, { ownerId: row.owner_id, existingId: row.id, selfHost, isEdit: true });
  if (!v.ok) throw new HttpError(422, 'Please fix the highlighted fields', { errors: v.errors, warnings: v.warnings });
  const c = v.clean;

  await tx(db, async (t) => {
    const sets = [];
    const vals = [];
    const put = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };
    if (c.destination_url !== undefined) put('destination_url', c.destination_url);
    if (c.title !== undefined) put('title', c.title);
    if (c.expires_at !== undefined) put('expires_at', c.expires_at);
    if (c.click_limit !== undefined) put('click_limit', c.click_limit);
    if (input.password === null) put('password_hash', null);          // null removes the password; "" or missing leaves it alone
    if (c.password) put('password_hash', hashPassword(c.password));
    if (input.campaign_id !== undefined || input.campaign !== undefined) {
      put('campaign_id', await resolveCampaign(t, row.owner_id, input));
    }
    if (input.status !== undefined) {
      if (!['active', 'disabled'].includes(input.status)) throw new HttpError(422, 'Invalid status', { errors: { status: 'Use active or disabled' } });
      const isAdmin = user.role === 'admin';
      const adminLocked = row.status === 'disabled' && row.disabled_by === 'admin';
      if (input.status === 'active') {
        // A link an admin disabled or blocked stays off until an admin switches it back on.
        if (adminLocked && !isAdmin) throw new HttpError(403, 'This link was disabled by an admin. Only an admin can turn it back on.');
        if (!isAdmin) {
          let host = '';
          try { host = new URL(c.destination_url ?? row.destination_url).hostname.toLowerCase(); } catch { host = ''; }
          const blocked = host && await isBlockedHost(t, host);
          if (blocked) throw new HttpError(422, `The domain ${blocked} is on the blocklist`, { errors: { status: `The domain ${blocked} is on the blocklist` } });
        }
        put('status', 'active'); put('disabled_reason', null); put('disabled_by', null);
      } else if (!(adminLocked && !isAdmin)) {      // an owner "disabling" an admin-disabled link changes nothing
        put('status', 'disabled');
        put('disabled_reason', String(input.disabled_reason || (isAdmin ? 'Disabled by admin' : 'Disabled by owner')).slice(0, 200));
        put('disabled_by', isAdmin ? 'admin' : 'owner');
      }
    }
    if (sets.length) {
      put('updated_at', nowIso());
      await t.run(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`, [...vals, row.id]);
    }
    if (input.tags !== undefined) await setTags(t, row.owner_id, row.id, normalizeTags(input.tags));
  });
  cache.invalidate(row.short_code);
  return { id: row.id, warnings: v.warnings };
}

/** Admin takedown: redirects stop on the very next request and history is kept. */
async function setStatus(db, id, status, reason) {
  const row = await db.get('SELECT id, short_code FROM links WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Link not found');
  // Only admins call this (takedown / enable / blocklist), so a disable here locks the link against the owner.
  await db.run('UPDATE links SET status = ?, disabled_reason = ?, disabled_by = ?, updated_at = ? WHERE id = ?',
    [status, status === 'disabled' ? String(reason || 'Disabled by admin').slice(0, 200) : null, status === 'disabled' ? 'admin' : null, nowIso(), id]);
  cache.invalidate(row.short_code);
}

module.exports = {
  effectiveStatus, serializeLink, serializeLinks, getLinkFor, createLink, updateLink, setStatus,
  normalizeTags, resolveCampaign, setTags, LINK_SELECT,
};
