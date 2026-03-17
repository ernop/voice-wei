# Music Player Lyrics Research

## Goal

Extend the YouTube-based music player so it can:
- find lyrics for tracks returned from YouTube search
- show large sing-along lyrics on a phone
- later synchronize lyrics to playback
- later surface musical metadata such as key, pitch, and possible transcription

## Current Inputs We Already Have

From the existing YouTube search and playlist flow, we already have useful lookup hints:
- artist
- song title
- video title
- channel title
- duration
- search term

That is enough to attempt good lyric matching, especially if we normalize titles and compare durations.

## Recommendation Summary

### Best first free option

Use `LRCLIB` first.

Why:
- free and no auth
- supports synced and unsynced lyrics
- track metadata includes duration
- designed for LRC/timed lyrics workflows

### Best commercial option

Use `Musixmatch` if we want licensed, larger-scale synced lyrics and are willing to pay.

Notes:
- paid plans
- synced lyrics available on higher tiers
- stronger long-term path for karaoke-style display

### Best enterprise/licensing option

`LyricFind` is worth contacting if this becomes a serious product, but pricing appears to be custom and sales-led.

## Provider Research

### 1. LRCLIB

URL:
- `https://lrclib.net/`

What it gives:
- plain lyrics
- synchronized lyrics
- metadata including track title, artist, album, duration

Why it fits:
- strongest free fit for this project
- duration-aware matching is valuable because YouTube titles are noisy
- good foundation for later lyric highlighting

Risks:
- catalog coverage will not be complete
- crowdsourced quality will vary by song

### 2. lyrics.ovh

URL:
- `https://api.lyrics.ovh/`

What it gives:
- plain lyrics by artist/title

Why it may help:
- simple free backup source for plain lyrics
- no auth

Limits:
- no synced lyrics found in current research
- weaker metadata matching than LRCLIB

### 3. Musixmatch

URL:
- `https://about.musixmatch.com/business/pricing-plans`

What it gives:
- static lyrics
- line-synced and word-synced lyrics on higher plans
- commercial path for richer lyric experiences

Observed public pricing:
- basic plan around $29.50/month for static lyrics
- scale plan around $119.50/month for synced lyrics
- enterprise custom

Why it matters:
- strongest obvious paid path if we want licensed synced lyrics without building our own alignment pipeline first

### 4. LyricFind

URL:
- `https://lyricfind.com/`

What it gives:
- licensed lyrics and lyric data products

Limits:
- public pricing not obvious
- likely direct-sales / partner arrangement

Why it matters:
- realistic commercial/licensing route if wei need stronger rights coverage later

### 5. Genius

URL:
- `https://docs.genius.com/`

Important limit:
- the public API is mainly metadata and annotations, not full lyrics

Conclusion:
- not a primary lyrics source for this feature

## Matching Strategy

We should not trust raw YouTube titles directly. A better matching pipeline:

1. Start with the playlist item returned from YouTube search.
2. Normalize title text:
- remove `(Official Video)`, `(Lyrics)`, `[HD]`, `feat.`, live/remix markers where possible
- split likely artist-title patterns
3. Query the lyrics provider with:
- artist
- title
- duration if supported
4. Score candidates by:
- normalized title similarity
- artist similarity
- duration difference
- whether the provider marks the track as instrumental
5. Store the selected match and confidence locally.

## UI Direction

### Phase 1 UI

Add a lyrics panel to the music player:
- default: collapsed or tabbed on mobile
- desktop: side panel or below current song
- phone: button to open full-screen lyrics

Recommended controls:
- `Lyrics`
- `Big Lyrics`
- `Overlay`
- `Hide`

### Large-Text Overlay

Desired behavior:
- cover most of the page
- dark translucent background over player
- very large centered text
- simple tap to dismiss
- optional font size controls

This is the best immediate sing-along mode for phone use.

### Synced Display

When timestamps exist:
- highlight current line
- keep previous and next lines visible
- auto-scroll gently
- avoid tiny karaoke effects first; line-level sync is enough to start

## Sync Options

### Option A: Provider-supplied synced lyrics

Best near-term choice.

Sources:
- LRCLIB
- Musixmatch

Pros:
- much simpler
- no heavy computation
- usable in browser quickly

Cons:
- depends on catalog coverage

