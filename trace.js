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
        // Zero spacing would stack every guide target at t=0.
        guideIntervalMs: PracticeControls.NOTE_LENGTH_VALUES
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

    // Rails cover the core octave (or the expanded range) plus the
    // pattern's reach: a 5d target must sit on a labeled rail, not
    // below the chart. On top of that, the 3 scale notes just below
    // the root and the 3 just above the octave are always drawn as
    // context (e.g. 7 6 5 below, 2 3 4 above in major) - flagged so
    // the view gives them their own color.
    function chartScaleNotes() {
        const intervals = parsedPatternEntries().map(entry => entry.interval);
        let min = state.expandRange ? -12 : 0;
        let max = state.expandRange ? 24 : 12;
        if (intervals.length) {
            min = Math.min(min, ...intervals);
            max = Math.max(max, ...intervals);
        }
        const contextList = [
            ...scaleIntervalsInRange(state.scaleType, -12, -1).slice(-3),
            ...scaleIntervalsInRange(state.scaleType, 13, 24).slice(0, 3)
        ];
        const contextIntervals = new Set(contextList);
        const lo = Math.min(min, ...contextList);
        const hi = Math.max(max, ...contextList);
        return scaleDegreeNotesInRange(state.root, state.octave, state.scaleType, lo, hi)
            .filter(note => (note.interval >= min && note.interval <= max) || contextIntervals.has(note.interval))
            .map(note => ({ ...note, context: contextIntervals.has(note.interval) }));
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

    // Rails, guide targets, and the window width depend only on the
    // settings and the pattern text. They are rebuilt when one of those
    // changes and simply read back on every animation frame - the frame
    // loop never re-parses the pattern or re-spells the scale.
    const chartModel = { rails: /** @type {any[]} */ ([]), targets: /** @type {any[]} */ ([]), windowMs: 8000 };

    function rebuildChartModel() {
        // Rail labels are the bare degree number; the view mirrors them
        // on the left and right chart edges.
        chartModel.rails = chartScaleNotes().map(note => ({
            midi: note.midi,
            label: String(note.degree),
            emphasized: !note.context && note.interval >= 0 && note.interval <= 12,
            context: note.context
        }));
        chartModel.targets = buildGuideTargets();
        // Window WIDTH is stable. Growing it with the clock continuously
        // squeezes the whole chart (the classic Trace twitch). The view
        // scrolls the playhead; this only picks 20s vs content-sized.
        const durationMs = chartModel.targets.length * state.guideIntervalMs;
        chartModel.windowMs = state.fixedWindow
            ? FIXED_WINDOW_MS
            : Math.max(8000, durationMs + 1000);
    }

    const view = PitchTraceView.create({
        canvasId: 'traceCanvas',
        defaultHeightPx: 430,
        railLabelsBothSides: true,
        rails: () => chartModel.rails,
        targets: () => chartModel.targets,
        history: () => session.history,
        clockMs: () => session.clockMs(),
        windowMs: () => chartModel.windowMs,
        fixedWindow: () => state.fixedWindow,
        showPlayhead: () => session.startedAt > 0
    });

    // Drawing is never throttled: the chart redraws every animation
    // frame so the scroll steps evenly (throttles are for readouts).
    // But identical frames are skipped: with the voice clock frozen and
    // no new samples, the picture cannot have changed.
    let lastDrawKey = '';

    function drawChart(force = false) {
        const key = `${session.history.length}|${session.clockMs() | 0}`;
        if (!force && key === lastDrawKey) return;
        lastDrawKey = key;
        view.draw();
    }
    function resizeCanvas() { view.resize(); }

    function resetTrace() {
        guidePlaybackToken++;
        session.reset();
        view.resetVerticalRange();
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
        rebuildChartModel();
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
        rebuildChartModel();
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
                rebuildChartModel();
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
            rebuildChartModel();
            drawChart(true);
        });
        PracticeControls.wireToggle('expandRangeToggle', state.expandRange, checked => {
            state.expandRange = checked;
            saveSettings();
            rebuildChartModel();
            drawChart(true);
        });
        window.addEventListener('resize', resizeCanvas);
        rebuildChartModel();
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
