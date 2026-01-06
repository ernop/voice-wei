### Product / UX
- **Unify the story**: “Voice-first music companion” homepage/landing that links to Music / Scales / Pitch with one-paragraph explanations.
- **Safer driving UX**: optional “car mode” toggle (bigger controls, fewer on-screen elements, stronger contrast).
- **TTS polish**: speak *action confirmations* (“Shuffled”, “Next”) without reading long logs; configurable verbosity.
- **Better voice affordances**: visible mic state, quick “Cancel”/“Stop listening” patterns consistent across all pages.
- **Accessibility pass**: ARIA labels everywhere, focus states, and “screen off” usability where possible.

### Music (Claude + YouTube)
- **Conversational follow-ups**: “more like that”, “less like that”, “only live versions”, “no covers”, “90s only”.
- **Playlist ops by voice**: “remove song 3”, “move this up”, “play the second one”, “save this playlist”.
- **Better result quality**: have Claude return *constraints* (original vs live, explicit vs clean, era) and filter search results accordingly.
- **Reliability**: robust handling when Piped/Invidious instances are down (status surface + retry UX).
- **Key security**: optional server endpoint for Claude calls (rate limiting, auth, key never shipped to browser).

### Scales (Trainer)
- **More training modes**: call-and-response, interval recognition quiz, “sing the 3rd” drills, ear training.
- **More musical content**: more modes/scales (already partially implemented in code), chord extensions, inversions.
- **Metronome + count-in**: consistent tempo reference; subdivided clicks.
- **Preset packs**: singer warmups, guitar drills, jazz modes, etc.

### Pitch Meter
- **Better segmentation**: detect “note events” (stable pitch regions) vs raw samples for cleaner scoring.
- **Guided exercises**: show next target note, give immediate “too sharp/flat” coaching.
- **Export**: save session results (JSON/CSV), shareable summary screenshot.

### Engineering / Cleanup
- **De-duplicate voice code**: the Music player currently has its own recognition stack; Scales has `voice-command-core.js`. Long term, share one core with adapters.
- **Config strategy**: document dev vs deploy configs clearly; avoid implying keys are “secure” without a backend.
- **Test harness**: a small “demo mode” (no Claude) for UI/testing without spending tokens.




## Vision & Roadmap

### Core Experience Improvements

#### Voice Control Enhancements
- **Conversational context**: "Play Hotel California" → "More like that" (continues the musical theme)
- **Follow-up commands**: "Slower", "louder", "different artist"
- **Memory**: "Play that song I liked last week" (requires song history storage)
- **Mood detection**: Analyze voice tone for automatic mood-based recommendations

#### Music Discovery
- **Spotify integration**: Use Spotify API instead of YouTube for better music catalog
- **Personalization**: Learn user preferences over time
- **Cross-platform sync**: Access favorites/playlists across devices
- **Offline playlists**: Pre-cache playlists for dead zones

#### UI/UX Polish
- **Car mode**: Larger UI optimized for dashboard viewing
- **Wake word**: "Hey DJ" to start listening without button press
- **Haptic feedback**: Phone vibration for voice command confirmation
- **Dark/light themes**: Automatic based on time of day

### Training Tools Expansion

#### Scales Tool
- **Custom scale builder**: Create and save custom scale patterns
- **Metronome integration**: Practice with adjustable tempo
- **Progress tracking**: Log practice sessions and improvement metrics
- **Chord progressions**: Play chord sequences for harmonic training

#### Pitch Tool
- **Recording analysis**: Save and replay practice sessions
- **Multi-track recording**: Layer vocals for harmony practice
- **Tuner mode**: Standalone instrument tuner
- **Range tracking**: Monitor vocal range expansion over time

### Platform Extensions

#### Mobile Apps
- **Native iOS/Android apps**: Better performance and integration
- **CarPlay/Android Auto**: Official car integration
- **Wear OS integration**: Voice control from smartwatch

#### Hardware Integration
- **Bluetooth LE**: Connect to car audio systems directly
- **USB audio**: Professional audio interfaces for training tools
- **MIDI integration**: Connect to keyboards and synthesizers

### Advanced Features

#### Social & Sharing
- **Practice sharing**: Share scale practice sessions with teachers
- **Collaborative playlists**: Create shared playlists with friends
- **Performance recording**: Record and share musical performances

#### AI Enhancements
- **Music generation**: AI-composed practice pieces
- **Real-time feedback**: AI coaching during practice sessions
- **Style analysis**: Identify and recommend songs in specific musical styles

#### Professional Features
- **Teacher dashboard**: Track student progress and assign exercises
- **Competition mode**: Time-based challenges and leaderboards
- **Integration APIs**: Connect with music education platforms

### Technical Infrastructure

