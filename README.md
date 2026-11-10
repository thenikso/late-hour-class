# Class game engine (proof of concept)

The design and its reasons are in [docs/design.md](docs/design.md); notes for working on the code (with Claude or otherwise) are in [CLAUDE.md](CLAUDE.md).

A pixel-art classroom that runs from the teacher's laptop. Students join from their own browser over the classroom Wi-Fi, pick an avatar and walk around a shared room. The teacher drives the slides on the room's screen, seats everyone for explanations, opens questions, and reveals scores with a bit of show.

One Node process, no dependencies, no build step. Node 20 or later.

## Run the Week 8 example

```sh
npm run font        # once: downloads the Monocraft pixel font into public/fonts/
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
npm test                             # simulated students through the main flows
```

The first time, macOS asks whether `node` may accept incoming connections: say yes, or students can't reach it. Before class, open the student link from your phone on the classroom Wi-Fi to check. Some guest networks block devices from seeing each other; a phone hotspot is the fallback.

## Starting from the last hour

In the teacher view, type a slide number in **Go to** and press Enter (or click the slide in the list). Slides with a question show a ▶ button under them: it jumps to that slide and opens the question in one go. For Week 8 the last hour starts at slide 25, after Break 2.

## What the teacher can do

- **Room:** Free roam, Take your seat (a countdown, then everyone is seated and the slides fill the screen), Presentation, or share any URL on the screen.
- **Slides:** ◀ ▶, E for the next reveal step (also the arrow keys and E on the keyboard), Go to, and the speaker notes for the current slide.
- **Questions:** open, close, *Suggest scores* (AI), adjust any score 0–3 and its feedback, *Reveal to everyone*, Spotlight one answer on the projector. Quick questions can be asked on the spot.
- **Players:** see who is online, remove someone.

The flags next to answers (short, unmarked parts, mostly pasted, written very fast, close to another answer) are prompts to look or ask, never penalties.

## Question kinds

- **choice:** students walk into the zone of their answer (or click, with `"zones": false`). Options can be shuffled, can carry a "because ①②③" reason, and can have a written follow-up. With `"correct": null` it is a poll.
- **grid:** a row of buttons per line, like the tick boxes on a worksheet. Each row can have its own options and more than one accepted answer.
- **text:** a written answer. If the question names parts, students mark them in their text with buttons that write `==①…==`; correctly marked parts raise the multiplier.

## Scoring, for fun

Chips × multiplier, counted up on screen. Handing in is worth 10; a right choice 30 (half right 15); a right reason 15; 10 per right grid row; the AI or teacher score is worth 15 per point (0–3). Each correctly marked part adds ×0.5.

Retries are never penalised: when the answer missed something, the student gets a *Try again*, up to three attempts, and the best one counts. A better retry earns an IMPROVED badge, and the projector shows "Improved today" next to the top five.

AI scoring sends the question, the rubric and the answers (as a1, a2…, no names) to the CLI on your laptop. If it fails or is slow, score by hand: the buttons work without it.

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

2. Tie each question to its slide: `<section class="slide" data-game-question="g" …>` (several keys separated by spaces).
3. Load `scripts/game-bridge.js` so the game can press E on the slide and jump between slides instantly.

The slide list (numbers, titles, task and break slides) comes from the deck's own `data-mode`, `data-seg` and headings. See `example/lectures/week-08/week-08-slides.html` for the full Week 8 set: 19 questions on 14 slides.

Slides are served by `tools/serve-slides.js` in two copies: the student copy (port 3001, on the Wi-Fi) has the speaker notes and the answer boxes on task slides removed, so they can't be read from the page source; the teacher copy (port 3002, this laptop only) is the full deck for the projector and the notes.

To run another deck: `node server.js --lesson <teacher deck url> --deck <student deck url> --projector <teacher deck url> --notes "<teacher deck url>?view=notes"`, with the slides served by `node tools/serve-slides.js <lectures folder>`.

## Files

- `server.js`: HTTP server, live updates (server-sent events), teacher actions.
- `lib/`: the game state (`game.js`), the lesson reader (`manifest.js`), quick checks (`checks.js`), AI scoring (`ai.js`).
- `public/`: the three pages (student, teacher, projector), the room and avatar drawing, styles.
- `public/assets/`: the office tileset and the 8 avatar sheets, from The Agency (CC0 1.0, see `public/assets/LICENSE.md`).
- `example/lectures/`: the Week 8 deck, made game-ready.
- `data/`: one session file per class, with names and answers. It is git-ignored; keep it off any public repository.

## Not in this proof of concept

Adventure rooms and doors, trophies, the questions-only chat, avatar unlocks, the rich text and code editors, and sign-in with school accounts. They are in the spec, for later.
