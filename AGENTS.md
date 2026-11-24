# AGENTS.md

Instructions for AI coding agents (and humans) working on this repo. `CLAUDE.md` is a symlink to this file.

Late Hour Class (LHC) is a pixel-art classroom game that runs from the teacher's laptop. Students join from their browsers over the classroom Wi-Fi, walk around a shared room as avatars, and answer questions; the teacher drives the slides on the room's screen, seats everyone for explanations, opens questions and reveals scores. The goal is to keep students working through 3-hour lessons, especially the last hour.

The design and the reasons behind it are in [docs/design.md](docs/design.md). The README covers running it and making a deck game-ready.

## Who this is for

Nicola Peduzzi built it for a weekly 3-hour course and maintains it; it has been used in real lessons since November 2026. It is open source so that students (and anyone else) can read it and send changes. A Claude skill makes each week's deck game-ready, so the engine itself must stay generic.

**Before you change anything, read [CONTRIBUTING.md](CONTRIBUTING.md).** It says which changes get accepted, how to declare AI help in a pull request, and the checklist a pull request must pass. If you are an AI agent preparing a contribution, follow it: keep the change small and focused, add tests, and write the AI disclosure in the pull request description.

## Commands

```sh
npm run example:mock   # the sample deck with fake offline scoring (no AI)
npm run example        # same, scoring with the local `claude` CLI
npm run demo           # every question kind, the three rooms and trophies, from example/demo-lesson.json (mock AI)
npm run week10         # "The weakest link": 30-minute after-midterm lesson, example/week-10-weakest-link.json (no deck)
npm test               # node:test, isolated unit + HTTP integration tests (over 45 tests across 8 files)
npm run report         # Markdown report of the newest session in data/ (add a file, or --names)
npm start -- --lesson <deck url> --deck <student deck url> --projector <deck url> --notes "<deck url>?view=notes"
node tools/serve-slides.js <lectures folder>   # student copy on :3001 (LAN), full copy on :3002 (localhost)
```

`npm run example` prints the student, teacher and projector links. The teacher and projector links carry a random key that changes every run.

The Monocraft font is committed in `public/fonts/`; there is no download step.

`.claude/launch.json` has three previews, `example-mock`, `demo` and `week10` (the last two with teacher key `demo`); both use `--data data/preview`, so browser checks never touch the real `data/term.json`.

## Hard rules

- **No install, no build step.** Node 20+ built-ins only on the server; plain ES modules, HTML and CSS in the browser. Students may read every file one day, so keep the code plain and commented where it isn't obvious. The one outside library is CodeMirror 6, vendored as a single pre-bundled file (`public/vendor/codemirror.js`, rebuilt from `tools/vendor/`); it holds no game logic, and the game's own code stays unbundled. Don't add another dependency without the maintainer agreeing first (open an issue).
- **The engine is course-neutral.** No course- or school-specific logic in `server.js`, `lib/` or `public/`. Course content arrives only through a lesson manifest (in a deck or a JSON file) and a deck URL. The sample deck in `example/slides/` is just an example.
- **The server is the only source of truth.** Clients send intentions (move, answer); the server validates, decides and broadcasts. Zone answers use the player's position on the server, not what the client claims. The one exception is the code bench: student code runs only in that student's browser (a Web Worker), which reports which checks passed; the teacher sees the code beside the result. Never run student code on the server.
- **Student text is never rendered as HTML.** Use `textContent`, the `h()` helper in `public/js/common.js`, or `marksToHtml()` (which escapes first). Keep it that way everywhere, including the projector.
- **Scores are for fun.** They never feed a grade. Retries are never penalised: the best attempt counts, and a better retry earns the IMPROVED badge. Leaderboards show only the top 5 plus "Improved today".
- **Fun never costs points, and never shames.** Streaks and the team bonus reward handing in, not being right or fast; missing one costs nothing. Hats, the class goal and the finale are cosmetic. Nothing shows the class who has *not* handed in or who is lost (only the teacher sees that). Effects stay off the slides: no hops, cat or disco during a presentation.
- **Flags are never penalties.** Fast checks (short, unmarked parts, pasted, written very fast, similar to another answer) only prompt the teacher to look or ask.
- **AI calls are anonymised.** Answers go to the CLI as `a1`, `a2`…, never with names. The teacher's score is final and the game must work with `--ai off`.
- **The gate is the teacher's, the names are private.** While students are still writing, closing, opening another question or going to Presentation needs `force` (the "anyway" button). Who is still writing, who is lost and held messages go to the teacher view only; keep them out of `baseView`.
- **Session data stays local.** `data/` holds names and answers and is git-ignored. Never commit it, and never copy it into the course repo or anywhere public.

