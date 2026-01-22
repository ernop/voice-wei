# Voice Music Control - Product Vision

## The Problem

Existing music apps while driving are dangerous and frustrating:

1. **Eyes off road**: Spotify, YouTube Music, Apple Music - all require looking at the screen to search, browse, select
2. **Hands off wheel**: Typing searches, scrolling lists, tapping small buttons
3. **Rigid search**: You need to know exact song/artist names. "That song from the 80s with the saxophone" returns nothing useful
4. **Single result mentality**: Search returns one "best match" - if it's wrong, start over
5. **No discovery**: Voice assistants play one song. No "here are five jazz tracks you might like"
6. **Dumb assistants**: Siri/Google understand "play Hotel California" but not "play something mellow for a long drive" or "what was that Beatles song about a yellow vehicle"

## The Vision

A voice-first music controller that understands intent, not just commands.

**One large button. Speak naturally. Get a playlist.**

- "Play some jazz" - Get 5 jazz tracks with explanations
- "Something upbeat for the gym" - AI picks energetic songs
- "That Beatles song with the submarine" - AI figures it out
- "Play Hotel California and other classic rock road trip songs" - Full playlist

The AI becomes your co-pilot DJ who actually understands what you want.

## Core Design Principles

### 1. Eyes-Free Operation
- Single giant "Listen" button - can hit without looking
- Voice commands for everything: play, pause, next, skip, shuffle, clear
- Status spoken aloud (optional)
- No scrolling required for basic operation

### 2. Minimal Interaction Required
- One tap to listen, one phrase to play
- Auto-submit mode: just speak, it processes when you stop
- Manual mode for noisy environments: say "submit" to send
- Large touch targets for all controls (80-100px buttons)

### 3. AI-Powered Understanding
- Claude interprets vague requests: "something chill" becomes specific songs
- Each song comes with a comment explaining why it matches
- Handles follow-ups: "more like that" (future)

### 4. Playlist-First Results
- Every search returns multiple songs (typically 3-5)
- Browse visually when stopped, or just hit play for the first one
- Shuffle, clear, manage via voice
- Auto-advance to next song

### 5. Transparency
- See what you said (transcript)
- See what was sent to Claude (prompt)
- See Claude's response (songs + comments)
- See errors clearly (debug panel)
- Choose your AI model (Haiku for speed, Opus for capability)

## Features Implemented

### Voice Input
- **Web Speech API**: Browser-native speech recognition (no external service, works offline for recognition)
- **Auto-submit mode**: Speak, pause, auto-processes
- **Manual mode**: Continuous listening, say "submit" or tap button
- **Interim results**: See transcription in real-time (manual mode)

### AI Integration
- **Claude Haiku 4.5 / Opus 4.5**: Interpret music requests
- **Structured output**: Returns JSON array of songs with comments
- **Text-to-speech**: Claude responses read aloud (optional)
- **Model selection**: Switch between Haiku (fast) and Opus (smart)

### Music Playback
- **YouTube integration**: Search via Data API v3, play via IFrame API
- **Central player**: Shows current song, artist at top
- **Playlist below**: All songs with comments, individual play buttons
- **Transport controls**: Play/pause, stop, next, previous, rewind, fast-forward
- **Auto-advance**: Next song plays when current ends
- **Shuffle**: Randomize playlist order
- **Smart pause during voice**: Music pauses when you tap Listen, resumes while waiting for Claude, pauses again when response arrives and is read aloud

### Voice Commands
| Command | Action |
|---------|--------|
| "play" / "start" / "resume" | Play playlist |
| "pause" / "halt" | Pause current song |
| "stop" | Stop playback |
| "next" / "skip" | Next song |
| "previous" / "prev" / "back" | Previous song |
| "fast forward" | Skip 10 seconds |
| "rewind" | Back 10 seconds |
| "shuffle" / "randomize" | Shuffle playlist |
| "clear" / "empty" | Clear playlist |
| "what's playing" / "current song" | Announce current song |
| "help" / "commands" | List available commands |
| "submit" | Submit pending command (manual mode) |

### Settings
- **Read responses aloud**: TTS for Claude replies
- **Auto-submit mode**: Toggle between auto and manual
- **Model selection**: Haiku 4.5 or Opus 4.5

