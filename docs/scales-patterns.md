# Scales Patterns

What each option on the Scales page plays. How the page works (controls,
piano keyboard, Sing panel) is in [tools.md](tools.md); setting defaults
and change behavior are in [parameters.md](parameters.md); the engine
rules behind movement styles and exercises are in
[architecture.md](architecture.md).

## Scales

The Scale row's twelve-tone scales (patterns from the `SCALE_PATTERNS`
registry in `music-constants.js`):

| Button | Semitone pattern |
|--------|------------------|
| major | 0 2 4 5 7 9 11 12 |
| minor | 0 2 3 5 7 8 10 12 (natural minor) |
| harmonic minor | 0 2 3 5 7 8 11 12 |
| melodic minor | 0 2 3 5 7 9 11 12 (jazz: the same up and down) |
| chromatic | 0 1 2 3 ... 12 |
| pentatonic | 0 2 4 7 9 12 (major pentatonic) |

The registry holds more scales (modes, blues, whole tone, ...) for the
other pages; Scales offers only the ones on its buttons.

### Microtonal scales

Fractional semitones (0.5 = one quarter tone) play at exact pitch; note
names show the nearest note plus a signed cents offset: `E4-50c` is E
lowered a quarter tone (the rast neutral third), `D4+40c` a slendro
step. (Arrows are not used - degree labels already use them for octave
displacement.)

| Button | Semitone pattern | What to listen for |
|--------|------------------|--------------------|
| quarter tone | 0 0.5 1 1.5 ... 12 | The 50-cent step itself - half of a half step |
| rast | 0 2 3.5 5 7 9 10.5 12 | Major-like, but the 3rd and 7th sit exactly between major and minor |
| bayati | 0 1.5 3 5 7 8 10 12 | The neutral 2nd - the signature step of much Arabic melody |
| sikah | 0 1.5 3.5 5.5 7 8.5 10.5 12 | A whole mode floating a quarter tone off the piano grid |
| slendro | 0 2.4 4.8 7.2 9.6 12 | Five equal steps; no perfect 5th, gamelan flavor |
| just major | 0 2.04 3.86 4.98 7.02 8.84 10.88 12 | Pure-ratio major; compare its sweeter 3rd against equal-tempered major |

## Section Width

| Button | The section spans |
|--------|-------------------|
| 1 octave | One octave (default) |
| octave+3rd | An octave plus a major 3rd |
| octave+5th | An octave plus a perfect 5th |
| 2 octaves | Two octaves |

The keyboard always shows three scale notes beyond each end of what plays.

## Direction

| Button | Plays |
|--------|-------|
| up | Upward only (default) |
| down | Downward only |
| up+down | Up, then down; the peak plays once |
| down+up | Down, then up |

## Repeat

| Button | Plays |
|--------|-------|
| once | One pass (default) |
| twice | Two passes, 1.5s between them |
| ∞ | Until Stop, 1s between passes |
| ∞+no gap | Until Stop, straight through |

## Move and Leaps

The two rows set one movement style between them: exactly one button
across both is lit, and **normal** (the plain walk) is the default.
Movement styles add extra notes around each section note; section notes
are never replaced (see "Scales engine rules" in
[architecture.md](architecture.md)).

| Row | Button | Example (C major up) |
|-----|--------|---------------------|
| Move | +1+2 | C-D-E, D-E-F, E-F-G... |
| Move | 1-3-5 | C-E-G, D-F-A, E-G-B... |
| Move | neighbors | Direction-aware: C-D-B up, C-B-D down |
| Move | chords | [CEG], [DFA], [EGB]... |
| Move | from 1 | c-D, c-E, c-F... |
| Move | to 1 | D-c, E-c, F-c... |
| Move | +1-1 | C-D-B, D-E-C, E-F-D... |
| Move | +1+2 chrom | C-C#-D, D-D#-E... |
| Move | +1-1 chrom | C-C#-B, D-D#-C#... |
| Leaps | 3rd up ... 7th up | 3rd up: C-E, D-F, E-G... |
| Leaps | 3rd down ... 7th down | 3rd down: C-A, D-B, E-C... |

## Exercises

Degree patterns, with `O` as the scale's own octave. Choosing one turns
Shifting on.

| Button | Pattern |
|--------|---------|
| full scale | The plain scale (default) |
| 5-note | 1-2-3-4-5-4-3-2-1 |
| octave jump | 1-8-1 |
| arp return | 1-3-5-8-5-3-1 |
| thirds | 1-3-2-4-3-5-4-6... |

## Rising, Shifting, Chop Head, and Ladder

| Row | Buttons | Behavior |
|-----|---------|----------|
| Rising | off, half, whole | Transposes the whole scale up each repeat by a half or whole step (C major -> C# major -> ...) |
| Shifting | off, on | Moves the start within the same scale (C-D-E-F-G -> D-E-F-G-A, staying in C major) |
| Chop Head | off, on | Each pass drops one more leading note (1-2-3-4-5-6-7-8, then 2-3-4-5-6-7-8, then 3-4-5-6-7-8, ... down to the last note) |
| Ladder | off, on, reverse | **on**: overlapping rungs shifting one degree per rung: 1-2-3, 2-3-4, 3-4-5, ... **reverse**: each rung plays against the direction of travel, so it leads with the one note not heard yet: 3-2-1, 4-3-2, 5-4-3, ... |

Rising and shifting imply repeat-forever. Chop head plays one shrinking
cycle per repeat (twice = two full cycles; forever loops the cycle).

The ladder follows the Direction and Section Width settings (a two-octave
section gives a two-octave climb) and plays one full climb per repeat
(forever loops it with the usual repeat gap). The rung size (2-8 notes,
"Rung Notes") and the pause between rungs ("Rung Gap"; 0 plays straight
through) are steppers on the Ladder row. Rising composes with the ladder:
each full climb transposes up.

At the range boundaries the ladder never stops early and never invents
notes beyond the range:

- **A terminal end plays out**: rung starts keep walking and the windows
  clip, shrinking to the last note. Plain up with rungs of 3 ends
  6-7-8, 7-8, 8; with rungs of 5 it ends 4-5-6-7-8, 5-6-7-8, 6-7-8,
  7-8, 8. Plain down mirrors this at the bottom (3-2-1, 2-1, 1).
- **A mid-cycle turnaround reflects**: windows fold over the peak, so
  up+down runs ... 5-6-7, 6-7-8, 7-8-7, 8-7-6, 7-6-5 ... and then plays
  out its ending at the bottom (3-2-1, 2-1, 1). Down+up reflects at the
  bottom (... 2-1-2 ...) and plays out at the top.
- **Forever with no gap reflects on both ends**: up+down / down+up loops
  are one seamless triangle - the loop seam is just another rung
  boundary (... 3-2-1, 2-1-2, 1-2-3 ...), with the rung gap between all
  rungs. Plain up or down forever-no-gap just plays out and starts over.

Chop head and the ladder each own the played sequence, so enabling either
one clears the other along with any exercise or movement style. Rising,
shifting, and chop head remain mutually exclusive.
