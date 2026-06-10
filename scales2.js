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
        running: false,
        stopRequested: false,
        nextRequested: false,
    };

    const STORAGE_KEY = 'intervals-settings';
    const PERSISTED_KEYS = [
        'root', 'octave', 'scale', 'lengthMs', 'gapMs', 'speakNumbers',
        'playNotes', 'showNoteNames', 'expandRange', 'reverse', 'repeat',
        'exerciseType', 'selectedLevel'
    ];

    /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
    let piano = null;

    const sleep = PianoCore.sleep;

    function saveSettings() {
        SettingsStore.save(STORAGE_KEY, state, PERSISTED_KEYS);
    }

    function playNote(noteName) {
        if (!piano) return;
        piano.playName(noteName, state.lengthMs / 1000);
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

        const noteNames = [];
        const displayDegrees = [];
        const spokenDegrees = [];
        for (const off of gen.offsets) {
            const idx = startIdx + off;
            if (idx < 0 || idx >= scale.length) return null;
            noteNames.push(scale[idx].name);
            displayDegrees.push(PatternPracticeCore.offsetToDegree(off, dpOct));
            spokenDegrees.push(PatternPracticeCore.offsetToSpoken(off, dpOct));
        }

        if (state.reverse) { noteNames.reverse(); displayDegrees.reverse(); spokenDegrees.reverse(); }
        const desc = state.reverse ? gen.label + ' rev' : gen.label;
        return { description: desc, displayDegrees, spokenDegrees, noteNames };
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

        const noteNames = [];
        const displayDegrees = [];
        const spokenDegrees = [];
        for (const off of offsets) {
            const idx = startIdx + off;
            if (idx < 0 || idx >= scale.length) return null;
            noteNames.push(scale[idx].name);
            displayDegrees.push(PatternPracticeCore.offsetToDegree(off, dpOct));
            spokenDegrees.push(PatternPracticeCore.offsetToSpoken(off, dpOct));
        }

        if (state.reverse) { noteNames.reverse(); displayDegrees.reverse(); spokenDegrees.reverse(); }
        const desc = state.reverse ? gen.label + ' rev' : gen.label;
        return { description: desc, displayDegrees, spokenDegrees, noteNames };
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
        let currentInstance = null;

        while (!state.stopRequested) {
            // Generate new pattern unless repeating the same one
            if (!currentInstance || !state.repeat || state.nextRequested) {
                state.nextRequested = false;
                currentInstance = generateRandomInstance();
                if (!currentInstance) {
                    display.textContent = 'Could not generate pattern -- check settings';
                    break;
                }
            }

            const degreeStr = currentInstance.displayDegrees.join('-');
            const noteStr = currentInstance.noteNames.join(' ');

            const namesPart = state.showNoteNames
                ? `<span class="pattern-notes">${noteStr}</span>` : '';

            display.innerHTML = `<span class="pattern-desc">${currentInstance.description}</span><span class="pattern-degrees">${degreeStr}</span>${namesPart}`;

            if (!firstRound || !state.repeat) {
                addHistory(degreeStr, currentInstance.description, noteStr);
            }

            // Brief pause to read the display before audio starts
            if (!firstRound && !state.stopRequested) {
                await sleep(Math.min(state.gapMs, 400));
            }
            firstRound = false;

            if (state.speakNumbers && !state.stopRequested) {
                await VoiceOutput.speak(currentInstance.spokenDegrees.join(', '));
            }

            if (state.playNotes && !state.stopRequested) {
                for (const note of currentInstance.noteNames) {
                    if (state.stopRequested) break;
                    playNote(note);
                    await sleep(state.lengthMs);
                }
            }

            if (!state.stopRequested) {
                await sleep(state.gapMs);
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
    }

    function requestNext() {
        state.nextRequested = true;
    }

    // ---- HISTORY ----
    function addHistory(degrees, desc, notes) {
        const list = document.getElementById('historyList');
        if (!list) return;
        const empty = list.querySelector('.history-empty');
        if (empty) empty.remove();

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `<span class="history-text history-desc">${desc}</span><span class="history-text history-degrees">${degrees}</span><span class="history-text history-notes">${notes}</span><span class="history-time">${new Date().toLocaleTimeString()}</span>`;
        list.prepend(item);
        while (list.children.length > 50) list.lastChild.remove();
    }

    // ---- UI ----
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
        const singleGroups = [
            { attr: 'data-root', stateKey: 'root', parse: String },
            { attr: 'data-octave', stateKey: 'octave', parse: Number },
            { attr: 'data-scale', stateKey: 'scale', parse: String },
            { attr: 'data-length', stateKey: 'lengthMs', parse: Number },
            { attr: 'data-gap', stateKey: 'gapMs', parse: Number },
        ];
        for (const { attr, stateKey, parse } of singleGroups) {
            PracticeControls.wireSingleSelect(attr, parse, state[stateKey], value => {
                state[stateKey] = value;
                saveSettings();
            });
        }

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
        document.getElementById('clearHistoryBtn').addEventListener('click', () => {
            document.getElementById('historyList').innerHTML =
                '<p class="history-empty">No patterns yet</p>';
        });

        MediaSessionCore.register('Intervals', [
            ['play', () => { runLoop(); }],
            ['pause', () => { stopLoop(); }],
            ['nexttrack', () => { requestNext(); }],
            ['seekforward', () => { requestNext(); }]
        ]);
        MediaSessionCore.primeOnUserGesture();
    }

    // ---- BOOT ----
    async function boot() {
        SettingsStore.load(STORAGE_KEY, state, PERSISTED_KEYS);
        piano = await PianoCore.createPiano();
        initUI();
    }
    boot();
})();
