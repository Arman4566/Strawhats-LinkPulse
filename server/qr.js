'use strict';
const zlib = require('node:zlib');

/**
 * Small QR Code encoder: byte mode, error-correction level M, versions 1 to 10
 * (up to 213 bytes, plenty for a short URL). Follows ISO/IEC 18004.
 */

// Level M block structure per version: [ecCodewordsPerBlock, [blockCount, dataCodewordsPerBlock], ...]
const BLOCKS_M = {
  1: [10, [1, 16]], 2: [16, [1, 28]], 3: [26, [1, 44]], 4: [18, [2, 32]], 5: [24, [2, 43]],
  6: [16, [4, 27]], 7: [18, [4, 31]], 8: [22, [2, 38], [2, 39]], 9: [22, [3, 36], [2, 37]],
  10: [26, [4, 43], [1, 44]],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38],
  8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // highest degree first, leading coefficient 1
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

function dataCapacity(version) {
  const [, ...groups] = BLOCKS_M[version];
  return groups.reduce((n, [count, per]) => n + count * per, 0);
}

function buildCodewords(bytes, version) {
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataCapacity(version); pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);

  // split into blocks, add error correction, interleave
  const [ecLen, ...groups] = BLOCKS_M[version];
  const blocks = [];
  let pos = 0;
  for (const [count, per] of groups) {
    for (let i = 0; i < count; i++) {
      const chunk = data.slice(pos, pos + per);
      pos += per;
      blocks.push({ data: chunk, ec: rsRemainder(chunk, ecLen) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

function makeMatrix(version) {
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => {            // x = column, y = row
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark; isFn[y][x] = true;
  };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(cx + dx, cy + dy, dist !== 2 && dist !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // reserve format areas (real values are drawn per mask), then version info
  drawFormat(modules, isFn, size, 0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, dark); setFn(b, a, dark);
    }
  }
  return { size, modules, isFn };
}

function drawFormat(modules, isFn, size, mask) {
  const data = (0 << 3) | mask;              // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) !== 0;
  const set = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);                    // the always-dark module
}

function placeData(m, codewords) {
  const { size, modules, isFn } = m;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m, mask) {
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
    if (!m.isFn[y][x] && MASKS[mask](x, y)) m.modules[y][x] = !m.modules[y][x];
  }
}

function penalty(mod, size) {
  let score = 0;
  const lineScore = (get) => {
    let s = 0;
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) s += 3 + (run - 5);
      // finder-like 1:1:3:1:1 patterns with 4 light modules on a side
      const bitsStr = Array.from({ length: size }, (_, b) => (get(a, b) ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) {
        let idx = bitsStr.indexOf(pat);
        while (idx !== -1) { s += 40; idx = bitsStr.indexOf(pat, idx + 1); }
      }
    }
    return s;
  };
  score += lineScore((y, x) => mod[y][x]);
  score += lineScore((x, y) => mod[y][x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = mod[y][x];
    if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
  }
  let dark = 0;
  for (const row of mod) for (const c of row) if (c) dark++;
  const k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
  return score + Math.max(0, k) * 10;
}

/** Encode text and return a square boolean matrix (true = dark). */
function encode(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
    if (Math.ceil(need / 8) <= dataCapacity(v)) { version = v; break; }
  }
  if (!version) throw new Error('Text is too long for the QR encoder (213 bytes max)');
  const codewords = buildCodewords(bytes, version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = makeMatrix(version);
    placeData(m, codewords);
    applyMask(m, mask);
    drawFormat(m.modules, m.isFn, m.size, mask);
    const score = penalty(m.modules, m.size);
    if (!best || score < best.score) best = { score, modules: m.modules, size: m.size };
  }
  return best.modules;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function toSvg(text, { dark = '#14171a', light = '#ffffff', quiet = 4, px = 8 } = {}) {
  const modules = encode(text);
  const n = modules.length;
  const fg = HEX.test(dark) ? dark : '#14171a';
  const bg = HEX.test(light) ? light : '#ffffff';
  const total = n + quiet * 2;
  let path = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!modules[y][x]) { x++; continue; }
      let run = 1;
      while (x + run < n && modules[y][x + run]) run++;
      path += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * px}" height="${total * px}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toPng(text, { quiet = 4, scale = 10 } = {}) {
  const modules = encode(text);
  const n = modules.length;
  const total = (n + quiet * 2) * scale;
  const raw = Buffer.alloc((total + 1) * total, 255);
  for (let py = 0; py < total; py++) {
    raw[py * (total + 1)] = 0;                                   // filter type: none
    const my = Math.floor(py / scale) - quiet;
    if (my < 0 || my >= n) continue;
    for (let px = 0; px < total; px++) {
      const mx = Math.floor(px / scale) - quiet;
      if (mx >= 0 && mx < n && modules[my][mx]) raw[py * (total + 1) + 1 + px] = 0;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(total, 0); ihdr.writeUInt32BE(total, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { encode, toSvg, toPng };
