// The teacher page: drive the slides, set the room's mode, keep an eye on the class.
// The live question, stats and scoring panel lives in teacher-question.js.

import { $, h, post, connect, screenFrame, classBar, clock } from './common.js';
import { CLASS_LEVELS } from './shared/fun.js';
import { Room } from './room.js';
import { avatarCanvas } from './sprites.js';
import { createQuestionPanel } from './teacher-question.js';

const key = new URLSearchParams(location.search).get('key') || '';
const withKey = (path) => `${path}?key=${encodeURIComponent(key)}`;
let state = null;

const room = new Room($('#mini'));
room.showNames = false;
const notes = screenFrame($('#notes'));

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
    h(
      'button',
      {
        class: 'btn small hot',
        onclick: () => {
          bar.remove();
          act(action, { ...body, force: true });
        },
      },
      'Move on anyway',
    ),
    h('button', { class: 'btn small', onclick: () => bar.remove() }, 'Wait'),
  );
}

const seatSeconds = () => Number($('#seat-s').value) || 20;
const questionPanel = createQuestionPanel({ act, alertBar, seatSeconds });

connect(
  { role: 'teacher', key },
  {
    onState(s) {
      state = s;
      room.setState(s);
      render();
    },
    onPos: (list) => room.setPositions(list),
    onBall: ([x, y]) => room.setBall(x, y),
    onDesk: (d) => questionPanel.deskText(d),
    onFx: (ev) => room.fx(ev),
    onGone: () => alertBar('Wrong teacher key: use the link printed when the server started.'),
    onStatus(ok) {
      $('#conn').textContent = ok ? 'live' : 'reconnecting…';
      $('#conn').style.color = ok ? 'var(--good)' : 'var(--warn)';
    },
  },
);

fetch('/api/info')
  .then((r) => r.json())
  .then((info) => {
    $('#join-url').textContent = info.studentUrl;
  });

// ---- the fixed controls ----------------------------------------------------------------

const go = (n) => act('slide', { slide: n });

$('#open-screen').href = withKey('/screen');
$('#report').href = `${withKey('/report')}&names`;
document.querySelectorAll('[data-mode]').forEach((b) => {
  b.onclick = () => act('mode', { mode: b.dataset.mode });
});
$('#seat').onclick = (e) => {
  if (e.target.tagName !== 'INPUT') act('seat', { seconds: seatSeconds() });
};
$('#share').onclick = () => {
  const url = $('#url').value.trim();
  if (url) act('url', { url });
};
$('#prev').onclick = () => go((state?.screen.slide || 1) - 1);
$('#next').onclick = () => go((state?.screen.slide || 0) + 1);
$('#cue').onclick = () => act('cue');
$('#goto').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') go(Number(e.target.value));
});
$('#finale').onclick = () => act('finale', { on: !state?.finale });
$('#show-asks').onclick = () => act('show-asks', { on: !state?.showAsks });
$('#show-join').onclick = () => act('show-join', { on: !state?.showJoin });

// Arrow keys and E drive the slides, like in the deck itself.
addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    e.preventDefault();
    $('#next').click();
  }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault();
    $('#prev').click();
  }
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
  $('#show-join').classList.toggle('on', !!s.showJoin);
  if (s.notesUrl && s.screen.slide) notes.update({ screen: s.screen }, s.notesUrl);
  $('#notes-box').hidden = !s.notesUrl;
  // Students who pressed "I'm lost" on this slide (they clear it with "Got it").
  $('#lost').hidden = !s.lost.length;
  $('#lost').textContent = s.lost.length ? `? ${s.lost.length} lost: ${s.lost.join(', ')}` : '';
  renderRooms();
  renderSlides();
  questionPanel.render(s);
  renderPlayers();
  renderBoard();
  renderAsks();
  renderGoal();
}

