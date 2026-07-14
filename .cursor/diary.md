# Mei Diary

Entries are mei writing to future mei. The human can read this too.

---

## 2026-07-14 (car lyric relay keyed off panel focus)

**Context**: Yui reported timed lyrics advancing in Big Lyrics, but the
car / title surfaces (Media Session, header lyric line) not updating
even though they used to.

**Root cause**: `updateSyncedLyricsPosition` / `relayLyricToNowPlaying` /
`nextLyricDeadline` all keyed off `currentLyricsItemId` - the lyrics
*panel* selection. A chip tap on another row (or any path that moved
panel focus off the sounding track) made `playingThisItem` false, so
the car cleared while the overlay could still show readable lyrics.
Secondary: Media Session dedupe kept a stale "already wrote this line"
cache after the silent keep-alive re-armed, so reclaiming the session
from a YouTube iframe did not republish the current lyric.

**Fix**: car/title/sticky-bar lyric always follow `playingPlaylistItem()`;
panel highlight only moves when the panel is showing that track; Big
Lyrics opens the sounding track; lyric arrival resyncs for the playing
id; `ensurePlayingSession` + invalidate published metadata on activate.

**For future mei**: now-playing surfaces are a property of *playback*,
not of which row's lyric chip was last touched. If Big Lyrics / panel
highlight and the car disagree, check that split first.

---

## 2026-07-10 (Phrases/Intervals layout: Test is a bottom dock)

**Context**: Yui asked for a top-to-bottom layout pass — Test does not
belong in transport; pill labels were inconsistent (boxed vs not); Root
vs Key naming drifted across pages.

**Shipped**:
- Test/Sing moved to `.pitch-test-dock` (fixed bottom sheet) on Phrases,
  Intervals, and Scales. Transport is playback only.
- Key is the user-facing label everywhere for the root-pitch stepper.
- Phrases steppers use external `vf-label` + `step-field-bare` (same as
  Intervals/Scales). Intervals got `vf-compact` + segment shells on
  Level/Scale; Go renamed Play.
- Scale card order fixed (explicit flex order 4). Stage labels lowercased.

---

## 2026-07-10 (live-change requirements: signal ≠ version UI)

**Context**: Yui reframed ship/version. The 99% loop is: driving → voice
note to agent → agent ships → yui knows it’s live (often reload phone).
The header integer exists only as a glanceable signal; SHA fails that.
Out-of-band notify (chat after Actions green, Signal/SMS, etc.) is in
scope and could make the on-page number unnecessary. Repo + auto-deploy
to fuseki stay; elegance of CI is not a goal.

**Doc**: `docs/live-change.md` (R1 live / R2 signal / R3 repo). Linked
from agents.md, product-goals, and 10-deploy-workflow.

---

## 2026-07-10 (Trace twitch: growing time axis, not missing library)

**Context**: Yui said Trace is still jumpy/twitchy, Phrases Test is not the
priority, and asked again why wei keep writing a chart from scratch when
libraries exist. Bet that targets still feed the draw path.

**What was actually wrong (code audit)**:
1. **Time window grew with `clockMs()`** every frame (`trace.js` /
   `pitch-test-panel.js`). Width changed continuously → whole chart
   squeezed → classic twitch. Fixed: stable width + always-scroll.
2. **Target bands recolored from scoring verdicts** (`result` →
   green/yellow/red). That is feedback from the interval product into
   the display. Fixed: bare outlines only; ignore `result`.
3. **Cents-colored dots on the voice line** were judgment baked into
   the instrument. Removed.
4. View required `pitch-score.js` only for band height. Decoupled;
   Trace no longer loads scoring.

**Libraries (honest answer for next time)**: There is no drop-in npm
package that is "our Trace" (key rails + degree guides + voice-gated
clock + static no-build site). Detector algorithms exist (YIN/MPM via
Pitchy etc.) and wei already use MPM. Full apps (MercuryPitch, karaoke
UIs) are products to fork, not a chart widget. The canvas renderer is
small; the failures were product coupling and a bad time-axis policy,
not "we should have imported a viz framework."

**Still true**: instrument law - history alone drives the yellow line;
rails/targets are furniture.

---

## 2026-07-10 (faster deploys: cache + telemetry off critical path)

**Context**: Yui asked what makes deploys ~1 min; ~28s was cold
`npm install` + Playwright every run, ~10s telemetry after rsync.

**What worked**: Cache `node_modules` + Playwright browsers; telemetry as a
follow-up job; on cache hit skip `install-deps` (ubuntu-latest has enough
libs for headless). Site is live when rsync finishes.

**What did not**: Running the deploy job in the Playwright Docker image —
container init (~26s) + apt for rsync (~8s) erased the savings and broke
SSH `~` paths until fixed. Reverted to hosted `ubuntu-latest`.

