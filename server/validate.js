'use strict';

const RESERVED_ALIASES = new Set([
  'api', 'admin', 'health', 'login', 'logout', 'register', 'app', 'assets', 'static', 'public',
  'unlock', 'favicon', 'robots', 'index', 'dashboard', 'links', 'campaigns', 'settings', 'report', 'qr',
]);
const ALIAS_RE = /^[A-Za-z0-9_-]{3,32}$/;
const MAX_URL_LENGTH = 2048;

function parseDestination(raw) {
  const text = String(raw || '').trim();
  if (!text) return { error: 'Enter a destination URL' };
  if (text.length > MAX_URL_LENGTH) return { error: `URL is longer than ${MAX_URL_LENGTH} characters` };
  let url;
  try { url = new URL(text); } catch { return { error: 'This is not a valid URL. Include http:// or https://' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Only http:// and https:// links are allowed' };
  if (url.username || url.password) return { error: 'URLs with a username or password are not allowed' };
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') && host !== 'localhost') return { error: 'The domain looks incomplete' };
  return { url, host };
}

/** True if host equals a blocked domain or is a subdomain of one. */
function isBlockedHost(db, host) {
  const rows = db.prepare('SELECT domain FROM blocked_domains').all();
  return rows.find((r) => {
    const d = r.domain.toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  })?.domain || null;
}

/** Parse an expiry given as ISO text or YYYY-MM-DD (date-only = end of that day, UTC). */
function parseExpiry(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const text = String(raw).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const d = new Date(dateOnly ? `${text}T23:59:59.000Z` : text);
  if (Number.isNaN(d.getTime())) return { error: 'Expiry must be a valid date and time' };
  return { value: d.toISOString() };
}

function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10_000_000) return { error: 'Click limit must be a whole number of 1 or more' };
  return { value: n };
}

/**
 * Check a link before it is saved. Returns { errors: {field: msg}, warnings: [msg], clean }.
 * `existingId` lets an edit keep its own alias.
 */
function validateLink(db, input, { ownerId, existingId = null, selfHost = null, isEdit = false } = {}) {
  const errors = {};
  const warnings = [];
  const clean = {};

  if (!isEdit || input.destination_url !== undefined) {
    const parsed = parseDestination(input.destination_url);
    if (parsed.error) errors.destination_url = parsed.error;
    else {
      clean.destination_url = parsed.url.toString();
      if (selfHost && parsed.host === selfHost.toLowerCase()) errors.destination_url = 'A link cannot point back to LinkPulse itself';
      const blocked = isBlockedHost(db, parsed.host);
      if (blocked) errors.destination_url = `The domain ${blocked} is on the blocklist`;
      if (parsed.url.protocol === 'http:') warnings.push('This destination uses http, not https. Visitors may see a browser warning.');
      if (!errors.destination_url && ownerId) {
        const dup = db.prepare('SELECT short_code FROM links WHERE owner_id = ? AND destination_url = ? AND id IS NOT ?')
          .get(ownerId, clean.destination_url, existingId);
        if (dup) warnings.push(`You already have a short link for this destination (${dup.short_code}).`);
      }
    }
  }

  if (!isEdit || input.alias !== undefined || input.short_code !== undefined) {
    const alias = String(input.alias ?? input.short_code ?? '').trim();
    if (alias) {
      if (!ALIAS_RE.test(alias)) errors.alias = 'Alias must be 3 to 32 characters: letters, numbers, - or _';
      else if (RESERVED_ALIASES.has(alias.toLowerCase())) errors.alias = 'This alias is reserved. Choose another.';
      else {
        const taken = db.prepare('SELECT id FROM links WHERE short_code = ? COLLATE NOCASE AND id IS NOT ?').get(alias, existingId);
        if (taken) errors.alias = 'This alias is already taken';
        else clean.alias = alias;
      }
    }
  }

  if (!isEdit || input.expires_at !== undefined) {
    const exp = parseExpiry(input.expires_at);
    if (exp.error) errors.expires_at = exp.error;
    else {
      clean.expires_at = exp.value;
      if (exp.value) {
        const ms = new Date(exp.value).getTime() - Date.now();
        if (ms <= 0) errors.expires_at = 'The expiry time is already in the past';
        else if (ms < 60 * 60 * 1000) warnings.push('This link expires in less than an hour.');
      }
    }
  }

  if (!isEdit || input.click_limit !== undefined) {
    const lim = parseLimit(input.click_limit);
    if (lim.error) errors.click_limit = lim.error;
    else {
      clean.click_limit = lim.value;
      if (lim.value !== null && lim.value <= 3) warnings.push(`This link will stop working after ${lim.value} click${lim.value === 1 ? '' : 's'}.`);
    }
  }

  if (input.password !== undefined && input.password !== null && input.password !== '') {
    const pw = String(input.password);
    if (pw.length < 4 || pw.length > 128) errors.password = 'Password must be 4 to 128 characters';
    else clean.password = pw;
  }

  if (input.title !== undefined) clean.title = String(input.title || '').trim().slice(0, 120);

  return { errors, warnings, clean, ok: Object.keys(errors).length === 0 };
}

module.exports = { validateLink, parseDestination, isBlockedHost, parseExpiry, parseLimit, RESERVED_ALIASES, ALIAS_RE };
