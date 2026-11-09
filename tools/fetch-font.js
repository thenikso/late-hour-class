#!/usr/bin/env node
// Downloads the Monocraft font (SIL Open Font License) into public/fonts/.
// Without it the game falls back to the system monospace font.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/fonts/Monocraft.ttf');
const urls = [
  'https://github.com/IdreesInc/Monocraft/releases/latest/download/Monocraft.ttf',
  'https://raw.githubusercontent.com/IdreesInc/Monocraft/main/dist/Monocraft.ttf',
  'https://github.com/IdreesInc/Monocraft/raw/main/dist/Monocraft.ttf',
];
for (const url of urls) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10000) throw new Error('file too small');
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buf);
    console.log(`Saved Monocraft (${Math.round(buf.length / 1024)} KB) from ${url}`);
    process.exit(0);
  } catch (e) {
    console.log(`  ${url}: ${e.message}`);
  }
}
console.log('Could not download Monocraft. Get Monocraft.ttf from https://github.com/IdreesInc/Monocraft/releases and put it in public/fonts/.');
process.exit(1);