## How it fits together

See [ARCHITECTURE.md](ARCHITECTURE.md) for the student-facing tour.

- `server.js`: `node:http` server. `GET /events` is a server-sent events stream per client (`state`, `pos`, `fx`, `ball`, `kicked`). SSE also carries `desk` (a shared desk draft, only to that desk and the teacher). Actions are two tables: `STUDENT_ACTIONS` (`POST /api/<action>` with a token) and `TEACHER_ACTIONS` (`POST /api/teacher/<action>?key=…`). `GET /report?key=…` is the session report. Also serves `public/`. `start(opts)` is exported for tests (supports `port: 0`).
- `lib/game.js`: the `Game` class: players (including teacher-unlocked rejoin), rooms and the shared door (`openDoor`, `goThrough`, `arrive`, `enter`), room modes (`free`, `seating`, `present`, `question`, `review`), the shared screen, ball physics, spotlight/hot seat, trophies, totals.
- `lib/rapid.js`: rapid rounds: the clock that moves through the lines (`startRapid`, `stepRapid`), locking each line from where players stand, and each student's own zone order (`rapidOrder`).
- `lib/desks.js`: shared desk drafts for written pair work: which desk a player is at (`deskAt`, from the server position), the pen (`writeDraft`, `takePen`), who a desk's hand-in counts for (`deskGroup`). Live text goes as `desk` events to that desk and the teacher only.
- `lib/questions.js`: the question life cycle (`open`, `submit`, `close`, `score`, `setScore`, `reveal`, `showExample`, `setTimer`), pair work (`makePairs`, `groupOf`), the submit gate (`checkGate`, `GateError`), pending retry counts and hand-in streaks.
- `lib/scoring.js`: pure functions: `needsAi`, `autoScore`, `canRetry` (written + code bench), `breakdown` and the `POINTS` table.
- `lib/views.js`: `studentView`, `teacherView`, `screenView`. `baseView` is what everyone gets; anything private is added in `teacherView` or under `me` / `mine`. The projector answer wall is anonymous by default (`wallNames: false`).
- `lib/asks.js`: the questions board (`AskBoard`, with slide tags): a plain rule decides posted or held; votes; teacher moderation.
- `lib/session.js` & `lib/term.js`: atomic JSON persistence for session files (`save`/`restore`, `--resume`) and `data/term.json` (term totals + trophy shelf).
- `lib/report.js`: the Markdown report built from a session file.
- `lib/manifest.js`: reads a lesson from a deck URL/file or a JSON file; `normaliseQuestion()` is the manifest schema in code (including optional `stretch` prompt for early finishers).
- `lib/checks.js`: fast rule checks. `lib/ai.js`: prompt-injection-hardened prompt building and the `claude` / `codex` / `mock` / `off` scorers.
- `public/js/shared/`: pure modules shared by server and browser — `fun.js` (avatars, emotes, hats, class goal, bonuses), `world.js` (room shell, zones, opinion line, trophy shelf slots), `rooms.js` (room data and collision/seating), `things.js` (furniture catalogue), `path.js` (half-tile A*), `marks.js` (part marks and HTML escaping), `util.js` (`isSet`, `clamp`, Fisher-Yates `shuffle`).
- `public/js/room-shell.js` & `room.js`: cached room shell/cat routes and live baseline-sorted canvas rendering. `public/js/sprites.js` loads and draws the sprite sheets. `public/js/qr.js` draws the projector join QR code.
- `public/js/code-bench.js`: spot the bug, the code bench, and the sandboxed Web Worker.
- `public/js/editors.js`: the two CodeMirror editors: `proseEditor` and `codeEditor`.
- `public/js/student.js`, `student-sheet.js`, `student-panels.js`, `teacher.js`, `teacher-question.js`, `screen.js`: the three pages. `common.js` has the DOM helper, SSE connection, screen iframe and score count-up.
- `tools/serve-slides.js`: serves a lectures folder twice. The student copy strips speaker notes (`.sn`) and the answer boxes (`data-cue`) on `data-mode="work"` slides; the teacher copy is the full deck, on localhost only.
- `docs/screenshots/`: the README pictures (projector, student, teacher), taken from the sample deck with made-up students. Retake them when the look changes a lot.
- `example/slides/`: a short sample deck (`sample-deck.html`, the tests use it too), its tiny slide engine (`deck.js`, `deck.css`) and `game-bridge.js`, the script any deck loads to work inside the game.

