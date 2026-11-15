// Draws the base room, the zones and every avatar on one canvas.
// The background is painted once at 16 px per tile and scaled up crisply;
// names and labels are drawn at screen resolution so they stay sharp.

import { TILE, COLS, ROWS, SCREEN, FLOOR, SEATS, TEACHER_SPOT, BALL_HOME, TROPHY_SLOTS, zones, seatAt, LETTERS } from './world.js';
import { drawTrophy, TROPHY_SIZE } from './trophies.js';
import { drawAvatar, drawHat, hatRise, drawEmote, drawCat, drawProp, drawBall, drawTile, tileset, whenReady } from './sprites.js';

const W = COLS * TILE;
const H = ROWS * TILE;
const ZONE_COLORS = ['#4cb3ff', '#ffcf4a', '#5ee08a', '#ff8ad8', '#c39bff', '#ff9f5a'];
const LINE_COLORS = ['#4cb3ff', '#ffcf4a']; // the two ends of an opinion line

// Tile ids in the office tileset (see sprites.js).
const T = {
  wood: [0, 1], wall: 2, wallDark: 4, window: 3, window2: 20, exitDoor: 12, chart: 11, board: 43,
  chair: 6, pcDesk: 34, plant: 7, plants: [26, 27, 28, 29], lamp: 18, coffee: 9, cooler: 13, printer: 14,
  sofa: [37, 38, 39], tdesk: [40, 41, 42], pingpong: [[56, 57, 58], [64, 65, 66]],
};

function paintBackground(tiles) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (!tiles) {
    g.fillStyle = '#2a2145';
    g.fillRect(0, 0, W, H);
    return c;
  }
  const put = (id, x, y) => drawTile(g, id, x, y, TILE);
  // floor: wooden boards, with a little variety
  for (let y = 6; y < ROWS; y++) for (let x = 0; x < COLS; x++) put(T.wood[(x * 7 + y * 3) % 5 === 0 ? 1 : 0], x, y);
  // the front wall
  for (let y = 0; y < 7; y++) for (let x = 0; x < COLS; x++) put(y === 0 ? T.wallDark : T.wall, x, y);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 6.5 * TILE, W, 2);
  for (const x of [3, 4, 5, 26, 27, 28]) put(T.window, x, 2);
  for (const x of [3, 4, 5, 26, 27, 28]) put(T.window2, x, 3);
  put(T.exitDoor, 1, 6);
  // screen frame (the page itself is an iframe laid over this)
  const sx = SCREEN.x * TILE;
  const sy = SCREEN.y * TILE;
  const sw = SCREEN.w * TILE;
  const sh = SCREEN.h * TILE;
  g.fillStyle = '#0b0716';
  g.fillRect(sx - 4, sy - 4, sw + 8, sh + 8);
  g.fillStyle = '#f3e9d2';
  g.fillRect(sx - 2, sy - 2, sw + 4, sh + 4);
  g.fillStyle = '#ffffff';
  g.fillRect(sx, sy, sw, sh);
  // front of the room: plants, a flip chart, the teacher's desk
  put(T.plant, 0, 6.6);
  put(T.plant, 31, 6.6);
  put(T.chart, 2, 7);
  put(T.lamp, 30, 7);
  T.tdesk.forEach((id, i) => put(id, TEACHER_SPOT.x - 1 + i, 7));
  // seats: a desk with a computer in front, a chair behind
  for (const s of SEATS) {
    put(T.pcDesk, s.x, s.y - 1);
    put(T.chair, s.x, s.y);
  }
  // back of the room: a break corner
  put(T.coffee, 1, 16.6);
  put(T.cooler, 2, 16.6);
  put(T.printer, 3, 16.6);
  T.sofa.forEach((id, i) => put(id, 6 + i, 16.8));
  T.pingpong.forEach((row, j) => row.forEach((id, i) => put(id, 14.5 + i, 15.8 + j)));
  T.sofa.forEach((id, i) => put(id, 23 + i, 16.8));
  T.plants.forEach((id, i) => put(id, 27 + i, 16.6));
  return c;
}

