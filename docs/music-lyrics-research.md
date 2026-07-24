# Music Player Lyrics Research

Research notes behind the player's lyrics and listening-accompaniment
features. **Status: phases 1-3 shipped** (LRCLIB lookup, the big-text
overlay, and synced line highlighting live in `player-lyrics.js`; see
[tools.md](tools.md) for user-facing behavior). Story Report shipped in v287:
lyrics remain on line one while Identity/Story Report selects line two.
Musical Guide, microphone analysis, and
recording-aligned singing information remain research and feed the backlog in
[product-goals.md](product-goals.md).

## Goal

Extend the YouTube-based music player so it can:
- find lyrics for tracks returned from YouTube search
- show large sing-along lyrics on a phone
- synchronize lyrics to playback and relay them on the first car-display line
- offer identity or a researched Story Report on the second line
- later surface sourced musical understanding and proven live pitch analysis

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

## Two-Line Listening Accompaniment Contract

The car / lock-screen surface has two logical text lines. The clarified product
contract is:

| Line | Owner | Values |
|------|-------|--------|
| First | timed lyrics | song identity intro/countdown, then the current lyric |
| Second | accompaniment mode | `Identity`, `Story Report`, or `Musical Guide` |

`Identity` is the default stable `year - artist - song` line. `Story Report`
advances the positive cultural/literary report at the selected interval.
`Musical Guide` advances sourced musical facts, section notes, and singing
guidance; a later proven microphone mode may temporarily prioritize a stable
live-pitch summary.

v287 implements separate primary and secondary display channels, correcting
the initial branch implementation that suppressed lyrics during Story Report.
Both channels may cause a `MediaMetadata` rewrite because the Web
Media Session API has no transient subtitle fields, but neither may alter the
sounding `videoId`, artwork, YouTube position, or playback state. Receiver
field order is device-specific, so the actual car must verify which metadata
field appears as line two.

The on-page sticky surface should render the same two lines explicitly even
when a receiver chooses a different layout. Report generation and microphone
analysis never pause, seek, restart, or speak over the song.

## Three Different Analysis Problems

The word “pitch” hides three separate jobs:

1. **User pitch:** detect what yui is singing into the phone microphone.
2. **Recording melody:** isolate and track the recorded lead vocal.
3. **Harmony:** infer key, modulation, and chords from the complete recording.

The existing McLeod Pitch Method (MPM) in `pitch-detect-core.js` is a
monophonic voice detector. It returns one fundamental between D2 and Bb4 from a
2048-sample time-domain frame. That is appropriate for an isolated singer. A
full mix contains vocals, bass, chords, and percussion simultaneously, so MPM
will jump among dominant periodic sources and cannot identify a chord or
reliably establish a key.

Recording melody extraction needs source separation or a polyphonic melody
tracker such as pYIN/MELODIA-class contour analysis. Harmony needs spectral
pitch-class features (chroma/HPCP) aggregated across seconds, followed by
key/chord models. Neither is a small extension of the current detector.

## Phone Microphone While Bluetooth Plays

### Feasibility verdict

A foreground, unlocked mobile browser can generally keep a YouTube embed
playing while `getUserMedia()` captures microphone audio. This is a plausible
experiment, not yet a portable product contract.

The best route is **high-quality A2DP output plus the phone's built-in
microphone**. A Bluetooth car/headset microphone uses the bidirectional
HFP/SCO profile; selecting it normally switches output away from stereo A2DP
to lower-bandwidth mono voice audio. Android Chrome can expose enough devices
to select the built-in mic explicitly on some phones. iOS/Safari owns more of
the route and may still prioritize HFP when a dual-profile accessory is
connected.

Relevant platform contracts:

