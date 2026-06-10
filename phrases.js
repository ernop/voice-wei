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
        loopCurrent: false
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
    const ADJUSTER_VALUES = {
        noteLengthMs: PracticeControls.NOTE_LENGTH_VALUES,
        gapMs: PracticeControls.GAP_VALUES,
        minLength: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16],
        maxLength: [3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 32, 40, 50]
    };

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let piano = null;
    /** @type {any | null} */
    let currentPhrase = null;
    /** @type {boolean[] } */
    let activeMask = [];
    /** @type {ReturnType<typeof HistoryList.create> | null} */
    let history = null;
    let playToken = 0;
    let isPointerToggling = false;
    let pointerToggleValue = true;

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

    function deriveDisplayPhrase() {
        if (!currentPhrase) return null;
        const root = rootMidi();
        if (root === null) return currentPhrase;

        const offsets = state.reflected
            ? PatternPracticeCore.reflectOffsets(currentPhrase.offsets, state.scaleType)
            : currentPhrase.offsets;
        const dp = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const midiNotes = offsets.map(offset => PatternPracticeCore.scaleOffsetToMidi(root, state.scaleType, offset));

        return {
            ...currentPhrase,
            root: state.root,
            scaleType: state.scaleType,
            octave: state.octave,
            offsets,
            midiNotes,
            displayDegrees: PatternPracticeCore.offsetsToDisplay(offsets, dp),
            spokenDegrees: PatternPracticeCore.offsetsToSpoken(offsets, dp),
            noteNames: midiNotes.map(midi => midiToPitchString(midi))
        };
    }

    function renderPhraseUnits(phrase) {
        const degreesEl = getEl('phraseDegrees');
        if (!degreesEl) return;
        degreesEl.textContent = '';
        degreesEl.classList.toggle('phrase-degrees-many', phrase.displayDegrees.length > 18);
        phrase.displayDegrees.forEach((degree, index) => {
            // The degree number is the mute toggle: tap to flip, drag
            // across several to paint the same state. Keeps the stage to
            // a single row (vertical space is precious on the phone).
            const token = document.createElement('button');
            token.type = 'button';
            token.className = 'phrase-degree-token';
            token.dataset.index = String(index);
            token.textContent = degree;
            token.title = `${degree} ${phrase.noteNames[index]} - tap to mute/unmute`;
            token.classList.toggle('inactive', activeMask[index] === false);
            token.addEventListener('pointerdown', event => {
                event.preventDefault();
                isPointerToggling = true;
                pointerToggleValue = activeMask[index] === false;
                setNoteActive(index, pointerToggleValue);
            });
            token.addEventListener('pointerenter', () => {
                if (isPointerToggling) setNoteActive(index, pointerToggleValue);
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
     * @param {any} phrase
     * @param {boolean} expandRange
     * @returns {Array<{ offset: number, midi: number, label: string, noteName: string }>}
     */
    function buildPhraseTestScaleLines(phrase, expandRange) {
        const root = rootMidi();
        if (root === null || !phrase) return [];
        const degreesPerOctave = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const lines = [];
        const phraseOffsets = Array.isArray(phrase.offsets) ? phrase.offsets : [];
        const extraRange = expandRange ? degreesPerOctave : 0;
        const lowerOffset = Math.min(-1, ...phraseOffsets) - 1 - extraRange;
        const upperOffset = Math.max(degreesPerOctave + 1, ...phraseOffsets) + 1 + extraRange;
        for (let offset = lowerOffset; offset <= upperOffset; offset++) {
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

    /** @param {any} phrase */
    /**
     * The explicit take plan: every note of the current phrase with
     * named fields, nothing positional or implied. Display, playback,
     * and the test panel all read this one list. Enabled notes share
     * one timeline that starts at 0 with the FIRST ENABLED note;
     * disabled notes own no time at all - exactly how playback sounds.
     * @returns {PhrasePlanNote[]}
     */
    function buildTakePlan() {
        const phrase = phraseForPlayback();
        if (!phrase) return [];
        const stepMs = state.noteLengthMs + effectiveGapMs();
        let slot = 0;
        return phrase.midiNotes.map((midi, index) => {
            const enabled = activeMask[index] !== false;
            const startMs = enabled ? slot * stepMs : null;
            if (enabled) slot++;
            return {
                index,
                midi,
                degree: phrase.displayDegrees[index],
                spoken: phrase.spokenDegrees[index],
                noteName: phrase.noteNames[index],
                enabled,
                startMs,
                endMs: enabled && startMs !== null ? startMs + state.noteLengthMs : null
            };
        });
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
        emptyMessage: () => (phraseForPlayback() ? null : 'Generate a phrase, then press Test.'),
        key: () => ({
            rootMidi: rootMidi() ?? 60,
            rootLabel: `${state.root}${state.octave}`,
            scaleType: state.scaleType
        }),
        rails: ({ expandRange }) => buildPhraseTestScaleLines(phraseForPlayback(), expandRange).map(line => ({
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

    function updatePhraseDisplay() {
        const degreesEl = getEl('phraseDegrees');
        const notesEl = getEl('phraseNotes');
        if (!degreesEl || !notesEl) return;
        const phrase = deriveDisplayPhrase();
        if (!phrase) {
            degreesEl.textContent = '--';
            degreesEl.classList.remove('phrase-degrees-many');
            notesEl.textContent = '';
            return;
        }
        renderPhraseUnits(phrase);
        notesEl.textContent = state.showNoteNames ? phrase.noteNames.join(' ') : '';
        drawPhraseTest();
    }

    function generatePhrase() {
        currentPhrase = buildPhrase();
        if (!currentPhrase) return null;
        activeMask = currentPhrase.midiNotes.map(() => true);
        updatePhraseDisplay();
        if (history) history.add(currentPhrase);
        return currentPhrase;
    }

    function phraseForPlayback() { return deriveDisplayPhrase(); }

    async function playPhraseOnce(phrase, token) {
        updatePhraseDisplay();
        if (state.outputMode === 'none' || state.outputMode === 'display') return;
        if (state.outputMode === 'speak') {
            await VoiceOutput.speak(spokenLine());
            return;
        }
        if (state.outputMode === 'speak_tones') {
            await VoiceOutput.speak(spokenLine());
            if (token !== playToken) return;
            await playToneSequence(phrase, token);
            return;
        }
        if (state.outputMode === 'sing_numbers') {
            await playSingNumberSequence(phrase, token);
            return;
        }
        await playToneSequence(phrase, token);
    }

    async function playPhrase(phrase) {
        await PianoCore.ensureStarted();
        cancelCurrentSound();
        const token = ++playToken;
        do {
            await playPhraseOnce(phrase, token);
            if (token !== playToken || !state.loopCurrent) break;
            await sleep(650);
        } while (token === playToken && state.loopCurrent);
    }

    // The mask is read live, right before each note starts: toggling a
    // later note during playback changes what WILL be played without
    // touching the note currently sounding.
    async function playToneSequence(phrase, token) {
        for (const note of buildTakePlan()) {
            if (token !== playToken) return;
            if (activeMask[note.index] === false) continue; // live mask read
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

    // Same live mask read as playToneSequence.
    async function playSingNumberSequence(phrase, token) {
        for (const note of buildTakePlan()) {
            if (token !== playToken) return;
            if (activeMask[note.index] === false) continue; // live mask read
            await speakNumberAtPitch(note.spoken, note.midi, state.noteLengthMs);
            const gap = effectiveGapMs();
            if (gap > 0) await sleep(gap);
        }
    }

    async function playCurrentOrNew() {
        await MediaSessionCore.activate();
        if (!currentPhrase) generatePhrase();
        const phrase = phraseForPlayback();
        if (phrase) await playPhrase(phrase);
    }

    async function playNext() {
        await MediaSessionCore.activate();
        testPanel.close();
        state.loopCurrent = false;
        syncRepeatButton();
        generatePhrase();
        const phrase = phraseForPlayback();
        if (phrase) await playPhrase(phrase);
    }

    async function toggleRepeatLoop() {
        if (!currentPhrase) generatePhrase();
        state.loopCurrent = !state.loopCurrent;
        syncRepeatButton();
        if (state.loopCurrent) {
            const phrase = phraseForPlayback();
            if (phrase) await playPhrase(phrase);
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

    function setNoteActive(index, active) {
        activeMask[index] = active;
        const token = document.querySelector(`.phrase-degree-token[data-index="${index}"]`);
        if (token) token.classList.toggle('inactive', !active);
        drawPhraseTest();
    }

    function endPointerToggle() { isPointerToggling = false; }

    function setAllNotes(active) {
        if (!currentPhrase) return;
        activeMask = currentPhrase.midiNotes.map(() => active);
        renderPhraseUnits(deriveDisplayPhrase());
        drawPhraseTest();
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
            activeMask = phrase.midiNotes.map(() => true);
            updatePhraseDisplay();
            const playbackPhrase = phraseForPlayback();
            if (playbackPhrase) await playPhrase(playbackPhrase);
        });
        const text = document.createElement('div');
        text.className = 'history-text';
        const degrees = document.createElement('div');
        degrees.className = 'phrase-history-degrees';
        degrees.textContent = phrase.displayDegrees.join(' ');
        const notes = document.createElement('div');
        notes.className = 'history-transcript';
        notes.textContent = phrase.noteNames.join(' ');
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
        // Named state inspection for the test suite: the explicit take
        // plan and the test timeline derived from it.
        window.phrasesDebug = { takePlan: buildTakePlan, testTargets: buildPhraseTestTargets };
    }

    boot();
})();
