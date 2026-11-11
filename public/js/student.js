import { $, h, store, post, connect, screenFrame, placeFrame, scoreShow, countTo, bump, sound, toast, celebrate, clock, classBar } from './common.js';
import { Room, ROOM_SIZE } from './room.js';
import { AVATARS, avatarCanvas, iconCanvas } from './sprites.js';
import { EMOTES, HATS, hatUnlocked, hatHint } from './fun.js';
import { clampToFloor, zoneAt, LETTERS, CIRCLED } from './world.js';
import { marksToHtml } from './marks.js';

const MODE_TEXT = {
  free: 'Free roam',
  seating: 'Take your seat!',
  present: 'Presentation',
  question: 'Your turn',
  review: 'Results',
};

let token = store.get('cge-token');
let state = null;
let me = { x: 16, y: 8, dir: 'down', moving: false };
let lastSent = 0;
let lastSentPos = '';
let sheetSig = '';
let editing = false;
let shownResult = store.get('cge-shown') || '';
const drafts = {}; // question key -> { text, reason, grid, pastedChars, activeMs, lastKey }

const room = new Room($('#room'));
const frame = screenFrame($('#screen'));

// ---- join ---------------------------------------------------------------------
function showJoin(msg = '') {
  $('#join').hidden = false;
  $('#join-err').textContent = msg;
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

// ---- live connection -------------------------------------------------------------
function start() {
  connect(
    { role: 'student', token },
    {
      onState: (s) => {
        const first = !state;
        state = s;
        room.selfId = s.me.id;
        room.setState(s);
        const self = s.players.find((p) => p.id === s.me.id);
        if (self && (first || s.mode === 'present')) {
          me.x = self.x;
          me.y = self.y;
          me.dir = self.dir;
        }
        render();
      },
      onPos: (list) => room.setPositions(list),
      onBall: ([x, y]) => room.setBall(x, y),
      onFx: (ev) => {
        room.fx(ev);
        const mine = ev.id === state?.me.id;
        if (ev.t === 'handin' && mine) sound.tune('handin');
        if (ev.t === 'emote' && mine) sound.tune('emote');
        if (ev.t === 'level') {
          toast(`Class level ${ev.level}! ${ev.text}.`, { ms: 7000 });
          celebrate();
          sound.tune('level');
        }
      },
      onGone: (why) => {
        store.del('cge-token');
        token = null;
        showJoin(why === 'kicked' ? 'You were removed from the room. Join again.' : 'Please join again.');
      },
      onStatus: (ok) => {
        $('#conn').textContent = ok ? 'online' : 'reconnecting…';
        $('#conn').hidden = ok; // only shown when something is wrong
        $('#conn').style.color = ok ? 'var(--good)' : 'var(--warn)';
      },
    },
  );
  requestAnimationFrame(loop);
}

// ---- movement ---------------------------------------------------------------------
const keys = new Set();
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
addEventListener('keydown', (e) => {
  if (typing()) return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
    keys.add(k);
    e.preventDefault();
  }
  if (k === 'enter') {
    const lock = $('#lock-in');
    if (lock && !lock.disabled) lock.click();
  }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !state) return;
  if (k >= '1' && k <= String(EMOTES.length)) sendEmote(EMOTES[Number(k) - 1].id);
  if (k === ' ' && document.activeElement?.tagName !== 'BUTTON') {
    e.preventDefault();
    sendEmote('hop');
  }
});

