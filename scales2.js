// @ts-check
// Interval training -- two exercise types, level-based

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

    function ri(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

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
        exerciseType: 'A',
        selectedLevel: 'a1',
        running: false,
        stopRequested: false,
    };

    /** @type {InstanceType<typeof Tone.Sampler> | null} */
    let synth = null;
    /** @type {InstanceType<typeof Tone.Gain> | null} */
    let gainNode = null;

    // ---- AUDIO ----
    async function initAudio() {
        gainNode = new Tone.Gain(1).toDestination();
        return new Promise((resolve, reject) => {
            synth = new Tone.Sampler({
                urls: {
                    'A0': 'A0.mp3', 'C1': 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
                    'A1': 'A1.mp3', 'C2': 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
                    'A2': 'A2.mp3', 'C3': 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
                    'A3': 'A3.mp3', 'C4': 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
                    'A4': 'A4.mp3', 'C5': 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
                    'A5': 'A5.mp3', 'C6': 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
                    'A6': 'A6.mp3', 'C7': 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
                    'A7': 'A7.mp3', 'C8': 'C8.mp3',
                },
                baseUrl: 'https://tonejs.github.io/audio/salamander/',
                onload: () => { console.log('Piano loaded'); resolve(); },
                onerror: (err) => reject(err)
            }).connect(gainNode);
            synth.volume.value = -3;
        });
    }

    function playNote(noteName) {
        if (!synth) return;
        gainNode.gain.setValueAtTime(1, Tone.now());
        synth.triggerAttackRelease(noteName, state.lengthMs / 1000);
    }

    function stopAudio() {
        if (synth) synth.releaseAll();
        if (gainNode) gainNode.gain.setValueAtTime(0, Tone.now());
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ---- SCALE MATH ----
    function buildExtendedScale() {
        const pattern = SCALE_PATTERNS[state.scale] || SCALE_PATTERNS.major;
        const baseIntervals = pattern.filter(s => s < 12);
        const rootMidi = noteNameToMidi(state.root, state.octave);
        if (rootMidi === null) return [];
        const notes = [];
        for (let oct = 0; oct < 3; oct++) {
            for (const interval of baseIntervals) {
                const midi = rootMidi + oct * 12 + interval;
                const info = midiToNoteName(midi);
                notes.push({ midi, name: info.full, noteName: info.name, octave: info.octave });
            }
        }
        return notes;
    }

    function degreesPerOctave() {
        const pattern = SCALE_PATTERNS[state.scale] || SCALE_PATTERNS.major;
        return pattern.filter(s => s < 12).length;
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
        for (const off of gen.offsets) {
            const idx = startIdx + off;
            if (idx < 0 || idx >= scale.length) return null;
            noteNames.push(scale[idx].name);
            displayDegrees.push(off + 1);
        }

        if (state.reverse) { noteNames.reverse(); displayDegrees.reverse(); }
        const desc = state.reverse ? gen.label + ' rev' : gen.label;
        return { description: desc, displayDegrees, noteNames };
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
        for (const off of offsets) {
            const idx = startIdx + off;
            if (idx < 0 || idx >= scale.length) return null;
            noteNames.push(scale[idx].name);
            displayDegrees.push(off + 1);
        }

        if (state.reverse) { noteNames.reverse(); displayDegrees.reverse(); }
        const desc = state.reverse ? gen.label + ' rev' : gen.label;
        return { description: desc, displayDegrees, noteNames };
    }

    // ---- MAIN LOOP ----
    async function runLoop() {
        if (state.running) return;
        state.running = true;
        state.stopRequested = false;

        if (Tone.context.state !== 'running') {
            await Tone.start();
        }

        const display = document.getElementById('currentDisplay');

        let firstRound = true;
        while (!state.stopRequested) {
            const instance = generateRandomInstance();
            if (!instance) {
                display.textContent = 'Could not generate pattern -- check settings';
                break;
            }

            const degreeStr = instance.displayDegrees.join('-');
            const noteStr = instance.noteNames.join(' ');

            const namesPart = state.showNoteNames
                ? `<span style="color:rgba(255,255,255,0.5);font-size:0.9rem;margin-left:8px">${noteStr}</span>` : '';

            // Show display early so you can read it before the notes play
            display.innerHTML =
                `<span style="color:rgba(255,255,255,0.45);font-size:0.85rem">${instance.description}</span>` +
                `<span style="color:#86efac;font-weight:700;font-size:1.6rem">${degreeStr}</span>` +
                namesPart;

            addHistory(degreeStr, instance.description, noteStr);

            // Brief pause to read the display before audio starts
            if (!firstRound && !state.stopRequested) {
                await sleep(Math.min(state.gapMs, 400));
            }
            firstRound = false;

            if (state.speakNumbers && !state.stopRequested) {
                await VoiceOutput.speak(instance.displayDegrees.join(', '));
            }

            if (state.playNotes && !state.stopRequested) {
                for (const note of instance.noteNames) {
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
        stopAudio();
    }

    // ---- HISTORY ----
    function addHistory(degrees, desc, notes) {
        const list = document.getElementById('historyList');
        if (!list) return;
        const empty = list.querySelector('.history-empty');
        if (empty) empty.remove();

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML =
            `<span class="history-text" style="color:rgba(255,255,255,0.5);min-width:100px">${desc}</span>` +
            `<span class="history-text" style="font-weight:600;color:#86efac">${degrees}</span>` +
            `<span class="history-text" style="color:rgba(255,255,255,0.5)">${notes}</span>` +
            `<span class="history-time">${new Date().toLocaleTimeString()}</span>`;
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
            });
            container.appendChild(btn);
        }
    }

    function initUI() {
        // Exercise type toggle
        document.querySelectorAll('[data-type]').forEach(btn => {
            if (btn.dataset.type === state.exerciseType) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                state.exerciseType = btn.dataset.type;
                updateLevelButtons();
            });
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
            document.querySelectorAll(`[${attr}]`).forEach(btn => {
                if (String(parse(btn.getAttribute(attr))) === String(state[stateKey])) {
                    btn.classList.add('selected');
                }
                btn.addEventListener('click', () => {
                    document.querySelectorAll(`[${attr}]`).forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    state[stateKey] = parse(btn.getAttribute(attr));
                });
            });
        }

        // Toggles
        const toggles = [
            { id: 'toggleSpeak', key: 'speakNumbers' },
            { id: 'togglePlayNotes', key: 'playNotes' },
            { id: 'toggleShowNames', key: 'showNoteNames' },
            { id: 'toggleExpandRange', key: 'expandRange' },
            { id: 'toggleReverse', key: 'reverse' },
        ];
        for (const { id, key } of toggles) {
            const el = document.getElementById(id);
            el.checked = state[key];
            el.addEventListener('change', () => { state[key] = el.checked; });
        }

        document.getElementById('playBtn').addEventListener('click', runLoop);
        document.getElementById('stopBtn').addEventListener('click', stopLoop);
        document.getElementById('clearHistoryBtn').addEventListener('click', () => {
            document.getElementById('historyList').innerHTML =
                '<p class="history-empty">No patterns yet</p>';
        });
    }

    // ---- BOOT ----
    async function boot() {
        await initAudio();
        initUI();
        console.log('Intervals page ready');
    }
    boot();
})();
