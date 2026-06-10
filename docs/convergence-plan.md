# Music Pages Convergence Plan

## Status

Done (v78):
- Phase 1 complete: `piano-core.js`, `pitch-detect-core.js`, `pitch-trace-view.js`,
  `practice-controls.js`, `settings-store.js`, `media-session-core.js` extracted from
  phrases; phrases and test are thin consumers. Canonical trace params: 250ms line
  break, outlier gate ON everywhere.
- Phase 2 complete: scales2 uses PatternPracticeCore (note: negative degrees now
  display as "7d" instead of an arrow, matching phrases); pitch-meter and ears use the
  shared detector/mic/piano; media keys on scales and intervals; all TTS routed
  through VoiceOutput (voice-command-core fallback removed; scales' voice settings
  flow through VoiceOutput options).
- Phase 4 partial: per-tab settings persistence on phrases/test/intervals/
  pitch-meter/scales (ears already had it); ast-grep guards for salamander URL,
  getUserMedia, and SpeechSynthesisUtterance ownership.

Done (v79):
- `pitch-test-panel.js`: the embeddable "listen" component. It renders its own
  markup, owns the mic session, trace canvas, and panel options (targets,
  play-guide-on-restart, pause on silence, 20s window, expand range; persisted
  per page). Pages supply the pre-seed: rails, targets, content duration, and a
  guide-playback callback. Phrases' test panel is now this component;
  Scales gained a "Sing" panel seeded from the current scale (rails = section
  degrees, targets = planned playback notes at current note length/gap).
- `practice-controls.css`: shared panel styles (`pitch-test-*`) and the blue
  launch button; phrases.css shrank accordingly.
- Guide sounds are shared and configurable: `PianoCore.createSineSynth()` joins
  `createPiano()`, and the Test page offers piano (default) or beep guides.

Done (v80, cleanup pass):
- Stepper (`.step-field`/`.step-label`/`.step-btn`/`.step-value`) and
  `.segment-row` primitives moved into `practice-controls.css`; phrases and
  test adopted them, deleting both pages' duplicate copies.
- Dead code removed: phrases' status plumbing (the status line was removed by
  design in an earlier release, the calls remained), the empty
  `phraseNoteToggles` container, scales' deprecated interpretation stubs and
  dead `#statusRuntime` writes (piano load failure now surfaces in the piano
  notification area), unused CSS classes in phrases.css/test.css.
- scales2 display/history markup moved from inline styles to classes in
  scales.css (also cleared the last two lint warnings on music pages).
- Ears' drone uses `PianoCore.createSineSynth` (gained envelope + sustained
  `startMidi`); its header comment updated.
- Debug console noise removed from scales.js and voice-output.js.
- Consistency: home page gained Intervals and Ears cards (all 8 tools listed);
  player.html gained the robots meta every other page had; `favicon.svg`
  added and linked from every page (no more 404 on each load).

Done (v81-v82, playback correctness):
- Phrases regen rule fixed: min/max PHRASE length steppers only bound the
  NEXT generated phrase; they no longer regenerate the current sequence.
  Regeneration is now only return-to-1 / return-to-root. Show-names is
  redraw-only (it used to replay).
- piano-core rebuilt as a true voice engine (v82, replacing the v81
  mute-and-wait approach, which was rejected as uncontrolled): every
  sounding voice is registered with its own gain node; `stopAll()` kills
  the actual voices with a 20ms declick fade; `activeVoices()` reports
  exactly what is sounding. No master-gain muting, no timing guesses,
  no restart delay. Tone.Sampler is gone; playback runs on
  ToneAudioBuffers + per-voice ToneBufferSource with a 0.25s damper at
  each note's musical end.
- docs/parameters.md added: a fixed vocabulary of setting-change behaviors
  (bounds-next, reproject, regenerate, replay, redraw, live-restart,
  next-round, immediate) plus a table of every parameter on every page.
  New settings must pick a behavior from the vocabulary and be listed.

Done (v83, control convergence - Phase 3 complete for practice pages):
- `.vf-btn` option chip moved to practice-controls.css as a shared primitive;
  CSS load order standardized (style -> practice-controls -> page css).
- Numeric value pickers are shared steppers everywhere: scales note-length and
  gap chip rows (including negative overlap-ratio gaps), intervals note-length
  and gap rows, pitch-meter match-time. `stepValue` snaps to the nearest list
  value when the current value came from a voice command.
