// The questions board: students ask the teacher something about the lesson,
// classmates vote for the questions they share, and the teacher can put the
// top ones on the projector before the next explanation.
//
// Only questions go on the board. A message that does not look like one is
// not thrown away: it is held for the teacher, who can post or dismiss it.
// The check is a plain rule on purpose (no AI call, nothing leaves the laptop).

export const ASK_MAX_CHARS = 200;
export const ASK_GAP_MS = 15_000; // one message per student in this time
export const ASK_OPEN_MAX = 5; // unanswered messages one student can have waiting

const STARTERS = /^(what|why|how|when|where|who|whom|whose|which|can|could|is|are|was|were|do|does|did|should|shall|will|would|may|might|must|has|have|isn't|aren't|doesn't|don't|what's|how's|why's)\b/i;

/** A rough test: at least three words, and a question mark or a question word up front. */
export function looksLikeQuestion(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  return text.includes('?') || STARTERS.test(text.trim());
}

export class AskBoard {
  constructor() {
    this.items = []; // { id, pid, text, slide, at, status, votes: [player id] }
    this.nextId = 1;
    this.lastAt = new Map(); // player id -> time of their last message
  }

  /**
   * Status of a message:
   *   posted    on the board for everyone
   *   held      waiting for the teacher (it did not look like a question)
   *   answered  the teacher dealt with it; off the board
   *   hidden    the teacher removed it
   */
  ask(player, text, { slide = null, now = Date.now() } = {}) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, ASK_MAX_CHARS);
    if (!text) throw new Error('Type your question first');
    if (now - (this.lastAt.get(player.id) || 0) < ASK_GAP_MS) {
      throw new Error('One question at a time: wait a few seconds');
    }
    const waiting = this.items.filter((it) => it.pid === player.id && (it.status === 'posted' || it.status === 'held'));
    if (waiting.length >= ASK_OPEN_MAX) {
      throw new Error('You have several questions waiting already');
    }
    this.lastAt.set(player.id, now);
    const item = {
      id: `q${this.nextId++}`,
      pid: player.id,
      text,
      slide: slide ? Number(slide) : null,
      at: now,
      status: looksLikeQuestion(text) ? 'posted' : 'held',
      votes: [],
    };
    this.items.push(item);
    return item;
  }

  /** "Me too": one vote per student, pressed again to take it back. Not on your own question. */
  vote(player, id) {
    const item = this.items.find((it) => it.id === id && it.status === 'posted');
    if (!item) throw new Error('That question is gone');
    if (item.pid === player.id) throw new Error('That one is yours');
    const i = item.votes.indexOf(player.id);
    if (i >= 0) item.votes.splice(i, 1);
    else item.votes.push(player.id);
    return item;
  }

  /** The teacher's word: post a held message, mark one answered, or hide it. */
  moderate(id, status) {
    if (!['posted', 'answered', 'hidden'].includes(status)) throw new Error('Unknown status');
    const item = this.items.find((it) => it.id === id);
    if (item) item.status = status;
  }

  /** Posted questions, most votes first, then oldest first. */
  posted() {
    return this.items
      .filter((it) => it.status === 'posted')
      .sort((a, b) => b.votes.length - a.votes.length || a.at - b.at);
  }

  /** How many of a player's questions got at least one vote (worth a few points, see fun.js). */
  upvotedBy(pid) {
    return this.items.filter((it) => it.pid === pid && it.votes.length > 0 && it.status !== 'hidden').length;
  }

  toJSON() {
    return { items: this.items, nextId: this.nextId };
  }

  restore(data) {
    this.items = data?.items || [];
    this.nextId = data?.nextId || this.items.length + 1;
  }
}
