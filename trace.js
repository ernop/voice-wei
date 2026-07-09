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
    const textDiff = new ValueDiff();

    const getEl = PracticeControls.getEl;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function rootMidi() {
        return noteNameToMidi(state.root, state.octave);
    }

    // Rails always cover the pattern: a 5d target must sit on a labeled
    // rail, not below the chart.
    function chartScaleNotes() {
        const intervals = parsedPatternEntries().map(entry => entry.interval);
        let min = state.expandRange ? -12 : 0;
        let max = state.expandRange ? 24 : 12;
        if (intervals.length) {
            min = Math.min(min, ...intervals);
            max = Math.max(max, ...intervals);
        }
        return scaleDegreeNotesInRange(state.root, state.octave, state.scaleType, min, max);
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

    /**
     * Parse the degree pattern into intervals from the root. Beyond the
     * plain 1..8, octave suffixes reach other octaves: "5d" (also "5v" or
     * "5\u2193") is 5 in the octave below, "2u" ("2\u2191") the octave above,
     * stackable ("5dd" = two octaves down). Numbers past the octave
     * continue upward: 9 = 2 above, 10 = 3 above. The typed token is
     * kept as the target label.
     * @returns {Array<{ interval: number, label: string }>}
     */
    function parsedPatternEntries() {
        const pattern = scalePattern(state.scaleType);
        const degreesPerOctave = pattern.length - 1;
        const tokens = state.patternText.trim().split(/[\s,;/-]+/).filter(Boolean);
        /** @type {Array<{ interval: number, label: string }>} */
        const entries = [];
        for (const token of tokens) {
            const match = token.toLowerCase().match(/^(\d+)([duv^\u2191\u2193]*)$/);
            if (!match) continue;
            const number = Number(match[1]);
            if (!Number.isInteger(number) || number < 1) continue;
            let octaveShift = 0;
            for (const mark of match[2]) {
                octaveShift += (mark === 'd' || mark === 'v' || mark === '\u2193') ? -1 : 1;
            }
            octaveShift += Math.floor((number - 1) / degreesPerOctave);
            const degreeIndex = (number - 1) % degreesPerOctave;
            const interval = pattern[degreeIndex] + octaveShift * 12;
            if (interval < -24 || interval > 36) continue;
            entries.push({ interval, label: token });
        }
        return entries;
    }

    function patternDurationMs() {
        const count = parsedPatternEntries().length;
        return count ? count * state.guideIntervalMs : 0;
    }

    function timeWindowMs() {
        if (state.fixedWindow) return FIXED_WINDOW_MS;
        return Math.max(8000, patternDurationMs() + 1000, session.clockMs() + 500);
    }

    function buildGuideTargets() {
        const root = rootMidi();
        if (root === null) return [];
        return parsedPatternEntries().map((entry, index) => ({
            midi: root + entry.interval,
            startMs: index * state.guideIntervalMs,
            endMs: index * state.guideIntervalMs + state.guideIntervalMs * 0.82,
            label: entry.label,
            active: true
        }));
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

    // Drawing is never throttled: the chart redraws every animation
    // frame so the scroll steps evenly (throttles are for readouts).
    function drawChart() {
        view.draw();
    }
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
        const root = rootMidi();
        const pattern = parsedPatternEntries();
        if (root === null || !pattern.length) return;
        const token = ++guidePlaybackToken;
        const durationMs = Math.max(120, Math.min(650, state.guideIntervalMs * 0.7));

        for (const entry of pattern) {
            if (token !== guidePlaybackToken) return;
            await playGuideTone(root + entry.interval, durationMs);
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
        // Named state inspection for the test suite.
        window.traceDebug = {
            patternEntries: parsedPatternEntries,
            guideTargets: buildGuideTargets,
            rails: chartScaleNotes
        };
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
