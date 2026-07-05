# Scales Voice Command Grammar

The complete spoken grammar for the Scales page. How the page itself works
(controls, piano keyboard, Sing panel) is in [tools.md](tools.md); setting
defaults and change behavior are in [parameters.md](parameters.md); the
engine rules behind movement styles and exercises are in
[architecture.md](architecture.md).

## How commands are interpreted

1. Click **Listen**, speak, and the command is parsed on the final result.
2. **Full commands reset settings to defaults first**, then apply your
   modifiers - "D minor" always sounds the same regardless of prior UI
   state. Playback starts automatically.
3. **Standalone setting commands** (a bare modifier like "slowly",
   "staccato", "thirds up", "octave 3") change just that setting and
   restart playback live if something is playing.
4. Say `stop` anytime to stop playback; `play` replays the current
   settings.

## Phonetic aliases

Speech recognition often mishears note names. These are automatically
recognized:

| Note | Also recognized as |
|------|-------------------|
| C | see, sea, si, cee |
| D | dee, the |
| E | ee, he |
| F | eff, ef, half |
| G | gee, jee, ji |
| A | ay, hey, eh, eight |
| B | bee, be, bea |

| Modifier | Also recognized as |
|----------|-------------------|
| sharp | shop, sharpe, shark |
| flat | flap, flight |

Example: "see major scale" = "C major scale", "bee flat minor" = "Bb minor".

## Base commands

### Scales

| Command | Result |
|---------|--------|
| `scale` | C major scale (default) |
| `D scale` | D major scale |
| `A minor scale` | A natural minor |
| `harmonic minor` / `A harmonic minor` | Harmonic minor (raised 7th) |
| `melodic minor` | Jazz melodic minor (same up and down) |
| `chromatic scale` / `chromatic from E` | All 12 semitones |
| `pentatonic` / `minor pentatonic` | Major / minor pentatonic |

Supported scale patterns (the `SCALE_PATTERNS` registry in
`music-constants.js`):

| Scale | Semitone pattern |
|-------|------------------|
| Major | 0 2 4 5 7 9 11 12 |
| Natural minor | 0 2 3 5 7 8 10 12 |
| Harmonic minor | 0 2 3 5 7 8 11 12 |
| Melodic minor | 0 2 3 5 7 9 11 12 |
| Chromatic | 0 1 2 3 ... 12 |
| Major pentatonic | 0 2 4 7 9 12 |
| Minor pentatonic | 0 3 5 7 10 12 |

### Notes, chords, intervals, arpeggios

| Command | Result |
|---------|--------|
| `C` / `play C` | Single note |
| `F sharp`, `B flat` | Accidentals |
| `C chord` / `A minor chord` | Triad |
| `tuning` / `A 440` / `concert A` / `reference` | A440 reference tone |
| `fifth` / `5th` | Perfect 5th from C |
| `third from G` | Major 3rd from G |
| `minor third` | Minor 3rd from C |
| `perfect fifth from D` | Perfect 5th from D |
| `arpeggio` / `D minor arpeggio` | Arpeggio |

Supported interval names: unison, 2nd, 3rd, 4th, 5th, 6th, 7th, octave.

## Modifiers

Modifiers combine with any scale, arpeggio, or interval command
("slowly chromatic scale", "G major up and down twice").

### Note length (tempo)

| Voice command | Note duration |
|---------------|---------------|
| `very fast` / `very quickly` | 100ms |
| `fast` / `quickly` | 150ms |
| *(default)* | 300ms |
| `normal` | 500ms |
| `slowly` / `slow` | 1000ms |
| `very slowly` | 2000ms |
| `super slowly` | 5000ms |

The UI note-length stepper offers the finer shared preset list (see
"Shared step presets" in [parameters.md](parameters.md)).

### Gaps between notes

| Modifier | Gap |
|----------|-----|
| `legato` / no modifier | 0 (none) |
| `with a gap` / `with a small gap` | 50ms |
| `with a large gap` / `staccato` | 300ms |
| `with a very large gap` | 500ms |

