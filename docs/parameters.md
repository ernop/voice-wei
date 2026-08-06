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
| `reproject` | Current content is kept and re-expressed in the new context (e.g. same degrees, new key). Never starts playback; ongoing playback continues and picks the change up live. |
| `regenerate` | Current content is discarded and regenerated (no auto-play). |
| `replay` | Current content kept; new sound settings apply to whatever plays next. Never starts playback (on Phrases, ongoing playback reads timing live per note). |
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
| time ladder (`TIME_VALUES_MS`) | 0 then tenths to 2s (0.1, 0.2, ... 1.9), quarters to 4s (2.25, 2.5, ... 4), halves to 5s, wholes to 10s |
| noteLengthMs | the time ladder from 0.1s up (a zero-length note is silence) |
| gapMs | -50%, -10%, -5%, then the full time ladder from 0 |

Every note/timing stepper walks the same shared ladder: note length, gap,
the Phrases section pause (Sect), the Trace guide interval, and the Pitch
page match window all step through the same numbers. Trace's rolling chart
width is a viewport size rather than musical timing; its broad presets are
2, 5, 10, 15, 20, 30, 45, and 60 seconds.

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
| powersetEnabled | false | toggle - exclusive with breakdown | immediate (mask only) |
| reverseAfterSection | false | toggle - after each powerset combo plays, the same notes replay in reverse order within the same section | immediate (preference) |
| autoStep | false | toggle | immediate (preference) |
| playOnStep | false | toggle | immediate (preference) |
| playOnNext | true | toggle - when off, Next generates and shows the phrase silently (work it out first, then press Play) | immediate (preference) |
| noteLengthMs | 300 | shared note-length list | replay |
| gapMs | 0 | shared gap list | replay |
| sectionPauseMs | 1000 | shared time ladder; pause between repeat loops / breakdown passes / powerset combos | live (read each cycle) |
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

## Staff (`staff-settings`)

