// Draws the base room, the zones and every avatar on one canvas.
// The background is painted once at 16 px per tile and scaled up crisply;
// names and labels are drawn at screen resolution so they stay sharp.

import { TILE, COLS, ROWS, SCREEN, SEATS, TEACHER_SPOT, zones, seatAt, LETTERS } from './world.js';
import { drawAvatar, drawTile, tileset, whenReady } from './sprites.js';

const W = COLS * TILE;
const H = ROWS * TILE;
const ZONE_COLORS = ['#4cb3ff', '#ffcf4a', '#5ee08a', '#ff8ad8', '#c39bff', '#ff9f5a'];

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
    const zoneQ = q && q.kind === 'choice' && q.zones && q.status !== 'closed-hidden' ? q : null;
    if (zoneQ) this.drawZones(zoneQ, t);

    const list = [...this.players.values()].filter((p) => p.online || p.meta.id === this.selfId);
    for (const p of list) {
      p.rx += (p.x - p.rx) * 0.3;
      p.ry += (p.y - p.ry) * 0.3;
    }
    list.sort((a, b) => a.ry - b.ry);
    for (const p of list) {
      const fx = (p.rx + 0.5) * TILE;
      const fy = (p.ry + 0.85) * TILE;
      const seat = p.moving ? -1 : seatAt(p.rx, p.ry);
      p.sitting = seat >= 0 && Math.abs(p.rx - SEATS[seat].x) < 0.15 && Math.abs(p.ry - SEATS[seat].y) < 0.15;
      if (p.sitting) {
        drawAvatar(g, p.meta.avatar, 'sit', 'up', 0, fx, fy + 4);
      } else {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(fx - 5, fy - 1, 10, 2);
        const phase = (p.meta.avatar * 97) % 400; // idle breathing out of step
        const frame = p.moving ? Math.floor(t / 130) % 4 : Math.floor((t + phase) / 280) % 4;
        drawAvatar(g, p.meta.avatar, p.moving ? 'walk' : 'idle', p.dir || 'down', frame, fx, fy);
      }
      if (p.meta.id === this.selfId) {
        const bob = Math.sin(t / 200) * 1.5;
        const top = fy - (p.sitting ? 20 : 28);
        g.fillStyle = '#ffcf4a';
        g.fillRect(fx - 2, top + bob, 5, 2);
        g.fillRect(fx - 1, top + 2 + bob, 3, 2);
        g.fillRect(fx, top + 4 + bob, 1, 1);
      }
    }

    // labels at screen resolution
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (zoneQ) this.drawZoneLabels(zoneQ);
    if (this.showNames) {
      const size = Math.max(10, Math.round(4.2 * this.scale));
      g.font = `${size}px Monocraft, ui-monospace, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      for (const p of list) {
        const x = (p.rx + 0.5) * TILE * this.scale;
        const y = ((p.ry + 0.85) * TILE - (p.sitting ? 17 : 25)) * this.scale;
        const name = p.meta.name;
        const w = g.measureText(name).width + 8;
        g.fillStyle = 'rgba(11,7,22,0.7)';
        g.fillRect(x - w / 2, y - size - 2, w, size + 4);
        g.fillStyle = p.meta.id === this.selfId ? '#ffcf4a' : '#f6f0ff';
        g.fillText(name, x, y + 1);
      }
    }
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
