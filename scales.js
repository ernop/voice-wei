// @ts-check
//-----------------------------------------------------------------------
// SCALES - scale practice: the option buttons say what plays, the piano
// keyboard shows it, and the Sing panel scores singing against it.
// Uses Tone.js for piano sound synthesis
//-----------------------------------------------------------------------

// Playback coordinator lives in scales-playback.js; note patterns in scales-patterns.js

// Default octave for scales
const DEFAULT_OCTAVE = 4;

// Loop timing (NOT the per-note gap control)
const FOREVER_SECTION_GAP_MS = 1000; // 1s gap between sections when looping ("forever" mode)

const SCALES_PRESETS_STORAGE_KEY = StorageKeys.SCALES_PRESETS;

// Option names in the words of each option button: the readout, preset
// titles, and history all describe a setting with the words on its button
// (tests/test-scales-keyboard.js holds them equal).
// Scale types read as their names with spaces.
/** @type {Record<string, Record<string, string>>} */
const SCALES_OPTION_LABELS = {
    sectionLength: { '1o': '1 octave', '1o+3': 'octave+3rd', '1o+5': 'octave+5th', '2o': '2 octaves' },
    direction: { ascending: 'up', descending: 'down', both: 'up+down', down_and_up: 'down+up' },
    movementStyle: {
        normal: 'normal', stop_and_go: '+1+2', one_three_five: '1-3-5', neighbors: 'neighbors', chords: 'chords',
        from_one: 'from 1', to_one: 'to 1', plus_minus_one: '+1-1',
        chromatic_stop_and_go: '+1+2 chrom', plus_minus_half: '+1-1 chrom',
        third_up: '3rd up', fourth_up: '4th up', fifth_up: '5th up', sixth_up: '6th up', seventh_up: '7th up',
        third_down: '3rd down', fourth_down: '4th down', fifth_down: '5th down', sixth_down: '6th down', seventh_down: '7th down'
    },
    exercise: { none: 'full scale', five_note: '5-note', octave_jump: 'octave jump', arpeggio_return: 'arp return', thirds: 'thirds' },
    risingSemitones: { 0: 'off', 1: 'half', 2: 'whole' }
};

/**
 * A repeat setting in the Repeat buttons' words.
 * @param {number} count @param {number} gapMs
 */
function scalesRepeatLabel(count, gapMs) {
    if (count === Infinity) return gapMs === 0 ? '\u221e+no gap' : '\u221e';
    if (count === 2) return 'twice';
    return count > 2 ? `${count}x` : 'once';
}

/** @param {string} className @param {string} text */
function scalesTextSpan(className, text) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
}

/**
 * Repair saved practice settings in place: a value that names no current
 * option loads as its default. Voice commands (removed 2026-10-27) stored
 * root "E#" for "E sharp" and rose by intervals no button offers, and early
 * versions had a 'centered' section width.
 * @param {Partial<ScalesSettings>} stored
 * @param {ScalesSettings} defaults
 */
function scalesRepairStored(stored, defaults) {
    if (!NOTE_NAMES.includes(stored.root)) stored.root = defaults.root;
    if (!(String(stored.scaleType) in SCALE_PATTERNS)) stored.scaleType = defaults.scaleType;
    if (!(String(stored.risingSemitones) in SCALES_OPTION_LABELS.risingSemitones)) stored.risingSemitones = defaults.risingSemitones;
    for (const key of /** @type {const} */ (['sectionLength', 'direction', 'movementStyle', 'exercise'])) {
        if (!(String(stored[key]) in SCALES_OPTION_LABELS[key])) stored[key] = defaults[key];
    }
}

// Ladder rung sizes offered by the stepper (notes per rung)
const SCALES_LADDER_SIZE_VALUES = [2, 3, 4, 5, 6, 7, 8];

const SCALES_SETTINGS_STORAGE_KEY = StorageKeys.SCALES_SETTINGS;

//-------SCALES CONTROLLER-------

/**
 * @typedef {Object} ScalesSettings
 * @property {number} noteLengthMs - Note duration in milliseconds
 * @property {number} gapMs - Gap between notes (ms if positive, overlap ratio if negative)
 * @property {string} direction
 * @property {number} octave
 * @property {number} repeatCount
 * @property {number} repeatGapMs
 * @property {number} risingSemitones
 * @property {string} movementStyle
 * @property {string} scaleType
 * @property {string} root
 * @property {string} sectionLength
 * @property {string} exercise
 * @property {number} shiftingSteps
 * @property {number} chopHead
 * @property {string} ladder
 * @property {number} ladderSize
 * @property {number} ladderGapMs
 */

/**
 * @typedef {Object} Preset
 * @property {string} id
 * @property {string} name
 * @property {ScalesSettings} config
 * @property {number} [createdAt]
 */

/**
 * A history row: a scale that played, or an error.
 * @typedef {Object} HistoryEntry
 * @property {'scale' | 'error'} type
 * @property {ScalesSettings} [config] - the settings the scale played with
 * @property {string} [description]
 * @property {string} [message]
 * @property {Object} [details]
 * @property {Date} timestamp
 */

/**
 * What the keyboard shows: the key it spells and numbers notes in, and
 * the readout line naming what is (or would be) playing.
 * @typedef {Object} ScalesShown
 * @property {string} text
 * @property {number} rootMidi
 * @property {string} scaleType
 */

