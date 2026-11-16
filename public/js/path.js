// Finding a way across a room, around the furniture: used when a student taps
// or clicks where they want to go, and by the class cat.
//
// The floor is treated as a grid of half-tile steps. A* search: keep a list of
// places to look at next, always take the one whose "steps so far + straight
// distance still to go" is smallest, and stop when the goal comes up.

import { FLOOR } from './world.js';
import { canStand } from './rooms.js';

const STEP = 0.5; // grid spacing, in tiles
const COLS = Math.round((FLOOR.w - 1) / STEP) + 1;
const ROWS = Math.floor((FLOOR.h - 1) / STEP) + 1;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const toCell = (x, y) => [Math.round((x - FLOOR.x) / STEP), Math.round((y - FLOOR.y) / STEP)];
const toSpot = (i, j) => ({ x: FLOOR.x + i * STEP, y: FLOOR.y + j * STEP });

/**
 * A list of spots to walk through from `from` to (the free grid spot nearest to) `to`,
 * or [] when there is no way. `unlocked` is the class rewards in the room (they are solid too).
 */
export function findPath(roomId, from, to, unlocked = []) {
  const free = (i, j) => i >= 0 && j >= 0 && i < COLS && j < ROWS && canStand(roomId, FLOOR.x + i * STEP, FLOOR.y + j * STEP, unlocked);
  const id = (i, j) => j * COLS + i;
  const [si, sj] = toCell(from.x, from.y);
  const [gi, gj] = nearestFreeCell(free, ...toCell(to.x, to.y));
  if (gi < 0) return [];

  const distance = (i, j) => Math.hypot(i - gi, j - gj);
  const open = [{ i: si, j: sj, cost: 0, guess: distance(si, sj) }];
  const cameFrom = new Map(); // cell id -> the cell we reached it from
  const best = new Map([[id(si, sj), 0]]); // cell id -> cheapest cost found so far

  while (open.length) {
    // take the most promising cell (a plain scan is fine for a grid this small)
    let k = 0;
    for (let n = 1; n < open.length; n++) if (open[n].guess < open[k].guess) k = n;
    const cur = open.splice(k, 1)[0];
    if (cur.i === gi && cur.j === gj) return trace(cameFrom, cur, id);

    for (const [di, dj] of NEIGHBOURS) {
      const i = cur.i + di;
      const j = cur.j + dj;
      if (!free(i, j)) continue;
      if (di && dj && (!free(cur.i + di, cur.j) || !free(cur.i, cur.j + dj))) continue; // no cutting corners
      const cost = cur.cost + Math.hypot(di, dj);
      if (cost >= (best.get(id(i, j)) ?? Infinity)) continue;
      best.set(id(i, j), cost);
      cameFrom.set(id(i, j), cur);
      open.push({ i, j, cost, guess: cost + distance(i, j) });
    }
  }
  return [];
}

/** Walk back from the goal to the start, then turn the list around. */
function trace(cameFrom, cell, id) {
  const path = [];
  for (let c = cell; c; c = cameFrom.get(id(c.i, c.j))) path.push(toSpot(c.i, c.j));
  return path.reverse().slice(1); // without the starting spot
}

/** The free cell closest to (i, j): a tap on a desk means "next to that desk". */
function nearestFreeCell(free, i, j) {
  for (let r = 0; r < 8; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && free(i + di, j + dj)) return [i + di, j + dj];
  return [-1, -1];
}
