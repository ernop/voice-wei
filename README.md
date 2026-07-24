# Voice-Wei

Voice-first music tools for singers, musicians, and readers - built for
hands-free practice, often while driving.

**Live:** https://fuseki.net/voice-wei/scales.html

Every practice tool runs one loop: **the system produces a target → you
reproduce it → the system verifies** (pitch trace, cents, stats).

![Scales trainer interface](screenshot-scales.png)

## Owner-directed change stance

This is a personal-use project with one owner and one primary user. When yui
asks for a change in direction, implement that direction directly or ask a
clear clarifying question before proceeding. Do not silently preserve old
behavior, old defaults, current practice habits, or the existing UI surface
because of an invented compatibility concern.

Breaking current user-land is allowed when it serves an explicit owner request.
Think through the consequence and mention it; if the break is risky or the
direction is ambiguous, ask. What is not allowed is countervailing the request
by choosing continuity as an unspoken constraint.

## Tools

| Tab | What it does |
|-----|--------------|
| [Scales](https://fuseki.net/voice-wei/scales.html) | Speak a practice pattern ("D minor scale", "harmonic minor repeat forever"), hear it on a real piano |
| [Intervals](https://fuseki.net/voice-wei/intervals.html) | Level-based interval drills: degree sequences and relative jumps |
| [Phrases](https://fuseki.net/voice-wei/phrases.html) | Generate and reproduce melodic phrases; reproject across keys; embedded sing test |
| [Trace](https://fuseki.net/voice-wei/trace.html) | Free singing against key-aware pitch rails with typed guide patterns |
| [Pitch](https://fuseki.net/voice-wei/pitch-meter.html) | Scored practice: free, call-and-response, play-along |
| [Ears](https://fuseki.net/voice-wei/ears.html) | Interval ear training: identify them, sing them, drone matching |
| [Lyrics](https://fuseki.net/voice-wei/player.html) | AI voice music player: "play some jazz" becomes a playlist (one AI-provider key required) |
| [Books](https://fuseki.net/voice-wei/ebook.html) | Ebook to audiobook via OpenAI TTS (OpenAI key required) |

Full usage details per tool: [docs/tools.md](docs/tools.md).

## Documentation map

[agents.md](agents.md) is the root of the documentation tree and holds the
complete index. The most-used docs:

| Doc | Contents |
|-----|----------|
| [docs/product-goals.md](docs/product-goals.md) | What this is for, per-tool goals, invariants, priorities, backlog |
| [docs/tools.md](docs/tools.md) | Per-tab usage reference |
| [docs/scales-commands.md](docs/scales-commands.md) | Full scales voice command grammar |
| [docs/parameters.md](docs/parameters.md) | Every setting: values, defaults, change behavior |
| [docs/architecture.md](docs/architecture.md) | Shared libraries, playback law, engine rules, testing, deploy |
| [docs/controls.md](docs/controls.md) | Button/control inventory and unification plan |
| [docs/setup.md](docs/setup.md) | Environment setup and deploy pipeline |
| [agents.md](agents.md) | Entry point for AI agents working on this repo |

## Quick start

```bash
./setup-cloud-agent.sh   # Cursor/cloud agent or fresh Linux VM
php -S 127.0.0.1:8000    # static pages + music search + Books URL import
# Visit http://127.0.0.1:8000/scales.html
```

`python3 -m http.server 8000` is static-only — fine for practice tools.
Music search and Books webpage/PDF URL import need the PHP server.
HTTPS is required for microphone access when deployed.

## Testing

```bash
./setup-cloud-agent.sh   # once per fresh cloud VM; installs npm deps, Playwright Chromium, PHP/pip tooling
npm test      # fast suite: JS syntax, CSS ownership, page-load smoke, Books flow
npm run test:full  # slower playback/mic/control/tab end-to-end suite
```

The suite starts its own static server on port 8000 (or reuses one already
running). It uses Playwright's installed Chromium by default; set `CHROME_PATH`
only when targeting a specific Chrome/Chromium binary. Full mic tests use
Chrome's fake audio device. For ordinary text/CSS/small JS changes, use the
fast default plus any targeted suite (`node tests/run-all.js --suite
test-controls.js`). The deploy workflow gates on typecheck, lint, and the fast
browser suite before rsync. Use `npm run test:full` when touching playback, mic,
progress recording, media session behavior, or cross-tab flows. Also:
`npm run lint` (ast-grep, including the shared-library ownership guards),
`npm run typecheck`, and `php -l proxy.php` when touching the PHP proxy.

## Version system

All pages share one version number (header label + `?v=` cache busters). After
a deploy, reload the live page and check the header to confirm you have that
build.

```bash
cat VERSION              # Current version
./bump-version.sh        # Increment; updates header label + all ?v= cache busters
```

When shipping a change that reaches the server, bump once and include the
version files in the **same** push as the change. Do not bump for
docs/tests-only commits, and do not push bump-only commits.

## Deployment

Push to `master` triggers the GitHub Actions deploy (rsync `--delete`;
docs, tests, and tooling are excluded). Manual: `./deploy.sh [--dry-run]`.

## Browser support

Chrome, Edge, and Safari. Firefox lacks the Web Speech API used for voice
features.

## License

Personal use project.
