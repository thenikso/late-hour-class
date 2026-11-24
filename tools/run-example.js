#!/usr/bin/env node
// Runs the sample deck (example/slides): the slide server (student and teacher copies) and the game.
//   npm run example            AI scoring with the local `claude` CLI
//   npm run example -- --ai codex | mock | off
//   npm run example -- --port 3000 --resume data/session-….json --data <folder> --term <file|off> --no-gate

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { serveSlides } from './serve-slides.js';
import { start, printStartup } from '../server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '3000' },
    'slides-port': { type: 'string', default: '3001' },
    ai: { type: 'string', default: 'claude' },
    resume: { type: 'string' },
    host: { type: 'string' },
    data: { type: 'string' },
    term: { type: 'string' },
    'no-gate': { type: 'boolean', default: false },
  },
});

const port = Number(values.port);
const slidesPort = Number(values['slides-port']);
const teacherPort = slidesPort + 1;
const deck = 'sample-deck.html';

const slides = await serveSlides(join(ROOT, 'example/slides'), { port: slidesPort, teacherPort });
const s = await start({
  port,
  ai: values.ai,
  resume: values.resume,
  host: values.host,
  data: values.data,
  term: values.term,
  'no-gate': values['no-gate'],
  lesson: `http://127.0.0.1:${teacherPort}/${deck}`,
  deck: `http://{host}:${slidesPort}/${deck}`,
  projector: `http://localhost:${teacherPort}/${deck}`,
  notes: `http://localhost:${teacherPort}/${deck}?view=notes`,
});
printStartup(s);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await s.close({ flush: true });
    await slides.close();
    process.exit(0);
  });
}