class ScalesController {
    constructor() {
        // Honest car/lock-screen transport state: most head units render one
        // play/pause toggle and route the press by this state, so claiming
        // 'playing' while idle turns every play press into a pause command.
        this.audio = new window.ScalesPlayback.AudioCoordinator(
            playing => MediaSessionCore.setPlaybackState(playing ? 'playing' : 'paused'));
        /** @type {ReturnType<typeof PianoKeyboard.create> | null} */
        this.keyboard = null;
        // Set when the piano samples failed to load; it then holds the
        // readout, since nothing can play.
        /** @type {string | null} */
        this.loadFailure = null;
        // Invalidates the pending "back to the settings view" of a single
        // note when anything else takes the display.
        this.flashId = 0;
        /** @type {Preset[]} */
        this.presets = [];
        /** @type {string | null} */
        this.selectedPresetId = null;
        // What Reset restores.
        /** @type {ScalesSettings} */
        this.defaultSettings = {
            noteLengthMs: 300,  // note duration in milliseconds
            gapMs: 0,           // gap between notes in ms (or negative for overlap ratio)
            direction: 'ascending', // ascending, descending, both, down_and_up
            octave: DEFAULT_OCTAVE,
            repeatCount: 1,   // 1=once, 2=twice, Infinity=forever
            // Section gap: used for "forever" modes only (between phrase sections and between loop cycles)
            // This is NOT the UI "Gap" control which is between NOTES.
            repeatGapMs: FOREVER_SECTION_GAP_MS,
            risingSemitones: 0, // 0=off, otherwise transpose each repeat upward by this many semitones
            movementStyle: 'normal', // normal, stop_and_go, one_three_five, neighbors, chords, from_one, to_one, plus_minus_one, chromatic_stop_and_go, plus_minus_half, or a ScalesPatterns.INTERVAL_MOVEMENTS key
            scaleType: 'major',
            root: 'C',
            sectionLength: '1o', // '1o', '1o+3', '1o+5', '2o'
            exercise: 'none', // 'none', 'five_note', 'octave_jump', 'arpeggio_return', 'thirds'
            shiftingSteps: 0,  // 0=off, 1=shift up 1 scale degree each repeat, etc.
            chopHead: 0,       // 0=off, 1=each pass drops the first note (12345678, 2345678, ...)
            // Ladder: overlapping fixed-size rungs shifting one degree at a
            // time (123, 234, 345, ...). 'reverse' plays each rung toward
            // the new note first (321, 432, 543, ...).
            ladder: 'off',     // 'off', 'on', 'reverse'
            ladderSize: 3,     // notes per rung
            ladderGapMs: 500   // pause between rungs; 0 plays straight through
        };
        this.settings = { ...this.defaultSettings };

        // Exercise pattern templates use scale degree offsets from starting note.
        // 'O' is a placeholder for "one octave up" (resolved to notesPerOctave at runtime).
        // This makes patterns work correctly for any scale, not just 7-note diatonic.
        /** @type {Record<string, (number | 'O')[]>} */
        this.exercisePatterns = {
            'none': [],
            'five_note': [0, 1, 2, 3, 4, 3, 2, 1, 0],         // 1-2-3-4-5-4-3-2-1
            'octave_jump': [0, 'O', 0],                         // 1-8va-1
            'arpeggio_return': [0, 2, 4, 'O', 4, 2, 0],        // 1-3-5-8va-5-3-1
            'thirds': [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 'O']  // 1-3-2-4-3-5-...-8va
        };

        // Play history for replay (HistoryList created in setupUI)
        /** @type {ReturnType<typeof HistoryList.create> | null} */
        this.history = null;
        /** @type {number} */
        this.maxHistoryLength = 50;

        // Note: settings store actual values (noteLengthMs in ms, gapMs in
        // ms or negative for overlap ratio); labels and interpretation come
        // from PracticeControls (shared across pages).
        this.init();
    }

    async init() {
        try {
            await this.audio.init();
        } catch (err) {
            console.error('Error loading piano samples:', err);
            this.showLoadFailure('Piano failed to load. Refresh to retry.');
        }
        this.loadSettings();
        this.setupUI();
        this.setupSingPanel();
        this.loadPresetsFromStorage();
        this.renderPresets();
        this.setupErrorHandling();
        this.setupMediaSession();
    }

    // Embedded "listen" panel pre-seeded with the current scale: rails are
    // the scale degrees in the section range, targets are the planned
    // playback notes at the current note length and gap.
    setupSingPanel() {
        this.singPanel = PitchTestPanel.create({
            hostId: 'scalesSingPanel',
            idPrefix: 'scalesSing',
            title: 'Sing Test',
            subtitle: 'Sing the current scale and watch your pitch against the target notes.',
            storageKey: StorageKeys.PANEL_SCALES_SING,
            legendTargetLabel: 'target notes',
            key: () => ({
                rootMidi: noteNameToMidi(this.settings.root, this.settings.octave),
                rootLabel: scaleRootPitchString(this.settings.root, this.settings.octave),
                scaleType: this.settings.scaleType
            }),
            rails: ({ expandRange }) => this.buildSingRails(expandRange),
            targets: () => this.buildSingTargets(),
            contentDurationMs: () => this.singContentDurationMs(),
            playNote: (midi, durationSec) => this.audio.piano?.playMidi(midi, durationSec),
            onOpenChange: open => this.syncSingButton(open),
            progressTool: 'scales-sing',
            statsMode: () => 'scales'
        });

        // The Sing button is a toggle: open the panel, or dismiss it.
        const singBtn = document.getElementById('singBtn');
        if (singBtn) singBtn.addEventListener('click', () => {
            if (this.singPanel.isOpen) {
                this.singPanel.close();
                return;
            }
            this.singPanel.open();
        });
    }

    /** @param {boolean} open */
    syncSingButton(open) {
        const btn = document.getElementById('singBtn');
        if (!btn) return;
        btn.classList.toggle('selected', open);
        btn.setAttribute('aria-pressed', String(open));
        document.getElementById('scalesSingDock')?.classList.toggle('open', open);
    }

    /** @param {boolean} expandRange */
    buildSingRails(expandRange) {
        const { min, max } = ScalesPatterns.getSectionRange(this.settings.sectionLength);
        // Rails must cover every planned note, not just the section
        // range: chords movement stacks thirds and fifths up to a
        // twelfth above the root, and exercises can leave the section
        // too. Uncovered targets used to draw clipped at the top of the
        // chart with no rails behind them.
        let lower = min;
        let upper = max;
        const rootMidi = noteNameToMidi(this.settings.root, this.settings.octave);
        for (const midi of this.patternNotes(0)) {
            lower = Math.min(lower, Math.floor(midi - rootMidi));
            upper = Math.max(upper, Math.ceil(midi - rootMidi));
        }
        if (expandRange) {
            lower -= 12;
            upper += 12;
        }
        return scaleDegreeNotesInRange(this.settings.root, this.settings.octave, this.settings.scaleType, lower, upper)
            .map(note => ({
                midi: note.midi,
                label: `${note.degree} ${note.name}`,
                emphasized: note.interval >= 0 && note.interval <= 12
            }));
    }