- [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
  defines `echoCancellation`, `noiseSuppression`, and `autoGainControl`.
  Boolean constraints are requests unless made exact; accepted settings must
  be read back from the track.
- [Apple Bluetooth audio-session options](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp)
  distinguish output-only A2DP from bidirectional HFP and give HFP routing
  priority when its input is selected.
- [Web Audio](https://www.w3.org/TR/webaudio/) supplies the foreground
  analyser clock, but route and accessory latency are outside its control.
- The [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)
  exposes playback state/time, not audio samples. Same-origin/CORS rules mean
  Voice-Wei cannot connect the cross-origin YouTube media element to Web Audio.

The microphone therefore hears the car speakers acoustically. It does not
receive a clean digital copy of the recording.

### Processing constraints

For music analysis, test a capture request with:

```text
echoCancellation: false
noiseSuppression: false
autoGainControl: false
```

and record the actual `MediaStreamTrack.getSettings()` result. Android Chrome
usually exposes all three. Safari may ignore independent noise-suppression and
gain controls, and car/headset hardware may apply processing before the browser
receives samples.

For detecting yui over speakers, a second condition with echo cancellation on
is also necessary. Echo cancellation can damage sustained harmonics or
consonant/voicing boundaries, while no cancellation may make the detector lock
to the recording. There is no correct setting in the abstract; the car route
must decide it from measured pitch accuracy.

### Hard limits

- A2DP adds route-dependent buffering. `YT.Player.getCurrentTime()` is media
  time, not the instant that sample exits the car speaker. Alignment needs a
  measured offset per phone/accessory route.
- The page must be treated as foreground-only. iOS can interrupt capture or
  Web Audio when hidden/locked, Android behavior varies by OEM, and YouTube
  policy does not provide a supported background embedded-player contract.
- A live pitch trace updates at animation-frame speed; car metadata does not.
  Bluetooth receivers redraw unpredictably and the Media Session API gives no
  delivery-frequency guarantee. The phone can show the full trace, while line
  two should receive only a pitch that has remained stable, at most about once
  per second initially.
- With loud car speakers and no usable echo cancellation, MPM may detect the
  recording rather than yui. This is a measured failure, not a case for
  guessing which source won.

### Required device experiment

No product implementation should precede a route experiment:

| Phone/browser | Output | Requested input |
|---------------|--------|-----------------|
| Android Chrome (at least Pixel and Samsung) | phone speaker | built-in mic |
| Android Chrome | A2DP-only speaker | built-in mic |
| Android Chrome | dual-profile car/headset | default, built-in, then Bluetooth mic |
| iPhone Safari | phone speaker | built-in mic |
| iPhone Safari | A2DP-only speaker | available input |
| iPhone Safari | AirPods and actual car | default and any enumerated phone mic |

For each route:

1. Start playback then capture; repeat capture then playback.
2. Record device labels, track capabilities/settings, sample rate,
   `AudioContext` state, mute/end events, and whether output audibly falls from
   A2DP to HFP.
3. Tap the phone and accessory microphones to identify the physical input.
4. Test processing off, echo cancellation on, and the browser default.
5. Measure acoustic latency with a controlled same-origin click/chirp before
   comparing it with YouTube time.
6. Test isolated sung notes, full recorded mix, and yui singing over the mix.
   Score voiced recall, octave errors, and cents error rather than judging by a
   plausible-looking note label.
7. Test route changes, interruption by a call, brief backgrounding, and lock.
   Background success is diagnostic only, never a portability promise.

The experiment should be a diagnostic mode owned by `pitch-detect-core.js`,
the sole `getUserMedia()` owner. It should expose raw route/settings evidence
before any key or coaching claim.

## External Musical Information

There is no single broad, legally reusable source for modern recordings'
section keys, chords, and vocal melodies. Recording identity and every musical
claim must retain separate provenance.

### Sources suitable for direct integration

| Source | Useful data | Contract and limitation |
|--------|-------------|-------------------------|
| [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API) | exact recording/release identity, MBID, ISRC, artist, duration, external links | no key/chords/melody; core data is CC0; keyless API with a meaningful User-Agent and rate limit |
| [Wikidata](https://www.wikidata.org/wiki/Wikidata:Data_access) | sparse tonality, BPM, and meter claims with references | CC0 and keyless, but usually composition-level and very incomplete |
| [McGill Billboard](https://ddmal.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/) | beat-level chords, key changes, and verse/chorus/bridge structure for 740 chart recordings | CC0 and recording-aligned; limited mainly to 1958-1991 |
| [SALAMI](https://github.com/DDMAL/salami-data-public) | hierarchical section boundaries for 1,300+ tracks | CC0; no chords or vocal melody |
| [OpenScore Lieder](https://github.com/OpenScore/Lieder) | exact vocal notes, written key/meter/tempo, range, and starting pitch for public-domain art songs | CC0 scores; edition/composition facts are not automatically facts about a selected recording |

[ReccoBeats](https://reccobeats.com/docs/documentation/introduction) is a
current no-key candidate for estimated global key/mode/BPM/meter. It has no
published reliability guarantee or service-level contract. It would be a new
runtime dependency and therefore needs explicit approval plus a measured
accuracy audit before integration. Values must be labeled `estimated`, never
presented as score facts.

### Sources that should be links, not ingested data

- [Hooktheory TheoryTab](https://www.hooktheory.com/theorytab/) has the most
  relevant section-labeled chords, key changes, and melody/range material, but
  its public API exposes progression statistics rather than complete song
  transcriptions and its terms prohibit scraping/redistribution.
- Ultimate Guitar, Songsterr, and Chordify have broad chord/tab coverage but
  no supported public data API for this use. Publisher/user licenses do not
  transfer to Voice-Wei.
- Genius is useful for annotations and section names, not structured musical
  analysis; its API requires an account and does not grant lyric reuse.
- Musicnotes and Singing Carrots often show original key or vocal range but
  should be surfaced as ordinary links only.
- GetSongKey/GetSongBPM require an account/API key and backlink; Tunebat and
  SongBPM have no suitable stable public contract.

The app may show normal outbound links to these sites. It must not scrape,
copy chord-over-lyric pages, automate paid downloads, or assume that an AI
summary changes the source's reuse rights.

### Sources not suitable as foundations

- Spotify Audio Features is deprecated/restricted for new apps, requires
  account/quota conditions, and carries storage/ML restrictions.
- AcousticBrainz stopped accepting submissions in 2022; its estimates are
  frozen, its live service is expected to retire, and MetaBrainz documents
  unreliable key/BPM predictions. Dumps may support a future offline audit,
  not a live dependency.
- DALI contains aligned vocal notes for modern songs but is restricted to
  noncommercial research. POP909 and other research datasets have unresolved
  composition-rights questions for product reuse.

### Existing-provider web research

The already configured Claude/OpenAI provider can search the web on explicit
request. Musical Guide can use that path without adding an account or browser
key, but its prompt and output contract must differ from Story Report:

- identify the exact recording/version first;
- cite every factual musical claim;
- distinguish concert key, chord-shape key, capo, and tuning;
- report source disagreement and confidence in the saved detail panel;
- emit `unknown` rather than infer exact chords, range, or melody;
- never reproduce restricted lyrics, tablature, or notation;
- derive short second-line cues only from claims that passed validation.

The second line can omit unknowns. The persisted full analysis cannot silently
omit uncertainty, because incorrect singing instructions are worse than no
instruction.

## Musical Guide Data Contract

Free-form prose is not sufficient for musical claims. One persisted record per
selected recording should use named fields:

```text
RecordingMusicalAnalysis
  videoId
  recordingIdentity { musicBrainzRecordingId?, isrc?, artist, title, release }
  global
    concertKey: Claim<KeyMode>?
    tempoBpm: Claim<number>?
    meter: Claim<string>?
    tuningHz: Claim<number>?
    instrumentTuning: Claim<string>?
    capo: Claim<number>?
    chordShapeKey: Claim<KeyMode>?
  sections[]
    { label, startSec?, endSec?, key?, chords?, sourceIds[], confidence }
  vocal
    { range?, tessitura?, firstPitch?, melodySource?, recordingSpecific }
  singingTips[]
  listeningNotes[]
  sourceLinks[]
  generatedAt
  provider
  model

Claim<T>
  value
  confidence
  method: sourced | score-derived | dataset | estimated | user-corrected
  sourceIds[]
```

`concertKey`, `chordShapeKey`, capo, and tuning are never aliases. A score's
vocal range carries `recordingSpecific: false` until the selected recording is
verified against it.

The shared display layer derives `DisplayCue[]` from typed Story Report and
Musical Guide records:

```text
DisplayCue { mode, text, startSec?, intervalIndex?, sourceIds[] }
```

Story cues advance by the selected interval. Musical cues use track/section
time when a source provides trustworthy boundaries; otherwise they use the
same interval clock. Lyrics keep their existing LRCLIB timeline independently.
One deadline scheduler renders both lines from actual YouTube time.

## Combined Build Plan

### Stage 0: Correct and unify the two-line display — SHIPPED v287

1. Keep timed lyrics on the primary line.
2. Move Story Report to the secondary line.
3. Add explicit `Identity | Story Report` secondary-line modes.
4. Give `media-session-core.js` separate stable track identity, primary
   display line, and secondary display line inputs.
5. Keep artwork/position/playback keyed only to `videoId`.
6. Verify the actual car displays title/artist in the expected order before
   relying on the words “first” and “second.”

### Stage 1: Source-grounded Musical Guide

1. Add **Request Musical Guide** beside Story Report.
2. Extend the selector to `Identity | Story Report | Musical Guide`.
3. Use the selected existing AI provider's required web search.
4. Save the structured record, exact prompt, complete response, citations,
   model/provider, and source links before activating it.
5. Validate keys/chords/ranges as typed claims; preserve conflicts and
   unknowns in a detail panel.
6. Generate <=50-character second-line cues for how to sing, play, understand,
   and listen to the song.
7. Reuse the selected interval; align cues to sections only when timestamps
   are sourced.
8. On replay, restart the saved guide without another request.

This is the first useful musical version because it does not depend on
unproven microphone routing.

### Stage 2: Keyless/open structured enrichment

After explicit approval of any new runtime source:

1. Resolve exact recording identity through MusicBrainz.
2. Read sparse Wikidata claims and references.
3. Match CC0 McGill/SALAMI annotations where catalog coverage exists.
4. Derive vocal facts from explicitly compatible open scores only, labeled as
   score-derived.
5. Audit ReccoBeats against known recordings before deciding whether its
   estimates deserve a runtime role.
6. Surface ordinary links for restricted chord/tab/range sites.

### Stage 3: Microphone route diagnostic

1. Build the device matrix above as a diagnostic, not a user-facing promise.
2. Extend `pitch-detect-core.js` to expose capture settings and spectral frames
   while preserving its ownership of microphone access.
3. Measure MPM on isolated voice and sing-over-playback conditions.
4. Add chroma/HPCP key estimation as a separate algorithm; never reinterpret
   MPM's one-note output as a chord/key.
5. Store confidence, route, processing settings, and calibration with every
   experiment.

### Stage 4: Live singing display

Only after a real car route passes:

1. Show the full pitch trace and confidence on the phone.
2. Publish a held note/cents summary to the secondary Bluetooth line no faster
   than receiver testing supports.
3. Never publish a pitch when accompaniment leakage makes source identity
   ambiguous.
4. Keep voice recognition and pitch capture as explicit mutually exclusive
   microphone sessions.

### Stage 5: Section and vocal alignment

1. Align sourced verse/chorus/bridge boundaries to LRCLIB line times.
2. Show section key/chords beside the corresponding lyric when provenance is
   strong.
3. Add user correction for key, capo, section boundaries, and source match;
   user-corrected claims outrank estimates.
4. Compare live singing against a target only when a legal,
   recording-specific vocal melody exists.

Arbitrary commercial-recording vocal extraction, source separation, and
generated notation remain research. They must not be implied by a global key
estimate or a chord-page link.

## Decisions Established by This Research

1. Lyrics remain the primary line; secondary accompaniment is mode-selectable.
2. Story and Musical records are separate typed concepts with one shared cue
   renderer.
3. Source-grounded Musical Guide precedes microphone-derived analysis.
4. Existing MPM can test user voice; it cannot infer full-mix harmony.
5. Full-mix key needs chroma/HPCP and measured confidence.
6. Exact recorded vocal melody is unavailable for most commercial songs
   without restricted notation or heavy source-separation/transcription work.
7. Restricted chord/tab/range sites are outbound links only.
8. No new runtime data provider, account, paid service, or analysis dependency
   is added without explicit approval.
9. The real phone/car route, not desktop simulation, is the acceptance test
   for microphone and second-line Bluetooth behavior.
