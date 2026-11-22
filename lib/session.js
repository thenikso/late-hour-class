// Session persistence: saves and restores a class session as JSON, and provides
// atomic file writes so a laptop crash or Ctrl+C never leaves a half-written file.

import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BASE, nearestFree, seatAt } from '../public/js/shared/rooms.js';
import { saveTerm, termKey } from './term.js';

/** Write `data` as pretty JSON via a temporary sibling file, then rename atomically. */
export async function atomicWriteJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Pick up a saved session after a crash or restart: players keep their tokens. */
export function restoreSession(game, data) {
  for (const saved of data.players || []) {
    const p = {
      hat: '',
      carried: 0,
      carriedImproved: 0,
      warp: 0,
      rejoinOpen: false,
      ...saved,
      online: 0,
      moving: false,
      gone: false,
      emoteAt: 0,
      lostAt: 0,
      back: null,
    };
    // Snap into a valid floor spot in case the session came from an older layout.
    Object.assign(p, nearestFree(BASE, p.x, p.y));
    p.seat = seatAt(BASE, p.x, p.y);
    game.players.set(p.id, p);
    if (p.token) game.byToken.set(p.token, p.id);
  }

  game.records = data.records || {};
  game.nextId = data.nextId || game.players.size + 1;

  // Older session files have no question order: rebuild it from the opening times.
  Object.values(game.records)
    .sort((a, b) => a.openedAt - b.openedAt)
    .forEach((r, i) => {
      r.seq = r.seq || i + 1;
    });
  game.seq = Math.max(0, ...Object.values(game.records).map((r) => r.seq));

  game.asks.restore(data.asks);
  for (const t of data.shelf || []) {
    if (!game.shelf.some((x) => x.key === t.key)) game.shelf.push(t);
  }
  game.classLevel = data.classLevel || 0;
  game.recount();
}

/** Persist the current session file and update the term-wide totals/trophies file. */
export async function saveSession(game) {
  const players = [...game.players.values()].map((player) => {
    // Strip transient connection and timing details before writing to disk.
    const { online: _o, emoteAt: _e, lostAt: _l, back: _b, gone: _g, rejoinOpen: _r, desk: _d, ...saved } = player;
    return saved;
  });

  const data = {
    savedAt: new Date().toISOString(),
    lesson: game.lesson.title,
    players,
    nextId: game.nextId,
    classLevel: game.classLevel,
    records: game.records,
    asks: game.asks,
    shelf: game.shelf,
  };
  await atomicWriteJson(game.sessionFile, data);

  if (!game.termFile) return;
  for (const p of game.players.values()) {
    game.term.players[termKey(p.name)] = { name: p.name, ...game.termTotals(p) };
  }
  game.term.trophies = game.shelf;
  await saveTerm(game.termFile, game.term);
}
