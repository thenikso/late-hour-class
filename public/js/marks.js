// Part marks inside an answer: ==①the part== means "this span is required part 1".
// Shared by the server (checks, AI prompt) and the browser (editor, rendering).

import { CIRCLED } from './world.js';

const MARK = /==([①-⑨])([\s\S]*?)==/g;

export function parseMarks(text = '') {
  const parts = {};
  for (const m of text.matchAll(MARK)) {
    const n = CIRCLED.indexOf(m[1]) + 1;
    if (n > 0) parts[n] = (parts[n] ? parts[n] + ' … ' : '') + m[2].trim();
  }
  return parts;
}

export const stripMarks = (text = '') => text.replace(MARK, (_, __, inner) => inner);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Escaped HTML with marked parts wrapped in coloured spans. Never renders student HTML. */
export function marksToHtml(text = '') {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    out += esc(text.slice(last, m.index));
    const n = CIRCLED.indexOf(m[1]) + 1;
    out += `<span class="mark m${n}"><b>${m[1]}</b>${esc(m[2])}</span>`;
    last = m.index + m[0].length;
  }
  return (out + esc(text.slice(last))).replace(/\n/g, '<br>');
}

export { esc };
