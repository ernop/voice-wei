# Architecture

How the system is built. Product intent lives in
[product-goals.md](product-goals.md); per-setting behavior in
[parameters.md](parameters.md).

## Shape

Static site, no build step. Each tab is an `.html` + `.js` (+ `.css`) trio
loading shared libraries via script tags. Cache busting via `?v=NN`
(see Version System in the README). The only server-side piece is
`proxy.php` (YouTube search via Piped/Invidious).

```
index.html               # Home: cards for every tool
scales.html/js/css       # Scale practice (voice-first)
intervals.html/js/css    # Interval drills
phrases.html/js/css      # Phrase practice
trace.html/js/css        # Free pitch trace
pitch-meter.html/js/css  # Scored pitch practice
ears.html/js/css         # Redirects to intervals.html?mode=ear
player.html + player.js  # AI music player
ebook.html/js/css        # Ebook to audiobook
```

## Change stance: owner direction before continuity

This architecture serves a personal-use product. Do not treat existing
behavior, defaults, settings layout, or current practice habits as public API
unless the docs say they are persisted contracts or yui says to preserve them.
When yui asks for a new focus, the implementation should follow that focus.

Compatibility work is still real where it protects data, secrets, deployed
configuration, or irreversible user effort. For ordinary UX/default/practice
behavior, preserving continuity is a choice that needs a reason. If that reason
would countervail the request, ask yui before using it.

## Shared libraries - one owner per concern

Pages must consume these instead of carrying their own copies; several of
them are enforced by ast-grep lint guards (see `.ast-grep/rules/`).

| Library | Owns | Enforced |
|---------|------|----------|
| `piano-core.js` | The piano voice engine + sine synth | yes (Salamander URL) |
| `pitch-detect-core.js` | Mic capture, autocorrelation detector, glitch filter, voice-gated clock | yes (getUserMedia) |
| `voice-output.js` | All TTS (always resolves; engine errors never crash callers) | yes (SpeechSynthesisUtterance) |
| `pitch-trace-view.js` | Pitch-trace canvas rendering (rails/targets/trace/playhead) | - |
| `pitch-test-panel.js` | The embeddable listen panel (renders markup, owns mic session + options) | - |
| `practice-controls.js` | Steppers, segmented option groups, toggles wiring | - |
| `settings-store.js` | Versioned persistence (typed merge, legacy migration) | - |
| `storage-keys.js` | Namespaced localStorage key registry | - |
| `api-keys-store.js` | Claude/OpenAI API key read/write/remove | - |
| `app-version.js` | Runtime release version label | - |
| `practice-audio.js` | Thin shared piano playback wrapper | - |
| `scales-playback.js` | Scales sequence playback coordinator | - |
| `scales-voice-maps.js` | Scale voice-command phonetic maps | - |
| `progress-store.js` | Scored-take history + daily trend lines (`practice-progress`) | - |
| `media-session-core.js` | The whole now-playing surface: car/lock-screen metadata, document title, header heading, playback state, media keys, silent-WAV session keep-alive | yes (navigator.mediaSession, document.title writes) |
| `pattern-practice-core.js` | Scale-degree offset and phrase math | - |
| `music-constants.js` | Note math, scale patterns, frequency conversion | - |
| `voice-command-core.js` | Speech recognition, auto/manual modes, spoken "submit", transcript UI | yes (webkitSpeechRecognition) |
| `history-list.js` | Capped newest-first history lists (pages provide renderItem) | - |
| `shared-header.js` | Site header, nav, version label | - |

CSS: `style.css` (global shell) -> `practice-controls.css` (shared
primitives: vf-btn chips, step fields, segment rows, display toggles,
transport buttons, history lists, pitch-test panel) -> one page stylesheet.
Page CSS may override primitives; never the reverse. The full button/control
class inventory per page, with its unification plan, is
[controls.md](controls.md).

## The playback law

Old-settings audio never overlaps new-settings audio, and stop means stop.

`piano-core.js` is a voice engine, not a wrapper around Tone.Sampler:
every note is a registered voice (its own buffer source + gain node) with
an authoritative end time. `stopAll()` kills each voice with a 20ms declick
ramp - the master output is never muted, so nothing can "come back".
`activeVoices()` reports exactly what is sounding. Notes get a 0.25s damper
fade at their musical end. Playback loops are cancelled via monotonic
tokens (`playToken` / `playbackId`); a superseded loop checks its token and
exits.

## Pitch pipeline

The singing listen-and-draw system, end to end:

