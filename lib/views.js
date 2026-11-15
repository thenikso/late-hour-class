// What each role gets to see. The game state holds everything; these functions
// cut it down to one JSON view per role, sent over the event stream on every change.
//
//   studentView   the room, the open question, and only this student's own answer and score
//   screenView    the projector: the room and whatever has been revealed
//   teacherView   everything, including flags, names of who is still writing or lost
//
// Rule of thumb: if the class should not see it, it must not be in baseView.

import { spotlightPicks } from './checks.js';
import { needsAi, canRetry } from './scoring.js';
import { optionOrder } from '../public/js/world.js';

const LOST_FOR_MS = 5 * 60_000; // "I'm lost" fades by itself after this long
const isSet = (v) => v !== null && v !== undefined;

const card = (p, extra = {}) => ({ id: p.id, name: p.name, avatar: p.avatar, hat: p.hat || '', ...extra });

/** The live question as everyone may see it. Answers and results only appear once revealed. */
function publicQuestion(game, rec, forTeacher = false) {
  if (!rec) return null;
  const q = rec.def;
  const entries = Object.values(rec.answers);
  const revealed = rec.status === 'revealed';
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
    submitted: entries.filter((e) => game.players.has(e.id)).length,
    online: game.online().length,
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
  if (q.kind === 'line') out.labels = q.labels;

  // Counts and right answers: the teacher sees them live, the class at the reveal.
  if (revealed || forTeacher) {
    const first = (e) => e.attempts[0] || {};
    if (q.kind === 'choice') {
      out.counts = q.options.map((_, i) => entries.filter((e) => first(e).choice === i).length);
      out.correct = q.correct;
      if (q.reasons) out.reasonsCorrect = q.reasons.correct;
    }
    if (q.kind === 'grid') {
      out.rowCorrect = q.rows.map((r) => r.correct);
      out.rowStats = q.rows.map((r, i) => (r.options || q.options).map((_, o) => entries.filter((e) => first(e).grid?.[i] === o).length));
    }
    if (q.kind === 'line') {
      const values = entries.map((e) => first(e).value).filter(isSet);
      out.spread = [0, 1, 2, 3, 4].map((b) => values.filter((v) => Math.min(4, Math.floor(v / 20)) === b).length);
      out.average = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    }
  }

  if (revealed) {
    out.wall = entries
      .map((e) => {
        const p = game.players.get(e.id);
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
    if (rec.exampleShown && q.example) out.example = q.example;
  }
  return out;
}

/** Top 5 and "Improved today". Nothing here shows who is at the bottom. */
function board(game) {
  const ps = [...game.players.values()];
  return {
    top: [...ps].filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 5).map((p) => card(p, { points: p.points })),
    improved: ps.filter((p) => p.improved > 0).sort((a, b) => b.improved - a.improved).slice(0, 5).map((p) => card(p, { improved: p.improved })),
  };
}

/** The closing ceremony: podium, improvers, the longest hand-in streaks. */
function finaleView(game) {
  const ps = [...game.players.values()];
  const runs = ps.map((p) => ({ p, n: game.streak(p.id) })).filter((x) => x.n >= 2);
  const best = Math.max(0, ...runs.map((x) => x.n));
  const longest = runs.filter((x) => x.n === best);
  return {
    podium: [...ps].filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((p) => card(p, { points: p.points })),
    improved: board(game).improved,
    streak: { n: best, players: longest.slice(0, 8).map((x) => card(x.p)), more: Math.max(0, longest.length - 8) },
    answers: Object.values(game.records).reduce((sum, r) => sum + Object.keys(r.answers).length, 0),
    questions: game.answeredRecords().length,
  };
}

/** The answer on the projector and its author. */
function spotlightView(game) {
  if (!game.spotlight) return null;
  const rec = game.records[game.spotlight.qkey];
  const a = rec?.answers[game.spotlight.pid]?.attempts.at(-1);
  const p = game.players.get(game.spotlight.pid);
  if (!a || !p) return null;
  const q = rec.def;
  return {
    pid: p.id,
    name: p.name,
    avatar: p.avatar,
    text: a.text,
    choice: isSet(a.choice) ? q.options[a.choice] : null,
    question: q.title,
  };
}

/** Trophies on the shelf, with a link to the slide where each concept was taught. */
function trophiesView(game) {
  const origin = game.deckUrl ? new URL(game.deckUrl).origin : '';
  return game.shelf.map((t) => ({
    key: t.key,
    name: t.name,
    sprite: t.sprite,
    text: t.text,
    example: t.example,
    lesson: t.lesson,
    slide: t.slide,
    url: origin && t.deckPath && t.slide ? `${origin}${t.deckPath}#${t.slide}` : null,
  }));
}

const askView = (game, it) => ({ id: it.id, text: it.text, name: game.players.get(it.pid)?.name || '?', votes: it.votes.length, status: it.status });

/** Everything every role sees. Players carry no points here: the class only sees the top 5. */
function baseView(game) {
  return {
    mode: game.mode,
    seatingEndsAt: game.seatingEndsAt,
    serverNow: Date.now(),
    screen: game.screen,
    lessonTitle: game.lesson.title,
    slideCount: game.lesson.slides.length,
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      online: p.online > 0,
      hat: p.hat || '',
      seat: p.seat,
      x: p.x,
      y: p.y,
      dir: p.dir,
      warp: p.warp,
    })),
    question: publicQuestion(game, game.live),
    board: board(game),
    spotlight: spotlightView(game),
    klass: game.klass(),
    trophies: trophiesView(game),
    ball: [+game.ball.x.toFixed(2), +game.ball.y.toFixed(2)],
    finale: game.finale ? finaleView(game) : null,
  };
}

