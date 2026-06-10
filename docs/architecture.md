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
ears.html/js/css         # Interval ear training
player.html + player.js  # AI music player
ebook.html/js/css        # Ebook to audiobook
```

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
| `settings-store.js` | Per-tab settings persistence (typed-merge restore) | - |
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

Every practice page persists its full settings under one localStorage key
(`scales-settings`, `intervals-settings`, `phrases-settings`,
`trace-settings`, `pitch-meter-settings`, `ears-settings` + `ears-stats`,
panel options under `*-test-panel` / `*-sing-panel`). `settings-store.js`
restores only keys whose stored type matches the default, so stale entries
cannot corrupt state. JSON cannot store Infinity: scales' repeat-forever
round-trips as -1.

Scored practice persists separately: every completed take (pitch test
panel) or session (pitch meter) appends to the `practice-progress` list
(capped at 1000 entries) via `progress-store.js`, which renders per-day
trend lines.

## Testing

`npm test` runs the headless suite in `tests/` (page loads, playback law,
shared controls + persistence, per-tab functions; fake mic for listening
tests). `npm run lint` (ast-grep, including the ownership guards) and
`npm run typecheck` (checkJs) must stay clean - errors in `player.js` /
`ebook.js` are a known pre-existing baseline.

## Deploy

Push to master -> GitHub Actions rsyncs to production (`--delete`; docs,
tests, tooling excluded). `./bump-version.sh` updates the VERSION file, the
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
- **Small exclusive set** (mode, direction, type, repeat...): segment-row
  of vf-btn pills.
- **Large named set** (scale types, output modes, presets): plain vf-btn
  chip row.
- **On/off**: display-toggle chip checkbox.
- **Multi-select** (Ears interval grid): vf multi-select chips - the only
  multi-value picker, and deliberately distinct.

The only remaining `<select>` is the Scales TTS voice list (dynamic,
OS-dependent, dozens of entries - a genuinely different picker).

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

## Deliberately distinct surfaces

Gameplay surfaces that are not settings controls and intentionally keep
their own look: ears' answer grid and interval multi-select, scales'
piano keyboard, the player's media transport bar and lyrics overlay,
and the ebook reader (a separate non-music tool with its own selects).

## Known deliberate gaps

- New gaps must be listed here with their reasoning, or fixed.
