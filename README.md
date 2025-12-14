# Voice-Wei

Voice-first tools for singers and musicians.

**Main Release:** http://fuseki.net/music/scales.html

## Scales (Primary Feature)

A voice-controlled scale trainer with realistic piano sounds. Speak naturally to practice scales, intervals, and ear training.

Click **Listen**, then say:
- "D minor scale"
- "slowly chromatic"
- "G major up and down"
- "perfect fifth from A"
- "harmonic minor repeat forever"

Everything you can say is also visible and clickable. Voice commands reset to defaults then apply your modifiers, so "D minor" always sounds the same regardless of previous UI state.

**Features:**
- Salamander Grand Piano samples via Tone.js
- Phonetic aliases handle speech recognition quirks ("see" = C, "bee flat" = Bb)
- Direction, tempo, gap, repeat, octave span controls
- Live status shows current note and interval during playback
- Works on mobile (Chrome, Safari, Edge)

See [SCALES.md](SCALES.md) for full command reference.

## Other Tools

### Pitch Meter
Real-time pitch detection for checking vocal accuracy. Select a scale, record yourself singing, see how close you hit each note.

### Music Player
Voice-controlled YouTube music player for hands-free operation. Speak your request ("play some jazz"), Claude AI interprets it, and songs appear in a playlist with comments explaining each match.

## Quick Start

```bash
python -m http.server 8000
# Visit http://localhost:8000/scales.html
```

HTTPS required for microphone access when deployed.

## Browser Support

- Chrome/Edge/Safari - Full support
- Firefox - No Web Speech API support

## Files

```
scales.html/js/css       # Scale practice (main feature)
pitch-meter.html/js/css  # Pitch detection
player.html + app.js     # Music player
voice-command-core.js    # Shared voice recognition
```

## Deployment

The main release at http://fuseki.net/music/scales.html is manually updated from known-good builds. During normal development, use the music8899b folder.

```bash
./deploy.sh           # Deploy to server
./deploy.sh --dry-run # Preview changes
```

## License

Personal use project.
