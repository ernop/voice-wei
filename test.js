// @ts-check
//-----------------------------------------------------------------------
// TEST
// Standalone key-aware pitch trace and pattern guide page.
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

    const STORAGE_KEY = 'test-settings';
    const PERSISTED_KEYS = [
        'root', 'octave', 'scaleType', 'guideIntervalMs', 'guideSound',
        'patternText', 'playGuidesOnReset', 'pauseOnSilence', 'fixedWindow',
        'expandRange'
    ];

    const ADJUSTER_VALUES = {
        guideIntervalMs: [500, 750, 1000, 1250, 1500, 2000, 3000]
    };
    const ROOT_PITCH_MIN_MIDI = 36; // C2
    const ROOT_PITCH_MAX_MIDI = 71; // B4
    const FIXED_WINDOW_MS = 20000;

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let guidePiano = null;
    /** @type {ReturnType<typeof PianoCore.createSineSynth> | null} */
    let guideSine = null;
    let guidePlaybackToken = 0;

    const getEl = PracticeControls.getEl;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function rootMidi() {
        return noteNameToMidi(state.root, state.octave);
    }

    function scaleIntervals() {
        return (SCALE_PATTERNS[state.scaleType] || SCALE_PATTERNS.major).slice();
    }

    function scaleNotes() {
        const root = rootMidi();
        if (root === null) return [];
        return scaleIntervals().map((interval, index) => {
            const midi = root + interval;
            return {
                degree: index + 1,
                midi,
                noteName: midiToPitchString(midi)
            };
        });
    }

    function chartScaleNotes() {
        const root = rootMidi();
        if (root === null) return [];
        const shifts = state.expandRange ? [-1, 0, 1] : [0];
        return shifts.flatMap(octaveShift => scaleIntervals().map((interval, index) => {
            const midi = root + octaveShift * 12 + interval;
            return {
                degree: index + 1,
                midi,
                octaveShift,
                noteName: midiToPitchString(midi)
            };
        }));
    }

    /** @param {number} midi */
    function isExtremeOutlier(midi) {
        const notes = chartScaleNotes();
        if (!notes.length) return false;
        const min = Math.min(...notes.map(note => note.midi));
        const max = Math.max(...notes.map(note => note.midi));
        return midi < min || midi > max;
    }

    function setStatus(message) {
        const el = getEl('statusReadout');
        if (el) el.textContent = message;
    }

    /**
     * @param {string} note
     * @param {number} cents
     * @param {number} freq
     */
    function updatePitchReadout(note, cents, freq) {
        const el = getEl('pitchReadout');
        if (!el) return;
        el.textContent = `Pitch: ${note} ${freq.toFixed(1)} Hz ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}c`;
    }

    function clearPitchReadout() {
        const el = getEl('pitchReadout');
        if (el) el.textContent = 'Pitch: --';
    }

    const session = PitchDetectCore.createTraceSession({
        pauseOnSilence: () => state.pauseOnSilence,
        isOutlier: isExtremeOutlier,
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
        canvasId: 'testCanvas',
        defaultHeightPx: 430,
        rails: () => chartScaleNotes().map(note => ({
            midi: note.midi,
            label: `${note.degree} ${note.noteName}`,
            emphasized: note.octaveShift === 0
        })),
        targets: buildGuideTargets,
        history: () => session.history,
        clockMs: () => session.clockMs(),
        windowMs: timeWindowMs,
        fixedWindow: () => state.fixedWindow,
        showPlayhead: () => session.startedAt > 0
    });

    function drawChart() { view.draw(); }
    function resizeCanvas() { view.resize(); }

    function resetTrace() {
        guidePlaybackToken++;
        session.reset();
        clearPitchReadout();
        setStatus(session.listening ? 'Listening' : 'Ready');
        drawChart();
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
            await sleep(Math.max(80, state.guideIntervalMs - durationMs));
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
        drawChart();
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
                const midi = rootMidi();
                return midi === null || (delta < 0 ? midi <= ROOT_PITCH_MIN_MIDI : midi >= ROOT_PITCH_MAX_MIDI);
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });

        const startBtn = getEl('startBtn');
        if (startBtn) {
            startBtn.textContent = session.listening ? 'Stop' : 'Start';
            startBtn.classList.toggle('listening', session.listening);
        }
        PracticeControls.setValueText('rootPitchValue', `${state.root}${state.octave}`);
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
        const bounded = Math.max(ROOT_PITCH_MIN_MIDI, Math.min(ROOT_PITCH_MAX_MIDI, midi));
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
                drawChart();
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
            drawChart();
        });
        PracticeControls.wireToggle('expandRangeToggle', state.expandRange, checked => {
            state.expandRange = checked;
            saveSettings();
            drawChart();
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
