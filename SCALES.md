# Scales - Voice-Wei

A voice-first tool for singers and musicians to practice scales, intervals, arpeggios, and ear training with realistic piano sounds.

## Overview

The Scales page is a **voice-first, click-second** interface. Everything you can say is also visible and clickable in the UI. The current settings are always displayed, making it easy to understand what will play.

**Key Features:**
- **Voice Commands**: Speak naturally to play scales, chords, intervals
- **Bidirectional Controls**: Click any option or say it - both update the same state
- **Live Status**: Shows current command set + playing note (e.g., "D minor | short | E4 [2nd]")
- **Realistic Piano**: Salamander Grand Piano samples via Tone.js
- **Instant Feedback**: See what you said in real-time while speaking

---

## Quick Start

1. Click **Listen** and say: "D minor scale"
2. Or click options (Root: D, Scale: minor) then click **Play**
3. Say "stop" or click **Stop** to end playback
4. Say "play" or click **Play** to repeat with current settings

---

## Voice Commands

### Phonetic Aliases

Speech recognition often mishears note names. These aliases are automatically recognized:

| Note | Also Recognized As |
|------|-------------------|
| C | see, sea, si, cee |
| D | dee, the |
| E | ee, he |
| F | eff, ef, half |
| G | gee, jee, ji |
| A | ay, hey, eh, eight |
| B | bee, be, bea |

| Modifier | Also Recognized As |
|----------|-------------------|
| sharp | shop, sharpe, shark |
| flat | flap, flight |

Example: "see major scale" = "C major scale", "bee flat minor" = "Bb minor"

---

### Scales

| Command | Description |
|---------|-------------|
| `scale` | C major scale (default) |
| `D scale` | D major scale |
| `A minor scale` | A natural minor |
| `chromatic scale` | All 12 semitones |
| `chromatic from E` | Chromatic starting on E |
| `pentatonic` | C major pentatonic |
| `minor pentatonic` | C minor pentatonic |

#### Harmonic Scales
| Command | Description | Intervals |
|---------|-------------|-----------|
| `harmonic minor` | Raised 7th | 1 2 b3 4 5 b6 7 |
| `A harmonic minor` | From A | A B C D E F G# A |
| `melodic minor` | Jazz melodic (same up/down) | 1 2 b3 4 5 6 7 |

### Notes & Chords

| Command | Result |
|---------|--------|
| `C` or `play C` | Single C note |
| `F sharp` | F# note |
| `B flat` | Bb note |
| `C chord` | C major chord (triad) |
| `A minor chord` | A minor chord |
| `tuning` | A440 reference tone |

### Intervals

Both word and numeric forms are accepted:

| Command | Result |
|---------|--------|
| `fifth` or `5th` | Perfect 5th from C |
| `third from G` | Major 3rd from G |
| `minor third` | Minor 3rd from C |
| `perfect fifth from D` | Perfect 5th from D |

Supported intervals: unison, 2nd, 3rd, 4th, 5th, 6th, 7th, octave

### Arpeggios

| Command | Result |
|---------|--------|
| `arpeggio` | C major arpeggio |
| `D minor arpeggio` | D minor arpeggio |

---

## Modifiers

Modifiers can be combined with any scale, arpeggio, or interval command.

### Note Length (Tempo)
| Voice Command | Note Duration |
|---------------|---------------|
| `very fast` | 150ms (v.short) |
| `fast` / `quickly` | 300ms (short) |
| *(default)* | 500ms (normal) |
| `slowly` | 800ms (long) |
| `very slowly` | 1500ms (v.long) |
| `super slowly` | 3000ms (super) |

### Gaps (Pauses Between Notes)
| Modifier | Effect |
|----------|--------|
| `legato` / no modifier | No gap (none) |
| `with a gap` / `small gap` | 50ms (small) |
| `with a medium gap` | 150ms (medium) |
| `staccato` / `large gap` | 300ms (large) |

### Repetition
| Modifier | Effect |
|----------|--------|
| *(default)* | Play once, stop (off) |
| `once` | Play one time |
| `twice` | Play 2 times |
| `repeat` / `loop` / `forever` / `forever` | Loop until "stop" |
| `forever` | Loop until "stop" with a ~0.2s gap between sections (not the between-notes gap) |
| `forever no gap` | Loop until "stop", with no gap between sections (not the between-notes gap) |