```
Microphone (getUserMedia)
 v  pitch-detect-core.js - capture + detection + recording
AnalyserNode (fft 2048) -> autocorrelation detector -> glitch holdback
 -> voice-gated clock -> history: PitchSample[] {time, freq, midi, cents, note}
 v
pitch-trace-view.js - canvas renderer (rails, targets, sung line, playhead)
 ^ data via provider callbacks              ^ verdict colors
pitch-test-panel.js - embeddable panel (owns session, canvas, guide, options)
 v  per-note windows
pitch-score.js - the one definition of "did you hit the note"
 v
progress-store.js - takes, trend lines, weak-spot analysis
```

**Capture and detection** (`pitch-detect-core.js`, the only file allowed
to call getUserMedia - ast-grep enforced). `createMicCapture` owns the
AudioContext, a 2048-sample analyser, and reusable buffers. `readPitch()`
runs an autocorrelation detector (normalized difference with parabolic
peak interpolation) over the time-domain buffer; it returns nothing when
the signal is too quiet (RMS < 0.01) or outside the singable band
(VOICE_MIN_MIDI D2 to VOICE_MAX_MIDI C5 - the full barbershop TTBB span
with headroom; out-of-band detections are the room and the gear, not the
singer, and read as silence). Otherwise it returns fractional MIDI plus
cents deviation. Accuracy is within ~5 cents on voice-like signals
across the singing range. The band is deliberately the OWNER's
instrument, not the exercise's: it never moves with the selected key,
range, or targets, so it cannot re-introduce target-coupled filtering.

**Recording** (`createTraceSession`, same file). A requestAnimationFrame
loop reads a pitch every frame and appends accepted samples to `history`.
Two mechanisms sit between detection and history:

- *Glitch holdback*: a jump > 5.5 midi arriving within 220ms of the
  previous sample is held back until 3 consecutive samples agree at the
  new level (within 1.2 midi, inside 260ms), then all held samples are
  flushed together - a real leap loses nothing. Voices cannot leap that
  far and settle within a frame or two; brief detector scrapes (octave
  errors, harmonic locks, breath transients) can, and never reach the
  trace. This is the ONLY rejection in the pipeline.
- *Voice-gated clock*: with pause-on-silence on (the default), time only
  advances while voice is detected, so a take does not scroll away while
  the singer breathes. Off means wall-clock from the last reset.

**The instrument law: the chart draws what was actually sung.** The
voice line and its dots derive only from the sung history. There is no
rails/target-based discarding, and the chart's vertical range in
`pitch-trace-view.js` expands to cover the sung trace, so off-rails
singing (wrong octave, overshoot) draws at its true pitch instead of
clamping to an edge or vanishing. The exercise sets only the chart's
FRAME - which rails are drawn as grid lines and how far the time axis
zooms - never the position, color, or visibility of the voice line. Dot
colors are cents from the nearest chromatic note (key- and
target-independent intonation). (This is load-bearing: the singer
adjusts by seeing their real pitch. A regression test records samples an
octave below the rails and asserts they stay in the trace.)

**Rendering** (`pitch-trace-view.js`). A pure canvas renderer that pulls
everything through provider callbacks: `rails()`, `targets()`,
`history()`, `clockMs()`, windowing options. The sung line breaks across
silences > 250ms and across unconfirmed fast jumps; dots along it are
colored by cents deviation. Target bands recolor from blue (pending) to
green/yellow/red once scored, and their HEIGHT is the real hit tolerance
(PitchScore.OK_CENTS mapped through the same pitch scale as the voice
line), so "the trace is inside the band" and "this note counts" are the
same statement - the picture can never promise a tolerance the scoring
does not honor. Redraws are throttled to 50ms ticks by `RateGate`
(render-throttle.js).

**The embeddable panel** (`pitch-test-panel.js`). Phrases (Test), Scales
(Sing), and Intervals (Sing) embed the same component; a page supplies a
typed `PitchTestPanelConfig` (key, rails, targets, content duration,
`playNote`). The panel renders its own markup, owns the trace session,
and sequences guide playback from the same target spans it draws - guide
and notation cannot disagree. See "Typed contracts" below for the
exclusivity and never-auto-play rules.

**Scoring and progress**: `pitch-score.js` grades each target's window
(see "Pitch correctness" below); completed takes are recorded through
`progress-store.js` with per-note verdicts and signed cents bias, feeding
the trend line and weak-spot line.

Consumers: the Trace page uses session + view directly; Phrases, Scales,
and Intervals go through `pitch-test-panel.js`; pitch-meter uses the same
session plus its own call-and-response/play-along modes (scored through
the same `pitch-score.js`); ears uses low-level `createMicCapture` for
its hold-detection loops. User-facing behavior per page is in
[tools.md](tools.md); per-setting behavior in [parameters.md](parameters.md).

