import { $, h, post, connect, screenFrame } from './common.js';
import { Room } from './room.js';
import { avatarCanvas } from './sprites.js';
import { LETTERS } from './world.js';
import { marksToHtml } from './marks.js';

const key = new URLSearchParams(location.search).get('key') || '';
const act = (action, body = {}) => post(`/api/teacher/${action}?key=${encodeURIComponent(key)}`, body).catch((e) => alertBar(e.message));
let state = null;

const room = new Room($('#mini'));
room.showNames = false;
const notes = screenFrame($('#notes'));

function alertBar(msg) {
  const q = $('#question');
  const bar = h('p', { class: 'err' }, msg);
  q.prepend(bar);
  setTimeout(() => bar.remove(), 5000);
}

$('#open-screen').href = `/screen?key=${encodeURIComponent(key)}`;
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => act('mode', { mode: b.dataset.mode })));
$('#seat').onclick = (e) => {
  if (e.target.tagName === 'INPUT') return;
  act('seat', { seconds: Number($('#seat-s').value) || 20 });
};
$('#share').onclick = () => $('#url').value.trim() && act('url', { url: $('#url').value.trim() });
$('#prev').onclick = () => go((state?.screen.slide || 1) - 1);
$('#next').onclick = () => go((state?.screen.slide || 0) + 1);
$('#cue').onclick = () => act('cue');
$('#goto').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') go(Number(e.target.value));
});
const go = (n) => act('slide', { slide: n });

addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') (e.preventDefault(), $('#next').click());
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') (e.preventDefault(), $('#prev').click());
  if (e.key.toLowerCase() === 'e') $('#cue').click();
});

connect(
  { role: 'teacher', key },
  {
    onState: (s) => {
      state = s;
      room.setState(s);
      render();
    },
    onPos: (list) => room.setPositions(list),
    onGone: () => alertBar('Wrong teacher key: use the link printed when the server started.'),
    onStatus: (ok) => {
      $('#conn').textContent = ok ? 'live' : 'reconnecting…';
      $('#conn').style.color = ok ? 'var(--good)' : 'var(--warn)';
    },
  },
);
fetch('/api/info')
  .then((r) => r.json())
  .then((i) => ($('#join-url').textContent = i.studentUrl));

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

// ---- rendering ---------------------------------------------------------------------
let slidesSig = '';
function render() {
  const s = state;
  $('#lesson').textContent = s.lessonTitle;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
  $('#seat').classList.toggle('on', s.mode === 'seating');
  if (s.notesUrl && s.screen.slide) notes.update({ screen: s.screen }, s.notesUrl);
  $('#notes-box').hidden = !s.notesUrl;
  renderSlides();
  renderQuestion();
  renderPlayers();
  renderBoard();
}

function renderSlides() {
  const s = state;
  const list = $('#slide-list');
  const sig = JSON.stringify([s.slides.length, s.questions.map((q) => q.status + q.answers)]);
  if (sig !== slidesSig) {
    slidesSig = sig;
    list.innerHTML = '';
    for (const sl of s.slides) {
      const qs = s.questions.filter((q) => q.slide === Number(sl.id));
      const li = h(
        'li',
        { 'data-n': sl.n, title: sl.title },
        h('span', { class: 'n' }, sl.n),
        h('span', {}, h('span', { class: `k ${sl.mode}` }, sl.mode === 'work' ? 'TASK ' : sl.mode === 'gate' ? 'BREAK ' : ''), sl.title || sl.seg),
      );
      if (qs.length)
        li.append(
          h(
            'div',
            { class: 'qs' },
            qs.map((q) =>
              h(
                'button',
                {
                  class: `btn small ${q.status === 'revealed' ? 'go' : q.status ? 'gold' : ''}`,
                  title: 'Show this slide and open the question',
                  onclick: (e) => {
                    e.stopPropagation();
                    go(sl.n).then(() => act('open', { key: q.key }));
                  },
                },
                `▶ ${q.title.split('·').pop().trim()}${q.answers ? ` (${q.answers})` : ''}`,
              ),
            ),
          ),
        );
      li.onclick = () => go(sl.n);
      list.append(li);
    }
  }
  list.querySelectorAll('li').forEach((li) => {
    const cur = Number(li.dataset.n) === s.screen.slide;
    if (cur && !li.classList.contains('cur')) li.scrollIntoView({ block: 'nearest' });
    li.classList.toggle('cur', cur);
  });
  $('#goto').placeholder = s.screen.slide || '';
  $('#goto').max = s.slides.length;
}

function renderPlayers() {
  const ps = [...state.players].sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
  $('#count').textContent = `${ps.filter((p) => p.online).length} online`;
  const ul = $('#players');
  ul.innerHTML = '';
  for (const p of ps)
    ul.append(
      h(
        'li',
        { class: p.online ? '' : 'off' },
        avatarCanvas(p.avatar, 1),
        h('span', { class: 'grow' }, p.name),
        h('span', { class: 'points' }, p.points),
        h('button', { class: 'btn small', title: 'Remove from the room', onclick: () => confirmKick(p) }, '×'),
      ),
    );
}
function confirmKick(p) {
  const b = h('span', {}, ` Remove ${p.name}? `, h('button', { class: 'btn small hot', onclick: () => act('kick', { pid: p.id }) }, 'Yes'));
  alertBar('');
  $('#question').prepend(b);
  setTimeout(() => b.remove(), 4000);
}

