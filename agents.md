# Agent Guide

Entry point for AI agents working on this repo. The binding rules live in
`.cursor/rules/` (always applied); this file orients you and holds the few
repo-wide conventions worth restating.

## Project Links

- **GitHub**: https://github.com/ernop/voice-wei
- **Live**: https://fuseki.net/music8899b/scales.html

## Read these before structural work

| Doc | When |
|-----|------|
| docs/product-goals.md | Deciding what to build or whether a change fits |
| docs/architecture.md | Touching shared libraries, playback, or the scales engine (the section-note rules there have caused real bugs) |
| docs/parameters.md | Adding or changing any user-facing setting (pick a behavior from the fixed vocabulary, update the table) |
| docs/tools.md | Changing user-visible behavior of a tab |
| tests/ | Always: `npm test` must pass before pushing |

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
  the sampler, getUserMedia, and SpeechSynthesisUtterance.
- Never use "code smell" or similar phrases. Never use emojis. Minimal
  persona: no exuberance, no repetition.
- Docstrings only when they add information the code doesn't already say;
  comments explain why, not what.

## Shipping

1. `npm test` && `npm run lint` && `npm run typecheck`
2. `./bump-version.sh` (updates VERSION, header label, all `?v=` cache busters)
3. Commit in small logical steps, push `master` - this deploys to production.
