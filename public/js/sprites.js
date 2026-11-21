// Avatars and room tiles. The pixel art comes from The Agency (git author mrosati)
// (CC0 1.0, see public/assets/LICENSE.md): 8 avatar sheets and one office tileset.
//
// Avatar sheets: 4 columns x 10 rows of 16 x 24 px frames.
//   rows: idle down, up, left, right · walk down, up, left, right · sit (from behind) · drink

import { AVATAR_NAMES, EMOTE_IDS, HAT_IDS } from './shared/fun.js';

export const FRAME_W = 16;
export const FRAME_H = 24;
const ROW = {
  idle: { down: 0, up: 1, left: 2, right: 3 },
  walk: { down: 4, up: 5, left: 6, right: 7 },
  sit: 8,
  drink: 9,
};

export const AVATARS = AVATAR_NAMES.map((name, i) => ({
  name,
  file: `/assets/avatars/ava_${i + 1}.png`,
}));

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

const sheets = AVATARS.map((a) => loadImage(a.file));
export const tileset = loadImage('/assets/tiles/office.png');
export const panorama = loadImage('/assets/room/panorama.png'); // the view outside the glass wall, 512 x 96

// The fun sheets (drawn with codex, cut to size by tools/cut-sprites.js; see shared/fun.js):
//   hats.png      8 hats, 16 px cells, in HATS order
//   emotes.png    6 icons, 12 px cells, in EMOTES order
//   cat.png       sit, stand, walk, sleep (16 px cells, facing right)
//   props.png     arcade machine, disco ball, trophy, ball (16 x 32 cells, standing on the bottom edge)
//   trophies.png  10 concept trophies, 16 px cells, in TROPHY_SPRITES order
const hatSheet = loadImage('/assets/fun/hats.png');
const emoteSheet = loadImage('/assets/fun/emotes.png');
const catSheet = loadImage('/assets/fun/cat.png');
const propSheet = loadImage('/assets/fun/props.png');
const trophySheet = loadImage('/assets/fun/trophies.png');

/** The sprites a lesson can name for its trophies. An unknown name shows the cup. */
export const TROPHY_SPRITES = ['cup', 'star', 'tape', 'bug', 'key', 'book', 'flask', 'bulb', 'flag', 'gear'];
export const TROPHY_SIZE = 16;

// How many pixels each hat sinks onto the head (headphones go around it).
const HAT_SINK = { cap: 5, beanie: 5, party: 3, headphones: 7, grad: 4, pirate: 5, wizard: 4, crown: 3 };
// How far each hat sticks out above the head, so name labels can make room.
const HAT_RISE = { cap: 5, beanie: 7, party: 11, headphones: 4, grad: 6, pirate: 6, wizard: 10, crown: 8 };
export const hatRise = (hat) => HAT_RISE[hat] || 0;

const PROPS = { arcade: 0, disco: 1, trophy: 2, ball: 3 };
const CAT = { sit: 0, stand: 1, walk: 2, sleep: 3 };

// Where the top of the head is in every avatar frame, so a hat follows the
// breathing and walking bob. Measured once per sheet from the pixels themselves.
const heads = sheets.map(() => null);

