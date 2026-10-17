'use strict';

// Hot-link cache: short code -> link rules. It skips a database read on most redirects.
// click_count is never trusted from here (the click limit is enforced by an atomic UPDATE),
// and any edit, disable or enable invalidates the entry at once so takedowns are immediate.
const TTL_MS = 5000;
const MAX_ENTRIES = 5000;
const store = new Map();

const key = (code) => String(code).toLowerCase();

function get(code) {
  const hit = store.get(key(code));
  if (!hit) return undefined;
  if (hit.exp <= Date.now()) { store.delete(key(code)); return undefined; }
  return hit.row;
}

function set(code, row) {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key(code), { row, exp: Date.now() + TTL_MS });
}

function invalidate(code) { store.delete(key(code)); }
function clear() { store.clear(); }

module.exports = { get, set, invalidate, clear };
