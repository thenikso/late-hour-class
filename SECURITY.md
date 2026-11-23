# Security

The game runs on a teacher's laptop on a classroom network and holds students' names and answers, so security problems matter even in a toy.

**Please don't open a public issue for a security problem.** Report it privately with GitHub's "Report a vulnerability" button on the Security tab of this repository. Say what an attacker can do, how to reproduce it, and which version (commit) you tried.

Things that count: reading or changing another student's answers or points, reaching the teacher or projector pages without the key, running code on the teacher's laptop, getting student text rendered as HTML, reading files outside `public/`, or getting student names sent to the AI scorer.

Things that don't: a student on the same Wi-Fi slowing the game down, or cheating by reading the shared slides. The game is for fun and its scores never feed a grade.

Only the latest commit on `main` is supported.