### Direction
| Modifier | Effect |
|----------|--------|
| `ascending` / `going up` | Upward only (default) |
| `descending` / `going down` | Downward only |
| `up and down` / `both ways` | Up then down |
| `down and up` | Down then up |

### Range (Wide Scale)
| Modifier | Effect |
|----------|--------|
| `wide` | Expand range by 3 notes on each end |
| `very wide` | Expand range by 5 notes on each end |
| `narrow` | No range expansion (normal) |

The "wide scale" feature adds extra chromatic notes below the root and above the top of the scale.

### Octave Span
| Modifier | Effect |
|----------|--------|
| `single octave` | Normal 1-octave scale (default) |
| `double octave` / `two octaves` | Play scale over 2 octaves |

### Octave Selection
| Modifier | Effect |
|----------|--------|
| `octave 3` / `3` | Start in octave 3 |
| `octave 4` / `4` | Start in octave 4 (default) |
| `octave 5` / `5` | Start in octave 5 |

### Example Combinations

```
"D minor scale"
"slowly chromatic scale"
"G major up and down"
"descending pentatonic"
"wide C major slowly"
"double octave harmonic minor"
"A minor repeat forever"
"quickly chromatic twice"
```

---

## UI Controls

The UI uses a **compact inline layout** with labels on the left and clickable options on the right.

### Control Rows

| Row | Options | Default |
|-----|---------|---------|
| **Repeat** | once, twice, forever | once |
| **Root** | C, C#, D, D#, E, F, F#, G, G#, A, A#, B | C |
| **Octave** | 2, 3, 4, 5, 6 | 4 |
| **Scale** | major, minor, chromatic, pentatonic, harmonic minor, melodic minor | major |
| **Direction** | up, down, up+down, down+up | up |
| **Note Length** | v.short, short, normal, long, v.long, super | normal |
| **Gap** | none, small, medium, large | none |
| **Span** | 1 octave, 2 octaves | 1 octave |
| **Wide** | off, +2, +3, +4, +5, +6 | off |

### Main Buttons

| Button | Action |
|--------|--------|
| **Listen** | Start voice recognition |
| **Stop** | Stop playback and cancel listening |
| **Play** | Play current settings |
| **Reset** | Return all settings to defaults |

### Voice Controls

Say these words anytime during listening:
- `stop` - Stop playback
- `play` - Play current settings

### Status Bar

The status bar shows the current command set during playback:

```
D minor | short | E4 [2nd]
```

- Always shows: root + scale type
- Shows non-default options: direction, tempo, gap, octave span, wide, repeat
- Shows current note with interval name

---

## Piano Keyboard

- **15 white keys** spanning ~2 octaves (C4 to C6 when Octave=4)
- **10 black keys** for sharps
- **Click keys** to play individual notes
- **Octave control** shifts the entire keyboard
- **Active keys highlight** during scale playback
- **C notes labeled** with octave number (C4, C5, C6)

---

## How Voice-First Works

1. **Click Listen** - starts voice recognition
2. **Speak your command** - e.g., "D minor descending slowly"
3. **Settings reset to defaults** - then your modifiers are applied
4. **UI updates** - shows what was understood
5. **Scale plays automatically** - no need to click Play
6. **Click Play** to repeat the same settings

The key insight: voice commands always start from defaults, then apply what you said. This means "D minor" always plays the same way, regardless of what buttons were previously clicked.

---

## Priority System

Voice modifiers override UI settings:

1. **Voice modifiers** (highest): "slowly", "with a gap", etc.
2. **UI buttons**: Used when no voice modifier specified
3. **Built-in defaults**: normal tempo, no gap, ascending

Example: If Note Length is "short" but you say "slowly chromatic scale", it plays slow.

---

## Technical Details

### Audio Engine
- **Tone.js** with Salamander Grand Piano samples
- Samples loaded from Tone.js CDN
- Gain node for instant audio cutoff on Stop

### Voice Recognition
- Web Speech API (browser native)
- Auto-submit mode: Processes immediately on final result
- Live interim display while speaking

