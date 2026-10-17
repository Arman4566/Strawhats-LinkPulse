'use strict';
const crypto = require('node:crypto');
const { tx, insertMany } = require('./db');

// Clicks are queued and written in batches, after the redirect has been sent.
// The visitor never waits for the database write (which matters now that the database is over the network).
const FLUSH_EVERY_MS = 250;
const FLUSH_AT = 100;

let dbRef = null;
let queue = [];
let timer = null;
let chain = Promise.resolve();        // writes happen one batch at a time, in order
const flushTimes = [];                // recent flush durations (ms), for the admin latency panel

function init(db) { dbRef = db; }

function dailySalt() {
  return new Date().toISOString().slice(0, 10);   // changes every UTC day, so visitor hashes do not track people long-term
}

/** Privacy-conscious visitor id: a daily-salted hash of IP + user agent. Raw IPs are never stored. */
function visitorHash(ip, ua) {
  return crypto.createHash('sha256').update(`${dailySalt()}|${ip}|${ua}`).digest('hex').slice(0, 16);
}

/**
 * Queue a click. `countIt` marks clicks on links WITHOUT a click limit: their counter is bumped here, in the
 * same transaction as the insert, instead of making the visitor wait for a database round trip.
 * (Links with a limit are counted by an atomic UPDATE in the redirect itself.)
 */
function logClick(rec) {
  queue.push(rec);
  if (queue.length >= FLUSH_AT) flush();
  else if (!timer) { timer = setTimeout(flush, FLUSH_EVERY_MS); timer.unref?.(); }
}

async function write(batch) {
  const t0 = performance.now();
  try {
    await tx(dbRef, async (t) => {
      await insertMany(t, 'clicks',
        ['link_id', 'clicked_at', 'referrer', 'device', 'browser', 'os', 'country', 'source', 'visitor_hash', 'is_bot'],
        batch.map((c) => [c.link_id, c.clicked_at, c.referrer, c.device, c.browser, c.os, c.country, c.source, c.visitor_hash, c.is_bot ? 1 : 0]));
      const bump = new Map();
      for (const c of batch) if (c.count_it) bump.set(c.link_id, (bump.get(c.link_id) || 0) + 1);
      for (const [id, n] of bump) await t.run('UPDATE links SET click_count = click_count + ? WHERE id = ?', [n, id]);
    });
  } catch (e) {
    console.error('click flush failed, re-queueing', e.message);
    queue = batch.concat(queue);
    timer = setTimeout(flush, 2000);
    timer.unref?.();
    return;
  }
  flushTimes.push(performance.now() - t0);
  if (flushTimes.length > 100) flushTimes.shift();
}

/** Write everything queued. The returned promise resolves once this batch AND all earlier ones are saved. */
function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length && dbRef) {
    const batch = queue;
    queue = [];
    chain = chain.then(() => write(batch));
  }
  return chain;
}

const pending = () => queue.length;
const recentFlushMs = () => flushTimes.slice();

module.exports = { init, logClick, flush, pending, visitorHash, recentFlushMs };