    // Targets are the first pass (shifting and rising move later ones).
    buildSingTargets() {
        const { ms, gap } = this.getNoteDuration();
        const stepMs = ms + gap;
        return this.patternNotes(0).map((midi, index) => ({
            midi,
            startMs: index * stepMs,
            endMs: index * stepMs + ms,
            label: scaleMidiToNoteName(this.settings.root, this.settings.octave, this.settings.scaleType, midi),
            active: true
        }));
    }

    singContentDurationMs() {
        const { ms, gap } = this.getNoteDuration();
        return this.patternNotes(0).length * (ms + gap);
    }

    // JSON cannot store Infinity, so "repeat forever" round-trips as -1.
    loadSettings() {
        const snapshot = { ...this.settings };
        SettingsStore.load(SCALES_SETTINGS_STORAGE_KEY, snapshot, Object.keys(this.defaultSettings));
        if (snapshot.repeatCount === -1) snapshot.repeatCount = Infinity;
        scalesRepairStored(snapshot, this.defaultSettings);
        Object.assign(this.settings, snapshot);
    }

    saveSettings() {
        const snapshot = { ...this.settings };
        if (snapshot.repeatCount === Infinity) snapshot.repeatCount = -1;
        SettingsStore.save(SCALES_SETTINGS_STORAGE_KEY, snapshot, Object.keys(this.defaultSettings));
    }

    setupMediaSession() {
        MediaSessionCore.register('Scales', [
            ['play', () => { this.playCurrentSettings(); }],
            ['pause', () => { this.stopPlayback(); }]
        ]);
        MediaSessionCore.setPlaybackState('paused');
    }

    // The keyboard's readout is the page's status surface; loading is
    // silent unless it fails.
    /** @param {string} message */
    showLoadFailure(message) {
        this.loadFailure = message;
        this.setReadoutPlan('');
    }

