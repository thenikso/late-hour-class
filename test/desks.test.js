// Unit tests for shared desk drafts (lib/desks.js): in written pair work, the
// students at one desk write one draft, one of them holding the pen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Game } from '../lib/game.js';
import { normaliseLesson } from '../lib/manifest.js';
import { deskAt, deskOf } from '../lib/desks.js';
import { seatPairs } from '../public/js/shared/rooms.js';

const PAIRS = { kind: 'text', pairs: true, title: 'Together', prompt: 'Write it together.', room: 'lab' };

/** A game in the workshop with Ada + Bo at desk 0 and Cy + Di at desk 1, and the pair question open. */
async function withDesks(fn) {
  const dataDir = await mkdtemp(join(tmpdir(), 'lhc-desks-'));
  const game = new Game({ lesson: normaliseLesson({ questions: { w: PAIRS } }), dataDir, aiMode: 'mock', termFile: null, log: () => {} });
  const players = ['Ada', 'Bo', 'Cy', 'Di'].map((name, i) => {
    const p = game.join(name, i);
    game.setOnline(p, +1);
    return p;
  });
  const events = [];
  game.onDesk((n, data) => events.push({ n, ...data }));
  game.enter('lab');
  game.open('w', { travel: false });
  // Seat them ourselves (the random pairs from makePairs are not what we test here).
  const [d0, d1] = seatPairs('lab');
  game.place(players[0], d0[0].x, d0[0].y, 'up');
  game.place(players[1], d0[1].x, d0[1].y, 'up');
  game.place(players[2], d1[0].x, d1[0].y, 'up');
  game.place(players[3], d1[1].x, d1[1].y, 'up');
  try {
    await fn({ game, players, events, desks: [d0, d1] });
  } finally {
    game.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('deskAt finds a desk from its seats or right beside them, and nothing in the aisle', () => {
  const [[a, b]] = seatPairs('lab');
  assert.equal(deskAt('lab', a.x, a.y), 0);
  assert.equal(deskAt('lab', b.x, b.y), 0);
  assert.equal(deskAt('lab', b.x + 1, b.y), 0, 'a third member stands beside the desk');
  assert.equal(deskAt('lab', a.x, a.y - 2), -1);
  assert.equal(deskAt('lab', 15, a.y), -1, 'the middle aisle is no desk');
});

test('one pen per desk: the holder writes, the others watch and can take it', () =>
  withDesks(({ game, players: [ada, bo, cy], events }) => {
    game.writeDraft(ada, { text: 'A test fills an event' });
    assert.deepEqual(events.at(-1), { n: 0, key: 'w', text: 'A test fills an event', v: 1 });
    assert.throws(() => game.writeDraft(bo, { text: 'mine now' }), /Ada has the pen/);

    game.takePen(bo);
    game.writeDraft(bo, { text: 'A test fills an event and cancels one booking' });
    assert.throws(() => game.writeDraft(ada, { text: 'x' }), /Bo has the pen/);

    const adaDesk = game.studentView(ada).desk;
    assert.equal(adaDesk.text, 'A test fills an event and cancels one booking');
    assert.equal(adaDesk.penName, 'Bo');
    assert.deepEqual(adaDesk.members.map((m) => m.name), ['Ada', 'Bo']);
    assert.equal(game.studentView(cy).desk.text, '', 'another desk has its own draft');

    // Drafts never reach the projector or the shared state.
    assert.ok(!JSON.stringify(game.screenView()).includes('cancels one booking'));
    assert.equal(game.teacherView().desks.length, 2);
  }));

test('the draft belongs to the desk: move desks and you see that desk; leaving frees the pen', () =>
  withDesks(({ game, players: [ada, bo, cy], desks: [, d1] }) => {
    game.writeDraft(cy, { text: 'Desk one draft' });
    game.writeDraft(ada, { text: 'Desk zero draft' });
    game.place(ada, d1[1].x + 1, d1[1].y, 'up'); // Ada walks over to stand beside desk 1
    assert.equal(deskOf(game, ada), 1);
    assert.equal(game.studentView(ada).desk.text, 'Desk one draft');
    // Ada held desk 0's pen; now it is free for Bo without taking it.
    game.writeDraft(bo, { text: 'Desk zero draft, by Bo' });
    assert.equal(game.studentView(bo).desk.penName, 'Bo');
  }));

test('a desk hands in its draft for everyone at it, and you must be at a desk', () =>
  withDesks(({ game, players: [ada, bo, cy, di] }) => {
    game.writeDraft(ada, { text: 'A test cancels one booking for a full event.', meta: { pastedChars: 0, activeMs: 9000 } });
    game.submit(bo, { text: 'ignored: the desk draft counts' });
    const rec = game.live;
    assert.equal(rec.answers[ada.id].attempts[0].text, 'A test cancels one booking for a full event.');
    assert.equal(rec.answers[bo.id].attempts[0].text, 'A test cancels one booking for a full event.');
    assert.equal(rec.answers[cy.id], undefined);
    assert.deepEqual(game.groupOf(rec, ada.id).sort(), [ada.id, bo.id].sort());

    game.place(di, 15, 12, 'up'); // Di wanders into the aisle
    assert.throws(() => game.submit(di, {}), /Sit at a desk/);
  }));

test('shared drafts stay off for single work, choices and rooms without seats', () =>
  withDesks(({ game, players: [ada] }) => {
    game.open({ key: 'solo', kind: 'text', title: 'Alone', prompt: '?' }, { travel: false, force: true });
    assert.equal(game.studentView(ada).desk, undefined);
    assert.throws(() => game.writeDraft(ada, { text: 'x' }), /Sit at a desk/);
  }));
