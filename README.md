# Class game engine

The design and its reasons are in [docs/design.md](docs/design.md); notes for working on the code (with Claude or otherwise) are in [CLAUDE.md](CLAUDE.md).

A pixel-art classroom that runs from the teacher's laptop. Students join from their own browser over the classroom Wi-Fi, pick an avatar and walk around a shared room. The teacher drives the slides on the room's screen, seats everyone for explanations, opens questions, and reveals scores with a bit of show.

One Node process, no dependencies, no build step. Node 20 or later.

## Run the Week 8 example

```sh
npm run example     # slides + game, AI scoring with your local `claude` CLI
```

It prints three links:

| Who | Link | Open it on |
| --- | --- | --- |
| Students | `http://<laptop-ip>:3000/` | their laptops or phones, same Wi-Fi |
| Teacher | `http://localhost:3000/teacher?key=…` | your laptop |
| Projector | `http://localhost:3000/screen?key=…` | the projector window (press F for a full-screen slide) |

The key is random each run and only works from the links printed at start. Keep the teacher and projector links to yourself.

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

In the teacher view, type a slide number in **Go to** and press Enter (or click the slide in the list). Slides with a question show a ▶ button under them: it jumps to that slide and opens the question in one go. For Week 8 the last hour starts at slide 25, after Break 2.

## What the teacher can do

- **Room:** Free roam, Take your seat (a countdown, then everyone is seated and the slides fill the screen), Presentation, or share any URL on the screen.
- **Slides:** ◀ ▶, E for the next reveal step (also the arrow keys and E on the keyboard), Go to, and the speaker notes for the current slide.
- **Questions:** open, close, *Suggest scores* (AI), adjust any score 0–3 and its feedback, *Reveal to everyone*, then *Show a sound answer* if the lesson has one. Quick questions can be asked on the spot: written, zones, or an opinion line.
- **The submit gate:** while students are still writing, *Close* reads *Close anyway (3 still writing)*, and anything else that would move the room on (another question, Presentation, Take your seat) asks first. Changing slide is always free. Only you see the names.
- **Hot seat:** *Spotlight* puts one answer on the projector and walks its author to the front of the room; *Pick someone* chooses at random among those who answered.
- **Students ask:** students send questions about the lesson with *Ask*. Real questions go on a board where classmates vote; anything else is held for you to post or dismiss. *On projector* shows the top five before your next explanation.
- **Players:** see who is online, rename or remove someone.
- **After class:** *Report* (or `npm run report`) gives the hand-in rate and timing of every question, the concepts the scorer said were missed, and the questions students asked.
- **Pace and mood:** a soft timer on the open question (1, 2, 3 or 5 minutes; nothing closes by itself), a note in the top bar when students press *I'm lost*, and **Finale** for the last minute of class: a podium, who improved, who never missed a question.

The flags next to answers (short, unmarked parts, mostly pasted, written very fast, close to another answer) are prompts to look or ask, never penalties.

## Question kinds

- **choice:** students walk into the zone of their answer (or click, with `"zones": false`). Options can be shuffled, can carry a "because ①②③" reason, and can have a written follow-up. With `"correct": null` it is a poll.
- **grid:** a row of buttons per line, like the tick boxes on a worksheet. Each row can have its own options and more than one accepted answer.
- **line:** an opinion line. Students stand anywhere between two ends ("Disagree" … "Agree"); the result is the spread across the room. Never right or wrong.
- **text:** a written answer. If the question names parts, students mark them in their text with buttons that write `==①…==`; correctly marked parts raise the multiplier.

## Scoring, for fun

Chips × multiplier, counted up on screen. Handing in is worth 10; a right choice 30 (half right 15); a right reason 15; 10 per right grid row; the AI or teacher score is worth 15 per point (0–3). Each correctly marked part adds ×0.5.

Two bonuses reward showing up rather than being right: handing in several questions in a row (+5 for each one in the run, up to +25), and +10 for everyone when the whole room hands in before you close. Missing a question costs nothing.

Retries are never penalised: when the answer missed something, the student gets a *Try again*, up to three attempts, and the best one counts. A better retry earns an IMPROVED badge, and the projector shows "Improved today" next to the top five.

AI scoring sends the question, the rubric and the answers (as a1, a2…, no names) to the CLI on your laptop. If it fails or is slow, score by hand: the buttons work without it.

## The fun parts

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
   { "title": "Week 8 · Debugging as finding out",
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

2. Tie each question to its slide: `<section class="slide" data-game-question="g" …>` (several keys separated by spaces).
3. Load `scripts/game-bridge.js` so the game can press E on the slide and jump between slides instantly.

The slide list (numbers, titles, task and break slides) comes from the deck's own `data-mode`, `data-seg` and headings. See `example/lectures/week-08/week-08-slides.html` for the full Week 8 set: 19 questions on 14 slides.

Slides are served by `tools/serve-slides.js` in two copies: the student copy (port 3001, on the Wi-Fi) has the speaker notes and the answer boxes on task slides removed, so they can't be read from the page source; the teacher copy (port 3002, this laptop only) is the full deck for the projector and the notes.

To run another deck: `node server.js --lesson <teacher deck url> --deck <student deck url> --projector <teacher deck url> --notes "<teacher deck url>?view=notes"`, with the slides served by `node tools/serve-slides.js <lectures folder>`.

## Files

- `server.js`: HTTP server, live updates (server-sent events), the list of student and teacher actions.
- `lib/`: the room and its rules (`game.js`), points (`scoring.js`), what each role sees (`views.js`), the questions board (`asks.js`), what carries over between lessons (`term.js`), the report (`report.js`), the lesson reader (`manifest.js`), quick checks (`checks.js`), AI scoring (`ai.js`).
- `public/`: the three pages (student, teacher, projector), the room and avatar drawing, styles.
- `public/assets/`: the office tileset and the 8 avatar sheets, from The Agency (CC0 1.0, see `public/assets/LICENSE.md`).
- `tools/cut-sprites.js`: shrinks an AI-drawn sprite sheet to crisp game-size sprites. `tools/report.js`: the session report.
- `example/lectures/`: the Week 8 deck, made game-ready.
- `data/`: one session file per class, with names and answers. It is git-ignored; keep it off any public repository.

## Not built

Adventure rooms and doors, pair tables, spot the bug, the code bench, the rich text and code editors, an AI check on the questions board, and sign-in with school accounts. They are in the design, for later.