    /** Disable each stepper button at the end of its value list. */
    syncStepperLimits() {
        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(
                    noteNameToMidi(this.settings.root, this.settings.octave), delta);
            }
            if (key === 'noteLengthMs') {
                return PracticeControls.stepDisabled(PracticeControls.NOTE_LENGTH_VALUES, this.settings.noteLengthMs, delta);
            }
            if (key === 'ladderSize') {
                return PracticeControls.stepDisabled(SCALES_LADDER_SIZE_VALUES, this.settings.ladderSize, delta);
            }
            if (key === 'ladderGapMs') {
                return PracticeControls.stepDisabled(PracticeControls.TIME_VALUES_MS, this.settings.ladderGapMs, delta);
            }
            return PracticeControls.stepDisabled(PracticeControls.GAP_VALUES, this.settings.gapMs, delta);
        });
    }

    /**
     * Stepper handler for the root pitch, timing, and ladder controls.
     * @param {string} key @param {number} delta
     */
    stepSettingValue(key, delta) {
        if (key === 'rootPitch') {
            const midi = noteNameToMidi(this.settings.root, this.settings.octave);
            if (midi === null) return;
            const bounded = PracticeControls.stepRootMidi(midi, delta);
            const info = midiToNoteName(bounded);
            this.settings.root = info.name;
            this.settings.octave = info.octave;
        } else if (key === 'noteLengthMs') {
            const next = PracticeControls.stepValue(PracticeControls.NOTE_LENGTH_VALUES, this.settings.noteLengthMs, delta);
            if (next === null) return;
            this.settings.noteLengthMs = next;
        } else if (key === 'gapMs') {
            const next = PracticeControls.stepValue(PracticeControls.GAP_VALUES, this.settings.gapMs, delta);
            if (next === null) return;
            this.settings.gapMs = next;
        } else if (key === 'ladderSize') {
            const next = PracticeControls.stepValue(SCALES_LADDER_SIZE_VALUES, this.settings.ladderSize, delta);
            if (next === null) return;
            this.settings.ladderSize = next;
        } else if (key === 'ladderGapMs') {
            const next = PracticeControls.stepValue(PracticeControls.TIME_VALUES_MS, this.settings.ladderGapMs, delta);
            if (next === null) return;
            this.settings.ladderGapMs = next;
        } else {
            return;
        }
        this.onSettingChanged();
    }

    // Rising implies forever - if rising is enabled and repeat isn't already forever, set it
    setRisingSemitones(semitones) {
        this.settings.risingSemitones = semitones;
        if (semitones > 0) {
            // Rising, shifting, and chop head are mutually exclusive
            this.settings.shiftingSteps = 0;
            this.settings.chopHead = 0;
            if (this.settings.repeatCount !== Infinity) {
                this.settings.repeatCount = Infinity;
            }
        }
    }

    // Shifting implies forever - if shifting is enabled and repeat isn't already forever, set it
    setShiftingSteps(steps) {
        this.settings.shiftingSteps = steps;
        if (steps > 0) {
            // Rising, shifting, and chop head are mutually exclusive
            this.settings.risingSemitones = 0;
            this.settings.chopHead = 0;
            if (this.settings.repeatCount !== Infinity) {
                this.settings.repeatCount = Infinity;
            }
        }
    }

    // Set exercise and optionally enable shifting
    setExercise(exercise, enableShifting = false) {
        this.settings.exercise = exercise;
        if (exercise !== 'none') {
            // Exercises play through their own pattern engine; chop head and
            // ladder only apply to the plain scale sequence.
            this.settings.chopHead = 0;
            this.settings.ladder = 'off';
        }
        if (enableShifting && exercise !== 'none') {
            this.setShiftingSteps(1); // Default to shifting by 1 scale degree
        }
    }

    // Chop head: successive passes drop the leading note (12345678 -> 2345678 -> ...).
    // It replaces the other per-repeat transforms, so enabling it clears them.
    setChopHead(on) {
        this.settings.chopHead = on ? 1 : 0;
        if (on) {
            this.settings.risingSemitones = 0;
            this.settings.shiftingSteps = 0;
            this.settings.exercise = 'none';
            this.settings.movementStyle = 'normal';
            this.settings.ladder = 'off';
        }
    }

    // Ladder: overlapping fixed-size rungs walking the scale one degree at a
    // time. It owns sequence generation, so enabling it clears the other
    // generators (exercise, movement, chop head). Rising still composes:
    // each full ladder cycle transposes up like any other repeated sequence.
    /** @param {string} mode - 'off', 'on', or 'reverse' */
    setLadder(mode) {
        this.settings.ladder = mode;
        if (mode !== 'off') {
            this.settings.chopHead = 0;
            this.settings.shiftingSteps = 0;
            this.settings.exercise = 'none';
            this.settings.movementStyle = 'normal';
        }
    }

    // A movement figure decorates the plain walk, which chop head and the
    // ladder replace, so choosing one clears them.
    /** @param {string} style */
    setMovementStyle(style) {
        this.settings.movementStyle = style;
        if (style !== 'normal') {
            this.settings.chopHead = 0;
            this.settings.ladder = 'off';
        }
    }

    /**
     * The option button groups: the data attribute on each button, the
     * setting its value names, and how choosing it applies (the modes that
     * exclude each other go through their setters). Repeat buttons hold a
     * count and a gap together and are wired on their own.
     * @returns {[string, keyof ScalesSettings, (value: any) => void][]}
     */
    optionGroups() {
        return [
            ['scale-type', 'scaleType', value => { this.settings.scaleType = value; }],
            ['direction', 'direction', value => { this.settings.direction = value; }],
            ['section-length', 'sectionLength', value => { this.settings.sectionLength = value; }],
            ['movement', 'movementStyle', value => this.setMovementStyle(value)],
            ['exercise', 'exercise', value => this.setExercise(value, value !== 'none')],
            ['ladder', 'ladder', value => this.setLadder(value)],
            ['rising', 'risingSemitones', value => this.setRisingSemitones(value)],
            ['shifting', 'shiftingSteps', value => this.setShiftingSteps(value)],
            ['chop-head', 'chopHead', value => this.setChopHead(value)]
        ];
    }

    /**
     * A button's value, typed like its setting (rising "1" is 1).
     * @param {Element} btn @param {string} attribute @param {keyof ScalesSettings} key
     */
    optionValue(btn, attribute, key) {
        const raw = btn.getAttribute(`data-${attribute}`);
        return typeof this.defaultSettings[key] === 'number' ? Number(raw) : raw;
    }

    setupUI() {
        // Stop button (main)
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopPlayback());
        }

        // Play button: always plays what the settings show
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.addEventListener('click', () => this.playCurrentSettings());
        }

        // Play history list (shared component owns rendering + clear)
        this.history = HistoryList.create({
            listId: 'historyList',
            clearBtnId: 'clearHistoryBtn',
            emptyText: 'Nothing played yet',
            max: this.maxHistoryLength,
            renderItem: (entry, index) => this.renderHistoryItem(entry, index)
        });

        // Copy all history button
        const copyAllHistoryBtn = document.getElementById('copyAllHistoryBtn');
        if (copyAllHistoryBtn) {
            copyAllHistoryBtn.addEventListener('click', () => this.copyAllHistory());
        }

        this.setupKeyboard();
        this.setupOptionButtons();

        // Presets ("playlist" of configs)
        this.setupPresetUI();
    }

    setupPresetUI() {
        const saveBtn = document.getElementById('savePresetBtn');
        const applyBtn = document.getElementById('applyPresetBtn');
        const deleteBtn = document.getElementById('deletePresetBtn');
        const nameInput = /** @type {HTMLInputElement | null} */ (document.getElementById('presetNameInput'));

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const name = (nameInput?.value || '').trim();
                this.saveCurrentAsPreset(name);
                if (nameInput) nameInput.value = '';
            });
        }

        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                if (!this.selectedPresetId) return;
                this.applyPresetById(this.selectedPresetId);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (!this.selectedPresetId) return;
                this.deletePresetById(this.selectedPresetId);
            });
        }
    }

    loadPresetsFromStorage() {
        this.presets = SettingsStore.loadJson(
            SCALES_PRESETS_STORAGE_KEY,
            [],
            value => Array.isArray(value)
        );
        for (const preset of this.presets) {
            // JSON writes a forever repeat (Infinity) as null.
            if (preset.config.repeatCount === null) preset.config.repeatCount = Infinity;
            scalesRepairStored(preset.config, this.defaultSettings);
        }
        if (this.selectedPresetId && !this.presets.some(p => p.id === this.selectedPresetId)) {
            this.selectedPresetId = null;
        }
    }

    savePresetsToStorage() {
        SettingsStore.saveJson(SCALES_PRESETS_STORAGE_KEY, this.presets);
    }

    /** @returns {ScalesSettings} the practice settings, as a preset or history row keeps them */
    getCurrentConfigSnapshot() {
        const keys = /** @type {(keyof ScalesSettings)[]} */ (Object.keys(this.defaultSettings));
        return /** @type {ScalesSettings} */ (Object.fromEntries(keys.map(key => [key, this.settings[key]])));
    }

    /** @param {string} name */
    saveCurrentAsPreset(name) {
        const now = Date.now();
        const config = this.getCurrentConfigSnapshot();

        const preset = {
            id: `${now}-${Math.random().toString(16).slice(2)}`,
            name: name || this.describeSettings(config),
            createdAt: now,
            config
        };

        // Newest at top
        this.presets.unshift(preset);
        this.selectedPresetId = preset.id;
        this.savePresetsToStorage();
        this.renderPresets();
    }

    /** @param {string} id */
    applyPresetById(id) {
        const preset = this.presets.find(p => p.id === id);
        if (!preset) return;

        this.applyConfig(preset.config);
        this.selectedPresetId = id;
        this.renderPresets();
    }

    /**
     * Put a preset's or history row's settings back. A config saved before
     * a setting existed gets that setting's default.
     * @param {Partial<ScalesSettings>} stored
     */
    applyConfig(stored) {
        const c = { ...this.defaultSettings, ...stored };
        this.settings.noteLengthMs = c.noteLengthMs;
        this.settings.gapMs = c.gapMs;
        this.settings.direction = c.direction;
        this.settings.octave = c.octave;
        this.settings.repeatCount = c.repeatCount;
        this.settings.repeatGapMs = c.repeatGapMs;
        this.setRisingSemitones(c.risingSemitones); // May override repeatCount if rising > 0
        this.settings.movementStyle = c.movementStyle;
        this.settings.scaleType = c.scaleType;
        this.settings.root = c.root;
        this.settings.sectionLength = c.sectionLength;
        this.settings.exercise = c.exercise;
        this.settings.shiftingSteps = c.shiftingSteps;
        this.setChopHead(c.chopHead);
        this.settings.ladderSize = c.ladderSize;
        this.settings.ladderGapMs = c.ladderGapMs;
        this.setLadder(c.ladder);

        this.onSettingChanged();
    }

    /** @param {string} id */
    deletePresetById(id) {
        const idx = this.presets.findIndex(p => p.id === id);
        if (idx === -1) return;
        this.presets.splice(idx, 1);
        if (this.selectedPresetId === id) {
            this.selectedPresetId = this.presets[0]?.id || null;
        }
        this.savePresetsToStorage();
        this.renderPresets();
    }

    // One line per config: its name, what it plays when the name says
    // something else, and when it was saved.
    renderPresets() {
        const list = document.getElementById('presetList');
        if (!list) return;

        if (!this.presets.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'No saved configs yet';
            list.replaceChildren(empty);
            return;
        }

        list.replaceChildren(...this.presets.map(preset => {
            const summary = this.describeSettings(preset.config);
            const item = document.createElement('div');
            item.className = preset.id === this.selectedPresetId ? 'preset-item selected' : 'preset-item';
            item.title = summary;
            item.append(scalesTextSpan('preset-item-name', preset.name || summary));
            if (preset.name && preset.name !== summary) item.append(scalesTextSpan('preset-item-summary', summary));
            item.append(scalesTextSpan('preset-item-time', this.formatTime(new Date(preset.createdAt))));
            item.addEventListener('click', () => {
                this.selectedPresetId = preset.id;
                this.renderPresets();
            });
            item.addEventListener('dblclick', () => this.applyPresetById(preset.id));
            return item;
        }));
    }

    //-------KEYBOARD DISPLAY-------
    // The keyboard and the readout line above it are the page's display.
    // At rest they show what Play plays: the first pass of the current
    // settings. A running scale shows each pass as it starts (rising and
    // shifting move it) and lights each note as it sounds.

    setupKeyboard() {
        this.keyboard = PianoKeyboard.create({
            hostId: 'pianoKeyboard',
            onKeyPress: async midi => {
                await this.ensureAudioStarted();
                this.soundSingleNote(midi, '8n');
            }
        });
    }

    /**
     * Notes of one pass of the current settings before any rising
     * transposition: the exercise repetition (shifting moves its start),
     * or the scale sequence.
     * @param {number} pass
     * @returns {number[]}
     */
    patternNotes(pass) {
        const s = this.settings;
        const exercisePattern = this.settingsExercisePattern();
        if (exercisePattern) {
            const rootMidi = noteNameToMidi(s.root, s.octave);
            return ScalesPatterns.buildExerciseNotes(rootMidi, s.scaleType, exercisePattern, s.shiftingSteps * pass);
        }
        return this.settingsPass().notes;
    }

    /** @returns {(number | 'O')[] | null} the exercise the settings play instead of the scale, if any */
    settingsExercisePattern() {
        const pattern = this.exercisePatterns[this.settings.exercise];
        return pattern && pattern.length > 0 ? pattern : null;
    }

    /** @returns {ScalesPass} one pass of the scale the settings describe */
    settingsPass() {
        const s = this.settings;
        return ScalesPatterns.buildScalePlaybackPlan({
            rootMidi: noteNameToMidi(s.root, s.octave),
            scaleType: s.scaleType,
            direction: s.direction,
            movementStyle: s.movementStyle,
            sectionLength: s.sectionLength,
            ladder: s.ladder,
            ladderSize: s.ladderSize,
            seamlessLoop: s.repeatCount === Infinity && s.repeatGapMs === 0
        });
    }

    /** @returns {ScalesShown} the current settings' key and description */
    settingsShown() {
        return {
            text: this.describeSettings(this.settings),
            rootMidi: noteNameToMidi(this.settings.root, this.settings.octave),
            scaleType: this.settings.scaleType
        };
    }

    /** The settings view: what Play plays, nothing sounding. */
    showIdle() {
        this.showPass(this.settingsShown(), this.patternNotes(0));
    }

    /**
     * Draw one pass: the board around `notes` raised by `transpose` (the
     * rising offset), spelled and numbered in the shown key raised the
     * same, and the readout describing it with nothing sounding yet.
     * @param {ScalesShown} shown
     * @param {number[]} notes
     * @param {number} [transpose]
     */
    showPass(shown, notes, transpose = 0) {
        this.flashId++;
        const rootMidi = shown.rootMidi + transpose;
        this.keyboard.show({
            root: NOTE_NAMES[midiPitchClass(rootMidi)],
            octave: midiOctave(rootMidi),
            scaleType: shown.scaleType,
            notes: notes.map(midi => midi + transpose)
        });
        this.setReadoutPlan(shown.text);
        this.showSounding([]);
    }

    /**
     * Light exactly these pitches and name them on the readout, each
     * with its scale degree when it has one.
     * @param {number[]} midis
     */
    showSounding(midis) {
        const missing = this.keyboard.setSounding(midis);
        if (missing.length) console.error('Scales keyboard does not draw the sounding notes', missing);
        const model = this.keyboard.model;
        document.getElementById('pianoReadoutNotes').replaceChildren(...midis.flatMap(midi => {
            const note = PianoKeyboard.noteAt(model, midi);
            if (!note) return [];
            const el = document.createElement('span');
            if (note.degree !== null) el.append(scalesTextSpan('piano-readout-degree', String(note.degree)));
            el.append(note.pitch);
            return [el];
        }));
    }

    /** @param {string} text */
    setReadoutPlan(text) {
        document.getElementById('pianoReadout').classList.toggle('is-error', this.loadFailure !== null);
        document.getElementById('pianoReadoutPlan').textContent = this.loadFailure ?? text;
    }

    /**
     * Sound a tapped key and light it while it rings. A note off the board
     * gets a board around it in the settings' key; the settings view
     * returns when the note ends, unless a sequence has the board by then.
     * @param {number} midi
     * @param {ToneDuration} duration
     */
    soundSingleNote(midi, duration) {
        this.audio.playNote(midi, duration);
        if (!PianoKeyboard.noteAt(this.keyboard.model, midi)) this.showPass(this.settingsShown(), [midi]);
        this.showSounding([midi]);
        this.showIdleAfter(Tone.Time(duration).toMilliseconds());
    }

    /**
     * Return to the settings view once a tapped note has rung out, unless
     * something else has taken the board by then.
     * @param {number} ms
     */
    showIdleAfter(ms) {
        const id = ++this.flashId;
        setTimeout(() => {
            if (id === this.flashId && !this.audio.isPlaying) this.showIdle();
        }, ms);
    }

    /**
     * One line naming what these settings play, in the option buttons'
     * words: key and scale, direction, then whatever differs from the
     * defaults. The readout, preset titles, and history all use it.
     * @param {ScalesSettings} c
     */
    describeSettings(c) {
        const d = this.defaultSettings;
        const labels = SCALES_OPTION_LABELS;
        const parts = [
            `${scaleRootPitchString(c.root, c.octave)} ${c.scaleType.replace(/_/g, ' ')}`,
            labels.direction[c.direction]
        ];
        if (c.sectionLength !== d.sectionLength) parts.push(labels.sectionLength[c.sectionLength]);
        if (c.movementStyle !== d.movementStyle) parts.push(`move ${labels.movementStyle[c.movementStyle]}`);
        if (c.exercise !== d.exercise) parts.push(labels.exercise[c.exercise]);
        if (c.shiftingSteps > 0) parts.push('shifting');
        if (c.chopHead) parts.push('chop head');
        if (c.ladder !== 'off') {
            parts.push(`${c.ladder === 'reverse' ? 'reverse ladder' : 'ladder'} of ${c.ladderSize}`);
            if (c.ladderGapMs !== d.ladderGapMs) parts.push(`rung gap ${PracticeControls.formatSeconds(c.ladderGapMs)}`);
        }
        if (c.risingSemitones) parts.push(`rising ${labels.risingSemitones[c.risingSemitones]}`);
        if (c.repeatCount > 1) parts.push(`repeat ${scalesRepeatLabel(c.repeatCount, c.repeatGapMs)}`);
        if (c.noteLengthMs !== d.noteLengthMs) parts.push(`len ${PracticeControls.formatSeconds(c.noteLengthMs)}`);
        if (c.gapMs !== d.gapMs) parts.push(`gap ${PracticeControls.formatGapLabel(c.gapMs)}`);
        return parts.join(' \u00b7 ');
    }

    // Sync UI elements to match current settings (bidirectional binding)
    syncUIToSettings() {
        // Repeat buttons (at the top)
        document.querySelectorAll('[data-repeat]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const { repeatCount, repeatGapMs } = this.parseRepeatButtonValue(btn.dataset.repeat);
            const matchesCount = repeatCount === this.settings.repeatCount;
            const matchesGap = (repeatCount === Infinity) ? (repeatGapMs === this.settings.repeatGapMs) : true;
            btn.classList.toggle('selected', matchesCount && matchesGap);
        });

        for (const [attribute, key] of this.optionGroups()) {
            document.querySelectorAll(`[data-${attribute}]`).forEach(btn => {
                btn.classList.toggle('selected', this.optionValue(btn, attribute, key) === this.settings[key]);
            });
        }

        // Steppers (shared control)
        PracticeControls.setValueText('rootPitchValue', scaleRootPitchString(this.settings.root, this.settings.octave));
        PracticeControls.setValueText('noteLengthValue', PracticeControls.formatSeconds(this.settings.noteLengthMs));
        PracticeControls.setValueText('gapValue', PracticeControls.formatGapLabel(this.settings.gapMs));
        PracticeControls.setValueText('ladderSizeValue', String(this.settings.ladderSize));
        PracticeControls.setValueText('ladderGapValue', PracticeControls.formatSeconds(this.settings.ladderGapMs));
        this.syncStepperLimits();

        // A running sequence keeps the board; it shows its own passes.
        if (!this.audio.isPlaying) this.showIdle();
    }

    // Called when any setting changes - immediately adopts and restarts if playing
    async onSettingChanged() {
        const wasPlaying = this.audio.isPlaying;

        this.saveSettings();

        // Stop any current playback immediately
        if (wasPlaying) {
            this.stopPlayback();
        }

        // Update UI to reflect new settings
        this.syncUIToSettings();
        if (this.singPanel) this.singPanel.draw();

        if (wasPlaying) await this.playScale();
    }

    /** @param {string | null | undefined} raw */
    parseRepeatButtonValue(raw) {
        const trimmed = String(raw || '').trim();
        if (trimmed === 'Infinity') return { repeatCount: Infinity, repeatGapMs: FOREVER_SECTION_GAP_MS };
        if (trimmed === 'Infinity-nogap') return { repeatCount: Infinity, repeatGapMs: 0 };

        const n = parseInt(trimmed);
        return { repeatCount: Number.isFinite(n) ? n : 1, repeatGapMs: null };
    }

    // Wire the option buttons, steppers, Reset, and Random to the settings.
    setupOptionButtons() {
        // Repeat buttons (at the top)
        document.querySelectorAll('[data-repeat]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                const { repeatCount, repeatGapMs } = this.parseRepeatButtonValue(btn.dataset.repeat);
                this.settings.repeatCount = repeatCount;
                if (repeatGapMs !== null) {
                    this.settings.repeatGapMs = repeatGapMs;
                }
                this.onSettingChanged();
            });
        });

        for (const [attribute, key, choose] of this.optionGroups()) {
            document.querySelectorAll(`[data-${attribute}]`).forEach(btn => {
                btn.addEventListener('click', () => {
                    choose(this.optionValue(btn, attribute, key));
                    this.onSettingChanged();
                });
            });
        }

        // Root pitch / note length / gap steppers (shared control)
        PracticeControls.wireSteppers((key, delta) => this.stepSettingValue(key, delta));

        // Reset button
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                Object.assign(this.settings, this.defaultSettings);
                this.onSettingChanged();
            });
        }

        // Random button (randomizes only: direction+root+move+rising+scale+length)
        const randomBtn = document.getElementById('randomBtn');
        if (randomBtn) {
            randomBtn.addEventListener('click', () => {
                this.randomizeCoreFilters();
            });
        }

        // Initial sync
        this.syncUIToSettings();
    }

    randomizeCoreFilters() {
        /** @param {readonly any[]} values */
        const pick = values => values[Math.floor(Math.random() * values.length)];
        /** @param {string} attribute @param {keyof ScalesSettings} key */
        const offered = (attribute, key) => [...document.querySelectorAll(`[data-${attribute}]`)]
            .map(btn => this.optionValue(btn, attribute, key));

        this.settings.root = pick(NOTE_NAMES);
        this.settings.direction = pick(offered('direction', 'direction'));
        this.setMovementStyle(pick(offered('movement', 'movementStyle')));
        this.setRisingSemitones(pick(offered('rising', 'risingSemitones')));
        this.settings.scaleType = pick(offered('scale-type', 'scaleType'));
        this.settings.noteLengthMs = pick(PracticeControls.NOTE_LENGTH_VALUES);

        this.onSettingChanged();
    }

    async ensureAudioStarted() {
        await MediaSessionCore.activate();
        await this.audio.ensureStarted();
    }

    /** Play the scale the settings describe, so what sounds is what the page shows. */
    async playScale() {
        const s = this.settings;
        const shown = this.settingsShown();
        const exercisePattern = this.settingsExercisePattern();
        if (exercisePattern) {
            await this.playExercise(shown, exercisePattern);
            return;
        }

        const { groups, notes } = this.settingsPass();
        if (s.ladder !== 'off') {
            await this.playGroupSequence(shown, groups, s.ladderGapMs);
        } else if (s.movementStyle !== 'normal') {
            await this.playGroupSequence(shown, groups, 0);
        } else {
            await this.playSequence(shown, notes);
        }
    }

    /**
     * Play a pass organized into groups (phrases), repeating and rising as
     * the settings say. Movement styles flow group to group with no extra
     * gap; the ladder passes its rung gap as groupGapMs.
     * All note arrays are MIDI.
     * @param {ScalesShown} shown
     * @param {ScalesGroup[]} groups
     * @param {number} groupGapMs
     */
    async playGroupSequence(shown, groups, groupGapMs) {
        const s = this.settings;
        const playTimes = s.repeatCount === 0 ? 1 : s.repeatCount;
        const isInfinite = playTimes === Infinity;
        const risingSemitones = s.risingSemitones || 0;
        const repeatGapMs = s.repeatGapMs;
        const passNotes = groups.flatMap(group => group.notes);

        const playId = this.audio.requestSequencePlayback();
        let r = 0;
        this.showPass(shown, passNotes, 0);

        try {
            while (this.audio.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                const transpose = risingSemitones * r;

                for (let g = 0; g < groups.length; g++) {
                    if (!this.audio.isPlaybackValid(playId)) break;

                    const duration = this.getNoteDuration();
                    const { isChord } = groups[g];
                    const groupMidi = groups[g].notes.map(midi => midi + transpose);

                    if (isChord) {
                        this.showSounding(groupMidi);
                        this.audio.playChord(groupMidi, duration.tone);
                        await this.audio.sleep(duration.ms + duration.gap);
                    } else {
                        for (let i = 0; i < groupMidi.length; i++) {
                            if (!this.audio.isPlaybackValid(playId)) break;

                            const midi = groupMidi[i];
                            this.showSounding([midi]);
                            this.audio.playNote(midi, duration.tone);
                            await this.audio.sleep(duration.ms + duration.gap);
                        }
                    }

                    // Movement styles flow note-to-note with no extra gap
                    // between groups; the ladder rung gap is the one
                    // configurable exception (0 plays straight through).
                    const isLastGroup = (g === groups.length - 1);
                    if (groupGapMs > 0 && !isLastGroup && this.audio.isPlaybackValid(playId)) {
                        await this.audio.sleep(groupGapMs);
                    }
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.audio.isPlaybackValid(playId)) {
                    this.showPass(shown, passNotes, risingSemitones * r);

                    if (risingSemitones === 0) {
                        // Forever-no-gap ladder cycles reflect at the seam,
                        // so the seam is just another rung boundary and gets
                        // the rung gap instead of a cycle divider.
                        const seamMs = isInfinite
                            ? (repeatGapMs > 0 ? repeatGapMs : groupGapMs)
                            : 1500;
                        await this.audio.sleep(seamMs);
                    }
                }
            }
        } finally {
            if (this.audio.playbackId === playId) {
                this.audio.isPlaying = false;
            }
        }

        if (this.audio.playbackId === playId) this.showIdle();
    }

    /**
     * Play an exercise pattern, shifting and repeating as the settings
     * say. All notes are MIDI.
     * @param {ScalesShown} shown
     * @param {(number | 'O')[]} exercisePattern
     */
    async playExercise(shown, exercisePattern) {
        const s = this.settings;
        const shiftingSteps = s.shiftingSteps;
        const playTimes = s.repeatCount === 0 ? 1 : s.repeatCount;
        const isInfinite = playTimes === Infinity;
        const repeatGapMs = s.repeatGapMs;

        // Shifting walks the start up the scale until the pattern runs off
        // the top of the notes it is built from; that empty pass ends it.
        /** @param {number} pass */
        const passNotes = pass => ScalesPatterns.buildExerciseNotes(
            shown.rootMidi, shown.scaleType, exercisePattern, shiftingSteps * pass);
        const playId = this.audio.requestSequencePlayback();
        let r = 0;
        let notes = passNotes(0);
        if (notes.length) this.showPass(shown, notes);

        try {
            while (this.audio.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                if (notes.length === 0) break;

                for (let i = 0; i < notes.length; i++) {
                    if (!this.audio.isPlaybackValid(playId)) break;

                    const midi = notes[i];
                    const duration = this.getNoteDuration();

                    this.showSounding([midi]);
                    this.audio.playNote(midi, duration.tone);
                    await this.audio.sleep(duration.ms + duration.gap);
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.audio.isPlaybackValid(playId)) {
                    notes = passNotes(r);
                    if (notes.length) this.showPass(shown, notes);

                    if (shiftingSteps === 0) {
                        await this.audio.sleep(isInfinite ? repeatGapMs : 1500);
                    } else {
                        await this.audio.sleep(300);
                    }
                }
            }
        } finally {
            if (this.audio.playbackId === playId) {
                this.audio.isPlaying = false;
            }
        }

        if (this.audio.playbackId === playId) this.showIdle();
    }

    /**
     * Play a sequence of MIDI notes, repeating, rising, and chopping as
     * the settings say.
     * @param {ScalesShown} shown
     * @param {number[]} notes
     */
    async playSequence(shown, notes) {
        const s = this.settings;
        // Chop head: each pass drops one more leading note (12345678,
        // 2345678, 345678, ... 8). One user-facing "repeat" spans the whole
        // shrinking cycle.
        const chopHead = !!s.chopHead && notes.length > 1;
        const chopPassCount = chopHead ? notes.length : 1;

        const repeatCount = s.repeatCount;
        const isInfinite = repeatCount === Infinity;
        const baseTimes = repeatCount === 0 ? 1 : repeatCount;
        const playTimes = isInfinite ? Infinity : baseTimes * chopPassCount;

        const risingSemitones = chopHead ? 0 : (s.risingSemitones || 0);
        const repeatGapMs = s.repeatGapMs;
        const playbackRepeatGapMs = chopHead
            ? repeatGapMs
            : (risingSemitones > 0 ? 0 : (isInfinite ? repeatGapMs : 1500));
        const omitsContinuousLoopRoot = !chopHead
            && isInfinite
            && playbackRepeatGapMs === 0
            && risingSemitones === 0
            && (s.direction === 'both' || s.direction === 'down_and_up');

        // Chop head keeps the whole sequence on the board as it shrinks.
        /** @param {number} repeatIndex */
        const showRepeat = repeatIndex => this.showPass(shown, notes, risingSemitones * repeatIndex);
        showRepeat(0);

        const finished = await this.audio.playRenderedSequence({
            getDuration: () => this.getNoteDuration(),
            getNotesForRepeat: repeatIndex => chopHead
                ? notes.slice(repeatIndex % chopPassCount)
                : ScalesPatterns.buildRepeatNotes(notes, repeatIndex, risingSemitones, omitsContinuousLoopRoot),
            onNote: midi => this.showSounding([midi]),
            onRepeatEnd: showRepeat,
            repeatCount: playTimes,
            repeatGapMs: playbackRepeatGapMs
        });
        if (finished) this.showIdle();
    }

    getNoteDuration() {
        const ms = this.settings.noteLengthMs;
        // Negative gap presets are overlap ratios, resolved by the shared helper.
        return { ms, tone: ms / 1000, gap: PracticeControls.effectiveGapMs(this.settings.gapMs, ms) };
    }

    stopPlayback() {
        this.audio.stop();
        if (this.singPanel) this.singPanel.cancelGuide();
        this.showIdle();
    }

    // Play button: plays exactly what the settings show
    async playCurrentSettings() {
        await this.ensureAudioStarted();
        this.addToHistory();
        await this.playScale();
    }

    /**
     * Record the scale about to play with the settings it plays with, so
     * its line and its replay name the same thing.
     */
    addToHistory() {
        const config = this.getCurrentConfigSnapshot();
        this.history.add({
            type: 'scale',
            config,
            description: this.describeSettings(config),
            timestamp: new Date()
        });
    }

    // One line per entry: replay, what played, and when. An error's
    // details sit in its tooltip and in Copy All.
    /**
     * @param {HistoryEntry} entry
     * @param {number} index
     */
    renderHistoryItem(entry, index) {
        const item = document.createElement('div');
        const time = scalesTextSpan('history-time', this.formatTime(entry.timestamp));

        if (entry.type === 'error') {
            item.className = 'history-item history-error';
            item.title = entry.details?.error ? this.formatErrorDetails(entry.details) : entry.message;
            item.append(
                scalesTextSpan('history-error-icon', '!'),
                scalesTextSpan('history-text', entry.message),
                time);
            return item;
        }

        const replay = document.createElement('button');
        replay.className = 'history-play-btn';
        replay.title = 'Play again';
        replay.textContent = '\u25b6';
        replay.addEventListener('click', () => this.playFromHistory(index));

        item.className = 'history-item';
        item.title = entry.description;
        item.append(replay, scalesTextSpan('history-text', entry.description), time);
        return item;
    }

    formatErrorDetails(details) {
        if (!details || !details.error) return '';

        let result = '';
        if (details.error.stack) {
            result = details.error.stack;
        } else if (details.error.toString) {
            result = details.error.toString();
        } else {
            result = JSON.stringify(details.error, null, 2);
        }

        if (details.filename) {
            result = `${details.filename}:${details.lineno}:${details.colno}\n${result}`;
        }

        return result;
    }

    copyAllHistory() {
        if (this.history.entries.length === 0) return;

        const lines = this.history.entries.map(entry => {
            const timeStr = this.formatTime(entry.timestamp);

            if (entry.type === 'error') {
                const errorDetails = entry.details?.error ? `\n${this.formatErrorDetails(entry.details)}` : '';
                return `[${timeStr}] ERROR: ${entry.message}${errorDetails}`;
            }
            return `[${timeStr}] ${entry.description}`;
        });

        navigator.clipboard.writeText(lines.join('\n'))
            .catch(error => this.logError('Could not copy the history', { error }));
    }

    /**
     * Replay a scale from the history: the settings it played with, left
     * set. Only scale rows carry a replay button.
     * @param {number} index
     */
    async playFromHistory(index) {
        const entry = this.history.entries[index];
        await this.ensureAudioStarted();
        this.stopPlayback();
        this.applyConfig(entry.config);
        await this.playScale();
    }

    /**
     * Format timestamp for display
     * @param {Date} date
     */
    formatTime(date) {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;

        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h`;

        return date.toLocaleDateString();
    }

    setupErrorHandling() {
        // Global JavaScript error handler
        window.addEventListener('error', (event) => {
            const errorMsg = `JavaScript Error: ${event.message}${event.filename ? ` (${event.filename}:${event.lineno})` : ''}`;
            this.logError(errorMsg, {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error
            });
        });

        // Unhandled promise rejection handler
        window.addEventListener('unhandledrejection', (event) => {
            const errorMsg = `Unhandled Promise Rejection: ${event.reason}`;
            this.logError(errorMsg, {
                reason: event.reason,
                promise: event.promise
            });
        });
    }

    logError(message, details = {}) {
        console.error(message, details);

        /** @type {HistoryEntry} */
        const errorEntry = {
            type: 'error',
            message: message,
            details: details,
            timestamp: new Date()
        };

        if (this.history) this.history.add(errorEntry);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.scalesController = new ScalesController();
});

