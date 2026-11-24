// Shared browser helpers: server connection, the screen iframe, score effects.

export const $ = (sel, root = document) => root.querySelector(sel);

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid !== null && kid !== undefined && kid !== false) {
      el.append(kid.nodeType ? kid : String(kid));
    }
  }
  return el;
};

export const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

export async function post(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

/** Live connection: full state on every change, positions ten times a second. */
export function connect(query, { onState, onPos, onGone, onStatus, onFx, onBall, onDesk }) {
  let es;
  let dead = false;
  const open = () => {
    es = new EventSource(`/events?${new URLSearchParams(query)}`);
    es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
    es.addEventListener('pos', (e) => onPos && onPos(JSON.parse(e.data)));
    es.addEventListener('fx', (e) => onFx && onFx(JSON.parse(e.data)));
    es.addEventListener('ball', (e) => onBall && onBall(JSON.parse(e.data)));
    es.addEventListener('desk', (e) => onDesk && onDesk(JSON.parse(e.data)));
    es.addEventListener('kicked', () => {
      dead = true;
      es.close();
      if (onGone) onGone('kicked');
    });
    es.onopen = () => onStatus && onStatus(true);
    es.onerror = async () => {
      if (onStatus) onStatus(false);
      if (dead) return;
      // A 401/403 means our token or key is no longer valid: stop retrying.
      if (es.readyState === EventSource.CLOSED) {
        const ctl = new AbortController();
        const r = await fetch(`/events?${new URLSearchParams(query)}`, { signal: ctl.signal }).catch(() => null);
        ctl.abort();
        if (r && (r.status === 401 || r.status === 403)) {
          dead = true;
          if (onGone) onGone('auth');
        } else {
          setTimeout(open, 1500);
        }
      }
    };
  };
  open();
  return {
    close() {
      dead = true;
      es.close();
    },
  };
}

/**
 * Put the shared page in a box. The page always renders at 1280x720 and is scaled
 * (letterboxed) into the box, so the deck never reflows when the box grows or shrinks:
 * slides keep their projector layout and the scroll position stays on the right slide.
 */
export const FRAME_W = 1280;
export const FRAME_H = 720;
export function placeFrame(iframe, r) {
  const s = Math.min(r.width / FRAME_W, r.height / FRAME_H);
  Object.assign(iframe.style, {
    width: `${FRAME_W}px`,
    height: `${FRAME_H}px`,
    left: `${r.left + (r.width - FRAME_W * s) / 2}px`,
    top: `${r.top + (r.height - FRAME_H * s) / 2}px`,
    transform: `scale(${s})`,
  });
}

/**
 * The wall screen without a page to show (a lesson with no deck): a card with the
 * open question, or the lesson's title. Same 1280x720 frame as the iframe.
 */
function screenCard(card, state) {
  const q = state.question;
  const asking = q && !['present', 'seating'].includes(state.mode);
  const lines = [];
  if (asking) {
    lines.push(['h1', q.title], ['p', q.prompt]);
    if (q.context) lines.push(['p', q.context, 'context']);
    if (q.kind === 'rapid' && q.status === 'open' && q.phase !== 'ready') lines.push(['p', q.rows[q.row].text, 'line']);
    if (q.status === 'revealed') lines.push(['p', 'Results are out.', 'quiet']);
  } else {
    lines.push(['h1', state.lessonTitle || '']);
  }
  const sig = JSON.stringify(lines);
  if (card.dataset.sig === sig) return;
  card.dataset.sig = sig;
  const long = lines.reduce((n, [, text]) => n + String(text || '').length, 0) > 420;
  card.classList.toggle('long', long);
  card.replaceChildren(...lines.filter(([, text]) => text).map(([tag, text, cls]) => h(tag, { class: cls || '' }, text)));
}

/** Keeps an iframe on the shared page; passes "reveal the next step" on to game-ready decks. */
export function screenFrame(iframe, card = null) {
  let current = null;
  let cueSeen = 0;
  return {
    update(state, deckUrl) {
      const s = state.screen || {};
      const url = s.slide && deckUrl ? `${deckUrl}#${s.slide}` : s.url;
      if (card) card.hidden = !!url;
      if (!url) {
        iframe.hidden = true;
        current = null;
        if (card) screenCard(card, state);
        return;
      }
      iframe.hidden = false;
      if (url !== current) {
        current = url;
        iframe.src = url;
        cueSeen = s.cue || 0;
        return;
      }
      while ((s.cue || 0) > cueSeen) {
        cueSeen++;
        try {
          iframe.contentWindow.postMessage({ type: 'lhc:cue' }, '*');
        } catch {}
      }
    },
    url: () => current,
  };
}

// ---- sound: tiny blips, off until someone turns them on ----------------------

let audio = null;
export const sound = {
  on: false,
  enable() {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    this.on = true;
  },
  blip(step = 0, kind = 'square') {
    if (!this.on || !audio) return;
    const o = audio.createOscillator();
    const gain = audio.createGain();
    o.type = kind;
    o.frequency.value = 330 * Math.pow(2, step / 12);
    gain.gain.setValueAtTime(0.07, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    o.connect(gain).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.13);
  },
};

// Little tunes: lists of [semitones above the base note, start in ms].
const TUNES = {
  handin: [[7, 0], [12, 90]],
  emote: [[9, 0]],
  hat: [[4, 0], [7, 80], [12, 160]],
  allin: [[0, 0], [4, 100], [7, 200], [12, 300], [16, 420]],
  level: [[0, 0], [5, 110], [9, 220], [12, 330], [17, 440], [24, 600]],
  finale: [[0, 0], [0, 150], [0, 300], [7, 450], [5, 700], [7, 850], [12, 1000]],
  timeup: [[12, 0], [7, 160]],
};
sound.tune = function (name) {
  for (const [step, at] of TUNES[name] || []) {
    setTimeout(() => this.blip(step, 'triangle'), at);
  }
};

/** A toast: a short message that slides in at the top and leaves by itself. */
export function toast(text, { icon = null, ms = 4500 } = {}) {
  let box = $('#toasts');
  if (!box) {
    box = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: 'toast panel' }, icon, h('span', {}, text));
  box.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

/** Confetti over the whole page for a couple of seconds. Pixel squares, no images. */
export function celebrate({ ms = 2600, count = 120 } = {}) {
  if (reduced() || document.hidden) return;
  const c = h('canvas', { class: 'confetti' });
  c.width = Math.ceil(innerWidth / 4); // drawn small and scaled up: chunky pixels
  c.height = Math.ceil(innerHeight / 4);
  document.body.append(c);
  const g = c.getContext('2d');
  const colors = ['#ff5d5d', '#ffcf4a', '#5ee08a', '#4cb3ff', '#ff8ad8', '#c39bff'];
  const bits = Array.from({ length: count }, (_, i) => ({
    x: Math.random() * c.width,
    y: -Math.random() * c.height * 0.6,
    vx: (Math.random() - 0.5) * 20,
    vy: 40 + Math.random() * 50,
    w: 1 + (i % 2),
    color: colors[i % colors.length],
    wob: Math.random() * 6,
  }));
  const t0 = performance.now();
  const step = (t) => {
    const k = (t - t0) / 1000;
    g.clearRect(0, 0, c.width, c.height);
    g.globalAlpha = Math.min(1, (ms - (t - t0)) / 500);
    for (const b of bits) {
      g.fillStyle = b.color;
      g.fillRect(Math.round(b.x + b.vx * k + Math.sin(k * 5 + b.wob) * 2), Math.round(b.y + b.vy * k), b.w, b.w);
    }
    if (t - t0 < ms) requestAnimationFrame(step);
    else c.remove();
  };
  requestAnimationFrame(step);
}

/** "1:05" from milliseconds left. */
export const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The class goal bar: level, progress to the next reward. */
export function classBar(el, k) {
  if (!k) return;
  const span = Math.max(1, k.to - k.from);
  const pct = k.next ? Math.max(0, Math.min(100, ((k.total - k.from) / span) * 100)) : 100;
  const sig = `${k.level}|${Math.round(pct)}|${k.next}`;
  if (el.dataset.sig === sig) return;
  const first = !el.dataset.sig;
  el.dataset.sig = sig;
  el.innerHTML = '';
  el.title = k.next ? `Everyone's points together: ${k.total} of ${k.to} for the next room reward` : 'The class earned every room reward';
  el.append(
    h('span', { class: 'lvl' }, `Class Lv ${k.level}`),
    h('span', { class: 'meter' }, h('span', { class: 'fill', style: `width:${pct}%` })),
    h('span', { class: 'quiet next' }, k.next ? `next: ${k.next}` : 'all unlocked!'),
  );
  if (!first) bump(el.querySelector('.lvl'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function bump(el, cls = 'pop') {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export async function countTo(el, from, to, ms = 500) {
  if (reduced() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  return new Promise((done) => {
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      el.textContent = Number.isInteger(to) && Number.isInteger(from) ? String(Math.round(v)) : fmt(v);
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : Math.abs(n % 1) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

/**
 * The scoring show: each step lands one by one, chips and mult tick up,
 * then the total slams in. `root` gets the markup.
 */
export async function scoreShow(root, breakdown, { fast = false } = {}) {
  root.innerHTML = '';
  const steps = h('ul', { class: 'score-steps' });
  const chips = h('div', { class: 'score-box chips' }, '0');
  const mult = h('div', { class: 'score-box mult' }, '1');
  const total = h('div', { class: 'score-total' }, '0');
  root.append(steps, h('div', { class: 'score-show' }, chips, h('div', { class: 'score-x' }, '×'), mult), total);
  let c = 0;
  let m = 1;
  let i = 0;
  const gap = fast || reduced() ? 0 : 380;
  for (const s of breakdown.steps) {
    await sleep(gap);
    steps.append(
      h(
        'li',
        {},
        h('span', {}, s.label),
        s.chips ? h('span', { class: 'c' }, `+${s.chips}`) : h('span', { class: 'm' }, `+${s.mult} mult`),
      ),
    );
    if (s.chips) {
      await countTo(chips, c, c + s.chips, gap ? 260 : 0);
      c += s.chips;
      bump(chips);
    }
    if (s.mult) {
      await countTo(mult, m, m + s.mult, gap ? 260 : 0);
      m += s.mult;
      bump(mult);
    }
    sound.blip(i++ * 2);
  }
  await sleep(gap);
  await countTo(total, 0, breakdown.total, gap ? 700 : 0);
  bump(total, breakdown.total >= 100 ? 'shake' : 'pop');
  sound.blip(14, 'triangle');
}
