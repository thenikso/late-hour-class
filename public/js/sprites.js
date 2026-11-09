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
}

/** A small canvas with one avatar standing, for pickers and lists. */
export function avatarCanvas(index, scale = 4) {
  const c = document.createElement('canvas');
  c.width = FRAME_W * scale;
  c.height = FRAME_H * scale;
  c.className = 'avatar';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const img = sheets[index] || sheets[0];
  whenReady(img, () => g.drawImage(img, 0, 0, FRAME_W, FRAME_H, 0, 0, FRAME_W * scale, FRAME_H * scale));
  return c;
}

/** Draw tile `id` of the office tileset (8 columns of 16 px) at tile (tx, ty). */
export function drawTile(g, id, tx, ty, tile = 16) {
  g.drawImage(tileset, (id % 8) * 16, Math.floor(id / 8) * 16, 16, 16, Math.round(tx * tile), Math.round(ty * tile), tile, tile);
}
