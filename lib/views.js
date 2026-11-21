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
import { optionOrder } from '../public/js/shared/world.js';
import { ROOMS } from '../public/js/shared/rooms.js';
import { isSet } from '../public/js/shared/util.js';

const LOST_FOR_MS = 5 * 60_000; // "I'm lost" fades by itself after this long

const card = (p, extra = {}) => ({ id: p.id, name: p.name, avatar: p.avatar, hat: p.hat || '', ...extra });

/**
 * The answers to a question, one per hand-in: in pair work the two copies of a
 * shared answer come back as one item with both players.
 *   [{ ids: [player id...], entry }]   (entry: the first member's attempts)
 */
function sharedAnswers(game, rec) {
  const seen = new Map();
  for (const entry of Object.values(rec.answers)) {
    const last = entry.attempts.at(-1);
    const key = `${last.by || entry.id}:${last.at}`;
    if (seen.has(key)) seen.get(key).ids.push(entry.id);
    else seen.set(key, { ids: [entry.id], entry });
  }
  return [...seen.values()];
}

const namesOf = (game, ids) => ids.map((id) => game.players.get(id)?.name || '(left)').join(' + ');

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
    stretch: q.stretch || '',
    parts: q.parts,
    slide: q.slide,
    scored: q.scored,
    pairs: q.pairs,
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
  if (q.kind === 'bug') out.code = q.code;
  if (q.kind === 'code') {
    out.starter = q.starter;
    out.tests = q.tests; // the checks run in the student's browser, so they travel with the question
  }

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
    if (q.kind === 'bug') {
      out.correctLines = q.correct;
      out.lineCounts = q.code.split('\n').map((_, i) => entries.filter((e) => first(e).line === i + 1).length);
    }
    if (q.kind === 'code') {
      out.passCounts = q.tests.map((_, i) => entries.filter((e) => e.attempts.at(-1)?.passed?.[i]).length);
    }
    if (q.kind === 'line') {
      const values = entries.map((e) => first(e).value).filter(isSet);
      out.spread = [0, 1, 2, 3, 4].map((b) => values.filter((v) => Math.min(4, Math.floor(v / 20)) === b).length);
      out.average = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    }
  }

  if (revealed) {
    const showNames = forTeacher || game.wallNames;
    out.wallNames = game.wallNames;
    out.wall = sharedAnswers(game, rec)
      .map(({ ids, entry }) => {
        const p = game.players.get(ids[0]);
        const shown = entry.attempts.filter((a) => a.state === 'revealed');
        const a = shown.at(-1);
        if (!p || !a) return null;
        return {
          pid: p.id,
          ids, // everyone who shares this answer: the points rise from each of them
          name: showNames ? namesOf(game, ids) : '',
          avatar: showNames ? p.avatar : null,
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
    top: [...ps]
      .filter((p) => p.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 5)
      .map((p) => card(p, { points: p.points })),
    improved: ps
      .filter((p) => p.improved > 0)
      .sort((a, b) => b.improved - a.improved)
      .slice(0, 5)
      .map((p) => card(p, { improved: p.improved })),
  };
}

/** The closing ceremony: podium, improvers, the longest hand-in streaks. */
function finaleView(game) {
  const ps = [...game.players.values()];
  const runs = ps.map((p) => ({ p, n: game.streak(p.id) })).filter((x) => x.n >= 2);
  const best = Math.max(0, ...runs.map((x) => x.n));
  const longest = runs.filter((x) => x.n === best);
  return {
    podium: [...ps]
      .filter((p) => p.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map((p) => card(p, { points: p.points })),
    improved: board(game).improved,
    streak: {
      n: best,
      players: longest.slice(0, 8).map((x) => card(x.p)),
      more: Math.max(0, longest.length - 8),
    },
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
  const choiceLabel = isSet(a.choice) ? q.options[a.choice] : isSet(a.line) ? `line ${a.line}` : null;
  return {
    pid: p.id,
    name: p.name,
    avatar: p.avatar,
    text: a.text,
    code: q.kind === 'code', // shown in a fixed-width font
    choice: choiceLabel,
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

const askView = (game, it) => ({
  id: it.id,
  text: it.text,
  slide: it.slide || null,
  name: game.players.get(it.pid)?.name || '?',
  votes: it.votes.length,
  status: it.status,
});

/** Everything every role sees. Players carry no points here: the class only sees the top 5. */
function baseView(game) {
  return {
    mode: game.mode,
    room: game.room,
    roomName: ROOMS[game.room].name,
    door: game.door ? { to: game.door.to, name: ROOMS[game.door.to].name, endsAt: game.door.endsAt } : null,
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
      gone: p.gone, // already through the open door
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
    .concat(
      game.asks.items
        .filter((it) => it.pid === p.id && it.status === 'held')
        .map((it) => ({ ...askView(game, it), mine: true, voted: false })),
    );

  const rec = game.live;
  // Pair work: who you share an answer with, and whether you are the suggested Driver.
  const rawGroup = rec?.groups?.find((g) => g.includes(p.id)) || null;
  const mates = rec ? game.groupOf(rec, p.id).slice(1) : [];
  v.me.partners = mates.map((id) => ({ id, name: game.players.get(id)?.name || '?' }));
  v.me.pairRole = rawGroup ? (rawGroup[0] === p.id ? 'driver' : 'navigator') : null;

  const entry = rec?.answers[p.id];
  if (entry) {
    const a = entry.attempts.at(-1);
    v.mine = {
      attempt: a.n,
      state: a.state,
      by: a.by && a.by !== p.id ? game.players.get(a.by)?.name || 'your partner' : null,
      text: a.text,
      choice: a.choice,
      reason: a.reason,
      grid: a.grid,
      value: a.value,
      line: a.line,
      passed: a.passed,
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
  v.wallNames = game.wallNames;
  v.slides = game.lesson.slides;
  v.rooms = Object.values(ROOMS).map((r) => ({ id: r.id, name: r.name }));
  for (const row of v.players) {
    const player = game.players.get(row.id);
    row.points = player.points;
    row.rejoinOpen = !!player.rejoinOpen;
  }
  v.lost = game
    .online()
    .filter((p) => p.lostAt && Date.now() - p.lostAt < LOST_FOR_MS)
    .map((p) => p.name);
  v.showAsks = game.showAsks;
  v.asks = game.asks.items
    .filter((it) => it.status === 'posted' || it.status === 'held')
    .map((it) => askView(game, it));
  v.lessonTrophies = game.lesson.trophies.map((t) => ({
    id: t.id,
    name: t.name,
    after: t.after,
    earned: game.shelf.some((x) => x.key === `${game.lesson.title}:${t.id}`),
  }));
  v.questions = game.lesson.order.map((key) => {
    const q = game.lesson.questions[key];
    const rec = game.records[key];
    return {
      key,
      title: q.title,
      kind: q.kind,
      slide: q.slide,
      status: rec?.status || null,
      answers: rec ? Object.keys(rec.answers).length : 0,
    };
  });

  const rec = game.live;
  if (!rec) return v;
  const q = rec.def;
  v.question = publicQuestion(game, rec, true);
  v.question.def = q;
  v.question.needsAi = needsAi(q);
  v.question.pendingRetries = game.pendingRetries(rec);
  v.question.scoringError = rec.scoringError || null;
  v.question.waitingFor = game.stillWriting(rec).map((p) => p.name);
  v.question.openedAt = rec.openedAt;
  v.question.hasExample = !!q.example;
  v.question.exampleShown = !!rec.exampleShown;

  v.answers = sharedAnswers(game, rec)
    .map(({ ids, entry }) => {
      const a = entry.attempts.at(-1);
      return {
        pid: ids[0],
        name: namesOf(game, ids),
        attempt: a.n,
        state: a.state,
        text: a.text,
        choice: a.choice,
        reason: a.reason,
        grid: a.grid,
        value: a.value,
        line: a.line,
        passed: a.passed,
        flags: a.flags || [],
        ai: a.ai || null,
        auto: a.auto || null,
        points: a.points ?? null,
        at: a.at,
        took: a.at - rec.openedAt, // how long after the question opened
      };
    })
    .sort((x, y) => x.at - y.at);
  v.picks = spotlightPicks(
    q,
    v.answers.map((a) => ({ id: a.pid, text: a.text, flags: a.flags })),
  );

  // Which concepts the scorer said were missed, most common first: what to go over again.
  const missed = new Map();
  for (const a of v.answers) {
    if (a.ai?.missed) missed.set(a.ai.missed, (missed.get(a.ai.missed) || 0) + 1);
  }
  v.question.missed = [...missed]
    .sort((a, b) => b[1] - a[1])
    .map(([concept, n]) => ({ concept, n }));
  return v;
}