### Architecture
- `voice-command-core.js`: Reusable voice input abstraction
- `scales.js`: Scale-specific command parsing and execution
- `scales.html` / `scales.css`: UI components

---

## Scale Patterns Reference

| Scale | Semitone Pattern |
|-------|------------------|
| Major | 0 2 4 5 7 9 11 12 |
| Natural Minor | 0 2 3 5 7 8 10 12 |
| Harmonic Minor | 0 2 3 5 7 8 11 12 |
| Melodic Minor | 0 2 3 5 7 9 11 12 |
| Chromatic | 0 1 2 3 4 5 6 7 8 9 10 11 12 |
| Major Pentatonic | 0 2 4 7 9 12 |
| Minor Pentatonic | 0 3 5 7 10 12 |

---

## Usage Tips

1. **For ear training**: Use "twice" or "forever" repeat
2. **For slow practice**: Say "very slowly" or "super slowly"
3. **For interval recognition**: Use "minor third", "perfect fifth", etc.
4. **Debug recognition issues**: Enable "Echo commands" checkbox to hear what was understood
5. **Quick repetition**: Just say "play" or click the Play button

---

## Vision: Extra Note Patterns (Under Development)

The goal is to support more sophisticated vocal training patterns beyond basic scales. These patterns add "extra notes" (also called "grace notes") around each scale note.

### Pattern Types

| Pattern | Voice Command | Description | Example (C major up) |
|---------|---------------|-------------|---------------------|
| +1+2 | "stop and go" | Add next 2 scale degrees | C-D-E, D-E-F, E-F-G... |
| 1-3-5 | "one three five", "triads" | Add 3rd and 5th above | C-E-G, D-F-A, E-G-B... |
| neighbors | "neighbors" | Direction-aware: above then below (or reverse) | C-D-B, D-E-C, E-F-D... |
| from 1 | "from one", "from the root" | Root first, then section note | c-D, c-E, c-F, c-G... |
| to 1 | "to one", "interleave", "return to root" | Section note, then back to root | D-c, E-c, F-c, G-c... |
| +1-1 | "plus minus one", "dance around" | Section, above, below | C-D-B, D-E-C, E-F-D... |
| chords | "chords" | Play as simultaneous chord | [CEG], [DFA], [EGB]... |

### Key Concepts

**Scale Notes vs Extra Notes:**
- **Scale notes**: The core scale degrees (1-8 in an octave) - these define the progression
- **Extra notes**: Embellishments that can extend beyond the scale range (to 9, 10, etc.)
- Every scale note MUST be played as a scale note - extra notes don't substitute

**Connectedness (Turnaround Logic):**
Like running up steps and turning around - you don't take two steps on the same spot:
- **WRONG**: 1-2-3-4-5-6-7-8-**8**-7-6-5-4-3-2-1
- **RIGHT**: 1-2-3-4-5-6-7-8-7-6-5-4-3-2-1

When looping without gaps, same at bottom: ...3-2-1-2-3... (not 1-**1**-2)

**Clean Endings:**
Extra notes do NOT extend past the final note. The ear expects resolution:
- With +1,+2 ending: ...3-4-5, 2-3-4, **1** (stops clean, no 1-2-3)

### Rising Exercises (Future)

Professional vocal exercises often use "rising" patterns where each repetition shifts up:

```
1-2-3-4-5-4-3-2-1  (starting on C)
2-3-4-5-6-5-4-3-2  (starting on D)
3-4-5-6-7-6-5-4-3  (starting on E)
4-5-6-7-8-7-6-5-4  (starting on F)
...
```

This trains the voice across ranges while keeping the pattern familiar.

---

## Vision: Pitch Detection ("Also Listen" Mode)

Future feature: toggle microphone listening during scale playback to provide pitch accuracy feedback.

**Concept:**
- Play scale notes as reference
- Listen to user's voice simultaneously
- Show visual meter: how close to the target pitch
- Provide guidance: "go down a little bit"
- Grade overall accuracy

**Technical Considerations:**
- May work even with overlapping audio (speaker + microphone)
- Needs to distinguish target pitch from played audio
- Visual feedback should be immediate (no lag)

---

## Deployment

Files to sync:
```
scales.html
scales.js
scales.css
voice-command-core.js
style.css (shared)
```

See `rsync-command.txt` for deployment commands.
