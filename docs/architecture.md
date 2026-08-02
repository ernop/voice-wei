# Architecture

How the system is built. Product intent lives in
[product-goals.md](product-goals.md); per-setting behavior in
[parameters.md](parameters.md).

## Shape

Static site, no build step. Each tab is an `.html` + `.js` (+ `.css`) trio
loading shared libraries via script tags. Cache busting via `?v=NN`
(see Version System in the README). `proxy.php` is the only server-side piece:
it provides keyless Piped/Invidious music search, fixed-provider LRCLIB
search, and same-origin webpage/PDF imports for Books and linked-page requests.

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

### Lyrics startup contract

The Lyrics page has one readiness boundary: `voice-wei-player-ready`, emitted
after controller construction, UI wiring, IndexedDB song-library hydration,
favorite reconciliation scheduling, saved-playlist restoration, and one
animation frame. `window.__voiceWeiStartup` exposes the same result for
inspection and tests. Its wall-clock budget is 1000ms from navigation start.
The initial status says `Initializing...`; `Ready` (including the no-key
`Ready - keyless search` state) is only authoritative after the readiness
event. Missing keys open the entry surface only at an Ask AI or Song Report
boundary.

Every load writes a `Startup` line to the in-page Log and a detailed report to
the browser console. The report separates costs that overlap and therefore
must not be added together:

| Report section | What it measures |
|----------------|------------------|
| `navigation.serverResponseMs` | navigation start through the first HTML byte |
| `documentDownloadMs` | first through last HTML byte |
| `parseAndBlockingResourcesMs` | HTML parsing plus resources that block `domInteractive` |
| `domContentLoadedHandlersMs` | all DOMContentLoaded callbacks |
| `appAfterDomContentLoadedMs` | remaining application work through the first ready frame |
| `phases` | named controller operations, with item counts for library/favorites/playlist work |
| `resources` | every resource's URL, initiator, start, network duration, transferred bytes, and decoded bytes |
| `longTasks` | main-thread tasks over 50ms reported by the browser |

The named phases are controller construction/stored settings, configuration
and key state, UI/voice wiring, lyrics-view settings, YouTube readiness
wiring, local-library hydration, favorite-lyrics scheduling, playlist
restoration, favorite-video repair scheduling, and linked-song setup.
`application initialization` contains those phases and is intentionally
nested.

External work that does not gate interaction is outside this readiness
boundary. The YouTube IFrame API starts in parallel and playback awaits its
ready callback. Favorite and restored-playlist lyric fetches run through the
bounded background queue after they are scheduled. Tone.js is not a Lyrics
startup dependency: the page loads it only when Local Song Library playback
is first requested. `tests/test-player-startup.js` enforces the one-second
contract on an empty profile and with a 100-song restored playlist.

### Lyrics background-playback evidence

`player-lifecycle.js` records evidence; it does not infer a cause or change
playback. Every session start, document visibility transition, page
freeze/resume, pagehide/pageshow, online/offline transition, transport intent,
and YouTube ready/state/error callback writes a readable **Playback diagnostic**
line through the durable Music Log.

The same transition synchronously replaces one localStorage breadcrumb. This
single last-event record is deliberate: Android can kill a hidden renderer
without firing `pagehide`, so an asynchronous history write alone may not
finish. On the next load the session-start line includes:

- `document.wasDiscarded` support/value and navigation type;
- the prior event, visibility, orderly-pagehide marker, application transport
  state, YouTube state, video id, and sampled position;
- browser version, network connection, device-memory class, and JavaScript
  heap figures when Chrome exposes them; and
- current application, YouTube, Media Session, and silent keep-alive states
  (a paused keep-alive under a playing claim is audio-focus loss).

A 15-second heartbeat refreshes the breadcrumb silently (no Log line) while
a track is playing or paused. After an unannounced renderer kill, the gap
between the last heartbeat and the return visit bounds when playback died,
and the position across consecutive beats shows whether sound survived
hiding. Audible tabs are exempt from background timer throttling, so beats
stay on schedule exactly while sound is actually playing.

This separates the important cases without guessing: a new document with
`wasDiscarded=yes` confirms browser discard; a prior hidden session with no
orderly pagehide is evidence of abrupt teardown on browsers lacking that flag;
a surviving session whose YouTube callback changes from playing to paused
shows iframe/media intervention instead. `tests/test-player-lifecycle.js`
enforces those distinctions, including an ordinary reload with an orderly
pagehide.

