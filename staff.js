// @ts-check
//-----------------------------------------------------------------------
// STAFF
// Continuous grand-staff sight singing: a long generated line of metered
// notes on one treble+bass system. Page mode shows the whole sheet to
// sing at your own pace; scroll mode moves the staff right-to-left past
// a fixed now-line while the microphone trace shows where you sang.
// Consumes pattern-practice-core, staff-scroll-view, piano-core,
// pitch-detect-core, practice-controls, settings-store,
// media-session-core.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const LEAD_IN_BEATS = 4;
    const EXTEND_AHEAD_BEATS = 24;
    const EXTEND_CHUNK_BEATS = 32;
    const SESSION_CAP = 20;
    const SESSIONS_WITH_TRACE = 8;
    const TRACE_SAMPLE_MIN_MS = 50;
    const TRACE_SAMPLE_CAP = 6000;
    // A run shorter than this is a false start, not a reviewable session.
    const SESSION_MIN_BEATS = 4;

    const state = {
        root: 'C',
        octave: 3,
        scaleType: 'major',
        phraseStyle: 'free',
        phraseLesson: 'free_open',
        phraseAlgo: 'arch',
        startAtOne: true,
        rangeLow: 0,
        rangeHigh: 11,
        accidentalRate: 0,
        minLength: 5,
        maxLength: 8,
        returnToInitial: true,
        returnToRoot: false,
        bpm: 60,
        restBeats: 2,
        measures: 16,
        durationBeats: [1, 2],
        pxPerBeat: 26,
        nowFraction: 0.3,
        staffWidthPct: 100,
        hearTones: true,
        mode: 'page'
    };

    const STORAGE_KEY = StorageKeys.STAFF_SETTINGS;
    const PERSISTED_KEYS = [
        'root', 'octave', 'scaleType', 'phraseStyle', 'phraseLesson', 'phraseAlgo',
        'startAtOne', 'rangeLow', 'rangeHigh', 'accidentalRate', 'minLength', 'maxLength',
        'returnToInitial', 'bpm', 'restBeats', 'measures', 'durationBeats',
        'pxPerBeat', 'nowFraction', 'staffWidthPct', 'hearTones', 'mode'
    ];

    const ADJUSTER_VALUES = {
        bpm: [20, 24, 30, 36, 42, 48, 54, 60, 66, 72, 80, 90, 100, 110, 120, 132, 144, 160, 180, 200],
        restBeats: [0, 0.5, 1, 2, 3, 4],
        measures: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128],
        accidentalRate: [0, 0.05, 0.1, 0.15, 0.25, 0.35],
        minLength: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16],
        maxLength: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32],
        pxPerBeat: [14, 18, 22, 26, 32, 40, 48],
        nowFraction: [0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
        staffWidthPct: [55, 70, 85, 100]
    };
    const DEFAULT_LESSON_BY_STYLE = Object.freeze({
        free: 'free_open',
        staff: 'staff_steps',
        sight: 'sight_pentachord',
        barbershop: 'barber_tonic',
        genre: 'genre_folk_hymn'
    });

    const getEl = PracticeControls.getEl;

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let piano = null;
    /** @type {ReturnType<typeof PatternPracticeCore.createContinuousSequence> | null} */
    let sequence = null;
    /** @type {TimedSequenceEvent[]} */
    let timedEvents = [];
    /** @type {StaffTraceSample[]} */
    let traceSamples = [];
    /** Trace loaded from a saved session for review (page mode). */
    let reviewingSession = false;

    let running = false;
    let clockBeat = -LEAD_IN_BEATS;
    let lastFrameWall = 0;
    let firedIndex = 0;
    let firedNoteCount = 0;
    /** @type {number | null} */
    let animationId = null;
    let lastTracePushWall = 0;
    /** @type {{ midi: number, wall: number } | null} */
    let lastAcceptedLive = null;

    const readoutGate = new RateGate(60);
    const textDiff = new ValueDiff();

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function rootMidi() { return noteNameToMidi(state.root, state.octave); }

    function msPerBeat() { return 60000 / state.bpm; }

    function keyContext() {
        return {
            rootMidi: rootMidi() ?? 60,
            rootLabel: scaleRootPitchString(state.root, state.octave),
            scaleType: state.scaleType
        };
    }

    function generationOptions() {
        return {
            scaleType: state.scaleType,
            phraseStyle: state.phraseStyle,
            phraseLesson: state.phraseLesson,
            phraseAlgo: state.phraseAlgo,
            startAtOne: state.startAtOne,
            rangeLow: state.rangeLow,
            rangeHigh: state.rangeHigh,
            minLength: state.minLength,
            maxLength: state.maxLength,
            returnToInitial: state.returnToInitial,
            returnToRoot: state.returnToRoot,
            accidentalRate: state.accidentalRate,
            durationBeats: state.durationBeats.slice(),
            restBeats: state.restBeats
        };
    }

    /**
     * The one derivation: timed events zipped with their key projection.
     * Memoized because the frame loop reads it continuously.
     * @type {StaffStreamEvent[]}
     */
    let streamCache = [];
    let streamCacheKey = '';

    function streamEvents() {
        const cacheKey = `${state.root}|${state.octave}|${state.scaleType}|${timedEvents.length}`;
        if (cacheKey !== streamCacheKey) {
            streamCacheKey = cacheKey;
            streamCache = computeStreamEvents();
        }
        return streamCache;
    }

    /** @returns {StaffStreamEvent[]} */
    function computeStreamEvents() {
        const root = rootMidi();
        if (root === null || !timedEvents.length) return [];
        const noteEvents = timedEvents.filter(event => event.type === 'note');
        const notes = PatternPracticeCore.buildSequenceNotes(
            noteEvents.map(event => /** @type {number} */(event.offset)), root, state.scaleType);
        let noteIndex = 0;
        return timedEvents.map(event => {
            if (event.type !== 'note') return { ...event };
            const note = notes[noteIndex++];
            return { ...event, midi: note.midi, degree: note.degree, noteName: note.noteName };
        });
    }

    function totalBeats() {
        if (!timedEvents.length) return 0;
        const last = timedEvents[timedEvents.length - 1];
        return last.startBeat + last.beats;
    }

    const traceSession = PitchDetectCore.createTraceSession({
        pauseOnSilence: () => false,
        onAccepted: sample => {
            lastAcceptedLive = { midi: sample.midi, wall: performance.now() };
            updatePitchReadout(sample.note, sample.cents, sample.freq);
            if (running) {
                const now = performance.now();
                if (now - lastTracePushWall >= TRACE_SAMPLE_MIN_MS && traceSamples.length < TRACE_SAMPLE_CAP) {
                    lastTracePushWall = now;
                    traceSamples.push({
                        beat: Math.round(clockBeat * 1000) / 1000,
                        midi: Math.round(sample.midi * 100) / 100
                    });
                }
            }
        },
        onSilence: () => {
            if (lastAcceptedLive && performance.now() - lastAcceptedLive.wall > 400) {
                lastAcceptedLive = null;
                clearPitchReadout();
            }
        },
        onFrame: () => {
            // Page-mode listening has no scroll loop; drive the overlay here.
            if (!running) view.frame();
        },
        frameCallbackIntervalMs: 40
    });

    const view = StaffScrollView.create({
        hostId: 'staffHost',
        key: keyContext,
        events: streamEvents,
        pxPerBeat: () => state.pxPerBeat,
        nowFraction: () => state.nowFraction,
        mode: () => /** @type {'page' | 'scroll'} */ (state.mode),
        clockBeat: () => clockBeat,
        trace: () => traceSamples,
        traceGapBeats: () => 320 / msPerBeat(),
        liveMidi: () => {
            if (!lastAcceptedLive) return null;
            if (performance.now() - lastAcceptedLive.wall > 350) return null;
            return lastAcceptedLive.midi;
        }
    });

    /** @param {string} note @param {number} cents @param {number} freq */
    function updatePitchReadout(note, cents, freq) {
        if (!readoutGate.ready()) return;
        textDiff.text('pitchReadout', getEl('pitchReadout'), `Pitch: ${note} ${freq.toFixed(1)} Hz ${formatCents(cents)}c`);
    }

    function clearPitchReadout() {
        textDiff.text('pitchReadout', getEl('pitchReadout'), 'Pitch: --');
    }

    /** @param {string} message */
    function setStatus(message) {
        textDiff.text('statusReadout', getEl('statusReadout'), message);
    }

    //-------------------------------------------------------------------
    // Generation
    //-------------------------------------------------------------------

    function regenerate() {
        stopRun({ save: false });
        reviewingSession = false;
        traceSamples = [];
        sequence = PatternPracticeCore.createContinuousSequence(generationOptions());
        timedEvents = sequence.nextEvents(state.measures * 4);
        streamCacheKey = '';
        view.render();
        setStatus(`${timedEvents.filter(event => event.type === 'note').length} notes over ${Math.ceil(totalBeats() / 4)} bars`);
    }

    /** Scroll mode keeps generating ahead of the now-line. */
    function extendIfNeeded() {
        if (state.mode !== 'scroll') return;
        if (clockBeat < totalBeats() - EXTEND_AHEAD_BEATS) return;
        if (!sequence) {
            // Continuing past a loaded session: resume at the next barline.
            const resumeBeat = Math.ceil(totalBeats() / 4) * 4;
            sequence = PatternPracticeCore.createContinuousSequence(
                { ...generationOptions(), startBeat: resumeBeat });
        }
        timedEvents = timedEvents.concat(sequence.nextEvents(EXTEND_CHUNK_BEATS));
        streamCacheKey = '';
        view.render();
    }

    //-------------------------------------------------------------------
    // Scroll transport
    //-------------------------------------------------------------------

    function frameLoop() {
        animationId = null;
        if (running) {
            const now = performance.now();
            clockBeat += (now - lastFrameWall) / msPerBeat();
            lastFrameWall = now;
            fireDueNotes();
            extendIfNeeded();
        }
        view.frame();
        if (running) {
            animationId = requestAnimationFrame(frameLoop);
        }
    }

    function fireDueNotes() {
        const events = streamEvents();
        while (firedIndex < events.length && events[firedIndex].startBeat <= clockBeat) {
            const event = events[firedIndex];
            firedIndex++;
            if (event.type !== 'note' || typeof event.midi !== 'number') continue;
            firedNoteCount++;
            if (state.hearTones && piano) {
                piano.playMidi(event.midi, (event.beats * msPerBeat() / 1000) * 0.92);
            }
        }
    }

    function syncFiredIndex() {
        const events = streamEvents();
        firedIndex = 0;
        while (firedIndex < events.length && events[firedIndex].startBeat <= clockBeat) firedIndex++;
    }

    async function startRun() {
        if (running) {
            pauseRun();
            return;
        }
        if (!timedEvents.length) regenerate();
        if (state.mode !== 'scroll') setMode('scroll');
        try {
            await PianoCore.ensureStarted();
        } catch (_err) {
            // Tones stay silent; the moving staff still runs.
        }
        if (reviewingSession) {
            // Re-running a loaded sheet: the old trace makes way for a new take.
            traceSamples = [];
            reviewingSession = false;
        }
        running = true;
        lastFrameWall = performance.now();
        syncFiredIndex();
        syncTransportButtons();
        MediaSessionCore.setPlaybackState('playing');
        setStatus('Scrolling');
        if (animationId === null) animationId = requestAnimationFrame(frameLoop);
    }

    function pauseRun() {
        running = false;
        if (piano) piano.stopAll();
        syncTransportButtons();
        MediaSessionCore.setPlaybackState('paused');
        setStatus('Paused');
        view.frame();
    }

    /** @param {{ save: boolean }} options */
    function stopRun(options) {
        const traversed = clockBeat;
        running = false;
        if (animationId !== null) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        if (piano) piano.stopAll();
        if (options.save && traversed >= SESSION_MIN_BEATS) {
            saveSession(traversed);
        }
        clockBeat = -LEAD_IN_BEATS;
        firedIndex = 0;
        syncTransportButtons();
        MediaSessionCore.setPlaybackState('paused');
        view.frame();
    }

    function syncTransportButtons() {
        const startBtn = getEl('startBtn');
        if (startBtn) {
            const text = startBtn.querySelector('.button-text');
            if (text) text.textContent = running ? 'Pause' : 'Start';
        }
    }

    //-------------------------------------------------------------------
    // Sessions: every real run is kept for later review
    //-------------------------------------------------------------------

    /** @returns {any[]} */
    function loadSessions() {
        return SettingsStore.loadJson(StorageKeys.STAFF_SESSIONS, [], Array.isArray);
    }

    /** @param {any[]} sessions */
    function persistSessions(sessions) {
        SettingsStore.saveJson(StorageKeys.STAFF_SESSIONS, sessions);
    }

    /** @param {number} traversedBeat */
    function saveSession(traversedBeat) {
        const endBeat = traversedBeat + 8;
        const session = {
            id: `run-${Date.now()}`,
            createdAt: new Date().toISOString(),
            root: state.root,
            octave: state.octave,
            scaleType: state.scaleType,
            bpm: state.bpm,
            phraseStyle: state.phraseStyle,
            phraseLesson: state.phraseLesson,
            phraseAlgo: state.phraseAlgo,
            events: timedEvents.filter(event => event.startBeat < endBeat),
            trace: traceSamples.slice()
        };
        const sessions = [session, ...loadSessions()].slice(0, SESSION_CAP);
        // Old traces are the bulky part; keep them only on recent runs.
        sessions.forEach((entry, index) => {
            if (index >= SESSIONS_WITH_TRACE) entry.trace = [];
        });
        persistSessions(sessions);
        renderSessionList();
        setStatus(`Run saved (${Math.floor(traversedBeat / 4)} bars sung)`);
    }

    /** @param {any} session */
    function loadSession(session) {
        stopRun({ save: false });
        state.root = session.root;
        state.octave = session.octave;
        state.scaleType = session.scaleType;
        state.bpm = session.bpm;
        setMode('page');
        timedEvents = Array.isArray(session.events) ? session.events : [];
        traceSamples = Array.isArray(session.trace) ? session.trace : [];
        reviewingSession = true;
        sequence = null;
        streamCacheKey = '';
        saveSettings();
        syncAllControls();
        view.render();
        const when = new Date(session.createdAt).toLocaleString();
        setStatus(`Reviewing run from ${when}${traceSamples.length ? ' (sung trace shown)' : ''}`);
    }

    function renderSessionList() {
        const list = getEl('sessionList');
        if (!list) return;
        const sessions = loadSessions();
        list.textContent = '';
        if (!sessions.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'No saved runs yet';
            list.appendChild(empty);
            return;
        }
        sessions.forEach(session => {
            const item = document.createElement('div');
            item.className = 'history-item';
            const line = document.createElement('div');
            line.className = 'staff-session-line';
            const title = document.createElement('span');
            title.className = 'staff-session-title';
            const key = scaleRootPitchString(session.root, session.octave);
            const bars = session.events && session.events.length
                ? Math.ceil((session.events[session.events.length - 1].startBeat
                    + session.events[session.events.length - 1].beats) / 4)
                : 0;
            title.textContent = `${key} ${String(session.scaleType).replace(/_/g, ' ')} - ${session.phraseStyle} - ${bars} bars @ ${session.bpm}bpm`;
            const detail = document.createElement('span');
            detail.className = 'staff-session-detail';
            const when = new Date(session.createdAt);
            detail.textContent = `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${session.trace && session.trace.length ? ' · sung' : ''}`;
            const loadBtn = document.createElement('button');
            loadBtn.type = 'button';
            loadBtn.className = 'vf-btn';
            loadBtn.textContent = 'Load';
            loadBtn.addEventListener('click', () => loadSession(session));
            line.appendChild(title);
            line.appendChild(detail);
            line.appendChild(loadBtn);
            item.appendChild(line);
            list.appendChild(item);
        });
    }

    //-------------------------------------------------------------------
    // Listening
    //-------------------------------------------------------------------

    async function toggleListening() {
        if (traceSession.listening) {
            traceSession.stop();
            lastAcceptedLive = null;
            clearPitchReadout();
            syncListenButton();
            view.frame();
            return;
        }
        traceSession.reset();
        const ok = await traceSession.start();
        if (!ok) {
            setStatus('Microphone unavailable or denied');
            return;
        }
        setStatus('Listening');
        syncListenButton();
    }

    function syncListenButton() {
        const btn = getEl('listenBtn');
        if (!btn) return;
        btn.classList.toggle('listening', traceSession.listening);
        btn.setAttribute('aria-pressed', String(traceSession.listening));
    }

    //-------------------------------------------------------------------
    // Controls
    //-------------------------------------------------------------------

    /** @param {'page' | 'scroll'} mode */
    function setMode(mode) {
        if (state.mode === mode) return;
        if (running) pauseRun();
        state.mode = mode;
        PracticeControls.syncSingleSelect('data-staff-mode', mode);
        saveSettings();
        view.render();
    }

    /** @param {number} offset */
    function rangeEndpointLabel(offset) {
        return PatternPracticeCore.offsetToDegree(
            offset, PatternPracticeCore.degreesPerOctave(state.scaleType));
    }

    /**
     * @param {'rangeLow' | 'rangeHigh'} key @param {number} delta
     */
    function steppedRangeValue(key, delta) {
        const { lowMin, highMax } = PatternPracticeCore.phraseRangeLimits(state.scaleType);
        const next = state[key] + delta;
        if (key === 'rangeLow') {
            return (next >= lowMin && next < state.rangeHigh) ? next : null;
        }
        return (next > state.rangeLow && next <= highMax) ? next : null;
    }

    function formatRestBeats(beats) {
        if (beats === 0) return 'none';
        if (beats === 0.5) return '\u00bd beat';
        return `${beats} beat${beats === 1 ? '' : 's'}`;
    }

    function syncAdjusterControls() {
        PracticeControls.setValueText('rootPitchValue', scaleRootPitchString(state.root, state.octave));
        PracticeControls.setValueText('bpmValue', String(state.bpm));
        PracticeControls.setValueText('restBeatsValue', formatRestBeats(state.restBeats));
        PracticeControls.setValueText('measuresValue', String(state.measures));
        PracticeControls.setValueText('minLengthValue', String(state.minLength));
        PracticeControls.setValueText('maxLengthValue', String(state.maxLength));
        PracticeControls.setValueText('accidentalRateValue', `${Math.round(state.accidentalRate * 100)}%`);
        PracticeControls.setValueText('pxPerBeatValue', `${state.pxPerBeat}px`);
        PracticeControls.setValueText('nowFractionValue', `${Math.round(state.nowFraction * 100)}%`);
        PracticeControls.setValueText('staffWidthPctValue', `${state.staffWidthPct}%`);
        PracticeControls.setValueText('rangeLowValue', rangeEndpointLabel(state.rangeLow));
        PracticeControls.setValueText('rangeHighValue', rangeEndpointLabel(state.rangeHigh));

        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(rootMidi(), delta);
            }
            if (key === 'rangeLow' || key === 'rangeHigh') {
                return steppedRangeValue(/** @type {'rangeLow' | 'rangeHigh'} */(key), delta) === null;
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });
    }

    function applyStaffWidth() {
        const host = getEl('staffHost');
        if (host) host.style.setProperty('--staff-width', `${state.staffWidthPct}%`);
    }

    function normalizeLengthBounds(key) {
        if (state.minLength > state.maxLength) {
            if (key === 'maxLength') state.minLength = state.maxLength;
            else state.maxLength = state.minLength;
        }
    }

    // Setting-change vocabulary (docs/parameters.md): generation shape
    // settings are bounds-next (they apply from the next Next / the next
    // generated extension); key settings reproject the current sheet;
    // display settings redraw immediately; bpm applies live.
    const REPROJECT_KEYS = new Set(['root', 'octave', 'scaleType']);
    const REDRAW_KEYS = new Set(['pxPerBeat', 'nowFraction', 'staffWidthPct']);
    const GENERATION_KEYS = new Set([
        'phraseStyle', 'phraseLesson', 'phraseAlgo', 'startAtOne', 'rangeLow', 'rangeHigh',
        'accidentalRate', 'minLength', 'maxLength', 'returnToInitial', 'durationBeats', 'restBeats'
    ]);

    /** @param {string} key */
    function onSettingChanged(key) {
        saveSettings();
        if (REPROJECT_KEYS.has(key)) {
            streamCacheKey = '';
            if (key === 'scaleType') syncAdjusterControls();
            view.render();
            return;
        }
        if (REDRAW_KEYS.has(key)) {
            applyStaffWidth();
            view.render();
            view.resize();
            return;
        }
        if (GENERATION_KEYS.has(key)) {
            // The running generator holds its creation options; a fresh
            // one continues from the same beat cursor with the new shape.
            if (sequence) {
                sequence = PatternPracticeCore.createContinuousSequence(
                    { ...generationOptions(), startBeat: Math.ceil(totalBeats() / 4) * 4 });
            }
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
        if (key === 'rangeLow' || key === 'rangeHigh') {
            const next = steppedRangeValue(/** @type {'rangeLow' | 'rangeHigh'} */(key), delta);
            if (next !== null) setAdjusterValue(key, next);
            return;
        }
        const next = PracticeControls.stepValue(ADJUSTER_VALUES[key] || [], state[key], delta);
        if (next !== null) setAdjusterValue(key, next);
    }

    /** @param {number} beats */
    function toggleDuration(beats) {
        const selected = state.durationBeats.includes(beats);
        if (selected && state.durationBeats.length === 1) return; // at least one value
        state.durationBeats = selected
            ? state.durationBeats.filter(value => value !== beats)
            : [...state.durationBeats, beats].sort((a, b) => a - b);
        syncDurationChips();
        onSettingChanged('durationBeats');
    }

    function syncDurationChips() {
        PracticeControls.syncMultiSelect('.staff-duration-row .vf-btn', 'data-duration-beats',
            value => state.durationBeats.includes(Number(value)));
    }

    /**
     * @param {string} id @param {boolean} on
     * @param {string} onLabel @param {string} offLabel
     */
    function syncBooleanPill(id, on, onLabel, offLabel) {
        const btn = getEl(id);
        if (!btn) return;
        btn.classList.toggle('selected', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.textContent = on ? onLabel : offLabel;
    }

    function syncLessonControls() {
        PracticeControls.syncSingleSelect('data-phrase-style', state.phraseStyle);
        PracticeControls.syncSingleSelect('data-phrase-lesson', state.phraseLesson);
        document.querySelectorAll('[data-lesson-family]').forEach(el => {
            const row = /** @type {HTMLElement} */ (el);
            row.hidden = row.dataset.lessonFamily !== state.phraseStyle;
        });
    }

    /** @param {string} style */
    function setPhraseStyle(style) {
        state.phraseStyle = style;
        state.phraseLesson = DEFAULT_LESSON_BY_STYLE[style] || 'free_open';
        syncLessonControls();
        onSettingChanged('phraseStyle');
    }

    /** @param {string} lesson */
    function setPhraseLesson(lesson) {
        state.phraseLesson = lesson;
        syncLessonControls();
        onSettingChanged('phraseLesson');
    }

    function syncAllControls() {
        PracticeControls.syncSingleSelect('data-scale', state.scaleType);
        PracticeControls.syncSingleSelect('data-phrase-algo', state.phraseAlgo);
        PracticeControls.syncSingleSelect('data-staff-mode', state.mode);
        syncBooleanPill('startAnchorBtn', state.startAtOne, 'start at 1', 'random start');
        syncBooleanPill('returnAnchorBtn', state.returnToInitial, 'return to 1', 'no return');
        PracticeControls.syncToggle('hearTonesToggle', state.hearTones);
        syncDurationChips();
        syncLessonControls();
        syncAdjusterControls();
        applyStaffWidth();
    }

    function wireSetting(attr, stateKey, parse) {
        PracticeControls.wireSingleSelect(attr, parse, state[stateKey], value => {
            state[stateKey] = value;
            onSettingChanged(stateKey);
        });
    }

    function initUI() {
        wireSetting('data-scale', 'scaleType', String);
        wireSetting('data-phrase-algo', 'phraseAlgo', String);
        PracticeControls.wireSingleSelect('data-phrase-style', String, state.phraseStyle, setPhraseStyle);
        PracticeControls.wireSingleSelect('data-phrase-lesson', String, state.phraseLesson, setPhraseLesson);
        PracticeControls.wireSingleSelect('data-staff-mode', String, state.mode,
            mode => setMode(/** @type {'page' | 'scroll'} */(mode)));
        PracticeControls.wireMultiSelect('.staff-duration-row .vf-btn', 'data-duration-beats',
            value => toggleDuration(Number(value)));
        PracticeControls.wireSteppers(stepAdjusterValue);
        PracticeControls.wireToggle('hearTonesToggle', state.hearTones, checked => {
            state.hearTones = checked;
            onSettingChanged('hearTones');
        });
        getEl('startAnchorBtn')?.addEventListener('click', () => {
            state.startAtOne = !state.startAtOne;
            syncBooleanPill('startAnchorBtn', state.startAtOne, 'start at 1', 'random start');
            onSettingChanged('startAtOne');
        });
        getEl('returnAnchorBtn')?.addEventListener('click', () => {
            state.returnToInitial = !state.returnToInitial;
            syncBooleanPill('returnAnchorBtn', state.returnToInitial, 'return to 1', 'no return');
            onSettingChanged('returnToInitial');
        });
        getEl('startBtn')?.addEventListener('click', () => { startRun(); });
        getEl('stopBtn')?.addEventListener('click', () => { stopRun({ save: true }); });
        getEl('nextBtn')?.addEventListener('click', () => { regenerate(); });
        getEl('listenBtn')?.addEventListener('click', () => { toggleListening(); });
        getEl('clearSessionsBtn')?.addEventListener('click', () => {
            persistSessions([]);
            renderSessionList();
        });
        window.addEventListener('resize', () => view.resize());

        syncAllControls();
        syncTransportButtons();
        renderSessionList();
        MediaSessionCore.register('Staff', [
            ['play', () => { startRun(); }],
            ['pause', () => { if (running) pauseRun(); }],
            ['nexttrack', () => { regenerate(); }]
        ]);
        MediaSessionCore.setPlaybackState('paused');
    }

    async function boot() {
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
        if (!Array.isArray(state.durationBeats) || !state.durationBeats.length) {
            state.durationBeats = [1, 2];
        }
        if (state.mode !== 'page' && state.mode !== 'scroll') state.mode = 'page';
        initUI();
        regenerate();
        try {
            piano = await PianoCore.createPiano();
        } catch (err) {
            console.error('Error loading piano samples:', err);
        }

        // Named state inspection for the test suite.
        window.staffDebug = {
            events: streamEvents,
            timedEvents: () => timedEvents.slice(),
            geometry: () => view.geometry(),
            yForMidi: (midi) => view.yForMidi(midi),
            clockBeat: () => clockBeat,
            setClockBeat: (beat) => {
                clockBeat = beat;
                fireDueNotes();
                extendIfNeeded();
                view.frame();
            },
            firedNoteCount: () => firedNoteCount,
            startRun,
            stopRun: () => stopRun({ save: true }),
            recordTraceSample: (beat, midi) => {
                traceSamples.push({ beat, midi });
                view.frame();
            },
            traceSamples: () => traceSamples.slice(),
            sessions: loadSessions,
            loadSessionAt: (index) => {
                const sessions = loadSessions();
                if (sessions[index]) loadSession(sessions[index]);
            },
            setMode,
            regenerate,
            settings: () => ({ ...state, durationBeats: state.durationBeats.slice() })
        };
    }

    boot();
})();