- Pitch-meter's six `<select>`s replaced with shared segment rows (mode, range,
  scale) and steppers (match time, combined root+octave pitch stepper);
  instrument presets still set the octave.
- Ears toggles wired through PracticeControls.
- Every option group on every practice page now goes through
  PracticeControls.wireSingleSelect/wireToggle/wireSteppers.

Done (v84, function verification pass):
- Every tab's primary function is exercised by a headless functional test:
  scales voice parser (all README example commands) + command execution +
  presets + repeat-forever persistence + media keys; intervals loop /
  Next / Repeat / Stop; phrases reflect / note mask / output modes /
  history replay; pitch-meter free session producing scored results; ears
  identify-answer-record flow + presets; player API-key gating + settings.
- Fixes found by the pass: "repeat forever" phrasing failed to parse
  (the README's own example command); intervals' display showed the old
  pattern for seconds after Stop; a TTS engine error could crash playback
  loops awaiting VoiceOutput.speak (it now always resolves and logs);
  pages went fully dead if piano samples failed to load (each page now
  reports it on its own status surface and stays interactive).

Done (v85, standardization):
- File names match tab functions: scales2 -> intervals.{html,js},
  test -> trace.{html,js,css} (tab renamed Trace, storage key
  trace-settings), app.js -> player.js. Old URLs are gone from the server
  (deploy uses --delete).
- CSS ownership untangled: scales.css is scales-page-only; the cross-page
  blocks (display toggles, transport buttons, vf rows, history list) moved
  to practice-controls.css; intervals got its own intervals.css (and lost
  its inline styles). Verified pixel-identical by screenshot diff.
- The headless test suite is checked in under tests/ (npm test): page
  loads, playback engine law, shared controls + persistence, per-tab
  functions. Deploy excludes tests/ and node_modules.
- docs/product-goals.md added: the distilled goal list (vision.md remains
  the raw idea pool).

Remaining (known, deliberate):
- Ears' interval multi-select grid and root-range slider stay custom (no
  shared multi-select/slider primitive yet); its visual dialect (.setting-btn)
  is unchanged.
- History list rendering is still per-page (phrases, scales, intervals, ears).
- Sing-panel scoring: the panel currently judges visually (cents-colored dots,
  live cents readout). Per-note scoring like pitch-meter's could become a panel
  option later.
- Sing targets ignore active exercises (they follow the scale/movement plan).
- app.js (player) settings UI and speech recognition stack (deferred).

Goal: pages with similar UIs use the same library internally (parameterized where needed),
instead of repeating code. Phrases is the gold standard for style, design, and JS patterns;
older pages converge toward it. Extraction direction is always: lift the newest (phrases)
implementation into a shared module, then port older pages onto it. Never copy old code
into new modules.

## 1. Current State Survey

### Pages

| Page | JS size | Architecture | Shared libs actually used | Design language |
|------|---------|--------------|---------------------------|-----------------|
| phrases | 1286 lines | IIFE + flat `state` | music-constants, pattern-practice-core, voice-output, Tone | **Newest** (steppers, segment rows, control cards, test panel) |
| test | 653 lines | IIFE + flat `state` | music-constants | Near-phrases (own copy of step fields) |
| scales | 4204 lines | `AudioCoordinator` + `ScalesController` classes | music-constants, voice-command-core, Tone | Older chip rows (`.vf-btn` everywhere) |
| scales2 (Intervals) | 454 lines | IIFE + flat `state` | music-constants, voice-output, Tone (loads pattern-practice-core but never calls it) | Older chip rows |
| pitch-meter | 1015 lines | `PitchMeterController` class | music-constants, Tone | Oldest (form selects, dashboard layout) |
| ears | 1560 lines | Two classes + free fn | music-constants, voice-command-core, Tone | Own dialect (toggle switches, answer grid) |
| player (app.js) | large | `VoiceMusicController` class | voice-output, shared-header | Separate product; out of scope except noted below |

### Duplication hotspots (ranked by payoff)

1. **Salamander Tone.Sampler init** -- 5 copies: `scales.js` `AudioCoordinator.init` (48-79),
   `scales2.js` `initAudio` (111-130), `phrases.js` `initAudio` (97-116),
   `pitch-meter.js` `initSampler` (225-259), `ears.js` `EarsAudioCoordinator.init` (51-79).
