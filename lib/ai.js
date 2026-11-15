// Scoring with an AI CLI that runs on the teacher's laptop with their own login.
// All answers for one question go out in ONE call, with names replaced by ids.
// Modes: claude (default), codex, mock (offline heuristic, for testing), off.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMarks, stripMarks } from '../public/js/marks.js';
import { CIRCLED } from '../public/js/world.js';

const TIMEOUT_MS = 180_000;
const CLI = { claude: 'claude', codex: 'codex' }; // modes that need a command on this laptop

/** The command a mode needs if it is not installed, else null. Checked once at start. */
export function cliMissing(mode) {
  const cmd = CLI[mode];
  if (!cmd) return null;
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 10_000 });
  return probe.error?.code === 'ENOENT' ? cmd : null;
}

export function buildPrompt(question, items) {
  const isChoice = question.kind === 'choice';
  const textDef = isChoice ? question.text : question;
  const parts = textDef?.parts || [];
  const rubric = (isChoice ? question.text?.rubric : question.rubric) || question.rubric || [];
  const lines = [];
  lines.push(
    'You are helping a teacher score short written answers in class.',
    'Score each answer against the rubric. Be fair and consistent; judge understanding, not style or English.',
    'Score scale: 3 = meets every rubric point; 2 = mostly, one point weak or missing; 1 = partly, shows some understanding; 0 = missing, off-topic or wrong.',
  );
  if (parts.length)
    lines.push(
      'Students may mark which span of their answer covers each required part, written like ==①text==.',
      'For each required part, say true if the student marked it AND the marked text really is that part; false if marked wrongly; omit it if not marked.',
    );
  lines.push(
    'If the answer shows a specific concept was misunderstood or missed, name that concept in "missed" (max 6 words); otherwise null.',
    'Write "feedback" to the student: at most 2 short sentences, second person, specific, kind; if missed, say what to reconsider without giving the full answer away.',
    '',
    `QUESTION: ${question.title}`,
    question.context ? `CONTEXT: ${question.context}` : '',
    `PROMPT: ${isChoice ? question.prompt + (question.text ? ' — then: ' + question.text.prompt : '') : question.prompt}`,
  );
  if (isChoice) {
    lines.push('OPTIONS:');
    question.options.forEach((o, i) => lines.push(`  ${i + 1}. ${o}`));
    if (question.correct !== null) lines.push(`EXPECTED OPTION(S): ${[].concat(question.correct).map((i) => i + 1).join(', ')}`);
  }
  if (parts.length) lines.push('REQUIRED PARTS: ' + parts.map((p, i) => `${CIRCLED[i]} ${p}`).join('; '));
  if (rubric.length) lines.push('RUBRIC:', ...rubric.map((r) => `  - ${r}`));
  if (question.example) lines.push(`ONE SOUND ANSWER (for you, not to quote): ${question.example}`);
  lines.push('', 'ANSWERS:');
  for (const it of items) {
    const choice = isChoice && it.choice !== undefined && it.choice !== null ? ` [chose option ${it.choice + 1}]` : '';
    lines.push(`--- id=${it.id}${choice}`, it.text || '(no text)');
  }
  lines.push(
    '',
    'Reply with ONLY this JSON, no prose, no code fence:',
    '{"results":[{"id":"a1","score":2,"parts":{"1":true,"2":false},"missed":null,"feedback":"..."}]}',
  );
  return lines.filter((l) => l !== '').join('\n');
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in the AI reply');
  return JSON.parse(text.slice(start, end + 1));
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${cmd} timed out after ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start "${cmd}": ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${cmd} exited with ${code}: ${err.slice(0, 400)}`));
      else resolve(out);
    });
    child.stdin.end(input);
  });
}

async function viaClaude(prompt) {
  const out = await run('claude', ['-p', '--output-format', 'json'], prompt);
  const outer = JSON.parse(out);
  if (outer.is_error) throw new Error(`claude: ${outer.result || 'error'}`);
  return extractJson(String(outer.result ?? ''));
}

async function viaCodex(prompt) {
  const dir = await mkdtemp(join(tmpdir(), 'cge-'));
  const file = join(dir, 'last.txt');
  try {
    await run('codex', ['exec', '--skip-git-repo-check', '--output-last-message', file, '-'], prompt);
    return extractJson(await readFile(file, 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Offline stand-in so the whole loop can be tried without any AI. */
function viaMock(question, items) {
  const parts = (question.kind === 'choice' ? question.text?.parts : question.parts) || [];
  const rubric = (question.kind === 'choice' ? question.text?.rubric : question.rubric) || [];
  const vocab = new Set(rubric.join(' ').toLowerCase().match(/[a-z]{5,}/g) || []);
  return {
    results: items.map((it) => {
      const plain = stripMarks(it.text || '').toLowerCase();
      const hits = (plain.match(/[a-z]{5,}/g) || []).filter((w) => vocab.has(w)).length;
      const score = plain.length < 15 ? 0 : Math.min(3, 1 + Math.floor(hits / 2) + (plain.length > 120 ? 1 : 0));
      const marked = parseMarks(it.text || '');
      const p = {};
      parts.forEach((_, i) => {
        if (marked[i + 1]) p[i + 1] = marked[i + 1].length > 4;
      });
      return {
        id: it.id,
        score,
        parts: p,
        missed: score <= 1 ? 'the key idea of this question' : null,
        feedback:
          score >= 3
            ? 'Clear and complete. (mock scoring)'
            : score === 2
              ? 'Mostly there; tighten one point of the rubric. (mock scoring)'
              : 'Have another look at what the question asks for. (mock scoring)',
      };
    }),
  };
}

export async function scoreAnswers(mode, question, items) {
  if (!items.length) return [];
  if (mode === 'off') throw new Error('AI scoring is off (started with --ai off)');
  const prompt = buildPrompt(question, items);
  const reply =
    mode === 'mock' ? viaMock(question, items) : mode === 'codex' ? await viaCodex(prompt) : await viaClaude(prompt);
  const byId = new Map((reply.results || []).map((r) => [String(r.id), r]));
  return items.map((it) => {
    const r = byId.get(it.id) || {};
    const score = Math.max(0, Math.min(3, Math.round(Number(r.score) || 0)));
    return {
      id: it.id,
      score,
      parts: r.parts && typeof r.parts === 'object' ? r.parts : {},
      missed: r.missed ? String(r.missed).slice(0, 80) : null,
      feedback: String(r.feedback || '').slice(0, 400),
    };
  });
}
