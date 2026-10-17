'use strict';
const crypto = require('node:crypto');

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random base62 code. Rejection sampling keeps every character equally likely. */
function randomCode(len = 7) {
  let out = '';
  while (out.length < len) {
    const buf = crypto.randomBytes(len * 2);
    for (const b of buf) {
      if (b < 248) { // 248 = 62 * 4
        out += B62[b % 62];
        if (out.length === len) break;
      }
    }
  }
  return out;
}

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const nowIso = () => new Date().toISOString();

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Body must be valid JSON'); }
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '0.0.0.0';
}

function baseUrl(req, configured) {
  if (configured) return configured.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${String(proto).split(',')[0]}://${req.headers.host}`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = { randomCode, HttpError, nowIso, sendJson, readBody, readJson, clientIp, baseUrl, escapeHtml };