#### Performance & Reliability
- **Progressive Web App**: Installable, works offline
- **Service workers**: Background audio processing
- **WebRTC optimization**: Lower latency voice processing
- **Edge computing**: Process voice locally when possible

#### Analytics & Insights
- **Usage analytics**: Understand how people use the tools
- **Performance metrics**: Monitor app performance and user satisfaction
- **A/B testing framework**: Test new features safely

### Business & Distribution

#### Monetization Options
- **Freemium model**: Basic features free, premium training content
- **Subscription tiers**: Individual vs family vs teacher plans
- **In-app purchases**: Premium song packs, advanced exercises

#### Education Integration
- **School partnerships**: Integrated into music education curricula
- **Certification programs**: Official training certification tracks
- **Corporate wellness**: Music-based stress reduction programs




## Vision & Future Ideas

### High-Priority Enhancements

**Music Player:**
- Conversational context: "Play Hotel California" ... "More like that" (remembers previous request)
- Playlist persistence: Save playlists with names, reload later
- Better error recovery: Retry failed YouTube searches automatically
- Voice command improvements: "Play louder", "Play quieter", "Play slower" (speed control)
- Queue management: "Add to queue", "Play next", "Remove this song"
- Genre/mood shortcuts: "Play my workout mix", "Play my driving mix"

**Scales Tool:**
- More scale types: Blues scale, modes (Dorian, Mixolydian, etc.)
- Chord progressions: "Play I-IV-V in C major"
- Metronome integration: Visual/metronome click during scale playback
- Recording: Record yourself playing along, compare to reference
- Interval training mode: "Play a perfect 5th" - user sings it back, get feedback

**Pitch Meter:**
- Historical accuracy tracking: See improvement over time
- Practice mode: Target specific notes, get feedback on accuracy
- Duet mode: Sing harmony while reference plays melody

### Technical Improvements

**Performance:**
- Service Worker for offline playlist caching
- Preload next song in playlist while current plays
- Lazy-load YouTube players (only create when needed)
- Optimize Tone.js sample loading (progressive loading)

**Reliability:**
- Better proxy instance health checking
- Automatic proxy failover with user notification
- Retry logic for transient API failures
- Offline mode: Play cached playlists when internet unavailable

**User Experience:**
- Wake word detection: "Hey DJ" to start listening (Web Speech API continuous mode)
- Voice activity detection: Auto-start listening when speech detected
- Better mobile keyboard: Custom keyboard for scales tool (note names, modifiers)
- Haptic feedback: Vibration on button presses (mobile)

### Platform Expansion

**New Tools:**
- Chord trainer: Practice chord recognition and voicings
- Rhythm trainer: Metronome with voice commands
- Song learning: "Play [song] slowly" - AI finds slowed-down versions
- Music theory quiz: Voice-controlled music theory questions

**Integration Ideas:**
- Spotify API integration (when available/affordable)
- Apple Music integration
- Local music library access (file upload/playback)
- MIDI device support (for scales tool)

**Accessibility:**
- Screen reader optimizations
- High contrast mode
- Larger text options
- Voice-only mode (no visual UI needed)

### AI Enhancements

**Smarter Understanding:**
- Context awareness: "Play more like that" remembers previous request
- Learning preferences: Remember user's music taste, suggest accordingly
- Natural follow-ups: "What year was that?" after song plays
- Multi-turn conversations: "Play jazz" ... "Make it more upbeat" ... "Add some vocals"

**Music Intelligence:**
- Tempo detection: "Play something at 120 BPM"
- Key detection: "Play songs in C major"
- Mood analysis: Analyze song audio, tag with mood/genre automatically
- Similarity search: "Play songs similar to [current song]"

### Deployment & Distribution

**Easier Setup:**
- One-click deployment script improvements
- Docker container option
- Cloud deployment guides (Vercel, Netlify, etc.)
- Mobile app wrapper (PWA → native app)

**Sharing:**
- Share playlists via URL
- Export playlists (JSON, M3U format)
- Import playlists from other services
- Collaborative playlists (multiple users)

### Experimental Ideas

**Voice Features:**
- Multi-language support: Spanish, French, etc.
- Accent/dialect adaptation: Learn user's speech patterns
- Whisper mode: Quiet voice recognition for late-night use
- Voice cloning: Use user's voice for TTS responses

**Music Features:**
- AI-generated playlists: "Create a playlist for a rainy day"
- Song mashups: "Play Hotel California mixed with jazz"
- Tempo matching: All songs in playlist play at same BPM
- Key matching: Transpose songs to same key

**Training Features:**
- Gamification: Points for accuracy, streaks, achievements
- Social features: Share scores, compete with friends
- Custom exercises: User-created scale patterns
- Video lessons: Integrate YouTube music lessons

