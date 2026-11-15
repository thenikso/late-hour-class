// What carries over from one lesson to the next: each student's points (so a
// bad day is not final, and hats unlock over the term) and the concept
// trophies on the shelf. It lives in one small JSON file next to the session
// files, on the teacher's laptop only.
//
//   { "players":  { "ada": { "name": "Ada", "points": 320, "improved": 2 } },
//     "trophies": [ { "key": "Week 8:g", "name": "…", "text": "…", … } ] }
//
// Students are matched by the name they type (lower-cased). That is good
// enough for cosmetic rewards, and it means no accounts.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const emptyTerm = () => ({ players: {}, trophies: [] });
export const termKey = (name) => String(name).trim().toLowerCase();

export async function loadTerm(file, log = console.log) {
  if (!file) return emptyTerm();
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return emptyTerm(); // first lesson: no file yet
  }
  try {
    const data = JSON.parse(text);
    return { players: data.players || {}, trophies: data.trophies || [] };
  } catch {
    // Never overwrite a file we could not read: keep a copy and start fresh.
    await copyFile(file, `${file}.bad`);
    log(`Could not read ${file}; kept a copy as ${file}.bad and started a fresh term file.`);
    return emptyTerm();
  }
}

export async function saveTerm(file, term) {
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ savedAt: new Date().toISOString(), ...term }, null, 2));
}