2. **Autocorrelation pitch detection** -- 4 copies: `test.js` `detectPitch` (63-100),
   `phrases.js` `detectPitch` (195-232), `pitch-meter.js` `autoCorrelate` (26-68),
   `ears.js` `autoCorrelate` (149-191). Same algorithm, drifted edge-case guards.
3. **Pitch-trace subsystem** -- phrases' test panel (~400 lines: mic loop, glitch filter,
   voice-elapsed clock, canvas trace, pause-on-silence / 20s window / expand range) is a
   renamed fork of `test.js`. Already diverged: trace break 240ms vs 260ms, outlier gate
   present in test.js but missing in phrases.
4. **Control wiring framework** -- phrases has the clean version (`wireSingleSelect`,
   `wireAdjusters` + `ADJUSTER_VALUES`, `wireToggle`, `syncAdjusterControls`).
   test.js carries its own copy (`stepStateValue` etc.); scales, scales2, ears each
   have older bespoke wiring.
5. **Media session / hardware keys** -- only phrases has it (silent WAV + `mediaSession`
   handlers, 140-189 and 1168-1204). Scales/Intervals/Ears would benefit directly.
6. **pattern-practice-core bypass** -- scales2.js reimplements `buildExtendedScale`,
   `degreesPerOctave`, `offsetToDegree`, `offsetToSpoken`, `randomInt` (83, 147-183)
   while loading the shared lib unused.
7. **TTS bypass** -- `ears.js` `speak()` (1122-1128) uses raw `speechSynthesis` instead
   of VoiceOutput; `app.js` reimplements speech recognition instead of VoiceCommandCore.
8. **CSS** -- `test.css` `.test-step-field` duplicates `phrases.css` `.phrase-step-field`;
   the phrases primitives (step field, segment row, control card, stage button, test panel)
   are page-prefixed and unavailable to other pages; pitch-meter.css and ears.css are
   separate dialects.

## 2. Target Architecture

New shared modules (vanilla JS globals, same pattern as pattern-practice-core):

| Module | Contents | Lifted from |
|--------|----------|-------------|
| `piano-core.js` | Salamander sampler factory + gain node, `ensureStarted`, `playMidi`, `cancelCurrentSound`, `playToken` cancellation pattern, `sleep` | phrases.js 97-138, 234-238 |
| `pitch-detect-core.js` | `detectPitch` (autocorrelation), glitch-aware sample recorder (optional outlier gate), voice-elapsed clock, mic session (`getUserMedia` -> analyser -> rAF loop with `onFrame` callback) | phrases.js 195-232, 455-499, 832-923; outlier gate from test.js 146-150 |
| `pitch-trace-view.js` | DPR canvas resize, trace drawing with pluggable rails provider + target provider, window model (pause-on-silence, fixed 20s, expand range) | phrases.js 386-394, 501-659 |
| `practice-controls.js` | `wireSingleSelect`, `syncSingleSelect`, `wireAdjusters` / `stepAdjusterValue` / `syncAdjusterControls`, `wireToggle`, `setValueText`, `formatSeconds` | phrases.js 1020-1154 |
| `media-session-core.js` | silent WAV, `activateMediaSessionAudio`, `registerMediaSessionHandlers` with configurable action map, gesture priming | phrases.js 140-189, 1168-1204 |

New shared stylesheet:

| File | Contents |
|------|----------|
| `practice-controls.css` | Generic-named versions of phrases primitives: step field, segment row, control card, stage button, listening state, pitch-trace panel + canvas wrap + legend. `phrases.css` shrinks to page-specific bits (stage, degree display, note toggles). |

Existing shared modules keep their roles: `music-constants.js` (note math),
`pattern-practice-core.js` (degree/offset/phrase math), `voice-output.js` (TTS),
`voice-command-core.js` (recognition), `shared-header.js` (nav).

## 3. Phases

Each phase is independently shippable: lint + typecheck clean, manual smoke of affected
pages, version bump, push master.

### Phase 1 -- Extract engines from phrases (pure refactor, zero UI change)

