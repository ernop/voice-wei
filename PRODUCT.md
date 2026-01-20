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

# Version System

All four pages share a unified version number stored in the `VERSION` file.

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

The common thread is hands-free, voice-first operation. Whether practicing scales, checking pitch, playing music while driving, or listening to books, these tools minimize visual attention and maximize voice control.

