'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, secret, { mode: 0o600 }); } catch { /* read-only disk: secret lives for this process */ }
  return secret;
}

module.exports = {
  ROOT,
  DATA_DIR,
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'linkpulse.db'),
  BASE_URL: process.env.BASE_URL || '',           // e.g. https://linkpulse.onrender.com
  JWT_SECRET: loadSecret(),
  TOKEN_TTL_SECONDS: 12 * 60 * 60,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@linkpulse.test',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin1234',
  SEED_DEMO: process.env.SEED_DEMO === '1',       // seed sample data on first start
  CODE_LENGTH: 7,
  // Link creation: per user or IP. Auth + unlock attempts have their own limits in the routes.
  CREATE_LIMIT_PER_MIN: Number(process.env.CREATE_LIMIT_PER_MIN || 20),
};