The URL importer accepts only same-origin GET requests. It resolves and pins
every outbound hostname before connecting, rejects private/reserved addresses
and nonstandard ports, revalidates every redirect, verifies TLS, caps response
sizes, and limits binary passthrough to PDFs. Production nginx rate-limits the
endpoint and executes no other PHP file. A dedicated on-demand PHP-FPM pool
runs as `voicewei`, has no shell/process execution functions, and can access
only the application root and `/tmp`. Lyrics search uses the same outbound
request boundary but accepts only `track_name` and `artist_name`; the server
fixes the destination to LRCLIB, caps JSON at 2 MB, and retains the 12-second
provider timeout. It is not a general URL proxy.

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
| `notation-spelling.js` | Key signatures, VexFlow spellings, clef/staff-system choice | - |
| `staff-view.js` | The Phrases snapshot staff (one phrase, formatter-spaced) | - |
| `staff-scroll-view.js` | The Staff page's scrolling grand staff: continuous diatonic geometry, fixed clef/key header, now-line, dedicated sung-pitch band | - |
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

Timing has two dialects. `playMidi()` starts at Tone's safety lookAhead
(~100ms after the call) - fine for sleep-driven loops where nothing
visual races the sound. A transport with a visual clock (the Staff
scroll's now-line) must instead hand notes over early and schedule the
exact audible onset with `playMidiAudibleIn()`, which subtracts the
reported device latency (`audibleLatencySeconds()`: baseLatency +
outputLatency - the latter is large on Bluetooth). Firing at the visual
moment itself puts every attack audibly late against the display.

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
runs the McLeod Pitch Method (MPM: NSDF key-maxima with a clarity
threshold and parabolic interpolation - the standard tuner algorithm,
designed against octave/harmonic locks) on a half-rate copy of the
buffer, evaluating ONLY the periods a voice in the singable band can
produce (~280 lags; a frame costs ~0.3ms whether voiced or not, and
nothing outside the band ever costs a multiply). A subharmonic check
steps a pick down to a 1.5x/2x/3x-period peak only when that peak is
clearly more periodic (a dominant harmonic masquerading as the note),
and never below the band. It returns nothing when the signal is too
quiet (RMS < 0.01), unclear (NSDF clarity < 0.8), or outside the
singable band (VOICE_MIN_MIDI D2 to VOICE_MAX_MIDI Bb4 - the owner's
range: below a barbershop bass line's low notes up to just above a lead
line's top; out-of-band detections are the room and the gear, not the
singer, and read as silence). Otherwise it returns fractional MIDI plus
cents deviation. Validated synthetically: sub-cent accuracy on clean and
harmonic-dominant signals across the band, zero octave errors on
jittered low notes, zero false positives on noise. The band is
deliberately the OWNER's instrument, not the exercise's: it never moves
with the selected key, range, or targets, so it cannot re-introduce
target-coupled filtering.

**Recording** (`createTraceSession`, same file). A requestAnimationFrame
loop reads a pitch every frame and appends accepted samples to `history`.
Three mechanisms sit between detection and history:

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
- *External take clock*: a page whose exercise runs on its own transport
  (Staff's moving sheet) supplies `takeClockMs`; while it returns a
  number, that IS the take clock - samples are stamped with it and the
  chart, targets, playhead, and scoring all share it, so the take can
  never drift from the transport. Voice gating does not apply then.

**The instrument law: the chart draws what was actually sung.** The
voice line derives only from the sung history. There is no
rails/target-based discarding. The frame is equally stable chart
furniture: for the shared test panels it spans the rails AND targets
(plus a small pad) and the sung history never resizes it - a momentary
low or high note used to rescale the whole chart mid-take, crushing the
lanes and disorienting the singer. Out-of-frame singing stays recorded
at its true pitch (and still scores) but is clipped off-screen. Trace
supplies an absolute user-selected vertical frame with the same
clipping. Pitch opts into `frameFollowsVoice`: its job is showing
whatever is sung, so there the frame expands to cover the take (held
monotone - it does not shrink when extremes scroll out of view). In
every mode the frame never clamps, moves, or recolors the voice line.

**Rendering** (`pitch-trace-view.js`). A pure canvas renderer that pulls
everything through provider callbacks: `rails()`, `targets()`,
`history()`, `clockMs()`, windowing options, and an optional absolute
`verticalBounds()` frame. Rails come in three tiers:
emphasized (the core scale, solid green), context (neighbor notes in
their own sky-blue color - Trace uses this for the 3 scale notes below
the root and the 3 above the octave), and dimmed (dashed faint green,
e.g. expanded-range octaves). Label gutters are measured from the actual
rail labels each draw, and `railLabelsBothSides` (Trace) mirrors the
labels on the right edge with a matching gutter. The sung line breaks
across silences > 250ms and across unconfirmed fast jumps. Target bands
are bare outlines of the hit zone (`BAND_CENTS`, matching scoring's OK
tolerance by convention) - scoring verdicts never recolor them;
judgment lives in readouts and progress, not in the chart. The view
does not load `pitch-score.js`.

**Time axis is stable.** Window WIDTH comes from the page (content
duration, or Trace's selected 2-60s rolling width) and does not grow
with the clock. Growing it used to continuously squeeze the whole chart
- the classic Trace twitch. The playhead always scrolls inside that
fixed width.

**Drawing is never throttled.** A scrolling chart stepped at uneven
intervals reads as twitching (a 50ms gate polled from a 60Hz frame loop
alternates 3- and 4-frame steps), so live surfaces redraw every
animation frame - the draw itself is cheap and bounded (decimated trace,
a dozen rails and bands). `RateGate` throttles apply only to ANALYSIS
(scoring, ~100ms) and TEXT readouts (~50ms), never to the pixels.

**The embeddable panel** (`pitch-test-panel.js`). Phrases (Test), Scales
(Sing), Intervals (Sing), and Staff (Sing) embed the same component; a page supplies a
typed `PitchTestPanelConfig` (key, rails, targets, content duration,
`playNote`). The panel renders its own markup, owns the trace session,
and sequences guide playback from the same target spans it draws - guide
and notation cannot disagree. See "Typed contracts" below for the
exclusivity and never-auto-play rules.

**Scoring and progress**: `pitch-score.js` grades each target's window
(see "Pitch correctness" below); completed takes are recorded through
`progress-store.js` with per-note verdicts and signed cents bias, feeding
the trend line and weak-spot line.

**Live-loop budget: never re-chew the take.** Per-sample work happens
once, when the sample arrives; per-tick (50ms) work is bounded by the
number of held notes and targets, never by take length. Concretely: the
panel segments incrementally (`PitchScore.createSegmenter`, pulled from
`session.history` as it grows) and each tick only re-runs the alignment
(`alignSegments`); the phrases take plan is memoized on its input key
(targets, rails, and duration all read it every tick); the view finds a
fixed window's visible slice by scanning back from the end of the
time-ordered history; the stable rails/targets frame and Trace's fixed
vertical bounds require no history scan, and Pitch's voice-following
range is monotone for a take, so each frame folds in only the visible
slice (a full history scan happens once, to seed an empty held
range); Trace rebuilds its
rails/targets/window model only when a setting or the pattern text
changes and the frame loop just reads it back (no per-frame pattern
parsing or scale spelling); and the detector stops scanning at the
deepest singable period, which caps the cost of pitchless frames
(breath noise used to trigger a full scan). Measured on a simulated
10-minute take: the old per-tick scoring re-chewed 36k samples in ~15ms
per tick (plus allocation/GC pressure, the felt "grinding"); the
incremental path is ~1.4ms.

Consumers: the Trace page uses session + view directly; Phrases, Scales,
Intervals, and Staff go through `pitch-test-panel.js`; pitch-meter uses the same
session plus its own call-and-response/play-along modes (scored through
the same `pitch-score.js`); ears uses low-level `createMicCapture` for
its hold-detection loops. User-facing behavior per page is in
[tools.md](tools.md); per-setting behavior in [parameters.md](parameters.md).

Media keys and the now-playing surface: phrases, scales, intervals, ears,
and the player register hardware play/pause/next handlers through
`media-session-core.js`, which is the ONLY writer of
`navigator.mediaSession` and `document.title` (ast-grep enforced). The core
composes stable track identity/artwork, changing primary and secondary display
lines, true media position, and playback state without letting one concern
overwrite another. It fans the primary line out to car/lock-screen title
metadata, the tab title, and
the site-header heading. Reporting `setPlaybackState('playing')` automatically
secures session ownership via the silent-WAV loop (without it, Chrome routes
the car display to whichever frame is audibly playing; with a YouTube iframe
that means youtube.com's metadata, not ours). The core self-primes on the
first user gesture; pages never wire activation.
Trace and pitch-meter deliberately do not register - they are
watch-the-screen tools where hardware keys add nothing.

The Lyrics player intentionally changes both presented text lines within one
continuing song: timed lyrics own the primary/title line, while identity or a
generated report owns the secondary/artist line. Track identity, both display
lines, YouTube position, artwork, and silent-audio session ownership remain
separate concepts; see
[media-session-lyrics-design.md](media-session-lyrics-design.md).

**Deadline scheduling, not polling.** Timeline-driven UI (the player's
progress bar, time text, lyric highlight, and now-playing listening text)
never runs on a fixed-interval timer. The moments at which those
surfaces change are computable in advance (the next synced-lyric or song-report moment,
the next whole display second), so the renderer draws once from the
player's ACTUAL current time and sleeps until the earliest upcoming
deadline (`scheduleNextProgressRender` in player-playlist.js). Every
wake re-reads real time and renders idempotently, so early timers,
buffering stalls, and drift self-correct; pause freezes the clock, and
seeks / lyric arrival / resume call `resyncProgressClock()`. Polling is
acceptable only where the data source is genuinely eventless and
continuous: mic frames (requestAnimationFrame in pitch-detect-core) and
the deploys dashboard's remote refresh.

**YouTube prebuffer experiment.** Normal playback owns one reused iframe.
The opt-in `?prebufferProbe=1` diagnostic adds exactly two independent,
muted, off-screen players for the next two physical playlist entries. Each
plays briefly, pauses at the start, then measures warm-resume latency and
buffered seconds through the IFrame API before being destroyed. It never
becomes the audible player and is not constructed on the normal URL. Results
are persisted through the existing Log path so real phone/network behavior
can be analyzed before changing playback architecture.

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
call-and-response periods.

The alignment is a PREFIX of the targets: only notes the singer has
reached can carry a verdict. Inside the prefix, a matched note verdicts
the moment the singer moves on and a skipped-over note is missed; every
target beyond the prefix stays pending - the future never changes color
while singing continues. An unreached target resolves to missed only
once the voice has gone quiet AND the take clock is past its slot.

The model, from one consistent idea of correct:

1. **Attempt** - at least `MIN_VOICED` voiced samples in the note's window,
   else it is "didn't sing it", not "wrong".
2. **Identity** - the pitch actually sustained is the **median** of the voiced
   samples (robust to onset slide, release, and octave glitches, which a mean
   is not). It must sit within `IDENTITY_CENTS` (140c) of the target, and a
   majority of samples must be within that band, so wobble around the target
   is not credited as a hold.
3. **Accuracy** - graded from the sustained pitch's distance: good <= 30c,
   ok <= 60c, otherwise missed (reached but too loose for a clean rep).
   (Bands doubled 2026-07-08, owner-directed: the tight bands read as
   punishing in real takes.)

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
  only between repeats when looping forever. The ladder's rung gap is the
  one configurable exception: it is an explicit setting (`ladderGapMs`,
  0 = straight through), never a hard-coded pause.
- Movement groups are explicit objects `{ notes, sectionIndex, isChord }` -
  playback and display read these properties, never special-case by name.
- `getNotesAbove/Below` use modular arithmetic over the scale pattern, not
  array extension.
- **Rising** transposes the whole scale by semitones each repeat;
  **shifting** moves the start within the same scale; **chop head** drops
  one more leading note each pass (12345678, 2345678, ...). Mutually
  exclusive; rising and shifting imply repeat-forever, while chop head
  plays one shrinking cycle per repeat.
- **Ladder** replaces section-note traversal with overlapping fixed-size
  rungs shifting one degree per rung (123, 234, ...); **reverse** plays
  each rung against the travel so its first note is always new (321,
  432, ...). The ladder owns sequence generation, so it excludes chop
  head, exercises, and movement styles (both directions), but composes
  with rising. Boundary law: rung starts always walk the full range -
  terminal ends play out by clipping (678, 78, 8), mid-cycle turnarounds
  reflect over the peak (678, 787, 876), and a forever-no-gap up+down or
  down+up cycle is one seamless triangle whose loop seam reflects too
  (the seam gets the rung gap, not a cycle divider).
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

Books large files: IndexedDB (`voice-wei-books`), not localStorage. The Books
Log is DOM-only. The Music Log is persisted in its dedicated IndexedDB as
described under Music player durable history.

Scored practice persists via `progress-store.js` → `PRACTICE_PROGRESS`.

Books keeps large user files in browser IndexedDB (`voice-wei-books`), not
localStorage. The current schema uses five object stores:

- `books`: original upload Blob, title/author/format metadata, estimated
  duration, read/listen progress, generated coverage.
- `sections`: parsed book text sections keyed by book; EPUB/HTML sections also
  keep sanitized reader markup, with EPUB package images embedded as data URLs
  where possible.
- `segments`: internal API-sized audio parts with status, exact source offsets,
  estimated/decoded duration, and MP3 Blob.
- `history`: local read/listen events (play/pause, segment transitions, jumps,
  samples, per-day aggregation inputs).
- `research`: complete per-book AI Research request/results: source text,
  question, answer, citations, images, model/configuration, elapsed time, and
  whether speech was enabled at return.

This makes Books a browser-local reader/player/generator rather than a
one-shot converter: generation can stop after some audio parts, preserve completed
MP3s, and resume next session. Duration buttons (+15 min / +1 hour) extend from
the playhead and skip already-queued work so repeated presses enqueue further
ahead; failed parts in that range remain pending for retry. Interrupted
"generating" states are reset on book open. EPUB imports prefer official `nav`/NCX table of
contents labels, and PDF imports use outline entries when available, so
chapter-level controls can hide the part storage model during normal use.
Single hard-wrapped newlines are not generation boundaries; sentence-ending
punctuation (including closing quotes) is preferred below the API cap. TXT
chapter extraction keeps the final occurrence of duplicated chapter headings,
which removes contents-list duplicates before section assembly. Audio plan v2
marks upgraded books; rebuild atomically replaces book/section/part records and
maps listening by source character independently of reading progress. There is still no
account identity, analytics sink, or server-side audit trail. The durable
history is browser-local and serves navigation/progress UI. The OpenAI key and
TTS settings use `api-keys-store.js` and `StorageKeys.EBOOK_SETTINGS`. The
visible Log panel is DOM state only and is lost on refresh/navigation.

Books AI Research reuses `voice-command-core.js` for one-utterance speech
recognition and `voice-output.js` for optional spoken replies. The request
snapshot is the active audio-part ID plus its complete stored text; playback time
is not used to narrow or transcribe that text. The browser sends a direct
OpenAI Responses request using the same browser-local key as TTS, with required
web/image search. One request builder owns both the actual body and its UI
preview; the preview replaces only the separately shown source text with a
size-labeled placeholder, preventing prompt/configuration drift. Response
annotations become clickable citations/source links and image results become
source-linked cards. The whole record is committed to the `research` store
before optional speech starts. `VoiceOutput` exposes native boundary events so
Books can highlight the current answer sentence without generating audio;
sentence/paragraph/page buttons move the same explicit answer cursor.

Reading and listening positions are separate owners: only reader interaction
updates `readingSectionId` / `readingCharOffset`; playback updates
`listeningSegmentId` / `listeningOffsetSec`. Playback never calls
`scrollIntoView`; the sticky reader toolbar owns the only explicit jumps to
latest read or playing section.

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
| `PlaylistItem` (working playlist) | `createPlaylistItem` | monotonic runtime list id, source kind/label, runtime lyric state |
| Persisted playlist entry | `persistedPlaylistEntry` | source, **no runtime id or lyric runtime** |
| `FavoriteData` | `createFavorite` | `favoritedAt` |
| Known-song history record (IndexedDB) | `historySongRecord` | `firstSeenAt`/`lastSeenAt`, sourceKind |
| Versioned share parameter | `shareParameter` / `songFromShareParameter` | format version around one complete Song |

No player code hand-builds song-shaped objects. Direct YouTube candidates
become Songs through `songFromYouTubeCandidate`, which locally splits common
`Artist - Track` titles and otherwise uses channel/title. Songs enter the
playlist only through `appendPlaylistItem` / `appendPlaylistItems` (append,
render, lyric lookup). A new direct search (`searchDirectAndAddToPlaylist`) or
AI search (`searchAndAddToPlaylist` with `replaceExisting`) **replaces** the
working playlist, while explicit loads (favorites, history lookups, known
songs) append. Replacement loses
nothing: every song is recorded to the known-songs catalog when it is
added, so the working playlist is a matter of convenience over durable
data. Runtime row ids come from one monotonic allocator in `PlayerSongs`;
reload regenerates them, including for older saved entries that still carry
the retired `id` field.

The default request boundary is keyless: voice fallback, Enter, and Search pass
one raw term to `searchYouTubeCandidates`, then turn up to ten ranked proxy
results directly into playlist rows. `searchYouTube` is the one-result wrapper
used when an AI-selected named song or identity repair needs a single recording
plus same-song alternates. Ask AI alone calls `processMusicSearch`; missing
provider keys therefore cannot block or alter ordinary search.

A song share URL embeds that versioned Song directly in its `song` query
parameter. Opening it never searches for the recording: the exact `videoId`
enters through `createPlaylistItem` with source kind `share`, while lyrics use
the ordinary keyless LRCLIB path. Invalid or unknown-version payloads create
no partial song. A shared song appends when the receiving browser already has
a playlist and becomes the selected item without forcing autoplay.

`PlayerSongs.songFieldsMatchQuery` owns text-search semantics across the
playlist, Known Songs, and Local Song Library: each whitespace-separated query
word must occur somewhere in the fields that surface exposes. Text is
Unicode-normalized and case/diacritic-insensitive; apostrophe variants are
ignored and other punctuation becomes canonical word boundaries. Playlist and
Known Songs expose name, artist, year, and album to search; provenance fields
(`comment`, `searchTerm`, raw YouTube title/channel) cannot create invisible
matches. The local library supplies its visible title, source filename/type,
and imported lyric text; it does not duplicate the matching algorithm.

**Video identity changes have one owner.** `transitionVideoIdentity` is the
only operation allowed to replace a Song's `videoId`. It updates every live
playlist row on an equivalent recording; favorite repair updates only rows
whose normalized name and artist match that favorite's intended song. The
transition rekeys the favorite before refreshing its rows, preserves
`favoritedAt`, resets video-bound runtime state, persists playlist and
favorites, and records the replacement key in Known Songs. A retry candidate
must identify the requested named song before it can cross this boundary.
Lyrics and reports are not copied to the new key; each resolves from its own
`videoId` record.

Every video-bound asynchronous operation captures the `videoId` at flight
start. Its result may write or populate only that captured key and may update a
live item only while the item still has that identity. In-flight maps are also
cleaned by the captured key, so an identity transition cannot leak a flight or
apply an old lyric/report to the replacement video.

Saved favorites receive a targeted repair pass after playlist restoration. A
favorite whose stored YouTube title does not identify its non-empty named song
is searched again through the existing keyless path; valid favorites perform
no YouTube request. A successful repair uses the same identity transition, so
a restored playlist and favorite move together. Mismatched favorites skip
lyric reconciliation until repair, preventing wrong-video lyric state from
being created. When search confirms the existing video key, the transition
still refreshes stale raw title/channel metadata and schedules that now-valid
key for lyrics.

**Lyric state has one permanent owner: IndexedDB `lyricStates`, keyed by
videoId.** Each record is either `found` (carrying the LyricsResult) or
`none` with `checkedAt` - and `none` may ONLY be written by a provider
search that actually answered empty; failures (rate limit, network,
timeout) save nothing, so the song stays unresolved and the next
interaction retries. An optional `lyricOffsetSeconds` on the same record
is the user's permanent timing nudge for that video (positive = show
later lines / correct lyrics that are too slow; negative = show earlier
lines / correct lyrics that are too fast; absent or 0 = use the timed file
as-is). Re-searches preserve an existing offset. The write discipline is
save-then-activate: the store write is awaited first, then the live
playlist item is updated from that same record
(`resolveLyricState` -> `applyLyricStateToItem`). A live item is
therefore only ever 'ready' with data that came from or through the
store - there is no second source that can disagree with it. (An earlier
design kept a fuzzy artist/title-keyed cache in localStorage with alias
and miss maps; keying by videoId in IndexedDB replaced it, and the
`PLAYER_LYRICS_CACHE` localStorage key is retired.)

**Lyrics are never persisted per playlist item.** The persisted playlist
carries Songs only; `lyricsData`/`lyricsStatus` are runtime state
re-derived from `lyricStates`. (Persisting full lyrics per item is what
exceeded the localStorage quota at ~100 songs.)

**Every interaction verifies against the store.** Adding a song (search,
favorites, history, restore-at-load) queues its resolution; playing a
song or tapping its row chip resolves it immediately. Resolution runs as
one queued/in-flight job per videoId - duplicate rows, background
reconciliation, and direct play share that job. Store success or retryable
failure broadcasts to every current playlist row with the captured videoId;
an identity transition cannot receive the old completion. Every provider fetch
is bounded by a 12s timeout, so a lookup interrupted by a page suspension
always settles and can never wedge a song in 'loading'. Background resolution
keeps provider concurrency at two videos. LRCLIB requests use the keyless
same-origin `proxy.php` boundary; each video's alternate identity candidates
run serially so the two-video queue is also the real network/PHP-worker bound.
Tapping the chip on a stored `none` forces a fresh provider recheck; a stored
`none` also expires after 7 days.

**Library reconciliation is per song, on every load.**
`reconcileLibraryLyrics` queues every favorite for resolution before the
playlist restore; songs already resolved in the store settle from one
IndexedDB read with zero network, so the pass is idempotent and an
interrupted or failed recheck resumes on the next open by construction.
When identity rules advance, an older timed record that already passes the
new local title/artist gates is promoted to the current `searchVersion` by an
awaited store write, also with zero provider traffic. Older valid simple
records still make their one timed-upgrade request; the resulting current
simple record then obeys the seven-day TTL. Invalid old records and old `none`
records recheck through the provider.

**Timed lyrics first.** The two lyric kinds are named in every
user-facing surface: timed (line-synced) and simple (text only). The
LRCLIB record selection prefers a timed record over a simple-only one
only after title identity and, when known, artist identity pass independent
minimums; duration can rank matching records but cannot compensate for a
different song or artist. Provider lookup uses artist + title without album,
because edition and compilation album metadata must not hide a valid lyric
record. Candidate identities are searched serially to preserve the real
two-request network bound. Search stops early only when one complete provider
answer contains timed lyrics with exact normalized title/artist identity and a
combined identity/duration score of at least 0.98; otherwise every candidate is
searched, preserving recall. Every stored result carries the `searchVersion`.
A valid stored result survives an empty revalidation, while an invalid stale
result cannot become final under the new version.

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
  query; consulted when live Piped/Invidious search fails.
- `favoriteEvents`: an append-only audit of favorite toggles.
- `lyricStates`: per-song lyric state keyed by videoId - the single
  permanent owner of lyrics and of any per-song `lyricOffsetSeconds`
  timing nudge (see "Lyric state has one permanent owner" above).
- `songReports`: the latest researched listening companion per `videoId`,
  including the exact prompt, provider/model, full prose, and <=50-character
  display lines. Regeneration replaces that song's prior report; replay reads
  the saved report without another API call.
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
per-song reports, and imported library songs. No concept is authoritative in two stores
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
that mirror the library - `songs`, `lyricStates`, `songReports` - and the re-fetchable
`youtubeSearches` cache have NO cap: trimming a library store would mean
silent partial coverage (some songs with state, some without), and the
library itself is their natural bound. IndexedDB quota is GB-scale;
record counts are not the risk.

The Music Log DOM is a current-session projection, not an automatic replay of
the store. Opening the panel performs no database read. **Show Previous**
explicitly reads the whole capped `logs` store, filters out records from the
current page session, and prepends the remaining records once. This keeps the
ordinary diagnostic view relevant while preserving access to all retained
history.

Song-report generation has one provider-independent boundary:
`requestSongReportResearch(prompt)` returns `{ text, provider, model }`.
Provider-specific response envelopes are logged in full and normalized at that
boundary. The prompt assigns reporting, not authorship: claims and
interpretations must be traceable to researched material, sourced
ideas appear in display notes without attribution, and the model is forbidden
to supply its own analysis, motives, connections, embellishment, or stylistic
filler. Display notes also exclude raw URLs, song and album titles, release
dates and years, record labels, publication names, and critic names. Source
attribution is isolated in a final `attributions` list that is retained only
in the raw research response. Distinctive lyric words, phrases, places, terms,
people, objects, events, and ideas may launch separate sourced research even
when the source does not analyze the song. The prompt reproduces George
Orwell's six writing rules verbatim and applies them to every note. A separate
plain-language rule forbids music, critical, journalistic, and insider slang
or an affected persona. The request resolves the song's lyrics through
`ensureLyricsForItem` first, numbers timed lyric lines in the prompt, and
requires JSON output: `lyricNotes` keyed to those line numbers plus
`generalNotes`, followed by `attributions`, quoting lyric words only from the
provided lyrics (no quoting is permitted when none were provided).
`parseSongReportResponse` converts that JSON into
`SongReportEntry` records - a note keyed to a valid line number carries that
line's sung time; everything else is untimed. Before an entry exists,
`sanitizeSongReportNote` enforces the no-citation display contract at the
parse boundary: markdown links keep only their visible words, bare URLs,
domains, and numeric citation markers are stripped, and a note left under
twenty characters by that cleaning is dropped from display (the stored raw
response retains the full material). `songReportSchedule` owns
playback timing: anchored notes at their absolute sung moments, untimed notes
at the midpoints of the largest remaining gaps (or interval-advanced from the
anchor when nothing is anchored), with over-budget notes wrapped by
`segmentSongReport` into consecutive interval-spaced segments. Consecutive
notes are separated by a 0.2-second blank on the in-page second line only;
the Media Session relay never carries the blank. Records saved before timed
notes migrate to untimed entries on load. The raw response and parsed entries
are saved together before Report mode activates. A missing report is
therefore not a disabled state: selecting Song Report checks IndexedDB,
requests only if absent, and displays the send/wait/result lifecycle with
elapsed time. Every transition is written through the durable Music Log path.

## External resilience vs. internal fallbacks

The anti-fallback rule (`.cursor/rules/00-absolute-rules.mdc`) forbids
downstream alternatives for things we control: no "try multiple mechanisms and
hope", no parallel code paths for one job, no retry loops where one
deterministic path belongs. That rule is about systems we own.

It does **not** forbid resilience against genuinely external, flaky services we
do not control. The server tries independent Piped instances, then independent
Invidious instances; `searchYouTube` consults the IndexedDB search cache if all
external providers fail. This recovery uses our own recorded data and is
surfaced explicitly in the log ("Search Cache"), not swallowed.

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
`Object.assign(controller, ...)` (commands, playlist, lyrics, song-report,
song-library, history-ui). All of these are `@ts-check`, not `@ts-nocheck`: each install
wraps its method object in `/** @type {ThisType<VoiceMusicController>} */` so
`this` is the controller type inside every method, and the controller's full
surface is declared in `types/player.d.ts` (merged with the `class`). Playback
state is the one piece that is a real owned object, not a mixin: `PlaybackState`
(`player-playback-state.js`) holds all playback status and is reached through
`controller.playback` plus thin installed accessors. Adding a method to a player
module means adding it to the `VoiceMusicController` interface; the typecheck
gate enforces this.

## Testing

`npm test` is the whole gate: every suite, every product, one command,
about 13 seconds wall. There are no fast/full profiles. The runner
(`tests/run-all.js`) executes the startup-timing suite alone first (its
wall-clock budget must not share CPUs), then drains the rest through a
bounded worker pool (`TEST_WORKERS`, default 6), longest suites first, and
prints per-suite times plus the slowest three.

Suites are product-scoped, extracted from the retired tab-functions
monolith: `test-scales-trace`, `test-phrases`, `test-intervals-pitch`,
`test-player-live`, `test-player-search`, `test-player-playlist`,
`test-player-report`, plus the standing `test-books`, `test-controls`,
`test-playback-engine`, `test-staff-view`, `test-staff-page`, `test-pages-load`,
`test-player-startup`, `test-player-lifecycle`, `test-syntax`, and
`test-css-ownership`. Use `node tests/run-all.js --suite <file>` for one
suite while iterating.

Two disciplines keep the gate fast and honest:

- **No fixed sleeps where state is observable.** Tests wait on explicit
  signals - `window.__voiceWeiStartup.ready`, page debug handles
  (`phrasesDebug`, `traceDebug`, `intervalsDebug`, `pitchMeter`),
  `window.__voiceStarts` / `window.__trace` voice instrumentation,
  Media Session transport state, DOM text/classes, and store contents
  (`PRACTICE_PROGRESS`, settings keys) - never wall-clock pads. Where a
  test configures note/gap durations and its assertions are structural
  (counts, ordering, persistence), it configures short durations.
- **No external network.** `tests/helpers.js` transparently serves every
  Salamander piano-sample request as a locally generated silent WAV on all
  pages and contexts, so the gate cannot flake on CDN availability.

One suite is deliberately outside every profile:
`node tests/audit-search-live.js` runs real songs through the REAL search
pipeline - `proxy.php` against live Piped/Invidious, the studio-version
ranking, and the LRCLIB lyric matcher - and prints the pick, runner-up,
surviving alternates, and matched lyric record per song (Fleet Foxes'
first two albums by default; pass `"Artist - Song"` arguments or
`PROXY_BASE=` for other cases). It needs the local PHP server
(`php -S 127.0.0.1:8000`) and the network, so it never runs in CI; use it
when investigating wrong-version or wrong-lyrics reports. `npm run lint` (ast-grep, including the ownership guards),
`npm run typecheck` (checkJs), and `npm test` must stay clean - **zero errors,
no tolerated baseline**. These run as gates in the deploy workflow; any failure
blocks the push from reaching the live site.

## Deploy

Push to master (when not paths-ignored for docs/rules-only) → GitHub Actions
rsyncs `--delete` to production immediately (~15s to live, verified against
the shipped `VERSION`); a parallel `validate` job re-runs typecheck, lint,
and the full test gate after the site is live, and a red run means fix
forward now. Agents run the local gate before pushing. For user-facing
ships, run `./bump-version.sh` once in the same push so reload shows a new
header/`?v=` build. Skip bumps for docs/tests-only commits; never push
bump-only commits. Full rules: `.cursor/rules/10-deploy-workflow.mdc`.
Manual deploy: `./deploy.sh`.

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
4. **Labels live inside the shell of the control they explain.** A
   stepper or labeled segment row carries a `step-label` as its first
   child, inside the border, so the label can never wrap away from its
   control. External `vf-label`s remain only for rows that introduce a
   free-standing control (text inputs, toggle clusters) and reserve no
   column width. Every page is converted; the external-label stepper
   dialect (`step-field-bare`) is retired and test-blocked.
5. **Controls size to their content at every viewport width.** No fixed
   column widths inside steppers, no reserved label columns, no
   per-breakpoint stretch-to-fill rules. Rows are flex-wrap containers
   with a uniform gap; a narrow screen wraps units, it never reshapes
   them.
6. **Corner radii come from the three-token scale** in style.css
   (`--radius-control` 4px for chips/buttons/values/toggles,
   `--radius-group` 6px for bounded shells and inputs, `--radius-card`
   10px for cards/panels/docks). No pill (999px) corners and no per-
   control radius choices.

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

1. **Timing** - note length, then gap (Key may sit on this same stepper
   row when the page clusters numeric choosers, as Phrases and Scales do)
2. **Key** - the root-pitch stepper (own row only when not clustered above;
   user-facing label is always "Key", never mixed with "Root")
3. **Shape** - the page's own pattern settings. On Scales, section width
   comes first (define the range), then direction/movement/repeat/exercise.
4. **Output/display options** - output mode chips, display toggles
5. **Scale type** - the scale chip row
6. **Actions** - reset/random rows close the block

A page may omit groups it doesn't have, but never reorders the ones it
shares. Page-unique surfaces that are not settings (scales' piano, the
phrase stage) sit outside this order.

**Pitch Test / Sing** is not transport. It is a fixed bottom dock
(`.pitch-test-dock`) that opens and closes independently of Play/Stop/Next.
Transport rows hold playback only.

## Deliberately distinct surfaces

Gameplay surfaces that are not settings controls and intentionally keep
their own look: ears' answer grid and interval multi-select, scales'
piano keyboard, the player's media transport bar and lyrics overlay,
and the ebook reader surface (page text, TOC, and its dynamic
voice/model selects - Books' buttons use the shared vocabulary).

## Known deliberate gaps

- New gaps must be listed here with their reasoning, or fixed.
