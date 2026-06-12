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
        minLength: 5,
        maxLength: 8,
        returnToInitial: true,
        returnToRoot: false,
        outputMode: 'tones',
        noteLengthMs: 300,
        gapMs: 0,
        showNoteNames: true,
        reflected: false,
        loopCurrent: false,
        breakdownAutoAdvance: true
    };

    const STORAGE_KEY = 'phrases-settings';
    const PERSISTED_KEYS = [
        'root', 'octave', 'scaleType', 'phraseAlgo', 'startAtOne', 'rangeMode',
        'chromaticRuns', 'minLength', 'maxLength', 'returnToInitial', 'returnToRoot',
        'outputMode', 'noteLengthMs', 'gapMs', 'showNoteNames'
    ];

    // Setting-change behaviors follow the shared vocabulary defined in
    // docs/parameters.md. Keys not listed here are bounds-next: they only
    // affect the NEXT generated phrase (phraseAlgo, startAtOne, rangeMode,
    // chromaticRuns, minLength, maxLength).
    const REGENERATE_KEYS = new Set(['returnToInitial', 'returnToRoot']);
    const REPROJECT_KEYS = new Set(['root', 'octave', 'scaleType']);
    const REPLAY_KEYS = new Set(['outputMode', 'noteLengthMs', 'gapMs']);
    const REDRAW_KEYS = new Set(['showNoteNames']);
    const BREAKDOWN_PASS_PAUSE_MS = 700;
    const ADJUSTER_VALUES = {
        noteLengthMs: PracticeControls.NOTE_LENGTH_VALUES,
        gapMs: PracticeControls.GAP_VALUES,
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
    let breakdownActive = false;
    /** @type {number[][]} */
    let breakdownPasses = [];
    let breakdownPassIndex = 0;

    const getEl = PracticeControls.getEl;

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    /** @type {ReturnType<typeof PitchTestPanel.create> | null} */
    let testPanel = null;

    function cancelCurrentSound() {
        if (piano) piano.stopAll();
        if (testPanel) testPanel.cancelGuide();
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    function stopPlayback() {
        playToken++;
        state.loopCurrent = false;
        syncRepeatButton();
        setBreakdownActive(false);
        cancelCurrentSound();
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
            chromaticRuns: state.chromaticRuns,
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
        if (offset < 0) {
            const degree = PatternPracticeCore.positiveModulo(offset, degreesPerOctave) + 1;
            return `${degree} below`;
        }
        if (offset === degreesPerOctave) return `${degreesPerOctave + 1} ${ordinalForDegree(degreesPerOctave + 1)}`;
        if (offset > degreesPerOctave) {
            const degree = PatternPracticeCore.positiveModulo(offset, degreesPerOctave) + 1;
            return `${degree} above`;
        }
        const degree = offset + 1;
        return `${degree} ${ordinalForDegree(degree)}`;
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
        storageKey: 'phrases-test-panel',
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

    function drawPhraseTest() { testPanel.draw(); }

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
            return;
        }
        renderPhraseUnits(plan);
        notesEl.textContent = state.showNoteNames ? plan.map(note => note.noteName).join(' ') : '';
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

    /**
     * Seed the authoritative take notes from a phrase (all enabled).
     * @param {Phrase} phrase
     */
    function setTakeFromPhrase(phrase) {
        takeNotes = phrase.notes.map(note => ({ offset: note.offset, enabled: true }));
        updatePhraseDisplay();
    }

    async function playPhraseOnce(token) {
        updatePhraseDisplay();
        if (state.outputMode === 'none' || state.outputMode === 'display') return;
        if (state.outputMode === 'speak') {
            await VoiceOutput.speak(spokenLine());
            return;
        }
        if (state.outputMode === 'speak_tones') {
            await VoiceOutput.speak(spokenLine());
            if (token !== playToken) return;
            await playToneSequence(token);
            return;
        }
        if (state.outputMode === 'sing_numbers') {
            await playSingNumberSequence(token);
            return;
        }
        await playToneSequence(token);
    }

    async function playPhrase() {
        if (!takeNotes.length) return;
        await PianoCore.ensureStarted();
        setBreakdownActive(false);
        cancelCurrentSound();
        const token = ++playToken;
        do {
            await playPhraseOnce(token);
            if (token !== playToken || !state.loopCurrent) break;
            await sleep(650);
        } while (token === playToken && state.loopCurrent);
    }

    // Enabled is read live, right before each note starts: toggling a
    // later note during playback changes what WILL be played without
    // touching the note currently sounding.
    async function playToneSequence(token) {
        for (const note of buildTakePlan()) {
            if (token !== playToken) return;
            if (!takeNotes[note.index].enabled) continue; // live read
            playMidi(note.midi);
            await sleep(state.noteLengthMs + effectiveGapMs());
        }
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
        state.loopCurrent = false;
        syncRepeatButton();
        generatePhrase();
        await playPhrase();
    }

    async function toggleRepeatLoop() {
        if (!currentPhrase) generatePhrase();
        state.loopCurrent = !state.loopCurrent;
        syncRepeatButton();
        if (state.loopCurrent) {
            await playPhrase();
        } else {
            stopPlayback();
        }
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
        renderPhraseUnits(buildTakePlan());
        drawPhraseTest();
    }

    /** @param {boolean} active */
    function setBreakdownActive(active) {
        breakdownActive = active;
        syncBreakdownControls();
    }

    function syncBreakdownButton() {
        const btn = getEl('breakdownBtn');
        if (!btn) return;
        btn.classList.toggle('selected', breakdownActive);
        btn.setAttribute('aria-pressed', String(breakdownActive));
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

    async function prepareBreakdownRun() {
        await MediaSessionCore.activate();
        if (!currentPhrase) generatePhrase();
        if (!takeNotes.length) return false;
        testPanel.close();
        state.loopCurrent = false;
        syncRepeatButton();
        await PianoCore.ensureStarted();
        cancelCurrentSound();
        breakdownPasses = buildBreakdownPasses();
        breakdownPassIndex = 0;
        applyNoteMask(breakdownPasses[breakdownPassIndex]);
        return true;
    }

    async function runBreakdown() {
        if (breakdownActive) {
            stopPlayback();
            return;
        }
        if (!(await prepareBreakdownRun())) return;
        if (state.breakdownAutoAdvance) {
            await runAutoBreakdown();
        } else {
            startManualBreakdownLoop();
        }
    }

    async function runAutoBreakdown() {
        const token = ++playToken;
        setBreakdownActive(true);
        try {
            for (let passIndex = 0; passIndex < breakdownPasses.length; passIndex++) {
                if (token !== playToken) return;
                breakdownPassIndex = passIndex;
                syncBreakdownControls();
                applyNoteMask(breakdownPasses[passIndex]);
                await playPhraseOnce(token);
                if (token !== playToken) return;
                if (passIndex < breakdownPasses.length - 1) await sleep(BREAKDOWN_PASS_PAUSE_MS);
            }
        } finally {
            if (token === playToken) setBreakdownActive(false);
        }
    }

    function startManualBreakdownLoop() {
        const token = ++playToken;
        setBreakdownActive(true);
        syncBreakdownControls();
        repeatManualBreakdown(token);
    }

    /** @param {number} token */
    async function repeatManualBreakdown(token) {
        try {
            while (token === playToken && breakdownActive) {
                applyNoteMask(breakdownPasses[breakdownPassIndex]);
                await playPhraseOnce(token);
                if (token !== playToken || !breakdownActive) return;
                await sleep(BREAKDOWN_PASS_PAUSE_MS);
            }
        } finally {
            if (token === playToken) setBreakdownActive(false);
        }
    }

    async function advanceBreakdownNote() {
        if (state.breakdownAutoAdvance) return;
        if (!breakdownActive) {
            if (!(await prepareBreakdownRun())) return;
            startManualBreakdownLoop();
            return;
        }
        if (breakdownPassIndex >= breakdownPasses.length - 1) return;
        const token = ++playToken;
        breakdownPassIndex++;
        cancelCurrentSound();
        applyNoteMask(breakdownPasses[breakdownPassIndex]);
        setBreakdownActive(true);
        syncBreakdownControls();
        repeatManualBreakdown(token);
    }

    function toggleBreakdownAutoAdvance() {
        const next = !state.breakdownAutoAdvance;
        if (breakdownActive) stopPlayback();
        state.breakdownAutoAdvance = next;
        syncBreakdownControls();
    }

    function syncBreakdownControls() {
        const autoBtn = getEl('autoAdvanceBtn');
        if (autoBtn) {
            autoBtn.classList.toggle('selected', state.breakdownAutoAdvance);
            autoBtn.setAttribute('aria-pressed', String(state.breakdownAutoAdvance));
        }
        const addBtn = getEl('addNoteBtn');
        if (addBtn instanceof HTMLButtonElement) {
            addBtn.hidden = state.breakdownAutoAdvance;
            addBtn.disabled = breakdownActive && breakdownPassIndex >= breakdownPasses.length - 1;
        }
        syncBreakdownButton();
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
        PracticeControls.setValueText('minLengthValue', String(state.minLength));
        PracticeControls.setValueText('maxLengthValue', String(state.maxLength));

        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(rootMidi(), delta);
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });
    }

    function onSettingChanged(key) {
        saveSettings();
        if (REGENERATE_KEYS.has(key)) {
            if (currentPhrase) {
                stopPlayback();
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

    function initUI() {
        wireSetting('data-scale', 'scaleType', String);
        wireSetting('data-phrase-algo', 'phraseAlgo', String);
        wireSetting('data-start', 'startAtOne', value => value === 'one');
        wireSetting('data-range', 'rangeMode', String);
        wireSetting('data-return-initial', 'returnToInitial', value => value === 'yes');
        wireSetting('data-output', 'outputMode', String);
        PracticeControls.wireSteppers(stepAdjusterValue);
        PracticeControls.wireToggle('showNamesToggle', state.showNoteNames, checked => {
            state.showNoteNames = checked;
            onSettingChanged('showNoteNames');
        });
        PracticeControls.wireToggle('chromaticToggle', state.chromaticRuns, checked => {
            state.chromaticRuns = checked;
            onSettingChanged('chromaticRuns');
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
        getEl('breakdownBtn')?.addEventListener('click', runBreakdown);
        getEl('autoAdvanceBtn')?.addEventListener('click', toggleBreakdownAutoAdvance);
        getEl('addNoteBtn')?.addEventListener('click', advanceBreakdownNote);
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

    async function boot() {
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
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
            testTargets: buildPhraseTestTargets,
            breakdownPasses: buildBreakdownPasses,
            panel: testPanel
        };
    }

    boot();
})();
