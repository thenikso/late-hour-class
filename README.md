# Late Hour Class

**LHC** for short: a classroom game for the last hour of a long lesson, when attention is lowest.

The design and its reasons are in [docs/design.md](docs/design.md); a 1-page tour of the codebase for students is in [ARCHITECTURE.md](ARCHITECTURE.md); notes for working on the code (by hand or with an AI agent) are in [AGENTS.md](AGENTS.md); how to send a change is in [CONTRIBUTING.md](CONTRIBUTING.md).

A pixel-art classroom that runs from the teacher's laptop. Students join from their own browser over the classroom Wi-Fi, pick an avatar and walk around a shared room. The teacher drives the slides on the room's screen, seats everyone for explanations, opens questions, and reveals scores with a bit of show.

One Node process, nothing to install, no build step. Node 20 or later. The only outside code is CodeMirror, the editor students type in, which ships ready-made in `public/vendor/`.

## Run the sample deck

```sh
npm run example     # the sample deck + game, AI scoring with your local `claude` CLI
```

It prints three links:

| Who | Link | Open it on |
| --- | --- | --- |
| Students | `http://<laptop-ip>:3000/` | their laptops or phones, same Wi-Fi |
| Teacher | `http://localhost:3000/teacher?key=…` | your laptop |
| Projector | `http://localhost:3000/screen?key=…` | the projector window (press F for a full-screen slide) |

The key is random each run and only works from the links printed at start. Keep the teacher and projector links to yourself.

To try every kind of question, the three rooms and the trophies without any slides: `npm run demo` (it reads `example/demo-lesson.json`, a lesson written as plain JSON).

Other ways to start it:

```sh
npm run example:mock                 # offline fake scoring, for trying things out
npm run example -- --ai codex        # score with the codex CLI instead
npm run example -- --ai off          # score by hand only
npm run example -- --resume data/session-2026-11-16-10-02.json   # carry on after a restart
npm run example -- --no-gate         # let the teacher move on without the "anyway" step
npm run example -- --term off        # don't carry points and trophies between lessons
npm run report                       # after class: hand-in rates, timings, what was missed
npm test                             # simulated students through the main flows
```

The first time, macOS asks whether `node` may accept incoming connections: say yes, or students can't reach it. Before class, open the student link from your phone on the classroom Wi-Fi to check. Some guest networks block devices from seeing each other; a phone hotspot is the fallback.

## Starting from the last hour

In the teacher view, type a slide number in **Go to** and press Enter (or click the slide in the list). Slides with a question show a ▶ button under them: it jumps to that slide and opens the question in one go.

## What the teacher can do

- **Room:** Free roam, Take your seat (a countdown, then everyone is seated and the slides fill the screen), Presentation, or share any URL on the screen.
- **Rooms:** *Door to* Classroom, Open floor or Workshop. The door opens for a few seconds and the class walks through together; anyone left is moved along. A question can name its room, and then opening it opens the door first. *Take your seat* and *Presentation* always bring everyone back to the classroom.
- **Slides:** ◀ ▶, E for the next reveal step (also the arrow keys and E on the keyboard), Go to, and the speaker notes for the current slide.
- **Questions:** open, close, *Suggest scores* (AI), adjust any score 0–3 and its feedback, *Reveal to everyone*, toggle names on the projector wall (anonymous by default), then *Show a sound answer* if the lesson has one. 1-click micro-checks (*Pulse: Makes sense?*, *Confidence line*, *True / False*) and custom quick questions can be asked on the spot.
- **The submit gate:** while students are still writing, *Close* reads *Close anyway (3 still writing)*, and anything else that would move the room on (another question, Presentation, Take your seat) asks first. Changing slide is always free. Only you see the names.
- **Hot seat:** *Spotlight* puts one answer on the projector and walks its author to the front of the room; *Pick someone* chooses at random among those who answered.
- **Students ask:** students send questions about the lesson with *Ask* (tagged with the current slide). Real questions go on a board where classmates vote; anything else is held for you to post or dismiss. *On projector* shows the top five before your next explanation.
- **Players:** see who is online, rename, unlock an offline seat for rejoin (`↺`, so a student switching devices keeps their points and answers), or remove someone.
- **After class:** *Report* (or `npm run report`) gives the hand-in rate and timing of every question, the concepts the scorer said were missed, and the questions students asked.
- **Pace and mood:** a soft timer on the open question (1, 2, 3 or 5 minutes; nothing closes by itself), a note in the top bar when students press *I'm lost*, and **Finale** for the last minute of class: a podium, who improved, who never missed a question.

