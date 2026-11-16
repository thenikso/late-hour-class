// The projector view: the room, the shared screen, and the big moments
// (countdowns, the hand-in counter, results and the spotlight).

import { $, h, post, connect, screenFrame, placeFrame, sound, countTo, bump, celebrate, clock, classBar } from './common.js';
import { Room, ROOM_SIZE } from './room.js';
import { avatarCanvas } from './sprites.js';
import { LETTERS } from './world.js';
import { marksToHtml } from './marks.js';

const key = new URLSearchParams(location.search).get('key') || '';
const room = new Room($('#room'));
const frame = screenFrame($('#screen'));
let state = null;
let full = false;
let wallSig = '';
let renderedAt = performance.now();

fetch('/api/info')
  .then((r) => r.json())
  .then((i) => ($('#join-url').textContent = i.studentUrl));

$('#sound').onclick = () => {
  if (sound.on) sound.on = false;
  else sound.enable();
  $('#sound').textContent = sound.on ? 'Sound on' : 'Sound off';
};
$('#full').onclick = () => {
  full = !full;
  layout();
};
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'f') $('#full').click();
});

connect(
  { role: 'screen', key },
  {
    onState: (s) => {
      state = s;
      renderedAt = performance.now();
      room.setState(s);
      render();
    },
    onPos: (list) => room.setPositions(list),
    onBall: ([x, y]) => room.setBall(x, y),
    onFx: (ev) => {
      room.fx(ev);
      if (ev.t === 'level') bigNews(`Class level ${ev.level}!`, ev.text, { count: 200, ms: 4000 });
      if (ev.t === 'trophy') bigNews(`New trophy: ${ev.name}`, ev.text, { count: 120, ms: 3000 });
    },
  },
);

// A game-ready deck on the screen can ask the game for a few things itself, for
// example a button on a slide that opens its question (see game-bridge.js in the
// example). Only the deck inside this page's own screen is listened to, and only
// for the actions listed here.
const DECK_COMMANDS = {
  open: (m) => ({ key: String(m.key) }),
  trophy: (m) => ({ id: String(m.id) }),
  timer: (m) => ({ seconds: Number(m.seconds) }),
  room: (m) => ({ room: String(m.room) }),
};
addEventListener('message', (e) => {
  const message = e.data;
  if (e.source !== $('#screen').contentWindow || message?.type !== 'cge:command' || !state?.screen.slide) return;
  const body = DECK_COMMANDS[message.action]?.(message);
  if (body) post(`/api/teacher/${message.action}?key=${encodeURIComponent(key)}`, body).catch(() => {});
});

/** The class earned something (a room reward, a trophy): say it big, for a few seconds. */
let newsTimer = null;
function bigNews(title, text, confetti) {
  const box = $('#levelup');
  box.innerHTML = '';
  box.append(h('h1', {}, title), h('p', {}, text));
  box.hidden = false;
  celebrate(confetti);
  sound.tune('level');
  clearTimeout(newsTimer);
  newsTimer = setTimeout(() => (box.hidden = true), 6000);
}

function layout() {
  const top = 8;
  room.fit(innerWidth - 16, innerHeight - top - 8);
  const wrap = $('#room-wrap');
  const cw = ROOM_SIZE.W * room.scale;
  wrap.style.left = `${(innerWidth - cw) / 2}px`;
  wrap.style.top = `${top}px`;
  const ifr = $('#screen');
  const big = full || state?.mode === 'present';
  document.body.classList.toggle('present', big && !full);
  document.body.classList.toggle('full', full);
  let r = room.screenRect();
  if (big) {
    const off = (innerWidth - cw) / 2;
    const h0 = full ? innerHeight - 16 : innerHeight - 110;
    r = { left: 8 - off, top: 0, width: innerWidth - 16, height: h0 };
  }
  placeFrame(ifr, r);
}
addEventListener('resize', layout);

