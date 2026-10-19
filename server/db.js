'use strict';
const { Pool, types } = require('pg');

// ---- type parsing: the rest of the app expects plain numbers and ISO-8601 strings ----
types.setTypeParser(20, Number);                                   // bigint (COUNT, SUM, BIGSERIAL ids)
types.setTypeParser(1700, Number);                                 // numeric
types.setTypeParser(1184, (v) => new Date(v).toISOString());       // timestamptz -> "2026-10-18T00:17:00.000Z"

// Neon is plain PostgreSQL. Timestamps are stored as timestamptz; case-insensitive text uses citext.
// Links are never deleted: disabled or expired links keep their clicks for reports.
const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email CITEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  short_code CITEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  disabled_reason TEXT,
  expires_at TIMESTAMPTZ,
  click_limit INTEGER,
  click_count INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
-- who switched a link off: 'admin' (only an admin can switch it back on) or 'owner'. Added after v1.1, so ALTER.
ALTER TABLE links ADD COLUMN IF NOT EXISTS disabled_by TEXT;
UPDATE links SET disabled_by = 'admin'
  WHERE status = 'disabled' AND disabled_by IS NULL
    AND (disabled_reason LIKE 'Disabled by admin%' OR disabled_reason LIKE 'Domain % was blocked');
CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_id);
CREATE INDEX IF NOT EXISTS idx_links_campaign ON links(campaign_id);

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  UNIQUE (owner_id, name)
);
CREATE TABLE IF NOT EXISTS link_tags (
  link_id INTEGER NOT NULL REFERENCES links(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (link_id, tag_id)
);

CREATE TABLE IF NOT EXISTS clicks (
  id BIGSERIAL PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id),
  clicked_at TIMESTAMPTZ NOT NULL,
  referrer TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT 'unknown',
  browser TEXT NOT NULL DEFAULT 'unknown',
  os TEXT NOT NULL DEFAULT 'unknown',
  country TEXT NOT NULL DEFAULT 'Unknown',
  source TEXT NOT NULL DEFAULT 'direct',
  visitor_hash TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clicks_link_time ON clicks(link_id, clicked_at);
CREATE INDEX IF NOT EXISTS idx_clicks_time ON clicks(clicked_at);

CREATE TABLE IF NOT EXISTS blocked_domains (
  id SERIAL PRIMARY KEY,
  domain CITEXT NOT NULL UNIQUE,
  added_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL
);

-- link-in-bio pages: one per user, a profile plus an ordered list of that user's short links
CREATE TABLE IF NOT EXISTS bio_pages (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  handle CITEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'ocean',
  published INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS bio_items (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES bio_pages(id) ON DELETE CASCADE,
  link_id INTEGER NOT NULL REFERENCES links(id),
  label TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bio_items_page ON bio_items(page_id, position);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
`;

/** "?" placeholders -> "$1, $2, ...". (No query in this app has a literal "?" in its text.) */
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

/**
 * A small query helper over a pg Pool or a single pg client (inside a transaction):
 *   await db.get(sql, [params])   -> first row or undefined
 *   await db.all(sql, [params])   -> array of rows
 *   await db.run(sql, [params])   -> { changes, id }   (id = first returned "id" column, add RETURNING id)
 */
function wrap(executor, extra = {}) {
  const q = (sql, params = []) => executor.query(toPg(sql), params);
  return {
    async all(sql, params) { return (await q(sql, params)).rows; },
    async get(sql, params) { return (await q(sql, params)).rows[0]; },
    async run(sql, params) { const r = await q(sql, params); return { changes: r.rowCount, id: r.rows[0]?.id }; },
    async exec(sql) { await executor.query(sql); },
    ...extra,
  };
}

/**
 * Connect to Neon (or any PostgreSQL) and make sure the tables exist.
 * `url` is the Neon connection string, e.g. postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
 * `schema` is optional (the tests use it to get a private schema).
 */
async function openDb(url, { schema } = {}) {
  if (!url) throw new Error('DATABASE_URL is not set. Paste your Neon connection string into .env (see .env.example).');
  // Neon's certificates are publicly verifiable, so say "verify-full" outright (what pg treats "require" as anyway;
  // writing it explicitly avoids a warning on every start).
  const connectionString = url.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, '$1verify-full');
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,   // a suspended Neon compute needs a moment to wake up
    keepAlive: true,
  });
  // Neon closes idle connections and suspends the compute; that must never crash the server.
  pool.on('error', (e) => console.error('Database connection dropped (it will reconnect):', e.message));
  if (schema) {
    pool.on('connect', (client) => client.query(`SET search_path TO "${schema}", public`));
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  }

  // One transaction + advisory lock, so two servers starting together cannot race on CREATE TABLE.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727274)');
    await client.query(SCHEMA);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw e;
  } finally { client.release(); }

  return wrap(pool, { pool, inTx: false, close: () => pool.end() });
}

/** Run fn(txDb) inside a transaction; roll back if it throws. Use the txDb passed in, not the outer db. */
async function tx(db, fn) {
  if (db.inTx) return fn(db);                       // already inside a transaction
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(wrap(client, { pool: db.pool, inTx: true }));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally { client.release(); }
}

/** Multi-row INSERT in chunks (one round trip per ~500 rows instead of one per row). */
async function insertMany(db, table, cols, rows, { onConflict = '' } = {}) {
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += Math.min(per, 500)) {
    const chunk = rows.slice(i, i + Math.min(per, 500));
    const params = [];
    const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return '?'; }).join(', ')})`).join(', ');
    await db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values} ${onConflict}`, params);
  }
}

/** SQL for "the calendar day of a timestamp, shifted by tz minutes", as YYYY-MM-DD. Takes one "?" parameter: tz. */
const localDaySql = (col) => `to_char((${col} AT TIME ZONE 'UTC') + make_interval(mins => ?), 'YYYY-MM-DD')`;
/** SQL for a part of the shifted local time: 'HOUR' (0-23) or 'DOW' (0 = Sunday). Takes one "?" parameter: tz. */
const localPartSql = (part, col) => `(EXTRACT(${part} FROM (${col} AT TIME ZONE 'UTC') + make_interval(mins => ?)))::int`;

module.exports = { openDb, tx, insertMany, localDaySql, localPartSql };
