# Tool Reference

What each tab does and how to use it. Setting-change behavior for every
control is defined in [parameters.md](parameters.md). The full scales voice
command reference is [scales-commands.md](scales-commands.md).

## Scales

Voice-controlled scale trainer with realistic piano (Salamander samples).
**Voice-first, click-second**: everything you can say is also visible and
clickable, and both update the same state.

The transport row is Play (primary, stretches wide), Stop, Listen.
Click **Listen**, then say things like:

- "D minor scale"
- "slowly chromatic"
- "G major up and down"
- "perfect fifth from A"
- "harmonic minor repeat forever"
- "quarter tone scale", "rast", "bayati from D" (microtonal - see
  [scales-commands.md](scales-commands.md) for the full list)

Voice commands reset settings to defaults then apply your modifiers, so
"D minor" always sounds the same regardless of previous UI state. Clicked
settings persist per tab and restart playback live when something is playing.

Features: direction / repeat / rising / shifting / chop head / movement styles /
exercises / section width controls; note length and gap steppers (gap goes
negative for overlap); piano keyboard preview; presets; command history;
hardware media keys (play/pause); **Sing** is a bottom-dock toggle that
opens the pitch-trace sheet seeded with the current scale.

Phonetic aliases handle speech recognition quirks ("see" = C, "bee flat" =
Bb). See [scales-commands.md](scales-commands.md) for the full grammar.

## Intervals

Level-based interval drills, button-first. Two exercise types:

- **Type A - degree sequences**: absolute scale degrees to visit
  ("1-x-8 up", "8-x-1 down", random ascending paths).
- **Type B - movement clusters**: relative jumps from the previous note
  ("+k, -j").

Pick a level, press Go: the loop shows the degrees (and optionally note
names), optionally speaks the numbers, plays the notes, then generates the
next pattern after the gap. Repeat holds the current pattern; Next advances
immediately; Stop is immediate. Media keys map to Go / Stop / Next.

**Sing** is a bottom-dock toggle that opens the shared pitch-trace sheet
seeded with the current pattern
(targets at the pattern's note timing, rails around its range with the
pattern notes highlighted). Turn Repeat on to hold one pattern while
drilling it; takes are scored and recorded like Phrases and Scales.

## Phrases

Melodic phrase memory and reproduction practice. Generates scale-degree
phrases with selectable note-picking algorithms, shows the full degree
sequence, and replays it until the shape is internalized.

**Defaults**: D#3, major, arch algorithm, 5-8 note phrases, 0.3s notes, no
gap, play tones, return to degree 1.

- **Play** plays the current phrase (creating one if needed), **Repeat**
  loops it, **Next** generates a new one, **Stop** stops everything.
- **Series** input loads a typed degree series as the current phrase -
  the manual twin of Next, for exact material like a song voice line.
  Tokens are degree digits with optional marks, the same octave grammar
  as the Trace pattern input: `v`/`d`/`↓` per octave lower, `^`/`u`/`↑`
  per octave higher (stackable), 9+ keeps climbing, plus `#`/`b` for
  the chromatic note above/below that degree (`5v 1 1 7bv 7v 2# 2`).
  Separators are spaces, commas, or `|` barlines. Bad tokens list under
  the input and nothing changes until the whole series parses. A loaded
  series joins Phrase History, so several voice lines can be re-played
  from there.
- **Reflect** flips the current phrase around the octave (up-from-1
  becomes down-from-8). A view/playback transform, not a regeneration.
- **Style + Lesson** selects the generator family: **free** keeps the older
  motion algorithms, **staff read** drills beginner staff-reading shapes,
  **sight sing** drills progressive scale-degree sets, and **barbershop**
  drills chord-tone functions. **Genre** adds broader melodic studies such
  as folk/hymn, pop hook, theatre, jazz, gospel, classical, fingerpicked
  folk, Beatles-style compact hooks, Simon/Garfunkel-style folk contours,
  modal folk, calypso, norteño, cantopop, klezmer, and modal/minor color.
  The named song-adjacent lessons use abstract contour/arpeggio tendencies,
  not copied melodies.
- Choosing a style or lesson applies its preset defaults and marks the
  affected controls as lesson-owned. Clicking one of those marked controls
  unlocks just that control and keeps the new combination; choosing a style
  or lesson again reapplies the preset. Fill modes stay independent and are
  never turned on by a style.
- **Per-note on/off markers** under the degrees isolate phrase sections by
  click or drag without losing the phrase.
- **Breakdown** starts from first/last plus one random interior note, then
  adds one note from the largest remaining gap between automatic replays.
  Turn **auto-advance** off to repeat the current subset until **add note**
  advances to the next subset.
- **Accidental rate** optionally chooses conventional chromatic passing
  tones instead of normal scale-degree targets at a low controlled rate.
- **Fill modes** add invisible tone-only notes during playback: **full
  fill** walks the scale between displayed notes, and **1358 fill** adds
  only root/third/fifth/octave path notes when they lie between them.