### Debug Panel
- Fixed bottom 1/3 of screen
- Shows: user messages, Claude requests/responses, errors
- All JavaScript errors caught and displayed
- Clear button to reset

### UI/UX
- **Full-width layout**: No wasted space
- **Large touch targets**: 150px listen button, 80-100px controls
- **Mobile-optimized**: Touch-friendly, no hover-only features
- **Visual feedback**: Pulsing animation when listening
- **Status messages**: Always know what's happening

## Technical Architecture

```
[Voice Input] --> [Web Speech API] --> [Transcript]
                                            |
                                            v
                                    [Command Parser]
                                            |
                        +-------------------+-------------------+
                        |                                       |
                        v                                       v
               [Control Command]                       [Music Search]
                        |                                       |
                        v                                       v
               [Execute Locally]                         [Claude API]
                        |                                       |
                        v                                       v
               [Update UI/Player]                        [Song List]
                                                               |
                                                               v
                                                      [YouTube API]
                                                               |
                                                               v
                                                      [Playlist UI]
                                                               |
                                                               v
                                                     [YouTube Player]
```

## Why Each Feature Matters While Driving

| Feature | Why It Matters |
|---------|----------------|
| Giant listen button | Can tap without looking |
| Voice commands | Hands stay on wheel |
| Auto-submit | Minimal interaction |
| AI interpretation | Don't need exact names |
| Playlist results | Pick from options or just play first |
| Large controls | Easy to hit in peripheral vision |
| Status messages | Know what happened without looking |
| TTS responses | Eyes on road |
| Smart pause during voice | Music pauses so mic hears you, resumes during API wait, pauses for response |
| Debug panel | Diagnose issues without dev tools |

## Security Model

- **API keys in config.json**: Loaded client-side
- **HTTP Basic Auth**: Password protects entire directory
- **HTTPS required**: For microphone access
- **No backend required**: Runs entirely in browser
- **Keys visible in dev tools**: Acceptable since page is password-protected

## Browser Requirements

- Chrome, Edge, or Safari (Web Speech API)
- HTTPS (microphone access)
- Stable internet (API calls)

## Future Possibilities

1. **Conversational context**: "Play Hotel California" ... "More like that"
2. **Spotify integration**: Use Spotify instead of YouTube
3. **Offline playlist caching**: Pre-load playlists for dead zones
4. **Car mode**: Even larger UI, simplified controls
5. **Wake word**: "Hey DJ" to start listening
6. **Song memory**: "Play that song I liked last week"
7. **Mood detection**: Voice tone analysis for automatic mood-matching

---

# Ebook to Audiobook Converter

## Overview

Convert ebooks to audiobooks using OpenAI's text-to-speech API. Upload common ebook formats (TXT, EPUB, PDF, HTML), preview the extracted text, and convert to high-quality MP3 audio.

## Core Features

### Input Formats
- **TXT**: Plain text files
- **EPUB**: Standard ebook format (extracts chapters, metadata)
- **PDF**: Portable document format (extracts text from all pages)
- **HTML**: Web pages saved locally

### Text-to-Speech
- **OpenAI TTS API**: High-quality neural voices
- **Voice Options**: Alloy (neutral), Echo (male), Fable (British), Onyx (deep), Nova (female), Shimmer (soft)
- **Model Selection**: TTS-1 (fast, $0.015/1K chars) or TTS-1-HD (high quality, $0.030/1K chars)
- **Speed Control**: 0.25x to 4.0x playback speed

### Conversion Process
- Text split into ~4000 character chunks (OpenAI limit is 4096)
- Each chunk converted separately via API
- Progress displayed with chunk count and time estimate
- Cancellable at any point
- Final audio combined into single MP3

### Audio Playback
- Built-in HTML5 audio player
- Download MP3 button for offline use
- Text preview with copy/select functionality

## Cost Reference

| Model | Cost per 1K chars | 10K word book (~60K chars) |
|-------|-------------------|----------------------------|
| TTS-1 | $0.015 | ~$0.90 |
| TTS-1-HD | $0.030 | ~$1.80 |

## Voice Characteristics

| Voice | Description |
|-------|-------------|
| Alloy | Neutral, balanced |
| Echo | Male, clear |
| Fable | British accent |
| Onyx | Deep male |
| Nova | Female, warm |
| Shimmer | Soft female |

## Security Model

