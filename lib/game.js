// The room state and every rule. The server is the only source of truth:
// clients send intentions, the game decides and everyone gets the result.

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAnswer, spotlightPicks, answerText } from './checks.js';
import { scoreAnswers } from './ai.js';
import { normaliseQuestion } from './manifest.js';
import { parseMarks } from '../public/js/marks.js';
import { SEATS, SPAWN, clampToFloor, seatAt, zoneAt, optionOrder } from '../public/js/world.js';

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
    this.sessionFile = join(dataDir, `session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
    this.nextId = 1;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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
    return true; // positions travel on the fast tick, not as a full state change
  }

  online() {
    return [...this.players.values()].filter((p) => p.online > 0);
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
    this.mode = mode;
    this.changed();
  }

  takeSeats(seconds = 20) {
    clearTimeout(this.seatTimer);
    this.mode = 'seating';
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
    const rec = this.records[def.key] || { key: def.key, def, answers: {}, openedAt: now(), log: [] };
    rec.def = def;
    rec.status = 'open';
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

  breakdown(q, a) {
    const steps = [{ label: 'Handed in', chips: 10 }];
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
      a.breakdown = this.breakdown(q, a);
      a.points = a.breakdown.total;
      if (a.n > 1 && a.state !== 'revealed' && a.points > before) a.improved = true;
      a.state = 'revealed';
    }
    rec.status = 'revealed';
    rec.revealedAt = now();
    this.mode = 'review';
    this.recount();
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
      if (a && p) spotlight = { name: p.name, avatar: p.avatar, text: a.text, choice: a.choice, question: r.def.title };
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
        seat: p.seat,
        x: p.x,
        y: p.y,
        dir: p.dir,
      })),
      question: this.publicQuestion(rec),
      board: this.board(),
      spotlight,
    };
  }

  studentView(p) {
    const v = this.baseView();
    v.deckUrl = this.deckUrl;
    const rec = this.live;
    const entry = rec?.answers[p.id];
    v.me = { id: p.id, name: p.name, avatar: p.avatar, points: p.points, improved: p.improved };
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
      const player = { ...p, online: 0, moving: false };
      this.players.set(p.id, player);
      if (p.token) this.byToken.set(p.token, p.id);
    }
    this.records = data.records || {};
    this.nextId = data.nextId || this.players.size + 1;
    this.recount();
  }

  async save() {
    await mkdir(this.dataDir, { recursive: true });
    const data = {
      savedAt: new Date().toISOString(),
      lesson: this.lesson.title,
      players: [...this.players.values()].map(({ online: _o, ...p }) => p),
      nextId: this.nextId,
      records: this.records,
    };
    await writeFile(this.sessionFile, JSON.stringify(data, null, 2));
  }
}
