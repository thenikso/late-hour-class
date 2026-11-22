// Unit tests for rapid rounds (lib/rapid.js): lines one at a time, answered by
// standing in a floor zone, each student with their own zone order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Game } from '../lib/game.js';
import { normaliseLesson } from '../lib/manifest.js';
import { rapidOrder, stepRapid, secondsFor } from '../lib/rapid.js';
import { POINTS } from '../lib/scoring.js';
import { zones } from '../public/js/shared/world.js';

const ROUND = {
  kind: 'rapid',
  title: 'Sort them',
  prompt: 'Evidenced, assumed or missing?',
  options: ['Evidenced', 'Assumed', 'Missing'],
  rows: [
    { text: 'A test log', correct: 0 },
    { text: 'A test plan', correct: 1 },
    { text: 'Nothing yet', correct: 2 },
  ],
  seconds: 5,
};

async function withGame(def, fn) {
  const dataDir = await mkdtemp(join(tmpdir(), 'cge-rapid-'));
  const game = new Game({ lesson: normaliseLesson({ questions: { r: def } }), dataDir, aiMode: 'mock', termFile: null, log: () => {} });
  const [ada, bo, cy] = ['Ada', 'Bo', 'Cy'].map((name, i) => {
    const p = game.join(name, i);
    game.setOnline(p, +1);
    return p;
  });
  try {
    await fn({ game, ada, bo, cy });
  } finally {
    game.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
}

/** Stand `p` in the zone that shows `option` to them on the current line. */
function standOn(game, p, option) {
  const rec = game.live;
  const order = rapidOrder(rec, p.id, rec.row);
  const z = zones(order.length)[order.indexOf(option)];
  p.x = z.x + z.w / 2 - 0.5;
  p.y = 9;
}

test('rapidOrder gives each student a stable shuffle per line, or the plain order without scramble', () => {
  const rec = { seed: 42, def: { options: ['a', 'b', 'c', 'd'], scramble: true } };
  const orders = [];
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    for (const row of [0, 1, 2]) {
      const order = rapidOrder(rec, pid, row);
      assert.deepEqual([...order].sort(), [0, 1, 2, 3], 'every option has one zone');
      assert.deepEqual(rapidOrder(rec, pid, row), order, 'same student and line: same order');
      orders.push(order.join(''));
    }
  }
  assert.ok(new Set(orders).size > 3, 'orders differ between students and lines');
  assert.deepEqual(rapidOrder({ seed: 42, def: { options: ['a', 'b', 'c'], scramble: false } }, 'p1', 0), [0, 1, 2]);
});

test('a rapid round runs line by line, locks where students stand, then closes itself', () =>
  withGame(ROUND, ({ game, ada, bo, cy }) => {
    game.open('r');
    const rec = game.live;
    assert.equal(rec.phase, 'ready');
    assert.throws(() => game.submit(ada, {}), /stand in your answer/);
    assert.deepEqual(game.teacherView().question.waitingFor, [], 'nobody is "still writing" a rapid round');

    stepRapid(game); // ready -> line 1
    assert.equal(rec.phase, 'answer');
    assert.equal(game.studentView(ada).question.order.length, 3);
    assert.equal(game.screenView().question.order, undefined, 'the projector has no zone order');

    for (let row = 0; row < 3; row++) {
      standOn(game, ada, ROUND.rows[row].correct); // Ada is always right
      standOn(game, bo, (ROUND.rows[row].correct + 1) % 3); // Bo always wrong
      cy.x = 1; // Cy stays at the front, outside every zone
      cy.y = 7;
      stepRapid(game); // lock the line, show its answer
      assert.equal(rec.phase, 'show');
      const shown = game.screenView().question;
      assert.deepEqual(shown.rowAnswer, [ROUND.rows[row].correct]);
      assert.deepEqual(shown.rowTally, { right: 1, answered: 2 });
      stepRapid(game); // next line, or the end
    }

    assert.equal(rec.status, 'scored', 'closed by itself after the last line');
    assert.equal(rec.phase, 'done');
    assert.equal(rec.answers[cy.id], undefined, 'standing nowhere is no answer, and costs nothing');

    game.reveal();
    const adaPoints = rec.answers[ada.id].attempts[0].points;
    const boPoints = rec.answers[bo.id].attempts[0].points;
    assert.equal(adaPoints, POINTS.handIn + 3 * POINTS.gridRow);
    assert.equal(boPoints, POINTS.handIn);
  }));

test('the teacher can stop a rapid round early without the gate', () =>
  withGame(ROUND, ({ game, ada }) => {
    game.open('r');
    stepRapid(game);
    standOn(game, ada, 0);
    stepRapid(game); // line 1 locked
    game.close(); // no force needed
    assert.equal(game.live.status, 'scored');
    assert.equal(game.live.phase, 'stopped');
    assert.equal(game.rapidTimer, null);
    assert.deepEqual(game.live.answers[ada.id].attempts[0].grid, [0, null, null]);
  }));

test('the manifest keeps rapid seconds in range and scrambles by default', () => {
  const lesson = normaliseLesson({ questions: { a: { ...ROUND, seconds: 999 }, b: { ...ROUND, seconds: 1, scramble: false } } });
  assert.equal(lesson.questions.a.seconds, 120);
  assert.equal(lesson.questions.a.scramble, true);
  assert.equal(lesson.questions.b.seconds, 3);
  assert.equal(lesson.questions.b.scramble, false);
  assert.deepEqual(lesson.questions.a.rows[1].correct, [1]);
});

test('the teacher sets the seconds per line, also for the line being answered', () =>
  withGame(ROUND, ({ game }) => {
    game.open('r');
    const rec = game.live;
    game.setRapidSeconds(30); // during the intro: counts from line 1
    stepRapid(game);
    assert.equal(secondsFor(rec), 30);
    assert.equal(game.screenView().question.seconds, 30);
    assert.ok(Math.abs(rec.phaseEndsAt - rec.phaseStartedAt - 30000) < 50);

    game.setRapidSeconds(45); // mid-line: this line now runs 45 s from when it came up
    assert.ok(Math.abs(rec.phaseEndsAt - rec.phaseStartedAt - 45000) < 50);

    rec.phaseStartedAt -= 40000; // 40 s into the line, then cut it to 10 s: a little time is left
    game.setRapidSeconds(10);
    assert.ok(rec.phaseEndsAt >= Date.now() + 1900, 'never ends the line under their feet');

    game.setRapidSeconds(999);
    assert.equal(secondsFor(rec), 120);
    game.setRapidSeconds(1);
    assert.equal(secondsFor(rec), 5);
  }));