Continuous grand-staff sight singing. Generation shape settings are
bounds-next in the continuous sense: they govern the NEXT generated
content - the next press of Next, or the next stretch the scroll
generates ahead of the now-line - never the sheet already drawn.

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| root | C | C..B chromatic | reproject |
| octave | 3 | via root stepper (shared C2-B5) | reproject |
| scaleType | major | major, minor, chromatic, pentatonic, h minor, m minor | reproject |
| phraseStyle | free | free, staff, sight, barbershop, genre | bounds-next |
| phraseLesson | free_open | style-specific lesson buttons | bounds-next |
| phraseAlgo | arch | balanced, random, stepwise, leapy, arch, motif, alto gaps, rearrange | bounds-next |
| startAtOne | true | start at 1 / random start | bounds-next |
| returnToInitial | true | return to 1 / no return | bounds-next |
| rangeLow | 0 (degree 1) | one degree per step (shared endpoint rules with Phrases); on Staff the range GOVERNS lesson palettes (contiguous palettes fill it, gapped palettes tile their pitch classes across it) | bounds-next |
| rangeHigh | 11 (degree 5 above) | one degree per step | bounds-next |
| accidentalRate | 0 | 0..35% list | bounds-next |
| minLength | 5 | 2..16 list | bounds-next |
| maxLength | 8 | 3..32 list | bounds-next |
| durationBeats | quarter + half | multi-select of eighth, quarter, half, whole; at least one stays on | bounds-next |
| restBeats | 2 | none, half, 1, 2, 3, 4 - the guaranteed rest after each phrase | bounds-next |
| restToBarline | false | "then to end of bar" pill: after the guaranteed rest, keep resting to the next barline so every phrase starts on beat 1. With Rest 0 a phrase ending on the barline gets no rest at all; set Rest > 0 to always breathe | bounds-next |
| phraseTwice | false | "phrase x2" pill: each phrase appears twice in a row with the same melody and rhythm (each pass followed by the configured rest) | bounds-next |
| secondPassOnYourOwn | false | "2nd pass: on your own" pill: with phrase x2 and hear tones, the repeat pass stays silent - hear it once, then do it yourself | immediate |
| revealAfterPhrase | false | "reveal when done" pill (stage row): note guides and the sung line stay hidden until each phrase's time is fully over, then appear - sing blind, check as you go. Idle/loaded review always shows in full. Enabling it once nudges Now to at least 50% for look-back room | redraw |
| measures | 16 | 4..128 list; page-mode sheet length and scroll's initial buffer | bounds-next |
| bpm | 60 | 20..200 list | immediate (scroll speed and note firing read it live) |
| audioOffsetMs | 0 ("Audio Lead") | -300..+500ms list; manual audible-onset trim on top of the reported device latency - + sounds notes earlier against the now-line, - later (for devices that under-report output latency, e.g. some Bluetooth) | immediate |
| pxPerBeat | 26 | 14..48 px list | redraw |
| nowFraction | 10% | 5..75% of the visible staff (a small floor keeps a little look-back room; high values leave room to review revealed phrases behind the line) | redraw |
| staffWidthPct | 100 | 55, 70, 85, 100% of the page; the staff stays left-aligned | redraw |
| hearTones | true | toggle (stage row under the band) - piano plays each note as it crosses the now-line | immediate |
| showDegrees | true | toggle (stage row) - each note's scale degree (1-8, with #/b and octave marks) under the staff | redraw |
| showPitchGuides | true | toggle (stage row) - gray per-note pitch guides in the sung-pitch band | redraw |
| sungLinePlacement | band | "sung line" segment (stage row): off / staff / band - where the recorded blue sung line draws: nowhere, on the notation itself (the noteheads' own diatonic grid, clipped to the staff area), or in the pitch band (the page-mode live dot stays either way, moving onto the staff grid when the band is hidden) | redraw |
| showPitchReadout | true | toggle (stage row, "pitch info") - the live sung-pitch readout (note, Hz, cents) | immediate |
| mode | page | page / scroll | immediate (switching pauses a running scroll) |

Every display-affecting toggle sits in the stage row directly under the
staff, next to what it changes. The sung-pitch band under the staff only
exists while something is configured to draw in it: guides on, or the
sung line placed there - otherwise the view ends at the staff.

Actions (not persisted): Start/Pause (the moving staff), Stop (ends the
run, saves it as a Past Run when at least a bar was traversed, and
rewinds to the lead-in), Next (new sequence), Listen (microphone on/off),
full screen (stage row; Fullscreen API toggle - also enters the compact
landscape layout that drops the site header and shrinks the transport),
Copy Text (bottom of the control area, above Past Runs; clipboard: every
setting, the generated sequence as degree.duration tokens and note
names, plus this session's timestamped status-log lines and any frontend
errors, for pasting to an agent).
Past Runs persist under `staff-sessions`: newest first, capped at 20,
with sung traces kept on the 8 most recent. Load reopens a run's sheet
and trace in page mode; Start after a load re-runs the same sheet.

## Trace (`trace-settings`)

Changing any key/guide setting also resets the trace (the chart is only
meaningful for one configuration).

| Setting | Default | Values | Behavior |
|---------|---------|--------|----------|
| root / octave | D#3 | root pitch stepper (shared C2-B5) | redraw + trace reset |
| scaleType | major | six scales | redraw + trace reset |
| guideIntervalMs | 1000 | shared time ladder from 0.1s | redraw + trace reset |
| guideSound | piano | piano / beep | immediate (next guide tone) |
| patternText | empty | degree string | redraw |
| playGuidesOnReset | false | toggle | immediate |
| pauseOnSilence | true | toggle | immediate + trace reset |
| rangeLowMidi / rangeHighMidi | Bb2 / Ab4 for the default key | semitone note steppers, C1..B7; endpoints cannot cross | redraw (sets the absolute vertical frame; sung notes outside it remain recorded but off-screen) |
| rangeFollowsKey | true | toggle | redraw (on recomputes the bounds from the selected key/scale; stepping either bound turns it off) |
| windowMs | 20000 | 2, 5, 10, 15, 20, 30, 45, 60 seconds | redraw |
| fixedWindow | false | toggle | redraw (selected rolling width; off = content-sized scroll width; never grows with clock) |

## Scales (`scales-settings`)

All settings are `live-restart`. Voice commands first reset every setting to
its default, then apply the spoken modifiers.

| Setting | Default | Behavior |
|---------|---------|----------|
| root + octave | C4 (root pitch stepper, shared C2-B5) | live-restart |
| scaleType | major (UI offers 12 types incl. microtonal quarter_tone/rast/bayati/sikah/slendro/just_major; voice reaches every `SCALE_PATTERNS` key) | live-restart |
| direction | ascending | live-restart |
| noteLengthMs | 300 (shared note-length list) | live-restart |
| gapMs | 0 (shared gap list; negative = overlap ratio) | live-restart |
| repeatCount | 1 (Infinity = forever) | live-restart |
| repeatGapMs | 1000 | live-restart |
| risingSemitones | 0 (forces forever when > 0) | live-restart |
| shiftingSteps | 0 (forces forever when > 0; excludes rising) | live-restart |
| chopHead | 0 (excludes rising/shifting/exercise/movement/ladder; each pass drops the leading note) | live-restart |
| ladder | off (on / reverse; excludes chop head/shifting/exercise/movement; overlapping rungs shifting one degree per rung; reverse leads each rung with the new note; terminal ends play out by clipping, turnarounds reflect, forever-no-gap up+down reflects at the loop seam) | live-restart |
| ladderSize | 3 (2-8 notes per rung, clamped to the section) | live-restart |
| ladderGapMs | 500 (shared time ladder 0-10s; pause between rungs, 0 plays straight through) | live-restart |
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
| responseTime | 2s | shared time ladder from 0.5s (stored in seconds) | next-round |
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
| claudeModel | claude-fable-5 | claude-fable-5, claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5 | immediate (next request); retired ids alias forward on load (sonnet-4-6 to sonnet-5, opus-4-5 to opus-4-8) |
| llmMigration | fable-5-target | internal marker, not a control | one-time owner-directed switch: installs without the marker move to Claude Fable 5 on load, then every later provider/model choice is untouched |
| openaiModel | gpt-5.5 | gpt-5.5, gpt-5.4, gpt-4.1 | immediate (next request); retired ids alias forward on load (gpt-5.2 to gpt-5.4) |
| autoSubmitMode | true | toggle | immediate (auto submits after a pause; manual waits for "submit") |
| readClaudeResponse | false | toggle | immediate (TTS reads AI responses) |
| lyricsOnNowPlaying | true | toggle | immediate (relay timed lyrics on the first line and the selected identity/report value on the second) |
| showSongNotes | false | Notes toggle in the playlist header | immediate (CSS class flip shows/hides every song's comment line, no re-render) |
| songDisplayMode | identity | identity / report | immediate (switches the second display line; Song Report is available whenever a song is selected and requests one when none is saved) |
| songReportIntervalSeconds | 8 | 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30 seconds | immediate (spaces untimed notes and wrapped note segments; lyric-anchored notes keep their absolute sung moments; audio never restarts) |

The per-query Model pills under the request box set the same settings
(provider + that provider's model) in one tap; the settings panel
pickers and the query pills always mirror each other.

The playlist filter box and the Known Songs search box are live view
filters, not settings: they are never persisted and reset to "show all"
on reload. Both use the one matcher in `player-songs.js`
(`songMatchesQuery`: punctuation/apostrophe and diacritic differences are
normalized, then every query word must appear in the visible name, artist,
year, or album). Hidden notes, search terms, and raw YouTube metadata do not
match. The playlist filter only hides rows - the playlist array, playback order,
and next/previous are untouched - and an active filter always shows a
status line ("Filtering for "x" - 3 of 12 shown") with a Cancel button.
When Timed only is active, that line also counts text-matching rows still
waiting for lyric resolution; Timed only remains an AND constraint.

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
durable history" in [architecture.md](architecture.md)). Optional field
`lyricOffsetSeconds` on a `lyricStates` record is the permanent lyric
timing nudge for that video (absent = 0). **Lyrics too fast** subtracts
0.5 seconds per tap; **Lyrics too slow** adds 0.5 seconds per tap.
Generated reports live in the same database's `songReports` store, keyed by
`videoId`; each record holds the prompt, model/provider, full report, and
display lines. **Request Song Report** replaces that song's saved report and
activates Report mode when the save completes. It is an explicit action, not a
background request. Report playback starts at line one immediately on return
and at the beginning of every later replay.

## Books (`ebookSettings`, API key in `openaiApiKey`, library in IndexedDB)

Books persists TTS preferences and the OpenAI API key in browser localStorage.
Large book data is stored in IndexedDB (`voice-wei-books`): original upload
Blobs, parsed book-section records, sanitized EPUB/HTML reader markup, planned
internal TTS audio parts, generated MP3 Blobs, separate read/listen progress,
local history events, and complete AI Research records. EPUB imports prefer the
official `nav`/NCX table of contents
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
| speakAiAnswers | false | true / false | evaluated when each AI Research response returns (not snapshotted at send time); when enabled, the answer is read through browser-native speech synthesis; the answer's local Play/Stop button remains available either way |

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

Actions: import creates a saved book plus chapter and internal audio-part records;
Generate selected/current/next chapter and Whole book use chapter-level TOC
boundaries. +15 min and +1 hour extend from the listening position, skipping
audio parts already queued or generating. Each part persists as it finishes;
Cancel preserves completed work. Normal progress/player UI presents chapter
duration rather than part counts. Low-level generate/download/delete controls
and clickable markers live in collapsed Advanced/Audio details. Rebuild
sentence-safe audio plan requires two clicks and deletes existing generated
audio before replanning.
AI Research pauses playback, captures one spoken utterance (or accepts typed
input), and discloses the complete Responses API request body except that the
separately displayed full book context is represented by a size-labeled
placeholder. Requests use `gpt-5.6` (GPT-5.6 Sol), reasoning `high`,
`web_search` with high context, required tool use, text + image search, up to
six image results, and a 12,000-token reasoning/answer budget. Incomplete
provider responses are reported as failures rather than displayed as finished.
A live timer and the label
`OpenAI Responses API · GPT-5.6 Sol · reasoning high · web + image search`
remain visible while awaiting the response. Answers render clickable citations,
source links, and returned image results. Complete request/result/source/model
records persist per book in IndexedDB and reload from Saved research. Answer
buttons navigate backward/forward by sentence, paragraph, or visible page;
Play starts local browser speech at the selected position. Books does not
request a new transcript or word-level book timestamp map.
The reader never automatically scrolls the whole browser window. Go to latest
read and Go to playing section are explicit sticky-toolbar actions backed by
separate reading and listening state.
Download original / current chapter audio / generated book audio are primary;
individual part files live under Advanced. Delete all audio preserves the
original/research; Delete book removes all browser-local records.

## Pitch test panel (shared component)

Per page key (`phrases-test-panel`, `scales-sing-panel`,
`intervals-sing-panel`; the Staff page's `staff-sing` panel is retired).

| Option | Default | Behavior |
|--------|---------|----------|
| showTargets | true | redraw |
| pauseOnSilence | true | immediate + trace reset |
| fixedWindow | false | redraw (20s scroll width; off = content-sized; width never grows with clock) |
| expandRange | false | redraw |

The panel NEVER auto-plays: the test exists for the user to sing, so
opening or restarting it only resets the trace and starts listening.
"Play Guide" is an explicit button (top action row, next to Restart)
that plays the enabled targets in the current key. The action row sits
at the very top of the panel, above the titles.

## Word lab (`voice-wei:coolness-lab`, on the Deploys page)

| Option | Default | Behavior |
|--------|---------|----------|
| formula (dropdown) | balanced | applies that formula's weights to all sliders + re-rank |
| weights (7 sliders, 0-3) | from `coolness-config.json` | recompute totals + re-rank immediately; switches formula to Custom |
| words (typed words) | empty | each scored word joins the leaderboard until Clear my words |

Reset weights restores the config defaults (the Balanced formula).
Sliders re-weight the stored per-metric values client-side; the metric
values themselves only change when `coolness-config.json` changes and
the report is regenerated (see "Word lab" in [tools.md](tools.md)).
