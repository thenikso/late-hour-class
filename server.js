#!/usr/bin/env node
// Class game engine: one Node process, no dependencies.
//   node server.js --lesson <deck-url-or-json> [--deck <student deck url>] [--notes <teacher deck url>]
//                  [--projector <deck url for the projector>] [--port 3000] [--ai claude|codex|mock|off] [--data ./data] [--resume file.json]
// Students open http://<laptop-ip>:<port>/ ; the teacher opens the /teacher link printed at start.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadLesson } from './lib/manifest.js';
import { Game } from './lib/game.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}

export function lanAddress() {
  for (const list of Object.values(networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address;
  return 'localhost';
}

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

async function serveStatic(req, res, pathname) {
  const file = PAGES[pathname] || pathname.slice(1);
  const full = normalize(join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(full));
  } catch {
    send(res, 404, 'Not found');
  }
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const json = (res, code, body) => send(res, code, body, 'application/json');

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        fail(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
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

export async function start(opts = {}) {
  const port = Number(opts.port || 3000);
  const host = opts.host || lanAddress();
  const fill = (u) => (u ? String(u).replace(/\{host\}/g, host) : u);
  const lessonSrc = fill(opts.lesson);
  const lesson = await loadLesson(lessonSrc);
  const key = opts.key || randomBytes(6).toString('hex');
  const game = new Game({
    lesson,
    dataDir: resolve(opts.data || join(ROOT, 'data')),
    aiMode: opts.ai || 'claude',
    deckUrl: fill(opts.deck || (lessonSrc && /^https?:/.test(lessonSrc) ? lessonSrc : '')),
    notesUrl: fill(opts.notes || ''),
    projectorUrl: fill(opts.projector || ''),
    log: opts.quiet ? () => {} : console.log,
  });
  if (opts.resume) {
    const data = JSON.parse(await readFile(opts.resume, 'utf8'));
    game.restore(data);
    game.sessionFile = resolve(opts.resume);
  }

  const clients = new Set(); // { res, role, player }
  const push = (c, event, data) => c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const viewFor = (c) => (c.role === 'student' ? game.studentView(c.player) : c.role === 'teacher' ? game.teacherView() : game.screenView());
  game.onChange(() => {
    for (const c of clients) {
      if (c.role === 'student' && !game.players.has(c.player.id)) {
        push(c, 'kicked', {});
        c.res.end();
        clients.delete(c);
        continue;
      }
      push(c, 'state', viewFor(c));
    }
  });
  game.onFx((event) => {
    for (const c of clients) push(c, 'fx', event);
  });
  let lastPos = '';
  const tick = setInterval(() => {
    if (game.stepBall(0.1)) for (const c of clients) push(c, 'ball', [+game.ball.x.toFixed(2), +game.ball.y.toFixed(2)]);
    const pos = JSON.stringify(game.positions());
    if (pos === lastPos) return;
    lastPos = pos;
    for (const c of clients) c.res.write(`event: pos\ndata: ${pos}\n\n`);
  }, 100);
  const keepAlive = setInterval(() => {
    for (const c of clients) c.res.write(': ping\n\n');
  }, 15000);

  const isTeacher = (url) => url.searchParams.get('key') === key;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
    const path = url.pathname;
    try {
      if (path === '/events') {
        const role = url.searchParams.get('role');
        let client;
        if (role === 'student') {
          const p = game.player(url.searchParams.get('token'));
          if (!p) return json(res, 401, { error: 'Unknown player' });
          client = { res, role, player: p };
          game.setOnline(p, +1);
        } else if ((role === 'teacher' || role === 'screen') && isTeacher(url)) client = { res, role };
        else return json(res, 403, { error: 'Wrong key' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 1500\n\n');
        clients.add(client);
        push(client, 'state', viewFor(client));
        res.write(`event: pos\ndata: ${JSON.stringify(game.positions())}\n\n`);
        req.on('close', () => {
          clients.delete(client);
          if (client.player && game.players.has(client.player.id)) game.setOnline(client.player, -1);
        });
        return;
      }

      if (req.method === 'POST' && path.startsWith('/api/')) {
        const body = await readBody(req);
        const action = path.slice(5);
        if (action === 'join') {
          const p = game.join(body.name, body.avatar);
          return json(res, 200, { token: p.token, id: p.id });
        }
        if (action.startsWith('teacher/')) {
          if (!isTeacher(url)) return json(res, 403, { error: 'Wrong key' });
          return json(res, 200, await teacherAction(game, action.slice(8), body));
        }
        const p = game.player(body.token);
        if (!p) return json(res, 401, { error: 'Unknown player: join again' });
        if (action === 'move') {
          game.move(p, body.x, body.y, body.dir, body.moving);
          return json(res, 200, { ok: true, mode: game.mode });
        }
        if (action === 'emote') return json(res, 200, { ok: game.emote(p, body.e) });
        if (action === 'hat') {
          game.setHat(p, body.hat);
          return json(res, 200, { ok: true });
        }
        if (action === 'answer') {
          const a = game.submit(p, body);
          return json(res, 200, { ok: true, state: a.state });
        }
        return json(res, 404, { error: 'Unknown action' });
      }

      if (req.method === 'GET' && path === '/api/info')
        return json(res, 200, { lesson: game.lesson.title, studentUrl: `http://${host}:${port}/` });

      if (req.method === 'GET') return serveStatic(req, res, path);
      send(res, 405, 'Method not allowed');
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  await new Promise((ok) => server.listen(port, '0.0.0.0', ok));
  const info = {
    port,
    key,
    game,
    studentUrl: `http://${host}:${port}/`,
    teacherUrl: `http://localhost:${port}/teacher?key=${key}`,
    screenUrl: `http://localhost:${port}/screen?key=${key}`,
    close: () => {
      clearInterval(tick);
      clearInterval(keepAlive);
      for (const c of clients) c.res.end();
      return new Promise((ok) => server.close(ok));
    },
  };
  return info;
}

async function teacherAction(game, action, b) {
  switch (action) {
    case 'mode':
      game.setMode(b.mode);
      break;
    case 'seat':
      game.takeSeats(Number(b.seconds) || 20);
      break;
    case 'slide':
      game.goSlide(b.slide);
      break;
    case 'cue':
      game.cue();
      break;
    case 'url':
      game.setScreenUrl(b.url);
      break;
    case 'open':
      game.open(b.key || b.def);
      break;
    case 'close':
      game.close();
      break;
    case 'score':
      if (game.scoring) throw new Error('Already scoring');
      // Runs in the background; results arrive over the event stream.
      game.score().catch((e) => game.log('scoring:', e.message));
      break;
    case 'set-score':
      game.setScore(b.pid, b.score, b.feedback);
      break;
    case 'reveal':
      game.reveal();
      break;
    case 'spotlight':
      game.setSpotlight(b.pid || null);
      break;
    case 'timer':
      game.setTimer(b.seconds);
      break;
    case 'finale':
      game.setFinale(b.on !== false);
      break;
    case 'kick':
      game.kick(b.pid);
      break;
    case 'rename':
      game.rename(b.pid, b.name);
      break;
    default:
      throw new Error('Unknown teacher action');
  }
  return { ok: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = args(process.argv.slice(2));
  start(opts)
    .then((s) => {
      console.log(`\n  Class game is running (${s.game.lesson.title})`);
      console.log(`  Students:  ${s.studentUrl}`);
      console.log(`  Teacher:   ${s.teacherUrl}`);
      console.log(`  Projector: ${s.screenUrl}`);
      console.log(`  AI scoring: ${s.game.aiMode}   Session file: ${s.game.sessionFile}\n`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
