// The student page: join, walk around, react, and follow what the room is doing.
// The question sheet lives in student-sheet.js; hats, the questions board and
// trophies in student-panels.js.

import { $, h, store, post, connect, screenFrame, placeFrame, countTo, bump, sound, toast, celebrate, classBar } from './common.js';
import { Room, ROOM_SIZE } from './room.js';
import { AVATARS, avatarCanvas, iconCanvas } from './sprites.js';
import { EMOTES } from './shared/fun.js';
import { trophyNear } from './shared/world.js';
import { ROOMS, DOOR, walk } from './shared/rooms.js';
import { findPath } from './shared/path.js';
import { createSheet } from './student-sheet.js';
import { createPanels } from './student-panels.js';

const MODE_TEXT = {
  free: 'Free roam',
  seating: 'Take your seat!',
  present: 'Presentation',
  question: 'Your turn',
  review: 'Results',
};
const WALK_SPEED = 5; // tiles per second
const SEND_EVERY_MS = 80; // how often our position goes to the server while walking

let token = store.get('cge-token');
let state = null; // the latest view from the server
let me = { x: 16, y: 8, dir: 'down', moving: false }; // our avatar, moved here first and sent to the server
let warp = -1; // the last server-side move of our avatar we have followed
let route = []; // spots still to walk through after a tap or click on the floor

const room = new Room($('#room'));
const frame = screenFrame($('#screen'));

/** Send one of our intentions to the server. */
const send = (action, body = {}) => post(`/api/${action}`, { token, ...body });

const sheet = createSheet({ send, room, layout });
const panels = createPanels({ send });

// ---- join -------------------------------------------------------------------------

function showJoin(message = '') {
  $('#join').hidden = false;
  $('#join-err').textContent = message;
  const box = $('#avatars');
  box.innerHTML = '';
  let pick = Number(store.get('cge-avatar') || Math.floor(Math.random() * AVATARS.length));
  AVATARS.forEach((a, i) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(i === pick), title: a.name }, avatarCanvas(i, 4));
    b.onclick = () => {
      pick = i;
      box.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-pressed', String(j === i)));
    };
    box.append(b);
  });
  $('#name').value = store.get('cge-name') || '';
  $('#join-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const name = $('#name').value.trim();
      const r = await post('/api/join', { name, avatar: pick });
      token = r.token;
      store.set('cge-token', token);
      store.set('cge-name', name);
      store.set('cge-avatar', String(pick));
      $('#join').hidden = true;
      start();
    } catch (err) {
      $('#join-err').textContent = err.message;
    }
  };
  $('#name').focus();
}

// ---- live connection ----------------------------------------------------------------

function start() {
  connect(
    { role: 'student', token },
    {
      onState: (s) => {
        state = s;
        room.selfId = s.me.id;
        room.setState(s);
        // The server put us somewhere (a seat, the hot seat): follow.
        const self = s.players.find((p) => p.id === s.me.id);
        if (self && self.warp !== warp) {
          warp = self.warp;
          me.x = self.x;
          me.y = self.y;
          me.dir = self.dir;
          stopRoute();
        }
        render();
      },
      onPos: (list) => room.setPositions(list),
      onBall: ([x, y]) => room.setBall(x, y),
      onFx,
      onGone: (why) => {
        store.del('cge-token');
        token = null;
        showJoin(why === 'kicked' ? 'You were removed from the room. Join again.' : 'Please join again.');
      },
      onStatus: (ok) => ($('#conn').hidden = ok), // only shown when something is wrong
    },
  );
  requestAnimationFrame(loop);
}

/** One-off events: someone reacted, the class levelled up, a trophy arrived. */
function onFx(ev) {
  room.fx(ev);
  const mine = ev.id === state?.me.id;
  if (ev.t === 'handin' && mine) sound.tune('handin');
  if (ev.t === 'emote' && mine) sound.tune('emote');
  if (ev.t === 'level') {
    toast(`Class level ${ev.level}! ${ev.text}.`, { ms: 7000 });
    celebrate();
    sound.tune('level');
  }
  if (ev.t === 'trophy') {
    toast(`New trophy on the shelf: ${ev.name}. Walk up to it to read it.`, { ms: 7000 });
    sound.tune('hat');
  }
}

// ---- keys: walking, reactions --------------------------------------------------------

const WALK_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
const keys = new Set();
// true while the student is writing somewhere: the keys must not move the avatar then
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || !!document.activeElement?.isContentEditable;

