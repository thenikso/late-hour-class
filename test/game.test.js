// End-to-end check of the main classroom flow with simulated students and mock AI scoring.
// Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../server.js';
import { zones, optionOrder } from '../public/js/world.js';
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
  return { x: z.x + z.w / 2 - 0.5, y: z.y + 2 };
}

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
  assert.equal(a.points, 10 + q.rows.length * 10);
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
