// Static room backdrop and the class cat's deterministic walk.
// Separated from room.js so students can read the room art independently of the
// live avatar/overlay loop.

import { TILE, COLS, ROWS, SCREEN } from './shared/world.js';
import { ROOMS, BASE, DOOR, thingsIn } from './shared/rooms.js';
import { findPath } from './shared/path.js';
import { drawProp, drawTile, panorama } from './sprites.js';

export const W = COLS * TILE;
export const H = ROWS * TILE;
export const GOLD = '#ffcf4a';

// The front wall is glass from the low sill up to the ceiling beam, with the view behind it.
export const WALL = {
  bottom: 7 * TILE, // where wall meets floor
  beam: 4, // the ceiling beam's height
  sill: 98, // top of the low wall under the glass (trophies stand on it)
  panes: 8, // glass panes across the room
  frame: '#2a2145',
  frameLight: '#51447f',
  ledge: '#c9a070',
  ledgeDark: '#8a6a45',
  low: '#3a2f5e',
};

const FLOORING = {
  wood: (x, y) => ((x * 7 + y * 3) % 5 === 0 ? 1 : 0), // two kinds of board, for a little variety
  carpet: () => 16,
  concrete: () => 55,
};

/** Draw one piece of furniture (either a prop sprite or a grid of office tiles). */
export function drawThing(g, thing) {
  if (thing.def.prop) {
    drawProp(g, thing.def.prop, thing.x * TILE + 8, thing.y * TILE + 32);
    return;
  }
  thing.def.tiles.forEach((row, j) => {
    row.forEach((id, i) => drawTile(g, id, thing.x + i, thing.y + j, TILE));
  });
}

/** The glass wall: the view, a few clouds, reflections, then the frame, the sill and the door. */
function paintWall(g) {
  g.fillStyle = '#a9defa';
  g.fillRect(0, 0, W, WALL.bottom);
  if (panorama.complete && panorama.naturalWidth) g.drawImage(panorama, 0, WALL.beam);

  // Small flat-bottomed clouds, to the sides of the screen.
  g.fillStyle = '#ffffff';
  for (const [x, y, w] of [[26, 16, 22], [96, 30, 14], [372, 14, 18], [446, 26, 24]]) {
    g.fillRect(x, y, w, 3);
    g.fillRect(x + 3, y - 2, w - 9, 2);
    g.fillRect(x + 7, y - 4, Math.max(4, w - 16), 2);
  }

  // Glass: two pale streaks of reflection on every pane.
  const pane = W / WALL.panes;
  g.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < WALL.panes; i++) {
    for (const [offset, width] of [[14, 7], [26, 3]]) {
      g.beginPath();
      g.moveTo(i * pane + offset + 24, WALL.beam);
      g.lineTo(i * pane + offset + 24 + width, WALL.beam);
      g.lineTo(i * pane + offset + width, WALL.sill);
      g.lineTo(i * pane + offset, WALL.sill);
      g.fill();
    }
  }

  // The frame: ceiling beam, a thin rail, and a post between panes.
  g.fillStyle = WALL.frame;
  g.fillRect(0, 0, W, WALL.beam);
  g.fillRect(0, 44, W, 2);
  for (let i = 0; i <= WALL.panes; i++) {
    const x = Math.min(W - 3, Math.max(0, Math.round(i * pane) - 1));
    g.fillStyle = WALL.frame;
    g.fillRect(x, 0, 3, WALL.sill);
    g.fillStyle = WALL.frameLight;
    g.fillRect(x, WALL.beam, 1, WALL.sill - WALL.beam);
  }

  // The low wall under the glass, with a wooden ledge on top.
  g.fillStyle = WALL.low;
  g.fillRect(0, WALL.sill, W, WALL.bottom - WALL.sill);
  g.fillStyle = WALL.ledge;
  g.fillRect(0, WALL.sill, W, 2);
  g.fillStyle = WALL.ledgeDark;
  g.fillRect(0, WALL.sill + 2, W, 1);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, WALL.bottom - 2, W, 2); // the skirting, in shadow

  // The door: a wooden leaf with a small window, and a green sign above it.
  const dx = DOOR.x * TILE;
  g.fillStyle = WALL.frame;
  g.fillRect(dx - 1, 68, 18, WALL.bottom - 68);
  g.fillStyle = '#8a5a2b';
  g.fillRect(dx + 1, 70, 14, WALL.bottom - 70);
  g.fillStyle = '#a9703a';
  g.fillRect(dx + 2, 71, 12, 1);
  g.fillStyle = '#bfe6fb';
  g.fillRect(dx + 4, 74, 8, 10);
  g.fillStyle = GOLD;
  g.fillRect(dx + 12, 92, 2, 2);
  g.fillStyle = '#5ee08a';
  g.fillRect(dx + 4, 63, 8, 3);
}