- **Alto gaps** is a phrase style centered on 3/4 and 7/8 movement,
  including direct and neighbor approaches around those pairs.
- **Output modes**: display only, say numbers, play tones, say + tones,
  sing numbers (speech pitch shaped toward each note), none.
- **Test** is a fixed bottom-dock toggle (not in the transport row). It
  opens the pitch-trace sheet for the current phrase (see "Pitch test
  panel" below). Playback still works while it listens: Play, Next, and
  single-note taps all sound during a take; a new phrase restarts the
  take. (The mic hears the speakers, so played piano appears in the
  trace.)
- **Range Low / Range High** steppers move the endpoints of the degree
  palette phrases are built from, one degree per step. Default 1..8 (the
  octave); low descends below unison (down to the 1 an octave below,
  labeled "6↓" style), high climbs to two octaves ("2↑" style) or drops
  below 8 to shrink the palette (7 = degrees 1-7 only).
- Hardware media keys: play/pause replay the phrase, next/seek generate
  the next one. (Chrome only routes media keys to pages with real media,
  so the page keeps a silent audio element active after the first tap.)

Setting behaviors (the key design): root/scale changes **reproject** the
current degree sequence into the new context; algorithm, min/max length,
start, and range endpoints apply to the **next** generated phrase;
return-to-1 regenerates; playback settings replay; show-names redraws.

Algorithm choices separate musical behavior from range: **arch** is the
default rise/fall contour with a midpoint climax, **balanced** is the original
clustered random walk, **random** samples freely, **stepwise** emphasizes
conjunct motion, **leapy** emphasizes disjunct motion with contrary-step
compensation, and **motif** repeats and varies a short contour cell.

## Staff

Continuous grand-staff sight singing: one long generated line rendered on
a treble+bass system. Unlike Phrases (one phrase at a time, sung from
memory), Staff produces an ongoing metered stream to be READ.

The staff is always a grand staff with a fixed left header (brace, clefs,
key signature, 4/4 meter). Notes split at middle C - below C4 on the bass
staff, C4 and up on the treble - so a pitch is never drawn twice. The two
staves are placed so diatonic spacing is continuous through the gap:
middle C has one shared position, and the sung trace crosses between
staves without a jump.

Two modes:

- **page**: the whole sheet is drawn on a still staff (horizontal scroll
  to browse); read and sing at your own pace. With Listen on, a live dot
  at the left edge of the pitch band shows the pitch currently being sung.
- **scroll**: the staff moves right-to-left past a fixed red **now-line**;
  sing each note as it reaches the line. The sequence keeps generating
  ahead of the now-line, so a run continues until Stop. With **hear
  tones** on, each note also sounds on the piano as it crosses. Hiding
  the tab pauses the run (no animation frames = no honest clock), and a
  stalled clock never dumps missed notes as a burst - a passed note only
  sounds if it would still be ringing.

Under the staff sits the dedicated **pitch band**: the sung trace draws
there, on the same beat timeline but at its own taller pitch scale, with
a gray reference segment marking each sheet note's pitch and span - so
singing detail is readable without anything drawing over the notation.
Two toggles sit directly under the band and control it independently:
**note guides** hides the gray right-answer segments (sing blind, then
toggle back on to compare), and **sung line** hides your recorded blue
line (sing without watching yourself, then reveal to review). Both
persist; the page-mode live dot stays either way.
The band's frame is the working range (plus the sheet's notes) and stays
fixed for the run; out-of-range pitch is clipped, never rescales it.

Generation reuses the Phrases engine: the same style/lesson families
(free, staff read, sight sing, barbershop, genre), algorithm modes,
start/return anchors, range endpoints, min/max phrase length, and
passing-note rate - applied continuously, phrase after phrase, with a
configurable rest span between phrases. Rests render as standard glyphs
(whole/half/quarter/eighth) on the staff the melodic line last used, and
never cross a barline.

- **Notes** chips choose which duration values the generator may use
  (eighth, quarter, half, whole); quarters are weighted most likely. At
  least one value stays enabled.
- **Tempo** sets beats per minute - the rate notes pass the now-line and
  the scroll speed. **Spacing** sets pixels per beat (horizontal zoom),
  **Now** places the now-line across the staff, **Width** sets the
  staff's share of the page.
- **Listen** starts the shared microphone pipeline (same detector, band,
  and glitch rules as Trace/Phrases); the live note/cents readout sits
  under the staff.
- **show numbers** draws each note's scale degree (1-8, with #/b and
  octave marks) in a row under the staff - training wheels for reading
  that scroll with the notes. Same shared token and label vocabulary as
  the Phrases degree row (`.degree-token` + PatternPracticeCore labels).
- Every real scroll run (a few beats or more) is saved on Stop as a
  **Past Run**: the generated sheet plus the sung trace. Load reopens it
  in page mode for review - the staff with your sung line in the pitch
  band beneath it - and Start re-runs the same sheet as a fresh take.
  Recent runs keep their traces; older ones keep just the sheet.
