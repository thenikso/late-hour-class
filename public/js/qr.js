// Tiny zero-dependency QR code encoder (ISO/IEC 18004, Byte mode, ECC Level L,
// Versions 1-4: up to 78 UTF-8 bytes, plenty for any classroom LAN URL).
// Drawn onto a crisp pixel <canvas> next to the join URL on the projector.

const VERSIONS = [
  { v: 1, size: 21, dataBytes: 19, ecBytes: 7, align: null },
  { v: 2, size: 25, dataBytes: 34, ecBytes: 10, align: 18 },
  { v: 3, size: 29, dataBytes: 55, ecBytes: 15, align: 22 },
  { v: 4, size: 33, dataBytes: 80, ecBytes: 20, align: 26 },
];

// ---- GF(256) arithmetic & Reed-Solomon error correction ---------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

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
  return poly;
}

function reedSolomon(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    for (let j = 0; j < ecCount; j++) {
      rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

// ---- encoding & matrix layout -----------------------------------------------------------

function formatBits(mask) {
  // ECC Level L = 01, followed by 3-bit mask index -> 15-bit BCH(15, 5) code XOR 0x5412.
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function encodeCodewords(bytes, spec) {
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode indicator
  pushBits(bytes.length, 8); // Character count (8 bits for versions 1-9)
  for (const b of bytes) pushBits(b, 8);

  const capacity = spec.dataBytes * 8;
  pushBits(0, Math.min(4, capacity - bits.length)); // Terminator
  while (bits.length % 8 !== 0) bits.push(0); // Pad to byte boundary

  const data = new Uint8Array(spec.dataBytes);
  let i = 0;
  for (; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    data[i] = byte;
  }
  const pad = [0xec, 0x11];
  for (let p = 0; i < spec.dataBytes; i++, p ^= 1) data[i] = pad[p];

  const ec = reedSolomon(data, spec.ecBytes);
  const all = new Uint8Array(data.length + ec.length);
  all.set(data);
  all.set(ec, data.length);
  return all;
}

function buildBaseMatrix(spec) {
  const n = spec.size;
  const grid = Array.from({ length: n }, () => new Uint8Array(n));
  const reserved = Array.from({ length: n }, () => new Uint8Array(n));
  const set = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    grid[r][c] = dark ? 1 : 0;
    reserved[r][c] = 1;
  };

  // Three 7x7 finder patterns with 1-module white separators.
  for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        set(fr + dr, fc + dc, inside && (inBorder || inCore));
      }
    }
  }

  // Timing patterns (row 6 and col 6).
  for (let i = 8; i < n - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment pattern for versions 2-4.
  if (spec.align !== null) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        set(spec.align + dr, spec.align + dc, dist !== 1);
      }
    }
  }

  // Reserve format info strips + mandatory dark module.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = 1;
    reserved[n - 1 - i][8] = 1;
  }
  set(n - 8, 8, true);

  return { grid, reserved };
}

function writeFormat(grid, mask) {
  const n = grid.length;
  const bits = formatBits(mask);
  const bit = (i) => (bits >> i) & 1;
  const topLeft = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const val = bit(14 - i);
    const [r, c] = topLeft[i];
    grid[r][c] = val;
    if (i < 7) grid[n - 1 - i][8] = val;
    else grid[8][n - 15 + i] = val;
  }
}

function placeData(grid, reserved, codewords) {
  const n = grid.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip vertical timing column
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (reserved[r][c]) continue;
        const dark = bitIdx < totalBits ? (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
        grid[r][c] = dark;
        bitIdx++;
      }
    }
    upward = !upward;
  }
}

/** Simple penalty heuristic (runs + balance) to pick the cleanest mask. */
function penalty(grid) {
  const n = grid.length;
  let score = 0;
  let dark = 0;
  for (let r = 0; r < n; r++) {
    let runRow = 1;
    let runCol = 1;
    for (let c = 0; c < n; c++) {
      dark += grid[r][c];
      if (c > 0) {
        runRow = grid[r][c] === grid[r][c - 1] ? runRow + 1 : 1;
        if (runRow === 5) score += 3;
        else if (runRow > 5) score += 1;

        runCol = grid[c][r] === grid[c - 1][r] ? runCol + 1 : 1;
        if (runCol === 5) score += 3;
        else if (runCol > 5) score += 1;
      }
    }
  }
  const pct = (dark * 100) / (n * n);
  return score + Math.floor(Math.abs(pct - 50) / 5) * 10;
}

/** Encode `text` into a 2D array of 0/1 modules, or null if it exceeds 78 UTF-8 bytes. */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const spec = VERSIONS.find((v) => bytes.length + 2 <= v.dataBytes);
  if (!spec) return null;
  const codewords = encodeCodewords(bytes, spec);
  const { grid: base, reserved } = buildBaseMatrix(spec);
  placeData(base, reserved, codewords);

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const candidate = base.map((row, r) =>
      row.map((cell, c) => (reserved[r][c] ? cell : cell ^ (MASKS[mask](r, c) ? 1 : 0))),
    );
    writeFormat(candidate, mask);
    const s = penalty(candidate);
    if (s < bestScore) {
      bestScore = s;
      best = candidate;
    }
  }
  return best;
}

/** Render a crisp QR code for `text` into a `<canvas>` (with a 2-module white quiet zone). */
export function qrCanvas(text, modulePx = 3) {
  const matrix = qrMatrix(text);
  if (!matrix) return null;
  const quiet = 2;
  const size = matrix.length + quiet * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size * modulePx;
  canvas.height = size * modulePx;
  canvas.className = 'qr';
  canvas.setAttribute('aria-label', `QR code for ${text}`);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#0b0716';
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) g.fillRect((c + quiet) * modulePx, (r + quiet) * modulePx, modulePx, modulePx);
    }
  }
  return canvas;
}
