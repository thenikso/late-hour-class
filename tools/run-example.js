#!/usr/bin/env node
// Runs the Week 8 example: the slide server (student and teacher copies) and the game.
//   npm run example            AI scoring with the local `claude` CLI
//   npm run example -- --ai codex | mock | off
//   npm run example -- --port 3000 --resume data/session-….json --data <folder> --term <file|off> --no-gate

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveSlides } from './serve-slides.js';
import { start, printStartup } from '../server.js';

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
  data: val('data'),
  term: val('term'),
  'no-gate': argv.includes('--no-gate'),
  lesson: `http://127.0.0.1:${teacherPort}/${deck}`,
  deck: `http://{host}:${slidesPort}/${deck}`,
  projector: `http://localhost:${teacherPort}/${deck}`,
  notes: `http://localhost:${teacherPort}/${deck}?view=notes`,
});
printStartup(s);
