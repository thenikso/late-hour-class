// The projector view: the room, the shared screen, and the big moments
// (countdowns, the hand-in counter, results and the spotlight).

import { $, h, connect, screenFrame, placeFrame, sound, countTo, bump } from './common.js';
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
  },
);

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
  if (s.mode === 'seating') {
    banner.hidden = false;
    tick();
  } else banner.hidden = true;

  renderQbar();
  renderWall();
  renderSpot();
}

let timer = null;
function tick() {
  clearTimeout(timer);
  if (!state || state.mode !== 'seating') return;
  const left = Math.max(0, Math.ceil((state.seatingEndsAt - state.serverNow - (performance.now() - renderedAt)) / 1000));
  $('#banner').innerHTML = `Take your seat! <span class="countdown">${left}</span>`;
  if (left <= 3 && left > 0) sound.blip(left * 2);
  timer = setTimeout(tick, 1000);
}

let lastCount = -1;
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
  const status = q.status === 'open' ? (allIn ? 'Everyone is in!' : 'handed in') : 'closed · scoring';
  bar.innerHTML = '';
  bar.append(
    h('div', { class: 'text' }, h('h2', {}, q.title), h('p', {}, q.prompt)),
    h('div', { class: `count ${allIn ? 'all-in' : ''}` }, h('span', { id: 'qcount' }, `${q.submitted}/${q.online}`), h('small', {}, status)),
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
  const sig = JSON.stringify([q.key, q.wall?.map((w) => w.points)]);
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

  const hasText = (q.wall || []).some((w) => w.text);
  let i = 0;
  for (const w of q.wall || []) {
    if (!hasText && i >= 8) break;
    const pts = h('span', { class: 'points' }, '0');
    const card = h(
      'div',
      { class: 'card' },
      h('div', { class: 'who' }, avatarCanvas(w.avatar, 1.5), h('span', { class: 'grow' }, w.name), w.improved ? h('span', { class: 'improved-badge' }, 'IMPROVED') : '', pts),
      w.text ? h('div', { html: marksToHtml(w.text) }) : '',
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
    sp.text ? h('div', { html: marksToHtml(sp.text) }) : h('div', {}, sp.choice !== null && sp.choice !== undefined ? `Chose option ${sp.choice + 1}` : ''),
  );
}
