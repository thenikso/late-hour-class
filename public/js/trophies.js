// Concept trophies: twelve-pixel sprites, written out as text so they can be
// read and changed without an image editor. One letter is one pixel.
//
// A lesson names a sprite for each of its trophies (see the README); an
// unknown name falls back to the cup.

const PALETTE = {
  k: '#1b1230', // outline
  y: '#ffcf4a', // gold
  w: '#f6f0ff', // white
  r: '#ff5d5d', // red
  b: '#4cb3ff', // blue
  g: '#5ee08a', // green
  s: '#9aa0b5', // steel
};

export const TROPHY_SIZE = 12;

const SPRITES = {
  cup: [
    '............',
    '.kkkkkkkkkk.',
    'kkyyyyyyyykk',
    'kykywyyyykyk',
    'kykyyyyyykyk',
    'kkkyyyyyykkk',
    '..kyyyyyyk..',
    '...kyyyyk...',
    '....kyyk....',
    '....kyyk....',
    '..kkkyykkk..',
    '..kkkkkkkk..',
  ],
  star: [
    '.....kk.....',
    '....kyyk....',
    '....kyyk....',
    'kkkkywyykkkk',
    'kyyyyyyyyyyk',
    '.kyyyyyyyyk.',
    '..kyyyyyyk..',
    '..kyyyyyyk..',
    '.kyyykkyyyk.',
    '.kyykk.kkyyk',
    'kyykk...kkyk',
    'kkk.......kk',
  ],
  tape: [
    '............',
    '..kkkkkk....',
    '.kyyyyyyk...',
    'kyyywwyyyk..',
    'kyywkkwyyk..',
    'kyywkkwyyk..',
    'kyyywwyyykkk',
    'kyyyyyyyywwk',
    '.kyyyyyykwwk',
    '..kkkkkkkrrk',
    '.........kkk',
    '............',
  ],
  bug: [
    '............',
    '..k......k..',
    '...k.kk.k...',
    '...kkkkkk...',
    '..krrkkrrk..',
    '.krrrkkrrrk.',
    'kkrkrkkrkrkk',
    '.krrrkkrrrk.',
    'kkrrkkkkrrkk',
    '.krrrkkrrrk.',
    '..krrkkrrk..',
    '...kkkkkk...',
  ],
  key: [
    '............',
    '............',
    '..kkkk......',
    '.kyyyyk.....',
    'kyykkyyk....',
    'kyk..kykkkkk',
    'kyk..kyyyyyk',
    'kyykkyykykyk',
    '.kyyyyk.k.k.',
    '..kkkk......',
    '............',
    '............',
  ],
  book: [
    '............',
    '.kkkkkkkkkk.',
    '.kbbbbbbbbk.',
    '.kbwwwwwwbk.',
    '.kbbbbbbbbk.',
    '.kbwwwwbbbk.',
    '.kbbbbbbbbk.',
    '.kbbbbbbbbk.',
    '.kbbbbbbbbk.',
    '.kkkkkkkkkk.',
    '.kwwwwwwwwk.',
    '.kkkkkkkkkk.',
  ],
  flask: [
    '....kkkk....',
    '....kwwk....',
    '....kwwk....',
    '....kwwk....',
    '...kwwwwk...',
    '...kwwwwk...',
    '..kwggggwk..',
    '..kggggggk..',
    '.kggwgggggk.',
    '.kggggggggk.',
    '.kggggggggk.',
    '..kkkkkkkk..',
  ],
  bulb: [
    '...kkkkkk...',
    '..kyyyyyyk..',
    '.kyywyyyyyk.',
    '.kywyyyyyyk.',
    '.kyyyyyyyyk.',
    '.kyyyyyyyyk.',
    '..kyyyyyyk..',
    '...kyyyyk...',
    '...kkkkkk...',
    '...kssssk...',
    '...kssssk...',
    '....kkkk....',
  ],
  flag: [
    '.kk.........',
    '.kkkkkkkk...',
    '.kkrrrrrrkk.',
    '.kkrrrrrrrk.',
    '.kkrrrrrrrk.',
    '.kkrrrrrrkk.',
    '.kkkkkkkk...',
    '.kk.........',
    '.kk.........',
    '.kk.........',
    '.kk.........',
    'kkkk........',
  ],
  gear: [
    '....kkkk....',
    '.kk.kssk.kk.',
    'kssksssskssk',
    '.kssssssssk.',
    'kksskkkksskk',
    'ksskk..kkssk',
    'ksskk..kkssk',
    'kksskkkksskk',
    '.kssssssssk.',
    'kssksssskssk',
    '.kk.kssk.kk.',
    '....kkkk....',
  ],
};

export const TROPHY_SPRITES = Object.keys(SPRITES);

/** Draw one trophy with its top-left corner at (x, y); `scale` is pixels per sprite pixel. */
export function drawTrophy(g, sprite, x, y, scale = 1) {
  const rows = SPRITES[sprite] || SPRITES.cup;
  rows.forEach((row, j) => {
    [...row].forEach((letter, i) => {
      if (letter === '.') return;
      g.fillStyle = PALETTE[letter];
      g.fillRect(x + i * scale, y + j * scale, scale, scale);
    });
  });
}

/** A small canvas showing one trophy, for lists and cards. */
export function trophyCanvas(sprite, scale = 4) {
  const c = document.createElement('canvas');
  c.width = c.height = TROPHY_SIZE * scale;
  c.className = 'icon';
  drawTrophy(c.getContext('2d'), sprite, 0, 0, scale);
  return c;
}
