// Rapid rounds: a grid of statements, answered one line at a time by standing
// in a floor zone. The server runs the clock and moves on by itself:
//
//   ready   the intro is up; the first line comes after READY_SECONDS
//   answer  one line is up; when its time runs out, where you stand is your answer
//   show    the right answer for that line, for SHOW_SECONDS; then the next line
//
// After the last line the question closes itself; the teacher still reveals the points.
// With `scramble` on, each student sees the options in their own zones, different
// for every line, so following the crowd doesn't help.
//
// Answers are stored like a grid question's (`attempt.grid`), so scoring is the same.

import { zoneAt } from '../public/js/shared/world.js';
import { autoScore } from './scoring.js';

export const READY_SECONDS = 8;
export const SHOW_SECONDS = 3;

const now = () => Date.now();

/** A small number from a string: the same input always gives the same number. */
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/**
 * Which option stands in which zone for this student on this line: order[zone] = option.
 * Always the same for the same (round, student, line), so a page reload keeps it.
 */
export function rapidOrder(rec, pid, row) {
  const order = rec.def.options.map((_, i) => i);
  if (!rec.def.scramble) return order;
  let seed = hash(`${rec.seed}:${pid}:${row}`);
  for (let i = order.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Start (or restart) a rapid round: the intro first, then line 1. */
export function startRapid(game, rec) {
  rec.seed = Math.floor(Math.random() * 1e9);
  rec.row = 0;
  setPhase(game, rec, 'ready', READY_SECONDS);
}

/** Stop the clock (the question closed, or another one opened). */
export function stopRapid(game) {
  clearTimeout(game.rapidTimer);
  game.rapidTimer = null;
}

function setPhase(game, rec, phase, seconds) {
  stopRapid(game);
  rec.phase = phase;
  rec.phaseEndsAt = now() + seconds * 1000;
  game.rapidTimer = setTimeout(() => stepRapid(game), seconds * 1000);
  game.changed();
}

/** The clock ran out: go to the next phase. The timer calls this; tests call it directly. */
export function stepRapid(game) {
  const rec = game.live;
  if (!rec || rec.def.kind !== 'rapid' || rec.status !== 'open') return stopRapid(game);
  const q = rec.def;
  if (rec.phase === 'ready') return setPhase(game, rec, 'answer', q.seconds);
  if (rec.phase === 'answer') {
    lockRow(game, rec);
    return setPhase(game, rec, 'show', SHOW_SECONDS);
  }
  // After showing a line's answer: the next line, or the end of the round.
  if (rec.row + 1 < q.rows.length) {
    rec.row += 1;
    return setPhase(game, rec, 'answer', q.seconds);
  }
  stopRapid(game);
  rec.phase = 'done';
  rec.phaseEndsAt = null;
  game.close({ force: true });
}

/**
 * Time is up on a line: everyone in a zone has answered it. Like every zone answer,
 * this uses where the player stands on the server. Not standing in a zone costs nothing.
 */
function lockRow(game, rec) {
  const q = rec.def;
  const i = rec.row;
  rec.lineTally ||= [];
  rec.lineTally[i] = { right: 0, answered: 0 };
  for (const p of game.online()) {
    if (p.gone) continue; // still on the way through the door
    const zone = zoneAt(q.options.length, p.x, p.y);
    if (zone < 0) continue;
    const pick = rapidOrder(rec, p.id, i)[zone];
    const entry = (rec.answers[p.id] ||= { id: p.id, attempts: [] });
    if (!entry.attempts.length) {
      entry.attempts.push({
        n: 1,
        at: now(),
        text: '',
        meta: { pastedChars: 0, activeMs: 0 },
        state: 'submitted',
        grid: q.rows.map(() => null),
        flags: [],
        by: p.id,
      });
    }
    const a = entry.attempts[0];
    a.grid[i] = pick;
    a.auto = autoScore(q, a);
    a.state = 'scored';
    rec.lineTally[i].answered += 1;
    if (a.auto.rows[i] === true) rec.lineTally[i].right += 1;
  }
  if (!rec.allInAt && !game.online().some((p) => !rec.answers[p.id])) rec.allInAt = now();
}
