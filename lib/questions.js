// Question lifecycle, pair grouping, submit gate, retries and hand-in streaks.
// Separated from lib/game.js so each file stays small enough to read in one sitting.

import { checkAnswer, answerText } from './checks.js';
import { scoreAnswers } from './ai.js';
import { normaliseQuestion } from './manifest.js';
import { needsAi, autoScore, canRetry, breakdown } from './scoring.js';
import { zoneAt, optionOrder, lineValue } from '../public/js/shared/world.js';
import { seatPairs, nearestFree } from '../public/js/shared/rooms.js';
import { clamp, shuffle } from '../public/js/shared/util.js';
import { startRapid, stopRapid } from './rapid.js';

const now = () => Date.now();
const DOOR_SECONDS = 10;

/**
 * The submit gate: thrown when the teacher tries to move on while students are
 * still writing. The teacher page answers with a "move on anyway" button, which
 * repeats the action with `force`.
 */
export class GateError extends Error {
  constructor(names) {
    super(`${names.length} still writing: ${names.join(', ')}`);
    this.gate = true;
    this.waitingFor = names;
  }
}

/** Online students who have not handed in the open question yet. */
export function stillWriting(game, rec = game.live) {
  // A rapid round runs on its own clock: nobody is "still writing" it.
  if (!rec || rec.status !== 'open' || rec.def.kind === 'rapid') return [];
  return game.online().filter((p) => !rec.answers[p.id]);
}

/** The submit gate: moving on waits for everyone, unless the teacher overrides. */
export function checkGate(game, force) {
  if (force || !game.gate) return;
  const names = stillWriting(game).map((p) => p.name);
  if (names.length) throw new GateError(names);
}

/** Questions that got at least one answer, newest first. */
export function answeredRecords(game) {
  return Object.values(game.records)
    .filter((r) => Object.keys(r.answers).length)
    .sort((a, b) => b.seq - a.seq);
}

/** How many questions in a row the player handed in just before `rec`. */
export function streakBefore(game, pid, rec) {
  let n = 0;
  for (const r of answeredRecords(game)) {
    if (r.seq >= rec.seq) continue;
    if (!r.answers[pid]) break;
    n++;
  }
  return n;
}

/** The player's current run of handed-in questions (an open question doesn't break it yet). */
export function streak(game, pid) {
  let n = 0;
  for (const r of answeredRecords(game)) {
    if (r.answers[pid]) n++;
    else if (r.status !== 'open') break;
  }
  return n;
}

/** The player ids that share an answer with `pid` on this question, `pid` first. */
export function groupOf(rec, pid) {
  const group = rec.groups?.find((g) => g.includes(pid));
  return group ? [pid, ...group.filter((id) => id !== pid)] : [pid];
}

/** How many unscored retries are waiting on a revealed question (counted once per pair). */
export function pendingRetries(rec) {
  if (!rec || rec.status !== 'revealed') return 0;
  const seen = new Set();
  for (const entry of Object.values(rec.answers)) {
    const last = entry.attempts.at(-1);
    if (last && last.n > 1 && last.state === 'submitted') {
      seen.add(`${last.by || entry.id}:${last.at}`);
    }
  }
  return seen.size;
}

/**
 * Pair work: put the students who are online in twos (an odd one out makes a
 * three), and seat each pair side by side if the room has seats.
 * The first member of each group is the suggested Driver; partners are Navigators.
 */
export function makePairs(game) {
  const ids = shuffle(game.online().map((p) => p.id));
  const groups = [];
  while (ids.length) {
    groups.push(ids.splice(0, ids.length === 3 ? 3 : 2));
  }
  const tables = seatPairs(game.room);
  groups.forEach((group, i) => {
    const table = tables[i];
    if (!table) return;
    group.slice(0, 2).forEach((id, k) => {
      game.place(game.players.get(id), table[k].x, table[k].y, 'up');
    });
    // Seat a 3rd group member right beside the table rather than leaving them across the room.
    if (group[2]) {
      const spot = nearestFree(game.room, table[1].x + 1, table[1].y, game.unlocked());
      game.place(game.players.get(group[2]), spot.x, spot.y, 'up');
    }
  });
  return groups;
}

/**
 * Open a lesson question by key, or a question the teacher typed on the spot.
 * A question that names another room opens the door first and starts on arrival.
 */
export function openQuestion(game, keyOrDef, { force = false, travel = true } = {}) {
  const def =
    typeof keyOrDef === 'string'
      ? game.questionDef(keyOrDef)
      : normaliseQuestion(keyOrDef.key || `live-${Object.keys(game.records).length + 1}`, keyOrDef);
  if (!def) throw new Error('Unknown question');
  if (game.live && game.live.key !== def.key && game.live.status === 'open') {
    closeQuestion(game, { force }); // one question at a time
  }
  if (travel && def.room && def.room !== game.room) {
    return game.openDoor(def.room, DOOR_SECONDS, { force: true, then: { open: keyOrDef } });
  }
  game.closeDoor();

  const rec = game.records[def.key] || { key: def.key, def, answers: {}, openedAt: now(), seq: ++game.seq };
  rec.def = def;
  rec.status = 'open';
  rec.timerEndsAt = null;
  rec.exampleShown = false;
  if (def.pairs && !rec.groups) rec.groups = makePairs(game);
  game.records[def.key] = rec;
  game.current = def.key;
  stopRapid(game);
  if (def.kind === 'rapid') startRapid(game, rec);

  game.setSpotlight(null);
  game.finale = false;
  clearTimeout(game.seatTimer);
  game.seatingEndsAt = null;
  game.mode = 'question';
  game.changed();
  return rec;
}

