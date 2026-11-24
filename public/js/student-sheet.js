// The question sheet on the student page: read the question, answer it in the
// way its kind asks for, hand in, then see the result card and maybe retry.
//
// Question kinds: text (with optional marked parts), choice (walk into a zone
// or pick), grid (one pick per row), line (stand somewhere between two ends),
// bug (click the faulty line) and code (write and run JavaScript); the last
// two have their editors in code-bench.js. A rapid round shows one line at a
// time: you answer by standing in a zone when its time runs out.
//
// Written pair work is one shared draft per desk (lib/desks.js): whoever holds
// the pen types, the others at the desk watch it appear and can take the pen.

import { $, h, store, scoreShow, celebrate, clock } from './common.js';
import { zoneAt, lineValue, LETTERS, CIRCLED } from './shared/world.js';
import { marksToHtml, parseMarks } from './shared/marks.js';
import { isSet } from './shared/util.js';
import { proseEditor } from './editors.js';
import { bugEditor, codeBench, codeLines, checkList, runChecks } from './code-bench.js';

function submitLabel(q, mine) {
  if (q.kind === 'line') return 'Lock in my spot ⏎';
  if (q.kind === 'choice' && q.zones) return 'Lock in my zone ⏎';
  if (mine && q.status === 'revealed') return 'Hand in my retry';
  return 'Hand in';
}

function bugLineClass(lineNumber, pickedLine, correctLines) {
  if (correctLines.includes(lineNumber)) return 'right';
  if (lineNumber === pickedLine) return correctLines.length ? 'wrong' : 'picked';
  return '';
}

function partsOf(q) {
  return (q.kind === 'text' ? q.parts : q.text?.parts) || [];
}

