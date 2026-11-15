// The teacher page: drive the slides, set the room's mode, run questions
// (open → close → score → reveal), and keep an eye on the class.

import { $, h, post, connect, screenFrame, classBar, clock } from './common.js';
import { CLASS_LEVELS } from './fun.js';
import { Room } from './room.js';
import { avatarCanvas } from './sprites.js';
import { LETTERS } from './world.js';
import { marksToHtml } from './marks.js';

const key = new URLSearchParams(location.search).get('key') || '';
const withKey = (path) => `${path}?key=${encodeURIComponent(key)}`;
let state = null;

const room = new Room($('#mini'));
room.showNames = false;
const notes = screenFrame($('#notes'));
const isSet = (v) => v !== null && v !== undefined;

// ---- talking to the server -----------------------------------------------------------

/**
 * Run a teacher action. If the submit gate stops it (students are still
 * writing), offer "move on anyway", which repeats the action with `force`.
 */
async function act(action, body = {}) {
  try {
    return await post(withKey(`/api/teacher/${action}`), body);
  } catch (e) {
    if (e.data?.gate) gateBar(action, body, e.data.waitingFor);
    else alertBar(e.message);
  }
}

function alertBar(...content) {
  const bar = h('div', { class: 'alert panel' }, content);
  $('#alerts').append(bar);
  setTimeout(() => bar.remove(), 8000);
  return bar;
}

function gateBar(action, body, names) {
  const bar = alertBar(
    h('span', {}, `Still writing: ${names.join(', ')}. `),
    h('button', { class: 'btn small hot', onclick: () => (bar.remove(), act(action, { ...body, force: true })) }, 'Move on anyway'),
    h('button', { class: 'btn small', onclick: () => bar.remove() }, 'Wait'),
  );
}

connect(
  { role: 'teacher', key },
  {
    onState: (s) => {
      state = s;
      room.setState(s);
      render();
    },
    onPos: (list) => room.setPositions(list),
    onBall: ([x, y]) => room.setBall(x, y),
    onFx: (ev) => room.fx(ev),
    onGone: () => alertBar('Wrong teacher key: use the link printed when the server started.'),
    onStatus: (ok) => {
      $('#conn').textContent = ok ? 'live' : 'reconnecting…';
      $('#conn').style.color = ok ? 'var(--good)' : 'var(--warn)';
    },
  },
);
fetch('/api/info')
  .then((r) => r.json())
  .then((info) => ($('#join-url').textContent = info.studentUrl));

// ---- the fixed controls ----------------------------------------------------------------

const seatSeconds = () => Number($('#seat-s').value) || 20;
const go = (n) => act('slide', { slide: n });

$('#open-screen').href = withKey('/screen');
$('#report').href = `${withKey('/report')}&names`;
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => act('mode', { mode: b.dataset.mode })));
$('#seat').onclick = (e) => e.target.tagName !== 'INPUT' && act('seat', { seconds: seatSeconds() });
$('#share').onclick = () => $('#url').value.trim() && act('url', { url: $('#url').value.trim() });
$('#prev').onclick = () => go((state?.screen.slide || 1) - 1);
$('#next').onclick = () => go((state?.screen.slide || 0) + 1);
$('#cue').onclick = () => act('cue');
$('#goto').addEventListener('keydown', (e) => e.key === 'Enter' && go(Number(e.target.value)));
$('#finale').onclick = () => act('finale', { on: !state?.finale });
$('#show-asks').onclick = () => act('show-asks', { on: !state?.showAsks });

// Arrow keys and E drive the slides, like in the deck itself.
addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') (e.preventDefault(), $('#next').click());
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') (e.preventDefault(), $('#prev').click());
  if (e.key.toLowerCase() === 'e') $('#cue').click();
});