**Hardware Integration:**
- Car head unit integration (Android Auto, CarPlay)
- Smart speaker support (Google Home, Alexa)
- MIDI keyboard input for scales tool
- Bluetooth microphone support

---

# Scales Tab - Detailed Vision (from voice notes)

## Core Purpose
Voice-controlled practice patterns for singing and ear training. User listens while driving (hands-free) and practices along. Goal: develop high availability of correct musical tones - hear it, match it instantly.

## Extra Note Patterns (The Hard Part)

The transcript describes embellishment patterns that add "extra notes" (also called "grace notes") around each scale note:

### Pattern Types

| Pattern | Description | Example (C major up) |
|---------|-------------|---------------------|
| **interleave-1** | Return to root after each note | C-C-D-C-E-C-F-C-G-C-A-C-B-C-C |
| **+1, +2** | Add next 2 scale degrees after each note | C-D-E, D-E-F, E-F-G, F-G-A, G-A-B, A-B-C |
| **+1, +3** | Add 2nd and 4th above (skip one) | C-D-F, D-E-G, E-F-A, F-G-B... |
| **+1, -1** | "Dance around" - above then below | C-D-B, D-E-C, E-F-D... |

### Key Distinction: Scale Notes vs Extra Notes

- **Scale notes**: The backbone (1-8 in an octave) - BOUNDED to section range
- **Extra notes**: Embellishments that can EXCEED section range (to 9, 10, 11...)

This distinction was a source of bugs. The system confused them, causing issues when implementing complex patterns.

### Connectedness (Turnaround Logic)

Like running up steps and turning around - you don't take two steps on the same spot:

- **WRONG**: 1-2-3-4-5-6-7-8-**8**-7-6-5-4-3-2-1
- **RIGHT**: 1-2-3-4-5-6-7-8-7-6-5-4-3-2-1

The top note serves dual purpose (end of up, start of down). Same at bottom when looping without gaps: ...3-2-1-2-3... (not 1-**1**-2).

### Clean Endings

Extra notes do NOT extend past the final note. The ear expects resolution:

With +1,+2 pattern ending:
- ...3-4-5, 2-3-4, **1** (stops clean)
- NOT: ...2-3-4, 1-2-3 (extras would overshoot)

## Future Feature: Pitch Detection ("Also Listen" Mode)

- Toggle microphone listening during playback
- Visual pitch accuracy meter
- Real-time feedback: "go down a little bit"
- Grade overall accuracy
- May work even with overlapping audio (speaker + mic simultaneous)

## Future Feature: Professional Vocal Exercises

Research what coaches actually use. Example "rising" pattern:

```
1-2-3-4-5-4-3-2-1  (start on C)
2-3-4-5-6-5-4-3-2  (start on D)
3-4-5-6-7-6-5-4-3  (start on E)
4-5-6-7-8-7-6-5-4  (start on F)
...
```

Each repetition shifts up one scale degree, training the voice across ranges.

## Voice UI Design Details

- Big button at top for voice input
- Commands like "F3 chromatic scale up and down forever no gap"
- Modifiers: "plus one plus two", "trills"
- Settings have sensible defaults
- Saying "D major" may contextually reset some modifiers (like extra patterns) but not others
- Option to say "done" or just wait - then playback starts
- Read back what was understood

## Personal Training Goal
User tends to jump too high (around scale degrees 6-7-8). Want exercises that train control in lower range.

---
# Vision & Roadmap

## Short-term Improvements

- [ ] **Wake word detection**: "Hey DJ" or "Hey Scales" to start listening without tapping
- [ ] **Solfege mode for scales**: "do re mi fa sol la ti do" instead of note names
- [ ] **Metronome integration**: Steady beat while practicing scales
- [ ] **Backing drone**: Sustained root note during scale practice for pitch reference
- [ ] **Car Mode**: Even larger UI, fewer elements, maximum touch targets

## Medium-term Features

- [ ] **Interval ear training**: Quiz mode - hear an interval, guess what it is
- [ ] **Conversational context**: "Play Hotel California" → "More like that" → AI remembers
- [ ] **Practice sessions**: Track progress over time, see improvement
- [ ] **Multiple instrument sounds**: Guitar, strings, synth options for scales
- [ ] **Spotify integration**: Play from Spotify instead of YouTube
- [ ] **Song memory**: "Play that song I liked last week"

## Long-term Vision

- [ ] **Progressive Web App**: Installable, works offline (cached scales, pre-loaded playlists)
- [ ] **Mood detection**: Voice tone analysis for automatic mood-matching music
- [ ] **Collaborative playlists**: Share voice-created playlists
- [ ] **Teaching mode**: Guided lessons for learning scales, intervals, ear training
- [ ] **MIDI output**: Control external synthesizers with voice