### Option B: Generate alignment from plain lyrics plus audio

Possible later, but much harder.

Pipeline from current research:
1. separate vocals from the mix with `Demucs` or `HTDemucs`
2. run singing-aware transcription / forced alignment
3. produce `LRC` timing output

Relevant open-source directions found:
- `lyrics-sync`
- `lyrics-audio-alignment`
- forced-alignment projects using Wav2Vec2 / CTC

Pros:
- could fill gaps when synced lyrics are unavailable

Cons:
- much more engineering
- likely server-side or offline preprocessing
- heavy compute
- accuracy will vary, especially with noisy or live recordings

Conclusion:
- do not start here
- keep it as a future enhancement

## Key, Pitch, Tempo, Chords, And Notation

These are different problem classes and should be treated separately.

### A. Key / Mode / Tempo

Most realistic sources:
- external metadata APIs
- local audio analysis

Research notes:
- `Essentia.js` can do browser-side music analysis including key extraction and tempo detection
- `Soundcharts` and other commercial audio-feature APIs exist
- `Spotify` metadata is increasingly restricted and should not be treated as a stable foundation here

Recommendation:
- if wei want lightweight metadata, analyze audio locally or on a worker/server rather than depending on Spotify

### B. Vocal Pitch / Absolute Pitch / Sung Note Tracking

There are two separate goals:
- detect the user's current sung pitch from microphone input
- estimate a song's vocal melody or pitch center from track audio

For the user microphone:
- browser pitch detection is already practical with Web Audio
- YIN/autocorrelation style detectors are suitable
- this is the easiest path for live singing feedback

For the song audio:
- much harder because the vocal is inside a full mix
- likely needs vocal separation first

Recommendation:
- live user pitch detection is feasible in-browser
- song-vocal pitch extraction is a later research feature

### C. Chords / Harmony

Open-source options exist, such as `Chordino`, but they are not simple browser drop-ins.

Recommendation:
- do not make chord detection part of v1 lyrics
- consider offline or server-side analysis later

### D. Notation / Melody Transcription

This is the hardest dream on the list.

Practical options:
- generate approximate melody/MIDI from audio with tools like `Basic Pitch`
- obtain licensed sheet music from commercial providers

What is realistic:
- generated transcription can be useful for rough melody hints
- it will not reliably produce clean, publication-grade sheet music for arbitrary commercial recordings
- licensed notation APIs exist, but access appears commercial and specialized

Conclusion:
- melody extraction may become a useful "practice assist" feature
- true notation should be treated as optional and likely commercial

## Proposed Build Order

### Phase 1: Lyrics Now
- add lyrics panel
- integrate LRCLIB lookup
- match using artist/title/duration
- add big-text mobile overlay

### Phase 2: Better Coverage
- add fallback plain-lyrics source such as lyrics.ovh if needed
- cache lyric matches locally
- expose match confidence and "wrong lyrics" feedback

### Phase 3: Sync
- prefer synced lyrics when LRCLIB returns them
- line highlighting during YouTube playback
- smooth auto-scroll

### Phase 4: Musical Metadata
- experiment with key and tempo extraction
- show song key when confidence is good enough
- explore singer aids such as suggested starting note or transposition hint

### Phase 5: Research Features
- lyric alignment generation from audio
- vocal extraction
- melody transcription
- chord analysis
- notation export or sheet-music linking

## Cost View

### Cheapest credible path
- LRCLIB first
- local cache in browser
- no backend required initially

### Moderate-cost path
- keep LRCLIB for free coverage
- add Musixmatch for synced/licensed depth where needed

### High-effort research path
- build alignment and music-analysis pipelines ourselves
- likely requires backend jobs, storage, and heavier compute

## Key Product Decisions

1. Use provider-supplied synced lyrics before trying to generate sync ourselves.
2. Treat large-text phone lyrics as a first-class feature, not a side panel only.
3. Separate "user singing analysis" from "song audio analysis" because the first is much easier.
4. Treat notation as a late-stage research feature, not a baseline promise.

## Suggested Next Implementation

If wei implement this soon, the first slice should be:
- add a `Lyrics` button on `player.html`
- fetch from LRCLIB using normalized title + artist + duration
- show lyrics in a side panel and a full-screen overlay
- if synced lyrics are available, keep the data structure ready even if initial UI is plain text
