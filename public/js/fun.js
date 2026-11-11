// The fun layer: emotes, hats and the class goal. Shared by the server (rules)
// and the browser (drawing), like world.js. Everything here is cosmetic:
// nothing in this file can lower a score.

/** Quick reactions shown as a bubble over the avatar. Keys 1–6 on the student page. */
export const EMOTES = [
  { id: 'wave', label: 'Hi!' },
  { id: 'yes', label: 'Got it' },
  { id: 'idea', label: 'Idea!' },
  { id: 'laugh', label: 'Ha!' },
  { id: 'heart', label: 'Nice one' },
  { id: 'lost', label: "I'm lost" }, // also tells the teacher, quietly
];
export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const EMOTE_GAP_MS = 1200; // one emote or hop per player in this time

/**
 * Hats, in sheet order (public/assets/fun/hats.png, 16 px cells in one row).
 * `at` is the player's own points; `improved` hats reward a better retry instead.
 */
export const HATS = [
  { id: 'cap', name: 'Cap', at: 30 },
  { id: 'beanie', name: 'Beanie', at: 80 },
  { id: 'party', name: 'Party hat', at: 150 },
  { id: 'headphones', name: 'Headphones', at: 230 },
  { id: 'grad', name: 'Scholar cap', improved: true },
  { id: 'pirate', name: 'Pirate hat', at: 320 },
  { id: 'wizard', name: 'Wizard hat', at: 420 },
  { id: 'crown', name: 'Crown', at: 550 },
];

export const hatUnlocked = (hat, player) => (hat.improved ? player.improved > 0 : player.points >= hat.at);
export const hatHint = (hat) => (hat.improved ? 'Improve an answer with a retry' : `${hat.at} points`);

/**
 * The class goal: everyone's points together fill one bar, and each level adds
 * something to the room for all. `at` is points per student, so a big class and
 * a small one level up at the same pace.
 */
export const CLASS_LEVELS = [
  { id: 'lights', at: 40, name: 'Fairy lights', text: 'Fairy lights on the wall' },
  { id: 'cat', at: 100, name: 'Class cat', text: 'A cat moved in' },
  { id: 'games', at: 180, name: 'Games corner', text: 'An arcade machine, and a ball to kick around in breaks' },
  { id: 'disco', at: 280, name: 'Disco ball', text: 'A disco ball for results time' },
  { id: 'trophy', at: 400, name: 'Golden trophy', text: 'The golden trophy is yours' },
];

/** Level (0–5) for a class total, plus the points bar towards the next one. */
export function classProgress(total, students, floorLevel = 0) {
  const n = Math.max(1, students);
  let level = 0;
  while (level < CLASS_LEVELS.length && total >= CLASS_LEVELS[level].at * n) level++;
  level = Math.max(level, floorLevel); // a level, once earned, stays
  const next = CLASS_LEVELS[level] || null;
  const from = level ? CLASS_LEVELS[level - 1].at * n : 0;
  const to = next ? next.at * n : from;
  return {
    total,
    level,
    from,
    to,
    next: next ? next.name : null,
    unlocked: CLASS_LEVELS.slice(0, level).map((l) => l.id),
  };
}

/** Bonus chips for handing in several questions in a row (never for being right or fast). */
export const streakChips = (before) => 5 * Math.min(5, Math.max(0, before));
export const FULL_HOUSE_CHIPS = 10;
