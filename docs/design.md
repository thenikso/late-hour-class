# Classroom pixel game: design

Started 9 November 2026 by Nicola Peduzzi. This is the Markdown copy of the original spec doc (revision 31, not public), which also has the five diagrams this copy describes in words. **The spec was written before the proof of concept**; where the two differ, the [As built](#as-built-proof-of-concept-9-november-2026) section at the end says what the code actually does.

## Why and how we judge it

The game exists to keep all students working through the whole 3-hour lesson, especially the last hour, without adding to weekly prep. The pixel world is the wrapper; the real tools are the submit gate, the live answer view and questioning students on what they wrote.

The first trial is one last hour of a normal lesson. It counts as a success if:

- at least 90% of connected students submit each exercise before we move on
- the time from question to "everyone submitted" is no longer than with the paper workbook
- reviewing answers together happens in the lesson, not after it
- preparing the lesson for the game takes under 30 minutes on top of normal prep
- nothing breaks badly enough to fall back to slides and paper

## Core concept

One shared pixel classroom, seen from above, with every student as an avatar. The teacher controls what the room is doing at any moment by switching its mode; students can only act within that mode.

| Who | Opens | Can do |
| --- | --- | --- |
| Teacher | `/teacher` on the laptop | Switch modes, push questions, see all answers live, reveal, ask for AI score suggestions, kick or rename |
| Projector | `/screen` on the projector | Shows the room, the slide screen, the "19/26 submitted" counter, revealed answers |
| Student | `http://<laptop-ip>:3000` on their laptop | Pick nickname and avatar, move when allowed, answer, see their own score |

The room has a few fixed areas: rows of seats facing a big screen, an open floor that can be split into answer zones, and a corner for the leaderboard. Everything else (decoration, unlockable items) is cosmetic.

The modes and how the teacher moves between them:

- **Free roam**: students arrive, pick avatars, walk around. Used at the start and in breaks.
- **Presentation**: everyone is seated, movement is locked, the screen shows the current slide.
- **Question**: a question appears; students answer by typing or by walking to a zone.
- **Review**: answers are revealed on the screen, discussed, and scored.

*Diagram (room modes):* four modes, switched by the teacher or by the slide type. Most of a lesson loops between presentation, question and review; free roam is only for arrivals and breaks.

### Base and adventures (v2)

From version 2 the classroom becomes the **base**: the room with the seats and the slide screen, where every teaching session happens. Exercises take place in **adventure rooms** reached through doors from the base. After an adventure the class returns to the base for the next explanation, and the base now holds a new trophy that sums up what was just practised.

*Diagram (base and adventures):* teach in the base, practise in adventure rooms, return with a trophy.

Door rules:

- **Adventures are exercise rooms.** Each one is built around a mechanic (zones, answer wall, bug hunt) and themed to the exercise. A lesson might have two or three.
- **Doors open on an objective or by the teacher**: everyone submitted, a target share of correct zone answers, or the teacher forcing it. The teacher can always keep a door shut.
- **Doors are shared, not personal.** The whole class leaves and returns together; anyone who doesn't walk through in a short countdown is moved along. Otherwise the class splits and the teacher can't present to everyone.
- **Trophies are interactive props.** Walking up to one and pressing a key opens a small card: the concept's name, a one or two line reminder, a short example from Campus Event, and a link to the slide where it was taught. For example, after a requirements adventure a "measuring tape" trophy reminds students what makes a requirement testable.
- **Trophies stay for the term.** The base slowly fills up, so by the midterm it doubles as a walkable revision map of the course.
- **Prep stays small.** A trophy is a few lines in that week's manifest (name, sprite, reminder text, slide number); sprites come from a shared set so most weeks need no new art.
- **Optional side rooms** (later): a practice room early finishers can enter while the class waits, with extra questions for bonus points. The teacher can call everyone back with one button.

## Mechanics catalogue

A lesson is built by chaining these mechanics. Each one is a small, reusable building block, so authoring a lesson means choosing blocks, not writing code.

*Diagram (room mock-up):* the same room serves both "take your seat" and "stand in your zone": seats face the screen for explanations, and the open floor splits into zones when a multiple-choice question is live.

| Mechanic | What students do | What the teacher gets | Good for | Version |
| --- | --- | --- | --- | --- |
| Take your seat | Walk to any seat within a countdown (e.g. 20 s); latecomers are seated automatically when it ends | Everyone facing the screen, movement locked | Starting an explanation | v1 |
| Answer wall | Type a short answer in a text box | Live list of answers, submitted counter, reveal | Workbook questions, definitions, critiques | v1 |
| Submit gate | Must submit before the room moves on | Counter on the projector; the next step unlocks only at 100% or when the teacher overrides | Making sure nobody skips an exercise | v1 |
| Stand in your zone | Walk the avatar into one of 2 to 4 floor zones (A, B, C, D) and confirm; optionally, write one line justifying the choice | Live headcount per zone, who is where | Multiple choice, true/false, "which is the better requirement?" | v2 (built in the POC) |
| Opinion line | Stand somewhere along a line from "disagree" to "agree" | A spread you can see at a glance | Opening a discussion, confidence checks | v2 |
| Hot seat | Nothing until picked; the picked avatar walks to the front | A random or chosen student, with their answer on screen, to question in person | Checking understanding and spotting copied or AI answers | v2 (the POC has Spotlight) |
| Pair up | Paired avatars share a table and one answer box | One answer per pair | Pair exercises already in the workbooks | v3 |
| Spot the bug | Click the faulty line in a code panel on the wall | Who found it and how fast | Debugging and code-reading weeks | v3 |
| Code bench | Write and run JavaScript at a desk; it runs only in their own browser | Pass or fail against the teacher's checks | Small Campus Event JS exercises | v3 |

The hot seat matters most for honesty: students know any answer can be put on screen with them standing next to it, which discourages pasting AI output better than any detector.

### Answers with marked parts

Some workbook exercises ask for a written answer that must contain specific parts, like a check with its given, when and then. The answer box lets students mark which part of their sentence covers which required element:

```markdown
Given ==①a published event with 1 seat left==, when ==②two students register at the same moment==, then ==③only one gets the seat and the other sees "full"==.
```

- The question lists its required parts (① given, ② when, ③ then). Above the box, one button per part: select text, press ②, and the marking is inserted.
- Marking is optional. The answer is scored on content first; correct marks add a bonus or a multiplier on top.
- Marks make the AI's job easier and the review faster: the teacher view can show each answer split into its parts, side by side.
- A marked part that is wrong (a "then" that is really a step) is exactly the misunderstanding we want to spot, so the feedback names it.

### Answer editors

- **Prose answers:** a small ProseMirror editor with live markdown, like Obsidian: the `==①...==` and other marks show only while the cursor is on them, otherwise the styling is applied (each part tinted in its own colour, the number as a badge).
- **Code answers:** CodeMirror with JavaScript highlighting for the code bench and spot-the-bug rooms.
- **Version 1 uses a plain text box** with the same buttons inserting the same `==①...==` syntax. The data format is identical, so swapping in ProseMirror later changes nothing else. Both editors are a lot of client code and need a one-off bundling step (see Tech stack).

## The in-game screen

The big screen in the base is an iframe showing whatever URL the teacher shares. The game knows nothing about slides: the course serves its decks itself, on another port, and the teacher points the screen at a URL.

- **Sharing is just a URL.** When the teacher changes slide, the deck's address changes (`week-08-slides.html#12`), the teacher view sends the new URL, and every screen follows. Any page works: a deck, a Campus Event page, a GitHub file.
- **Students can open the same URL** in their own tab to read it full size, then come back to the game.
- **On the projector** `/screen` shows the room with the screen large; a key toggles a full-screen view of the shared page.
- **Speaker notes are a catch.** The decks hide notes unless opened with `?view=notes`, but they are in the HTML, so a student could read them in the page source. Students must be served a copy of the decks with the notes removed, and the full decks kept for the teacher. (The POC does this in `tools/serve-slides.js`.)
- **Later, slides can talk to the game.** A deck could send `postMessage` events to its parent window ("open the zones room now", "drop a trophy"). Optional, and it only works when the deck knows it is inside the game.

Slides keep being written exactly as now. What the game needs per lesson is described next.

## Lesson setup: the deck can be the game

A game-aware deck is the best fit: one HTML file that is a normal slide deck in a browser and, when loaded by the game, also sets up that lesson's rooms, questions and trophies. The decks already mark exercise slides as `work`, so most of the structure is there.

The engine stays generic by reading a small, course-neutral **lesson manifest**. A deck carries it as a JSON block plus a few `data-game-*` attributes on its slides:

```html
<section class="slide" id="12" data-mode="work"
         data-game-room="zones" data-game-question="nfr">
  … the slide as it is today …
</section>

<script type="application/json" id="game-lesson">
{
  "questions": {
    "nfr": {
      "kind": "choice", "justify": true,
      "prompt": "Which one is a non-functional requirement?",
      "options": ["Students can register for an event",
                  "Registration is confirmed within 2 seconds",
                  "Organisers can cancel an event"],
      "correct": 1
    }
  },
  "trophies": [
    { "after": "nfr", "name": "Measuring tape", "sprite": "tape",
      "text": "A requirement is testable when it names a threshold and a condition.",
      "slide": 11 }
  ]
}
</script>
```

(This was the initial proposal; the implemented schema is in `AGENTS.md` and `lib/manifest.js`, including trophies and `data-game-room`.)

How it works and where to draw the lines:

- **The game reads the manifest by fetching the deck URL** and parsing it, so the deck needs no game code.
- **The same manifest can live in a standalone `.json` file** for a course without HTML decks. The engine accepts either; nothing in it is specific to this course.
- **Lesson-specific props and scripts are fine inside the deck**, which runs in its iframe. Scripts that change the game world itself should go through a small, documented set of `postMessage` commands rather than reaching into the engine, or the engine stops being generic and safe.
- **Prep cost:** tagging the work slides and writing the JSON is the whole job; a week with no manifest still works with the deck on screen and questions typed on the spot.
- **Rubrics** sit in the manifest next to each question; the speaker notes are a good source, but the student copy strips the notes, so the rubric must not live only there.

## Scoring, AI suggestions and rewards

Scores are for motivation only. They never feed into the portfolio, the midterms or any Canvas grade.

Typed answers go through two passes: fast checks the moment they arrive, then proper scoring and feedback.

*Diagram (scoring pipeline):* fast checks → Claude scoring → teacher confirms → reveal → retry.

1. **Fast checks (under a second, as answers arrive).** Plain rules on the laptop: too short, missing required parts or marks, pasted in one go, written much faster than the class, nearly identical to another answer. They raise flags on the teacher view and suggest a few answers worth putting on the spot, good or problematic.
2. **Scoring and feedback (once the question closes).** One batched call to the local `claude` CLI with all answers, the rubric and the required parts, names replaced by numbers. Each answer gets a suggested score, a bonus for correct marks, and two lines of personal feedback. If an answer shows a concept was missed, the feedback says which one.
3. **Teacher confirms.** Accept all, or change any score with one click. The teacher's word is final.
4. **Retry.** A student whose feedback says the concept was missed can read it and submit again. The retry is scored again at full value and the best score counts, because understanding is the goal. A student who improves on a retry is highlighted as "improved" on the screen.

The fast pass could also use a hosted decision model. Jev (TypeSafe AI) is built for this kind of quick classification, in roughly 70 to 500 ms, but it is API-only, not local, and its listing still said "coming soon" in November 2026 ([source](https://www.cometapi.com/en/models/typesafe-ai/jev)). It would send student text to another provider, so we start with plain rules and add it later only if the rules prove too blunt.

Flags such as "possibly AI" or "pasted" are a reason to ask the student about their answer in class, never a penalty on their own. These signals are unreliable, and a wrong accusation costs more than a missed one.

Multiple choice, zone, grid and rapid answers are scored automatically, with no AI.

Rewards are cosmetic: hats, colours, pets, a desk decoration, unlocked at point thresholds over the term. Points carry over between lessons so a bad day is not final.

The leaderboard shows only the top 5 and each student's own position to themselves. A "most improved" spot gives the middle of the class something to aim for.

On privacy: answers leave the laptop only through the CLI call, without names.

### Question chat (v2)

There is one world chat, and it only accepts questions about the lesson.

- Each message gets a quick check: is it a question, and is it about what we're doing? Pertinent ones are posted; the author sees "checking…" for a moment meanwhile.
- A rejected message is not thrown away: it goes privately to the teacher, so a wrong rejection still reaches someone.
- Other students upvote questions they share. Asking a question that gets upvoted earns a point.
- Back in the base, the top questions appear on the screen for the teacher to answer before the next explanation.
- The check can be a short Claude call (a few seconds) or a decision model like Jev; plain rules can't judge whether a question is on topic.

## Look and feel: make points feel good

The interface should make scoring feel like a win: points that count up, stack and pop, like the scoring moments in Balatro. That game is inspiration for the feel only; the art, palette and effects are our own.

- **Score as a little show.** When scores are revealed, each student's points tick up piece by piece: base points for the answer, then bonuses for marks, then the multiplier, then the total lands with a bump.
- **Juice, in small doses.** Numbers that pop and wobble, a short screen shake on big totals, sounds whose pitch rises as points stack, a glow on the leaderboard line that moved.
- **One strong look.** Chunky pixel UI panels, Monocraft for all text, a dark backdrop with a slowly moving pattern, a limited palette with one loud accent colour for points.
- **Calm when teaching.** Effects play on the projector at reveal time and on each student's own screen; during explanations the room is still, so nothing competes with the slides.
- **Feedback, not just numbers.** The same card that shows the points also shows the two lines of feedback and, if offered, the retry button.

## Tech stack and architecture

The game lives in its own repo as a generic engine, with no Software Engineering logic baked in; this course is just its first user. One Node process on the teacher's laptop serves the game, holds the room state, relays messages and calls the AI. Slides are served separately, and the game only shows their URL and reads their manifest.

*Diagram (architecture):* one Node process, three kinds of client (student, teacher, projector), the slide server, files and the AI CLI on the same laptop.

| Part | Choice | Why |
| --- | --- | --- |
| Repo | Its own repo, course-neutral; lessons, rubrics and art packs come from outside | Reusable for other courses; can be opened to students later |
| Runtime | Node 20 or later | Already on the laptop |
| Server | `node:http` with server-sent events for live updates (the spec proposed the `ws` package; the POC needs no dependency at all) | No framework, nothing to install |
| Slides | Any static server on another port; the POC ships `tools/serve-slides.js` | The game only needs a URL; slides stay course business |
| Client | Plain HTML, one `<canvas>`, ES modules | Students can read every game file; nothing to compile |
| Editors | ProseMirror (prose with marks) and CodeMirror (code), from v2 | Pre-bundled once with esbuild into a vendored file; the game's own code stays unbundled |
| Art | 16×16 tiles and sprites, crisp pixel scaling | One look across everything; the POC uses CC0 art from The Agency |
| Font | Monocraft, bundled locally | Open licence (SIL OFL); matches the pixel style |
| Storage | One JSON file per session in a data folder | Names and answers stay on the laptop |
| AI | `child_process` running `claude -p` (or `codex exec`) | Runs on the laptop with the teacher's own login; nothing to host |
| Code bench (v3) | Student code runs in a Web Worker in their own browser | Never runs on the server or on anyone else's machine |

The server is the only source of truth. Students send intentions ("move here", "submit this text"); the server decides what happens and sends the result to everyone. All student text is shown as plain text, never as HTML, so nobody can inject scripts into other screens.

Students join by typing the laptop's address. On campus Wi-Fi this may be blocked (devices on the same network often cannot see each other), so the first technical task is a 5-minute test in the classroom. The fallback is a small travel router or a phone hotspot that the laptop and students join.

## Versions

| Version | Adds | Try it when |
| --- | --- | --- |
| v1 | Base room, seating, shared screen, answer wall with marks, gate, fast checks, AI scoring and feedback | One last hour, after the Wi-Fi test |
| v2 | Adventure rooms with shared doors, zones with justification, trophies, deck manifest, ProseMirror editor, retries, question chat, leaderboard, full scoring effects | v1 kept students submitting and nothing broke |
| v3 | Pair tables, spot the bug, code bench with CodeMirror, slides sending `postMessage` commands | v2 is used for whole lessons |
| v4 | Open-source the repo to students; parts of the world they can change and hot-reload together; a second course using the engine | The class is ready to work on the game as a software project |

Version 4 could also become teaching material in its own right: students write user stories and acceptance criteria for a feature of the game they use every week.

## Risks

| Risk | What we do about it |
| --- | --- |
| Campus Wi-Fi blocks students from reaching the laptop | Test in the room first; travel router or hotspot as fallback |
| Prep time grows week by week | The manifest is optional; questions are copied from workbooks; cap at 30 minutes |
| Avatars distract during explanations | Presentation mode locks movement and seats everyone |
| Novelty wears off after a few weeks | New mechanics arrive one per version, not all at once |
| The bottom of the class switches off because of the leaderboard | Top 5 only, points for submitting, most improved spot |
| AI suggestions are wrong or uneven | Teacher confirms every score; scores never count toward grades |
| Students inject scripts or cheat once the code is open | Server decides everything; student text is never rendered as HTML |
| Laptop or server crashes mid-lesson | State saved after every change; restart with `--resume`; slides and paper still work |

## Decisions

Decided by Nicola on 9 November 2026:

- Sending anonymised student answers to an AI is fine.
- First trial: the last hour of Week 8 (Monday 16 November 2026), if the students are up for it.
- No anonymity needed in class: real names can show.
- Scoring is "for fun" and will evolve; retries are not penalised, and improvement is highlighted rather than a plain ranking.
- The engine lives in its own folder and repo (`class-game-engine`), with a game-ready Week 8 deck in an example folder. A skill for preparing lessons comes later.
- The whole of Week 8 is in the example, and the teacher can jump straight to any slide (for example the last hour).
- The room and avatars use The Agency's CC0 pixel art.

Still open:

- Should the student copy of the decks (notes and answers stripped) also be built in the course repo, since it is needed whatever the game does?

## As built: proof of concept, 9 November 2026

The POC went further than the spec's version 1 in some places and less far in others.

Built:

- Base room (32×18 tiles) with 48 desks, the 16:9 screen, a break corner; The Agency's tiles and 8 animated avatars, with a sitting pose.
- Modes: free roam, take your seat (countdown, then everyone is seated and the slides fill the screen), presentation, question, review.
- Shared screen: the deck at a fixed 1280×720, scaled; teacher controls ◀ ▶, E (next reveal step), Go to slide, a clickable slide list, speaker notes; any URL can be shared. Projector full-screen toggle (F).
- Deck manifest (pulled forward from v2): `<script id="game-lesson">` plus `data-game-question` on slides; the whole Week 8 deck has 19 questions on 14 slides.
- Question kinds: text with marked parts; choice by standing in a floor zone (pulled forward from v2), with shuffling, half-right options, "because ①②③" reasons and a written follow-up; polls; grids of tick boxes.
- Fast checks with flags; batched AI scoring (`claude`, `codex`, `mock`, `off`) with feedback and "missed" concepts; the teacher's 0–3 buttons and feedback box override it.
- Reveal: score count-up (chips × multiplier) on each student's screen; the projector wall with stats, answer cards and points; Spotlight puts one answer on the projector.
- Retries (pulled forward from v2): up to 3 attempts, best counts, IMPROVED badge, "Improved today" next to the top 5.
- Student deck copy with notes and work-slide answers stripped, served on the LAN; the full deck stays on localhost.
- Session JSON in `data/`, `--resume` after a restart; 9 automated tests.

Added on 11 November 2026, the "fun layer" (see `AGENTS.md` for the rules):

- Reactions (six emote bubbles, a hop) with a quiet "I'm lost" signal to the teacher.
- Hats unlocked by points or by improving on a retry (the first cosmetic rewards from this spec).
- A class goal: points together unlock room rewards (fairy lights, a cat, a games corner with a kickable ball, a disco ball, a trophy). This is the cooperative counterweight to the leaderboard.
- Bonuses for handing in: a streak bonus and a team bonus when everyone is in.
- A soft timer on questions, a spotlight pool of light on the avatar, points rising from avatars at the reveal, confetti and short tunes, and a Finale with a podium.
- Hat, emote, cat and prop sprites drawn with `codex` and cut with `tools/cut-sprites.js`.

Added on 15 November 2026, the day before the first trial:

- The submit gate (v1): closing a question, opening another, or going to Presentation while students are still writing needs the teacher's "anyway". Changing slide is not gated.
- Hot seat (v2): Spotlight walks the student to the front; "Pick someone" chooses at random among those who answered.
- Opinion line (v2): a `line` question kind; students stand between two ends.
- Question chat (v2), as a questions board: a plain rule (not an AI call) decides whether a message looks like a question; the rest is held for the teacher. Votes, top five on the projector, 5 points for a voted question.
- Concept trophies (v2): `trophies` in the manifest, a shelf on the front wall, a reminder card with a link to the slide. No adventure rooms: the trophy is earned when its question is revealed.
- Points across lessons: `data/term.json`, matched by name. Today's board starts at zero; hats unlock on the term total; the shelf persists.
- Each student sees their own place; other students' points are no longer sent to the class at all.
- A session report (hand-in rate and timings per question, missed concepts, questions asked), to judge the trial by the criteria at the top of this document.
- "Show a sound answer" after the reveal, a "missed most" tally for the teacher, rename.
- The server rules are split into small files (`game`, `scoring`, `views`, `asks`, `term`, `report`) and the student page into three.

Added on 16 November 2026, to complete the game:

- Rooms as data, with solid furniture. Every thing has a collision box (seeded from The Agency's own shapes); avatars walk around desks and are drawn in front of or behind them. Tap or click the floor to walk there (A* path-finding).
- Adventure rooms and shared doors (v2): an open floor and a workshop besides the classroom. The door opens for a countdown, the class walks through together, the rest are moved along. A question or a slide names its room; "Take your seat" is the walk back. Rooms are generic rather than themed per exercise, and there are no optional side rooms.
- Pair up (v3): `pairs: true` on any question; pairs sit side by side, one hand-in counts for both and is scored once. A written answer is one shared draft per desk, with a pen: one student types at a time, the others watch live and can take the pen (no merging needed). The draft belongs to the desk, not the student.
- Spot the bug and the code bench (v3): `bug` and `code` question kinds. Student code runs in a Web Worker in the student's own browser.
- Slides talking to the game (v3): `classGame.open/timer/trophy/room` from a deck on the projector.
- Trophy art redrawn with codex, like the other fun sheets.

- Editors: CodeMirror 6 for both written answers (marks shown live, like Obsidian) and code, vendored as one bundled file. The spec named ProseMirror for prose; one library does both jobs, and the answer is still plain text.
- E uses what is next to you (sit, read a trophy, the door, the cat).
- A glass front wall with a view, trophies on the sill, daylight on the floor.

Not built: side rooms, an AI check on the questions board.
