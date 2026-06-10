# Agent Guide

Entry point for AI agents working on this repo. Re-read this file at the
start of every task, and update it whenever yui gives standing guidance -
this is where that guidance accumulates. The binding rules live in
`.cursor/rules/` (always applied); this file orients you, holds the
working method, and is the root of the documentation tree: every doc in
the repo is reachable from here.

## Project Links

- **GitHub**: https://github.com/ernop/voice-wei
- **Live**: https://fuseki.net/music8899b/scales.html

## The working method (standing guidance from yui)

1. **Depth over speed. Never rush.** Time spent does not matter;
   correctness and care do. Do not sprint to ship a plausible patch.
2. **Every defect gets a base-design analysis.** Before fixing anything,
   trace the defect to the bottom: was it the product of an earlier
   design, system, or data-structure choice? If yes, fix the design -
   the patch alone is a failure. Ask whether the structure that allowed
   the bug should exist at all. Partial patches are explicitly unwanted.
3. **Analyze the whole system, not the symptom's file.** When the design
   is at fault, the same fault usually exists elsewhere (the parallel-
   array phrase shape existed in intervals too). Sweep for siblings and
   fix the class, then add static enforcement so it cannot return.
4. **Everything explicit, everything named.** State is explicit lists of
   objects with named fields. No positional conventions, no "the first
   item means X", no re-anchoring assumptions, no parallel arrays across
   boundaries. Constructors take named, typed, required configs and
   throw on missing data (see Typed contracts in docs/architecture.md).
5. **Static guarantees before tests.** Types and lint guards that catch
   mistakes at write time beat tests, which beat manual checking. The
   typecheck and lint baselines stay at zero errors, gated in deploy.
6. **Purpose first.** Design each page from what it is for; share code
   only where two surfaces do the same job (see "How to decide what a
   control looks like" in docs/architecture.md). The most recent
   reviewed page wins ties - never converge a page into being worse at
   its purpose.
7. **One owner per concern, one representation per concept.** See the
   Data representation law and shared-library table in
   docs/architecture.md.
8. **Update the docs hierarchy with the work.** Behavior changes update
   docs/tools.md and docs/parameters.md; design changes update
   docs/architecture.md; new standing guidance updates this file. No
   documentation file may exist outside the tree below.

## Documentation tree (every doc, from here)

| Doc | What it holds |
|-----|---------------|
| [README.md](README.md) | Human-facing overview, dev setup, version system |
| [docs/product-goals.md](docs/product-goals.md) | What this is for, per-tool goals, invariants, priorities, backlog |
| [docs/tools.md](docs/tools.md) | Per-tab usage reference |
| [docs/architecture.md](docs/architecture.md) | Shared libraries, playback law, representation law, typed contracts, control vocabulary, engine rules, testing, deploy |
| [docs/parameters.md](docs/parameters.md) | Every setting: values, defaults, change behavior |
| [docs/scales-commands.md](docs/scales-commands.md) | Full scales voice command grammar |
| [docs/setup.md](docs/setup.md) | Deployment/environment setup |
| [docs/music-lyrics-research.md](docs/music-lyrics-research.md) | Research notes: lyrics features for the player (feeds product-goals backlog) |
| [.cursor/diary.md](.cursor/diary.md) | Mei diary: session notes from agent to future agents |
| `.cursor/rules/` | Binding rules, always applied (not markdown docs) |

Read before structural work: product-goals (does the change fit),
architecture (how it must be built), parameters (setting behaviors),
tools (user-visible behavior).

## Non-negotiables (summary; full versions in .cursor/rules/)

- **Owner-directed changes are real direction.** This project is for one
  owner/user. If yui asks to change focus, do it or ask before proceeding.
  Never quietly preserve current behavior or UI habits because of an invented
  compatibility concern.
- **No fallbacks/hacks for things we control.** Fix the upstream issue,
  fail loudly, never catch and continue silently.
- **The playback law**: old-settings audio never overlaps new-settings
  audio; stopping kills the actual voices (piano-core registry), never a
  master mute or a timing guess.
- **One shared library per concern** - ast-grep guards enforce ownership of
  the sampler, getUserMedia, SpeechSynthesisUtterance,
  webkitSpeechRecognition, and Tone.Frequency.
- Never use "code smell" or similar phrases. Never use emojis. Minimal
  persona: no exuberance, no repetition.
- Docstrings only when they add information the code doesn't already say;
  comments explain why, not what.

## Shipping

1. `npm test` && `npm run lint` && `npm run typecheck`
   - `npm test` is intentionally fast: JS syntax, CSS ownership, page-load smoke.
   - Add `node tests/run-all.js --suite <suite-file>` or `npm run test:full`
     when the touched code needs deeper playback/mic/control coverage.
2. `./bump-version.sh` (updates VERSION, header label, all `?v=` cache busters)
3. Commit in small logical steps, push `master` - this deploys to production.
4. When a session produced lessons worth keeping, append a diary entry
   (.cursor/diary.md) and fold standing guidance into this file.
