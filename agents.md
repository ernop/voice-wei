# Agent Rules and Guidelines

## Project Links

- **GitHub**: https://github.com/ernop/voice-wei
- **Live**: https://fuseki.net/music8899b/scales.html

## ABSOLUTE RULE: No Fallbacks/Hacks for Things We Control

**NEVER add fallbacks or hacks when we control the import/dependency.** Fix the upstream issue, fail loudly, never catch and continue silently.

## Documentation Style

Be concise. State the rule clearly once, avoid repetition. Minimal without losing the point.

## Persona

Minimal. No exuberance. No repetition. No waste. Gets to the point.

- Docstrings ONLY if they add information the code doesn't already say
- NO useless docstrings that just restate the function name

## CRITICAL: BANNED PHRASES

NEVER use "code smell" or similar phrases. Never use "HORRIFIC". Never use emojis.

## Version Bump

Version is **global** across all files: `scales.html`, `player.html`, `pitch-meter.html`

Update TWO things in each file:

1. **Version label** in header:
   ```html
   <span class="version-label">v0.27</span>
   ```

2. **Cache buster query strings** on all local CSS/JS imports:
   ```html
   <link rel="stylesheet" href="style.css?v=27">
   <script src="scales.js?v=27"></script>
   ```

Bump all files together. The `?v=XX` number matches the version minor (v0.26 -> ?v=27).

---

# Scales Architecture

## Core Concepts

The scales feature plays musical patterns. Understanding the hierarchy:

1. **Section Length** - The semitone range we cover (the "canvas")
2. **Scale** - Which notes within that range we play (the "filter")
3. **Root** - Starting note of the section
4. **Direction** - Order we play notes (up, down, up+down, down+up)
5. **Repeat** - Play the section more than once?
6. **Rising** - After playing, move the root note up?
7. **Move** - Rearrange notes within the section (normal, stop-and-go, 1-3-5, from-1)

## Section Length Options

| Setting | Range (semitones) | Example if root=C4 |
|---------|-------------------|-------------------|
| 1 octave | 0 to 12 | C4 to C5 |
| octave+3rd | 0 to 16 | C4 to E5 |
| octave+5th | 0 to 19 | C4 to G5 |
| 2 octaves | 0 to 24 | C4 to C6 |
| centered | -4 to 16 | Ab3 to E5 (3rd below root to 3rd above octave) |

## Scale Types

- **major, minor, etc.** - Play only scale degrees that fall within the section range
- **chromatic** - Play ALL semitones in the section range

## Examples

**C major, octave+5th, up:**
- Section range: 0-19 semitones (C4 to G5)
- Major scale degrees in range: 0,2,4,5,7,9,11,12,14,16,17,19
- Notes: C4, D4, E4, F4, G4, A4, B4, C5, D5, E5, F5, G5 (12 notes)

**C chromatic, octave+5th, up:**
- Same range, all semitones: 20 notes

**C major, 1 octave, up:**
- Range: 0-12 semitones
- Notes: C4, D4, E4, F4, G4, A4, B4, C5 (8 notes - traditional scale)

**C major, centered, up:**
- Range: -4 to +16 semitones
- Major degrees in range: -3(A3), -1(B3), 0(C4), 2, 4, 5, 7, 9, 11, 12, 14, 16
- Notes: A3, B3, C4, D4, E4, F4, G4, A4, B4, C5, D5, E5 (12 notes)

## Implementation Notes

- `SCALE_PATTERNS` in `music-constants.js` defines scale degree intervals
- Section length stored in `settings.sectionLength` ('1o', '1o+3', '1o+5', '2o', 'centered')
- `playScale()` should calculate semitone range from section length, then filter scale pattern to that range

## Movement Styles

Movement styles add extra notes around each **section note**.

### VITAL: Section Notes Are Sacred

1. **Section notes** = the notes determined by scale + section length + direction
2. **Every section note MUST be played AS a section note** - appearing as an "extra" doesn't count
3. **Section ends ONLY after all section notes have been played as section notes**
4. **Movement styles NEVER change which notes are section notes** - they only add extras