- **API keys in localStorage**: Never sent anywhere except OpenAI
- **No server storage**: All processing happens client-side
- **HTTPS required**: For clipboard and file access

---

# Multimedia Ebook System (Planned)

## Vision

Don't just produce raw MP3 - create a synchronized multimedia experience where users can listen AND see visual content from the book (charts, images, tables, diagrams).

## Core Concept

```
[Ebook File]
     |
     v
[Content Extraction]
     |
     +---> [Text Chunks] ---> [TTS API] ---> [Audio Segments]
     |
     +---> [Images/Charts] ---> [Visual Assets]
     |
     +---> [Content Manifest] ---> [Synchronized Playback]
```

## Content Manifest Structure

Each ebook becomes a manifest linking text, audio, and visuals:

```javascript
{
  "title": "Book Title",
  "sections": [
    {
      "id": "section-1",
      "type": "text",
      "content": "Chapter 1 begins...",
      "audioChunkIndex": 0,
      "startTime": 0,
      "endTime": 45.2
    },
    {
      "id": "figure-1",
      "type": "image",
      "src": "blob:...",
      "caption": "Figure 1: Market Growth",
      "afterSection": "section-1",
      "displayDuration": 10
    },
    {
      "id": "section-2",
      "type": "text",
      "content": "As shown in Figure 1...",
      "audioChunkIndex": 1,
      "startTime": 45.2,
      "endTime": 92.8,
      "references": ["figure-1"]
    },
    {
      "id": "table-1",
      "type": "table",
      "data": [["Year", "Revenue"], ["2020", "$1M"]],
      "caption": "Table 1: Annual Revenue",
      "afterSection": "section-2"
    }
  ]
}
```

## Playback Modes

### Audio-Only Mode
- Standard MP3 playback
- No visual display
- Best for driving, walking, eyes-busy situations

### Synchronized Mode
- Audio plays with visual timeline
- Images/charts appear when audio reaches their reference point
- User can see what's being discussed
- Visual content remains on screen for configured duration

### Browse Mode
- Pause audio, browse all visual content
- Jump to any section
- Resume audio from visual context

## State Management

Track position across multiple dimensions:

```javascript
{
  "audioPosition": 125.4,        // seconds into combined audio
  "currentSection": "section-5",
  "visibleAssets": ["figure-2", "table-1"],
  "mode": "synchronized",        // audio-only | synchronized | browse
  "history": [
    { "time": "10:32", "action": "play", "position": 0 },
    { "time": "10:45", "action": "pause", "position": 125.4 },
    { "time": "10:46", "action": "view", "asset": "figure-2" }
  ]
}
```

## Visual Asset Extraction

### From EPUB
- Images embedded in content
- SVG diagrams
- Tables (converted from HTML)
- Figure references in text (e.g., "see Figure 1")

### From PDF
- Embedded images via PDF.js
- Tables (harder - may need heuristics)
- Charts (extract as images)

### From HTML
- img tags
- SVG elements
- Tables
- Canvas elements (screenshot)

## UI Components

### Visual Timeline
```
[====|====|====|====|====|====]
      ^
  [Figure 1]  [Table 1]  [Figure 2]
```

Thumbnails of visual assets positioned on audio timeline.

### Asset Viewer
- Full-screen image view
- Zoomable charts
- Scrollable tables
- Caption display

### Section Navigator
- List of all sections
- Visual indicator for assets
- Current position highlight
- Click to jump

## Implementation Phases

### Phase 1: Image Extraction
- Extract images from EPUB
- Store in memory alongside text
- Display in simple gallery

### Phase 2: Content Manifest
- Link text chunks to images
- Detect figure references
- Calculate audio timing

### Phase 3: Synchronized Display
- Show images at correct time
- Allow manual browsing
- Position persistence

### Phase 4: Tables and Charts
- HTML table extraction
- Chart image extraction
- Styled display

## Technical Considerations

### Memory Management
- Large images: create thumbnails for timeline
- Lazy load full images when viewed
- Release blobs when book closed

### Timing Accuracy
- Audio chunks have variable duration
- Need to track actual duration after TTS
- Build timing map incrementally during conversion

### Reference Detection
- Regex for "Figure X", "Table Y", "see chart"
- Associate with nearest visual asset
- Handle missing references gracefully

---

# Ear Training - Interval Recognition & Production

## Vision

