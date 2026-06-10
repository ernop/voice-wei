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
| `voice-command-core.js` | Speech recognition + transcript UI | - |
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

Consumers: the Trace page directly; Phrases and Scales through
`pitch-test-panel.js`; pitch-meter through the same session plus its own
scoring; ears through low-level `createMicCapture` for its hold-detection
loops.

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

## Known deliberate gaps

- Ears' interval multi-select grid and range slider are custom (no shared
  multi-select/slider primitive yet); its visual dialect predates the
  shared controls.
- History list rendering is per-page (phrases, scales, intervals, ears).
- Sing targets follow the scale/movement plan and ignore active exercises.
- `player.js` has its own speech recognition stack and settings UI
  (predates `voice-command-core.js`).
