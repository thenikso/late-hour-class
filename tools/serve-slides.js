#!/usr/bin/env node
// A tiny static server for slide decks, kept apart from the game.
// It runs two copies of the same folder:
//   teacher copy  127.0.0.1:<teacher-port>  everything, including speaker notes (only this laptop can reach it)
//   student copy  0.0.0.0:<port>            speaker notes removed, and on "work" slides the hidden answers removed
// Usage: node tools/serve-slides.js <folder> [--port 3001] [--teacher-port 3002] [--keep-answers]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

/** Remove every element whose opening tag matches `open`, with all its content (balanced by tag name). */
export function removeElements(html, open) {
  let out = '';
  let pos = 0;
  const re = new RegExp(open.source, 'g');
  let m;
  while ((m = re.exec(html))) {
    if (m.index < pos) continue;
    const tag = m[1].toLowerCase();
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    tagRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = html.length;
    let t;
    while (depth && (t = tagRe.exec(html))) {
      if (t[0].endsWith('/>')) continue;
      depth += t[1] ? -1 : 1;
      if (!depth) end = t.index + t[0].length;
    }
    out += html.slice(pos, m.index);
    pos = end;
    re.lastIndex = end;
  }
  return out + html.slice(pos);
}

export function studentCopy(html, { keepAnswers = false } = {}) {
  let out = removeElements(html, /<(div)\b[^>]*\bclass="sn"[^>]*>/);
  if (!keepAnswers) {
    out = out.replace(/(<section\b[^>]*data-mode="work"[^>]*>)([\s\S]*?)(<\/section>)/g, (_, a, body, c) => {
      return a + removeElements(body, /<(\w+)\b[^>]*\bdata-cue\b[^>]*>/) + c;
    });
  }
  return out;
}

function makeServer(root, { strip, keepAnswers }) {
  return createServer(async (req, res) => {
    let file;
    try {
      const url = new URL(req.url, 'http://x');
      file = normalize(join(root, decodeURIComponent(url.pathname)));
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request');
      return;
    }

    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
      return;
    }

    try {
      let s = await stat(file);
      if (s.isDirectory()) {
        file = join(file, 'index.html');
        s = await stat(file);
      }
      if (!s.isFile()) throw new Error('not a file');
      const type = TYPES[extname(file)] || 'application/octet-stream';
      let body = await readFile(file);
      if (strip && extname(file) === '.html') {
        body = studentCopy(body.toString('utf8'), { keepAnswers });
      }
      res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
}

export async function serveSlides(folder, { port = 3001, teacherPort = 3002, keepAnswers = false } = {}) {
  const root = resolve(folder);
  const student = makeServer(root, { strip: true, keepAnswers });
  const teacher = makeServer(root, { strip: false });
  await new Promise((ok) => student.listen(port, '0.0.0.0', ok));
  await new Promise((ok) => teacher.listen(teacherPort, '127.0.0.1', ok));
  return {
    close: () => Promise.all([new Promise((ok) => student.close(ok)), new Promise((ok) => teacher.close(ok))]),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '3001' },
      'teacher-port': { type: 'string', default: '3002' },
      'keep-answers': { type: 'boolean', default: false },
    },
  });
  const folder = positionals[0] || '.';
  const port = Number(values.port);
  const teacherPort = Number(values['teacher-port']);
  serveSlides(folder, { port, teacherPort, keepAnswers: values['keep-answers'] }).then(() => {
    console.log(`  Slides for students (no notes): http://<this-laptop>:${port}/`);
    console.log(`  Slides for the teacher (full):  http://localhost:${teacherPort}/`);
  });
}