A player's position is the top-left of the tile they fill; their feet (`FEET`, and the small `FOOT_BOX` that collides) are near its bottom. The browser walks with `walk()` (it slides along furniture); the server only checks `canStand()` for each reported position and ignores a move into something solid. Every room must keep the door, the hot seat, the front strip and every seat free: a test checks it.

On the student page E uses what is within reach (`withinReach()` in `student.js`: sit, read a trophy, the open door, the cat); add new interactions there. Sitting is just standing exactly on a chair's spot.

When the server moves a player (a seat, the hot seat, another room) it calls `Game.place`, which raises that player's `warp` number. The browser follows when it sees a new number and echoes it with every move; a move carrying an old number is ignored.

The shared screen is an iframe that always renders at 1280×720 and is scaled with a CSS transform (`placeFrame()` in `common.js`). Don't resize the iframe itself: the decks are scroll-snap documents and reflowing them lands on the wrong slide. Slides change by setting the iframe URL to `deck#n`; the E cue is a `postMessage({type:'lhc:cue'})` that `game-bridge.js` turns into an `e` keypress. The bridge also makes in-game slide jumps instant.

## The fun layer

Everything here is in `public/js/fun.js` (rules), `Game` (state) and `room.js` / `common.js` (drawing and effects).

- **Emotes and hops:** `POST /api/emote` with one of six fixed ids, or `hop`; rate-limited on the server and sent to everyone as a one-off `fx` event (never stored). "I'm lost" also shows the teacher a count with names, cleared by "Got it" or a new slide.
- **Hats:** unlocked by a player's own points, or by improving an answer on a retry (the scholar cap). `POST /api/hat`; the server checks the unlock.
- **Class goal:** everyone's points together, with thresholds per student (`CLASS_LEVELS`). Each level adds something to the room: fairy lights, a cat, the games corner (arcade machine and a ball to kick in free roam), a disco ball for results, a trophy. A level, once reached, stays (`classLevel` is saved in the session file).
- **Streak and team bonus:** see Scoring below.
- **Soft timer:** the teacher can show a countdown on an open question. Nothing closes by itself, except a `rapid` round, which the teacher starts and can stop early.
- **Finale:** a teacher button; the projector shows a podium of three, "Improved today", the longest hand-in streak and the class totals.
- The ball is simulated on the server (`Game.stepBall`, ten times a second) and sent as `ball` events.

## Lesson manifest

A deck becomes game-ready with a `<script type="application/json" id="game-lesson">` block (`title`, `questions`) and `data-game-question="key [key…]"` on the slide `<section>`. Question kinds:

