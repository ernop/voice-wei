// @ts-check
//-----------------------------------------------------------------------
// TEST
// Standalone key-aware pitch trace and pattern guide page (the Trace tab).
// Consumes piano-core, pitch-detect-core, pitch-trace-view,
// practice-controls, and settings-store.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const state = {
        root: 'D#',
        octave: 3,
        scaleType: 'major',
        guideIntervalMs: 1000,
        guideSound: 'piano',
        patternText: '',
        playGuidesOnReset: false,
        pauseOnSilence: true,
        fixedWindow: false,
        expandRange: false
    };

    const STORAGE_KEY = StorageKeys.TRACE_SETTINGS;
    const PERSISTED_KEYS = [
        'root', 'octave', 'scaleType', 'guideIntervalMs', 'guideSound',
        'patternText', 'playGuidesOnReset', 'pauseOnSilence', 'fixedWindow',
        'expandRange'
    ];

    const ADJUSTER_VALUES = {
        guideIntervalMs: [500, 750, 1000, 1250, 1500, 2000, 3000]
    };
    const FIXED_WINDOW_MS = 20000;

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let guidePiano = null;
    /** @type {ReturnType<typeof PianoCore.createSineSynth> | null} */
    let guideSine = null;
    let guidePlaybackToken = 0;
    const readoutGate = new RateGate(50);
    const chartGate = new RateGate(50);
    const textDiff = new ValueDiff();

    const getEl = PracticeControls.getEl;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function rootMidi() {
        return noteNameToMidi(state.root, state.octave);
    }

    function scaleNotes() {
        return scaleDegreeNotesInRange(state.root, state.octave, state.scaleType, 0, 12);
    }

    function chartScaleNotes() {
        return state.expandRange
            ? scaleDegreeNotesInRange(state.root, state.octave, state.scaleType, -12, 24)
            : scaleNotes();
    }

    function setStatus(message) {
        textDiff.text('status', getEl('statusReadout'), message);
    }

    /**
     * @param {string} note
     * @param {number} cents
     * @param {number} freq
     */
    function updatePitchReadout(note, cents, freq) {
        if (!readoutGate.ready()) return;
        const el = getEl('pitchReadout');
        if (!el) return;
        const text = `Pitch: ${note} ${freq.toFixed(1)} Hz ${formatCents(cents)}c`;
        textDiff.text('pitchReadout', el, text);
    }

    function clearPitchReadout() {
        textDiff.text('pitchReadout', getEl('pitchReadout'), 'Pitch: --');
    }

    const session = PitchDetectCore.createTraceSession({
        pauseOnSilence: () => state.pauseOnSilence,
        onAccepted: sample => {
            updatePitchReadout(sample.note, sample.cents, sample.freq);
            setStatus('Listening and drawing');
        },
        onSilence: () => clearPitchReadout(),
        onFrame: () => drawChart()
    });

    function parsedPatternDegrees() {
        const tokens = state.patternText.trim().split(/[\s,;/-]+/).filter(Boolean);
        const notes = scaleNotes();
        return tokens.map(token => Number(token))
            .filter(degree => Number.isInteger(degree) && degree >= 1 && degree <= notes.length);
    }

    function patternDurationMs() {
        const count = parsedPatternDegrees().length;
        return count ? count * state.guideIntervalMs : 0;
    }

    function timeWindowMs() {
        if (state.fixedWindow) return FIXED_WINDOW_MS;
        return Math.max(8000, patternDurationMs() + 1000, session.clockMs() + 500);
    }

    function buildGuideTargets() {
        const guideNotes = scaleNotes();
        const targets = [];
        parsedPatternDegrees().forEach((degree, index) => {
            const note = guideNotes[degree - 1];
            if (!note) return;
            targets.push({
                midi: note.midi,
                startMs: index * state.guideIntervalMs,
                endMs: index * state.guideIntervalMs + state.guideIntervalMs * 0.82,
                label: String(degree),
                active: true
            });
        });
        return targets;
    }

    const view = PitchTraceView.create({
        canvasId: 'traceCanvas',
        defaultHeightPx: 430,
        rails: () => chartScaleNotes().map(note => ({
            midi: note.midi,
            label: `${note.degree} ${note.name}`,
            emphasized: note.interval >= 0 && note.interval <= 12
        })),
        targets: buildGuideTargets,
        history: () => session.history,
        clockMs: () => session.clockMs(),
        windowMs: timeWindowMs,
        fixedWindow: () => state.fixedWindow,
        showPlayhead: () => session.startedAt > 0
    });

    function drawChart(force = false) {
        if (force) {
            chartGate.stamp();
        } else if (!chartGate.ready()) {
            return;
        }
        view.draw();
    }
    function resizeCanvas() { view.resize(); }

    function resetTrace() {
        guidePlaybackToken++;
        session.reset();
        clearPitchReadout();
        setStatus(session.listening ? 'Listening' : 'Ready');
        drawChart(true);
    }

    /**
     * @param {number} midi
     * @param {number} durationMs
     */
    async function playGuideTone(midi, durationMs) {
        await PianoCore.ensureStarted();
        const player = state.guideSound === 'beep' ? guideSine : guidePiano;
        if (player) player.playMidi(midi, durationMs / 1000);
    }

    async function playPatternGuide() {
        const notes = scaleNotes();
        const pattern = parsedPatternDegrees();
        if (!pattern.length) return;
        const token = ++guidePlaybackToken;
        const durationMs = Math.max(120, Math.min(650, state.guideIntervalMs * 0.7));

        for (const degree of pattern) {
            if (token !== guidePlaybackToken) return;
            const note = notes[degree - 1];
            if (note) await playGuideTone(note.midi, durationMs);
            // playGuideTone returns immediately (voices are fire-and-
            // forget), so the full interval is the note spacing - the
            // same spacing the chart draws the guide targets at.
            await sleep(Math.max(80, state.guideIntervalMs));
        }
    }

    async function resetFromButton() {
        resetTrace();
        if (state.playGuidesOnReset) await playPatternGuide();
    }

    function stopListening() {
        guidePlaybackToken++;
        session.stop();
        syncControls();
        setStatus('Stopped');
        drawChart(true);
    }

    async function toggleListening() {
        if (session.listening) {
            stopListening();
            return;
        }

        const ok = await session.start();
        if (!ok) {
            syncControls();
            setStatus('Microphone unavailable or access denied');
            return;
        }
        resetTrace();
        syncControls();
    }

    function syncControls() {
        PracticeControls.syncSingleSelect('data-scale', state.scaleType);
        PracticeControls.syncSingleSelect('data-guide-sound', state.guideSound);
        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(rootMidi(), delta);
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });

        const startBtn = getEl('startBtn');
        if (startBtn) {
            startBtn.textContent = session.listening ? 'Stop' : 'Start';
            startBtn.classList.toggle('listening', session.listening);
        }
        PracticeControls.setValueText('rootPitchValue', scaleRootPitchString(state.root, state.octave));
        PracticeControls.setValueText('guideIntervalValue', PracticeControls.formatSeconds(state.guideIntervalMs));
        PracticeControls.syncToggle('pauseOnSilenceToggle', state.pauseOnSilence);
        PracticeControls.syncToggle('fixedWindowToggle', state.fixedWindow);
        PracticeControls.syncToggle('expandRangeToggle', state.expandRange);
    }

    /** @param {string} key @param {string | number} value */
    function setStateValue(key, value) {
        state[key] = value;
        saveSettings();
        syncControls();
        resetTrace();
    }

    /** @param {number} midi */
    function setRootPitchFromMidi(midi) {
        const bounded = PracticeControls.clampRootMidi(midi);
        const info = midiToNoteName(bounded);
        state.root = info.name;
        state.octave = info.octave;
        saveSettings();
        syncControls();
        resetTrace();
    }

    /** @param {string} key @param {number} delta */
    function stepStateValue(key, delta) {
        if (key === 'rootPitch') {
            const midi = rootMidi();
            if (midi !== null) setRootPitchFromMidi(midi + delta);
            return;
        }

        const next = PracticeControls.stepValue(ADJUSTER_VALUES[key] || [], state[key], delta);
        if (next !== null) setStateValue(key, next);
    }

    function initUI() {
        PracticeControls.wireSingleSelect('data-scale', String, state.scaleType, value => {
            setStateValue('scaleType', value);
        });
        PracticeControls.wireSingleSelect('data-guide-sound', String, state.guideSound, value => {
            state.guideSound = value;
            saveSettings();
        });
        PracticeControls.wireSteppers(stepStateValue);

        const patternInput = /** @type {HTMLInputElement | null} */ (getEl('patternInput'));
        if (patternInput) {
            patternInput.value = state.patternText;
            patternInput.addEventListener('input', () => {
                state.patternText = patternInput.value;
                saveSettings();
                drawChart(true);
            });
        }
        getEl('startBtn')?.addEventListener('click', toggleListening);
        getEl('resetBtn')?.addEventListener('click', resetFromButton);
        PracticeControls.wireToggle('playGuidesToggle', state.playGuidesOnReset, checked => {
            state.playGuidesOnReset = checked;
            saveSettings();
        });
        PracticeControls.wireToggle('pauseOnSilenceToggle', state.pauseOnSilence, checked => {
            state.pauseOnSilence = checked;
            saveSettings();
            resetTrace();
        });
        PracticeControls.wireToggle('fixedWindowToggle', state.fixedWindow, checked => {
            state.fixedWindow = checked;
            saveSettings();
            drawChart(true);
        });
        PracticeControls.wireToggle('expandRangeToggle', state.expandRange, checked => {
            state.expandRange = checked;
            saveSettings();
            drawChart(true);
        });
        window.addEventListener('resize', resizeCanvas);
        syncControls();
        resizeCanvas();
        resetTrace();
    }

    async function boot() {
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
        initUI();
        guideSine = PianoCore.createSineSynth();
        try {
            guidePiano = await PianoCore.createPiano();
        } catch (err) {
            // Trace and beep guides keep working; piano guides stay silent.
            console.error('Error loading piano samples:', err);
        }
    }

    boot();
})();
