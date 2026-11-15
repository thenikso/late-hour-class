# CLAUDE.md

A pixel-art classroom game that runs from the teacher's laptop. Students join from their browsers over the classroom Wi-Fi, walk around a shared room as avatars, and answer questions; the teacher drives the slides on the room's screen, seats everyone for explanations, opens questions and reveals scores. The goal is to keep students working through 3-hour lessons, especially the last hour.

The design and the reasons behind it are in [docs/design.md](docs/design.md). The README covers running it and making a deck game-ready.

## Who this is for

Nicola Peduzzi teaches Software Engineering at H-Farm and is the only user and developer. The first real use is the last hour of Week 8 (Monday 16 November 2026, slides 25–30), if the students are up for it. Later, a Claude skill will make each week's deck game-ready; the engine itself must stay generic.

## Commands

```sh
npm run example:mock   # Week 8 example with fake offline scoring (no AI)
npm run example        # same, scoring with the local `claude` CLI
npm test               # node:test, simulated students through the main flows (23 tests)
npm run report         # Markdown report of the newest session in data/ (add a file, or --names)
npm start -- --lesson <deck url> --deck <student deck url> --projector <deck url> --notes "<deck url>?view=notes"
node tools/serve-slides.js <lectures folder>   # student copy on :3001 (LAN), full copy on :3002 (localhost)
```

`npm run example` prints the student, teacher and projector links. The teacher and projector links carry a random key that changes every run.

The Monocraft font is committed in `public/fonts/`; there is no download step.

`.claude/launch.json` runs the mock example with `--data data/preview`, so browser checks never touch the real `data/term.json`.

## Hard rules

- **Zero dependencies, no build step.** Node 20+ built-ins only on the server; plain ES modules, HTML and CSS in the browser. Students may read every file one day, so keep the code plain and commented where it isn't obvious. If an editor (ProseMirror, CodeMirror) arrives later, it comes as one pre-bundled vendored file; the game's own code stays unbundled.
- **The engine is course-neutral.** No Software Engineering or H-Farm logic in `server.js`, `lib/` or `public/`. Course content arrives only through a lesson manifest (in a deck or a JSON file) and a deck URL. The Week 8 deck in `example/` is just an example.
- **The server is the only source of truth.** Clients send intentions (move, answer); the server validates, decides and broadcasts. Zone answers use the player's position on the server, not what the client claims.
- **Student text is never rendered as HTML.** Use `textContent`, the `h()` helper in `public/js/common.js`, or `marksToHtml()` (which escapes first). Keep it that way everywhere, including the projector.
- **Scores are for fun.** They never feed a grade. Retries are never penalised: the best attempt counts, and a better retry earns the IMPROVED badge. Leaderboards show only the top 5 plus "Improved today".
- **Fun never costs points, and never shames.** Streaks and the team bonus reward handing in, not being right or fast; missing one costs nothing. Hats, the class goal and the finale are cosmetic. Nothing shows the class who has *not* handed in or who is lost (only the teacher sees that). Effects stay off the slides: no hops, cat or disco during a presentation.
- **Flags are never penalties.** Fast checks (short, unmarked parts, pasted, written very fast, similar to another answer) only prompt the teacher to look or ask.
- **AI calls are anonymised.** Answers go to the CLI as `a1`, `a2`…, never with names. The teacher's score is final and the game must work with `--ai off`.
- **The gate is the teacher's, the names are private.** While students are still writing, closing, opening another question or going to Presentation needs `force` (the "anyway" button). Who is still writing, who is lost and held messages go to the teacher view only; keep them out of `baseView`.
- **Session data stays local.** `data/` holds names and answers and is git-ignored. Never commit it, and never copy it into the course repo or anywhere public.

## How it fits together

- `server.js`: `node:http` server. `GET /events` is a server-sent events stream per client (`state`, `pos`, `fx`, `ball`, `kicked`). Actions are two tables: `STUDENT_ACTIONS` (`POST /api/<action>` with a token) and `TEACHER_ACTIONS` (`POST /api/teacher/<action>?key=…`). `GET /report?key=…` is the session report. Also serves `public/`. `start(opts)` is exported for tests.
- `lib/game.js`: the `Game` class: players, room modes (`free`, `seating`, `present`, `question`, `review`), the shared screen (slide number and cue count), the question life cycle (open, submit, close, score, reveal, retry), the submit gate (`checkGate`, `GateError`), spotlight and hot seat, trophies, totals and the session JSON (`save`/`restore`, `--resume`).
- `lib/scoring.js`: pure functions: `needsAi`, `autoScore`, `canRetry`, `breakdown` and the `POINTS` table.
- `lib/views.js`: `studentView`, `teacherView`, `screenView`. `baseView` is what everyone gets; anything private is added in `teacherView` or under `me` / `mine`.
- `lib/asks.js`: the questions board (`AskBoard`): a plain rule decides posted or held; votes; teacher moderation.
- `lib/term.js`: `data/term.json`: points per student name and the trophy shelf, across lessons.
- `lib/report.js`: the Markdown report built from a session file.
- `lib/manifest.js`: reads a lesson from a deck URL/file or a JSON file; `normaliseQuestion()` is the manifest schema in code.
- `lib/checks.js`: fast rule checks. `lib/ai.js`: prompt building and the `claude` / `codex` / `mock` / `off` scorers.
- `public/js/fun.js`: the fun layer's rules, shared by server and browser: emotes, hats and how they unlock, class goal levels, streak and team bonus sizes.
- `public/js/world.js`: room geometry shared by server and browser (tiles, screen, floor, seats, zones, option shuffling).
- `public/js/room.js` draws the room on one canvas (tiles painted once, avatars each frame, labels at screen resolution). `public/js/sprites.js` loads the tileset and avatar sheets.
- `public/js/trophies.js`: trophy sprites written as text, one letter per pixel.
- `public/js/student.js` (join, walking, top bar), `student-sheet.js` (the question sheet and result card), `student-panels.js` (hats, Ask, trophies), `teacher.js`, `screen.js`: the three pages. `common.js` has the DOM helper, the SSE connection, the screen iframe and the score count-up.
- `tools/serve-slides.js`: serves a lectures folder twice. The student copy strips speaker notes (`.sn`) and the answer boxes (`data-cue`) on `data-mode="work"` slides; the teacher copy is the full deck, on localhost only.
- `example/lectures/`: copies of the course's slide engine and the Week 8 deck, plus `scripts/game-bridge.js`.