function renderBoard() {
  const b = state.board;
  const el = $('#board');
  el.innerHTML = '';
  el.append(h('strong', {}, 'Top 5'), h('ol', {}, b.top.map((p) => h('li', {}, `${p.name} · `, h('span', { class: 'points' }, p.points)))));
  if (b.improved.length) el.append(h('strong', {}, 'Improved'), h('ul', {}, b.improved.map((p) => h('li', {}, `${p.name} ×${p.improved}`))));
}

// ---- the question panel ------------------------------------------------------------------
function renderQuestion() {
  const box = $('#question');
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') {
    const c = $('#q-count');
    if (c && state.question) c.textContent = `${state.question.submitted}/${state.question.online}`;
    return; // don't wipe what the teacher is typing
  }
  box.innerHTML = '';
  const s = state;
  const q = s.question;
  const slideQs = s.questions.filter((x) => x.slide === s.screen.slide);

  if (!q || q.status === 'revealed') {
    if (slideQs.length) {
      box.append(h('strong', {}, `Questions on slide ${s.screen.slide}`));
      box.append(questionList(slideQs));
    }
  }
  if (q) box.append(liveQuestion(q));
  else box.append(h('p', { class: 'quiet' }, 'No question open. Pick one from the slide list, this slide, or ask one now.'));

  const all = h('details', {}, h('summary', {}, `All lesson questions (${s.questions.length})`), questionList(s.questions));
  box.append(all, quickQuestion());
}

