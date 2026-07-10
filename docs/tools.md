# Tool Reference

What each tab does and how to use it. Setting-change behavior for every
control is defined in [parameters.md](parameters.md). The full scales voice
command reference is [scales-commands.md](scales-commands.md).

## Scales

Voice-controlled scale trainer with realistic piano (Salamander samples).
**Voice-first, click-second**: everything you can say is also visible and
clickable, and both update the same state.

Click **Listen**, then say things like:

- "D minor scale"
- "slowly chromatic"
- "G major up and down"
- "perfect fifth from A"
- "harmonic minor repeat forever"

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

## Trace

Free singing inside a selected key while watching the pitch line. Separate
from Phrases so you can practice scale motion and intonation without
generating anything first.

- Start begins listening; Reset clears the trace (and optionally plays the
  typed pattern as guides - off by default).
- Key/octave/scale draw the scale-degree rails.
- Type degree patterns like `1 2 3 5 3 1` to draw blue target bands; the
  guide interval stepper sets their horizontal spacing. Octave suffixes
  reach outside the home octave: `5d` (or `5v`/`5↓`) is the 5 an octave
  below the root, `2u` (or `2↑`) the 2 an octave above, stackable as
  `5dd`; numbers past the octave keep climbing (`9` = the 2 above).
  Rails extend automatically to cover every typed target.
- Guide sound: piano (default) or sine beep.
- Pause on silence (default on): the clock only advances while you sing.
- 20s window switches to a fixed 20-second scrolling viewport (default is
  a content-sized scrolling viewport - the width never grows with the
  clock, which used to squeeze the chart every frame).
- Expand range adds rails an octave above and below.
- The chart draws what you actually sing, wherever it lands: the vertical
  range expands to cover your voice even outside the rails. Guide bands
  are bare outlines of the hit zone; they do not recolor from scoring
  (Trace has no scoring). Filtering is voice-physics only, never
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

Claude interprets the request, YouTube (via the `proxy.php` Piped/Invidious
proxy) supplies the videos. Requires a Claude API key (stored in
localStorage; the page gates until one is entered). Settings cover
auto-submit vs manual voice mode, model selection, and spoken responses.

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
are re-ranked before the first is taken - " - Topic" (auto-generated
album track) and Vevo/official uploads score up, while live / cover /
remix / karaoke / reaction / sped-up markers in the title score down
unless your request contained that word. The per-query Model pills under
the request box pick the exact AI model (Claude or OpenAI) for the next
request, and the status line names it ("Processing with
claude-opus-4-8..."). Key-level provider failures - invalid key, spend
or rate limits, billing - show a persistent red banner naming the
provider and where to fix it, on top of the raw error in the Log.

Each playlist row is one compact data line with fixed slots: favorite
star, the lyric marker (T = timed lyrics, S = simple lyrics, - = none
found; tap it to view or retry), song name, artist - year - album,
duration, and remove. The AI's note appears as a second line only when
the Notes toggle is on. Tap a row to play it. The playlist header offers
Notes, Shuffle, Sort by Artist, Sort by Year, Clear, and a live filter.
Behind the working list, every song ever seen is recorded durably in the
known-songs catalog (IndexedDB), so clearing or replacing the playlist
never loses song information. When a video refuses to play (embed
disabled, removed), the player retries its remembered alternates and,
when none are left - e.g. after a reload - re-runs the YouTube search
once for fresh candidates before giving up.

Lyrics come in two kinds, named everywhere in the UI: **timed lyrics**
(line-synced; the T marker, the highlight, and the title relay) and
**simple lyrics** (text only; the S marker). The search prefers timed
lyrics: among plausible LRCLIB matches a timed record beats a simple-only
one, and a song stored with only simple lyrics gets one serious re-search
for timed ones (keeping the simple text if nothing better exists).
LRCLIB lookup renders in the panel and overlay, and (on by default, in
settings) the current timed lyric line is relayed into the now-playing
title that Bluetooth/car displays, lock screens, and the tab show. The
title spots follow one sequence per song: for the first 2 seconds the
song's identity (artist - name - year - album, so you know who and what
it is), then -- when the first lyric line starts more than 5 seconds in
-- the upcoming line prefixed with a per-second countdown, then the bare
sung lyric line and nothing else (song/artist are never written outside
the identity intro). Writes are pushed into the OS media session exactly
when the text changes (line boundaries / countdown seconds); the car
pulls its redraw from that. On this page the header gives the lyric
heading its own full-width line, with the nav tabs and the settings gear
sharing one row beneath it. The Lyrics panel toggle and Big Lyrics
overlay button sit in the central player next to the rewind/forward
controls.

