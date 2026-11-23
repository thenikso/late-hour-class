#!/usr/bin/env node
// Class game engine: one Node process, no dependencies.
//
//   node server.js --lesson <deck url or .json> [--deck <student deck url>] [--projector <deck url>]
//                  [--notes <teacher deck url>] [--port 3000] [--ai claude|codex|mock|off]
//                  [--data ./data] [--resume file.json] [--term file.json|off] [--no-gate]
//
// Students open http://<laptop-ip>:<port>/ ; the teacher opens the /teacher link printed at start.
//
// How clients talk to the server:
//   GET  /events                 a server-sent events stream: `state` (the client's view, on every
//                                change), `pos` (positions, ten times a second), `fx`, `ball`, `kicked`,
//                                `desk` (a shared desk draft: to that desk and the teacher only)
//   POST /api/join               a student enters; the reply holds their token
//   POST /api/<action>           a student's intention, with their token (see STUDENT_ACTIONS)
//   POST /api/teacher/<action>   the teacher's controls, with the key from the teacher link
//   GET  /report                 the session report (teacher key)
//   GET  anything else           a file from public/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { loadLesson } from './lib/manifest.js';
import { loadTerm } from './lib/term.js';
import { sessionReport } from './lib/report.js';
import { cliMissing } from './lib/ai.js';
import { Game } from './lib/game.js';
import { membersAt } from './lib/desks.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const MAX_BODY = 64 * 1024;

// ---- what students can do ------------------------------------------------------------
// Each action gets the game, the player (found by token) and the request body.

const STUDENT_ACTIONS = {
  move: (game, p, b) => ({ ok: game.move(p, b.x, b.y, b.dir, b.moving, b.warp), mode: game.mode }),
  emote: (game, p, b) => ({ ok: game.emote(p, b.e) }),
  hat: (game, p, b) => {
    game.setHat(p, b.hat);
    return { ok: true };
  },
  answer: (game, p, b) => ({ ok: true, state: game.submit(p, b).state }),
  // shared desk drafts in pair work (lib/desks.js)
  draft: (game, p, b) => ({ ok: true, v: game.writeDraft(p, b) }),
  pen: (game, p) => {
    game.takePen(p);
    return { ok: true };
  },
  ask: (game, p, b) => ({ ok: true, status: game.ask(p, b.text).status }),
  vote: (game, p, b) => {
    game.voteAsk(p, b.id);
    return { ok: true };
  },
};

// ---- what the teacher can do ---------------------------------------------------------
// `force` is the submit gate's override: "move on anyway".

const TEACHER_ACTIONS = {
  // the room
  mode: (game, b) => game.setMode(b.mode, { force: b.force }),
  room: (game, b) => game.openDoor(b.room, Number(b.seconds) || undefined, { force: b.force }),
  seat: (game, b) => game.takeSeats(Number(b.seconds) || 20, { force: b.force }),
  finale: (game, b) => game.setFinale(b.on !== false),
  'show-join': (game, b) => game.setShowJoin(b.on !== false), // the join link, big on the projector
  // the shared screen
  slide: (game, b) => game.goSlide(b.slide),
  cue: (game) => game.cue(),
  url: (game, b) => game.setScreenUrl(b.url),
  // questions
  open: (game, b) => game.open(b.key || b.def, { force: b.force }),
  close: (game, b) => game.close({ force: b.force }),
  timer: (game, b) => game.setTimer(b.seconds),
  'rapid-seconds': (game, b) => game.setRapidSeconds(b.seconds), // seconds per line of a rapid round
  score: (game, b) => {
    if (game.scoring) throw new Error('Already scoring');
    game.checkGate(b.force);
    // The AI call runs in the background; results arrive over the event stream.
    game.score({ force: true }).catch((e) => game.log('scoring:', e.message));
  },
  'set-score': (game, b) => game.setScore(b.pid, b.score, b.feedback),
  reveal: (game, b) => game.reveal({ force: b.force }),
  example: (game, b) => game.showExample(b.on !== false),
  'wall-names': (game, b) => game.setWallNames(b.on !== false),
  spotlight: (game, b) => game.setSpotlight(b.pid || null),
  pick: (game) => game.pickSpotlight(),
  // the questions board, trophies, players
  'ask-status': (game, b) => game.moderateAsk(b.id, b.status),
  'show-asks': (game, b) => game.setShowAsks(b.on !== false),
  trophy: (game, b) => game.awardTrophy(b.id),
  'allow-rejoin': (game, b) => game.allowRejoin(b.pid, b.on !== false),
  kick: (game, b) => game.kick(b.pid),
  rename: (game, b) => game.rename(b.pid, b.name),
};

