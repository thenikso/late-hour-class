// The question & scoring panel on the teacher page:
//   - 1-click micro-checks for mid-lesson attention resets
//   - live question controls (open -> close -> score -> reveal)
//   - class stats and per-student answer cards with score/feedback overrides
//
// Persistent sections ("All lesson questions" and "Ask a quick question") live
// in their own containers so incoming state updates never collapse them or wipe
// what the teacher is typing.

import { $, h, clock } from './common.js';
import { LETTERS } from './shared/world.js';
import { marksToHtml } from './shared/marks.js';
import { isSet } from './shared/util.js';

const MICRO_CHECKS = [
  {
    label: 'Pulse: Makes sense?',
    title: 'Quick pulse check',
    def: { kind: 'choice', title: 'Quick pulse', prompt: 'How is this landing right now?', options: ['Clear', 'Mostly', 'Lost'], correct: null, zones: false, scored: false },
  },
  {
    label: 'Confidence line',
    title: 'Opinion line from Foggy to Crystal clear',
    def: { kind: 'line', title: 'Confidence check', prompt: 'How clear is this idea right now?', labels: ['Foggy', 'Crystal clear'], scored: false },
  },
  {
    label: 'True / False',
    title: 'Quick two-zone True/False poll',
    def: { kind: 'choice', title: 'True or False?', prompt: 'Walk to True or False.', options: ['True', 'False'], correct: null, zones: true, scored: false },
  },
];

