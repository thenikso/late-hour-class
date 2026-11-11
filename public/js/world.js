// The base room: geometry shared by the server (rules) and the browser (drawing).
// Units are tiles. The room is 32 × 18 tiles of 16 px.

export const TILE = 16;
export const COLS = 32;
export const ROWS = 18;

// The big screen on the north wall, where the shared page appears.
// 16:9, like a real projector. The shared page renders at a fixed 1280×720 and is scaled to fit.
export const SCREEN = { x: 10.7, y: 0.3, w: 10.6, h: 5.9625 };

// Walkable floor: everything below the wall.
export const FLOOR = { x: 1, y: 7, w: 30, h: 10.4 };

export const SEAT_ROWS = [9, 11, 13, 15];
export const SEAT_COLS = [4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 26, 28];
export const SEATS = SEAT_ROWS.flatMap((y) => SEAT_COLS.map((x) => ({ x, y })));

export const TEACHER_SPOT = { x: 28, y: 6.2 };
export const SPAWN = { x: 16, y: 7.6 };
export const BALL_HOME = { x: 12.5, y: 16.4 }; // where the break-time ball rests

export const clampToFloor = (x, y) => ({
  x: Math.max(FLOOR.x, Math.min(FLOOR.x + FLOOR.w - 1, x)),
  y: Math.max(FLOOR.y, Math.min(FLOOR.y + FLOOR.h - 1, y)),
});

export function seatAt(x, y) {
  return SEATS.findIndex((s) => Math.abs(s.x - x) < 0.6 && Math.abs(s.y - y) < 0.6);
}

/** Zones split the floor into equal columns, one per option, in display order. */
export function zones(count) {
  const w = FLOOR.w / count;
  return Array.from({ length: count }, (_, i) => ({
    i,
    x: FLOOR.x + i * w,
    y: FLOOR.y + 1,
    w,
    h: FLOOR.h - 1,
  }));
}

export function zoneAt(count, x, y) {
  if (!count) return -1;
  const z = zones(count);
  const cx = x + 0.5;
  const cy = y + 0.5;
  return z.findIndex((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);
}

/** Display order of a choice question's options (deterministic shuffle by key). */
export function optionOrder(q) {
  const idx = q.options.map((_, i) => i);
  if (!q.shuffle) return idx;
  let seed = [...q.key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  for (let i = idx.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