addEventListener('keydown', (e) => {
  if (typing()) return;
  const k = e.key.toLowerCase();
  if (WALK_KEYS.includes(k)) {
    keys.add(k);
    e.preventDefault();
  }
  if (k === 'enter') sheet.pressEnter();
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !state) return;
  if (k >= '1' && k <= String(EMOTES.length)) sendEmote(EMOTES[Number(k) - 1].id);
  if (k === 'e') withinReach()?.use();
  if (k === ' ' && document.activeElement?.tagName !== 'BUTTON') {
    e.preventDefault();
    sendEmote('hop');
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function sendEmote(e) {
  send('emote', { e }).catch(() => {});
}
EMOTES.forEach((em, i) => {
  const b = h('button', { type: 'button', title: `${em.label} (key ${i + 1})`, 'aria-label': em.label, 'data-e': em.id }, iconCanvas('emote', em.id, 2));
  b.onclick = () => (sendEmote(em.id), b.blur());
  $('#emotes').append(b);
});

$('#sound').onclick = () => {
  if (sound.on) sound.on = false;
  else sound.enable();
  $('#sound').textContent = sound.on ? 'Sound on' : 'Sound off';
  $('#sound').blur();
};

// ---- tap or click the floor to walk there -----------------------------------------------

function stopRoute() {
  route = [];
  room.target = null;
}

function walkTo(spot) {
  route = findPath(state.room, me, spot, state.klass.unlocked);
  room.target = route.at(-1) || null;
}

$('#room').addEventListener('pointerdown', (e) => {
  if (state && state.mode !== 'present') walkTo(room.spotAt(e.clientX, e.clientY));
});

// ---- E: use what is next to you ----------------------------------------------------------
// A free chair (sit down), a trophy on the sill (read it), the open door (go through),
// the class cat (pet it). The hint at the bottom of the screen says what E would do.

const near = (spot, reach) => Math.hypot(me.x - spot.x, me.y - spot.y) < reach;

/** Is somebody else on this chair? */
const taken = (seat) => [...room.players.values()].some((p) => p.meta.id !== state.me.id && p.online && Math.abs(p.x - seat.x) < 0.6 && Math.abs(p.y - seat.y) < 0.6);

function sitOn(seat) {
  stopRoute();
  Object.assign(me, { x: seat.x, y: seat.y, dir: 'up' });
}

/** What E would do right now: { label, use }, or null when nothing is within reach. */
function withinReach() {
  if (!state || state.mode === 'present') return null;
  if (state.door && near(DOOR, 5)) return { label: 'go through the door', use: () => walkTo(DOOR) };

  const seats = ROOMS[state.room].seats;
  const sitting = seats.some((seat) => seat.x === me.x && seat.y === me.y);
  const chair = seats.filter((seat) => near(seat, 1.3) && !taken(seat)).sort((a, b) => Math.hypot(me.x - a.x, me.y - a.y) - Math.hypot(me.x - b.x, me.y - b.y))[0];
  if (chair && !sitting) return { label: 'sit down', use: () => sitOn(chair) };

  const trophy = trophyNear(state.trophies.length, me.x, me.y);
  if (trophy >= 0) return { label: `read “${state.trophies[trophy].name}”`, use: () => panels.openTrophies(trophy) };

  if (room.has('cat') && room.cat && near(room.cat, 1.5)) return { label: 'pet the cat', use: () => sendEmote('heart') };
  return null;
}

function updateHint() {
  const text = withinReach()?.label ? `E · ${withinReach().label}` : '';
  const hint = $('#hint');
  if (hint.textContent !== text) hint.textContent = text;
  hint.hidden = !text;
}
$('#hint').onclick = () => withinReach()?.use(); // on a touch screen, tap the hint

// ---- the frame loop: move our avatar, tell the server, draw ---------------------------------

let lastT = performance.now();
let lastSentAt = 0;
let lastSent = '';

function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (state) {
    const locked = state.mode === 'present'; // seated for the explanation
    const gone = state.players.find((p) => p.id === state.me.id)?.gone; // through the door already
    let dx = 0;
    let dy = 0;
    if (!locked && !gone && !typing()) {
      if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
      if (keys.has('arrowright') || keys.has('d')) dx += 1;
      if (keys.has('arrowup') || keys.has('w')) dy -= 1;
      if (keys.has('arrowdown') || keys.has('s')) dy += 1;
    }
    if (dx || dy || locked || gone) stopRoute(); // the keys take over from a tap
    if (route.length) {
      // head for the next spot on the route; drop it once we are there
      dx = route[0].x - me.x;
      dy = route[0].y - me.y;
      if (Math.hypot(dx, dy) < WALK_SPEED * dt) {
        Object.assign(me, route.shift());
        if (!route.length) room.target = null;
      }
    }
    me.moving = !!(dx || dy);
    if (me.moving) {
      const len = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;
      // walk() stops us at furniture and slides us along its edge
      Object.assign(me, walk(state.room, me, { x: me.x + (dx / len) * step, y: me.y + (dy / len) * step }, state.klass.unlocked));
      me.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    }
    room.setLocal(state.me.id, me.x, me.y, me.dir, me.moving);

    // We move at once on our own screen; the server hears about it a few times a second.
    const now = `${me.x.toFixed(2)},${me.y.toFixed(2)},${me.dir},${me.moving}`;
    if (!locked && now !== lastSent && t - lastSentAt > SEND_EVERY_MS) {
      lastSentAt = t;
      lastSent = now;
      send('move', { x: me.x, y: me.y, dir: me.dir, moving: me.moving, warp }).catch(() => {});
    }
    sheet.standingAt(me.x, me.y);
    updateHint();
    if (state.door) tickDoor();
    room.draw(t);
  }
  requestAnimationFrame(loop);
}

// ---- layout -------------------------------------------------------------------------------

function layout() {
  const sheetEl = $('#sheet');
  const docked = innerWidth >= 1000 && !sheetEl.hidden; // the sheet sits on the right (see student.css)
  const sheetH = sheetEl.hidden || docked ? 0 : sheetEl.offsetHeight + 16;
  const sheetW = docked ? sheetEl.offsetWidth + 20 : 0;
  const top = Math.max(56, $('.hud').offsetHeight + 20); // the top bar wraps onto two rows on narrow screens
  const availW = innerWidth - 20 - sheetW;
  const availH = Math.max(160, innerHeight - top - sheetH - 8);
  room.fit(availW, availH);
  const roomW = ROOM_SIZE.W * room.scale;
  const left = (innerWidth - sheetW - roomW) / 2;
  const wrap = $('#room-wrap');
  wrap.style.left = `${left}px`;
  wrap.style.top = `${top}px`;
  // During a presentation the slides cover the room; otherwise they sit on the room's wall screen.
  const present = state?.mode === 'present';
  document.body.classList.toggle('present', present);
  if (present) placeFrame($('#screen'), { left: 12 - left, top: 0, width: innerWidth - 24 - sheetW, height: availH - 8 });
  else placeFrame($('#screen'), room.screenRect());
}
addEventListener('resize', layout);

// ---- rendering: the top bar and banners -------------------------------------------------------

let shownPoints = 0;

function renderMe(meView) {
  const box = $('#me');
  const made = `hat:${meView.hat}`;
  if (box.dataset.made !== made) {
    box.dataset.made = made;
    box.innerHTML = '';
    box.append(
      avatarCanvas(meView.avatar, 1.5, { hat: meView.hat }),
      h('span', {}, meView.name),
      h('span', { class: 'points', id: 'my-points' }, String(shownPoints)),
      h('span', { class: 'quiet' }, 'pts'),
      h('span', { class: 'quiet', id: 'my-rank', title: 'Your place today. Only you can see it.' }),
      h('span', { class: 'streak', id: 'my-streak', title: 'Questions handed in, in a row. Keep it going for bonus points.' }),
    );
  }
  $('#my-rank').textContent = meView.rank ? `#${meView.rank}` : '';
  const streak = $('#my-streak');
  const streakText = meView.streak >= 2 ? `${meView.streak} in a row` : '';
  if (streak.textContent !== streakText) {
    streak.textContent = streakText;
    if (streakText) bump(streak);
  }
  if (meView.points !== shownPoints) {
    const el = $('#my-points');
    countTo(el, shownPoints, meView.points, 700).then(() => bump(el));
    shownPoints = meView.points;
  }
}

function render() {
  const s = state;
  renderMe(s.me);
  classBar($('#klass'), s.klass);
  $('#emotes [data-e="lost"]').setAttribute('aria-pressed', String(!!s.me.lost));
  $('#mode').textContent = s.room === 'base' ? MODE_TEXT[s.mode] || s.mode : `${s.roomName} · ${MODE_TEXT[s.mode] || s.mode}`;

  frame.update(s, s.deckUrl);
  const link = $('#open-screen');
  link.hidden = !frame.url();
  if (frame.url()) link.href = frame.url();

  renderBanner();
  panels.render(s);
  sheet.render(s);
  layout();
}

let countdownTimer = null;
let renderedAt = performance.now();

function renderBanner() {
  renderedAt = performance.now();
  clearTimeout(countdownTimer);
  const banner = $('#banner');
  banner.innerHTML = '';
  if (state.door) {
    banner.hidden = false;
    tickDoor();
  } else if (state.mode === 'seating' && state.seatingEndsAt) {
    banner.hidden = false;
    tickCountdown();
  } else if (state.spotlight) {
    banner.hidden = false;
    const you = state.spotlight.pid === state.me.id;
    banner.append(you ? 'You are on the spot: tell the class about your answer.' : 'On the spot: ', you ? '' : h('b', {}, state.spotlight.name));
  } else banner.hidden = true;
}

function tickCountdown() {
  if (!state || state.mode !== 'seating') return;
  const left = Math.max(0, Math.ceil((state.seatingEndsAt - state.serverNow - (performance.now() - renderedAt)) / 1000));
  const banner = $('#banner');
  banner.innerHTML = '';
  banner.append('Take your seat! ', h('span', { class: 'countdown' }, left), h('br'), h('span', { class: 'quiet' }, "Walk onto any chair. When time runs out you'll be seated automatically."));
  countdownTimer = setTimeout(tickCountdown, 250);
}

/** The door is open: say where it leads and how long is left. */
function tickDoor() {
  const left = Math.max(0, Math.ceil((state.door.endsAt - Date.now() - room.skew) / 1000));
  const text = `The door is open: next stop, the ${state.door.name.toLowerCase()}! Walk through it, top left. ${left}`;
  const banner = $('#banner');
  if (banner.textContent !== text) banner.textContent = text;
}

// The soft timer on a question ticks between server updates.
setInterval(() => state && sheet.tick(), 500);

// ---- go ------------------------------------------------------------------------------------

if (token) start();
else showJoin();
layout();
