// Draws a room, the answer zones and every avatar on one canvas.
//
// Three layers, back to front:
//   1. the shell: floor, front wall, windows, chairs. Painted once per room.
//   2. everything that stands on the floor: furniture, avatars, the cat, the
//      ball. Drawn every frame in "baseline" order (the line on the floor each
//      one stands on), so whoever is further down the screen is in front.
//   3. labels (names, zone letters, points) at screen resolution, so text stays sharp.

import { TILE, COLS, ROWS, SCREEN, FLOOR, TROPHY_SLOTS, zones, LETTERS } from './world.js';
import { ROOMS, BASE, DOOR, FEET, thingsIn, seatAt } from './rooms.js';
import { findPath } from './path.js';
import { drawAvatar, drawHat, hatRise, drawEmote, drawCat, drawProp, drawBall, drawTile, drawTrophy, TROPHY_SIZE, tileset, panorama, whenReady } from './sprites.js';

const W = COLS * TILE;
const H = ROWS * TILE;
export const ROOM_SIZE = { W, H };

const ZONE_COLORS = ['#4cb3ff', '#ffcf4a', '#5ee08a', '#ff8ad8', '#c39bff', '#ff9f5a'];
const LINE_COLORS = ['#4cb3ff', '#ffcf4a']; // the two ends of an opinion line
const PARTY = ['#ff5d5d', '#ffcf4a', '#5ee08a', '#4cb3ff', '#ff8ad8', '#c39bff'];
const INK = '#1b1230';
const PAPER = '#f6f0ff';
const GOLD = '#ffcf4a';
const FONT = 'Monocraft, ui-monospace, monospace';

// The front wall is glass from the low sill up to the ceiling beam, with the view behind it.
const WALL = {
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

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The glass wall: the view, a few clouds, reflections, then the frame, the sill and the door. */
function paintWall(g) {
  g.fillStyle = '#a9defa';
  g.fillRect(0, 0, W, WALL.bottom);
  if (panorama.complete && panorama.naturalWidth) g.drawImage(panorama, 0, WALL.beam);

  // small flat-bottomed clouds, to the sides of the screen
  g.fillStyle = '#ffffff';
  for (const [x, y, w] of [[26, 16, 22], [96, 30, 14], [372, 14, 18], [446, 26, 24]]) {
    g.fillRect(x, y, w, 3);
    g.fillRect(x + 3, y - 2, w - 9, 2);
    g.fillRect(x + 7, y - 4, Math.max(4, w - 16), 2);
  }

  // glass: two pale streaks of reflection on every pane
  const pane = W / WALL.panes;
  g.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < WALL.panes; i++)
    for (const [offset, width] of [[14, 7], [26, 3]]) {
      g.beginPath();
      g.moveTo(i * pane + offset + 24, WALL.beam);
      g.lineTo(i * pane + offset + 24 + width, WALL.beam);
      g.lineTo(i * pane + offset + width, WALL.sill);
      g.lineTo(i * pane + offset, WALL.sill);
      g.fill();
    }

  // the frame: ceiling beam, a thin rail, and a post between panes
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

  // the low wall under the glass, with a wooden ledge on top
  g.fillStyle = WALL.low;
  g.fillRect(0, WALL.sill, W, WALL.bottom - WALL.sill);
  g.fillStyle = WALL.ledge;
  g.fillRect(0, WALL.sill, W, 2);
  g.fillStyle = WALL.ledgeDark;
  g.fillRect(0, WALL.sill + 2, W, 1);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, WALL.bottom - 2, W, 2); // the skirting, in shadow

  // the door: a wooden leaf with a small window, and a green sign above it
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
function paintShell(roomId) {
  const room = ROOMS[roomId];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  for (let y = 7; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(g, FLOORING[room.flooring](x, y), x, y, TILE);
  paintWall(g);

  // daylight falling through each pane onto the floor
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
    // Everything solid casts a little shadow at its foot.
    else if (thing.solid) {
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(thing.solid.x * TILE + 1, (thing.solid.y + thing.solid.h) * TILE - 1, thing.solid.w * TILE - 2, 3);
    }
  }
  return c;
}