// ---- reactions, hats, sound ---------------------------------------------------------
function sendEmote(e) {
  post('/api/emote', { token, e }).catch(() => {});
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
$('#hats-open').onclick = () => (($('#hats').hidden = false), renderHats(), $('#hats-open').blur());
$('#hats-close').onclick = () => ($('#hats').hidden = true);

function renderHats() {
  const grid = $('#hat-grid');
  if ($('#hats').hidden || !state) return;
  const me = state.me;
  const sig = `${me.hat}|${me.points}|${me.improved}`;
  if (grid.dataset.sig === sig) return;
  grid.dataset.sig = sig;
  grid.innerHTML = '';
  const wear = (id) => post('/api/hat', { token, hat: id }).catch((e) => toast(e.message));
  grid.append(h('button', { type: 'button', 'aria-pressed': String(!me.hat), onclick: () => wear('') }, avatarCanvas(me.avatar, 3, 'none'), 'No hat'));
  for (const hat of HATS) {
    const open = hatUnlocked(hat, me);
    grid.append(
      h(
        'button',
        { type: 'button', disabled: !open, 'aria-pressed': String(me.hat === hat.id), onclick: () => wear(hat.id) },
        avatarCanvas(me.avatar, 3, hat.id),
        hat.name,
        open ? null : h('span', { class: 'hint' }, hatHint(hat)),
      ),
    );
  }
}

// New hats: say so once, when the points that unlock them arrive.
let knownHats = null;
function checkHats() {
  const open = HATS.filter((x) => hatUnlocked(x, state.me)).map((x) => x.id);
  if (knownHats) {
    const fresh = HATS.filter((x) => open.includes(x.id) && !knownHats.includes(x.id));
    for (const hat of fresh) toast(`New hat: ${hat.name}! Open Hats to wear it.`, { icon: iconCanvas('hat', hat.id, 2) });
    if (fresh.length) {
      sound.tune('hat');
      bump($('#hats-open'));
    }
  }
  knownHats = open;
}

// The soft timer ticks between server updates.
setInterval(() => state && updateLiveBits(), 500);
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (state) {
    const locked = state.mode === 'present';
    let dx = 0;
    let dy = 0;
    if (!locked && !typing()) {
      if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
      if (keys.has('arrowright') || keys.has('d')) dx += 1;
      if (keys.has('arrowup') || keys.has('w')) dy -= 1;
      if (keys.has('arrowdown') || keys.has('s')) dy += 1;
    }
    const moving = !!(dx || dy);
    if (moving) {
      const len = Math.hypot(dx, dy);
      const c = clampToFloor(me.x + (dx / len) * 5 * dt, me.y + (dy / len) * 5 * dt);
      me.x = c.x;
      me.y = c.y;
      me.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    }
    me.moving = moving;
    room.setLocal(state.me.id, me.x, me.y, me.dir, moving);
    const sig = `${me.x.toFixed(2)},${me.y.toFixed(2)},${me.dir},${moving}`;
    if (!locked && sig !== lastSentPos && t - lastSent > 80) {
      lastSent = t;
      lastSentPos = sig;
      post('/api/move', { token, x: me.x, y: me.y, dir: me.dir, moving }).catch(() => {});
    }
    updateZoneHint();
    room.draw(t);
  }
  requestAnimationFrame(loop);
}

// ---- layout -------------------------------------------------------------------------
function layout() {
  const sheet = $('#sheet');
  const docked = innerWidth >= 1000 && !sheet.hidden; // the sheet sits on the right (see student.css)
  const sheetH = sheet.hidden || docked ? 0 : sheet.offsetHeight + 16;
  const sheetW = docked ? sheet.offsetWidth + 20 : 0;
  const top = Math.max(56, $('.hud').offsetHeight + 20); // the top bar wraps onto two rows on narrow screens
  const availW = innerWidth - 20 - sheetW;
  const availH = Math.max(160, innerHeight - top - sheetH - 8);
  room.fit(availW, availH);
  const wrap = $('#room-wrap');
  const cw = ROOM_SIZE.W * room.scale;
  wrap.style.left = `${(innerWidth - sheetW - cw) / 2}px`;
  wrap.style.top = `${top}px`;
  const ifr = $('#screen');
  const present = state?.mode === 'present';
  document.body.classList.toggle('present', present);
  if (present) {
    placeFrame(ifr, { left: 12 - (innerWidth - sheetW - cw) / 2, top: 0, width: innerWidth - 24 - sheetW, height: availH - 8 });
  } else placeFrame(ifr, room.screenRect());
}
addEventListener('resize', layout);