function markByRule(q, attempt) {
  attempt.auto = autoScore(q, attempt);
  if (attempt.state === 'submitted') attempt.state = 'scored';
}

function scoreAndRevealAttempt(game, rec, entry) {
  const q = rec.def;
  const a = entry.attempts.at(-1);
  if (a.state === 'submitted' && !needsAi(q)) markByRule(q, a);
  if (a.state === 'submitted') return false; // a written answer nobody scored yet stays hidden
  const bestBefore = Math.max(0, ...entry.attempts.slice(0, -1).map((x) => x.points || 0));
  a.breakdown = breakdown(q, a, { run: streakBefore(game, entry.id, rec), fullHouse: rec.fullHouse });
  a.points = a.breakdown.total;
  a.improved = a.n > 1 && a.points > bestBefore;
  a.state = 'revealed';
  return true;
}

/** A student hands in (or, after the reveal, retries). In pair work it counts for the whole pair. */
export function submitAnswer(game, p, body) {
  const rec = game.live;
  if (!rec) throw new Error('No question is open');
  const q = rec.def;
  const group = groupOf(rec, p.id);
  const entry = rec.answers[p.id] || { id: p.id, attempts: [] };
  const isRetry = rec.status === 'revealed';
  if (isRetry && !canRetry(q, entry)) throw new Error('No retry available');
  if (!isRetry && rec.status !== 'open') throw new Error('This question is closed');
  if (q.kind === 'rapid') throw new Error('Just stand in your answer: it locks in when the time runs out.');

  const attempt = {
    n: isRetry ? entry.attempts.length + 1 : 1,
    at: now(),
    text: typeof body.text === 'string' ? body.text.slice(0, 4000) : '',
    // How it was typed, as reported by the browser. Only used for flags, never for points.
    meta: {
      pastedChars: Math.max(0, Number(body.meta?.pastedChars) || 0),
      activeMs: Math.max(0, Number(body.meta?.activeMs) || 0),
    },
    state: 'submitted', // -> 'scored' -> 'revealed'
  };

  if (q.kind === 'choice') {
    if (q.zones) {
      // Zone answers use where the player stands on the server, not what the browser claims.
      const order = optionOrder(q);
      const zone = zoneAt(order.length, p.x, p.y);
      if (zone < 0) throw new Error('Walk into a zone first');
      attempt.choice = order[zone];
    } else {
      attempt.choice = Number(body.choice);
    }
    if (!(attempt.choice >= 0 && attempt.choice < q.options.length)) throw new Error('Pick an option');
    if (q.reasons) attempt.reason = body.reason === undefined || body.reason === null ? null : Number(body.reason);
  }
  if (q.kind === 'grid') {
    const picked = Array.isArray(body.grid) ? body.grid : [];
    attempt.grid = q.rows.map((_, i) => (picked[i] === null || picked[i] === undefined ? null : Number(picked[i])));
  }
  if (q.kind === 'line') {
    attempt.value = lineValue(p.x);
  }
  if (q.kind === 'bug') {
    attempt.line = Number(body.line);
    if (!(attempt.line >= 1 && attempt.line <= q.code.split('\n').length)) throw new Error('Pick a line');
  }
  // Code runs only in the student's own browser, which reports which checks passed.
  // The server cannot verify that, so the teacher sees the code next to the result.
  if (q.kind === 'code') {
    attempt.passed = q.tests.map((_, i) => body.passed?.[i] === true);
  }

  const others = Object.values(rec.answers)
    .filter((e) => !group.includes(e.id))
    .map((e) => ({ id: e.id, name: game.players.get(e.id)?.name || '?', text: e.attempts.at(-1).text }));
  attempt.flags = checkAnswer(q, { id: p.id, text: attempt.text, meta: attempt.meta }, others);
  if (!needsAi(q)) markByRule(q, attempt);

  // Before the close, changing your mind replaces the answer; after the reveal, a retry is a new attempt.
  // Every member of a pair gets their own copy, so each keeps their own points and streak.
  let latestCopy = attempt;
  for (const id of group) {
    const mine = rec.answers[id] || { id, attempts: [] };
    const copy = { ...attempt, by: p.id };
    if (isRetry) mine.attempts.push(copy);
    else mine.attempts = [copy];
    rec.answers[id] = mine;
    // Auto-scored retries (like the code bench) reveal immediately without waiting for the teacher.
    if (isRetry && !needsAi(q)) scoreAndRevealAttempt(game, rec, mine);
    if (id === p.id) latestCopy = copy;
  }

  if (isRetry && !needsAi(q)) game.recount();
  if (!rec.allInAt && !stillWriting(game, rec).length) rec.allInAt = now(); // for the session report
  game.fx({ t: 'handin', id: p.id });
  game.changed();
  return latestCopy;
}

