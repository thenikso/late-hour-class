// Two answer editors for code questions on the student page:
//   bug   spot the bug: click the faulty line of a piece of code
//   code  the code bench: write JavaScript and run it against the lesson's checks
//
// A student's code runs only in that student's own browser, inside a Web Worker:
// a separate thread with no access to the page, which we stop after two seconds.
// It never runs on the server or on anyone else's machine.

import { h } from './common.js';

const RUN_LIMIT_MS = 2000;

// The worker's own program. It runs the student's code, then each check, and
// sends back which checks came out true. A check that throws counts as false.
const WORKER_SOURCE = `
onmessage = (e) => {
  const { code, checks } = e.data;
  const guarded = checks.map((c) => '(() => { try { return !!(' + c + '); } catch (err) { return false; } })()');
  let passed = checks.map(() => false);
  let error = null;
  try {
    passed = new Function(code + '\\n;return [' + guarded.join(',') + '];')();
  } catch (err) {
    error = String(err && err.message ? err.message : err);
  }
  postMessage({ passed, error });
};`;

/** Run `code` against `tests` ([{ name, check }]). Resolves to { passed: [true|false…], error }. */
export function runChecks(code, tests) {
  return new Promise((done) => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const finish = (result) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      done(result);
    };
    const nothing = tests.map(() => false);
    const timer = setTimeout(() => finish({ passed: nothing, error: 'It ran for too long. Is there a loop that never ends?' }), RUN_LIMIT_MS);
    worker.onmessage = (e) => finish(e.data);
    worker.onerror = (e) => (e.preventDefault(), finish({ passed: nothing, error: e.message || 'The code could not be read.' }));
    worker.postMessage({ code, checks: tests.map((t) => t.check) });
  });
}

/** Code as numbered lines. `mark(n)` returns extra class names for line n (counted from 1). */
export function codeLines(code, { onPick = null, mark = () => '' } = {}) {
  return h(
    'ol',
    { class: `code-lines ${onPick ? 'pickable' : ''}` },
    code.split('\n').map((line, i) => h('li', { class: mark(i + 1), onclick: onPick ? () => onPick(i + 1) : null }, h('code', {}, line || ' '))),
  );
}

/** Spot the bug: the draft `d` remembers the picked line. */
export function bugEditor(q, d) {
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(
      codeLines(q.code, { onPick: (n) => ((d.line = n), draw()), mark: (n) => (n === d.line ? 'picked' : '') }),
      h('p', { class: 'quiet' }, d.line ? `You picked line ${d.line}.` : 'Click the line with the bug.'),
    );
  };
  draw();
  return wrap;
}

/** The list of checks with a tick or a cross each. */
export function checkList(tests, passed) {
  return h(
    'ul',
    { class: 'checks' },
    tests.map((t, i) => h('li', { class: passed ? (passed[i] ? 'ok' : 'no') : 'quiet' }, passed ? (passed[i] ? '✓ ' : '✗ ') : '· ', t.name)),
  );
}

/** The code bench: a code box, a Run button and the checks. The draft `d` keeps the code and the last result. */
export function codeEditor(q, d) {
  d.text ||= q.starter;
  const box = h('textarea', { class: 'code', spellcheck: 'false', 'aria-label': 'Your code' });
  box.value = d.text;
  const results = h('div');
  const showResults = (error = null) => {
    results.innerHTML = '';
    results.append(checkList(q.tests, d.passed), error ? h('p', { class: 'err' }, error) : '');
  };
  showResults();

  box.addEventListener('input', () => {
    d.text = box.value;
    d.passed = null; // the code changed: the old result no longer counts
    showResults();
  });
  box.addEventListener('paste', (e) => (d.pastedChars += (e.clipboardData?.getData('text') || '').length));
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault(); // Tab indents instead of leaving the box
    box.setRangeText('  ', box.selectionStart, box.selectionEnd, 'end');
    box.dispatchEvent(new Event('input'));
  });

  const run = h('button', { class: 'btn', type: 'button' }, 'Run the checks ▶');
  run.onclick = async () => {
    run.disabled = true;
    const result = await runChecks(d.text, q.tests);
    d.passed = result.passed;
    showResults(result.error);
    run.disabled = false;
  };
  return h('div', {}, box, h('div', { class: 'row' }, run, h('span', { class: 'quiet small' }, 'Your code runs only on this laptop.')), results);
}
