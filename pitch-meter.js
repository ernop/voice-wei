// @ts-check
//-----------------------------------------------------------------------
// PITCH
// The Pitch tab. Listen is the page's first job: the microphone draws
// every sung note on a chromatic chart between the chosen Bottom and Top
// notes, nothing plays, and the scale finder ranks the keys the singing
// could be in. The scored exercises (call & response, play along) run
// on the same chart and session.
// Consumes pitch-detect-core (the one microphone owner), pitch-trace-view,
// pitch-score, scale-finder, piano-core, practice-controls,
// render-throttle, settings-store, and progress-store.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    /**
     * @typedef {{ midi: number, label: string, emphasized: boolean, context: boolean, labelPriority: number }} PitchRail
     * @typedef {{ midi: number, freq: number, name: string, noteName: string, octave: number }} TargetNote
     * @typedef {{ matched: boolean, accuracy: number, avgCents: number | null, biasCents: number | null, reason: string, label: string, midi: number }} NoteResult
     * @typedef {'call-response' | 'play-along'} ExerciseMode
     * @typedef {{
     *   mode: ExerciseMode,
     *   keyLabel: string,
     *   targets: TargetNote[],
     *   startedMic: boolean,
     *   startedAt: number,
     *   noteResults: NoteResult[],
     *   sampleStart: number | null
     * }} ExerciseRun
     */

    /** @type {readonly ExerciseMode[]} */
    const EXERCISE_MODES = Object.freeze(['call-response', 'play-along']);
    /** @type {Readonly<Record<string, number>>} The key octave each preset sets */
    const INSTRUMENT_OCTAVES = Object.freeze({ voice: 4, violin: 4, bass: 2 });
    // Stored in seconds; the choices are the shared time ladder (a match
    // window under half a second is unplayable, so it starts at 0.5s).
    const RESPONSE_TIME_VALUES = Object.freeze(PracticeControls.TIME_VALUES_MS
        .filter(ms => ms >= 500)
        .map(ms => ms / 1000));
    const WINDOW_VALUES_MS = PracticeControls.WINDOW_VALUES_MS;
    // The chart offers the notes the detector can hear plus a whole step
    // of room at each end; nothing outside the band is ever drawn.
    const CHART_MIN_MIDI = PitchDetectCore.VOICE_MIN_MIDI - 2;
    const CHART_MAX_MIDI = PitchDetectCore.VOICE_MAX_MIDI + 2;
    // With time stopped in silence, a pause still leaves this much room:
    // longer than the trace's line break, so phrases separate, and short
    // enough that pauses never scroll the singing away.
    const SILENCE_MARK_MS = 400;
    const ANALYSIS_INTERVAL_MS = 500;

    const state = {
        bottomMidi: 48, // C3
        topMidi: 72, // C5
        windowMs: 20000,
        timePassesInSilence: false,
        showScaleFinder: true,
        rootNote: 'C',
        octave: 4,
        scaleType: 'major',
        mode: 'call-response',
        responseTime: 2,
        instrument: 'voice'
    };
    const STORAGE_KEY = StorageKeys.PITCH_METER_SETTINGS;
    const PERSISTED_KEYS = [
        'bottomMidi', 'topMidi', 'windowMs', 'timePassesInSilence', 'showScaleFinder',
        'rootNote', 'octave', 'scaleType', 'mode', 'responseTime', 'instrument'
    ];

    const getEl = PracticeControls.getEl;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const readoutGate = new RateGate(50);
    const analysisGate = new RateGate(ANALYSIS_INTERVAL_MS);
    const readoutDiff = new ValueDiff();
    const finderDiff = new ValueDiff();

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let piano = null;
    /** @type {ExerciseRun | null} */
    let exercise = null;
    let previewToken = 0;
    /** @type {PitchRail[]} */
    let rails = [];
    /** @type {'#' | 'b'} */
    let keySpelling = '#';
    let segmenter = PitchScore.createSegmenter();
    let segmentedCount = 0;
    /** @type {HTMLElement[]} the 12 histogram columns, C first */
    const finderBars = [];

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function rootMidi() {
        return noteNameToMidi(state.rootNote, state.octave);
    }

    function setStatus(message) {
        PracticeControls.setValueText('status', message);
    }

    /** A note's name as the selected key spells it. @param {number} midi */
    function noteLabel(midi) {
        return scaleMidiToPitchString(state.rootNote, state.octave, state.scaleType, Math.round(midi), keySpelling);
    }

    /**
     * A pitch class's name as a given key spells it (no octave).
     * @param {number} pitchClass @param {string} rootName @param {string} scaleType
     */
    function pitchClassName(pitchClass, rootName, scaleType) {
        return scaleMidiToNoteName(rootName, 4, scaleType, 60 + pitchClass, scaleAccidentalPreference(rootName, scaleType));
    }

    /** @param {string} scaleType */
    function scaleMembers(scaleType) {
        return new Set(scalePattern(scaleType).map(step => positiveModulo(step, 12)));
    }

    // Every semitone from Bottom to Top gets a rail: the key's notes solid
    // with bold labels, its root in sky blue, the rest dashed. When rails
    // crowd, labels give way in reverse order of use for orientation: the
    // root's stay longest, then the fifth's, the third's, the other key
    // notes', and the out-of-key notes' go first.
    function rebuildRails() {
        const root = rootMidi();
        const members = scaleMembers(state.scaleType);
        const third = scaleThirdInterval(state.scaleType);
        rails = [];
        for (let midi = state.bottomMidi; midi <= state.topMidi; midi++) {
            const interval = positiveModulo(midi - root, 12);
            const inKey = members.has(interval);
            rails.push({
                midi,
                label: noteLabel(midi),
                emphasized: inKey,
                context: interval === 0,
                labelPriority: interval === 0 ? 0 : !inKey ? 4 : interval === 7 ? 1 : interval === third ? 2 : 3
            });
        }
    }

    function silenceAllowanceMs() {
        return state.timePassesInSilence ? Infinity : SILENCE_MARK_MS;
    }

    function verticalBounds() {
        return { minMidi: state.bottomMidi - 0.5, maxMidi: state.topMidi + 0.5 };
    }

    // One voice clock for both silence settings: the switch changes how
    // much of each pause counts (setMaxSilenceMs), so it applies mid-take
    // without restarting it.
    const session = PitchDetectCore.createTraceSession({
        pauseOnSilence: () => true,
        onAccepted: sample => updatePitchDisplay(sample.midi, sample.cents, sample.freq),
        onSilence: () => clearPitchDisplay(),
        onFrame: () => {
            drawChart();
            if (analysisGate.ready()) refreshAnalysis();
        }
    });

    const view = PitchTraceView.create({
        canvasId: 'pitchChart',
        defaultHeightPx: 360,
        // The newest singing is at the right edge once the chart scrolls,
        // so the note names are there too.
        railLabelsBothSides: true,
        rails: () => rails,
        targets: () => [],
        history: () => session.history,
        clockMs: () => session.clockMs(),
        windowMs: () => state.windowMs,
        verticalBounds,
        showPlayhead: () => session.listening
    });

    // Every animation frame redraws (an uneven cadence reads as twitching)
    // unless nothing can have changed: no new samples, same clock.
    let lastDrawKey = '';
    function drawChart(force = false) {
        const key = `${session.history.length}|${session.clockMs() | 0}`;
        if (!force && key === lastDrawKey) return;
        lastDrawKey = key;
        view.draw();
    }

    //-------READOUT-------

    /** @param {number} midi @param {number} cents @param {number} freq */
    function updatePitchDisplay(midi, cents, freq) {
        if (!readoutGate.ready()) return;
        const absCents = Math.abs(cents);
        const color = absCents < 10 ? '#4ade80' : absCents < 25 ? '#facc15' : '#f87171';
        const markerLeft = `${Math.max(0, Math.min(100, 50 + cents)).toFixed(1)}%`;
        readoutDiff.text('note', getEl('currentNote'), noteLabel(midi));
        readoutDiff.text('cents', getEl('currentCents'), `${formatCents(cents)} cents`);
        readoutDiff.text('freq', getEl('currentFreq'), `${freq.toFixed(1)} Hz`);
        readoutDiff.style('noteColor', getEl('currentNote'), 'color', color);
        readoutDiff.style('markerLeft', getEl('centsMarker'), 'left', markerLeft);
        readoutDiff.style('markerColor', getEl('centsMarker'), 'background', color);
    }

    function clearPitchDisplay() {
        readoutDiff.text('note', getEl('currentNote'), '--');
        readoutDiff.text('cents', getEl('currentCents'), '-- cents');
        readoutDiff.text('freq', getEl('currentFreq'), '-- Hz');
        readoutDiff.style('noteColor', getEl('currentNote'), 'color', '#fff');
        readoutDiff.style('markerLeft', getEl('centsMarker'), 'left', '50%');
        readoutDiff.style('markerColor', getEl('centsMarker'), 'background', '#fff');
    }

    //-------HELD NOTES AND THE SCALE FINDER-------

    /** Notes held since the last reset; each sample is segmented once. */
    function heldNotes() {
        const history = session.history;
        while (segmentedCount < history.length) segmenter.push(history[segmentedCount++]);
        return segmenter.segments().map(segment => ({
            midi: segment.midi,
            durationMs: segment.samples[segment.samples.length - 1].time - segment.samples[0].time
        }));
    }

    function refreshAnalysis() {
        const notes = heldNotes();
        const fitBtn = /** @type {HTMLButtonElement | null} */ (getEl('fitRangeBtn'));
        if (fitBtn) fitBtn.disabled = notes.length === 0;
        if (state.showScaleFinder) renderScaleFinder(ScaleFinder.rank(notes));
    }

    function buildFinderBars() {
        const host = getEl('scaleFinderBars');
        if (!host) return;
        for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
            const bar = document.createElement('div');
            bar.className = 'pitch-finder-bar';
            const track = document.createElement('span');
            track.className = 'pitch-finder-track';
            const fill = document.createElement('span');
            fill.className = 'pitch-finder-fill';
            track.append(fill);
            const name = document.createElement('span');
            name.className = 'pitch-finder-note';
            bar.append(track, name);
            host.append(bar);
            finderBars.push(bar);
        }
    }

    /**
     * Bars show each pitch class's share of the singing, colored and
     * spelled by the leading candidate (by the selected key until there is
     * one): its tonic sky blue like the chart's root rails, its other
     * notes green, notes outside it amber.
     * @param {ReturnType<typeof ScaleFinder.rank>} result
     */
    function renderScaleFinder(result) {
        const best = result.ready ? result.candidates[0] : null;
        const spellRoot = best ? NOTE_NAMES[best.root] : state.rootNote;
        const spellScale = best ? best.scaleType : state.scaleType;
        const tonic = best ? best.root : midiPitchClass(rootMidi());
        const members = scaleMembers(spellScale);
        const maxShare = Math.max(...result.pitchClasses.map(entry => entry.share));
        finderBars.forEach((bar, pitchClass) => {
            const entry = result.pitchClasses[pitchClass];
            const interval = positiveModulo(pitchClass - tonic, 12);
            const fill = /** @type {HTMLElement} */ (bar.querySelector('.pitch-finder-fill'));
            const height = maxShare > 0 ? Math.round(entry.share / maxShare * 100) : 0;
            finderDiff.style(`height${pitchClass}`, fill, 'height', `${height}%`);
            bar.classList.toggle('is-tonic', interval === 0);
            bar.classList.toggle('is-outside', !members.has(interval));
            finderDiff.text(`name${pitchClass}`, bar.querySelector('.pitch-finder-note'),
                pitchClassName(pitchClass, spellRoot, spellScale));
        });

        let summary = 'Sing a few notes';
        if (result.ready) {
            const tuning = Math.abs(result.tuningCents) >= 5 ? `, tuning ${formatCents(result.tuningCents)}c` : '';
            summary = `${result.noteCount} notes, ${Math.round(result.totalMs / 1000)}s${tuning}`;
        } else if (result.noteCount) {
            summary = `${result.noteCount} notes, ${result.distinctPitchClasses} different: needs `
                + `${ScaleFinder.MIN_HELD_NOTES} notes, ${ScaleFinder.MIN_DISTINCT_PITCH_CLASSES} different`;
        }
        finderDiff.text('summary', getEl('scaleFinderSummary'), summary);

        const list = getEl('scaleFinderList');
        const listKey = result.candidates
            .map(candidate => `${candidate.root}:${candidate.scaleType}:${Math.round(candidate.probability * 100)}:${candidate.outside.join('.')}`)
            .join('|') + `|${state.rootNote}:${state.scaleType}`;
        if (list && finderDiff.changed('list', listKey)) {
            list.replaceChildren(...result.candidates.map(candidateRow));
        }
    }

    /** @param {ReturnType<typeof ScaleFinder.rank>['candidates'][number]} candidate */
    function candidateRow(candidate) {
        const rootName = NOTE_NAMES[candidate.root];
        const row = document.createElement('li');
        row.className = 'pitch-finder-row';
        const percent = document.createElement('span');
        percent.className = 'pitch-finder-percent';
        percent.textContent = `${Math.round(candidate.probability * 100)}%`;
        const name = document.createElement('span');
        name.className = 'pitch-finder-name';
        name.textContent = candidate.name;
        const outside = document.createElement('span');
        outside.className = 'pitch-finder-outside';
        outside.textContent = candidate.outside.length
            ? `outside: ${candidate.outside.map(pitchClass => pitchClassName(pitchClass, rootName, candidate.scaleType)).join(' ')}`
            : '';
        const inUse = rootName === state.rootNote && candidate.scaleType === state.scaleType;
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'panel-action-btn';
        use.textContent = inUse ? 'In use' : 'Use';
        use.disabled = inUse;
        use.addEventListener('click', () => {
            state.rootNote = rootName;
            state.scaleType = candidate.scaleType;
            keyChanged();
        });
        row.append(percent, name, outside, use);
        return row;
    }

    //-------RANGE, KEY, AND SETTINGS-------

    /** @param {number} bottom @param {number} top */
    function setRange(bottom, top) {
        state.bottomMidi = bottom;
        state.topMidi = top;
        saveSettings();
        rebuildRails();
        syncControls();
        drawChart(true);
    }

    // One tap frames what was actually held (brief slides and scrapes
    // between notes do not stretch it), with a semitone of room.
    function fitRangeToSinging() {
        const midis = heldNotes().map(note => Math.round(note.midi));
        if (!midis.length) return;
        const bottom = Math.max(CHART_MIN_MIDI, Math.min(...midis) - 1);
        const top = Math.min(CHART_MAX_MIDI, Math.max(...midis) + 1);
        setRange(bottom, Math.max(top, bottom + 1));
    }

    /**
     * The exercise's notes must be on the chart: widen the frame (never
     * narrow it) to hold each target with a semitone of room.
     * @param {TargetNote[]} targets
     */
    function frameTargets(targets) {
        const low = Math.min(...targets.map(note => note.midi)) - 1;
        const high = Math.max(...targets.map(note => note.midi)) + 1;
        if (low >= state.bottomMidi && high <= state.topMidi) return;
        setRange(Math.max(CHART_MIN_MIDI, Math.min(state.bottomMidi, low)),
            Math.min(CHART_MAX_MIDI, Math.max(state.topMidi, high)));
    }

    function keyChanged() {
        keySpelling = scaleAccidentalPreference(state.rootNote, state.scaleType);
        saveSettings();
        rebuildRails();
        syncControls();
        refreshAnalysis();
        drawChart(true);
    }

    /** @param {number} midi */
    function setKeyFromMidi(midi) {
        const info = midiToNoteName(PracticeControls.clampRootMidi(midi));
        state.rootNote = info.name;
        state.octave = info.octave;
        keyChanged();
    }

    /** @param {string} key @param {number} delta */
    function stepSetting(key, delta) {
        if (key === 'bottomMidi') {
            const next = state.bottomMidi + delta;
            if (next >= CHART_MIN_MIDI && next < state.topMidi) setRange(next, state.topMidi);
            return;
        }
        if (key === 'topMidi') {
            const next = state.topMidi + delta;
            if (next <= CHART_MAX_MIDI && next > state.bottomMidi) setRange(state.bottomMidi, next);
            return;
        }
        if (key === 'rootPitch') {
            setKeyFromMidi(PracticeControls.stepRootMidi(rootMidi(), delta));
            return;
        }
        if (key === 'responseTime') {
            const next = PracticeControls.stepValue(RESPONSE_TIME_VALUES, state.responseTime, delta);
            if (next === null) return;
            state.responseTime = next;
            saveSettings();
            syncControls();
        }
    }

    // The Width slider walks the shared window list by index, so its
    // notches are evenly spaced and every one is a labeled value.
    function wireWidthSlider() {
        const slider = /** @type {HTMLInputElement | null} */ (getEl('widthSlider'));
        const scale = getEl('widthScale');
        if (!slider || !scale) return;
        const last = WINDOW_VALUES_MS.length - 1;
        slider.min = '0';
        slider.max = String(last);
        slider.step = '1';
        WINDOW_VALUES_MS.forEach((ms, index) => {
            const left = `${index / last * 100}%`;
            const notch = document.createElement('i');
            notch.style.left = left;
            const label = document.createElement('b');
            label.textContent = PracticeControls.formatSeconds(ms);
            label.style.left = left;
            if (index === 0) label.className = 'is-start';
            if (index === last) label.className = 'is-end';
            scale.append(notch, label);
        });
        slider.addEventListener('input', () => {
            state.windowMs = WINDOW_VALUES_MS[Number(slider.value)];
            saveSettings();
            syncControls();
            drawChart(true);
        });
    }

    function syncControls() {
        PracticeControls.syncSingleSelect('data-scale', state.scaleType);
        PracticeControls.syncSingleSelect('data-mode', state.mode);
        PracticeControls.syncSingleSelect('data-instrument', state.instrument);
        PracticeControls.setValueText('rootPitchValue', scaleRootPitchString(state.rootNote, state.octave));
        PracticeControls.setValueText('bottomValue', noteLabel(state.bottomMidi));
        PracticeControls.setValueText('topValue', noteLabel(state.topMidi));
        PracticeControls.setValueText('responseTimeValue', `${state.responseTime}s`);
        PracticeControls.setValueText('widthValue', PracticeControls.formatSeconds(state.windowMs));
        const slider = /** @type {HTMLInputElement | null} */ (getEl('widthSlider'));
        if (slider) slider.value = String(WINDOW_VALUES_MS.indexOf(state.windowMs));
        PracticeControls.syncToggle('timePassesToggle', state.timePassesInSilence);
        PracticeControls.syncToggle('scaleFinderToggle', state.showScaleFinder);
        const finderCard = getEl('scaleFinderCard');
        if (finderCard) finderCard.hidden = !state.showScaleFinder;
        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'bottomMidi') {
                return delta < 0 ? state.bottomMidi <= CHART_MIN_MIDI : state.bottomMidi + 1 >= state.topMidi;
            }
            if (key === 'topMidi') {
                return delta < 0 ? state.topMidi - 1 <= state.bottomMidi : state.topMidi >= CHART_MAX_MIDI;
            }
            if (key === 'responseTime') {
                return PracticeControls.stepDisabled(RESPONSE_TIME_VALUES, state.responseTime, delta);
            }
            return PracticeControls.rootStepDisabled(rootMidi(), delta);
        });

        const listenBtn = getEl('listenBtn');
        if (listenBtn) {
            listenBtn.textContent = session.listening ? 'Stop' : 'Listen';
            listenBtn.classList.toggle('listening', session.listening);
        }
        const exerciseBtn = /** @type {HTMLButtonElement | null} */ (getEl('exerciseBtn'));
        if (exerciseBtn) {
            exerciseBtn.disabled = !piano;
            exerciseBtn.textContent = exercise ? 'Stop exercise' : 'Start exercise';
        }
        const previewBtn = /** @type {HTMLButtonElement | null} */ (getEl('previewBtn'));
        if (previewBtn) previewBtn.disabled = !piano || exercise !== null;
    }

    //-------LISTENING-------

    /** @returns {Promise<boolean>} false when the microphone is unavailable */
    async function startListening() {
        stopPreview();
        const ok = await session.start();
        if (!ok) {
            setStatus('Microphone unavailable or access denied');
            syncControls();
            return false;
        }
        setStatus('Listening');
        syncControls();
        drawChart(true);
        return true;
    }

    function stopMic() {
        session.stop();
        clearPitchDisplay();
        syncControls();
        refreshAnalysis();
        drawChart(true);
    }

    function stopListening() {
        if (exercise) endExercise(exercise);
        else setStatus('Stopped');
        stopMic();
    }

    async function toggleListening() {
        if (session.listening) stopListening();
        else await startListening();
    }

    // Reset starts a fresh take: the chart, the held notes the finder
    // weighs, and any exercise in progress (abandoned without results).
    function resetTake() {
        if (exercise) {
            exercise = null;
            if (piano) piano.stopAll();
        }
        session.reset();
        segmenter = PitchScore.createSegmenter();
        segmentedCount = 0;
        clearPitchDisplay();
        const resultsPanel = getEl('resultsPanel');
        if (resultsPanel) resultsPanel.hidden = true;
        setStatus(session.listening ? 'Listening' : 'Press Listen and sing');
        syncControls();
        refreshAnalysis();
        drawChart(true);
    }

    //-------EXERCISES-------

    function targetNotes() {
        return buildScaleFrequencies(state.rootNote, state.octave, state.scaleType);
    }

    async function playPreview() {
        if (!piano) return;
        const token = ++previewToken;
        piano.stopAll();
        await PianoCore.ensureStarted();
        for (const note of targetNotes()) {
            if (token !== previewToken) return;
            piano.playMidi(note.midi, '4n');
            await sleep(500);
        }
    }

    function stopPreview() {
        previewToken++;
        if (piano) piano.stopAll();
    }

    async function toggleExercise() {
        if (exercise) finishExercise(exercise);
        else await startExercise();
    }

    // An exercise is a fresh take: it resets the chart like Reset, and
    // when it had to start the microphone it stops it again at the end.
    async function startExercise() {
        if (!piano) return;
        stopPreview();
        const startedMic = !session.listening;
        if (startedMic && !(await startListening())) return;
        resetTake();
        const targets = targetNotes();
        frameTargets(targets);
        /** @type {ExerciseRun} */
        const run = {
            mode: /** @type {ExerciseMode} */ (state.mode),
            keyLabel: `${state.rootNote}${state.octave} ${state.scaleType}`,
            targets,
            startedMic,
            startedAt: performance.now(),
            noteResults: [],
            sampleStart: null
        };
        exercise = run;
        syncControls();
        await PianoCore.ensureStarted();
        if (exercise !== run) return;
        if (run.mode === 'call-response') await runCallResponse(run);
        else await runPlayAlong(run);
    }

    /** @param {ExerciseRun} run */
    async function runCallResponse(run) {
        const total = run.targets.length;
        for (let index = 0; index < total; index++) {
            const note = run.targets[index];
            setStatus(`Note ${index + 1}/${total}: hear ${note.name}, then match it`);
            piano.playMidi(note.midi, '2n');
            await sleep(600);
            if (exercise !== run) return;
            setStatus(`Now sing ${note.name} (${state.responseTime}s)`);
            const windowStart = session.history.length;
            await sleep(state.responseTime * 1000);
            if (exercise !== run) return;
            const result = evaluateNoteMatch(note, session.history.slice(windowStart));
            run.noteResults.push(result);
            setStatus(result.matched ? `${note.name}: ${result.accuracy}% accurate` : `${note.name}: missed (${result.reason})`);
            await sleep(500);
            if (exercise !== run) return;
        }
        finishExercise(run);
    }

    /** @param {ExerciseRun} run */
    async function runPlayAlong(run) {
        setStatus('Get ready to sing along...');
        await sleep(1000);
        if (exercise !== run) return;
        run.sampleStart = session.history.length;
        for (const note of run.targets) {
            setStatus(`Sing: ${note.name}`);
            piano.playMidi(note.midi, '4n');
            await sleep(state.responseTime * 1000);
            if (exercise !== run) return;
        }
        finishExercise(run);
    }

    /** @param {ExerciseRun} run */
    function finishExercise(run) {
        endExercise(run);
        if (run.startedMic) stopMic();
    }

    /**
     * Stop the run's piano and report what was sung: per-note results for
     * call & response, the nearest-note breakdown for play along.
     * @param {ExerciseRun} run
     */
    function endExercise(run) {
        exercise = null;
        if (piano) piano.stopAll();
        if (run.mode === 'call-response' && run.noteResults.length) {
            showCallResponseResults(run);
        } else if (run.mode === 'play-along' && run.sampleStart !== null && session.history.length > run.sampleStart) {
            showPlayAlongResults(run, session.history.slice(run.sampleStart));
        } else {
            setStatus('Exercise stopped');
        }
        syncControls();
    }

    /**
     * @param {TargetNote} targetNote
     * @param {{ midi: number }[]} samples
     * @returns {NoteResult}
     */
    function evaluateNoteMatch(targetNote, samples) {
        const base = { label: targetNote.name, midi: targetNote.midi };
        const score = PitchScore.scoreWindow(samples, targetNote.midi);
        if (!score.attempted) {
            return { ...base, matched: false, reason: 'no sound detected', accuracy: 0, avgCents: null, biasCents: null };
        }
        if (!score.matched) {
            const sungNote = midiToNoteName(/** @type {number} */ (score.sungMidi)).full;
            return { ...base, matched: false, reason: `sang ${sungNote} instead`, accuracy: 0, avgCents: null, biasCents: score.biasCents };
        }
        // Reached the note: 'good'/'ok' count as a hit; a matched-but-loose
        // note (verdict 'missed') is reported with its sharp/flat direction.
        const hit = score.verdict === 'good' || score.verdict === 'ok';
        return {
            ...base,
            matched: hit,
            reason: hit ? '' : `${score.biasCents > 0 ? 'sharp' : 'flat'} by ${Math.round(score.avgCents)}c`,
            accuracy: score.accuracy,
            avgCents: score.avgCents,
            biasCents: score.biasCents
        };
    }

    /** @param {ExerciseRun} run */
    function showCallResponseResults(run) {
        const matched = run.noteResults.filter(result => result.matched);
        const total = run.noteResults.length;
        const accuracy = matched.length
            ? Math.round(matched.reduce((sum, result) => sum + result.accuracy, 0) / matched.length)
            : 0;
        const avgCents = matched.length
            ? matched.reduce((sum, result) => sum + /** @type {number} */ (result.avgCents), 0) / matched.length
            : null;
        renderResultsSummary(accuracy, avgCents, matched.length, total);
        recordProgress(run, matched.length, total, avgCents, accuracy, run.noteResults.map(result => ({
            label: result.label,
            midi: result.midi,
            result: /** @type {'good' | 'ok' | 'missed'} */ (
                result.matched ? PitchScore.verdictFor(/** @type {number} */ (result.avgCents)) : 'missed'),
            avgCents: result.avgCents,
            biasCents: result.biasCents
        })));
        renderNoteBreakdown('Per-note results', run.noteResults.map(result => {
            /** @type {'good' | 'ok' | 'poor' | 'missed'} */
            let status = 'missed';
            if (result.avgCents !== null) {
                const verdict = PitchScore.verdictFor(result.avgCents);
                status = verdict === 'missed' ? 'poor' : verdict;
            }
            return {
                name: result.label,
                status,
                deviation: result.matched ? `${result.accuracy}% (${Math.round(/** @type {number} */ (result.avgCents))} cents)` : result.reason
            };
        }));
        setStatus(`Done: ${matched.length}/${total} notes matched, ${accuracy}% average accuracy`);
    }

    /**
     * Play along has no per-note windows, so each sample goes to its
     * nearest target (within the note-identity band) and each target is
     * graded with the one shared correctness definition.
     * @param {ExerciseRun} run
     * @param {{ midi: number }[]} samples
     */
    function showPlayAlongResults(run, samples) {
        const identitySemitones = PitchScore.IDENTITY_CENTS / 100;
        /** @type {Map<number, { midi: number }[]>} */
        const samplesByTarget = new Map(run.targets.map(note => [note.midi, []]));
        for (const sample of samples) {
            let nearestMidi = run.targets[0].midi;
            for (const note of run.targets) {
                if (Math.abs(sample.midi - note.midi) < Math.abs(sample.midi - nearestMidi)) nearestMidi = note.midi;
            }
            if (Math.abs(sample.midi - nearestMidi) <= identitySemitones) {
                /** @type {{ midi: number }[]} */ (samplesByTarget.get(nearestMidi)).push(sample);
            }
        }
        const scored = run.targets.map(note => ({
            note,
            score: PitchScore.scoreWindow(samplesByTarget.get(note.midi) || [], note.midi)
        }));
        const sung = scored.filter(entry => entry.score.attempted);
        const hit = scored.filter(entry => entry.score.verdict === 'good' || entry.score.verdict === 'ok').length;
        const avgCents = sung.length ? sung.reduce((sum, entry) => sum + entry.score.avgCents, 0) / sung.length : null;
        const accuracy = sung.length ? sung.reduce((sum, entry) => sum + entry.score.accuracy, 0) / sung.length : 0;
        renderResultsSummary(accuracy, avgCents, hit, run.targets.length);
        recordProgress(run, hit, run.targets.length, avgCents, accuracy, scored.map(({ note, score }) => ({
            label: note.name,
            midi: note.midi,
            result: score.verdict,
            avgCents: score.attempted ? score.avgCents : null,
            biasCents: score.attempted ? score.biasCents : null
        })));
        renderNoteBreakdown('Per-note breakdown', scored.map(({ note, score }) => ({
            name: note.name,
            status: !score.attempted ? 'missed' : score.verdict === 'missed' ? 'poor' : score.verdict,
            deviation: score.attempted ? `${Math.round(score.avgCents)} cents avg` : 'not detected'
        })));
        setStatus(`Done: ${Math.round(accuracy)}% accuracy`);
    }

    /**
     * @param {number} accuracyPercent @param {number | null} avgCents
     * @param {number} notesHit @param {number} total
     */
    function renderResultsSummary(accuracyPercent, avgCents, notesHit, total) {
        const resultsPanel = getEl('resultsPanel');
        if (resultsPanel) resultsPanel.hidden = false;
        PracticeControls.setValueText('overallAccuracy', `${Math.round(accuracyPercent)}%`);
        PracticeControls.setValueText('avgDeviation', avgCents === null ? '-- cents' : `${avgCents.toFixed(1)} cents`);
        PracticeControls.setValueText('notesHit', `${notesHit}/${total}`);
        const accuracyEl = getEl('overallAccuracy');
        if (accuracyEl) {
            accuracyEl.style.color = accuracyPercent >= 80 ? '#4ade80' : accuracyPercent >= 60 ? '#facc15' : '#f87171';
        }
    }

    /**
     * @param {string} title
     * @param {{ name: string, status: 'good' | 'ok' | 'poor' | 'missed', deviation: string }[]} items
     */
    function renderNoteBreakdown(title, items) {
        const breakdown = getEl('noteBreakdown');
        if (!breakdown) return;
        const marks = { good: String.fromCharCode(10003), ok: '~', poor: '!', missed: 'x' };
        const heading = document.createElement('h4');
        heading.textContent = title;
        breakdown.replaceChildren(heading, ...items.map(item => {
            const row = document.createElement('div');
            row.className = 'note-result';
            const name = document.createElement('span');
            name.className = 'note-name';
            name.textContent = item.name;
            const status = document.createElement('span');
            status.className = `note-status note-${item.status}`;
            status.textContent = marks[item.status];
            const deviation = document.createElement('span');
            deviation.className = 'note-deviation';
            deviation.textContent = item.deviation;
            row.append(name, status, deviation);
            return row;
        }));
    }

    /**
     * Persist a finished exercise and refresh the trend lines.
     * @param {ExerciseRun} run
     * @param {number} hit @param {number} total @param {number | null} avgCents
     * @param {number} accuracyPercent - the results panel's headline accuracy
     * @param {ProgressNoteResult[]} notes
     */
    function recordProgress(run, hit, total, avgCents, accuracyPercent, notes) {
        if (total === 0) return;
        ProgressStore.record({
            tool: 'pitch-meter',
            context: `${run.mode} ${run.keyLabel}`,
            total,
            hit,
            avgCents,
            notes
        });
        PracticeControls.setValueText('progressSummary', ProgressStore.trendLine('pitch-meter'));
        PracticeControls.setValueText('weakSpotsSummary', ProgressStore.weakSpotLine('pitch-meter'));
        try {
            if (window.FusekiStats) window.FusekiStats.game({
                m: `pitch-${run.mode}`,
                r: 'done',
                d: (performance.now() - run.startedAt) / 1000,
                hit,
                total,
                cents: avgCents,
                acc: Math.round(accuracyPercent)
            });
        } catch (error) {
            // Statistics must never break the app (owner, 2026-10-11).
        }
    }

    //-------BOOT-------

    function initUI() {
        PracticeControls.wireSteppers(stepSetting);
        PracticeControls.wireSingleSelect('data-scale', String, state.scaleType, value => {
            state.scaleType = value;
            keyChanged();
        });
        PracticeControls.wireSingleSelect('data-mode', String, state.mode, value => {
            state.mode = value;
            saveSettings();
            syncControls();
        });
        PracticeControls.wireSingleSelect('data-instrument', String, state.instrument, value => {
            state.instrument = value;
            state.octave = INSTRUMENT_OCTAVES[value];
            keyChanged();
        });
        PracticeControls.wireToggle('timePassesToggle', state.timePassesInSilence, checked => {
            state.timePassesInSilence = checked;
            session.setMaxSilenceMs(silenceAllowanceMs());
            saveSettings();
            drawChart(true);
        });
        PracticeControls.wireToggle('scaleFinderToggle', state.showScaleFinder, checked => {
            state.showScaleFinder = checked;
            saveSettings();
            syncControls();
            refreshAnalysis();
        });
        wireWidthSlider();
        buildFinderBars();
        getEl('listenBtn')?.addEventListener('click', toggleListening);
        getEl('resetBtn')?.addEventListener('click', resetTake);
        getEl('fitRangeBtn')?.addEventListener('click', fitRangeToSinging);
        getEl('exerciseBtn')?.addEventListener('click', toggleExercise);
        getEl('previewBtn')?.addEventListener('click', playPreview);
        window.addEventListener('resize', () => view.resize());

        keySpelling = scaleAccidentalPreference(state.rootNote, state.scaleType);
        session.setMaxSilenceMs(silenceAllowanceMs());
        rebuildRails();
        syncControls();
        view.resize();
        refreshAnalysis();
        setStatus('Press Listen and sing');
    }

    async function boot() {
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
        // The retired free-practice mode ('free') may still be stored.
        if (!EXERCISE_MODES.includes(/** @type {ExerciseMode} */ (state.mode))) state.mode = EXERCISE_MODES[0];
        initUI();
        // Named state inspection for the test suite, plus the explicit
        // sample seam (the pitch test panel's recordSample pattern).
        window.pitchDebug = {
            settings: () => ({ ...state }),
            rails: () => rails,
            verticalBounds,
            silenceAllowanceMs,
            history: () => session.history,
            clockMs: () => session.clockMs(),
            listening: () => session.listening,
            finder: () => ScaleFinder.rank(heldNotes()),
            pianoReady: () => piano !== null,
            exerciseRunning: () => exercise !== null,
            recordSample(midi, timeMs) {
                session.record({ time: timeMs, midi, freq: midiToFreq(midi), cents: 0, note: '' });
                refreshAnalysis();
                drawChart(true);
            }
        };
        try {
            piano = await PianoCore.createPiano();
        } catch (err) {
            // Listen needs no piano; only the exercises and the preview do.
            console.error('Error loading piano samples:', err);
            setStatus('Piano failed to load: exercises are off until a reload. Listen still works.');
        }
        syncControls();
    }

    boot();
})();