export function studentView(game, p) {
  const v = baseView(game);
  v.deckUrl = game.deckUrl;

  // Your own place on the board is for your eyes only.
  const ranked = [...game.players.values()].filter((o) => o.points > 0).sort((a, b) => b.points - a.points);
  const rank = ranked.findIndex((o) => o.points === p.points) + 1; // ties share the better place
  v.me = {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    points: p.points,
    improved: p.improved,
    hat: p.hat || '',
    streak: game.streak(p.id),
    lost: !!p.lostAt,
    rank: p.points > 0 ? rank : null,
    term: game.termTotals(p),
  };

  // The board of questions for the teacher, plus this student's own held ones.
  v.asks = game.asks
    .posted()
    .map((it) => ({ ...askView(game, it), mine: it.pid === p.id, voted: it.votes.includes(p.id) }))
    .concat(game.asks.items.filter((it) => it.pid === p.id && it.status === 'held').map((it) => ({ ...askView(game, it), mine: true, voted: false })));

  const rec = game.live;
  const entry = rec?.answers[p.id];
  if (entry) {
    const a = entry.attempts.at(-1);
    v.mine = {
      attempt: a.n,
      state: a.state,
      text: a.text,
      choice: a.choice,
      reason: a.reason,
      grid: a.grid,
      value: a.value,
      canRetry: rec.status === 'revealed' && canRetry(rec.def, entry),
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

export function screenView(game) {
  const v = baseView(game);
  v.deckUrl = game.projectorUrl;
  // The top questions for the teacher, when the teacher puts them up.
  v.asks = game.showAsks ? game.asks.posted().slice(0, 5).map((it) => askView(game, it)) : null;
  return v;
}

export function teacherView(game) {
  const v = baseView(game);
  v.deckUrl = game.deckUrl;
  v.projectorUrl = game.projectorUrl;
  v.notesUrl = game.notesUrl;
  v.aiMode = game.aiMode;
  v.scoring = game.scoring;
  v.slides = game.lesson.slides;
  for (const row of v.players) row.points = game.players.get(row.id).points;
  v.lost = game.online().filter((p) => p.lostAt && Date.now() - p.lostAt < LOST_FOR_MS).map((p) => p.name);
  v.showAsks = game.showAsks;
  v.asks = game.asks.items.filter((it) => it.status === 'posted' || it.status === 'held').map((it) => askView(game, it));
  v.lessonTrophies = game.lesson.trophies.map((t) => ({ id: t.id, name: t.name, after: t.after, earned: game.shelf.some((x) => x.key === `${game.lesson.title}:${t.id}`) }));
  v.questions = game.lesson.order.map((key) => {
    const q = game.lesson.questions[key];
    const rec = game.records[key];
    return { key, title: q.title, kind: q.kind, slide: q.slide, status: rec?.status || null, answers: rec ? Object.keys(rec.answers).length : 0 };
  });

  const rec = game.live;
  if (!rec) return v;
  const q = rec.def;
  v.question = publicQuestion(game, rec, true);
  v.question.def = q;
  v.question.needsAi = needsAi(q);
  v.question.scoringError = rec.scoringError || null;
  v.question.waitingFor = game.stillWriting(rec).map((p) => p.name);
  v.question.openedAt = rec.openedAt;
  v.question.hasExample = !!q.example;
  v.question.exampleShown = !!rec.exampleShown;

  v.answers = Object.values(rec.answers)
    .map((entry) => {
      const a = entry.attempts.at(-1);
      return {
        pid: entry.id,
        name: game.players.get(entry.id)?.name || '(left)',
        attempt: a.n,
        state: a.state,
        text: a.text,
        choice: a.choice,
        reason: a.reason,
        grid: a.grid,
        value: a.value,
        flags: a.flags || [],
        ai: a.ai || null,
        auto: a.auto || null,
        points: a.points ?? null,
        at: a.at,
      };
    })
    .sort((x, y) => x.at - y.at);
  v.picks = spotlightPicks(q, v.answers.map((a) => ({ id: a.pid, text: a.text, flags: a.flags })));

  // Which concepts the scorer said were missed, most common first: what to go over again.
  const missed = new Map();
  for (const a of v.answers) if (a.ai?.missed) missed.set(a.ai.missed, (missed.get(a.ai.missed) || 0) + 1);
  v.question.missed = [...missed].sort((a, b) => b[1] - a[1]).map(([concept, n]) => ({ concept, n }));
  return v;
}