function drawThing(g, thing) {
  if (thing.def.prop) return drawProp(g, thing.def.prop, thing.x * TILE + 8, thing.y * TILE + 32);
  thing.def.tiles.forEach((row, j) => row.forEach((id, i) => drawTile(g, id, thing.x + i, thing.y + j, TILE)));
}

// ---- the class cat ---------------------------------------------------------------------
// It pads from one favourite spot to the next, around the furniture. Where it is
// depends only on the clock, so every screen in the room sees the cat in the same place.

const CAT_LEG = 9000; // ms per leg: walk for the first half, then sit or nap
const random = (i) => {
  // a fixed "random" number in [0, 1) for each whole number i
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const catRoutes = new Map(); // "from>to|rewards" -> the path between two spots

function catAt(now, calm, unlocked) {
  const spots = ROOMS[BASE].catSpots.map(([x, y]) => ({ x, y }));
  if (calm) return { ...spots[0], pose: 'sleep', flip: false }; // naps through explanations
  const leg = Math.floor(now / CAT_LEG);
  const spotOf = (n) => Math.floor(random(n) * spots.length);
  const [from, to] = [spotOf(leg), spotOf(leg + 1)];
  const walked = Math.min(1, (now % CAT_LEG) / (CAT_LEG / 2));
  if (walked < 1 && from !== to) {
    const key = `${from}>${to}|${unlocked.join()}`;
    if (!catRoutes.has(key)) catRoutes.set(key, [spots[from], ...findPath(BASE, spots[from], spots[to], unlocked)]);
    const route = catRoutes.get(key);
    const at = walked * (route.length - 1);
    const a = route[Math.floor(at)];
    const b = route[Math.min(route.length - 1, Math.floor(at) + 1)];
    const k = at - Math.floor(at);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, pose: Math.floor(now / 180) % 2 ? 'walk' : 'stand', flip: b.x < a.x };
  }
  return { ...spots[to], pose: random(leg + 999) < 0.35 ? 'sleep' : 'sit', flip: random(leg + 5) < 0.5 };
}

// ---- the room ----------------------------------------------------------------------------

