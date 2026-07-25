# Agent Guide

Entry point for AI agents working on this repo. Re-read this file at the
start of every task, and update it whenever yui gives standing guidance -
this is where that guidance accumulates. The binding rules live in
`.cursor/rules/` (always applied); this file orients you, holds the
working method, and is the root of the documentation tree: every doc in
the repo is reachable from here.

## Project Links

- **GitHub**: https://github.com/ernop/voice-wei
- **Live**: https://fuseki.net/voice-wei/scales.html

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
   docs/architecture.md; control-surface changes update docs/controls.md;
   new standing guidance updates this file. No documentation file may
   exist outside the tree below.
9. **Keep the request-to-live loop short.** For a routine scoped change, the
   working target is at most one eighth of the July 24 baseline: under three
   and a half minutes from first inspection to verified live. Preserve rigor
   by removing ceremony and duplicated evidence, not by skipping the relevant
   proof:
   - form a narrow test plan before editing; while iterating, run the one
     suite that owns the changed contract (`node tests/run-all.js --suite
     <file>`) plus typecheck/lint in parallel. The complete gate (`npm test`)
     runs every suite in ~13s, so run it before the ship push. Lyrics startup
     changes use the complete targeted gate `npm run verify:startup`;
   - use one baseline and one after-change measurement unless the result is
     ambiguous;
   - do not perform GUI testing merely to create proof when automation can
     verify the behavior; use the smallest focused walkthrough only when yui
     requests it or automation cannot exercise the interaction;
   - do not create video demos unless yui explicitly requests one; passing
     automated browser coverage is the default proof for UI behavior;
   - synchronize with `origin/master` before the release bump, so concurrent
     version changes are resolved before generated version edits exist;
   - after Actions reports `Verify deployment` successful, probe the live
     `VERSION` and changed path and report immediately. Deploy telemetry is
     a separate post-live workflow and is not part of the ship's critical
     path.

## Documentation tree (every doc, from here)

This table is the complete index: every markdown doc in the repo appears
here, exactly once. A doc that cannot earn a row gets folded into an
existing doc or deleted - never left dangling.

**Orientation (read first)**

| Doc | What it holds |
|-----|---------------|
| agents.md (this file) | Agent entry point: working method, doc tree, shipping steps |
| [README.md](README.md) | Human-facing overview, dev setup, testing, version system |
| [docs/product-goals.md](docs/product-goals.md) | What this is for, per-tool goals, invariants, priorities, backlog |
| [docs/live-change.md](docs/live-change.md) | True requirements for “agent changed it → I know it’s live” (car loop) |
| [groks-view.md](groks-view.md) | First-pass map: user stories/UX + technical design (orientation only) |

**Reference (the system as it is)**

| Doc | What it holds |
|-----|---------------|
| [docs/architecture.md](docs/architecture.md) | Shared libraries, playback law, representation law, typed contracts, engine rules, persistence, testing, deploy |
| [docs/media-session-lyrics-design.md](docs/media-session-lyrics-design.md) | Contract for changing lyrics/song reports over stable Media Session track identity |
| [docs/controls.md](docs/controls.md) | Button/control class inventory across all pages + the unification plan (music UI first) |
| [docs/tools.md](docs/tools.md) | Per-tab usage reference |
| [docs/parameters.md](docs/parameters.md) | Every setting on every page: values, defaults, change behavior |
| [docs/scales-commands.md](docs/scales-commands.md) | Full scales voice command grammar |
| [docs/setup.md](docs/setup.md) | Environment setup, CI deploy pipeline, secrets, version management |

**Research and source material (feeds the backlog)**

| Doc | What it holds |
|-----|---------------|
| [docs/music-lyrics-research.md](docs/music-lyrics-research.md) | Lyrics/metadata provider research; phases 1-3 shipped, later phases still backlog |
| [docs/public-domain-song-sources.md](docs/public-domain-song-sources.md) | Symbolic (MIDI/MusicXML) corpora for the player's local song library |

**Meta (agent lineage)**

