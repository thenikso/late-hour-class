// Unit tests for shared world, room geometry, path-finding, fun rules, utilities and QR codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TROPHY_SLOTS, trophiesNear, trophyNear, optionOrder, lineValue, FLOOR } from '../public/js/shared/world.js';
import { ROOMS, DOOR, HOT_SEAT, canStand, thingsIn } from '../public/js/shared/rooms.js';
import { findPath } from '../public/js/shared/path.js';
import { classProgress, CLASS_LEVELS } from '../public/js/shared/fun.js';
import { shuffle, clamp, isSet } from '../public/js/shared/util.js';
import { qrMatrix } from '../public/js/qr.js';

test('every room keeps door, hot seat, cat spots and every chair reachable and solid furniture boxed', () => {
  for (const room of Object.keys(ROOMS)) {
    assert.ok(canStand(room, DOOR.x, DOOR.y) && canStand(room, HOT_SEAT.x, HOT_SEAT.y), `${room}: door and hot seat free`);
    for (const seat of ROOMS[room].seats) {
      assert.ok(findPath(room, DOOR, seat).length > 0, `${room}: path from door to seat ${seat.x},${seat.y}`);
    }
    for (const thing of thingsIn(room, ['games', 'trophy'])) {
      assert.ok(thing.def.flat || thing.solid, `${room}: ${thing.kind} has a solid box`);
    }
  }
  for (const [x, y] of ROOMS.base.catSpots) {
    assert.ok(canStand('base', x, y, ['games', 'trophy']), `cat spot ${x},${y} is free`);
  }
  assert.equal(canStand('base', 4, 8), false, 'feet inside a desk');
  assert.equal(canStand('base', 4, 9), true, 'on its chair');
});

test('trophiesNear reaches both bottom-row (0..15) and upper-shelf (16..31) trophies', () => {
  const firstColX = TROPHY_SLOTS[0].x;
  assert.deepEqual(trophiesNear(5, firstColX, 7.2), [0]);
  assert.deepEqual(trophiesNear(20, firstColX, 7.2), [0, 16]);
  assert.equal(trophyNear(20, firstColX, 7.2), 16, 'newest trophy in the column');
  assert.deepEqual(trophiesNear(20, firstColX, 10), [], 'too far from the front wall');
});

test('optionOrder is deterministic and lineValue clamps to 0..100', () => {
  const q = { key: 'week8-g', options: ['a', 'b', 'c', 'd'], shuffle: true };
  assert.deepEqual(optionOrder(q), optionOrder(q));
  assert.equal(lineValue(FLOOR.x), 0);
  assert.equal(lineValue(FLOOR.x + FLOOR.w - 1), 100);
  assert.equal(lineValue(-5), 0);
  assert.equal(lineValue(999), 100);
});

test('classProgress scales by student count and never lowers an earned level', () => {
  const n = 4;
  assert.equal(classProgress(0, n).level, 0);
  assert.equal(classProgress(CLASS_LEVELS[0].at * n, n).level, 1);
  assert.deepEqual(classProgress(CLASS_LEVELS[1].at * n, n).unlocked, ['lights', 'cat']);
  assert.equal(classProgress(10, n, 2).level, 2, 'earned level stays');
  assert.equal(classProgress(1e6, n).next, null);
});

test('shared util helpers work without mutating inputs', () => {
  const orig = [1, 2, 3, 4, 5];
  const out = shuffle(orig, () => 0);
  assert.deepEqual(orig, [1, 2, 3, 4, 5]);
  assert.deepEqual([...out].sort(), orig);
  assert.equal(clamp(10, 0, 5), 5);
  assert.equal(isSet(0), true);
  assert.equal(isSet(null), false);
  assert.equal(isSet(undefined), false);
});

test('qrMatrix encodes classroom LAN URLs into valid square QR matrices with finder patterns', () => {
  const m1 = qrMatrix('http://10.0.0.1:3000/');
  assert.ok(m1 && m1.length === 25, '21-byte URL fits Version 2 (25x25)');
  // Top-left 7x7 finder outer border is dark, inner 5x5 ring is light, 3x3 core is dark.
  assert.equal(m1[0][0], 1);
  assert.equal(m1[1][1], 0);
  assert.equal(m1[3][3], 1);
  assert.equal(m1[m1.length - 8][8], 1, 'mandatory dark module');

  assert.equal(qrMatrix('x'.repeat(100)), null, 'returns null above Version 4 capacity');
});
