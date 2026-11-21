#!/usr/bin/env node
// Turns a big AI-drawn sprite sheet into a crisp little one. No dependencies.
//
// Image generators draw "pixel art" at 1000+ px with fuzzy edges. This tool reads
// such a sheet (items on a flat magenta background, in a grid), finds each item,
// and redraws it at game size: each small pixel takes the most common colour of
// the area it covers, then gets a dark 1 px outline like the avatars have.
//
//   node tools/cut-sprites.js in.png out.png --cols 4 --rows 2 [--cell 16] [--fit 14x12]
//        [--order 0,4,1,6] [--align bottom|center] [--no-outline]
//
// Output: one row of `cell`-sized frames (cell can be WxH, e.g. 16x32), transparent background.
// The sheets in public/assets/fun/ were drawn with `codex exec` (see public/assets/LICENSE.md).

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ---- PNG in and out (8-bit RGB or RGBA, not interlaced) -------------------------
export function readPng(file) {
  const buf = readFileSync(file);
  let pos = 8;
  let w = 0, h = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const name = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || ![2, 6].includes(type) || data[12]) throw new Error('Only 8-bit RGB/RGBA, non-interlaced PNGs');
    }
    if (name === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      px[(y * w + x) * 4] = line[x * bpp];
      px[(y * w + x) * 4 + 1] = line[x * bpp + 1];
      px[(y * w + x) * 4 + 2] = line[x * bpp + 2];
      px[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, px };
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export function writePng(file, { w, h, px }) {
  const chunk = (name, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(name, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

// ---- cutting -------------------------------------------------------------------
const OUTLINE = [27, 18, 48, 255]; // the room's darkest purple

/** Magenta-ish, or transparent: the background. */
const isBg = (r, g, b, a) => a < 128 || (r > 150 && b > 150 && g < 110 && r - g > 90 && b - g > 90);

export function cut(img, { cols, rows, cellW = 16, cellH = 16, fitW, fitH, order, align = 'bottom', outline = true }) {
  const pad = outline ? 1 : 0;
  fitW = Math.min(fitW || cellW, cellW) - pad * 2;
  fitH = Math.min(fitH || cellH, cellH) - pad * 2;
  const cells = order || Array.from({ length: cols * rows }, (_, i) => i);
  const out = { w: cells.length * cellW, h: cellH, px: new Uint8Array(cells.length * cellW * cellH * 4) };
  const at = (x, y) => (y * img.w + x) * 4;
  const bg = (x, y) => {
    const i = at(x, y);
    return isBg(img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]);
  };
  cells.forEach((cell, n) => {
    const x0 = Math.floor(((cell % cols) * img.w) / cols);
    const y0 = Math.floor((Math.floor(cell / cols) * img.h) / rows);
    const x1 = Math.floor((((cell % cols) + 1) * img.w) / cols);
    const y1 = Math.floor(((Math.floor(cell / cols) + 1) * img.h) / rows);
    // The item's bounding box inside its cell.
    let l = x1;
    let r = x0;
    let t = y1;
    let b = y0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!bg(x, y)) {
          l = Math.min(l, x);
          r = Math.max(r, x);
          t = Math.min(t, y);
          b = Math.max(b, y);
        }
      }
    }
    if (r < l) return;
    const bw = r - l + 1;
    const bh = b - t + 1;
    const k = Math.min(fitW / bw, fitH / bh);
    const tw = Math.max(1, Math.round(bw * k));
    const th = Math.max(1, Math.round(bh * k));
    const ox = n * cellW + Math.floor((cellW - tw) / 2);
    const oy = align === 'bottom' ? cellH - pad - th : Math.floor((cellH - th) / 2);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        // Most common colour of the source area this small pixel covers.
        const sx0 = l + Math.floor((tx * bw) / tw);
        const sx1 = l + Math.max(Math.floor(((tx + 1) * bw) / tw), Math.floor((tx * bw) / tw) + 1);
        const sy0 = t + Math.floor((ty * bh) / th);
        const sy1 = t + Math.max(Math.floor(((ty + 1) * bh) / th), Math.floor((ty * bh) / th) + 1);
        const buckets = new Map();
        let fg = 0;
        let all = 0;
        for (let y = sy0; y < sy1; y++) {
          for (let x = sx0; x < sx1; x++) {
            all++;
            if (bg(x, y)) continue;
            fg++;
            const i = at(x, y);
            const key = ((img.px[i] >> 5) << 6) | ((img.px[i + 1] >> 5) << 3) | (img.px[i + 2] >> 5);
            const s = buckets.get(key) || [0, 0, 0, 0];
            s[0]++;
            s[1] += img.px[i];
            s[2] += img.px[i + 1];
            s[3] += img.px[i + 2];
            buckets.set(key, s);
          }
        }
        if (fg * 2 < all) continue;
        const best = [...buckets.values()].sort((p, q) => q[0] - p[0])[0];
        const o = ((oy + ty) * out.w + ox + tx) * 4;
        out.px.set([Math.round(best[1] / best[0]), Math.round(best[2] / best[0]), Math.round(best[3] / best[0]), 255], o);
      }
    }
    if (!outline) return;
    // A 1 px dark outline around the shape, inside this cell only.
    const edge = new Set();
    const solid = (x, y) =>
      x >= n * cellW &&
      x < (n + 1) * cellW &&
      y >= 0 &&
      y < cellH &&
      out.px[(y * out.w + x) * 4 + 3] === 255 &&
      !edge.has(y * out.w + x);
    for (let y = 0; y < cellH; y++) {
      for (let x = n * cellW; x < (n + 1) * cellW; x++) {
        if (out.px[(y * out.w + x) * 4 + 3] === 0 && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
          edge.add(y * out.w + x);
        }
      }
    }
    for (const i of edge) out.px.set(OUTLINE, i * 4);
  });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cols: { type: 'string', default: '1' },
      rows: { type: 'string', default: '1' },
      cell: { type: 'string', default: '16' },
      fit: { type: 'string' },
      order: { type: 'string' },
      align: { type: 'string', default: 'bottom' },
      'no-outline': { type: 'boolean', default: false },
    },
  });
  const [src, dst] = positionals;
  if (!src || !dst) {
    console.error('Usage: node tools/cut-sprites.js in.png out.png --cols 4 --rows 2 [--cell 16|16x32] [--fit 14x12] [--order 0,4,1] [--align bottom|center] [--no-outline]');
    process.exit(1);
  }
  const [cellW, cellH = cellW] = values.cell.split('x').map(Number);
  const [fitW, fitH] = (values.fit || `${cellW}x${cellH}`).split('x').map(Number);
  const out = cut(readPng(src), {
    cols: Number(values.cols),
    rows: Number(values.rows),
    cellW,
    cellH,
    fitW,
    fitH,
    order: values.order ? values.order.split(',').map(Number) : undefined,
    align: values.align,
    outline: !values['no-outline'],
  });
  writePng(dst, out);
  console.log(`${dst}: ${out.w} x ${out.h}`);
}
