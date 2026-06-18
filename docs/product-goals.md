# Product Goals

What this system is for, what each tool must do well, and the deduplicated
backlog. When a change does not serve one of these goals, question it.
(Implemented behavior is documented in [tools.md](tools.md); how it's built
in [architecture.md](architecture.md).)

## What this system is

Voice-first music tools for a singer who practices hands-free, often while
driving. The heart of every tool is one loop:

1. **The system produces a target** - a scale, an interval, a phrase, a note.
2. **The learner reproduces it** - sings it back or names it.
3. **The system verifies** - pitch trace, cents readout, right/wrong stats.

The overarching training goal (from the original voice notes): *high
availability of correct musical tones - hear it, match it instantly*, with
specific attention to control in the lower range (the learner tends to
overshoot around degrees 6-7-8).

## Ownership and change stance

This project is built for yui, not for a broad anonymous user base. Product
judgment should serve the current owner-directed training focus. When yui asks
to shift that focus, change the tool accordingly or ask a clarifying question
before acting. Do not protect old workflows, old defaults, or old UI layouts as
if they were public compatibility contracts.

Breaking current user-land can be the correct move. The weiward behavior is to
notice the consequence, say it plainly when it matters, and then follow the
requested direction. The unweiward behavior is to silently choose continuity
and deliver a weaker version of the requested change.

## Per-tool goals

| Tab | Goal | Done well when |
|-----|------|----------------|
| Scales | Speak a practice pattern, hear it played correctly | Any reasonable spoken command produces the right notes with the right timing; settings are also clickable and persist |
| Intervals | Drill interval distances by level | Patterns generate endlessly at the chosen difficulty; hands-free Next/Stop |
| Phrases | Remember and reproduce whole melodic shapes | Generated phrases respect the bounds; reproject cleanly across keys; the embedded test verifies the singing |
| Trace | Free singing with eyes on the pitch line | Trace is accurate, glitch-free, and starts when the voice does |
| Pitch | Structured accuracy practice with scoring | Call-and-response and play-along produce honest per-note results |
| Ears | Name and sing intervals from sound alone | Adaptive weighting pushes weak intervals; lifetime stats persist |
| Music | Hands-free music listening via natural language | Claude interprets the request; playlist plays without touching the screen |
| Books | Turn ebooks into listenable audio | Conversion works on real files; output is downloadable |

## System invariants

- **Hands-free first**: voice commands, hardware media keys, large controls,
  spoken feedback where it helps driving.
- **Exact audio control**: the piano engine knows every sounding voice;
  old-settings audio never overlaps new-settings audio; stop means stop.
- **Purpose-first design**: every page's functionality and controls are
  designed from its goal above. Controls doing the same job share one
  implementation; controls serving different jobs stay distinct (see
  "How to decide what a control looks like" in docs/architecture.md).
- **Owner-directed evolution**: explicit yui direction can change defaults,
  workflows, UI surfaces, and practice behavior. Ask when unclear; do not
  preserve continuity by default.
- **One shared library per concern**, enforced by lint guards; pages are
  thin consumers (see docs/architecture.md).
- **Defined parameters**: every setting picks a change behavior from the
  fixed vocabulary in docs/parameters.md and persists per tab.
- **Runs on a phone in a car**: Chrome/Edge/Safari, HTTPS, no build step,
  no backend beyond the YouTube proxy.

## Current priorities (deduplicated from the idea pool)

1. **Deeper judgment**: per-note scoring in the shared sing panel (v86),
   progress tracking over time (v88: scored takes persist, daily trend
   lines on the panel and the Pitch tool), and degree-level analytics
   (v106: every recorded take carries per-note outcomes with SIGNED
   cents bias; "Weak spots: 6: 21c sharp" lines on the panel and the
   Pitch tool - the original lower-range/overshoot goal is now
   measurable). Next: generators biasing toward weak degrees;
   call-and-response variants on more tools.
2. **Car mode**: larger UI preset, wake word, fewer on-screen elements.
3. **Training content**: more coach-style exercises and preset packs;
   lower-range control drills specifically.
4. **Conversational player**: follow-ups like "more like that", playlist
   operations by voice, reliability when Piped/Invidious instances are down.
5. **Resilience**: PWA/offline caching, surfacing proxy health.

## Backlog (the idea pool, deduplicated)

Everything proposed so far, grouped. Items graduate into the priorities
above; nothing here is a commitment.

### Training tools

- Metronome / count-in with subdivided clicks; backing drone during scale
  practice (a sustained-note sine synth already exists in piano-core)
- Solfege mode (do-re-mi) alongside degree numbers
- Custom scale builder and user-created exercise patterns
- Interval recognition quizzes and "sing the 3rd" drills beyond Ears
- Mastery mode (N correct in a row), timed sessions, challenge mode with
  self-leaderboards
- Recording: capture practice, replay, compare to reference; range tracking
  over time; session export (JSON/CSV)
- Real-time coaching ("a bit flat", "go down a little") spoken during
  practice
- Multiple instrument sounds (guitar, strings, synth)
- MIDI: keyboard input for practice tools, MIDI output to synths

### Music player

- Conversational context: "more like that", "less like that", "only live
  versions", "90s only", multi-turn refinement
- Playlist ops by voice: "remove song 3", "play the second one", "save
  this playlist"; named playlists; queue management
- Lyrics / sing-along surface: fetch lyrics by artist+title (research in
  music-lyrics-research.md), full-screen large-text overlay, then
  line-synced and word-synced phases; later key/pitch-center estimation
  and singer aids (starting note, transposition hints)
- Claude returning constraints (original vs live, era) to filter results
- Better proxy health surfacing and failover UX
- Spotify / Apple Music integration; song memory ("that song I liked last
  week"); tempo/key-matched playlists

### Books

- Multimedia ebook mode: a content manifest linking text chunks, audio
  segments, and extracted images/tables for synchronized listen-and-see
  playback (audio-only / synchronized / browse modes). Current Books already
  extracts EPUB images and low-text PDF page renders into a browseable gallery;
  remaining work is synchronization, richer PDF/table extraction, HTML image
  extraction, and figure-reference detection.
- Voice-cloned or higher-quality narration options

### Platform

- Progressive Web App: installable, offline caching of samples/playlists
- Wake word ("Hey DJ" / "Hey Scales"); voice activity detection
- Haptic feedback on mobile; high-contrast and accessibility passes
- Optional server endpoint for Claude calls (rate limiting, key never in
  browser)
- Multi-language voice support; whisper-mode recognition

### Personal training focus

The learner overshoots around scale degrees 6-7-8; exercises specifically
training control in the lower range remain the highest-signal content gap.