- **Sing** (bottom dock) opens the shared pitch test panel against the
  current sheet: targets are the sheet's notes at their metered timing
  (current bpm), rails span the working range plus every sheet note, and
  the take is scored per note like Phrases Test. While a run is on the
  move (Start), the TRANSPORT owns the take clock - trace, targets, and
  playhead all share run time, so the panel and the moving sheet can
  never drift apart (pause on silence does not apply then). Starting a
  run from the top restarts an open take so they begin together; Stop
  hands the clock back and starts a fresh self-paced take (time starts
  with your voice, as on other pages).
- **Copy Text** (by the readout) copies the complete state as plain
  text - every setting plus the generated sequence as degree.duration
  tokens with barlines and the spelled note names - ready to paste into
  a conversation with an agent.
- Hardware media keys: play/pause control the moving staff, next
  generates a new sequence.
- A **palette line** under the style/lesson chips names, live, the exact
  degrees the generator may draw from and its motion character (e.g.
  "1 2 3 4 5 6 7 8 - steps and small skips (range sets the span)"). It
  reads the same core resolution the generator uses
  (`PatternPracticeCore.lessonPalette`), so it cannot disagree with the
  music. Only the selected style's lesson row is shown.
- On Staff, the RANGE ENDPOINTS govern the span (owner rule, 2026-07-29:
  a visible Range control must not be silently overridden). Lessons
  contribute their CHARACTER, re-scoped to the range: contiguous drill
  palettes (staff steps, pentachord, do-re) become every degree in the
  range with the lesson's motion (steps stay steps), and gapped palettes
  (triads, landmarks, barbershop functions) keep exactly their pitch
  classes, tiled across every octave the range covers. Note that a pure
  step walk still LINGERS low by nature; free arch/balanced/leapy or
  chord lessons cover the range faster. (Phrases is unchanged: its
  lessons own their preset range through the lock system.)

Setting behaviors: root/scale **reproject** the current sheet; tempo and
hear-tones apply **live**; spacing/now/width **redraw**; the generation
shape settings (style, lesson, algorithm, anchors, range, lengths, note
values, rest span) apply from the next generated content - the next
press of Next, or the next stretch the scroll generates.

## Trace

Free singing inside a selected key while watching the pitch line. Separate
from Phrases so you can practice scale motion and intonation without
generating anything first.

Layout: the primary controls - Start/Stop, Reset, the key stepper, and
the scale-type row - are docked directly onto the top of the chart (one
visual unit, no gap), so the glance-and-tap set is always next to the
display. The live pitch/status readout docks onto the chart's bottom
edge. The Low/High note steppers and Follow key toggle sit with the
chart controls. Secondary options (guide interval, guide sound, and
rolling-window width) sit below that; the pattern input stays above.

- Start begins listening; Reset clears the trace (and optionally plays the
  typed pattern as guides - off by default).
- Key/octave/scale draw the scale-degree rails. Rail labels are the bare
  degree number, mirrored on the left AND right edges of the chart.
