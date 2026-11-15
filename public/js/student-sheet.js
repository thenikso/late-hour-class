// The question sheet on the student page: read the question, answer it in the
// way its kind asks for, hand in, then see the result card and maybe retry.
//
// Question kinds: text (with optional marked parts), choice (walk into a zone
// or pick), grid (one pick per row), line (stand somewhere between two ends).

import { $, h, store, scoreShow, celebrate, clock } from './common.js';
import { zoneAt, lineValue, LETTERS, CIRCLED } from './world.js';
import { marksToHtml } from './marks.js';

const isSet = (v) => v !== null && v !== undefined;

export function createSheet({ send, room, layout }) {
  const el = $('#sheet');
  let state = null;
  let drawn = ''; // what the sheet currently shows; redrawn only when this changes
  let editing = false; // changing an answer already handed in, or retrying
  let shownResult = store.get('cge-shown') || ''; // the result card pops up once per attempt
  const drafts = {}; // question key -> what the student has typed or picked so far

  function draftFor(q) {
    drafts[q.key] ||= { text: '', choice: null, reason: null, grid: [], pastedChars: 0, activeMs: 0, lastKey: 0 };
    return drafts[q.key];
  }

  // ---- the sheet ---------------------------------------------------------------------

  function render(s) {
    const moved = s.question?.key !== state?.question?.key;
    state = s;
    const q = s.question;
    const mine = s.mine;
    if (moved) $('#result').hidden = true; // a new question: the last result card steps aside
    if (!q || s.mode === 'present' || s.mode === 'seating') {
      el.hidden = true;
      drawn = '';
      return;
    }
    const now = [q.key, q.status, mine?.state, mine?.attempt, editing, !!q.example].join('|');
    if (now !== drawn) {
      drawn = now;
      el.hidden = false;
      el.innerHTML = '';
      el.append(h('div', { class: 'sheet-head' }, h('h2', {}, q.title), h('button', { class: 'btn small', title: 'Fold or unfold', onclick: () => (el.classList.toggle('minimised'), layout()) }, '–')));
      if (q.prompt) el.append(h('p', { class: 'prompt' }, q.prompt));
      if (q.context) el.append(h('p', { class: 'context' }, q.context));
      const canEdit = (q.status === 'open' && (!mine || editing)) || (q.status === 'revealed' && editing && mine?.canRetry);
      el.append(...(canEdit ? editor(q, mine) : summary(q, mine)));
      if (q.example) el.append(h('p', { class: 'quiet small' }, 'One sound answer:'), h('div', { class: 'feedback' }, q.example));
    }
    tick();
    maybeShowResult();
  }

  /** After handing in (or when the question is closed): what you answered, and what you can do next. */
  function summary(q, mine) {
    const count = h('span', { class: 'status quiet', id: 'live-count' });
    if (!mine) return [h('p', { class: 'quiet' }, q.status === 'open' ? '' : 'This question is closed.'), h('div', { class: 'row' }, count)];
    const row = h('div', { class: 'row' });
    if (q.status === 'open') row.append(h('button', { class: 'btn', onclick: startEditing }, 'Change my answer'));
    if (mine.state === 'revealed') row.append(h('button', { class: 'btn gold', onclick: () => openResult(true) }, 'See my result'));
    if (mine.canRetry) row.append(h('button', { class: 'btn go', onclick: startRetry }, 'Try again ↻'));
    row.append(count);
    return [h('p', { class: 'done' }, mine.state === 'revealed' ? 'Scored. See your result.' : '✓ Handed in.'), answerSummary(q, mine), row];
  }

  function answerSummary(q, mine) {
    const box = h('div', { class: 'preview' });
    if (q.kind === 'choice' && isSet(mine.choice)) {
      box.append(h('div', {}, `${LETTERS[q.order.indexOf(mine.choice)]} · ${q.options[mine.choice]}`));
      if (q.reasons && isSet(mine.reason)) box.append(h('div', {}, `Reason: ${q.reasons.options[mine.reason]}`));
    }
    if (q.kind === 'grid' && mine.grid) q.rows.forEach((row, i) => box.append(h('div', {}, `${i + 1}. ${(row.options || q.options)[mine.grid[i]] ?? '—'}`)));
    if (q.kind === 'line' && isSet(mine.value)) box.append(h('div', {}, lineText(q, mine.value)));
    if (mine.text) box.append(h('div', { html: marksToHtml(mine.text) }));
    return box;
  }

  const lineText = (q, value) => (value === 50 ? 'Right in the middle.' : `${Math.abs(value - 50) * 2}% of the way towards “${q.labels[value < 50 ? 0 : 1]}”.`);

  /** The inputs for this kind of question, and the hand-in button. */
  function editor(q, mine) {
    const d = draftFor(q);
    if (mine && !d.text && mine.text) d.text = mine.text;
    const out = [];
    if (q.kind === 'choice') out.push(choiceEditor(q, d));
    if (q.kind === 'grid') out.push(gridEditor(q, d));
    if (q.kind === 'line') out.push(h('p', { class: 'quiet', id: 'stand-hint' }));
    if (q.kind === 'text') out.push(textEditor(q.parts || [], d, 'Your answer'));
    if (q.kind === 'choice' && q.text) out.push(textEditor(q.text.parts || [], d, q.text.prompt));

    const standing = q.kind === 'line' || (q.kind === 'choice' && q.zones); // answered by where you stand
    const label = q.kind === 'line' ? 'Lock in my spot ⏎' : standing ? 'Lock in my zone ⏎' : mine && q.status === 'revealed' ? 'Hand in my retry' : 'Hand in';
    const err = h('span', { class: 'err' });
    const button = h('button', { class: 'btn go', id: 'lock-in' }, label);
    button.onclick = async () => {
      button.disabled = true;
      try {
        await send('answer', { text: d.text, choice: d.choice, reason: d.reason, grid: d.grid, meta: { pastedChars: d.pastedChars, activeMs: d.activeMs } });
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
    const picks = q.zones ? [] : pickRow(q.order.map(() => 'Pick'), q.order.indexOf(d.choice), (pos) => (d.choice = q.order[pos]));
    q.order.forEach((opt, pos) => list.append(h('li', { 'data-pos': pos }, picks[pos] || '', picks[pos] ? ' ' : '', h('span', { class: 'letter' }, LETTERS[pos]), q.options[opt])));
    wrap.append(list);
    if (q.zones) wrap.append(h('p', { class: 'quiet', id: 'stand-hint' }));
    if (q.reasons) wrap.append(h('div', { class: 'row' }, h('span', {}, 'Main reason:'), pickRow(q.reasons.options, d.reason, (i) => (d.reason = i))));
    return wrap;
  }

  function gridEditor(q, d) {
    const table = h('table');
    q.rows.forEach((row, i) => {
      const buttons = pickRow(row.options || q.options, d.grid[i], (j) => (d.grid[i] = j));
      table.append(h('tr', {}, h('td', {}, `${i + 1}. ${row.text}`), h('td', { class: 'opts' }, buttons)));
    });
    return table;
  }

  /**
   * A plain text box. If the question names parts, a button per part wraps the
   * selected text as ==①…==, and the preview below shows the parts in colour.
   */
  function textEditor(parts, d, label) {
    const box = h('textarea', { placeholder: label, 'aria-label': label });
    box.value = d.text;
    const preview = h('div', { class: 'preview' });
    const sync = () => {
      d.text = box.value;
      preview.innerHTML = marksToHtml(d.text) || '<span class="quiet">Preview</span>';
    };
    sync();
    box.addEventListener('input', sync);
    // How the answer was written (time spent typing, how much was pasted). The teacher
    // sees it as a prompt to ask about the answer; it never changes a score.
    box.addEventListener('keydown', () => {
      const t = performance.now();
      if (d.lastKey && t - d.lastKey < 5000) d.activeMs += t - d.lastKey;
      d.lastKey = t;
    });
    box.addEventListener('paste', (e) => (d.pastedChars += (e.clipboardData?.getData('text') || '').length));

    const wrap = h('div');
    if (parts.length) {
      const markButtons = parts.map((part, i) => {
        const b = h('button', { class: `btn small partbtn m${i + 1}`, type: 'button', title: `Mark the selected text as ${part}` }, `${CIRCLED[i]} ${part}`);
        b.onclick = () => {
          const { selectionStart: from, selectionEnd: to, value } = box;
          const inner = value.slice(from, to);
          box.value = `${value.slice(0, from)}==${CIRCLED[i]}${inner}==${value.slice(to)}`;
          // the caret goes after the mark, or inside an empty one
          const caret = from + 3 + inner.length + (inner ? 2 : 0);
          box.focus();
          box.setSelectionRange(caret, caret);
          sync();
        };
        return b;
      });
      wrap.append(h('div', { class: 'row' }, h('span', { class: 'quiet' }, 'Select text, then mark it:'), markButtons));
    }
    wrap.append(box, preview);
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
    $('#result').hidden = true;
    startEditing();
  }

  // ---- things that change between server updates ---------------------------------------------

  /** The hand-in counter and the soft timer. */
  function tick() {
    const q = state?.question;
    const count = $('#live-count');
    if (!q || !count) return;
    const left = q.timerEndsAt ? q.timerEndsAt - (Date.now() + room.skew) : null;
    const time = left === null ? '' : left > 0 ? ` · ${clock(left)}` : ' · time is up, wrap it up';
    const text = q.status === 'open' ? `${q.submitted}/${q.online} handed in${time}` : q.status === 'revealed' ? 'Results are out' : 'Waiting for the scores…';
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
    if (q.kind === 'line') text = `Walk left or right, then press Enter or the button. Now: ${lineText(q, lineValue(x))}`;
    else {
      const zone = zoneAt(q.order.length, x, y);
      text = zone < 0 ? 'Walk into the zone of your answer (arrow keys or WASD), then lock in.' : `You're standing in ${LETTERS[zone]}. Press Enter or the button to lock it in.`;
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
    store.set('cge-shown', id);
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
      const verdict = { right: '✓ Right answer.', partial: '½ Half right.', wrong: '✗ Not the expected answer: check the screen.' }[mine.auto?.choice];
      if (verdict) feedback.append(h('p', {}, verdict));
      if (mine.feedback) feedback.append(h('div', { class: 'feedback' }, mine.feedback));
      if (mine.missed) feedback.append(h('p', { class: 'missed' }, `Worth another look: ${mine.missed}`));
      $('#retry').hidden = !mine.canRetry;
      // a little party for a right answer, a good score or a better retry
      const good = mine.auto?.choice === 'right' || mine.improved || (mine.breakdown.steps || []).some((step) => /^Answer [23]\/3/.test(step.label));
      if (good && !fast) celebrate({ count: 70, ms: 2000 });
    });
  }
  $('#result-close').onclick = () => ($('#result').hidden = true);
  $('#retry').onclick = startRetry;

  return { render, tick, standingAt, pressEnter };
}