export function closeQuestion(game, { force = false } = {}) {
  const rec = game.live;
  if (!rec || rec.status !== 'open') return;
  checkGate(game, force);
  stopRapid(game);
  if (rec.def.kind === 'rapid' && rec.phase !== 'done') rec.phase = 'stopped'; // the teacher ended it early
  rec.status = needsAi(rec.def) ? 'closed' : 'scored';
  rec.closedAt = now();
  rec.timerEndsAt = null;
  // Team bonus: everyone in the room handed in before the close.
  const here = game.online();
  rec.present = here.length;
  rec.fullHouse = here.length >= 2 && here.every((p) => rec.answers[p.id]);
  game.changed();
}

/** Ask the AI for 0-3 score suggestions on every answer not scored yet (one batched call). */
export async function scoreQuestion(game, { force = false } = {}) {
  const rec = game.live;
  if (!rec) throw new Error('No question');
  if (game.scoring) throw new Error('Already scoring');
  if (rec.status === 'open') closeQuestion(game, { force });
  const q = rec.def;
  const pending = Object.values(rec.answers)
    .map((entry) => entry.attempts.at(-1))
    .filter((a) => a.state === 'submitted');
  for (const a of pending) a.auto = autoScore(q, a);
  if (!needsAi(q) || !pending.length) {
    if (rec.status !== 'revealed') rec.status = 'scored';
    game.changed();
    return;
  }

  game.scoring = true;
  rec.scoringError = null;
  game.changed();
  try {
    // Answers leave as a1, a2...: the AI never sees a name. A pair's shared answer goes once.
    const shared = new Map(); // "who handed in, when" -> the copies of that answer
    for (const a of pending) {
      const key = `${a.by}:${a.at}`;
      shared.set(key, [...(shared.get(key) || []), a]);
    }
    const byAnon = new Map([...shared.values()].map((copies, i) => [`a${i + 1}`, copies]));
    const items = [...byAnon].map(([id, [a]]) => ({ id, text: answerText(a), choice: a.choice }));
    const results = await scoreAnswers(game.aiMode, q, items);
    for (const r of results) {
      for (const a of byAnon.get(r.id) || []) {
        a.ai = { score: r.score, parts: r.parts, missed: r.missed, feedback: r.feedback, by: game.aiMode };
        a.state = 'scored';
      }
    }
    if (results.length < items.length) {
      rec.scoringError = `The AI returned ${results.length} of ${items.length} scores. Score the rest by hand or try again.`;
    }
    if (rec.status !== 'revealed') rec.status = 'scored';
  } catch (e) {
    // Answers keep their state, so the teacher can score by hand or try again.
    rec.scoringError = e.message;
    game.log('scoring failed:', e.message);
  } finally {
    game.scoring = false;
    game.changed();
  }
}

/** The teacher's word is final: change a suggested score or the feedback. */
export function setAnswerScore(game, pid, score, feedback) {
  const rec = game.live;
  if (!rec?.answers[pid]) return;
  let wasRevealed = false;
  for (const id of groupOf(rec, pid)) {
    const a = rec.answers[id]?.attempts.at(-1);
    if (!a) continue;
    a.ai = { parts: {}, missed: null, ...a.ai, score: clamp(Number(score) || 0, 0, 3), edited: true };
    if (typeof feedback === 'string') a.ai.feedback = feedback.slice(0, 400);
    if (a.ai.score >= 2) a.ai.missed = null;
    if (a.state === 'submitted') {
      a.auto = autoScore(rec.def, a);
      a.state = 'scored';
    }
    wasRevealed ||= a.state === 'revealed';
  }
  if (wasRevealed) revealQuestion(game); // already out: show the corrected points
  game.changed();
}

/** A soft countdown on the open question. Nothing closes by itself: the teacher decides. */
export function setQuestionTimer(game, seconds) {
  const rec = game.live;
  if (!rec || rec.status !== 'open') return;
  const s = clamp(Number(seconds) || 0, 0, 3600);
  rec.timerEndsAt = s ? now() + s * 1000 : null;
  game.changed();
}

/** Show everyone their points and put the answers on the projector. */
export function revealQuestion(game, { force = false } = {}) {
  const rec = game.live;
  if (!rec) return;
  if (rec.status === 'open') closeQuestion(game, { force });
  for (const entry of Object.values(rec.answers)) {
    scoreAndRevealAttempt(game, rec, entry);
  }
  rec.status = 'revealed';
  rec.revealedAt = now();
  game.mode = 'review';
  game.recount();
  for (const t of game.lesson.trophies) {
    if (t.after === rec.key) game.awardTrophy(t.id);
  }
  game.changed();
}

/** After the reveal: put one sound answer (from the lesson manifest) on the projector, or take it off. */
export function showExample(game, on) {
  const rec = game.live;
  if (!rec || rec.status !== 'revealed') return;
  rec.exampleShown = !!on;
  game.changed();
}
