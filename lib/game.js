// The room state and its rules. The server is the only source of truth:
// clients send intentions ("move here", "this is my answer"), the game decides,
// and everyone gets the result.
//
// What lives where:
//   game.js     this file: players, rooms and doors, room modes, the question life cycle
//   scoring.js  how an answer becomes points
//   views.js    what each role (student, teacher, projector) gets to see
//   asks.js     the questions board
//   term.js     what carries over between lessons
//   checks.js   fast flags for the teacher · ai.js  the 0–3 score suggestions

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAnswer, answerText } from './checks.js';
import { scoreAnswers } from './ai.js';
import { normaliseQuestion } from './manifest.js';
import { needsAi, autoScore, canRetry, breakdown } from './scoring.js';
import { AskBoard } from './asks.js';
import { emptyTerm, termKey, saveTerm } from './term.js';
import * as views from './views.js';
import { TROPHY_SLOTS, zoneAt, optionOrder, lineValue } from '../public/js/world.js';
import { ROOMS, BASE, SPAWN, HOT_SEAT, canStand, nearestFree, arrivalSpots, seatAt, seatPairs, nearDoor } from '../public/js/rooms.js';
import { EMOTE_IDS, EMOTE_GAP_MS, HATS, hatUnlocked, CLASS_LEVELS, classProgress, ASK_CHIPS, ASK_CHIPS_MAX } from '../public/js/fun.js';

const now = () => Date.now();
const AVATARS = 8;
const NAME_MAX = 24;
const MODES = ['free', 'seating', 'present', 'question', 'review'];
const DIRS = ['up', 'down', 'left', 'right'];
const DOOR_SECONDS = 10; // how long the door stays open before everyone is moved along
const BALL_HOME = ROOMS[BASE].ballHome;

/**
 * The submit gate: thrown when the teacher tries to move on while students are
 * still writing. The teacher page answers with a "move on anyway" button, which
 * repeats the action with `force`.
 */
export class GateError extends Error {
  constructor(names) {
    super(`${names.length} still writing: ${names.join(', ')}`);
    this.gate = true;
    this.waitingFor = names;
  }
}

