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

Pages must consume these instead of carrying their own copies; three of
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
| `media-session-core.js` | Hardware media keys (silent-WAV trick + action maps) | - |
| `pattern-practice-core.js` | Scale-degree offset and phrase math | - |
| `music-constants.js` | Note math, scale patterns, frequency conversion | - |
| `voice-command-core.js` | Speech recognition, auto/manual modes, spoken "submit", transcript UI | yes (webkitSpeechRecognition) |
| `history-list.js` | Capped newest-first history lists (pages provide renderItem) | - |
| `shared-header.js` | Site header, nav, version label | - |

CSS: `style.css` (global shell) -> `practice-controls.css` (shared
primitives: vf-btn chips, step fields, segment rows, display toggles,
transport buttons, history lists, pitch-test panel) -> one page stylesheet.
Page CSS may override primitives; never the reverse.

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

`pitch-detect-core.js`: getUserMedia -> AnalyserNode (fft 2048) ->
autocorrelation with parabolic interpolation -> glitch filter (jumps >5.5
midi within 220ms need a confirming sample; out-of-range detections are
discarded via per-page outlier gates) -> voice-gated clock (time advances
only while singing when pause-on-silence is on). The trace line breaks
across gaps >250ms.

Consumers: the Trace page directly; Phrases, Scales, and Intervals through
`pitch-test-panel.js`; pitch-meter through the same session plus its own
scoring; ears through low-level `createMicCapture` for its hold-detection
loops.

Media keys: phrases, scales, intervals, and ears register hardware
play/pause/next handlers (`media-session-core.js`). Trace and pitch-meter
deliberately do not - they are watch-the-screen tools where hardware keys
add nothing.

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
| `PLAYER_PLAYLIST` | Music playlist + current index |
| `PLAYER_FAVORITES` | Favorited tracks |
| `PLAYER_LYRICS_CACHE` | Resolved lyrics records |
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

### Music player durable history (`voice-wei-music`)

The music player keeps unbounded/historical data in its own IndexedDB
(`voice-wei-music`), owned solely by `player-history-db.js`. Page/engine code
never touches this DB directly. Stores:

- `logs`: every in-app log line (append-only).
- `lookups`: each natural-language music request and its resulting song list.
- `songs`: the known-songs catalog, keyed by `videoId` (upsert on re-seeing).
- `youtubeSearches`: the search-term -> results cache, keyed by normalized
  query; consulted as a fallback when the live proxy search fails.
- `favoriteEvents`: an append-only audit of favorite toggles.

Store-by-lifetime is the dividing law (persistence principle P1):
**localStorage** owns small, synchronous, boot-time state - settings,
lyrics-view prefs, API keys, the live playlist + index, and the
**authoritative favorites set** (`PLAYER_FAVORITES`). **IndexedDB** owns the
unbounded/historical data above. No concept is authoritative in two stores
(P2): favorites live in localStorage; `favoriteEvents` is history only, never
read back as the source of truth. (An earlier schema also mirrored favorites
into a `favorites` object store; database version 2 deletes it on upgrade.)

Every store is bounded by policy and trimmed loudly (P3): each has a record
cap (`logs`/`songs`/`favoriteEvents` 5000, `lookups`/`youtubeSearches` 2000).
On nearing 90% the player posts a one-time "History storage" notice via the
log panel; past the cap the oldest records are trimmed (lowest primary key for
append-only stores, lowest time-index value for keyed stores). "Permanent"
means kept until the user is warned and the oldest entries are trimmed.

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
   Pages embedding the panel must treat open Test/Sing mode as exclusive:
   page-level playback routes, hardware/media-session actions, and delayed
   setting replays must not start page playback under the panel. The panel's
   explicit guide button is the sole permitted automatic-target sound while
   the user is there to sing. On Phrases this is enforced by a central
   playback gate (`runPhrasePlayback`) plus the page-owned MIDI boundary
   (`playMidi`); new Phrases playback actions must go through that gate, not
   add one-off Test checks at the button handler.
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
- **Text fields**: `text-input` base look; pages may size (width,
  font-size, resize), never re-skin.
- **Selected state**: `.selected`, everywhere. No `.active` dialects.

Page stylesheets may add layout (placement, sizing) on top of these but
must not redefine their look. `tests/test-css-ownership.js` fails the
suite if a page stylesheet redefines a selector owned by
practice-controls.css.

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
and the ebook reader (a separate non-music tool with its own selects).

## Known deliberate gaps

- New gaps must be listed here with their reasoning, or fixed.
