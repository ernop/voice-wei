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
gap, play tones, return to the initial note.

- **Play** plays the current phrase (creating one if needed), **Repeat**
  loops it, **Next** generates a new one, **Stop** stops everything.
- **Reflect** flips the current phrase around the octave (up-from-1
  becomes down-from-8). A view/playback transform, not a regeneration.
- **Per-note on/off markers** under the degrees isolate phrase sections by
  click or drag without losing the phrase.
- **Breakdown** starts from first/last plus one random interior note, then
  adds one note from the largest remaining gap between automatic replays.
  Turn **auto-advance** off to repeat the current subset until **add note**
  advances to the next subset.
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

## Ears

Interval ear training: identification and production.

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

## Books

Ebook to audiobook conversion using OpenAI TTS (key in localStorage).

- Formats: TXT, EPUB, PDF, HTML
- Six voices (Alloy, Echo, Fable, Onyx, Nova, Shimmer), TTS-1 or TTS-1-HD,
  speed 0.25x-4x
- Text is split into ~4000-char chunks, converted with progress shown and
  cancellable, then combined into one downloadable MP3
- Cost ballpark: a 10k-word book is roughly $0.90 (TTS-1) / $1.80 (HD)

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