export function createSheet({ send, room, layout, panels }) {
  const el = $('#sheet');
  let state = null;
  let drawn = ''; // what the sheet currently shows; redrawn only when this changes
  let editing = false; // changing an answer already handed in, or retrying
  let shownResult = store.get('lhc-shown') || ''; // the result card pops up once per attempt
  const drafts = {}; // question key -> what the student has typed or picked so far

  // The shared desk draft (written pair work): the latest text we know, and the editor showing it.
  let deskLive = { key: null, n: -1, text: '', v: -1 };
  let deskEditor = null;
  let deskTimer = null;
  let deskPending = null; // text typed but not sent yet
  const canWrite = (s) => !!s.desk && s.desk.n >= 0 && (!s.desk.pen || s.desk.pen === s.me.id);

  function draftFor(q) {
    drafts[q.key] ||= {
      text: '',
      choice: null,
      reason: null,
      grid: [],
      line: null,
      passed: null,
      lastError: null,
      pastedChars: 0,
      activeMs: 0,
      lastKey: 0,
    };
    return drafts[q.key];
  }

  // ---- the sheet ---------------------------------------------------------------------

  function render(s) {
    const moved = s.question?.key !== state?.question?.key;
    state = s;
    if (s.desk && takeDeskText({ key: s.question?.key, ...s.desk }) && deskEditor && !canWrite(s)) deskEditor.setText(deskLive.text);
    const q = s.question;
    const mine = s.mine;
    if (moved) {
      $('#result').hidden = true; // a new question: the last result card steps aside
      editing = false;
    }
    if (!q || s.mode === 'present' || s.mode === 'seating') {
      el.hidden = true;
      drawn = '';
      return;
    }

    const mates = s.me.partners.map((mate) => mate.name);
    const sig = JSON.stringify([
      q.key,
      q.status,
      mine?.state,
      mine?.attempt,
      mine?.text,
      mine?.choice,
      mine?.reason,
      mine?.grid,
      mine?.line,
      mine?.value,
      mine?.passed,
      mine?.by,
      q.row,
      q.phase,
      q.order,
      s.desk ? [s.desk.n, canWrite(s)] : null, // not the text: that streams in without a redraw
      editing,
      !!q.example,
      mates,
      s.me.pairRole,
      s.asks?.length || 0,
      s.trophies?.length || 0,
    ]);
    if (sig !== drawn) {
      drawn = sig;
      el.hidden = false;
      el.innerHTML = '';
      deskEditor = null;
      el.append(
        h(
          'div',
          { class: 'sheet-head' },
          h('h2', {}, q.title),
          h(
            'button',
            {
              class: 'btn small',
              title: 'Fold or unfold',
              onclick: () => {
                el.classList.toggle('minimised');
                layout();
              },
            },
            '–',
          ),
        ),
      );
      if (q.prompt) el.append(h('p', { class: 'prompt' }, q.prompt));
      if (q.context) el.append(h('p', { class: 'context' }, q.context));
      if (mates.length && !s.desk) {
        const roleNote =
          s.me.pairRole === 'driver'
            ? 'You are Driver (type and hand in together).'
            : 'You are Navigator (talk it over and review before handing in).';
        el.append(h('p', { class: 'pair' }, `Pair with ${mates.join(' and ')}. ${roleNote}`));
      }
      const canEdit = (q.status === 'open' && (!mine || editing)) || (q.status === 'revealed' && editing && mine?.canRetry);
      if (q.kind === 'rapid' && q.status === 'open') el.append(...rapidPanel(q, mine));
      else el.append(...(canEdit ? editor(q, mine) : summary(q, mine)));
      if (q.example) {
        el.append(h('p', { class: 'quiet small' }, 'One sound answer:'), h('div', { class: 'feedback' }, q.example));
      }
    }
    deskInfo();
    tick();
    maybeShowResult();
  }

  // ---- the shared desk draft -----------------------------------------------------------------

  /** Keep the newest desk text we have heard of (from the state or a `desk` event). */
  function takeDeskText(d) {
    if (d.n < 0) return false;
    const sameDesk = d.key === deskLive.key && d.n === deskLive.n;
    if (sameDesk && d.v <= deskLive.v) return false;
    deskLive = { key: d.key, n: d.n, text: d.text, v: d.v };
    return true;
  }

  /** A `desk` event: the pen holder typed. Watchers see it at once; the writer already has it. */
  function deskText(d) {
    if (!state?.question || d.key !== state.question.key || !takeDeskText(d)) return;
    if (deskEditor && !canWrite(state)) deskEditor.setText(d.text);
  }

  /** Who is at this desk and who has the pen, updated without redrawing the editor. */
  function deskInfo() {
    const desk = state?.desk;
    const who = $('#desk-who');
    if (!desk || desk.n < 0 || !who) return;
    const others = desk.members.filter((m) => m.id !== state.me.id).map((m) => m.name);
    const withWho = others.length ? `with ${others.join(' and ')}` : 'on your own so far';
    let pen = 'The pen is free: start typing to take it.';
    if (desk.pen === state.me.id) pen = 'You have the pen.';
    else if (desk.pen) pen = `${desk.penName} has the pen.`;
    const text = `Desk ${desk.n + 1}, ${withWho}. ${pen}`;
    if (who.textContent !== text) who.textContent = text;
    $('#take-pen').hidden = canWrite(state);
  }

  /** Typing at the desk: send the text a moment after the last key, not on every key. */
  function queueDraft(text) {
    deskPending = text;
    clearTimeout(deskTimer);
    deskTimer = setTimeout(sendDraft, 250);
  }

  async function sendDraft() {
    clearTimeout(deskTimer);
    if (deskPending === null) return;
    const text = deskPending;
    deskPending = null;
    const d = draftFor(state.question);
    // How it was typed since the last send (for the teacher's flags only).
    const meta = { pastedChars: d.pastedChars - (d.sentPasted || 0), activeMs: d.activeMs - (d.sentActive || 0) };
    d.sentPasted = d.pastedChars;
    d.sentActive = d.activeMs;
    try {
      await send('draft', { text, meta });
    } catch {
      // Someone took the pen just now: their text wins, and the next state turns us into a watcher.
    }
  }

  /** The shared draft: an editor for the pen holder, a live window for everyone else at the desk. */
  function deskBox(q, d) {
    const desk = state.desk;
    deskEditor = null;
    if (desk.n < 0) {
      return h('p', { class: 'pair' }, 'Sit at a desk with your partner, or stand right beside it: each desk writes one answer together.');
    }
    const writing = canWrite(state);
    const take = h('button', { class: 'btn small', id: 'take-pen', type: 'button' }, '✎ Take the pen');
    take.onclick = () => send('pen').catch(() => {});
    const wrap = h('div', {}, h('div', { class: 'row desk-bar' }, h('span', { class: 'pair', id: 'desk-who' }), take));
    wrap.append(
      textEditor(q.parts || [], d, writing ? "Your desk's answer" : 'Your partner is writing…', {
        value: deskLive.text,
        readOnly: !writing,
        onChange: queueDraft,
      }),
    );
    return wrap;
  }

  /**
   * A rapid round while it runs: the line, your zones (in your own order), the clock,
   * and for a moment after each line its answer. Nothing to click: where you stand counts.
   */
  function rapidPanel(q, mine) {
    const out = [];
    const n = q.rows.length;
    if (q.phase === 'ready') {
      out.push(h('p', { class: 'rapid-line' }, `${n} lines, ${q.seconds} seconds each. Get ready…`));
    } else {
      out.push(h('p', { class: 'quiet small' }, `Line ${q.row + 1} of ${n}`), h('p', { class: 'rapid-line' }, q.rows[q.row].text));
    }
    const list = h('ul', { class: 'options', id: 'zone-list' });
    q.order.forEach((opt, pos) => {
      list.append(h('li', { 'data-pos': pos }, h('span', { class: 'letter' }, LETTERS[pos]), q.options[opt]));
    });
    out.push(list);
    if (q.phase === 'show' && q.rowAnswer) {
      const right = [].concat(q.rowAnswer);
      const pick = mine?.grid?.[q.row];
      const answer = right.map((i) => q.options[i]).join(' or ');
      let verdict = `You weren't in a zone this time. The answer: ${answer}.`;
      if (isSet(pick)) verdict = right.includes(pick) ? `✓ Right: ${answer}.` : `✗ You picked ${q.options[pick]}. The answer: ${answer}.`;
      out.push(h('p', { class: 'rapid-verdict' }, verdict));
      out.push(h('p', { class: 'quiet small' }, `${q.rowTally.right} of ${q.rowTally.answered} got it.`));
    } else {
      out.push(h('p', { class: 'quiet', id: 'stand-hint' }));
    }
    out.push(h('div', { class: 'row' }, h('span', { class: 'rapid-clock', id: 'rapid-clock' })));
    return out;
  }

  /** After handing in (or when the question is closed): what you answered, and what you can do next. */
  function summary(q, mine) {
    const count = h('span', { class: 'status quiet', id: 'live-count' });
    if (!mine) {
      return [h('p', { class: 'quiet' }, q.status === 'open' ? '' : 'This question is closed.'), h('div', { class: 'row' }, count)];
    }
    const row = h('div', { class: 'row' });
    const shared = state.me.partners.length > 0;
    if (q.status === 'open') {
      row.append(h('button', { class: 'btn', onclick: startEditing }, shared ? 'Change our answer' : 'Change my answer'));
    }
    if (mine.state === 'revealed') {
      row.append(h('button', { class: 'btn gold', onclick: () => openResult(true) }, 'See my result'));
    }
    if (mine.canRetry) {
      row.append(h('button', { class: 'btn go', onclick: startRetry }, 'Try again ↻'));
    }
    row.append(count);

    let done = '✓ Handed in.';
    if (mine.state === 'revealed') done = 'Scored. See your result.';
    else if (mine.by) done = `✓ ${mine.by} handed in for you both.`;

    const items = [h('p', { class: 'done' }, done), answerSummary(q, mine), row];
    if (q.status === 'open') {
      const nudge = earlyFinisherBox(q, mine);
      if (nudge) items.push(nudge);
    }
    return items;
  }

  /** Keeps early finishers engaged inside the lesson while waiting for the room to finish. */
  function earlyFinisherBox(q, mine) {
    const tips = [];
    if (q.stretch) {
      tips.push(h('p', {}, h('b', {}, 'Done early? '), q.stretch));
    }
    const requiredParts = partsOf(q);
    if (requiredParts.length && mine.text) {
      const marked = parseMarks(mine.text);
      const missing = requiredParts.map((_, i) => i + 1).filter((n) => !marked[n]);
      if (missing.length) {
        const badges = missing.map((n) => CIRCLED[n - 1]).join(' ');
        tips.push(h('p', { class: 'quiet small' }, `Tip: you haven't marked ${badges} yet — click Change to add marks for a multiplier bonus.`));
      }
    }
    const actions = h('div', { class: 'row' });
    const askCount = state.asks?.length || 0;
    actions.append(
      h(
        'button',
        { class: 'btn small', type: 'button', onclick: () => panels.openAsks() },
        askCount ? `Check Ask board (${askCount})` : 'Ask a question',
      ),
    );
    if (state.trophies?.length) {
      actions.append(
        h(
          'button',
          { class: 'btn small', type: 'button', onclick: () => panels.openTrophies([]) },
          `Review trophies (${state.trophies.length})`,
        ),
      );
    }
    return h('div', { class: 'while-waiting' }, h('div', { class: 'quiet small' }, 'While the room wraps up:'), ...tips, actions);
  }

  function answerSummary(q, mine) {
    const box = h('div', { class: 'preview' });
    if (q.kind === 'choice' && isSet(mine.choice)) {
      box.append(h('div', {}, `${LETTERS[q.order.indexOf(mine.choice)]} · ${q.options[mine.choice]}`));
      if (q.reasons && isSet(mine.reason)) box.append(h('div', {}, `Reason: ${q.reasons.options[mine.reason]}`));
    }
    if ((q.kind === 'grid' || q.kind === 'rapid') && mine.grid) {
      q.rows.forEach((row, i) => {
        box.append(h('div', {}, `${i + 1}. ${(row.options || q.options)[mine.grid[i]] ?? '—'}`));
      });
    }
    if (q.kind === 'line' && isSet(mine.value)) box.append(h('div', {}, lineText(q, mine.value)));
    if (q.kind === 'bug' && isSet(mine.line)) {
      const right = q.correctLines || [];
      box.append(codeLines(q.code, { mark: (n) => bugLineClass(n, mine.line, right) }));
    } else if (q.kind === 'code') {
      box.append(codeLines(mine.text || ''), checkList(q.tests, mine.passed));
    } else if (mine.text) {
      box.append(h('div', { html: marksToHtml(mine.text) }));
    }
    return box;
  }

  const lineText = (q, value) =>
    value === 50 ? 'Right in the middle.' : `${Math.abs(value - 50) * 2}% of the way towards “${q.labels[value < 50 ? 0 : 1]}”.`;

  /** Restore a draft from a previous hand-in (useful after a page reload). */
  function hydrateDraft(d, mine) {
    if (!mine) return;
    if (!d.text && mine.text) d.text = mine.text;
    if (d.choice === null && isSet(mine.choice)) d.choice = mine.choice;
    if (d.reason === null && isSet(mine.reason)) d.reason = mine.reason;
    if (!d.grid.length && Array.isArray(mine.grid)) d.grid = [...mine.grid];
    if (d.line === null && isSet(mine.line)) d.line = mine.line;
  }

  /** The inputs for this kind of question, and the hand-in button. */
  function editor(q, mine) {
    const d = draftFor(q);
    hydrateDraft(d, mine);
    const out = [];
    if (q.kind === 'bug') out.push(bugEditor(q, d));
    if (q.kind === 'code') out.push(codeBench(q, d));
    if (q.kind === 'choice') out.push(choiceEditor(q, d));
    if (q.kind === 'grid') out.push(gridEditor(q, d));
    if (q.kind === 'line') out.push(h('p', { class: 'quiet', id: 'stand-hint' }));
    if (q.kind === 'text' && state.desk) out.push(deskBox(q, d));
    else if (q.kind === 'text') out.push(textEditor(q.parts || [], d, 'Your answer'));
    if (q.kind === 'choice' && q.text) out.push(textEditor(q.text.parts || [], d, q.text.prompt));

    const err = h('span', { class: 'err' });
    let allowErroredCode = false;
    const button = h('button', { class: 'btn go', id: 'lock-in' }, submitLabel(q, mine));
    button.onclick = async () => {
      if (mine?.by && q.status === 'open' && !confirm(`${mine.by} already handed in for your pair. Replace their answer with yours?`)) {
        return;
      }
      button.disabled = true;
      err.textContent = '';
      try {
        if (state.desk) await sendDraft(); // the desk's answer is its draft: send the last keys first
        if (q.kind === 'code') {
          const result = await runChecks(d.text, q.tests);
          d.passed = result.passed;
          d.lastError = result.error;
          if (result.error && !allowErroredCode) {
            allowErroredCode = true;
            err.textContent = `${result.error} Fix it, or click Hand in again to submit anyway.`;
            button.disabled = false;
            return;
          }
        }
        await send('answer', {
          text: d.text,
          choice: d.choice,
          reason: d.reason,
          grid: d.grid,
          line: d.line,
          passed: d.passed,
          meta: { pastedChars: d.pastedChars, activeMs: d.activeMs },
        });
        editing = false;
        drawn = ''; // the next state from the server redraws the sheet
      } catch (e) {
        err.textContent = e.message;
        button.disabled = false;
      }
    };
    out.push(h('div', { class: 'row' }, button, err, h('span', { class: 'status quiet', id: 'live-count' })));
    return out;
  }

  /** A row of buttons where one is picked: calls `pick(i)` and lights the button up. */
  function pickRow(labels, picked, pick) {
    const buttons = labels.map((label, i) => {
      const b = h('button', { class: `btn small ${picked === i ? 'on' : ''}`, type: 'button' }, label);
      b.onclick = () => {
        pick(i);
        buttons.forEach((x) => x.classList.toggle('on', x === b));
      };
      return b;
    });
    return buttons;
  }

  function choiceEditor(q, d) {
    const wrap = h('div');
    const list = h('ul', { class: 'options', id: 'zone-list' });
    const picks = q.zones ? [] : pickRow(q.order.map(() => 'Pick'), q.order.indexOf(d.choice), (pos) => {
      d.choice = q.order[pos];
    });
    q.order.forEach((opt, pos) => {
      list.append(h('li', { 'data-pos': pos }, picks[pos] || '', picks[pos] ? ' ' : '', h('span', { class: 'letter' }, LETTERS[pos]), q.options[opt]));
    });
    wrap.append(list);
    if (q.zones) wrap.append(h('p', { class: 'quiet', id: 'stand-hint' }));
    if (q.reasons) {
      wrap.append(
        h(
          'div',
          { class: 'row' },
          h('span', {}, 'Main reason:'),
          pickRow(q.reasons.options, d.reason, (i) => {
            d.reason = i;
          }),
        ),
      );
    }
    return wrap;
  }

  function gridEditor(q, d) {
    const table = h('table');
    q.rows.forEach((row, i) => {
      const buttons = pickRow(row.options || q.options, d.grid[i], (j) => {
        d.grid[i] = j;
      });
      table.append(h('tr', {}, h('td', {}, `${i + 1}. ${row.text}`), h('td', { class: 'opts' }, buttons)));
    });
    return table;
  }

  /**
   * The box for a written answer (see editors.js). If the question names parts,
   * a button per part wraps the selected text as ==①...==, shown tinted in the box.
   */
  function textEditor(parts, d, label, shared = null) {
    const editor = proseEditor({
      value: shared ? shared.value : d.text,
      label,
      readOnly: !!shared?.readOnly,
      onChange: (text) => {
        if (shared) shared.onChange(text);
        else d.text = text;
      },
      // How the answer was written (time spent typing, how much was pasted). The teacher
      // sees it as a prompt to ask about the answer; it never changes a score.
      onKey() {
        const t = performance.now();
        if (d.lastKey && t - d.lastKey < 5000) d.activeMs += t - d.lastKey;
        d.lastKey = t;
      },
      onPaste: (chars) => {
        d.pastedChars += chars;
      },
    });
    const wrap = h('div');
    if (shared) deskEditor = editor;
    if (parts.length && !shared?.readOnly) {
      const buttons = parts.map((part, i) =>
        h(
          'button',
          {
            class: `btn small partbtn m${i + 1}`,
            type: 'button',
            title: `Mark the selected text as ${part}`,
            onclick: () => editor.mark(i + 1),
          },
          `${CIRCLED[i]} ${part}`,
        ),
      );
      wrap.append(h('div', { class: 'row' }, h('span', { class: 'quiet' }, 'Select text, then mark it:'), buttons));
    }
    wrap.append(editor.el);
    return wrap;
  }

  function startEditing() {
    editing = true;
    redraw();
  }

  function redraw() {
    drawn = '';
    render(state);
    layout();
  }

  function startRetry() {
    const d = draftFor(state.question);
    d.text = state.mine?.text || d.text; // start from the last attempt
    d.passed = state.mine?.passed || null;
    $('#result').hidden = true;
    startEditing();
  }

  // ---- things that change between server updates ---------------------------------------------

  /** The hand-in counter and the soft timer. */
  function tick() {
    const q = state?.question;
    const rapidClock = $('#rapid-clock');
    if (q?.kind === 'rapid' && rapidClock) {
      const left = q.phaseEndsAt ? Math.max(0, Math.ceil((q.phaseEndsAt - (Date.now() + room.skew)) / 1000)) : 0;
      const text = { ready: `First line in ${left}`, answer: `${left}`, show: `Next in ${left}` }[q.phase] || '';
      if (rapidClock.textContent !== text) rapidClock.textContent = text;
      rapidClock.classList.toggle('low', q.phase === 'answer' && left <= 3);
    }
    const count = $('#live-count');
    if (!q || !count) return;
    const left = q.timerEndsAt ? q.timerEndsAt - (Date.now() + room.skew) : null;
    let time = '';
    if (left !== null) {
      time = left > 0 ? ` · ${clock(left)}` : ' · time is up, wrap it up';
    }
    let text = 'Waiting for the scores…';
    if (q.status === 'open') text = `${q.submitted}/${q.online} handed in${time}`;
    else if (q.status === 'revealed') text = 'Results are out';
    if (count.textContent !== text) count.textContent = text;
    count.classList.toggle('timer', left !== null && q.status === 'open');
    count.classList.toggle('low', left !== null && left < 15000);
  }

  /** Called every frame with our position: says which zone (or where on the line) we stand. */
  function standingAt(x, y) {
    const q = state?.question;
    const hint = $('#stand-hint');
    if (!q || !hint) return;
    let text;
    if (q.kind === 'line') {
      text = `Walk left or right, then press Enter or the button. Now: ${lineText(q, lineValue(x))}`;
    } else if (q.kind === 'rapid') {
      const zone = zoneAt(q.order.length, x, y);
      const ready = q.phase === 'ready' ? 'Zones move around on every line, so read them each time.' : 'It locks in when the time runs out.';
      text = zone < 0 ? `Walk into the zone of your answer. ${ready}` : `You're in ${LETTERS[zone]} · ${q.options[q.order[zone]]}. ${ready}`;
      document.querySelectorAll('#zone-list li').forEach((li) => li.classList.toggle('here', Number(li.dataset.pos) === zone));
    } else {
      const zone = zoneAt(q.order.length, x, y);
      text =
        zone < 0
          ? 'Walk into the zone of your answer (arrow keys or WASD), then lock in.'
          : `You're standing in ${LETTERS[zone]}. Press Enter or the button to lock it in.`;
      document.querySelectorAll('#zone-list li').forEach((li) => li.classList.toggle('here', Number(li.dataset.pos) === zone));
    }
    if (hint.textContent !== text) hint.textContent = text;
  }

  /** Enter locks in a zone or a spot on the line (when not typing). */
  function pressEnter() {
    const button = $('#lock-in');
    if (button && !button.disabled) button.click();
  }

  // ---- the result card -----------------------------------------------------------------------

  function maybeShowResult() {
    const q = state.question;
    const mine = state.mine;
    if (!q || mine?.state !== 'revealed') return;
    const id = `${q.key}:${mine.attempt}`;
    if (shownResult === id) return;
    shownResult = id;
    store.set('lhc-shown', id);
    openResult(false);
  }

  /** The score counts up step by step, then the feedback. `fast` skips the show (seen before). */
  function openResult(fast) {
    const q = state.question;
    const mine = state.mine;
    if (!mine?.breakdown) return;
    $('#result').hidden = false;
    const title = $('#result-title');
    title.innerHTML = '';
    title.append(q.title, mine.improved ? h('span', { class: 'improved-badge' }, 'IMPROVED') : '');
    const feedback = $('#result-feedback');
    feedback.innerHTML = '';
    scoreShow($('#result-show'), mine.breakdown, { fast }).then(() => {
      const verdict = {
        right: '✓ Right answer.',
        partial: '½ Half right.',
        wrong: '✗ Not the expected answer: check the screen.',
      }[mine.auto?.choice];
      if (verdict) feedback.append(h('p', {}, verdict));
      if (q.kind === 'code' && Array.isArray(mine.auto?.tests)) {
        feedback.append(checkList(q.tests, mine.auto.tests));
      }
      if (mine.feedback) feedback.append(h('div', { class: 'feedback' }, mine.feedback));
      if (mine.missed) feedback.append(h('p', { class: 'missed' }, `Worth another look: ${mine.missed}`));
      $('#retry').hidden = !mine.canRetry;
      // A little party for a right answer, all code checks passing, a good score or a better retry.
      const allCodePassed = Array.isArray(mine.auto?.tests) && mine.auto.tests.length > 0 && mine.auto.tests.every(Boolean);
      const good =
        mine.auto?.choice === 'right' ||
        allCodePassed ||
        mine.improved ||
        (mine.breakdown.steps || []).some((step) => /^Answer [23]\/3/.test(step.label));
      if (good && !fast) celebrate({ count: 70, ms: 2000 });
    });
  }

  $('#result-close').onclick = () => {
    $('#result').hidden = true;
  };
  $('#result').addEventListener('click', (e) => {
    if (e.target === $('#result')) $('#result').hidden = true;
  });
  $('#retry').onclick = startRetry;

  return { render, tick, standingAt, pressEnter, deskText };
}
