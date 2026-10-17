'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { openDb } = require('./db');
const clicks = require('./clicks');
const auth = require('./auth');
const { handleApi } = require('./api');
const { handleRedirect, handleUnlock, CODE_RE } = require('./redirect');
const { HttpError, sendJson, nowIso } = require('./util');

const PUBLIC_DIR = path.join(config.ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const APP_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "frame-ancestors 'none'",
].join('; ');

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': APP_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  return true;
}

function createServer(db) {
  clicks.init(db);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;

      if (pathname.startsWith('/api/') || pathname === '/health') {
        await handleApi(db, req, res, url, sendJson);
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, pathname)) return;

      const unlock = pathname.match(/^\/unlock\/([^/]+)$/);
      if (req.method === 'POST' && unlock) return await handleUnlock(db, req, res, decodeURIComponent(unlock[1]));

      const code = pathname.slice(1);
      if ((req.method === 'GET' || req.method === 'HEAD') && CODE_RE.test(code)) return await handleRedirect(db, req, res, code);

      return await handleRedirect(db, req, res, '!');   // renders the "link not found" page
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) {
        const headers = e.status === 429 && e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
        sendJson(res, e.status, { error: e.message, ...e.extra }, headers);
      } else {
        console.error('Unhandled error:', e);
        sendJson(res, 500, { error: 'Something went wrong on our side' });
      }
    }
  });
}

function ensureAdmin(db) {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return;
  db.prepare('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(config.ADMIN_EMAIL, 'Admin', auth.hashPassword(config.ADMIN_PASSWORD), 'admin', nowIso());
  console.log(`Created admin account ${config.ADMIN_EMAIL}. Change ADMIN_PASSWORD before you deploy.`);
}

if (require.main === module) {
  const db = openDb(config.DB_PATH);
  ensureAdmin(db);
  if (config.SEED_DEMO && !db.prepare('SELECT 1 FROM links LIMIT 1').get()) {
    require('./seed').seed(db);
    console.log('Seeded demo data.');
  }
  const server = createServer(db);
  server.listen(config.PORT, () => console.log(`LinkPulse running on http://localhost:${config.PORT}`));
  const shutdown = () => { clicks.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer, ensureAdmin };