export function createQuestionPanel({ act, alertBar, seatSeconds }) {
  let state = null;
  let liveSig = '';
  let allQuestionsSig = '';
  let slideQuestionsSig = '';

  // Build the persistent 1-click micro-checks + custom quick question form once.
  const quickRoot = $('#quick-question');
  quickRoot.append(buildQuickTools());

  function buildQuickTools() {
    const presets = h(
      'div',
      { class: 'row' },
      h('span', { class: 'quiet small' }, '1-click check:'),
      MICRO_CHECKS.map((mc) =>
        h(
          'button',
          { class: 'btn small', type: 'button', title: mc.title, onclick: () => act('open', { def: mc.def }) },
          mc.label,
        ),
      ),
    );

    const prompt = h('input', { type: 'text', placeholder: 'Ask a quick question now…' });
    const kind = h(
      'select',
      {},
      h('option', { value: 'text' }, 'Written answer'),
      h('option', { value: 'choice' }, 'Zones (a poll)'),
      h('option', { value: 'line' }, 'Opinion line'),
    );
    const extra = h('input', { type: 'text', hidden: true });
    kind.onchange = () => {
      extra.hidden = kind.value === 'text';
      extra.placeholder =
        kind.value === 'choice' ? 'Options, separated by |' : 'The two ends, separated by |  (default: Disagree | Agree)';
    };
    const ask = () => {
      const text = prompt.value.trim();
      if (!text) return;
      const list = extra.value.split('|').map((x) => x.trim()).filter(Boolean);
      const def = { kind: kind.value, title: 'Quick question', prompt: text, scored: false };
      if (kind.value === 'choice') {
        if (list.length < 2) return alertBar('Give at least two options, separated by |');
        Object.assign(def, { options: list, correct: null });
      }
      if (kind.value === 'line') def.labels = list;
      act('open', { def });
      prompt.value = '';
      extra.value = '';
    };

    const custom = h(
      'details',
      {},
      h('summary', {}, 'Ask a custom quick question'),
      h('div', { class: 'row' }, prompt),
      h('div', { class: 'row' }, kind, extra, h('button', { class: 'btn', type: 'button', onclick: ask }, 'Ask')),
    );
    return h('div', {}, presets, custom);
  }

  function questionList(questions) {
    return h(
      'ul',
      { class: 'qlist' },
      questions.map((q) =>
        h(
          'li',
          {},
          h('span', { class: 'quiet' }, q.slide ? `s${q.slide}` : ''),
          h('span', { class: 'grow' }, q.title),
          q.status ? h('span', { class: 'chip info' }, `${q.status} · ${q.answers}`) : '',
          h('button', { class: 'btn small go', onclick: () => act('open', { key: q.key }) }, q.status ? 'Reopen' : 'Open'),
        ),
      ),
    );
  }

  function render(s) {
    state = s;
    renderSlideQuestions(s);
    renderAllQuestions(s);
    renderLiveQuestion(s);
  }

  function renderSlideQuestions(s) {
    const box = $('#slide-questions');
    const q = s.question;
    const onThisSlide = s.questions.filter((x) => x.slide === s.screen.slide);
    const show = (!q || q.status === 'revealed') && onThisSlide.length > 0;
    const sig = show ? JSON.stringify([s.screen.slide, onThisSlide]) : '';
    if (sig === slideQuestionsSig) return;
    slideQuestionsSig = sig;
    box.hidden = !show;
    box.innerHTML = '';
    if (show) {
      // A lesson without a deck has no slide number: just say "Questions".
      const label = s.screen.slide ? `Questions on slide ${s.screen.slide}` : 'Questions';
      box.append(h('strong', {}, label), questionList(onThisSlide));
    }
  }

  function renderAllQuestions(s) {
    const sig = JSON.stringify(s.questions);
    if (sig === allQuestionsSig) return;
    allQuestionsSig = sig;
    const summary = $('#all-questions-summary');
    summary.textContent = `All lesson questions (${s.questions.length})`;
    const list = $('#all-questions-list');
    list.replaceChildren(questionList(s.questions));
  }

  function renderLiveQuestion(s) {
    const box = $('#live-question');
    const q = s.question;
    if (box.contains(document.activeElement) && ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) {
      // Don't wipe what the teacher is typing: only the counter moves.
      if ($('#q-count') && q) $('#q-count').textContent = `${q.submitted}/${q.online}`;
      return;
    }

    const sig = JSON.stringify([
      q,
      s.desks?.map((d) => [d.n, d.members, d.penName]), // the text streams in by itself
      s.answers,
      s.picks,
      s.spotlight?.pid || null,
      s.scoring,
      s.wallNames,
    ]);
    if (sig === liveSig) return;
    liveSig = sig;

    box.innerHTML = '';
    if (!q) {
      box.append(h('p', { class: 'quiet' }, 'No question open. Pick one from the slide list, this slide, or use a 1-click check below.'));
      return;
    }
    box.append(liveQuestion(s, q));
  }

  function liveQuestion(s, q) {
    const wrap = h('div');
    wrap.append(
      h(
        'div',
        { class: 'qhead' },
        h('h2', {}, q.title),
        h('span', { class: 'chip info' }, q.status),
        h('span', { class: 'big-count', id: 'q-count' }, `${q.submitted}/${q.online}`),
        h('span', { class: 'quiet' }, 'handed in'),
        h('span', { class: 'quiet', id: 'q-elapsed' }),
      ),
    );
    const open = q.status === 'open';
    const writing = q.waitingFor.length;
    if (open && q.kind === 'rapid') {
      // A rapid round runs by itself; Close stops it early.
      const where = q.phase === 'ready' ? 'Intro up, first line soon' : `Line ${q.row + 1} of ${q.rows.length} (${q.phase === 'show' ? 'showing the answer' : 'answering'})`;
      wrap.append(h('p', { class: 'quiet' }, `${where}. It moves on by itself and closes after the last line.`));
    } else if (open && writing) wrap.append(h('p', { class: 'waiting' }, `Waiting for: ${q.waitingFor.join(', ')}`));
    if (open && !writing && q.online > 0 && q.kind !== 'rapid') wrap.append(h('p', { class: 'ok' }, 'Everyone is in. You can close.'));
    if (q.fullHouse) wrap.append(h('p', { class: 'ok' }, 'Everyone handed in: +10 each at the reveal.'));

    const row = h('div', { class: 'row' });
    // The submit gate: closing early is possible, but it has to be said out loud.
    if (open && writing) {
      row.append(h('button', { class: 'btn hot', onclick: () => act('close', { force: true }) }, `Close anyway (${writing} still writing)`));
    }
    if (open && !writing) {
      row.append(h('button', { class: 'btn go', onclick: () => act('close') }, q.kind === 'rapid' ? 'Stop early' : 'Close'));
    }
    if (!open && q.needsAi) {
      const retries = q.pendingRetries || 0;
      let label = `Suggest scores (${s.aiMode})`;
      if (s.scoring) label = `Scoring with ${s.aiMode}…`;
      else if (q.status === 'revealed') label = retries ? `Score retries (${retries})` : 'Score retries';
      const primary = q.status === 'closed' || retries > 0;
      row.append(h('button', { class: `btn ${primary ? 'gold' : ''}`, disabled: s.scoring, onclick: () => act('score') }, label));
    }
    if (!open) {
      const primaryReveal = q.status === 'scored';
      row.append(
        h(
          'button',
          { class: `btn ${primaryReveal ? 'go' : ''}`, onclick: () => act('reveal') },
          q.status === 'revealed' ? 'Reveal again' : 'Reveal to everyone',
        ),
      );
    }
    if (q.status === 'revealed' && q.hasExample) {
      row.append(
        h(
          'button',
          {
            class: `btn ${q.exampleShown ? 'on' : ''}`,
            title: 'Put the sound answer from the lesson on the projector',
            onclick: () => act('example', { on: !q.exampleShown }),
          },
          'Show a sound answer',
        ),
      );
    }
    if (q.status === 'revealed') {
      row.append(
        h(
          'button',
          {
            class: `btn small ${s.wallNames ? 'on' : ''}`,
            title: 'Projector answer cards are anonymous by default; toggle to show student names',
            onclick: () => act('wall-names', { on: !s.wallNames }),
          },
          s.wallNames ? 'Names on wall: on' : 'Names on wall: off',
        ),
      );
    }
    if (s.answers.length) {
      row.append(
        h(
          'button',
          { class: 'btn', title: 'Put a random student on the spot, with their answer on the projector', onclick: () => act('pick') },
          'Pick someone',
        ),
      );
    }
    if (s.spotlight) {
      row.append(h('button', { class: 'btn', onclick: () => act('spotlight', { pid: null }) }, `Clear spotlight (${s.spotlight.name})`));
    }
    if (open) {
      // A soft countdown on every screen; nothing closes by itself.
      row.append(h('span', { class: 'quiet' }, 'Timer'));
      for (const m of [1, 2, 3, 5]) {
        row.append(
          h(
            'button',
            { class: 'btn small', title: `Show a ${m} minute countdown`, onclick: () => act('timer', { seconds: m * 60 }) },
            `${m}m`,
          ),
        );
      }
      if (q.timerEndsAt) row.append(h('button', { class: 'btn small', onclick: () => act('timer', { seconds: 0 }) }, 'off'));
    }
    row.append(h('button', { class: 'btn small', onclick: () => act('seat', { seconds: seatSeconds() }) }, 'Back to seats'));
    wrap.append(row);

    if (q.scoringError) {
      wrap.append(h('p', { class: 'err' }, `Scoring issue: ${q.scoringError}`));
    }
    if (q.missed.length) {
      wrap.append(
        h(
          'p',
          { class: 'missed' },
          'Missed most: ',
          q.missed.slice(0, 4).map((m) => h('span', { class: 'chip warn' }, `${m.concept} ×${m.n}`)),
        ),
      );
    }
    wrap.append(statsView(q));
    if (s.desks) wrap.append(desksView(s));

    const picks = s.picks || { good: [], check: [] };
    wrap.append(h('ul', { class: 'answers' }, s.answers.map((a) => answerItem(s, q, a, picks))));
    return wrap;
  }

  // ---- shared desk drafts (written pair work): every desk's text, as it is typed -------------

  const deskTexts = new Map(); // `${question}:${desk}` -> { text, v }: the newest we have heard of

  function newestDraft(key, d) {
    const id = `${key}:${d.n}`;
    const known = deskTexts.get(id);
    if (!known || d.v > known.v) deskTexts.set(id, { text: d.text, v: d.v });
    return deskTexts.get(id).text;
  }

  function desksView(s) {
    const box = h('div', { class: 'desks' }, h('strong', {}, 'Desks'));
    for (const d of s.desks) {
      const names = d.members.map((m) => m.name).join(', ') || 'nobody there now';
      const pen = d.penName ? ` · ✎ ${d.penName}` : '';
      box.append(
        h(
          'div',
          { class: 'desk', id: `desk-${d.n}` },
          h('div', { class: 'quiet' }, `Desk ${d.n + 1}: ${names}${pen}`),
          h('div', { class: 'draft' }, newestDraft(s.question.key, d) || '…'),
        ),
      );
    }
    return box;
  }

  /** A `desk` event: someone typed. Only that desk's text changes on the page. */
  function deskText(d) {
    const text = newestDraft(d.key, d);
    const el = document.querySelector(`#desk-${d.n} .draft`);
    if (el) el.textContent = text || '…';
  }

  /** How the class answered: a bar per option, per grid row, or along the opinion line. */
  function statsView(q) {
    const box = h('div', { class: 'stats' });
    const bar = (n, of) => h('span', { class: 'bar', style: `width:${(n / Math.max(1, of)) * 120}px` });
    if (q.kind === 'choice') {
      const total = q.counts.reduce((x, y) => x + y, 0);
      const correct = isSet(q.correct) ? [].concat(q.correct) : [];
      q.order.forEach((opt, pos) => {
        box.append(
          h(
            'div',
            {},
            h('b', {}, `${LETTERS[pos]} `),
            correct.includes(opt) ? h('span', { class: 'ok' }, '✓ ') : '',
            `${q.options[opt].slice(0, 70)} · ${q.counts[opt]}`,
            bar(q.counts[opt], total),
          ),
        );
      });
    }
    if (q.kind === 'grid' || q.kind === 'rapid') {
      q.rows.forEach((row, i) => {
        const right = q.rowCorrect[i] || [];
        box.append(
          h(
            'div',
            {},
            `${i + 1}. ${row.text.slice(0, 60)} → `,
            (row.options || q.options).map((o, j) => h('span', { class: right.includes(j) ? 'ok' : '' }, `${o}: ${q.rowStats[i][j]}  `)),
          ),
        );
      });
    }
    if (q.kind === 'bug') {
      box.append(
        h(
          'ol',
          { class: 'code-lines' },
          q.code.split('\n').map((line, i) =>
            h('li', { class: q.correctLines.includes(i + 1) ? 'right' : '' }, h('code', {}, line || ' '), q.lineCounts[i] ? h('b', {}, ` ← ${q.lineCounts[i]}`) : ''),
          ),
        ),
      );
    }
    if (q.kind === 'code') {
      q.tests.forEach((test, i) => {
        box.append(h('div', {}, `${test.name} · ${q.passCounts[i]} pass`, bar(q.passCounts[i], q.submitted)));
      });
    }
    if (q.kind === 'line') {
      const total = q.spread.reduce((x, y) => x + y, 0);
      box.append(
        h(
          'div',
          {},
          `${q.labels[0]} ◀ `,
          q.spread.map((n) => h('span', {}, bar(n, total), ` ${n} `)),
          `▶ ${q.labels[1]}`,
          isSet(q.average) ? ` · average ${q.average}/100` : '',
        ),
      );
    }
    return box;
  }

  /** One student's answer: what they wrote, the flags, and the 0-3 score with its feedback. */
  function answerItem(s, q, a, picks) {
    const def = q.def;
    const good = picks.good.includes(a.pid);
    const check = picks.check.includes(a.pid);
    const li = h('li', { class: `answer ${good ? 'pick-good' : ''} ${check ? 'pick-check' : ''}` });
    const onSpot = s.spotlight?.pid === a.pid;
    li.append(
      h(
        'div',
        { class: 'who' },
        h('span', {}, a.name),
        a.attempt > 1 ? h('span', { class: 'chip good' }, `retry ${a.attempt}`) : '',
        good ? h('span', { class: 'chip good' }, 'worth showing') : '',
        h('span', { class: 'grow' }),
        isSet(a.points) ? h('span', { class: 'points' }, `${a.points} pts`) : '',
        h(
          'button',
          {
            class: `btn small ${onSpot ? 'on' : ''}`,
            title: 'Put this answer on the projector; the student walks to the front',
            onclick: () => act('spotlight', { pid: onSpot ? null : a.pid }),
          },
          'Spotlight',
        ),
      ),
    );

    const tick = (ok) => (ok === true ? h('span', { class: 'ok' }, ' ✓') : ok === false ? h('span', { class: 'no' }, ' ✗') : '');
    const body = h('div', { class: 'body' });
    if (def.kind === 'choice' && isSet(a.choice)) {
      const verdict = a.auto?.choice === 'partial' ? ' ½' : tick({ right: true, wrong: false }[a.auto?.choice]);
      body.append(h('div', {}, h('b', {}, LETTERS[q.order.indexOf(a.choice)]), ` ${def.options[a.choice].slice(0, 90)}`, verdict));
      if (def.reasons && isSet(a.reason)) {
        body.append(h('div', { class: 'quiet' }, `Reason: ${def.reasons.options[a.reason]}`, tick(a.auto?.reason)));
      }
    }
    if ((def.kind === 'grid' || def.kind === 'rapid') && a.grid) {
      body.append(
        h(
          'div',
          {},
          a.grid.map((picked, i) => {
            const ok = a.auto?.rows?.[i];
            const label = picked === null ? '—' : (def.rows[i].options || def.options)[picked].split(' ')[0];
            return h('span', { class: ok === true ? 'ok' : ok === false ? 'no' : '' }, `${i + 1}:${label}  `);
          }),
        ),
      );
    }
    if (def.kind === 'line' && isSet(a.value)) body.append(h('div', {}, `Stands at ${a.value}/100`));
    if (def.kind === 'bug') {
      body.append(
        h('div', {}, `Line ${a.line}`, tick({ right: true, wrong: false }[a.auto?.choice]), h('span', { class: 'quiet' }, ` · after ${clock(a.took)}`)),
      );
    }
    if (def.kind === 'code') {
      // The checks ran in the student's browser: read the code before trusting the ticks.
      body.append(
        h('pre', { class: 'code' }, a.text),
        h(
          'div',
          {},
          def.tests.map((test, i) => h('span', { class: a.passed?.[i] ? 'ok' : 'no' }, `${a.passed?.[i] ? '✓' : '✗'} ${test.name}  `)),
        ),
      );
    } else if (a.text) {
      body.append(h('div', { html: marksToHtml(a.text) }));
    }
    li.append(body);
    if (a.flags.length) {
      li.append(h('div', {}, a.flags.map((f) => h('span', { class: `chip ${f.level}` }, f.label))));
    }

    if (q.needsAi) {
      const ai = a.ai || {};
      const feedback = h('textarea', { placeholder: 'Feedback to the student (optional)' });
      feedback.value = ai.feedback || '';
      let savedFeedback = feedback.value;
      const saveScore = (score) => {
        savedFeedback = feedback.value;
        act('set-score', { pid: a.pid, score, feedback: feedback.value });
      };
      // Only send on blur/change if the feedback text itself was modified without a score button click.
      feedback.addEventListener('change', () => {
        if (feedback.value !== savedFeedback) saveScore(ai.score ?? 0);
      });
      const by = !a.ai ? 'Not scored yet' : ai.edited ? 'Your score' : `Suggested by ${ai.by}`;
      li.append(
        h(
          'div',
          { class: 'ai' },
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'quiet' }, by),
            h(
              'span',
              { class: 'scorebtns' },
              [0, 1, 2, 3].map((n) =>
                h(
                  'button',
                  {
                    class: `btn small ${ai.score === n ? 'on' : ''}`,
                    type: 'button',
                    onmousedown: (e) => e.preventDefault(), // keep focus out of blur-before-click race
                    onclick: () => saveScore(n),
                  },
                  n,
                ),
              ),
            ),
            ai.missed ? h('span', { class: 'chip warn' }, `missed: ${ai.missed}`) : '',
          ),
          feedback,
        ),
      );
    }
    return li;
  }

  return { render, deskText };
}
