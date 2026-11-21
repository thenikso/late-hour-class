// The room state and its rules. The server is the only source of truth:
// clients send intentions ("move here", "this is my answer"), the game decides,
// and everyone gets the result.
//
// What lives where:
//   game.js       this file: players, rooms and doors, room modes, spotlight, trophies, totals
//   questions.js  question life cycle, pair work, submit gate, retries and streaks
//   scoring.js    pure scoring rules: how an answer becomes points
//   views.js      what each role (student, teacher, projector) gets to see
//   asks.js       the questions board
//   session.js    atomic session save and restore
//   term.js       what carries over between lessons
//   checks.js     fast flags for the teacher · ai.js  the 0-3 score suggestions

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { AskBoard } from './asks.js';
import { emptyTerm, termKey } from './term.js';
import { restoreSession, saveSession } from './session.js';
import {
  GateError,
  stillWriting,
  checkGate,
  answeredRecords,
  streakBefore,
  streak,
  groupOf,
  pendingRetries,
  openQuestion,
  submitAnswer,
  closeQuestion,
  scoreQuestion,
  setAnswerScore,
  setQuestionTimer,
  revealQuestion,
  showExample,
} from './questions.js';
import * as views from './views.js';
import { TROPHY_SLOTS } from '../public/js/shared/world.js';
import { ROOMS, BASE, SPAWN, HOT_SEAT, canStand, nearestFree, arrivalSpots, seatAt, nearDoor } from '../public/js/shared/rooms.js';
import {
  AVATAR_NAMES,
  EMOTE_IDS,
  EMOTE_GAP_MS,
  HOP_GAP_MS,
  HATS,
  hatUnlocked,
  CLASS_LEVELS,
  classProgress,
  ASK_CHIPS,
  ASK_CHIPS_MAX,
} from '../public/js/shared/fun.js';
import { clamp } from '../public/js/shared/util.js';

export { GateError };

const now = () => Date.now();
const AVATARS = AVATAR_NAMES.length;
const NAME_MAX = 24;
const MODES = ['free', 'seating', 'present', 'question', 'review'];
const DIRS = ['up', 'down', 'left', 'right'];
const DOOR_SECONDS = 10; // how long the door stays open before everyone is moved along
const BALL_HOME = ROOMS[BASE].ballHome;

