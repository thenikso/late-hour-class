// Pure unit tests for scoring rules in lib/scoring.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POINTS, MAX_ATTEMPTS, needsAi, autoScore, canRetry, breakdown } from '../lib/scoring.js';

test('needsAi is true only for scored text or choice-with-text questions', () => {
  assert.equal(needsAi({ kind: 'text', scored: true }), true);
  assert.equal(needsAi({ kind: 'text', scored: false }), false);
  assert.equal(needsAi({ kind: 'choice', scored: true, text: { prompt: 'Why?' } }), true);
  assert.equal(needsAi({ kind: 'choice', scored: true, text: null }), false);
  assert.equal(needsAi({ kind: 'code', scored: true }), false);
  assert.equal(needsAi({ kind: 'grid', scored: true }), false);
});

test('autoScore marks choice, partial, reason, bug, code and grid rows', () => {
  const choiceQ = {
    kind: 'choice',
    correct: [2],
    partial: [1],
    reasons: { options: ['a', 'b'], correct: [0] },
  };
  assert.deepEqual(autoScore(choiceQ, { choice: 2, reason: 0 }), { choice: 'right', reason: true });
  assert.deepEqual(autoScore(choiceQ, { choice: 1, reason: 1 }), { choice: 'partial', reason: false });
  assert.deepEqual(autoScore(choiceQ, { choice: 0, reason: null }), { choice: 'wrong' });

  const bugQ = { kind: 'bug', correct: [3, 4] };
  assert.deepEqual(autoScore(bugQ, { line: 3 }), { choice: 'right' });
  assert.deepEqual(autoScore(bugQ, { line: 1 }), { choice: 'wrong' });

  const gridQ = {
    kind: 'grid',
    rows: [
      { text: 'r1', correct: [0] },
      { text: 'r2', correct: null },
      { text: 'r3', correct: [1, 2] },
    ],
  };
  assert.deepEqual(autoScore(gridQ, { grid: [0, 1, 2] }), { rows: [true, null, true] });

  const codeQ = { kind: 'code', tests: [{ name: 't1' }, { name: 't2' }] };
  assert.deepEqual(autoScore(codeQ, { passed: [true, false] }), { tests: [true, false] });
});

test('breakdown sums chips and multiplies by correctly marked parts', () => {
  const q = { kind: 'text', scored: true, parts: ['given', 'when', 'then'] };
  const attempt = {
    text: '==①event full== ==②user clicks== ==③error shown==',
    ai: { score: 2, parts: { 1: true, 2: false, 3: true } },
  };
  const b = breakdown(q, attempt, { run: 2, fullHouse: true });
  // chips: handIn(10) + streak(10) + fullHouse(10) + ai(2*15=30) = 60
  // mult: 1 + 2 * 0.5 = 2
  assert.equal(b.chips, POINTS.handIn + 10 + 10 + 2 * POINTS.perScore);
  assert.equal(b.mult, 2);
  assert.equal(b.total, 120);
});

test('canRetry allows retries for weak/missed text answers and failing code bench checks', () => {
  const textQ = { kind: 'text', scored: true };
  assert.equal(canRetry(textQ, { attempts: [{ state: 'revealed', ai: { score: 1, missed: null } }] }), true);
  assert.equal(canRetry(textQ, { attempts: [{ state: 'revealed', ai: { score: 2, missed: 'edge case' } }] }), true);
  assert.equal(canRetry(textQ, { attempts: [{ state: 'revealed', ai: { score: 3, missed: null } }] }), false);
  assert.equal(
    canRetry(textQ, { attempts: Array.from({ length: MAX_ATTEMPTS }, () => ({ state: 'revealed', ai: { score: 0 } })) }),
    false,
    'stops after MAX_ATTEMPTS',
  );

  const codeQ = { kind: 'code', scored: true };
  assert.equal(canRetry(codeQ, { attempts: [{ state: 'revealed', auto: { tests: [true, false] } }] }), true);
  assert.equal(canRetry(codeQ, { attempts: [{ state: 'revealed', auto: { tests: [true, true] } }] }), false);
  assert.equal(canRetry(codeQ, { attempts: [{ state: 'submitted', auto: { tests: [false] } }] }), false);
});
