// The shell every room shares: its size, the screen on the front wall, the
// floor area, and how the floor is read for answers (zones, the opinion line).
// Shared by the server (rules) and the browser (drawing). Units are tiles of 16 px.
// What stands in each room is in rooms.js.

export const TILE = 16;
export const COLS = 32;
export const ROWS = 18;

// The big screen on the front wall, where the shared page appears.
// 16:9, like a real projector. The shared page renders at a fixed 1280x720 and is scaled to fit.
export const SCREEN = { x: 10.7, y: 0.3, w: 10.6, h: 5.9625 };

// Where a player can be: everything below the front wall. (A position is the
// top-left corner of the tile the player fills, so x runs from 1 to 30.)
export const FLOOR = { x: 1, y: 7, w: 30, h: 10.4 };

// Concept trophies stand on the sill under the glass wall, and on a shelf above it,
// left and right of the screen. A slot is the top-left corner of one trophy, in tiles.
const SHELF_ROWS = [5.3, 4.1];
const SHELF_COLS = [2, 3, 4, 5, 6, 7, 8, 9, 22, 23, 24, 25, 26, 27, 28, 29];
export const TROPHY_SLOTS = SHELF_ROWS.flatMap((y) => SHELF_COLS.map((x) => ({ x, y })));

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

/** Index of the floor zone containing a player at (x, y), or -1 if outside. */
export function zoneAt(count, x, y) {
  if (!count) return -1;
  const cx = x + 0.5;
  const cy = y + 0.5;
  return zones(count).findIndex((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);
}

/** The opinion line: where a player stands across the floor, from 0 (far left) to 100 (far right). */
export function lineValue(x) {
  const k = (x - FLOOR.x) / (FLOOR.w - 1);
  return Math.round(Math.max(0, Math.min(1, k)) * 100);
}

/**
 * All trophy slot indices standing in the shelf column above a player at (x, y).
 * Both the sill row (0..15) and the upper shelf row (16..31) are reachable from
 * the front strip under the glass wall.
 */
export function trophiesNear(count, x, y) {
  if (y > 8) return [];
  const limit = Math.min(count, TROPHY_SLOTS.length);
  const hits = [];
  for (let i = 0; i < limit; i++) {
    if (Math.abs(TROPHY_SLOTS[i].x - x) < 0.6) hits.push(i);
  }
  return hits;
}

/** The most recent trophy in the shelf column above (x, y), or -1 if none. */
export function trophyNear(count, x, y) {
  const hits = trophiesNear(count, x, y);
  return hits.length ? hits.at(-1) : -1;
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