A voice-first ear training tool for developing musicianship. Two core skills:
1. **Identification**: Hear an interval, name it
2. **Production**: See/hear a target interval, sing it accurately

Designed for hands-free practice while driving, walking, or doing chores.

## The Problem

Learning intervals is fundamental to musicianship but:
1. Most ear training apps require looking at screens and tapping buttons
2. No feedback loop for *singing* intervals - just passive listening
3. Hard to practice while doing other activities
4. Boring drill formats don't adapt to your weaknesses
5. No connection between "knowing" an interval and being able to produce it

## Core Design Principles

### 1. Voice-First, Eyes-Free
- Large "Listen" button to start (same as Scales page)
- All interaction via voice when in driving mode
- Audio prompts and feedback - no need to look
- Visual UI available when stationary for richer feedback

### 2. Two Complementary Modes

**Identify Mode** (Ear → Brain)
- Hear two notes (melodic or harmonic)
- Say the interval name: "major third", "perfect fifth", "tritone"
- Immediate audio feedback: "Correct!" or "That was a minor sixth"
- Track accuracy per interval type

**Sing Mode** (Brain → Voice)
- Hear a reference note
- Prompt: "Sing a perfect fourth above"
- User sings the target note
- Pitch detection verifies accuracy (within tolerance)
- Feedback: "Good!" / "A bit flat" / "That was a major third"

### 3. Configurable Interval Sets

Allow users to focus practice:
- **All intervals**: m2, M2, m3, M3, P4, TT, P5, m6, M6, m7, M7, P8
- **Easy set**: P4, P5, P8 (perfect intervals)
- **Thirds/Sixths**: m3, M3, m6, M6
- **Trouble intervals**: User's weakest based on history
- **Diatonic only**: Intervals within a major/minor scale
- **Custom selection**: Pick any subset

### 4. Direction Options
- **Ascending**: Lower note first, then higher
- **Descending**: Higher note first, then lower
- **Harmonic**: Both notes simultaneously
- **Random**: Mix of all three

### 5. Adaptive Difficulty
- Track accuracy per interval × direction
- Automatically weight practice toward weak areas
- Show progress over time
- Optional "mastery mode": must get 5 correct in a row to mark as learned

### 6. Voice Commands

| Command | Action |
|---------|--------|
| "start" / "go" / "next" | Play next interval |
| "repeat" / "again" | Replay current interval |
| "skip" | Skip without answering |
| "[interval name]" | Submit answer (identify mode) |
| "stop" / "pause" | Pause session |
| "stats" / "score" | Read current accuracy |
| "easier" / "harder" | Adjust difficulty |
| "driving mode" | Audio-only, no visuals needed |

### 7. Interval Naming (with aliases)

Support multiple ways to say each interval:

| Interval | Semitones | Aliases |
|----------|-----------|---------|
| minor 2nd | 1 | "minor second", "half step", "semitone", "m2" |
| Major 2nd | 2 | "major second", "whole step", "whole tone", "M2" |
| minor 3rd | 3 | "minor third", "m3" |
| Major 3rd | 4 | "major third", "M3" |
| Perfect 4th | 5 | "perfect fourth", "fourth", "P4" |
| Tritone | 6 | "tritone", "augmented fourth", "diminished fifth", "TT" |
| Perfect 5th | 7 | "perfect fifth", "fifth", "P5" |
| minor 6th | 8 | "minor sixth", "m6" |
| Major 6th | 9 | "major sixth", "M6" |
| minor 7th | 10 | "minor seventh", "m7" |
| Major 7th | 11 | "major seventh", "M7" |
| Octave | 12 | "octave", "perfect octave", "P8", "eighth" |

### 8. Session Structure

**Quick Practice** (default)
- Endless random intervals from selected set
- Stop anytime with voice command
- Shows running accuracy

**Timed Session**
- 5/10/15 minute sessions
- Summary at end with weakest intervals highlighted
- Saves to history

**Challenge Mode**
- Fixed number of intervals (10/20/50)
- Score at end
- Leaderboard against yourself

## UI Layout

### Desktop/Tablet (Visual Mode)

