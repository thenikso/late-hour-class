// The room state and every rule. The server is the only source of truth:
// clients send intentions, the game decides and everyone gets the result.

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAnswer, spotlightPicks, answerText } from './checks.js';
import { scoreAnswers } from './ai.js';
import { normaliseQuestion } from './manifest.js';
import { parseMarks } from '../public/js/marks.js';
import { SEATS, SPAWN, FLOOR, BALL_HOME, clampToFloor, seatAt, zoneAt, optionOrder } from '../public/js/world.js';
import { EMOTE_IDS, EMOTE_GAP_MS, HATS, hatUnlocked, CLASS_LEVELS, classProgress, streakChips, FULL_HOUSE_CHIPS } from '../public/js/fun.js';

const now = () => Date.now();
const token = () => randomBytes(12).toString('hex');
const AVATARS = 8;

export class Game {
  constructor({ lesson, dataDir, aiMode, deckUrl, notesUrl, projectorUrl, log = console.log }) {
    this.lesson = lesson;
    this.dataDir = dataDir;
    this.aiMode = aiMode;
    this.log = log;
    this.players = new Map(); // id -> player
    this.byToken = new Map(); // token -> id
    this.mode = 'free';
    this.seatingEndsAt = null;
    this.seatTimer = null;
    this.deckUrl = deckUrl || '';
    this.notesUrl = notesUrl || '';
    this.projectorUrl = projectorUrl || deckUrl || '';
    this.screen = { url: deckUrl || '', slide: deckUrl ? 1 : null, cue: 0 };
    this.records = {}; // question key -> record
    this.current = null; // key of the live question
    this.spotlight = null; // { qkey, pid }
    this.scoring = false;
    this.lastError = null;
    this.listeners = new Set();
    this.fxListeners = new Set();
    this.seq = 0; // order in which questions were first opened (for streaks)
    this.classLevel = 0; // highest class level reached; never goes back down
    this.finale = false;
    this.ball = { ...BALL_HOME, vx: 0, vy: 0 };
    this.sessionFile = join(dataDir, `session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
    this.nextId = 1;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Short-lived events (an emote, a hop, a level-up): sent once, never stored. */
  onFx(fn) {
    this.fxListeners.add(fn);
    return () => this.fxListeners.delete(fn);
  }

  fx(event) {
    this.fxListeners.forEach((fn) => fn(event));
  }

  changed() {
    clearTimeout(this._emit);
    this._emit = setTimeout(() => this.listeners.forEach((fn) => fn()), 30);
    clearTimeout(this._save);
    this._save = setTimeout(() => this.save().catch((e) => this.log('save failed:', e.message)), 800);
  }

  // ---- players --------------------------------------------------------------
  join(name, avatar) {
    name = String(name || '').trim().slice(0, 24);
    if (!name) throw new Error('Pick a name');
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new Error('That name is taken: add an initial');
    const id = `p${this.nextId++}`;
    const t = token();
    const p = {
      id,
      token: t,
      name,
      avatar: Math.max(0, Math.min(AVATARS - 1, Number(avatar) || 0)),
      x: SPAWN.x + (Math.random() * 4 - 2),
      y: SPAWN.y,
      dir: 'down',
      moving: false,
      seat: -1,
      online: 0,
      lastSeen: now(),
      points: 0,
      improved: 0,
      hat: '',
      emoteAt: 0,
      lostAt: 0,
    };
    if (this.mode === 'present') this.sit(p);
    this.players.set(id, p);
    this.byToken.set(t, id);
    this.changed();
    return p;
  }

  player(tok) {
    const id = this.byToken.get(tok);
    return id ? this.players.get(id) : null;
  }

  setOnline(p, delta) {
    p.online = Math.max(0, p.online + delta);
    p.lastSeen = now();
    this.changed();
  }

  rename(id, name) {
    const p = this.players.get(id);
    if (p && name) p.name = String(name).trim().slice(0, 24);
    this.changed();
  }

  kick(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.byToken.delete(p.token);
    this.changed();
  }

  move(p, x, y, dir, moving) {
    if (this.mode === 'present') return false; // locked in their seat
    const c = clampToFloor(Number(x) || 0, Number(y) || 0);
    p.x = c.x;
    p.y = c.y;
    p.dir = ['up', 'down', 'left', 'right'].includes(dir) ? dir : p.dir;
    p.moving = !!moving;
    p.seat = seatAt(p.x, p.y);
    p.lastSeen = now();
    if (p.moving) this.kickBall(p);
    return true; // positions travel on the fast tick, not as a full state change
  }

  online() {
    return [...this.players.values()].filter((p) => p.online > 0);
  }

  // ---- fun: emotes, hops, hats ------------------------------------------------
  /** A reaction bubble or a hop. Fixed list, rate-limited; "lost" also reaches the teacher. */
  emote(p, e) {
    const hop = e === 'hop';
    if (!hop && !EMOTE_IDS.includes(e)) throw new Error('Unknown emote');
    if (hop && this.mode === 'present') return false; // seated: no hopping during explanations
    if (now() - (p.emoteAt || 0) < (hop ? 400 : EMOTE_GAP_MS)) return false;
    p.emoteAt = now();
    this.fx({ t: hop ? 'hop' : 'emote', id: p.id, e });
    if (e === 'lost' || (e === 'yes' && p.lostAt)) {
      p.lostAt = e === 'lost' ? now() : 0;
      this.changed();
    }
    return true;
  }

  /** Wear a hat you have unlocked ('' takes it off). */
  setHat(p, id) {
    if (id) {
      const hat = HATS.find((x) => x.id === id);
      if (!hat) throw new Error('Unknown hat');
      if (!hatUnlocked(hat, p)) throw new Error('Not unlocked yet');
    }
    p.hat = id || '';
    this.changed();
  }

  // ---- the break-time ball (a class reward) -------------------------------------
  /** The ball only rolls in free roam, once the class has earned the games corner. */
  ballOn() {
    return this.mode === 'free' && this.klass().unlocked.includes('games');
  }

  /** Walking into the ball sends it off, away from the player. */
  kickBall(p) {
    if (!this.ballOn()) return;
    const b = this.ball;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.8) return;
    const face = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.dir] || [0, 1];
    const [ux, uy] = d > 0.1 ? [dx / d, dy / d] : face;
    b.vx = ux * 9;
    b.vy = uy * 9;
  }

  /** Called by the server ten times a second. Returns true while the ball is moving. */
  stepBall(dt) {
    const b = this.ball;
    if (!b.vx && !b.vy) return false;
    if (!this.ballOn()) {
      Object.assign(b, BALL_HOME, { vx: 0, vy: 0 });
      return true;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const maxX = FLOOR.x + FLOOR.w - 1;
    const maxY = FLOOR.y + FLOOR.h - 1;
    if (b.x < FLOOR.x || b.x > maxX) (b.vx = -b.vx), (b.x = Math.max(FLOOR.x, Math.min(maxX, b.x)));
    if (b.y < FLOOR.y || b.y > maxY) (b.vy = -b.vy), (b.y = Math.max(FLOOR.y, Math.min(maxY, b.y)));
    b.vx *= 0.86;
    b.vy *= 0.86;
    if (Math.hypot(b.vx, b.vy) < 0.4) b.vx = b.vy = 0;
    return true;
  }

  clearLost() {
    for (const p of this.players.values()) p.lostAt = 0;
  }

  // ---- modes ----------------------------------------------------------------
  sit(p) {
    const taken = new Set([...this.players.values()].filter((o) => o !== p && o.seat >= 0).map((o) => o.seat));
    let seat = seatAt(p.x, p.y);
    if (seat < 0 || taken.has(seat)) {
      let best = -1;
      let bestD = Infinity;
      SEATS.forEach((s, i) => {
        if (taken.has(i)) return;
        const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
        if (d < bestD) (bestD = d), (best = i);
      });
      seat = best;
    }
    if (seat >= 0) {
      p.seat = seat;
      p.x = SEATS[seat].x;
      p.y = SEATS[seat].y;
      p.dir = 'up';
      p.moving = false;
    }
  }

  setMode(mode) {
    clearTimeout(this.seatTimer);
    this.seatingEndsAt = null;
    if (mode === 'present') for (const p of this.players.values()) this.sit(p);
    this.finale = false;
    this.mode = mode;
    this.changed();
  }

  takeSeats(seconds = 20) {
    clearTimeout(this.seatTimer);
    this.mode = 'seating';
    this.finale = false;
    this.seatingEndsAt = now() + seconds * 1000;
    this.seatTimer = setTimeout(() => this.setMode('present'), seconds * 1000);
    this.changed();
  }

  // ---- shared screen --------------------------------------------------------
  setScreenUrl(url) {
    this.screen = { url: String(url || ''), slide: null, cue: 0 };
    this.changed();
  }

  goSlide(n) {
    if (!this.deckUrl) return;
    const max = this.lesson.slides.length || 999;
    n = Math.max(1, Math.min(max, Number(n) || 1));
    if (n !== this.screen.slide) this.clearLost(); // a new slide: "I'm lost" starts fresh
    this.screen = { url: this.deckUrl, slide: n, cue: 0 };
    const slide = this.lesson.slides[n - 1];
    // Break slides open the room; the teacher still decides everything else.
    if (slide?.mode === 'gate' && this.mode === 'present') this.setMode('free');
    this.changed();
  }

  cue() {
    this.screen = { ...this.screen, cue: (this.screen.cue || 0) + 1 };
    this.changed();
  }

  // ---- questions ------------------------------------------------------------
  questionDef(key) {
    return this.records[key]?.def || this.lesson.questions[key] || null;
  }

  open(keyOrDef) {
    let def;
    if (typeof keyOrDef === 'string') def = this.questionDef(keyOrDef);
    else def = normaliseQuestion(keyOrDef.key || `live-${Object.keys(this.records).length + 1}`, keyOrDef);
    if (!def) throw new Error('Unknown question');
    const rec = this.records[def.key] || { key: def.key, def, answers: {}, openedAt: now(), seq: ++this.seq, log: [] };
    rec.def = def;
    rec.status = 'open';
    rec.timerEndsAt = null;
    this.finale = false;
    this.records[def.key] = rec;
    this.current = def.key;
    this.spotlight = null;
    if (this.mode === 'present' || this.mode === 'seating') {
      clearTimeout(this.seatTimer);
      this.seatingEndsAt = null;
    }
    this.mode = 'question';
    this.changed();
    return rec;
  }

  get live() {
    return this.current ? this.records[this.current] : null;
  }

  submit(p, body) {
    const rec = this.live;
    if (!rec) throw new Error('No question is open');
    const q = rec.def;
    const entry = rec.answers[p.id] || { id: p.id, attempts: [] };
    const last = entry.attempts.at(-1);
    const isRetry = rec.status === 'revealed';
    if (isRetry) {
      if (!last || !this.canRetry(rec, entry)) throw new Error('No retry available');
    } else if (rec.status !== 'open') throw new Error('This question is closed');

    const attempt = {
      n: isRetry ? entry.attempts.length + 1 : 1,
      at: now(),
      text: typeof body.text === 'string' ? body.text.slice(0, 4000) : '',
      meta: {
        pastedChars: Math.max(0, Number(body.meta?.pastedChars) || 0),
        activeMs: Math.max(0, Number(body.meta?.activeMs) || 0),
      },
      state: 'submitted',
    };
    if (q.kind === 'choice') {
      if (q.zones) {
        const order = optionOrder(q);
        const z = zoneAt(order.length, p.x, p.y);
        if (z < 0) throw new Error('Walk into a zone first');
        attempt.choice = order[z];
      } else attempt.choice = Number(body.choice);
      if (!(attempt.choice >= 0 && attempt.choice < q.options.length)) throw new Error('Pick an option');
      if (q.reasons) attempt.reason = body.reason === undefined || body.reason === null ? null : Number(body.reason);
    }
    if (q.kind === 'grid') attempt.grid = q.rows.map((_, i) => (Array.isArray(body.grid) && body.grid[i] !== null ? Number(body.grid[i]) : null));

    if (!isRetry) entry.attempts = [attempt]; // changing your mind before the close replaces the answer
    else entry.attempts.push(attempt);
    rec.answers[p.id] = entry;

    const others = Object.values(rec.answers)
      .filter((e) => e.id !== p.id)
      .map((e) => ({ id: e.id, name: this.players.get(e.id)?.name || '?', text: e.attempts.at(-1).text }));
    attempt.flags = checkAnswer(q, { id: p.id, text: attempt.text, meta: attempt.meta }, others);
    if (!this.needsAi(q)) this.autoScore(q, attempt);
    this.fx({ t: 'handin', id: p.id });
    this.changed();
    return attempt;
  }

  needsAi(q) {
    return q.scored && (q.kind === 'text' || (q.kind === 'choice' && q.text));
  }

  canRetry(rec, entry) {
    const last = entry?.attempts.at(-1);
    if (!last || last.state !== 'revealed' || !this.needsAi(rec.def)) return false;
    return entry.attempts.length < 3 && (!!last.ai?.missed || (last.ai?.score ?? 3) < 2);
  }

  close() {
    const rec = this.live;
    if (!rec || rec.status !== 'open') return;
    rec.status = 'closed';
    rec.closedAt = now();
    rec.timerEndsAt = null;
    // Team bonus: everyone in the room handed in before the close.
    const here = this.online();
    rec.fullHouse = here.length >= 2 && here.every((p) => rec.answers[p.id]);
    if (!this.needsAi(rec.def)) rec.status = 'scored';
    this.changed();
  }

  /** Choice correctness, reasons and grid rows: scored instantly, no AI. */
  autoScore(q, attempt) {
    const auto = {};
    if (q.kind === 'choice' && q.correct !== null && q.correct !== undefined) {
      const correct = [].concat(q.correct);
      auto.choice = correct.includes(attempt.choice) ? 'right' : (q.partial || []).includes(attempt.choice) ? 'partial' : 'wrong';
      if (q.reasons && attempt.reason !== null && attempt.reason !== undefined)
        auto.reason = [].concat(q.reasons.correct ?? []).includes(attempt.reason);
    }
    if (q.kind === 'grid') {
      auto.rows = q.rows.map((r, i) => (r.correct === null ? null : r.correct.includes(attempt.grid[i])));
    }
    attempt.auto = auto;
    if (attempt.state === 'submitted') attempt.state = 'scored';
  }

  async score() {
    const rec = this.live;
    if (!rec) throw new Error('No question');
    if (this.scoring) throw new Error('Already scoring');
    if (rec.status === 'open') this.close();
    const q = rec.def;
    const pending = Object.values(rec.answers)
      .map((e) => ({ e, a: e.attempts.at(-1) }))
      .filter(({ a }) => a.state === 'submitted');
    for (const { a } of pending) this.autoScore(q, a);
    if (!this.needsAi(q) || !pending.length) {
      rec.status = rec.status === 'revealed' ? 'revealed' : 'scored';
      this.changed();
      return;
    }
    this.scoring = true;
    rec.scoringError = null;
    this.changed();
    try {
      const ids = new Map();
      const items = pending.map(({ e, a }, i) => {
        const anon = `a${i + 1}`;
        ids.set(anon, { e, a });
        return { id: anon, text: answerText(a), choice: a.choice };
      });
      const results = await scoreAnswers(this.aiMode, q, items);
      for (const r of results) {
        const hit = ids.get(r.id);
        if (!hit) continue;
        hit.a.ai = { score: r.score, parts: r.parts, missed: r.missed, feedback: r.feedback, by: this.aiMode };
        hit.a.state = 'scored';
      }
      if (rec.status !== 'revealed') rec.status = 'scored';
    } catch (e) {
      rec.scoringError = e.message;
      this.log('scoring failed:', e.message);
      // Fall back to manual: answers keep their state so the teacher can score by hand or retry.
    } finally {
      this.scoring = false;
      this.changed();
    }
  }

  /** The teacher's word is final: change a suggested score or the feedback. */
  setScore(pid, score, feedback) {
    const rec = this.live;
    const a = rec?.answers[pid]?.attempts.at(-1);
    if (!a) return;
    a.ai = { ...(a.ai || { parts: {}, missed: null }), score: Math.max(0, Math.min(3, Number(score) || 0)) };
    if (typeof feedback === 'string') a.ai.feedback = feedback.slice(0, 400);
    if (a.ai.score >= 2) a.ai.missed = null;
    a.ai.edited = true;
    if (a.state === 'submitted') {
      this.autoScore(rec.def, a);
      a.state = 'scored';
    }
    if (a.state === 'revealed') this.reveal();
    this.changed();
  }

  /** A soft countdown on the open question. Nothing closes by itself: the teacher decides. */
  setTimer(seconds) {
    const rec = this.live;
    if (!rec || rec.status !== 'open') return;
    const s = Math.max(0, Math.min(3600, Number(seconds) || 0));
    rec.timerEndsAt = s ? now() + s * 1000 : null;
    this.changed();
  }

  /** Questions that got at least one answer, newest first. */
  answeredRecords() {
    return Object.values(this.records)
      .filter((r) => Object.keys(r.answers).length)
      .sort((a, b) => (b.seq || 0) - (a.seq || 0) || b.openedAt - a.openedAt);
  }

  /** How many questions in a row the player handed in just before `rec`. */
  streakBefore(pid, rec) {
    let n = 0;
    for (const r of this.answeredRecords()) {
      if (r === rec || (r.seq || 0) > (rec.seq || 0)) continue;
      if (!r.answers[pid]) break;
      n++;
    }
    return n;
  }

  /** The player's current run of handed-in questions (an open question doesn't break it yet). */
  streak(pid) {
    let n = 0;
    for (const r of this.answeredRecords()) {
      if (r.answers[pid]) n++;
      else if (r.status === 'open') continue;
      else break;
    }
    return n;
  }

  breakdown(q, a, rec = null, pid = null) {
    const steps = [{ label: 'Handed in', chips: 10 }];
    // Bonuses for showing up, not for being right: a hand-in streak and the team bonus.
    const run = rec && pid ? this.streakBefore(pid, rec) : 0;
    if (run) steps.push({ label: `${run + 1} in a row`, chips: streakChips(run) });
    if (rec?.fullHouse) steps.push({ label: 'Everyone handed in', chips: FULL_HOUSE_CHIPS });
    if (q.scored) {
      if (a.auto?.choice === 'right') steps.push({ label: 'Right answer', chips: 30 });
      if (a.auto?.choice === 'partial') steps.push({ label: 'Half right', chips: 15 });
      if (a.auto?.reason === true) steps.push({ label: 'Right reason', chips: 15 });
      if (a.auto?.rows) {
        const right = a.auto.rows.filter((r) => r === true).length;
        if (right) steps.push({ label: `${right}/${a.auto.rows.length} rows right`, chips: right * 10 });
      }
      if (a.ai && this.needsAi(q)) {
        if (a.ai.score) steps.push({ label: `Answer ${a.ai.score}/3`, chips: a.ai.score * 15 });
        const parts = (q.kind === 'text' ? q.parts : q.text?.parts) || [];
        const marked = parseMarks(a.text);
        const good = parts.map((_, i) => i + 1).filter((n) => marked[n] && a.ai.parts?.[n] === true);
        if (good.length) steps.push({ label: `Parts marked ${good.map((n) => '①②③④⑤⑥⑦⑧⑨'[n - 1]).join('')}`, mult: good.length * 0.5 });
      }
    }
    const chips = steps.reduce((s, x) => s + (x.chips || 0), 0);
    const mult = 1 + steps.reduce((s, x) => s + (x.mult || 0), 0);
    return { steps, chips, mult, total: Math.round(chips * mult) };
  }

  reveal() {
    const rec = this.live;
    if (!rec) return;
    if (rec.status === 'open') this.close();
    const q = rec.def;
    for (const e of Object.values(rec.answers)) {
      const a = e.attempts.at(-1);
      if (a.state === 'submitted' && !this.needsAi(q)) this.autoScore(q, a);
      if (a.state === 'submitted' && this.needsAi(q) && !a.ai) continue; // not scored yet: stays hidden
      const before = Math.max(0, ...e.attempts.slice(0, -1).filter((x) => x.state === 'revealed').map((x) => x.points || 0));
      a.breakdown = this.breakdown(q, a, rec, e.id);
      a.points = a.breakdown.total;
      if (a.n > 1 && a.state !== 'revealed' && a.points > before) a.improved = true;
      a.state = 'revealed';
    }
    rec.status = 'revealed';
    rec.revealedAt = now();
    this.mode = 'review';
    const before = this.classLevel;
    this.recount();
    if (this.classLevel > before) {
      const l = CLASS_LEVELS[this.classLevel - 1];
      this.fx({ t: 'level', level: this.classLevel, id: l.id, name: l.name, text: l.text });
    }
    this.changed();
  }

  recount() {
    for (const p of this.players.values()) {
      p.points = 0;
      p.improved = 0;
    }
    for (const rec of Object.values(this.records))
      for (const e of Object.values(rec.answers)) {
        const p = this.players.get(e.id);
        if (!p) continue;
        const shown = e.attempts.filter((a) => a.state === 'revealed');
        if (!shown.length) continue;
        p.points += Math.max(...shown.map((a) => a.points || 0));
        if (shown.some((a) => a.improved)) p.improved += 1;
      }
    this.classLevel = this.klass().level;
  }

  /** The class goal: all points together, and what the room has earned so far. */
  klass() {
    const ps = [...this.players.values()];
    return classProgress(ps.reduce((s, p) => s + p.points, 0), ps.length, this.classLevel);
  }

  /** The closing ceremony: podium, improvers, the longest hand-in streaks. */
  setFinale(on) {
    this.finale = !!on;
    this.spotlight = null;
    this.changed();
  }

  finaleView() {
    const ps = [...this.players.values()];
    const card = (p, extra = {}) => ({ id: p.id, name: p.name, avatar: p.avatar, hat: p.hat || '', ...extra });
    const runs = ps.map((p) => ({ p, n: this.streak(p.id) })).filter((x) => x.n >= 2);
    const best = Math.max(0, ...runs.map((x) => x.n));
    return {
      podium: [...ps].filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((p) => card(p, { points: p.points })),
      improved: ps.filter((p) => p.improved > 0).sort((a, b) => b.improved - a.improved).slice(0, 5).map((p) => card(p, { improved: p.improved })),
      streak: { n: best, players: runs.filter((x) => x.n === best).slice(0, 8).map((x) => card(x.p)), more: Math.max(0, runs.filter((x) => x.n === best).length - 8) },
      answers: Object.values(this.records).reduce((s, r) => s + Object.keys(r.answers).length, 0),
      questions: this.answeredRecords().length,
    };
  }

  setSpotlight(pid) {
    this.spotlight = pid && this.current ? { qkey: this.current, pid } : null;
    this.changed();
  }

  // ---- views ----------------------------------------------------------------
  publicQuestion(rec, forTeacher = false) {
    if (!rec) return null;
    const q = rec.def;
    const online = this.online();
    const entries = Object.values(rec.answers);
    const out = {
      key: q.key,
      kind: q.kind,
      title: q.title,
      prompt: q.prompt,
      context: q.context,
      parts: q.parts,
      slide: q.slide,
      scored: q.scored,
      status: rec.status,
      timerEndsAt: rec.status === 'open' ? rec.timerEndsAt || null : null,
      fullHouse: !!rec.fullHouse,
      submitted: entries.filter((e) => this.players.get(e.id)).length,
      online: online.length,
      waitingFor: online.filter((p) => !rec.answers[p.id]).map((p) => p.name),
    };
    if (q.kind === 'choice') {
      out.options = q.options;
      out.order = optionOrder(q);
      out.zones = q.zones;
      out.reasons = q.reasons ? { options: q.reasons.options } : null;
      out.text = q.text ? { prompt: q.text.prompt, parts: q.text.parts } : null;
    }
    if (q.kind === 'grid') {
      out.options = q.options;
      out.rows = q.rows.map((r) => ({ text: r.text, options: r.options }));
    }
    const revealed = rec.status === 'revealed';
    if (revealed || forTeacher) {
      if (q.kind === 'choice') {
        out.counts = q.options.map((_, i) => entries.filter((e) => e.attempts[0]?.choice === i).length);
        out.correct = q.correct;
        if (q.reasons) out.reasonsCorrect = q.reasons.correct;
      }
      if (q.kind === 'grid') {
        out.rowCorrect = q.rows.map((r) => r.correct);
        out.rowStats = q.rows.map((r, i) =>
          (r.options || q.options).map((_, o) => entries.filter((e) => e.attempts[0]?.grid?.[i] === o).length),
        );
      }
    }
    if (revealed) {
      out.wall = entries
        .map((e) => {
          const p = this.players.get(e.id);
          const shown = e.attempts.filter((a) => a.state === 'revealed');
          const a = shown.at(-1);
          if (!p || !a) return null;
          return {
            pid: e.id,
            name: p.name,
            avatar: p.avatar,
            text: a.text,
            choice: a.choice,
            points: Math.max(...shown.map((x) => x.points || 0)),
            score: a.ai?.score ?? null,
            improved: shown.some((x) => x.improved),
          };
        })
        .filter(Boolean)
        .sort((x, y) => y.points - x.points);
    }
    return out;
  }

  board() {
    const ps = [...this.players.values()];
    return {
      top: [...ps].sort((a, b) => b.points - a.points).slice(0, 5).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, points: p.points })),
      improved: ps.filter((p) => p.improved > 0).sort((a, b) => b.improved - a.improved).slice(0, 5).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, improved: p.improved })),
    };
  }

  baseView() {
    const rec = this.live;
    let spotlight = null;
    if (this.spotlight) {
      const r = this.records[this.spotlight.qkey];
      const a = r?.answers[this.spotlight.pid]?.attempts.at(-1);
      const p = this.players.get(this.spotlight.pid);
      if (a && p) spotlight = { pid: p.id, name: p.name, avatar: p.avatar, text: a.text, choice: a.choice, question: r.def.title };
    }
    return {
      mode: this.mode,
      seatingEndsAt: this.seatingEndsAt,
      serverNow: now(),
      screen: this.screen,
      lessonTitle: this.lesson.title,
      slideCount: this.lesson.slides.length,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        online: p.online > 0,
        points: p.points,
        improved: p.improved,
        hat: p.hat || '',
        seat: p.seat,
        x: p.x,
        y: p.y,
        dir: p.dir,
      })),
      question: this.publicQuestion(rec),
      board: this.board(),
      spotlight,
      klass: this.klass(),
      ball: [+this.ball.x.toFixed(2), +this.ball.y.toFixed(2)],
      finale: this.finale ? this.finaleView() : null,
    };
  }

  studentView(p) {
    const v = this.baseView();
    v.deckUrl = this.deckUrl;
    const rec = this.live;
    const entry = rec?.answers[p.id];
    v.me = { id: p.id, name: p.name, avatar: p.avatar, points: p.points, improved: p.improved, hat: p.hat || '', streak: this.streak(p.id), lost: !!p.lostAt };
    if (entry) {
      const a = entry.attempts.at(-1);
      v.mine = {
        attempt: a.n,
        state: a.state,
        text: a.text,
        choice: a.choice,
        reason: a.reason,
        grid: a.grid,
        canRetry: rec.status === 'revealed' && this.canRetry(rec, entry),
      };
      if (a.state === 'revealed') {
        v.mine.breakdown = a.breakdown;
        v.mine.feedback = a.ai?.feedback || '';
        v.mine.missed = a.ai?.missed || null;
        v.mine.auto = a.auto;
        v.mine.improved = !!a.improved;
      }
    }
    return v;
  }

  screenView() {
    const v = this.baseView();
    v.deckUrl = this.projectorUrl;
    return v;
  }

  teacherView() {
    const v = this.baseView();
    v.projectorUrl = this.projectorUrl;
    const rec = this.live;
    v.deckUrl = this.deckUrl;
    v.notesUrl = this.notesUrl;
    v.aiMode = this.aiMode;
    v.scoring = this.scoring;
    v.slides = this.lesson.slides;
    v.lost = [...this.players.values()].filter((p) => p.online > 0 && p.lostAt && now() - p.lostAt < 5 * 60000).map((p) => p.name);
    v.questions = this.lesson.order.map((k) => {
      const q = this.lesson.questions[k];
      const r = this.records[k];
      return { key: k, title: q.title, kind: q.kind, slide: q.slide, status: r?.status || null, answers: r ? Object.keys(r.answers).length : 0 };
    });
    if (rec) {
      v.question = this.publicQuestion(rec, true);
      v.question.scoringError = rec.scoringError || null;
      v.question.def = rec.def;
      const list = Object.values(rec.answers).map((e) => {
        const a = e.attempts.at(-1);
        const p = this.players.get(e.id);
        return {
          pid: e.id,
          name: p?.name || '(left)',
          attempt: a.n,
          state: a.state,
          text: a.text,
          choice: a.choice,
          reason: a.reason,
          grid: a.grid,
          flags: a.flags || [],
          ai: a.ai || null,
          auto: a.auto || null,
          points: a.points ?? null,
          at: a.at,
        };
      });
      v.answers = list.sort((x, y) => x.at - y.at);
      v.picks = spotlightPicks(rec.def, list.map((a) => ({ id: a.pid, text: a.text, flags: a.flags })));
    }
    return v;
  }

  positions() {
    return [...this.players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), p.dir, p.moving ? 1 : 0, p.online > 0 ? 1 : 0]);
  }

  /** Pick up a saved session after a crash or restart: players keep their tokens. */
  restore(data) {
    for (const p of data.players || []) {
      const player = { hat: '', ...p, online: 0, moving: false, emoteAt: 0, lostAt: 0 };
      this.players.set(p.id, player);
      if (p.token) this.byToken.set(p.token, p.id);
    }
    this.records = data.records || {};
    this.nextId = data.nextId || this.players.size + 1;
    // Older session files have no question order: rebuild it from the opening times.
    Object.values(this.records).sort((a, b) => a.openedAt - b.openedAt).forEach((r, i) => (r.seq = r.seq || i + 1));
    this.seq = Math.max(0, ...Object.values(this.records).map((r) => r.seq));
    this.classLevel = data.classLevel || 0;
    this.recount();
  }

  async save() {
    await mkdir(this.dataDir, { recursive: true });
    const data = {
      savedAt: new Date().toISOString(),
      lesson: this.lesson.title,
      players: [...this.players.values()].map(({ online: _o, emoteAt: _e, lostAt: _l, ...p }) => p),
      nextId: this.nextId,
      classLevel: this.classLevel,
      records: this.records,
    };
    await writeFile(this.sessionFile, JSON.stringify(data, null, 2));
  }
}
