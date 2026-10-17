'use strict';
const { tx } = require('./db');
const { hashPassword } = require('./auth');
const { validateLink } = require('./validate');
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

function tagsFor(db, linkId) {
  return db.prepare('SELECT t.name FROM tags t JOIN link_tags lt ON lt.tag_id = t.id WHERE lt.link_id = ? ORDER BY t.name')
    .all(linkId).map((r) => r.name);
}

function serializeLink(db, row, base) {
  return {
    id: row.id,
    short_code: row.short_code,
    short_url: `${base}/${row.short_code}`,
    destination_url: row.destination_url,
    title: row.title,
    status: row.status,
    effective_status: effectiveStatus(row),
    disabled_reason: row.disabled_reason,
    expires_at: row.expires_at,
    click_limit: row.click_limit,
    click_count: row.click_count,
    has_password: !!row.password_hash,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name ?? null,
    owner_id: row.owner_id,
    owner_email: row.owner_email,
    tags: tagsFor(db, row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const LINK_SELECT = `
  SELECT l.*, c.name AS campaign_name, u.email AS owner_email
  FROM links l
  LEFT JOIN campaigns c ON c.id = l.campaign_id
  LEFT JOIN users u ON u.id = l.owner_id`;

function getLinkFor(db, user, id) {
  const row = db.prepare(`${LINK_SELECT} WHERE l.id = ?`).get(id);
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

function setTags(db, ownerId, linkId, names) {
  db.prepare('DELETE FROM link_tags WHERE link_id = ?').run(linkId);
  for (const name of names) {
    db.prepare('INSERT OR IGNORE INTO tags (owner_id, name) VALUES (?, ?)').run(ownerId, name);
    const tag = db.prepare('SELECT id FROM tags WHERE owner_id = ? AND name = ?').get(ownerId, name);
    db.prepare('INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)').run(linkId, tag.id);
  }
}

/** Resolve a campaign by id (must belong to the owner) or by name (created if missing). */
function resolveCampaign(db, ownerId, { campaign_id, campaign }) {
  if (campaign_id !== undefined && campaign_id !== null && campaign_id !== '') {
    const c = db.prepare('SELECT id FROM campaigns WHERE id = ? AND owner_id = ?').get(Number(campaign_id), ownerId);
    if (!c) throw new HttpError(400, 'Campaign not found', { errors: { campaign_id: 'Campaign not found' } });
    return c.id;
  }
  const name = String(campaign || '').trim().slice(0, 80);
  if (!name) return null;
  db.prepare('INSERT OR IGNORE INTO campaigns (owner_id, name, created_at) VALUES (?, ?, ?)').run(ownerId, name, nowIso());
  return db.prepare('SELECT id FROM campaigns WHERE owner_id = ? AND name = ?').get(ownerId, name).id;
}

function insertWithGeneratedCode(db, makeRow) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return makeRow(randomCode(config.CODE_LENGTH)); } catch (e) {
      if (!/UNIQUE/i.test(String(e.message))) throw e;
    }
  }
  throw new HttpError(503, 'Could not generate a unique short code. Please try again.');
}

/** Validate and create a link. Throws HttpError(422) with field errors on bad input. */
function createLink(db, user, input, { selfHost } = {}) {
  const v = validateLink(db, input, { ownerId: user.id, selfHost });
  if (!v.ok) throw new HttpError(422, 'Please fix the highlighted fields', { errors: v.errors, warnings: v.warnings });
  const c = v.clean;
  const now = nowIso();

  const id = tx(db, () => {
    const campaignId = resolveCampaign(db, user.id, input);
    const insert = (code) => db.prepare(`
      INSERT INTO links (owner_id, campaign_id, short_code, destination_url, title, expires_at, click_limit, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      user.id, campaignId, code, c.destination_url, c.title || '', c.expires_at ?? null, c.click_limit ?? null,
      c.password ? hashPassword(c.password) : null, now, now).lastInsertRowid;
    const linkId = c.alias ? insert(c.alias) : insertWithGeneratedCode(db, insert);
    setTags(db, user.id, Number(linkId), normalizeTags(input.tags));
    return Number(linkId);
  });
  return { id, warnings: v.warnings };
}

function updateLink(db, user, id, input, { selfHost } = {}) {
  const row = getLinkFor(db, user, id);
  const v = validateLink(db, input, { ownerId: row.owner_id, existingId: row.id, selfHost, isEdit: true });
  if (!v.ok) throw new HttpError(422, 'Please fix the highlighted fields', { errors: v.errors, warnings: v.warnings });
  const c = v.clean;

  tx(db, () => {
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
      put('campaign_id', resolveCampaign(db, row.owner_id, input));
    }
    if (input.status !== undefined) {
      if (!['active', 'disabled'].includes(input.status)) throw new HttpError(422, 'Invalid status', { errors: { status: 'Use active or disabled' } });
      put('status', input.status);
      put('disabled_reason', input.status === 'disabled' ? String(input.disabled_reason || 'Disabled by owner').slice(0, 200) : null);
    }
    if (sets.length) {
      put('updated_at', nowIso());
      db.prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`).run(...vals, row.id);
    }
    if (input.tags !== undefined) setTags(db, row.owner_id, row.id, normalizeTags(input.tags));
  });
  cache.invalidate(row.short_code);
  return { id: row.id, warnings: v.warnings };
}

/** Admin takedown: redirects stop on the very next request and history is kept. */
function setStatus(db, id, status, reason) {
  const row = db.prepare('SELECT id, short_code FROM links WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Link not found');
  db.prepare('UPDATE links SET status = ?, disabled_reason = ?, updated_at = ? WHERE id = ?')
    .run(status, status === 'disabled' ? String(reason || 'Disabled by admin').slice(0, 200) : null, nowIso(), id);
  cache.invalidate(row.short_code);
}

module.exports = {
  effectiveStatus, serializeLink, getLinkFor, createLink, updateLink, setStatus,
  normalizeTags, resolveCampaign, setTags, LINK_SELECT,
};
