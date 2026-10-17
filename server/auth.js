'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { HttpError } = require('./util');

// ---- passwords: scrypt with a random salt ("salt$hash", both hex) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes('$')) return false;
  const [saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---- tokens: minimal HS256 JWT ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signToken(user) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + config.TOKEN_TTL_SECONDS,
  }));
  const sig = crypto.createHmac('sha256', config.JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', config.JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

/** Returns the user row for the request's bearer token, or null. Reads role from the DB, not the token. */
function currentUser(db, req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const payload = verifyToken(header.slice(7));
  if (!payload) return null;
  return db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(payload.sub) || null;
}

function requireUser(db, req) {
  const user = currentUser(db, req);
  if (!user) throw new HttpError(401, 'Please log in');
  return user;
}

function requireAdmin(db, req) {
  const user = requireUser(db, req);
  if (user.role !== 'admin') throw new HttpError(403, 'Admin access required');
  return user;
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, currentUser, requireUser, requireAdmin };
