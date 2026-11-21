// Two answer editors for code questions on the student page:
//   bug   spot the bug: click the faulty line of a piece of code
//   code  the code bench: write JavaScript and run it against the lesson's checks
//
// A student's code runs only in that student's own browser, inside a Web Worker:
// a separate thread with no access to the page, which we stop after two seconds.
// It never runs on the server or on anyone else's machine.

import { h } from './common.js';
import { codeEditor } from './editors.js';

const RUN_LIMIT_MS = 2000;

// The worker's own program. We capture postMessage first (so student code cannot
// spoof a passing message) and run via indirect eval (so a top-level `return` is
// a syntax error and cannot short-circuit the checks).
const WORKER_SOURCE = `
const send = self.postMessage.bind(self);
self.onmessage = (e) => {
  const { code, checks } = e.data;
  self.postMessage = () => {};
  const guarded = checks.map((c) => '(() => { try { return Boolean(' + c + '); } catch { return false; } })()');
  let passed = checks.map(() => false);
  let error = null;
  try {
    // Evaluate student code and checks in one script scope so const/let/function declarations are visible.
    const result = (0, eval)(code + '\\n;[' + guarded.join(',') + '];');
    if (Array.isArray(result) && result.length === checks.length) {
      passed = result.map((v) => v === true);
    }
  } catch (err) {
    error = String(err && err.message ? err.message : err);
  }
  send({ passed, error });
};`;

/** Run `code` against `tests` ([{ name, check }]). Resolves to { passed: [true|false...], error }. */
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
    const timer = setTimeout(() => {
      finish({ passed: nothing, error: 'It ran for too long. Is there a loop that never ends?' });
    }, RUN_LIMIT_MS);
    worker.onmessage = (e) => finish(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      finish({ passed: nothing, error: e.message || 'The code could not be read.' });
    };
    worker.postMessage({ code, checks: tests.map((t) => t.check) });
  });
}

/** Code as numbered lines. `mark(n)` returns extra class names for line n (counted from 1). */
export function codeLines(code, { onPick = null, mark = () => '' } = {}) {
  return h(
    'ol',
    { class: `code-lines ${onPick ? 'pickable' : ''}` },
    code.split('\n').map((line, i) => {
      const lineNum = i + 1;
      return h(
        'li',
        { class: mark(lineNum), onclick: onPick ? () => onPick(lineNum) : null },
        h('code', {}, line || ' '),
      );
    }),
  );
}

/** Spot the bug: the draft `d` remembers the picked line. */
export function bugEditor(q, d) {
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(
      codeLines(q.code, {
        onPick: (n) => {
          d.line = n;
          draw();
        },
        mark: (n) => (n === d.line ? 'picked' : ''),
      }),
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
    tests.map((t, i) => {
      let cls = 'quiet';
      let mark = '· ';
      if (passed) {
        cls = passed[i] ? 'ok' : 'no';
        mark = passed[i] ? '✓ ' : '✗ ';
      }
      return h('li', { class: cls }, mark, t.name);
    }),
  );
}

/** The code bench: a code editor, a Run button and the checks. The draft `d` keeps the code and the last result. */
export function codeBench(q, d) {
  d.text ||= q.starter;
  const results = h('div');
  const showResults = (error = null) => {
    results.innerHTML = '';
    results.append(checkList(q.tests, d.passed), error ? h('p', { class: 'err' }, error) : '');
  };
  showResults(d.lastError);

  const editor = codeEditor({
    value: d.text,
    onChange(text) {
      d.text = text;
      d.passed = null; // the code changed: the old result no longer counts
      d.lastError = null;
      showResults();
    },
    onPaste: (chars) => {
      d.pastedChars += chars;
    },
  });
  const run = h('button', { class: 'btn', type: 'button' }, 'Run the checks ▶');
  run.onclick = async () => {
    run.disabled = true;
    const result = await runChecks(d.text, q.tests);
    d.passed = result.passed;
    d.lastError = result.error;
    showResults(result.error);
    run.disabled = false;
  };
  return h(
    'div',
    {},
    editor.el,
    h('div', { class: 'row' }, run, h('span', { class: 'quiet small' }, 'Your code runs only on this laptop.')),
    results,
  );
}
