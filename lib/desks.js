// Shared desk drafts: in pair work on a written answer, the students at one desk
// write ONE draft together. The draft belongs to the desk, not to a student: sit
// at another desk and you see (and write) that desk's draft.
//
// Only one student at a desk writes at a time: whoever holds the pen. The others
// watch the text appear and can take the pen at any moment. The pen is free when
// nobody holds it, or when its holder left the desk or went offline; the first to
// type then picks it up. One writer at a time means there is nothing to merge.
//
// A desk is two neighbouring seats (seatPairs in rooms.js), plus the spot right
// beside them, where a third member of an odd group stands. Like zone answers,
// "where you are" is always the server's idea of your position.
//
// Live text travels as small `desk` events to the desk's members and the teacher
// only (see server.js), never in the shared state: drafts stay private to the desk.

import { ROOMS, seatPairs } from '../public/js/shared/rooms.js';

const BESIDE = 1.1; // how far beside a desk's outer seat still counts as "at the desk"
const MAX_TEXT = 4000;

/** Shared drafts are on for written pair work, in a room with seats, while the question is live. */
export function deskMode(game, rec = game.live) {
  return !!(
    rec &&
    rec.def.pairs &&
    rec.def.kind === 'text' &&
    ROOMS[game.room].seats.length >= 2 &&
    (rec.status === 'open' || rec.status === 'revealed')
  );
}

/** The desk at (x, y) in a room: on one of its two seats or right beside them. -1 if none. */
export function deskAt(roomId, x, y) {
  let best = -1;
  let bestGap = Infinity;
  seatPairs(roomId).forEach(([a, b], n) => {
    if (Math.abs(y - a.y) > 0.6) return;
    const gap = Math.max(0, Math.min(a.x, b.x) - x, x - Math.max(a.x, b.x)); // 0 on or between the seats
    if (gap <= BESIDE && gap < bestGap) {
      best = n;
      bestGap = gap;
    }
  });
  return best;
}

/** The desk a player is at right now, or -1 (also -1 when drafts are off). */
export function deskOf(game, p) {
  if (!deskMode(game) || p.gone || !(p.online > 0)) return -1;
  return deskAt(game.room, p.x, p.y);
}

/** Players at desk `n` right now. */
export function membersAt(game, n) {
  return game.online().filter((p) => deskOf(game, p) === n);
}

/** The draft of desk `n` for this question, made on first use. */
export function deskDraft(rec, n) {
  rec.desks ||= {};
  return (rec.desks[n] ||= { text: '', v: 0, pen: null, writers: [], meta: { pastedChars: 0, activeMs: 0 } });
}

/** Who holds the pen, if they are still at the desk; otherwise the pen is free (null). */
export function penHolder(game, rec, n) {
  const pen = rec.desks?.[n]?.pen;
  const p = pen && game.players.get(pen);
  return p && deskOf(game, p) === n ? p : null;
}

/** A player moved (or was put somewhere): if they changed desk, everyone's view changes. */
export function deskMoved(game, p) {
  const n = deskOf(game, p);
  if (n === (p.desk ?? -1)) return;
  p.desk = n;
  game.changed();
}

/** A question just opened: note where everyone sits. */
export function refreshDesks(game) {
  for (const p of game.players.values()) p.desk = deskOf(game, p);
}

/** The student holding (or picking up) the pen sends the desk's text as it is now. */
export function writeDraft(game, p, body) {
  const rec = game.live;
  const n = deskOf(game, p);
  if (n < 0) throw new Error('Sit at a desk to write');
  const draft = deskDraft(rec, n);
  const holder = penHolder(game, rec, n);
  if (holder && holder.id !== p.id) throw new Error(`${holder.name} has the pen`);
  const tookPen = draft.pen !== p.id;
  draft.pen = p.id;
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : draft.text;
  // How it was typed, as reported by the writer's browser since the last send: only for flags.
  draft.meta.pastedChars += Math.max(0, Number(body.meta?.pastedChars) || 0);
  draft.meta.activeMs += Math.max(0, Number(body.meta?.activeMs) || 0);
  if (text !== draft.text) {
    draft.text = text;
    draft.v += 1;
    if (!draft.writers.includes(p.id)) draft.writers.push(p.id);
    game.deskEvent(n, { key: rec.key, n, text: draft.text, v: draft.v });
  }
  if (tookPen) game.changed(); // the others at the desk now watch
  return draft.v;
}

/** Take the pen from whoever has it: one click, no asking. */
export function takePen(game, p) {
  const rec = game.live;
  const n = deskOf(game, p);
  if (n < 0) throw new Error('Sit at a desk first');
  deskDraft(rec, n).pen = p.id;
  game.changed();
}

/**
 * Who a desk's hand-in counts for: everyone at the desk now, and everyone who wrote
 * in it and is not at another desk now (stepped away, or offline for a moment).
 */
export function deskGroup(game, rec, n) {
  const ids = membersAt(game, n).map((p) => p.id);
  for (const id of deskDraft(rec, n).writers) {
    const p = game.players.get(id);
    if (p && !ids.includes(id) && deskOf(game, p) < 0) ids.push(id);
  }
  return ids;
}

/** One desk as its members see it (the text arrives here and in `desk` events). */
export function deskView(game, rec, n) {
  const draft = deskDraft(rec, n);
  const pen = penHolder(game, rec, n);
  return {
    n,
    text: draft.text,
    v: draft.v,
    pen: pen?.id ?? null,
    penName: pen?.name ?? null,
    members: membersAt(game, n).map((p) => ({ id: p.id, name: p.name })),
  };
}

/** Every desk with someone at it or something written, for the teacher. */
export function allDesks(game, rec) {
  const used = new Set(Object.keys(rec.desks || {}).map(Number));
  for (const p of game.online()) {
    const n = deskOf(game, p);
    if (n >= 0) used.add(n);
  }
  return [...used].sort((a, b) => a - b).map((n) => deskView(game, rec, n));
}