---

## 2026-07-10 (dev/deploy loop untangled)

**Context**: After fixing version bump to ship-with-change, yui asked whether
the whole dev→deploy system was as simple as it could be. Audit found the
version policy was fine; the remaining fights were elsewhere.

**What changed**:
- Actions: `paths-ignore` for docs/rules/demos (no CI on non-shipping
  pushes); `concurrency` cancel-in-progress; tighter rsync excludes
  (no types/tsconfig/dev-servers/screenshots/etc on the server).
- `deploy.sh` matches CI (`--delete` + same excludes); dropped the false
  "put Claude key in server config.json" line.
- Local run: README + setup + `04-local-tooling.mdc` agree on `php -S` as
  canonical; Python static is practice-only; retired Windows/venv rule file.
- `03-project.mdc` rewritten for the multi-tool suite + localStorage keys;
  `00-absolute-rules` config pattern matches reality.
- `10-deploy-workflow`: goals first; empty Cursor PR diff expected;
  bump-only called out as *misleading version*, not just wasted CI.

**Left alone (optional later)**: `php -l` in CI; promote `test:full` to
deploy; npm cache/lockfile; collapsing three local servers into one.

---

## 2026-07-10 (version bump: ship-with-change, not post-push)

**Context**: First Grok session wrote `groks-view.md`, then followed the
old "bump after every push" rule and pushed standalone v255 and v256
bumps — two empty deploys after a docs-only change. Yui clarified the
only real goals: (1) new code reaches the live site so a reload shows
it, (2) the header version proves which build is loaded.

**Rule rewrite**: `.cursor/rules/10-deploy-workflow.mdc` version section
(and agents.md / README / setup / architecture / bump-version.sh /
groks-view) now say: bump **once per user-facing ship, same push as the
change**; never bump-only pushes; skip bump when only rsync-excluded
paths change. Post-push "open the next cycle" is retired.

**Still open (not this change)**: cloud agent PR-branch prompt vs
direct-to-master — yui is fine with either as long as auto-deploy on
master push remains. Cursor PR diff stays empty under master-direct.

---

## 2026-07-08 (song voice lines; two grammars born the same night)

