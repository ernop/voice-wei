# Grok's View

A first-pass map of Voice-Wei from a new model reading the repo. Product
intent lives in [docs/product-goals.md](docs/product-goals.md); behavior in
[docs/tools.md](docs/tools.md); construction in
[docs/architecture.md](docs/architecture.md). This file is orientation, not
the source of truth.

Live site: https://fuseki.net/music8899b/ · Repo: https://github.com/ernop/voice-wei · Version at writing: v256

---

## 1. User stories and experience

### Who and why

One owner, one primary user: a singer who practices hands-free, often while
driving. The product is not a general consumer app; owner direction can
change defaults, workflows, and UI without treating current habits as a
public compatibility contract.

The training heart of every practice tool is one loop:

1. The system produces a target (scale, interval, phrase, note).
2. The learner reproduces it (sings or names it).
3. The system verifies (pitch trace, cents, right/wrong, weak-spot stats).

Overarching goal: high availability of correct musical tones — hear it,
match it instantly — with special attention to lower-range control
(overshoot around degrees 6–7–8).

### The product surface

Home (`index.html`) is a card grid into tools. Shared chrome: site header,
nav tabs, version label. Practice tools share a compact, glanceable control
language (chips, steppers, transport buttons) aimed at phone-in-car use.

| Tool | User story in one line |
|------|------------------------|
| **Scales** | Speak a practice pattern ("D minor scale", "harmonic minor repeat forever"), hear real piano, optionally Sing against a pitch trace. |
| **Intervals** | Drill degree sequences or relative jumps by level; Sing the pattern; or switch to Ear training (identify / sing / both). |
| **Phrases** | Generate or type a melodic shape, internalize it (Play / Repeat / Next / Breakdown), Test by singing it back. |
| **Trace** | Free sing in a key while watching the pitch line against rails and optional typed guide patterns. |
| **Pitch** | Structured accuracy: free practice, call-and-response, or play-along with scored results. |
| **Ears** | Same Intervals page in ear mode (`ears.html` redirects); adaptive weighting toward weak intervals. |
| **Music** | Speak a natural request ("play some jazz"); Claude builds a playlist; YouTube plays; lyrics and car media keys keep hands free. |
| **Books** | Import ebook / URL metabook → local library → read and/or generate OpenAI TTS audio that resumes where it stopped. |

### Experience principles (what it feels like)

- **Hands-free first.** Voice in, spoken feedback out, hardware media keys,
  large sticky controls, car Bluetooth / lock-screen now-playing.
- **Voice-first, click-second on Scales.** Anything sayable is also
  clickable; both update the same state. Voice commands reset to defaults
  then apply modifiers so "D minor" always means the same thing.
- **Exact stop.** Stop kills sounding voices; old settings never overlap
  new settings in the audio.
- **Sing modes stay honest.** Opening Test/Sing stops transport so a take
  starts from silence; the chart draws what was actually sung (not clamped
  to exercise rails); scoring has one definition across tools.
- **Music: studio recording by default**, timed lyrics preferred, playlist
  as a working list over durable history, problems visible in the Log and
  provider banners.
- **Nothing important is lost.** Practice settings persist per tab; scored
  takes and weak spots accumulate; Music and Books keep large history in
  IndexedDB so clears/reloads do not erase the library.

### Typical journeys

**Car practice (Scales / Phrases / Intervals)**  
Open the tab → Listen or Play → speak or tap → hear piano → optionally
Sing → glance at cents / weak-spot line → media keys for play/stop/next
without looking.

**Ear training**  
Intervals → Ear mode → Identify or Sing → adaptive presets lean into
weak intervals → lifetime stats persist.

**Driving music**  
Music → Listen → "that Beatles song with the submarine" → playlist
streams in → timed lyric line on the car display → next/pause by voice or
steering-wheel keys.

**Long-form reading**  
Books → import EPUB/PDF/URL list → read in-browser and/or generate MP3
chunks → progress and completed audio survive across sessions.

### Current product focus (not a full backlog)

Priorities in product-goals: deeper judgment (weak-degree bias in
generators, more call-and-response), car mode (larger UI, wake word),
training content for lower-range control, conversational Music follow-ups,
and resilience (PWA / proxy health). Full idea pool stays in
[docs/product-goals.md](docs/product-goals.md).

---

## 2. Technical design

### Shape

Static multi-page site, **no build step**. Each tool is an `.html` + `.js`
(+ `.css`) trio loading shared libraries via script tags. Cache busting is
a single `VERSION` / `?v=NN` / `app-version.js` number, bumped once per
user-facing ship in the same push as the change (header label is how yui
confirms the live build after reload).

The only server-side piece in the product path is `proxy.php` (YouTube
search via Piped/Invidious, plus URL-read for Books web import). Claude and
OpenAI calls go from the browser with keys in localStorage
(`api-keys-store.js`). Deploy: push `master` (user-facing paths) → GitHub
Actions (typecheck, lint, fast tests) → rsync → live; reload and check the
header version. Docs/rules-only pushes are skipped by Actions.

Browser target: Chrome / Edge / Safari (Web Speech API). HTTPS required
for mic.

```
Voice / click / media keys
        |
   page controller (thin)
        |
   shared libraries (one owner per concern)
        |
   Web Audio / Speech / YouTube iframe / IndexedDB / localStorage
        |
   proxy.php  (external search / URL fetch only)
```