When the server moves a player (a seat, the hot seat) it calls `Game.place`, which raises that player's `warp` number. The browser follows when it sees a new number and echoes it with every move; a move carrying an old number is ignored.

The shared screen is an iframe that always renders at 1280×720 and is scaled with a CSS transform (`placeFrame()` in `common.js`). Don't resize the iframe itself: the decks are scroll-snap documents and reflowing them lands on the wrong slide. Slides change by setting the iframe URL to `deck#n`; the E cue is a `postMessage({type:'cge:cue'})` that `game-bridge.js` turns into an `e` keypress. The bridge also makes in-game slide jumps instant.

## The fun layer

Everything here is in `public/js/fun.js` (rules), `Game` (state) and `room.js` / `common.js` (drawing and effects).

- **Emotes and hops:** `POST /api/emote` with one of six fixed ids, or `hop`; rate-limited on the server and sent to everyone as a one-off `fx` event (never stored). "I'm lost" also shows the teacher a count with names, cleared by "Got it" or a new slide.
- **Hats:** unlocked by a player's own points, or by improving an answer on a retry (the scholar cap). `POST /api/hat`; the server checks the unlock.
- **Class goal:** everyone's points together, with thresholds per student (`CLASS_LEVELS`). Each level adds something to the room: fairy lights, a cat, the games corner (arcade machine and a ball to kick in free roam), a disco ball for results, a trophy. A level, once reached, stays (`classLevel` is saved in the session file).
- **Streak and team bonus:** see Scoring below.
- **Soft timer:** the teacher can show a countdown on an open question. Nothing closes by itself.
- **Finale:** a teacher button; the projector shows a podium of three, "Improved today", the longest hand-in streak and the class totals.
- The ball is simulated on the server (`Game.stepBall`, ten times a second) and sent as `ball` events.

## Lesson manifest

A deck becomes game-ready with a `<script type="application/json" id="game-lesson">` block (`title`, `questions`) and `data-game-question="key [key…]"` on the slide `<section>`. Question kinds:

- `text`: `prompt`, `parts` (named parts students mark as `==①…==`), `rubric`, `example`.
- `choice`: `options`, `correct` (index, list, or `null` for a poll), `partial`, `zones` (default true: answer by standing in a floor zone), `shuffle`, `reasons` (`{options, correct}`), optional `text` follow-up (`{prompt, parts, rubric}`).
- `grid`: `options`, `rows` (`{text, options?, correct}`; `correct` can be a list).
- `line`: `labels` (the two ends). Always unscored; the answer is where the student stands (0–100).
- Any kind: `title`, `context`, `scored: false` for unscored polls.

Next to `questions`, `trophies`: `[{ after, name, sprite, text, example, slide }]` (see `normaliseTrophy`).

Scoring lives in `lib/scoring.js` (`breakdown()`): handed in 10; a hand-in streak +5 per question in a row (up to +25); +10 each when everyone online handed in before the close; right choice 30, half 15; right reason 15; 10 per right grid row; AI/teacher score ×15 (0–3); +0.5 multiplier per correctly marked part. Retry is offered when the AI names something missed or scores under 2, up to 3 attempts. A question to the teacher that got a vote adds 5 to its author (up to 15).

## Art

The office tileset and the 8 avatar sheets in `public/assets/` come from The Agency (a small multiplayer office game, git author mrosati, local copy in `/Users/nikso/Work/H-Farm/TheAgency`), dedicated to the public domain under CC0; see `public/assets/LICENSE.md`. Tiles are 16 px in an 8-column sheet; avatars are 16×24 frames, 4 columns × 10 rows (idle ×4 directions, walk ×4, sit from behind, drink). Monocraft (SIL OFL) is the UI font. New art should match: 16 px tiles, crisp pixel scaling.

The sheets in `public/assets/fun/` (hats, emote icons, the cat, room props) were drawn with `codex exec` image generation. To add art: ask codex for one sheet on a flat magenta (#FF00FF) background, a strict grid, one item per cell, chunky 16-bit style, no text or shadows; then `node tools/cut-sprites.js in.png out.png --cols N --rows M --cell 16` shrinks it to crisp sprites with a dark outline. Look at the result enlarged before using it.

## Testing

- `npm test` starts the real server on port 3990 with mock AI and drives it over HTTP. Add a test for every rule you change in `lib/`.
- For UI changes, check in a browser with several students. Browsers allow 6 SSE connections per origin, so give each simulated student its own Playwright browser context. Check the student view at a laptop width (sheet docked on the right, ≥1000 px) and a narrow one (sheet at the bottom), the teacher view, and the projector in present mode.
- Use `--ai mock` for anything automated; never call the real `claude` CLI from tests.

## Working with Nicola

- Write to Nicola in plain, short English, leading with the result.
- This repo is local only for now (no remote). Commit to `main` with clear messages; don't push anywhere unless asked.
- Student-facing words in the game are short and friendly, in plain English. Avoid jargon on the student pages.
