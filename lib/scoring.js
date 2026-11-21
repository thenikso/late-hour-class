// How an answer turns into points. Pure functions: no room state in here, so
// every rule can be read (and tested) on its own.
//
// A score is "chips × multiplier", shown step by step on the student's screen:
//   chips       points for handing in, for a right choice, for the 0–3 score…
//   multiplier  starts at 1 and grows with every correctly marked part
//
// Scores are for fun. Nothing here can take points away.

import { parseMarks } from '../public/js/shared/marks.js';
import { CIRCLED } from '../public/js/shared/world.js';
import { streakChips, FULL_HOUSE_CHIPS } from '../public/js/shared/fun.js';
import { isSet } from '../public/js/shared/util.js';

export const POINTS = {
  handIn: 10, // just for handing in, right or wrong
  rightChoice: 30,
  halfRight: 15,
  rightReason: 15,
  gridRow: 10, // per right row
  perCheck: 10, // per passing check of a code question
  perScore: 15, // times the 0–3 score from the AI or the teacher
  perPart: 0.5, // added to the multiplier per correctly marked part
};

export const MAX_ATTEMPTS = 3;

/** Written answers need a 0–3 score from the AI or the teacher; the rest is marked by rule. */
export const needsAi = (q) => q.scored && (q.kind === 'text' || (q.kind === 'choice' && !!q.text));

/** The named parts students can mark in their text (①, ②…), wherever the question keeps them. */
export const textParts = (q) => (q.kind === 'text' ? q.parts : q.text?.parts) || [];

/** Choice correctness, the reason and grid rows: marked instantly, no AI. */
export function autoScore(q, attempt) {
  const auto = {};
  if (q.kind === 'choice' && isSet(q.correct)) {
    const correct = [].concat(q.correct);
    if (correct.includes(attempt.choice)) auto.choice = 'right';
    else if ((q.partial || []).includes(attempt.choice)) auto.choice = 'partial';
    else auto.choice = 'wrong';
    if (q.reasons && isSet(attempt.reason)) auto.reason = [].concat(q.reasons.correct ?? []).includes(attempt.reason);
  }
  if (q.kind === 'bug' && q.correct.length) auto.choice = q.correct.includes(attempt.line) ? 'right' : 'wrong';
  if (q.kind === 'code') auto.tests = attempt.passed;
  if (q.kind === 'grid') {
    // a row without a `correct` list is not marked (null)
    auto.rows = q.rows.map((row, i) => (row.correct === null ? null : row.correct.includes(attempt.grid[i])));
  }
  return auto;
}

/**
 * A retry is offered when the feedback names something missed, or the score is
 * under 2. Retries are never penalised: the best attempt counts.
 */
export function canRetry(q, entry) {
  const last = entry?.attempts.at(-1);
  if (!last || last.state !== 'revealed' || !needsAi(q)) return false;
  if (entry.attempts.length >= MAX_ATTEMPTS) return false;
  return !!last.ai?.missed || (last.ai?.score ?? 3) < 2;
}

/**
 * The steps of one answer's score.
 *   run        how many questions in a row the player handed in before this one
 *   fullHouse  everyone in the room handed in before the close
 */
export function breakdown(q, attempt, { run = 0, fullHouse = false } = {}) {
  const steps = [{ label: 'Handed in', chips: POINTS.handIn }];

  // Bonuses for showing up, not for being right.
  if (run) steps.push({ label: `${run + 1} in a row`, chips: streakChips(run) });
  if (fullHouse) steps.push({ label: 'Everyone handed in', chips: FULL_HOUSE_CHIPS });

  if (q.scored) {
    const auto = attempt.auto || {};
    if (auto.choice === 'right') steps.push({ label: 'Right answer', chips: POINTS.rightChoice });
    if (auto.choice === 'partial') steps.push({ label: 'Half right', chips: POINTS.halfRight });
    if (auto.reason === true) steps.push({ label: 'Right reason', chips: POINTS.rightReason });
    if (auto.rows) {
      const right = auto.rows.filter((r) => r === true).length;
      if (right) steps.push({ label: `${right}/${auto.rows.length} rows right`, chips: right * POINTS.gridRow });
    }
    if (auto.tests) {
      const passing = auto.tests.filter(Boolean).length;
      if (passing) steps.push({ label: `${passing}/${auto.tests.length} checks pass`, chips: passing * POINTS.perCheck });
    }
    if (attempt.ai && needsAi(q)) {
      if (attempt.ai.score) steps.push({ label: `Answer ${attempt.ai.score}/3`, chips: attempt.ai.score * POINTS.perScore });
      // A marked part counts when the student marked it AND the scorer agreed it really is that part.
      const marked = parseMarks(attempt.text);
      const good = textParts(q)
        .map((_, i) => i + 1)
        .filter((n) => marked[n] && attempt.ai.parts?.[n] === true);
      if (good.length) steps.push({ label: `Parts marked ${good.map((n) => CIRCLED[n - 1]).join('')}`, mult: good.length * POINTS.perPart });
    }
  }

  const chips = steps.reduce((sum, s) => sum + (s.chips || 0), 0);
  const mult = 1 + steps.reduce((sum, s) => sum + (s.mult || 0), 0);
  return { steps, chips, mult, total: Math.round(chips * mult) };
}
