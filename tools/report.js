#!/usr/bin/env node
// Prints a report of one session: hand-in rates, timings, what was missed.
//   node tools/report.js data/session-2026-11-16-10-02.json [--names]
// Without a file it uses the newest session in ./data.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionReport } from '../lib/report.js';

const argv = process.argv.slice(2);
let file = argv.find((a) => !a.startsWith('--'));
if (!file) {
  const sessions = (await readdir('data').catch(() => [])).filter((f) => /^session-.*\.json$/.test(f)).sort();
  if (!sessions.length) {
    console.error('No session files in ./data. Usage: node tools/report.js <session.json> [--names]');
    process.exit(1);
  }
  file = join('data', sessions.at(-1));
}
process.stdout.write(sessionReport(JSON.parse(await readFile(file, 'utf8')), { names: argv.includes('--names') }));
