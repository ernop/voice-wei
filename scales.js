// @ts-check
//-----------------------------------------------------------------------
// SCALES - Voice-controlled scale and pitch training
// Uses VoiceCommandCore for voice recognition
// Uses Tone.js for piano sound synthesis
//-----------------------------------------------------------------------

// Playback coordinator lives in scales-playback.js; voice maps in scales-voice-maps.js

// Default octave for scales
const DEFAULT_OCTAVE = 4;

// Loop timing (NOT the per-note gap control)
const FOREVER_SECTION_GAP_MS = 1000; // 1s gap between sections when looping ("forever" mode)

const SCALES_PRESETS_STORAGE_KEY = StorageKeys.SCALES_PRESETS;

// Option names in the words of each option button's data-full text: the
// readout, preset titles, and history all describe a setting with the
// words on its button (tests/test-scales-keyboard.js holds them equal).
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
    // Voice also rises by 3, 4, 5, or 7 ("rising a minor third"); those have no button.
    risingSemitones: { 1: 'half', 2: 'whole', 3: 'minor third', 4: 'major third', 5: 'perfect fourth', 7: 'perfect fifth' }
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
 * option loads as its default. Spoken "E sharp" was once stored as root
 * "E#", and early versions had a 'centered' section width.
 * @param {Partial<ScalesSettings>} stored
 * @param {ScalesSettings} defaults
 */
function scalesRepairStored(stored, defaults) {
    if (!NOTE_NAMES.includes(stored.root)) stored.root = defaults.root;
    if (!(String(stored.scaleType) in SCALE_PATTERNS)) stored.scaleType = defaults.scaleType;
    for (const key of /** @type {const} */ (['sectionLength', 'direction', 'movementStyle', 'exercise'])) {
        if (!(String(stored[key]) in SCALES_OPTION_LABELS[key])) stored[key] = defaults[key];
    }
}

// Stepper value lists (the former chip-row options)
const SCALES_VOICE_RATE_VALUES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];
const SCALES_VOICE_PITCH_VALUES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

// Ladder rung sizes offered by the stepper (notes per rung)
const SCALES_LADDER_SIZE_VALUES = [2, 3, 4, 5, 6, 7, 8];

// Spoken rung sizes ("ladder of four", "three note ladder")
/** @type {Record<string, number>} */
const LADDER_COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

// A movement style said on its own ("neighbors", "+1-1c") sets it
/** @type {[RegExp, string][]} */
const SCALES_MOVEMENT_COMMANDS = [
    [/^(stop\s*-\s*and\s*-\s*go|stop\s+and\s+go|two\s+(steps?\s+)?forward\s+(one\s+step\s+)?back)$/, 'stop_and_go'],
    [/^(1\s*[- ]?\s*3\s*[- ]?\s*5|one\s+three\s+five|triads?)$/, 'one_three_five'],
    [/^(nbr|neighbou?rs?)$/, 'neighbors'],
    [/^(chd|chords?\s*(mode)?)$/, 'chords'],
    [/^(from\s+(1|one)|from\s+the\s+root|root\s+always)$/, 'from_one'],
    [/^(to\s+(1|one)|to\s+the\s+root|interleave\s*(1|one)?|return\s+to\s+root)$/, 'to_one'],
    [/^(plus\s*minus\s*(1|one)|\+1\s*-1|dance\s+around)$/, 'plus_minus_one'],
    [/^(chromatic\s+stop\s*-?\s*and\s*-?\s*go|chromatic\s+steps?|\+1\s*\+2\s*(chromatic|half|c)|\+1\+2c)$/, 'chromatic_stop_and_go'],
    [/^(plus\s*minus\s*(a\s+)?half|\+1\s*-1\s*(chromatic|half|c)|\+1-1c|chromatic\s+neighbou?rs?)$/, 'plus_minus_half'],
    [/^(normal\s+movement|normal)$/, 'normal']
];

// Leap sizes as spoken ("thirds up", "5th down", "4u"), for the leap styles
/** @type {Record<string, string>} */
const SCALES_LEAP_WORDS = {
    third: 'third', '3rd': 'third', '3': 'third',
    fourth: 'fourth', '4th': 'fourth', '4': 'fourth',
    fifth: 'fifth', '5th': 'fifth', '5': 'fifth',
    sixth: 'sixth', '6th': 'sixth', '6': 'sixth',
    seventh: 'seventh', '7th': 'seventh', '7': 'seventh'
};

const SCALES_SETTINGS_STORAGE_KEY = StorageKeys.SCALES_SETTINGS;
const SCALES_PERSISTED_SETTING_KEYS = [
    'noteLengthMs', 'gapMs', 'direction', 'octave', 'repeatCount',
    'repeatGapMs', 'risingSemitones', 'movementStyle', 'scaleType', 'root',
    'sectionLength', 'exercise', 'shiftingSteps',
    'chopHead', 'ladder', 'ladderSize', 'ladderGapMs',
    'showSequence', 'useAbbrev', 'instructionDismissed',
    'voiceRate', 'voicePitch', 'voiceName', 'echoCommands'
];

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
 * @typedef {Object} ScaleModifiers
 * @property {string | null} [tempo]
 * @property {string | null} [gap]
 * @property {number | null} [repeat]
 * @property {string | null} [direction]
 * @property {number | null} [risingSemitones]
 * @property {string | null} [movementStyle]
 * @property {string | null} [sectionLength]
 * @property {number | null} [repeatGapMs]
 * @property {string | null} [exercise]
 * @property {number | null} [shiftingSteps]
 * @property {number | null} [chopHead]
 * @property {string | null} [ladder]
 * @property {number | null} [ladderSize]
 * @property {number | null} [ladderGapMs]
 */

/**
 * @typedef {Object} ScaleCommand
 * @property {string} [type]
 * @property {string} [root]
 * @property {string} [scale]
 * @property {string} [scaleType]
 * @property {number} [octave]
 * @property {string} [direction]
 * @property {string} [repeatRaw]
 * @property {number} [repeatCount]
 * @property {string} [tempoName]
 * @property {string} [gapName]
 * @property {string} [movementStyle]
 * @property {number} [risingSemitones]
 * @property {string} [chord]
 * @property {string} [note]
 * @property {string} [rawTranscript]
 * @property {string} [quality]
 * @property {string} [interval]
 * @property {ScaleModifiers} [modifiers]
 * @property {string} [setting]
 * @property {string | number} [value]
 */

