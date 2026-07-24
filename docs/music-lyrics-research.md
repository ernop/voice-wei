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
guidance; a later proven microphone mode may temporarily prioritize stable
facts detected from the sounding recording, such as key, tempo, or a coarse
chord root.

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

## Scope: Analyze the Sounding Song, Not the User

The word “pitch” hides separate jobs:

1. **Recording melody:** track the recording's predominant melodic line and,
   only with stronger evidence, decide whether it is the lead vocal.
2. **Harmony/rhythm:** infer key, chord roots, tempo, and musical changes from
   the complete recording.

User singing is explicitly outside this Lyrics feature. The existing practice
tools continue to own user-voice tracing and scoring.

The existing McLeod Pitch Method (MPM) in `pitch-detect-core.js` is a
monophonic voice detector. A full mix contains vocals, bass, chords, and
percussion simultaneously, so MPM will jump among dominant periodic sources
and cannot identify a chord or reliably establish a key. Song analysis needs a
separate spectral pipeline: pitch-class features (chroma/HPCP) and temporal
models for harmony/rhythm, with predominant-melody contours as a later
experiment. It may share microphone ownership with `pitch-detect-core.js`; it
must not reinterpret MPM output as song analysis.

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

Echo cancellation is especially dangerous here because the locally played
song is the desired signal: an effective canceller may remove or spectrally
damage exactly what Musical Guide needs to analyze. Processing-off is the
target route; browser-default processing is a negative-control condition.

### Hard limits

- A2DP adds route-dependent buffering. `YT.Player.getCurrentTime()` is media
  time, not the instant that sample exits the car speaker. Alignment needs a
  measured offset per phone/accessory route.
- The page must be treated as foreground-only. iOS can interrupt capture or
  Web Audio when hidden/locked, Android behavior varies by OEM, and YouTube
  policy does not provide a supported background embedded-player contract.
- Spectral estimates can update many times per second; car metadata does not.
  Bluetooth receivers redraw unpredictably and the Media Session API gives no
  delivery-frequency guarantee. The phone can show diagnostics, while line
  two receives only a confidence-gated musical summary at a tested cadence.
- Road noise, speech, navigation prompts, and conversation can contaminate the
  song. Low confidence must suppress output rather than producing a plausible
  label.

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
4. Test processing off and the browser default; echo-cancelled capture is an
   expected-failure control because it may remove the song.
5. Measure acoustic latency with a controlled same-origin click/chirp before
   comparing it with YouTube time.
6. Play full annotated recordings covering clear/ambiguous key, chord changes,
   tempo, meter, instrumental/vocal sections, and modulation. Score each task
   against its annotation rather than judging by a plausible-looking label.
7. Test route changes, interruption by a call, brief backgrounding, and lock.
   Background success is diagnostic only, never a portability promise.

The experiment should be a diagnostic mode owned by `pitch-detect-core.js`,
the sole `getUserMedia()` owner. It should expose raw route/settings evidence
before any key or coaching claim.

## Live Song-Only Detection

### What is realistically detectable

Published benchmarks use clean digital audio. A phone re-recording car speakers
adds room response, mono summation, car EQ, road noise, clipping, navigation
prompts, and possible browser processing, so those benchmarks are ceilings.
Initial acoustic expectations are engineering priors to test, not product
claims:

| Information | Feasibility from car-speaker capture | Earliest useful result |
|-------------|--------------------------------------|------------------------|
| tempo | strongest candidate; half/double ambiguity remains | provisional after 8-15s; update every 1-2s |
| global major/minor key | useful with long aggregation and abstention | provisional after 20-30s; stable after 40-60s |
| tuning offset | possible in tonal, unclipped passages | after 20-30s |
| chord root | conditional on clear harmony and beat confidence | 2-4 beats late |
| major/minor chord | weaker than root; omit extensions/inversions | 2-4 beats late |
| local key change | retrospective and ambiguous | 5-10s after a sustained change |
| section boundary | contrast detection only, not verse/chorus naming | 6-12s late |
| meter/downbeat | weak; common meters only after long context | 30-60s, experimental |
| predominant melody | may follow vocal, guitar, synth, or bass | delayed research trace only |
| lead-vocal melody | source identity cannot be guaranteed from salience | not a product output |