// ---- rendering ----------------------------------------------------------------------
let shownPoints = 0;
function render() {
  const s = state;
  const meBox = $('#me');
  if (meBox.dataset.ready !== `hat:${s.me.hat}`) {
    meBox.innerHTML = '';
    meBox.append(
      avatarCanvas(s.me.avatar, 1.5, s.me.hat),
      h('span', {}, s.me.name),
      h('span', { class: 'points', id: 'my-points' }, String(shownPoints)),
      h('span', { class: 'quiet' }, 'pts'),
      h('span', { class: 'streak', id: 'my-streak', title: 'Questions handed in, in a row. Keep it going for bonus points.' }),
    );
    meBox.dataset.ready = `hat:${s.me.hat}`;
  }
  const streak = $('#my-streak');
  const streakText = s.me.streak >= 2 ? `${s.me.streak} in a row` : '';
  if (streak.textContent !== streakText) {
    streak.textContent = streakText;
    if (streakText) bump(streak);
  }
  classBar($('#klass'), s.klass);
  document.querySelector('#emotes [data-e="lost"]').setAttribute('aria-pressed', String(!!s.me.lost));
  checkHats();
  renderHats();
  if (s.me.points !== shownPoints) {
    const el = $('#my-points');
    countTo(el, shownPoints, s.me.points, 700).then(() => bump(el));
    shownPoints = s.me.points;
  }
  $('#mode').textContent = MODE_TEXT[s.mode] || s.mode;
  const deckUrl = s.deckUrl;
  frame.update(s, deckUrl);
  const link = $('#open-screen');
  link.hidden = !frame.url();
  if (frame.url()) link.href = frame.url();

  const banner = $('#banner');
  if (s.mode === 'seating' && s.seatingEndsAt) {
    banner.hidden = false;
    tickCountdown();
  } else if (s.spotlight) {
    banner.hidden = false;
    banner.innerHTML = `On the spot: <b>${escapeText(s.spotlight.name)}</b>`;
  } else banner.hidden = true;

  renderSheet();
  maybeShowResult();
  layout();
}

const escapeText = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let countdownTimer = null;
function tickCountdown() {
  clearTimeout(countdownTimer);
  if (!state || state.mode !== 'seating') return;
  const left = Math.max(0, Math.ceil((state.seatingEndsAt - state.serverNow - (performance.now() - renderedAt)) / 1000));
  $('#banner').innerHTML = `Take your seat! <span class="countdown">${left}</span><br><span class="quiet">Walk onto any chair. When time runs out you'll be seated automatically.</span>`;
  countdownTimer = setTimeout(tickCountdown, 250);
}
let renderedAt = performance.now();

// ---- the question sheet -----------------------------------------------------------------
function draftFor(q) {
  if (!drafts[q.key]) drafts[q.key] = { text: '', reason: null, grid: [], choice: null, pastedChars: 0, activeMs: 0, lastKey: 0 };
  return drafts[q.key];
}

function renderSheet() {
  renderedAt = performance.now();
  const q = state.question;
  const sheet = $('#sheet');
  const mine = state.mine;
  if (!q || state.mode === 'present' || state.mode === 'seating') {
    sheet.hidden = true;
    sheetSig = '';
    return;
  }
  const sig = [q.key, q.status, mine?.state, mine?.attempt, editing].join('|');
  updateLiveBits();
  if (sig === sheetSig) return;
  sheetSig = sig;
  sheet.hidden = false;
  sheet.innerHTML = '';
  sheet.append(h('div', { class: 'sheet-head' }, h('h2', {}, q.title), h('button', { class: 'btn small', onclick: () => sheet.classList.toggle('minimised') }, '–')));
  if (q.prompt) sheet.append(h('p', { class: 'prompt' }, q.prompt));
  if (q.context) sheet.append(h('p', { class: 'context' }, q.context));

  const canEdit = (q.status === 'open' && (!mine || editing)) || (q.status === 'revealed' && editing && mine?.canRetry);
  if (!canEdit) {
    if (mine) {
      sheet.append(h('p', { class: 'done' }, mine.state === 'revealed' ? 'Scored. See your result.' : '✓ Handed in.'));
      sheet.append(answerSummary(q, mine));
      const row = h('div', { class: 'row' });
      if (q.status === 'open') row.append(h('button', { class: 'btn', onclick: () => ((editing = true), renderSheet()) }, 'Change my answer'));
      if (mine.state === 'revealed') row.append(h('button', { class: 'btn gold', onclick: () => openResult(true) }, 'See my result'));
      if (mine.canRetry) row.append(h('button', { class: 'btn go', onclick: () => startRetry() }, 'Try again ↻'));
      row.append(h('span', { class: 'status quiet', id: 'live-count' }));
      sheet.append(row);
    } else {
      sheet.append(h('p', { class: 'quiet' }, q.status === 'open' ? '' : 'This question is closed.'));
      sheet.append(h('div', { class: 'row' }, h('span', { class: 'status quiet', id: 'live-count' })));
    }
    updateLiveBits();
    layout();
    return;
  }

  const d = draftFor(q);
  if (mine && !d.text && mine.text) d.text = mine.text;
  if (q.kind === 'choice') sheet.append(choiceEditor(q, d));
  if (q.kind === 'grid') sheet.append(gridEditor(q, d));
  if (q.kind === 'text') sheet.append(textEditor(q.parts || [], d, 'Your answer'));
  if (q.kind === 'choice' && q.text) sheet.append(textEditor(q.text.parts || [], d, q.text.prompt));

  const err = h('span', { class: 'err' });
  const send = h('button', { class: 'btn go', id: 'lock-in' }, q.kind === 'choice' && q.zones ? 'Lock in my zone ⏎' : mine && q.status === 'revealed' ? 'Hand in my retry' : 'Hand in');
  send.onclick = async () => {
    try {
      send.disabled = true;
      await post('/api/answer', {
        token,
        text: d.text,
        choice: d.choice,
        reason: d.reason,
        grid: d.grid,
        meta: { pastedChars: d.pastedChars, activeMs: d.activeMs },
      });
      editing = false;
      sheetSig = '';
    } catch (e) {
      err.textContent = e.message;
      send.disabled = false;
    }
  };
  sheet.append(h('div', { class: 'row' }, send, err, h('span', { class: 'status quiet', id: 'live-count' })));
  updateLiveBits();
  layout();
}