The always-reachable surface is the now-playing control line under the
central player: it scrolls with the page until it reaches the top, then
hooks there. It carries a clickable track-position strip (current and
total time at the ends; click or drag anywhere to jump), the current
timed lyric line (own full row), previous/play-pause/next,
-30/-10/+10/+30 second jumps, the Big Lyrics button, and the current
song line - tapping the song line scrolls the playlist to that row. The
Listen button scrolls with the page like everything else.

Other surfaces on the page:

- **Playlist filter**: type in the filter box above the playlist to
  live-filter the loaded songs by name, artist, year, album, comment, or
  search term. An active filter shows a status line ("Filtering for
  \"sunset\" - 3 of 12 shown") with a Cancel button that restores the
  full list. Filtering is a view: playback order and next/previous still
  use the whole playlist.
- **Notes toggle** (playlist header): shows or hides every song's comment
  line instantly. Off by default; rows stay compact until you want the
  AI's per-song notes.
- **Load Favorites** appends the favorited tracks to the playlist.
- **History / Cache** toggles a panel with past lookups, the known-songs
  catalog, and the YouTube search cache (all from the `voice-wei-music`
  IndexedDB); selected lookups or songs can be loaded back into the
  playlist. Hidden by default. The Known Songs card has the same live
  search as the playlist filter, with per-row Load buttons and a "Load
  All Shown" button that loads every matching song into the working
  playlist.
- **Song Library** toggles the local song library: imports
  `.mid`/`.midi`/`.musicxml`/`.xml` melody files, keeps them in this
  browser, and plays their melodies on the shared piano. Public-domain
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
- Each book is split into persistent TTS-sized audio chunks, while conversion
  controls use the book's chapter/TOC boundaries first. Generation can cover
  the selected/current/next chapter, whole book, +15 minutes, or a single
  backup chunk. Finished chunks are never regenerated unless deleted in a
  future management flow.
- Generation is a work queue, not a single locked job: starting another
  chapter or chunk while one is already generating appends it to the queue
  (deduped) instead of being ignored, and the progress line shows how many
  units are done and how many are still queued. Cancel stops the in-flight
  unit and clears the queue; switching books clears it too.
- Narration options show OpenAI reference pricing for the selected model and
  include per-voice sample buttons. GPT-4o mini TTS exposes accent and
  narration-style presets as structured `instructions`; legacy TTS models
  disable those controls because the speech endpoint does not support
  instructions there. Samples generate a short MP3 through the same OpenAI
  speech endpoint, using the current model, speed, accent, style, and extra
  narration instructions.
- Generated chunks are saved immediately to IndexedDB, so cancelling midway
  preserves the completed MP3s and reloading later can continue from the next
  pending chunk.
- The player is custom, not native browser chrome: previous/next chunk,
  play/pause, +/-30s, quadratic back/forward jumps, seek bar, keyboard
  Left/Right chunk navigation, saved listening position, and preloaded next
  generated chunk. A toggle can keep about one hour of audio generated ahead
  while listening.
- Books keeps local listening/reading history in IndexedDB: play/pause,
  chunk changes, jumps, position samples, dates, per-day listening/read
  totals, and rough read-speed estimates. It is hidden by default and visible
  from the player History button.
- The reader shows parsed book sections and text/audio chunks, tracks reading
  progress, and can search/highlight text locally. Audio chunk markers should
  not render as bulky colored boxes inside the reading text.
- Downloads: original file, current chunk MP3, all generated chunk MP3s
  individually, or one concatenated MP3 made from all generated chunks.
- The library is a compact bookshelf: one row per book with title/author, read
  progress, generated chunk count, estimated duration, and storage
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

The embedded "listen" component used by Phrases (Test), Scales (Sing), and
Intervals (Sing). Each page launches it from a fixed **bottom dock**
(independent of the transport row): scale-degree rails, target-band
outlines, your sung pitch as a yellow trace, and a voice-gated timeline
(time starts when singing is detected).

**The chart draws what you sing.** Rails and targets are for comparison
only; they never gate what is recorded or drawn, and scoring verdicts
never recolor the chart (judgment lives in the readout and progress
line). Off-rails singing (wrong octave, overshoot) draws at its true
pitch - the chart's vertical range expands to cover it. Rejection is
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