Media keys and the now-playing surface: phrases, scales, intervals, ears,
and the player register hardware play/pause/next handlers through
`media-session-core.js`, which is the ONLY writer of
`navigator.mediaSession` and `document.title` (ast-grep enforced). One
call (`setNowPlayingTitle`) fans out to every surface a listener sees -
car/lock-screen metadata, the tab title, and the site-header heading - so
the surfaces cannot disagree, and reporting `setPlaybackState('playing')`
automatically secures session ownership via the silent-WAV loop (without
it, Chrome routes the car display to whichever frame is audibly playing;
with a YouTube iframe that means youtube.com's metadata, not ours). The
core self-primes on the first user gesture; pages never wire activation.
Trace and pitch-meter deliberately do not register - they are
watch-the-screen tools where hardware keys add nothing.

**Deadline scheduling, not polling.** Timeline-driven UI (the player's
progress bar, time text, lyric highlight, and now-playing lyric title)
never runs on a fixed-interval timer. The moments at which those
surfaces change are computable in advance (the next synced-lyric moment,
the next whole display second), so the renderer draws once from the
player's ACTUAL current time and sleeps until the earliest upcoming
deadline (`scheduleNextProgressRender` in player-playlist.js). Every
wake re-reads real time and renders idempotently, so early timers,
buffering stalls, and drift self-correct; pause freezes the clock, and
seeks / lyric arrival / resume call `resyncProgressClock()`. Polling is
acceptable only where the data source is genuinely eventless and
continuous: mic frames (requestAnimationFrame in pitch-detect-core) and
the deploys dashboard's remote refresh.

## Pitch correctness (one owner)

`pitch-score.js` is the single definition of "did the singer hit this note,
and how accurately?". The embedded sing/test panel, the Pitch tool's
call-and-response, and Pitch free practice all go through it; no tool
carries its own thresholds (they had previously drifted - a 1.5
vs 1.5-but-`<` match window, 3 vs 5 minimum samples, 10/25 vs 15/30 bands).

**Takes are scored as sequences, not clock windows**
(`PitchScore.scoreSequence`): the sung history is segmented into held
notes (split on time gaps and sustained pitch moves; fragments below
`MIN_VOICED` are transition glides, dropped) and aligned in order to the
target notes by minimal-cost dynamic alignment (tolerates false starts,
skipped notes, and one hold serving repeated equal targets). Each
aligned pair is graded by `scoreWindow`. The take clock never decides a
verdict - holding a note twice its slot, or breathing between notes,
scores identically. This is forced by the voice-gated clock: breaths are
zero-width in voice time and note durations are the singer's own, so
fixed windows misassign samples by construction. Fixed windows remain
only where a window is physically real: the Pitch tool's timed
call-and-response periods. In the panel, a matched note gets its verdict
as soon as the singer moves on; an unmatched target stays pending until
the take clock passes its slot.

The model, from one consistent idea of correct:

1. **Attempt** - at least `MIN_VOICED` voiced samples in the note's window,
   else it is "didn't sing it", not "wrong".
2. **Identity** - the pitch actually sustained is the **median** of the voiced
   samples (robust to onset slide, release, and octave glitches, which a mean
   is not). It must sit within `IDENTITY_CENTS` (70c) of the target, and a
   majority of samples must be within that band, so wobble around the target
   is not credited as a hold.
3. **Accuracy** - graded from the sustained pitch's distance: good <= 15c,
   ok <= 30c, otherwise missed (reached but too loose for a clean rep).

`biasCents` is always reported signed (+ sharp, - flat) so degree-level
weak-spot analysis can say "you overshoot the 6th" - the training goal. Free
practice has no time windows, so it bins each voiced sample to its nearest
target within the identity band, then grades each target with the same
`scoreWindow` definition.

## Scales engine rules (movement styles, exercises)

The scales feature plays musical patterns built from:

1. **Section length** - the semitone range ('1o', '1o+3', '1o+5', '2o',
   'centered' = -4..+16)
2. **Scale** - which notes within that range (patterns in
   `music-constants.js`)
3. **Root, direction, repeat, rising/shifting, movement style**

Vital rules that have caused bugs before:

- **Section notes are sacred**: every section note must be played AS a
  section note; movement styles only add extras around them and never
  change which notes are section notes.
- **Determine section notes first** (with turn-point deduplication:
  up+down plays ...B-C-B..., never ...B-C-C-B...), **then** apply movement.
- **Extras may exceed the section range** (degree 9, 10...) but the final
  note of a round trip gets no extras - the ear expects clean resolution.
- **No movement style may add extra gaps**; the 1s section divider exists
  only between repeats when looping forever.
- Movement groups are explicit objects `{ notes, sectionIndex, isChord }` -
  playback and display read these properties, never special-case by name.
- `getNotesAbove/Below` use modular arithmetic over the scale pattern, not
  array extension.
- **Rising** transposes the whole scale by semitones each repeat;
  **shifting** moves the start within the same scale. Mutually exclusive;
  both imply repeat-forever.
- Voice commands reset settings to defaults before applying modifiers.

Exercise patterns are degree-offset templates with `'O'` as the
octave placeholder (`five_note`, `octave_jump`, `arpeggio_return`,
`thirds`), so they work for any scale size.

## Persistence

All user-facing browser state goes through `settings-store.js` and the
key names in `storage-keys.js`. Do not call `localStorage` directly from
page code except inside those modules (and `api-keys-store.js` for API
keys, which remain plain strings).

### Envelope format

Every persisted blob uses:

```json
{ "v": "<app version from app-version.js>", "data": { ... } }
```

`app-version.js` is the runtime source; `bump-version.sh` updates it
together with `VERSION`, `shared-header.js`, and all `?v=` cache busters.

### Load policy

| Situation | Behavior |
|-----------|----------|
| Missing key | Keep defaults |
| Legacy flat JSON (no envelope) | Typed merge, then re-save in envelope form |
| Older version envelope | Best-effort typed merge; log partial restore |
| Same version, parse/structure failure | **Serious visible error banner** (likely a bug) |

Failures always log to the console as `[voice-wei persistence] ...`.

### Key registry (`storage-keys.js`)

| Key constant | Purpose |
|--------------|---------|
| `SCALES_SETTINGS` | Scales page settings (includes UI toggles and voice TTS prefs) |
| `SCALES_PRESETS` | Saved scale configs |
| `INTERVALS_SETTINGS` | Intervals patterns + ear-training mode settings |
| `INTERVALS_EAR_STATS` | Lifetime per-interval identification stats |
| `PHRASES_SETTINGS` | Phrases page settings |
| `TRACE_SETTINGS` | Trace page settings |
| `PITCH_METER_SETTINGS` | Pitch tool settings |
| `PLAYER_SETTINGS` | Music player voice/settings |
| `PLAYER_PLAYLIST` | Working playlist (Songs + membership, no lyric runtime) + current index |
| `PLAYER_FAVORITES` | Favorited tracks |
| `PLAYER_LYRICS_CACHE` | Retired (lyrics moved to IndexedDB `lyricStates`); name stays reserved |
| `PLAYER_LYRICS_VIEW` | Lyrics overlay preferences |
| `EBOOK_SETTINGS` | Books TTS settings |
| `PRACTICE_PROGRESS` | Scored take history (cap 1000) |
| `API_CLAUDE` / `API_OPENAI` | API keys (plain strings via `api-keys-store.js`) |
| `PANEL_*` | Pitch test panel options per page |

Legacy unprefixed keys are listed in `LegacyStorageKeys` and migrated on
first read.

### Other storage

Books large files: IndexedDB (`voice-wei-books`), not localStorage.
Log panel contents: DOM-only, not persisted.

Scored practice persists via `progress-store.js` → `PRACTICE_PROGRESS`.

Books keeps large user files in browser IndexedDB (`voice-wei-books`), not
localStorage. The current schema uses three object stores:

- `books`: original upload Blob, title/author/format metadata, estimated
  duration, read/listen progress, generated coverage.
- `sections`: parsed book text sections keyed by book; EPUB/HTML sections also
  keep sanitized reader markup, with EPUB package images embedded as data URLs
  where possible.
- `segments`: TTS-sized text chunks with per-chunk status and MP3 Blob.
- `history`: local read/listen events (play/pause, segment transitions, jumps,
  samples, per-day aggregation inputs).

This makes Books a browser-local reader/player/generator rather than a
one-shot converter: generation can stop after some chunks, preserve completed
MP3s, and resume next session. EPUB imports prefer official `nav`/NCX table of
contents labels, and PDF imports use outline entries when available, so
chapter-level controls can sit above the chunk storage model. There is still no
account identity, analytics sink, or server-side audit trail. The durable
history is browser-local and serves navigation/progress UI. The OpenAI key and
TTS settings use `api-keys-store.js` and `StorageKeys.EBOOK_SETTINGS`. The
visible Log panel is DOM state only and is lost on refresh/navigation.

localStorage is intentionally not used for EPUB/PDF/MP3 data: it is
string-only and commonly capped around 5-10 MB. IndexedDB quota is
browser/device dependent; Books displays `navigator.storage.estimate()` and
requests persistent storage by default where supported.

### The Song primitive (music player)

`player-songs.js` (`PlayerSongs`) is the single owner of the player's data
vocabulary. A **Song** is: the YouTube `videoId` (identity - the key that
plays it) plus always-present descriptive metadata (name, artist, year,
album, comment, searchTerm, raw YouTube title/channel, duration). Every
shape the player uses derives from it, and each derived shape has exactly
one constructor in that module:

| Shape | Constructor | Adds to Song |
|-------|-------------|--------------|
| `PlaylistItem` (working playlist) | `createPlaylistItem` | list id, source kind/label, runtime lyric state |
| Persisted playlist entry | `persistedPlaylistEntry` | list id + source, **no lyric runtime** |
| `FavoriteData` | `createFavorite` | `favoritedAt` |
| Known-song history record (IndexedDB) | `historySongRecord` | `firstSeenAt`/`lastSeenAt`, sourceKind |

No player code hand-builds song-shaped objects. Songs enter the playlist
only through `appendPlaylistItem` (append at the end, render, lyric
lookup); a new AI search **replaces** the working playlist
(`searchAndAddToPlaylist` with `replaceExisting`), while explicit loads
(favorites, history lookups, known songs) append. Replacement loses
nothing: every song is recorded to the known-songs catalog when it is
added, so the working playlist is a matter of convenience over durable
data.

**Lyric state has one permanent owner: IndexedDB `lyricStates`, keyed by
videoId.** Each record is either `found` (carrying the LyricsResult) or
`none` with `checkedAt` - and `none` may ONLY be written by a provider
search that actually answered empty; failures (rate limit, network,
timeout) save nothing, so the song stays unresolved and the next
interaction retries. The write discipline is save-then-activate: the
store write is awaited first, then the live playlist item is updated
from that same record (`resolveLyricState` -> `applyLyricStateToItem`).
A live item is therefore only ever 'ready' with data that came from or
through the store - there is no second source that can disagree with it.
(An earlier design kept a fuzzy artist/title-keyed cache in localStorage
with alias and miss maps; keying by videoId in IndexedDB replaced it,
and the `PLAYER_LYRICS_CACHE` localStorage key is retired.)

**Lyrics are never persisted per playlist item.** The persisted playlist
carries Songs only; `lyricsData`/`lyricsStatus` are runtime state
re-derived from `lyricStates`. (Persisting full lyrics per item is what
exceeded the localStorage quota at ~100 songs.)

**Every interaction verifies against the store.** Adding a song (search,
favorites, history, restore-at-load) queues its resolution; playing a
song or tapping its row chip resolves it immediately. Resolution runs as
one shared in-flight promise per videoId - duplicate rows, the queue,
and a direct play all await the same flight - and every provider fetch
is bounded by a 12s timeout, so a lookup interrupted by a page
suspension always settles and can never wedge a song in 'loading'.
Background resolution goes through one bounded queue (2 songs at a
time), so a 100-song add never fires 100 requests at once. Tapping the
chip on a stored `none` forces a fresh provider recheck; a stored `none`
also expires after 7 days.

**Library reconciliation is per song, on every load.**
`reconcileLibraryLyrics` queues every favorite for resolution before the
playlist restore; songs already resolved in the store settle from one
IndexedDB read with zero network, so the pass is idempotent and an
interrupted or failed recheck resumes on the next open by construction.

**Timed lyrics first.** The two lyric kinds are named in every
user-facing surface: timed (line-synced) and simple (text only). The
LRCLIB record selection prefers a timed record over a simple-only one
among plausible matches; a stored record holding timed lyrics is final,
while simple-only and "none" records carry the `searchVersion` that
produced them and get exactly one re-search when the algorithm improves
(plus the normal TTL recheck), never downgrading - an upgrade attempt
that finds nothing better keeps the simple lyrics it has.

### Music player durable history (`voice-wei-music`)

The music player keeps unbounded/historical data in its own IndexedDB
(`voice-wei-music`), owned solely by `player-history-db.js`. Page/engine code
never touches this DB directly. Stores:

- `logs`: every in-app log line (append-only).
- `lookups`: each natural-language music request and its resulting song list.
- `songs`: the known-songs catalog, keyed by `videoId` (upsert on re-seeing);
  records are `historySongRecord` shapes (Song + timestamps), never raw
  playlist items with lyric blobs.
- `youtubeSearches`: the search-term -> results cache, keyed by normalized
  query; consulted as a fallback when the live proxy search fails.
- `favoriteEvents`: an append-only audit of favorite toggles.
- `lyricStates`: per-song lyric state keyed by videoId - the single
  permanent owner of lyrics (see "Lyric state has one permanent owner"
  above).
- `librarySongs`: imported MIDI/MusicXML songs with their full note
  arrays, keyed by id (migrated out of localStorage, which their bulk
  was on course to exhaust).

Store-by-bulk is the dividing law (persistence principle P1):
**localStorage** (a shared ~5MB quota) may hold only KB-scale state whose
size does not grow with the library - settings, lyrics-view prefs, API
keys, the live playlist + index, and the **authoritative favorites set**
(`PLAYER_FAVORITES`, Song-sized records). Its one real benefit is
synchronous availability at boot; nothing bulky may buy that
convenience. **IndexedDB** (GB-scale quota) owns everything that grows
with the library or with time: the stores above, per-song lyric states,
and imported library songs. No concept is authoritative in two stores
(P2): favorites live in localStorage; `favoriteEvents` is history only,
never read back as the source of truth. (An earlier schema also mirrored
favorites into a `favorites` object store; database version 2 deletes it
on upgrade. Lyrics and imported songs also began in localStorage; v3/v4
moved them out after quota blowouts.)

Caps apply to time-streams only, never to library entities (P3). The
append-only event streams grow with use forever, so they carry caps and
trim loudly (`logs`/`favoriteEvents` 5000, `lookups` 2000): on nearing 90%
the player posts a one-time "History storage" notice via the log panel;
past the cap the oldest records (lowest primary key) are trimmed. Stores
that mirror the library - `songs`, `lyricStates` - and the re-fetchable
`youtubeSearches` cache have NO cap: trimming a library store would mean
silent partial coverage (some songs with state, some without), and the
library itself is their natural bound. IndexedDB quota is GB-scale;
record counts are not the risk.

## External resilience vs. internal fallbacks

The anti-fallback rule (`.cursor/rules/00-absolute-rules.mdc`) forbids
downstream alternatives for things we control: no "try multiple mechanisms and
hope", no parallel code paths for one job, no retry loops where one
deterministic path belongs. That rule is about systems we own.

It does **not** forbid resilience against genuinely external, flaky services we
do not control. Two player behaviors are deliberate external resilience, not
banned fallbacks, and are allowed:

- `proxy.php` tries several Piped instances, then several Invidious instances.
  These are independent third-party hosts that rot and rate-limit; failover
  across them is the only way to get a result at all.
- `searchYouTube` consults the IndexedDB search cache when the live proxy fetch
  fails. This is recovery from an external outage using our own recorded data,
  surfaced explicitly in the log ("Search Cache"), not a silent swallow.

Internal cascades are still banned and have been removed. YouTube player
creation now waits on exactly one shared API-ready promise (`ensureYouTubeApi`)
bounded by a timeout - the previous "two strategies for robustness" (a callback
queue plus a polling interval, which could both fire and build two players) is
gone. The dividing test: if the alternative exists because an outside service
might fail, it is resilience; if it exists because we were unsure our own code
would work, it is a fallback and must be collapsed to one correct path.

## Data representation law

One representation per concept, conversions in one place:

- **Pitch is MIDI integers internally.** All math, state, and module
  boundaries (piano engine, pitch detection, targets, rails) use MIDI.
  Note names ("D#", "Bb") and pitch strings ("D#3") exist only at the
  edges: voice input, persisted settings, display. Every conversion goes
  through `music-constants.js` (`noteNameToMidi`, `midiToPitchString`,
  `midiToNoteName`, scale-aware spelling helpers, `normalizePitchClassName`,
  `midiToFreq`/`freqToMidi`). Stored roots may be canonicalized to sharp
  pitch classes for simple equality and stepping, but scale/key displays
  use conventional musical spelling (`D#` major is shown as `Eb` major).
  An ast-grep guard forbids `Tone.Frequency` outside piano-core so no
  parallel conversion path can reappear.
- **Scales are `SCALE_PATTERNS` ids** ('major', 'harmonic_minor'...),
  one frozen registry in music-constants.js; degree/offset math lives in
  `pattern-practice-core.js` (offset 0 = degree 1).
- **Scale degrees are explicit objects at UI boundaries.** Scale rails,
  previews, pitch-meter targets, and interval-pattern rails consume
  `ScaleDegreeNote` objects from `scaleDegreeNotesInRange()` rather than
  recomputing labels from pitch classes. The object carries interval,
  degree number, octave shift, MIDI, and the correctly spelled pitch
  name. That prevents octave notes from wrapping back to degree 1 and
  prevents key signatures from disagreeing with note labels.
- **A sequence of notes is a list of note objects** (`SequenceNote[]`,
  zipped once by `buildSequenceNotes`), never parallel arrays indexed by
  position. Every consumer-side re-zip is a chance to misalign - the
  masked-test scoring bug was exactly that. `Phrase` and the intervals
  instances carry `notes`; the phrases page's authoritative take state
  is an explicit `TakeNote[]` (offset + enabled), and `buildTakePlan` is
  the single derivation everything reads.
- **Time is milliseconds**, and names carry the unit (`noteLengthMs`,
  `gapMs`, `durationSec`). The piano boundary takes `ToneDuration`
  (seconds number or Tone notation string); scales' per-note triple is
  `NoteTiming`.

## Typed contracts (static guarantees first)

The shared musical vocabulary lives in `types/music.d.ts` as global
ambient types: `KeyContext`, `ScaleDegreeNote`, `TargetSpan`, `RailLine`,
`PitchTestPanelConfig`. Rules:

1. **Data the component cannot work without is required in its config
   type.** A pitch test cannot exist without `key()` and `playNote()` -
   omitting them is a tsc error at the call site, before anything runs.
2. **`create()` validates required fields and throws.** A bad consumer
   dies at page load (caught by the pages-load suite and by anyone
   opening the page in dev), never mid-interaction in front of the user.
3. **Derived behavior is owned by the component, from the typed data.**
   The panel sequences its own guide from the active `TargetSpan`s, so
   the guide is by construction the same notes/key/timing as the drawn
   notation - a consumer cannot supply a guide that disagrees. Consumers
   only provide `playNote(midi, durationSec)`. The guide is an explicit
   button - the panel never auto-plays into a take.
   Open Test/Sing mode COEXISTS with page playback (owner-directed):
   Play, Next, single-note taps, and media keys keep working while the
   panel listens, so the user can hear notes and sing against them.
   Opening the test still stops the transport (a take starts from
   silence), Stop never closes the panel, and generating a new phrase
   while the panel is open restarts the take for the new targets.
4. **One timeline, explicitly named.** Phrases derives a single take
   plan (`PhrasePlanNote[]`: index, midi, degree, spoken, enabled,
   startMs/endMs) and display, playback, and the test panel all read
   it. Disabled notes own no time; the timeline starts at 0 with the
   first ENABLED note - never "assume the first item is zero".
5. **Shared state is reified, not implicit.** The key is data the panel
   holds and displays ("Key: Eb3 major" in the readout), not something
   smeared across closures.

New shared components follow the same pattern: a named `...Config` type
in `types/`, required fields for required data, a throwing constructor.

### Player module typing

The music player is one controller (`VoiceMusicController` in `player.js`)
composed from feature modules that mix their methods onto it via
`Object.assign(controller, ...)` (commands, playlist, lyrics, song-library,
history-ui). All of these are `@ts-check`, not `@ts-nocheck`: each install
wraps its method object in `/** @type {ThisType<VoiceMusicController>} */` so
`this` is the controller type inside every method, and the controller's full
surface is declared in `types/player.d.ts` (merged with the `class`). Playback
state is the one piece that is a real owned object, not a mixin: `PlaybackState`
(`player-playback-state.js`) holds all playback status and is reached through
`controller.playback` plus thin installed accessors. Adding a method to a player
module means adding it to the `VoiceMusicController` interface; the typecheck
gate enforces this.

## Testing

`npm test` runs the fast headless profile in `tests/`: JavaScript syntax,
CSS ownership, page-load smoke, and the fast Books workflow suite (local
library, book mode, custom player, history). It is the default pre-push check
for ordinary docs/CSS/small-JS work and is also a deploy gate.

Use `node tests/run-all.js --suite <suite-file>` for targeted browser checks.
Use `npm run test:full` for slower playback law, shared controls +
persistence, per-tab functions, and fake-mic listening tests when touching
those systems. `npm run lint` (ast-grep, including the ownership guards),
`npm run typecheck` (checkJs), and `npm test` must stay clean - **zero errors,
no tolerated baseline**. These run as gates in the deploy workflow; any failure
blocks the push from reaching the live site.

## Deploy

Push to master -> GitHub Actions runs the gates (typecheck, lint, fast browser
suite) and then rsyncs to production (`--delete`; docs, tests, tooling excluded). `./bump-version.sh` updates the VERSION file, the
header label, and every `?v=` cache buster - run it whenever a release
ships. Manual deploy: `./deploy.sh`.

## How to decide what a control looks like

Design order, never reversed:

1. **Start from the page's purpose** (docs/product-goals.md). What is the
   user trying to accomplish here, with what hands/eyes/attention budget?
   Functionality and usage flow from that - not from what other pages do.
2. **If the resulting control does the same job as one that already
   exists** (pick a pitch, step a duration, choose one of N modes), it
   must be the shared control. No derivative look-alikes. Ties between
   versions go to the most recent reviewed page (currently phrases).
3. **If the purpose genuinely calls for a different interaction**, build
   it as its own named component and list it under "Deliberately distinct
   surfaces" below with its reasoning.

Convergence is the outcome of rule 2, not a goal in itself. A page must
never get worse at its job to look like another page.

## Canonical pickers

One picker kind per value kind, everywhere:

- **Single pitch** (root, drone note, range center): the root-pitch stepper
  (step field showing e.g. "D#3", +/- moves by semitone). No chip grids,
  octave rows, sliders, or selects for pitches.
- **Ordered numeric value** (durations, gaps, lengths, TTS rate/pitch):
  step field over a fixed value list.
- **Shared presets**: the root, note-length, and gap pickers use the
  single preset lists owned by `practice-controls.js`
  (`ROOT_PITCH_MIN/MAX_MIDI`, `NOTE_LENGTH_VALUES`, `GAP_VALUES`) - the
  same values on every page, resolved and labeled by the same helpers
  (`effectiveGapMs`, `formatGapLabel`). Pages never carry their own
  copies of these lists (see docs/parameters.md "Shared step presets").
- **Exclusive option set** (mode, direction, type, repeat, output,
  scale...): segment-row of vf-btn pills, regardless of set size.
- **On/off**: display-toggle chip checkbox.
- **Multi-select** (Ears interval grid): vf multi-select chips - the only
  multi-value picker, and deliberately distinct.

The only remaining `<select>` on the practice pages is the Scales TTS voice
list (dynamic, OS-dependent, dozens of entries - a genuinely different
picker). Books is a deliberately distinct non-practice tool and keeps its own
selects for OpenAI TTS voice/model choices.

### Grouping rule (visual separability)

Controls must be identifiable as groups at a glance:

1. **Every option group is visually bounded.** Either it sits in a
   segment shell (the bordered pill container) or it lives in a labeled
   `vf-row` where the left label marks the boundary (the voice-first
   pages). Bare chip runs where one group bleeds into the next are
   forbidden.
2. **Numeric steppers cluster together.** All of a page's step fields
   share one row/card (each step field is its own bounded pill), never
   scattered between option groups.
3. **Shells are tight.** Group containers use minimal padding; the
   boundary comes from the border, not from whitespace. Don't spend
   vertical or horizontal space to imply grouping.

## Canonical control surfaces

Beyond pickers, the rest of the control vocabulary is also fixed:

- **Settings rows**: `vf-row` (labeled row) + `vf-label` (small-caps left
  label) + `vf-options` (wrapping option container, 5px gap). Standalone
  `vf-options` is the label-less chip row (phrases output/scale rows).
- **Transport buttons**: `listen-button` (wide green mic bar),
  `stop-button` (red), `play-button` (teal; `.listening` goes amber),
  `next-button` (orange), `repeat-button` (indigo; `.selected` goes green
  for latching repeat). Same classes in the sticky voice row and inside
  panels (pitch-meter, trace). `pitch-test-launch-button` is the blue
  Sing/Test variant of play.
- **Panel action chips**: `panel-action-btn` for small corner/inline
  actions (Copy All, Clear, Save, Apply, Delete, Reset, Random, Test,
  Show, Select All). Add `.danger` for destructive actions (red hover).
- **Secondary buttons**: `secondary-btn` for mid-size neutral actions
  (trace Reset, ears sing controls). Also takes `.danger`.
- **Primary buttons**: `primary-btn` for mid-size green "do the thing"
  actions (Books import/generate/play-from-progress).
- **Text fields**: `text-input` base look; pages may size (width,
  font-size, resize), never re-skin.
- **Selected state**: `.selected`, everywhere. No `.active` dialects.
- **Compact density**: `vf-compact` on a settings container switches the
  shared controls inside to the 16px pill density (phrases, scales).

Page stylesheets may add layout (placement, sizing) on top of these but
must not redefine their look. `tests/test-css-ownership.js` fails the
suite if a page stylesheet (including ebook.css) redefines a selector
owned by practice-controls.css. The concrete class-by-class inventory
(with the player dialects still awaiting convergence) is
[controls.md](controls.md).

## Canonical settings order

Settings appear in the same order on every practice page, following the
most recent reviewed page (phrases):

1. **Timing** - note length, then gap
2. **Root** - the root pitch stepper
3. **Shape** - the page's own pattern settings (range, algorithm,
   direction, movement, repeat, exercise...)
4. **Output/display options** - output mode chips, display toggles
5. **Scale type** - the scale chip row
6. **Actions** - reset/random rows close the block

A page may omit groups it doesn't have, but never reorders the ones it
shares. Page-unique surfaces that are not settings (scales' piano, the
phrase stage) sit outside this order.

## Deliberately distinct surfaces

Gameplay surfaces that are not settings controls and intentionally keep
their own look: ears' answer grid and interval multi-select, scales'
piano keyboard, the player's media transport bar and lyrics overlay,
and the ebook reader surface (page text, TOC, and its dynamic
voice/model selects - Books' buttons use the shared vocabulary).

## Known deliberate gaps

- New gaps must be listed here with their reasoning, or fixed.