Clean-audio context:

- NNLS Chroma reached 80% on the 2009 MIREX chord collection, but its authors
  evaluated digital recordings, not phone/car capture
  ([Mauch and Dixon](https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2010/Mauch-Dixon-ISMIR-2010.pdf)).
- Current MIREX chord systems remain far from perfect even before acoustic
  recapture ([MIREX chord results](https://music-ir.org/mirex/wiki/2020:Audio_Chord_Estimation_Results)).
- MELODIA estimates a **predominant** melodic contour, not vocal identity; it
  may choose another salient instrument
  ([MELODIA](https://www.upf.edu/web/mtg/melodia)).
- Essentia marks its meter algorithm experimental and not evaluated
  ([Meter](https://essentia.upf.edu/reference/std_Meter.html)).

### Recommended causal signal pipeline

Do not send full-mix audio through MPM. Use a separate, bounded-latency
pipeline:

1. Capture mono PCM from the built-in phone microphone with browser processing
   disabled. Reject HFP/speech-band routes, clipping, low level, and streams
   whose effective bandwidth is unsuitable.
2. Use `AudioWorklet` only to move fixed blocks into a ring buffer. Run all
   feature extraction and inference in a Worker so analysis cannot interrupt
   playback or the audio-rendering thread.
3. Maintain a 4096-sample Hann STFT with a 1024-sample hop at 44.1/48 kHz for
   spectral peaks, onsets, quality checks, and tuning. The existing 2048-frame
   MPM analyser is not a sufficient harmonic representation.
4. Estimate global tuning from stable spectral-peak deviations over 20-30
   seconds. Feed the estimate into a 36-bin harmonic pitch class profile
   (HPCP), preserving three bins per semitone until final decisions.
5. Build separate whole-band/treble and bass-emphasized chroma. Whole-band
   evidence supports key; bass evidence helps distinguish chord roots from
   upper harmonics.
6. Estimate global key by correlating rolling HPCP with 24 major/minor key
   profiles. Smooth with a low-transition 24-key-plus-uncertain HMM. Do not
   expose church modes or tonicizations.
7. For chords, average chroma between accepted beats, compare only 24
   major/minor templates plus no-chord, then apply a fixed-lag HMM/Viterbi
   smoother. Compare ordinary HPCP against NNLS chroma before selecting the
   production front end.
8. Derive several onset functions (spectral flux, complex-domain change,
   low-frequency energy) and feed an online tempogram/comb bank plus causal
   beat-phase tracker. Whole-track rhythm algorithms are not automatically
   valid in a live stream.
9. For section changes, combine beat-synchronous chroma, log-mel/MFCC timbre,
   loudness, and rhythmic density. A bounded-history self-similarity novelty
   detector may say “section changed”; it cannot safely name verse or chorus.
10. Keep predominant melody outside the primary pipeline. A later delayed
    experiment may process overlapping chunks with MELODIA and a singing-voice
    classifier, but must label the result “predominant melody,” never “vocal.”

The algorithm's timestamps describe what reaches the microphone now. A2DP
latency matters only when persisting those observations against YouTube media
time; that mapping needs route calibration.

### Confidence and abstention

Raw algorithm “strength” values are not probabilities. Calibrate every display
gate on held-out physical car recordings.

Three layers decide whether line two may speak:

1. **Session quality:** A2DP retained, built-in microphone selected, processing
   off, full-enough bandwidth, no sustained clipping, adequate music level.
2. **Observation quality:** tonal concentration, onset periodicity, harmonic
   peak count, estimated signal/noise, and agreement between bass/treble
   evidence.
3. **Decision quality:** top-two margin, persistence across windows, agreement
   between algorithm variants, and calibrated precision on unseen captures.

Initial display rules:

- Key: same major/minor key across three windows and calibrated precision >=80%.
- Chord: ordinary and NNLS chroma agree on root, two beat windows agree, and
  calibrated root precision >=75%.
- Tempo: dominant tempo clearly exceeds half/double candidates and varies <2%
  for five seconds.
- Tuning: at least three consistent pitch classes and uncertainty <=5 cents.
- Section: both harmonic and timbral novelty exceed calibrated thresholds.
- Melody: never reaches Bluetooth output until predominant-contour accuracy and
  source-identity evidence pass separate tests.

When confidence fails, retain the last value briefly, then show `Listening` or
`Signal unsuitable`; never cycle through guesses. Report both precision and
coverage during evaluation: a detector that speaks once per song can look
accurate while being useless.

### Second-line display policy

The analyzer can compute frequently, but Bluetooth metadata should be sparse:

```text
Listening to song...
Tempo ~118 BPM
Key estimate: G major
G major · chord root E
Possible key change: A major
Section changed
Signal unsuitable
```

The first lyric line remains independent. Start with no faster than one
secondary-line update per second, then use actual car redraw behavior to set
the limit. Chord changes should require two consistent beat windows; key and
tempo should update only after meaningful confidence changes. A detailed phone
panel may show diagnostics that never reach the car.

### Browser implementation candidates

Adding any dependency requires a separate decision after a measurement spike:

| Candidate | Fit | Cost / constraint |
|-----------|-----|-------------------|
| [Essentia.js](https://mtg.github.io/essentia.js/) | strongest prototype: WASM HPCP, tuning, NNLS chroma, key, chords, rhythm, MELODIA | roughly multi-megabyte browser payload; AGPLv3 or commercial license; API still evolving |
| [Meyda](https://meyda.js.org/audio-features.html) | permissive MIT, lightweight STFT/chroma/MFCC/flux building blocks | no tuning-aware HPCP, chord/key temporal models, or robust beat tracker; avoid its deprecated `ScriptProcessorNode` wrapper |
| [NNLS Chroma / Chordino](https://isophonics.net/nnls-chroma) | strong research baseline for tuning-aware chord features | original C++ Vamp plugin is GPLv2 with no maintained official browser port; smoothing is described as non-state-of-the-art |
| TensorFlow.js / ONNX Runtime Web | possible classifiers after classical baseline | model load, thermal behavior, browser backend support, and sustained mobile CPU/GPU require proof |
| Basic Pitch TS | polyphonic note transcription experiment | optimized for one instrument, not identifying lead vocal in a full mix |
| browser source separation | could improve vocal analysis | model size, memory, battery, latency, and model-weight licensing make it unsuitable for the default loop |

The efficient research path is an isolated Essentia.js measurement spike, not
a product dependency: test whether the algorithm family survives phone/car
recapture. If it does, wei can decide whether its license is acceptable or a
small permissively licensed implementation of only the validated pipeline is
better.

### Evaluation corpus and acceptance gates

Use annotations only with audio obtained legally:

- Isophonics Beatles/Queen: key regions, chords, beats, and sections for
  locally owned matching releases.
- GiantSteps+: global key and tempo on EDM excerpts.
- Ballroom: beats and metric positions across common dance meters.
- MedleyDB: royalty-free multitracks and melody/vocal annotations, under its
  noncommercial research terms.
- SALAMI: structural annotations, prioritizing tracks with lawful audio.

Evaluate three levels:

1. Clean digital PCM baseline.
2. Deterministic simulation: mono, representative car EQ/impulse responses,
   compression/clipping, road noise at multiple SNRs, and an HFP
   speech-bandwidth expected-failure condition.
3. Physical capture: at least Pixel/Samsung/iPhone, two cars, mount/cup-holder/
   seat positions, parked/idling/urban/highway, and several playback levels.

Split by song, phone, and car so calibration never sees another version of the
held-out condition. Record every route, constraint setting, and acoustic
condition.

Initial physical-capture go/no-go thresholds:

| Task | Required result when displayed |
|------|--------------------------------|
| route | A2DP + built-in mic + unprocessed usable bandwidth in >=95% of sessions per supported platform |
| global key | >=80% exact precision, >=60% coverage, p95 stable result <=45s |
| chord root | >=75% weighted recall over displayed time, >=40% coverage |
| major/minor chord | >=65% weighted recall over displayed time |
| tempo | >=90% within 4%, >=80% coverage, p95 first result <=12s |
| beat | F1 >=0.75 and p95 phase error <=100ms before beat-driven UI |
| local key | >=70% exact precision when displayed; otherwise hide |
| section boundary | F1@3s >=0.60, <=0.3 false alarms/minute, p95 delay <=10s |
| tuning | median error <=5 cents, 90th percentile <=10 cents |
| predominant melody | RPA >=0.75 and overall accuracy >=0.65 before any product display |
| runtime | real-time factor <=0.30, <1% dropped blocks, stable 20-minute thermal run |

Use standardized MIR metrics (`mir_eval`) and publish precision together with
coverage and time-to-result. The first spike succeeds if tempo and global key
pass; chords and melody are independent later gates.

### Strictly out of scope

- Listening to, scoring, or separating the user's singing.
- Treating MPM's dominant pitch as the song's key, chord, or vocal line.
- Direct YouTube PCM access or phone tab capture.
- Exact YouTube-time alignment before route calibration.
- Chord extensions, inversions, slash chords, capo shapes, or prediction.
- Semantic verse/chorus labels from acoustic novelty alone.
- Claiming a predominant contour is the lead vocal.
- Mandatory mobile source separation.
- Supporting routes that switch to HFP or retain destructive echo cancellation.

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
3. Measure the song-only spectral pipeline on annotated full mixes; do not run
   user-voice scoring or MPM.
4. Add tuning-aware chroma/HPCP key and tempo estimation first, followed by
   separately gated chord-root experiments.
5. Store confidence, route, processing settings, and calibration with every
   experiment.

### Stage 4: Live song-analysis display

Only after a real car route passes:

1. Keep the three second-line options `Identity | Story Report | Musical
   Guide`; within Musical Guide, accepted live detections temporarily
   prioritize its saved sourced cues.
2. Publish confidence-gated tempo and global key first, no faster than receiver
   testing supports.
3. Add chord root/major-minor only if their independent physical-capture gates
   pass.
4. Keep detailed quality/confidence diagnostics on the phone; line two shows
   only accepted musical information.
5. Pause analysis rather than guess during navigation prompts, conversation,
   clipping, HFP routing, or destructive browser processing.

### Stage 5: Section and vocal alignment

1. Align sourced verse/chorus/bridge boundaries to LRCLIB line times.
2. Show section key/chords beside the corresponding lyric when provenance is
   strong.
3. Add user correction for key, capo, section boundaries, and source match;
   user-corrected claims outrank estimates.
4. Evaluate delayed predominant-melody contours against recording annotations;
   never label them vocal without source-identity evidence.

Arbitrary commercial-recording vocal extraction, source separation, and
generated notation remain research. They must not be implied by a global key
estimate or a chord-page link.

## Decisions Established by This Research

1. Lyrics remain the primary line; secondary accompaniment is mode-selectable.
2. Story and Musical records are separate typed concepts with one shared cue
   renderer.
3. Source-grounded Musical Guide precedes microphone-derived analysis.
4. This microphone mode analyzes only the sounding recording; user singing
   remains in the separate practice tools.
5. Existing MPM is not part of song analysis and cannot infer full-mix harmony.
6. Full-mix key needs tuning-aware chroma/HPCP and measured confidence.
7. Tempo and global major/minor key are the first live acceptance targets;
   chords, meter, sections, and melody have independent gates.
8. Exact recorded vocal melody is unavailable for most commercial songs
   without restricted notation or heavy source-separation/transcription work.
9. Restricted chord/tab/range sites are outbound links only.
10. No new runtime data provider, account, paid service, or analysis dependency
   is added without explicit approval.
11. The real phone/car route, not desktop simulation, is the acceptance test
   for microphone and second-line Bluetooth behavior.
