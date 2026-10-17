'use strict';
const crypto = require('node:crypto');
const { tx } = require('./db');

// Clicks are queued and written in batches, after the redirect has been sent.
// The visitor never waits for the database write.
const FLUSH_EVERY_MS = 250;
const FLUSH_AT = 100;

let dbRef = null;
let queue = [];
let timer = null;
const flushTimes = [];                // recent flush durations (ms), for the admin latency panel

function init(db) { dbRef = db; }

function dailySalt() {
  return new Date().toISOString().slice(0, 10);   // changes every UTC day, so visitor hashes do not track people long-term
}

/** Privacy-conscious visitor id: a daily-salted hash of IP + user agent. Raw IPs are never stored. */
function visitorHash(ip, ua) {
  return crypto.createHash('sha256').update(`${dailySalt()}|${ip}|${ua}`).digest('hex').slice(0, 16);
}

function logClick(rec) {
  queue.push(rec);
  if (queue.length >= FLUSH_AT) flush();
  else if (!timer) { timer = setTimeout(flush, FLUSH_EVERY_MS); timer.unref?.(); }
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length || !dbRef) return 0;
  const batch = queue;
  queue = [];
  const t0 = performance.now();
  try {
    tx(dbRef, () => {
      const stmt = dbRef.prepare(`
        INSERT INTO clicks (link_id, clicked_at, referrer, device, browser, os, country, source, visitor_hash, is_bot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const c of batch) {
        stmt.run(c.link_id, c.clicked_at, c.referrer, c.device, c.browser, c.os, c.country, c.source, c.visitor_hash, c.is_bot ? 1 : 0);
      }
    });
  } catch (e) {
    console.error('click flush failed, re-queueing', e.message);
    queue = batch.concat(queue);
    timer = setTimeout(flush, 2000);
    timer.unref?.();
    return 0;
  }
  flushTimes.push(performance.now() - t0);
  if (flushTimes.length > 100) flushTimes.shift();
  return batch.length;
}

const pending = () => queue.length;
const recentFlushMs = () => flushTimes.slice();

module.exports = { init, logClick, flush, pending, visitorHash, recentFlushMs };