```
┌─────────────────────────────────────────────────────┐
│  Ear Training                           v33   [...] │
│  [Scales] [Pitch] [Music] [Books] [Ears]           │
├─────────────────────────────────────────────────────┤
│                                                     │
│              [ 🎧 Listen ]  [ ▶ Next ]              │
│                                                     │
│         ┌─────────────────────────────┐             │
│         │   🎵  ?  →  🎵               │             │
│         │      What interval?          │             │
│         └─────────────────────────────┘             │
│                                                     │
│  Mode: [Identify] [Sing]                           │
│                                                     │
│  Intervals:  ☑m2 ☑M2 ☑m3 ☑M3 ☑P4 ☑TT ☑P5...       │
│  Direction:  [Asc] [Desc] [Harm] [Random]          │
│  Root range: C3 ──●────── C5                       │
│                                                     │
│  ─────────────────────────────────────             │
│  Session: 15 correct / 18 total (83%)              │
│  Weakest: tritone (40%), minor 6th (50%)           │
│                                                     │
│  History:                                          │
│  ✓ P5 asc   ✓ M3 desc   ✗ m6 harm   ✓ P4 asc     │
└─────────────────────────────────────────────────────┘
```

### Driving Mode (Audio-Only)

No visual feedback needed. All via audio:

1. "Next interval" → plays two notes
2. User says: "minor sixth"
3. System: "Correct! That was a minor sixth ascending. Next..."
4. Continues until "stop" or "pause"

Stats read aloud on request: "You've done 20 intervals, 85% correct. Weakest is the tritone."

## Technical Architecture

```
[Voice Input] ──→ [Speech Recognition]
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
   [Control Command]           [Interval Answer]
         │                             │
         ▼                             ▼
   [Update State]              [Check Answer]
                                       │
                                       ▼
                               [Update Stats]
                                       │
                                       ▼
                               [Audio Feedback]
                                       │
                               [TTS or Tone.js]


[Sing Mode Addition]

[Pitch Detection] ◄── [Microphone]
        │
        ▼
[Frequency → Note]
        │
        ▼
[Compare to Target]
        │
        ▼
[Accuracy Feedback]
```

## Integration with Existing Code

- **Tone.js**: Already loaded for Scales - reuse for playing intervals
- **Salamander Piano**: Same samples for consistent sound
- **voice-command-core.js**: Shared voice recognition infrastructure
- **Pitch detection**: Port from pitch-meter.js for sing mode
- **style.css**: Shared styling

## Implementation Phases

### Phase 1: Core Identify Mode
- Basic interval playback (ascending melodic)
- Voice recognition for interval names
- Simple accuracy tracking
- Visual UI with interval buttons

### Phase 2: Full Identify Mode
- Descending and harmonic intervals
- Configurable interval sets
- Session history and stats
- Driving mode (audio feedback)

### Phase 3: Sing Mode
- Integrate pitch detection
- "Sing X above this note" prompts
- Accuracy tolerance settings
- Combined practice (identify then sing)

### Phase 4: Adaptive Learning
- Track weakness per interval × direction
- Weighted random selection
- Progress visualization
- Mastery tracking

## Success Metrics

- User can practice for 10+ minutes hands-free while driving
- Measurable improvement in interval recognition accuracy over sessions
- Both identification and production skills improve together
- Users report increased confidence in real musical situations

---

# Version System

All five pages share a unified version number stored in the `VERSION` file.

## Current Version

See `VERSION` file for the single source of truth.

## Bumping Version

Run the bump script before deploying changes:

```bash
./bump-version.sh        # Increment by 1
./bump-version.sh 31     # Set to specific version
```

This updates:
- `VERSION` file
- All HTML version labels (v30 in header)
- All cache-busting parameters (?v=30)

## Deploy Workflow

1. Make changes
2. Run `./bump-version.sh`
3. `git add -A && git commit -m "..." && git push`
4. Push to master triggers GitHub Actions deploy

---

# Summary

Voice-Wei is a collection of voice-first tools for musicians and readers:

1. **Scales**: Voice-controlled scale practice with realistic piano
2. **Pitch Meter**: Real-time pitch detection for vocal accuracy
3. **Music Player**: AI-powered voice-controlled YouTube player
4. **Books**: Ebook to audiobook converter using OpenAI TTS
5. **Ears**: Interval ear training - identification and singing production

The common thread is hands-free, voice-first operation. Whether practicing scales, checking pitch, training your ear, playing music while driving, or listening to books, these tools minimize visual attention and maximize voice control.