function findHeadTop(pixels) {
  for (let y = 0; y < FRAME_H; y++) {
    let left = -1;
    let right = -1;
    // The head is a few rows wide: measure across the widest of the next three rows.
    for (let yy = y; yy < Math.min(FRAME_H, y + 3); yy++) {
      for (let x = 0; x < FRAME_W; x++) {
        if (pixels[(yy * FRAME_W + x) * 4 + 3] > 40) {
          if (left < 0 || x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (left < 0) continue;

    let rowHasPixel = false;
    for (let x = 0; x < FRAME_W; x++) {
      if (pixels[(y * FRAME_W + x) * 4 + 3] > 40) {
        rowHasPixel = true;
        break;
      }
    }
    if (rowHasPixel) {
      return { top: y, cx: (left + right + 1) / 2 };
    }
  }
  return { top: 0, cx: FRAME_W / 2 };
}

function measureHeads(index) {
  const img = sheets[index];
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const out = [];
  for (let row = 0; row < 10; row++) {
    for (let frame = 0; frame < 4; frame++) {
      const data = g.getImageData(frame * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H).data;
      out.push(findHeadTop(data));
    }
  }
  heads[index] = out;
}

sheets.forEach((img, i) => whenReady(img, () => measureHeads(i)));

/** Calls fn once the image is ready (now, if it already is). */
export function whenReady(img, fn) {
  if (img.complete && img.naturalWidth) fn();
  else img.addEventListener('load', fn, { once: true });
}

/**
 * Draw one avatar frame with its feet at (x, y), in canvas units.
 * pose: 'idle' | 'walk' | 'sit' | 'drink'; dir: 'down' | 'up' | 'left' | 'right'.
 */
export function drawAvatar(g, index, pose, dir, frame, x, y) {
  const img = sheets[index] || sheets[0];
  if (!img.complete || !img.naturalWidth) return;
  const row = typeof ROW[pose] === 'number' ? ROW[pose] : ROW[pose][dir] ?? ROW[pose].down;
  g.drawImage(
    img,
    (frame % 4) * FRAME_W,
    row * FRAME_H,
    FRAME_W,
    FRAME_H,
    Math.round(x - FRAME_W / 2),
    Math.round(y - FRAME_H),
    FRAME_W,
    FRAME_H,
  );
  return heads[index]?.[row * 4 + (frame % 4)] || { top: 1, cx: 8 };
}

/** Draw a hat on the head that drawAvatar just reported (same x, y as the avatar). */
export function drawHat(g, hat, head, x, y) {
  const i = HAT_IDS.indexOf(hat);
  if (i < 0 || !hatSheet.complete || !hatSheet.naturalWidth) return;
  const left = Math.round(x - FRAME_W / 2 + head.cx - 8);
  const top = Math.round(y - FRAME_H + head.top - 16 + HAT_SINK[hat]);
  g.drawImage(hatSheet, i * 16, 0, 16, 16, left, top, 16, 16);
}

/** One emote icon (12 px) with its top-left corner at (x, y). */
export function drawEmote(g, id, x, y, size = 12) {
  const i = EMOTE_IDS.indexOf(id);
  if (i < 0 || !emoteSheet.complete || !emoteSheet.naturalWidth) return;
  g.drawImage(emoteSheet, i * 12, 0, 12, 12, x, y, size, size);
}

/** The class cat with its feet at (x, y); flip = facing left. */
export function drawCat(g, pose, x, y, flip = false) {
  if (!catSheet.complete || !catSheet.naturalWidth) return;
  g.save();
  g.translate(Math.round(x), Math.round(y - 16));
  if (flip) g.scale(-1, 1);
  g.drawImage(catSheet, CAT[pose] * 16, 0, 16, 16, -8, 0, 16, 16);
  g.restore();
}

/** A room prop (16 x 32) standing with its bottom centre at (x, y). */
export function drawProp(g, name, x, y) {
  if (!propSheet.complete || !propSheet.naturalWidth) return;
  g.drawImage(propSheet, PROPS[name] * 16, 0, 16, 32, Math.round(x - 8), Math.round(y - 32), 16, 32);
}

/** The break-time ball (10 px on the floor) resting on (x, y). */
export function drawBall(g, x, y) {
  if (!propSheet.complete || !propSheet.naturalWidth) return;
  g.drawImage(propSheet, PROPS.ball * 16, 16, 16, 16, Math.round(x - 5), Math.round(y - 10), 10, 10);
}

/** One concept trophy (16 px) with its top-left corner at (x, y). */
export function drawTrophy(g, sprite, x, y, size = TROPHY_SIZE) {
  if (!trophySheet.complete || !trophySheet.naturalWidth) return;
  const i = Math.max(0, TROPHY_SPRITES.indexOf(sprite));
  g.drawImage(trophySheet, i * TROPHY_SIZE, 0, TROPHY_SIZE, TROPHY_SIZE, Math.round(x), Math.round(y), size, size);
}

/** A small canvas showing one trophy, for lists and cards. */
export function trophyCanvas(sprite, scale = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = TROPHY_SIZE * scale;
  c.className = 'icon';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  whenReady(trophySheet, () => drawTrophy(g, sprite, 0, 0, TROPHY_SIZE * scale));
  return c;
}

/** A small canvas showing one hat or emote, for buttons. */
export function iconCanvas(kind, id, scale = 2) {
  const size = kind === 'hat' ? 16 : 12;
  const c = document.createElement('canvas');
  c.width = c.height = size * scale;
  c.className = 'icon';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const img = kind === 'hat' ? hatSheet : emoteSheet;
  const i = (kind === 'hat' ? HAT_IDS : EMOTE_IDS).indexOf(id);
  whenReady(img, () => g.drawImage(img, i * size, 0, size, size, 0, 0, size * scale, size * scale));
  return c;
}

/**
 * A small canvas with one avatar standing, for pickers and lists.
 * Set `reserveHat: true` to keep headroom above the head even when no hat is worn,
 * so rows of hat buttons line up cleanly.
 */
export function avatarCanvas(index, scale = 4, { hat = '', reserveHat = false } = {}) {
  const c = document.createElement('canvas');
  const headroom = hat || reserveHat ? 10 : 0;
  c.width = FRAME_W * scale;
  c.height = (FRAME_H + headroom) * scale;
  c.className = 'avatar';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const img = sheets[index] || sheets[0];
  whenReady(img, () => {
    g.scale(scale, scale);
    const head = drawAvatar(g, index, 'idle', 'down', 0, FRAME_W / 2, FRAME_H + headroom);
    if (hat) whenReady(hatSheet, () => drawHat(g, hat, head, FRAME_W / 2, FRAME_H + headroom));
  });
  return c;
}

/** Draw tile `id` of the office tileset (8 columns of 16 px) at tile (tx, ty). */
export function drawTile(g, id, tx, ty, tile = 16) {
  g.drawImage(tileset, (id % 8) * 16, Math.floor(id / 8) * 16, 16, 16, Math.round(tx * tile), Math.round(ty * tile), tile, tile);
}
