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
| Intervals | Drill interval distances by level; ear training for naming and singing intervals | Patterns generate endlessly; ear mode adapts to weak intervals; lifetime stats persist |
| Phrases | Remember and reproduce whole melodic shapes | Generated phrases respect the bounds; reproject cleanly across keys; the embedded test verifies the singing |
| Staff | Read notation fluently: sing a continuous generated line from the grand staff | The staff is clean and readable (one position per pitch, no duplication across clefs); scroll mode paces the reading and the live trace shows where the singing landed; past runs replay for review |
| Trace | Free singing with eyes on the pitch line | Trace is accurate, glitch-free, and starts when the voice does |
| Pitch | Structured accuracy practice with scoring | Call-and-response and play-along produce honest per-note results |
| Lyrics | Hands-free music listening from ordinary artist/song searches, with AI interpretation when wanted | Raw voice/typed terms produce a keyless playable playlist; Ask AI handles fuzzy or curated requests |
| Books | Read ebooks, grow local generated audio, and research questions raised while listening | Originals, parsed text, MP3 chunks, and progress persist locally; generation resumes where it stopped; one spoken question launches source-critical web/image research with the exact request disclosed |
| Articles | Dictate blog-post drafts into the fuseki.net editor from a phone | Each spoken chunk lands as a new paragraph of a draft article in the Fuseki database; the first chunk creates the draft; finalizing happens later in the editor |

## System invariants

- **Hands-free first**: voice commands, hardware media keys, large controls,
  spoken feedback where it helps driving.
- **Exact audio control**: the piano engine knows every sounding voice;
  old-settings audio never overlaps new-settings audio; stop means stop.
- **Practice test silence**: when a tool enters a sing/test mode, the page
  must not keep playing or start playing automatically. In Phrases Test,
  Play Guide is the only accepted sound source; Play/Next/history/note taps,
  media keys, and setting-triggered replays stay silent while Test is open.
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
- **Runs on a phone in a car**: Chrome/Edge/Safari, HTTPS, no build step.
  This repo's only backend is `proxy.php`: keyless Piped/Invidious and LRCLIB
  search plus remote webpage/PDF imports for Books and linked-page requests.
  The Articles tab is additionally a client of the separately deployed
  Fuseki editor API (see "Articles: Fuseki editor client" in
  docs/architecture.md).
- **Agent change → live → yui knows**: the car-loop ship contract is only
  “the fix is on the phone,” “yui gets a trustworthy signal,” and “it’s in
  git.” The header version is one signal, not the goal — see
  [live-change.md](live-change.md).

## Lyrics player: intended behavior and user needs

The accumulated product intent for the Lyrics tab, stated as the user's
needs (behavior reference: [tools.md](tools.md); construction:
[architecture.md](architecture.md)). Changes to the player should be
checked against this list, and new standing intent gets added here.

1. **"Search directly unless I ask for interpretation."** Raw artist/song
   terms from voice, Enter, or Search go straight to the keyless YouTube
   proxy and return several playable results. Ask AI is a separate explicit
   action for fuzzy identification or curation. Searches prefer the ORIGINAL
   STUDIO RECORDING - never live, cover, remix, acoustic, karaoke, or reaction
   versions unless explicitly asked for. (Live versions also break the
   timed-lyrics replay.) YouTube results are re-ranked studio-first
   (Topic/Vevo/official preferred, version markers penalized); Ask AI also
   carries that instruction in its prompt.
2. **Timed lyrics whenever they exist.** Two kinds, named everywhere:
   timed lyrics (line-synced) and simple lyrics (text only). Timed is
   always preferred; a song holding only simple lyrics gets a serious
   re-search, and an upgrade can never downgrade what is already held.
3. **Sing along from any display.** The now-playing title (car
   Bluetooth, lock screen, tab, header) is the sung lyric line, with a
   short song-identity intro at track start and a countdown before any
   line 3s or more away across an intro or instrumental gap. The Media
   Session artist line (car/lock-screen
   second row) stays `year - artist - song` for the whole play so song
   identity remains visible under the lyric. Artwork and elapsed/total
   position stay tied to the same sounding `videoId`; a lyric change is
   never modeled as a new song.
4. **Nothing is ever lost.** Every song seen, every lookup, every lyric
   state is durably recorded (IndexedDB); the playlist is a convenience
   view over that. Interruption at ANY point (page evicted mid-search,
   mid-lyric-fetch, mid-backfill) resumes on the next open.
