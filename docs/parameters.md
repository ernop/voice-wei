# Parameter Definitions

Single source of truth for every user-facing setting on every page: what it
means, its default, and exactly what happens when it changes. No page may
invent a new change behavior; every setting picks one from the vocabulary
below and is listed here. When adding a setting, add its row in the same
change. (What each tool does is in [tools.md](tools.md); how settings
persist is in [architecture.md](architecture.md) "Persistence".)

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
| phraseStyle | free | free, staff, sight, barbershop, genre | bounds-next |
| phraseLesson | free_open | style-specific lesson buttons | bounds-next |
| phraseAlgo | arch | balanced, random, stepwise, leapy, arch, motif | bounds-next |
| startAtOne | true | start at 1 / random start | bounds-next |
| rangeLow | 0 (degree 1) | Range Low stepper, one degree per step | bounds-next |
| rangeHigh | 7 (degree 8) | Range High stepper, one degree per step | bounds-next |
| chromaticRuns | false | toggle - sometimes pass through the chromatic note between whole-step degrees (4 #4 5 up, 6 b6 5 down); only where such a note exists | bounds-next |
| minLength | 5 | 2..12, 14, 16 list | bounds-next |
| maxLength | 8 | 3..12, 14, 16, then smaller long-phrase steps to 50 | bounds-next |
| returnToInitial | true | return to 1 / no return | regenerate |
| returnToRoot | false | (not in UI) | regenerate |
| hearTones | true | toggle | redraw |
| hearSpeech | false | toggle | redraw |
| singNumbers | false | toggle | redraw |
| showStaff | true | toggle | redraw |
| breakdownEnabled | false | toggle | immediate (mask only) |
| autoStep | false | toggle | immediate (preference) |
| playOnStep | false | toggle | immediate (preference) |
| playOnNext | true | toggle - when off, Next generates and shows the phrase silently (work it out first, then press Play) | immediate (preference) |
| noteLengthMs | 300 | shared note-length list | replay |
| gapMs | 0 | shared gap list | replay |
| showNoteNames | true | toggle | redraw |
| fillMode | none | off / full fill / 1358 fill | redraw |
| loopCurrent | false | Repeat button | immediate (preference only; does not start/stop audio) |
| seriesText | '' | last successfully loaded Series input text | convenience only (restores the input on reload) |
| lessonLockedKeys | [] | setting-key array | UI marker only |

Range endpoints: the two steppers move the lower and upper ends of the
degree palette phrases are built from, one scale degree per step, stored
as scale offsets (0 = degree 1, degrees-per-octave = degree 8). Default
1..8 (the octave). The low endpoint descends below unison (down to the 1
an octave below, shown with the down-arrow degree labels, e.g. "6↓");
the high endpoint climbs past the octave (up to two octaves, "2↑"
style) or drops below 8 to shrink the palette (high 7 = degrees 1-7
only, excluding the octave). The endpoints can never cross. One owner
resolves and clamps them: `rangeBounds` / `phraseRangeLimits` in
pattern-practice-core.js. The endpoints are the degree WORKSPACE, and
every surface reads the same two state values: the generator draws notes
from them and the test chart draws its rails across them (the take can
only widen the rails - a replayed or reflected phrase may hold notes
from outside the current palette, and notes on screen always sit on
rails).

Phrase style chooses the pedagogy: "free" uses the older motion algorithms;
"staff" focuses on beginner staff-reading shapes (steps, skips, landmarks);
"sight" focuses on progressive vocal sight-singing degree sets; "barbershop"
focuses on chord-tone functions; "genre" applies broader melodic studies such
as folk/hymn, pop hook, theatre, jazz, gospel, classical sequence,
fingerpicked folk, Beatles-style compact hooks, Simon/Garfunkel-style folk
contours, modal folk, calypso, norteño, cantopop, klezmer, and modal/minor
color. Algorithm modes still choose the interior melodic behavior in "free":
"arch" gives a phrase-level contour and midpoint
climax; "balanced" is the original clustered random walk; "random" samples
freely; "stepwise" emphasizes conjunct motion; "leapy" emphasizes disjunct
motion with contrary-step compensation; "motif" repeats and varies a short
contour cell. No generator emits the same note twice in a row - immediate
repetition reads as a stutter; repeats only come from deliberate anchors.

The tonic anchors outrank lesson palettes at the phrase edges: with
"start at 1" on, degree-set lessons seed on degree 1 even when the
palette excludes it (e.g. barbershop dominant/sevenths), and "return to
1" appends degree 1 at the end the same way. The palette governs
everything between the anchors. Both anchors exist to make the phrase
easier to pitch, so they always mean literal degree 1.

Selecting a style or lesson applies its preset defaults and records those
setting names in `lessonLockedKeys`. The lock is soft: it marks which controls
the lesson currently owns, but clicking one of those controls removes that key
from the lock list and keeps the user's override. Choosing any high-level
style or lesson again reapplies that preset and resets the relevant locks.
Fill modes are intentionally outside lesson presets: styles never turn on or
lock `full fill` / `1358 fill`, because those are playback modifiers rather
than genre or pedagogy choices.

Actions (not persisted): Reflect (reproject of the current phrase around the
octave), per-note on/off mask, add note (advance breakdown pass), and Series
Set (parse the typed degree series - `parseDegreeSeries` in
pattern-practice-core.js - and load it as the current phrase; honors
playOnNext, joins history; parse errors show under the input and change
nothing). The mask is
`immediate` for display; tone and sing playback read it live. Spoken output
reads the mask once when a play cycle starts. Repeat is a preference only:
toggling it does not start or stop audio. Play on step controls whether add
note (or auto step after a cycle) triggers playback. Fill notes are audible
only between adjacent enabled phrase notes, never across breakdown gaps.

Phrase Test coexists with playback (owner-directed reversal of the
earlier exclusive-mode rule): while Test is open and listening, Play,
Next, history replay, per-note play buttons, and hardware/media keys all
work normally, so the user can hear notes and sing against them in one
take. Entering Test still stops the transport (a take starts from
silence), the panel itself never auto-plays, and Stop stops sound
without closing the panel. Generating or switching phrases while the
panel is open restarts the take for the new phrase (same targets on
screen and under the score). Note the physics: the microphone hears the
speakers, so played piano appears in the trace - the chart shows what
reaches the mic.

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
| chopHead | 0 (excludes rising/shifting/exercise/movement; each pass drops the leading note) | live-restart |
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

## Music player (`PLAYER_SETTINGS`, lyrics view in `PLAYER_LYRICS_VIEW`)

All player settings are `immediate`: they apply to the next request,
playback update, or lyric render without replaying anything.

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| aiProvider | claude | claude / openai segment row | immediate (next request; shows that provider's model row and key panel) |
| claudeModel | claude-opus-4-8 | claude-fable-5, claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5 | immediate (next request); retired ids alias forward on load (sonnet-4-6 to sonnet-5, opus-4-5 to opus-4-8) |
| openaiModel | gpt-5.5 | gpt-5.5, gpt-5.4, gpt-4.1 | immediate (next request); retired ids alias forward on load (gpt-5.2 to gpt-5.4) |
| autoSubmitMode | true | toggle | immediate (auto submits after a pause; manual waits for "submit") |
| readClaudeResponse | false | toggle | immediate (TTS reads AI responses) |
| lyricsOnNowPlaying | true | toggle | immediate (relay current synced lyric into the media-session title) |
| showSongNotes | false | Notes toggle in the playlist header | immediate (CSS class flip shows/hides every song's comment line, no re-render) |

The per-query Model pills under the request box set the same settings
(provider + that provider's model) in one tap; the settings panel
pickers and the query pills always mirror each other.

The playlist filter box and the Known Songs search box are live view
filters, not settings: they are never persisted and reset to "show all"
on reload. Both use the one matcher in `player-songs.js`
(`songMatchesQuery`: every query word must appear in the song's name,
artist, year, album, comment, title, channel, or search term). The
playlist filter only hides rows - the playlist array, playback order,
and next/previous are untouched - and an active filter always shows a
status line ("Filtering for "x" - 3 of 12 shown") with a Cancel button.

Lyrics overlay view preferences (`PLAYER_LYRICS_VIEW`), all `immediate`
(re-render of the open overlay):

| Setting | Default | Values |
|---------|---------|--------|
| fontScale | 1 | 0.72..1.9 in overlay +/- steps |
| widthMode | wide | wide / focus |
| align | center | center / left |
| spacing | roomy | roomy / tight |
| backdrop | dim | dim / blackout |

API keys are plain strings via `api-keys-store.js` (`API_CLAUDE`,
`API_OPENAI`). The working playlist + current index persist in
`PLAYER_PLAYLIST` as Songs + membership (never lyric runtime); favorites
in `PLAYER_FAVORITES`. Per-song lyric state lives in the
`voice-wei-music` IndexedDB (`lyricStates`, keyed by videoId), alongside
the unbounded history (see "The Song primitive" and "Music player
durable history" in [architecture.md](architecture.md)).

## Books (`ebookSettings`, API key in `openaiApiKey`, library in IndexedDB)

Books persists TTS preferences and the OpenAI API key in browser localStorage.
Large book data is stored in IndexedDB (`voice-wei-books`): original upload
Blobs, parsed book-section records, sanitized EPUB/HTML reader markup, planned
TTS text chunks, generated MP3 chunk Blobs, read/listen progress, and local
history events. EPUB imports prefer the official `nav`/NCX table of contents
for chapter names; PDF imports use outline entries when available. The visible
Log panel is page-session state and is cleared on reload. Books requests
persistent browser storage automatically where supported.

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| voice | alloy | alloy, ash, ballad, cedar, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse | immediate for the next preview/conversion request; legacy TTS models show their supported subset |
| model | gpt-4o-mini-tts | gpt-4o-mini-tts, gpt-4o-mini-tts-2025-12-15, tts-1, tts-1-hd | immediate for the next preview/conversion request; UI displays current OpenAI reference pricing |
| speed | 1.0 | 0.25..4.0 in 0.1 button steps | immediate for the next preview/conversion request |
| accent | default | default, American English, British English, Australian English, Irish English, Scottish English, Indian English, New York English, Southern US English | composed into GPT-4o mini TTS instructions; disabled for legacy TTS models |
| style | audiobook | audiobook narrator, neutral, dramatic suspense, warm storyteller, documentary, calm bedtime, whisper | composed into GPT-4o mini TTS instructions; disabled for legacy TTS models |
| instructions | empty | text | appended to accent/style instructions for GPT-4o mini TTS preview/conversion requests; disabled for legacy TTS models |

Displayed reference pricing:

- `gpt-4o-mini-tts` and `gpt-4o-mini-tts-2025-12-15`: $0.60 / 1M
  text input tokens + $12 / 1M audio output tokens, roughly $0.015 per
  generated minute.
- `tts-1`: $15 / 1M characters ($0.015 / 1K characters).
- `tts-1-hd`: $30 / 1M characters ($0.030 / 1K characters).

The Generate card includes voice sample buttons for every voice available to
the selected model. A sample uses the user's OpenAI key and the current model,
speed, and narration instructions, but sends a short fixed sample text instead
of book content: "it was a dark and stormy night. The datacenter was centrally
located in the data plains of Torrenthia, humming along as usual, blotting out
the sound of scraping from beneath."

Actions: import creates a saved book plus section/chapter and chunk records;
Generate selected/current/next chapter and Whole book use chapter-level TOC
boundaries, while +Chunk remains available for the underlying TTS chunk unit.
Each chunk record updates as its MP3 finishes; Cancel preserves completed
chunks and leaves the rest pending/error; custom playback controls update
listening and reading progress and write local history events for play/pause,
chunk changes, jumps, and position samples; auto-generate-ahead can generate
more pending chunks while listening.
Download original / current chunk / all chunk MP3s / combined MP3 export saved
blobs; Delete chunk MP3 / Delete all MP3s clear generated audio without
removing the original; Delete book removes the browser-local book, sections,
and chunks. The visible Log is page-local DOM state only; it is not a durable
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