function questionList(qs) {
  return h(
    'ul',
    { class: 'qlist' },
    qs.map((q) =>
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

function quickQuestion() {
  const prompt = h('input', { type: 'text', placeholder: 'Ask a quick question now…' });
  const opts = h('input', { type: 'text', placeholder: 'Options for zones, separated by | (leave empty for a written answer)' });
  const b = h('button', { class: 'btn' }, 'Ask');
  b.onclick = () => {
    const text = prompt.value.trim();
    if (!text) return;
    const options = opts.value.split('|').map((x) => x.trim()).filter(Boolean);
    const def = options.length
      ? { kind: 'choice', title: 'Quick question', prompt: text, options, correct: null, scored: false }
      : { kind: 'text', title: 'Quick question', prompt: text, rubric: [] };
    act('open', { def });
  };
  return h('details', {}, h('summary', {}, 'Ask a quick question'), h('div', { class: 'row' }, prompt), h('div', { class: 'row' }, opts, b));
}

function liveQuestion(q) {
  const s = state;
  const wrap = h('div');
  const def = q.def;
  const needsAi = def.scored && (def.kind === 'text' || (def.kind === 'choice' && def.text));
  wrap.append(
    h(
      'div',
      { class: 'qhead' },
      h('h2', {}, q.title),
      h('span', { class: 'chip info' }, q.status),
      h('span', { class: 'big-count', id: 'q-count' }, `${q.submitted}/${q.online}`),
      h('span', { class: 'quiet' }, 'handed in'),
    ),
  );
  if (q.status === 'open' && q.waitingFor.length) wrap.append(h('p', { class: 'waiting' }, `Waiting for: ${q.waitingFor.join(', ')}`));
  if (q.status === 'open' && q.online > 0 && q.submitted >= q.online) wrap.append(h('p', { class: 'ok' }, 'Everyone is in. You can close.'));

  const row = h('div', { class: 'row' });
  if (q.status === 'open') row.append(h('button', { class: 'btn hot', onclick: () => act('close') }, 'Close'));
  if (needsAi && q.status !== 'open')
    row.append(
      h(
        'button',
        { class: 'btn gold', disabled: s.scoring, onclick: () => act('score') },
        s.scoring ? `Scoring with ${s.aiMode}…` : q.status === 'revealed' ? 'Score retries' : `Suggest scores (${s.aiMode})`,
      ),
    );
  if (q.status !== 'open') row.append(h('button', { class: 'btn go', onclick: () => act('reveal') }, q.status === 'revealed' ? 'Reveal again' : 'Reveal to everyone'));
  if (s.spotlight) row.append(h('button', { class: 'btn', onclick: () => act('spotlight', { pid: null }) }, 'Clear spotlight'));
  row.append(h('button', { class: 'btn small', onclick: () => act('seat', { seconds: Number($('#seat-s').value) || 20 }) }, 'Back to seats'));
  wrap.append(row);
  if (q.scoringError) wrap.append(h('p', { class: 'err' }, `Scoring failed: ${q.scoringError}. You can score by hand below, or try again.`));

  wrap.append(statsView(q));

  const picks = s.picks || { good: [], check: [] };
  const ul = h('ul', { class: 'answers' });
  for (const a of s.answers || []) ul.append(answerItem(q, def, a, picks, needsAi));
  wrap.append(ul);
  return wrap;
}

function statsView(q) {
  const box = h('div', { class: 'stats' });
  if (q.kind === 'choice' && q.counts) {
    const total = q.counts.reduce((x, y) => x + y, 0) || 1;
    const correct = q.correct === null || q.correct === undefined ? [] : [].concat(q.correct);
    q.order.forEach((opt, pos) => {
      box.append(
        h(
          'div',
          {},
          h('b', {}, `${LETTERS[pos]} `),
          correct.includes(opt) ? h('span', { class: 'ok' }, '✓ ') : '',
          `${q.options[opt].slice(0, 70)} · ${q.counts[opt]}`,
          h('span', { class: 'bar', style: `width:${(q.counts[opt] / total) * 120}px` }),
        ),
      );
    });
  }
  if (q.kind === 'grid' && q.rowStats) {
    q.rows.forEach((r, i) => {
      const opts = r.options || q.options;
      const right = q.rowCorrect[i] || [];
      box.append(
        h('div', {}, `${i + 1}. ${r.text.slice(0, 60)} → `, opts.map((o, j) => h('span', { class: right.includes(j) ? 'ok' : '' }, `${o}: ${q.rowStats[i][j]}  `))),
      );
    });
  }
  return box;
}

function answerItem(q, def, a, picks, needsAi) {
  const cls = ['answer'];
  if (picks.good.includes(a.pid)) cls.push('pick-good');
  if (picks.check.includes(a.pid)) cls.push('pick-check');
  const li = h('li', { class: cls.join(' ') });
  li.append(
    h(
      'div',
      { class: 'who' },
      h('span', {}, a.name),
      a.attempt > 1 ? h('span', { class: 'chip good' }, `retry ${a.attempt}`) : '',
      picks.good.includes(a.pid) ? h('span', { class: 'chip good' }, 'worth showing') : '',
      h('span', { class: 'grow' }),
      a.points !== null ? h('span', { class: 'points' }, `${a.points} pts`) : '',
      h('button', { class: 'btn small', title: 'Put this answer on the screen', onclick: () => act('spotlight', { pid: a.pid }) }, 'Spotlight'),
    ),
  );
  const body = h('div', { class: 'body' });
  if (def.kind === 'choice' && a.choice !== undefined && a.choice !== null) {
    const pos = q.order.indexOf(a.choice);
    const mark = a.auto?.choice === 'right' ? h('span', { class: 'ok' }, ' ✓') : a.auto?.choice === 'wrong' ? h('span', { class: 'no' }, ' ✗') : a.auto?.choice === 'partial' ? ' ½' : '';
    body.append(h('div', {}, h('b', {}, LETTERS[pos]), ` ${def.options[a.choice].slice(0, 90)}`, mark));
    if (def.reasons && a.reason !== null && a.reason !== undefined)
      body.append(h('div', { class: 'quiet' }, `Reason: ${def.reasons.options[a.reason]}`, a.auto?.reason === true ? h('span', { class: 'ok' }, ' ✓') : a.auto?.reason === false ? h('span', { class: 'no' }, ' ✗') : ''));
  }
  if (def.kind === 'grid' && a.grid)
    body.append(
      h(
        'div',
        {},
        a.grid.map((g, i) => {
          const opts = def.rows[i].options || def.options;
          const ok = a.auto?.rows?.[i];
          return h('span', { class: ok === true ? 'ok' : ok === false ? 'no' : '' }, `${i + 1}:${g === null ? '—' : opts[g].split(' ')[0]}  `);
        }),
      ),
    );
  if (a.text) body.append(h('div', { html: marksToHtml(a.text) }));
  li.append(body);
  if (a.flags.length) li.append(h('div', {}, a.flags.map((f) => h('span', { class: `chip ${f.level}` }, f.label))));

  if (needsAi) {
    const ai = a.ai || {};
    const fb = h('textarea', { placeholder: 'Feedback to the student (optional)' });
    fb.value = ai.feedback || '';
    fb.addEventListener('change', () => act('set-score', { pid: a.pid, score: ai.score ?? 0, feedback: fb.value }));
    const btns = h(
      'span',
      { class: 'scorebtns' },
      [0, 1, 2, 3].map((n) => h('button', { class: `btn small ${ai.score === n ? 'on' : ''}`, onclick: () => act('set-score', { pid: a.pid, score: n, feedback: fb.value }) }, n)),
    );
    li.append(
      h(
        'div',
        { class: 'ai' },
        h('div', { class: 'row' }, h('span', { class: 'quiet' }, a.ai ? (ai.edited ? 'Your score' : `Suggested by ${ai.by}`) : 'Not scored yet'), btns, ai.missed ? h('span', { class: 'chip warn' }, `missed: ${ai.missed}`) : ''),
        fb,
      ),
    );
  }
  return li;
}
