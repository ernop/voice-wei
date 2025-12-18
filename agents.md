# Agent Rules and Guidelines

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

- Version label: `<span class="version-label">v00.0000xx</span>`
- Files: `player.html`, `pitch-meter.html`, `scales.html`
- Bump rule: increment final 3 digits by 1

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
- **continuous** - Smooth frequency glide through the entire range (no discrete notes)

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

Movement styles add extra notes after each **section note**.

### VITAL: Section Notes Are Sacred

1. **Section notes** = the notes determined by scale + section length + direction
2. **Every section note MUST be played AS a section note** - appearing as an "extra" doesn't count
3. **Section ends ONLY after all section notes have been played as section notes**
4. **Movement styles NEVER change which notes are section notes** - they only add extras after each one

### VITAL: Determine Section Notes FIRST, Then Apply Movement

The order is absolute:
1. **FIRST**: Determine section notes based on direction (with deduplication at turn points)
2. **THEN**: Apply movement pattern to those section notes

For up+down, deduplicate at the top:
- Ascending: C D E F G A B C
- Descending: C B A G F E D C  
- Combined: C D E F G A B C B A G F E D C (NOT C D E F G A B C **C** B A G F E D C)

For down+up, deduplicate at the bottom:
- Descending: C5 B A G F E D C
- Ascending: C D E F G A B C5
- Combined: C5 B A G F E D C D E F G A B C5 (NOT ...D C **C** D...)

### VITAL: Timing Rules

1. **All notes use normal note-to-note gap** (default 0ms)
2. **No movement style can EVER add extra gaps** - this is absolute
3. **Section divider (1s gap)**: ONLY after the ENTIRE section finishes, ONLY when repeating forever

### VITAL: Direction vs Movement Are Independent

**Direction** (up, down, up+down, down+up) ONLY controls the ORDER of section notes.

**Movement extras** have FIXED rules that NEVER change based on direction:
- Extras are ALWAYS found relative to the ascending scale
- `stop_and_go`: ALWAYS adds notes ABOVE (higher pitch)
- `one_three_five`: ALWAYS adds 3rd and 5th ABOVE
- `neighbors`: ALWAYS lower neighbor then upper neighbor
- `plus_semitone`: ALWAYS +1 semitone (chromatic, ignores scale)
- `from_one`: section note then root

Example - C major **down** with stop_and_go:
- Section notes in descending order: C5, B4, A4, G4, F4, E4, D4, C4
- Each gets extras ABOVE: C5-D5-E5, B4-C5-D5, A4-B4-C5, G4-A4-B4...
- The extras go UP even though we're in the "down" part

### Styles Reference

| Style | Pattern | Example (C major octave) |
|-------|---------|--------------------------|
| normal | section note only | C, D, E, F, G, A, B, C |
| stop_and_go | section note + 2 above | C-D-E, D-E-F, E-F-G... |
| one_three_five | section note + 3rd + 5th | C-E-G, D-F-A, E-G-B... |
| neighbors | section note + below + above | C-B-D, D-C-E, E-D-F... |
| plus_semitone | section note + chromatic up | C-C#, D-D#, E-F... |
| from_one | section note + root | C-C, D-C, E-C, F-C... |

### Implementation

- `degreesAscendingRef` is always passed to `buildMovementSequence` - the ascending scale used to find notes above/below
- `getNotesAbove(note, scale, count)` finds N notes higher than the given note
- `getNotesBelow(note, scale, count)` finds N notes lower than the given note
- Extended scales (octave up/down) ensure extras are available even for boundary notes