- `text`: `prompt`, `parts` (named parts students mark as `==①…==`), `rubric`, `example`.
- `choice`: `options`, `correct` (index, list, or `null` for a poll), `partial`, `zones` (default true: answer by standing in a floor zone), `shuffle`, `reasons` (`{options, correct}`), optional `text` follow-up (`{prompt, parts, rubric}`).
- `grid`: `options`, `rows` (`{text, options?, correct}`; `correct` can be a list).
- `rapid`: `options` (2–4, the floor zones), `rows` (`{text, correct}`), `seconds` per line (default 10; the teacher can change it live with `rapid-seconds`, 5–120), `scramble` (default true: every student gets their own zone order, new on every line). Runs by itself: intro, then each line, then its answer for 3 seconds; closes itself after the last line. The one exception to "nothing closes by itself". Stored and scored like a grid.
- `bug`: `code`, `correct` (line number or list, from 1). `code`: `starter`, `tests` (`[{ name, check }]`, each check a JavaScript expression that must be true).
- `line`: `labels` (the two ends). Always unscored; the answer is where the student stands (0–100).
- Any kind: `title`, `context`, `stretch` (optional extra challenge for early finishers), `scored: false` for unscored polls, `room` (`floor` or `lab`: the door opens first), `pairs: true` (one answer per pair; a `text` pair question is one shared draft per desk, see `lib/desks.js`).

Next to `questions`, `trophies`: `[{ after, name, sprite, text, example, slide }]` (see `normaliseTrophy`).

Scoring lives in `lib/scoring.js` (`breakdown()`): handed in 10; a hand-in streak +5 per question in a row (up to +25); +10 each when everyone online handed in before the close; right choice (or bug line) 30, half 15; right reason 15; 10 per right grid or rapid row, or passing check; AI/teacher score ×15 (0–3); +0.5 multiplier per correctly marked part. Retry is offered when the AI names something missed or scores under 2, or when a code bench check failed, up to 3 attempts. A question to the teacher that got a vote adds 5 to its author (up to 15).

## Art

The front wall is glass: `paintWall()` in `public/js/room-shell.js` draws the view (`public/assets/room/panorama.png`, 512 × 96, drawn with codex and shrunk with `tools/shrink-image.js`), then the frame, the sill and the door in code. Trophies stand on the sill.

The office tileset and the 8 avatar sheets in `public/assets/` come from The Agency (a small multiplayer office game by mrosati), dedicated to the public domain under CC0; see `public/assets/LICENSE.md`. Tiles are 16 px in an 8-column sheet; avatars are 16×24 frames, 4 columns × 10 rows (idle ×4 directions, walk ×4, sit from behind, drink). Monocraft (SIL OFL) is the UI font. New art should match: 16 px tiles, crisp pixel scaling.

The sheets in `public/assets/fun/` (hats, emote icons, the cat, room props, trophies) were drawn with `codex exec` image generation. To add art: ask codex for one sheet on a flat magenta (#FF00FF) background, a strict grid, one item per cell, chunky 16-bit style, no text or shadows; then `node tools/cut-sprites.js in.png out.png --cols N --rows M --cell 16` shrinks it to crisp sprites with a dark outline. Look at the result enlarged before using it.

## Testing

- `npm test` runs isolated unit tests plus ephemeral-port (`port: 0`) HTTP integration tests with mock AI. Add a test for every rule you change in `lib/`.
- For UI changes, check in a browser with several students. Browsers allow 6 SSE connections per origin, so give each simulated student its own Playwright browser context. Check the student view at a laptop width (sheet docked on the right, ≥1000 px) and a narrow one (sheet at the bottom), the teacher view, and the projector in present mode.
- Use `--ai mock` for anything automated; never call the real `claude` CLI from tests.

## Making a change

- Follow [CONTRIBUTING.md](CONTRIBUTING.md). In short: one focused change per pull request, a test for every rule you change in `lib/`, `npm test` green, a browser check for UI changes, the docs updated (this file, `README.md`, `ARCHITECTURE.md`) when behaviour or structure changes, and AI help declared in the pull request.
- Only changes that make the game better for every class are accepted: no course-specific logic in the engine, nothing that weakens the hard rules above.
- Commits: a short imperative subject ("Let the teacher …", "Fix …"), then a plain body saying what changed and why. The maintainer commits to `main`; contributors work on a branch of their fork and open a pull request.
- Write in plain, short English, leading with the result. Student-facing words in the game are short and friendly, in plain English. Avoid jargon on the student pages.
- Never commit anything from `data/` (names and answers of real students), secrets, or a real class's answers.
