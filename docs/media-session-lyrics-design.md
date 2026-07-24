# Listening Text over Media Session

## Why this needs its own contract

The Lyrics tool uses a track-oriented protocol as a changing listening-text
display:

- Media Session `title` carries the current lyric.
- Media Session `artist` carries the selected second line: stable
  `year - artist - song` identity or the current song-report line.
- A silent audio element keeps the top-level Voice-Wei page in control while
  the audible song plays in a YouTube iframe.

This is intentionally unlike a normal player. In a normal player, a changed
title usually means a changed track. Here, title and artist changes mean that
the same track continued into its next lyric or report line.

The implementation must therefore keep four concepts separate:

1. **Track identity** changes only when the sounding `videoId` changes.
2. **Primary lyric display** changes at lyric boundaries while track identity
   stays fixed.
3. **Secondary accompaniment display** changes at report boundaries or reverts
   to stable identity while track identity stays fixed.
4. **Playback position** comes from the YouTube player's current time and
   duration, not from lyric timing or the silent ownership audio.
5. **Session ownership** is the top-level page's silent audio mechanism. It is
   transport plumbing, not the song or its timeline.

## What is true today

### In the page

The visible progress bars and `elapsed / total` text read
`YT.Player.getCurrentTime()` and `YT.Player.getDuration()`. One deadline clock
renders those values and the current listening line from the same sampled
YouTube time. Lyric/report deadlines can wake the clock between whole seconds,
but a text change
does not reset the in-page timeline.

This shared clock is useful: it gives progress and lyrics one source of time.
It does not mean a lyric is a new song.

### In the operating system, lock screen, or car

Voice-Wei currently publishes:

- complete Media Session metadata (`title`, `artist`, `album`, and `artwork`)
- the real YouTube position, duration, and playback rate
- Media Session playback state
- play, pause, previous/next, relative seek, and absolute seek handlers

The elapsed-total state is sampled from the same YouTube clock as the in-page
progress bar; it never comes from the hidden 10-second ownership WAV. Artwork
is the selected video's `hqdefault.jpg`, keyed by the sounding `videoId`, and
remains unchanged across lyric updates.

Receiver presentation is still device-specific. A car may omit a field,
crop artwork, or redraw when the lyric title changes, but Voice-Wei sends one
complete, internally consistent account of the continuing song.

### Metadata updates

Each real track installs one `MediaMetadata` object. Distinct lyric, report
line, identity intro, or countdown values mutate that object's `title` and/or
`artist` fields in place; identical repeats are deduplicated. Report mode
changes only the presented artist line; Identity mode restores the stable
`year - artist - song` value. A line transition never clears or rewrites
Media Session position state, so the receiver's time remaining stays
continuous.

The Web Media Session API has no stable track-ID field and no transient lyric
field. A browser or Bluetooth head unit may interpret a title metadata change
as a track change even when the other fields and playback position stay
stable. `setPositionState()` can supply the correct song timeline, but the web
API cannot guarantee how every receiver combines position and changing title
metadata.

## Desired user-visible contract

For the whole time one `videoId` is sounding:

| Surface | Value |
|---|---|
| First text line | identity intro/countdown/current lyric; report mode never replaces it |
| Second text line | selected mode: `year - artist - song` identity or current song-report line |
| Artwork | one explicit image, stable for the song |
| Position / duration | YouTube song position and duration |
| Playback state | true playing, paused, or stopped state |

A listening-text transition changes only its primary or secondary display
channel. It must not:

- reset position;
- change artwork;
- overwrite the other display channel;
- emit previous/next-track behavior; or
- clear and recreate the logical track in Voice-Wei.

A real song boundary is a changed sounding `videoId`, including an alternate
video selected after playback failure. That boundary may update all fields and
reset position to the new song's actual current time.

## Implemented design

### 1. Give Media Session separate semantic inputs

`media-session-core.js` remains the only browser Media Session writer and
accepts distinct semantic state:

```text
setTrackIdentity({ id, title, artist, album, artwork })
setDisplayLine(text)
setSecondaryDisplayLine(text)
setPosition({ duration, position, playbackRate })
setPlaybackState(state)
clearTrack()
```

The core composes one `MediaMetadata` value from stable track identity plus
independent primary/title and secondary/artist display lines. This does not
make receiver behavior predictable, but
it prevents Voice-Wei itself from confusing lyric/report changes with song
changes.

Non-player tools can continue using a simple page/exercise registration API;
they do not need song position or artwork.

### 2. Publish the real YouTube position independently

The core wraps `navigator.mediaSession.setPositionState()`.

The player feeds it from the same YouTube time sample used by
`renderPlaybackPosition()`, never from listening-text relay callbacks. It publishes
at:

- song start, once duration is readable;
- seek;
- pause and resume;
- periodic correction from the whole-second progress clock; and
- real track change.

Clear position on stop or playlist teardown. Clamp values to the API's valid
range because duration may appear before a stable position.

Replacing `navigator.mediaSession.metadata` can make a receiver discard its
timer. Voice-Wei therefore replaces that object only at a true track/session
boundary and reasserts position there. Listening-line transitions use the
standard mutable `MediaMetadata` fields on the installed object and do not
call `setPositionState()`.

### 3. Publish explicit stable artwork

Choose artwork once per sounding `videoId` and include it on every composed
metadata publication. This prevents listening-text writes from sending metadata with
missing artwork and leaving the receiver to choose or cache an unrelated
image.

The selected video's YouTube thumbnail is the deliberate artwork policy. It is
stable for that `videoId` and changes only at a real video boundary.

### 4. Remove false boundaries and stale state

Track setup should happen once in the authoritative `playVideo()` path after
the active `videoId` is known. Lyric rendering updates only the primary line;
song-report rendering updates only the secondary line.

Stopping and clearing the playlist clear track identity, position, artwork,
and playback state together. Pause retains the complete track and freezes its
last real position.

### 5. Keep listening-text propagation conservative

Each distinct lyric or report line still requires a metadata update if the car
is to show it. Do not add extra metadata churn:

- keep identical-value deduplication;
- do not republish stable identity because a listening-text deadline fired unless the
  composed metadata must be sent;
- consider whether the per-second pre-lyric countdown is valuable enough to
  justify one metadata update per second; and
- never drive position from listening-text callbacks.

## Verification

Automated browser tests should prove Voice-Wei's semantics:

1. Several lyric changes keep the same track identity and artwork.
2. Position increases from YouTube time across lyric changes.
3. A lyric change does not reset position to zero.
4. Seek, pause, resume, stop, and real `videoId` changes publish valid state.
5. Session reclaim republishes the complete composed metadata and current
   position.
6. Playlist clear leaves no stale track or position.
7. Other tools using `media-session-core.js` retain their current behavior.

The browser API cannot prove a particular car's rendering policy. Device
validation must answer:

- Does its timer follow the YouTube duration after position state is set?
- Does changing only the lyric title reset or flicker that timer?
- Does explicit stable artwork remain stable across lyric changes?
- Does artwork update exactly once at a real track change?

Those observations decide whether position should be reasserted after every
lyric metadata write and whether the countdown should be reduced or removed.

## Safe order of work

1. Refactor core state into track identity, display line, position, and
   playback state without changing the visible two-line text.
2. Add position publication and automated lifecycle tests.
3. Fix stop/playlist-clear cleanup.
4. Add one explicit artwork policy.
5. Observe the actual car behavior and tune only the compatibility details
   supported by that evidence.

This order preserves the working lyric relay while making Voice-Wei's own
model correct before optimizing for one receiver.
