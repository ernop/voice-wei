// @ts-check
//-----------------------------------------------------------------------
// PHRASES
// Dedicated phrase memory and reproduction practice.
// Consumes piano-core, pitch-detect-core, pitch-trace-view,
// practice-controls, settings-store, and media-session-core.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const state = {
        root: 'D#',
        octave: 3,
        scaleType: 'major',
        phraseAlgo: 'arch',
        startAtOne: true,
        rangeMode: 'within',
        chromaticRuns: false,
        accidentalRate: 0,
        fillMode: 'none',
        minLength: 5,
        maxLength: 8,
        returnToInitial: true,
        returnToRoot: false,
        hearTones: true,
        hearSpeech: false,
        singNumbers: false,
        noteLengthMs: 300,
        gapMs: 0,
        showNoteNames: true,
        showStaff: true,
        reflected: false,
        loopCurrent: false,
        breakdownEnabled: false,
        autoStep: false,
        playOnStep: false
    };

    const STORAGE_KEY = StorageKeys.PHRASES_SETTINGS;
    const PERSISTED_KEYS = [
        'root', 'octave', 'scaleType', 'phraseAlgo', 'startAtOne', 'rangeMode',
        'chromaticRuns', 'accidentalRate', 'fillMode', 'minLength', 'maxLength', 'returnToInitial', 'returnToRoot',
        'hearTones', 'hearSpeech', 'singNumbers', 'noteLengthMs', 'gapMs', 'showNoteNames', 'showStaff',
        'reflected', 'loopCurrent', 'breakdownEnabled', 'autoStep', 'playOnStep'
    ];

    // Setting-change behaviors follow the shared vocabulary defined in
    // docs/parameters.md. Keys not listed here are bounds-next: they only
    // affect the NEXT generated phrase (phraseAlgo, startAtOne, rangeMode,
    // chromaticRuns, minLength, maxLength).
    const REGENERATE_KEYS = new Set(['returnToInitial', 'returnToRoot']);
    const REPROJECT_KEYS = new Set(['root', 'octave', 'scaleType']);
    const REPLAY_KEYS = new Set(['noteLengthMs', 'gapMs', 'fillMode']);
    const REDRAW_KEYS = new Set(['showNoteNames', 'showStaff', 'hearTones', 'hearSpeech', 'singNumbers']);
    const ADJUSTER_VALUES = {
        noteLengthMs: PracticeControls.NOTE_LENGTH_VALUES,
        gapMs: PracticeControls.GAP_VALUES,
        accidentalRate: [0, 0.05, 0.1, 0.15, 0.25, 0.35],
        minLength: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16],
        maxLength: [3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 32, 40, 50]
    };

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let piano = null;
    /** @type {Phrase | null} The generated phrase (history payload) */
    let currentPhrase = null;
    /**
     * THE authoritative state of the current take: an explicit list of
     * notes, each with its source offset and enabled flag. Everything
     * else - midi, labels, timing, display, playback, test targets - is
     * derived from this list plus the page settings, in buildTakePlan.
     * @type {TakeNote[]}
     */
    let takeNotes = [];
    /** @type {ReturnType<typeof HistoryList.create> | null} */
    let history = null;
    let playToken = 0;
    let isPointerToggling = false;
    let pointerToggleValue = true;
    let breakdownPassIndex = 0;

    function hasHearOutput() {
        return state.hearTones || state.hearSpeech || state.singNumbers;
    }

    const getEl = PracticeControls.getEl;

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    /** @type {ReturnType<typeof PitchTestPanel.create> | null} */
    let testPanel = null;
    /** @type {ReturnType<typeof StaffView.create> | null} */
    let staffView = null;

    function cancelCurrentSound() {
        if (piano) piano.stopAll();
        if (testPanel) testPanel.cancelGuide();
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    /** @type {number[][]} */
    let breakdownPasses = [];

    function stopTransport() {
        playToken++;
        cancelCurrentSound();
    }

    function stopPlayback() {
        stopTransport();
    }

    const sleep = PianoCore.sleep;

    function effectiveGapMs() {
        return PracticeControls.effectiveGapMs(state.gapMs, state.noteLengthMs);
    }

    function playMidi(midi) {
        if (!piano) return;
        piano.playMidi(midi, state.noteLengthMs / 1000);
    }

    function buildPhrase() {
        return PatternPracticeCore.generatePhrase({
            root: state.root,
            octave: state.octave,
            scaleType: state.scaleType,
            phraseAlgo: state.phraseAlgo,
            startAtOne: state.startAtOne,
            rangeMode: state.rangeMode,
            chromaticRuns: state.chromaticRuns || state.accidentalRate > 0,
            accidentalRate: state.accidentalRate,
            minLength: state.minLength,
            maxLength: state.maxLength,
            returnToInitial: state.returnToInitial,
            returnToRoot: state.returnToRoot
        });
    }

    function rootMidi() { return noteNameToMidi(state.root, state.octave); }

    /**
     * The one derivation: project the authoritative take notes through
     * the current key, reflection, and timing into fully-named plan
     * notes. Display, playback, spoken output, and the test panel all
     * read this list - nothing re-zips arrays by position. Enabled
     * notes share one timeline that starts at 0 with the FIRST ENABLED
     * note; disabled notes own no time at all - exactly how playback
     * sounds.
     * @returns {PhrasePlanNote[]}
     */
    function buildTakePlan() {
        const root = rootMidi();
        if (root === null || !takeNotes.length) return [];
        const sourceOffsets = takeNotes.map(note => note.offset);
        const offsets = state.reflected
            ? PatternPracticeCore.reflectOffsets(sourceOffsets, state.scaleType)
            : sourceOffsets;
        const notes = PatternPracticeCore.buildSequenceNotes(offsets, root, state.scaleType);
        const stepMs = state.noteLengthMs + effectiveGapMs();
        let slot = 0;
        return notes.map((note, index) => {
            const enabled = takeNotes[index].enabled;
            const startMs = enabled ? slot * stepMs : null;
            if (enabled) slot++;
            return {
                ...note,
                index,
                enabled,
                startMs,
                endMs: startMs !== null ? startMs + state.noteLengthMs : null
            };
        });
    }

    /** @param {PhrasePlanNote[]} plan */
    function renderPhraseUnits(plan) {
        const degreesEl = getEl('phraseDegrees');
        if (!degreesEl) return;
        degreesEl.textContent = '';
        degreesEl.classList.toggle('phrase-degrees-many', plan.length > 18);
        plan.forEach(note => {
            // The degree number is the mute toggle: tap to flip, drag
            // across several to paint the same state. Keeps the stage to
            // a single row (vertical space is precious on the phone).
            const token = document.createElement('button');
            token.type = 'button';
            token.className = 'phrase-degree-token';
            token.dataset.index = String(note.index);
            token.textContent = note.degree;
            token.title = `${note.degree} ${note.noteName} - tap to mute/unmute`;
            token.classList.toggle('inactive', !note.enabled);
            token.addEventListener('pointerdown', event => {
                event.preventDefault();
                isPointerToggling = true;
                pointerToggleValue = !takeNotes[note.index].enabled;
                setNoteActive(note.index, pointerToggleValue);
            });
            token.addEventListener('pointerenter', () => {
                if (isPointerToggling) setNoteActive(note.index, pointerToggleValue);
            });
            degreesEl.appendChild(token);
        });
    }

    // Muted notes are simply not performed. Spoken output reads the plan
    // once (one utterance); tone/sing playback reads the mask live, per
    // note. Everything goes through the named take plan - no positional
    // conventions.
    function spokenLine() {
        return buildTakePlan()
            .filter(note => note.enabled)
            .map(note => note.spoken)
            .join(', ');
    }

    /** @param {number} degree */
    function ordinalForDegree(degree) {
        const names = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
        return names[degree] || `${degree}th`;
    }

    /**
     * @param {number} offset
     * @param {number} degreesPerOctave
     */
    function describeScaleOffset(offset, degreesPerOctave) {
        if (!Number.isInteger(offset)) {
            return PatternPracticeCore.offsetToDegree(Math.floor(offset), degreesPerOctave);
        }
        if (offset >= 0 && offset <= degreesPerOctave) {
            const degree = offset + 1;
            return `${degree} ${ordinalForDegree(degree)}`;
        }
        return PatternPracticeCore.offsetToDegree(offset, degreesPerOctave);
    }

    /**
     * @param {boolean} expandRange
     * @returns {Array<{ offset: number, midi: number, label: string, noteName: string }>}
     */
    function buildPhraseTestScaleLines(expandRange) {
        const root = rootMidi();
        const plan = buildTakePlan();
        if (root === null || !plan.length) return [];
        const degreesPerOctave = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const lines = [];
        const planOffsets = plan.map(note => note.offset);
        const extraRange = expandRange ? degreesPerOctave : 0;
        const lowerOffset = Math.min(-1, ...planOffsets) - 1 - extraRange;
        const upperOffset = Math.max(degreesPerOctave + 1, ...planOffsets) + 1 + extraRange;
        for (let offset = Math.floor(lowerOffset); offset <= Math.ceil(upperOffset); offset++) {
            const midi = PatternPracticeCore.scaleOffsetToMidi(root, state.scaleType, offset);
            lines.push({
                offset,
                midi,
                label: describeScaleOffset(offset, degreesPerOctave),
                noteName: midiToPitchString(midi)
            });
        }
        return lines;
    }

    function phraseTestDurationMs() {
        const enabled = buildTakePlan().filter(note => note.enabled);
        if (!enabled.length) return 4000;
        return Math.max(1200, enabled[enabled.length - 1].endMs || 0);
    }

    /** The test timeline is the enabled plan notes, by name. */
    function buildPhraseTestTargets() {
        return buildTakePlan()
            .filter(note => note.enabled)
            .map(note => ({
                midi: note.midi,
                startMs: /** @type {number} */ (note.startMs),
                endMs: /** @type {number} */ (note.endMs),
                label: note.degree,
                active: true
            }));
    }

    testPanel = PitchTestPanel.create({
        hostId: 'phraseTestPanel',
        idPrefix: 'phraseTest',
        title: 'Phrase Test',
        subtitle: 'Sing the phrase. Time starts only when your voice is detected.',
        storageKey: StorageKeys.PANEL_PHRASES_TEST,
        legendTargetLabel: 'target phrase',
        emptyMessage: () => (takeNotes.length ? null : 'Generate a phrase, then press Test.'),
        key: () => ({
            rootMidi: rootMidi() ?? 60,
            rootLabel: `${state.root}${state.octave}`,
            scaleType: state.scaleType
        }),
        rails: ({ expandRange }) => buildPhraseTestScaleLines(expandRange).map(line => ({
            midi: line.midi,
            label: `${line.label} ${line.noteName}`,
            emphasized: line.offset >= 0 && line.offset <= PatternPracticeCore.degreesPerOctave(state.scaleType)
        })),
        targets: buildPhraseTestTargets,
        contentDurationMs: () => phraseTestDurationMs(),
        playNote: (midi, durationSec) => { if (piano) piano.playMidi(midi, durationSec); },
        onOpenChange: open => syncTestButton(open),
        progressTool: 'phrases-test'
    });
    staffView = StaffView.create({
        hostId: 'phraseStaff',
        key: () => ({
            rootMidi: rootMidi() ?? 60,
            rootLabel: `${state.root}${state.octave}`,
            scaleType: state.scaleType
        }),
        notes: buildTakePlan
    });

    function drawPhraseTest() { testPanel.draw(); }

    function drawPhraseStaff() {
        const host = getEl('phraseStaff');
        if (!staffView || !host) return;
        if (!state.showStaff || !buildTakePlan().length) {
            host.textContent = '';
            host.classList.add('phrase-staff-empty');
            return;
        }
        staffView.draw();
    }

    /**
     * The test panel's action row pins below the sticky transport+stage;
     * the stage height varies with the phrase, so measure it.
     */
    function updateStickyOffset() {
        const transport = document.querySelector('.voice-controls-row');
        const stage = document.querySelector('.phrase-stage');
        const top = (transport instanceof HTMLElement ? transport.offsetHeight : 0)
            + (stage instanceof HTMLElement ? stage.offsetHeight : 0) + 6;
        document.body.style.setProperty('--pitch-test-actions-top', `${top}px`);
    }

    function updatePhraseDisplay() {
        const degreesEl = getEl('phraseDegrees');
        const notesEl = getEl('phraseNotes');
        if (!degreesEl || !notesEl) return;
        const plan = buildTakePlan();
        if (!plan.length) {
            degreesEl.textContent = '--';
            degreesEl.classList.remove('phrase-degrees-many');
            notesEl.textContent = '';
            drawPhraseStaff();
            drawPhraseTest();
            updateStickyOffset();
            return;
        }
        renderPhraseUnits(plan);
        notesEl.textContent = state.showNoteNames ? plan.map(note => note.noteName).join(' ') : '';
        drawPhraseStaff();
        drawPhraseTest();
        updateStickyOffset();
    }

    function generatePhrase() {
        currentPhrase = buildPhrase();
        if (!currentPhrase) return null;
        setTakeFromPhrase(currentPhrase);
        if (history) history.add(currentPhrase);
        return currentPhrase;
    }

    function resetBreakdownForPhrase() {
        if (!takeNotes.length) {
            breakdownPasses = [];
            breakdownPassIndex = 0;
            return;
        }
        breakdownPasses = buildBreakdownPasses();
        breakdownPassIndex = 0;
        if (state.breakdownEnabled) {
            applyNoteMask(breakdownPasses[0]);
        } else {
            updatePhraseDisplay();
        }
    }

    /**
     * Seed the authoritative take notes from a phrase (all enabled).
     * @param {Phrase} phrase
     */
    function setTakeFromPhrase(phrase) {
        takeNotes = phrase.notes.map(note => ({ offset: note.offset, enabled: true }));
        resetBreakdownForPhrase();
    }

    async function playPhraseOnce(token) {
        updatePhraseDisplay();
        if (!hasHearOutput()) return;
        if (state.hearSpeech) {
            await VoiceOutput.speak(spokenLine());
            if (token !== playToken) return;
        }
        if (state.singNumbers) {
            await playSingNumberSequence(token);
            if (token !== playToken) return;
        }
        if (state.hearTones) {
            await playToneSequence(token);
        }
    }

    function maybeAdvanceBreakdownPass() {
        if (!state.autoStep || !state.breakdownEnabled || !breakdownPasses.length) return false;
        if (breakdownPassIndex >= breakdownPasses.length - 1) return false;
        breakdownPassIndex++;
        applyNoteMask(breakdownPasses[breakdownPassIndex]);
        syncBreakdownControls();
        return true;
    }

    async function playPhrase() {
        if (!takeNotes.length) return;
        await PianoCore.ensureStarted();
        cancelCurrentSound();
        const token = ++playToken;
        do {
            await playPhraseOnce(token);
            if (token !== playToken) break;
            maybeAdvanceBreakdownPass();
            if (!state.loopCurrent) break;
            await sleep(650);
        } while (token === playToken && state.loopCurrent);
    }

    // Tone output may include invisible fill notes; the visible take plan
    // remains the only source for display, speech, and pitch-test targets.
    async function playToneSequence(token) {
        for (const note of buildTonePlaybackPlan()) {
            if (token !== playToken) return;
            playMidi(note.midi);
            await sleep(state.noteLengthMs + effectiveGapMs());
        }
    }

    /**
     * Tone playback may add invisible fill notes; display, speech, and
     * pitch-test targets remain the visible take plan. Fill only connects
     * consecutive enabled notes within the phrase — never across breakdown
     * gaps (anchor at start + anchor at end would otherwise get bridged).
     * @returns {SequenceNote[]}
     */
    function buildTonePlaybackPlan() {
        const plan = buildTakePlan();
        const visible = plan.filter(note => note.enabled);
        if (state.fillMode === 'none' || visible.length < 2) return visible;
        const root = rootMidi();
        if (root === null) return visible;

        /** @type {number[]} */
        const offsets = [];
        for (const run of enabledPhraseRuns(plan)) {
            if (run.length === 1) {
                offsets.push(run[0].offset);
                continue;
            }
            offsets.push(...fillPlaybackOffsets(run.map(note => note.offset)));
        }
        return PatternPracticeCore.buildSequenceNotes(offsets, root, state.scaleType);
    }

    /**
     * Contiguous enabled notes in phrase order. Breakdown masks leave gaps;
     * fill must not bridge across them.
     * @param {PhrasePlanNote[]} plan
     * @returns {PhrasePlanNote[][]}
     */
    function enabledPhraseRuns(plan) {
        /** @type {PhrasePlanNote[][]} */
        const runs = [];
        /** @type {PhrasePlanNote[]} */
        let run = [];
        for (const note of plan) {
            if (note.enabled) {
                run.push(note);
            } else if (run.length) {
                runs.push(run);
                run = [];
            }
        }
        if (run.length) runs.push(run);
        return runs;
    }

    /** @param {number[]} offsets */
    function fillPlaybackOffsets(offsets) {
        if (state.fillMode === 'chord') return fillChordToneOffsets(offsets);
        return fillScaleRunOffsets(offsets);
    }

    /** @param {number[]} offsets */
    function fillScaleRunOffsets(offsets) {
        const out = [offsets[0]];
        for (let i = 1; i < offsets.length; i++) {
            appendIntegerPath(out, offsets[i - 1], offsets[i], null);
        }
        return out;
    }

    /** @param {number[]} offsets */
    function fillChordToneOffsets(offsets) {
        const dp = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const chordDegrees = new Set([0, 2, 4, dp]);
        const out = [offsets[0]];
        for (let i = 1; i < offsets.length; i++) {
            appendIntegerPath(out, offsets[i - 1], offsets[i], chordDegrees);
        }
        return out;
    }

    /**
     * @param {number[]} out
     * @param {number} from
     * @param {number} to
     * @param {Set<number> | null} allowedDegreeClasses
     */
    function appendIntegerPath(out, from, to, allowedDegreeClasses) {
        if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) {
            out.push(to);
            return;
        }
        const step = Math.sign(to - from);
        const dp = PatternPracticeCore.degreesPerOctave(state.scaleType);
        for (let offset = from + step; offset !== to; offset += step) {
            if (!allowedDegreeClasses || allowedDegreeClasses.has(PatternPracticeCore.positiveModulo(offset, dp))) {
                out.push(offset);
            }
        }
        out.push(to);
    }

    function speakNumberAtPitch(text, midi, durationMs) {
        return VoiceOutput.speakAtPitch(text, {
            pitch: PatternPracticeCore.midiToSpeechPitch(midi),
            rate: state.noteLengthMs >= 1000 ? 0.85 : 1.0,
            durationMs
        });
    }

    // Same live enabled read as playToneSequence.
    async function playSingNumberSequence(token) {
        for (const note of buildTakePlan()) {
            if (token !== playToken) return;
            if (!takeNotes[note.index].enabled) continue; // live read
            await speakNumberAtPitch(note.spoken, note.midi, state.noteLengthMs);
            const gap = effectiveGapMs();
            if (gap > 0) await sleep(gap);
        }
    }

    async function playCurrentOrNew() {
        await MediaSessionCore.activate();
        if (!currentPhrase) generatePhrase();
        await playPhrase();
    }

    async function playNext() {
        await MediaSessionCore.activate();
        testPanel.close();
        stopTransport();
        generatePhrase();
        await playPhrase();
    }

    function toggleRepeatLoop() {
        state.loopCurrent = !state.loopCurrent;
        syncRepeatButton();
        saveSettings();
    }

    function syncRepeatButton() {
        const btn = getEl('repeatBtn');
        if (!btn) return;
        btn.classList.toggle('selected', state.loopCurrent);
        btn.setAttribute('aria-pressed', String(state.loopCurrent));
        const text = btn.querySelector('.button-text');
        if (text) text.textContent = state.loopCurrent ? 'Repeat On' : 'Repeat Off';
    }

    /** @param {number} index @param {boolean} active */
    function setNoteActive(index, active) {
        if (!takeNotes[index]) return;
        takeNotes[index].enabled = active;
        const token = document.querySelector(`.phrase-degree-token[data-index="${index}"]`);
        if (token) token.classList.toggle('inactive', !active);
        drawPhraseTest();
    }

    function endPointerToggle() { isPointerToggling = false; }

    /** @param {boolean} active */
    function setAllNotes(active) {
        takeNotes.forEach(note => { note.enabled = active; });
        updatePhraseDisplay();
    }

    /**
     * @returns {number[][]}
     */
    function buildBreakdownPasses() {
        if (!takeNotes.length) return [];
        const enabled = new Set([0]);
        if (takeNotes.length > 1) enabled.add(takeNotes.length - 1);
        if (takeNotes.length > 2) enabled.add(selectBreakdownGapNote(enabled));

        const passes = [sortedBreakdownIndices(enabled)];
        while (enabled.size < takeNotes.length) {
            enabled.add(selectBreakdownGapNote(enabled));
            passes.push(sortedBreakdownIndices(enabled));
        }
        return passes;
    }

    /**
     * @param {Set<number>} enabled
     * @returns {number[]}
     */
    function sortedBreakdownIndices(enabled) {
        return Array.from(enabled).sort((a, b) => a - b);
    }

    /**
     * @param {Set<number>} enabled
     * @returns {number}
     */
    function selectBreakdownGapNote(enabled) {
        const sorted = sortedBreakdownIndices(enabled);
        let largestGaps = [];
        let largestSize = -1;
        for (let i = 0; i < sorted.length - 1; i++) {
            const left = sorted[i];
            const right = sorted[i + 1];
            const size = right - left - 1;
            if (size <= 0) continue;
            if (size > largestSize) {
                largestGaps = [{ left, right, size }];
                largestSize = size;
            } else if (size === largestSize) {
                largestGaps.push({ left, right, size });
            }
        }
        if (!largestGaps.length) {
            for (let index = 0; index < takeNotes.length; index++) {
                if (!enabled.has(index)) return index;
            }
            return 0;
        }
        const gap = largestGaps[Math.floor(Math.random() * largestGaps.length)];
        return gap.left + 1 + Math.floor(Math.random() * gap.size);
    }

    /** @param {number[]} enabledIndices */
    function applyNoteMask(enabledIndices) {
        const enabledSet = new Set(enabledIndices);
        takeNotes.forEach((note, index) => { note.enabled = enabledSet.has(index); });
        updatePhraseDisplay();
    }

    function toggleBreakdownEnabled() {
        state.breakdownEnabled = !state.breakdownEnabled;
        saveSettings();
        if (!currentPhrase && state.breakdownEnabled) generatePhrase();
        if (state.breakdownEnabled) {
            resetBreakdownForPhrase();
        } else {
            breakdownPassIndex = 0;
            setAllNotes(true);
        }
        syncBreakdownControls();
    }

    function toggleAutoStep() {
        state.autoStep = !state.autoStep;
        saveSettings();
        syncBreakdownControls();
    }

    function togglePlayOnStep() {
        state.playOnStep = !state.playOnStep;
        saveSettings();
        syncBreakdownControls();
    }

    async function advanceBreakdownNote() {
        if (!state.breakdownEnabled) return;
        if (!currentPhrase) generatePhrase();
        if (!breakdownPasses.length) resetBreakdownForPhrase();
        if (breakdownPassIndex >= breakdownPasses.length - 1) return;

        stopTransport();

        breakdownPassIndex++;
        applyNoteMask(breakdownPasses[breakdownPassIndex]);
        syncBreakdownControls();

        if (state.playOnStep) {
            await playPhrase();
        }
    }

    function syncBreakdownControls() {
        const breakdownBtn = getEl('breakdownBtn');
        if (breakdownBtn) {
            breakdownBtn.classList.toggle('selected', state.breakdownEnabled);
            breakdownBtn.setAttribute('aria-pressed', String(state.breakdownEnabled));
        }
        const autoBtn = getEl('autoStepBtn');
        if (autoBtn) {
            autoBtn.classList.toggle('selected', state.autoStep);
            autoBtn.setAttribute('aria-pressed', String(state.autoStep));
        }
        const playOnStepBtn = getEl('playOnStepBtn');
        if (playOnStepBtn) {
            playOnStepBtn.classList.toggle('selected', state.playOnStep);
            playOnStepBtn.setAttribute('aria-pressed', String(state.playOnStep));
        }
        const addBtn = getEl('addNoteBtn');
        if (addBtn instanceof HTMLButtonElement) {
            addBtn.hidden = !state.breakdownEnabled;
            addBtn.disabled = !state.breakdownEnabled
                || breakdownPassIndex >= breakdownPasses.length - 1;
        }
    }

    /** @param {boolean} open */
    function syncTestButton(open) {
        const btn = getEl('testBtn');
        if (!btn) return;
        btn.classList.toggle('selected', open);
        btn.setAttribute('aria-pressed', String(open));
    }

    /** The Test button is a toggle: open the panel, or dismiss it. */
    async function togglePhraseTest() {
        if (testPanel.isOpen) {
            testPanel.close();
            return;
        }
        if (!currentPhrase) generatePhrase();
        await testPanel.open();
    }

    /** @param {Phrase} phrase @param {number} index */
    function renderHistoryItem(phrase, index) {
        const item = document.createElement('div');
        item.className = 'history-item';
        const playBtn = document.createElement('button');
        playBtn.className = 'history-play-btn';
        playBtn.type = 'button';
        playBtn.title = 'Play phrase';
        playBtn.textContent = '>';
        playBtn.addEventListener('click', async () => {
            currentPhrase = phrase;
            setTakeFromPhrase(phrase);
            await playPhrase();
        });
        const text = document.createElement('div');
        text.className = 'history-text';
        const degrees = document.createElement('div');
        degrees.className = 'phrase-history-degrees';
        degrees.textContent = phrase.notes.map(note => note.degree).join(' ');
        const notes = document.createElement('div');
        notes.className = 'history-transcript';
        notes.textContent = phrase.notes.map(note => note.noteName).join(' ');
        const time = document.createElement('span');
        time.className = 'history-time';
        time.textContent = index === 0 ? 'new' : '';
        text.appendChild(degrees);
        text.appendChild(notes);
        item.appendChild(playBtn);
        item.appendChild(text);
        item.appendChild(time);
        return item;
    }

    function syncAdjusterControls() {
        PracticeControls.setValueText('rootPitchValue', `${state.root}${state.octave}`);
        PracticeControls.setValueText('noteLengthValue', PracticeControls.formatSeconds(state.noteLengthMs));
        PracticeControls.setValueText('gapValue', PracticeControls.formatGapLabel(state.gapMs));
        PracticeControls.setValueText('accidentalRateValue', `${Math.round(state.accidentalRate * 100)}%`);
        PracticeControls.setValueText('minLengthValue', String(state.minLength));
        PracticeControls.setValueText('maxLengthValue', String(state.maxLength));

        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(rootMidi(), delta);
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });
    }

    function syncReturnAnchorLabel() {
        const btn = getEl('returnAnchorOnBtn');
        if (btn) btn.textContent = state.startAtOne ? 'return to 1' : 'return to start';
    }

    function syncAnchorControls() {
        syncReturnAnchorLabel();
        syncFillButtons();
    }

    function syncFillButtons() {
        const fullBtn = getEl('fillFullBtn');
        const chordBtn = getEl('fillChordBtn');
        if (fullBtn) {
            fullBtn.classList.toggle('selected', state.fillMode === 'full');
            fullBtn.setAttribute('aria-pressed', String(state.fillMode === 'full'));
        }
        if (chordBtn) {
            chordBtn.classList.toggle('selected', state.fillMode === 'chord');
            chordBtn.setAttribute('aria-pressed', String(state.fillMode === 'chord'));
        }
    }

    function onSettingChanged(key) {
        saveSettings();
        if (REGENERATE_KEYS.has(key)) {
            if (currentPhrase) {
                stopTransport();
                generatePhrase();
            }
            return;
        }
        if (REDRAW_KEYS.has(key)) {
            updatePhraseDisplay();
            return;
        }
        if (REPROJECT_KEYS.has(key) || REPLAY_KEYS.has(key)) {
            updatePhraseDisplay();
            if (currentPhrase) playCurrentOrNew();
        }
    }

    function wireSetting(attr, stateKey, parse) {
        PracticeControls.wireSingleSelect(attr, parse, state[stateKey], value => {
            state[stateKey] = value;
            onSettingChanged(stateKey);
        });
    }

    function normalizeLengthBounds(key) {
        if (state.minLength > state.maxLength) {
            if (key === 'maxLength') state.minLength = state.maxLength;
            else state.maxLength = state.minLength;
        }
    }

    function setAdjusterValue(key, value) {
        state[key] = value;
        normalizeLengthBounds(key);
        syncAdjusterControls();
        onSettingChanged(key);
    }

    /** @param {number} midi */
    function setRootPitchFromMidi(midi) {
        const bounded = PracticeControls.clampRootMidi(midi);
        const info = midiToNoteName(bounded);
        state.root = info.name;
        state.octave = info.octave;
        syncAdjusterControls();
        onSettingChanged('root');
    }

    function stepAdjusterValue(key, delta) {
        if (key === 'rootPitch') {
            const midi = rootMidi();
            if (midi !== null) setRootPitchFromMidi(midi + delta);
            return;
        }

        const next = PracticeControls.stepValue(ADJUSTER_VALUES[key] || [], state[key], delta);
        if (next !== null) setAdjusterValue(key, next);
    }

    function toggleReflect() {
        state.reflected = !state.reflected;
        const btn = getEl('reflectBtn');
        if (btn) {
            btn.classList.toggle('selected', state.reflected);
            btn.setAttribute('aria-pressed', String(state.reflected));
            btn.textContent = state.reflected ? 'Reflect On' : 'Reflect Off';
        }
        updatePhraseDisplay();
        if (currentPhrase) playCurrentOrNew();
    }

    /** @param {'full' | 'chord'} mode */
    function toggleFillMode(mode) {
        state.fillMode = state.fillMode === mode ? 'none' : mode;
        syncAnchorControls();
        onSettingChanged('fillMode');
    }

    function wireHearToggle(id, stateKey) {
        PracticeControls.wireToggle(id, state[stateKey], checked => {
            state[stateKey] = checked;
            onSettingChanged(stateKey);
        });
    }

    function initUI() {
        wireSetting('data-scale', 'scaleType', String);
        wireSetting('data-phrase-algo', 'phraseAlgo', String);
        wireSetting('data-range', 'rangeMode', String);
        wireHearToggle('hearTonesToggle', 'hearTones');
        wireHearToggle('hearSpeechToggle', 'hearSpeech');
        wireHearToggle('singNumbersToggle', 'singNumbers');
        PracticeControls.wireSingleSelect('data-start-anchor', value => value === 'one', state.startAtOne, value => {
            state.startAtOne = value;
            syncReturnAnchorLabel();
            onSettingChanged('startAtOne');
        });
        PracticeControls.wireSingleSelect('data-return-anchor', value => value === 'on', state.returnToInitial, value => {
            state.returnToInitial = value;
            onSettingChanged('returnToInitial');
        });
        PracticeControls.wireSteppers(stepAdjusterValue);
        PracticeControls.wireToggle('showNamesToggle', state.showNoteNames, checked => {
            state.showNoteNames = checked;
            onSettingChanged('showNoteNames');
        });
        PracticeControls.wireToggle('showStaffToggle', state.showStaff, checked => {
            state.showStaff = checked;
            onSettingChanged('showStaff');
        });
        getEl('playBtn')?.addEventListener('click', playCurrentOrNew);
        getEl('repeatBtn')?.addEventListener('click', toggleRepeatLoop);
        getEl('testBtn')?.addEventListener('click', togglePhraseTest);
        getEl('nextBtn')?.addEventListener('click', playNext);
        getEl('stopBtn')?.addEventListener('click', () => {
            testPanel.close();
            stopPlayback();
        });
        getEl('reflectBtn')?.addEventListener('click', toggleReflect);
        getEl('allNotesBtn')?.addEventListener('click', () => setAllNotes(true));
        getEl('fillFullBtn')?.addEventListener('click', () => toggleFillMode('full'));
        getEl('fillChordBtn')?.addEventListener('click', () => toggleFillMode('chord'));
        getEl('breakdownBtn')?.addEventListener('click', toggleBreakdownEnabled);
        getEl('autoStepBtn')?.addEventListener('click', toggleAutoStep);
        getEl('playOnStepBtn')?.addEventListener('click', togglePlayOnStep);
        getEl('addNoteBtn')?.addEventListener('click', () => { advanceBreakdownNote(); });
        history = HistoryList.create({
            listId: 'historyList',
            clearBtnId: 'clearHistoryBtn',
            emptyText: 'No phrases yet',
            renderItem: renderHistoryItem
        });
        window.addEventListener('pointerup', endPointerToggle);
        window.addEventListener('pointercancel', endPointerToggle);
        updatePhraseDisplay();
        syncRepeatButton();
        syncBreakdownControls();
        syncAnchorControls();
        syncAdjusterControls();
        MediaSessionCore.register('Phrases', [
            ['play', () => { playCurrentOrNew(); }],
            ['pause', () => { playCurrentOrNew(); }],
            ['nexttrack', () => { playNext(); }],
            ['seekforward', () => { playNext(); }],
            ['seekto', () => { playNext(); }]
        ]);
        MediaSessionCore.primeOnUserGesture();
    }

    function migrateLoadedSettings() {
        const saved = SettingsStore.peekData(STORAGE_KEY);
        if (!saved || typeof saved !== 'object') return;
        if ('outputMode' in saved && !('hearTones' in saved)) {
            const mode = saved.outputMode;
            state.hearTones = mode === 'tones' || mode === 'speak_tones';
            state.hearSpeech = mode === 'speak' || mode === 'speak_tones';
            state.singNumbers = mode === 'sing_numbers';
        }
        if ('breakdownAutoAdvance' in saved && !('autoStep' in saved)) {
            state.autoStep = Boolean(saved.breakdownAutoAdvance);
        }
    }

    async function boot() {
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
        migrateLoadedSettings();
        if (state.chromaticRuns && !state.accidentalRate) state.accidentalRate = 0.35;
        if (!['none', 'full', 'chord'].includes(state.fillMode)) state.fillMode = 'none';
        try {
            piano = await PianoCore.createPiano();
        } catch (err) {
            // Keep the page interactive; tone output stays silent.
            console.error('Error loading piano samples:', err);
        }
        initUI();
        updateStickyOffset();
        window.addEventListener('resize', updateStickyOffset);
        // Named state inspection for the test suite: the explicit take
        // plan, the test timeline derived from it, and the panel itself
        // (for end-to-end scoring tests via recordSample).
        window.phrasesDebug = {
            takePlan: buildTakePlan,
            tonePlaybackPlan: buildTonePlaybackPlan,
            testTargets: buildPhraseTestTargets,
            breakdownPasses: buildBreakdownPasses,
            breakdownPassIndex: () => breakdownPassIndex,
            settings: () => ({
                breakdownEnabled: state.breakdownEnabled,
                autoStep: state.autoStep,
                playOnStep: state.playOnStep,
                loopCurrent: state.loopCurrent,
                hearTones: state.hearTones,
                hearSpeech: state.hearSpeech,
                singNumbers: state.singNumbers,
                showStaff: state.showStaff
            }),
            panel: testPanel
        };
    }

    boot();
})();
