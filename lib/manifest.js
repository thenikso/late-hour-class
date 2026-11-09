// Loads a lesson: either a game-ready HTML deck (a normal slide deck that
// carries <script type="application/json" id="game-lesson"> plus optional
// data-game-* attributes on its slides) or a standalone JSON manifest.
// Nothing here knows about any particular course.

import { readFile } from 'node:fs/promises';

const isUrl = (s) => /^https?:\/\//i.test(s);

async function readSource(source) {
  if (isUrl(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not fetch ${source}: HTTP ${res.status}`);
    return res.text();
  }
  return readFile(source, 'utf8');
}

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decode(m[1]) : undefined;
};

/** Pull the slide list out of an HTML deck: id, kind, segment, title, linked questions. */
export function parseSlides(html) {
  const slides = [];
  const re = /<section\b([^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*)>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const id = attr(attrs, 'id') ?? String(slides.length + 1);
    const h = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(body);
    const title = h ? decode(h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()) : '';
    const q = attr(attrs, 'data-game-question');
    slides.push({
      n: slides.length + 1,
      id,
      mode: attr(attrs, 'data-mode') || 'teach',
      seg: attr(attrs, 'data-seg') || '',
      block: attr(attrs, 'data-block') || '',
      title,
      room: attr(attrs, 'data-game-room') || null,
      questions: q ? q.split(/\s+/).filter(Boolean) : [],
    });
  }
  return slides;
}

export function parseManifestJson(html) {
  const m = /<script\b[^>]*id="game-lesson"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  return JSON.parse(m[1]);
}

export function normaliseLesson(raw, slides = []) {
  const lesson = {
    title: raw.title || 'Lesson',
    questions: {},
    order: [],
    slides,
  };
  for (const [key, q] of Object.entries(raw.questions || {})) {
    lesson.questions[key] = normaliseQuestion(key, q);
    lesson.order.push(key);
  }
  // A question names its slide either in the manifest or through the slide attribute.
  for (const s of slides)
    for (const key of s.questions)
      if (lesson.questions[key] && !lesson.questions[key].slide) lesson.questions[key].slide = Number(s.id);
  return lesson;
}

export function normaliseQuestion(key, q) {
  const out = {
    key,
    kind: q.kind || 'text',
    title: q.title || key,
    prompt: q.prompt || '',
    context: q.context || '',
    slide: q.slide ? Number(q.slide) : null,
    scored: q.scored !== false,
    rubric: q.rubric || [],
    example: q.example || '',
    parts: q.parts || [],
    minutes: q.minutes || null,
  };
  if (out.kind === 'choice') {
    out.options = q.options || [];
    out.correct = q.correct ?? null; // index or array of indexes; null = poll
    out.partial = q.partial || []; // indexes worth half
    out.zones = q.zones !== false;
    out.shuffle = !!q.shuffle;
    out.reasons = q.reasons || null; // { options: [...], correct: [...] }
    out.text = q.text ? { prompt: q.text.prompt || '', parts: q.text.parts || [], rubric: q.text.rubric || out.rubric } : null;
  }
  if (out.kind === 'grid') {
    out.options = q.options || [];
    out.rows = (q.rows || []).map((r) => ({
      text: r.text,
      options: r.options || null,
      correct: r.correct === undefined ? null : [].concat(r.correct),
    }));
  }
  return out;
}

export async function loadLesson(source) {
  if (!source) return normaliseLesson({ title: 'Ad-hoc lesson' });
  const text = await readSource(source);
  if (/^\s*[{[]/.test(text)) return normaliseLesson(JSON.parse(text));
  const raw = parseManifestJson(text) || { title: 'Slides only' };
  return normaliseLesson(raw, parseSlides(text));
}