// The small room at the top right.
function fitMini() {
  const w = $('#mini').parentElement.clientWidth - 28;
  room.fit(w, w);
}
addEventListener('resize', fitMini);
fitMini();
const loop = (t) => {
  room.draw(t);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// How long the question has been open, ticking between server updates.
setInterval(() => {
  const el = $('#q-elapsed');
  const q = state?.question;
  if (el && q?.status === 'open') el.textContent = `open for ${clock(Date.now() + room.skew - q.openedAt)}`;
}, 1000);

// ---- rendering ---------------------------------------------------------------------------

function render() {
  const s = state;
  $('#lesson').textContent = s.lessonTitle;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
  $('#seat').classList.toggle('on', s.mode === 'seating');
  $('#finale').classList.toggle('on', !!s.finale);
  if (s.notesUrl && s.screen.slide) notes.update({ screen: s.screen }, s.notesUrl);
  $('#notes-box').hidden = !s.notesUrl;
  // Students who pressed "I'm lost" on this slide (they clear it with "Got it").
  $('#lost').hidden = !s.lost.length;
  $('#lost').textContent = s.lost.length ? `? ${s.lost.length} lost: ${s.lost.join(', ')}` : '';
  renderSlides();
  renderQuestion();
  renderPlayers();
  renderBoard();
  renderAsks();
  renderGoal();
}

// ---- the slide list ------------------------------------------------------------------------

let slidesDrawn = '';
function renderSlides() {
  const s = state;
  const list = $('#slide-list');
  const now = JSON.stringify([s.slides.length, s.questions.map((q) => q.status + q.answers)]);
  if (now !== slidesDrawn) {
    slidesDrawn = now;
    list.innerHTML = '';
    for (const slide of s.slides) {
      const kind = slide.mode === 'work' ? 'TASK ' : slide.mode === 'gate' ? 'BREAK ' : '';
      const li = h('li', { 'data-n': slide.n, title: slide.title, onclick: () => go(slide.n) }, h('span', { class: 'n' }, slide.n), h('span', {}, h('span', { class: `k ${slide.mode}` }, kind), slide.title || slide.seg));
      // Questions tied to this slide: one click shows the slide and opens the question.
      const questions = s.questions.filter((q) => q.slide === Number(slide.id));
      if (questions.length)
        li.append(
          h(
            'div',
            { class: 'qs' },
            questions.map((q) => {
              const open = (e) => {
                e.stopPropagation();
                go(slide.n).then(() => act('open', { key: q.key }));
              };
              const look = q.status === 'revealed' ? 'go' : q.status ? 'gold' : '';
              return h('button', { class: `btn small ${look}`, title: 'Show this slide and open the question', onclick: open }, `▶ ${q.title.split('·').pop().trim()}${q.answers ? ` (${q.answers})` : ''}`);
            }),
          ),
        );
      list.append(li);
    }
  }
  list.querySelectorAll('li').forEach((li) => {
    const current = Number(li.dataset.n) === s.screen.slide;
    if (current && !li.classList.contains('cur')) li.scrollIntoView({ block: 'nearest' });
    li.classList.toggle('cur', current);
  });
  $('#goto').placeholder = s.screen.slide || '';
  $('#goto').max = s.slides.length;
}

// ---- the side column: players, board, questions from students, class goal -----------------------

function renderPlayers() {
  const players = [...state.players].sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
  $('#count').textContent = `${players.filter((p) => p.online).length} online`;
  const ul = $('#players');
  ul.innerHTML = '';
  for (const p of players) {
    const rename = () => {
      const name = prompt(`New name for ${p.name}`, p.name);
      if (name) act('rename', { pid: p.id, name });
    };
    const remove = () => confirm(`Remove ${p.name} from the room?`) && act('kick', { pid: p.id });
    ul.append(
      h(
        'li',
        { class: p.online ? '' : 'off' },
        avatarCanvas(p.avatar, 1),
        h('span', { class: 'grow' }, p.name),
        h('span', { class: 'points' }, p.points),
        h('button', { class: 'btn small', title: 'Rename', onclick: rename }, '✎'),
        h('button', { class: 'btn small', title: 'Remove from the room', onclick: remove }, '×'),
      ),
    );
  }
}

function renderBoard() {
  const b = state.board;
  const el = $('#board');
  el.innerHTML = '';
  el.append(h('strong', {}, 'Top 5'), h('ol', {}, b.top.map((p) => h('li', {}, `${p.name} · `, h('span', { class: 'points' }, p.points)))));
  if (b.improved.length) el.append(h('strong', {}, 'Improved'), h('ul', {}, b.improved.map((p) => h('li', {}, `${p.name} ×${p.improved}`))));
}

/** Questions students asked. Held ones did not look like a question: post or dismiss them. */
function renderAsks() {
  const s = state;
  $('#show-asks').classList.toggle('on', s.showAsks);
  $('#ask-count').textContent = s.asks.length ? `(${s.asks.length})` : '';
  const ul = $('#asks');
  ul.innerHTML = '';
  if (!s.asks.length) ul.append(h('li', { class: 'quiet' }, 'None yet. Students ask with the Ask button.'));
  const status = (it, to, label, title) => h('button', { class: 'btn small', title, onclick: () => act('ask-status', { id: it.id, status: to }) }, label);
  for (const it of [...s.asks].sort((a, b) => b.votes - a.votes)) {
    const held = it.status === 'held';
    ul.append(
      h(
        'li',
        { class: held ? 'held' : '' },
        h('div', {}, held ? h('span', { class: 'chip warn' }, 'held') : h('span', { class: 'chip good' }, `▲ ${it.votes}`), it.text, h('span', { class: 'quiet' }, ` · ${it.name}`)),
        h('div', { class: 'row' }, held ? status(it, 'posted', 'Post', 'Put it on the board') : status(it, 'answered', 'Answered', 'Take it off the board'), status(it, 'hidden', held ? 'Dismiss' : 'Hide', 'Remove it')),
      ),
    );
  }
}

function renderGoal() {
  const s = state;
  classBar($('#klass'), s.klass);
  const got = CLASS_LEVELS.slice(0, s.klass.level).map((l) => l.name);
  $('#klass-note').textContent = got.length ? `In the room: ${got.join(', ')}.` : "Everyone's points together unlock things for the room.";
  // Concept trophies of this lesson: earned at a reveal, or awarded by hand.
  const box = $('#trophies');
  box.innerHTML = '';
  for (const t of s.lessonTrophies)
    box.append(h('li', {}, h('span', { class: 'grow' }, t.name), t.earned ? h('span', { class: 'chip good' }, 'on the shelf') : h('button', { class: 'btn small', title: t.after ? `Earned when “${t.after}” is revealed, or now` : 'Award it now', onclick: () => act('trophy', { id: t.id }) }, 'Award')));
  $('#trophies-box').hidden = !s.lessonTrophies.length;
}

// ---- the question panel ----------------------------------------------------------------------

function renderQuestion() {
  const box = $('#question');
  const q = state.question;
  if (box.contains(document.activeElement) && ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) {
    // Don't wipe what the teacher is typing: only the counter moves.
    if ($('#q-count') && q) $('#q-count').textContent = `${q.submitted}/${q.online}`;
    return;
  }
  box.innerHTML = '';
  const onThisSlide = state.questions.filter((x) => x.slide === state.screen.slide);
  if ((!q || q.status === 'revealed') && onThisSlide.length) box.append(h('strong', {}, `Questions on slide ${state.screen.slide}`), questionList(onThisSlide));
  box.append(q ? liveQuestion(q) : h('p', { class: 'quiet' }, 'No question open. Pick one from the slide list, this slide, or ask one now.'));
  box.append(h('details', {}, h('summary', {}, `All lesson questions (${state.questions.length})`), questionList(state.questions)), quickQuestion());
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

/** A question typed on the spot: written, zones (a poll), or an opinion line. */
function quickQuestion() {
  const prompt = h('input', { type: 'text', placeholder: 'Ask a quick question now…' });
  const kind = h('select', {}, h('option', { value: 'text' }, 'Written answer'), h('option', { value: 'choice' }, 'Zones (a poll)'), h('option', { value: 'line' }, 'Opinion line'));
  const extra = h('input', { type: 'text', hidden: true });
  kind.onchange = () => {
    extra.hidden = kind.value === 'text';
    extra.placeholder = kind.value === 'choice' ? 'Options, separated by |' : 'The two ends, separated by |  (default: Disagree | Agree)';
  };
  const ask = () => {
    const text = prompt.value.trim();
    if (!text) return;
    const list = extra.value.split('|').map((x) => x.trim()).filter(Boolean);
    const def = { kind: kind.value, title: 'Quick question', prompt: text, scored: false };
    if (kind.value === 'choice') Object.assign(def, { options: list, correct: null });
    if (kind.value === 'line') def.labels = list;
    if (kind.value === 'choice' && list.length < 2) return alertBar('Give at least two options, separated by |');
    act('open', { def });
  };
  return h('details', {}, h('summary', {}, 'Ask a quick question'), h('div', { class: 'row' }, prompt), h('div', { class: 'row' }, kind, extra, h('button', { class: 'btn', onclick: ask }, 'Ask')));
}

function liveQuestion(q) {
  const s = state;
  const wrap = h('div');
  wrap.append(
    h('div', { class: 'qhead' }, h('h2', {}, q.title), h('span', { class: 'chip info' }, q.status), h('span', { class: 'big-count', id: 'q-count' }, `${q.submitted}/${q.online}`), h('span', { class: 'quiet' }, 'handed in'), h('span', { class: 'quiet', id: 'q-elapsed' })),
  );
  const open = q.status === 'open';
  const writing = q.waitingFor.length;
  if (open && writing) wrap.append(h('p', { class: 'waiting' }, `Waiting for: ${q.waitingFor.join(', ')}`));
  if (open && !writing && q.online > 0) wrap.append(h('p', { class: 'ok' }, 'Everyone is in. You can close.'));
  if (q.fullHouse) wrap.append(h('p', { class: 'ok' }, 'Everyone handed in: +10 each at the reveal.'));

  const row = h('div', { class: 'row' });
  // The submit gate: closing early is possible, but it has to be said out loud.
  if (open && writing) row.append(h('button', { class: 'btn hot', onclick: () => act('close', { force: true }) }, `Close anyway (${writing} still writing)`));
  if (open && !writing) row.append(h('button', { class: 'btn go', onclick: () => act('close') }, 'Close'));
  if (!open && q.needsAi) {
    const label = s.scoring ? `Scoring with ${s.aiMode}…` : q.status === 'revealed' ? 'Score retries' : `Suggest scores (${s.aiMode})`;
    row.append(h('button', { class: 'btn gold', disabled: s.scoring, onclick: () => act('score') }, label));
  }
  if (!open) row.append(h('button', { class: 'btn go', onclick: () => act('reveal') }, q.status === 'revealed' ? 'Reveal again' : 'Reveal to everyone'));
  if (q.status === 'revealed' && q.hasExample) row.append(h('button', { class: `btn ${q.exampleShown ? 'on' : ''}`, title: 'Put the sound answer from the lesson on the projector', onclick: () => act('example', { on: !q.exampleShown }) }, 'Show a sound answer'));
  if (s.answers.length) row.append(h('button', { class: 'btn', title: 'Put a random student on the spot, with their answer on the projector', onclick: () => act('pick') }, 'Pick someone'));
  if (s.spotlight) row.append(h('button', { class: 'btn', onclick: () => act('spotlight', { pid: null }) }, `Clear spotlight (${s.spotlight.name})`));
  if (open) {
    // a soft countdown on every screen; nothing closes by itself
    row.append(h('span', { class: 'quiet' }, 'Timer'));
    for (const m of [1, 2, 3, 5]) row.append(h('button', { class: 'btn small', title: `Show a ${m} minute countdown`, onclick: () => act('timer', { seconds: m * 60 }) }, `${m}m`));
    if (q.timerEndsAt) row.append(h('button', { class: 'btn small', onclick: () => act('timer', { seconds: 0 }) }, 'off'));
  }
  row.append(h('button', { class: 'btn small', onclick: () => act('seat', { seconds: seatSeconds() }) }, 'Back to seats'));
  wrap.append(row);

  if (q.scoringError) wrap.append(h('p', { class: 'err' }, `Scoring failed: ${q.scoringError}. You can score by hand below, or try again.`));
  if (q.missed.length) wrap.append(h('p', { class: 'missed' }, 'Missed most: ', q.missed.slice(0, 4).map((m) => h('span', { class: 'chip warn' }, `${m.concept} ×${m.n}`))));
  wrap.append(statsView(q));

  const picks = s.picks || { good: [], check: [] };
  wrap.append(h('ul', { class: 'answers' }, s.answers.map((a) => answerItem(q, a, picks))));
  return wrap;
}

/** How the class answered: a bar per option, per grid row, or along the opinion line. */
function statsView(q) {
  const box = h('div', { class: 'stats' });
  const bar = (n, of) => h('span', { class: 'bar', style: `width:${(n / Math.max(1, of)) * 120}px` });
  if (q.kind === 'choice') {
    const total = q.counts.reduce((x, y) => x + y, 0);
    const correct = isSet(q.correct) ? [].concat(q.correct) : [];
    q.order.forEach((opt, pos) => box.append(h('div', {}, h('b', {}, `${LETTERS[pos]} `), correct.includes(opt) ? h('span', { class: 'ok' }, '✓ ') : '', `${q.options[opt].slice(0, 70)} · ${q.counts[opt]}`, bar(q.counts[opt], total))));
  }
  if (q.kind === 'grid')
    q.rows.forEach((row, i) => {
      const right = q.rowCorrect[i] || [];
      box.append(h('div', {}, `${i + 1}. ${row.text.slice(0, 60)} → `, (row.options || q.options).map((o, j) => h('span', { class: right.includes(j) ? 'ok' : '' }, `${o}: ${q.rowStats[i][j]}  `))));
    });
  if (q.kind === 'line') {
    const total = q.spread.reduce((x, y) => x + y, 0);
    box.append(h('div', {}, `${q.labels[0]} ◀ `, q.spread.map((n) => h('span', {}, bar(n, total), ` ${n} `)), `▶ ${q.labels[1]}`, isSet(q.average) ? ` · average ${q.average}/100` : ''));
  }
  return box;
}

/** One student's answer: what they wrote, the flags, and the 0–3 score with its feedback. */
function answerItem(q, a, picks) {
  const def = q.def;
  const good = picks.good.includes(a.pid);
  const check = picks.check.includes(a.pid);
  const li = h('li', { class: `answer ${good ? 'pick-good' : ''} ${check ? 'pick-check' : ''}` });
  const onSpot = state.spotlight?.pid === a.pid;
  li.append(
    h(
      'div',
      { class: 'who' },
      h('span', {}, a.name),
      a.attempt > 1 ? h('span', { class: 'chip good' }, `retry ${a.attempt}`) : '',
      good ? h('span', { class: 'chip good' }, 'worth showing') : '',
      h('span', { class: 'grow' }),
      isSet(a.points) ? h('span', { class: 'points' }, `${a.points} pts`) : '',
      h('button', { class: `btn small ${onSpot ? 'on' : ''}`, title: 'Put this answer on the projector; the student walks to the front', onclick: () => act('spotlight', { pid: onSpot ? null : a.pid }) }, 'Spotlight'),
    ),
  );

  const tick = (ok) => (ok === true ? h('span', { class: 'ok' }, ' ✓') : ok === false ? h('span', { class: 'no' }, ' ✗') : '');
  const body = h('div', { class: 'body' });
  if (def.kind === 'choice' && isSet(a.choice)) {
    const verdict = a.auto?.choice === 'partial' ? ' ½' : tick({ right: true, wrong: false }[a.auto?.choice]);
    body.append(h('div', {}, h('b', {}, LETTERS[q.order.indexOf(a.choice)]), ` ${def.options[a.choice].slice(0, 90)}`, verdict));
    if (def.reasons && isSet(a.reason)) body.append(h('div', { class: 'quiet' }, `Reason: ${def.reasons.options[a.reason]}`, tick(a.auto?.reason)));
  }
  if (def.kind === 'grid' && a.grid)
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
  if (def.kind === 'line' && isSet(a.value)) body.append(h('div', {}, `Stands at ${a.value}/100`));
  if (a.text) body.append(h('div', { html: marksToHtml(a.text) }));
  li.append(body);
  if (a.flags.length) li.append(h('div', {}, a.flags.map((f) => h('span', { class: `chip ${f.level}` }, f.label))));

  if (q.needsAi) {
    const ai = a.ai || {};
    const feedback = h('textarea', { placeholder: 'Feedback to the student (optional)' });
    feedback.value = ai.feedback || '';
    const setScore = (score) => act('set-score', { pid: a.pid, score, feedback: feedback.value });
    feedback.addEventListener('change', () => setScore(ai.score ?? 0));
    const by = !a.ai ? 'Not scored yet' : ai.edited ? 'Your score' : `Suggested by ${ai.by}`;
    li.append(
      h(
        'div',
        { class: 'ai' },
        h('div', { class: 'row' }, h('span', { class: 'quiet' }, by), h('span', { class: 'scorebtns' }, [0, 1, 2, 3].map((n) => h('button', { class: `btn small ${ai.score === n ? 'on' : ''}`, onclick: () => setScore(n) }, n))), ai.missed ? h('span', { class: 'chip warn' }, `missed: ${ai.missed}`) : ''),
        feedback,
      ),
    );
  }
  return li;
}
