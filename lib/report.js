// A short report of one session, for the teacher after class. It answers the
// questions the trial is judged by: did (nearly) everyone hand in each
// exercise, and how long did it take?
//
// It reads a session file (data/session-….json) and returns Markdown.
// By default it holds no names: `names: true` adds a line per student.

import { needsAi } from './scoring.js';

const HAND_IN_TARGET = 0.9; // the design's bar: 90% hand in each exercise

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const mmss = (ms) => {
  if (!(ms > 0)) return '–';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function sessionReport(data, { names = false } = {}) {
  const players = data.players || [];
  const records = Object.values(data.records || {})
    .filter((r) => Object.keys(r.answers).length)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const out = [`# ${data.lesson || 'Lesson'}: session report`, '', `Saved ${data.savedAt || '?'} · ${players.length} students · ${records.length} questions answered`, ''];

  out.push('| Question | Handed in | Everyone in after | Open for | Average score | Retries | To look at |', '| --- | --- | --- | --- | --- | --- | --- |');
  let metTarget = 0;
  const missed = new Map();
  for (const rec of records) {
    const entries = Object.values(rec.answers);
    // `present` is how many were online at the close; older files fall back to the class size.
    const present = Math.max(rec.present || players.length, entries.length);
    if (entries.length / present >= HAND_IN_TARGET) metTarget++;
    const scores = entries.map((e) => e.attempts.at(-1).ai?.score).filter((s) => typeof s === 'number');
    const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) + '/3' : needsAi(rec.def) ? 'not scored' : '–';
    const retries = entries.filter((e) => e.attempts.length > 1).length;
    const flagged = entries.filter((e) => (e.attempts.at(-1).flags || []).some((f) => f.level === 'look')).length;
    for (const e of entries) {
      const m = e.attempts.at(-1).ai?.missed;
      if (m) missed.set(m, (missed.get(m) || 0) + 1);
    }
    out.push(
      `| ${rec.def.title} | ${entries.length}/${present} (${pct(entries.length, present)}) | ${mmss(rec.allInAt - rec.openedAt)} | ${mmss(rec.closedAt - rec.openedAt)} | ${average} | ${retries || '–'} | ${flagged || '–'} |`,
    );
  }

  out.push('', `**Hand-in target (${HAND_IN_TARGET * 100}% of the room):** met on ${metTarget} of ${records.length} questions.`);
  if (missed.size) {
    out.push('', '## Concepts to go over again', '');
    for (const [concept, n] of [...missed].sort((a, b) => b[1] - a[1]).slice(0, 8)) out.push(`- ${concept} (${n})`);
  }
  const asks = (data.asks?.items || []).filter((it) => it.status !== 'hidden');
  if (asks.length) {
    out.push('', '## Questions students asked', '');
    for (const it of asks.sort((a, b) => b.votes.length - a.votes.length)) out.push(`- ${it.text}${it.votes.length ? ` (+${it.votes.length})` : ''}${it.status === 'answered' ? ' ✓' : ''}`);
  }
  if (names) {
    out.push('', '## Students', '', '| Name | Handed in | Points | Improved |', '| --- | --- | --- | --- |');
    for (const p of [...players].sort((a, b) => a.name.localeCompare(b.name))) {
      const handedIn = records.filter((r) => r.answers[p.id]).length;
      out.push(`| ${p.name} | ${handedIn}/${records.length} | ${p.points} | ${p.improved || '–'} |`);
    }
  }
  return out.join('\n') + '\n';
}
