// Original pixel avatars, drawn from tiny character grids. 12 × 16 px each.
// Letters: h hair, s skin, e eye, m mouth, t shirt, d shirt shade, p trousers, b shoes, a accessory, g glasses.

const FRONT = [
  '....hhhh....',
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..sesssses..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
  '..tttttttt..',
  '.tttttttttt.',
  '.sttddddtts.',
  '.s.tttttt.s.',
  '...pppppp...',
  '...pp..pp...',
  '...pp..pp...',
  '..bbb..bbb..',
];
const BACK = [
  '....hhhh....',
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hhhhhhhh..',
  '..hhhhhhhh..',
  '..shhhhhhs..',
  '...hhhhhh...',
  '....ssss....',
  '..tttttttt..',
  '.tttttttttt.',
  '.stttttttts.',
  '.s.tttttt.s.',
  '...pppppp...',
  '...pp..pp...',
  '...pp..pp...',
  '..bbb..bbb..',
];
const STEP = ['...pp..pp...', '..pp....pp..', '.bbb....bbb.'];
const SIDE_FACE = '..ssssssse..';

// accessories drawn over the base, by rows from the top
const ACCESSORIES = {
  cap: [[0, '...aaaaaa...'], [1, '..aaaaaaaa..'], [2, '..aaaaaaaaaa']],
  beanie: [[0, '....aaaa....'], [1, '...aaaaaa...'], [2, '..aaaaaaaa..']],
  band: [[2, '..aaaaaaaa..']],
  bow: [[0, '.........aa.'], [1, '........aaaa'], [2, '.........aa.']],
  phones: [[1, '..a......a..'], [2, '.aa......aa.'], [3, '.aa......aa.'], [4, '.a........a.']],
  glasses: [[4, '..gggssggg..']],
  flower: [[1, '........aa..'], [2, '.......aaaa.'], [3, '........aa..']],
  none: [],
};

export const AVATARS = [
  { name: 'Ash', hair: '#2b1d14', skin: '#f2c9a0', shirt: '#4cb3ff', shade: '#2f7fc0', pants: '#2c2f4a', shoes: '#14101f', acc: 'cap', accColor: '#ff5d5d' },
  { name: 'Wren', hair: '#e3a33b', skin: '#ffd8b8', shirt: '#5ee08a', shade: '#33a35e', pants: '#3a3157', shoes: '#14101f', acc: 'bow', accColor: '#ff8ad8' },
  { name: 'Kit', hair: '#111111', skin: '#8d5a3b', shirt: '#ffcf4a', shade: '#c79a1f', pants: '#26324f', shoes: '#f3e9d2', acc: 'phones', accColor: '#c39bff' },
  { name: 'Sol', hair: '#b4462f', skin: '#f6d2b0', shirt: '#ff5d5d', shade: '#b83a3a', pants: '#1f2a3a', shoes: '#14101f', acc: 'glasses', accColor: '#f3e9d2' },
  { name: 'Moss', hair: '#3c2a1e', skin: '#c68b5f', shirt: '#c39bff', shade: '#8a63c9', pants: '#33402a', shoes: '#14101f', acc: 'beanie', accColor: '#5ee08a' },
  { name: 'Juno', hair: '#f1f1f1', skin: '#e9b48e', shirt: '#ff9f5a', shade: '#c56e2c', pants: '#2c2f4a', shoes: '#14101f', acc: 'band', accColor: '#4cb3ff' },
  { name: 'Pip', hair: '#5a3a8a', skin: '#ffe0c4', shirt: '#2ad4c4', shade: '#1c9a8e', pants: '#3a2a2a', shoes: '#f3e9d2', acc: 'flower', accColor: '#ffcf4a' },
  { name: 'Rook', hair: '#1d1d2b', skin: '#5e3b26', shirt: '#f3e9d2', shade: '#b9ad94', pants: '#4a2c3d', shoes: '#14101f', acc: 'none', accColor: '#000' },
];

const cache = new Map();

function build(avatarIndex, dir, frame) {
  const a = AVATARS[avatarIndex % AVATARS.length];
  const rows = (dir === 'up' ? BACK : FRONT).slice();
  if (dir === 'left' || dir === 'right') rows[4] = SIDE_FACE;
  if (frame === 1) {
    rows[13] = STEP[0];
    rows[14] = STEP[1];
    rows[15] = STEP[2];
  }
  const grid = rows.map((r) => r.split(''));
  if (dir !== 'up' || a.acc !== 'glasses')
    for (const [y, line] of ACCESSORIES[a.acc] || [])
      line.split('').forEach((ch, x) => {
        if (ch !== '.' && !(dir === 'up' && ch === 'g')) grid[y][x] = ch;
      });
  const colors = { h: a.hair, s: a.skin, e: '#1a1020', m: '#a8475a', t: a.shirt, d: a.shade, p: a.pants, b: a.shoes, a: a.accColor, g: '#1a1020' };
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 16;
  const g = c.getContext('2d');
  grid.forEach((row, y) =>
    row.forEach((ch, x0) => {
      if (ch === '.') return;
      const x = dir === 'left' ? 11 - x0 : x0;
      g.fillStyle = colors[ch];
      g.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}

export function avatarSprite(index, dir = 'down', frame = 0) {
  const k = `${index}:${dir}:${frame}`;
  if (!cache.has(k)) cache.set(k, build(index, dir, frame));
  return cache.get(k);
}

/** A small canvas with one avatar, for pickers and lists. */
export function avatarCanvas(index, scale = 4) {
  const c = document.createElement('canvas');
  c.width = 12 * scale;
  c.height = 16 * scale;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(avatarSprite(index), 0, 0, 12 * scale, 16 * scale);
  return c;
}
