// End-to-end check of the main classroom flow with simulated students and mock AI scoring.
// Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../server.js';
import { zones, optionOrder, FLOOR } from '../public/js/world.js';
import { ROOMS, HOT_SEAT, DOOR, canStand, thingsIn } from '../public/js/rooms.js';
import { findPath } from '../public/js/path.js';
import { Game } from '../lib/game.js';
import { loadLesson } from '../lib/manifest.js';
import { loadTerm } from '../lib/term.js';
import { sessionReport } from '../lib/report.js';
import { looksLikeQuestion } from '../lib/asks.js';
import { classProgress, CLASS_LEVELS } from '../public/js/fun.js';
import { parseMarks } from '../public/js/marks.js';
import { studentCopy } from '../tools/serve-slides.js';
import { readFile } from 'node:fs/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DECK = join(ROOT, 'example/lectures/week-08/week-08-slides.html');
const PORT = 3990;
let srv, game, dataDir;
const base = `http://127.0.0.1:${PORT}`;

const post = async (path, body = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
};
const teacher = (action, body) => post(`/api/teacher/${action}?key=${srv.key}`, body);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const untilScored = async () => {
  for (let i = 0; i < 100 && game.scoring; i++) await wait(20);
};
/** Middle of the zone that shows `option` (zones are shuffled per question). */
function spotFor(q, option) {
  const order = optionOrder(q);
  const z = zones(order.length)[order.indexOf(option)];
  return { x: z.x + z.w / 2 - 0.5, y: 9 }; // row 9 is a row of chairs: nothing solid there
}
const BALL_HOME = ROOMS.base.ballHome;

const students = [];
before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'cge-'));
  srv = await start({ lesson: DECK, deck: 'http://127.0.0.1:1/week-08-slides.html', port: PORT, ai: 'mock', data: dataDir, quiet: true, host: '127.0.0.1' });
  game = srv.game;
  for (const [name, avatar] of [['Ada', 0], ['Bo', 1], ['Cy', 2], ['Di', 3]]) {
    const j = await post('/api/join', { name, avatar });
    students.push({ name, ...j });
  }
});
after(async () => {
  await srv.close();
  await rm(dataDir, { recursive: true, force: true });
});

test('the Week 8 deck loads with its slides and questions', () => {
  assert.equal(game.lesson.slides.length, 30);
  assert.equal(Object.keys(game.lesson.questions).length, 19);
  assert.equal(game.lesson.questions.a.slide, 3);
});

test('names are unique and unknown tokens are refused', async () => {
  await assert.rejects(post('/api/join', { name: 'ada', avatar: 1 }));
  await assert.rejects(post('/api/move', { token: 'nope', x: 3, y: 9 }));
});

test('the teacher can jump straight to the last hour', async () => {
  await teacher('slide', { slide: 25 });
  assert.equal(game.screen.slide, 25);
  await teacher('cue');
  assert.equal(game.screen.cue, 1);
});

test('take your seat moves everyone to the desks, then presents', async () => {
  await teacher('seat', { seconds: 0.05 });
  await wait(150);
  assert.equal(game.mode, 'present');
  const seats = new Set([...game.players.values()].map((p) => `${p.x},${p.y}`));
  assert.equal(seats.size, 4);
  await assert.rejects(post('/api/move', { token: students[0].token, x: 2, y: 2 }).then(() => {
    const p = game.players.get(students[0].id);
    if (p.x !== 2) throw new Error('locked');
  }));
});