/** One button per room. Pressing one opens the door: the class has a few seconds to walk through. */
function renderRooms() {
  const s = state;
  const box = $('#rooms');
  box.innerHTML = '';
  box.append(h('strong', {}, 'Door to'));
  for (const r of s.rooms) {
    const here = r.id === s.room;
    const opening = s.door?.to === r.id;
    box.append(
      h(
        'button',
        { class: `btn small ${here ? 'on' : ''}`, disabled: here, onclick: () => act('room', { room: r.id }) },
        opening ? `${r.name} (door open…)` : r.name,
      ),
    );
  }
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
      const li = h(
        'li',
        { 'data-n': slide.n, title: slide.title, onclick: () => go(slide.n) },
        h('span', { class: 'n' }, slide.n),
        h('span', {}, h('span', { class: `k ${slide.mode}` }, kind), slide.title || slide.seg),
      );
      // Questions tied to this slide: one click shows the slide and opens the question.
      const questions = s.questions.filter((q) => q.slide === Number(slide.id));
      if (questions.length) {
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
              return h(
                'button',
                { class: `btn small ${look}`, title: 'Show this slide and open the question', onclick: open },
                `▶ ${q.title.split('·').pop().trim()}${q.answers ? ` (${q.answers})` : ''}`,
              );
            }),
          ),
        );
      }
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
    const remove = () => {
      if (confirm(`Remove ${p.name} from the room?`)) act('kick', { pid: p.id });
    };
    const rejoin = !p.online
      ? h(
          'button',
          {
            class: `btn small ${p.rejoinOpen ? 'on' : ''}`,
            title: p.rejoinOpen
              ? 'Seat unlocked: student can rejoin with this exact name'
              : 'Unlock seat so this student can rejoin from another browser without losing points',
            onclick: () => act('allow-rejoin', { pid: p.id, on: !p.rejoinOpen }),
          },
          '↺',
        )
      : '';
    ul.append(
      h(
        'li',
        { class: p.online ? '' : 'off' },
        avatarCanvas(p.avatar, 1),
        h('span', { class: 'grow' }, p.name),
        h('span', { class: 'points' }, p.points),
        rejoin,
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
  el.append(
    h('strong', {}, 'Top 5'),
    h('ol', {}, b.top.map((p) => h('li', {}, `${p.name} · `, h('span', { class: 'points' }, p.points)))),
  );
  if (b.improved.length) {
    el.append(h('strong', {}, 'Improved'), h('ul', {}, b.improved.map((p) => h('li', {}, `${p.name} ×${p.improved}`))));
  }
}

/** Questions students asked. Held ones did not look like a question: post or dismiss them. */
function renderAsks() {
  const s = state;
  $('#show-asks').classList.toggle('on', s.showAsks);
  $('#ask-count').textContent = s.asks.length ? `(${s.asks.length})` : '';
  const ul = $('#asks');
  ul.innerHTML = '';
  if (!s.asks.length) ul.append(h('li', { class: 'quiet' }, 'None yet. Students ask with the Ask button.'));
  const status = (it, to, label, title) =>
    h('button', { class: 'btn small', title, onclick: () => act('ask-status', { id: it.id, status: to }) }, label);
  for (const it of [...s.asks].sort((a, b) => b.votes - a.votes)) {
    const held = it.status === 'held';
    ul.append(
      h(
        'li',
        { class: held ? 'held' : '' },
        h(
          'div',
          {},
          held ? h('span', { class: 'chip warn' }, 'held') : h('span', { class: 'chip good' }, `▲ ${it.votes}`),
          it.slide ? h('span', { class: 'chip info' }, `s${it.slide}`) : '',
          it.text,
          h('span', { class: 'quiet' }, ` · ${it.name}`),
        ),
        h(
          'div',
          { class: 'row' },
          held ? status(it, 'posted', 'Post', 'Put it on the board') : status(it, 'answered', 'Answered', 'Take it off the board'),
          status(it, 'hidden', held ? 'Dismiss' : 'Hide', 'Remove it'),
        ),
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
  for (const t of s.lessonTrophies) {
    box.append(
      h(
        'li',
        {},
        h('span', { class: 'grow' }, t.name),
        t.earned
          ? h('span', { class: 'chip good' }, 'on the shelf')
          : h(
              'button',
              {
                class: 'btn small',
                title: t.after ? `Earned when “${t.after}” is revealed, or now` : 'Award it now',
                onclick: () => act('trophy', { id: t.id }),
              },
              'Award',
            ),
      ),
    );
  }
  $('#trophies-box').hidden = !s.lessonTrophies.length;
}
