// Isolated end-to-end tests of the classroom server and Game rules.
// Every test starts its own server on a free OS port with a fresh temp folder,
// so any test can run on its own or in any order. Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../server.js';
import { Game } from '../lib/game.js';
import { loadLesson } from '../lib/manifest.js';
import { loadTerm } from '../lib/term.js';
import { sessionReport } from '../lib/report.js';
import { looksLikeQuestion } from '../lib/asks.js';
import { zones, optionOrder, FLOOR } from '../public/js/shared/world.js';
import { ROOMS, HOT_SEAT, DOOR, canStand } from '../public/js/shared/rooms.js';
import { parseMarks } from '../public/js/shared/marks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DECK = join(ROOT, 'example/slides/sample-deck.html');
const BALL_HOME = ROOMS.base.ballHome;
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Middle of the floor zone that shows `option` (zones may be shuffled per question). */
function spotFor(q, option) {
  const order = optionOrder(q);
  const z = zones(order.length)[order.indexOf(option)];
  return { x: z.x + z.w / 2 - 0.5, y: 9 }; // row 9 is a row of chairs: nothing solid there
}

/** Spin up an isolated server + 4 students (Ada, Bo, Cy, Di), then tear it down cleanly. */
async function withClassroom(opts, fn) {
  if (typeof opts === 'function') {
    fn = opts;
    opts = {};
  }
  const dataDir = await mkdtemp(join(tmpdir(), 'cge-'));
  const srv = await start({
    lesson: DECK,
    deck: 'http://127.0.0.1:1/sample-deck.html',
    port: 0,
    ai: 'mock',
    data: dataDir,
    quiet: true,
    host: '127.0.0.1',
    ...opts,
  });
  const base = `http://127.0.0.1:${srv.port}`;
  const post = async (path, body = {}) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(`${path}: ${j.error}`), { status: r.status, body: j });
    return j;
  };
  const teacher = (action, body) => post(`/api/teacher/${action}?key=${srv.key}`, body);
  const untilScored = async () => {
    for (let i = 0; i < 100 && srv.game.scoring; i++) await wait(20);
  };
  const students = [];
  const names = opts.students ?? [['Ada', 0], ['Bo', 1], ['Cy', 2], ['Di', 3]];
  for (const [name, avatar] of names) {
    const j = await post('/api/join', { name, avatar });
    students.push({ name, ...j });
  }
  const setAllOnline = (delta) => {
    for (const s of students) srv.game.setOnline(srv.game.players.get(s.id), delta);
  };
  try {
    await fn({ srv, game: srv.game, base, dataDir, students, post, teacher, untilScored, setAllOnline });
  } finally {
    await srv.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('join enforces unique names, player cap, unknown tokens, and teacher-unlocked seat rejoin', () =>
  withClassroom({ maxPlayers: 5 }, async ({ game, students, post, teacher }) => {
    await assert.rejects(post('/api/join', { name: 'ada', avatar: 1 }), /taken/);
    await assert.rejects(post('/api/move', { token: 'nope', x: 3, y: 9 }), /Unknown player/);

    // 5th player succeeds; 6th hits the player cap.
    await post('/api/join', { name: 'Eli', avatar: 4 });
    await assert.rejects(post('/api/join', { name: 'Fay', avatar: 5 }), /full/);

    // Teacher unlocks Ada's offline seat so Ada can rejoin from another browser without losing points.
    const ada = game.players.get(students[0].id);
    ada.points = 75;
    await teacher('allow-rejoin', { pid: ada.id, on: true });
    assert.equal(game.teacherView().players.find((p) => p.id === ada.id).rejoinOpen, true);
    const rejoined = await post('/api/join', { name: 'Ada', avatar: 5 });
    assert.equal(rejoined.id, ada.id, 'same player id reclaimed');
    assert.notEqual(rejoined.token, students[0].token, 'old token invalidated');
    assert.equal(game.players.get(ada.id).points, 75, 'points preserved');
    await assert.rejects(post('/api/move', { token: students[0].token, x: 4, y: 9 }), /Unknown player/);
  }));

test('slides, cue, and take-your-seat countdown move everyone to desks then lock movement', () =>
  withClassroom(async ({ game, students, post, teacher }) => {
    await teacher('slide', { slide: 5 });
    assert.equal(game.screen.slide, 5);
    await teacher('cue');
    assert.equal(game.screen.cue, 1);

    await teacher('seat', { seconds: 0.05 });
    await wait(150);
    assert.equal(game.mode, 'present');
    const seats = new Set([...game.players.values()].map((p) => `${p.x},${p.y}`));
    assert.equal(seats.size, 4);
    const moved = await post('/api/move', { token: students[0].token, x: 4, y: 9 });
    assert.equal(moved.ok, false, 'movement is locked in present mode');
  }));

test('zone questions score by server position, retries earn IMPROVED, and setScore updates improved', () =>
  withClassroom(async ({ game, students, post, teacher, untilScored }) => {
    await teacher('open', { key: 'g' });
    const q = game.lesson.questions.g;
    const wrongOpt = [0, 1, 2, 3].find((o) => ![].concat(q.correct, q.partial).includes(o));
    const plan = [
      [students[0], [].concat(q.correct)[0], '==①if A: the queue drops the second click== and ==②if B: the cache keeps the old total because the key is wrong=='],
      [students[1], q.partial[0], 'Maybe a timing thing'],
      [students[2], wrongOpt, 'no idea'],
    ];
    for (const [s, opt, text] of plan) {
      await post('/api/move', { token: s.token, ...spotFor(q, opt), dir: 'down', moving: false });
      await post('/api/answer', { token: s.token, text, meta: { activeMs: 60000 } });
    }
    await post('/api/move', { token: students[3].token, x: 10, y: 7.2 });
    await assert.rejects(post('/api/answer', { token: students[3].token, text: 'hi' }), /zone/);

    const rec = game.records.g;
    assert.ok(rec.answers[students[2].id].attempts[0].flags.some((f) => f.kind === 'short' || f.kind === 'unmarked'));

    await teacher('score');
    await untilScored();
    assert.equal(rec.status, 'scored');
    assert.equal(rec.answers[students[0].id].attempts[0].auto.choice, 'right');
    assert.equal(rec.answers[students[1].id].attempts[0].auto.choice, 'partial');
    assert.equal(rec.answers[students[2].id].attempts[0].auto.choice, 'wrong');

    await teacher('reveal');
    assert.equal(game.mode, 'review');
    const ada = rec.answers[students[0].id].attempts[0];
    assert.ok(ada.points > rec.answers[students[2].id].attempts[0].points);
    assert.equal(Object.keys(parseMarks(ada.text)).length, 2);

    // Wall is anonymous by default on the projector; teacher can toggle names on.
    assert.equal(game.screenView().question.wall.length, 3);
    assert.equal(game.screenView().question.wall[0].name, '', 'projector wall hides names by default');
    await teacher('wall-names', { on: true });
    assert.equal(game.screenView().question.wall[0].name, 'Ada');

    // Cy retries with a stronger answer from the right zone.
    const cyView = game.studentView(game.players.get(students[2].id));
    assert.equal(cyView.mine.canRetry, true);
    await post('/api/move', { token: students[2].token, ...spotFor(q, [].concat(q.correct)[0]) });
    await post('/api/answer', {
      token: students[2].token,
      text: '==①if A: the second request is dropped by the queue== ==②if B: the cache returns the stale total==',
      meta: { activeMs: 90000 },
    });
    assert.equal(game.teacherView().question.pendingRetries, 1);
    await teacher('score');
    await untilScored();
    await teacher('reveal');
    const cyEntry = rec.answers[students[2].id];
    assert.equal(cyEntry.attempts.length, 2);
    assert.equal(cyEntry.attempts[1].improved, true);
    assert.equal(game.players.get(students[2].id).improved, 1);

    // If the teacher lowers a retry below the first attempt, `improved` updates cleanly.
    await teacher('set-score', { pid: students[2].id, score: 0, feedback: 'Re-check' });
    const lowered = cyEntry.attempts[1].points <= cyEntry.attempts[0].points;
    assert.equal(cyEntry.attempts[1].improved, !lowered);
  }));

test('grid questions are marked row by row without AI and build hand-in streaks', () =>
  withClassroom(async ({ game, students, post, teacher }) => {
    // Answer one quick poll first so the grid question becomes 2 in a row.
    await teacher('open', { def: { key: 'p1', kind: 'choice', title: 'Warmup', prompt: 'Go?', options: ['Yes', 'No'], correct: null, zones: false, scored: false } });
    await post('/api/answer', { token: students[0].token, choice: 0 });
    await post('/api/answer', { token: students[1].token, choice: 1 });
    await teacher('reveal');

    await teacher('open', { key: 'd' });
    const q = game.lesson.questions.d;
    const right = q.rows.map((r) => r.correct[0]);
    await post('/api/answer', { token: students[0].token, grid: right });
    await post('/api/answer', { token: students[1].token, grid: right.map(() => null) });
    await teacher('close');
    assert.equal(game.records.d.status, 'scored');
    await teacher('reveal');

    const a = game.records.d.answers[students[0].id].attempts[0];
    assert.equal(a.auto.rows.filter(Boolean).length, q.rows.length);
    assert.equal(a.points, 10 + q.rows.length * 10 + 5, 'hand-in + right rows + 2-in-a-row streak');
    assert.ok(game.records.d.answers[students[1].id].attempts[0].breakdown.steps.some((s) => s.label === '2 in a row'));
    assert.equal(game.studentView(game.players.get(students[0].id)).me.streak, 2);
  }));

test('teacher has final word on score and spotlight walks student to the hot seat and back', () =>
  withClassroom(async ({ game, students, post, teacher, setAllOnline }) => {
    setAllOnline(+1);
    await teacher('open', { key: 'f' });
    const di = game.players.get(students[3].id);
    await post('/api/move', { token: students[3].token, x: 20, y: 13, dir: 'left', moving: false });
    await post('/api/answer', { token: students[3].token, text: '==①A: the parser== ==②predicts a crash==', meta: { activeMs: 30000 } });
    await teacher('close', { force: true });
    await teacher('set-score', { pid: di.id, score: 3, feedback: 'Spot on' });
    await teacher('reveal');

    const a = game.records.f.answers[di.id].attempts[0];
    assert.equal(a.ai.score, 3);
    assert.equal(a.ai.feedback, 'Spot on');

    const warpBefore = di.warp;
    await teacher('spotlight', { pid: di.id });
    assert.deepEqual([di.x, di.y], [HOT_SEAT.x, HOT_SEAT.y]);
    assert.equal(di.warp, warpBefore + 1);
    assert.equal(game.screenView().spotlight.name, 'Di');
    // Stale move carrying old warp is ignored.
    assert.equal((await post('/api/move', { token: students[3].token, x: 4, y: 9, warp: warpBefore })).ok, false);
    assert.equal(di.x, HOT_SEAT.x);

    await teacher('spotlight', { pid: null });
    assert.deepEqual([di.x, di.y], [20, 13], 'returned where they stood');
    await teacher('pick');
    assert.equal(game.spotlight.pid, di.id);
  }));

test('emotes, lost/got-it privacy, hop lock in present, and free-roam coffee drink', () =>
  withClassroom(async ({ game, students, post, teacher, setAllOnline }) => {
    setAllOnline(+1);
    const seen = [];
    const off = game.onFx((e) => seen.push(e));
    const bo = game.players.get(students[1].id);

    assert.equal((await post('/api/emote', { token: students[1].token, e: 'wave' })).ok, true);
    assert.equal((await post('/api/emote', { token: students[1].token, e: 'wave' })).ok, false, 'rate-limited');
    await assert.rejects(post('/api/emote', { token: students[1].token, e: '<script>' }));

    bo.emoteAt = 0;
    await post('/api/emote', { token: students[1].token, e: 'lost' });
    assert.deepEqual(game.teacherView().lost, ['Bo']);
    assert.equal(game.studentView(bo).me.lost, true);
    assert.equal(game.screenView().players.some((p) => 'lostAt' in p || 'lost' in p), false, 'only teacher sees lost');

    bo.emoteAt = 0;
    await post('/api/emote', { token: students[1].token, e: 'yes' });
    assert.deepEqual(game.teacherView().lost, [], '"Got it" clears lost');

    bo.emoteAt = 0;
    assert.equal((await post('/api/emote', { token: students[1].token, e: 'drink' })).ok, true, 'coffee allowed in free roam');
    assert.ok(seen.some((e) => e.t === 'drink' && e.id === bo.id));

    await teacher('mode', { mode: 'present' });
    bo.emoteAt = 0;
    assert.equal((await post('/api/emote', { token: students[1].token, e: 'hop' })).ok, false);
    assert.equal((await post('/api/emote', { token: students[1].token, e: 'drink' })).ok, false);
    off();
  }));

test('hats unlock by term points or retry improvement and server enforces unlock rules', () =>
  withClassroom(async ({ game, students, post }) => {
    const ada = game.players.get(students[0].id);
    const cy = game.players.get(students[2].id);
    ada.points = 40;
    cy.improved = 1;

    await post('/api/hat', { token: students[0].token, hat: 'cap' });
    assert.equal(game.screenView().players.find((p) => p.id === ada.id).hat, 'cap');
    await assert.rejects(post('/api/hat', { token: students[0].token, hat: 'crown' }), /unlocked/);
    await assert.rejects(post('/api/hat', { token: students[0].token, hat: 'grad' }), /unlocked/);
    await assert.rejects(post('/api/hat', { token: students[0].token, hat: 'nope' }), /Unknown/);

    await post('/api/hat', { token: students[2].token, hat: 'grad' });
    assert.equal(cy.hat, 'grad');
    await post('/api/hat', { token: students[0].token, hat: '' });
    assert.equal(ada.hat, '');
  }));

test('submit gate holds room until all online students hand in, full-house awards team bonus, soft timer never closes', () =>
  withClassroom(async ({ game, students, post, teacher, setAllOnline }) => {
    setAllOnline(+1);
    await teacher('open', { def: { key: 'gate', kind: 'choice', title: 'Gate', prompt: 'Ready?', options: ['Yes', 'No'], correct: null, zones: false, scored: false } });
    await teacher('timer', { seconds: 0.05 });
    for (const s of students.slice(0, 2)) await post('/api/answer', { token: s.token, choice: 0 });
    await wait(100);
    assert.equal(game.records.gate.status, 'open', 'soft timer never closes by itself');

    for (const action of ['close', 'reveal', 'score']) {
      await assert.rejects(teacher(action), /2 still writing: Cy, Di/);
    }
    await assert.rejects(teacher('mode', { mode: 'present' }), /still writing/);
    await assert.rejects(teacher('open', { key: 'a' }), /still writing/);
    assert.equal(game.studentView(game.players.get(students[0].id)).question.waitingFor, undefined, 'waiting list stays private');

    await teacher('slide', { slide: 6 }); // changing slide is not gated
    for (const s of students.slice(2)) await post('/api/answer', { token: s.token, choice: 1 });
    await teacher('close');
    assert.equal(game.records.gate.fullHouse, true);
    await teacher('reveal');
    const a = game.records.gate.answers[students[3].id].attempts[0];
    assert.ok(a.breakdown.steps.some((s) => s.label === 'Everyone handed in' && s.chips === 10));

    // Missing the next question costs nothing (and resets streak).
    await teacher('open', { def: { key: 'g2', kind: 'choice', title: 'G2', prompt: 'Again?', options: ['Y', 'N'], correct: null, zones: false, scored: false } });
    for (const s of students.slice(0, 3)) await post('/api/answer', { token: s.token, choice: 0 });
    await teacher('close', { force: true });
    const diBefore = game.players.get(students[3].id).points;
    await teacher('reveal');
    assert.equal(game.records.g2.fullHouse, false);
    assert.equal(game.players.get(students[3].id).points, diBefore);
    assert.equal(game.studentView(game.players.get(students[3].id)).me.streak, 0);
  }));

test('break-time ball rolls only in free roam once games corner is earned, and class goal scales by online players', () =>
  withClassroom(async ({ game, students, post, teacher }) => {
    // Only 2 of 4 players online -> denominator uses 2, not 4.
    game.setOnline(game.players.get(students[0].id), +1);
    game.setOnline(game.players.get(students[1].id), +1);
    game.players.get(students[0].id).points = 80;
    assert.equal(game.klass().level, 1, '80 points / 2 online players = 40/student = Level 1');

    const kickIt = () => post('/api/move', { token: students[0].token, x: game.ball.x - 0.4, y: game.ball.y, dir: 'right', moving: true });
    game.classLevel = 2;
    await kickIt();
    assert.equal(game.stepBall(0.1), false, 'not earned yet');

    game.classLevel = 3;
    await kickIt();
    assert.equal(game.stepBall(0.1), true);
    assert.ok(game.ball.x > BALL_HOME.x);
    for (let i = 0; i < 200 && game.stepBall(0.1); i++) {}
    assert.equal(game.ball.vx, 0, 'slows down and stops');

    await kickIt();
    await teacher('mode', { mode: 'present' });
    game.stepBall(0.1);
    assert.deepEqual([game.ball.x, game.ball.y], [BALL_HOME.x, BALL_HOME.y], 'returns home in present mode');
  }));

test('opinion line reads server x-position and finale builds podium, improvers and streaks', () =>
  withClassroom(async ({ game, students, post, teacher }) => {
    await teacher('open', { def: { key: 'line', kind: 'line', title: 'Opinion', prompt: 'Tests first?', labels: ['Never', 'Always'] } });
    const xs = [FLOOR.x, FLOOR.x + (FLOOR.w - 1) / 2, FLOOR.x + FLOOR.w - 1, FLOOR.x + FLOOR.w - 1];
    for (const [i, s] of students.entries()) {
      await post('/api/move', { token: s.token, x: xs[i], y: 10 });
      await post('/api/answer', { token: s.token, value: 3 }); // browser claim ignored
    }
    assert.deepEqual(students.map((s) => game.records.line.answers[s.id].attempts[0].value), [0, 50, 100, 100]);
    assert.equal(game.studentView(game.players.get(students[0].id)).question.spread, undefined);
    await teacher('reveal');
    assert.deepEqual(game.screenView().question.spread, [1, 0, 1, 0, 2]);
    assert.equal(game.screenView().question.average, 63);

    // Add a second question so streaks >= 2 exist for the finale.
    await teacher('open', { def: { key: 'q2', kind: 'choice', title: 'Q2', prompt: 'Ok?', options: ['A', 'B'], correct: 0, zones: false } });
    await post('/api/answer', { token: students[0].token, choice: 0 });
    await post('/api/answer', { token: students[1].token, choice: 1 });
    await teacher('reveal');

    await teacher('finale', { on: true });
    const f = game.screenView().finale;
    assert.equal(f.podium[0].name, 'Ada');
    assert.equal(f.streak.n, 2);
    assert.ok(f.answers >= 6);
    await teacher('mode', { mode: 'free' });
    assert.equal(game.screenView().finale, null);
  }));

test('questions board tags slides, holds non-questions, counts votes for points, and shows top 5 on projector', () =>
  withClassroom(async ({ game, students, post, teacher }) => {
    assert.equal(looksLikeQuestion('Why do we need two explanations?'), true);
    assert.equal(looksLikeQuestion('how does the retry work'), true);
    assert.equal(looksLikeQuestion('this is boring'), false);

    const [ada, bo, cy] = students;
    const view = (s) => game.studentView(game.players.get(s.id));
    await teacher('slide', { slide: 4 });

    assert.equal((await post('/api/ask', { token: ada.token, text: 'Why do we need two explanations?' })).status, 'posted');
    await assert.rejects(post('/api/ask', { token: ada.token, text: 'And why three?' }), /wait/);
    assert.equal((await post('/api/ask', { token: bo.token, text: 'pizza pizza pizza' })).status, 'held');
    assert.equal(view(cy).asks.length, 1);
    assert.equal(view(cy).asks[0].slide, 4, 'tagged with current slide');
    assert.equal(view(bo).asks.find((a) => a.mine).status, 'held');

    const id = view(cy).asks[0].id;
    const before = game.players.get(ada.id).points;
    await assert.rejects(post('/api/vote', { token: ada.token, id }), /yours/);
    await post('/api/vote', { token: cy.token, id });
    await post('/api/vote', { token: bo.token, id });
    assert.equal(game.players.get(ada.id).points, before + 5);
    await post('/api/vote', { token: bo.token, id });
    assert.equal(view(ada).asks[0].votes, 1);

    await teacher('show-asks', { on: true });
    assert.equal(game.screenView().asks[0].slide, 4);

    // The join link goes big on the projector and comes off again; students never see the flag.
    assert.equal(game.screenView().showJoin, false);
    await teacher('show-join', { on: true });
    assert.equal(game.screenView().showJoin, true);
    assert.equal(game.teacherView().showJoin, true);
    assert.equal(view(ada).showJoin, undefined);
    await teacher('show-join', { on: false });
    assert.equal(game.screenView().showJoin, false);
    await teacher('ask-status', { id, status: 'answered' });
    assert.deepEqual(game.screenView().asks, []);
  }));

test('trophies, term persistence, atomic session restore, privacy boundaries and session report', () =>
  withClassroom(async ({ srv, game, base, dataDir, students, post, teacher, setAllOnline }) => {
    setAllOnline(+1);
    await teacher('open', { key: 'a' });
    const qa = game.lesson.questions.a;
    await post('/api/move', { token: students[0].token, ...spotFor(qa, [].concat(qa.correct)[0]) });
    await post('/api/answer', { token: students[0].token, text: 'Clear explanation of why gone is not fixed because the root cause remains.' });
    await teacher('close', { force: true });
    if (qa.text) await teacher('set-score', { pid: students[0].id, score: 3, feedback: 'Great' });
    await teacher('reveal');

    const [t] = game.screenView().trophies;
    assert.equal(t.name, 'Break it down');
    assert.equal(t.url, 'http://127.0.0.1:1/sample-deck.html#3');
    await teacher('trophy', { id: 'm' });
    assert.deepEqual(game.teacherView().lessonTrophies.map((x) => x.earned), [true, true]);

    // Privacy: students see own rank + top 5, never other players' points.
    const adaView = game.studentView(game.players.get(students[0].id));
    assert.equal(adaView.me.rank, 1);
    assert.ok(adaView.players.every((p) => !('points' in p)));
    assert.ok(game.teacherView().players.every((p) => 'points' in p));

    // Save + restore into a fresh Game, and verify term carry-over into next week.
    await game.save();
    const saved = JSON.parse(await readFile(game.sessionFile, 'utf8'));
    const restored = new Game({ lesson: await loadLesson(DECK), dataDir, aiMode: 'mock', termFile: null, log: () => {} });
    restored.restore(saved);
    assert.equal(restored.players.size, 4);
    assert.ok(restored.player(students[0].token), 'tokens survive restore');
    restored.dispose();

    const term = await loadTerm(game.termFile);
    const nextWeek = new Game({ lesson: await loadLesson(DECK), dataDir, aiMode: 'mock', term, termFile: null, log: () => {} });
    const adaNext = nextWeek.join('ADA', 0);
    assert.equal(adaNext.points, 0);
    assert.equal(nextWeek.studentView(adaNext).me.term.points, game.players.get(students[0].id).points);
    nextWeek.setHat(adaNext, 'cap');
    assert.equal(nextWeek.screenView().trophies.length, 2);
    nextWeek.dispose();

    // Report endpoint + markdown without names unless asked.
    const report = sessionReport(saved);
    assert.ok(!report.includes('Ada'));
    assert.match(sessionReport(saved, { names: true }), /\| Ada \|/);
    assert.equal((await fetch(`${base}/report?key=${srv.key}`)).status, 200);
    assert.equal((await fetch(`${base}/report?key=nope`)).status, 403);
  }));

test('shared doors transition rooms, spot the bug scores lines, and code bench supports instant retries', () =>
  withClassroom(async ({ game, students, post, teacher, setAllOnline }) => {
    setAllOnline(+1);
    await teacher('open', {
      def: { key: 'adv', kind: 'bug', title: 'Bug hunt', prompt: 'Which line?', code: 'let a = 1;\nlet b = a + ;\nreturn b;', correct: 2, room: 'lab' },
    });
    assert.equal(game.room, 'base');
    assert.equal(game.screenView().door.name, 'Workshop');

    await post('/api/move', { token: students[0].token, ...DOOR });
    assert.equal(game.screenView().players.find((p) => p.id === students[0].id).gone, true);
    assert.equal((await post('/api/move', { token: students[0].token, x: 10, y: 9 })).ok, false);
    for (const s of students.slice(1)) await post('/api/move', { token: s.token, ...DOOR });
    assert.equal(game.room, 'lab');
    assert.equal(game.live.key, 'adv');
    assert.ok(students.every((s) => canStand('lab', game.players.get(s.id).x, game.players.get(s.id).y)));

    await post('/api/answer', { token: students[0].token, line: 2 });
    await post('/api/answer', { token: students[1].token, line: 3 });
    await assert.rejects(post('/api/answer', { token: students[2].token, line: 9 }), /line/);
    await teacher('reveal', { force: true });
    assert.deepEqual(game.screenView().question.lineCounts, [0, 1, 1]);

    // Code bench: Bo fails one check, retries after reveal, and improves immediately!
    const tests = [{ name: 'adds', check: 'add(1, 2) === 3' }, { name: 'adds negatives', check: 'add(-1, -1) === -2' }];
    await teacher('open', { def: { key: 'bench', kind: 'code', title: 'Bench', prompt: 'Write add', starter: 'function add(a, b) {}', tests } });
    await post('/api/answer', { token: students[0].token, text: 'function add(a, b) { return a + b; }', passed: [true, true] });
    await post('/api/answer', { token: students[1].token, text: 'function add(a, b) { return 3; }', passed: [true, false, true, 'yes'] });
    await teacher('reveal', { force: true });

    const bo = game.players.get(students[1].id);
    assert.deepEqual(game.records.bench.answers[bo.id].attempts[0].auto.tests, [true, false]);
    assert.equal(game.studentView(bo).mine.canRetry, true, 'failing code check offers a retry');

    const retryRes = await post('/api/answer', { token: students[1].token, text: 'function add(a, b) { return a + b; }', passed: [true, true] });
    assert.equal(retryRes.state, 'revealed', 'code retry auto-reveals immediately');
    assert.equal(game.records.bench.answers[bo.id].attempts[1].improved, true);
    assert.equal(bo.improved, 1);

    // Take your seat from lab opens door back to classroom then seats everyone.
    await teacher('seat', { seconds: 0.05 });
    assert.equal(game.door.to, 'base');
    await wait(150);
    assert.equal(game.room, 'base');
    assert.equal(game.mode, 'present');
    assert.ok(students.every((s) => game.players.get(s.id).seat >= 0));
  }));

test('pair work assigns Driver/Navigator, seats pairs and trios, and scores once per pair', () =>
  withClassroom({ students: [['Ada', 0], ['Bo', 1], ['Cy', 2], ['Di', 3], ['Eli', 4]] }, async ({ game, students, post, teacher, untilScored, setAllOnline }) => {
    setAllOnline(+1);
    await teacher('open', { def: { key: 'duo', kind: 'text', pairs: true, title: 'Duo', prompt: 'Explain it together', rubric: ['explains the queue clearly'] } });
    const rec = game.records.duo;
    assert.deepEqual(rec.groups.map((g) => g.length).sort(), [2, 3], '5 students split into a pair and a trio');

    const [firstId, mateId] = rec.groups[0];
    const first = game.players.get(firstId);
    const mate = game.players.get(mateId);
    assert.equal(game.studentView(first).me.pairRole, 'driver');
    assert.equal(game.studentView(mate).me.pairRole, 'navigator');
    assert.equal(first.seat >= 0 && Math.abs(first.seat - mate.seat) === 1, true);

    const token = students.find((s) => s.id === first.id).token;
    const text = 'The queue keeps requests in order, which explains clearly why the second click waits for the first one to finish.';
    // Written pair work is one shared draft per desk: write it, then hand it in.
    await post('/api/draft', { token, text, meta: { activeMs: 60000 } });
    const mateToken = students.find((s) => s.id === mate.id).token;
    await assert.rejects(post('/api/draft', { token: mateToken, text: 'no' }), /has the pen/);
    await post('/api/answer', { token });
    assert.equal(game.studentView(mate).mine.text, text);
    assert.equal(game.studentView(mate).mine.by, first.name);
    assert.equal(game.teacherView().answers.length, 1);

    await teacher('score', { force: true });
    await untilScored();
    await teacher('reveal');
    const [a, b] = [first, mate].map((p) => rec.answers[p.id].attempts[0]);
    assert.equal(a.ai.score, b.ai.score);
    assert.ok(a.points > 0 && b.points > 0);
  }));

test('HTTP security boundaries reject path traversal, bad encodings, bad JSON, oversized bodies and missing keys', () =>
  withClassroom({ students: [] }, async ({ base }) => {
    const traversal = await fetch(`${base}/..%2fserver.js`);
    assert.equal(traversal.status, 403);

    const badEncoding = await fetch(`${base}/%E0%A4%A`);
    assert.equal(badEncoding.status, 400);

    const noKey = await fetch(`${base}/api/teacher/cue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noKey.status, 403);

    const badJson = await fetch(`${base}/api/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(badJson.status, 400);

    const tooLarge = await fetch(`${base}/api/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(70 * 1024) }),
    }).catch(() => ({ status: 413 }));
    assert.ok(tooLarge.status >= 400);
  }));