const loop = (t) => {
  room.draw(t);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

function render() {
  const s = state;
  frame.update(s, s.deckUrl);
  layout();
  const asking = s.question && s.question.status !== 'revealed' && !['present', 'seating'].includes(s.mode);
  $('#join').hidden = s.mode === 'present' || full || asking;

  const banner = $('#banner');
  banner.hidden = !(s.door || s.mode === 'seating');
  if (!banner.hidden) tick();

  const k = $('#klass');
  k.hidden = s.mode === 'present' || s.mode === 'review' || full || !!s.finale;
  classBar(k, s.klass);

  renderQbar();
  renderWall();
  renderSpot();
  renderAsks();
  renderFinale();
}

// The soft timer on the open question ticks between server updates.
let timeUp = false;
setInterval(() => {
  const q = state?.question;
  const el = $('#qtimer');
  if (!el || !q?.timerEndsAt) return (timeUp = false);
  const left = q.timerEndsAt - (Date.now() + room.skew);
  el.textContent = left > 0 ? clock(left) : "time's up";
  el.classList.toggle('low', left < 15000);
  if (left <= 0 && !timeUp) sound.tune('timeup');
  timeUp = left <= 0;
}, 250);

let finaleSig = '';
function renderFinale() {
  const f = state.finale;
  const box = $('#finale');
  if (!f) {
    box.hidden = true;
    finaleSig = '';
    return;
  }
  const sig = JSON.stringify(f);
  if (sig === finaleSig) return;
  const first = !finaleSig;
  finaleSig = sig;
  box.hidden = false;
  box.innerHTML = '';
  const place = (p, n) => {
    if (!p) return '';
    const pts = h('span', { class: 'points' }, first ? '0' : String(p.points));
    if (first) setTimeout(() => countTo(pts, 0, p.points, 900).then(() => bump(pts)), n === 1 ? 1500 : n === 2 ? 900 : 300);
    return h('div', { class: `place p${n}` }, avatarCanvas(p.avatar, 5, p.hat || 'none'), h('b', {}, p.name), pts, h('div', { class: 'step' }, n));
  };
  const who = (p, extra = '') => h('div', { class: 'who' }, avatarCanvas(p.avatar, 1.5), `${p.name}${extra}`);
  const awards = h('div', { class: 'awards' });
  if (f.improved.length) awards.append(h('div', { class: 'award panel' }, h('h3', {}, 'Improved today'), h('div', { class: 'names' }, f.improved.map((p) => who(p, p.improved > 1 ? ` ×${p.improved}` : '')))));
  if (f.streak.n >= 2)
    awards.append(h('div', { class: 'award panel' }, h('h3', {}, `Handed in ${f.streak.n} in a row`), h('div', { class: 'names' }, f.streak.players.map((p) => who(p))), f.streak.more ? h('div', { class: 'quiet' }, `and ${f.streak.more} more`) : ''));
  const k = state.klass;
  box.append(
    h(
      'div',
      { class: 'inner' },
      h('h1', {}, "That's a wrap!"),
      h('div', { class: 'podium' }, place(f.podium[1], 2), place(f.podium[0], 1), place(f.podium[2], 3)),
      awards,
      h('p', { class: 'together' }, `Together: ${f.answers} answers to ${f.questions} questions · ${k.total} points · class level ${k.level}`),
    ),
  );
  if (first) {
    sound.tune('finale');
    setTimeout(() => celebrate({ count: 260, ms: 5000 }), 1500);
  }
}

let timer = null;
function tick() {
  clearTimeout(timer);
  const endsAt = state?.door ? state.door.endsAt : state?.mode === 'seating' ? state.seatingEndsAt : null;
  if (!endsAt) return;
  const left = Math.max(0, Math.ceil((endsAt - state.serverNow - (performance.now() - renderedAt)) / 1000));
  const banner = $('#banner');
  banner.innerHTML = '';
  banner.append(state.door ? `The door is open: off to the ${state.door.name.toLowerCase()}! ` : 'Take your seat! ', h('span', { class: 'countdown' }, left));
  if (left <= 3 && left > 0) sound.blip(left * 2);
  timer = setTimeout(tick, 1000);
}

let lastCount = -1;
let wasAllIn = false;
function renderQbar() {
  const q = state.question;
  const bar = $('#qbar');
  if (!q || state.mode === 'present' || state.mode === 'seating' || q.status === 'revealed') {
    bar.hidden = true;
    lastCount = -1;
    return;
  }
  bar.hidden = false;
  const allIn = q.status === 'open' && q.online > 0 && q.submitted >= q.online;
  if (allIn && !wasAllIn) {
    // the whole room handed in: a small party, and the team bonus is theirs
    celebrate({ count: 90, ms: 2200 });
    sound.tune('allin');
  }
  wasAllIn = allIn;
  const status = q.status === 'open' ? (allIn ? 'Everyone is in!' : 'handed in') : 'closed · scoring';
  bar.innerHTML = '';
  bar.append(
    h('div', { class: 'text' }, h('h2', {}, q.title), h('p', {}, q.prompt)),
    h('div', { class: `count ${allIn ? 'all-in' : ''}` }, h('span', { id: 'qcount' }, `${q.submitted}/${q.online}`), h('small', {}, status), q.timerEndsAt ? h('span', { class: 'timer', id: 'qtimer' }) : ''),
  );
  if (q.submitted !== lastCount) {
    if (lastCount >= 0) {
      bump($('#qcount'));
      sound.blip(q.submitted % 12);
    }
    lastCount = q.submitted;
  }
}

function renderWall() {
  const q = state.question;
  const wall = $('#wall');
  const board = $('#board');
  if (!q || q.status !== 'revealed' || state.mode !== 'review') {
    wall.hidden = true;
    board.hidden = true;
    wallSig = '';
    return;
  }
  const sig = JSON.stringify([q.key, q.wall?.map((w) => w.points), q.example]);
  if (sig === wallSig) return;
  wallSig = sig;
  wall.hidden = false;
  wall.innerHTML = '';
  wall.append(h('h2', {}, q.title));

  if (q.kind === 'choice' && q.counts) {
    const total = Math.max(1, q.counts.reduce((a, b) => a + b, 0));
    const correct = q.correct === null || q.correct === undefined ? [] : [].concat(q.correct);
    q.order.forEach((opt, pos) =>
      wall.append(
        h(
          'div',
          { class: `stat ${correct.includes(opt) ? 'right' : ''}` },
          h('b', {}, `${LETTERS[pos]} `),
          h('span', { class: 'bar', style: `width:${(q.counts[opt] / total) * 200}px` }),
          `${q.counts[opt]}  ${correct.includes(opt) ? '✓' : ''}`,
          h('div', { class: 'quiet' }, q.options[opt]),
        ),
      ),
    );
  }
  if (q.kind === 'grid' && q.rowStats)
    q.rows.forEach((r, i) => {
      const opts = r.options || q.options;
      const right = q.rowCorrect[i] || [];
      wall.append(
        h(
          'div',
          { class: 'stat' },
          h('div', {}, `${i + 1}. ${r.text}`),
          opts.map((o, j) => h('div', { class: right.includes(j) ? 'stat right' : 'stat' }, h('span', { class: 'bar', style: `width:${q.rowStats[i][j] * 12}px` }), `${o}: ${q.rowStats[i][j]} ${right.includes(j) ? '✓' : ''}`)),
        ),
      );
    });

  if (q.kind === 'bug')
    wall.append(
      h(
        'ol',
        { class: 'code-lines' },
        q.code.split('\n').map((line, i) => h('li', { class: q.correctLines.includes(i + 1) ? 'right' : '' }, h('code', {}, line || ' '), q.lineCounts[i] ? h('b', {}, `  ← ${q.lineCounts[i]}`) : '')),
      ),
    );
  if (q.kind === 'code') q.tests.forEach((test, i) => wall.append(h('div', { class: 'stat right' }, h('span', { class: 'bar', style: `width:${(q.passCounts[i] / Math.max(1, q.submitted)) * 200}px` }), `${q.passCounts[i]} pass · ${test.name}`)));
  if (q.kind === 'line') {
    const most = Math.max(1, ...q.spread);
    wall.append(
      h('div', { class: 'stat' }, h('b', {}, `${q.labels[0]} ◀ … ▶ ${q.labels[1]}`)),
      ...q.spread.map((n, i) => h('div', { class: 'stat' }, h('span', { class: 'quiet' }, `${i * 20}–${i * 20 + 20} `), h('span', { class: 'bar', style: `width:${(n / most) * 200}px` }), String(n))),
    );
  }
  if (q.example) wall.append(h('div', { class: 'card example' }, h('div', { class: 'who' }, 'One sound answer'), h('div', {}, q.example)));

  const hasText = (q.wall || []).some((w) => w.text);
  let i = 0;
  for (const w of q.wall || []) {
    if (q.kind === 'line' || q.kind === 'bug') break; // the floor, or the code above, is the result
    if (!hasText && i >= 8) break;
    const pts = h('span', { class: 'points' }, '0');
    const card = h(
      'div',
      { class: 'card' },
      h('div', { class: 'who' }, avatarCanvas(w.avatar, 1.5), h('span', { class: 'grow' }, w.name), w.improved ? h('span', { class: 'improved-badge' }, 'IMPROVED') : '', pts),
      w.text ? (q.kind === 'code' ? h('pre', { class: 'code' }, w.text) : h('div', { html: marksToHtml(w.text) })) : '',
    );
    wall.append(card);
    setTimeout(() => countTo(pts, 0, w.points, 600).then(() => (bump(pts), sound.blip(5 + (i % 7)))), 200 + i * 180);
    i++;
  }

  board.hidden = false;
  board.innerHTML = '';
  const b = state.board;
  board.append(h('h3', {}, 'Top 5'), h('ol', {}, b.top.map((p) => h('li', {}, `${p.name} `, h('span', { class: 'points' }, p.points)))));
  if (b.improved.length) board.append(h('h3', {}, 'Improved today'), h('ul', {}, b.improved.map((p) => h('li', {}, `${p.name} ×${p.improved}`))));
  if (q.fullHouse) board.append(h('p', { class: 'ok' }, 'Everyone handed in: +10 each'));
  const bar = h('div', { class: 'classbar' });
  board.append(bar);
  classBar(bar, state.klass);
}

function renderSpot() {
  const sp = state.spotlight;
  const box = $('#spot');
  if (!sp) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = '';
  box.append(
    h('div', { class: 'q' }, sp.question),
    h('h2', {}, h('span', {}, avatarCanvas(sp.avatar, 2)), ` ${sp.name}`),
    sp.choice ? h('div', { class: 'q' }, `Chose: ${sp.choice}`) : '',
    sp.text ? (sp.code ? h('pre', { class: 'code' }, sp.text) : h('div', { html: marksToHtml(sp.text) })) : '',
  );
}

/** The questions students asked the teacher, most wanted first (when the teacher puts them up). */
function renderAsks() {
  const asks = state.asks;
  const box = $('#asks');
  box.hidden = !asks || !!state.finale;
  if (box.hidden) return;
  box.innerHTML = '';
  box.append(
    h('h2', {}, 'Your questions'),
    asks.length ? h('ol', {}, asks.map((it) => h('li', {}, h('span', { class: 'votes' }, `▲ ${it.votes}`), h('div', {}, it.text, h('div', { class: 'who' }, it.name))))) : h('p', { class: 'quiet' }, 'No questions yet. Use the Ask button on your screen.'),
  );
}