function updateLiveBits() {
  const q = state.question;
  const el = $('#live-count');
  if (!q || !el) return;
  const left = q.timerEndsAt ? q.timerEndsAt - (Date.now() + room.skew) : null;
  const time = left === null ? '' : left > 0 ? ` · ${clock(left)}` : ' · time is up, wrap it up';
  const txt = q.status === 'open' ? `${q.submitted}/${q.online} handed in${time}` : q.status === 'revealed' ? 'Results are out' : 'Waiting for the scores…';
  if (el.textContent !== txt) el.textContent = txt;
  el.classList.toggle('timer', left !== null && q.status === 'open');
  el.classList.toggle('low', left !== null && left < 15000);
}

function answerSummary(q, mine) {
  const box = h('div', { class: 'preview' });
  if (q.kind === 'choice' && mine.choice !== undefined && mine.choice !== null) {
    const pos = q.order.indexOf(mine.choice);
    box.append(h('div', {}, `${LETTERS[pos]} · ${q.options[mine.choice]}`));
    if (q.reasons && mine.reason !== null && mine.reason !== undefined) box.append(h('div', {}, `Reason: ${q.reasons.options[mine.reason]}`));
  }
  if (q.kind === 'grid' && mine.grid) {
    q.rows.forEach((r, i) => {
      const opts = r.options || q.options;
      box.append(h('div', {}, `${i + 1}. ${opts[mine.grid[i]] ?? '—'}`));
    });
  }
  if (mine.text) box.append(h('div', { html: marksToHtml(mine.text) }));
  return box;
}

