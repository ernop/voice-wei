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

Features: direction / repeat / rising / shifting / movement styles /
exercises / section width controls; note length and gap steppers (gap goes
negative for overlap); piano keyboard preview; presets; command history;
hardware media keys (play/pause); **Sing** opens the embedded pitch-trace
panel seeded with the current scale.

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

**Sing** opens the shared pitch-trace panel seeded with the current pattern
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
- **Test** opens the embedded pitch-trace panel for the current phrase
  (see "Pitch test panel" below).
- Hardware media keys: play/pause replay the phrase, next/seek generate
  the next one. (Chrome only routes media keys to pages with real media,
  so the page keeps a silent audio element active after the first tap.)

Setting behaviors (the key design): root/scale changes **reproject** the
current degree sequence into the new context; algorithm, min/max length,
start, and range (in octave / just over / out octave) apply to the **next**
generated phrase; return-to-1 regenerates; playback settings replay;
show-names redraws. "Just over" lets phrases reach two degrees past the
octave - down to 6 below, up to 3 above.

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
- Root/octave/scale draw the scale-degree rails.
- Type degree patterns like `1 2 3 5 3 1` to draw blue target bands; the
  guide interval stepper sets their horizontal spacing.
- Guide sound: piano (default) or sine beep.
- Pause on silence (default on): the clock only advances while you sing.
- 20s window switches to a fixed-width scrolling viewport; Expand range
  adds rails an octave above and below.
- Detections outside the key range are discarded (one-frame octave spikes
  never reach the chart); fast jumps need a confirming sample.

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

Lyrics: LRCLIB lookup with a synced-line overlay, and (on by default, in
settings) the current synced lyric line is relayed into the now-playing
title that Bluetooth/car displays, lock screens, and the tab show -- the
song name moves to the artist slot while a line is active.

Other surfaces on the page:

- **Load Favorites** rebuilds a playlist from the favorited tracks.
- **History / Cache** opens past lookups, the known-songs catalog, and
  the YouTube search cache (all from the `voice-wei-music` IndexedDB);
  selected lookups or songs can be loaded back into the playlist.
- **Local Song Library** imports `.mid`/`.midi`/`.musicxml`/`.xml` melody
  files, keeps them in this browser, and plays their melodies on the
  shared piano. Public-domain corpora to import are listed in
  [public-domain-song-sources.md](public-domain-song-sources.md).

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
Intervals (Sing):
scale-degree rails, target bands, your sung pitch as a yellow trace with
cents-colored dots, and a voice-gated timeline (time starts when singing
is detected).

**Per-note scoring**: once your singing passes a target's window, the band
recolors with its verdict - green (avg within 10 cents), yellow (within
25), red (missed: too far off or not sung) - and the readout keeps a
running score ("Score: 6/8 on pitch (avg 12c)"). A note counts as matched
when at least 30% of its window's samples land within 1.5 semitones, same
thresholds as the Pitch tool. Restart clears the scores with the trace.

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
