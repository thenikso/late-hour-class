// Avatars and room tiles. The pixel art comes from The Agency (git author mrosati)
// (CC0 1.0, see public/assets/LICENSE.md): 8 avatar sheets and one office tileset.
//
// Avatar sheets: 4 columns × 10 rows of 16 × 24 px frames.
//   rows: idle down, up, left, right · walk down, up, left, right · sit (from behind) · drink

export const FRAME_W = 16;
export const FRAME_H = 24;
const ROW = { idle: { down: 0, up: 1, left: 2, right: 3 }, walk: { down: 4, up: 5, left: 6, right: 7 }, sit: 8, drink: 9 };

export const AVATARS = ['Alex', 'Sam', 'Jo', 'Kai', 'Rio', 'Noa', 'Ivy', 'Max'].map((name, i) => ({ name, file: `/assets/avatars/ava_${i + 1}.png` }));

const loaded = (src) => {
  const img = new Image();
  img.src = src;
  return img;
};
const sheets = AVATARS.map((a) => loaded(a.file));
export const tileset = loaded('/assets/tiles/office.png');

// The fun sheets (drawn with codex, cut to size by tools/cut-sprites.js; see fun.js):
//   hats.png    8 hats, 16 px cells, in HATS order
//   emotes.png  6 icons, 12 px cells, in EMOTES order
//   cat.png     sit, stand, walk, sleep (16 px cells, facing right)
//   props.png   arcade machine, disco ball, trophy, ball (16 × 32 cells, standing on the bottom edge)
const hatSheet = loaded('/assets/fun/hats.png');
const emoteSheet = loaded('/assets/fun/emotes.png');
const catSheet = loaded('/assets/fun/cat.png');
const propSheet = loaded('/assets/fun/props.png');
const HAT_IDS = ['cap', 'beanie', 'party', 'headphones', 'grad', 'pirate', 'wizard', 'crown'];
// How many pixels each hat sinks onto the head (headphones go around it).
const HAT_SINK = { cap: 5, beanie: 5, party: 3, headphones: 7, grad: 4, pirate: 5, wizard: 4, crown: 3 };
// How far each hat sticks out above the head, so name labels can make room.
const HAT_RISE = { cap: 5, beanie: 7, party: 11, headphones: 4, grad: 6, pirate: 6, wizard: 10, crown: 8 };
export const hatRise = (hat) => HAT_RISE[hat] || 0;
const EMOTE_ORDER = ['wave', 'yes', 'idea', 'laugh', 'heart', 'lost'];
const PROPS = { arcade: 0, disco: 1, trophy: 2, ball: 3 };
const CAT = { sit: 0, stand: 1, walk: 2, sleep: 3 };

// Where the top of the head is in every avatar frame, so a hat follows the
// breathing and walking bob. Measured once per sheet from the pixels themselves.
const heads = sheets.map(() => null);
function measureHeads(i) {
  const img = sheets[i];
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const out = [];
  for (let row = 0; row < 10; row++)
    for (let f = 0; f < 4; f++) {
      const d = g.getImageData(f * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H).data;
      let top = 0;
      let cx = FRAME_W / 2;
      scan: for (let y = 0; y < FRAME_H; y++) {
        let l = -1;
        let r = -1;
        // the head is a few rows wide: look at the widest of the next three rows
        for (let yy = y; yy < Math.min(FRAME_H, y + 3); yy++)
          for (let x = 0; x < FRAME_W; x++)
            if (d[(yy * FRAME_W + x) * 4 + 3] > 40) {
              if (l < 0 || x < l) l = x;
              if (x > r) r = x;
            }
        if (l >= 0) {
          let any = false;
          for (let x = 0; x < FRAME_W; x++) if (d[(y * FRAME_W + x) * 4 + 3] > 40) any = true;
          if (!any) continue;
          top = y;
          cx = (l + r + 1) / 2;
          break scan;
        }
      }
      out.push({ top, cx });
    }
  heads[i] = out;
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
  g.drawImage(img, (frame % 4) * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H, Math.round(x - FRAME_W / 2), Math.round(y - FRAME_H), FRAME_W, FRAME_H);
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
  const i = EMOTE_ORDER.indexOf(id);
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

/** A room prop (16 × 32) standing with its bottom centre at (x, y). */
export function drawProp(g, name, x, y) {
  if (!propSheet.complete || !propSheet.naturalWidth) return;
  g.drawImage(propSheet, PROPS[name] * 16, 0, 16, 32, Math.round(x - 8), Math.round(y - 32), 16, 32);
}

/** The break-time ball (10 px on the floor) resting on (x, y). */
export function drawBall(g, x, y) {
  if (!propSheet.complete || !propSheet.naturalWidth) return;
  g.drawImage(propSheet, PROPS.ball * 16, 16, 16, 16, Math.round(x - 5), Math.round(y - 10), 10, 10);
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
  const i = (kind === 'hat' ? HAT_IDS : EMOTE_ORDER).indexOf(id);
  whenReady(img, () => g.drawImage(img, i * size, 0, size, size, 0, 0, size * scale, size * scale));
  return c;
}

/** A small canvas with one avatar standing, for pickers and lists. */
export function avatarCanvas(index, scale = 4, hat = '') {
  const c = document.createElement('canvas');
  const up = hat ? 10 : 0; // room above the head for a hat
  c.width = FRAME_W * scale;
  c.height = (FRAME_H + up) * scale;
  c.className = 'avatar';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const img = sheets[index] || sheets[0];
  whenReady(img, () => {
    g.scale(scale, scale);
    const head = drawAvatar(g, index, 'idle', 'down', 0, FRAME_W / 2, FRAME_H + up);
    if (hat) whenReady(hatSheet, () => drawHat(g, hat, head, FRAME_W / 2, FRAME_H + up));
  });
  return c;
}

/** Draw tile `id` of the office tileset (8 columns of 16 px) at tile (tx, ty). */
export function drawTile(g, id, tx, ty, tile = 16) {
  g.drawImage(tileset, (id % 8) * 16, Math.floor(id / 8) * 16, 16, 16, Math.round(tx * tile), Math.round(ty * tile), tile, tile);
}
