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

# Ebook to Audiobook Converter (v3)

## Overview

Convert ebooks and web pages to audiobooks using OpenAI's text-to-speech API. Features persistent storage, cost tracking, progressive playback, and precise navigation.

## Core Features

### Input Sources
- **File Upload**: TXT, EPUB, PDF, HTML, MOBI formats
- **URL Fetch**: Extract text from any web page
- **Drag & Drop**: Drop files directly onto upload area

### Text-to-Speech
- **OpenAI TTS API**: High-quality neural voices
- **Voice Options**: Alloy, Echo, Fable, Onyx, Nova, Shimmer
- **Model Selection**: TTS-1 (fast) or TTS-1-HD (high quality)
- **Speed Control**: 0.25x to 4.0x playback speed

### Persistent Storage (IndexedDB)
- **Browser Storage**: All data stored locally in IndexedDB
- **No Server Required**: Works entirely client-side
- **Large Capacity**: Can store hundreds of MB of audio
- **Audio Preservation**: MP3 files stored permanently (never regenerated)
- **Cross-Session**: Books persist across browser sessions

### Cost Tracking
- **Real-Time Estimates**: See cost before conversion
- **Per-Chunk Tracking**: Monitor cost as conversion progresses
- **Session & Total**: Track both current session and lifetime costs
- **Pricing Display**: TTS-1 ($0.015/1K chars), TTS-1-HD ($0.030/1K chars)

### Playback Features
- **Progressive Playback**: Audio plays as chunks complete (no waiting for full conversion)
- **Precise Timeline**: Zoom 1x-20x for accurate seeking in long books
- **Quick Jump Buttons**: -1m, -30s, -10s, +10s, +30s, +1m, +4m, +12m
- **Position Memory**: Automatically saves and restores position per book
- **Playback History**: Every seek/play action logged with clickable jump-back

## Data Architecture

### IndexedDB Storage
```
EbookAudiobookDB (IndexedDB)
  books/                         <- Object store
    [userHash, bookHash]         <- Compound key
      title, author, text, chapters, format
      hasAudio, audioDuration, conversionCost
      createdAt, updatedAt

  audio/                         <- Object store
    [userHash, bookHash]         <- Compound key
      blob                       <- MP3 audio blob
      size, createdAt
```

### Security Model
- **Browser Isolation**: IndexedDB is origin-locked (same-origin policy)
- **User Namespace**: API key hash partitions data within the DB
- **No Server**: Data never leaves the browser
- **Private by Default**: Other users/sites cannot access your data

### Metadata Schema
```json
{
  "title": "Book Title",
  "author": "Author Name",
  "text": "Full book text...",
  "chapters": ["Chapter 1", "Chapter 2"],
  "format": "epub",
  "sourceUrl": "https://...",
  "charCount": 50000,
  "wordCount": 8500,
  "hasAudio": true,
  "audioDuration": 3600,
  "conversionCost": 0.75,
  "updatedAt": 1705700000
}
```

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

## UI Components

### Library Panel
- Shows all saved books sorted by last update
- Click to load book and audio
- Delete button per book
- Storage usage display

### Cost Tracker
- Session cost (current session)
- Total cost (lifetime)
- Estimated cost before conversion

### Timeline Controls
- Zoomable timeline (1x-20x)
- Current time / Total / Remaining display
- Quick jump buttons
- Click anywhere to seek

### Playback History
- Timestamped log of all playback actions
- Click any entry to jump to that position
- Persists per book

## Technical Notes

### Progressive Playback
- Conversion creates chunks of ~4000 characters
- Each chunk converted separately
- Audio player updates after each chunk
- User can start listening immediately

### Position Persistence
- Position saved every 5 seconds during playback
- Stored in localStorage keyed by bookHash
- Restored when book loaded from library

### URL Fetching
- Uses proxy.php to avoid CORS
- Extracts main content (article, main, .content)
- Removes nav, header, footer, ads
- Falls back to body text

---

## Summary

Voice Music Control solves the fundamental problem with music apps while driving: they're designed for people sitting at desks, not behind wheels. This app puts voice first, AI second, and touch third. Speak naturally, get smart results, control hands-free.

The Ebook Converter extends this to audiobooks - convert any text to speech with cost tracking, persistent storage, and precise playback control. Your API key is your identity, and your books are always available.

The goal isn't to replace Spotify or YouTube Music. It's to be the safest, smartest way to control music when your eyes and hands need to be elsewhere.