// ---- the fun layer: room rewards and little effects ------------------------------
const PARTY = ['#ff5d5d', '#ffcf4a', '#5ee08a', '#4cb3ff', '#ff8ad8', '#c39bff'];
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The class cat pads between these spots. Its path depends only on the clock,
// so every screen in the room sees the cat in the same place.
const CAT_SPOTS = [[16, 7.4], [16, 16.4], [5, 16.4], [27, 16.4], [2.5, 7.6], [29.5, 7.8], [10, 16.5], [21.5, 16.4]];
const CAT_LEG = 9000; // ms: walk for the first half, then sit or nap
const rnd = (i) => {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
function catAt(now, calm) {
  if (calm) return { x: 29.5, y: 7.8, pose: 'sleep', flip: false }; // naps through explanations
  const i = Math.floor(now / CAT_LEG);
  const k = (now % CAT_LEG) / CAT_LEG;
  const a = CAT_SPOTS[Math.floor(rnd(i) * CAT_SPOTS.length)];
  const b = CAT_SPOTS[Math.floor(rnd(i + 1) * CAT_SPOTS.length)];
  const w = Math.min(1, k / 0.5);
  if (w < 1 && a !== b) return { x: a[0] + (b[0] - a[0]) * w, y: a[1] + (b[1] - a[1]) * w, pose: Math.floor(now / 180) % 2 ? 'walk' : 'stand', flip: b[0] < a[0] };
  return { x: b[0], y: b[1], pose: rnd(i + 999) < 0.35 ? 'sleep' : 'sit', flip: rnd(i + 5) < 0.5 };
}

export class Room {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.bg = paintBackground(null);
    whenReady(tileset, () => (this.bg = paintBackground(tileset)));
    this.players = new Map(); // id -> { meta, x, y, rx, ry, dir, moving, online }
    this.state = null;
    this.selfId = null;
    this.scale = 2;
    this.dpr = 1;
    this.showNames = true;
    // short-lived effects
    this.emotes = new Map(); // player id -> { e, t0 }
    this.hops = new Map(); // player id -> start time
    this.floats = []; // { id, text, color, t0 }
    this.sparks = []; // { x, y, vx, vy, color, t0 }
    this.ball = { x: BALL_HOME.x, y: BALL_HOME.y, rx: BALL_HOME.x, ry: BALL_HOME.y };
    this.skew = 0; // server clock minus ours
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
    for (let i = 0; i < n; i++)
      this.sparks.push({ x: (p.rx + 0.5) * TILE, y: (p.ry - 0.2) * TILE, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 50, color: PARTY[i % PARTY.length], t0 });
  }

  /** A short text that rises from an avatar, like "+85". */
  float(id, text, color = '#ffcf4a') {
    this.floats.push({ id, text, color, t0: performance.now() });
  }

  setBall(x, y) {
    this.ball.x = x;
    this.ball.y = y;
  }

  has(reward) {
    return !!this.state?.klass?.unlocked.includes(reward);
  }

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
    return {
      left: SCREEN.x * TILE * this.scale,
      top: SCREEN.y * TILE * this.scale,
      width: SCREEN.w * TILE * this.scale,
      height: SCREEN.h * TILE * this.scale,
    };
  }

  setState(state) {
    this.state = state;
    this.skew = (state.serverNow || Date.now()) - Date.now();
    if (state.ball) this.setBall(state.ball[0], state.ball[1]);
    // Results just came out: the points rise from each avatar.
    const q = state.question;
    const first = !this.shown;
    this.shown = this.shown || new Map();
    if (q?.status === 'revealed')
      for (const w of q.wall || []) {
        const k = `${q.key}:${w.pid}`;
        if (this.shown.get(k) === w.points) continue;
        this.shown.set(k, w.points);
        if (first) continue;
        this.float(w.pid, `+${w.points}`, w.improved ? '#5ee08a' : '#ffcf4a');
        if (w.improved) this.sparkle(w.pid, 18);
      }
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      const cur = this.players.get(p.id);
      if (cur) cur.meta = p;
      else this.players.set(p.id, { meta: p, x: p.x, y: p.y, rx: p.x, ry: p.y, dir: p.dir, moving: false, online: p.online });
    }
    for (const id of this.players.keys()) if (!seen.has(id)) this.players.delete(id);
  }

  setPositions(list) {
    for (const [id, x, y, dir, moving, online] of list) {
      const p = this.players.get(id);
      if (!p || id === this.selfId) continue;
      p.x = x;
      p.y = y;
      p.dir = dir;
      p.moving = !!moving;
      p.online = !!online;
    }
  }

  setLocal(id, x, y, dir, moving) {
    const p = this.players.get(id);
    if (!p) return;
    p.x = p.rx = x;
    p.y = p.ry = y;
    p.dir = dir;
    p.moving = moving;
    p.online = true;
  }

  draw(t) {
    const g = this.g;
    const k = this.scale * this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.bg, 0, 0, W * k, H * k);
    g.setTransform(k, 0, 0, k, 0, 0);

    const q = this.state?.question;
    const zoneQ = q && q.kind === 'choice' && q.zones ? q : null;
    const lineQ = q && q.kind === 'line' ? q : null;
    if (zoneQ) this.drawZones(zoneQ, t);
    if (lineQ) this.drawLine(lineQ);

    this.drawShelf();
    this.drawRewards(t);

    const list = [...this.players.values()].filter((p) => p.online || p.meta.id === this.selfId);
    for (const p of list) {
      p.rx += (p.x - p.rx) * 0.3;
      p.ry += (p.y - p.ry) * 0.3;
    }
    list.sort((a, b) => a.ry - b.ry);
    const spot = this.state?.spotlight?.pid;
    for (const p of list) {
      const fx = (p.rx + 0.5) * TILE;
      const fy = (p.ry + 0.85) * TILE;
      const seat = p.moving ? -1 : seatAt(p.rx, p.ry);
      p.sitting = seat >= 0 && Math.abs(p.rx - SEATS[seat].x) < 0.15 && Math.abs(p.ry - SEATS[seat].y) < 0.15;
      // a hop: a short arc, 350 ms
      const hop = this.hops.get(p.meta.id);
      const hk = hop && !p.sitting ? (t - hop) / 350 : 1;
      if (hop && hk >= 1) this.hops.delete(p.meta.id);
      const up = hk < 1 ? Math.round(Math.sin(Math.PI * hk) * 7) : 0;
      if (p.meta.id === spot) {
        // on the spot: a pool of light
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
      let head;
      const ay = p.sitting ? fy + 4 : fy - up;
      if (p.sitting) {
        head = drawAvatar(g, p.meta.avatar, 'sit', 'up', 0, fx, ay);
      } else {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(fx - 5 + (up ? 1 : 0), fy - 1, 10 - (up ? 2 : 0), 2);
        const phase = (p.meta.avatar * 97) % 400; // idle breathing out of step
        const frame = p.moving ? Math.floor(t / 130) % 4 : Math.floor((t + phase) / 280) % 4;
        head = drawAvatar(g, p.meta.avatar, p.moving ? 'walk' : 'idle', p.dir || 'down', frame, fx, ay);
      }
      if (p.meta.hat && head) drawHat(g, p.meta.hat, head, fx, ay);
      // where labels start: above the head, and above the hat if there is one
      p.labelY = fy - (p.sitting ? 17 : 25) - hatRise(p.meta.hat);
      if (p.meta.id === this.selfId) {
        const bob = Math.sin(t / 200) * 1.5;
        const top = p.labelY - 3 - up;
        g.fillStyle = '#ffcf4a';
        g.fillRect(fx - 2, top + bob, 5, 2);
        g.fillRect(fx - 1, top + 2 + bob, 3, 2);
        g.fillRect(fx, top + 4 + bob, 1, 1);
      }
    }
    this.drawSparks(t);
    this.drawEmotes(t, list);

    // labels at screen resolution
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (zoneQ) this.drawZoneLabels(zoneQ);
    if (lineQ) this.drawLineLabels(lineQ);
    if (this.showNames) {
      const size = Math.max(10, Math.round(4.2 * this.scale));
      g.font = `${size}px Monocraft, ui-monospace, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      for (const p of list) {
        const x = (p.rx + 0.5) * TILE * this.scale;
        const y = p.labelY * this.scale;
        const name = p.meta.name;
        const w = g.measureText(name).width + 8;
        g.fillStyle = 'rgba(11,7,22,0.7)';
        g.fillRect(x - w / 2, y - size - 2, w, size + 4);
        g.fillStyle = p.meta.id === this.selfId ? '#ffcf4a' : '#f6f0ff';
        g.fillText(name, x, y + 1);
      }
    }
    this.drawFloats(t);
  }

  /** Concept trophies, each on its bit of shelf on the front wall. */
  drawShelf() {
    const g = this.g;
    (this.state?.trophies || []).forEach((trophy, i) => {
      const slot = TROPHY_SLOTS[i];
      if (!slot) return;
      const x = slot.x * TILE + (TILE - TROPHY_SIZE) / 2;
      const y = slot.y * TILE;
      g.fillStyle = '#5b3a1e';
      g.fillRect(x - 1, y + TROPHY_SIZE, TROPHY_SIZE + 2, 2);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x - 1, y + TROPHY_SIZE + 2, TROPHY_SIZE + 2, 1);
      drawTrophy(g, trophy.sprite, x, y);
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
    g.fillStyle = '#1b1230';
    for (let i = 0; i <= 4; i++) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / 4), y - 2, 1, 7); // quarter marks
    if (q.status === 'revealed' && q.average !== null && q.average !== undefined) {
      // where the class stands on average
      const ax = Math.round(x0 + ((x1 - x0) * q.average) / 100);
      g.fillStyle = '#f6f0ff';
      g.fillRect(ax - 2, y - 5, 5, 2);
      g.fillRect(ax - 1, y - 3, 3, 2);
      g.fillRect(ax, y - 1, 1, 2);
    }
  }

  drawLineLabels(q) {
    const g = this.g;
    const s = this.scale;
    const size = Math.max(11, Math.round(5.5 * s));
    const y = (FLOOR.y + 1.2) * TILE * s;
    g.font = `bold ${size}px Monocraft, ui-monospace, monospace`;
    g.textBaseline = 'top';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(11,7,22,0.9)';
    g.lineWidth = Math.max(3, s * 1.6);
    [
      ['left', (FLOOR.x + 0.5) * TILE * s, `◀ ${q.labels[0]}`],
      ['right', (FLOOR.x + FLOOR.w - 0.5) * TILE * s, `${q.labels[1]} ▶`],
    ].forEach(([align, x, label], i) => {
      g.textAlign = align;
      g.fillStyle = LINE_COLORS[i];
      g.strokeText(label, x, y);
      g.fillText(label, x, y);
    });
  }

  /** What the class has earned together: lights, the cat, the games corner, the disco ball, the trophy. */
  drawRewards(t) {
    const g = this.g;
    const mode = this.state?.mode;
    const party = mode === 'review' || !!this.state?.finale;
    if (this.has('lights')) {
      const step = still() ? 0 : Math.floor(t / 450);
      for (const [x0, x1] of [[0.6, 10], [22, 31.4]]) {
        const n = 12;
        let px = null;
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const x = Math.round((x0 + (x1 - x0) * u) * TILE);
          const y = Math.round((0.7 + Math.sin(Math.PI * u) * 0.7) * TILE);
          if (px) {
            g.strokeStyle = '#1b1230';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(px[0] + 0.5, px[1] + 0.5);
            g.lineTo(x + 0.5, y + 0.5);
            g.stroke();
          }
          px = [x, y];
          if (i === 0 || i === n) continue;
          const lit = (i + step) % 3 !== 0;
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
    if (this.has('trophy')) drawProp(g, 'trophy', 23.6 * TILE, 8.1 * TILE);
    if (this.has('games')) {
      drawProp(g, 'arcade', 11 * TILE, 17.9 * TILE);
      // the ball rolls only in free roam; otherwise it waits by the machine
      const b = this.ball;
      const [bx, by] = mode === 'free' ? [b.x, b.y] : [BALL_HOME.x, BALL_HOME.y];
      b.rx += (bx - b.rx) * 0.35;
      b.ry += (by - b.ry) * 0.35;
      const x = (b.rx + 0.5) * TILE;
      const y = (b.ry + 0.85) * TILE;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x - 4, y - 1, 8, 2);
      drawBall(g, x, y);
    }
    if (this.has('disco')) {
      drawProp(g, 'disco', 8.5 * TILE, 3.4 * TILE);
      g.fillStyle = '#1b1230';
      g.fillRect(8.5 * TILE, 0, 1, 1.3 * TILE);
      if (party && !still()) {
        // slow coloured spots sweeping the floor
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
    if (this.has('cat')) {
      const c = catAt(Date.now() + this.skew, mode === 'present' || mode === 'seating' || still());
      const x = (c.x + 0.5) * TILE;
      const y = (c.y + 0.85) * TILE;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x - 5, y - 1, 10, 2);
      drawCat(g, c.pose, x, y, c.flip);
      if (c.pose === 'sleep' && !still()) {
        g.fillStyle = '#f6f0ff';
        const z = Math.floor(t / 600) % 3;
        g.fillRect(x + 6 + z, y - 16 - z * 3, 2, 1);
        g.fillRect(x + 7 + z, y - 15 - z * 3, 1, 1);
        g.fillRect(x + 6 + z, y - 14 - z * 3, 2, 1);
      }
    }
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
  drawEmotes(t, list) {
    const g = this.g;
    for (const p of list) {
      const em = this.emotes.get(p.meta.id);
      if (!em) continue;
      const age = t - em.t0;
      if (age > 2600) {
        this.emotes.delete(p.meta.id);
        continue;
      }
      const x = Math.round((p.rx + 0.5) * TILE) - 8;
      const rise = age < 120 ? 3 - Math.round(age / 40) : 0; // pops up into place
      const y = Math.round(p.labelY - (this.showNames ? 9 : 2)) - 17 + rise;
      g.globalAlpha = age > 2200 ? 1 - (age - 2200) / 400 : 1;
      g.fillStyle = '#1b1230';
      g.fillRect(x + 1, y, 14, 16);
      g.fillRect(x, y + 1, 16, 14);
      g.fillRect(x + 6, y + 16, 4, 1);
      g.fillRect(x + 7, y + 17, 2, 1);
      g.fillStyle = '#f6f0ff';
      g.fillRect(x + 2, y + 1, 12, 14);
      g.fillRect(x + 1, y + 2, 14, 12);
      g.fillRect(x + 7, y + 15, 2, 1);
      drawEmote(g, em.e, x + 2, y + 2);
      g.globalAlpha = 1;
    }
  }

  drawFloats(t) {
    const g = this.g;
    this.floats = this.floats.filter((f) => t - f.t0 < 2200);
    const size = Math.max(12, Math.round(6 * this.scale));
    g.font = `bold ${size}px Monocraft, ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineJoin = 'round';
    for (const f of this.floats) {
      const p = this.players.get(f.id);
      if (!p || p.labelY === undefined) continue;
      const k = (t - f.t0) / 2200;
      const x = (p.rx + 0.5) * TILE * this.scale;
      const y = (p.labelY - 12 - (still() ? 8 : k * 16)) * this.scale;
      g.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1;
      g.strokeStyle = 'rgba(11,7,22,0.9)';
      g.lineWidth = Math.max(3, this.scale * 1.4);
      g.strokeText(f.text, x, y);
      g.fillStyle = f.color;
      g.fillText(f.text, x, y);
    }
    g.globalAlpha = 1;
  }

  drawZones(q, t) {
    const g = this.g;
    const zs = zones(q.order.length);
    const revealed = q.status === 'revealed';
    const correct = revealed && q.correct !== null && q.correct !== undefined ? [].concat(q.correct) : [];
    zs.forEach((z, i) => {
      const opt = q.order[i];
      const col = ZONE_COLORS[i % ZONE_COLORS.length];
      const good = correct.includes(opt);
      g.globalAlpha = revealed ? (good ? 0.4 + 0.1 * Math.sin(t / 150) : 0.1) : 0.26;
      g.fillStyle = revealed && good ? '#5ee08a' : col;
      g.fillRect(z.x * TILE + 2, z.y * TILE, z.w * TILE - 4, z.h * TILE);
      g.globalAlpha = 1;
      g.strokeStyle = col;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.strokeRect(z.x * TILE + 2.5, z.y * TILE + 0.5, z.w * TILE - 5, z.h * TILE - 1);
      g.setLineDash([]);
    });
  }

  drawZoneLabels(q) {
    const g = this.g;
    const zs = zones(q.order.length);
    const s = this.scale;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(11,7,22,0.9)';
    const text = (str, x, y) => {
      g.lineWidth = Math.max(3, s * 1.6);
      g.strokeText(str, x, y);
      g.fillText(str, x, y);
    };
    zs.forEach((z, i) => {
      const opt = q.order[i];
      const x = (z.x + z.w / 2) * TILE * s;
      const y = (z.y + 0.2) * TILE * s;
      const big = Math.max(14, Math.round(10 * s));
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.font = `bold ${big}px Monocraft, ui-monospace, monospace`;
      g.fillStyle = ZONE_COLORS[i % ZONE_COLORS.length];
      text(LETTERS[i], x, y);
      const small = Math.max(9, Math.round(3.6 * s));
      g.font = `${small}px Monocraft, ui-monospace, monospace`;
      g.fillStyle = '#f6f0ff';
      const words = String(q.options[opt]).split(/\s+/);
      const maxW = z.w * TILE * s - 16;
      let line = '';
      let ly = y + big + 4;
      let lines = 0;
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (g.measureText(test).width > maxW && line) {
          text(line, x, ly);
          ly += small + 3;
          line = w;
          if (++lines >= 4) {
            line = '…';
            break;
          }
        } else line = test;
      }
      if (line) text(line, x, ly);
      if (q.counts && q.status === 'revealed') {
        g.font = `bold ${Math.max(12, Math.round(6 * s))}px Monocraft, ui-monospace, monospace`;
        g.fillStyle = '#ffcf4a';
        g.textBaseline = 'bottom';
        text(`${q.counts[opt]}`, x, (z.y + z.h - 0.2) * TILE * s);
      }
    });
  }
}

export const ROOM_SIZE = { W, H };