The flags next to answers (short, unmarked parts, mostly pasted, written very fast, close to another answer) are prompts to look or ask, never penalties.

## Question kinds

- **choice:** students walk into the zone of their answer (or click, with `"zones": false`). Options can be shuffled, can carry a "because ①②③" reason, and can have a written follow-up. With `"correct": null` it is a poll.
- **grid:** a row of buttons per line, like the tick boxes on a worksheet. Each row can have its own options and more than one accepted answer.
- **rapid:** a grid answered on the floor, one line at a time. The intro and the current line are on the projector; students stand in a zone before the clock runs out (`"seconds"` per line, 10 by default; you can change it while the round runs, from 10 to 60 seconds, and the line being answered gets the new time too), see the right answer for a moment, and the next line comes up by itself. The round closes itself after the last line; you still reveal the points. Each student sees the options in their own zones, shuffled again on every line, so following the crowd doesn't help (`"scramble": false` turns that off). Not standing in a zone costs nothing.
- **line:** an opinion line. Students stand anywhere between two ends ("Disagree" … "Agree"); the result is the spread across the room. Never right or wrong.
- **bug:** spot the bug. Students click the faulty line of a piece of code; you see who found it and how fast.
- **code:** the code bench. Students write JavaScript and run it against the lesson's checks. The code runs only in their own browser; you see the code next to the ticks.
- **text:** a written answer. If the question names parts, students mark them in their text with buttons that write `==①…==` (shown as a tinted span with a numbered badge; the `==` only appear while the cursor is on them); correctly marked parts raise the multiplier.

Any question can be **pair work** (`"pairs": true`): students are put in twos and seated side by side, one hand-in counts for both, and it is scored once. A written pair question is **one shared draft per desk**: whoever holds the pen types, the others at the desk watch it appear and can click *Take the pen*. The draft belongs to the desk, so a student who moves to another desk sees and writes that desk's draft. Drafts go only to the students at that desk and to you; the teacher view shows every desk's draft as it is typed.

## Scoring, for fun

Chips × multiplier, counted up on screen. Handing in is worth 10; a right choice or the right line of a bug 30 (half right 15); a right reason 15; 10 per right grid or rapid row, or passing check; the AI or teacher score is worth 15 per point (0–3). Each correctly marked part adds ×0.5.

Two bonuses reward showing up rather than being right: handing in several questions in a row (+5 for each one in the run, up to +25), and +10 for everyone when the whole room hands in before you close. Missing a question costs nothing.

Retries are never penalised: when the answer missed something, the student gets a *Try again*, up to three attempts, and the best one counts. A better retry earns an IMPROVED badge, and the projector shows "Improved today" next to the top five.

AI scoring sends the question, the rubric and the answers (as a1, a2…, no names) to the CLI on your laptop. If it fails or is slow, score by hand: the buttons work without it.

## The fun parts

- **Walking:** arrow keys or WASD, or tap/click the floor and your avatar finds its way there. Furniture is solid: you walk around desks, and you can stand behind or in front of them.
- **E:** use what is next to you. Sit on a free chair, read a trophy on the sill or upper shelf, go through the open door, grab coffee in free roam, or pet the cat. A hint at the bottom of the screen says what E would do; on a touch screen, tap the hint.
- **Reactions:** six bubbles over your avatar (keys 1–6 or the top bar), and Space to hop. *I'm lost* also tells the teacher, quietly; *Got it* clears it.
- **Hats:** your own points unlock hats; improving an answer on a retry unlocks the scholar cap.
- **Class goal:** everyone's points fill one bar. Each level adds something to the room for all: fairy lights, a cat, an arcade machine and a ball to kick around in breaks, a disco ball at results time, a golden trophy.
- **Celebrations:** confetti and a tune when everyone has handed in, when the class levels up, and on your own screen for a good answer. Sound is off until you turn it on.

- **Trophies:** a lesson can give the class a trophy for each idea it practised. It lands on the shelf by the screen when its question is revealed; students walk up to it (or press *Trophies*) to read a short reminder and open the slide where it was taught. The shelf fills up over the term.
- **Your place:** each student sees their own place on today's board next to their points. The class only ever sees the top five.

Points and trophies carry over between lessons in `data/term.json`, matched by the name a student types. Today's board starts at zero each lesson; hats unlock on the term total.

During a presentation the room stays calm: no hopping, the cat naps, and the slides cover the room.

## Making a deck game-ready

The game reads the lesson from the deck itself:

