// The rooms, as data, and the rules for walking in them. Shared by the server
// (which decides where a player may stand) and the browser (which draws the
// room and moves your own avatar without waiting for the server).
//
// Every room has the same shell: 32 x 18 tiles, the front wall with the big
// screen, the door on the left, the same floor area (see world.js). What
// changes is the flooring and the things standing in it.
//
//   base   the classroom: where every explanation happens
//   floor  an open floor, for zones and opinion lines
//   lab    a workshop with tables for two, for pair work and code
//
// To add a room: add an entry to ROOMS. To add a kind of furniture: add it to
// things.js. Positions are in tiles, measured from the room's top-left corner
// to the thing's top-left corner.

import { FLOOR, TILE } from './world.js';
import { THINGS, thingSize } from './things.js';

// ---- the classroom ---------------------------------------------------------------------

const DESK_ROWS = [9, 11, 13, 15]; // where the chairs are; each desk is one tile further up
const DESK_COLS = [4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 26, 28];
const DESK_SEATS = DESK_ROWS.flatMap((y) => DESK_COLS.map((x) => ({ x, y })));

const base = {
  id: 'base',
  name: 'Classroom',
  flooring: 'wood',
  seats: DESK_SEATS,
  things: [
    ['plant', 0, 6.6],
    ['plant', 31, 6.6],
    ['chart', 2, 7],
    ['teacherDesk', 27, 7],
    ['lamp', 30, 7],
    ...DESK_SEATS.flatMap((s) => [
      ['desk', s.x, s.y - 1],
      ['chair', s.x, s.y],
    ]),
    // the break corner along the back wall
    ['coffee', 1, 16.6],
    ['cooler', 2, 16.6],
    ['printer', 3, 16.6],
    ['sofa', 6, 16.8],
    ['pingpong', 14.5, 15.8],
    ['sofa', 23, 16.8],
    ['fern', 27, 16.6],
    ['reed', 28, 16.6],
    ['bush', 29, 16.6],
    ['ivy', 30, 16.6],
    // class rewards: the fourth entry is the class level that brings them (fun.js)
    ['arcade', 10.5, 15.9, 'games'],
    ['trophy', 20.5, 15.7, 'trophy'],
  ],
  // where the class cat likes to stop; it naps at the first one during explanations
  catSpots: [
    [29.5, 7.8],
    [16, 7.4],
    [3.4, 7.3],
    [5, 15.9],
    [27, 15.9],
    [12.5, 15.9],
    [21.8, 15.9],
    [16, 12],
  ],
  ballHome: { x: 12.5, y: 16.4 }, // where the break-time ball rests
  coffeeSpot: { x: 1, y: 16.6 }, // where students can press E in free roam to sip coffee
};

// ---- the open floor ----------------------------------------------------------------------

const floor = {
  id: 'floor',
  name: 'Open floor',
  flooring: 'carpet',
  seats: [],
  things: [
    ['plant', 0, 6.6],
    ['plant', 31, 6.6],
    ['sofa', 3, 16.8],
    ['beanbag', 7.5, 16.6],
    ['beanbag', 9, 16.6],
    ['fern', 12, 16.6],
    ['stereo', 15, 16.7],
    ['reed', 19, 16.6],
    ['beanbag', 22, 16.6],
    ['sofa', 24, 16.8],
    ['ivy', 29, 16.6],
    ['bush', 30, 16.6],
  ],
};

// ---- the workshop: tables for two ----------------------------------------------------------

const TABLE_ROWS = [9, 12, 15];
const TABLE_COLS = [3, 7, 11, 19, 23, 27];
const TABLES = TABLE_ROWS.flatMap((y) => TABLE_COLS.map((x) => ({ x, y })));
// two chairs under each table, left then right: seats 2n and 2n + 1 share a table
const TABLE_SEATS = TABLES.flatMap((t) => [
  { x: t.x, y: t.y + 1 },
  { x: t.x + 1, y: t.y + 1 },
]);

const lab = {
  id: 'lab',
  name: 'Workshop',
  flooring: 'concrete',
  seats: TABLE_SEATS,
  things: [
    ['plant', 0, 6.6],
    ['cabinet', 28, 7],
    ['board', 29.2, 7],
    ['lamp', 30.2, 7],
    ...TABLES.map((t) => ['table', t.x, t.y]),
    ...TABLE_SEATS.map((s) => ['chair', s.x, s.y]),
    ['cabinet', 1, 16.6],
    ['printer', 2, 16.6],
    ['bench', 15, 16.7],
    ['fern', 30, 16.6],
  ],
};

export const ROOMS = { base, floor, lab };
export const BASE = 'base';

/** Where students arrive in the classroom, and where everyone enters and leaves any room. */
export const SPAWN = { x: 16, y: 7.2 };
export const DOOR = { x: 1, y: 7 }; // the spot under the door on the front wall
export const HOT_SEAT = { x: 9, y: 7.2 }; // at the front: where a student on the spot stands
const DOOR_REACH = 0.9; // this close to the door counts as walking through it

