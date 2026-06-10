# Parameter Definitions

Single source of truth for every user-facing setting on every page: what it
means, its default, and exactly what happens when it changes. No page may
invent a new change behavior; every setting picks one from the vocabulary
below and is listed here. When adding a setting, add its row in the same
change.

## Change-behavior vocabulary

| Behavior | Meaning |
|----------|---------|
| `bounds-next` | Constrains only the NEXT generated item. Current content untouched, nothing replays. |
| `reproject` | Current content is kept and re-expressed in the new context (e.g. same degrees, new key), then replayed if something was generated. |
| `regenerate` | Current content is discarded and regenerated (no auto-play). |
| `replay` | Current content kept; replayed with the new sound settings. |
| `redraw` | Display refresh only; no audio. |
| `live-restart` | If playing, stop and restart playback with the new settings; if idle, just store. |
| `next-round` | Takes effect when the running loop generates its next item (or the next question/session starts). |
| `immediate` | Applies instantly to the running feature (listening view, output toggles). |

## Playback law

Old-settings audio never overlaps new-settings audio. `piano-core.js` is a
voice engine: every sounding voice is registered with its own gain;
`stopAll()` kills each voice with a 20ms declick fade and `activeVoices()`
reports exactly what is sounding. Stopping is real voice control - never a
master-output mute.

## Phrases (`phrases-settings`)

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| root | D# | C..B chromatic | reproject |
| octave | 3 | via root stepper (C2-B4) | reproject |
| scaleType | major | major, minor, chromatic, pentatonic, h minor, m minor | reproject |
| startAtOne | true | start at 1 / random start | bounds-next |
| rangeMode | within | in octave / just over / out octave | bounds-next |
| minLength | 5 | 2..16 list | bounds-next |
| maxLength | 8 | 3..50 list | bounds-next |
| returnToInitial | true | return to 1 / no return | regenerate |
| returnToRoot | false | (not in UI) | regenerate |
| outputMode | tones | display, speak, tones, speak_tones, sing_numbers, none | replay |
| noteLengthMs | 300 | 200..1600 list | replay |
| gapMs | 0 | 0, 100, 250, 500 | replay |
| showNoteNames | true | toggle | redraw |

Range modes: "in octave" keeps degrees 1-8; "just over" allows two degrees
past each end (down to 6 of the octave below, up to 3 of the octave above
for seven-note scales); "out octave" allows half an octave below to two
octaves up.

Actions (not persisted): Reflect (reproject of the current phrase around the
octave), Repeat loop, per-note on/off mask.

## Trace (`trace-settings`)

Changing any key/guide setting also resets the trace (the chart is only
meaningful for one configuration).

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| root / octave | D#3 | stepper (C2-B4) | redraw + trace reset |
| scaleType | major | six scales | redraw + trace reset |
| guideIntervalMs | 1000 | 500..3000 list | redraw + trace reset |
| guideSound | piano | piano / beep | immediate (next guide tone) |
| patternText | empty | degree string | redraw |
| playGuidesOnReset | false | toggle | immediate |
| pauseOnSilence | true | toggle | immediate + trace reset |
| fixedWindow | false | toggle | redraw |
| expandRange | false | toggle | redraw |

## Scales (`scales-settings`)

All settings are `live-restart`. Voice commands first reset every setting to
its default, then apply the spoken modifiers.

| Setting | Default | Behavior |
|---------|---------|----------|
| root + octave | C4 (root pitch stepper, C2-B5) | live-restart |
| scaleType | major | live-restart |
| direction | ascending | live-restart |
| noteLengthMs | 300 | live-restart |
| gapMs | 0 (negative = overlap ratio) | live-restart |
| repeatCount | 1 (Infinity = forever) | live-restart |
| repeatGapMs | 1000 | live-restart |
| risingSemitones | 0 (forces forever when > 0) | live-restart |
| shiftingSteps | 0 (forces forever when > 0; excludes rising) | live-restart |
| movementStyle | normal | live-restart |
| rangeExpansion | 0 | live-restart |
| octaveSpan | 1 | live-restart |
| sectionLength | 1o | live-restart |
| exercise | none | live-restart |

UI preferences (separate keys): presets (`scales-presets-v1`), instruction
dismissed, show sequence, abbreviations.

## Intervals (`intervals-settings`)

The play loop reads settings when it generates each pattern.

| Setting | Default | Behavior |
|---------|---------|----------|
| exerciseType | A | next-round |
| selectedLevel | a1 | next-round |
| root + octave | C4 (root pitch stepper, C2-B5) | next-round |
| scale | major | next-round |
| lengthMs | 600 | next-round |
| gapMs | 2000 | next-round |
| expandRange | false | next-round |
| reverse | false | next-round |
| repeat | false | immediate (keeps or rolls the pattern) |
| speakNumbers | true | immediate |
| playNotes | true | immediate |
| showNoteNames | true | immediate |

## Pitch Meter (`pitch-meter-settings`)

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| mode | call-response | free / call-response / play-along segment row | next-round (next session) |
| responseTime | 2s | 1..5s stepper | next-round |
| instrument | voice | voice / violin / bass segment row | immediate (sets octave preset, redraws targets) |
| rootNote + octave | C4 | root pitch stepper (C2-B5) | immediate (redraws targets) |
| scaleType | major | major, minor, chromatic, pentatonic, blues | immediate (redraws targets) |

## Ears (`ears-settings`, lifetime stats in `ears-stats`)

| Setting | Default | Behavior |
|---------|---------|----------|
| mode | identify | next-round |
| direction | ascending | next-round |
| enabledIntervals | all 12 | next-round |
| adaptiveMode | true | next-round |
| drivingMode | false | immediate (TTS feedback) |
| autoAdvance | false | immediate |
| rootRangeMid | 48 (C3, range-center stepper C2-C5) | next-round |

Drone test: note stepper (C3-C5) applies on Start.

## Pitch test panel (shared component)

Per page key (`phrases-test-panel`, `scales-sing-panel`,
`intervals-sing-panel`).

| Option | Default | Behavior |
|--------|---------|----------|
| showTargets | true | redraw |
| playOnRestart | false (phrases: true - the test guide anchors the key) | immediate (next restart) |
| pauseOnSilence | true | immediate + trace reset |
| fixedWindow | false | redraw |
| expandRange | false | redraw |