1. Add a JSON block with the questions:

   ```html
   <script type="application/json" id="game-lesson">
   { "title": "Good guesses",
     "questions": {
       "g": { "kind": "choice", "title": "Box G · Choose one check",
              "prompt": "Choose one check, before you see any result. Walk to it.",
              "options": ["① …", "② …", "③ …", "④ …"], "correct": [2], "partial": [1],
              "text": { "prompt": "What would A and B each show?", "parts": ["if A", "if B"],
                        "rubric": ["…"] } } } }
   </script>
   ```

   Optional, next to `"questions"`: trophies for the ideas the lesson practises.

   ```json
   "trophies": [ { "after": "g", "name": "One check at a time", "sprite": "flask",
                   "text": "One or two lines to remember.", "example": "…", "slide": 17 } ]
   ```

   `after` is the question whose reveal earns it (leave it out to award it by hand). Sprites: cup, star, tape, bug, key, book, flask, bulb, flag, gear.

   A question can also say where it happens and how: `"room": "floor"` (open floor, good for zones and opinion lines) or `"lab"` (the workshop, with tables for two), and `"pairs": true`. A slide can set the room for all its questions with `data-game-room="lab"`.

2. Tie each question to its slide: `<section class="slide" data-game-question="g" …>` (several keys separated by spaces).
3. Load `game-bridge.js` (copy it from `example/slides/`) so the game can press E on the slide and jump between slides instantly. It also lets a slide talk to the game on the projector: `classGame.open('g')`, `classGame.timer(120)`, `classGame.trophy('m')`, `classGame.room('lab')`, for example from a button on the slide.

The slide list (numbers, titles, task and break slides) comes from the deck's own `data-mode`, `data-seg` and headings. See `example/slides/sample-deck.html` for a short, complete example: 6 questions on 7 of its 9 slides, with speaker notes and hidden answers.

Slides are served by `tools/serve-slides.js` in two copies: the student copy (port 3001, on the Wi-Fi) has the speaker notes and the answer boxes on task slides removed, so they can't be read from the page source; the teacher copy (port 3002, this laptop only) is the full deck for the projector and the notes.

To run another deck: `node server.js --lesson <teacher deck url> --deck <student deck url> --projector <teacher deck url> --notes "<teacher deck url>?view=notes"`, with the slides served by `node tools/serve-slides.js <lectures folder>`.

## Files

See [ARCHITECTURE.md](ARCHITECTURE.md) for a walkthrough of how a student action flows through the codebase.

- `server.js`: HTTP server, live updates (server-sent events), student and teacher action tables, graceful shutdown.
- `lib/`: room state (`game.js`), question lifecycle & pairs (`questions.js`), shared desk drafts (`desks.js`), rapid rounds (`rapid.js`), pure scoring (`scoring.js`), role views (`views.js`), the questions board (`asks.js`), atomic persistence (`session.js`, `term.js`), the report (`report.js`), the lesson reader (`manifest.js`), quick checks (`checks.js`), AI scoring (`ai.js`).
- `public/js/shared/`: pure modules imported by both Node and the browser — `world.js`, `things.js`, `rooms.js`, `path.js`, `fun.js`, `marks.js`, `util.js`.
- `public/`: the three pages (student, teacher, projector), room art & rendering (`room-shell.js`, `room.js`, `sprites.js`), QR join code (`qr.js`), CodeMirror wrappers (`editors.js`), code bench sandbox (`code-bench.js`), and styles.
- `public/assets/`: the office tileset and the 8 avatar sheets, from The Agency (CC0 1.0, see `public/assets/LICENSE.md`).
- `public/vendor/codemirror.js`: CodeMirror 6 (MIT), bundled once from `tools/vendor/` (`npm install && npm run build` there to rebuild).
- `test/`: isolated unit and ephemeral-port HTTP integration tests (`npm test`).
- `tools/`: `serve-slides.js`, `run-example.js`, `report.js`, `cut-sprites.js`, `shrink-image.js`.
- `example/slides/`: a short game-ready sample deck, the tiny slide engine it uses (`deck.js`, `deck.css`) and `game-bridge.js`.
- `example/*.json`: lessons without a deck (`demo-lesson.json` has every question kind).
- `data/`: one session file per class, with names and answers. It is git-ignored; keep it off any public repository.

## Not built

Optional side rooms for early finishers, an AI check on the questions board, and sign-in with school accounts.

## Contributing

Ideas, bug reports and pull requests are welcome, from students and anyone else. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it explains which changes get in, and that using AI is fine as long as you say so. Please follow the [code of conduct](CODE_OF_CONDUCT.md), and report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). The art in `public/assets/` is CC0 (see `public/assets/LICENSE.md`), the Monocraft font is SIL OFL (`public/fonts/OFL.txt`), and CodeMirror is MIT (`public/vendor/CODEMIRROR-LICENSE`).