/** The part of a room that never changes: painted once at 16 px per tile, then scaled up crisply. */
export function paintShell(roomId) {
  const room = ROOMS[roomId];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  for (let y = 7; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      drawTile(g, FLOORING[room.flooring](x, y), x, y, TILE);
    }
  }
  paintWall(g);

  // Daylight falling through each pane onto the floor.
  const pane = W / WALL.panes;
  g.fillStyle = 'rgba(255, 244, 214, 0.09)';
  for (let i = 0; i < WALL.panes; i++) {
    g.beginPath();
    g.moveTo(i * pane + 8, WALL.bottom);
    g.lineTo((i + 1) * pane - 6, WALL.bottom);
    g.lineTo((i + 1) * pane - 22, WALL.bottom + 40);
    g.lineTo(i * pane - 8, WALL.bottom + 40);
    g.fill();
  }

  // The screen's frame. The shared page itself is an iframe laid over it.
  const [sx, sy, sw, sh] = [SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h].map((v) => v * TILE);
  g.fillStyle = '#0b0716';
  g.fillRect(sx - 4, sy - 4, sw + 8, sh + 8);
  g.fillStyle = '#f3e9d2';
  g.fillRect(sx - 2, sy - 2, sw + 4, sh + 4);
  g.fillStyle = '#ffffff';
  g.fillRect(sx, sy, sw, sh);

  for (const thing of thingsIn(roomId)) {
    // Things that lie flat on the floor (chairs) are part of the shell: avatars always go on top.
    if (thing.def.flat) drawThing(g, thing);
    else if (thing.solid) {
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(thing.solid.x * TILE + 1, (thing.solid.y + thing.solid.h) * TILE - 1, thing.solid.w * TILE - 2, 3);
    }
  }
  return c;
}

// ---- the class cat ---------------------------------------------------------------------
// It pads from one favourite spot to the next, around the furniture. Where it is
// depends only on the clock, so every screen in the room sees the cat in the same place.

const CAT_LEG = 9000; // ms per leg: walk for the first half, then sit or nap
const catRoutes = new Map(); // "from>to|rewards" -> the path between two spots

function hashInt(i) {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function catAt(now, calm, unlocked) {
  const spots = ROOMS[BASE].catSpots.map(([x, y]) => ({ x, y }));
  if (calm) return { ...spots[0], pose: 'sleep', flip: false }; // naps through explanations
  const leg = Math.floor(now / CAT_LEG);
  const spotOf = (n) => Math.floor(hashInt(n) * spots.length);
  const [from, to] = [spotOf(leg), spotOf(leg + 1)];
  const walked = Math.min(1, (now % CAT_LEG) / (CAT_LEG / 2));
  if (walked < 1 && from !== to) {
    const key = `${from}>${to}|${unlocked.join()}`;
    if (!catRoutes.has(key)) {
      catRoutes.set(key, [spots[from], ...findPath(BASE, spots[from], spots[to], unlocked)]);
    }
    const route = catRoutes.get(key);
    const at = walked * (route.length - 1);
    const a = route[Math.floor(at)];
    const b = route[Math.min(route.length - 1, Math.floor(at) + 1)];
    const k = at - Math.floor(at);
    return {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      pose: Math.floor(now / 180) % 2 ? 'walk' : 'stand',
      flip: b.x < a.x,
    };
  }
  return {
    ...spots[to],
    pose: hashInt(leg + 999) < 0.35 ? 'sleep' : 'sit',
    flip: hashInt(leg + 5) < 0.5,
  };
}