// ---- small HTTP helpers ----------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const PAGES = { '/': 'student.html', '/teacher': 'teacher.html', '/screen': 'screen.html' };

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const json = (res, code, body) => send(res, code, body, 'application/json');

async function serveStatic(res, pathname) {
  let rel;
  try {
    rel = PAGES[pathname] || decodeURIComponent(pathname.slice(1));
  } catch {
    return send(res, 400, 'Bad request');
  }
  const full = normalize(join(PUBLIC, rel));
  if (full !== PUBLIC && !full.startsWith(PUBLIC + sep)) {
    return send(res, 403, 'Forbidden'); // no climbing out of public/
  }
  try {
    if (!(await stat(full)).isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(await readFile(full));
  } catch {
    send(res, 404, 'Not found');
  }
}

/** The JSON body of a POST, with a size limit. */
function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new Error('Body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        fail(new Error('Bad JSON'));
      }
    });
    req.on('error', fail);
  });
}

/** This laptop's address on the Wi-Fi, for the link students type. */
export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return 'localhost';
}

// ---- the server ------------------------------------------------------------------------

export async function start(opts = {}) {
  const port = opts.port === undefined ? 3000 : Number(opts.port);
  const host = opts.host || lanAddress();
  const log = opts.quiet ? () => {} : console.log;
  const fill = (url) => (url ? String(url).replace(/\{host\}/g, host) : url); // "{host}" in a URL means this laptop
  const lessonSrc = fill(opts.lesson);
  const dataDir = resolve(opts.data || join(ROOT, 'data'));
  const termFile = opts.term === 'off' ? null : resolve(opts.term || join(dataDir, 'term.json'));
  const key = opts.key || randomBytes(6).toString('hex'); // the teacher's and projector's password, new every run

  const game = new Game({
    lesson: await loadLesson(lessonSrc),
    dataDir,
    aiMode: opts.ai || 'claude',
    deckUrl: fill(opts.deck || (/^https?:/.test(lessonSrc || '') ? lessonSrc : '')),
    notesUrl: fill(opts.notes || ''),
    projectorUrl: fill(opts.projector || ''),
    term: await loadTerm(termFile, log),
    termFile,
    gate: !opts['no-gate'],
    maxPlayers: opts.maxPlayers ? Number(opts.maxPlayers) : undefined,
    log,
  });
  if (opts.resume) {
    game.restore(JSON.parse(await readFile(opts.resume, 'utf8')));
    game.sessionFile = resolve(opts.resume);
  }

  // Everyone listening on /events: { res, role, player }.
  const clients = new Set();

  function safeWrite(client, payload) {
    if (client.res.writableEnded || client.res.destroyed) {
      clients.delete(client);
      return;
    }
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }

  const push = (client, event, data) => safeWrite(client, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const pushAll = (event, data) => clients.forEach((c) => push(c, event, data));
  const viewFor = (c) => {
    if (c.role === 'student') return game.studentView(c.player);
    if (c.role === 'teacher') return game.teacherView();
    return game.screenView();
  };

  game.onChange(() => {
    for (const c of [...clients]) {
      if (c.role === 'student' && !game.players.has(c.player.id)) {
        push(c, 'kicked', {});
        c.res.end();
        clients.delete(c);
      } else {
        push(c, 'state', viewFor(c));
      }
    }
  });
  game.onFx((event) => pushAll('fx', event));
  // A desk's draft goes to the students at that desk and to the teacher, nobody else.
  game.onDesk((n, data) => {
    const here = new Set(membersAt(game, n).map((p) => p.id));
    for (const c of [...clients]) {
      if (c.role === 'teacher' || (c.role === 'student' && here.has(c.player.id))) push(c, 'desk', data);
    }
  });

  // The fast tick: the ball and everyone's position, only when something moved.
  let lastPositions = '';
  const tick = setInterval(() => {
    if (game.stepBall(0.1)) pushAll('ball', [+game.ball.x.toFixed(2), +game.ball.y.toFixed(2)]);
    if (!clients.size) return;
    const positions = JSON.stringify(game.positions());
    if (positions === lastPositions) return;
    lastPositions = positions;
    const payload = `event: pos\ndata: ${positions}\n\n`;
    for (const c of [...clients]) safeWrite(c, payload);
  }, 100);

  // A comment line now and then keeps proxies and browsers from closing a quiet stream.
  const keepAlive = setInterval(() => {
    for (const c of [...clients]) safeWrite(c, ': ping\n\n');
  }, 15000);

  const isTeacher = (url) => url.searchParams.get('key') === key;

  function openStream(req, res, url) {
    const role = url.searchParams.get('role');
    let client;
    if (role === 'student') {
      const player = game.player(url.searchParams.get('token'));
      if (!player) return json(res, 401, { error: 'Unknown player' });
      client = { res, role, player };
      game.setOnline(player, +1);
    } else if ((role === 'teacher' || role === 'screen') && isTeacher(url)) {
      client = { res, role };
    } else {
      return json(res, 403, { error: 'Wrong key' });
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    clients.add(client);
    push(client, 'state', viewFor(client));
    push(client, 'pos', game.positions());
    req.on('close', () => {
      clients.delete(client);
      if (client.player && game.players.has(client.player.id)) game.setOnline(client.player, -1);
    });
  }

  async function handlePost(req, res, url) {
    const body = await readBody(req);
    const action = url.pathname.slice('/api/'.length);
    if (action === 'join') {
      const p = game.join(body.name, body.avatar);
      return json(res, 200, { token: p.token, id: p.id });
    }
    if (action.startsWith('teacher/')) {
      if (!isTeacher(url)) return json(res, 403, { error: 'Wrong key' });
      const run = TEACHER_ACTIONS[action.slice('teacher/'.length)];
      if (!run) return json(res, 404, { error: 'Unknown teacher action' });
      run(game, body);
      return json(res, 200, { ok: true });
    }
    const run = STUDENT_ACTIONS[action];
    if (!run) return json(res, 404, { error: 'Unknown action' });
    const player = game.player(body.token);
    if (!player) return json(res, 401, { error: 'Unknown player: join again' });
    json(res, 200, run(game, player, body));
  }

  const server = createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'x'}`);
    } catch {
      return send(res, 400, 'Bad request');
    }
    try {
      if (url.pathname === '/events') return openStream(req, res, url);
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) return await handlePost(req, res, url);
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
      if (url.pathname === '/api/info') return json(res, 200, { lesson: game.lesson.title, studentUrl: `http://${host}:${server.address().port}/` });
      if (url.pathname === '/report') {
        if (!isTeacher(url)) return send(res, 403, 'Wrong key');
        await game.save();
        const data = JSON.parse(await readFile(game.sessionFile, 'utf8'));
        return send(res, 200, sessionReport(data, { names: url.searchParams.has('names') }));
      }
      return await serveStatic(res, url.pathname);
    } catch (e) {
      // A rule said no (name taken, question closed…). The submit gate answers 409 so the
      // teacher page can offer "move on anyway".
      if (e.gate) json(res, 409, { error: e.message, gate: true, waitingFor: e.waitingFor });
      else json(res, 400, { error: e.message });
    }
  });

  await new Promise((ok) => server.listen(port, '0.0.0.0', ok));
  const actualPort = server.address().port;
  return {
    port: actualPort,
    key,
    game,
    studentUrl: `http://${host}:${actualPort}/`,
    teacherUrl: `http://localhost:${actualPort}/teacher?key=${key}`,
    screenUrl: `http://localhost:${actualPort}/screen?key=${key}`,
    close: async ({ flush = false } = {}) => {
      clearInterval(tick);
      clearInterval(keepAlive);
      if (flush && game.players.size) {
        await game.save().catch((e) => log('final save failed:', e.message));
      }
      game.dispose();
      for (const c of clients) c.res.end();
      clients.clear();
      return new Promise((ok) => server.close(ok));
    },
  };
}

/** The lines printed at start: the three links, and a warning if the AI CLI is missing. */
export function printStartup(s) {
  const game = s.game;
  console.log(`\n  ${game.lesson.title}: ${game.lesson.slides.length} slides, ${game.lesson.order.length} questions`);
  console.log(`  Students:  ${s.studentUrl}`);
  console.log(`  Teacher:   ${s.teacherUrl}`);
  console.log(`  Projector: ${s.screenUrl}`);
  console.log(`  AI scoring: ${game.aiMode}   Session file: ${game.sessionFile}`);
  const missing = cliMissing(game.aiMode);
  if (missing) {
    console.log(`\n  ! The "${missing}" command was not found, so score suggestions will fail.\n    Score by hand, or restart with --ai codex | mock | off.`);
  }
  console.log('');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      lesson: { type: 'string' },
      deck: { type: 'string' },
      projector: { type: 'string' },
      notes: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      ai: { type: 'string' },
      data: { type: 'string' },
      resume: { type: 'string' },
      term: { type: 'string' },
      key: { type: 'string' },
      'no-gate': { type: 'boolean', default: false },
    },
  });
  start(values)
    .then((s) => {
      printStartup(s);
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, async () => {
          await s.close({ flush: true });
          process.exit(0);
        });
      }
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
