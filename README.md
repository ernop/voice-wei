# Voice-Wei

Voice-first music tools for singers, musicians, and readers - built for
hands-free practice, often while driving.

**Live:** https://fuseki.net/music8899b/scales.html

Every practice tool runs one loop: **the system produces a target → you
reproduce it → the system verifies** (pitch trace, cents, stats).

![Scales trainer interface](screenshot-scales.png)

## Tools

| Tab | What it does |
|-----|--------------|
| [Scales](https://fuseki.net/music8899b/scales.html) | Speak a practice pattern ("D minor scale", "harmonic minor repeat forever"), hear it on a real piano |
| [Intervals](https://fuseki.net/music8899b/intervals.html) | Level-based interval drills: degree sequences and relative jumps |
| [Phrases](https://fuseki.net/music8899b/phrases.html) | Generate and reproduce melodic phrases; reproject across keys; embedded sing test |
| [Trace](https://fuseki.net/music8899b/trace.html) | Free singing against key-aware pitch rails with typed guide patterns |
| [Pitch](https://fuseki.net/music8899b/pitch-meter.html) | Scored practice: free, call-and-response, play-along |
| [Ears](https://fuseki.net/music8899b/ears.html) | Interval ear training: identify them, sing them, drone matching |
| [Music](https://fuseki.net/music8899b/player.html) | AI voice music player: "play some jazz" becomes a playlist (Claude key required) |
| [Books](https://fuseki.net/music8899b/ebook.html) | Ebook to audiobook via OpenAI TTS (OpenAI key required) |

Full usage details per tool: [docs/tools.md](docs/tools.md).

## Documentation map

| Doc | Contents |
|-----|----------|
| [docs/product-goals.md](docs/product-goals.md) | What this is for, per-tool goals, invariants, priorities, backlog |
| [docs/tools.md](docs/tools.md) | Per-tab usage reference |
| [docs/scales-commands.md](docs/scales-commands.md) | Full scales voice command grammar |
| [docs/parameters.md](docs/parameters.md) | Every setting: values, defaults, change behavior |
| [docs/architecture.md](docs/architecture.md) | Shared libraries, playback law, engine rules, testing, deploy |
| [docs/setup.md](docs/setup.md) | Environment setup |
| [agents.md](agents.md) | Entry point for AI agents working on this repo |

## Quick start

```bash
python3 -m http.server 8000
# Visit http://localhost:8000/scales.html
```

HTTPS is required for microphone access when deployed.

## Testing

```bash
npm install   # once; installs playwright (uses your installed Chrome)
npm test      # headless suite: page loads, playback engine, controls, tab functions
```

The suite starts its own static server on port 8000 (or reuses one already
running). Set `CHROME_PATH` if Chrome is not auto-detected; mic tests use
Chrome's fake audio device. Also: `npm run lint` (ast-grep, including the
shared-library ownership guards) and `npm run typecheck`.

## Version system

All pages share one version number:

```bash
cat VERSION              # Current version
./bump-version.sh        # Increment; updates header label + all ?v= cache busters
```

When a significant change ships, bump the version and push `master` in the
same change.

## Deployment

Push to `master` triggers the GitHub Actions deploy (rsync `--delete`;
docs, tests, and tooling are excluded). Manual: `./deploy.sh [--dry-run]`.

## Browser support

Chrome, Edge, and Safari. Firefox lacks the Web Speech API used for voice
features.

## License

Personal use project.
