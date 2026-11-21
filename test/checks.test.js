// Unit tests for fast rule checks in lib/checks.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, spotlightPicks } from '../lib/checks.js';

test('checkAnswer flags empty, short, unmarked, pasted, fast and similar answers', () => {
  const q = { kind: 'text', parts: ['cause', 'fix'] };

  const emptyFlags = checkAnswer(q, { id: 'p1', text: '   ', meta: {} });
  assert.ok(emptyFlags.some((f) => f.kind === 'empty'));

  const shortFlags = checkAnswer(q, { id: 'p1', text: 'Too short', meta: {} });
  assert.ok(shortFlags.some((f) => f.kind === 'short'));
  assert.ok(shortFlags.some((f) => f.kind === 'unmarked'));

  const partialMark = checkAnswer(q, { id: 'p1', text: '==①The loop stops early== and needs an update to fix it properly.', meta: {} });
  assert.ok(partialMark.some((f) => f.kind === 'partly-marked' && f.label.includes('②')));

  const longText = 'The queue handles incoming requests one at a time so the second registration waits for the first one to complete and sees the full state.';
  const fastAndPasted = checkAnswer(q, { id: 'p1', text: longText, meta: { pastedChars: 100, activeMs: 4000 } });
  assert.ok(fastAndPasted.some((f) => f.kind === 'pasted'));
  assert.ok(fastAndPasted.some((f) => f.kind === 'fast'));

  const similar = checkAnswer(q, { id: 'p2', text: longText, meta: {} }, [{ id: 'p1', name: 'Ada', text: longText }]);
  assert.ok(similar.some((f) => f.kind === 'similar' && f.label.includes('Ada')));
});

test('code questions only raise the pasted flag', () => {
  const q = { kind: 'code', tests: [{ name: 't1', check: 'true' }] };
  assert.deepEqual(checkAnswer(q, { id: 'p1', text: 'function f(){return 1;}', meta: { pastedChars: 0 } }), []);
  const pasted = checkAnswer(q, { id: 'p1', text: 'function isEven(n) { return n % 2 === 0; } // pasted code', meta: { pastedChars: 50 } });
  assert.equal(pasted.length, 1);
  assert.equal(pasted[0].kind, 'pasted');
});

test('spotlightPicks highlights fullest answers and answers with non-info flags', () => {
  const answers = [
    { id: 'p1', text: 'Short', flags: [{ kind: 'short', level: 'warn' }] },
    { id: 'p2', text: 'A much more detailed explanation covering every part clearly.', flags: [{ kind: 'unmarked', level: 'info' }] },
    { id: 'p3', text: 'Another solid answer with clear reasoning and examples.', flags: [] },
  ];
  const picks = spotlightPicks({ kind: 'text' }, answers);
  assert.deepEqual(picks.good, ['p2', 'p3']);
  assert.deepEqual(picks.check, ['p1']);
});