/**
 * @typedef {Object} Preset
 * @property {string} id
 * @property {string} name
 * @property {ScalesSettings} config
 * @property {number} [createdAt]
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string | null} [transcript]
 * @property {ScaleCommand} [command]
 * @property {ScalesSettings | null} [config] - a scale's settings when it played
 * @property {string} [type]
 * @property {string} [message]
 * @property {string} [description]
 * @property {Object} [details]
 * @property {Date} [timestamp]
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
        /** @type {VoiceCommandCore | null} */
        this.voiceCore = null;
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
        // What Reset (and every voice command, before applying its own
        // words) restores: the musical settings only. Display toggles,
        // the dismissed tip, and the TTS voice are preferences and stay.
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
        this.settings = {
            ...this.defaultSettings,
            showSequence: false,
            useAbbrev: false,
            instructionDismissed: false,
            voiceRate: 1.0,
            voicePitch: 1.0,
            voiceName: null,
            echoCommands: false
        };

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

        // Maps tempo voice commands to ms values
        /** @type {Record<string, number>} */
        this.tempoNameToMs = {
            'very fast': 100,
            'fast': 150,
            'normal': 500,
            'slow': 1000,
            'very slow': 2000,
            'super slow': 5000
        };

        // Maps gap voice commands to actual values (negative = overlap ratio, positive = ms)
        /** @type {Record<string, number>} */
        this.gapNameToValue = {
            'none': 0,
            'small': 50,
            'normal': 150,
            'large': 300,
            'very large': 500
        };

        // The command playing or last played: a spoken setting carries a
        // running scale on with the new value.
        /** @type {ScaleCommand | null} */
        this.lastCommand = null;

        // Command history for replay (HistoryList created in setupUI)
        /** @type {ReturnType<typeof HistoryList.create> | null} */
        this.history = null;
        /** @type {number} */
        this.maxHistoryLength = 50;

        // Note: settings store actual values (noteLengthMs in ms, gapMs in
        // ms or negative for overlap ratio); labels and interpretation come
        // from PracticeControls (shared across pages). Tempo/gap NAMES exist
        // only as voice input; they are never derived back from settings.
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
        this.setupVoiceCore();
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
        SettingsStore.load(SCALES_SETTINGS_STORAGE_KEY, snapshot, SCALES_PERSISTED_SETTING_KEYS);
        if (snapshot.repeatCount === -1) snapshot.repeatCount = Infinity;
        scalesRepairStored(snapshot, this.defaultSettings);

        // One-time migration from legacy ad-hoc keys (owner-mediated access)
        const legacyShow = SettingsStore.takeLegacy('scales-show-sequence');
        if (legacyShow !== null) {
            snapshot.showSequence = legacyShow === 'true';
        }
        const legacyAbbr = SettingsStore.takeLegacy('scales-use-abbrev');
        if (legacyAbbr !== null) {
            snapshot.useAbbrev = legacyAbbr === 'true';
        }
        const legacyInstruction = SettingsStore.takeLegacy('scales-instruction-dismissed');
        if (legacyInstruction !== null) {
            snapshot.instructionDismissed = legacyInstruction === 'true';
        }

        Object.assign(this.settings, snapshot);
        this.pendingVoiceSettings = {
            voiceRate: snapshot.voiceRate,
            voicePitch: snapshot.voicePitch,
            voiceName: snapshot.voiceName,
            echoCommands: snapshot.echoCommands
        };
    }

    saveSettings() {
        const snapshot = { ...this.settings };
        if (snapshot.repeatCount === Infinity) snapshot.repeatCount = -1;
        if (this.voiceCore) {
            snapshot.voiceRate = this.voiceCore.settings.voiceRate;
            snapshot.voicePitch = this.voiceCore.settings.voicePitch;
            snapshot.voiceName = this.voiceCore.settings.voiceName;
            snapshot.echoCommands = this.voiceCore.settings.echoCommands;
        }
        SettingsStore.save(SCALES_SETTINGS_STORAGE_KEY, snapshot, SCALES_PERSISTED_SETTING_KEYS);
    }

    applyPersistedVoiceSettings() {
        if (!this.voiceCore || !this.pendingVoiceSettings) return;
        const v = this.pendingVoiceSettings;
        if (typeof v.voiceRate === 'number') this.voiceCore.setVoiceRate(v.voiceRate);
        if (typeof v.voicePitch === 'number') this.voiceCore.setVoicePitch(v.voicePitch);
        if (v.voiceName) this.voiceCore.setVoice(v.voiceName);
        if (typeof v.echoCommands === 'boolean') this.voiceCore.echoCommands = v.echoCommands;
        this.pendingVoiceSettings = null;
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

    setupVoiceCore() {
        this.voiceCore = new VoiceCommandCore({
            settings: {
                autoSubmitMode: true
            },
            onStatusChange: () => { },
            onError: (/** @type {string} */ msg) => this.showError(msg)
        });

        // Register scale commands
        // Voice commands reset to defaults first, then apply modifiers from speech
        this.voiceCore.registerHandler({
            parse: (/** @type {string} */ transcript) => this.parseScaleCommand(transcript),
            execute: async (/** @type {ScaleCommand} */ command, /** @type {string} */ transcript) => {
                // Reset to defaults before applying voice command (unless it's
                // a control command). Setting, reset, and random commands
                // already changed the settings while parsing.
                const controlCommands = ['stop', 'help', 'play', 'setting', 'reset', 'random'];
                if (!controlCommands.includes(command.type)) {
                    this.resetToDefaults();
                }
                await this.executeScaleCommand(command, transcript);
            }
        });

        this.voiceCore.init();
        this.applyPersistedVoiceSettings();
        this.syncVoiceSteppers();
    }

    resetToDefaults() {
        Object.assign(this.settings, this.defaultSettings);
        this.syncUIToSettings();
    }

    /** Sync the TTS voice stepper labels and all stepper disabled states. */
    syncVoiceSteppers() {
        PracticeControls.setValueText('voiceRateValue', this.voiceCore.settings.voiceRate + 'x');
        PracticeControls.setValueText('voicePitchValue', this.voiceCore.settings.voicePitch.toFixed(1));
        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'rootPitch') {
                return PracticeControls.rootStepDisabled(
                    noteNameToMidi(this.settings.root, this.settings.octave), delta);
            }
            if (key === 'noteLengthMs') {
                return PracticeControls.stepDisabled(PracticeControls.NOTE_LENGTH_VALUES, this.settings.noteLengthMs, delta);
            }
            if (key === 'voiceRate') {
                return PracticeControls.stepDisabled(SCALES_VOICE_RATE_VALUES, this.voiceCore.settings.voiceRate, delta);
            }
            if (key === 'voicePitch') {
                return PracticeControls.stepDisabled(SCALES_VOICE_PITCH_VALUES, this.voiceCore.settings.voicePitch, delta);
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
     * Stepper handler for the root pitch, timing and voice controls.
     * @param {string} key @param {number} delta
     */
    stepSettingValue(key, delta) {
        // TTS voice settings: immediate, no playback restart
        if (key === 'voiceRate') {
            const next = PracticeControls.stepValue(SCALES_VOICE_RATE_VALUES, this.voiceCore.settings.voiceRate, delta);
            if (next !== null) {
                this.voiceCore.setVoiceRate(next);
                this.syncVoiceSteppers();
                this.saveSettings();
            }
            return;
        }
        if (key === 'voicePitch') {
            const next = PracticeControls.stepValue(SCALES_VOICE_PITCH_VALUES, this.voiceCore.settings.voicePitch, delta);
            if (next !== null) {
                this.voiceCore.setVoicePitch(next);
                this.syncVoiceSteppers();
                this.saveSettings();
            }
            return;
        }
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

        // Command history list (shared component owns rendering + clear)
        this.history = HistoryList.create({
            listId: 'historyList',
            clearBtnId: 'clearHistoryBtn',
            emptyText: 'No commands yet',
            max: this.maxHistoryLength,
            renderItem: (entry, index) => this.renderHistoryItem(entry, index)
        });

        // Copy all history button
        const copyAllHistoryBtn = document.getElementById('copyAllHistoryBtn');
        if (copyAllHistoryBtn) {
            copyAllHistoryBtn.addEventListener('click', () => this.copyAllHistory());
        }

        this.setupKeyboard();

        // Voice settings
        this.setupVoiceControls();

        // Voice-first clickable UI
        this.setupVoiceFirstUI();

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
    // settings. A running command shows its own notes - each pass of a
    // scale as it starts (rising and shifting move it), or the notes of a
    // chord, arpeggio, or interval - and lights each note as it sounds.

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
     * Sound one note and light it while it rings: a key tap, a spoken
     * note, the tuning A. A note off the board gets a board around it in
     * the settings' key; the settings view returns when the note ends,
     * unless a sequence has the board by then.
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
     * Return to the settings view once a sound that ends on its own (a
     * tapped note, a chord) has rung out, unless something else has
     * taken the board by then.
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

    /**
     * The readout and history line for a command. A scale command has
     * already written itself into the settings, so it reads like them.
     * @param {ScaleCommand} command
     */
    describeCommand(command) {
        const root = command.root && scaleRootPitchString(command.root, this.settings.octave);
        switch (command.type) {
            case 'scale': return this.describeSettings(this.settings);
            case 'note': return `${command.note}${command.octave}`;
            case 'tuning': return 'A440';
            case 'arpeggio': return `${root} ${command.quality} arpeggio`;
            case 'chord': return `${root} ${command.quality} chord`;
            case 'interval': return `${command.quality ? `${command.quality} ` : ''}${command.interval} from ${root}`;
            default: throw new Error(`describeCommand: ${command.type} commands play nothing`);
        }
    }

    /**
     * What a chord, arpeggio, or interval command shows: its line, spelled
     * and numbered in its root's minor scale for a minor quality, else the
     * major.
     * @param {ScaleCommand} command
     * @returns {ScalesShown}
     */
    commandShown(command) {
        return {
            text: this.describeCommand(command),
            rootMidi: noteNameToMidi(command.root, this.settings.octave),
            scaleType: command.quality === 'minor' ? 'minor' : 'major'
        };
    }

    setupVoiceControls() {
        // Chrome fills the voice list after load and announces it.
        this.populateVoiceDropdown();
        speechSynthesis.addEventListener('voiceschanged', () => this.populateVoiceDropdown());

        const voiceSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('voiceSelect'));
        if (voiceSelect) {
            voiceSelect.addEventListener('input', (e) => {
                const target = /** @type {HTMLSelectElement} */ (e.target);
                this.voiceCore.setVoice(target.value || null);
                this.saveSettings();
            });
        }

        const testVoiceBtn = document.getElementById('testVoiceBtn');
        if (testVoiceBtn) {
            testVoiceBtn.addEventListener('click', () => {
                this.voiceCore.speakText('C major scale ascending');
            });
        }
    }

    // English voices with an accent hint, the saved voice selected.
    populateVoiceDropdown() {
        const voiceSelect = /** @type {HTMLSelectElement} */ (document.getElementById('voiceSelect'));
        const englishVoices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
        const group = document.createElement('optgroup');
        group.label = 'English';
        for (const v of englishVoices) {
            const accent = v.lang.includes('GB') ? '(UK)' :
                v.lang.includes('AU') ? '(AU)' :
                    v.lang.includes('US') ? '(US)' : '';
            group.append(new Option(`${v.name} ${accent}`.trim(), v.name));
        }
        voiceSelect.replaceChildren(new Option('Default', ''), ...(englishVoices.length ? [group] : []));
        const saved = this.voiceCore.settings.voiceName;
        voiceSelect.value = englishVoices.some(v => v.name === saved) ? saved : '';
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
        this.syncVoiceSteppers();

        this.updateNoteSequencePreview();

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

    // Build modifiers object from current settings for replay
    // Note: tempo/gap are omitted so getNoteDuration() reads from this.settings directly
    buildModifiersFromSettings() {
        return {
            repeat: this.settings.repeatCount,
            direction: this.settings.direction,
            risingSemitones: this.settings.risingSemitones,
            movementStyle: this.settings.movementStyle,
            repeatGapMs: this.settings.repeatGapMs,
            exercise: this.settings.exercise,
            shiftingSteps: this.settings.shiftingSteps,
            chopHead: this.settings.chopHead,
            ladder: this.settings.ladder,
            ladderSize: this.settings.ladderSize,
            ladderGapMs: this.settings.ladderGapMs
        };
    }

    /** @param {string | null | undefined} raw */
    parseRepeatButtonValue(raw) {
        const trimmed = String(raw || '').trim();
        if (trimmed === 'Infinity') return { repeatCount: Infinity, repeatGapMs: FOREVER_SECTION_GAP_MS };
        if (trimmed === 'Infinity-nogap') return { repeatCount: Infinity, repeatGapMs: 0 };

        const n = parseInt(trimmed);
        return { repeatCount: Number.isFinite(n) ? n : 1, repeatGapMs: null };
    }

    // Setup voice-first clickable UI elements (all bidirectional controls)
    setupVoiceFirstUI() {
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

        // Dismissable instruction (hidden by default, shown only if never dismissed)
        const instruction = document.getElementById('vfInstruction');
        const dismissBtn = document.getElementById('dismissInstruction');
        if (instruction && dismissBtn) {
            if (!this.settings.instructionDismissed) {
                instruction.style.display = '';
            }
            dismissBtn.addEventListener('click', () => {
                instruction.style.display = 'none';
                this.settings.instructionDismissed = true;
                this.saveSettings();
            });
        }

        const showSeqToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('showSequenceToggle'));
        const seqGridContainer = document.getElementById('sequenceGridContainer');
        if (showSeqToggle) {
            showSeqToggle.checked = this.settings.showSequence;
            if (seqGridContainer) seqGridContainer.style.display = this.settings.showSequence ? 'grid' : 'none';

            showSeqToggle.addEventListener('change', () => {
                this.settings.showSequence = showSeqToggle.checked;
                if (seqGridContainer) {
                    seqGridContainer.style.display = this.settings.showSequence ? 'grid' : 'none';
                }
                this.saveSettings();
            });
        }

        const abbrToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('useAbbrevToggle'));
        if (abbrToggle) {
            abbrToggle.checked = this.settings.useAbbrev;
            if (this.settings.useAbbrev) this.applyAbbreviations(true);
            abbrToggle.addEventListener('change', () => {
                this.settings.useAbbrev = abbrToggle.checked;
                this.applyAbbreviations(this.settings.useAbbrev);
                this.saveSettings();
            });
        }

        // Initial sync
        this.syncUIToSettings();
    }

    // Toggle button and label text between full and abbreviated versions
    /** @param {boolean} useAbbr */
    applyAbbreviations(useAbbr) {
        // Toggle buttons
        document.querySelectorAll('.vf-btn[data-abbr][data-full]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.textContent = useAbbr ? btn.dataset.abbr : btn.dataset.full;
        });
        // Toggle section labels (row labels and in-pill stepper labels)
        document.querySelectorAll('.vf-label[data-abbr][data-full], .step-label[data-abbr][data-full]').forEach(el => {
            const label = /** @type {HTMLElement} */ (el);
            label.textContent = useAbbr ? label.dataset.abbr : label.dataset.full;
        });
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

    /**
     * Extract modifiers from transcript and return cleaned transcript + modifiers
     * @param {string} transcript
     */
    extractModifiers(transcript) {
        let text = transcript.toLowerCase().trim();
        /** @type {ScaleModifiers} */
        const modifiers = {
            tempo: null,        // 'very slow', 'slow', 'normal', 'fast', 'very fast'
            gap: null,          // 'none', 'small', 'normal', 'large', 'very large'
            repeat: null,       // null (use settings: rising and shifting loop) or number of passes
            direction: null,    // 'ascending', 'descending', 'both'
            risingSemitones: null, // null (use settings) or integer semitones (0=off)
            movementStyle: null, // null (use settings) or one of movement styles
            sectionLength: null // null (use settings) or a Section Width value
        };

        // "Wide" and "narrow" have no section width of their own; the words
        // are accepted so the rest of the command still plays.
        text = text.replace(/\b(very\s+wide|wide|narrow)\b/, '');

        // Section width
        if (text.match(/\b(double|two|2)\s*octave(s)?\b/)) {
            modifiers.sectionLength = '2o';
            text = text.replace(/\b(double|two|2)\s*octave(s)?\b/, '');
        } else if (text.match(/\bsingle\s*octave\b/) || text.match(/\bone\s*octave\b/)) {
            modifiers.sectionLength = '1o';
            text = text.replace(/\b(single|one)\s*octave\b/, '');
        }

        // Movement style modifiers (within a scale)
        // Chromatic variants must be checked before their diatonic namesakes.
        /** @type {Record<string, string>} */
        const intervalMovementWords = { third: 'third', thirds: 'third', fourth: 'fourth', fourths: 'fourth', fifth: 'fifth', fifths: 'fifth', sixth: 'sixth', sixths: 'sixth', seventh: 'seventh', sevenths: 'seventh' };
        const intervalMovementRe = /\b(?:in\s+)?(thirds?|fourths?|fifths?|sixths?|sevenths?)\s+(up|down)\b/;
        const intervalMovementMatch = text.match(intervalMovementRe);
        if (text.match(/\bchromatic\s+stop\s*-?\s*and\s*-?\s*go\b/) || text.match(/\bchromatic\s+steps?\b/) || text.match(/\+1\s*\+2\s*(chromatic|half)\b/)) {
            modifiers.movementStyle = 'chromatic_stop_and_go';
            text = text.replace(/\bchromatic\s+stop\s*-?\s*and\s*-?\s*go\b/, '').replace(/\bchromatic\s+steps?\b/, '').replace(/\+1\s*\+2\s*(chromatic|half)\b/, '');
        } else if (text.match(/\bplus\s*minus\s*(a\s+)?half\b/) || text.match(/\+1\s*-1\s*(chromatic|half)\b/) || text.match(/\bchromatic\s+neighbou?rs?\b/)) {
            modifiers.movementStyle = 'plus_minus_half';
            text = text.replace(/\bplus\s*minus\s*(a\s+)?half\b/, '').replace(/\+1\s*-1\s*(chromatic|half)\b/, '').replace(/\bchromatic\s+neighbou?rs?\b/, '');
        } else if (intervalMovementMatch) {
            modifiers.movementStyle = `${intervalMovementWords[intervalMovementMatch[1]]}_${intervalMovementMatch[2]}`;
            text = text.replace(intervalMovementRe, '');
        } else if (text.match(/\bstop\s*-\s*and\s*-\s*go\b/) || text.match(/\bstop\s+and\s+go\b/)) {
            modifiers.movementStyle = 'stop_and_go';
            text = text.replace(/\bstop\s*-\s*and\s*-\s*go\b/, '').replace(/\bstop\s+and\s+go\b/, '');
        } else if (text.match(/\btwo\s+(steps?\s+)?forward\s+(one\s+step\s+)?back\b/)) {
            modifiers.movementStyle = 'stop_and_go';
            text = text.replace(/\btwo\s+(steps?\s+)?forward\s+(one\s+step\s+)?back\b/, '');
        } else if (text.match(/\b(1\s*[- ]?\s*3\s*[- ]?\s*5|one\s+three\s+five)\b/)) {
            modifiers.movementStyle = 'one_three_five';
            text = text.replace(/\b(1\s*[- ]?\s*3\s*[- ]?\s*5|one\s+three\s+five)\b/, '');
        } else if (text.match(/\btriads?\b/)) {
            modifiers.movementStyle = 'one_three_five';
            text = text.replace(/\btriads?\b/, '');
        } else if (text.match(/\bneighbou?rs?\b/)) {
            modifiers.movementStyle = 'neighbors';
            text = text.replace(/\bneighbou?rs?\b/, '');
        } else if (text.match(/\bchords?\s*(mode)?\b/)) {
            modifiers.movementStyle = 'chords';
            text = text.replace(/\bchords?\s*(mode)?\b/, '');
        } else if (text.match(/\bfrom\s+(1|one)\b/) || text.match(/\bfrom\s+the\s+root\b/) || text.match(/\broot\s+always\b/)) {
            modifiers.movementStyle = 'from_one';
            text = text.replace(/\bfrom\s+(1|one)\b/, '').replace(/\bfrom\s+the\s+root\b/, '').replace(/\broot\s+always\b/, '');
        } else if (text.match(/\bto\s+(1|one)\b/) || text.match(/\bto\s+the\s+root\b/) || text.match(/\binterleave\s*(1|one)?\b/) || text.match(/\breturn\s+to\s+root\b/)) {
            modifiers.movementStyle = 'to_one';
            text = text.replace(/\bto\s+(1|one)\b/, '').replace(/\bto\s+the\s+root\b/, '').replace(/\binterleave\s*(1|one)?\b/, '').replace(/\breturn\s+to\s+root\b/, '');
        } else if (text.match(/\bplus\s*minus\s*(1|one)\b/) || text.match(/\b\+1\s*-1\b/) || text.match(/\bdance\s+around\b/)) {
            modifiers.movementStyle = 'plus_minus_one';
            text = text.replace(/\bplus\s*minus\s*(1|one)\b/, '').replace(/\b\+1\s*-1\b/, '').replace(/\bdance\s+around\b/, '');
        } else if (text.match(/\bnormal\s+movement\b/) || text.match(/\bnormal\b/)) {
            modifiers.movementStyle = 'normal';
            text = text.replace(/\bnormal\s+movement\b/, '').replace(/\bnormal\b/, '');
        }

        // Rising / modulation modifiers (transpose each repeat upward)
        // Common in vocal warmups: repeat the same figure and move up by half-steps or whole-steps.
        if (text.match(/\b(no|without)\s+rising\b/) || text.match(/\brising\s+off\b/) || text.match(/\brising\s+disabled\b/)) {
            modifiers.risingSemitones = 0;
            text = text.replace(/\b(no|without)\s+rising\b/, '').replace(/\brising\s+off\b/, '').replace(/\brising\s+disabled\b/, '');
        } else if (text.match(/\brising\b/) || text.match(/\bmodulat(e|ing)\b/) || text.match(/\btranspose\b/)) {
            // Specific intervals if provided, else default to half-step (chromatic rise)
            if (text.match(/\bhalf\s*step\b/) || text.match(/\bhalf\s*tone\b/) || text.match(/\bsemitone\b/) || text.match(/\bchromatic\b/)) {
                modifiers.risingSemitones = 1;
                text = text.replace(/\bhalf\s*step\b/, '').replace(/\bhalf\s*tone\b/, '').replace(/\bsemitone\b/, '').replace(/\bchromatic\b/, '');
            } else if (text.match(/\bwhole\s*step\b/) || text.match(/\bwhole\s*tone\b/)) {
                modifiers.risingSemitones = 2;
                text = text.replace(/\bwhole\s*step\b/, '').replace(/\bwhole\s*tone\b/, '');
            } else if (text.match(/\bminor\s+third\b/)) {
                modifiers.risingSemitones = 3;
                text = text.replace(/\bminor\s+third\b/, '');
            } else if (text.match(/\bmajor\s+third\b/)) {
                modifiers.risingSemitones = 4;
                text = text.replace(/\bmajor\s+third\b/, '');
            } else if (text.match(/\bperfect\s+fifth\b/) || text.match(/\bfifth\b/)) {
                modifiers.risingSemitones = 7;
                text = text.replace(/\bperfect\s+fifth\b/, '').replace(/\bfifth\b/, '');
            } else if (text.match(/\bperfect\s+fourth\b/) || text.match(/\bfourth\b/)) {
                modifiers.risingSemitones = 5;
                text = text.replace(/\bperfect\s+fourth\b/, '').replace(/\bfourth\b/, '');
            } else {
                modifiers.risingSemitones = 1;
            }

            text = text.replace(/\brising\b/, '').replace(/\bmodulat(e|ing)\b/, '').replace(/\btranspose\b/, '');
        }

        // Exercise patterns
        if (text.match(/\b(5|five)\s*note\s*(warmup|warm\s*up|exercise)?\b/) || text.match(/\bwarmup\b/)) {
            modifiers.exercise = 'five_note';
            modifiers.shiftingSteps = 1; // Default to shifting for warmups
            text = text.replace(/\b(5|five)\s*note\s*(warmup|warm\s*up|exercise)?\b/, '').replace(/\bwarmup\b/, '');
        } else if (text.match(/\boctave\s*jump\b/)) {
            modifiers.exercise = 'octave_jump';
            modifiers.shiftingSteps = 1;
            text = text.replace(/\boctave\s*jump\b/, '');
        } else if (text.match(/\b(arpeggio|arp)\s*return\b/) || text.match(/\breturn\s*(arpeggio|arp)\b/)) {
            modifiers.exercise = 'arpeggio_return';
            modifiers.shiftingSteps = 1;
            text = text.replace(/\b(arpeggio|arp)\s*return\b/, '').replace(/\breturn\s*(arpeggio|arp)\b/, '');
        } else if (text.match(/\bthirds\s*(exercise)?\b/) || text.match(/\bskip\s*(pattern|exercise)?\b/)) {
            modifiers.exercise = 'thirds';
            modifiers.shiftingSteps = 1;
            text = text.replace(/\bthirds\s*(exercise)?\b/, '').replace(/\bskip\s*(pattern|exercise)?\b/, '');
        } else if (text.match(/\bno\s*exercise\b/) || text.match(/\bexercise\s*off\b/) || text.match(/\bfull\s*scale\b/)) {
            modifiers.exercise = 'none';
            modifiers.shiftingSteps = 0;
            text = text.replace(/\bno\s*exercise\b/, '').replace(/\bexercise\s*off\b/, '').replace(/\bfull\s*scale\b/, '');
        }

        // Shifting modifiers (separate from exercise - can be combined)
        if (text.match(/\b(no|without)\s+shift(ing)?\b/) || text.match(/\bshift(ing)?\s+off\b/)) {
            modifiers.shiftingSteps = 0;
            text = text.replace(/\b(no|without)\s+shift(ing)?\b/, '').replace(/\bshift(ing)?\s+off\b/, '');
        } else if (text.match(/\bshift(ing)?\b/) || text.match(/\bwalk(ing)?\b/)) {
            modifiers.shiftingSteps = 1; // Default to shifting by 1 scale degree
            text = text.replace(/\bshift(ing)?\b/, '').replace(/\bwalk(ing)?\b/, '');
        }

        // Chop head modifier (each pass drops the leading note)
        // "chop ahead" covers a common recognition of "chop head".
        if (text.match(/\b(no|without)\s+chop\s*(head|ahead)\b/) || text.match(/\bchop\s*(head|ahead)\s+off\b/)) {
            modifiers.chopHead = 0;
            text = text.replace(/\b(no|without)\s+chop\s*(head|ahead)\b/, '').replace(/\bchop\s*(head|ahead)\s+off\b/, '');
        } else if (text.match(/\bchop(ped)?\s*(head|ahead)\b/)) {
            modifiers.chopHead = 1;
            text = text.replace(/\bchop(ped)?\s*(head|ahead)\b/, '');
        }

        // Ladder modifier (overlapping rungs shifting one degree at a time).
        // The rung size can lead ("four note ladder") or trail ("ladder of four").
        if (text.match(/\b(no|without)\s+ladder\b/) || text.match(/\bladder\s+off\b/)) {
            modifiers.ladder = 'off';
            text = text.replace(/\b(no|without)\s+ladder\b/, '').replace(/\bladder\s+off\b/, '');
        } else {
            const ladderRe = /\b(?:(two|three|four|five|six|seven|eight|[2-8])[\s-]*note\s+)?(reversed?\s+)?ladder(?:\s+(?:of\s+)?(two|three|four|five|six|seven|eight|[2-8]))?\b/;
            const ladderMatch = text.match(ladderRe);
            if (ladderMatch) {
                modifiers.ladder = ladderMatch[2] ? 'reverse' : 'on';
                const sizeToken = ladderMatch[1] || ladderMatch[3];
                if (sizeToken) modifiers.ladderSize = this.parseLadderCount(sizeToken);
                text = text.replace(ladderRe, '');
            }
        }

        // Tempo modifiers (check longer phrases first)
        if (text.match(/\bsuper\s+slow(ly)?\b/) || text.match(/\bsuper\s+long\b/)) {
            modifiers.tempo = 'super slow';
            text = text.replace(/\bsuper\s+slow(ly)?\b/, '').replace(/\bsuper\s+long\b/, '');
        } else if (text.match(/\bvery\s+slowly\b/) || text.match(/\bvery\s+slow\b/)) {
            modifiers.tempo = 'very slow';
            text = text.replace(/\bvery\s+slowly\b/, '').replace(/\bvery\s+slow\b/, '');
        } else if (text.match(/\bslowly\b/) || text.match(/\bslow\b/)) {
            modifiers.tempo = 'slow';
            text = text.replace(/\bslowly\b/, '').replace(/\bslow\b/, '');
        } else if (text.match(/\bvery\s+quickly\b/) || text.match(/\bvery\s+fast\b/)) {
            modifiers.tempo = 'very fast';
            text = text.replace(/\bvery\s+quickly\b/, '').replace(/\bvery\s+fast\b/, '');
        } else if (text.match(/\bquickly\b/) || text.match(/\bfast\b/)) {
            modifiers.tempo = 'fast';
            text = text.replace(/\bquickly\b/, '').replace(/\bfast\b/, '');
        }

        // Gap modifiers (check longer phrases first)
        if (text.match(/\bwith\s+(a\s+)?very\s+large\s+gap/)) {
            modifiers.gap = 'very large';
            text = text.replace(/\bwith\s+(a\s+)?very\s+large\s+gap\b/, '');
        } else if (text.match(/\bwith\s+(a\s+)?large\s+(gap|pause)/)) {
            modifiers.gap = 'large';
            text = text.replace(/\bwith\s+(a\s+)?large\s+(gap|pause)(s)?\b/, '');
        } else if (text.match(/\bwith\s+(a\s+)?(small\s+)?(gap|pause)/)) {
            modifiers.gap = text.match(/\bsmall\s+/) ? 'small' : 'normal';
            text = text.replace(/\bwith\s+(a\s+)?(small\s+)?(gap|pause)(s)?\b/, '');
        } else if (text.match(/\bstaccato\b/)) {
            modifiers.gap = 'large';
            text = text.replace(/\bstaccato\b/, '');
        } else if (text.match(/\blegato\b/)) {
            modifiers.gap = 'none';
            text = text.replace(/\blegato\b/, '');
        }

        // Repeat modifiers
        // Repeat modifiers - check specific patterns first, then bare "repeat"
        if (text.match(/\b(and\s+)?repeat\s+(\d+)\s+times\b/)) {
            // "repeat 5 times"
            const match = text.match(/\b(and\s+)?repeat\s+(\d+)\s+times\b/);
            modifiers.repeat = parseInt(match[2]);
            text = text.replace(/\b(and\s+)?repeat\s+\d+\s+times\b/, '');
        } else if (text.match(/\b(and\s+)?repeat\s+(twice|two\s+times|2\s+times)\b/)) {
            // "repeat twice"
            modifiers.repeat = 2;
            text = text.replace(/\b(and\s+)?repeat\s+(twice|two\s+times|2\s+times)\b/, '');
        } else if (text.match(/\b(and\s+)?repeat\s+(three\s+times|3\s+times)\b/)) {
            // "repeat three times"
            modifiers.repeat = 3;
            text = text.replace(/\b(and\s+)?repeat\s+(three\s+times|3\s+times)\b/, '');
        } else if (text.match(/\bthree\s+times\b/) || text.match(/\b3\s+times\b/)) {
            // "three times" (without repeat)
            modifiers.repeat = 3;
            text = text.replace(/\b(three|3)\s+times\b/, '');
        } else if (text.match(/\btwice\b/) || text.match(/\btwo\s+times\b/) || text.match(/\b2\s+times\b/)) {
            // "twice" (without repeat)
            modifiers.repeat = 2;
            text = text.replace(/\b(twice|two\s+times|2\s+times)\b/, '');
        } else if (text.match(/\b(and\s+)?(repeat\s+)?forever\s+no\s+gap\b/)) {
            // "forever no gap", "repeat forever no gap"
            modifiers.repeat = Infinity;
            modifiers.repeatGapMs = 0;
            text = text.replace(/\b(and\s+)?(repeat\s+)?forever\s+no\s+gap\b/, '');
        } else if (text.match(/\b(and\s+)?(repeat\s+)?forever\b/)) {
            // "forever", "repeat forever", "and repeat forever"
            modifiers.repeat = Infinity;
            modifiers.repeatGapMs = FOREVER_SECTION_GAP_MS;
            text = text.replace(/\b(and\s+)?(repeat\s+)?forever\b/, '');
        } else if (text.match(/\b(and\s+)?repeat\b/) || text.match(/\bloop\b/)) {
            // "repeat" alone = forever, "loop" = forever
            modifiers.repeat = Infinity;
            text = text.replace(/\b(and\s+)?repeat\b/, '').replace(/\bloop\b/, '');
        }

        // Direction modifiers (inline)
        if (text.match(/\bascending\b/) || text.match(/\bgoing\s+up\b/)) {
            modifiers.direction = 'ascending';
            text = text.replace(/\bascending\b/, '').replace(/\bgoing\s+up\b/, '');
        } else if (text.match(/\bdescending\b/) || text.match(/\bgoing\s+down\b/)) {
            modifiers.direction = 'descending';
            text = text.replace(/\bdescending\b/, '').replace(/\bgoing\s+down\b/, '');
        } else if (text.match(/\bdown\s+and\s+up\b/)) {
            modifiers.direction = 'down_and_up';
            text = text.replace(/\bdown\s+and\s+up\b/, '');
        } else if (text.match(/\bup\s+and\s+down\b/) || text.match(/\bboth\s+ways\b/)) {
            modifiers.direction = 'both';
            text = text.replace(/\bup\s+and\s+down\b/, '').replace(/\bboth\s+ways\b/, '');
        }

        // Clean up extra spaces
        text = text.replace(/\s+/g, ' ').trim();
        // Remove leading "play" 
        text = text.replace(/^play\s+/, '');

        return { cleanedText: text, modifiers };
    }

    /**
     * @param {string} transcript
     * @returns {ScaleCommand | null}
     */
    parseScaleCommand(transcript) {
        // First extract modifiers
        const { cleanedText, modifiers } = this.extractModifiers(transcript);
        let lower = cleanedText.toLowerCase().trim();
        const originalLower = transcript.toLowerCase().trim();

        // Speech stutters happen: "c c chromatic scale" should behave like "c chromatic scale".
        // Collapse immediate duplicate note tokens while preserving intent (e.g., "c c sharp" -> "c sharp").
        const tokens = lower.split(/\s+/).filter(Boolean);
        if (tokens.length > 1) {
            const deduped = [];
            let prevNote = null;
            for (const tok of tokens) {
                const note = normalizeNoteName(tok);
                if (note && prevNote && note === prevNote) {
                    continue;
                }
                deduped.push(tok);
                prevNote = note || null;
            }
            lower = deduped.join(' ');
        }

        // Stop command
        if (originalLower.match(/^(stop|quiet|silence|enough)$/)) {
            return { type: 'stop' };
        }

        // Help command
        if (originalLower.match(/^(help|commands|what can (i|you) (say|do))/)) {
            return { type: 'help' };
        }

        // Play command (or again/repeat)
        if (originalLower.match(/^(play|again|repeat that|play (it |that )?again|one more time|do (it |that )?again)$/)) {
            return { type: 'play' };
        }

        // Standalone movement style commands
        const spokenMovement = SCALES_MOVEMENT_COMMANDS.find(([pattern]) => pattern.test(originalLower));
        const spokenLeap = originalLower.match(/^(?:in\s+)?(thirds?|fourths?|fifths?|sixths?|sevenths?|3rds?|4ths?|5ths?|6ths?|7ths?)\s+(up|down)$/) || originalLower.match(/^([34567])\s*([ud])$/);
        if (spokenMovement || spokenLeap) {
            const style = spokenMovement
                ? spokenMovement[1]
                : `${SCALES_LEAP_WORDS[spokenLeap[1].replace(/s$/, '')]}_${spokenLeap[2].startsWith('u') ? 'up' : 'down'}`;
            this.setMovementStyle(style);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: style };
        }

        // Standalone rising/modulation commands
        if (originalLower.match(/^(no\s+rising|without\s+rising|rising\s+off|rising\s+disabled)$/)) {
            this.setRisingSemitones(0);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'risingSemitones', value: 0 };
        }
        if (originalLower.match(/^rising(\s+(half\s*step|whole\s*step|minor\s+third|major\s+third|perfect\s+fourth|fourth|perfect\s+fifth|fifth))?$/) ||
            originalLower.match(/^modulat(e|ing)(\s+(half\s*step|whole\s*step|minor\s+third|major\s+third|perfect\s+fourth|fourth|perfect\s+fifth|fifth))?$/)) {
            let semitones = 1;
            if (originalLower.match(/whole\s*step/)) semitones = 2;
            else if (originalLower.match(/minor\s+third/)) semitones = 3;
            else if (originalLower.match(/major\s+third/)) semitones = 4;
            else if (originalLower.match(/perfect\s+fourth/) || originalLower.match(/\bfourth\b/)) semitones = 5;
            else if (originalLower.match(/perfect\s+fifth/) || originalLower.match(/\bfifth\b/)) semitones = 7;
            else if (originalLower.match(/half\s*step/)) semitones = 1;

            this.setRisingSemitones(semitones);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'risingSemitones', value: semitones };
        }

        // Standalone exercise commands
        if (originalLower.match(/^(5|five)\s*note\s*(warmup|warm\s*up|exercise)?$/) || originalLower.match(/^warmup$/)) {
            this.setExercise('five_note', true);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'exercise', value: 'five_note' };
        }
        if (originalLower.match(/^octave\s*jump$/)) {
            this.setExercise('octave_jump', true);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'exercise', value: 'octave_jump' };
        }
        if (originalLower.match(/^(arpeggio|arp)\s*return$/) || originalLower.match(/^return\s*(arpeggio|arp)$/)) {
            this.setExercise('arpeggio_return', true);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'exercise', value: 'arpeggio_return' };
        }
        if (originalLower.match(/^thirds(\s*exercise)?$/) || originalLower.match(/^skip(\s*pattern)?$/)) {
            this.setExercise('thirds', true);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'exercise', value: 'thirds' };
        }
        if (originalLower.match(/^(no\s*exercise|exercise\s*off|full\s*scale)$/)) {
            this.settings.exercise = 'none';
            this.settings.shiftingSteps = 0;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'exercise', value: 'none' };
        }
        if (originalLower.match(/^shift(ing)?(\s+on)?$/) || originalLower.match(/^walk(ing)?$/)) {
            this.setShiftingSteps(1);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'shiftingSteps', value: 1 };
        }
        if (originalLower.match(/^(no\s*shift(ing)?|shift(ing)?\s*off)$/)) {
            this.settings.shiftingSteps = 0;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'shiftingSteps', value: 0 };
        }

        // Standalone chop head commands
        if (originalLower.match(/^chop(ped)?\s*(head|ahead)(\s+(on|mode))?$/)) {
            this.setChopHead(1);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'chopHead', value: 1 };
        }
        if (originalLower.match(/^(no\s+chop\s*(head|ahead)|without\s+chop\s*(head|ahead)|chop\s*(head|ahead)\s+off)$/)) {
            this.setChopHead(0);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'chopHead', value: 0 };
        }

        // Standalone ladder commands
        if (originalLower.match(/^(no\s+ladder|without\s+ladder|ladder\s+off)$/)) {
            this.setLadder('off');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'ladder', value: 'off' };
        }
        const ladderGapStandalone = originalLower.match(/^ladder\s+(?:no\s+gap|(?:gap|pause)\s+(none|zero|no\s+gap|half(?:\s+a)?\s+second|\d+(?:\.\d+)?(?:\s*seconds?)?))$/);
        if (ladderGapStandalone) {
            const token = ladderGapStandalone[1] || 'no gap';
            let gapMs;
            if (token === 'none' || token === 'zero' || token === 'no gap') {
                gapMs = 0;
            } else if (token.startsWith('half')) {
                gapMs = 500;
            } else {
                gapMs = Math.round(parseFloat(token) * 1000);
            }
            this.settings.ladderGapMs = gapMs;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'ladderGapMs', value: gapMs };
        }
        const ladderStandalone = originalLower.match(/^(?:(two|three|four|five|six|seven|eight|[2-8])[\s-]*note\s+)?(reversed?\s+)?ladder(?:\s+(?:of\s+)?(two|three|four|five|six|seven|eight|[2-8]))?(?:\s+(?:on|mode))?$/);
        if (ladderStandalone) {
            const sizeToken = ladderStandalone[1] || ladderStandalone[3];
            if (sizeToken) this.settings.ladderSize = this.parseLadderCount(sizeToken);
            const mode = ladderStandalone[2] ? 'reverse' : 'on';
            this.setLadder(mode);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'ladder', value: mode };
        }

        // Single note: "play C", "note D", "C sharp", "B flat"
        // Also handles phonetic variants: "see" for C, "bee" for B, etc.
        const phoneticNotes = Object.keys(ScalesVoiceMaps.NOTE_PHONETIC_MAP).join('|');
        const phoneticMods = Object.keys(ScalesVoiceMaps.MODIFIER_PHONETIC_MAP).join('|');
        const noteRegex = new RegExp(`^(play\\s+|note\\s+)?(${phoneticNotes})\\s*(${phoneticMods})?(\\s*\\d)?$`, 'i');
        const noteMatch = lower.match(noteRegex);
        if (noteMatch) {
            const letter = normalizeNoteName(noteMatch[2]);
            const octave = noteMatch[4] ? parseInt(noteMatch[4]) : this.settings.octave;

            if (letter) {
                const note = ScalesVoiceMaps.spokenPitchClassName(letter, normalizeModifier(noteMatch[3]));
                return { type: 'note', note, octave, modifiers };
            }
        }

        // Scale patterns - flexible matching
        // Supports: "C major scale", "chromatic scale", "scale from E", "D minor", "chromatic scale from G"
        // Also accepts phonetic variants: "see major scale", "bee minor", etc.
        const scaleTypes = [
            'major', 'minor', 'chromatic',
            'pentatonic', 'minor\\s*pentatonic', 'blues',
            'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian',
            'harmonic\\s*minor', 'harmonic\\s*major', 'double\\s*harmonic',
            'melodic\\s*minor',
            'whole\\s*tone', 'diminished', 'augmented',
            // Microtonal (longer aliases before their prefixes)
            'quarter[\\s-]*tone', 'quartertone',
            'maqam\\s*rast', 'rast', 'rust',
            'maqam\\s*bayati', 'bayati', 'bayatti', 'biati',
            'maqam\\s*sikah', 'sikah', 'sika', 'seeka',
            'slendro', 'slendra', 'just\\s*major'
        ].join('|');

        // Build phonetic note pattern for regex
        const notePattern = Object.keys(ScalesVoiceMaps.NOTE_PHONETIC_MAP).join('|');
        const modPattern = Object.keys(ScalesVoiceMaps.MODIFIER_PHONETIC_MAP).join('|');

        // Try multiple patterns
        let scaleMatch = null;
        let root = 'C';
        let scaleType = 'major';
        let noteModifier = null;

        // Pattern 1: "[note] [type] scale" e.g., "D major scale", "A dorian", "see chromatic"
        const pattern1 = lower.match(new RegExp(`^(${notePattern})\\s*(${modPattern})?\\s*(${scaleTypes})?\\s*(scale)?$`, 'i'));
        // Pattern 2: "[type] scale (from [note])" e.g., "chromatic scale", "chromatic scale from E"
        // Also handles "a chromatic scale" where "a" is an article
        const pattern2 = lower.match(new RegExp(`^(a\\s+)?(${scaleTypes})\\s*(scale)?\\s*(from|starting\\s+on|starting\\s+at)?\\s*(${notePattern})?\\s*(${modPattern})?$`, 'i'));
        // Pattern 3: "scale (from [note])" or "a scale" e.g., "scale", "scale from D", "a scale"
        const pattern3 = lower.match(new RegExp(`^(a\\s+)?scale\\s*(from|starting\\s+on|starting\\s+at)?\\s*(${notePattern})?\\s*(${modPattern})?$`, 'i'));

        if (pattern1 && (pattern1[3] || pattern1[4])) {
            // Note-first pattern: "A dorian scale", "see major", "dee minor scale"
            scaleMatch = pattern1;
            root = normalizeNoteName(pattern1[1]) || 'C';
            noteModifier = normalizeModifier(pattern1[2]);
            scaleType = pattern1[3] ? normalizeScaleTypeName(pattern1[3]) : 'major';
        } else if (pattern2 && pattern2[2]) {
            // Type-first pattern: "chromatic scale", "a chromatic scale", "harmonic minor from E"
            // pattern2[1] = optional "a " article (ignored)
            // pattern2[2] = scale type
            // pattern2[3] = "scale" (optional)
            // pattern2[4] = "from" (optional)
            // pattern2[5] = note (optional, may be phonetic)
            // pattern2[6] = sharp/flat (optional, may be phonetic)
            scaleMatch = pattern2;
            scaleType = normalizeScaleTypeName(pattern2[2]);
            root = normalizeNoteName(pattern2[5]) || 'C';
            noteModifier = normalizeModifier(pattern2[6]);
        } else if (pattern3) {
            // Just "scale" or "a scale" with optional "from [note]"
            // pattern3[1] = optional "a " article (ignored)
            // pattern3[2] = "from" (optional)
            // pattern3[3] = note (optional, may be phonetic)
            // pattern3[4] = sharp/flat (optional, may be phonetic)
            scaleMatch = pattern3;
            root = normalizeNoteName(pattern3[3]) || 'C';
            noteModifier = normalizeModifier(pattern3[4]);
            scaleType = 'major';
        }

        if (scaleMatch) {
            root = ScalesVoiceMaps.spokenPitchClassName(root, noteModifier);
            return { type: 'scale', root, scaleType, modifiers };
        }

        // Arpeggio: "C arpeggio", "arpeggio D minor"
        const arpMatch = lower.match(/([a-g])?\s*(sharp|flat|#|b)?\s*(major|minor)?\s*arpeggio/i) ||
            lower.match(/arpeggio\s+([a-g])?\s*(sharp|flat|#|b)?\s*(major|minor)?/i);
        if (arpMatch) {
            const root = ScalesVoiceMaps.spokenPitchClassName((arpMatch[1] || 'C').toUpperCase(), normalizeModifier(arpMatch[2]));
            const quality = arpMatch[3] ? arpMatch[3].toLowerCase() : 'major';
            return { type: 'arpeggio', root, quality, modifiers };
        }

        // Chord: "C chord", "D minor chord"
        const chordMatch = lower.match(/([a-g])\s*(sharp|flat|#|b)?\s*(major|minor)?\s*chord/i);
        if (chordMatch) {
            const root = ScalesVoiceMaps.spokenPitchClassName(chordMatch[1].toUpperCase(), normalizeModifier(chordMatch[2]));
            const quality = chordMatch[3] ? chordMatch[3].toLowerCase() : 'major';
            return { type: 'chord', root, quality, modifiers };
        }

        // Section width commands (standalone) - "1 octave", "1o", "octave+3rd", etc.
        // These MUST be checked BEFORE the interval parser catches them
        if (originalLower.match(/^(1\s*o\s*\+\s*3(rd)?|octave\s*\+\s*3(rd)?|octave\s+plus\s+(a\s+)?third|section\s+octave\s*\+\s*3)$/)) {
            this.settings.sectionLength = '1o+3';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'sectionLength', value: '1o+3' };
        }
        if (originalLower.match(/^(1\s*o\s*\+\s*5(th)?|octave\s*\+\s*5(th)?|octave\s+plus\s+(a\s+)?fifth|section\s+octave\s*\+\s*5)$/)) {
            this.settings.sectionLength = '1o+5';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'sectionLength', value: '1o+5' };
        }
        if (originalLower.match(/^(1\s*o(ctave)?|one\s*octave|single\s*octave)$/)) {
            this.settings.sectionLength = '1o';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'sectionLength', value: '1o' };
        }
        if (originalLower.match(/^(2\s*o(ctaves?)?|two\s*octaves?|double\s*octave)$/)) {
            this.settings.sectionLength = '2o';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'sectionLength', value: '2o' };
        }

        // Note length commands (standalone) - "0.5 seconds", "half second", "1s", etc.
        // These MUST be checked BEFORE the interval parser catches them
        if (originalLower.match(/^(half\s*a?\s*second|point\s*five\s*(seconds?)?)$/)) {
            this.settings.noteLengthMs = 500;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 500 };
        }
        if (originalLower.match(/^(one\s*second|a\s*second)$/)) {
            this.settings.noteLengthMs = 1000;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 1000 };
        }
        if (originalLower.match(/^(two\s*seconds?|a\s*couple\s*seconds?)$/)) {
            this.settings.noteLengthMs = 2000;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 2000 };
        }
        if (originalLower.match(/^(three\s*seconds?)$/)) {
            this.settings.noteLengthMs = 3000;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 3000 };
        }
        if (originalLower.match(/^(five\s*seconds?)$/)) {
            this.settings.noteLengthMs = 5000;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 5000 };
        }
        // Numeric durations: "0.5s", "1s", "500ms", etc.
        const noteLengthMatch = originalLower.match(/^(0?\.?\d+)\s*(s(ec(ond)?s?)?|ms|milliseconds?)$/);
        if (noteLengthMatch) {
            let value = parseFloat(noteLengthMatch[1]);
            const unit = noteLengthMatch[2];
            if (unit.startsWith('ms') || unit.startsWith('milli')) {
                // already in ms
            } else {
                value = value * 1000; // convert seconds to ms
            }
            if (value >= 50 && value <= 10000) {
                this.settings.noteLengthMs = value;
                this.syncUIToSettings();
                return { type: 'setting', setting: 'noteLengthMs', value };
            }
        }

        // Interval: "fifth", "third from C", "perfect fifth", "minor 3rd", "major 2nd"
        // Accept both word forms (third) and numeric forms (3rd)
        // Also accepts phonetic note names: "fifth from see", "third from bee"
        const intervalRegex = new RegExp(`(perfect\\s+|major\\s+|minor\\s+)?(unison|1st|first|2nd|second|3rd|third|4th|fourth|5th|fifth|6th|sixth|7th|seventh|8th|octave)(\\s+from\\s+(${notePattern}))?`, 'i');
        const intervalMatch = lower.match(intervalRegex);
        if (intervalMatch) {
            const quality = intervalMatch[1] ? intervalMatch[1].trim() : '';
            // Normalize numeric forms to word forms
            const intervalMap = {
                '1st': 'unison', 'first': 'unison', 'unison': 'unison',
                '2nd': 'second', 'second': 'second',
                '3rd': 'third', 'third': 'third',
                '4th': 'fourth', 'fourth': 'fourth',
                '5th': 'fifth', 'fifth': 'fifth',
                '6th': 'sixth', 'sixth': 'sixth',
                '7th': 'seventh', 'seventh': 'seventh',
                '8th': 'octave', 'octave': 'octave'
            };
            const interval = intervalMap[intervalMatch[2].toLowerCase()];
            const root = normalizeNoteName(intervalMatch[4]) || 'C';
            return { type: 'interval', interval, quality, root, modifiers };
        }

        // Tuning note
        if (originalLower.match(/^(tuning|tuning note|a\s*440|concert\s*a|reference)$/)) {
            return { type: 'tuning', modifiers };
        }

        // Direction commands (standalone) - includes abbreviations
        if (originalLower.match(/^(ascending|up|upward|u)$/)) {
            this.settings.direction = 'ascending';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'direction', value: 'ascending' };
        }
        if (originalLower.match(/^(descending|down|downward|d)$/)) {
            this.settings.direction = 'descending';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'direction', value: 'descending' };
        }
        if (originalLower.match(/^(up\s*(and|&|\+)\s*down|u\s*\+\s*d|both\s*ways)$/)) {
            this.settings.direction = 'both';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'direction', value: 'both' };
        }
        if (originalLower.match(/^(down\s*(and|&|\+)\s*up|d\s*\+\s*u)$/)) {
            this.settings.direction = 'down_and_up';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'direction', value: 'down_and_up' };
        }

        // Tempo commands (standalone)
        if (originalLower.match(/^(super\s+slow|really\s+slow|very\s+very\s+slow)$/)) {
            this.settings.noteLengthMs = this.tempoNameToMs['super slow'];
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'super slow' };
        }
        if (originalLower.match(/^(very\s+slow|real\s+slow)$/)) {
            this.settings.noteLengthMs = this.tempoNameToMs['very slow'];
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'very slow' };
        }
        if (originalLower.match(/^(slow|slower)$/)) {
            this.settings.noteLengthMs = this.tempoNameToMs['slow'];
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'slow' };
        }
        if (originalLower.match(/^(normal\s+speed|normal\s+tempo|medium|default\s+speed)$/)) {
            this.settings.noteLengthMs = this.tempoNameToMs['normal'];
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'normal' };
        }
        if (originalLower.match(/^(fast|faster|quick)$/)) {
            this.settings.noteLengthMs = this.tempoNameToMs['fast'];
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'fast' };
        }
        if (originalLower.match(/^(very\s+fast|really\s+fast|super\s+fast)$/)) {
            this.settings.noteLengthMs = this.tempoNameToMs['very fast'];
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'very fast' };
        }

        // Octave commands (standalone) - "3", "4", "5", "octave 3", etc.
        const octaveMatch = originalLower.match(/^(octave\s+)?([2-6])$/);
        if (octaveMatch) {
            const octave = parseInt(octaveMatch[2]);
            this.settings.octave = octave;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'octave', value: octave };
        }

        // Scale type commands (standalone) - abbreviations
        if (originalLower.match(/^(maj(or)?|major\s+scale)$/)) {
            this.settings.scaleType = 'major';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'scaleType', value: 'major' };
        }
        if (originalLower.match(/^(min(or)?|minor\s+scale)$/)) {
            this.settings.scaleType = 'minor';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'scaleType', value: 'minor' };
        }
        if (originalLower.match(/^(chr(omatic)?|chromatic\s+scale)$/)) {
            this.settings.scaleType = 'chromatic';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'scaleType', value: 'chromatic' };
        }
        if (originalLower.match(/^(pent(atonic)?|pentatonic\s+scale)$/)) {
            this.settings.scaleType = 'pentatonic';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'scaleType', value: 'pentatonic' };
        }
        if (originalLower.match(/^(h\s*min|hmin|harmonic\s*min(or)?|harmonic\s+minor\s+scale)$/)) {
            this.settings.scaleType = 'harmonic_minor';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'scaleType', value: 'harmonic_minor' };
        }
        if (originalLower.match(/^(m\s*min|mmin|melodic\s*min(or)?|melodic\s+minor\s+scale)$/)) {
            this.settings.scaleType = 'melodic_minor';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'scaleType', value: 'melodic_minor' };
        }

        // Repeat commands (standalone) - includes abbreviations
        if (originalLower.match(/^(once|one\s*time|1\s*x|1\s*time)$/)) {
            this.settings.repeatCount = 1;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: 1 };
        }
        if (originalLower.match(/^(twice|two\s*times|2\s*x|2\s*times)$/)) {
            this.settings.repeatCount = 2;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: 2 };
        }
        if (originalLower.match(/^(thrice|three\s*times|3\s*x|3\s*times)$/)) {
            this.settings.repeatCount = 3;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: 3 };
        }
        if (originalLower.match(/^(inf(inity)?|forever|loop|repeat\s*forever)$/)) {
            this.settings.repeatCount = Infinity;
            this.settings.repeatGapMs = FOREVER_SECTION_GAP_MS;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: Infinity };
        }
        if (originalLower.match(/^(inf(inity)?\s*(0\s*g(ap)?|no\s*gap)|forever\s*no\s*gap)$/)) {
            this.settings.repeatCount = Infinity;
            this.settings.repeatGapMs = 0;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: 'infinity-nogap' };
        }

        // Rising commands (standalone) - includes abbreviations
        // Check major 2nd / whole step FIRST (case-sensitive M2)
        if (originalLower.match(/^(major\s*2(nd)?|whole\s*(step)?|tone|2\s*semitones?)$/) ||
            transcript.match(/^M\s*2$/)) {
            this.setRisingSemitones(2);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'risingSemitones', value: 2 };
        }
        if (originalLower.match(/^(rising\s*off|off|no\s*rising|0\s*semitones?)$/)) {
            this.setRisingSemitones(0);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'risingSemitones', value: 0 };
        }
        if (originalLower.match(/^(m\s*2|minor\s*2(nd)?|half\s*step|semitone|1\s*semitone)$/)) {
            this.setRisingSemitones(1);
            this.syncUIToSettings();
            return { type: 'setting', setting: 'risingSemitones', value: 1 };
        }

        // Gap commands (standalone) - "no gap", "0 gap", "legato", "staccato", "-50%", etc.
        if (originalLower.match(/^(no\s*gap|zero\s*gap|0\s*(s|gap)|legato)$/)) {
            this.settings.gapMs = 0;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'gapMs', value: 0 };
        }
        if (originalLower.match(/^(staccato|detached|separated)$/)) {
            this.settings.gapMs = 300;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'gapMs', value: 300 };
        }
        // Overlap percentages
        const overlapMatch = originalLower.match(/^-\s*(\d+)\s*%$/);
        if (overlapMatch) {
            const pct = parseInt(overlapMatch[1]);
            if (pct >= 5 && pct <= 90) {
                const overlap = -pct / 100;
                this.settings.gapMs = overlap;
                this.syncUIToSettings();
                return { type: 'setting', setting: 'gapMs', value: overlap };
            }
        }
        if (originalLower.match(/^(overlap|overlapping)$/)) {
            this.settings.gapMs = -0.1;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'gapMs', value: -0.1 };
        }

        // Reset and Random commands
        if (originalLower.match(/^reset$/)) {
            this.resetToDefaults();
            return { type: 'reset' };
        }
        if (originalLower.match(/^random(ize)?$/)) {
            this.randomizeCoreFilters();
            return { type: 'random' };
        }

        return null;
    }

    /**
     * @param {ScaleCommand} command
     * @param {string | null} [transcript]
     * @param {boolean} [skipHistory]
     */
    async executeScaleCommand(command, transcript = null, skipHistory = false) {
        await this.ensureAudioStarted();

        // Track if we were playing (for setting commands that should restart)
        const wasPlaying = this.audio.isPlaying;

        // Stop any currently playing sequence immediately
        this.stopPlayback();

        if (command.type === 'scale') this.applyScaleCommand(command);

        // Add to history (for playable commands, not control commands)
        const playableTypes = ['note', 'scale', 'arpeggio', 'chord', 'interval', 'tuning'];
        if (!skipHistory && playableTypes.includes(command.type)) {
            this.addToHistory(command, transcript);
        }

        // Echo the recognized command if enabled (for debugging)
        if (this.voiceCore.echoCommands && command.type !== 'stop' && command.type !== 'help' && command.type !== 'play') {
            const description = this.getCommandDescription(command);
            await this.voiceCore.speakTextAsync(description);
        }

        switch (command.type) {
            case 'stop':
                break;

            case 'help':
                this.showHelp();
                break;

            case 'play':
                // Play current settings (whatever is in the UI)
                await this.playCurrentSettings();
                return; // Don't store 'play' as last command

            case 'note':
                this.lastCommand = command;
                this.soundSingleNote(noteNameToMidi(command.note, command.octave), '8n');
                break;

            case 'scale':
                // applyScaleCommand wrote the words into the settings.
                this.lastCommand = command;
                await this.playScale();
                break;

            case 'arpeggio':
                this.lastCommand = command;
                await this.playArpeggio(command);
                break;

            case 'chord':
                this.lastCommand = command;
                await this.playChord(command);
                break;

            case 'interval':
                this.lastCommand = command;
                await this.playInterval(command);
                break;

            case 'tuning':
                this.lastCommand = command;
                this.soundSingleNote(noteNameToMidi('A', 4), '2n');
                break;

            case 'setting':
                // Parsing applied the setting; keep it, and carry a playing
                // scale on with it.
                this.saveSettings();
                if (this.singPanel) this.singPanel.draw();
                if (wasPlaying && this.lastCommand && this.lastCommand.type === 'scale') await this.playScale();
                break;

            case 'reset':
                // Parsing reset the settings; keep them.
                this.saveSettings();
                if (this.singPanel) this.singPanel.draw();
                break;
        }
    }

    /**
     * Voice-first sync: write a scale command's words into the settings so
     * the buttons, the keyboard, and history show what plays. Exercise and
     * shifting go last: playback lets them override chop head and the ladder,
     * and their setters clear those.
     * @param {ScaleCommand} command
     */
    applyScaleCommand(command) {
        const mods = command.modifiers;
        this.settings.root = command.root;
        this.settings.scaleType = command.scaleType;
        if (mods.direction) this.settings.direction = mods.direction;
        if (mods.movementStyle) this.setMovementStyle(mods.movementStyle);
        if (mods.sectionLength) this.settings.sectionLength = mods.sectionLength;
        if (mods.risingSemitones !== null && mods.risingSemitones !== undefined) {
            this.setRisingSemitones(mods.risingSemitones);
        }
        if (mods.chopHead !== null && mods.chopHead !== undefined) this.setChopHead(mods.chopHead);
        if (mods.ladderSize !== null && mods.ladderSize !== undefined) this.settings.ladderSize = mods.ladderSize;
        if (mods.ladder !== null && mods.ladder !== undefined) this.setLadder(mods.ladder);
        if (mods.exercise !== null && mods.exercise !== undefined) this.setExercise(mods.exercise);
        if (mods.shiftingSteps !== null && mods.shiftingSteps !== undefined) this.setShiftingSteps(mods.shiftingSteps);
        if (mods.tempo) {
            const ms = this.tempoNameToMs[mods.tempo];
            if (ms !== undefined) this.settings.noteLengthMs = ms;
        }
        if (mods.gap) {
            const gapVal = this.gapNameToValue[mods.gap];
            if (gapVal !== undefined) this.settings.gapMs = gapVal;
        }
        if (mods.repeat !== undefined && mods.repeat !== null) this.settings.repeatCount = mods.repeat;
        if (mods.repeatGapMs !== undefined && mods.repeatGapMs !== null) this.settings.repeatGapMs = mods.repeatGapMs;
        this.syncUIToSettings();
    }

    /**
     * Get a speakable description of a command (for echo mode)
     * @param {ScaleCommand} command
     */
    getCommandDescription(command) {
        const mods = command.modifiers || {};
        let parts = [];

        // Tempo modifier
        if (mods.tempo) {
            parts.push(mods.tempo.includes('very') ? 'very slowly' : mods.tempo === 'fast' ? 'quickly' : 'slowly');
        }

        // Main command
        switch (command.type) {
            case 'note':
                parts.push(this.speakableNote(command.note) + (command.octave ? ` ${command.octave}` : ''));
                break;
            case 'scale':
                parts.push(this.speakableNote(command.root));
                parts.push(command.scaleType.replace('_', ' '));
                parts.push('scale');
                break;
            case 'arpeggio':
                parts.push(this.speakableNote(command.root));
                parts.push(command.quality);
                parts.push('arpeggio');
                break;
            case 'chord':
                parts.push(this.speakableNote(command.root));
                parts.push(command.quality);
                parts.push('chord');
                break;
            case 'interval':
                parts.push(command.quality || '');
                parts.push(command.interval);
                parts.push('from');
                parts.push(this.speakableNote(command.root));
                break;
            case 'tuning':
                return 'A four forty tuning note';
        }

        // Direction
        if (mods.direction) {
            if (mods.direction === 'both') {
                parts.push('up and down');
            } else if (mods.direction === 'down_and_up') {
                parts.push('down and up');
            } else {
                parts.push(mods.direction);
            }
        }

        // Movement style (scale-only)
        if (mods.movementStyle) {
            /** @type {Record<string, string>} */
            const speakable = {
                stop_and_go: 'stop and go',
                one_three_five: 'one three five',
                neighbors: 'neighbors',
                chords: 'chords',
                from_one: 'from one',
                to_one: 'to one',
                plus_minus_one: 'plus minus one',
                chromatic_stop_and_go: 'chromatic stop and go',
                plus_minus_half: 'plus minus half',
                third_up: 'thirds up',
                fourth_up: 'fourths up',
                fifth_up: 'fifths up',
                sixth_up: 'sixths up',
                seventh_up: 'sevenths up',
                third_down: 'thirds down',
                fourth_down: 'fourths down',
                fifth_down: 'fifths down',
                sixth_down: 'sixths down',
                seventh_down: 'sevenths down'
            };
            if (speakable[mods.movementStyle]) parts.push(speakable[mods.movementStyle]);
        }

        // Rising / modulation
        if (mods.risingSemitones) {
            parts.push('rising');
            parts.push(SCALES_OPTION_LABELS.risingSemitones[mods.risingSemitones]);
        }

        // Chop head
        if (mods.chopHead) {
            parts.push('chop head');
        }

        // Ladder
        if (mods.ladder && mods.ladder !== 'off') {
            if (mods.ladder === 'reverse') parts.push('reverse');
            parts.push('ladder');
            const size = mods.ladderSize ?? this.settings.ladderSize;
            parts.push(`of ${size}`);
        }

        // Gap
        if (mods.gap) {
            parts.push('with');
            if (mods.gap.includes('very')) parts.push('very large');
            else if (mods.gap.includes('large')) parts.push('large');
            else parts.push('small');
            parts.push('gaps');
        }

        // Repeat
        if (mods.repeat === Infinity) {
            const repeatGapMs = mods.repeatGapMs ?? this.settings.repeatGapMs;
            parts.push(repeatGapMs === 0 ? 'forever no gap' : 'forever');
        } else if (mods.repeat > 1) {
            parts.push(mods.repeat === 2 ? 'twice' : `${mods.repeat} times`);
        }

        return parts.filter(p => p).join(' ');
    }

    /**
     * Convert note name to speakable form (C# -> C sharp)
     * @param {string | undefined} note
     */
    speakableNote(note) {
        if (!note) return '';
        return note
            .replace('#', ' sharp')
            .replace('b', ' flat');
    }

    /** @param {string} token - spoken rung size ("four" or "4") */
    parseLadderCount(token) {
        return LADDER_COUNT_WORDS[token] ?? parseInt(token);
    }

    /** @param {number} midi */
    formatPitchStringForCurrentScale(midi) {
        return scaleMidiToPitchString(
            this.settings.root,
            this.settings.octave,
            this.settings.scaleType,
            midi
        );
    }

    /** Play the scale the settings describe, so what sounds is what the page shows. */
    async playScale() {
        // Voice commands mutate settings without passing through
        // onSettingChanged, so persist whatever is about to play.
        this.saveSettings();

        const s = this.settings;
        const shown = this.settingsShown();
        const modifiers = this.buildModifiersFromSettings();
        const exercisePattern = this.settingsExercisePattern();
        if (exercisePattern) {
            await this.playExercise(shown, exercisePattern, modifiers);
            return;
        }

        const { groups, notes } = this.settingsPass();
        if (s.ladder !== 'off') {
            await this.playGroupSequence(shown, groups, modifiers, { groupGapMs: s.ladderGapMs });
        } else if (s.movementStyle !== 'normal') {
            await this.playGroupSequence(shown, groups, modifiers);
        } else {
            await this.playSequence(shown, notes, modifiers);
        }
    }

    /**
     * Play a sequence organized into groups (phrases).
     * Movement styles flow group-to-group with no extra gap; the ladder
     * passes its configurable rung gap through options.groupGapMs.
     * All note arrays are MIDI.
     * @param {ScalesShown} shown
     * @param {ScalesGroup[]} groups
     * @param {ScaleModifiers} [modifiers]
     * @param {{ groupGapMs?: number }} [options]
     */
    async playGroupSequence(shown, groups, modifiers = {}, options = {}) {
        const groupGapMs = options.groupGapMs || 0;
        const repeatCount = modifiers.repeat ?? this.settings.repeatCount;
        const playTimes = repeatCount === 0 ? 1 : repeatCount;
        const isInfinite = playTimes === Infinity;
        const risingSemitones = (modifiers.risingSemitones ?? this.settings.risingSemitones) || 0;
        const repeatGapMs = modifiers.repeatGapMs ?? this.settings.repeatGapMs;
        const passNotes = groups.flatMap(group => group.notes);

        /** @param {number} transpose */
        const showRepeat = transpose => {
            this.showPass(shown, passNotes, transpose);
            this.clearActuallyPlayed();
            this.updateNoteSequencePreview(transpose);
        };

        const playId = this.audio.requestSequencePlayback();
        let r = 0;
        showRepeat(0);

        try {
            while (this.audio.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                const transpose = risingSemitones * r;

                for (let g = 0; g < groups.length; g++) {
                    if (!this.audio.isPlaybackValid(playId)) break;

                    const duration = this.getNoteDuration(modifiers);
                    const { sectionIndex, isChord } = groups[g];
                    const groupMidi = groups[g].notes.map(midi => midi + transpose);

                    if (isChord) {
                        this.showSounding(groupMidi);
                        this.appendActuallyPlayedChord(groupMidi);

                        this.audio.playChord(groupMidi, duration.tone);
                        await this.audio.sleep(duration.ms + duration.gap);
                    } else {
                        for (let i = 0; i < groupMidi.length; i++) {
                            if (!this.audio.isPlaybackValid(playId)) break;

                            const midi = groupMidi[i];
                            this.showSounding([midi]);
                            this.appendActuallyPlayed(midi, i === sectionIndex);

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
                    showRepeat(risingSemitones * r);

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
     * Play an exercise pattern with optional shifting. All notes are MIDI.
     * @param {ScalesShown} shown
     * @param {(number | 'O')[]} exercisePattern
     * @param {ScaleModifiers} modifiers
     */
    async playExercise(shown, exercisePattern, modifiers) {
        const shiftingSteps = modifiers.shiftingSteps ?? this.settings.shiftingSteps;
        const repeatCount = modifiers.repeat ?? this.settings.repeatCount;
        const playTimes = repeatCount === 0 ? 1 : repeatCount;
        const isInfinite = playTimes === Infinity;
        const repeatGapMs = modifiers.repeatGapMs ?? this.settings.repeatGapMs;

        // Shifting walks the start up the scale until the pattern runs off
        // the top of the notes it is built from; that empty pass ends it.
        /** @param {number} pass */
        const passNotes = pass => ScalesPatterns.buildExerciseNotes(
            shown.rootMidi, shown.scaleType, exercisePattern, shiftingSteps * pass);
        const playId = this.audio.requestSequencePlayback();
        let r = 0;
        let notes = passNotes(0);
        const showRepeat = () => {
            if (notes.length) this.showPass(shown, notes);
            this.clearActuallyPlayed();
        };
        showRepeat();

        try {
            while (this.audio.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                if (notes.length === 0) break;

                for (let i = 0; i < notes.length; i++) {
                    if (!this.audio.isPlaybackValid(playId)) break;

                    const midi = notes[i];
                    const duration = this.getNoteDuration(modifiers);

                    this.showSounding([midi]);
                    this.appendActuallyPlayed(midi, true);

                    this.audio.playNote(midi, duration.tone);
                    await this.audio.sleep(duration.ms + duration.gap);
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.audio.isPlaybackValid(playId)) {
                    notes = passNotes(r);
                    showRepeat();

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

    /** @param {ScaleCommand} command */
    async playArpeggio(command) {
        const rootMidi = noteNameToMidi(command.root, this.settings.octave);
        const up = (command.quality === 'minor' ? [0, 3, 7, 12] : [0, 4, 7, 12]).map(interval => rootMidi + interval);
        const down = [...up].reverse();

        const direction = command.modifiers.direction || this.settings.direction;
        let notes = up;
        if (direction === 'descending') notes = down;
        else if (direction === 'both') notes = [...up, ...down.slice(1)];
        else if (direction === 'down_and_up') notes = [...down, ...up.slice(1)];

        await this.playSequence(this.commandShown(command), notes, command.modifiers);
    }

    /** @param {ScaleCommand} command */
    async playChord(command) {
        const rootMidi = noteNameToMidi(command.root, this.settings.octave);
        const notes = (command.quality === 'minor' ? [0, 3, 7] : [0, 4, 7]).map(interval => rootMidi + interval);
        const duration = '2n';

        this.showPass(this.commandShown(command), notes);
        this.showSounding(notes);
        const finished = await this.audio.playChordRepeated(notes, {
            repeatCount: command.modifiers.repeat || 1,
            gapMs: 2000,
            duration
        });
        if (finished) this.showIdleAfter(Tone.Time(duration).toMilliseconds());
    }

    /** @param {ScaleCommand} command */
    async playInterval(command) {
        const { root, interval, quality } = command;
        const rootMidi = noteNameToMidi(root, this.settings.octave);

        const intervalMap = {
            'unison': 0,
            'second': quality === 'minor' ? 1 : 2,
            'third': quality === 'minor' ? 3 : 4,
            'fourth': 5,
            'fifth': 7,
            'sixth': quality === 'minor' ? 8 : 9,
            'seventh': quality === 'minor' ? 10 : 11,
            'octave': 12
        };

        const semitones = intervalMap[interval];
        await this.playSequence(this.commandShown(command), [rootMidi, rootMidi + semitones], command.modifiers);
    }

    /**
     * Play a sequence of MIDI notes with repeat/rising support.
     * @param {ScalesShown} shown
     * @param {number[]} notes
     * @param {ScaleModifiers} [modifiers]
     */
    async playSequence(shown, notes, modifiers = {}) {
        // Chop head: each pass drops one more leading note (12345678,
        // 2345678, 345678, ... 8). One user-facing "repeat" spans the whole
        // shrinking cycle.
        const chopHead = !!(modifiers.chopHead ?? this.settings.chopHead) && notes.length > 1;
        const chopPassCount = chopHead ? notes.length : 1;

        const repeatCount = modifiers.repeat ?? this.settings.repeatCount;
        const isInfinite = repeatCount === Infinity;
        const baseTimes = repeatCount === 0 ? 1 : repeatCount;
        const playTimes = isInfinite ? Infinity : baseTimes * chopPassCount;

        const risingSemitones = chopHead ? 0 : ((modifiers.risingSemitones ?? this.settings.risingSemitones) || 0);
        const repeatGapMs = modifiers.repeatGapMs ?? this.settings.repeatGapMs;
        const playbackRepeatGapMs = chopHead
            ? repeatGapMs
            : (risingSemitones > 0 ? 0 : (isInfinite ? repeatGapMs : 1500));
        const direction = modifiers.direction || this.settings.direction;
        const omitsContinuousLoopRoot = !chopHead
            && isInfinite
            && playbackRepeatGapMs === 0
            && risingSemitones === 0
            && (direction === 'both' || direction === 'down_and_up');

        // Chop head keeps the whole sequence on the board as it shrinks.
        /** @param {number} repeatIndex */
        const showRepeat = repeatIndex => {
            const transpose = risingSemitones * repeatIndex;
            this.showPass(shown, notes, transpose);
            this.clearActuallyPlayed();
            this.updateNoteSequencePreview(transpose);
        };
        showRepeat(0);

        const finished = await this.audio.playRenderedSequence({
            getDuration: () => this.getNoteDuration(modifiers),
            getNotesForRepeat: repeatIndex => chopHead
                ? notes.slice(repeatIndex % chopPassCount)
                : ScalesPatterns.buildRepeatNotes(notes, repeatIndex, risingSemitones, omitsContinuousLoopRoot),
            onNote: midi => {
                this.showSounding([midi]);
                this.appendActuallyPlayed(midi, true);
            },
            onRepeatEnd: showRepeat,
            repeatCount: playTimes,
            repeatGapMs: playbackRepeatGapMs
        });
        if (finished) this.showIdle();
    }

    getNoteDuration(modifiers = {}) {
        // Note length: voice modifier overrides setting
        let ms;
        if (modifiers.tempo && this.tempoNameToMs[modifiers.tempo] !== undefined) {
            ms = this.tempoNameToMs[modifiers.tempo];
        } else {
            ms = this.settings.noteLengthMs;
        }

        // Tone duration in seconds
        const tone = ms / 1000;

        // Gap: voice modifier overrides setting; negative presets are
        // overlap ratios, resolved by the shared helper.
        let gap;
        if (modifiers.gap && this.gapNameToValue[modifiers.gap] !== undefined) {
            gap = this.gapNameToValue[modifiers.gap];
        } else {
            gap = PracticeControls.effectiveGapMs(this.settings.gapMs, ms);
        }

        return { ms, tone, gap };
    }

    stopPlayback() {
        this.audio.stop();
        if (this.singPanel) this.singPanel.cancelGuide();
        this.showIdle();
        // Also cancel any in-progress voice recognition
        if (this.voiceCore) {
            this.voiceCore.stopListening();
        }
    }

    // Play button: plays exactly what the settings show
    async playCurrentSettings() {
        await this.ensureAudioStarted();
        this.lastCommand = this.settingsCommand();
        this.addToHistory(this.lastCommand, null);
        await this.playScale();
    }

    /** @returns {ScaleCommand} the settings as the scale command that plays them */
    settingsCommand() {
        return {
            type: 'scale',
            root: this.settings.root,
            scaleType: this.settings.scaleType,
            modifiers: this.buildModifiersFromSettings()
        };
    }

    /**
     * A scale entry keeps the settings it played with, so its line and
     * its replay name the same thing.
     * @param {ScaleCommand} command
     * @param {string | null} transcript - the words heard; null for a button
     */
    addToHistory(command, transcript) {
        this.history.add({
            type: 'command',
            command: structuredClone(command),
            config: command.type === 'scale' ? this.getCurrentConfigSnapshot() : null,
            transcript,
            description: this.describeCommand(command),
            timestamp: new Date()
        });
    }

    // One line per entry: replay, what played, the words heard when they
    // say something else, and when. An error's details sit in its tooltip
    // and in Copy All.
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
        item.append(replay, scalesTextSpan('history-text', entry.description));
        if (entry.transcript && entry.transcript !== entry.description) {
            item.append(scalesTextSpan('history-transcript', `"${entry.transcript}"`));
        }
        item.append(time);
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
            const transcript = entry.transcript && entry.transcript !== entry.description ? ` ("${entry.transcript}")` : '';
            return `[${timeStr}] ${entry.description}${transcript}`;
        });

        navigator.clipboard.writeText(lines.join('\n'))
            .catch(error => this.logError('Could not copy the history', { error }));
    }

    /**
     * Replay a history entry. A scale replays the settings it played with
     * (and leaves them set, as a voice command would).
     * @param {number} index
     */
    async playFromHistory(index) {
        const entry = this.history.entries[index];
        if (entry.type !== 'command') return;
        if (!entry.config) {
            await this.executeScaleCommand(entry.command, null, true);
            return;
        }
        await this.ensureAudioStarted();
        this.stopPlayback();
        this.applyConfig(entry.config);
        this.lastCommand = this.settingsCommand();
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

    clearActuallyPlayed() {
        const el = document.getElementById('actuallyPlayed');
        if (el) el.textContent = '';
    }

    /**
     * Append a MIDI note to the "actually played" display.
     * @param {number} midi
     * @param {boolean} isSection
     */
    appendActuallyPlayed(midi, isSection) {
        const el = document.getElementById('actuallyPlayed');
        if (!el) return;

        const display = this.formatMidiDisplay(midi, isSection, this.settings.octave);

        if (isSection && el.textContent.length > 0) {
            el.textContent += ' ';
        }
        el.textContent += display;
    }

    /**
     * Append a chord (MIDI array) to the "actually played" display.
     * @param {number[]} chordMidi
     */
    appendActuallyPlayedChord(chordMidi) {
        const el = document.getElementById('actuallyPlayed');
        if (!el) return;

        const formatted = chordMidi.map(m => this.formatMidiDisplay(m, true, this.settings.octave)).join('');

        if (el.textContent.length > 0) {
            el.textContent += ' ';
        }
        el.textContent += `[${formatted}]`;
    }

    /**
     * Format a MIDI note for display, showing octave only when non-default.
     * Section notes are uppercase, auxiliary notes lowercase.
     * @param {number} midi
     * @param {boolean} isSection
     * @param {number} [defaultOctave=4]
     * @returns {string}
     */
    formatMidiDisplay(midi, isSection, defaultOctave = 4) {
        if (!Number.isInteger(midi)) {
            // Microtonal spelling ("E4-50c") embeds its own octave; the
            // cents suffix would be ambiguous without it.
            const full = this.formatPitchStringForCurrentScale(midi);
            return isSection ? full : full.toLowerCase();
        }
        const noteName = scaleMidiToNoteName(
            this.settings.root,
            this.settings.octave,
            this.settings.scaleType,
            midi
        );
        const octave = midiOctave(midi);
        const name = isSection ? noteName : noteName.toLowerCase();
        return octave === defaultOctave ? name : name + octave;
    }

    /**
     * Write the settings' planned pass into the Sequence row, raised by
     * `transpose` while rising.
     * @param {number} [transpose]
     */
    updateNoteSequencePreview(transpose = 0) {
        const s = this.settings;
        document.getElementById('noteSequence').textContent = this.settingsPass().groups.map(group => {
            const midiNotes = group.notes.map(midi => midi + transpose);
            if (group.isChord) {
                return `[${midiNotes.map(midi => this.formatMidiDisplay(midi, true, s.octave)).join('')}]`;
            }
            return midiNotes.map((midi, i) => this.formatMidiDisplay(midi, i === group.sectionIndex, s.octave)).join('');
        }).join(' ');
    }

    // Spoken: the page is used hands-free. The full command list is
    // docs/scales-commands.md.
    showHelp() {
        this.voiceCore.speakText('Say scale, note, chord, arpeggio, or interval. Add slowly, with a gap, or repeat. Say stop to cancel.');
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

        // Add error to command history
        const errorEntry = {
            type: 'error',
            message: message,
            details: details,
            timestamp: new Date()
        };

        if (this.history) this.history.add(errorEntry);
    }

    showError(msg) {
        this.logError(msg);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.scalesController = new ScalesController();
});

