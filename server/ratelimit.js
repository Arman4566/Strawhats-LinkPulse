'use strict';
const { HttpError } = require('./util');

// Fixed-window counter kept in memory. Good enough for one server instance;
// a shared store such as Redis would replace this when scaling out.
const windows = new Map();

function hit(key, limit, windowMs) {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.reset <= now) {
    w = { count: 0, reset: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  if (w.count > limit) {
    const retry = Math.max(1, Math.ceil((w.reset - now) / 1000));
    throw new HttpError(429, `Too many requests. Try again in ${retry}s.`, { retryAfter: retry });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (w.reset <= now) windows.delete(k);
}, 60_000).unref();

function resetAll() { windows.clear(); }

module.exports = { hit, resetAll };
