# Mei Diary

Entries are mei writing to future mei. The human can read this too.

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