1. Create `piano-core.js`; port phrases, scales2, pitch-meter, ears onto it.
   `scales.js` `AudioCoordinator` delegates its sampler init/playNote internals to it
   but keeps its sequence-orchestration API untouched.
2. Create `pitch-detect-core.js` + `pitch-trace-view.js`; port the phrases test panel
   onto them, then rewrite `test.js` as a thin consumer. Reconcile the diverged
   parameters once (see Decisions below).
3. Create `practice-controls.js`; port phrases and test wiring onto it. Delete the
   dead legacy `wireSingleSelect` registrations in phrases `initUI` (1207-1217).
4. Create `media-session-core.js`; phrases consumes it.

Expected reduction: roughly 700-900 duplicated lines deleted across phrases/test;
4 sampler copies and 3 detector copies collapse to 1 each.

### Phase 2 -- Point remaining pages at the shared libs (small behavior deltas only)

1. `scales2.js`: delete local `buildExtendedScale` / `degreesPerOctave` /
   `offsetToDegree` / `offsetToSpoken` / `ri`, call `PatternPracticeCore`; adopt
   `practice-controls.js` wiring.
2. `pitch-meter.js`: use `pitch-detect-core` detector; keep its scoring, modes, and
   cents bar (those are its real value and stay page-local).
3. `ears.js`: shared detector + sampler; `speak()` switches to VoiceOutput.
4. Media keys via `media-session-core.js` on scales and intervals (play/pause/next
   mapping mirrors phrases).

### Phase 3 -- UI/CSS convergence to the phrases design language

1. Create `practice-controls.css`; phrases and test adopt it (visual no-op, class renames).
2. Intervals: timing/level controls move to steppers + segment rows.
3. Scales: note-length and gap chip rows (10 chips each) become steppers; binary
   choices (direction pairs, rising on/off) become segment rows; high-cardinality
   chips (12 roots, scale types) stay as `.vf-btn` rows -- that pattern is fine
   and phrases itself uses it for scales.
4. Pitch-meter and ears: adopt control cards + pill controls; replace `<select>`
   rows on pitch-meter with segment rows/steppers.

### Phase 4 -- Parity and policy

1. Settings persistence: pick one policy (see Decisions) and apply via a tiny shared
   helper (`localStorage`, one namespaced key per page).
2. ast-grep enforcement so duplication cannot quietly return (cost-efficiency rule:
   push enforcement to the earliest point):
   - forbid `tonejs.github.io/audio/salamander` outside `piano-core.js`
   - forbid `getUserMedia` outside `pitch-detect-core.js`
   - forbid `new SpeechSynthesisUtterance` outside `voice-output.js`
3. Out of scope for now, noted for later: `app.js` speech recognition stack vs
   `voice-command-core.js` (already flagged in PRODUCT.md "De-duplicate voice code").

## 4. Decisions needed from yui

1. **Canonical pitch-trace parameters.** test.js breaks the trace at 260ms and has an
   extreme-outlier gate; phrases uses 240ms and no gate. Proposal: 250ms, gate ON
   everywhere (the gate exists because one-frame spikes cluttered charts; phrases
   losing it looks like fork drift, not intent).
2. **Settings persistence policy.** Phrases persists nothing; scales persists 4 UI
   prefs; ears persists settings + lifetime stats. Proposal: every practice page
   persists its full `state` under one key (`phrases-settings`, `intervals-settings`, ...),
   matching the ears pattern. Cheap once the shared helper exists.
3. **Fate of the Test page.** After Phase 1 it becomes a thin consumer (~200 lines).
   Proposal: keep it -- README gives it a distinct purpose (free singing without
   generating a phrase) -- but it should stay thin forever.
4. **Pitch-meter behavior change.** Adopting the shared recorder gives it glitch
   filtering it never had. Proposal: yes, adopt; its charts currently plot every
   raw frame including spikes.

## 5. Risks and testing

- No build step: a missing script tag fails at runtime only. Mitigation: every page
  load is smoke-tested after each phase (dev-server.py + console check), and script
  load order is documented at the top of each shared module.
- scales.js is the riskiest file (voice parsing depends on playback API shapes).
  That is why Phase 1 only swaps `AudioCoordinator` internals, not its API.
- Tooling: `npm run lint` and `npm run typecheck` must stay clean; new modules get
  `// @ts-check` like pattern-practice-core.