export const nearDoor = (x, y) => Math.hypot(x - DOOR.x, y - DOOR.y) < DOOR_REACH;

// ---- the things in a room -------------------------------------------------------------------

const thingsCache = new Map();

/**
 * Everything standing in a room right now, ready to draw and to bump into:
 *   { kind, def, x, y, solid: { x, y, w, h } | null, baseline }
 * `solid` is in tiles. `baseline` is the line on the floor the thing stands on;
 * drawing things and avatars in baseline order is what puts one in front of another.
 * `unlocked` lists the class rewards the room has earned (e.g. ['lights', 'cat', 'games']).
 */
export function thingsIn(roomId, unlocked = []) {
  const key = `${roomId}|${unlocked.join()}`;
  if (!thingsCache.has(key)) {
    const room = ROOMS[roomId] || ROOMS[BASE];
    const list = room.things
      .filter(([, , , reward]) => !reward || unlocked.includes(reward))
      .map(([kind, x, y]) => {
        const def = THINGS[kind];
        const [bx, by, bw, bh] = def.box || [0, 0, 0, 0];
        const solid = def.box ? { x: x + bx / TILE, y: y + by / TILE, w: bw / TILE, h: bh / TILE } : null;
        return { kind, def, x, y, solid, baseline: solid ? solid.y + solid.h : y + thingSize(def).h / TILE };
      });
    thingsCache.set(key, list);
  }
  return thingsCache.get(key);
}

// ---- standing and walking -------------------------------------------------------------------

// A player's position (x, y) is the top-left corner of the tile they fill; their
// feet touch the floor a little above that tile's bottom edge.
export const FEET = { x: 0.5, y: 0.85 }; // from the position to the point between the feet
const FOOT_BOX = { x: 0.25, y: 0.6, w: 0.5, h: 0.3 }; // the part of the player that bumps into things

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const onFloor = (x, y) => x >= FLOOR.x && x <= FLOOR.x + FLOOR.w - 1 && y >= FLOOR.y && y <= FLOOR.y + FLOOR.h - 1;

/** Can a player stand at (x, y)? On the floor, and not with their feet inside something solid. */
export function canStand(roomId, x, y, unlocked = []) {
  if (!onFloor(x, y)) return false;
  const feet = { x: x + FOOT_BOX.x, y: y + FOOT_BOX.y, w: FOOT_BOX.w, h: FOOT_BOX.h };
  return !thingsIn(roomId, unlocked).some((t) => t.solid && overlap(feet, t.solid));
}

/**
 * Walk from `from` towards `to` in small steps, sliding along whatever is in
 * the way: each step tries to move sideways and up/down separately, so bumping
 * into a desk at an angle still carries you along its edge.
 */
export function walk(roomId, from, to, unlocked = []) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.2));
  const dx = (to.x - from.x) / steps;
  const dy = (to.y - from.y) / steps;
  let { x, y } = from;
  for (let i = 0; i < steps; i++) {
    if (canStand(roomId, x + dx, y, unlocked)) x += dx;
    if (canStand(roomId, x, y + dy, unlocked)) y += dy;
  }
  return { x, y };
}

/** The free spot nearest to (x, y), looking further out ring by ring. */
export function nearestFree(roomId, x, y, unlocked = [], taken = () => false) {
  for (let r = 0; r <= 12; r += 0.5) {
    for (let dy = -r; dy <= r; dy += 0.5) {
      for (let dx = -r; dx <= r; dx += 0.5) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // only the ring's edge
        if (canStand(roomId, x + dx, y + dy, unlocked) && !taken(x + dx, y + dy)) {
          return { x: x + dx, y: y + dy };
        }
      }
    }
  }
  return { x, y };
}

/** `count` free spots fanning out from the door: where a class lands after walking through. */
export function arrivalSpots(roomId, count, unlocked = []) {
  const spots = [];
  const used = (x, y) => spots.some((s) => Math.abs(s.x - x) < 1 && Math.abs(s.y - y) < 0.5);
  for (let i = 0; i < count; i++) {
    const startX = DOOR.x + 1 + (i % 12) * 1.5;
    const startY = FLOOR.y + 0.3 + Math.floor(i / 12) * 0.5;
    spots.push(nearestFree(roomId, startX, startY, unlocked, used));
  }
  return spots;
}

// ---- seats ------------------------------------------------------------------------------------

/** Index of the chair a player at (x, y) is on, or -1. */
export function seatAt(roomId, x, y) {
  return ROOMS[roomId].seats.findIndex((s) => Math.abs(s.x - x) < 0.6 && Math.abs(s.y - y) < 0.6);
}

/** Seats two by two, neighbours along a row: where pairs sit. */
export function seatPairs(roomId) {
  const seats = ROOMS[roomId].seats;
  const pairs = [];
  for (let i = 0; i + 1 < seats.length; i += 2) {
    pairs.push([seats[i], seats[i + 1]]);
  }
  return pairs;
}
