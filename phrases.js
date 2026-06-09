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
        startAtOne: true,
        allowOutOfOctave: false,
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
        testPanelOpen: false,
        testListening: false,
        showTestTargets: true,
        testPlayOnRestart: false,
        testPauseOnSilence: true,
        testFixedWindow: false,
        testExpandRange: false
    };

    const STORAGE_KEY = 'phrases-settings';
    const PERSISTED_KEYS = [
        'root', 'octave', 'scaleType', 'startAtOne', 'allowOutOfOctave',
        'minLength', 'maxLength', 'returnToInitial', 'returnToRoot',
        'outputMode', 'noteLengthMs', 'gapMs', 'showNoteNames',
        'showTestTargets', 'testPlayOnRestart', 'testPauseOnSilence',
        'testFixedWindow', 'testExpandRange'
    ];

    const STRUCTURE_KEYS = new Set([
        'minLength', 'maxLength', 'returnToInitial', 'returnToRoot'
    ]);
    const PROJECT_KEYS = new Set(['root', 'octave', 'scaleType']);
    const PLAYBACK_KEYS = new Set(['outputMode', 'noteLengthMs', 'gapMs', 'showNoteNames']);
    const TEST_FIXED_WINDOW_MS = 20000;
    const ADJUSTER_VALUES = {
        noteLengthMs: [200, 250, 300, 350, 400, 450, 500, 600, 900, 1200, 1600],
        gapMs: [0, 100, 250, 500],
        minLength: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16],
        maxLength: [3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 32, 40, 50]
    };
    const ROOT_PITCH_MIN_MIDI = 36; // C2
    const ROOT_PITCH_MAX_MIDI = 71; // B4

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let piano = null;
    /** @type {any | null} */
    let currentPhrase = null;
    /** @type {boolean[] } */
    let activeMask = [];
    /** @type {any[]} */
    const phraseHistory = [];
    let playToken = 0;
    let isPointerToggling = false;
    let pointerToggleValue = true;

    const getEl = PracticeControls.getEl;
    function setStatus(text) { const el = getEl('phraseStatus'); if (el) el.textContent = text; }

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function cancelCurrentSound() {
        if (piano) piano.mute();
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    function stopPlayback(status = 'Stopped') {
        playToken++;
        state.loopCurrent = false;
        syncRepeatButton();
        cancelCurrentSound();
        setStatus(status);
    }

    const sleep = PianoCore.sleep;

    function playMidi(midi) {
        if (!piano) return;
        piano.playMidi(midi, state.noteLengthMs / 1000);
    }

    function buildPhrase() {
        return PatternPracticeCore.generatePhrase({
            root: state.root,
            octave: state.octave,
            scaleType: state.scaleType,
            startAtOne: state.startAtOne,
            allowOutOfOctave: state.allowOutOfOctave,
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
            displayDegrees: offsets.map(offset => PatternPracticeCore.offsetToDegree(offset, dp)),
            spokenDegrees: offsets.map(offset => PatternPracticeCore.offsetToSpoken(offset, dp)),
            noteNames: midiNotes.map(midi => midiToPitchString(midi))
        };
    }

    function renderPhraseUnits(phrase) {
        const degreesEl = getEl('phraseDegrees');
        if (!degreesEl) return;
        degreesEl.textContent = '';
        phrase.displayDegrees.forEach((degree, index) => {
            const unit = document.createElement('span');
            unit.className = 'phrase-note-unit';
            unit.dataset.index = String(index);
            unit.classList.toggle('inactive', activeMask[index] === false);

            const token = document.createElement('span');
            token.className = 'phrase-degree-token';
            token.dataset.index = String(index);
            token.textContent = degree;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'phrase-note-toggle';
            btn.textContent = activeMask[index] === false ? 'off' : 'on';
            btn.title = `${degree} ${phrase.noteNames[index]}`;
            btn.dataset.index = String(index);
            btn.classList.toggle('inactive', activeMask[index] === false);
            btn.addEventListener('pointerdown', event => {
                event.preventDefault();
                isPointerToggling = true;
                pointerToggleValue = activeMask[index] === false;
                setNoteActive(index, pointerToggleValue);
            });
            btn.addEventListener('pointerenter', () => {
                if (isPointerToggling) setNoteActive(index, pointerToggleValue);
            });

            unit.appendChild(token);
            unit.appendChild(btn);
            degreesEl.appendChild(unit);
        });
    }

    function activeIndexes(phrase) {
        const indexes = [];
        for (let i = 0; i < phrase.midiNotes.length; i++) {
            if (activeMask[i] !== false) indexes.push(i);
        }
        if (indexes.length) return indexes;
        return phrase.midiNotes.map((_, i) => i);
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
     * @returns {Array<{ offset: number, midi: number, label: string, noteName: string }>}
     */
    function buildPhraseTestScaleLines(phrase) {
        const root = rootMidi();
        if (root === null || !phrase) return [];
        const degreesPerOctave = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const lines = [];
        const phraseOffsets = Array.isArray(phrase.offsets) ? phrase.offsets : [];
        const extraRange = state.testExpandRange ? degreesPerOctave : 0;
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
    function phraseTestDurationMs(phrase) {
        if (!phrase) return 4000;
        const noteCount = Math.max(phrase.midiNotes.length, 1);
        const phraseMs = (noteCount * (state.noteLengthMs + state.gapMs)) - state.gapMs;
        return Math.max(1200, phraseMs);
    }

    /** @param {any} phrase */
    function phraseTestTimeWindowMs(phrase) {
        if (state.testFixedWindow) return TEST_FIXED_WINDOW_MS;
        return Math.max(4000, phraseTestDurationMs(phrase) + 700, session.clockMs() + 250);
    }

    // Singing far outside the charted rails is a detector artifact, not a
    // note; such samples are discarded before they reach the trace.
    /** @param {number} midi */
    function isPhraseTestOutlier(midi) {
        const lines = buildPhraseTestScaleLines(phraseForPlayback());
        if (!lines.length) return false;
        const min = Math.min(...lines.map(line => line.midi));
        const max = Math.max(...lines.map(line => line.midi));
        return midi < min || midi > max;
    }

    const session = PitchDetectCore.createTraceSession({
        pauseOnSilence: () => state.testPauseOnSilence,
        isOutlier: isPhraseTestOutlier,
        onAccepted: sample => {
            updatePhraseTestReadout(sample.note, sample.cents, sample.freq);
            setPhraseTestStatus('Listening and drawing');
        },
        onSilence: () => clearPhraseTestReadout(),
        onFrame: () => drawPhraseTest()
    });

    function buildPhraseTestTargets() {
        if (!state.showTestTargets) return [];
        const phrase = phraseForPlayback();
        if (!phrase) return [];
        const stepMs = state.noteLengthMs + state.gapMs;
        const phraseDuration = phraseTestDurationMs(phrase);
        return phrase.midiNotes.map((midi, index) => ({
            midi,
            startMs: index * stepMs,
            endMs: Math.min(index * stepMs + state.noteLengthMs, phraseDuration),
            label: phrase.displayDegrees[index],
            active: activeMask[index] !== false
        }));
    }

    const testView = PitchTraceView.create({
        canvasId: 'phraseTestCanvas',
        defaultHeightPx: 380,
        isVisible: () => state.testPanelOpen,
        emptyMessage: () => (phraseForPlayback() ? null : 'Generate a phrase, then press Test.'),
        rails: () => buildPhraseTestScaleLines(phraseForPlayback()).map(line => ({
            midi: line.midi,
            label: `${line.label} ${line.noteName}`,
            emphasized: line.offset >= 0 && line.offset <= PatternPracticeCore.degreesPerOctave(state.scaleType)
        })),
        targets: buildPhraseTestTargets,
        history: () => session.history,
        clockMs: () => session.clockMs(),
        windowMs: () => phraseTestTimeWindowMs(phraseForPlayback()),
        fixedWindow: () => state.testFixedWindow,
        showPlayhead: () => session.startedAt > 0
    });

    function drawPhraseTest() { testView.draw(); }
    function resizePhraseTestCanvas() { testView.resize(); }

    function syncPhraseTestControls() {
        const panel = getEl('phraseTestPanel');
        if (panel) panel.hidden = !state.testPanelOpen;

        const listenBtn = getEl('phraseTestListenBtn');
        if (listenBtn) {
            listenBtn.classList.toggle('listening', state.testListening);
            listenBtn.setAttribute('aria-pressed', String(state.testListening));
            listenBtn.textContent = state.testListening ? 'Listening On' : 'Listening Off';
        }

        const targetsBtn = getEl('phraseTestTargetsBtn');
        if (targetsBtn) {
            targetsBtn.classList.toggle('selected', state.showTestTargets);
            targetsBtn.setAttribute('aria-pressed', String(state.showTestTargets));
            targetsBtn.textContent = state.showTestTargets ? 'Targets On' : 'Targets Off';
        }

        PracticeControls.syncToggle('phraseTestPlayToggle', state.testPlayOnRestart);
        PracticeControls.syncToggle('phraseTestPauseToggle', state.testPauseOnSilence);
        PracticeControls.syncToggle('phraseTestWindowToggle', state.testFixedWindow);
        PracticeControls.syncToggle('phraseTestRangeToggle', state.testExpandRange);
    }

    /** @param {string} message */
    function setPhraseTestStatus(message) {
        const el = getEl('phraseTestStatus');
        if (el) el.textContent = message;
    }

    /**
     * @param {string} note
     * @param {number} cents
     * @param {number} freq
     */
    function updatePhraseTestReadout(note, cents, freq) {
        const pitchEl = getEl('phraseTestPitch');
        const centsEl = getEl('phraseTestCents');
        if (pitchEl) pitchEl.textContent = `Pitch: ${note} ${freq.toFixed(1)} Hz`;
        if (centsEl) centsEl.textContent = `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents`;
    }

    function clearPhraseTestReadout() {
        const pitchEl = getEl('phraseTestPitch');
        const centsEl = getEl('phraseTestCents');
        if (pitchEl) pitchEl.textContent = 'Pitch: --';
        if (centsEl) centsEl.textContent = '-- cents';
    }

    function resetPhraseTestSession() {
        session.reset();
        clearPhraseTestReadout();
        setPhraseTestStatus('Sing to start time');
        drawPhraseTest();
    }

    function updatePhraseDisplay() {
        const degreesEl = getEl('phraseDegrees');
        const notesEl = getEl('phraseNotes');
        if (!degreesEl || !notesEl) return;
        const phrase = deriveDisplayPhrase();
        if (!phrase) {
            degreesEl.textContent = '--';
            notesEl.textContent = '';
            const togglesEl = getEl('phraseNoteToggles');
            if (togglesEl) togglesEl.textContent = '';
            return;
        }
        renderPhraseUnits(phrase);
        notesEl.textContent = state.showNoteNames ? phrase.noteNames.join(' ') : '';
        drawPhraseTest();
    }

    function generatePhrase() {
        currentPhrase = buildPhrase();
        if (!currentPhrase) { setStatus('Could not generate phrase'); return null; }
        activeMask = currentPhrase.midiNotes.map(() => true);
        phraseHistory.unshift(currentPhrase);
        if (phraseHistory.length > 50) phraseHistory.pop();
        updatePhraseDisplay();
        renderHistory();
        return currentPhrase;
    }

    function phraseForPlayback() { return deriveDisplayPhrase(); }

    async function playPhraseOnce(phrase, token) {
        updatePhraseDisplay();
        setStatus(`Playing ${phrase.displayDegrees.join(' ')}`);
        if (state.outputMode === 'none') { setStatus('No audio'); return; }
        if (state.outputMode === 'display') { setStatus('Displayed'); return; }
        if (state.outputMode === 'speak') {
            await VoiceOutput.speak(activeIndexes(phrase).map(i => phrase.spokenDegrees[i]).join(', '));
            if (token === playToken) setStatus('Ready');
            return;
        }
        if (state.outputMode === 'speak_tones') {
            await VoiceOutput.speak(activeIndexes(phrase).map(i => phrase.spokenDegrees[i]).join(', '));
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
            setStatus('Repeating');
            await sleep(650);
        } while (token === playToken && state.loopCurrent);
    }

    async function playToneSequence(phrase, token) {
        for (const i of activeIndexes(phrase)) {
            if (token !== playToken) return;
            const midi = phrase.midiNotes[i];
            setStatus(`${phrase.displayDegrees[i]} | ${midiToPitchString(midi)}`);
            playMidi(midi);
            await sleep(state.noteLengthMs + state.gapMs);
        }
        if (token === playToken && !state.loopCurrent) setStatus('Ready');
    }

    function speakNumberAtPitch(text, midi, durationMs) {
        return new Promise(resolve => {
            if (!('speechSynthesis' in window)) { resolve(undefined); return; }
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.pitch = PatternPracticeCore.midiToSpeechPitch(midi);
            utterance.rate = state.noteLengthMs >= 1000 ? 0.85 : 1.0;
            utterance.volume = 1.0;
            let settled = false;
            const finish = () => { if (settled) return; settled = true; resolve(undefined); };
            utterance.onend = finish;
            utterance.onerror = finish;
            window.speechSynthesis.speak(utterance);
            setTimeout(finish, Math.max(250, durationMs + 250));
        });
    }

    async function playSingNumberSequence(phrase, token) {
        for (const i of activeIndexes(phrase)) {
            if (token !== playToken) return;
            const midi = phrase.midiNotes[i];
            const degree = phrase.displayDegrees[i];
            setStatus(`${degree} | ${midiToPitchString(midi)}`);
            await speakNumberAtPitch(phrase.spokenDegrees[i], midi, state.noteLengthMs);
            if (state.gapMs > 0) await sleep(state.gapMs);
        }
        if (token === playToken && !state.loopCurrent) setStatus('Ready');
    }

    async function playCurrentOrNew() {
        await MediaSessionCore.activate();
        if (!currentPhrase) generatePhrase();
        const phrase = phraseForPlayback();
        if (phrase) await playPhrase(phrase);
    }

    async function playNext() {
        await MediaSessionCore.activate();
        closePhraseTestMode();
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
            stopPlayback('Repeat off');
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
        const btn = document.querySelector(`.phrase-note-toggle[data-index="${index}"]`);
        if (btn) {
            btn.classList.toggle('inactive', !active);
            btn.textContent = active ? 'on' : 'off';
        }
        const token = document.querySelector(`.phrase-degree-token[data-index="${index}"]`);
        if (token) token.classList.toggle('inactive', !active);
        const unit = document.querySelector(`.phrase-note-unit[data-index="${index}"]`);
        if (unit) unit.classList.toggle('inactive', !active);
        drawPhraseTest();
    }

    function endPointerToggle() { isPointerToggling = false; }

    function setAllNotes(active) {
        if (!currentPhrase) return;
        activeMask = currentPhrase.midiNotes.map(() => active);
        renderPhraseUnits(deriveDisplayPhrase());
        drawPhraseTest();
    }

    function stopPhraseTestListening() {
        session.stop();
        state.testListening = false;
        syncPhraseTestControls();
        setPhraseTestStatus('Listening off');
        drawPhraseTest();
    }

    function closePhraseTestMode() {
        if (!state.testPanelOpen && !state.testListening) return;
        stopPhraseTestListening();
        state.testPanelOpen = false;
        syncPhraseTestControls();
        clearPhraseTestReadout();
        setPhraseTestStatus('Ready');
    }

    async function startPhraseTestListening() {
        if (state.testListening) return;
        const ok = await session.start();
        if (!ok) {
            state.testListening = false;
            syncPhraseTestControls();
            setPhraseTestStatus('Microphone unavailable or access denied. Allow microphone access and try Test again.');
            return;
        }
        state.testListening = true;
        syncPhraseTestControls();
        setPhraseTestStatus('Sing to start time');
    }

    async function restartPhraseTest() {
        if (!currentPhrase) generatePhrase();
        state.testPanelOpen = true;
        syncPhraseTestControls();
        resizePhraseTestCanvas();
        resetPhraseTestSession();
        await startPhraseTestListening();
        const phrase = phraseForPlayback();
        if (phrase && state.testPlayOnRestart) await playPhrase(phrase);
    }

    async function startPhraseTest() {
        if (!currentPhrase) generatePhrase();
        state.testPanelOpen = true;
        syncPhraseTestControls();
        resizePhraseTestCanvas();
        await restartPhraseTest();
    }

    async function togglePhraseTestListening() {
        if (state.testListening) {
            stopPhraseTestListening();
            return;
        }
        if (!session.startedAt) resetPhraseTestSession();
        await startPhraseTestListening();
    }

    function togglePhraseTestTargets() {
        state.showTestTargets = !state.showTestTargets;
        saveSettings();
        syncPhraseTestControls();
        drawPhraseTest();
    }

    function renderHistory() {
        const list = getEl('historyList');
        if (!list) return;
        list.textContent = '';
        if (!phraseHistory.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'No phrases yet';
            list.appendChild(empty);
            return;
        }
        phraseHistory.forEach((phrase, index) => {
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
            list.appendChild(item);
        });
    }

    function syncAdjusterControls() {
        PracticeControls.setValueText('rootPitchValue', `${state.root}${state.octave}`);
        PracticeControls.setValueText('noteLengthValue', PracticeControls.formatSeconds(state.noteLengthMs));
        PracticeControls.setValueText('gapValue', PracticeControls.formatSeconds(state.gapMs));
        PracticeControls.setValueText('minLengthValue', String(state.minLength));
        PracticeControls.setValueText('maxLengthValue', String(state.maxLength));

        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                const midi = rootMidi();
                return midi === null || (delta < 0 ? midi <= ROOT_PITCH_MIN_MIDI : midi >= ROOT_PITCH_MAX_MIDI);
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });
    }

    function onSettingChanged(key) {
        saveSettings();
        if (STRUCTURE_KEYS.has(key)) {
            if (currentPhrase) {
                stopPlayback('Regenerated');
                generatePhrase();
            }
            return;
        }
        if (PROJECT_KEYS.has(key) || PLAYBACK_KEYS.has(key)) {
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
        const bounded = PatternPracticeCore.clamp(midi, ROOT_PITCH_MIN_MIDI, ROOT_PITCH_MAX_MIDI);
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
        wireSetting('data-start', 'startAtOne', value => value === 'one');
        wireSetting('data-range', 'allowOutOfOctave', value => value === 'expanded');
        wireSetting('data-return-initial', 'returnToInitial', value => value === 'yes');
        wireSetting('data-output', 'outputMode', String);
        PracticeControls.wireSteppers(stepAdjusterValue);
        PracticeControls.wireToggle('showNamesToggle', state.showNoteNames, checked => {
            state.showNoteNames = checked;
            onSettingChanged('showNoteNames');
        });
        getEl('playBtn')?.addEventListener('click', playCurrentOrNew);
        getEl('repeatBtn')?.addEventListener('click', toggleRepeatLoop);
        getEl('testBtn')?.addEventListener('click', startPhraseTest);
        getEl('nextBtn')?.addEventListener('click', playNext);
        getEl('stopBtn')?.addEventListener('click', () => {
            closePhraseTestMode();
            stopPlayback();
        });
        getEl('reflectBtn')?.addEventListener('click', toggleReflect);
        getEl('allNotesBtn')?.addEventListener('click', () => setAllNotes(true));
        getEl('phraseTestRestartBtn')?.addEventListener('click', restartPhraseTest);
        getEl('phraseTestListenBtn')?.addEventListener('click', togglePhraseTestListening);
        getEl('phraseTestTargetsBtn')?.addEventListener('click', togglePhraseTestTargets);
        PracticeControls.wireToggle('phraseTestPlayToggle', state.testPlayOnRestart, checked => {
            state.testPlayOnRestart = checked;
            saveSettings();
        });
        PracticeControls.wireToggle('phraseTestPauseToggle', state.testPauseOnSilence, checked => {
            state.testPauseOnSilence = checked;
            saveSettings();
            resetPhraseTestSession();
        });
        PracticeControls.wireToggle('phraseTestWindowToggle', state.testFixedWindow, checked => {
            state.testFixedWindow = checked;
            saveSettings();
            drawPhraseTest();
        });
        PracticeControls.wireToggle('phraseTestRangeToggle', state.testExpandRange, checked => {
            state.testExpandRange = checked;
            saveSettings();
            drawPhraseTest();
        });
        getEl('clearHistoryBtn')?.addEventListener('click', () => { phraseHistory.length = 0; renderHistory(); });
        window.addEventListener('pointerup', endPointerToggle);
        window.addEventListener('pointercancel', endPointerToggle);
        window.addEventListener('resize', resizePhraseTestCanvas);
        updatePhraseDisplay();
        renderHistory();
        syncRepeatButton();
        syncPhraseTestControls();
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
        setStatus('Loading piano');
        piano = await PianoCore.createPiano();
        initUI();
        setStatus('Ready');
    }

    boot();
})();