export class Game {
  constructor({
    lesson,
    dataDir,
    aiMode,
    deckUrl,
    notesUrl,
    projectorUrl,
    term = emptyTerm(),
    termFile = null,
    gate = true,
    maxPlayers = 120,
    log = console.log,
  }) {
    this.lesson = lesson;
    this.dataDir = dataDir;
    this.aiMode = aiMode;
    this.log = log;
    this.gate = gate; // false: the teacher can always move on without the override
    this.maxPlayers = maxPlayers;

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
    this.wallNames = false; // projector answer wall is anonymous by default so students feel safe drafting

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

  /** Stop all background timers (call on server shutdown or at the end of a test). */
  dispose() {
    clearTimeout(this._emit);
    clearTimeout(this._save);
    clearTimeout(this.seatTimer);
    clearTimeout(this.doorTimer);
  }

  // ---- players ----------------------------------------------------------------------

  cleanName(name) {
    return String(name || '').trim().slice(0, NAME_MAX);
  }

  findByName(name, except = null) {
    const low = name.toLowerCase();
    return [...this.players.values()].find((p) => p !== except && p.name.toLowerCase() === low) || null;
  }

  /**
   * Join the room, or reclaim an existing seat when the teacher unlocked it for
   * rejoin (for example when a student switches device or clears storage).
   */
  join(name, avatar) {
    name = this.cleanName(name);
    if (!name) throw new Error('Pick a name');

    const existing = this.findByName(name);
    if (existing) {
      if (existing.rejoinOpen && existing.online === 0) {
        this.byToken.delete(existing.token);
        existing.token = randomBytes(12).toString('hex');
        existing.avatar = clamp(Number(avatar) || 0, 0, AVATARS - 1);
        existing.rejoinOpen = false;
        this.byToken.set(existing.token, existing.id);
        this.changed();
        return existing;
      }
      throw new Error('That name is taken: add an initial, or ask the teacher to unlock your seat');
    }

    if (this.players.size >= this.maxPlayers) throw new Error('The room is full');
    const before = this.term.players[termKey(name)]; // points from earlier lessons, by name
    const spawn = nearestFree(this.room, SPAWN.x + (Math.random() * 6 - 3), SPAWN.y, this.unlocked());
    const p = {
      id: `p${this.nextId++}`,
      token: randomBytes(12).toString('hex'),
      name,
      avatar: clamp(Number(avatar) || 0, 0, AVATARS - 1),
      ...spawn,
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
      rejoinOpen: false,
    };
    if (this.mode === 'present') this.sit(p);
    this.players.set(p.id, p);
    this.byToken.set(p.token, p.id);
    this.changed();
    return p;
  }

  /** Let an offline student reclaim their name, points and answers from another browser. */
  allowRejoin(id, on = true) {
    const p = this.players.get(id);
    if (!p) return;
    p.rejoinOpen = !!on;
    this.changed();
  }

  player(token) {
    const id = this.byToken.get(token);
    return id ? this.players.get(id) : null;
  }

  setOnline(p, delta) {
    p.online = Math.max(0, p.online + delta);
    if (p.online > 0) p.rejoinOpen = false;
    this.changed();
  }

  online() {
    return [...this.players.values()].filter((p) => p.online > 0);
  }

  rename(id, name) {
    const p = this.players.get(id);
    name = this.cleanName(name);
    if (!p || !name) return;
    if (this.findByName(name, p)) throw new Error('That name is taken');
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

  // ---- fun: emotes, hops, coffee, hats -----------------------------------------------

  /** A reaction bubble, a hop, or sipping coffee in free roam. Rate-limited; "lost" reaches the teacher. */
  emote(p, e) {
    const hop = e === 'hop';
    const drink = e === 'drink';
    if (!hop && !drink && !EMOTE_IDS.includes(e)) throw new Error('Unknown emote');
    if ((hop || drink) && this.mode === 'present') return false; // calm during explanations
    if (drink && (this.mode !== 'free' || this.room !== BASE)) return false;
    if (now() - p.emoteAt < (hop ? HOP_GAP_MS : EMOTE_GAP_MS)) return false;
    p.emoteAt = now();
    this.fx({ t: hop ? 'hop' : drink ? 'drink' : 'emote', id: p.id, e });
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
    b.vx *= 0.86;
    b.vy *= 0.86;
    if (Math.hypot(b.vx, b.vy) < 0.4) {
      b.vx = 0;
      b.vy = 0;
    }
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
      for (const p of this.players.values()) p.back = null;
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
    n = clamp(Number(n) || 1, 1, max);
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

  // ---- questions (see lib/questions.js) -----------------------------------------------

  get live() {
    return this.current ? this.records[this.current] : null;
  }

  questionDef(key) {
    return this.records[key]?.def || this.lesson.questions[key] || null;
  }

  stillWriting(rec = this.live) {
    return stillWriting(this, rec);
  }

  checkGate(force) {
    return checkGate(this, force);
  }

  groupOf(rec, pid) {
    return groupOf(rec, pid);
  }

  pendingRetries(rec = this.live) {
    return pendingRetries(rec);
  }

  open(keyOrDef, opts) {
    return openQuestion(this, keyOrDef, opts);
  }

  submit(p, body) {
    return submitAnswer(this, p, body);
  }

  close(opts) {
    return closeQuestion(this, opts);
  }

  score(opts) {
    return scoreQuestion(this, opts);
  }

  setScore(pid, score, feedback) {
    return setAnswerScore(this, pid, score, feedback);
  }

  setTimer(seconds) {
    return setQuestionTimer(this, seconds);
  }

  reveal(opts) {
    return revealQuestion(this, opts);
  }

  showExample(on) {
    return showExample(this, on);
  }

  setWallNames(on) {
    this.wallNames = !!on;
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
    const item = this.asks.ask(p, text, { slide: this.screen.slide });
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
    for (const rec of Object.values(this.records)) {
      for (const entry of Object.values(rec.answers)) {
        const p = this.players.get(entry.id);
        const shown = entry.attempts.filter((a) => a.state === 'revealed');
        if (!p || !shown.length) continue;
        p.points += Math.max(...shown.map((a) => a.points || 0));
        if (shown.some((a) => a.improved)) p.improved += 1;
      }
    }
    const before = this.classLevel;
    this.classLevel = this.klass().level;
    if (this.classLevel > before) {
      const level = CLASS_LEVELS[this.classLevel - 1];
      this.fx({ t: 'level', level: this.classLevel, id: level.id, name: level.name, text: level.text });
    }
  }

  /** The class goal: all points together, scaled by active class size (online if anyone is connected). */
  klass() {
    const ps = [...this.players.values()];
    const activeCount = this.online().length || ps.length;
    return classProgress(
      ps.reduce((sum, p) => sum + p.points, 0),
      activeCount,
      this.classLevel,
    );
  }

  answeredRecords() {
    return answeredRecords(this);
  }

  streakBefore(pid, rec) {
    return streakBefore(this, pid, rec);
  }

  streak(pid) {
    return streak(this, pid);
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

  // ---- the session file (see session.js) ----------------------------------------------------

  restore(data) {
    restoreSession(this, data);
  }

  save() {
    return saveSession(this);
  }
}