function choiceEditor(q, d) {
  const wrap = h('div');
  const list = h('ul', { class: 'options', id: 'zone-list' });
  q.order.forEach((opt, pos) => {
    const li = h('li', { 'data-pos': pos }, h('span', { class: 'letter' }, LETTERS[pos]), q.options[opt]);
    if (!q.zones) {
      const b = h('button', { class: `btn small ${d.choice === opt ? 'on' : ''}`, type: 'button' }, 'Pick');
      b.onclick = () => {
        d.choice = opt;
        list.querySelectorAll('.btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      li.prepend(b, ' ');
    }
    list.append(li);
  });
  wrap.append(list);
  if (q.zones) wrap.append(h('p', { class: 'quiet', id: 'zone-hint' }, 'Walk into the zone of your answer (arrow keys or WASD), then lock in.'));
  if (q.reasons) {
    const row = h('div', { class: 'row' }, h('span', {}, 'Main reason:'));
    q.reasons.options.forEach((r, i) => {
      const b = h('button', { class: `btn small ${d.reason === i ? 'on' : ''}`, type: 'button' }, r);
      b.onclick = () => {
        d.reason = i;
        row.querySelectorAll('.btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      row.append(b);
    });
    wrap.append(row);
  }
  return wrap;
}

function updateZoneHint() {
  const q = state?.question;
  const hint = $('#zone-hint');
  if (!q || !hint || q.kind !== 'choice' || !q.zones) return;
  const z = zoneAt(q.order.length, me.x, me.y);
  const txt = z < 0 ? 'Walk into the zone of your answer (arrow keys or WASD), then lock in.' : `You're standing in ${LETTERS[z]}. Press Enter or the button to lock it in.`;
  if (hint.textContent !== txt) {
    hint.textContent = txt;
    document.querySelectorAll('#zone-list li').forEach((li) => li.classList.toggle('here', Number(li.dataset.pos) === z));
  }
}

function gridEditor(q, d) {
  const table = h('table');
  q.rows.forEach((r, i) => {
    const opts = r.options || q.options;
    const cell = h('td', { class: 'opts' });
    opts.forEach((o, j) => {
      const b = h('button', { class: `btn small ${d.grid[i] === j ? 'on' : ''}`, type: 'button' }, o);
      b.onclick = () => {
        d.grid[i] = j;
        cell.querySelectorAll('.btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      cell.append(b);
    });
    table.append(h('tr', {}, h('td', {}, `${i + 1}. ${r.text}`), cell));
  });
  return table;
}

function textEditor(parts, d, label) {
  const wrap = h('div');
  const ta = h('textarea', { placeholder: label, 'aria-label': label });
  ta.value = d.text;
  const preview = h('div', { class: 'preview', html: marksToHtml(d.text) || '<span class="quiet">Preview</span>' });
  const sync = () => {
    d.text = ta.value;
    preview.innerHTML = marksToHtml(d.text) || '<span class="quiet">Preview</span>';
  };
  ta.addEventListener('input', sync);
  ta.addEventListener('keydown', () => {
    const t = performance.now();
    if (d.lastKey && t - d.lastKey < 5000) d.activeMs += t - d.lastKey;
    d.lastKey = t;
  });
  ta.addEventListener('paste', (e) => {
    d.pastedChars += (e.clipboardData?.getData('text') || '').length;
  });
  if (parts.length) {
    const row = h('div', { class: 'row' }, h('span', { class: 'quiet' }, 'Select text, then mark it:'));
    parts.forEach((p, i) => {
      const b = h('button', { class: `btn small partbtn m${i + 1}`, type: 'button', title: `Mark the selected text as ${p}` }, `${CIRCLED[i]} ${p}`);
      b.onclick = () => {
        const { selectionStart: a, selectionEnd: z, value } = ta;
        const inner = value.slice(a, z) || '';
        ta.value = `${value.slice(0, a)}==${CIRCLED[i]}${inner}==${value.slice(z)}`;
        const caret = a + 3 + inner.length;
        ta.focus();
        ta.setSelectionRange(inner ? caret + 2 : caret, inner ? caret + 2 : caret);
        sync();
      };
      row.append(b);
    });
    wrap.append(row);
  }
  wrap.append(ta, preview);
  return wrap;
}

function startRetry() {
  editing = true;
  const q = state.question;
  const d = draftFor(q);
  d.text = state.mine?.text || d.text;
  $('#result').hidden = true;
  sheetSig = '';
  renderSheet();
}

// ---- result card ------------------------------------------------------------------------
function maybeShowResult() {
  const q = state.question;
  const mine = state.mine;
  if (!q || !mine || mine.state !== 'revealed') return;
  const id = `${q.key}:${mine.attempt}`;
  if (shownResult === id) return;
  shownResult = id;
  store.set('cge-shown', id);
  openResult(false);
}

function openResult(fast) {
  const q = state.question;
  const mine = state.mine;
  if (!mine?.breakdown) return;
  $('#result').hidden = false;
  $('#result-title').innerHTML = `${escapeText(q.title)}${mine.improved ? ' <span class="improved-badge">IMPROVED</span>' : ''}`;
  const fb = $('#result-feedback');
  fb.innerHTML = '';
  scoreShow($('#result-show'), mine.breakdown, { fast }).then(() => {
    if (mine.auto?.choice) fb.append(h('p', {}, mine.auto.choice === 'right' ? '✓ Right answer.' : mine.auto.choice === 'partial' ? '½ Half right.' : '✗ Not the expected answer: check the screen.'));
    if (mine.feedback) fb.append(h('div', { class: 'feedback' }, mine.feedback));
    if (mine.missed) fb.append(h('p', { class: 'missed' }, `Worth another look: ${mine.missed}`));
    $('#retry').hidden = !mine.canRetry;
    // a little party for a right answer, a good score or a better retry
    const good = mine.auto?.choice === 'right' || mine.improved || mine.breakdown.steps.some((x) => /^Answer [23]\/3/.test(x.label));
    if (good && !fast) celebrate({ count: 70, ms: 2000 });
  });
}
$('#result-close').onclick = () => ($('#result').hidden = true);
$('#retry').onclick = () => startRetry();

// ---- go -----------------------------------------------------------------------------------
if (token) start();
else showJoin();
layout();