5. **The playlist is the working list.** A new search replaces it
   gently: nothing dropped until the first found song lands, results
   stream in as found, and the currently playing song keeps playing.
   Loads (favorites, history) append. Rows are compact single data
   lines - vertical space is precious.
6. **Hands and eyes stay free.** Voice in, spoken feedback out, one
   always-reachable control line (sticks to the top when scrolling),
   hardware media keys, and playable-video recovery (fresh alternates
   are searched when a video refuses to embed).
7. **Problems must be visible.** Raw AI requests/responses are logged
   readably; truncated responses recover their complete songs and say
   so; key-level provider failures (spend/rate limits, billing) show a
   persistent banner naming the provider and where to fix it; the exact
   model in use is named at request time and choosable per query.
8. **Ready within one second.** The page has one measured readiness boundary
   after its controls, stored settings, local library, and restored playlist
   are usable. Every load records named startup phases and resource costs;
   external YouTube readiness and bounded lyric backfill run in parallel and
   do not hold the page in initialization.
9. **A song can carry a researched listening companion.** On request, the
   selected AI model receives the song's full stored lyrics, researches the
   sounding song, and writes a positive, fact-grounded report spanning
   literary interpretation, recording and band history, relationships, places
   and references, business, reception, and influence wherever the material
   is worthwhile. It quotes the actual lyric lines when discussing them and
   never fills missing categories. Timed lyrics remain on the first display
   line; the report is an alternative to song identity on the second line.
   Notes about a specific lyric line play at that line's sung moment; general
   notes fill the gaps (or advance at the chosen reading interval when the
   song has no timed lyrics). It leaves audio/artwork/position untouched,
   persists by video, and plays again when that song replays.
   The verbatim owner directive that set the lyric policy (2026-07-24):

   > Remove the following line from the book prompt: "Do not quote or
   > reproduce the lyrics. When a source analyzes them, paraphrase that
   > source's analysis and attribution"
   >
   > In fact we should direct the llm to DO include the lyrics
   >
   > Also we must modify the prompt sent to the LLM to include the full text
   > of the lyrical, which we do have and must also do.  Also save this
   > request, without any chabge at all, into ournorisuct description files.
10. **Musical understanding is a second accompaniment mode.** On explicit
   request, a Musical Guide gathers sourced facts about concert key, key
   changes, tempo, meter, tuning, capo/chord shapes, sections, vocal range,
   starting pitch, and how to sing/play/hear the recording. It preserves
   provenance, disagreement, and unknowns rather than inventing precision,
   while its short second-line cues show only validated useful material.
   Live phone-microphone analysis is an experimental extension that listens
   only to the recording coming from the speakers—not to yui singing. The
   existing monophonic detector cannot infer chords/key from a full mix, so
   tempo/key/chord work needs its own confidence-gated spectral pipeline and
   actual phone/car Bluetooth routing must pass before it becomes a product
   promise.
11. **A shared song is playable without setup.** The Lyrics page opens without
   demanding an API key. A song share link carries the exact recording and
   metadata needed to populate the playlist, play by `videoId`, and fetch
   lyrics through the keyless provider path. Raw searches are also keyless;
   API keys remain optional until a visitor explicitly presses Ask AI or asks
   for a Song Report.

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
4. **Conversational player**: follow-ups like "more like that" and playlist
   operations by voice.
5. **Listening accompaniment**: correct the two-line Story Report contract,
   add source-grounded Musical Guide, then run the real phone/car microphone
   feasibility matrix before considering live song analysis.
6. **Resilience**: PWA/offline caching and visible external API failures.

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
- YouTube quota visibility and cached-search management
- Spotify / Apple Music integration; song memory ("that song I liked last
  week"); tempo/key-matched playlists

### Books

- Source-critical AI Research while listening: a question uses the whole current
  audio context, treats book claims as claims rather than truth, searches the
  web, returns cited sources/images, and persists the complete result per book.
- Richer multimedia ebook mode on top of the local Books library: current
  Books stores originals, parsed text sections, generated MP3 audio parts,
  separate read/listen progress, research, and detailed local history in
  IndexedDB. Remaining work
  is image/table extraction in the new section model, richer EPUB/HTML
  rendering, figure reference detection, and better progress visualization from
  the history data. Exact word-level MP3/text synchronization is not a goal.
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
