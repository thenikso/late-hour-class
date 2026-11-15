// Fast checks: plain rules that run the moment an answer arrives (well under a
// second). They only raise flags for the teacher. A flag is a reason to ask the
// student about their answer, never a penalty.

import { parseMarks, stripMarks } from '../public/js/marks.js';
import { CIRCLED } from '../public/js/world.js';
import { textParts } from './scoring.js';

const words = (s) => stripMarks(s).toLowerCase().match(/[a-z0-9à-ÿ']+/g) || [];

function shingles(s, n = 3) {
  const w = words(s);
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  return set;
}

function similarity(a, b) {
  const A = shingles(a);
  const B = shingles(b);
  if (A.size < 3 || B.size < 3) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** The text part of an answer that the checks and the AI look at. */
export const answerText = (a) => (a && typeof a.text === 'string' ? a.text : '');

export function checkAnswer(question, answer, others = []) {
  const flags = [];
  const text = answerText(answer);
  const hasText = question.kind === 'text' || (question.kind === 'choice' && !!question.text);
  if (hasText) {
    const len = stripMarks(text).trim().length;
    if (len === 0) flags.push({ kind: 'empty', level: 'warn', label: 'No text' });
    else if (len < 25) flags.push({ kind: 'short', level: 'warn', label: 'Very short' });

    const parts = textParts(question);
    if (parts.length && len > 0) {
      const marked = parseMarks(text);
      const missing = parts.map((_, i) => i + 1).filter((n) => !marked[n]);
      if (missing.length === parts.length) flags.push({ kind: 'unmarked', level: 'info', label: 'No parts marked' });
      else if (missing.length) flags.push({ kind: 'partly-marked', level: 'info', label: `Not marked: ${missing.map((n) => CIRCLED[n - 1]).join('')}` });
    }

    const meta = answer.meta || {};
    if (len > 40 && meta.pastedChars > len * 0.5)
      flags.push({ kind: 'pasted', level: 'look', label: 'Mostly pasted' });
    if (len > 120 && meta.activeMs > 0 && meta.activeMs < 12000)
      flags.push({ kind: 'fast', level: 'look', label: `Written in ${Math.round(meta.activeMs / 1000)} s` });

    for (const o of others) {
      if (o.id === answer.id) continue;
      const sim = similarity(text, answerText(o));
      if (sim > 0.45) {
        flags.push({ kind: 'similar', level: 'look', label: `Similar to ${o.name}`, other: o.id });
        break;
      }
    }

  }
  return flags;
}

/** A few answers worth putting on the spot: the fullest, and ones with warnings. */
export function spotlightPicks(question, answers) {
  const withText = answers.filter((a) => stripMarks(answerText(a)).trim().length > 0);
  const byLength = [...withText].sort((a, b) => stripMarks(answerText(b)).length - stripMarks(answerText(a)).length);
  const good = byLength.slice(0, 2).map((a) => a.id);
  const check = answers.filter((a) => (a.flags || []).some((f) => f.level !== 'info')).slice(0, 3).map((a) => a.id);
  return { good, check };
}
