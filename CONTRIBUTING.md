# Contributing

Thanks for wanting to make Late Hour Class better! Students, teachers and anyone else are welcome to report bugs, suggest ideas and send pull requests.

This is a small project with one maintainer, so a few rules keep it fun to work on. Please read them before you start.

## What gets accepted

We only accept changes that **make the game better for every class that uses it**. Good examples:

- a bug fix, with a test that fails without it
- something that makes the game clearer, calmer, faster, or easier to use on a phone or a small laptop
- a new question kind, room or bit of fun that any course could use
- better tests, clearer code, clearer docs
- accessibility fixes

We will say no, kindly, to changes that:

- only help one course, one teacher or one lesson (course content belongs in a lesson manifest, not in the engine)
- give a score advantage to anyone, or let points feed a grade
- shame students, show the class who is lost or who has not handed in, or turn flags into penalties
- add a dependency, an install step or a build step
- run student code on the server, render student text as HTML, or send names to an AI
- are large rewrites, mass reformatting or renaming without a clear reason

The hard rules in [AGENTS.md](AGENTS.md#hard-rules) are the full list. When in doubt, **open an issue first** and describe the idea: it saves you from writing code that can't be merged.

## Using AI is fine, if you say so

You may use AI tools (Claude, Codex, Copilot, ChatGPT, …) to write code, tests or docs. You must **declare it in the pull request**: which tool, and roughly what it did (for example "Claude Code wrote the first version of the rapid-round timer; I rewrote the tests and checked it in the browser"). The pull request template has a section for this.

You are still the author. That means:

- you have read and understood every line you submit, and can explain it if asked
- you have run the tests and tried the change in a browser yourself
- the pull request description is yours: say what you changed and why, in your own words
- you don't submit large AI-generated changes you haven't reviewed, or many small ones just to have contributed

Pull requests that hide AI use, or that the author can't explain, will be closed. Using AI well is a skill we practise in the course; declaring it is part of doing it honestly.

AI agents working on this repo should read [AGENTS.md](AGENTS.md) (also available as `CLAUDE.md`). It has the architecture, the hard rules and the commands, and it points back here.

## Getting started

You need Node 20 or later. There is nothing to install.

```sh
git clone <your fork>
cd late-hour-class
npm test            # 45+ tests, about a second
npm run demo        # every question kind with fake scoring
```

`npm run demo` prints a student link and a teacher link (teacher key `demo`). Open the student link in a few browser windows (or private windows) to play as several students. [ARCHITECTURE.md](ARCHITECTURE.md) follows one student action through the code; [AGENTS.md](AGENTS.md) explains where everything lives.

Use `--ai mock` (the `demo` and `example:mock` scripts already do) so you never need an AI CLI to work on the game.

## Making a pull request

1. **Fork** the repo and create a branch with a short name (`fix-door-stuck`, `add-sound-toggle`).
2. **Keep it focused**: one change per pull request. Two unrelated fixes are two pull requests.
3. **Match the style**: plain ES modules, no build step, small functions, comments where the code isn't obvious. Students read this code, so write for them.
4. **Test it**:
   - add or update a test in `test/` for every rule you change in `lib/` or `server.js`
   - `npm test` must pass
   - for anything you can see, try it in a browser with at least two students, at laptop width and phone width, plus the teacher view and the projector
5. **Update the docs** when behaviour or structure changes: `README.md` (for teachers), `AGENTS.md` (for developers and agents), `ARCHITECTURE.md` (if files move).
6. **Write a clear commit message**: a short subject in the imperative ("Fix the door closing on late students"), a blank line, then what changed and why.
7. **Open the pull request** and fill in the template, including the AI section. Screenshots or a short clip help a lot for anything visual.

Expect questions and change requests: that's normal and not a judgement on you. If a pull request goes quiet for a few weeks, it may be closed; you can always reopen it.

## Reporting bugs and ideas

Open an issue. For a bug, say what you did, what you expected, what happened, and your browser and device. For an idea, say what problem it solves in class, not only what it looks like.

**Never paste real student data** (names, answers, session files from `data/`) in an issue, a pull request or a test. Make up names.

For security problems, don't open a public issue: see [SECURITY.md](SECURITY.md).

## Be kind

Everyone here is learning, the maintainer included. Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contribution is released under the [MIT License](LICENSE), like the rest of the code. New art must be your own or under a licence that allows it (CC0 preferred); say where it comes from in the pull request.