- With Follow key on, the Low/High frame follows the selected key and
  scale and includes six context rails in their own color (sky blue
  against the scale's green): the 3 scale notes just below the root and
  the 3 just above the octave.
- Low and High are absolute note bounds. Stepping either one turns
  Follow key off, allowing the whole chart to zoom into even a
  two-semitone span. The bounds never react to singing; out-of-range
  voice remains recorded but is drawn off-screen. Turning Follow key
  back on restores the key-relative frame.
- Type degree patterns like `1 2 3 5 3 1` to draw blue target bands; the
  guide interval stepper sets their horizontal spacing. Octave suffixes
  reach outside the home octave: `5d` (or `5v`/`5↓`) is the 5 an octave
  below the root, `2u` (or `2↑`) the 2 an octave above, stackable as
  `5dd`; numbers past the octave keep climbing (`9` = the 2 above).
  Targets outside the selected vertical frame stay off-screen.
- Guide sound: piano (default) or sine beep.
- Pause on silence (default on): the clock only advances while you sing.
- Window width steps through 2, 5, 10, 15, 20, 30, 45, and 60 seconds;
  the window toggle enables that scrolling viewport (default is a
  content-sized scrolling viewport). The width never grows with the
  clock, which used to squeeze the chart every frame.
- Guide bands are bare outlines of the hit zone; they do not recolor
  from scoring (Trace has no scoring). Filtering is voice-physics only, never
  exercise-based: detections outside the singable band (D2-Bb4:
  barbershop bass low up to just above a lead's top) read as silence,
  and a large instant jump must sustain for a few frames to count as
  voice (brief detector scrapes never reach the chart; real leaps are
  recorded whole).

## Pitch

Structured accuracy practice with scoring.

- **Free practice**: sing anything, watch the chart, stop to get per-note
  accuracy against the selected scale.
- **Call & response**: piano plays each scale note, you match it during the
  response window, every note gets scored (match %, cents off).
- **Play along**: sing with the piano as it walks the scale.

Range presets (voice/violin/bass) set the octave; root+octave, scale, and
match-time are shared steppers/segment rows. Results panel shows overall
accuracy, average deviation, and per-note breakdown.

## Ears (within Intervals tab)

Ear training lives on the **Intervals** page under **Ear training** mode
(`intervals.html?mode=ear`). The old `ears.html` URL redirects there.

- **Identify**: hear an interval (ascending, descending, or harmonic),
  name it by button or voice ("major third", "tritone", aliases accepted).
- **Sing**: hear a reference note, sing the prompted interval; pitch
  detection confirms when you hold the target (~1.5s within tolerance).
- **Both**: identify first, then sing it.

Adaptive mode weights practice toward your weakest intervals. Presets
filter the interval set (perfect / 3rds+6ths / 2nds+7ths / weakest).
Driving mode speaks feedback. Lifetime per-interval stats persist. The
Drone Test plays a sustained reference tone and shows live cents while you
match it.

Voice commands: "next", "repeat", "skip", "stats", or an interval name to
answer. Hardware media keys: play/pause repeat the current interval, next
plays a new one.

## Music

AI voice music player: **one large button, speak naturally, get a
playlist.**

- "Play some jazz" - five tracks with comments explaining each match
- "That Beatles song with the submarine" - Claude figures it out

Claude or OpenAI interprets the request; the same-origin PHP endpoint then
queries Piped/Invidious to find videos without a YouTube API key. Music
requires one AI-provider key stored in localStorage. A search made while
the selected provider has no key saved opens the key entry overlay on the
spot (with a Close button to decline) alongside the persistent problem
banner. Settings cover keys,
auto-submit vs manual voice mode, model selection, and spoken responses.
The page records `Startup: Ready in ...` in its Log after controls, stored
settings, the local song library, and the restored playlist are usable. The
browser console carries the full named phase, navigation, resource, and
long-task tables when a slow load needs diagnosis.

Transport voice commands:

| Command | Action |
|---------|--------|
| "play" / "start" / "resume" | Play |
| "pause" / "halt" | Pause |
| "stop" | Stop |
| "next" / "skip" | Next song |
| "previous" / "back" | Previous song |
| "fast forward" / "rewind" | Skip 10s |
| "shuffle" | Shuffle playlist |
| "clear" | Clear playlist |
| "what's playing" | Announce current song |
| "submit" | Send pending command (manual mode) |

Music pauses while you speak, resumes while waiting for Claude, and pauses
again while the response is read aloud.

Requests can also be typed (the "Type a music request" box) when speaking
is not an option.

The playlist is the **working list for the current search**: a new AI
request replaces it (the previous songs stay reloadable from History),
while explicit loads - favorites, past lookups, known songs - append to
it. The replacement is gentle: nothing is dropped until the first found
song is actually added (a search that finds nothing leaves the list
untouched), results appear one by one as their YouTube searches
complete, and a song that is already playing carries over as entry 1
and keeps playing with the new songs queued behind it. The raw AI
request and response JSON are logged to the Log panel for every batch.

Searches target the original studio recording unless you ask otherwise:
the AI is told never to add "live" to search terms, and YouTube results
are re-ranked before the first is taken. A result whose title does not
contain the requested song's name is treated as the wrong song outright
(an artist's official upload of a different track can never win);
YouTube's auto-generated album tracks ("Provided to YouTube by" /
" - Topic", flagged by the proxy) and Vevo/official uploads score up;
live / cover / remix / karaoke / reaction / sped-up markers score down
unless your request contained that word; and leftover title words beyond
artist + song + format labels (concert dates, venues, "(Solstice
Version)"-style renames) score down too. The remembered alternates used
when a video refuses to embed keep only candidates that pass the same
same-recording bar, so a retry never silently swaps in a live take or a
different song. The per-query Model pills under
the request box pick the exact AI model (Claude or OpenAI) for the next
request, and the status line names it ("Processing with
claude-opus-4-8..."). Key-level provider failures - invalid key, spend
or rate limits, billing - show a persistent red banner naming the
provider and where to fix it, on top of the raw error in the Log.

Each playlist row is one compact data line with fixed slots: favorite
star and lyric marker in a padded leading gutter (so a near-miss on the
star favorites instead of starting the song), then song name, artist -
year - album, duration, and remove. The lyric marker is a small chip:
**✓** = timed/line-synced (best), **~** = non-timed/simple text only,
– = none found (tap it to view or retry). The AI's note appears as a
second line only when the Notes toggle is on. Tap the row body (not the
leading gutter) to play it. The playlist header offers Timed only,
Notes, Shuffle, Sort by Artist, Sort by Year, Clear, and a live filter.
Behind the working list, every song ever seen is recorded durably in the
known-songs catalog (IndexedDB), so clearing or replacing the playlist
never loses song information. When a video refuses to play (embed
disabled, removed), the player retries its remembered alternates and,
when none are left - e.g. after a reload - re-runs the YouTube search
once for fresh candidates before giving up.

Lyrics come in two kinds, named everywhere in the UI: **timed lyrics**
(line-synced; the ✓ marker, the highlight, and the title relay) and
**simple lyrics** (text only; the ~ marker). The search prefers timed
lyrics only among LRCLIB records that independently match the requested title
and known artist; a matching duration cannot make a different song or artist
eligible. Lookup uses title and artist without requiring the album, so album
editions and compilation metadata do not hide valid lyrics. When these
identity rules change, older stored results (including timed lyrics) are
revalidated once; a still-valid stored lyric is not discarded when that
recheck finds nothing better.
LRCLIB lookup renders in the panel and overlay, and (on by default, in
settings) the current timed lyric line is relayed into the now-playing
title that Bluetooth/car displays, lock screens, and the tab show. The
title spots follow one sequence per song: for the first 2 seconds the
song's identity (artist - name - year - album, so you know who and what
it is), then -- when the first lyric line starts more than 5 seconds in
-- the upcoming line prefixed with a per-second countdown, then the bare
sung lyric line. The Media Session artist field (car/lock-screen second
row) is always `year - artist - song` while playing, so identity stays
under the lyric after the intro ends. Car / lock-screen / tab / header
titles lead the sung line by 0.75s so Bluetooth metadata redraw lands
near the moment the line starts; the on-screen highlight stays on the
exact timed time. Big Lyrics closes with Escape. If playback advances to
another song while Big Lyrics remains open, the new lyrics begin at the top
instead of retaining the prior song's scroll position.

**Song Report** is the alternative second-line accompaniment. Press **Song
Report** for the selected or sounding song. If that song has a saved report,
it starts immediately; if not, the same button requests one from the selected
AI provider/model. **Request Song Report** remains the explicit refresh action.
**Report Text** (enabled when a report is saved) opens the whole report as
readable text under the controls: every note in playback order with anchored
notes keeping their sung time, then the attributions appendix from the raw
response. Pressing it again closes the panel; it follows the current song and
closes if that song has no saved report.
While research is in flight, both buttons show the sending/waiting phase and
the elapsed wait. On return, the Song Report button and adjacent status name
the returned character/line counts, provider/model, elapsed time, and active
playback interval.

The request carries the song's full stored lyrics, resolved through the
normal lyric store path before the prompt is built: timed lyrics are numbered
one line per row, plain lyrics go in as text. The model acts as a reporter,
not a stylist: every claim or interpretation must come from researched
material, and the model may not add its own analysis, motives, connective
details, embellishment, or generic praise. Display notes state sourced ideas
without source names or attribution phrases. They never contain raw URLs,
song or album titles, release dates or years, record labels, publication
names, or critic names. Source attribution follows the display-note fields in
a separate `attributions` list retained in the research response and never
shown as a note. The parse boundary enforces this beyond the prompt: markdown
links collapse to their visible words, bare URLs, domains, and numeric
citation markers are stripped from every note before display, and a note that
was mostly citation never displays at all (the raw response keeps everything).
Distinctive words, phrases, places, terms, people, objects,
events, or ideas in the lyrics may seed separate research; useful sourced
context does not need a source that already connects it to the song. Every
note follows George Orwell's six writing rules, which the research prompt
includes verbatim. Notes use ordinary, literal English rather than music,
critical, journalistic, or insider slang: for example, `recorded live`, not
`cut live`. The model returns short notes (at most 80 characters each) as
JSON: `lyricNotes` tied to numbered lyric lines and `generalNotes` for
everything else, quoting lyric words only from the provided lyrics. When no
lyrics are available the prompt requires general notes only and forbids
quoting.

Playback anchors each lyric note to its line's sung time, so a note appears
exactly when that part of the song arrives. General notes fill the largest
gaps between anchored notes (or, for songs without timed lyrics, advance at
the **Every** stepper's 0.5–30 seconds per line). A note longer than the
50-character display budget wraps into consecutive interval-spaced segments.
Between consecutive notes the in-page second line goes blank for 0.2 seconds
so a new note is visibly a new note; the car/lock-screen relay carries the
note itself without the blank. **Identity / Song Report** chooses the second
line: Identity keeps `year - artist - song`, while Song Report plays the
saved notes. Timed lyrics continue independently on the first line. Artwork
and YouTube position remain the same. A replay reuses the saved notes without
another AI call, and reports saved before timed notes still play as untimed
lines. The Log records the request body, waiting lifecycle, complete provider
response, parsed notes, save, and playback start or failure.

The Media Session also carries the selected video's stable YouTube thumbnail
and the true YouTube elapsed/total position. Lyric/report changes mutate the
installed track metadata's text fields in place; they do not replace the
metadata object, clear position, or rewrite position state. This prevents a
line transition from blanking and resetting the receiver's time-remaining
display. Pause freezes that complete state; stop or playlist clear removes it.
Car seek-back, seek-forward, and seek-to actions seek the YouTube player.
Writes are pushed into the OS media session exactly when the text changes
(line boundaries / countdown seconds); the car pulls its redraw from that. On
this page the header gives the lyric
heading its own full-width line, with the nav tabs and the settings gear
sharing one row beneath it. The Lyrics panel toggle sits with the sticky transport's Big Lyrics
button (the older central-player secondary row is hidden).

The always-reachable surface is the now-playing control line under the
header: it scrolls with the page until it reaches the top, then hooks
there. It carries a clickable track-position strip (current and total
time at the ends; click or drag anywhere to jump), the current timed
lyric line (own full row; once shown it holds its space through lyric
gaps so the sticky bar never changes height mid-track and shoves the
page under the reader - rows collapse only at track boundaries), a song-nav row
(previous/play-pause/next, Big Lyrics, and the current song line -
tapping the song line scrolls the playlist to that row; green controls =
between-song / track actions), and a within-song seek row (-30/-5/+5/+30,
plus a "1st" jump to just before the first lyric that appears only on
timed-lyric tracks; teal controls = within-song seek). Timed tracks also
show **Lyrics too fast** / **Lyrics too slow** controls and the current
signed lyric offset. Each tap corrects the named problem by 0.5 seconds.
The same controls and live offset appear inside Big Lyrics. Each song's
timing nudge is stored forever on that video's lyric state (absent means
no offset); the next play reapplies it automatically. The older central
player block is kept in the DOM for progress wiring but stays hidden; the
sticky bar is the only on-screen transport. The Listen button scrolls with
the page like everything else.

Other surfaces on the page:

- **Playlist filter**: type in the filter box above the playlist to
  live-filter the loaded songs by visible name, artist, year, or album;
  Unicode punctuation and diacritic differences do not matter, and every
  entered word is required. **Timed only** (playlist header toggle) further
  hides rows that do not yet hold timed (synced) lyrics. Text and Timed only
  combine. An active filter shows a status line ("Filtering for timed
  lyrics only + \"sunset\" - 3 of 12 shown") with a Cancel button that
  restores the full list (clears the text query and turns Timed only
  off). While Timed only is active, the status also counts text matches still
  waiting for lyric resolution. Filtering is a view: playback order and
  next/previous still use the whole playlist.
- **Notes toggle** (playlist header): shows or hides every song's comment
  line instantly. Off by default; rows stay compact until you want the
  AI's per-song notes.
- **Keep-alive necessity experiment**: append `?keepAlive=0` to the Music URL
  to run the complete Media Session surface (lyric titles, artwork, position,
  media keys) without the silent ownership audio. Play a song, background the
  page, and check the lock screen / car display: page-controlled lyric lines
  mean the silent loop is unnecessary on that browser; YouTube's own metadata
  means ownership still requires it. `Playback diagnostic` lines label the
  session `keepAlive=disabled` so evidence from experiment runs is
  distinguishable.
- **Three-player prebuffer probe**: append `?prebufferProbe=1` to the Music
  URL, load at least three songs, and start one. Normal playback remains on
  its existing player while two muted off-screen players warm the next two
  physical playlist entries. After about seven seconds, open Log and copy all
  lines labeled **Prebuffer probe**; they report player readiness, cold start,
  buffered seconds, warm-resume latency, and any YouTube errors. The probe is
  diagnostic only and is completely absent without the query parameter.
- **Load Favorites** appends every not-already-loaded favorite in one list
  update. A favorite whose saved video contradicts its named song waits for
  video identity repair before lyrics are resolved.
- **History / Cache** toggles a panel with past lookups, the known-songs
  catalog, and the YouTube search cache (all from the `voice-wei-music`
  IndexedDB); selected lookups or songs can be loaded back into the
  playlist. Hidden by default. The Known Songs card has the same
  punctuation/diacritic-insensitive live identity search as the playlist
  filter (name, artist, year, album), with per-row Load buttons and a "Load
  All Shown" button that loads every matching song into the working playlist.
- **Log** opens with only lines from the current page session, and **Copy
  All** copies only those visible session lines. **Load Old Logs** explicitly
  prepends every earlier-session line still retained by the 5,000-line
  IndexedDB log store; after that explicit load, **Copy All** includes them.
  **Playback diagnostic** lines record visibility/page lifecycle, browser
  discard evidence, network and memory context, application transport intent,
  and every YouTube player state. After an Android background stop, the next
  session-start line includes the last synchronously saved state even when the
  old page was killed without an exit event. Layout shifts not caused by user
  input are logged with the elements that moved (`event=layout-shift;
  moved=...`), so "the page moved on its own" reports name their culprit; a
  felt jump with no shift line points at a scripted scroll instead.
- **Song Library** toggles the local song library: imports
  `.mid`/`.midi`/`.musicxml`/`.xml` melody files, keeps them in this
  browser, and plays their melodies on the shared piano. Its search requires
  every typed word to match somewhere across title, source filename/type, or
  imported lyric text, so words may occur in different fields. Public-domain
  corpora to import are listed in
  [public-domain-song-sources.md](public-domain-song-sources.md).
  Hidden by default.

## Books

Local ebook library, reader, audiobook generator, and MP3 player using OpenAI
TTS. The OpenAI key is entered in settings and stored in this browser's
localStorage as `openaiApiKey`; requests go directly from the browser to
OpenAI.

- Formats: TXT, EPUB, PDF, HTML.
- Imports are saved in this browser's IndexedDB library as the original raw
  file plus parsed book sections.
- Web import: paste a page URL and Voice-Wei reads it through the server proxy
  (`proxy.php?readUrl=`), then shows that page's outbound links (text plus URL)
  in one flat list with select all / select none / invert / per-link toggles
  and a filter (links are checked by default). One Submit builds the whole
  book: the accepted links download in the background with bounded concurrency,
  and each becomes its own chapter named after the link text. The result is a
  "metabook" whose first chapter is the contents - the original page's full
  text followed by an index of every selected link, each marked with the
  chapter it became or, if it could not be fetched, an inline note with the
  failure reason. There is no per-link recursion: the importer goes one level
  deep from the pasted page. The `rawFile` is a JSON snapshot of every fetched
  page, tagged with `sourceUrl` and `contentOrigin: url`. This suits
  syllabus/reading-list pages whose real content lives across many linked
  essays.
- The web reader handles several common obstacles through the proxy:
  LessWrong / EA Forum / Alignment Forum URLs are rewritten to their
  server-rendered GreaterWrong mirrors; main-content narrowing prefers
  `<article>` and post-content containers and truncates trailing comment
  threads so reader text and link lists stay clean; and linked PDFs are
  fetched as bytes through an asset passthrough (`proxy.php?assetUrl=`) and
  parsed with the same client-side PDF.js path used for uploaded PDFs.
  Cloudflare-gated mirrors such as archive.is still cannot be read
  server-side and are skipped with a logged reason.
- EPUB and HTML imports preserve sanitized reader markup, including embedded
  EPUB images when they can be resolved from the package, so the book can be
  read locally instead of only previewed as flattened plain text.
- The user-facing audio unit is a **chapter**: chapter rows and the TOC report
  generated time against total chapter time, and the player reports one
  continuous position such as `Chapter 8 · 6m / 20m`. Internally, chapters are
  still divided into API-sized audio parts for persistence and recovery, but
  those controls/markers live under collapsed **Audio details** / **Advanced
  audio parts** disclosures. Generation covers selected/current/next chapter,
  whole book, +15 minutes, or +1 hour. Repeated duration presses skip queued
  work and extend farther ahead.
- Audio-part splitting ignores single hard-wrapped newlines and prefers the
  last complete sentence (including punctuation followed by closing quotes)
  below OpenAI's input limit; clause/whitespace splits are only used for an
  exceptionally long sentence. Plain-text imports detect repeated
  `CHAPTER <number>` headings (discarding duplicate contents-list headings), so
  books such as Gutenberg TXT files use real chapters instead of arbitrary
  fixed-size Parts. Legacy Part-based TXT books with no generated audio upgrade
  automatically on open. Other existing plans can be replaced through the
  two-step **Rebuild sentence-safe audio plan** action, which clearly deletes
  generated audio before rebuilding.
- Generation is a work queue, not a single locked job: starting another
  chapter or advanced audio part while one is already generating appends it to the queue
  (deduped) instead of being ignored, and the progress line shows how many
  units are done and how many are still queued. Cancel stops the in-flight
  unit and clears the queue; switching books clears it too. Auth/quota/rate-
  limit failures stop the rest of the queue and leave those parts pending so
  a later +15/+1 hour can fill them; transient per-part failures mark that
  part as error and continue. Reloading a book resets interrupted generation
  back to pending.
- Narration options show OpenAI reference pricing for the selected model and
  include per-voice sample buttons. GPT-4o mini TTS exposes accent and
  narration-style presets as structured `instructions`; legacy TTS models
  disable those controls because the speech endpoint does not support
  instructions there. Samples generate a short MP3 through the same OpenAI
  speech endpoint, using the current model, speed, accent, style, and extra
  narration instructions.
- Generated audio parts are saved immediately to IndexedDB, so cancelling midway
  preserves the completed MP3s and reloading later can continue from the next
  pending chunk.
- The player is custom, not native browser chrome: previous/next audio,
  play/pause, +/-30s, quadratic back/forward jumps, seek bar, keyboard
  Left/Right navigation, saved listening position, and preloaded next audio
  part. Advanced audio markers remain clickable. A toggle can keep about one
  hour generated ahead.
- **AI Research** is a dedicated card immediately after the Listen card.
  **AI question** pauses the current MP3 and starts one-utterance browser
  speech recognition; questions remain editable/typable. Before sending, the
  card shows the exact full request body with only the book context replaced by
  an explicit placeholder, plus that complete source text in its own disclosure.
  Requests use the OpenAI Responses API with GPT-5.6 Sol, reasoning high, and
  required high-context web search with text and image results. The research
  frame tells the model to work for the listener, validate claims rather than
  treating the book as canonical truth, use multiple sources where warranted,
  and answer carefully with clickable citations and useful images. Because the
  answer text is displayed and spoken exactly as written, the instructions
  require plain prose in ordinary, literal English with no persona, markdown,
  or formatting syntax; no raw URLs in the answer text (links stay in
  citations, sources, and images); no repetition of the question, book title,
  author, or chapter name; source names in prose only when the source's
  identity matters to weighing the claim; and George Orwell's six writing
  rules, included verbatim. While in
  flight, the full provider/model/configuration and elapsed time stay visible.
  **Read answer aloud when it returns** is read live at response time, so a
  change made during research is honored. Complete results—question, answer,
  request, source text, citations, images, model/configuration, elapsed time,
  and speech state—are stored in a dedicated per-book IndexedDB research
  history and survive reload. Answers have Page/Paragraph/Sentence back/forward
  buttons plus local Play/Stop from the selected position; browser speech
  boundary events highlight the current answer sentence. No narration MP3 or
  word-level book alignment is generated.
- Books keeps local listening/reading history in IndexedDB: play/pause,
  chunk changes, jumps, position samples, dates, per-day listening/read
  totals, and rough read-speed estimates. It is hidden by default and visible
  from the player History button.
- The reader never moves the whole browser window automatically as audio
  changes. Its sticky toolbar provides explicit **Go to latest read** and
  **Go to playing section** buttons. Manual reading and listening positions are
  stored separately, so the destinations can differ.
- Downloads normally expose original, current chapter audio, and generated
  book audio. Individual audio-part files and deletion live under Advanced.
- The library is a compact bookshelf: one row per book with title/author, read
  progress, generated audio time/percentage, estimated duration, and storage
  usage/quota. Opening a row reveals book actions inside the workspace.
  Generated MP3s can be deleted separately from the original book.
- localStorage is intentionally used only for small settings/secrets. Browser
  localStorage is commonly around 5-10 MB and string-only; raw books and MP3s
  belong in IndexedDB. Books requests persistent browser storage automatically
  and displays the current quota estimate.
- There is no user identity, server-side audit log, or analytics. The visible
  Log panel is page-local and can be cleared; the local history panel is
  browser-local and exists to support user navigation/progress.

## Pitch test panel (shared)

The embedded "listen" component used by Phrases (Test), Scales (Sing),
Intervals (Sing), and Staff (Sing). Each page launches it from a fixed **bottom dock**
(independent of the transport row): scale-degree rails, target-band
outlines, your sung pitch as a yellow trace, and a voice-gated timeline
(time starts when singing is detected).

**The chart draws what you sing.** Rails and targets are for comparison
only; they never gate what is recorded or drawn, and scoring verdicts
never recolor the chart (judgment lives in the readout and progress
line). The vertical frame is stable for the whole take: it spans the
rails and targets (chords movement stacks targets above the octave -
those sit inside the frame too) and singing never resizes it, so a
momentary low or high note cannot rescale the chart mid-take. Off-frame
singing stays recorded at its true pitch and still scores, but draws
off-screen; use Expand range for more room. Rejection is
voice-physics only: detections outside the singable band (D2-Bb4:
barbershop bass low up to just above a lead's top) are the room, not the
singer, and read as silence; and a large instant jump must sustain for a
few frames to be voice (brief detector scrapes never reach the trace,
confirmed jumps are recorded whole). Target bands are bare outlines of
the hit zone (about 60 cents either way), so singing inside the outline
is what scoring credits. (Architecture details: "Pitch pipeline" in
[architecture.md](architecture.md).)

**Per-note scoring** (owned by `pitch-score.js`, one definition
everywhere): the take is scored as a *sequence* - your held notes,
aligned in order to the target notes - so timing is yours: hold a note
twice its slot, breathe whenever, and nothing shifts onto the wrong
target. Verdicts update the score readout as you move through the
phrase; the chart itself stays an instrument. For each aligned note the
sustained pitch is the *median* of its samples and must sit within 140
cents of the target with a majority of samples inside that band;
accuracy is then graded good (within 30 cents), ok (within 60), or
missed (too far off, held too loosely, sung as a different note, or
skipped). The readout keeps a running score ("Score: 6/8 on pitch (avg 12c)"). Restart
clears the scores with the trace.

**Progress over time**: each completed take (all notes scored) is recorded,
and the panel shows a per-day trend line - "Progress: Today 62% (5 takes)
· Jun 9 48% (3)". The Pitch tool records its sessions the same way and
shows its trend in the results panel.

**Weak spots**: every recorded note keeps its verdict and its SIGNED cents
bias (sharp vs flat). Aggregated over recent takes, the panel and the
Pitch tool show a weak-spot line - "Weak spots: 6: missed 40%, 18c sharp" -
naming the degrees that need work and which way you lean on them. Labels
appear once they have at least 3 attempts and a real problem (missed 30%+
or leaning 15c+).

Options per page: targets on/off, pause on silence, 20s window, expand
range. The guide never auto-plays; "Play Guide" is an explicit button in
the pinned action row.