export class Room {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.shells = new Map(); // room id -> painted shell
    for (const image of [tileset, panorama]) whenReady(image, () => this.shells.clear()); // repaint once the art has loaded
    this.players = new Map(); // id -> { meta, x, y, rx, ry, dir, moving, online }
    this.state = null;
    this.roomId = BASE;
    this.selfId = null;
    this.scale = 2;
    this.dpr = 1;
    this.showNames = true;
    this.target = null; // { x, y }: where a tap is sending our avatar
    this.cat = null; // { x, y, pose }: where the class cat is, once the class has one
    // short-lived effects
    this.emotes = new Map(); // player id -> { e, t0 }
    this.hops = new Map(); // player id -> start time
    this.floats = []; // { id, text, color, t0 }
    this.sparks = []; // { x, y, vx, vy, color, t0 }
    this.ball = { x: 0, y: 0, rx: 0, ry: 0 };
    this.skew = 0; // server clock minus ours
  }

  // ---- what the server tells us ------------------------------------------------------------

  setState(state) {
    const moved = state.room !== this.roomId; // the class walked into another room
    this.state = state;
    this.roomId = state.room;
    this.skew = (state.serverNow || Date.now()) - Date.now();
    if (state.ball) this.setBall(state.ball[0], state.ball[1]);
    this.showNewPoints(state.question);

    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      const cur = this.players.get(p.id);
      if (!cur) this.players.set(p.id, { meta: p, x: p.x, y: p.y, rx: p.x, ry: p.y, dir: p.dir, moving: false, online: p.online });
      else {
        // The server put this player somewhere (a seat, another room): no gliding across the room.
        if (moved || p.warp !== cur.meta.warp) Object.assign(cur, { x: p.x, y: p.y, rx: p.x, ry: p.y, dir: p.dir, moving: false });
        cur.meta = p;
      }
    }
    for (const id of this.players.keys()) if (!seen.has(id)) this.players.delete(id);
  }

  /** Results just came out: the points rise from each avatar. */
  showNewPoints(q) {
    const first = !this.shownPoints;
    this.shownPoints ||= new Map();
    if (q?.status !== 'revealed') return;
    for (const card of q.wall || []) {
      const key = `${q.key}:${card.pid}`;
      if (this.shownPoints.get(key) === card.points) continue;
      this.shownPoints.set(key, card.points);
      if (first) continue; // a page reload is not news
      for (const id of card.ids) {
        this.float(id, `+${card.points}`, card.improved ? '#5ee08a' : GOLD);
        if (card.improved) this.sparkle(id, 18);
      }
    }
  }

  setPositions(list) {
    for (const [id, x, y, dir, moving, online] of list) {
      const p = this.players.get(id);
      if (!p || id === this.selfId) continue; // our own avatar moves here first
      Object.assign(p, { x, y, dir, moving: !!moving, online: !!online });
    }
  }

  /** Our own avatar: moved by the keys on this page, without waiting for the server. */
  setLocal(id, x, y, dir, moving) {
    const p = this.players.get(id);
    if (p) Object.assign(p, { x, y, rx: x, ry: y, dir, moving, online: true });
  }

  setBall(x, y) {
    this.ball.x = x;
    this.ball.y = y;
  }

  /** An event from the server's fx stream. */
  fx(ev) {
    const t = performance.now();
    if (ev.t === 'emote') this.emotes.set(ev.id, { e: ev.e, t0: t });
    if (ev.t === 'hop' && !still()) this.hops.set(ev.id, t);
    if (ev.t === 'handin') this.sparkle(ev.id);
  }

  /** A few pixels of confetti popping out of one avatar. */
  sparkle(id, n = 12) {
    const p = this.players.get(id);
    if (!p || still()) return;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.sparks.push({ x: (p.rx + 0.5) * TILE, y: (p.ry - 0.2) * TILE, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 50, color: PARTY[i % PARTY.length], t0 });
  }

  /** A short text that rises from an avatar, like "+85". */
  float(id, text, color = GOLD) {
    this.floats.push({ id, text, color, t0: performance.now() });
  }

  /** The class rewards in the room (see fun.js). */
  get unlocked() {
    return this.state?.klass?.unlocked || [];
  }

  has(reward) {
    return this.roomId === BASE && this.unlocked.includes(reward);
  }

  // ---- size and coordinates ------------------------------------------------------------------

  fit(availW, availH) {
    const s = Math.min(availW / W, availH / H);
    this.scale = s >= 1 ? Math.max(1, Math.floor(s * 2) / 2) : s;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${W * this.scale}px`;
    this.canvas.style.height = `${H * this.scale}px`;
    this.canvas.width = Math.round(W * this.scale * this.dpr);
    this.canvas.height = Math.round(H * this.scale * this.dpr);
  }

  /** Where the screen sits, in CSS px relative to the canvas's top-left corner. */
  screenRect() {
    const s = TILE * this.scale;
    return { left: SCREEN.x * s, top: SCREEN.y * s, width: SCREEN.w * s, height: SCREEN.h * s };
  }

  /** A click or tap on the page, as a player position in the room (so the feet land on the tap). */
  spotAt(clientX, clientY) {
    const box = this.canvas.getBoundingClientRect();
    const s = TILE * this.scale;
    return { x: (clientX - box.left) / s - FEET.x, y: (clientY - box.top) / s - FEET.y };
  }

  // ---- drawing ---------------------------------------------------------------------------------

  draw(t) {
    const g = this.g;
    const k = this.scale * this.dpr;
    if (!this.shells.has(this.roomId)) this.shells.set(this.roomId, paintShell(this.roomId));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.shells.get(this.roomId), 0, 0, W * k, H * k);
    g.setTransform(k, 0, 0, k, 0, 0);

    // on the floor and the wall, under everything that stands
    const q = this.state?.question;
    const zoneQ = q?.kind === 'choice' && q.zones ? q : null;
    const lineQ = q?.kind === 'line' ? q : null;
    if (zoneQ) this.drawZones(zoneQ, t);
    if (lineQ) this.drawLine(lineQ);
    if (this.state?.door) this.drawOpenDoor(t);
    if (this.target) this.drawTarget(t);
    this.drawShelf();
    this.drawWallRewards(t);

    // everything that stands on the floor, back to front
    const players = [...this.players.values()].filter((p) => (p.online || p.meta.id === this.selfId) && !p.meta.gone);
    for (const p of players) {
      p.rx += (p.x - p.rx) * 0.3; // glide towards where the server says they are
      p.ry += (p.y - p.ry) * 0.3;
    }
    const standing = [
      ...thingsIn(this.roomId, this.unlocked).filter((thing) => !thing.def.flat).map((thing) => ({ baseline: thing.baseline, draw: () => drawThing(g, thing) })),
      ...players.map((p) => ({ baseline: p.ry + FEET.y, draw: () => this.drawPlayer(p, t) })),
      ...this.floorRewards(t),
    ];
    standing.sort((a, b) => a.baseline - b.baseline);
    for (const item of standing) item.draw();

    this.drawSparks(t);
    this.drawEmotes(t, players);

    // labels at screen resolution
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (zoneQ) this.drawZoneLabels(zoneQ);
    if (lineQ) this.drawLineLabels(lineQ);
    if (this.showNames) this.drawNames(players);
    this.drawFloats(t);
  }

  /** One avatar: standing, walking, hopping or sitting, with its hat and the marks around it. */
  drawPlayer(p, t) {
    const g = this.g;
    const id = p.meta.id;
    const fx = (p.rx + FEET.x) * TILE; // the point between the feet
    const fy = (p.ry + FEET.y) * TILE;
    const chair = ROOMS[this.roomId].seats[p.moving ? -1 : seatAt(this.roomId, p.rx, p.ry)];
    p.sitting = !!chair && Math.abs(p.rx - chair.x) < 0.15 && Math.abs(p.ry - chair.y) < 0.15;

    // a hop: a short arc, 350 ms
    const hopStart = this.hops.get(id);
    const hop = hopStart && !p.sitting ? (t - hopStart) / 350 : 1;
    if (hopStart && hop >= 1) this.hops.delete(id);
    const up = hop < 1 ? Math.round(Math.sin(Math.PI * hop) * 7) : 0;

    if (id === this.state?.spotlight?.pid) this.drawSpotlight(fx, fy);
    const mates = this.state?.me?.partners || [];
    if (mates.length && (id === this.selfId || mates.some((mate) => mate.id === id))) {
      // pair work: a ring under you and your partner
      g.strokeStyle = '#5ee08a';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(fx, fy - 1, 9, 3.5, 0, 0, Math.PI * 2);
      g.stroke();
    }

    let head;
    const ay = p.sitting ? fy + 4 : fy - up;
    if (p.sitting) head = drawAvatar(g, p.meta.avatar, 'sit', 'up', 0, fx, ay);
    else {
      g.fillStyle = 'rgba(0,0,0,0.3)'; // the shadow shrinks a little during a hop
      g.fillRect(fx - 5 + (up ? 1 : 0), fy - 1, 10 - (up ? 2 : 0), 2);
      const phase = (p.meta.avatar * 97) % 400; // idle breathing out of step with the others
      const frame = p.moving ? Math.floor(t / 130) % 4 : Math.floor((t + phase) / 280) % 4;
      head = drawAvatar(g, p.meta.avatar, p.moving ? 'walk' : 'idle', p.dir || 'down', frame, fx, ay);
    }
    if (p.meta.hat && head) drawHat(g, p.meta.hat, head, fx, ay);
    // where labels start: above the head, and above the hat if there is one
    p.labelY = fy - (p.sitting ? 17 : 25) - hatRise(p.meta.hat);

    if (id === this.selfId) {
      // a small bobbing arrow: "this one is you"
      const top = p.labelY - 3 - up + Math.sin(t / 200) * 1.5;
      g.fillStyle = GOLD;
      g.fillRect(fx - 2, top, 5, 2);
      g.fillRect(fx - 1, top + 2, 3, 2);
      g.fillRect(fx, top + 4, 1, 1);
    }
  }

  /** On the spot: a pool of light. */
  drawSpotlight(fx, fy) {
    const g = this.g;
    g.fillStyle = 'rgba(255, 233, 150, 0.16)';
    g.beginPath();
    g.moveTo(fx - 3, fy - 60);
    g.lineTo(fx + 3, fy - 60);
    g.lineTo(fx + 12, fy);
    g.lineTo(fx - 12, fy);
    g.fill();
    g.fillStyle = 'rgba(255, 233, 150, 0.4)';
    g.beginPath();
    g.ellipse(fx, fy, 12, 4, 0, 0, Math.PI * 2);
    g.fill();
  }

  /** The door is open: it glows, and arrows on the floor point at it. */
  drawOpenDoor(t) {
    const g = this.g;
    const x = DOOR.x * TILE;
    const y = (DOOR.y - 1) * TILE;
    const pulse = still() ? 0.6 : 0.45 + 0.3 * Math.sin(t / 220);
    g.fillStyle = GOLD;
    g.globalAlpha = pulse;
    g.fillRect(x + 1, 70, 14, WALL.bottom - 70); // light through the doorway
    g.globalAlpha = 0.25 + pulse * 0.4;
    g.fillRect(x - 2, y + TILE, 20, 14); // and spilling onto the floor
    g.globalAlpha = 1;
    const slide = still() ? 0 : Math.floor(t / 250) % 3;
    g.fillStyle = INK;
    for (let i = 0; i < 3; i++) {
      // three little arrows walking towards the door
      const ax = x + 26 + i * 9 - slide * 3;
      const ay = y + TILE + 6;
      g.fillRect(ax + 1, ay - 2, 1, 5);
      g.fillRect(ax, ay - 1, 1, 3);
      g.fillRect(ax - 1, ay, 1, 1);
    }
  }

  /** Where a tap is sending our avatar: a small pulsing ring on the floor. */
  drawTarget(t) {
    const g = this.g;
    const r = 3 + (still() ? 0 : Math.sin(t / 150));
    g.strokeStyle = GOLD;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse((this.target.x + FEET.x) * TILE, (this.target.y + FEET.y) * TILE, r * 1.6, r * 0.7, 0, 0, Math.PI * 2);
    g.stroke();
  }

  /** Concept trophies, each on its bit of shelf on the front wall. */
  drawShelf() {
    const g = this.g;
    (this.state?.trophies || []).forEach((trophy, i) => {
      const slot = TROPHY_SLOTS[i];
      if (!slot) return;
      const x = slot.x * TILE;
      const y = slot.y * TILE - 3;
      g.fillStyle = '#5b3a1e';
      g.fillRect(x, y + TROPHY_SIZE - 1, TROPHY_SIZE, 2);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, y + TROPHY_SIZE + 1, TROPHY_SIZE, 1);
      drawTrophy(g, trophy.sprite, x, y);
    });
  }

  /** Class rewards on the wall and ceiling: fairy lights and the disco ball. */
  drawWallRewards(t) {
    const g = this.g;
    if (this.has('lights')) {
      const blink = still() ? 0 : Math.floor(t / 450);
      for (const [x0, x1] of [[0.6, 10], [22, 31.4]]) {
        const bulbs = 12;
        let last = null;
        for (let i = 0; i <= bulbs; i++) {
          const u = i / bulbs;
          const x = Math.round((x0 + (x1 - x0) * u) * TILE);
          const y = Math.round((0.7 + Math.sin(Math.PI * u) * 0.7) * TILE); // the string sags in the middle
          if (last) {
            g.strokeStyle = INK;
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(last[0] + 0.5, last[1] + 0.5);
            g.lineTo(x + 0.5, y + 0.5);
            g.stroke();
          }
          last = [x, y];
          if (i === 0 || i === bulbs) continue;
          const lit = (i + blink) % 3 !== 0;
          g.fillStyle = PARTY[i % PARTY.length];
          g.globalAlpha = lit ? 1 : 0.45;
          g.fillRect(x - 1, y + 1, 3, 3);
          if (lit) {
            g.globalAlpha = 0.25;
            g.fillRect(x - 2, y, 5, 5);
          }
          g.globalAlpha = 1;
        }
      }
    }
    if (this.has('disco')) {
      drawProp(g, 'disco', 8.5 * TILE, 3.4 * TILE);
      g.fillStyle = INK;
      g.fillRect(8.5 * TILE, 0, 1, 1.3 * TILE);
      const party = this.state.mode === 'review' || !!this.state.finale;
      if (party && !still()) {
        // slow coloured spots sweeping the floor at results time
        for (let i = 0; i < 6; i++) {
          const a = t / 1400 + (i * Math.PI) / 3;
          g.fillStyle = PARTY[i];
          g.globalAlpha = 0.16;
          g.beginPath();
          g.ellipse((16 + Math.cos(a) * (6 + i * 1.4)) * TILE, (12 + Math.sin(a * 1.3) * 3.6) * TILE, 22, 9, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
    }
  }

  /** Class rewards that move about on the floor: the ball and the cat. Sorted in with everything else. */
  floorRewards(t) {
    const g = this.g;
    const out = [];
    const mode = this.state?.mode;
    const shadow = (x, y, w) => {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x - w / 2, y - 1, w, 2);
    };
    if (this.has('games')) {
      // the ball rolls only in free roam; otherwise it waits by the arcade machine
      const b = this.ball;
      const home = ROOMS[BASE].ballHome;
      const [bx, by] = mode === 'free' ? [b.x, b.y] : [home.x, home.y];
      b.rx += (bx - b.rx) * 0.35;
      b.ry += (by - b.ry) * 0.35;
      const x = (b.rx + FEET.x) * TILE;
      const y = (b.ry + FEET.y) * TILE;
      out.push({ baseline: b.ry + FEET.y, draw: () => (shadow(x, y, 8), drawBall(g, x, y)) });
    }
    if (this.has('cat')) {
      const cat = catAt(Date.now() + this.skew, mode === 'present' || mode === 'seating' || still(), this.unlocked);
      this.cat = cat; // where it is now, for the student page (press E to pet it)
      const x = (cat.x + FEET.x) * TILE;
      const y = (cat.y + FEET.y) * TILE;
      out.push({
        baseline: cat.y + FEET.y,
        draw: () => {
          shadow(x, y, 10);
          drawCat(g, cat.pose, x, y, cat.flip);
          if (cat.pose !== 'sleep' || still()) return;
          g.fillStyle = PAPER; // a little "z" drifting up
          const z = Math.floor(t / 600) % 3;
          g.fillRect(x + 6 + z, y - 16 - z * 3, 2, 1);
          g.fillRect(x + 7 + z, y - 15 - z * 3, 1, 1);
          g.fillRect(x + 6 + z, y - 14 - z * 3, 2, 1);
        },
      });
    }
    return out;
  }

  drawSparks(t) {
    const g = this.g;
    this.sparks = this.sparks.filter((s) => t - s.t0 < 900);
    for (const s of this.sparks) {
      const k = (t - s.t0) / 1000;
      g.fillStyle = s.color;
      g.fillRect(Math.round(s.x + s.vx * k), Math.round(s.y + s.vy * k + 120 * k * k), 2, 2);
    }
  }

  /** Emote bubbles: a small white bubble over the head for a couple of seconds. */
  drawEmotes(t, players) {
    const g = this.g;
    for (const p of players) {
      const emote = this.emotes.get(p.meta.id);
      if (!emote) continue;
      const age = t - emote.t0;
      if (age > 2600) {
        this.emotes.delete(p.meta.id);
        continue;
      }
      const x = Math.round((p.rx + 0.5) * TILE) - 8;
      const rise = age < 120 ? 3 - Math.round(age / 40) : 0; // pops up into place
      const y = Math.round(p.labelY - (this.showNames ? 9 : 2)) - 17 + rise;
      g.globalAlpha = age > 2200 ? 1 - (age - 2200) / 400 : 1;
      g.fillStyle = INK;
      g.fillRect(x + 1, y, 14, 16);
      g.fillRect(x, y + 1, 16, 14);
      g.fillRect(x + 6, y + 16, 4, 1);
      g.fillRect(x + 7, y + 17, 2, 1);
      g.fillStyle = PAPER;
      g.fillRect(x + 2, y + 1, 12, 14);
      g.fillRect(x + 1, y + 2, 14, 12);
      g.fillRect(x + 7, y + 15, 2, 1);
      drawEmote(g, emote.e, x + 2, y + 2);
      g.globalAlpha = 1;
    }
  }

  // ---- labels (drawn at screen resolution) -------------------------------------------------------

  /** Text with a dark outline, readable on any floor. */
  outlined(text, x, y) {
    const g = this.g;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(11,7,22,0.9)';
    g.lineWidth = Math.max(3, this.scale * 1.6);
    g.strokeText(text, x, y);
    g.fillText(text, x, y);
  }

  drawNames(players) {
    const g = this.g;
    const size = Math.max(10, Math.round(4.2 * this.scale));
    g.font = `${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (const p of players) {
      if (p.labelY === undefined) continue;
      const x = (p.rx + 0.5) * TILE * this.scale;
      const y = p.labelY * this.scale;
      const w = g.measureText(p.meta.name).width + 8;
      g.fillStyle = 'rgba(11,7,22,0.7)';
      g.fillRect(x - w / 2, y - size - 2, w, size + 4);
      g.fillStyle = p.meta.id === this.selfId ? GOLD : PAPER;
      g.fillText(p.meta.name, x, y + 1);
    }
  }

  drawFloats(t) {
    const g = this.g;
    this.floats = this.floats.filter((f) => t - f.t0 < 2200);
    g.font = `bold ${Math.max(12, Math.round(6 * this.scale))}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (const f of this.floats) {
      const p = this.players.get(f.id);
      if (!p || p.labelY === undefined) continue;
      const k = (t - f.t0) / 2200;
      g.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1;
      g.fillStyle = f.color;
      this.outlined(f.text, (p.rx + 0.5) * TILE * this.scale, (p.labelY - 12 - (still() ? 8 : k * 16)) * this.scale);
    }
    g.globalAlpha = 1;
  }

  // ---- answering by standing: zones and the opinion line -------------------------------------------

  drawZones(q, t) {
    const g = this.g;
    const revealed = q.status === 'revealed';
    const correct = revealed && q.correct !== null && q.correct !== undefined ? [].concat(q.correct) : [];
    zones(q.order.length).forEach((z, i) => {
      const color = ZONE_COLORS[i % ZONE_COLORS.length];
      const right = correct.includes(q.order[i]);
      // after the reveal the right zone glows green and the others fade
      g.globalAlpha = revealed ? (right ? 0.4 + 0.1 * Math.sin(t / 150) : 0.1) : 0.26;
      g.fillStyle = right ? '#5ee08a' : color;
      g.fillRect(z.x * TILE + 2, z.y * TILE, z.w * TILE - 4, z.h * TILE);
      g.globalAlpha = 1;
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.strokeRect(z.x * TILE + 2.5, z.y * TILE + 0.5, z.w * TILE - 5, z.h * TILE - 1);
      g.setLineDash([]);
    });
  }

  drawZoneLabels(q) {
    const g = this.g;
    const s = this.scale;
    zones(q.order.length).forEach((z, i) => {
      const option = q.order[i];
      const x = (z.x + z.w / 2) * TILE * s;
      const y = (z.y + 0.2) * TILE * s;
      const big = Math.max(14, Math.round(10 * s));
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.font = `bold ${big}px ${FONT}`;
      g.fillStyle = ZONE_COLORS[i % ZONE_COLORS.length];
      this.outlined(LETTERS[i], x, y);

      // the option's words, wrapped to the zone's width, four lines at most
      const small = Math.max(9, Math.round(3.6 * s));
      g.font = `${small}px ${FONT}`;
      g.fillStyle = PAPER;
      const maxWidth = z.w * TILE * s - 16;
      const lines = [''];
      for (const word of String(q.options[option]).split(/\s+/)) {
        const longer = lines.at(-1) ? `${lines.at(-1)} ${word}` : word;
        if (g.measureText(longer).width <= maxWidth || !lines.at(-1)) lines[lines.length - 1] = longer;
        else lines.push(word);
      }
      if (lines.length > 4) lines.splice(4, Infinity, '…');
      lines.forEach((line, n) => this.outlined(line, x, y + big + 4 + n * (small + 3)));

      if (q.counts && q.status === 'revealed') {
        g.font = `bold ${Math.max(12, Math.round(6 * s))}px ${FONT}`;
        g.fillStyle = GOLD;
        g.textBaseline = 'bottom';
        this.outlined(`${q.counts[option]}`, x, (z.y + z.h - 0.2) * TILE * s);
      }
    });
  }

  /** An opinion line: the floor fades from one colour to the other, with a ruler along the front. */
  drawLine(q) {
    const g = this.g;
    const x0 = (FLOOR.x + 0.5) * TILE;
    const x1 = (FLOOR.x + FLOOR.w - 0.5) * TILE;
    const y = (FLOOR.y + 0.55) * TILE;
    const fade = g.createLinearGradient(x0, 0, x1, 0);
    fade.addColorStop(0, LINE_COLORS[0]);
    fade.addColorStop(1, LINE_COLORS[1]);
    g.fillStyle = fade;
    g.globalAlpha = 0.14;
    g.fillRect(FLOOR.x * TILE, (FLOOR.y + 1) * TILE, FLOOR.w * TILE, (FLOOR.h - 1) * TILE);
    g.globalAlpha = 1;
    g.fillRect(x0, y, x1 - x0, 3);
    g.fillStyle = INK;
    for (let i = 0; i <= 4; i++) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / 4), y - 2, 1, 7); // quarter marks
    if (q.status === 'revealed' && q.average !== null && q.average !== undefined) {
      // where the class stands on average
      const ax = Math.round(x0 + ((x1 - x0) * q.average) / 100);
      g.fillStyle = PAPER;
      g.fillRect(ax - 2, y - 5, 5, 2);
      g.fillRect(ax - 1, y - 3, 3, 2);
      g.fillRect(ax, y - 1, 1, 2);
    }
  }

  drawLineLabels(q) {
    const g = this.g;
    const s = this.scale;
    const y = (FLOOR.y + 1.2) * TILE * s;
    g.font = `bold ${Math.max(11, Math.round(5.5 * s))}px ${FONT}`;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillStyle = LINE_COLORS[0];
    this.outlined(`◀ ${q.labels[0]}`, (FLOOR.x + 0.5) * TILE * s, y);
    g.textAlign = 'right';
    g.fillStyle = LINE_COLORS[1];
    this.outlined(`${q.labels[1]} ▶`, (FLOOR.x + FLOOR.w - 0.5) * TILE * s, y);
  }
}
