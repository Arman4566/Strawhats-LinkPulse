'use strict';
const { validateLink } = require('./validate');
const { normalizeTags } = require('./links');

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM. */
function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  destination_url: ['destination_url', 'destination', 'url', 'long_url', 'target', 'link'],
  alias: ['alias', 'short_code', 'custom_alias', 'slug', 'short'],
  campaign: ['campaign', 'campaign_name'],
  tags: ['tags', 'tag', 'labels'],
  expires_at: ['expires_at', 'expires', 'expiry', 'expiry_date', 'expires_on'],
  click_limit: ['click_limit', 'limit', 'max_clicks', 'clicks_limit'],
  password: ['password', 'pass'],
  title: ['title', 'name', 'description'],
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const key = String(h).trim().toLowerCase().replace(/[\s-]+/g, '_');
    for (const [field, names] of Object.entries(HEADER_ALIASES)) {
      if (names.includes(key) && map[field] === undefined) map[field] = idx;
    }
  });
  return map;
}

const MAX_ROWS = 1000;

/**
 * Check every row of a CSV the way the link wizard would, without writing anything.
 * Each row is "valid", "duplicate" (skipped) or "error". Returns the rows plus a summary.
 */
function checkCsv(db, user, text, { selfHost } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { fatal: 'The file needs a header row and at least one link.' };
  const cols = mapHeaders(rows[0]);
  if (cols.destination_url === undefined) {
    return { fatal: 'Missing a destination column. Name it destination_url (or url).' };
  }
  const body = rows.slice(1);
  if (body.length > MAX_ROWS) return { fatal: `Too many rows. The limit is ${MAX_ROWS} per file.` };

  const seenAlias = new Set();
  const seenDest = new Set();
  const out = [];
  body.forEach((cells, i) => {
    const get = (f) => (cols[f] === undefined ? '' : String(cells[cols[f]] ?? '').trim());
    const input = {
      destination_url: get('destination_url'),
      alias: get('alias'),
      campaign: get('campaign'),
      tags: get('tags'),
      expires_at: get('expires_at'),
      click_limit: get('click_limit'),
      password: get('password'),
      title: get('title'),
    };
    const item = { row: i + 2, input, status: 'valid', messages: [] };
    const v = validateLink(db, input, { ownerId: user.id, selfHost });

    if (!v.ok) {
      item.status = 'error';
      item.messages = Object.values(v.errors);
    } else {
      const aliasKey = (v.clean.alias || '').toLowerCase();
      const destKey = v.clean.destination_url;
      if (aliasKey && seenAlias.has(aliasKey)) {
        item.status = 'error';
        item.messages = ['This alias appears earlier in the file'];
      } else if (seenDest.has(destKey)) {
        item.status = 'duplicate';
        item.messages = ['Same destination as an earlier row in this file'];
      } else if (v.warnings.some((w) => w.startsWith('You already have a short link'))) {
        item.status = 'duplicate';
        item.messages = ['You already have a short link for this destination'];
      }
      if (item.status === 'valid') {
        if (aliasKey) seenAlias.add(aliasKey);
        seenDest.add(destKey);
        item.messages = v.warnings;
        item.input.tags = normalizeTags(input.tags);
      }
    }
    out.push(item);
  });

  const summary = {
    total: out.length,
    valid: out.filter((r) => r.status === 'valid').length,
    duplicates: out.filter((r) => r.status === 'duplicate').length,
    errors: out.filter((r) => r.status === 'error').length,
  };
  return { rows: out, summary };
}

module.exports = { parseCsv, checkCsv };