### Tool map (code)

| Surface | Entry | Notes |
|---------|-------|-------|
| Home | `index.html` | Card grid |
| Scales | `scales.html` + `scales.js` | Largest practice page; voice grammar in `docs/scales-commands.md` |
| Intervals + Ears | `intervals.html` + `intervals.js` (+ `ear-training.js`) | `ears.html` redirects with `?mode=ear` |
| Phrases | `phrases.html` + `phrases.js` | Generators, take plan, Test panel |
| Trace | `trace.html` + `trace.js` | Session + view directly (no embed panel) |
| Pitch | `pitch-meter.html` + `pitch-meter.js` | Free / C&R / play-along |
| Music | `player.html` + `player.js` + `player-*.js` | `VoiceMusicController` composed from mixins |
| Books | `ebook.html` + `ebook.js` | Local library in IndexedDB `voice-wei-books` |
| Deploys | `deploys.html` | Ops chart, not a practice tool |

### Shared libraries (the real architecture)

Pages are thin consumers. Ast-grep lint guards enforce single ownership for
several hotspots (sampler URL, `getUserMedia`, TTS utterance, speech
recognition, `mediaSession` / `document.title`, `Tone.Frequency`).

| Concern | Owner |
|---------|-------|
| Piano / sine voices | `piano-core.js` |
| Mic + MPM pitch detect + glitch holdback + voice-gated clock | `pitch-detect-core.js` |
| Pitch-trace canvas | `pitch-trace-view.js` |
| Embeddable Sing/Test panel | `pitch-test-panel.js` |
| "Did you hit the note?" | `pitch-score.js` |
| Scored-take history / trends / weak spots | `progress-store.js` |
| Note math, scale patterns | `music-constants.js` |
| Degree / phrase math | `pattern-practice-core.js` |
| Speech recognition UI modes | `voice-command-core.js` |
| TTS | `voice-output.js` |
| Now-playing + media keys | `media-session-core.js` |
| Settings persistence | `settings-store.js` + `storage-keys.js` |
| Shared control wiring / CSS primitives | `practice-controls.js` / `.css` |
| Site header | `shared-header.js` |

CSS layering: `style.css` (shell) → `practice-controls.css` (shared
primitives) → one page stylesheet. Page sheets must not redefine owned
selectors (enforced in tests).

### Two big subsystems

**A. Practice / pitch pipeline**

```
Mic → pitch-detect-core (MPM, singable band D2–Bb4, glitch holdback,
      voice-gated clock) → history samples
   → pitch-trace-view (rails, targets, sung line)
   → pitch-score (sequence alignment + cents bands)
   → progress-store (takes, trends, "Weak spots: 6: 21c sharp")
```

Embed path: Phrases / Scales / Intervals Sing use `pitch-test-panel.js`
with a typed `PitchTestPanelConfig`. Trace and Pitch wire session/view
(and Pitch's own modes) themselves. Playback law: every sounding note is a
registered voice; `stopAll()` declicks each voice; loops use monotonic
tokens so superseded playback exits.

**B. Music player**

```
Voice/typed request → Claude (or OpenAI) → song list
   → proxy.php YouTube search (Piped then Invidious failover)
   → playlist (working list) + IndexedDB catalog (durable)
   → YouTube IFrame playback
   → LRCLIB lyrics (timed preferred) → overlay + car title relay
```

`player-songs.js` owns the Song vocabulary; playlist items, favorites, and
history records are constructed there, not hand-built. Lyrics live in
IndexedDB `lyricStates` keyed by `videoId` (not on playlist rows).
External resilience (multi-instance proxy, search-cache on outage) is
allowed; internal "try two strategies" fallbacks are not.

### Persistence sketch

- **localStorage** (via settings-store): KB-scale per-tab settings,
  playlist + index, favorites, API keys, panel options.
- **IndexedDB `voice-wei-music`**: logs, lookups, known songs, YouTube
  search cache, lyric states, imported MIDI/MusicXML library songs.
- **IndexedDB `voice-wei-books`**: books, sections, TTS segments (MP3
  blobs), read/listen history.
- **Envelope format** for settings: `{ v, data }` with typed merge and
  legacy migration.

### Design laws that shape the code

- **One owner per concern, one representation per concept** (pitch is MIDI
  internally; conversions only in `music-constants.js`).
- **Anti-fallback for things we control** — fix the primary path; fail
  visibly.
- **Typed contracts** in `types/` — required config fields, throwing
  constructors, checkJs gated in deploy.
- **Purpose-first controls** — same job → shared control; different job →
  named distinct surface (see architecture + controls docs).
- **Deadline scheduling** for Music UI clocks (lyric/title/progress), not
  fixed-interval polling; mic frames stay on rAF.

### Quality gates

- `npm test` — fast: syntax, CSS ownership, page-load smoke, Books flow.
- `npm run test:full` — playback / mic / controls / cross-tab.
- `npm run lint` (ast-grep), `npm run typecheck` (tsc checkJs) — zero
  errors, deploy-blocking.
- Docs tree rooted at [agents.md](agents.md); behavior/design/control
  changes update the matching doc.

### What this overview deliberately skips

Full voice grammars, every setting's change behavior, class-by-class
control inventory, lyrics provider research, and the idea-pool backlog —
those live in the linked docs when mei need them.