export class Game {
  constructor({ lesson, dataDir, aiMode, deckUrl, notesUrl, projectorUrl, term = emptyTerm(), termFile = null, gate = true, log = console.log }) {
    this.lesson = lesson;
    this.dataDir = dataDir;
    this.aiMode = aiMode;
    this.log = log;
    this.gate = gate; // false: the teacher can always move on without the override

    this.players = new Map(); // id -> player
    this.byToken = new Map(); // token -> id
    this.nextId = 1;

    this.mode = 'free';
    this.seatingEndsAt = null;
    this.seatTimer = null;

    this.room = BASE; // the room the whole class is in
    this.door = null; // { to, endsAt, then }: the door is open and the class is walking through
    this.doorTimer = null;

    this.deckUrl = deckUrl || '';
    this.notesUrl = notesUrl || '';
    this.projectorUrl = projectorUrl || deckUrl || '';
    this.screen = { url: this.deckUrl, slide: this.deckUrl ? 1 : null, cue: 0 };

    this.records = {}; // question key -> record (definition, answers, status)
    this.current = null; // key of the live question
    this.seq = 0; // order in which questions were first opened (for streaks)
    this.scoring = false;
    this.spotlight = null; // { qkey, pid }: one answer on the projector, its author on the hot seat

    this.asks = new AskBoard();
    this.showAsks = false; // the top questions are on the projector

    this.term = term; // points and trophies from earlier lessons
    this.termFile = termFile;
    this.shelf = [...term.trophies]; // every trophy in the room, oldest first

    this.classLevel = 0; // highest class level reached; never goes back down
    this.finale = false;
    this.ball = { ...BALL_HOME, vx: 0, vy: 0 };

    this.listeners = new Set();
    this.fxListeners = new Set();
    this.sessionFile = join(dataDir, `session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
  }

  // ---- telling the server what changed ----------------------------------------------

  /** Called (a moment later, once) after any change: the server sends everyone a fresh view. */
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

  /** Something changed: tell the listeners soon, and save the session file a little later. */
  changed() {
    clearTimeout(this._emit);
    this._emit = setTimeout(() => this.listeners.forEach((fn) => fn()), 30);
    clearTimeout(this._save);
    this._save = setTimeout(() => this.save().catch((e) => this.log('save failed:', e.message)), 800);
  }

  // ---- players ----------------------------------------------------------------------

  cleanName(name) {
    return String(name || '').trim().slice(0, NAME_MAX);
  }

  nameTaken(name, except = null) {
    return [...this.players.values()].some((p) => p !== except && p.name.toLowerCase() === name.toLowerCase());
  }

  join(name, avatar) {
    name = this.cleanName(name);
    if (!name) throw new Error('Pick a name');
    if (this.nameTaken(name)) throw new Error('That name is taken: add an initial');
    const before = this.term.players[termKey(name)]; // points from earlier lessons, by name
    const p = {
      id: `p${this.nextId++}`,
      token: randomBytes(12).toString('hex'),
      name,
      avatar: Math.max(0, Math.min(AVATARS - 1, Number(avatar) || 0)),
      ...nearestFree(this.room, SPAWN.x + (Math.random() * 6 - 3), SPAWN.y, this.unlocked()), // by the screen, not inside a desk
      dir: 'down',
      moving: false,
      seat: -1,
      gone: false, // walked through the open door, waiting for the others
      online: 0, // open connections (a student may have two tabs)
      points: 0, // today's points
      improved: 0, // today's answers improved on a retry
      carried: before?.points || 0,
      carriedImproved: before?.improved || 0,
      hat: '',
      warp: 0, // goes up each time the server moves this player
      emoteAt: 0,
      lostAt: 0,
    };
    if (this.mode === 'present') this.sit(p);
    this.players.set(p.id, p);
    this.byToken.set(p.token, p.id);
    this.changed();
    return p;
  }

  player(token) {
    const id = this.byToken.get(token);
    return id ? this.players.get(id) : null;
  }

  setOnline(p, delta) {
    p.online = Math.max(0, p.online + delta);
    this.changed();
  }

  online() {
    return [...this.players.values()].filter((p) => p.online > 0);
  }

  rename(id, name) {
    const p = this.players.get(id);
    name = this.cleanName(name);
    if (!p || !name) return;
    if (this.nameTaken(name, p)) throw new Error('That name is taken');
    p.name = name;
    this.changed();
  }

  kick(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.spotlight?.pid === id) this.spotlight = null;
    this.players.delete(id);
    this.byToken.delete(p.token);
    this.changed();
  }

  /** A student walks. Positions travel on the server's fast tick, not as a full state change. */
  move(p, x, y, dir, moving, warp) {
    if (this.mode === 'present' || p.gone) return false; // locked in their seat, or already through the door
    // The browser echoes the last `warp` it saw. An older number means this move was
    // sent before the browser knew the server had put the player somewhere else.
    if (warp !== undefined && Number(warp) !== p.warp) return false;
    // The browser already walks around furniture; a spot inside a desk or off the floor is refused.
    x = Number(x) || 0;
    y = Number(y) || 0;
    if (!canStand(this.room, x, y, this.unlocked())) return false;
    p.x = x;
    p.y = y;
    p.dir = DIRS.includes(dir) ? dir : p.dir;
    p.moving = !!moving;
    p.seat = seatAt(this.room, x, y);
    if (p.moving) this.kickBall(p);
    if (this.door && nearDoor(x, y)) this.goThrough(p);
    return true;
  }

  /** The server puts a player somewhere (a seat, the hot seat). Their browser follows. */
  place(p, x, y, dir) {
    p.x = x;
    p.y = y;
    p.dir = dir;
    p.moving = false;
    p.seat = seatAt(this.room, x, y);
    p.warp += 1;
  }

  /** Totals over the term: earlier lessons plus today. Hats unlock on these. */
  termTotals(p) {
    return { points: p.carried + p.points, improved: p.carriedImproved + p.improved };
  }

  // ---- fun: emotes, hops, hats ------------------------------------------------------

  /** A reaction bubble or a hop. Fixed list, rate-limited; "lost" also reaches the teacher. */
  emote(p, e) {
    const hop = e === 'hop';
    if (!hop && !EMOTE_IDS.includes(e)) throw new Error('Unknown emote');
    if (hop && this.mode === 'present') return false; // seated: no hopping during explanations
    if (now() - p.emoteAt < (hop ? 400 : EMOTE_GAP_MS)) return false;
    p.emoteAt = now();
    this.fx({ t: hop ? 'hop' : 'emote', id: p.id, e });
    if (e === 'lost' || (e === 'yes' && p.lostAt)) {
      p.lostAt = e === 'lost' ? now() : 0; // "Got it" clears "I'm lost"
      this.changed();
    }
    return true;
  }

  clearLost() {
    for (const p of this.players.values()) p.lostAt = 0;
  }

  /** Wear a hat you have unlocked ('' takes it off). */
  setHat(p, id) {
    if (id) {
      const hat = HATS.find((x) => x.id === id);
      if (!hat) throw new Error('Unknown hat');
      if (!hatUnlocked(hat, this.termTotals(p))) throw new Error('Not unlocked yet');
    }
    p.hat = id || '';
    this.changed();
  }

  // ---- the break-time ball (a class reward) -----------------------------------------

  /** The ball only rolls in the classroom, in free roam, once the class has earned the games corner. */
  ballOn() {
    return this.room === BASE && this.mode === 'free' && this.unlocked().includes('games');
  }

  /** Walking into the ball sends it off, away from the player. */
  kickBall(p) {
    if (!this.ballOn()) return;
    const b = this.ball;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.8) return;
    const facing = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.dir] || [0, 1];
    const [ux, uy] = d > 0.1 ? [dx / d, dy / d] : facing;
    b.vx = ux * 9;
    b.vy = uy * 9;
  }

  /** Called by the server ten times a second. Returns true while the ball is moving. */
  stepBall(dt) {
    const b = this.ball;
    if (!b.vx && !b.vy) return false;
    if (!this.ballOn()) {
      Object.assign(b, BALL_HOME, { vx: 0, vy: 0 }); // back to its corner
      return true;
    }
    // Move sideways, then up or down; whatever is in the way (a wall, a desk) bounces it back.
    const free = (x, y) => canStand(BASE, x, y, this.unlocked());
    if (free(b.x + b.vx * dt, b.y)) b.x += b.vx * dt;
    else b.vx = -b.vx;
    if (free(b.x, b.y + b.vy * dt)) b.y += b.vy * dt;
    else b.vy = -b.vy;
    // friction, then a full stop
    b.vx *= 0.86;
    b.vy *= 0.86;
    if (Math.hypot(b.vx, b.vy) < 0.4) b.vx = b.vy = 0;
    return true;
  }

  // ---- room modes -------------------------------------------------------------------

  /** Seat a player: their own chair if they stand on a free one, else the nearest free chair. */
  sit(p) {
    const seats = ROOMS[this.room].seats;
    const taken = new Set([...this.players.values()].filter((o) => o !== p && o.seat >= 0).map((o) => o.seat));
    let seat = seatAt(this.room, p.x, p.y);
    if (seat < 0 || taken.has(seat)) {
      seat = -1;
      let nearest = Infinity;
      seats.forEach((s, i) => {
        const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
        if (!taken.has(i) && d < nearest) {
          nearest = d;
          seat = i;
        }
      });
    }
    if (seat >= 0) this.place(p, seats[seat].x, seats[seat].y, 'up');
  }

  setMode(mode, { force = false } = {}) {
    if (!MODES.includes(mode)) throw new Error('Unknown mode');
    if (mode === 'present') this.checkGate(force); // the slides would cover an open question
    clearTimeout(this.seatTimer);
    this.seatingEndsAt = null;
    if (mode === 'present') {
      this.closeDoor();
      if (this.room !== BASE) this.enter(BASE); // explanations always happen in the classroom
      for (const p of this.players.values()) p.back = null; // nobody returns to the hot seat's "before"
      for (const p of this.players.values()) this.sit(p);
    }
    this.finale = false;
    this.mode = mode;
    this.changed();
  }

  /** A countdown to walk to a chair; when it ends everyone is seated and the slides fill the screen. */
  takeSeats(seconds = 20, { force = false } = {}) {
    this.checkGate(force);
    // From another room, "take your seat" is the walk back through the door.
    if (this.room !== BASE) return this.openDoor(BASE, seconds, { force: true, then: { present: true } });
    clearTimeout(this.seatTimer);
    this.mode = 'seating';
    this.finale = false;
    this.seatingEndsAt = now() + seconds * 1000;
    this.seatTimer = setTimeout(() => this.setMode('present', { force: true }), seconds * 1000);
    this.changed();
  }

  // ---- rooms and the door ---------------------------------------------------------------

  /** The class rewards in the room right now (some are furniture: they are solid). */
  unlocked() {
    return this.klass().unlocked;
  }

  /**
   * Open the door to another room. The whole class goes together: students have
   * `seconds` to walk through, then anyone still here is moved along.
   * `then` says what happens on arrival: { open: question } or { present: true }.
   */
  openDoor(to, seconds = DOOR_SECONDS, { force = false, then = null } = {}) {
    if (!ROOMS[to]) throw new Error('Unknown room');
    this.checkGate(force);
    if (to === this.room) return;
    this.closeDoor();
    this.finale = false;
    this.door = { to, endsAt: now() + seconds * 1000, then };
    this.doorTimer = setTimeout(() => this.arrive(), seconds * 1000);
    this.changed();
  }

  closeDoor() {
    clearTimeout(this.doorTimer);
    this.door = null;
    for (const p of this.players.values()) p.gone = false;
  }

  /** A student reached the open door. When the last one is through, nobody has to wait. */
  goThrough(p) {
    p.gone = true;
    p.moving = false;
    if (this.online().every((o) => o.gone)) this.arrive();
    else this.changed();
  }

  /** The countdown ended (or everyone is through): the class is in the next room. */
  arrive() {
    const door = this.door;
    if (!door) return;
    this.closeDoor();
    this.enter(door.to);
    if (door.then?.open) this.open(door.then.open, { force: true, travel: false });
    if (door.then?.present) this.setMode('present', { force: true });
    this.changed();
  }

  /** Put everyone in `roomId`, fanned out from the door. */
  enter(roomId) {
    this.setSpotlight(null);
    this.room = roomId;
    const players = [...this.players.values()];
    const spots = arrivalSpots(roomId, players.length, this.unlocked());
    players.forEach((p, i) => {
      p.back = null;
      this.place(p, spots[i].x, spots[i].y, 'down');
    });
    this.changed();
  }

  // ---- the shared screen ------------------------------------------------------------

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
    // Break slides open the room; the teacher still decides everything else.
    if (this.lesson.slides[n - 1]?.mode === 'gate' && this.mode === 'present') this.setMode('free');
    this.changed();
  }

  /** Reveal the next step on the current slide (the deck's E key). */
  cue() {
    this.screen = { ...this.screen, cue: (this.screen.cue || 0) + 1 };
    this.changed();
  }

  // ---- questions: open → hand in → close → score → reveal → retry ---------------------

  get live() {
    return this.current ? this.records[this.current] : null;
  }

  questionDef(key) {
    return this.records[key]?.def || this.lesson.questions[key] || null;
  }

  /** Online students who have not handed in the open question yet. */
  stillWriting(rec = this.live) {
    if (!rec || rec.status !== 'open') return [];
    return this.online().filter((p) => !rec.answers[p.id]);
  }

  /** The submit gate: moving on waits for everyone, unless the teacher overrides. */
  checkGate(force) {
    if (force || !this.gate) return;
    const names = this.stillWriting().map((p) => p.name);
    if (names.length) throw new GateError(names);
  }

  /**
   * Open a lesson question by key, or a question the teacher typed on the spot.
   * A question that names another room opens the door first and starts on arrival.
   */
  open(keyOrDef, { force = false, travel = true } = {}) {
    const def = typeof keyOrDef === 'string' ? this.questionDef(keyOrDef) : normaliseQuestion(keyOrDef.key || `live-${Object.keys(this.records).length + 1}`, keyOrDef);
    if (!def) throw new Error('Unknown question');
    if (this.live && this.live.key !== def.key && this.live.status === 'open') this.close({ force }); // one question at a time
    if (travel && def.room && def.room !== this.room) return this.openDoor(def.room, DOOR_SECONDS, { force: true, then: { open: keyOrDef } });
    this.closeDoor();

    const rec = this.records[def.key] || { key: def.key, def, answers: {}, openedAt: now(), seq: ++this.seq };
    rec.def = def;
    rec.status = 'open';
    rec.timerEndsAt = null;
    rec.exampleShown = false;
    if (def.pairs && !rec.groups) rec.groups = this.makePairs();
    this.records[def.key] = rec;
    this.current = def.key;

    this.setSpotlight(null);
    this.finale = false;
    clearTimeout(this.seatTimer);
    this.seatingEndsAt = null;
    this.mode = 'question';
    this.changed();
    return rec;
  }

  /**
   * Pair work: put the students who are online in twos (an odd one out makes a
   * three), and seat each pair side by side if the room has seats.
   * Returns the groups as lists of player ids.
   */
  makePairs() {
    const ids = this.online().map((p) => p.id).sort(() => Math.random() - 0.5);
    const groups = [];
    while (ids.length) groups.push(ids.splice(0, ids.length === 3 ? 3 : 2));
    const tables = seatPairs(this.room);
    groups.forEach((group, i) => {
      if (!tables[i]) return;
      group.slice(0, 2).forEach((id, k) => this.place(this.players.get(id), tables[i][k].x, tables[i][k].y, 'up'));
    });
    return groups;
  }

  /** The player ids that share an answer with `pid` on this question, `pid` first. */
  groupOf(rec, pid) {
    const group = rec.groups?.find((g) => g.includes(pid));
    return group ? [pid, ...group.filter((id) => id !== pid)] : [pid];
  }

  /** A student hands in (or, after the reveal, retries). In pair work it counts for the whole pair. */
  submit(p, body) {
    const rec = this.live;
    if (!rec) throw new Error('No question is open');
    const q = rec.def;
    const group = this.groupOf(rec, p.id);
    const entry = rec.answers[p.id] || { id: p.id, attempts: [] };
    const isRetry = rec.status === 'revealed';
    if (isRetry && !canRetry(q, entry)) throw new Error('No retry available');
    if (!isRetry && rec.status !== 'open') throw new Error('This question is closed');

    const attempt = {
      n: isRetry ? entry.attempts.length + 1 : 1,
      at: now(),
      text: typeof body.text === 'string' ? body.text.slice(0, 4000) : '',
      // How it was typed, as reported by the browser. Only used for flags, never for points.
      meta: {
        pastedChars: Math.max(0, Number(body.meta?.pastedChars) || 0),
        activeMs: Math.max(0, Number(body.meta?.activeMs) || 0),
      },
      state: 'submitted', // → 'scored' → 'revealed'
    };

    if (q.kind === 'choice') {
      if (q.zones) {
        // Zone answers use where the player stands on the server, not what the browser claims.
        const order = optionOrder(q);
        const zone = zoneAt(order.length, p.x, p.y);
        if (zone < 0) throw new Error('Walk into a zone first');
        attempt.choice = order[zone];
      } else attempt.choice = Number(body.choice);
      if (!(attempt.choice >= 0 && attempt.choice < q.options.length)) throw new Error('Pick an option');
      if (q.reasons) attempt.reason = body.reason === undefined || body.reason === null ? null : Number(body.reason);
    }
    if (q.kind === 'grid') {
      const picked = Array.isArray(body.grid) ? body.grid : [];
      attempt.grid = q.rows.map((_, i) => (picked[i] === null || picked[i] === undefined ? null : Number(picked[i])));
    }
    if (q.kind === 'line') attempt.value = lineValue(p.x);
    if (q.kind === 'bug') {
      attempt.line = Number(body.line);
      if (!(attempt.line >= 1 && attempt.line <= q.code.split('\n').length)) throw new Error('Pick a line');
    }
    // Code runs only in the student's own browser, which reports which checks passed.
    // The server cannot verify that, so the teacher sees the code next to the result.
    if (q.kind === 'code') attempt.passed = q.tests.map((_, i) => body.passed?.[i] === true);

    const others = Object.values(rec.answers)
      .filter((e) => !group.includes(e.id))
      .map((e) => ({ id: e.id, name: this.players.get(e.id)?.name || '?', text: e.attempts.at(-1).text }));
    attempt.flags = checkAnswer(q, { id: p.id, text: attempt.text, meta: attempt.meta }, others);
    if (!needsAi(q)) this.markByRule(q, attempt);

    // Before the close, changing your mind replaces the answer; after the reveal, a retry is a new attempt.
    // Every member of a pair gets their own copy, so each keeps their own points and streak.
    for (const id of group) {
      const mine = rec.answers[id] || { id, attempts: [] };
      const copy = { ...attempt, by: p.id };
      if (isRetry) mine.attempts.push(copy);
      else mine.attempts = [copy];
      rec.answers[id] = mine;
    }

    if (!rec.allInAt && !this.stillWriting(rec).length) rec.allInAt = now(); // for the session report
    this.fx({ t: 'handin', id: p.id });
    this.changed();
    return attempt;
  }

  markByRule(q, attempt) {
    attempt.auto = autoScore(q, attempt);
    if (attempt.state === 'submitted') attempt.state = 'scored';
  }

  close({ force = false } = {}) {
    const rec = this.live;
    if (!rec || rec.status !== 'open') return;
    this.checkGate(force);
    rec.status = needsAi(rec.def) ? 'closed' : 'scored';
    rec.closedAt = now();
    rec.timerEndsAt = null;
    // Team bonus: everyone in the room handed in before the close.
    const here = this.online();
    rec.present = here.length;
    rec.fullHouse = here.length >= 2 && here.every((p) => rec.answers[p.id]);
    this.changed();
  }

  /** Ask the AI for 0–3 score suggestions on every answer not scored yet (one batched call). */
  async score({ force = false } = {}) {
    const rec = this.live;
    if (!rec) throw new Error('No question');
    if (this.scoring) throw new Error('Already scoring');
    if (rec.status === 'open') this.close({ force });
    const q = rec.def;
    const pending = Object.values(rec.answers)
      .map((entry) => entry.attempts.at(-1))
      .filter((a) => a.state === 'submitted');
    for (const a of pending) a.auto = autoScore(q, a);
    if (!needsAi(q) || !pending.length) {
      if (rec.status !== 'revealed') rec.status = 'scored';
      this.changed();
      return;
    }

    this.scoring = true;
    rec.scoringError = null;
    this.changed();
    try {
      // Answers leave as a1, a2…: the AI never sees a name. A pair's shared answer goes once.
      const shared = new Map(); // "who handed in, when" -> the copies of that answer
      for (const a of pending) shared.set(`${a.by}:${a.at}`, [...(shared.get(`${a.by}:${a.at}`) || []), a]);
      const byAnon = new Map([...shared.values()].map((copies, i) => [`a${i + 1}`, copies]));
      const items = [...byAnon].map(([id, [a]]) => ({ id, text: answerText(a), choice: a.choice }));
      for (const r of await scoreAnswers(this.aiMode, q, items)) {
        for (const a of byAnon.get(r.id) || []) {
          a.ai = { score: r.score, parts: r.parts, missed: r.missed, feedback: r.feedback, by: this.aiMode };
          a.state = 'scored';
        }
      }
      if (rec.status !== 'revealed') rec.status = 'scored';
    } catch (e) {
      // Answers keep their state, so the teacher can score by hand or try again.
      rec.scoringError = e.message;
      this.log('scoring failed:', e.message);
    } finally {
      this.scoring = false;
      this.changed();
    }
  }

  /** The teacher's word is final: change a suggested score or the feedback. */
  setScore(pid, score, feedback) {
    const rec = this.live;
    if (!rec?.answers[pid]) return;
    let wasRevealed = false;
    for (const id of this.groupOf(rec, pid)) {
      const a = rec.answers[id]?.attempts.at(-1);
      if (!a) continue;
      a.ai = { parts: {}, missed: null, ...a.ai, score: Math.max(0, Math.min(3, Number(score) || 0)), edited: true };
      if (typeof feedback === 'string') a.ai.feedback = feedback.slice(0, 400);
      if (a.ai.score >= 2) a.ai.missed = null;
      if (a.state === 'submitted') {
        a.auto = autoScore(rec.def, a);
        a.state = 'scored';
      }
      wasRevealed ||= a.state === 'revealed';
    }
    if (wasRevealed) this.reveal(); // already out: show the corrected points
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

  /** Show everyone their points and put the answers on the projector. */
  reveal({ force = false } = {}) {
    const rec = this.live;
    if (!rec) return;
    if (rec.status === 'open') this.close({ force });
    const q = rec.def;
    for (const entry of Object.values(rec.answers)) {
      const a = entry.attempts.at(-1);
      if (a.state === 'submitted' && !needsAi(q)) this.markByRule(q, a);
      if (a.state === 'submitted') continue; // a written answer nobody scored yet stays hidden
      const bestBefore = Math.max(0, ...entry.attempts.slice(0, -1).map((x) => x.points || 0));
      a.breakdown = breakdown(q, a, { run: this.streakBefore(entry.id, rec), fullHouse: rec.fullHouse });
      a.points = a.breakdown.total;
      if (a.n > 1 && a.state !== 'revealed' && a.points > bestBefore) a.improved = true;
      a.state = 'revealed';
    }
    rec.status = 'revealed';
    rec.revealedAt = now();
    this.mode = 'review';
    this.recount();
    for (const t of this.lesson.trophies) if (t.after === rec.key) this.awardTrophy(t.id);
    this.changed();
  }

  /** After the reveal: put one sound answer (from the lesson manifest) on the projector, or take it off. */
  showExample(on) {
    const rec = this.live;
    if (!rec || rec.status !== 'revealed') return;
    rec.exampleShown = !!on;
    this.changed();
  }

  // ---- spotlight and the hot seat -----------------------------------------------------

  /**
   * Put one student's answer on the projector. Their avatar walks to the front
   * (the hot seat) and goes back when the spotlight moves on.
   */
  setSpotlight(pid) {
    const old = this.spotlight && this.players.get(this.spotlight.pid);
    if (old?.back) {
      if (this.mode !== 'present') this.place(old, old.back.x, old.back.y, 'up');
      old.back = null;
    }
    const p = pid ? this.players.get(pid) : null;
    this.spotlight = p && this.live?.answers[p.id] ? { qkey: this.current, pid: p.id } : null;
    if (this.spotlight && this.mode !== 'present' && !this.door) {
      p.back = { x: p.x, y: p.y };
      this.place(p, HOT_SEAT.x, HOT_SEAT.y, 'down');
    }
    this.changed();
  }

  /** Spotlight a random student among those who answered (and are in the room). */
  pickSpotlight() {
    const rec = this.live;
    const pool = Object.keys(rec?.answers || {}).filter((id) => this.players.get(id)?.online > 0 && id !== this.spotlight?.pid);
    if (!pool.length) throw new Error('Nobody to pick yet');
    this.setSpotlight(pool[Math.floor(Math.random() * pool.length)]);
  }

  // ---- the questions board -------------------------------------------------------------

  ask(p, text) {
    const item = this.asks.ask(p, text);
    this.changed();
    return item;
  }

  voteAsk(p, id) {
    this.asks.vote(p, id);
    this.recount(); // a voted question is worth a few points to its author
    this.changed();
  }

  moderateAsk(id, status) {
    this.asks.moderate(id, status);
    this.recount();
    this.changed();
  }

  setShowAsks(on) {
    this.showAsks = !!on;
    this.changed();
  }

  // ---- concept trophies ----------------------------------------------------------------

  /** The class earns a lesson trophy. It goes on the shelf and stays for the term. */
  awardTrophy(id) {
    const t = this.lesson.trophies.find((x) => x.id === id);
    if (!t) throw new Error('Unknown trophy');
    const key = `${this.lesson.title}:${t.id}`;
    if (this.shelf.some((x) => x.key === key)) return;
    // The deck's path, so the "where it was taught" link still works next week from another address.
    const deckPath = this.deckUrl ? new URL(this.deckUrl).pathname : '';
    this.shelf.push({ key, name: t.name, sprite: t.sprite, text: t.text, example: t.example, slide: t.slide, lesson: this.lesson.title, deckPath });
    if (this.shelf.length > TROPHY_SLOTS.length) this.shelf.shift(); // the shelf is full: the oldest makes room
    this.fx({ t: 'trophy', name: t.name, text: t.text });
    this.changed();
  }

  // ---- totals: points, streaks, the class goal -------------------------------------------

  /** Recompute every player's points from the records (the best revealed attempt of each question counts). */
  recount() {
    for (const p of this.players.values()) {
      p.points = Math.min(ASK_CHIPS_MAX, this.asks.upvotedBy(p.id) * ASK_CHIPS);
      p.improved = 0;
    }
    for (const rec of Object.values(this.records))
      for (const entry of Object.values(rec.answers)) {
        const p = this.players.get(entry.id);
        const shown = entry.attempts.filter((a) => a.state === 'revealed');
        if (!p || !shown.length) continue;
        p.points += Math.max(...shown.map((a) => a.points || 0));
        if (shown.some((a) => a.improved)) p.improved += 1;
      }
    const before = this.classLevel;
    this.classLevel = this.klass().level;
    if (this.classLevel > before) {
      const level = CLASS_LEVELS[this.classLevel - 1];
      this.fx({ t: 'level', level: this.classLevel, id: level.id, name: level.name, text: level.text });
    }
  }

  /** The class goal: all points together, and what the room has earned so far. */
  klass() {
    const ps = [...this.players.values()];
    return classProgress(ps.reduce((sum, p) => sum + p.points, 0), ps.length, this.classLevel);
  }

  /** Questions that got at least one answer, newest first. */
  answeredRecords() {
    return Object.values(this.records)
      .filter((r) => Object.keys(r.answers).length)
      .sort((a, b) => b.seq - a.seq);
  }

  /** How many questions in a row the player handed in just before `rec`. */
  streakBefore(pid, rec) {
    let n = 0;
    for (const r of this.answeredRecords()) {
      if (r.seq >= rec.seq) continue;
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
      else if (r.status !== 'open') break;
    }
    return n;
  }

  /** The closing ceremony on the projector. Any room change ends it. */
  setFinale(on) {
    this.finale = !!on;
    this.setSpotlight(null);
  }

  // ---- what each role sees (see views.js) -------------------------------------------------

  studentView(p) {
    return views.studentView(this, p);
  }

  teacherView() {
    return views.teacherView(this);
  }

  screenView() {
    return views.screenView(this);
  }

  /** The fast tick: [id, x, y, dir, moving, online] for every player. */
  positions() {
    return [...this.players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), p.dir, p.moving ? 1 : 0, p.online > 0 ? 1 : 0]);
  }

  // ---- the session file ---------------------------------------------------------------------

  /** Pick up a saved session after a crash or restart: players keep their tokens. */
  restore(data) {
    for (const saved of data.players || []) {
      const p = { hat: '', carried: 0, carriedImproved: 0, warp: 0, ...saved, online: 0, moving: false, gone: false, emoteAt: 0, lostAt: 0, back: null };
      Object.assign(p, nearestFree(BASE, p.x, p.y)); // a session saved before furniture was solid
      p.seat = seatAt(BASE, p.x, p.y);
      this.players.set(p.id, p);
      if (p.token) this.byToken.set(p.token, p.id);
    }
    this.records = data.records || {};
    this.nextId = data.nextId || this.players.size + 1;
    // Older session files have no question order: rebuild it from the opening times.
    Object.values(this.records)
      .sort((a, b) => a.openedAt - b.openedAt)
      .forEach((r, i) => (r.seq = r.seq || i + 1));
    this.seq = Math.max(0, ...Object.values(this.records).map((r) => r.seq));
    this.asks.restore(data.asks);
    for (const t of data.shelf || []) if (!this.shelf.some((x) => x.key === t.key)) this.shelf.push(t);
    this.classLevel = data.classLevel || 0;
    this.recount();
  }

  async save() {
    await mkdir(this.dataDir, { recursive: true });
    const data = {
      savedAt: new Date().toISOString(),
      lesson: this.lesson.title,
      // connection and timing details are not worth keeping
      players: [...this.players.values()].map(({ online: _o, emoteAt: _e, lostAt: _l, back: _b, gone: _g, ...p }) => p),
      nextId: this.nextId,
      classLevel: this.classLevel,
      records: this.records,
      asks: this.asks,
      shelf: this.shelf,
    };
    await writeFile(this.sessionFile, JSON.stringify(data, null, 2));

    // The term file: today's points on top of what each student brought in.
    if (!this.termFile) return;
    for (const p of this.players.values()) this.term.players[termKey(p.name)] = { name: p.name, ...this.termTotals(p) };
    this.term.trophies = this.shelf;
    await saveTerm(this.termFile, this.term);
  }
}
