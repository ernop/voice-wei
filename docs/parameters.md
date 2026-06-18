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

## Shared step presets

The root, note-length, and gap steppers are one control each, with one
preset list each, owned by `practice-controls.js` and identical on every
page that shows them:

| Picker | Presets |
|--------|---------|
| root pitch | semitone steps, C2..B5 (MIDI 36..83) |
| noteLengthMs | 100, 150, 200, 250, 300, 350, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 3000, 5000 |
| gapMs | -50%, -10%, -5%, 0, 50, 100, 150, 250, 300, 500, 1000, 1500, 2000, 3000, 5000 |

Negative gap presets are overlap ratios of the note length (-50% starts
the next note halfway through the current one); they display as
percentages. `PracticeControls.effectiveGapMs()` resolves a gap preset to
milliseconds; pages never reinterpret the values themselves. Where a gap
separates patterns rather than notes (intervals), overlap presets resolve
to "no pause". The ears range-center stepper is a different picker (it
chooses a question range, not a root) and keeps its own range.

## Phrases (`phrases-settings`)

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| root | D# | C..B chromatic | reproject |
| octave | 3 | via root stepper (shared C2-B5) | reproject |
| scaleType | major | major, minor, chromatic, pentatonic, h minor, m minor | reproject |
| phraseAlgo | arch | balanced, random, stepwise, leapy, arch, motif | bounds-next |
| startAtOne | true | start at 1 / random start | bounds-next |
| rangeMode | within | in octave / just over / out octave | bounds-next |
| chromaticRuns | false | toggle - sometimes pass through the chromatic note between whole-step degrees (4 #4 5 up, 6 b6 5 down); only where such a note exists | bounds-next |
| minLength | 5 | 2..16 list | bounds-next |
| maxLength | 8 | 3..50 list | bounds-next |
| returnToInitial | true | return to 1 / no return | regenerate |
| returnToRoot | false | (not in UI) | regenerate |
| hearTones | true | toggle | redraw |
| hearSpeech | false | toggle | redraw |
| singNumbers | false | toggle | redraw |
| showStaff | true | toggle | redraw |
| breakdownEnabled | false | toggle | immediate (mask only) |
| autoStep | false | toggle | immediate (preference) |
| playOnStep | false | toggle | immediate (preference) |
| noteLengthMs | 300 | shared note-length list | replay |
| gapMs | 0 | shared gap list | replay |
| showNoteNames | true | toggle | redraw |
| fillMode | none | off / full fill / 1358 fill | redraw |
| loopCurrent | false | Repeat button | immediate (preference only; does not start/stop audio) |

Range modes: "in octave" keeps degrees 1-8; "just over" allows two degrees
past each end (down to 6 of the octave below, up to 3 of the octave above
for seven-note scales); "out octave" allows half an octave below to two
octaves up.

Algorithm modes choose the interior melodic behavior while start and return
settings stay independent as anchors. "Arch" is the default because it gives
new phrases a higher-level contour and midpoint climax; "balanced" is the
original clustered random walk; "random" samples freely inside the range;
"stepwise" emphasizes conjunct motion; "leapy" emphasizes disjunct motion with
contrary-step compensation; "motif" repeats and varies a short contour cell.
No generator emits the same note twice in a row - immediate repetition reads
as a stutter; repeats only come from deliberate anchors.

Actions (not persisted): Reflect (reproject of the current phrase around the
octave), per-note on/off mask, add note (advance breakdown pass). The mask is
`immediate` for display; tone and sing playback read it live. Spoken output
reads the mask once when a play cycle starts. Repeat is a preference only:
toggling it does not start or stop audio. Play on step controls whether add
note (or auto step after a cycle) triggers playback. Fill notes are audible
only between adjacent enabled phrase notes, never across breakdown gaps.

## Trace (`trace-settings`)

Changing any key/guide setting also resets the trace (the chart is only
meaningful for one configuration).

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| root / octave | D#3 | root pitch stepper (shared C2-B5) | redraw + trace reset |
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
| root + octave | C4 (root pitch stepper, shared C2-B5) | live-restart |
| scaleType | major | live-restart |
| direction | ascending | live-restart |
| noteLengthMs | 300 (shared note-length list) | live-restart |
| gapMs | 0 (shared gap list; negative = overlap ratio) | live-restart |
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
| root + octave | C4 (root pitch stepper, shared C2-B5) | next-round |
| scale | major | next-round |
| lengthMs | 600 (shared note-length list) | next-round |
| gapMs | 2000 (shared gap list; gap between patterns) | next-round |
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
| rootNote + octave | C4 | root pitch stepper (shared C2-B5) | immediate (redraws targets) |
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

## Books (`ebookSettings`, API key in `openaiApiKey`, library in IndexedDB)

Books persists TTS preferences and the OpenAI API key in browser localStorage.
Large book data is stored in IndexedDB (`voice-wei-books`): original upload
Blobs, parsed book-section records, sanitized EPUB/HTML reader markup, planned
TTS text segments, generated MP3 segment Blobs, read/listen progress, and local
history events. The visible Log panel is page-session state and is cleared on
reload. Books requests persistent browser storage automatically where
supported.

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| voice | alloy | alloy, echo, fable, onyx, nova, shimmer | immediate for the next preview/conversion request |
| model | tts-1 | tts-1, tts-1-hd | immediate for the next preview/conversion request |
| speed | 1.0 | 0.25..4.0 in 0.25 steps | immediate for the next preview/conversion request |

Actions: import creates a saved book plus section and segment records; Generate
next 15 min / next hour / current section / all remaining updates individual
segment records as each MP3 finishes; Cancel preserves completed segments and
leaves the rest pending/error; custom playback controls update listening and
reading progress and write local history events for play/pause, segment
changes, jumps, and position samples; auto-generate-ahead can generate more
pending segments while listening.
Download original / current segment / all segment MP3s / combined MP3 export
saved blobs; Delete segment MP3 / Delete all MP3s clear generated audio without
removing the original; Delete book removes the browser-local book, sections,
and segments. The visible Log is page-local DOM state only; it is not a durable
usage record.

## Pitch test panel (shared component)

Per page key (`phrases-test-panel`, `scales-sing-panel`,
`intervals-sing-panel`).

| Option | Default | Behavior |
|--------|---------|----------|
| showTargets | true | redraw |
| pauseOnSilence | true | immediate + trace reset |
| fixedWindow | false | redraw |
| expandRange | false | redraw |

The panel NEVER auto-plays: the test exists for the user to sing, so
opening or restarting it only resets the trace and starts listening.
"Play Guide" is an explicit button (top action row, next to Restart)
that plays the enabled targets in the current key. The action row sits
at the very top of the panel, above the titles.
