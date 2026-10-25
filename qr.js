// Small QR code encoder: byte mode, error correction level M, versions 1-10.
// Enough for a URL of up to about 200 characters. No dependencies.
// makeQr(text) returns a square array of rows of booleans (true = dark).
//
// Written from the QR code standard (ISO/IEC 18004). The data placement and
// masking follow the approach of Project Nayuki's QR Code generator library,
// Copyright (c) Project Nayuki, MIT License:
// https://www.nayuki.io/page/qr-code-generator-library
"use strict";

// Error correction level M: [EC codewords per block, [[block count, data codewords per block], ...]]
const BLOCKS = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]],
  5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const EC_LEVEL_M = 0b00;

// GF(256) arithmetic for Reed-Solomon
const EXP = new Array(512).fill(0);
const LOG = new Array(256).fill(0);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsRemainder(data, n) {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= gfMul(g, EXP[i]); });
    gen = next;
  }
  let rem = new Array(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem = rem.slice(1).concat(0);
    for (let j = 0; j < n; j++) rem[j] ^= gfMul(gen[j + 1], factor);
  }
  return rem;
}

function codewords(data, version) {
  const [ecLen, groups] = BLOCKS[version];
  const capacity = groups.reduce((s, [n, d]) => s + n * d, 0);
  const countBits = version < 10 ? 8 : 16;
  const bits = [0, 1, 0, 0];
  for (let i = countBits - 1; i >= 0; i--) bits.push((data.length >> i) & 1);
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  for (let i = 0, n = Math.min(4, capacity * 8 - bits.length); i < n; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);

  const blocks = [];
  let pos = 0;
  for (const [n, d] of groups) {
    for (let i = 0; i < n; i++) { blocks.push(out.slice(pos, pos + d)); pos += d; }
  }
  const ecs = blocks.map((b) => rsRemainder(b, ecLen));
  const result = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) result.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) result.push(e[i]);
  return result;
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

class Matrix {
  constructor(version) {
    this.v = version;
    this.size = 17 + 4 * version;
    this.mod = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  set(x, y, dark) { this.mod[y][x] = dark; this.fn[y][x] = true; }

  drawFunctionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && x < s && y >= 0 && y < s) {
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            this.set(x, y, d !== 2 && d !== 4);
          }
        }
      }
    }
    const pos = ALIGN[this.v];
    pos.forEach((ax, i) => pos.forEach((ay, j) => {
      const last = pos.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) this.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));
    this.drawFormat(0);                 // reserve the areas; real bits drawn later
    if (this.v >= 7) {
      let rem = this.v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
      const bits = (this.v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >> i) & 1) === 1;
        const a = s - 11 + (i % 3), b = Math.floor(i / 3);
        this.set(a, b, bit);
        this.set(b, a, bit);
      }
    }
  }

  drawFormat(mask) {
    const data = (EC_LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >> i) & 1) === 1;
    const s = this.size;
    for (let i = 0; i < 6; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  }

  placeData(words) {
    const s = this.size, total = words.length * 8;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          if (!this.fn[y][x] && i < total) {
            this.mod[y][x] = ((words[i >> 3] >> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    const rule = MASKS[mask];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) if (!this.fn[y][x] && rule(x, y)) this.mod[y][x] = !this.mod[y][x];
    }
  }

  penalty() {
    const s = this.size, m = this.mod;
    let score = 0;
    const lines = m.map((row) => row).concat(Array.from({ length: s }, (_, x) => m.map((row) => row[x])));
    const finder = [true, false, true, true, true, false, true];
    for (const line of lines) {
      let run = 0, prev = null;
      for (const v of line) {
        if (v === prev) run++;
        else { if (run >= 5) score += run - 2; run = 1; prev = v; }
      }
      if (run >= 5) score += run - 2;
      for (let i = 0; i < s - 6; i++) {
        if (finder.every((f, k) => line[i + k] === f)) {
          const before = line.slice(Math.max(0, i - 4), i);
          const after = line.slice(i + 7, i + 11);
          if ((before.length === 4 && !before.some(Boolean)) || (after.length === 4 && !after.some(Boolean))) score += 40;
        }
      }
    }
    for (let y = 0; y < s - 1; y++) {
      for (let x = 0; x < s - 1; x++) {
        const v = m[y][x];
        if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
      }
    }
    const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
    score += Math.floor(Math.abs(dark * 20 - s * s * 10) / (s * s)) * 10;
    return score;
  }
}

function makeQr(text) {
  const data = Buffer.from(text, "utf8");
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const capacity = BLOCKS[v][1].reduce((s, [n, d]) => s + n * d, 0);
    if (4 + (v < 10 ? 8 : 16) + 8 * data.length <= capacity * 8) { version = v; break; }
  }
  if (!version) throw new Error("text too long for this QR encoder");
  const words = codewords([...data], version);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const mtx = new Matrix(version);
    mtx.drawFunctionPatterns();
    mtx.placeData(words);
    mtx.applyMask(mask);
    mtx.drawFormat(mask);
    const score = mtx.penalty();
    if (!best || score < best[0]) best = [score, mtx];
  }
  return best[1].mod;
}

module.exports = { makeQr };
