// @ts-check
// Interval training -- two exercise types, level-based.
// Consumes pattern-practice-core, piano-core, practice-controls,
// settings-store, and media-session-core.

(function () {
    'use strict';

    // ---- EXERCISE TYPES ----
    //
    // TYPE A: "Degree sequences" -- pick absolute scale degrees to visit.
    //   "1-4-5" = play degree 1, degree 4, degree 5. Three ascending notes.
    //   Transposed: start on random degree N, pattern becomes N, N+3, N+4.
    //
    // TYPE B: "Movement clusters" -- relative jumps, each from previous note.
    //   "+2, -3" from note X = play X, then X+2, then (X+2)-3 = X-1.

    const ri = PatternPracticeCore.randomInt;

    // Type A levels (degree sequences). Offsets are degree distances from root.
    // dp = degrees per octave (7 for major). ceiling = dp normally, dp*2 when expanded.
    // "1-4-8" = offsets [0, 3, 7] (degree 1 to 4 is +3, degree 1 to 8 is +7)
    const DEGREE_LEVELS = [
        { id: 'a1', name: '1-x',            desc: 'Root then one random degree',
            gen: (dp, ceil) => { const x = ri(1, ceil); return { offsets: [0, x], label: `1-${x+1}` }; } },
        { id: 'a2', name: '1-x-8 up',       desc: 'Root, stop, octave (ascending)',
            gen: (dp, ceil) => { const x = ri(1, dp - 1); return { offsets: [0, x, dp], label: `1-${x+1}-8` }; } },
        { id: 'a3', name: '8-x-1 down',     desc: 'Octave, stop, root (descending)',
            gen: (dp, ceil) => { const x = ri(1, dp - 1); return { offsets: [dp, x, 0], label: `8-${x+1}-1` }; } },
        { id: 'a4', name: '1-x-y up',       desc: 'Root then two ascending stops',
            gen: (dp, ceil) => {
                const x = ri(1, ceil - 1);
                const y = ri(x + 1, ceil);
                return { offsets: [0, x, y], label: `1-${x+1}-${y+1}` };
            } },
        { id: 'a5', name: '1-x-8-x-1',     desc: 'Symmetric octave round-trip',
            gen: (dp, ceil) => { const x = ri(1, dp - 1); return { offsets: [0, x, dp, x, 0], label: `1-${x+1}-8-${x+1}-1` }; } },
        { id: 'a6', name: '1-x-8-y-1',     desc: 'Asymmetric octave round-trip',
            gen: (dp, ceil) => {
                const x = ri(1, dp - 1);
                let y; do { y = ri(1, dp - 1); } while (y === x);
                return { offsets: [0, x, dp, y, 0], label: `1-${x+1}-8-${y+1}-1` };
            } },
        { id: 'a7', name: '1-...-8 path',   desc: 'Random ascending path (3-7 notes)',
            gen: (dp, ceil) => {
                const nStops = ri(1, 5);
                const pool = [];
                for (let i = 1; i < ceil; i++) pool.push(i);
                // Shuffle and pick nStops unique intermediate degrees
                for (let i = pool.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [pool[i], pool[j]] = [pool[j], pool[i]];
                }
                const stops = pool.slice(0, nStops).sort((a, b) => a - b);
                const offsets = [0, ...stops, ceil];
                const label = offsets.map(o => o + 1).join('-');
                return { offsets, label };
            } },
    ];

    // Type B levels (movement clusters). Jumps are sequential from previous note.
    // "+2, -3" means: from start go +2 steps, then from there go -3 steps.
    const CLUSTER_LEVELS = [
        { id: 'b1', name: '+k, -k',         desc: 'Up k then down k (back to start)',
            gen: (dp) => { const k = ri(1, dp); return { jumps: [k, -k], label: `+${k} -${k}` }; } },
        { id: 'b2', name: '-k, +k',         desc: 'Down k then up k (back to start)',
            gen: (dp) => { const k = ri(1, dp); return { jumps: [-k, k], label: `-${k} +${k}` }; } },
        { id: 'b3', name: '+k, -j',         desc: 'Up k then down j (different sizes)',
            gen: (dp) => {
                const k = ri(1, dp);
                let j; do { j = ri(1, dp); } while (j === k);
                return { jumps: [k, -j], label: `+${k} -${j}` };
            } },
        { id: 'b4', name: '-k, +j',         desc: 'Down k then up j (different sizes)',
            gen: (dp) => {
                const k = ri(1, dp);
                let j; do { j = ri(1, dp); } while (j === k);
                return { jumps: [-k, j], label: `-${k} +${j}` };
            } },
        { id: 'b5', name: '+k, -j, +m',     desc: 'Three jumps, mixed sizes',
            gen: (dp) => {
                const k = ri(1, dp), j = ri(1, dp), m = ri(1, dp);
                return { jumps: [k, -j, m], label: `+${k} -${j} +${m}` };
            } },
    ];

    const INTERVAL_ORDER = ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];

    // ---- STATE ----
    const state = {
        root: 'C',
        octave: 4,
        scale: 'major',
        lengthMs: 600,
        gapMs: 2000,
        speakNumbers: true,
        playNotes: true,
        showNoteNames: true,
        expandRange: false,
        reverse: false,
        repeat: false,
        exerciseType: 'A',
        selectedLevel: 'a1',
        trainingMode: 'patterns',
        mode: 'identify',
        direction: 'ascending',
        enabledIntervals: [...INTERVAL_ORDER],
        adaptiveMode: true,
        drivingMode: false,
        autoAdvance: false,
        rootRangeMid: 60,
        running: false,
        stopRequested: false,
        nextRequested: false,
    };

    const ADJUSTER_VALUES = {
        lengthMs: PracticeControls.NOTE_LENGTH_VALUES,
        gapMs: PracticeControls.GAP_VALUES
    };

    const STORAGE_KEY = StorageKeys.INTERVALS_SETTINGS;
    const EAR_STATS_KEY = StorageKeys.INTERVALS_EAR_STATS;
    const PERSISTED_KEYS = [
        'root', 'octave', 'scale', 'lengthMs', 'gapMs', 'speakNumbers',
        'playNotes', 'showNoteNames', 'expandRange', 'reverse', 'repeat',
        'exerciseType', 'selectedLevel', 'trainingMode',
        'mode', 'direction', 'enabledIntervals', 'adaptiveMode', 'drivingMode',
        'autoAdvance', 'rootRangeMid'
    ];
    const EAR_SETTING_KEYS = [
        'mode', 'direction', 'enabledIntervals', 'adaptiveMode', 'drivingMode',
        'autoAdvance', 'rootRangeMid'
    ];

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let piano = null;
    /** @type {any | null} The pattern currently displayed (and sung against) */
    let currentInstance = null;
    /** @type {ReturnType<typeof PitchTestPanel.create> | null} */
    let singPanel = null;
    /** @type {ReturnType<typeof HistoryList.create> | null} */
    let history = null;
    /** @type {ReturnType<NonNullable<typeof window.EarTraining>['create']> | null} */
    let earTraining = null;

    const sleep = PianoCore.sleep;

    // The shared gap presets include overlap ratios (negative values);
    // here the gap sits between patterns, so they resolve to "no pause".
    function patternGapMs() {
        return Math.max(0, PracticeControls.effectiveGapMs(state.gapMs, state.lengthMs));
    }

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function migrateLegacyEarsSettings() {
        const legacyRaw = localStorage.getItem('ears-settings');
        if (!legacyRaw) return;
        try {
            const legacy = JSON.parse(legacyRaw);
            EAR_SETTING_KEYS.forEach(key => {
                if (!(key in legacy)) return;
                if (key === 'enabledIntervals' && Array.isArray(legacy[key])) {
                    state.enabledIntervals = legacy[key];
                    return;
                }
                if (typeof legacy[key] === typeof state[key]) {
                    state[key] = legacy[key];
                }
            });
            saveSettings();
        } catch (err) {
            console.error('Failed to migrate ears-settings:', err);
        }
    }

    function readInitialTrainingMode() {
        const params = new URLSearchParams(window.location.search);
        const queryMode = params.get('mode');
        if (queryMode === 'ear' || window.location.hash === '#ear') {
            state.trainingMode = 'ear';
        }
    }

    function syncTrainingModeUI() {
        const patternsPanel = document.getElementById('patternsPanel');
        const earPanel = document.getElementById('earTrainingPanel');
        if (patternsPanel) patternsPanel.hidden = state.trainingMode !== 'patterns';
        if (earPanel) earPanel.hidden = state.trainingMode !== 'ear';
        document.querySelectorAll('[data-training-mode]').forEach(btn => {
            btn.classList.toggle('selected', /** @type {HTMLElement} */ (btn).dataset.trainingMode === state.trainingMode);
        });
        if (state.trainingMode === 'ear' && earTraining) {
            MediaSessionCore.register('Ear training', [
                ['play', () => { earTraining.repeatCurrentInterval(); }],
                ['pause', () => { earTraining.repeatCurrentInterval(); }],
                ['nexttrack', () => { earTraining.playNextInterval(); }],
                ['seekforward', () => { earTraining.playNextInterval(); }]
            ]);
        } else {
            MediaSessionCore.register('Intervals', [
                ['play', () => { runLoop(); }],
                ['pause', () => { stopLoop(); }],
                ['nexttrack', () => { requestNext(); }],
                ['seekforward', () => { requestNext(); }]
            ]);
        }
    }

    function setupTrainingModeSwitch() {
        PracticeControls.wireSingleSelect('data-training-mode', String, state.trainingMode, value => {
            state.trainingMode = value === 'ear' ? 'ear' : 'patterns';
            saveSettings();
            syncTrainingModeUI();
        });
    }

    function defaultEarStats() {
        /** @type {Record<string, { correct: number, total: number }>} */
        const stats = {};
        INTERVAL_ORDER.forEach(interval => {
            stats[interval] = { correct: 0, total: 0 };
        });
        return stats;
    }

    /** @param {unknown} data @returns {data is Record<string, { correct: number; total: number }>} */
    function isEarStatsRecord(data) {
        return data !== null && typeof data === 'object' && !Array.isArray(data);
    }

    function loadEarStats() {
        return SettingsStore.loadJson(EAR_STATS_KEY, defaultEarStats(), isEarStatsRecord);
    }

    function saveEarStats(stats) {
        SettingsStore.saveJson(EAR_STATS_KEY, stats);
    }

    async function setupEarTraining() {
        earTraining = window.EarTraining.create({
            settings: state,
            saveSettings,
            loadStats: loadEarStats,
            saveStats: saveEarStats
        });
        await earTraining.init();
    }

    /** @param {number} midi */
    function playNote(midi) {
        if (!piano) return;
        piano.playMidi(midi, state.lengthMs / 1000);
    }

    // ---- SCALE MATH ----
    function buildExtendedScale() {
        return PatternPracticeCore.buildExtendedScale({
            root: state.root,
            octave: state.octave,
            scaleType: state.scale,
            lowerOctaves: 0,
            upperOctaves: 3
        });
    }

    function degreesPerOctave() {
        return PatternPracticeCore.degreesPerOctave(state.scale);
    }

    // ---- INSTANCE GENERATION ----

    /**
     * Zip scale positions into SequenceNotes once (the representation
     * law: sequences cross boundaries as lists of note objects, never
     * parallel arrays). Returns null when an offset leaves the scale.
     * @param {Array<{ midi: number, name: string }>} scale
     * @param {number[]} offsets - scale-degree offsets (0 = degree 1)
     * @param {number} startIdx - scale index of offset 0
     * @param {number} dpOct
     * @returns {SequenceNote[] | null}
     */
    function buildInstanceNotes(scale, offsets, startIdx, dpOct) {
        /** @type {SequenceNote[]} */
        const notes = [];
        for (const off of offsets) {
            const idx = startIdx + off;
            if (idx < 0 || idx >= scale.length) return null;
            notes.push({
                offset: off,
                midi: scale[idx].midi,
                degree: PatternPracticeCore.offsetToDegree(off, dpOct),
                spoken: PatternPracticeCore.offsetToSpoken(off, dpOct),
                noteName: scale[idx].name
            });
        }
        return notes;
    }

    function generateRandomInstance() {
        const scale = buildExtendedScale();
        if (scale.length === 0) return null;
        const dpOct = degreesPerOctave();

        if (state.exerciseType === 'A') {
            return generateDegreeInstance(scale, dpOct);
        } else {
            return generateClusterInstance(scale, dpOct);
        }
    }

    function generateDegreeInstance(scale, dpOct) {
        const level = DEGREE_LEVELS.find(l => l.id === state.selectedLevel);
        if (!level) return null;

        const ceil = state.expandRange ? dpOct * 2 : dpOct;
        const gen = level.gen(dpOct, ceil);

        // Always start on the root (degree 1). Offsets are absolute scale positions.
        const startIdx = dpOct;

        const notes = buildInstanceNotes(scale, gen.offsets, startIdx, dpOct);
        if (!notes) return null;
        if (state.reverse) notes.reverse();
        const desc = state.reverse ? gen.label + ' rev' : gen.label;
        return { description: desc, notes };
    }

    function generateClusterInstance(scale, dpOct) {
        const level = CLUSTER_LEVELS.find(l => l.id === state.selectedLevel);
        if (!level) return null;

        const gen = level.gen(dpOct);

        // Convert sequential jumps to cumulative offsets
        const offsets = [0];
        let pos = 0;
        for (const j of gen.jumps) {
            pos += j;
            offsets.push(pos);
        }

        const minOff = Math.min(...offsets);
        const maxOff = Math.max(...offsets);

        const lowestStart = Math.max(0, dpOct - minOff);
        const highestStart = Math.min(scale.length - 1 - maxOff, dpOct + dpOct - 1);
        if (lowestStart > highestStart) return null;
        const startIdx = ri(lowestStart, highestStart);

        const notes = buildInstanceNotes(scale, offsets, startIdx, dpOct);
        if (!notes) return null;
        if (state.reverse) notes.reverse();
        const desc = state.reverse ? gen.label + ' rev' : gen.label;
        return { description: desc, notes };
    }

    // ---- DISPLAY ----
    function showInstance(instance) {
        const display = document.getElementById('currentDisplay');
        if (!display) return;
        const degreeStr = instance.notes.map(note => note.degree).join('-');
        const noteStr = instance.notes.map(note => note.noteName).join(' ');
        const namesPart = state.showNoteNames
            ? `<span class="pattern-notes">${noteStr}</span>` : '';
        display.innerHTML = `<span class="pattern-desc">${instance.description}</span><span class="pattern-degrees">${degreeStr}</span>${namesPart}`;
        if (singPanel) singPanel.draw();
    }

    // ---- MAIN LOOP ----
    async function runLoop() {
        if (state.running) return;
        state.running = true;
        state.stopRequested = false;

        await MediaSessionCore.activate();
        await PianoCore.ensureStarted();

        const display = document.getElementById('currentDisplay');

        let firstRound = true;

        while (!state.stopRequested) {
            // Generate new pattern unless repeating the same one
            if (!currentInstance || !state.repeat || state.nextRequested) {
                state.nextRequested = false;
                // Avoid serving the identical pattern twice in a row
                const previousKey = currentInstance
                    ? currentInstance.description + currentInstance.notes.map(note => note.degree).join('-')
                    : null;
                let next = generateRandomInstance();
                for (let attempt = 0;
                    attempt < 5 && next && previousKey
                    && next.description + next.notes.map(note => note.degree).join('-') === previousKey;
                    attempt++) {
                    next = generateRandomInstance();
                }
                currentInstance = next;
                if (!currentInstance) {
                    display.textContent = 'Could not generate pattern -- check settings';
                    break;
                }
            }

            showInstance(currentInstance);

            if ((!firstRound || !state.repeat) && history) {
                history.add({
                    desc: currentInstance.description,
                    degrees: currentInstance.notes.map(note => note.degree).join('-'),
                    notes: currentInstance.notes.map(note => note.noteName).join(' '),
                    time: new Date().toLocaleTimeString()
                });
            }

            // Brief pause to read the display before audio starts
            if (!firstRound && !state.stopRequested) {
                await sleep(Math.min(patternGapMs(), 400));
            }
            firstRound = false;

            if (state.speakNumbers && !state.stopRequested) {
                await VoiceOutput.speak(currentInstance.notes.map(note => note.spoken).join(', '));
            }

            if (state.playNotes && !state.stopRequested) {
                for (const note of currentInstance.notes) {
                    if (state.stopRequested) break;
                    playNote(note.midi);
                    await sleep(state.lengthMs);
                }
            }

            if (!state.stopRequested) {
                await sleep(patternGapMs());
            }
        }

        state.running = false;
        if (display) display.textContent = 'Stopped';
    }

    function stopLoop() {
        state.stopRequested = true;
        state.running = false;
        VoiceOutput.stop();
        if (piano) piano.stopAll();
        if (singPanel) singPanel.cancelGuide();
        // The loop only notices the stop at its next checkpoint (it may be
        // mid-gap for seconds); the display must reflect the stop now.
        const display = document.getElementById('currentDisplay');
        if (display) display.textContent = 'Stopped';
    }

    function requestNext() {
        state.nextRequested = true;
    }

    // ---- HISTORY ----
    function renderHistoryItem(entry) {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `<span class="history-text history-desc">${entry.desc}</span><span class="history-text history-degrees">${entry.degrees}</span><span class="history-text history-notes">${entry.notes}</span><span class="history-time">${entry.time}</span>`;
        return item;
    }

    // ---- SING PANEL ----
    /** @param {boolean} expandRange */
    function buildSingRails(expandRange) {
        if (!currentInstance) return [];
        const scale = buildExtendedScale();
        if (!scale.length) return [];
        const midis = currentInstance.notes.map(note => note.midi);
        const minMidi = Math.min(...midis);
        const maxMidi = Math.max(...midis);
        const pad = expandRange ? 12 : 4;
        return scale
            .map(note => ({ note }))
            .filter(({ note }) => note.midi >= minMidi - pad && note.midi <= maxMidi + pad)
            .map(({ note }) => ({
                midi: note.midi,
                label: `${note.degree} ${note.name}`,
                emphasized: midis.includes(note.midi)
            }));
    }

    function buildSingTargets() {
        if (!currentInstance) return [];
        return currentInstance.notes.map((note, index) => ({
            midi: note.midi,
            startMs: index * state.lengthMs,
            endMs: (index + 1) * state.lengthMs,
            label: note.degree,
            active: true
        }));
    }

    function setupSingPanel() {
        singPanel = PitchTestPanel.create({
            hostId: 'intervalsSingPanel',
            idPrefix: 'intervalsSing',
            title: 'Sing Test',
            subtitle: 'Sing the current pattern and watch your pitch against the targets. Turn Repeat on to hold one pattern.',
            storageKey: StorageKeys.PANEL_INTERVALS_SING,
            legendTargetLabel: 'target notes',
            emptyMessage: () => (currentInstance ? null : 'Press Go or Sing to get a pattern.'),
            key: () => ({
                rootMidi: noteNameToMidi(state.root, state.octave) ?? 60,
                rootLabel: scaleRootPitchString(state.root, state.octave),
                scaleType: state.scale
            }),
            rails: ({ expandRange }) => buildSingRails(expandRange),
            targets: buildSingTargets,
            contentDurationMs: () => (currentInstance ? currentInstance.notes.length * state.lengthMs : 4000),
            playNote: (midi, durationSec) => { if (piano) piano.playMidi(midi, durationSec); },
            onOpenChange: open => {
                const btn = document.getElementById('singBtn');
                if (!btn) return;
                btn.classList.toggle('selected', open);
                btn.setAttribute('aria-pressed', String(open));
            },
            progressTool: 'intervals-sing'
        });

        // Named state inspection for the test suite (deterministic
        // scoring via the panel's explicit recordSample seam).
        window.intervalsDebug = { panel: singPanel };

        // The Sing button is a toggle: open the panel, or dismiss it.
        document.getElementById('singBtn')?.addEventListener('click', async () => {
            if (!singPanel) return;
            if (singPanel.isOpen) {
                singPanel.close();
                return;
            }
            if (!currentInstance) {
                currentInstance = generateRandomInstance();
                if (currentInstance) showInstance(currentInstance);
            }
            await singPanel.open();
        });
    }

    // ---- UI ----
    function syncSteppers() {
        PracticeControls.setValueText('rootPitchValue', scaleRootPitchString(state.root, state.octave));
        PracticeControls.setValueText('lengthValue', PracticeControls.formatSeconds(state.lengthMs));
        PracticeControls.setValueText('gapValue', PracticeControls.formatGapLabel(state.gapMs));
        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(noteNameToMidi(state.root, state.octave), delta);
            }
            return PracticeControls.stepDisabled(ADJUSTER_VALUES[key] || [], state[key], delta);
        });
    }

    function updateLevelButtons() {
        const container = document.getElementById('levelOptions');
        container.innerHTML = '';
        const levels = state.exerciseType === 'A' ? DEGREE_LEVELS : CLUSTER_LEVELS;

        // If current selection is from wrong type, switch to first of correct type
        if (!levels.find(l => l.id === state.selectedLevel)) {
            state.selectedLevel = levels[0].id;
            saveSettings();
        }

        for (const lvl of levels) {
            const btn = document.createElement('button');
            btn.className = 'vf-btn';
            if (lvl.id === state.selectedLevel) btn.classList.add('selected');
            btn.textContent = lvl.name;
            btn.title = lvl.desc;
            btn.dataset.level = lvl.id;
            btn.addEventListener('click', () => {
                container.querySelectorAll('[data-level]').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                state.selectedLevel = lvl.id;
                saveSettings();
            });
            container.appendChild(btn);
        }
    }

    function initUI() {
        // Exercise type toggle
        PracticeControls.wireSingleSelect('data-type', String, state.exerciseType, value => {
            state.exerciseType = value || 'A';
            saveSettings();
            updateLevelButtons();
        });

        // Level buttons (initial)
        updateLevelButtons();

        // Single-select setting groups
        PracticeControls.wireSingleSelect('data-scale', String, state.scale, value => {
            state.scale = value;
            saveSettings();
        });

        // Root pitch / timing steppers (shared control)
        PracticeControls.wireSteppers((key, delta) => {
            if (key === 'rootPitch') {
                const midi = noteNameToMidi(state.root, state.octave);
                if (midi === null) return;
                const bounded = PracticeControls.stepRootMidi(midi, delta);
                const info = midiToNoteName(bounded);
                state.root = info.name;
                state.octave = info.octave;
            } else {
                const next = PracticeControls.stepValue(ADJUSTER_VALUES[key] || [], state[key], delta);
                if (next === null) return;
                state[key] = next;
            }
            saveSettings();
            syncSteppers();
        });
        syncSteppers();

        // Toggles
        const toggles = [
            { id: 'toggleSpeak', key: 'speakNumbers' },
            { id: 'togglePlayNotes', key: 'playNotes' },
            { id: 'toggleShowNames', key: 'showNoteNames' },
            { id: 'toggleExpandRange', key: 'expandRange' },
            { id: 'toggleReverse', key: 'reverse' },
            { id: 'toggleRepeat', key: 'repeat' },
        ];
        for (const { id, key } of toggles) {
            PracticeControls.wireToggle(id, Boolean(state[key]), checked => {
                state[key] = checked;
                saveSettings();
            });
        }

        document.getElementById('playBtn').addEventListener('click', runLoop);
        document.getElementById('stopBtn').addEventListener('click', stopLoop);
        document.getElementById('nextBtn').addEventListener('click', requestNext);

        history = HistoryList.create({
            listId: 'historyList',
            clearBtnId: 'clearHistoryBtn',
            emptyText: 'No patterns yet',
            renderItem: renderHistoryItem
        });

        setupSingPanel();
        setupTrainingModeSwitch();
        syncTrainingModeUI();

        MediaSessionCore.primeOnUserGesture();
    }

    // ---- BOOT ----
    async function boot() {
        readInitialTrainingMode();
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
        migrateLegacyEarsSettings();
        try {
            piano = await PianoCore.createPiano();
        } catch (err) {
            console.error('Error loading piano samples:', err);
            const display = document.getElementById('currentDisplay');
            if (display) display.textContent = 'Piano failed to load. Refresh to retry.';
        }
        initUI();
        await setupEarTraining();
        syncTrainingModeUI();
    }
    boot();
})();