### Repetition

| Modifier | Effect |
|----------|--------|
| *(default)* | Play once |
| `twice` / `repeat twice` / `two times` | Play 2 times |
| `repeat` / `loop` / `forever` | Loop until "stop", ~1s gap between repeats |
| `forever no gap` | Loop until "stop" with no gap between repeats |

### Direction

| Modifier | Effect |
|----------|--------|
| `ascending` / `going up` | Upward only (default) |
| `descending` / `going down` | Downward only |
| `up and down` / `both ways` | Up then down |
| `down and up` | Down then up |

### Range and width

| Modifier | Effect |
|----------|--------|
| `wide` | Extra scale notes on each end (range expansion) |
| `very wide` | More extra notes on each end |
| `octave plus third` / `1o+3` | Section spans octave + major 3rd |
| `octave plus fifth` / `1o+5` | Section spans octave + perfect 5th |
| `two octaves` / `double octave` | Section spans 2 octaves |

### Octave (standalone)

`octave 2` .. `octave 6` (or just a bare `3`, `4`...) moves the starting
octave. Note commands take an explicit octave too ("play C 5").

## Movement styles

Movement styles add extra notes around each section note; section notes
are never replaced (see "Scales engine rules" in
[architecture.md](architecture.md)).

| Style | Voice command | Example (C major up) |
|-------|---------------|---------------------|
| +1+2 | `stop and go` | C-D-E, D-E-F, E-F-G... |
| 1-3-5 | `one three five`, `triads` | C-E-G, D-F-A, E-G-B... |
| neighbors | `neighbors` | Direction-aware: C-D-B up, C-B-D down |
| from 1 | `from one`, `from the root` | c-D, c-E, c-F... |
| to 1 | `to one`, `interleave`, `return to root` | D-c, E-c, F-c... |
| +1-1 | `plus minus one`, `dance around` | C-D-B, D-E-C, E-F-D... |
| chords | `chords` | [CEG], [DFA], [EGB]... |
| +1+2 chromatic | `chromatic stop and go`, `chromatic steps` | C-C#-D, D-D#-E... |
| +1-1 chromatic | `plus minus half`, `chromatic neighbors` | C-C#-B, D-D#-C#... |
| 3rd..7th up | `thirds up` ... `sevenths up` | thirds up: C-E, D-F, E-G... |
| 3rd..7th down | `thirds down` ... `sevenths down` | thirds down: C-A, D-B, E-C... |

## Exercises

Degree-offset presets (with `O` as the octave placeholder), which default
to shifting mode:

| Exercise | Voice command | Pattern |
|----------|---------------|---------|
| 5-note | `five note warmup`, `warmup` | 1-2-3-4-5-4-3-2-1 |
| oct jump | `octave jump` | 1-8-1 |
| arp return | `arpeggio return`, `arp return` | 1-3-5-8-5-3-1 |
| thirds | `thirds`, `skip pattern` | 1-3-2-4-3-5-4-6... |

## Rising and shifting

| Mode | Voice command | Behavior |
|------|---------------|----------|
| Rising | `rising`, `modulating`, `transpose` | Transposes the whole scale up each repeat (C major -> D major -> ...); `rising half step` / `whole step` / `minor third` / `fourth` / `fifth` choose the step; `no rising` turns it off |
| Shifting | `shifting`, `walking` | Moves the start within the same scale (C-D-E-F-G -> D-E-F-G-A, staying in C major) |

Both imply repeat-forever and are mutually exclusive.

## Example combinations

```
"D minor scale"
"slowly chromatic scale"
"G major up and down"
"descending pentatonic"
"wide C major slowly"
"double octave harmonic minor"
"A minor repeat forever"
"quickly chromatic twice"
"five note warmup rising half step"
```

## Tips

- Enable **Echo commands** in the voice panel to hear what was understood
  when recognition misbehaves.
- Say `help` while listening for a spoken summary of the grammar.