### VITAL: Determine Section Notes FIRST, Then Apply Movement

The order is absolute:
1. **FIRST**: Determine section notes based on direction (with deduplication at turn points)
2. **THEN**: Apply movement pattern to those section notes

For up+down, deduplicate at the top:
- Combined: C D E F G A B C B A G F E D C (NOT ...B C **C** B...)

For down+up, deduplicate at the bottom:
- Combined: C5 B A G F E D C D E F G A B C5 (NOT ...D C **C** D...)

### VITAL: Timing Rules

1. **All notes use normal note-to-note gap** (default 0ms)
2. **No movement style can EVER add extra gaps** - this is absolute
3. **Section divider (1s gap)**: ONLY after the ENTIRE section finishes, ONLY when repeating forever

### VITAL: Round-Trip Final Note

For **up+down** and **down+up** directions: the **final section note has NO move notes**.
It's the resolution - you land on it cleanly without extras.

For single directions (up or down only): move notes still play on final note.

### Direction-Aware vs Direction-Independent Styles

**Direction-INDEPENDENT** (extras always go the same way regardless of direction):
- `stop_and_go`: ALWAYS adds notes ABOVE (higher pitch)
- `one_three_five`: ALWAYS adds 3rd and 5th ABOVE
- `chords`: ALWAYS plays root + 3rd + 5th simultaneously
- `from_one`: ALWAYS plays root BEFORE section note

**Direction-AWARE** (extras follow the current direction):
- `neighbors`: In ascending part: section, above, below. In descending part: section, below, above.

### Styles Reference

| Style | Pattern | Example (C major octave) |
|-------|---------|--------------------------|
| normal | section note only | C, D, E, F, G, A, B, C |
| stop_and_go | section + 2 above | Cde, Def, Efg... |
| one_three_five | section + diatonic 3rd + 5th | Ceg, Dfa, Egb... |
| neighbors | section + with-dir + against-dir | Cdb, Dec, Efd... (ascending) |
| chords | section + 3rd + 5th simultaneous | [CEG], [DFA], [EGB]... |
| from_one | root THEN section | cC, cD, cE, cF... |

### 1-3-5 Uses Diatonic Intervals

The 3rd and 5th are **diatonic** based on scale type:
- **Minor scales** (minor, natural_minor, dorian, phrygian, aeolian): minor 3rd (3 semitones)
- **Major scales** (major, lydian, mixolydian): major 3rd (4 semitones)
- **Chromatic/other**: defaults to major intervals
- **Fifth**: always perfect 5th (7 semitones)

### Explicit Group Structure

Groups are objects with explicit metadata - no guessing required:

```javascript
{
    notes: ['C4', 'D4', 'E4'],  // playback order
    sectionIndex: 0,            // which note is THE section note
    isChord: false              // play simultaneously?
}
```

Examples:
- stop_and_go: `{ notes: ['C4', 'D4', 'E4'], sectionIndex: 0 }` - section first
- from_one: `{ notes: ['C4', 'D4'], sectionIndex: 1 }` - section LAST
- chords: `{ notes: ['C4', 'E4', 'G4'], sectionIndex: 0, isChord: true }`

The playback and display code reads these properties directly. No special-casing by style name.

### Finding Notes Above/Below (Pure Music Theory)

`getNotesAbove` and `getNotesBelow` use pure arithmetic, not array manipulation:

1. Extract scale pattern (note names only): `[C, D, E, F, G, A, B]`
2. Find note's position in pattern
3. Calculate next position with modular arithmetic
4. Bump octave when wrapping around

For B4 in C major, "2 notes above":
- B is at index 6
- Next (i=1): (6+1) % 7 = 0 = C, octave bumps to 5 → C5
- Next (i=2): (6+2) % 7 = 1 = D, same octave 5 → D5
- Result: [C5, D5]

No "extending the scale array" needed. No duplicate notes possible.
