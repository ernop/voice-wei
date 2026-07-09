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
        phraseStyle: 'free',
        phraseLesson: 'free_open',
        phraseAlgo: 'arch',
        startAtOne: true,
        rangeLow: 0, rangeHigh: 7,
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
        sectionPauseMs: 1000,
        showNumbers: true,
        showNoteNames: true,
        showStaff: true,
        showPlayRow: true,
        reflected: false,
        loopCurrent: false,
        breakdownEnabled: false,
        powersetEnabled: false,
        autoStep: false,
        playOnStep: false,
        playOnNext: true,
        seriesText: '',
        lessonLockedKeys: []
    };

    const STORAGE_KEY = StorageKeys.PHRASES_SETTINGS;
    const PERSISTED_KEYS = [
        'root', 'octave', 'scaleType', 'phraseStyle', 'phraseLesson', 'phraseAlgo', 'startAtOne', 'rangeLow', 'rangeHigh',
        'chromaticRuns', 'accidentalRate', 'fillMode', 'minLength', 'maxLength', 'returnToInitial', 'returnToRoot',
        'hearTones', 'hearSpeech', 'singNumbers', 'noteLengthMs', 'gapMs', 'sectionPauseMs', 'showNumbers', 'showNoteNames',
        'showStaff', 'showPlayRow', 'reflected', 'loopCurrent', 'breakdownEnabled', 'powersetEnabled',
        'autoStep', 'playOnStep', 'playOnNext', 'seriesText', 'lessonLockedKeys'
    ];

    // Setting-change behaviors follow the shared vocabulary defined in
    // docs/parameters.md. Keys not listed here are bounds-next: they only
    // affect the NEXT generated phrase (phraseStyle, phraseLesson,
    // phraseAlgo, startAtOne, rangeLow, rangeHigh, chromaticRuns,
    // minLength, maxLength).
    const REGENERATE_KEYS = new Set(['returnToInitial', 'returnToRoot']);
    const REPROJECT_KEYS = new Set(['root', 'octave', 'scaleType']);
    const REPLAY_KEYS = new Set(['noteLengthMs', 'gapMs']);
    const REDRAW_KEYS = new Set([
        'showNumbers', 'showNoteNames', 'showStaff', 'showPlayRow',
        'hearTones', 'hearSpeech', 'singNumbers', 'fillMode'
    ]);
    const ADJUSTER_VALUES = {
        noteLengthMs: PracticeControls.NOTE_LENGTH_VALUES,
        gapMs: PracticeControls.GAP_VALUES,
        sectionPauseMs: [0, 300, 500, 650, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000],
        accidentalRate: [0, 0.05, 0.1, 0.15, 0.25, 0.35],
        minLength: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16],
        maxLength: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 45, 50]
    };
    const DEFAULT_LESSON_BY_STYLE = Object.freeze({
        free: 'free_open',
        staff: 'staff_steps',
        sight: 'sight_pentachord',
        barbershop: 'barber_tonic',
        genre: 'genre_folk_hymn'
    });
    const LESSON_PRESETS = Object.freeze({
        free_open: { style: 'free', defaults: { scaleType: 'major', phraseAlgo: 'arch', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: [] },
        staff_steps: { style: 'staff', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'minLength', 'maxLength', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        staff_skips: { style: 'staff', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        staff_mixed: { style: 'staff', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 6, maxLength: 10, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        staff_landmarks: { style: 'staff', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        sight_do_re: { style: 'sight', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 4, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        sight_pentachord: { style: 'sight', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 10, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        sight_triad: { style: 'sight', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        sight_cadence: { style: 'sight', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        barber_tonic: { style: 'barbershop', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial', 'accidentalRate'] },
        barber_dominant: { style: 'barbershop', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: false, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        barber_subdominant: { style: 'barbershop', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 8, startAtOne: false, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        barber_thirds: { style: 'barbershop', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 10, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        barber_sevenths: { style: 'barbershop', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 10, startAtOne: false, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        genre_folk_hymn: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 6, maxLength: 12, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial'] },
        genre_pop_hook: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 4, maxLength: 8, startAtOne: false, returnToInitial: false, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'accidentalRate'] },
        genre_theatre: { style: 'genre', defaults: { scaleType: 'major', rangeLow: -2, rangeHigh: 9, minLength: 8, maxLength: 14, startAtOne: false, returnToInitial: true, accidentalRate: 0.05 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial'] },
        genre_jazz: { style: 'genre', defaults: { scaleType: 'major', rangeLow: -2, rangeHigh: 9, minLength: 8, maxLength: 14, startAtOne: false, returnToInitial: true, accidentalRate: 0.15 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial'] },
        genre_gospel: { style: 'genre', defaults: { scaleType: 'minor_pentatonic', rangeLow: -2, rangeHigh: 7, minLength: 6, maxLength: 12, startAtOne: false, returnToInitial: true, accidentalRate: 0.1 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial'] },
        genre_classical: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 8, maxLength: 12, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'startAtOne', 'returnToInitial'] },
        genre_blackbird_folk: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 8, maxLength: 12, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        genre_hello_pop: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 6, maxLength: 10, startAtOne: false, returnToInitial: false, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'accidentalRate'] },
        genre_simon_folk: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 8, maxLength: 12, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        genre_scarborough_modal: { style: 'genre', defaults: { scaleType: 'minor', rangeLow: 0, rangeHigh: 7, minLength: 8, maxLength: 12, startAtOne: false, returnToInitial: true, accidentalRate: 0 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        genre_calypso: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 5, maxLength: 10, startAtOne: false, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'accidentalRate'] },
        genre_norteno: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 6, maxLength: 12, startAtOne: true, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        genre_cantopop: { style: 'genre', defaults: { scaleType: 'major', rangeLow: 0, rangeHigh: 7, minLength: 6, maxLength: 12, startAtOne: false, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial', 'accidentalRate'] },
        genre_klezmer: { style: 'genre', defaults: { scaleType: 'harmonic_minor', rangeLow: -2, rangeHigh: 9, minLength: 6, maxLength: 12, startAtOne: false, returnToInitial: true, accidentalRate: 0.05 }, locks: ['scaleType', 'rangeLow', 'rangeHigh', 'returnToInitial'] },
        genre_modal: { style: 'genre', defaults: { scaleType: 'minor', rangeLow: -2, rangeHigh: 9, minLength: 6, maxLength: 12, startAtOne: false, returnToInitial: true, accidentalRate: 0 }, locks: ['rangeLow', 'rangeHigh', 'returnToInitial'] }
    });

    const phraseAudio = (() => {
        /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
        let piano = null;
        return {
            /** @param {Awaited<ReturnType<typeof PianoCore.createPiano>>} instance */
            setPiano(instance) {
                piano = instance;
            },
            stopAll() {
                if (piano) piano.stopAll();
            },
            /** @param {number} midi @param {number} durationSec */
            playPhraseMidi(midi, durationSec) {
                if (!piano) return false;
                piano.playMidi(midi, durationSec);
                return true;
            },
            /** @param {number} midi @param {number} durationSec */
            playGuideMidi(midi, durationSec) {
                if (piano) piano.playMidi(midi, durationSec);
            }
        };
    })();
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
    let syncingPhraseStageScroll = false;
    /**
     * Powerset practice: lazily walks every unique-as-text ordered note
     * combination of the current phrase (all 3-note combos, then 4, ...).
     * Each pass is an enable mask over the take, like breakdown passes.
     * @type {{ next: () => number[] | null } | null}
     */
    let powersetIterator = null;
    let powersetExhausted = false;

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
        phraseAudio.stopAll();
        if (testPanel) testPanel.cancelGuide();
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    /** @type {number[][]} */
    let breakdownPasses = [];

    // Honest car/lock-screen transport state: most head units render one
    // play/pause toggle and route the press by this state, so claiming
    // 'playing' while idle turns every play press into a pause command.
    let transportPlaying = false;

    /** @param {boolean} playing */
    function setTransportPlaying(playing) {
        transportPlaying = playing;
        MediaSessionCore.setPlaybackState(playing ? 'playing' : 'paused');
    }

    function stopTransport() {
        playToken++;
        cancelCurrentSound();
        setTransportPlaying(false);
    }

    function stopPlayback() {
        stopTransport();
    }

    const sleep = PianoCore.sleep;

    function effectiveGapMs() {
        return PracticeControls.effectiveGapMs(state.gapMs, state.noteLengthMs);
    }

    function playMidi(midi) {
        return phraseAudio.playPhraseMidi(midi, state.noteLengthMs / 1000);
    }

    function buildPhrase() {
        return PatternPracticeCore.generatePhrase({
            root: state.root,
            octave: state.octave,
            scaleType: state.scaleType,
            phraseStyle: state.phraseStyle,
            phraseLesson: state.phraseLesson,
            phraseAlgo: state.phraseAlgo,
            startAtOne: state.startAtOne,
            rangeLow: state.rangeLow,
            rangeHigh: state.rangeHigh,
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
     * Memoized on its actual inputs: the live loop reads the plan many
     * times per second (targets, rails, duration), and rebuilding the
     * spelled note names each time was measurable work. A pure-function
     * memo keyed by the inputs cannot go stale - any change to key,
     * timing, reflection, or the take notes changes the key.
     * @returns {PhrasePlanNote[]}
     */
    let takePlanKey = '';
    /** @type {PhrasePlanNote[]} */
    let takePlanCache = [];

    function buildTakePlan() {
        const key = [
            state.root, state.octave, state.scaleType,
            state.reflected ? 'r' : '', state.noteLengthMs, state.gapMs,
            takeNotes.map(note => `${note.offset}${note.enabled ? '' : 'x'}`).join(',')
        ].join('|');
        if (key !== takePlanKey) {
            takePlanCache = computeTakePlan();
            takePlanKey = key;
        }
        return takePlanCache;
    }

    /** @returns {PhrasePlanNote[]} */
    function computeTakePlan() {
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
    function phraseTitleFromPlan(plan) {
        const scaleName = `${scaleRootPitchString(state.root, state.octave)} ${state.scaleType.replace(/_/g, ' ')}`;
        const degrees = plan
            .filter(note => note.enabled)
            .map(note => note.degree)
            .join(',');
        return `${scaleName} ${degrees}`;
    }

    /** @param {PhrasePlanNote[]} plan */
    function syncPhraseTitle(plan) {
        if (plan.length) {
            MediaSessionCore.setNowPlayingTitle(phraseTitleFromPlan(plan), { artist: '' });
        } else {
            MediaSessionCore.clearNowPlayingTitle();
        }
    }

    /** @param {PhrasePlanNote[]} plan */
    function renderPhraseUnits(plan) {
        const degreesEl = getEl('phraseDegrees');
        if (!degreesEl) return;
        degreesEl.textContent = '';
        degreesEl.classList.toggle('phrase-degrees-many', plan.length > 18);
        degreesEl.classList.toggle('phrase-degrees-empty', !state.showPlayRow && !state.showNumbers && !state.showNoteNames);
        degreesEl.classList.toggle('phrase-degrees-show-play', state.showPlayRow);
        degreesEl.classList.toggle('phrase-degrees-show-names', state.showNoteNames);
        degreesEl.style.setProperty('--phrase-note-count', String(plan.length));
        degreesEl.style.setProperty('--phrase-note-cell-width', '21px');
        plan.forEach(note => {
            const column = document.createElement('div');
            column.className = 'phrase-note-column';
            column.classList.toggle('inactive', !note.enabled);
            column.dataset.index = String(note.index);

            if (state.showPlayRow) {
                const playToken = document.createElement('button');
                playToken.type = 'button';
                playToken.className = 'phrase-note-play-token';
                playToken.textContent = '\u25b6';
                playToken.title = `Play ${note.degree} ${note.noteName}`;
                playToken.setAttribute('aria-label', `Play ${note.noteName}`);
                playToken.addEventListener('click', event => {
                    event.stopPropagation();
                    playSingleNote(note.midi);
                });
                column.appendChild(playToken);
            }

            if (state.showNumbers) {
                const token = document.createElement('button');
                token.type = 'button';
                token.className = 'phrase-degree-token';
                token.dataset.index = String(note.index);
                token.textContent = note.degree;
                token.title = `${note.enabled ? 'Mute' : 'Unmute'} ${note.degree} ${note.noteName}`;
                token.setAttribute('aria-label', `${note.enabled ? 'Mute' : 'Unmute'} ${note.noteName}`);
                token.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    isPointerToggling = true;
                    pointerToggleValue = !takeNotes[note.index].enabled;
                    setNoteActive(note.index, pointerToggleValue);
                });
                token.addEventListener('pointerenter', () => {
                    if (isPointerToggling) setNoteActive(note.index, pointerToggleValue);
                });
                column.appendChild(token);
            }

            if (state.showNoteNames) {
                const name = document.createElement('div');
                name.className = 'phrase-note-name-token';
                name.textContent = note.noteName;
                name.title = `${note.degree} ${note.noteName}`;
                column.appendChild(name);
            }

            degreesEl.appendChild(column);
        });
    }

    /** @param {number} midi */
    async function playSingleNote(midi) {
        await PianoCore.ensureStarted();
        playMidi(midi);
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
     * The chart's rails ARE the working range: the same rangeLow/rangeHigh
     * endpoints the generator draws notes from, read from the same state.
     * The take can only widen the span (a replayed or reflected phrase may
     * hold notes from outside the current palette, and those notes must
     * sit on rails too); the expand-range toggle adds an octave each way.
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
        const lowerOffset = Math.min(state.rangeLow, ...planOffsets) - extraRange;
        const upperOffset = Math.max(state.rangeHigh, ...planOffsets) + extraRange;
        const rootInfo = midiToNoteName(root);
        for (let offset = Math.floor(lowerOffset); offset <= Math.ceil(upperOffset); offset++) {
            const midi = PatternPracticeCore.scaleOffsetToMidi(root, state.scaleType, offset);
            lines.push({
                offset,
                midi,
                label: describeScaleOffset(offset, degreesPerOctave),
                noteName: scaleMidiToPitchString(rootInfo.name, rootInfo.octave, state.scaleType, midi)
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
            rootLabel: scaleRootPitchString(state.root, state.octave),
            scaleType: state.scaleType
        }),
        rails: ({ expandRange }) => buildPhraseTestScaleLines(expandRange).map(line => ({
            midi: line.midi,
            label: `${line.label} ${line.noteName}`,
            emphasized: line.offset >= 0 && line.offset <= PatternPracticeCore.degreesPerOctave(state.scaleType)
        })),
        targets: buildPhraseTestTargets,
        contentDurationMs: () => phraseTestDurationMs(),
        playNote: (midi, durationSec) => { phraseAudio.playGuideMidi(midi, durationSec); },
        onOpenChange: open => syncTestButton(open),
        progressTool: 'phrases-test'
    });
    staffView = StaffView.create({
        hostId: 'phraseStaff',
        key: () => ({
            rootMidi: rootMidi() ?? 60,
            rootLabel: scaleRootPitchString(state.root, state.octave),
            scaleType: state.scaleType
        }),
        notes: buildTakePlan
    });

    function drawPhraseTest() { testPanel.draw(); }

    function drawPhraseStaff() {
        const host = getEl('phraseStaff');
        if (!staffView || !host) return;
        if (!state.showStaff || !buildTakePlan().length) {
            host.classList.add('phrase-staff-empty');
            staffView.clear();
            return;
        }
        staffView.draw();
        syncPhraseStageScrollers();
    }

    function syncPhraseStageScrollers() {
        const degreesEl = getEl('phraseDegrees');
        const staffScroll = document.querySelector('#phraseStaff .phrase-staff-scroll');
        if (!(degreesEl instanceof HTMLElement) || !(staffScroll instanceof HTMLElement)) return;

        wirePhraseStageScroller(degreesEl, staffScroll);
        wirePhraseStageScroller(staffScroll, degreesEl);
        staffScroll.scrollLeft = degreesEl.scrollLeft;
    }

    /**
     * Numbers and note controls are outside the SVG, so keep both horizontal
     * scrollers locked to the same x-origin after VexFlow lays out the staff.
     * @param {HTMLElement} source
     * @param {HTMLElement} target
     */
    function wirePhraseStageScroller(source, target) {
        if (source.dataset.phraseScrollSync === 'true') return;
        source.dataset.phraseScrollSync = 'true';
        source.addEventListener('scroll', () => {
            if (syncingPhraseStageScroll) return;
            syncingPhraseStageScroll = true;
            target.scrollLeft = source.scrollLeft;
            syncingPhraseStageScroll = false;
        });
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
            syncPhraseTitle(plan);
            degreesEl.textContent = '--';
            degreesEl.classList.remove('phrase-degrees-many');
            notesEl.textContent = '';
            drawPhraseStaff();
            drawPhraseTest();
            updateStickyOffset();
            return;
        }
        syncPhraseTitle(plan);
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
        if (state.powersetEnabled) resetPowersetForPhrase();
    }

    /**
     * Start (or restart) the powerset walk over the current take and show
     * the first combination as the enable mask.
     */
    function resetPowersetForPhrase() {
        powersetExhausted = false;
        if (!takeNotes.length) {
            powersetIterator = null;
            return;
        }
        powersetIterator = PatternPracticeCore.createUniqueSubsequenceIterator(
            takeNotes.map(note => note.offset),
            3
        );
        const first = powersetIterator.next();
        if (first) {
            applyNoteMask(first);
        } else {
            powersetExhausted = true;
            updatePhraseDisplay();
        }
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

    /**
     * Powerset always auto-advances: after each play-through the next
     * combination becomes the mask, so its highlight is the advance hint
     * during the inter-pass pause. The last pass (the whole phrase) just
     * repeats once the walk is exhausted.
     */
    function maybeAdvancePowersetPass() {
        if (!state.powersetEnabled || !powersetIterator || powersetExhausted) return false;
        const next = powersetIterator.next();
        if (!next) {
            powersetExhausted = true;
            syncBreakdownControls();
            return false;
        }
        applyNoteMask(next);
        syncBreakdownControls();
        return true;
    }

    async function playPhrase() {
        if (!takeNotes.length) return;
        await PianoCore.ensureStarted();
        cancelCurrentSound();
        const token = ++playToken;
        setTransportPlaying(true);
        do {
            await playPhraseOnce(token);
            if (token !== playToken) break;
            maybeAdvanceBreakdownPass();
            maybeAdvancePowersetPass();
            if (!state.loopCurrent) break;
            // The next section's mask is applied BEFORE this pause, so the
            // highlight always previews exactly the notes about to play.
            // Read live each cycle so Sect changes apply immediately.
            await sleep(state.sectionPauseMs);
        } while (token === playToken && state.loopCurrent);
        if (token === playToken) setTransportPlaying(false);
    }

    // Tone output may include invisible fill notes; the visible take plan
    // remains the only source for display, speech, and pitch-test targets.
    async function playToneSequence(token) {
        if (state.fillMode === 'none') {
            for (let index = 0; index < takeNotes.length; index++) {
                if (token !== playToken) return;
                const note = buildTakePlan()[index];
                if (!note || !takeNotes[index].enabled) continue; // live read
                playMidi(note.midi);
                await sleep(state.noteLengthMs + effectiveGapMs());
            }
            return;
        }

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

    // Playback and the test panel coexist: the panel is a passive
    // listening surface, so playing the phrase, single notes, or a new
    // phrase while Listening is on is allowed (and the mic will chart
    // whatever it hears, including the piano - the chart shows what
    // reaches the microphone). The panel itself still never auto-plays.
    async function playCurrentOrNew() {
        await MediaSessionCore.activate();
        if (!currentPhrase) generatePhrase();
        await playPhrase();
    }

    function handleMediaPlay() {
        playCurrentOrNew();
    }

    function handleMediaPause() {
        stopTransport();
    }

    function handleMediaNext() {
        playNext();
    }

    function handleMediaPrevious() {
        playPrevious();
    }

    function exitBreakdownMode() {
        if (!state.breakdownEnabled) return;
        state.breakdownEnabled = false;
        breakdownPassIndex = 0;
        breakdownPasses = [];
        saveSettings();
        syncBreakdownControls();
    }

    function exitPowersetMode() {
        if (!state.powersetEnabled) return;
        state.powersetEnabled = false;
        powersetIterator = null;
        powersetExhausted = false;
        saveSettings();
        syncBreakdownControls();
    }

    /**
     * A new phrase while the test panel is open starts a fresh take for
     * it: same targets on screen and under the score, listening
     * uninterrupted.
     */
    async function restartTakeForNewPhrase() {
        if (testPanel && testPanel.isOpen) await testPanel.open();
    }

    async function playNext() {
        await MediaSessionCore.activate();
        stopTransport();
        exitBreakdownMode();
        exitPowersetMode();
        generatePhrase();
        await restartTakeForNewPhrase();
        // With play-on-next off, Next only reveals the phrase so it can be
        // worked out by eye/voice first; Play starts audio when ready.
        if (!state.playOnNext) return;
        await playPhrase();
    }

    /**
     * Load the typed degree series as the current phrase - the manual
     * twin of Next. Parse errors show under the input and change
     * nothing; a valid series becomes the take (and a history entry),
     * so breakdown, repeat, test, and per-note muting all apply to it.
     */
    async function applySeriesFromInput() {
        const input = getEl('seriesInput');
        const errorEl = getEl('seriesError');
        if (!(input instanceof HTMLInputElement) || !(errorEl instanceof HTMLElement)) return;
        const parsed = PatternPracticeCore.parseDegreeSeries(input.value, state.scaleType);
        if (parsed.errors.length) {
            errorEl.hidden = false;
            errorEl.textContent = parsed.errors.join(' \u00b7 ');
            return;
        }
        errorEl.hidden = true;
        errorEl.textContent = '';
        state.seriesText = input.value;
        saveSettings();

        await MediaSessionCore.activate();
        stopTransport();
        exitBreakdownMode();
        exitPowersetMode();
        const phrase = PatternPracticeCore.phraseFromOffsets({
            offsets: parsed.offsets,
            root: state.root,
            octave: state.octave,
            scaleType: state.scaleType
        });
        if (!phrase) return;
        currentPhrase = phrase;
        setTakeFromPhrase(phrase);
        if (history) history.add(phrase);
        await restartTakeForNewPhrase();
        if (!state.playOnNext) return;
        await playPhrase();
    }

    /**
     * Car back button: step back through the phrase history, one entry
     * per press, replaying each. At the oldest entry it replays that.
     */
    async function playPrevious() {
        await MediaSessionCore.activate();
        stopTransport();
        exitBreakdownMode();
        exitPowersetMode();
        const entries = history ? history.entries : [];
        if (entries.length) {
            const index = entries.indexOf(currentPhrase);
            const previous = entries[index < 0 ? 0 : Math.min(index + 1, entries.length - 1)];
            currentPhrase = previous;
            setTakeFromPhrase(previous);
        }
        if (!currentPhrase) return;
        await restartTakeForNewPhrase();
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
        document.querySelectorAll(`[data-index="${index}"]`).forEach(token => {
            token.classList.toggle('inactive', !active);
        });
        syncPhraseTitle(buildTakePlan());
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
        if (state.breakdownEnabled && state.powersetEnabled) {
            state.powersetEnabled = false;
            powersetIterator = null;
            powersetExhausted = false;
        }
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

    function togglePowersetEnabled() {
        state.powersetEnabled = !state.powersetEnabled;
        if (state.powersetEnabled && state.breakdownEnabled) {
            state.breakdownEnabled = false;
            breakdownPassIndex = 0;
            breakdownPasses = [];
        }
        saveSettings();
        if (state.powersetEnabled) {
            // generatePhrase seeds the take, which starts the walk itself.
            if (!currentPhrase) generatePhrase();
            else resetPowersetForPhrase();
        } else {
            powersetIterator = null;
            powersetExhausted = false;
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

    function togglePlayOnNext() {
        state.playOnNext = !state.playOnNext;
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

    /** Manual powerset step: show the next combination, optionally play it. */
    async function advancePowersetCombo() {
        if (!state.powersetEnabled) return;
        if (!currentPhrase) generatePhrase();
        if (!powersetIterator) resetPowersetForPhrase();

        stopTransport();
        if (!maybeAdvancePowersetPass()) return;

        if (state.playOnStep) {
            await playPhrase();
        }
    }

    function advanceStagePass() {
        if (state.powersetEnabled) return advancePowersetCombo();
        return advanceBreakdownNote();
    }

    function syncBreakdownControls() {
        const breakdownBtn = getEl('breakdownBtn');
        if (breakdownBtn) {
            breakdownBtn.classList.toggle('selected', state.breakdownEnabled);
            breakdownBtn.setAttribute('aria-pressed', String(state.breakdownEnabled));
        }
        const powersetBtn = getEl('powersetBtn');
        if (powersetBtn) {
            powersetBtn.classList.toggle('selected', state.powersetEnabled);
            powersetBtn.setAttribute('aria-pressed', String(state.powersetEnabled));
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
        const playOnNextBtn = getEl('playOnNextBtn');
        if (playOnNextBtn) {
            playOnNextBtn.classList.toggle('selected', state.playOnNext);
            playOnNextBtn.setAttribute('aria-pressed', String(state.playOnNext));
        }
        const addBtn = getEl('addNoteBtn');
        if (addBtn instanceof HTMLButtonElement) {
            addBtn.hidden = !state.breakdownEnabled && !state.powersetEnabled;
            addBtn.textContent = state.powersetEnabled ? 'next combo' : 'add note';
            addBtn.disabled = state.powersetEnabled
                ? powersetExhausted
                : (!state.breakdownEnabled || breakdownPassIndex >= breakdownPasses.length - 1);
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
        stopTransport();
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
            await restartTakeForNewPhrase();
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

    /** Range endpoints display as the degree they sit on ("1", "8", "6↓", "3↑"). @param {number} offset */
    function rangeEndpointLabel(offset) {
        return describeScaleOffset(offset, PatternPracticeCore.degreesPerOctave(state.scaleType));
    }

    function syncAdjusterControls() {
        PracticeControls.setValueText('rootPitchValue', scaleRootPitchString(state.root, state.octave));
        PracticeControls.setValueText('noteLengthValue', PracticeControls.formatSeconds(state.noteLengthMs));
        PracticeControls.setValueText('gapValue', PracticeControls.formatGapLabel(state.gapMs));
        PracticeControls.setValueText('sectionPauseValue', PracticeControls.formatSeconds(state.sectionPauseMs));
        PracticeControls.setValueText('accidentalRateValue', `${Math.round(state.accidentalRate * 100)}%`);
        PracticeControls.setValueText('minLengthValue', String(state.minLength));
        PracticeControls.setValueText('maxLengthValue', String(state.maxLength));
        PracticeControls.setValueText('rangeLowValue', rangeEndpointLabel(state.rangeLow));
        PracticeControls.setValueText('rangeHighValue', rangeEndpointLabel(state.rangeHigh));

        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(rootMidi(), delta);
            }
            if (key === 'rangeLow' || key === 'rangeHigh') {
                return steppedRangeValue(key, delta) === null;
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });
    }

    /**
     * The next value for a range-endpoint stepper, or null at a bound.
     * Endpoints move one scale degree per step; the low end may reach a
     * full octave below unison, the high end two octaves up, and the two
     * can never cross (low < high always).
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

    function syncAnchorControls() {
        syncFillButtons();
    }

    /**
     * A boolean control drawn as one button: the label names the current
     * state and a click flips it (same pattern as the Reflect button).
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

    function isLessonLocked(key) {
        return Array.isArray(state.lessonLockedKeys) && state.lessonLockedKeys.includes(key);
    }

    function unlockLessonKey(key) {
        if (!isLessonLocked(key)) return;
        state.lessonLockedKeys = state.lessonLockedKeys.filter(lockedKey => lockedKey !== key);
        syncLessonLocks();
        saveSettings();
    }

    function syncToggleControl(id, checked) {
        const input = getEl(id);
        if (!(input instanceof HTMLInputElement)) return;
        input.checked = checked;
    }

    function syncPresetControlledValues() {
        PracticeControls.syncSingleSelect('data-scale', state.scaleType);
        PracticeControls.syncSingleSelect('data-phrase-algo', state.phraseAlgo);
        syncBooleanPill('startAnchorBtn', state.startAtOne, 'start at 1', 'random start');
        syncBooleanPill('returnAnchorBtn', state.returnToInitial, 'return to 1', 'no return');
        syncToggleControl('hearTonesToggle', state.hearTones);
        syncToggleControl('hearSpeechToggle', state.hearSpeech);
        syncToggleControl('singNumbersToggle', state.singNumbers);
        syncToggleControl('showNumbersToggle', state.showNumbers);
        syncToggleControl('showNamesToggle', state.showNoteNames);
        syncToggleControl('showStaffToggle', state.showStaff);
        syncToggleControl('showPlayRowToggle', state.showPlayRow);
        syncPhraseLessonControls();
        syncAnchorControls();
        syncAdjusterControls();
    }

    function syncLessonLocks() {
        const selectorsByKey = {
            scaleType: '[data-scale]',
            phraseAlgo: '[data-phrase-algo]',
            rangeLow: '[data-step-key="rangeLow"]',
            rangeHigh: '[data-step-key="rangeHigh"]',
            startAtOne: '#startAnchorBtn',
            returnToInitial: '#returnAnchorBtn',
            fillMode: '#fillFullBtn, #fillChordBtn',
            noteLengthMs: '[data-step-key="noteLengthMs"]',
            gapMs: '[data-step-key="gapMs"]',
            accidentalRate: '[data-step-key="accidentalRate"]',
            minLength: '[data-step-key="minLength"]',
            maxLength: '[data-step-key="maxLength"]',
            hearTones: '#hearTonesToggle',
            hearSpeech: '#hearSpeechToggle',
            singNumbers: '#singNumbersToggle',
            showNumbers: '#showNumbersToggle',
            showNoteNames: '#showNamesToggle',
            showStaff: '#showStaffToggle',
            showPlayRow: '#showPlayRowToggle'
        };
        document.querySelectorAll('.lesson-locked').forEach(el => el.classList.remove('lesson-locked'));
        Object.entries(selectorsByKey).forEach(([key, selector]) => {
            if (!isLessonLocked(key)) return;
            document.querySelectorAll(selector).forEach(el => {
                const target = el.closest('.step-field, label') || el;
                target.classList.add('lesson-locked');
            });
        });
    }

    /** @param {string} lesson */
    function applyLessonPreset(lesson) {
        const preset = LESSON_PRESETS[lesson];
        if (!preset) {
            setPhraseLesson(lesson);
            return;
        }
        state.phraseStyle = preset.style;
        state.phraseLesson = lesson;
        Object.assign(state, preset.defaults);
        normalizeLengthBounds('maxLength');
        state.lessonLockedKeys = preset.locks.slice();
        syncPresetControlledValues();
        syncLessonLocks();
        saveSettings();
        if (REDRAW_KEYS.has('fillMode')) updatePhraseDisplay();
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
            // Range endpoint labels name degrees of the current scale.
            if (key === 'scaleType') syncAdjusterControls();
            updatePhraseDisplay();
            if (currentPhrase) playCurrentOrNew();
        }
    }

    function wireSetting(attr, stateKey, parse) {
        PracticeControls.wireSingleSelect(attr, parse, state[stateKey], value => {
            unlockLessonKey(stateKey);
            state[stateKey] = value;
            onSettingChanged(stateKey);
        });
    }

    function syncPhraseLessonControls() {
        PracticeControls.syncSingleSelect('data-phrase-style', state.phraseStyle);
        PracticeControls.syncSingleSelect('data-phrase-lesson', state.phraseLesson);
        document.querySelectorAll('[data-lesson-family]').forEach(el => {
            const row = /** @type {HTMLElement} */ (el);
            row.hidden = row.dataset.lessonFamily !== state.phraseStyle;
        });
    }

    /** @param {string} style */
    function setPhraseStyle(style) {
        applyLessonPreset(DEFAULT_LESSON_BY_STYLE[style] || DEFAULT_LESSON_BY_STYLE.free);
    }

    /** @param {string} lesson */
    function setPhraseLesson(lesson) {
        applyLessonPreset(lesson);
    }

    function normalizeLengthBounds(key) {
        if (state.minLength > state.maxLength) {
            if (key === 'maxLength') state.minLength = state.maxLength;
            else state.maxLength = state.minLength;
        }
    }

    function setAdjusterValue(key, value) {
        unlockLessonKey(key);
        state[key] = value;
        normalizeLengthBounds(key);
        syncAdjusterControls();
        onSettingChanged(key);
    }

    /** @param {number} midi */
    function setRootPitchFromMidi(midi) {
        const bounded = PracticeControls.clampRootMidi(midi);
        unlockLessonKey('root');
        unlockLessonKey('octave');
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
            const next = steppedRangeValue(/** @type {'rangeLow' | 'rangeHigh'} */ (key), delta);
            if (next !== null) setAdjusterValue(key, next);
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
        unlockLessonKey('fillMode');
        state.fillMode = state.fillMode === mode ? 'none' : mode;
        syncAnchorControls();
        onSettingChanged('fillMode');
    }

    function wireHearToggle(id, stateKey) {
        PracticeControls.wireToggle(id, state[stateKey], checked => {
            unlockLessonKey(stateKey);
            state[stateKey] = checked;
            onSettingChanged(stateKey);
        });
    }

    function initUI() {
        wireSetting('data-scale', 'scaleType', String);
        wireSetting('data-phrase-algo', 'phraseAlgo', String);
        PracticeControls.wireSingleSelect('data-phrase-style', String, state.phraseStyle, setPhraseStyle);
        PracticeControls.wireSingleSelect('data-phrase-lesson', String, state.phraseLesson, setPhraseLesson);
        wireHearToggle('hearTonesToggle', 'hearTones');
        wireHearToggle('hearSpeechToggle', 'hearSpeech');
        wireHearToggle('singNumbersToggle', 'singNumbers');
        getEl('startAnchorBtn')?.addEventListener('click', () => {
            unlockLessonKey('startAtOne');
            state.startAtOne = !state.startAtOne;
            syncBooleanPill('startAnchorBtn', state.startAtOne, 'start at 1', 'random start');
            onSettingChanged('startAtOne');
        });
        getEl('returnAnchorBtn')?.addEventListener('click', () => {
            unlockLessonKey('returnToInitial');
            state.returnToInitial = !state.returnToInitial;
            syncBooleanPill('returnAnchorBtn', state.returnToInitial, 'return to 1', 'no return');
            onSettingChanged('returnToInitial');
        });
        PracticeControls.wireSteppers(stepAdjusterValue);
        PracticeControls.wireToggle('showNumbersToggle', state.showNumbers, checked => {
            unlockLessonKey('showNumbers');
            state.showNumbers = checked;
            onSettingChanged('showNumbers');
        });
        PracticeControls.wireToggle('showNamesToggle', state.showNoteNames, checked => {
            unlockLessonKey('showNoteNames');
            state.showNoteNames = checked;
            onSettingChanged('showNoteNames');
        });
        PracticeControls.wireToggle('showStaffToggle', state.showStaff, checked => {
            unlockLessonKey('showStaff');
            state.showStaff = checked;
            onSettingChanged('showStaff');
        });
        PracticeControls.wireToggle('showPlayRowToggle', state.showPlayRow, checked => {
            unlockLessonKey('showPlayRow');
            state.showPlayRow = checked;
            onSettingChanged('showPlayRow');
        });
        getEl('playBtn')?.addEventListener('click', playCurrentOrNew);
        getEl('repeatBtn')?.addEventListener('click', toggleRepeatLoop);
        getEl('testBtn')?.addEventListener('click', togglePhraseTest);
        getEl('nextBtn')?.addEventListener('click', playNext);
        getEl('stopBtn')?.addEventListener('click', () => {
            stopPlayback();
        });
        getEl('reflectBtn')?.addEventListener('click', toggleReflect);
        getEl('allNotesBtn')?.addEventListener('click', () => setAllNotes(true));
        getEl('fillFullBtn')?.addEventListener('click', () => toggleFillMode('full'));
        getEl('fillChordBtn')?.addEventListener('click', () => toggleFillMode('chord'));
        getEl('breakdownBtn')?.addEventListener('click', toggleBreakdownEnabled);
        getEl('powersetBtn')?.addEventListener('click', togglePowersetEnabled);
        getEl('autoStepBtn')?.addEventListener('click', toggleAutoStep);
        getEl('playOnStepBtn')?.addEventListener('click', togglePlayOnStep);
        getEl('playOnNextBtn')?.addEventListener('click', togglePlayOnNext);
        getEl('addNoteBtn')?.addEventListener('click', () => { advanceStagePass(); });
        const seriesInput = getEl('seriesInput');
        if (seriesInput instanceof HTMLInputElement) {
            seriesInput.value = state.seriesText;
            seriesInput.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    applySeriesFromInput();
                }
            });
        }
        getEl('seriesSetBtn')?.addEventListener('click', () => { applySeriesFromInput(); });
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
        syncBooleanPill('startAnchorBtn', state.startAtOne, 'start at 1', 'random start');
        syncBooleanPill('returnAnchorBtn', state.returnToInitial, 'return to 1', 'no return');
        syncAdjusterControls();
        syncPhraseLessonControls();
        syncLessonLocks();
        MediaSessionCore.register('Phrases', [
            ['play', handleMediaPlay],
            ['pause', handleMediaPause],
            ['nexttrack', handleMediaNext],
            ['seekforward', handleMediaNext],
            ['seekto', handleMediaNext],
            ['previoustrack', handleMediaPrevious],
            ['seekbackward', handleMediaPrevious]
        ]);
        // Idle at load: the car's toggle must send 'play', not 'pause'.
        setTransportPlaying(false);
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
        if (!Array.isArray(state.lessonLockedKeys)) state.lessonLockedKeys = [];
        // Breakdown and powerset are exclusive pass modes over the take.
        if (state.powersetEnabled && state.breakdownEnabled) state.breakdownEnabled = false;
    }

    async function boot() {
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
        migrateLoadedSettings();
        if (state.chromaticRuns && !state.accidentalRate) state.accidentalRate = 0.35;
        if (!['none', 'full', 'chord'].includes(state.fillMode)) state.fillMode = 'none';
        try {
            phraseAudio.setPiano(await PianoCore.createPiano());
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
            mediaPlay: handleMediaPlay,
            mediaNext: handleMediaNext,
            mediaPrevious: handleMediaPrevious,
            settings: () => ({
                breakdownEnabled: state.breakdownEnabled,
                powersetEnabled: state.powersetEnabled,
                powersetExhausted,
                autoStep: state.autoStep,
                playOnStep: state.playOnStep,
                playOnNext: state.playOnNext,
                loopCurrent: state.loopCurrent,
                hearTones: state.hearTones,
                hearSpeech: state.hearSpeech,
                singNumbers: state.singNumbers,
                showNumbers: state.showNumbers,
                showNoteNames: state.showNoteNames,
                showPlayRow: state.showPlayRow,
                showStaff: state.showStaff,
                lessonLockedKeys: state.lessonLockedKeys.slice()
            }),
            panel: testPanel
        };
    }

    boot();
})();