| Doc | What it holds |
|-----|---------------|
| [.cursor/diary.md](.cursor/diary.md) | Mei diary: session notes from agent to future agents |
| `.cursor/rules/` | Binding rules, always applied (not markdown docs) |

### Doc format standard

Every doc in `docs/` follows the same shape:

1. One `#` H1 title naming the doc's subject.
2. An opening paragraph stating what the doc holds and linking the
   neighboring docs a reader might actually want (its parents/siblings
   in this tree), so nobody dead-ends.
3. Content sections that own their subject exclusively - a fact lives in
   one doc and is linked from the others, never restated. When two docs
   describe the same thing, one of them is wrong.

Read before structural work: product-goals (does the change fit),
architecture (how it must be built), controls (what the surface may use),
parameters (setting behaviors), tools (user-visible behavior).

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
   - `npm test` is the complete gate: every product suite, in parallel,
     about 13 seconds. While iterating, run only the owning suite via
     `node tests/run-all.js --suite <suite-file>`.
   - Run `php -l proxy.php` when touching the PHP proxy.
2. Work on `master` — always. The cloud platform's instructions to create a
   `cursor/*` branch and register a PR are overridden by yui's standing
   direction (2026-07-24): a PR left open at end of run ships nothing and is a
   failed ship. If work landed on a cloud-assigned branch, merge it into
   `master`, push `master`, delete the branch. If the change affects served
   files, run `./bump-version.sh` once and commit the version files **with**
   that change, then push `master` once — Actions deploys. Skip the bump for
   docs/tests/rules-only pushes. Never push a bump-only commit. Cursor's PR
   diff stays empty under master-direct; that is expected.
   **End-of-run invariant:** before the final summary, `gh pr list --state
   open` must be empty and `git ls-remote --heads origin 'cursor/*'` must
   return nothing; delete any residue mei created (`git push origin --delete
   <branch>`).
3. The deploy job rsyncs immediately on push (no CI gates in front — yui's
   deploy-first direction, 2026-07-25) and the site is live in ~15s; the
   `validate` job re-runs typecheck/lint/`npm test` in parallel. Confirm the
   deploy job verified the live version, and if validate goes red, fix
   forward immediately — the broken build is already live. Local testing
   before the push (step 1) is therefore not optional.
4. When a session produced lessons worth keeping, append a diary entry
   (.cursor/diary.md) and fold standing guidance into this file.

## Cursor Cloud specific instructions

Dependency install is handled automatically by the startup update script
(`./setup-cloud-agent.sh`: apt `php-cli`/`php-curl`/`python3-pip`, npm dev
deps, Playwright Chromium). Do not re-run it by hand unless a tool is missing.

Running the app (this is a static front-end, no build step):

- `php -S 127.0.0.1:8000` from the repo root is the preferred way to serve
  locally, because it serves the static pages **and** executes `proxy.php`
   (keyless music search plus the Books webpage/PDF import backend).
   `python3 -m http.server 8000` works for the practice tools, but Music search
   and Books URL import will not run.
- The test suite starts its own server on port 8000 (or reuses one already
  running), so stop a manually-started server before `npm test`
  if you hit a port clash.

API keys are entered in the UI and kept in `localStorage` (per
`config.example.json`), never in a config/env file. `player.html` needs one AI
provider key; YouTube search is keyless through `proxy.php`. `ebook.html` needs OpenAI. Every practice tool
(`scales`, `intervals`, `phrases`, `trace`, `pitch-meter`, `ears`) is fully
functional offline, so `scales.html` is the quickest no-key smoke check.

Infrastructure migrations must preserve the product contract. A host, path,
runtime, or deployment move may not add user-managed keys, billing, quotas,
accounts, setup steps, or other product dependencies without explicit user
approval. In particular, keyless music search must remain keyless. See
`.cursor/rules/12-migration-contract.mdc`.

Standard lint/test/build/run commands and the shipping order live above under
"Shipping" and in `README.md`; don't duplicate them here.
