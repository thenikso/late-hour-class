# Architecture: how Late Hour Class works

Welcome! This project has **no build step and no server dependencies** (only Node 20+ built-ins and plain ES modules in the browser). You can read any file directly and trace what runs.

## The big picture

One Node process (`server.js`) runs on the teacher's laptop. Three browser pages connect to it:

| Page | URL | Role |
| --- | --- | --- |
| Student | `/` (`public/student.html`) | Walk around, react, answer questions, view own score |
| Teacher | `/teacher?key=…` (`public/teacher.html`) | Control slides, rooms, questions, scoring, spotlight |
| Projector | `/screen?key=…` (`public/screen.html`) | Shared room, QR join code, hand-in counter, revealed wall |

The server is the **single source of truth**: browsers send intentions over `POST /api/*`, the server validates them, updates `Game`, and pushes role-specific views back over a Server-Sent Events stream (`GET /events`).

## Tracing one student action end to end

Suppose Ada walks into Zone B and clicks **Lock in my zone**:

1. **Client move (`public/js/student.js`)**: keyboard or tap-to-walk moves Ada locally using `walk()` from `public/js/shared/rooms.js` and sends `POST /api/move` every ~80 ms.
2. **Server validation (`server.js` → `lib/game.js`)**: `server.js` looks up Ada by her token, calls `game.move(...)`, which checks `canStand()` using the **exact same** `public/js/shared/rooms.js` file the browser uses.
3. **Fast position tick (`server.js`)**: ten times a second, changed `[id, x, y, dir, moving, online]` tuples stream out as `event: pos` so every screen smoothly glides Ada's avatar.
4. **Handing in (`public/js/student-sheet.js` → `lib/questions.js`)**: clicking **Lock in** sends `POST /api/answer`. The server ignores any client-claimed zone and reads `zoneAt()` from Ada's server-side `(x, y)` position, runs `checkAnswer()` (`lib/checks.js`), and stores the attempt.
5. **Role-filtered views (`lib/views.js`)**: `game.changed()` triggers `server.js` to push `event: state` to each connected client:
   - `studentView(game, player)`: the room + Ada's own answer, rank and feedback only.
   - `screenView(game)`: the room + projector wall (anonymous by default) + Top 5.
   - `teacherView(game)`: everything, including flags, who is still writing, and who pressed "I'm lost".
6. **Drawing (`public/js/room.js` + `room-shell.js`)**: the canvas paints the cached room shell, then sorts furniture, avatars, the cat and the ball by floor baseline (`y`) so avatars naturally walk in front of and behind desks.

## Folder map

```
server.js                     HTTP server, SSE stream, action dispatch, graceful shutdown
lib/                          Server-only rules and I/O
  game.js                     Room state, players, doors, seating, ball, spotlight, trophies
  questions.js                Question lifecycle, submit gate, pair work, retries, streaks
  desks.js                    Shared desk drafts in written pair work: one pen per desk
  rapid.js                    Rapid rounds: timed lines answered by standing in a zone
  scoring.js                  Pure scoring functions (chips x multiplier, retry eligibility)
  views.js                    Role-specific JSON projections (student / teacher / screen)
  checks.js                   Fast non-punitive answer flags (short, unmarked, pasted, similar)
  ai.js                       Batched, anonymised, injection-hardened AI CLI scorer
  asks.js                     Lesson questions board and moderation
  manifest.js                 Reads lesson JSON from an HTML slide deck or .json file
  session.js                  Atomic session save/restore
  term.js                     Cross-lesson term points and trophy shelf
  report.js                   Post-class Markdown report generator

public/
  student.html, teacher.html, screen.html
  css/                        game.css (shared tokens + components) + per-page sheets
  vendor/                     Pre-bundled CodeMirror 6 (the only third-party code)
  js/
    shared/                   Pure modules imported by BOTH Node (lib/) and the browser
      world.js                Room dimensions, zones, opinion line, trophy shelf slots
      things.js               Furniture sprite catalogue and collision boxes
      rooms.js                Room layouts (base, floor, lab), collision and seating
      path.js                 Half-tile A* path-finding (tap-to-walk and the class cat)
      fun.js                  Emotes, hats, class goal levels, streak/team bonuses
      marks.js                Part-mark parser (==①...==) and safe HTML escaping
      util.js                 Tiny pure helpers (isSet, clamp, Fisher-Yates shuffle)
    common.js                 DOM helper h(), SSE client, iframe scaler, Web Audio, confetti
    sprites.js                Tileset, avatar, hat, emote, cat and trophy sprite drawing
    room-shell.js             Cached room backdrop (glass wall, daylight) and cat routes
    room.js                   Live canvas renderer (avatars, zones, overlays, labels)
    editors.js                CodeMirror 6 wrappers for prose (live marks) and JS code
    code-bench.js             Spot-the-bug and Web Worker JS sandbox
    qr.js                     Zero-dependency QR code encoder for the projector join link
    student.js                Student page shell, walking loop, E interactions, HUD
    student-sheet.js          Question sheet, early-finisher box, result count-up
    student-panels.js         Hats, Ask board and trophy shelf modals
    teacher.js                Teacher console shell, slides, players, asks, class goal
    teacher-question.js       1-click micro-checks, live question controls, scoring cards
    screen.js                 Projector view, answer wall, spotlight, finale podium

test/                         Independent unit and ephemeral-port HTTP integration tests
tools/                        Slide server (student/teacher copies), sprite tools, CLI report
```

## Design invariants to preserve

1. **Server authority:** never trust client-reported zones, opinion positions, hat unlocks, or scores. (The code bench runs student JS only in their own browser Web Worker; the teacher always sees the code next to the check ticks.)
2. **No student HTML injection:** render student text via `textContent`, `h()`, or `marksToHtml()` (which escapes before wrapping spans).
3. **Privacy in `views.js`:** anything the class must not see (who is still writing, who is lost, held asks, other students' points) belongs only in `teacherView` or `me`/`mine`, never `baseView`.
4. **Course neutrality:** keep all course-specific content inside lesson manifests and decks, never inside `server.js`, `lib/`, or `public/`.
