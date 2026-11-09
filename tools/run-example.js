#!/usr/bin/env node
// Runs the Week 8 example: the slide server (student and teacher copies) and the game.
//   npm run example            AI scoring with the local `claude` CLI
//   npm run example -- --ai codex | mock | off
//   npm run example -- --port 3000 --resume data/session-….json

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveSlides } from './serve-slides.js';
import { start } from '../server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const val = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};

const port = Number(val('port', 3000));
const slidesPort = Number(val('slides-port', 3001));
const teacherPort = slidesPort + 1;
const deck = 'week-08/week-08-slides.html';

await serveSlides(join(ROOT, 'example/lectures'), { port: slidesPort, teacherPort });
const s = await start({
  port,
  ai: val('ai', 'claude'),
  resume: val('resume'),
  host: val('host'),
  lesson: `http://127.0.0.1:${teacherPort}/${deck}`,
  deck: `http://{host}:${slidesPort}/${deck}`,
  projector: `http://localhost:${teacherPort}/${deck}`,
  notes: `http://localhost:${teacherPort}/${deck}?view=notes`,
});
console.log(`\n  ${s.game.lesson.title}: ${s.game.lesson.slides.length} slides, ${s.game.lesson.order.length} questions`);
console.log(`  Students:  ${s.studentUrl}`);
console.log(`  Teacher:   ${s.teacherUrl}`);
console.log(`  Projector: ${s.screenUrl}`);
console.log(`  AI scoring: ${s.game.aiMode}   Session file: ${s.game.sessionFile}\n`);
