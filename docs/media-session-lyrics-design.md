# Lyrics over Media Session

## Why this needs its own contract

The Lyrics tool uses a track-oriented protocol as a lyric display:

- Media Session `title` carries the current lyric.
- Media Session `artist` carries `year - artist - song`.
- A silent audio element keeps the top-level Voice-Wei page in control while
  the audible song plays in a YouTube iframe.

This is intentionally unlike a normal player. In a normal player, a changed
title usually means a changed track. Here, most title changes mean that the
same track continued into its next lyric line.

The implementation must therefore keep four concepts separate:

1. **Track identity** changes only when the sounding `videoId` changes.
2. **Lyric display** changes at lyric boundaries while track identity stays
   fixed.
3. **Playback position** comes from the YouTube player's current time and
   duration, not from lyric timing or the silent ownership audio.
4. **Session ownership** is the top-level page's silent audio mechanism. It is
   transport plumbing, not the song or its timeline.

## What is true today

### In the page

The visible progress bars and `elapsed / total` text read
`YT.Player.getCurrentTime()` and `YT.Player.getDuration()`. One deadline clock
renders those values and the current lyric from the same sampled YouTube time.
Lyric deadlines can wake the clock between whole seconds, but a lyric change
does not reset the in-page timeline.

This shared clock is useful: it gives progress and lyrics one source of time.
It does not mean a lyric is a new song.

### In the operating system, lock screen, or car

Voice-Wei currently publishes:

- Media Session metadata (`title` and `artist`)
- Media Session playback state
- media-key action handlers

Voice-Wei does **not** publish Media Session position state or artwork.

Consequently, an OS/car elapsed-total display is not currently trustworthy as
the song clock. Depending on browser routing, it may reflect:

- the hidden 10-second looping WAV used to own the session;
- the YouTube iframe's media session; or
- device-specific cached/default state.

Likewise, the image may be Voice-Wei's favicon, YouTube artwork from a routed
iframe session, or cached device artwork. Voice-Wei does not currently select
it. YouTube artwork is a plausible explanation for a first-song image that
then sticks, but it has not been proven on the observed device.

### Metadata updates

Every distinct lyric, identity intro, or countdown value assigns a new
`MediaMetadata` object. Identical repeats are deduplicated. The second-line
`artist` value remains stable during the song.

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
| First text line | identity intro, countdown if needed, then current lyric |
| Second text line | `year - artist - song`, skipping missing fields |
| Artwork | one explicit image, stable for the song |
| Position / duration | YouTube song position and duration |
| Playback state | true playing, paused, or stopped state |

A lyric transition changes only the first text line. It must not:

- reset position;
- change artwork;
- change the stable second line;
- emit previous/next-track behavior; or
- clear and recreate the logical track in Voice-Wei.

A real song boundary is a changed sounding `videoId`, including an alternate
video selected after playback failure. That boundary may update all fields and
reset position to the new song's actual current time.

## Recommended implementation

### 1. Give Media Session separate semantic inputs

Keep `media-session-core.js` as the only browser Media Session writer, but
replace the title-plus-artist call shape with distinct state:

```text
setTrackIdentity({ id, artistLine, artwork })
setDisplayLine(text)
setPosition({ duration, position, playbackRate })
setPlaybackState(state)
clearTrack()
```

The core composes one `MediaMetadata` value from stable track identity plus the
changing display line. This does not make receiver behavior predictable, but
it prevents Voice-Wei itself from confusing lyric changes with song changes.

Non-player tools can continue using a simple page/exercise registration API;
they do not need song position or artwork.

### 2. Publish the real YouTube position independently

Add a core wrapper around `navigator.mediaSession.setPositionState()`.

The player should feed it from the same YouTube time sample used by
`renderPlaybackPosition()`, not from `relayLyricToNowPlaying()`. Publish at:

- song start, once duration is readable;
- seek;
- pause and resume;
- periodic correction from the whole-second progress clock; and
- real track change.

Clear position on stop or playlist teardown. Clamp values to the API's valid
range because duration may appear before a stable position.

If a receiver resets its timer when title metadata changes, Voice-Wei can
reassert the already-known position immediately after that metadata write as a
device-compatibility measure. This is a synchronized refresh, not a statement
that the lyric is a new track.

### 3. Publish explicit stable artwork

Choose artwork once per sounding `videoId` and include it on every composed
metadata publication. This prevents lyric writes from sending metadata with
missing artwork and leaving the receiver to choose or cache an unrelated
image.

The first implementation should choose one deliberate policy:

- the current video's YouTube thumbnail, stable for that `videoId`; or
- a bundled Voice-Wei image, stable for every song.

The current video thumbnail is more informative; a bundled image is more
predictable and independent of image-host behavior. This is a product choice,
not a required part of position correctness.

### 4. Remove false boundaries and stale state

Track setup should happen once in the authoritative `playVideo()` path after
the active `videoId` is known. Lyric rendering should only update the display
line.

Stopping and clearing the playlist must clear track identity, position,
artwork, and playback state together. At present, normal stop clears the
session, while some playlist-clear paths can leave stale metadata.

### 5. Keep lyric propagation conservative

Each distinct lyric still requires a title metadata update if the car is to
show it. Do not add extra metadata churn:

- keep identical-value deduplication;
- do not republish stable identity because a lyric deadline fired unless the
  composed metadata must be sent;
- consider whether the per-second pre-lyric countdown is valuable enough to
  justify one metadata update per second; and
- never drive position from lyric callbacks.

## Verification plan

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
