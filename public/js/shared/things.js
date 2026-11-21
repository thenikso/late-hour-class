// The catalogue of things a room can hold: which tiles draw each one, and
// which part of it is solid.
//
// A solid box is [x, y, width, height] in pixels from the thing's top-left
// corner. It usually covers only the lower part of the sprite: that is what
// lets an avatar stand behind a desk (its feet above the box, its legs hidden
// by the desk) or in front of it. The boxes started from the collision shapes
// that ship with the tileset (The Agency, CC0) and were trimmed by eye.
//
//   tiles  rows of tile ids in the office tileset (8 columns of 16 px)
//   prop   instead of tiles: a 16 x 32 sprite from the props sheet
//   box    the solid part; leave it out for things you can walk over
//   flat   drawn on the floor, under every avatar (a chair you sit on)

export const THINGS = {
  // the classroom
  desk: { tiles: [[34]], box: [1, 5, 14, 11] },
  chair: { tiles: [[6]], flat: true },
  teacherDesk: { tiles: [[40, 41, 42]], box: [0, 3, 46, 12] },
  chart: { tiles: [[11]], box: [3, 10, 10, 6] },
  lamp: { tiles: [[18]], box: [5, 11, 6, 5] },

  // the break corner
  coffee: { tiles: [[9]], box: [2, 5, 12, 11] },
  cooler: { tiles: [[13]], box: [3, 6, 10, 10] },
  printer: { tiles: [[14]], box: [1, 6, 14, 10] },
  sofa: { tiles: [[37, 38, 39]], box: [0, 4, 48, 12] },
  pingpong: { tiles: [[56, 57, 58], [64, 65, 66]], box: [1, 6, 46, 24] },

  // plants
  plant: { tiles: [[7]], box: [2, 9, 12, 7] },
  fern: { tiles: [[26]], box: [3, 10, 10, 5] },
  reed: { tiles: [[27]], box: [3, 10, 10, 5] },
  bush: { tiles: [[28]], box: [3, 10, 10, 5] },
  ivy: { tiles: [[29]], box: [3, 10, 10, 5] },

  // the adventure rooms
  table: { tiles: [[41, 42]], box: [2, 2, 28, 10] },
  bench: { tiles: [[32, 33]], box: [0, 3, 32, 12] },
  board: { tiles: [[43]], box: [2, 10, 12, 6] },
  cabinet: { tiles: [[15]], box: [0, 4, 16, 12] },
  stereo: { tiles: [[24, 25]], box: [0, 6, 32, 9] },
  beanbag: { tiles: [[17]], box: [1, 9, 14, 7] },

  // class rewards (see fun.js): they appear once the class has earned them
  arcade: { prop: 'arcade', box: [1, 22, 14, 10] },
  trophy: { prop: 'trophy', box: [3, 25, 10, 7] },
};

/** Size of a thing's sprite in pixels. */
export function thingSize(def) {
  if (def.prop) return { w: 16, h: 32 };
  return { w: def.tiles[0].length * 16, h: def.tiles.length * 16 };
}
