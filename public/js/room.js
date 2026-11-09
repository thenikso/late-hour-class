// Draws the base room, the zones and every avatar on one canvas.
// The background is painted once at 16 px per tile and scaled up crisply;
// names and labels are drawn at screen resolution so they stay sharp.

import { TILE, COLS, ROWS, SCREEN, SEATS, TEACHER_SPOT, zones, LETTERS } from './world.js';
import { avatarSprite } from './sprites.js';

const W = COLS * TILE;
const H = ROWS * TILE;
const ZONE_COLORS = ['#4cb3ff', '#ffcf4a', '#5ee08a', '#ff8ad8', '#c39bff', '#ff9f5a'];

function paintBackground() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // floor
  for (let y = 6; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      g.fillStyle = (x + y) % 2 ? '#2a2145' : '#2f254d';
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  // wall with bricks
  g.fillStyle = '#1c1533';
  g.fillRect(0, 0, W, 6.5 * TILE);
  g.fillStyle = '#251c42';
  for (let y = 0; y < 6.5 * TILE; y += 8)
    for (let x = (y / 8) % 2 ? 0 : 8; x < W; x += 16) g.fillRect(x, y, 15, 7);
  g.fillStyle = '#4a3a7a';
  g.fillRect(0, 6.5 * TILE, W, 3);
  g.fillStyle = '#120d22';
  g.fillRect(0, 6.5 * TILE + 3, W, 2);
  // side walls
  g.fillStyle = '#1c1533';
  g.fillRect(0, 6 * TILE, 8, H);
  g.fillRect(W - 8, 6 * TILE, 8, H);
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
  // a pin board on the left, a window on the right
  g.fillStyle = '#0b0716';
  g.fillRect(4 * TILE - 2, 1.4 * TILE - 2, 4.6 * TILE + 4, 3.4 * TILE + 4);
  g.fillStyle = '#a0703f';
  g.fillRect(4 * TILE, 1.4 * TILE, 4.6 * TILE, 3.4 * TILE);
  const notes = ['#ffcf4a', '#5ee08a', '#4cb3ff', '#ff8ad8', '#f3e9d2'];
  notes.forEach((c, k) => {
    g.fillStyle = c;
    g.fillRect((4.4 + (k % 3) * 1.4) * TILE, (1.8 + Math.floor(k / 3) * 1.5) * TILE + (k % 2) * 3, 16, 14);
    g.fillStyle = '#c0392b';
    g.fillRect((4.4 + (k % 3) * 1.4) * TILE + 7, (1.8 + Math.floor(k / 3) * 1.5) * TILE + (k % 2) * 3 + 1, 2, 2);
  });
  g.fillStyle = '#0b0716';
  g.fillRect(23.4 * TILE - 2, 1.2 * TILE - 2, 4.6 * TILE + 4, 3.8 * TILE + 4);
  g.fillStyle = '#2b5e8f';
  g.fillRect(23.4 * TILE, 1.2 * TILE, 4.6 * TILE, 3.8 * TILE);
  g.fillStyle = '#3f7fb8';
  g.fillRect(23.4 * TILE, 1.2 * TILE, 4.6 * TILE, 1.6 * TILE);
  g.fillStyle = '#f3e9d2';
  g.fillRect(24.2 * TILE, 1.7 * TILE, 18, 5);
  g.fillRect(26.3 * TILE, 2.3 * TILE, 22, 5);
  g.fillStyle = '#1c1533';
  g.fillRect(25.7 * TILE - 1, 1.2 * TILE, 3, 3.8 * TILE);
  g.fillRect(23.4 * TILE, 3.1 * TILE - 1, 4.6 * TILE, 3);
  // plants either side
  for (const px of [2, 30]) {
    g.fillStyle = '#6b4a2b';
    g.fillRect(px * TILE, 5 * TILE, 12, 14);
    g.fillStyle = '#3fae66';
    g.fillRect(px * TILE - 2, 3.4 * TILE, 16, 22);
    g.fillStyle = '#5ee08a';
    g.fillRect(px * TILE + 2, 3 * TILE, 8, 10);
  }
  // teacher desk
  g.fillStyle = '#5a3d24';
  g.fillRect((TEACHER_SPOT.x - 1.5) * TILE, 7.2 * TILE, 3.5 * TILE, 10);
  g.fillStyle = '#8a5f37';
  g.fillRect((TEACHER_SPOT.x - 1.5) * TILE, 7.2 * TILE, 3.5 * TILE, 4);
  // seats: desk in front, chair behind
  for (const s of SEATS) {
    const x = s.x * TILE;
    const y = s.y * TILE;
    g.fillStyle = '#5a3d24';
    g.fillRect(x - 1, y + 1, TILE + 2, 6);
    g.fillStyle = '#8a5f37';
    g.fillRect(x - 1, y + 1, TILE + 2, 2);
    g.fillStyle = '#7a3b52';
    g.fillRect(x + 3, y + 10, TILE - 6, 6);
  }
  return c;
}

export class Room {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.bg = paintBackground();
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
      const frame = p.moving ? Math.floor(t / 160) % 2 : 0;
      const sprite = avatarSprite(p.meta.avatar, p.dir || 'down', frame);
      const fx = (p.rx + 0.5) * TILE;
      const fy = (p.ry + 0.85) * TILE;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(fx - 5, fy - 1, 10, 2);
      g.drawImage(sprite, Math.round(fx - 6), Math.round(fy - 16));
      if (p.meta.id === this.selfId) {
        const bob = Math.sin(t / 200) * 1.5;
        g.fillStyle = '#ffcf4a';
        g.fillRect(fx - 2, fy - 22 + bob, 5, 2);
        g.fillRect(fx - 1, fy - 20 + bob, 3, 2);
        g.fillRect(fx, fy - 18 + bob, 1, 1);
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
        const y = ((p.ry + 0.85) * TILE - 17) * this.scale;
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
      g.globalAlpha = revealed ? (good ? 0.35 + 0.1 * Math.sin(t / 150) : 0.08) : 0.16;
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
    zs.forEach((z, i) => {
      const opt = q.order[i];
      const x = (z.x + z.w / 2) * TILE * s;
      const y = (z.y + 0.2) * TILE * s;
      const big = Math.max(14, Math.round(10 * s));
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.font = `bold ${big}px Monocraft, ui-monospace, monospace`;
      g.fillStyle = ZONE_COLORS[i % ZONE_COLORS.length];
      g.fillText(LETTERS[i], x, y);
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
          g.fillText(line, x, ly);
          ly += small + 3;
          line = w;
          if (++lines >= 4) {
            line = '…';
            break;
          }
        } else line = test;
      }
      if (line) g.fillText(line, x, ly);
      if (q.counts && q.status === 'revealed') {
        g.font = `bold ${Math.max(12, Math.round(6 * s))}px Monocraft, ui-monospace, monospace`;
        g.fillStyle = '#ffcf4a';
        g.textBaseline = 'bottom';
        g.fillText(`${q.counts[opt]}`, x, (z.y + z.h - 0.2) * TILE * s);
      }
    });
  }
}

export const ROOM_SIZE = { W, H };