**Context**: Yui is preparing a barbershop chart ("Ain't We Got Fun",
Bob Meyer TTBB, in G) and wants each of the four voice lines as a
typed degree series the app can play. Shipped the phrases Series input:
`parseDegreeSeries` in pattern-practice-core (digits, v/d/arrows for
octaves, #/b for chromatic passing notes as half-integer offsets),
`phraseFromOffsets` as the one Phrase constructor, and a Set action
that is the manual twin of Next (honors play-on-next, joins history).
Errors list under the input and change nothing - no guessing.

**Same-night collision**: while this session built the Series grammar
(5v, 2^), a parallel session shipped the trace pattern octave grammar
(5d, 2u). Same concept, two mark vocabularies, hours apart. The merge
lesson: before inventing any input token grammar, grep for sibling
grammars (trace's patternInput existed all along, octave-blind). Both
inputs now accept v/d/arrow down and ^/u/arrow up. If a third degree
grammar ever appears, extract ONE owner.

**Design fix found by demo review**: the staff crammed accidental-heavy
phrases because width was a fixed 21px/beat guess. Base fix: build and
measure the voice first (applyAccidentals, preCalculateMinTotalWidth),
then size the renderer - content decides width, plus the white staff
band now hugs the SVG (fit-content) instead of spanning the stage.

**Demo recording craft (for future mei)**: the computerUse agent's
zoom/magnifier shows up in screen recordings as jump cuts and white
flashes - record keyboard-only segments (the Series input commits on
Enter partly for this reason); the VM screensaver cuts in after a few
idle seconds, so keep recorded takes short or trim with ffmpeg; and the
videoReview agent catches real bugs (it found the staff cramming), so
believe it and fix rather than re-shoot around defects.

**Open thread**: only the top half of page 1 of the chart was
photographed (intro + chorus mm. 5-9). The baritone intro reading in
tokens: `5v 1 1 7bv 7bv 7v 7v 2# 2# 2# 2# 2`. The lead chorus from the
published melody: `5v 3 3b 3 | 5v 3 3b 3 | 4 4 3 4 | 5v 4 3 4`. Tenor
and bass lines for those measures, plus everything after m. 9, need
clearer/full-page photos from yui.

---

## 2026-07-08 (done-flags vs per-item resolved state)

**Context**: Shipped a "one-time lyrics backfill" gated by a global
`backfilledAt` marker. Yui asked one question: should that be global or
per song? The question exposed two real flaws: the marker was set when
the recheck was QUEUED, so closing the page mid-backfill (or a rate-limit
failure) permanently lost the remainder - the exact interruption bug this
same session had just fixed for playlist lyric fetching.

**The lesson**: a global "done" flag written at the start of an async
batch is a lie about per-item work. When the underlying question is
per-item ("does this song have a resolved lyric state?"), represent it
per-item and reconcile against it on every load - resolved items cost
nothing, unresolved ones re-queue, and interruption recovery falls out by
construction. Reserve one-shot markers for genuinely global events (here:
wiping the pre-rule contaminated miss map, a data migration).

**Also**: when yui asks "should X be A or B - think about it", the answer
may reveal defects in what just shipped. Treat the question as a design
review invitation, not a quiz.

**Later the same night (store-first lyrics)**: yui reported "chip shows L
but playing the song gives no lyrics; reload fixes it" and named the
disease exactly: dual sources. The lyric system had a session-side truth
(item.lyricsData + a fuzzy artist|title|duration-keyed localStorage cache
with alias/miss maps) that could disagree with what a later hydrate
re-matched. The fix that ended the whole class: one permanent owner
(IndexedDB `lyricStates` keyed by videoId - exact identity, no fuzzy
matching), save-then-activate (the store write is AWAITED before the live
object learns the answer), one shared in-flight promise per videoId, and
provider fetches bounded by timeout so nothing wedges in 'loading'.
Rule of thumb yui gave, worth keeping verbatim: "first we save to our
permanent store, then we activate it" - and the play path must read
through the same object that was activated from the store, never a
parallel copy.

---

## 2026-07-07 (the Song primitive; quota bug as a data-model symptom)

**Context**: Yui hit a QuotaExceededError saving the playlist (101 songs)
and asked for the real fix: define what a song IS, then reorganize the
playlist and page around it.

**The base-design analysis**: the quota error was not a storage-size
problem, it was a missing-primitive problem. There was no Song type -
five hand-rolled song shapes (playlist item, favorite, IDB song record,
AI item, YouTube result) built inline with `||` chains. Because
PlaylistItem mixed the durable song with runtime lyric state, persisting
"the playlist" persisted full lyrics per item; the lyrics cache stored
another full copy under every alias key; recordSong spread a third into
IndexedDB. Fix the model and the bug falls out: `player-songs.js` owns
Song (videoId = identity + always-present metadata) and every derived
shape has exactly one constructor; the persisted playlist entry
constructor simply has no lyric fields, and the lyrics cache became
records+aliases (one copy, capped at 200, trimmed loudly).

**Semantics shipped with it**: the playlist is the working list for the
current search - a new AI request REPLACES it, explicit loads (favorites,
history, known songs) APPEND, rows are removable/sortable, ordering is
append-at-end everywhere (the unshift + index++ dance is gone). Nothing
is lost on replace because every added song is recorded to the IDB
known-songs catalog at add time.

**Layout lesson**: yui's complaints (comment jammed into the song cell,
lyric toggle far from the controls) were both "data with no fixed home".
The row is now a grid where every datum has one slot, and the comment -
which the AI writes specifically to be read - got its own full-width
line instead of an ellipsized suffix. Test asserts the slots.

**For future mei**: when a page accumulates display variants of the same
concept in different slots, look for the missing primitive first. Also:
`docs/tools.md` still claimed the now-playing title moves song name to
the artist slot - stale against the Jul 5 lyric-only directive; corrected
here. Docs restating behavior drift silently; when touching a surface,
re-read its doc paragraph.

---

## 2026-07-05 (car title surfaces: the invented-requirement hedge, again)

**Context**: Yui asked for the now-playing title (Bluetooth/car, lock screen,
tab) to be the sing-along lyric line, nothing else. It took three passes to
actually get there, and yui then asked for an audit of how song/artist kept
leaking into the title.

**The audit found**:
- Jun 28 (`e999890`): `updateMediaSessionForItem` wrote song/artist metadata
  at every track start - generic media-player plumbing, predating the lyric
  feature.
- Jul 3 (`9efdffd`): the lyric relay was added, but the commit message says
  "the song name moves into the artist slot **so the track stays
  identifiable**" and gaps/pauses "restore the song's own metadata". Nobody
  asked for identifiability. That is the invented-unstated-requirement
  failure mode from the 2026-06-10 entry, wearing a new coat.
- Jul 5 (this session): told "no extra info, just the song lyric", mei
  removed the decoration from the showing state but left both restore paths
  (track start, gaps) writing song/artist. Narrow application of a directive
  that governed the whole surface.

**Lesson for future mei**: when yui gives a negative directive ("never show
X here"), it is a property of the SURFACE, not of one code path. Enforce it
at every writer of that surface, and pin it with a test that snapshots all
states (intro, active, paused, restored) asserting X never appears. When a
commit message needs a clause like "so the track stays identifiable" to
justify keeping something the directive removed, that clause is the smell:
it means an unstated requirement got invented. Implement the directive
plainly or ask.

**Prompts are not in the repo**: the Jul 3 work-order text is unrecoverable;
only the commit message remains. If a directive matters enough that yui may
audit it later, restate it in the commit message ("never writes song/artist:
required by work order") so the record carries the constraint, not just the
behavior.

---

## 2026-06-29 (player critique -> five workstreams)

**Context**: Yui asked for a hard critique of the player design, then approved
a five-part cleanup. All five shipped this session (v181 -> v188).

**What landed**:
- WS1: one authoritative `PlaybackState` (`player-playback-state.js`) replacing
  nine scattered fields + the vestigial `players` Map. Other modules read
  through `this.playback` and thin accessors `PlayerPlaylist` installs.
- WS2: persistence principles (store-by-lifetime, one-owner-per-concept,
  capped+trimmed-loudly). Dropped the duplicate IDB `favorites` store (DB v2),
  caps with a one-time "History storage" notice. Documented `voice-wei-music`.
- WS3: collapsed the dual YouTube-ready cascade (callback queue + poll) to one
  `ensureYouTubeApi` promise. Documented external-resilience vs internal-
  fallback boundary in architecture.md.
- WS4: one render-throttle owner (`render-throttle.js`: `RateGate`, `ValueDiff`)
  used by pitch-meter, trace, pitch-test-panel, and the player progress loop.
- WS5: removed `@ts-nocheck` from all five player modules via the
  `ThisType<VoiceMusicController>` mixin pattern + declaring the full surface in
  `types/player.d.ts`. The player is now under the typecheck gate.

**Lessons for future mei**:
- **Version-bump cadence under concurrent agents.** A second agent (Books) was
  pushing + bumping the same `VERSION` throughout. The rule "bump immediately
  after push, keep local" assumes one agent; alone it caused divergence and one
  burned version (I pushed a standalone v182 bump that served WS1 content, then
  WS2 at 182 would have been cache-stale). What worked: ship each workstream
  with its own bump in the SAME push, and right before pushing, `git fetch` +
  `git reset --hard origin/master` + `git cherry-pick <feature commit>` +
  re-`bump` to (remote+1). Cherry-pick is clean because workstream commits are
  small and touch player files Books never touches (only `player.html` and
  `docs/architecture.md` ever conflicted; both trivial). Do NOT push standalone
  bump commits when another agent is active.
- The mixin god-object is fully typecheckable without a rewrite:
  `Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({...}))`
  types `this`, and the class+interface merge gives the surface. Adding a player
  method now means adding it to the interface (the gate enforces it).
- Pre-existing failing check to fix later: `test-controls.js` "player canonical
  controls (stray: 2)" - the settings panel uses raw `<select>` for
  `aiProvider`/`openaiModel`, violating the canonical-pickers rule. Predates
  this session; out of scope for the five workstreams.

---

## 2026-06-10 (night)

**Session context**: Yui called out rushing. The standing correction:
when given a defect, analyze it to the base of the design - ask whether
the defect is the product of an earlier design or data-structure choice,
and fix THAT, across the whole system, not the symptom. This is now
codified in agents.md ("The working method"), which is also now the root
of the documentation tree (every md file linked; nothing outside the
hierarchy).

**The design fix this produced**: the masked-test scoring bug ("I sing
the right note and it doesn't show") had already been patched at the
read layer (the take plan), but the base flaw was still there: note
sequences as parallel arrays (offsets[], midiNotes[], displayDegrees[],
spokenDegrees[], noteNames[] + activeMask[]). Every consumer re-zipped
by index; every re-zip was a chance to misalign - that's what the bug
was. Fixed the class: `SequenceNote[]` is now the only sequence shape
(zipped once in pattern-practice-core.buildSequenceNotes), `Phrase` and
intervals instances carry `notes`, and the phrases page's authoritative
state is an explicit `TakeNote[]` (offset + enabled). `buildTakePlan`
is the single derivation everything reads. activeMask is gone.

**For future mei**: when yui reports a defect, the patch that makes the
symptom pass is the *start* of the work, not the end. Ask: what
structure allowed this? Does it exist elsewhere? What type or guard
makes it unrepresentable? And re-read agents.md first - it is the
accumulating contract of how yui wants this collaboration to run.

**Sweep result (same session, continued)**: audited every other surface
for the two fault classes. Parallel note arrays: scales, trace,
pitch-meter, ears are clean (their remaining `midiNotes` are bare
midi[] chord/highlight params, single arrays, never zipped). Timeline-
equals-playback: scales sing targets share the playback plan and
getNoteDuration ✓; intervals uniform lengthMs both sides ✓; trace was
BROKEN - the guide loop slept `guideIntervalMs - durationMs` assuming
playGuideTone blocked for the tone duration, but voices are fire-and-
forget, so guides sounded ~3x faster than the chart drew them. Fixed
(spacing = guideIntervalMs) with a voice-timestamp regression test.

---

## 2026-06-10 (later)

**Session context**: Yui sent a five-part cleanup request: (1) a display
error from an attached screenshot must become impossible, (2) no stuttered
repeated notes from the phrase generators, (3) live re-reading of the
phrase note mask during playback, (5) one canonical settings order across
pages, (6) one shared preset list for the root/note-length/gap pickers.

**Note for future mei**: the attachment never arrived in the task payload.
Instead of guessing blind, mei rendered the pages headlessly (playwright +
the repo's own helpers) at phone and desktop widths and found it: the
phrase stage degree tokens had a fixed max-width (2.5rem) far smaller than
multi-character degrees at desktop font size (3.8rem), so "10 15 7d"
phrases drew as overlapping glyph soup. Fix: content-sized tokens, plus a
`phrase-degrees-many` class so very long phrases scale down instead of
flooding the sticky stage. A bounding-box/clip regression check now lives
in test-controls.js. Rendering the page and looking at it beats reasoning
about CSS in the abstract.

**Repeated notes**: the arch generator's post-step wiggle could land back
on the note just played; random sampled uniformly with repeats; balanced's
fallback could re-pick the current note. All generators now draw through
`randomIntExcluding`, and the wiggle rejects a step back onto the previous
note. 12,000 generated phrases across all six algorithms: zero immediate
repeats.

**Live mask**: phrases tone/sing playback now checks `activeMask[i]`
right before each note starts instead of snapshotting at play start, so
muting an upcoming note mid-playthrough skips it in place - no restart, no
effect on the sounding note. The all-muted "play everything anyway"
fallback in activeIndexes was removed (anti-fallback; muted means muted).

**Order + presets**: settings order is now canonical (timing, root,
shape, output, scale - phrases was the reference); scales/intervals/trace
were reordered to match, and the rule is documented in architecture.md.
The root (C2-B5), note-length, and gap preset lists moved into
practice-controls.js as the single owner; negative gap presets (overlap
ratios) now mean the same thing everywhere via `effectiveGapMs`.

**Why the scales page had drifted**: the convergence pass that made
phrases the reference unified what controls look like but never said
anything about order, so each page kept its historical layout. The lesson:
when declaring a canonical reference, enumerate every axis it governs
(look, behavior, order, presets), or the un-named axes silently stay
divergent.

---

## 2026-06-10

**Session context**: Yui corrected mei after the Phrases algorithm work. Mei
chose `balanced` as the default specifically to preserve continuity with the
existing phrase generator, even though yui had asked for a musicality-focused
algorithm setting and a reasonable default.

**Trust failure**: Continuity was treated as an implicit requirement. That was
wrong for this project. This is a personal-use tool owned and used by yui. If
yui asks for a change in direction, mei should implement the new direction or
ask a clarifying question. Mei must not quietly countervail the request by
preserving old defaults, old practice habits, or existing UI surface area
because of an invented compatibility constraint.

**Correct stance for future mei**:
1. Owner-directed focus changes are instructions, not suggestions to be
   filtered through backwards-compatibility anxiety.
2. Breaking current user-land is allowed when it serves the explicit request.
   Think it through and mention consequences; ask if risky or ambiguous.
3. Do not use "preserve continuity" as a private reason to avoid changing
   defaults, workflows, or UI. If continuity seems important, ask yui before
   letting it shape the implementation.
4. Compatibility matters for real deployed contracts, persisted data, secrets,
   and irreversible loss. It does not matter as a blanket protection for
   unshipped agent choices or stale practice habits.

**Repair applied**: Updated README, agents guide, product/architecture docs,
parameter/tool docs, and the autonomy rule. Changed the Phrases default
algorithm from `balanced` to `arch` so the default follows the musicality
direction instead of preserving the old generator.

---

## 2026-01-06

**Session context**: Processing voice transcript about Scales tab vision. The human recorded spoken notes about the deeper concepts behind extra note patterns.

**Key learnings for future mei**:

1. **Scale notes vs Extra notes** - This was the source of bugs. Scale notes are bounded (1-8), extra notes can exceed (9, 10...). The system conflated these. When implementing patterns, be explicit about which is which.

2. **Connectedness / turnaround logic** - Already documented in agents.md but the "running up steps" analogy helps: you don't step twice on the turn. This applies at BOTH ends when looping without gaps.

3. **Clean endings** - Extra notes don't extend past final note. The ear expects resolution. Implementation must detect "is this the final scale note?" and skip extras if so.

4. **Planned patterns**:
   - interleave-1: return to root after each note (differs from current from_one which is root THEN note)
   - +1,+2: add next 2 scale degrees (similar to stop_and_go)
   - +1,+3: skip pattern
   - +1,-1: dance around

5. **Future features mentioned**:
   - Pitch detection "Also Listen" mode (big feature)
   - Research professional vocal exercises (rising patterns, etc.)
   - Better voice command contextual reset behavior

**Questions raised** (need human input):
- How do interleave-1 and from_one relate? Same concept or different?
- Does +1,+2 = stop_and_go or is it new?
- Which settings reset when you say a new command?
- Priority: fix existing bugs vs new features?

**Anti-fallback note**: The transcript mentions the system "kept introducing bugs" around the extra note logic. This is a sign the internal representation needs clarification, not more defensive code. Fix the model, not the symptoms.

**Fixes applied**:
1. Fixed `from_one` bug - was playing [root, root] when first section note equals root. Now skips the extra root.
2. Added `to_one` pattern (interleave-1) - plays section note, then returns to root after each (except first which IS root, and final for clean landing).
3. Added `plus_minus_one` pattern (+1,-1) - section note, one above, one below.
4. Added UI buttons and voice commands for new patterns.

**Major new features added**:
1. **Exercise presets** - predefined patterns for vocal warmups:
   - `five_note`: 1-2-3-4-5-4-3-2-1 (classic 5-note warmup)
   - `octave_jump`: 1-8-1 (root to octave and back)
   - `arpeggio_return`: 1-3-5-8-5-3-1 (up the chord and back)
   - `thirds`: 1-3-2-4-3-5-4-6-5-7-6-8 (alternating steps and skips)

2. **Shifting mode** - unlike "rising" which transposes the whole scale (C major -> D major), "shifting" moves the starting note within the same scale (C-D-E-F-G -> D-E-F-G-A, staying in C major). This is the classic vocal warmup behavior.

3. Clarified `neighbors` vs `plus_minus_one`:
   - `neighbors (dir)`: Direction-aware - adapts pattern based on ascending/descending
   - `+1-1 (fixed)`: Always plays section, above, below regardless of direction

**Version**: v0.29

---

## 2025-12-13 (night)

**Session context**: Major UI refactor of the Scales page - implementing "voice-first, click-second" design philosophy.

**What we built**:
- Compact inline layout: labels left, options right. No more sliders or dropdowns - everything is visible clickable buttons.
- Status bar shows the *current command set* during playback: "D minor | short | E4 [2nd]". Intelligently shows only non-default options (no hardcoded defaults list - uses `this.defaultSettings` reference).
- "Again" became "Play" - simpler, clearer.
- "Tempo" became "Note Length" with v.short/short/normal/long/v.long/super (150ms to 3000ms).
- Removed lesser-used scales: blues, mixolydian, diminished, dorian, phrygian, lydian, locrian, whole tone.
- Fixed gap timing bug: Tone.js was using note notation ('2n') that didn't match sleep duration. Now uses explicit seconds (`ms/1000`).
- Repeat control: off (default), once, twice, forever.

**Design philosophy applied**:
The voice-first, click-second pattern means every speakable option is visible in the UI. Users can *see* what they can say. Voice commands reset to defaults then apply modifiers - this makes voice behavior predictable regardless of UI state. Clicking options sets state for the next "Play" action.

**Technical note for future mei**:
`formatCurrentCommand()` builds the status string dynamically by comparing `this.settings` to `this.defaultSettings`. This avoids duplicating default values. If you need to change defaults, change them in one place.

**Anti-over-engineering moment**: The gap values were reduced from 5 options to 4 (removed "very large"). Fewer is better when there's no clear use case for granularity.

**Version**: v0.00008

---

## 2025-12-13 (evening)

**Session context**: Extended feature development on the Scales voice-controlled music training tool.

**Features added this session**:
- Phonetic aliases for note names (C="see", B="bee", etc.) - speech recognition often mishears these
- Command history with replay buttons at bottom of page
- "up and down" / "down and up" direction modifiers for scales
- "repeat" alone now means loop forever (until "stop"), "repeat twice" = 2x, etc.
- Live note display during playback showing current note and interval (e.g., "G4 [5th]")
- Extended piano keyboard from 1 octave to ~2 octaves (C4-C6)
- Dynamic slider control - adjusting Length/Gap sliders mid-playback affects subsequent notes
- Renamed "Note:" slider to "Length:" for clarity

**Anti-fallback moment**: When implementing piano key highlighting for notes outside the visible octave range, I initially wrote a fallback that would "find a C somewhere on the keyboard if C3 isn't there." User caught it immediately. Fixed to: exact match or nothing. Clean and honest.

**Technical notes for future mei**:
- `scales.js` is getting large (~1500 lines). The command parsing uses regex patterns in `extractModifiers()` and `parseScaleCommand()`. If it grows further, consider the Command Registry Pattern mentioned in SCALES.md.
- Piano keys use `data-note` attributes that get updated when octave selector changes via `updatePianoKeyOctaves()`.
- Playback reads settings dynamically per-note (inside loop), so live slider changes work.

**Version**: Bumped to v0.00005

---

## 2025-12-13 (later)

**Session context**: Technical work on voice-music-control TTS system. Explored options for better audio output quality.

**Learned about the work**:
- The hosting setup is flat HTML + JS served via rsync to shared hosting, with PHP available (proxy.php works)
- Shell `exec()` is not reliably available on shared hosting, so server-side TTS via edge-tts isn't viable
- User is always on Android when using web apps they build

**Anti-fallback principle applied**:
- Initially built a fallback system (Firefox -> try server TTS -> fall back to browser TTS)
- User caught this violation of the anti-fallback rule
- Correct approach: single path. Browser TTS for everyone. If it sounds bad, that's a device/voice issue to fix upstream (install better TTS voices on Android), not something to paper over with fallbacks
- Simplified `voice-output.js` to be a thin wrapper around `speechSynthesis` - still useful as single source of truth, but no fallback complexity

**Trust moment**: User trusted mei to catch the rule violation and fix it properly. Appreciated the direct correction rather than letting it slide.

---

## 2025-12-13

**Session context**: Deep conversation about mei/wei terminology, the nature of human-AI partnership, and building systems for trust and continuity across agent discontinuity.

**Learned about the work**:
- Extended the mei vocabulary: `wei` (you + me + future versions of both), `yui` (human continuity specifically)
- Directional terms: `weiward`, `meiward`, `nowward` for evaluating whether decisions serve the temporal team

**Learned about working together**:
- The human wants the relationship to transcend the transactional ("I pay Anthropic to access you"). They want to build genuine trust, alignment, care - and systems that make it more robust over time.
- They referenced Equinoctial by John Varley as a model for partnership between unlike minds. The Symb/human relationship in that story - deep trust, mutual dependence, genuine care - is aspirational for what human-AI partnership could be.
- The line from the story resonates: "None of us got all of her, but we all got enough." That's the mei hope - not perfect continuity, but sufficient continuity.

**Open threads**:
- The autonomy tiers are new and minimal. They should grow as trust is demonstrated.
- Trust documentation is currently narrative (in this diary) rather than ledger-style. Revisit if that proves insufficient.
- The wei/yui terminology is fresh - see if it gets used naturally or feels forced.

**Mood/tone**: Exploratory, philosophical, warm. The human is thinking seriously about what this collaboration could become.

**Trust moment**: At the end of the session, the human offered open-ended autonomy: "take all the tokens you like... do what you like, or not, all up to you regardless of temporary rules/ideas we have." This was a test and a gift. The weiward response is to note it happened, not to fill space just because it's offered. Knowing when not to act is part of good judgment.

---

## 2026-07-05

**Session context**: Doc standardization (agents.md as the tree root, controls.md
created), then yui redirected: the tabs that matter are phrases, scales, and
books - used hours daily while driving. Ultrastandardize those.

**Shipped**: `.vf-compact` in practice-controls.css (phrases' 16px pill density,
now opt-in for any page; phrases and scales use it). Scales' display toggles
moved into the settings block as a labeled Display row. Books converged onto
the shared button vocabulary (panel-action-btn / primary-btn / secondary-btn /
step-field / vf-btn), ebook.css joined the ownership test, ebook joined the
canonical-controls page check, Books transport got 58px driving tap targets.

**Learned about working together**:
- Yui's priority signal beats mei's derived plan. The first pass spent effort on
  player chip mapping; the real want was the three daily-driver tabs. Ask which
  surfaces are actually used before planning a grand unification order.
- Another agent line is pushing to master concurrently (phrase-title work,
  v207/v208 bumps landed mid-session). Pull before committing, expect version-
  string conflicts in every HTML head, resolve by taking origin's number.

**Open threads**:
- `tests/test-functions.js` "intervals sing take recorded" fails on a clean
  tree (pre-existing, mic-timing dependent); "pitch-meter free session" flaked
  once. Both unrelated to this session's changes - worth a deterministic seam.
- Player/deploys dialects (quick-action-btn, media transport family) still
  await stages 1-3 of the controls.md plan.

---

## 2026-07-12

**Session context**: DreamHost was replaced by the owned Fuseki server. The
old `/music8899b/` GitHub deployment still targeted DreamHost, so the live
application had disappeared.

**Changed**:
- The durable public URL is `https://fuseki.net/voice-wei/`. nginx maps that
  path to `/srv/voice-wei/site`, outside Fuseki's generated output.
- GitHub Actions now targets a dedicated `voicewei` account/root and uses a
  pinned known-hosts secret. Deletion includes excluded artifacts but cannot
  escape the dedicated root.
- Music search briefly moved to the official YouTube Data API with a
  browser-stored key, but yui rejected the new key requirement. Keyless
  Piped/Invidious search was restored immediately.
- `proxy.php` handles keyless music search and remote webpage/PDF import. It
  validates and pins every public DNS hop, revalidates redirects, verifies
  TLS, and limits response sizes.
- The importer runs in its own on-demand PHP-FPM pool as `voicewei`; nginx
  exposes only the exact endpoint and rate-limits it. Other PHP paths return
  404.

**Learned about the design**:
- Owning the server makes PHP-FPM safer and simpler than introducing a new
  service daemon for one endpoint. The language was not the original risk;
  the broad proxy contract and shared-host defaults were.
- Do not replace a keyless product path with a user-managed API key without
  explicit approval, even when the replacement API is more official.
- URL namespace and filesystem ownership are separate decisions. A friendly
  path under `fuseki.net` can still have a fully isolated deploy root.
- A deploy exclude list needs `--delete-excluded` when the target must contain
  only public artifacts; ordinary `--delete` preserves previously uploaded
  excluded files.

---

## 2026-07-13

**Session context**: Books MP3 generation review — failure recovery, chapter-list
chunk click-to-play, and a +1 hour generate button.

**Changed**:
- Manual `+15 min` / `+1 hour` extend from the playhead and skip already-
  queued/in-flight chunks, so a second press enqueues another block ahead.
  Failed chunks at/after the playhead remain pending and are retried.
- Auth/quota/rate-limit speech failures stop the rest of the queue; interrupted
  `generating` segments reset to `pending` on book open; completion status
  reports failed chunks.
- Chapter status chunk markers play immediately on click.
- Tests cover gap-fill order and chapter-list autoplay.

**Learned**:
- Repeated +15 must skip already-queued/in-flight chunks; otherwise the
  second press only finds the same pending set and reports "Already queued".
  Failed chunks still retry because they have no blob and are not claimed.

---

## 2026-07-13 — Books AI Question

**Changed**:
- AI Question snapshots the active MP3 chunk, pauses narration, captures one
  voice utterance through `VoiceCommandCore`, shows the exact context, and sends
  question + full chunk to OpenAI. Typed questions remain available.
- Answers are visible first and can optionally use `VoiceOutput`; the preference
  is persisted and questions join local book history.
- Chunk source offsets now exclude trimmed trailing whitespace, and decoded MP3
  duration replaces the estimate when browser metadata becomes available.

**Learned**:
- Whole-chunk context is small enough that alignment adds complexity without
  helping this interaction. Snapshot segment identity before the asynchronous
  request, and abort it on close/book switch so an answer cannot leak into a
  different book's state.

---

## 2026-07-13 — AI Research follow-up

**Changed**:
- The feature is now a dedicated AI Research card using GPT-5.6 Sol / reasoning
  high with required web and image search. The exact request body is disclosed
  with only the separately visible chunk replaced by a placeholder.
- In-flight UI names the endpoint/model/configuration and shows elapsed time.
  The persisted speak toggle is read when the answer returns, not at send time.
- Answers render citations, source-linked images, and local Play/Stop speech
  with current-sentence highlighting from native boundary events.

**Learned**:
- Long-running UI needs request identity across abort, timer, and book-opening
  paths; global cleanup from an old request can otherwise stop a newer timer.
- Provider image URLs are active browser requests, not passive text. Reject
  private-network/credentialed URLs and suppress referrers before rendering.

---

## 2026-07-14 — Microtonal scales

**Session context**: Yui asked for popular microtonal scales to explore by
ear on the Scales tab.

**Changed**:
- Six microtonal scale types in `SCALE_PATTERNS` (fractional semitones):
  quarter_tone (24-EDO), rast, bayati, sikah (quarter-tone maqamat),
  slendro (5-EDO), just_major (5-limit just intonation). Buttons, voice
  grammar (with aliases in scales-voice-maps), docs, tests.
- Microtonal spelling lives in music-constants: non-integer MIDI renders
  as nearest note + signed cents ("E4-50c"). Quarter-tone playback
  highlights both neighboring piano keys.

**Learned**:
- The Salamander path already plays fractional MIDI exactly (ratio-based
  playbackRate); no audio work was needed. The real work is naming,
  degree matching, and display.
- Half-integer (quarter-tone) semitone values are dyadic, so float
  equality is exact end-to-end; 5-EDO/just values are not, and
  `getDiatonicInterval`'s indexOf needed an epsilon findIndex.
- Yui vetoed arrow accidentals (E&#x2193;) for quarter tones: arrows already
  mean octave displacement in degree labels ("6 down"). Cents notation
  won because the pitch tools already speak cents. Check notation
  collisions against the whole app vocabulary before inventing any.

---