test('a zone question scores by where students stand, and a retry beats nothing', async () => {
  await teacher('mode', { mode: 'free' });
  await teacher('open', { key: 'g' });
  const q = game.lesson.questions.g;
  // Ada right + both parts marked, Bo half right, Cy wrong, Di outside any zone.
  const plan = [
    [students[0], q.correct[0] ?? q.correct, '==①if A: the queue drops the second click== and ==②if B: the cache keeps the old total because the key is wrong=='],
    [students[1], q.partial[0], 'Maybe a timing thing'],
    [students[2], [0, 1, 2, 3].find((o) => ![].concat(q.correct, q.partial).includes(o)), 'no idea'],
  ];
  for (const [s, opt, text] of plan) {
    const at = spotFor(q, opt);
    await post('/api/move', { token: s.token, ...at, dir: 'down', moving: false });
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
  assert.ok(ada.points > rec.answers[students[2].id].attempts[0].points, 'right answer earns more');
  assert.ok(Object.keys(parseMarks(ada.text)).length === 2);

  // The screen sees the wall; students see their own breakdown.
  const screen = game.screenView();
  assert.equal(screen.question.wall.length, 3);
  const cy = game.studentView(game.players.get(students[2].id));
  assert.ok(cy.mine.breakdown.total > 0);

  // Cy retries with a better answer from the right zone.
  assert.equal(cy.mine.canRetry, true, "a weak answer can be retried");
  {
    await post('/api/move', { token: students[2].token, ...spotFor(q, [].concat(q.correct)[0]) });
    await post('/api/answer', {
      token: students[2].token,
      text: '==①if A: the second request is dropped by the queue== ==②if B: the cache returns the stale total==',
      meta: { activeMs: 90000 },
    });
    await teacher('score');
    await untilScored();
    await teacher('reveal');
    const e = rec.answers[students[2].id];
    assert.equal(e.attempts.length, 2);
    assert.equal(e.attempts[1].improved, true);
    assert.equal(game.players.get(students[2].id).improved, 1);
    assert.equal(game.players.get(students[2].id).points, e.attempts[1].points, 'best attempt counts, no penalty');
  }
});

test('grid questions are marked row by row without AI', async () => {
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
  // Ada also handed in the question before this one: 2 in a row is worth 5 more.
  assert.equal(a.points, 10 + q.rows.length * 10 + 5);
  assert.ok(a.breakdown.steps.some((s) => s.label === '2 in a row' && s.chips === 5));
  // Bo skipped nothing either, and a streak is about handing in, not about being right.
  assert.ok(game.records.d.answers[students[1].id].attempts[0].breakdown.steps.some((s) => s.label === '2 in a row'));
  assert.equal(game.studentView(game.players.get(students[0].id)).me.streak, 2);
});

test('the teacher has the final word on a score', async () => {
  await teacher('open', { key: 'f' });
  await post('/api/answer', { token: students[3].token, text: '==①A: the parser== ==②predicts a crash==', meta: { activeMs: 30000 } });
  await teacher('close');
  await teacher('set-score', { pid: students[3].id, score: 3, feedback: 'Spot on' });
  await teacher('reveal');
  const a = game.records.f.answers[students[3].id].attempts[0];
  assert.equal(a.ai.score, 3);
  assert.equal(a.ai.feedback, 'Spot on');
  assert.ok(a.points >= 10 + 45);
  await teacher('spotlight', { pid: students[3].id });
  assert.equal(game.screenView().spotlight.name, 'Di');
});

test('the session file restores players with their tokens', async () => {
  await game.save();
  const data = JSON.parse(await readFile(game.sessionFile, 'utf8'));
  assert.equal(data.players.length, 4);
  assert.ok(data.records.g);
});

test('the student copy of a deck drops notes and work-slide answers', async () => {
  const html = await readFile(DECK, 'utf8');
  const out = studentCopy(html);
  assert.ok(html.includes('class="sn"'));
  assert.ok(!out.includes('class="sn"'));
  const workCues = (s) => [...s.matchAll(/<section[^>]*data-mode="work"[\s\S]*?<\/section>/g)].filter((m) => m[0].includes('data-cue')).length;
  assert.ok(workCues(html) > 0);
  assert.equal(workCues(out), 0);
});

// ---- the fun layer ---------------------------------------------------------------

test('emotes come from a fixed list, are rate-limited, and "lost" reaches the teacher', async () => {
  const seen = [];
  const off = game.onFx((e) => seen.push(e));
  const bo = game.players.get(students[1].id);
  bo.emoteAt = 0;
  game.setOnline(bo, +1);
  assert.equal((await post('/api/emote', { token: students[1].token, e: 'wave' })).ok, true);
  assert.equal((await post('/api/emote', { token: students[1].token, e: 'wave' })).ok, false, 'too soon after the last one');
  await assert.rejects(post('/api/emote', { token: students[1].token, e: '<script>' }));
  assert.deepEqual(seen.filter((e) => e.t === 'emote'), [{ t: 'emote', id: students[1].id, e: 'wave' }]);

  bo.emoteAt = 0;
  await post('/api/emote', { token: students[1].token, e: 'lost' });
  assert.deepEqual(game.teacherView().lost, ['Bo']);
  assert.equal(game.studentView(bo).me.lost, true);
  assert.equal(game.screenView().players.some((p) => 'lostAt' in p || 'lost' in p), false, 'only the teacher sees who is lost');
  bo.emoteAt = 0;
  await post('/api/emote', { token: students[1].token, e: 'yes' });
  assert.deepEqual(game.teacherView().lost, [], '"Got it" clears it');

  // hops are for the open floor, not for explanations
  bo.emoteAt = 0;
  await teacher('mode', { mode: 'present' });
  assert.equal((await post('/api/emote', { token: students[1].token, e: 'hop' })).ok, false);
  await teacher('mode', { mode: 'free' });
  assert.equal((await post('/api/emote', { token: students[1].token, e: 'hop' })).ok, true);
  game.setOnline(bo, -1);
  off();
});

test('hats unlock with your own points or a better retry, and the server checks', async () => {
  const ada = game.players.get(students[0].id);
  const cy = game.players.get(students[2].id);
  assert.ok(ada.points >= 30 && ada.points < 550);
  await post('/api/hat', { token: students[0].token, hat: 'cap' });
  assert.equal(game.screenView().players.find((p) => p.id === ada.id).hat, 'cap');
  await assert.rejects(post('/api/hat', { token: students[0].token, hat: 'crown' }), /unlocked/);
  await assert.rejects(post('/api/hat', { token: students[0].token, hat: 'nope' }));
  assert.equal(ada.improved, 0);
  await assert.rejects(post('/api/hat', { token: students[0].token, hat: 'grad' }), /unlocked/);
  await post('/api/hat', { token: students[2].token, hat: 'grad' }); // Cy improved on a retry
  assert.equal(cy.hat, 'grad');
  await post('/api/hat', { token: students[0].token, hat: '' });
  assert.equal(ada.hat, '');
});

test('everyone handing in earns the whole room a bonus, and a soft timer never closes anything', async () => {
  for (const s of students) game.setOnline(game.players.get(s.id), +1);
  await teacher('open', { def: { key: 'team', kind: 'choice', title: 'Quick poll', prompt: 'Tabs or spaces?', options: ['Tabs', 'Spaces'], correct: null, zones: false, scored: false } });
  await teacher('timer', { seconds: 0.05 });
  assert.ok(game.screenView().question.timerEndsAt > Date.now() - 1000);
  for (const s of students.slice(0, 3)) await post('/api/answer', { token: s.token, choice: 0 });
  await wait(120);
  assert.equal(game.records.team.status, 'open', 'time is up, but the teacher decides');
  await post('/api/answer', { token: students[3].token, choice: 1 });
  await teacher('close');
  assert.equal(game.records.team.fullHouse, true);
  await teacher('reveal');
  const a = game.records.team.answers[students[3].id].attempts[0];
  assert.ok(a.breakdown.steps.some((s) => s.label === 'Everyone handed in' && s.chips === 10));

  // One student misses the next one: no team bonus, and nobody loses anything.
  await teacher('open', { def: { key: 'team2', kind: 'choice', title: 'Quick poll 2', prompt: 'Again?', options: ['Yes', 'No'], correct: null, zones: false, scored: false } });
  for (const s of students.slice(0, 3)) await post('/api/answer', { token: s.token, choice: 0 });
  await assert.rejects(teacher('close'), /still writing: Di/, 'the gate: someone is still writing');
  await teacher('close', { force: true });
  assert.equal(game.records.team2.fullHouse, false);
  const before = game.players.get(students[3].id).points;
  await teacher('reveal');
  assert.equal(game.players.get(students[3].id).points, before, 'missing a question costs nothing');
  assert.equal(game.studentView(game.players.get(students[3].id)).me.streak, 0, 'but the streak starts again');
  for (const s of students) game.setOnline(game.players.get(s.id), -1);
});

test('the class goal fills with everyone\'s points and a level, once earned, stays', () => {
  const n = 4;
  assert.equal(classProgress(0, n).level, 0);
  assert.equal(classProgress(CLASS_LEVELS[0].at * n, n).level, 1);
  assert.deepEqual(classProgress(CLASS_LEVELS[1].at * n, n).unlocked, ['lights', 'cat']);
  assert.equal(classProgress(10, n, 2).level, 2, 'a newcomer raising the bar does not take a reward away');
  assert.equal(classProgress(1e6, n).next, null);
  const k = game.screenView().klass;
  assert.equal(k.total, [...game.players.values()].reduce((s, p) => s + p.points, 0));
  assert.ok(k.level >= 1 && k.level === game.classLevel);
});

test('the ball rolls only in free roam, once the class has earned the games corner', async () => {
  const kickIt = () => post('/api/move', { token: students[0].token, x: game.ball.x - 0.4, y: game.ball.y, dir: 'right', moving: true });
  await teacher('mode', { mode: 'free' });
  game.classLevel = 2;
  await kickIt();
  assert.equal(game.stepBall(0.1), false, 'not earned yet');
  game.classLevel = 3;
  await kickIt();
  assert.equal(game.stepBall(0.1), true);
  assert.ok(game.ball.x > BALL_HOME.x, 'kicked away from the player');
  for (let i = 0; i < 200 && game.stepBall(0.1); i++);
  assert.equal(game.ball.vx, 0, 'it slows down and stops');
  assert.ok(game.ball.x >= 1 && game.ball.x <= 30 && game.ball.y >= 7 && game.ball.y <= 17, 'and stays on the floor');
  await kickIt();
  await teacher('mode', { mode: 'present' });
  game.stepBall(0.1);
  assert.deepEqual([game.ball.x, game.ball.y], [BALL_HOME.x, BALL_HOME.y], 'back in its corner for the explanation');
  game.classLevel = game.klass().level;
});

test('the finale shows a podium of three, the improvers and the longest streak', async () => {
  await teacher('finale', { on: true });
  const f = game.screenView().finale;
  assert.ok(f.podium.length <= 3 && f.podium[0].points >= f.podium.at(-1).points);
  assert.equal(f.podium[0].name, 'Ada');
  assert.deepEqual(f.improved.map((p) => p.name), ['Cy']);
  assert.ok(f.streak.n >= 2 && f.streak.players.length >= 1);
  assert.ok(f.answers >= 10);
  await teacher('mode', { mode: 'free' });
  assert.equal(game.screenView().finale, null, 'any room change ends it');
});

// ---- the gate, the hot seat, the opinion line -------------------------------------------

test('the submit gate holds the room until everyone handed in, unless the teacher overrides', async () => {
  for (const s of students) game.setOnline(game.players.get(s.id), +1);
  await teacher('open', { def: { key: 'gate', kind: 'choice', title: 'Gate', prompt: 'Ready?', options: ['Yes', 'No'], correct: null, zones: false, scored: false } });
  for (const s of students.slice(0, 2)) await post('/api/answer', { token: s.token, choice: 0 });
  for (const action of ['close', 'reveal', 'score']) await assert.rejects(teacher(action), /2 still writing: Cy, Di/);
  await assert.rejects(teacher('mode', { mode: 'present' }), /still writing/, 'slides would cover the question');
  await assert.rejects(teacher('open', { key: 'a' }), /still writing/, 'another question would replace it');
  assert.equal(game.records.gate.status, 'open');
  assert.equal(game.studentView(game.players.get(students[0].id)).question.waitingFor, undefined, 'the class never sees who is still writing');
  await teacher('slide', { slide: 26 }); // looking at another slide is not moving on
  for (const s of students.slice(2)) await post('/api/answer', { token: s.token, choice: 1 });
  await teacher('close');
  assert.equal(game.records.gate.status, 'scored');
  assert.ok(game.records.gate.allInAt >= game.records.gate.openedAt, 'the report knows when everyone was in');
  await teacher('reveal');
});

test('spotlight walks the student to the hot seat and back; pick chooses someone who answered', async () => {
  const cy = game.players.get(students[2].id);
  await post('/api/move', { token: students[2].token, x: 20, y: 13, dir: 'left', moving: false });
  const warp = cy.warp;
  await teacher('spotlight', { pid: cy.id });
  assert.deepEqual([cy.x, cy.y], [HOT_SEAT.x, HOT_SEAT.y]);
  assert.equal(cy.warp, warp + 1);
  await post('/api/move', { token: students[2].token, x: 3, y: 9, warp });
  assert.equal(cy.x, HOT_SEAT.x, 'a move sent before the browser saw the walk-up is ignored');
  assert.equal(game.screenView().spotlight.choice, 'No', 'the projector shows the words, not an option number');
  await teacher('spotlight', { pid: null });
  assert.deepEqual([cy.x, cy.y], [20, 13], 'back where they stood');
  await teacher('pick');
  assert.ok(game.records.gate.answers[game.spotlight.pid]);
  await teacher('spotlight', { pid: null });
});

test('an opinion line reads where students stand and never marks anyone right or wrong', async () => {
  await teacher('open', { def: { key: 'line', kind: 'line', title: 'Opinion', prompt: 'Tests first?', labels: ['Never', 'Always'] } });
  const xs = [FLOOR.x, FLOOR.x + (FLOOR.w - 1) / 2, FLOOR.x + FLOOR.w - 1, FLOOR.x + FLOOR.w - 1];
  for (const [i, s] of students.entries()) {
    await post('/api/move', { token: s.token, x: xs[i], y: 10 });
    await post('/api/answer', { token: s.token, value: 3 }); // the browser cannot claim a position
  }
  assert.deepEqual(students.map((s) => game.records.line.answers[s.id].attempts[0].value), [0, 50, 100, 100]);
  assert.equal(game.studentView(game.players.get(students[0].id)).question.spread, undefined, 'the spread waits for the reveal');
  await teacher('reveal');
  const q = game.screenView().question;
  assert.deepEqual(q.spread, [1, 0, 1, 0, 2]);
  assert.equal(q.average, 63);
  assert.ok(game.records.line.answers[students[0].id].attempts[0].breakdown.steps.every((s) => !/right/i.test(s.label)));
  for (const s of students) game.setOnline(game.players.get(s.id), -1);
});

// ---- the questions board ---------------------------------------------------------------------

test('questions go on the board, anything else is held for the teacher, and votes earn a few points', async () => {
  assert.equal(looksLikeQuestion('Why do we need two explanations?'), true);
  assert.equal(looksLikeQuestion('how does the retry work'), true);
  assert.equal(looksLikeQuestion('this is boring'), false);
  const [ada, bo, cy] = students;
  const view = (s) => game.studentView(game.players.get(s.id));

  assert.equal((await post('/api/ask', { token: ada.token, text: 'Why do we need two explanations?' })).status, 'posted');
  await assert.rejects(post('/api/ask', { token: ada.token, text: 'And why three?' }), /wait/, 'one at a time');
  assert.equal((await post('/api/ask', { token: bo.token, text: 'pizza pizza pizza' })).status, 'held');
  assert.deepEqual(view(cy).asks.map((a) => a.text), ['Why do we need two explanations?'], 'held messages stay off the board');
  assert.equal(view(bo).asks.find((a) => a.mine).status, 'held', 'but their author sees them waiting');
  assert.equal(game.teacherView().asks.length, 2);

  const id = view(cy).asks[0].id;
  const before = game.players.get(ada.id).points;
  await assert.rejects(post('/api/vote', { token: ada.token, id }), /yours/);
  await post('/api/vote', { token: cy.token, id });
  await post('/api/vote', { token: bo.token, id });
  assert.equal(view(ada).asks[0].votes, 2);
  assert.equal(game.players.get(ada.id).points, before + 5, 'a voted question is worth 5, however many votes');
  await post('/api/vote', { token: bo.token, id });
  assert.equal(view(ada).asks[0].votes, 1, 'a second press takes the vote back');

  assert.equal(game.screenView().asks, null);
  await teacher('show-asks', { on: true });
  assert.equal(game.screenView().asks[0].votes, 1);
  await teacher('ask-status', { id, status: 'answered' });
  assert.deepEqual(game.screenView().asks, []);
  await teacher('show-asks', { on: false });
});

// ---- trophies and the term ------------------------------------------------------------------------

test('a concept trophy is earned at the reveal and carries a link to its slide', async () => {
  const seen = [];
  const off = game.onFx((e) => seen.push(e));
  assert.deepEqual(game.lesson.trophies.map((t) => t.after), ['a', 'm']);
  assert.equal(game.screenView().trophies.length, 0);
  await teacher('open', { key: 'a' });
  await teacher('reveal');
  const [t] = game.screenView().trophies;
  assert.equal(t.name, 'Gone is not fixed');
  assert.equal(t.url, 'http://127.0.0.1:1/week-08-slides.html#3');
  assert.ok(seen.some((e) => e.t === 'trophy'));
  await teacher('reveal');
  assert.equal(game.shelf.length, 1, 'only once');
  await teacher('trophy', { id: 'm' }); // the teacher can also award one by hand
  assert.deepEqual(game.teacherView().lessonTrophies.map((x) => x.earned), [true, true]);
  off();
});

test('points and trophies carry over to the next lesson through the term file', async () => {
  await game.save();
  const term = await loadTerm(game.termFile);
  const ada = game.players.get(students[0].id);
  assert.equal(term.players.ada.points, ada.points);
  assert.equal(term.trophies.length, 2);

  // Next week: a new game, the same term file.
  const next = new Game({ lesson: await loadLesson(DECK), dataDir, aiMode: 'mock', term, termFile: null, log: () => {} });
  const again = next.join('ADA', 0);
  assert.equal(again.points, 0, "today's board starts at zero");
  assert.equal(next.studentView(again).me.term.points, ada.points);
  assert.equal(next.studentView(again).me.rank, null);
  next.setHat(again, 'cap'); // unlocked by the term total
  assert.equal(next.screenView().trophies.length, 2, 'the shelf is still full');
  assert.equal(next.join('Newcomer', 1).carried, 0);
  clearTimeout(next._emit);
  clearTimeout(next._save);
});

test("the class sees the top 5, a student sees their own place, and nobody else's points", () => {
  const view = game.studentView(game.players.get(students[0].id));
  assert.equal(view.me.rank, 1);
  assert.ok(view.board.top.length <= 5);
  assert.ok(view.players.every((p) => !('points' in p)));
  assert.ok(game.teacherView().players.every((p) => 'points' in p));
});

test('the session report gives hand-in rates without names unless asked', async () => {
  await game.save();
  const data = JSON.parse(await readFile(game.sessionFile, 'utf8'));
  const report = sessionReport(data);
  assert.match(report, /\| Gate \| 4\/4 \(100%\)/);
  assert.match(report, /Hand-in target/);
  assert.match(report, /Why do we need two explanations\?/);
  assert.ok(!report.includes('Ada'));
  assert.match(sessionReport(data, { names: true }), /\| Ada \|/);
  const r = await fetch(`${base}/report?key=${srv.key}`);
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/report?key=nope`)).status, 403);
});

// ---- rooms: furniture, doors, adventures ------------------------------------------------------

test('furniture is solid, every seat can be reached, and the server refuses a spot inside a desk', async () => {
  for (const room of Object.keys(ROOMS)) {
    assert.ok(canStand(room, DOOR.x, DOOR.y) && canStand(room, HOT_SEAT.x, HOT_SEAT.y), `${room}: the door and the hot seat are free`);
    for (const seat of ROOMS[room].seats) assert.ok(findPath(room, DOOR, seat).length > 0, `${room}: a way from the door to the seat at ${seat.x},${seat.y}`);
    for (const thing of thingsIn(room, ['games', 'trophy'])) assert.ok(thing.def.flat || thing.solid, `${room}: ${thing.kind} has a solid box`);
  }
  for (const [x, y] of ROOMS.base.catSpots) assert.ok(canStand('base', x, y, ['games', 'trophy']), `the cat can stand at ${x},${y}`);
  assert.equal(canStand('base', 4, 8), false, 'feet inside a desk');
  assert.ok([...game.players.values()].every((p) => canStand(game.room, p.x, p.y)), 'nobody joined inside a desk');
  assert.equal(canStand('base', 4, 9), true, 'on its chair');

  await teacher('mode', { mode: 'free' });
  const ada = game.players.get(students[0].id);
  await post('/api/move', { token: students[0].token, x: 4, y: 9 });
  assert.equal((await post('/api/move', { token: students[0].token, x: 4, y: 8 })).ok, false);
  assert.deepEqual([ada.x, ada.y], [4, 9], 'the player stays where they were');
  assert.equal((await post('/api/move', { token: students[0].token, x: 99, y: 99 })).ok, false, 'and off the floor is refused too');
});

test('a question in another room opens the door; the class walks through together', async () => {
  for (const s of students) game.setOnline(game.players.get(s.id), +1);
  await teacher('open', { def: { key: 'adventure', kind: 'bug', title: 'Bug hunt', prompt: 'Which line?', code: 'let a = 1;\nlet b = a + ;\nreturn b;', correct: 2, room: 'lab' } });
  assert.equal(game.room, 'base');
  assert.equal(game.screenView().door.name, 'Workshop');
  assert.equal(game.live?.key === 'adventure', false, 'the question waits for the class to arrive');

  // Ada walks through and waits on the other side; the others follow.
  await post('/api/move', { token: students[0].token, ...DOOR });
  assert.equal(game.screenView().players.find((p) => p.id === students[0].id).gone, true);
  assert.equal((await post('/api/move', { token: students[0].token, x: 10, y: 9 })).ok, false, 'no walking about once through');
  assert.equal(game.room, 'base');
  for (const s of students.slice(1)) await post('/api/move', { token: s.token, ...DOOR });
  assert.equal(game.room, 'lab', 'the last one through: nobody waits for the countdown');
  assert.equal(game.door, null);
  assert.equal(game.live.key, 'adventure');
  const spots = students.map((s) => game.players.get(s.id)).map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(spots).size, 4, 'everyone lands on their own spot');
  assert.ok(students.every((s) => !game.players.get(s.id).gone && canStand('lab', game.players.get(s.id).x, game.players.get(s.id).y)));

  // Spot the bug: marked by rule, with how long each student took for the teacher.
  await post('/api/answer', { token: students[0].token, line: 2 });
  await post('/api/answer', { token: students[1].token, line: 3 });
  await assert.rejects(post('/api/answer', { token: students[2].token, line: 9 }), /line/);
  await teacher('reveal', { force: true });
  const rec = game.records.adventure;
  assert.equal(rec.answers[students[0].id].attempts[0].auto.choice, 'right');
  assert.equal(rec.answers[students[0].id].attempts[0].points - rec.answers[students[1].id].attempts[0].points, 30);
  assert.deepEqual(game.screenView().question.lineCounts, [0, 1, 1]);
  assert.ok(game.teacherView().answers[0].took >= 0);

  // "Take your seat" from another room is the walk back; when it ends everyone is seated in the classroom.
  await teacher('seat', { seconds: 0.05 });
  assert.equal(game.door.to, 'base');
  await wait(150);
  assert.equal(game.room, 'base');
  assert.equal(game.mode, 'present');
  assert.ok(students.every((s) => game.players.get(s.id).seat >= 0));
  await teacher('mode', { mode: 'free' });
});

test('the code bench trusts the browser for the checks but shows the teacher the code', async () => {
  const tests = [{ name: 'adds', check: 'add(1, 2) === 3' }, { name: 'adds negatives', check: 'add(-1, -1) === -2' }];
  await teacher('open', { def: { key: 'bench', kind: 'code', title: 'Bench', prompt: 'Write add', starter: 'function add(a, b) {}', tests } });
  assert.deepEqual(game.studentView(game.players.get(students[0].id)).question.tests, tests);
  await post('/api/answer', { token: students[0].token, text: 'function add(a, b) { return a + b; }', passed: [true, true] });
  await post('/api/answer', { token: students[1].token, text: 'function add(a, b) { return 3; }', passed: [true, false, true, 'yes'] });
  await teacher('reveal', { force: true });
  const [ada, bo] = [students[0], students[1]].map((s) => game.records.bench.answers[s.id].attempts[0]);
  assert.deepEqual(bo.auto.tests, [true, false], 'only real ticks, and only as many as there are checks');
  assert.ok(ada.breakdown.steps.some((s) => s.label === '2/2 checks pass' && s.chips === 20));
  assert.equal(game.teacherView().answers.find((a) => a.pid === students[1].id).text, 'function add(a, b) { return 3; }');
  assert.deepEqual(game.screenView().question.passCounts, [2, 1]);
});

test('pair work: one hand-in counts for both, is scored once, and each keeps their own points', async () => {
  await teacher('open', { def: { key: 'duo', kind: 'text', pairs: true, title: 'Duo', prompt: 'Explain it together', rubric: ['explains the queue clearly'] } });
  const rec = game.records.duo;
  assert.deepEqual(rec.groups.map((g) => g.length), [2, 2]);
  const [first, mate] = rec.groups[0].map((id) => game.players.get(id));
  const token = students.find((s) => s.id === first.id).token;
  assert.deepEqual(game.studentView(mate).me.partners.map((p) => p.name), [first.name]);
  assert.equal(first.seat >= 0 && Math.abs(first.seat - mate.seat) === 1, true, 'the pair sits side by side');

  const text = 'The queue keeps requests in order, which explains clearly why the second click waits for the first one to finish.';
  await post('/api/answer', { token, text, meta: { activeMs: 60000 } });
  assert.equal(game.studentView(mate).mine.text, text);
  assert.equal(game.studentView(mate).mine.by, first.name);
  assert.equal(game.stillWriting().length, 2, 'only the other pair is still writing');
  assert.equal(game.teacherView().answers.length, 1, 'the teacher sees one answer for the pair');
  assert.equal(game.teacherView().answers[0].name, `${first.name} + ${mate.name}`);

  await teacher('score', { force: true });
  await untilScored();
  await teacher('reveal');
  const [a, b] = [first, mate].map((p) => rec.answers[p.id].attempts[0]);
  assert.equal(a.ai.score, b.ai.score);
  assert.ok(a.points > 0 && b.points > 0);
  assert.equal(game.screenView().question.wall.length, 1);
  assert.deepEqual(game.screenView().question.wall[0].ids.sort(), [first.id, mate.id].sort());
  for (const s of students) game.setOnline(game.players.get(s.id), -1);
  await teacher('mode', { mode: 'free' });
});

test('the demo lesson loads with every kind of question, rooms and trophies', async () => {
  const demo = await loadLesson(join(ROOT, 'example/demo-lesson.json'));
  assert.deepEqual([...new Set(demo.order.map((k) => demo.questions[k].kind))].sort(), ['bug', 'choice', 'code', 'grid', 'line', 'text']);
  assert.ok(demo.order.every((k) => !demo.questions[k].room || ROOMS[demo.questions[k].room]));
  assert.equal(demo.questions.pair.pairs, true);
  assert.equal(demo.trophies.length, 2);
});
