// @ts-check
//-----------------------------------------------------------------------
// SCALES - Voice-controlled scale and pitch training
// Uses VoiceCommandCore for voice recognition
// Uses Tone.js for piano sound synthesis
//-----------------------------------------------------------------------

//-------AUDIO COORDINATOR-------
// Single authority for all audio playback - prevents overlapping sounds

/**
 * @typedef {Object} PlaySequenceOptions
 * @property {(() => { ms: number, tone: number | string, gap: number })} [getDuration]
 * @property {((midi: number, index: number, repeatIndex: number) => void)} [onNote]
 * @property {((message: string) => void)} [onStatus]
 * @property {((nextRepeatIndex: number) => void)} [onRepeatEnd]
 * @property {number} [repeatCount]
 * @property {number} [repeatGapMs]
 * @property {boolean} [seamlessRepeat]
 * @property {((repeatIndex: number) => number[])} [getNotesForRepeat]
 */

/**
 * @typedef {Object} PlayChordSequenceOptions
 * @property {number} [repeatCount]
 * @property {((message: string) => void)} [onStatus]
 * @property {number} [gapMs]
 */

class AudioCoordinator {
    constructor() {
        /** @type {InstanceType<typeof Tone.Sampler> | null} */
        this.synth = null;
        /** @type {InstanceType<typeof Tone.Gain> | null} */
        this.gainNode = null;
        /** @type {boolean} */
        this.isPlaying = false;
        /** @type {number} */
        this.playbackId = 0;  // Monotonic ID to detect stale/superseded playback
        /** @type {((note: string, index: number) => void) | null} */
        this.onNoteCallback = null;
        /** @type {((message: string) => void) | null} */
        this.onStatusCallback = null;
        /** @type {(() => void) | null} */
        this.onCompleteCallback = null;
    }

    async init() {
        // Use Salamander Grand Piano samples for realistic piano sound
        const baseUrl = 'https://tonejs.github.io/audio/salamander/';

        // Create a gain node for hard cutoff on stop
        this.gainNode = new Tone.Gain(1).toDestination();

        return new Promise((resolve, reject) => {
            this.synth = new Tone.Sampler({
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
                baseUrl: baseUrl,
                onload: () => {
                    console.log('Piano samples loaded');
                    resolve();
                },
                onerror: (err) => {
                    console.error('Error loading piano samples:', err);
                    reject(err);
                }
            }).connect(this.gainNode);

            this.synth.volume.value = -3;
        });
    }

    // Ensure Tone.js audio context is running (requires user interaction)
    async ensureStarted() {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
    }

    // Enable audio output (restore after hard cutoff)
    enableAudio() {
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(1, Tone.now());
        }
    }

    /**
     * Play a single note (does not affect sequence playback state)
     * @param {number} midi - MIDI note number
     * @param {string} [duration]
     */
    playNote(midi, duration = '8n') {
        this.enableAudio();
        this.synth.triggerAttackRelease(midiToPitchString(midi), duration);
    }

    /**
     * Play a chord (multiple notes simultaneously)
     * @param {number[]} midiNotes - Array of MIDI note numbers
     * @param {string} [duration]
     */
    playChord(midiNotes, duration = '2n') {
        this.enableAudio();
        this.synth.triggerAttackRelease(midiNotes.map(midiToPitchString), duration);
    }

    // Request to start a sequence - stops any existing playback first
    // Returns playbackId for the caller to check if still valid
    requestSequencePlayback() {
        this.stop();  // Stop any existing playback
        this.enableAudio();
        this.playbackId++;
        this.isPlaying = true;
        return this.playbackId;
    }

    /**
     * Check if a playback session is still the current one
     * @param {number} id
     */
    isPlaybackValid(id) {
        return this.isPlaying && id === this.playbackId;
    }

    /**
     * Play a sequence of MIDI notes with full control
     * @param {number[]} notes - Array of MIDI note numbers
     * @param {PlaySequenceOptions} [options]
     */
    async playSequence(notes, options = {}) {
        const {
            getDuration,
            onNote,
            onStatus,
            onRepeatEnd,
            repeatCount = 1,
            repeatGapMs = 1500,
            seamlessRepeat = false,
            getNotesForRepeat = null
        } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        const playTimes = repeatCount === 0 ? 1 : (isInfinite ? Infinity : repeatCount);
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                const notesForRepeat = getNotesForRepeat ? getNotesForRepeat(r) : notes;

                const startIndex = (seamlessRepeat && r > 0) ? 1 : 0;

                for (let i = startIndex; i < notesForRepeat.length; i++) {
                    if (!this.isPlaybackValid(playId)) break;

                    const duration = getDuration ? getDuration() : { ms: 500, tone: 0.5, gap: 0 };

                    if (onNote) onNote(notesForRepeat[i], i, r);
                    this.synth.triggerAttackRelease(midiToPitchString(notesForRepeat[i]), duration.tone);

                    await this.sleep(duration.ms + duration.gap);
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.isPlaybackValid(playId)) {
                    if (onRepeatEnd) onRepeatEnd(r);

                    if (repeatGapMs > 0) {
                        if (onStatus) {
                            if (isInfinite) {
                                onStatus(`Loop ${r + 1}... (say "stop" to end)`);
                            } else {
                                onStatus(`Repeat ${r + 1} of ${playTimes}...`);
                            }
                        }
                        await this.sleep(repeatGapMs);
                    }
                }
            }
        } finally {
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
    }

    /**
     * Play a chord with repeat support
     * @param {number[]} midiNotes - Array of MIDI note numbers
     * @param {PlayChordSequenceOptions} [options]
     */
    async playChordRepeated(midiNotes, options = {}) {
        const {
            repeatCount = 1,
            onStatus,
            gapMs = 2000
        } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < repeatCount)) {
                this.synth.triggerAttackRelease(midiNotes.map(midiToPitchString), '2n');
                r++;

                const hasMore = isInfinite || r < repeatCount;
                if (hasMore && this.isPlaybackValid(playId)) {
                    if (onStatus && isInfinite) {
                        onStatus(`Chord loop ${r + 1}... (say "stop")`);
                    }
                    await this.sleep(gapMs);
                }
            }
        } finally {
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
    }

    // Stop all playback immediately
    stop() {
        this.isPlaying = false;
        this.playbackId++;  // Invalidate any in-flight playback

        if (this.synth) {
            this.synth.releaseAll();
        }

        // Hard cutoff - immediately mute to prevent lingering notes
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(0, Tone.now());
        }
    }

    /** @param {number} ms */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

//-------MUSICAL CONSTANTS-------
// NOTE_NAMES, NOTE_NAMES_FLAT, SCALE_PATTERNS, and utility functions
// are provided by music-constants.js

/** @type {Record<string, string>} */
const NOTE_PHONETIC_MAP = {
    // C variants
    'see': 'C', 'sea': 'C', 'si': 'C', 'cee': 'C',
    // D variants  
    'dee': 'D', 'the': 'D',
    // E variants
    'ee': 'E', 'he': 'E',
    // F variants
    'eff': 'F', 'ef': 'F', 'half': 'F',
    // G variants
    'gee': 'G', 'jee': 'G', 'ji': 'G',
    // A variants
    'ay': 'A', 'hey': 'A', 'eh': 'A', 'eight': 'A',
    // B variants
    'bee': 'B', 'be': 'B', 'bea': 'B',
    // Standard names (for completeness)
    'c': 'C', 'd': 'D', 'e': 'E', 'f': 'F', 'g': 'G', 'a': 'A', 'b': 'B'
};

/** @type {Record<string, string>} */
const MODIFIER_PHONETIC_MAP = {
    'sharp': 'sharp', 'shop': 'sharp', 'sharpe': 'sharp', 'shark': 'sharp',
    'flat': 'flat', 'flap': 'flat', 'flight': 'flat',
    '#': 'sharp', 'b': 'flat'
};

/**
 * Normalize a spoken note name to standard form
 * @param {string | null | undefined} spoken
 * @returns {string | null}
 */
function normalizeNoteName(spoken) {
    if (!spoken) return null;
    const lower = spoken.toLowerCase().trim();
    return NOTE_PHONETIC_MAP[lower] || (lower.length === 1 && lower.match(/[a-g]/i) ? lower.toUpperCase() : null);
}

/**
 * Normalize sharp/flat modifier
 * @param {string | null | undefined} spoken
 * @returns {string | null}
 */
function normalizeModifier(spoken) {
    if (!spoken) return null;
    const lower = spoken.toLowerCase().trim();
    return MODIFIER_PHONETIC_MAP[lower] || null;
}

// Default octave for scales
const DEFAULT_OCTAVE = 4;

// Loop timing (NOT the per-note gap control)
const FOREVER_SECTION_GAP_MS = 1000; // 1s gap between sections when looping ("forever" mode)

const PIANO_NOTIFICATION_MAX_NOTE_CELLS = 6;

const SCALES_PRESETS_STORAGE_KEY = 'scales-presets-v1';

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
 * @property {number} rangeExpansion
 * @property {number} octaveSpan
 * @property {string} sectionLength
 */

/**
 * @typedef {Object} ScaleModifiers
 * @property {string | null} [tempo]
 * @property {string | null} [gap]
 * @property {number} [repeat]
 * @property {string | null} [direction]
 * @property {number | null} [risingSemitones]
 * @property {string | null} [movementStyle]
 * @property {number | null} [rangeExpansion]
 * @property {number | null} [octaveSpan]
 * @property {number | null} [repeatGapMs]
 * @property {string | null} [exercise]
 * @property {number | null} [shiftingSteps]
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
 * @property {number} [rangeExpansion]
 * @property {number} [octaveSpan]
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
 * @property {string} [transcript]
 * @property {ScaleCommand} [command]
 * @property {string} [type]
 * @property {string} [message]
 * @property {string} [description]
 * @property {Object} [details]
 * @property {Date} [timestamp]
 */

class ScalesController {
    constructor() {
        /** @type {VoiceCommandCore | null} */
        this.voiceCore = null;
        /** @type {AudioCoordinator} */
        this.audio = new AudioCoordinator();  // Single authority for all audio
        /** @type {HTMLElement | null} */
        this.pianoNotificationCommandEl = null;
        /** @type {HTMLElement[]} */
        this.pianoNotificationNoteCells = [];
        /** @type {Preset[]} */
        this.presets = [];
        /** @type {string | null} */
        this.selectedPresetId = null;
        this.settings = {
            noteLengthMs: 300,  // note duration in milliseconds
            gapMs: 0,           // gap between notes in ms (or negative for overlap ratio)
            direction: 'ascending', // ascending, descending, both, down_and_up
            octave: DEFAULT_OCTAVE,
            repeatCount: 1,   // 1=once, 2=twice, Infinity=forever
            // Section gap: used for "forever" modes only (between phrase sections and between loop cycles)
            // This is NOT the UI "Gap" control which is between NOTES.
            repeatGapMs: FOREVER_SECTION_GAP_MS,
            risingSemitones: 0, // 0=off, otherwise transpose each repeat upward by this many semitones
            movementStyle: 'normal', // normal, stop_and_go, one_three_five, from_one
            // Voice-first settings (also controllable via UI)
            scaleType: 'major',
            root: 'C',
            rangeExpansion: 0,  // 0-6: extra notes on each end for "wide scale"
            octaveSpan: 1,      // 1 or 2: how many octaves to span
            sectionLength: '1o', // '1o', '1o+3', '1o+5', '2o', 'centered'
            exercise: 'none', // 'none', 'five_note', 'octave_jump', 'arpeggio_return', 'thirds'
            shiftingSteps: 0  // 0=off, 1=shift up 1 scale degree each repeat, etc.
        };

        // Default settings for reset (and for voice commands which reset first)
        this.defaultSettings = {
            noteLengthMs: 300,  // 0.3s by default
            gapMs: 0,           // no gap by default
            direction: 'ascending',
            octave: DEFAULT_OCTAVE,
            repeatCount: 1,   // Once by default
            repeatGapMs: FOREVER_SECTION_GAP_MS,
            risingSemitones: 0,
            movementStyle: 'normal',
            scaleType: 'major',
            root: 'C',
            rangeExpansion: 0,
            octaveSpan: 1,
            sectionLength: '1o',
            exercise: 'none',
            shiftingSteps: 0
        };

        // Exercise patterns: arrays of scale degree offsets from starting note
        // e.g., [0,1,2,3,4,3,2,1,0] = 1-2-3-4-5-4-3-2-1 (five_note warmup)
        /** @type {Record<string, number[]>} */
        this.exercisePatterns = {
            'none': [], // Use full scale
            'five_note': [0, 1, 2, 3, 4, 3, 2, 1, 0], // 1-2-3-4-5-4-3-2-1
            'octave_jump': [0, 7, 0], // 1-8-1
            'arpeggio_return': [0, 2, 4, 7, 4, 2, 0], // 1-3-5-8-5-3-1
            'thirds': [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7] // 1-3-2-4-3-5-4-6-5-7-6-8
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

        // Track last command for "repeat" / "again" functionality
        /** @type {ScaleCommand | null} */
        this.lastCommand = null;
        /** @type {string | null} */
        this.lastTranscript = null;

        // Command history for replay
        /** @type {HistoryEntry[]} */
        this.commandHistory = [];
        /** @type {number} */
        this.maxHistoryLength = 50;

        // Note: settings store actual values (noteLengthMs in ms, gapMs in ms or negative for overlap ratio)
        // Helper to format ms as display label
        this.formatMsLabel = (ms) => `${ms / 1000}s`;
        // Helper to format gap value as display label
        this.formatGapLabel = (gap) => {
            if (gap < 0) return `${Math.round(gap * 100)}%`;
            return `${gap / 1000}s`;
        };
        // Map ms to closest tempo name (for voice command generation)
        this.msToTempoName = (ms) => {
            if (ms <= 100) return 'very fast';
            if (ms <= 150) return 'fast';
            if (ms <= 500) return 'normal';
            if (ms <= 1000) return 'slow';
            if (ms <= 2000) return 'very slow';
            return 'super slow';
        };
        this.init();
    }

    async init() {
        this.updateLoadingStatus(false, 'Loading piano...');
        try {
            await this.audio.init();
            this.updateLoadingStatus(true);
        } catch (err) {
            this.updateLoadingStatus(false, 'Failed to load piano');
        }
        this.setupVoiceCore();
        this.setupUI();
        this.loadPresetsFromStorage();
        this.renderPresets();
        this.setupErrorHandling();
    }

    /**
     * @param {boolean} loaded
     * @param {string | null} [message]
     */
    updateLoadingStatus(loaded, message = null) {
        const statusRuntime = document.getElementById('statusRuntime');
        if (statusRuntime) {
            if (loaded) {
                statusRuntime.textContent = 'Ready - say a command or tap the piano';
            } else if (message) {
                statusRuntime.textContent = message;
            }
        }
    }

    setupVoiceCore() {
        this.voiceCore = new VoiceCommandCore({
            settings: {
                autoSubmitMode: true
            },
            uiIds: {
                statusEl: 'statusRuntime'
            },
            onStatusChange: (/** @type {string} */ msg) => console.log('Status:', msg),
            onError: (/** @type {string} */ msg) => this.showError(msg)
        });

        // Register scale commands
        // Voice commands reset to defaults first, then apply modifiers from speech
        this.voiceCore.registerHandler({
            parse: (/** @type {string} */ transcript) => this.parseScaleCommand(transcript),
            execute: async (/** @type {ScaleCommand} */ command, /** @type {string} */ transcript) => {
                // Reset to defaults before applying voice command (unless it's a control command)
                const controlCommands = ['stop', 'help', 'play', 'setting'];
                if (!controlCommands.includes(command.type)) {
                    this.resetToDefaults();
                }
                await this.executeScaleCommand(command, transcript);
            }
        });

        this.voiceCore.init();
    }

    /**
     * @param {string} transcript
     * @param {ScaleCommand} command
     */
    setInterpretationStatus(transcript, command) {
        // Deprecated: old "statusInterpretation" element removed in favor of the piano notification table.
        // Kept as a no-op so existing call sites don't break.
    }

    /**
     * @param {string} transcript
     * @param {ScaleCommand} command
     */
    buildInterpretationMessage(transcript, command) {
        // Deprecated: no longer used (old debug/interpretation string).
        return '';
    }

    // Reset to defaults without updating status (used before voice commands)
    resetToDefaults() {
        this.settings = { ...this.defaultSettings };
        console.log(`[noteLengthMs] reset to default: ${this.settings.noteLengthMs}ms`);
        this.syncUIToSettings();
    }

    setNoteLengthMs(ms, source = 'unknown') {
        const old = this.settings.noteLengthMs;
        this.settings.noteLengthMs = ms;
        console.log(`[noteLengthMs] ${old}ms -> ${ms}ms (${source})`);
    }

    // Rising implies forever - if rising is enabled and repeat isn't already forever, set it
    setRisingSemitones(semitones) {
        this.settings.risingSemitones = semitones;
        if (semitones > 0 && this.settings.repeatCount !== Infinity) {
            this.settings.repeatCount = Infinity;
            // Rising and shifting are mutually exclusive
            this.settings.shiftingSteps = 0;
        }
    }

    // Shifting implies forever - if shifting is enabled and repeat isn't already forever, set it
    setShiftingSteps(steps) {
        this.settings.shiftingSteps = steps;
        if (steps > 0 && this.settings.repeatCount !== Infinity) {
            this.settings.repeatCount = Infinity;
            // Rising and shifting are mutually exclusive
            this.settings.risingSemitones = 0;
        }
    }

    // Set exercise and optionally enable shifting
    setExercise(exercise, enableShifting = false) {
        this.settings.exercise = exercise;
        if (enableShifting && exercise !== 'none') {
            this.setShiftingSteps(1); // Default to shifting by 1 scale degree
        }
    }

    setupUI() {
        // Stop button (main)
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopPlayback());
        }

        // Piano notification area (above the keys)
        this.setupPianoNotificationArea();

        // Again button (play again or current settings)
        const againBtn = document.getElementById('againBtn');
        if (againBtn) {
            againBtn.addEventListener('click', () => this.playAgainOrCurrent());
        }

        // Clear history button
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        }

        // Copy all history button
        const copyAllHistoryBtn = document.getElementById('copyAllHistoryBtn');
        if (copyAllHistoryBtn) {
            copyAllHistoryBtn.addEventListener('click', () => this.copyAllHistory());
        }

        // Piano keys (if present)
        this.setupPianoKeys();

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
        const raw = localStorage.getItem(SCALES_PRESETS_STORAGE_KEY);
        if (!raw) {
            this.presets = [];
            this.selectedPresetId = null;
            return;
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            this.presets = [];
            this.selectedPresetId = null;
            return;
        }

        this.presets = parsed;
        // Keep selection if possible
        if (this.selectedPresetId && !this.presets.some(p => p.id === this.selectedPresetId)) {
            this.selectedPresetId = null;
        }
    }

    savePresetsToStorage() {
        localStorage.setItem(SCALES_PRESETS_STORAGE_KEY, JSON.stringify(this.presets));
    }

    getCurrentConfigSnapshot() {
        const s = this.settings;
        return {
            noteLengthMs: s.noteLengthMs,
            gapMs: s.gapMs,
            direction: s.direction,
            octave: s.octave,
            repeatCount: s.repeatCount,
            repeatGapMs: s.repeatGapMs,
            risingSemitones: s.risingSemitones,
            movementStyle: s.movementStyle,
            scaleType: s.scaleType,
            root: s.root,
            rangeExpansion: s.rangeExpansion,
            octaveSpan: s.octaveSpan,
            sectionLength: s.sectionLength
        };
    }

    /** @param {string} name */
    saveCurrentAsPreset(name) {
        const now = Date.now();
        const config = this.getCurrentConfigSnapshot();

        const title = name || this.buildPresetTitleFromConfig(config);
        const preset = {
            id: `${now}-${Math.random().toString(16).slice(2)}`,
            name: title,
            createdAt: now,
            config
        };

        // Newest at top
        this.presets.unshift(preset);
        this.selectedPresetId = preset.id;
        this.savePresetsToStorage();
        this.renderPresets();
        this.voiceCore.updateStatus('Saved config');
    }

    /** @param {ScalesSettings} c */
    buildPresetTitleFromConfig(c) {
        /** @type {Record<string, string>} */
        const dirLabels = { ascending: 'up', descending: 'down', both: 'up+down', down_and_up: 'down+up' };
        const parts = [];

        parts.push(`${c.scaleType.replace(/_/g, ' ')} ${c.root} scale`);

        if (c.direction) parts.push(dirLabels[c.direction] || c.direction);
        if (c.risingSemitones) parts.push(`rising ${this.getRisingLabel(c.risingSemitones)}`);
        if (c.movementStyle && c.movementStyle !== 'normal') parts.push(this.getMovementLabel(c.movementStyle));
        if (c.exercise && c.exercise !== 'none') parts.push(this.getExerciseLabel(c.exercise));
        if (c.shiftingSteps && c.shiftingSteps > 0) parts.push('shifting');
        if (c.octaveSpan && c.octaveSpan !== 1) parts.push(`${c.octaveSpan} oct`);
        if (c.rangeExpansion) parts.push(`wide +${c.rangeExpansion}`);
        if (c.noteLengthMs !== this.defaultSettings.noteLengthMs) parts.push(`len ${this.formatMsLabel(c.noteLengthMs)}`);
        if (c.gapMs !== this.defaultSettings.gapMs) parts.push(`gap ${this.formatGapLabel(c.gapMs)}`);

        if (c.repeatCount === Infinity) parts.push(c.repeatGapMs === 0 ? 'forever no gap' : 'forever');
        else if (c.repeatCount > 1) parts.push(`x${c.repeatCount}`);

        return parts.join(' ');
    }

    /** @param {string} id */
    applyPresetById(id) {
        const preset = this.presets.find(p => p.id === id);
        if (!preset) return;

        this.applyConfig(preset.config);
        this.selectedPresetId = id;
        this.renderPresets();
        // Status is updated by onSettingChanged() if playing, otherwise show this
        if (!this.audio.isPlaying) {
            this.voiceCore.updateStatus('Applied config');
        }
    }

    /** @param {ScalesSettings} c */
    applyConfig(c) {
        this.setNoteLengthMs(c.noteLengthMs, 'applyConfig');
        this.settings.gapMs = c.gapMs;
        this.settings.direction = c.direction;
        this.settings.octave = c.octave;
        this.settings.repeatCount = c.repeatCount;
        this.settings.repeatGapMs = c.repeatGapMs;
        this.setRisingSemitones(c.risingSemitones); // May override repeatCount if rising > 0
        this.settings.movementStyle = c.movementStyle;
        this.settings.scaleType = c.scaleType;
        this.settings.root = c.root;
        this.settings.rangeExpansion = c.rangeExpansion;
        this.settings.octaveSpan = c.octaveSpan;
        this.settings.sectionLength = c.sectionLength ?? '1o';

        this.updatePianoKeyOctaves?.();
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
        this.voiceCore.updateStatus('Deleted config');
    }

    renderPresets() {
        const list = document.getElementById('presetList');
        if (!list) return;

        if (!this.presets.length) {
            list.innerHTML = '<p class="history-empty">No saved configs yet</p>';
            return;
        }

        list.innerHTML = this.presets.map((p) => {
            const when = this.formatTime(new Date(p.createdAt));
            const selectedClass = (p.id === this.selectedPresetId) ? ' selected' : '';
            const subtitle = this.buildPresetTitleFromConfig(p.config);
            return `
                <div class="preset-item${selectedClass}" data-preset-id="${this.escapeHtml(String(p.id))}">
                    <div class="preset-item-title">
                        ${this.escapeHtml(p.name || subtitle)}
                        <div class="preset-item-subtitle">${this.escapeHtml(subtitle)}</div>
                    </div>
                    <div class="preset-item-time">${this.escapeHtml(when)}</div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.preset-item').forEach(el => {
            const element = /** @type {HTMLElement} */ (el);
            element.addEventListener('click', () => {
                const id = element.dataset.presetId;
                this.selectedPresetId = id || null;
                this.renderPresets();
            });
            element.addEventListener('dblclick', () => {
                const id = element.dataset.presetId;
                if (id) this.applyPresetById(id);
            });
        });
    }

    setupPianoNotificationArea() {
        this.pianoNotificationCommandEl = document.getElementById('pianoNotificationCommand');
        this.pianoNotificationNoteCells = [
            document.getElementById('pianoNotificationNote1'),
            document.getElementById('pianoNotificationNote2'),
            document.getElementById('pianoNotificationNote3'),
            document.getElementById('pianoNotificationNote4'),
            document.getElementById('pianoNotificationNote5'),
            document.getElementById('pianoNotificationNote6')
        ].filter(Boolean);

        this.updatePianoNotificationCommand(null);
        this.setPianoNotificationActiveNotes([]);
    }

    /** @param {number[]} midiNotes */
    setPianoNotificationActiveNotes(midiNotes) {
        if (!this.pianoNotificationNoteCells.length) return;
        for (let i = 0; i < this.pianoNotificationNoteCells.length; i++) {
            const midi = midiNotes?.[i];
            const cell = this.pianoNotificationNoteCells[i];
            cell.textContent = midi !== undefined ? midiToPitchString(midi) : '';
            cell.classList.toggle('empty', midi === undefined);
        }
    }

    /** @param {ScaleCommand | null} command */
    updatePianoNotificationCommand(command) {
        if (!this.pianoNotificationCommandEl) return;

        const runtime = document.getElementById('statusRuntime');
        // Remove existing non-runtime badges
        Array.from(this.pianoNotificationCommandEl.querySelectorAll('.piano-notification-badge')).forEach(el => {
            if (runtime && el === runtime) return;
            el.remove();
        });

        const badges = this.buildPianoNotificationBadges(command);
        for (const b of badges) {
            const badge = document.createElement('span');
            badge.className = 'piano-notification-badge';
            badge.textContent = b;
            if (runtime && runtime.parentElement === this.pianoNotificationCommandEl) {
                this.pianoNotificationCommandEl.insertBefore(badge, runtime);
            } else {
                this.pianoNotificationCommandEl.appendChild(badge);
            }
        }
    }

    /** @param {ScaleCommand | null} command */
    buildPianoNotificationBadges(command) {
        const s = this.settings;
        const d = this.defaultSettings;

        /** @type {Record<string, string>} */
        const dirLabels = { ascending: 'up', descending: 'down', both: 'up+down', down_and_up: 'down+up' };

        const badges = [];

        // Base "thing" being played
        if (command?.type === 'scale') {
            badges.push(`${command.scaleType.replace(/_/g, ' ')} ${command.root} scale`);
        } else if (command?.type === 'arpeggio') {
            badges.push(`${command.root} ${command.quality} arpeggio`);
        } else if (command?.type === 'chord') {
            badges.push(`${command.root} ${command.quality} chord`);
        } else if (command?.type === 'interval') {
            badges.push(`${command.quality}${command.interval} from ${command.root}`.trim());
        } else if (command?.type === 'note') {
            badges.push(`${command.note}${command.octave ?? ''}`.trim());
        } else if (command?.type === 'tuning') {
            badges.push('A440');
        } else {
            badges.push(`${s.scaleType.replace(/_/g, ' ')} ${s.root} scale`);
        }

        const mods = command?.modifiers || {};

        // Unified modifiers
        const direction = mods.direction ?? s.direction;
        if (direction && direction !== d.direction) badges.push(dirLabels[direction] || direction);

        const rising = (mods.risingSemitones ?? s.risingSemitones) || 0;
        if (rising) badges.push(`rising ${this.getRisingLabel(rising)}`);

        const movement = mods.movementStyle ?? s.movementStyle;
        if (movement && movement !== d.movementStyle && movement !== 'normal') badges.push(this.getMovementLabel(movement));

        const octaveSpan = mods.octaveSpan ?? s.octaveSpan;
        if (octaveSpan && octaveSpan !== d.octaveSpan) badges.push(`${octaveSpan} oct`);

        const rangeExpansion = mods.rangeExpansion ?? s.rangeExpansion;
        if (rangeExpansion && rangeExpansion !== d.rangeExpansion) badges.push(`wide +${rangeExpansion}`);

        // Tempo and per-note gap (note-level controls)
        if (mods.tempo) {
            const ms = this.tempoNameToMs[mods.tempo];
            if (ms !== undefined) badges.push(`len ${this.formatMsLabel(ms)}`);
        } else if (s.noteLengthMs !== d.noteLengthMs) {
            badges.push(`len ${this.formatMsLabel(s.noteLengthMs)}`);
        }

        if (mods.gap) {
            const gapVal = this.gapNameToValue[mods.gap];
            if (gapVal !== undefined) badges.push(`gap ${this.formatGapLabel(gapVal)}`);
        } else if (s.gapMs !== d.gapMs) {
            badges.push(`gap ${this.formatGapLabel(s.gapMs)}`);
        }

        // Repeat (loop mode)
        const repeatCount = mods.repeat ?? s.repeatCount;
        const repeatGapMs = mods.repeatGapMs ?? s.repeatGapMs;
        if (repeatCount === Infinity) badges.push(repeatGapMs === 0 ? 'forever no gap' : 'forever');
        else if (repeatCount === 0) badges.push('repeat off');
        else if (repeatCount > 1) badges.push(`x${repeatCount}`);

        return badges.filter(Boolean);
    }

    setupVoiceControls() {
        // Wait a bit for voices to load, then populate dropdown
        setTimeout(() => this.populateVoiceDropdown(), 100);
        // Also try again after a longer delay (Chrome loads voices async)
        setTimeout(() => this.populateVoiceDropdown(), 500);

        const voiceSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('voiceSelect'));
        if (voiceSelect) {
            voiceSelect.addEventListener('input', (e) => {
                const target = /** @type {HTMLSelectElement} */ (e.target);
                this.voiceCore.setVoice(target.value || null);
            });
        }

        const voiceRate = /** @type {HTMLInputElement | null} */ (document.getElementById('voiceRate'));
        const voiceRateValue = document.getElementById('voiceRateValue');
        if (voiceRate) {
            voiceRate.addEventListener('input', (e) => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                const rate = parseFloat(target.value);
                this.voiceCore.setVoiceRate(rate);
                if (voiceRateValue) voiceRateValue.textContent = rate + 'x';
            });
        }

        const voicePitch = /** @type {HTMLInputElement | null} */ (document.getElementById('voicePitch'));
        const voicePitchValue = document.getElementById('voicePitchValue');
        if (voicePitch) {
            voicePitch.addEventListener('input', (e) => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                const pitch = parseFloat(target.value);
                this.voiceCore.setVoicePitch(pitch);
                if (voicePitchValue) voicePitchValue.textContent = pitch.toFixed(1);
            });
        }

        const testVoiceBtn = document.getElementById('testVoiceBtn');
        if (testVoiceBtn) {
            testVoiceBtn.addEventListener('click', () => {
                this.voiceCore.speakText('C major scale ascending');
            });
        }
    }

    populateVoiceDropdown() {
        const voiceSelect = document.getElementById('voiceSelect');
        if (!voiceSelect) return;

        const voices = this.voiceCore.getAvailableVoices();
        if (voices.length === 0) return;

        // Clear existing options except default
        voiceSelect.innerHTML = '<option value="">Default</option>';

        // Group voices by language
        const englishVoices = voices.filter(v => v.lang.startsWith('en'));

        // Add English voices first
        if (englishVoices.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'English';
            englishVoices.forEach(v => {
                const option = document.createElement('option');
                option.value = v.name;
                // Show voice name and accent hint
                const accent = v.lang.includes('GB') ? '(UK)' :
                    v.lang.includes('AU') ? '(AU)' :
                        v.lang.includes('US') ? '(US)' : '';
                option.textContent = `${v.name} ${accent}`.trim();
                group.appendChild(option);
            });
            voiceSelect.appendChild(group);
        }
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

        // Root note buttons
        document.querySelectorAll('[data-root]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.dataset.root === this.settings.root);
        });

        // Scale type buttons
        document.querySelectorAll('[data-scale-type]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.dataset.scaleType === this.settings.scaleType);
        });

        // Direction buttons
        document.querySelectorAll('[data-direction]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.dataset.direction === this.settings.direction);
        });

        // Rising buttons
        document.querySelectorAll('[data-rising]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const semitones = parseInt(btn.dataset.rising || '0');
            btn.classList.toggle('selected', semitones === this.settings.risingSemitones);
        });

        // Exercise buttons
        document.querySelectorAll('[data-exercise]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.dataset.exercise === this.settings.exercise);
        });

        // Shifting buttons
        document.querySelectorAll('[data-shifting]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const steps = parseInt(btn.dataset.shifting || '0');
            btn.classList.toggle('selected', steps === this.settings.shiftingSteps);
        });

        // Movement buttons
        document.querySelectorAll('[data-movement]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.dataset.movement === this.settings.movementStyle);
        });

        // Note length buttons
        document.querySelectorAll('[data-length-ms]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', parseInt(btn.dataset.lengthMs || '0') === this.settings.noteLengthMs);
        });

        // Gap buttons
        document.querySelectorAll('[data-gap-value]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', parseFloat(btn.dataset.gapValue || '0') === this.settings.gapMs);
        });

        // Octave buttons
        document.querySelectorAll('[data-octave]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', parseInt(btn.dataset.octave || '0') === this.settings.octave);
        });

        // Octave span buttons
        document.querySelectorAll('[data-octave-span]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const span = parseInt(btn.dataset.octaveSpan || '1');
            btn.classList.toggle('selected', span === this.settings.octaveSpan);
        });

        // Range expansion buttons
        document.querySelectorAll('[data-range]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const range = parseInt(btn.dataset.range || '0');
            btn.classList.toggle('selected', range === this.settings.rangeExpansion);
        });

        // Section length buttons
        document.querySelectorAll('[data-section-length]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.dataset.sectionLength === this.settings.sectionLength);
        });

        // Update piano scale preview
        this.updateScalePreview();
        this.updatePatternPreview();

        // Keep the piano notification area showing what we'd play (when idle).
        if (!this.audio.isPlaying) {
            this.updatePianoNotificationCommand(null);
            this.setPianoNotificationActiveNotes([]);
        }
    }

    // Called when any setting changes - immediately adopts and restarts if playing
    async onSettingChanged() {
        const wasPlaying = this.audio.isPlaying;

        // Stop any current playback immediately
        if (wasPlaying) {
            this.stopPlayback();
        }

        // Update UI to reflect new settings
        this.syncUIToSettings();
        this.updatePianoNotificationCommand(null);

        // Restart if we were playing - use current settings directly
        if (wasPlaying) {
            this.voiceCore.updateStatus(this.formatCurrentCommand());
            const modifiers = this.buildModifiersFromSettings();
            await this.playScale(this.settings.root, this.settings.scaleType, modifiers);
        }
    }

    // Build modifiers object from current settings for replay
    // Note: tempo/gap are omitted so getNoteDuration() reads from this.settings directly
    buildModifiersFromSettings() {
        return {
            repeat: this.settings.repeatCount,
            direction: this.settings.direction,
            risingSemitones: this.settings.risingSemitones,
            movementStyle: this.settings.movementStyle,
            rangeExpansion: this.settings.rangeExpansion,
            octaveSpan: this.settings.octaveSpan,
            repeatGapMs: this.settings.repeatGapMs,
            exercise: this.settings.exercise,
            shiftingSteps: this.settings.shiftingSteps
        };
    }

    // Format current settings as a compact status string
    // Always shows root + scale type, only shows other options if they differ from defaults
    formatCurrentCommand() {
        const s = this.settings;
        const d = this.defaultSettings;

        // Always include root and scale type
        const scaleLabel = s.scaleType.replace('_', ' ');
        let parts = [`${s.root} ${scaleLabel}`];

        // Only add non-default options
        if (s.direction !== d.direction) {
            const dirLabels = { ascending: 'up', descending: 'down', both: 'up+down', down_and_up: 'down+up' };
            parts.push(dirLabels[s.direction] || s.direction);
        }
        if (s.movementStyle !== d.movementStyle) {
            parts.push(`move: ${this.getMovementLabel(s.movementStyle)}`);
        }
        if (s.risingSemitones !== d.risingSemitones) {
            parts.push(`rise: ${this.getRisingLabel(s.risingSemitones)}`);
        }
        if (s.exercise !== d.exercise) {
            parts.push(`ex: ${this.getExerciseLabel(s.exercise)}`);
        }
        if (s.shiftingSteps !== d.shiftingSteps && s.shiftingSteps > 0) {
            parts.push('shifting');
        }
        if (s.octave !== d.octave) {
            parts.push(`oct ${s.octave}`);
        }
        if (s.noteLengthMs !== d.noteLengthMs) {
            parts.push(this.formatMsLabel(s.noteLengthMs));
        }
        if (s.gapMs !== d.gapMs) {
            parts.push(`gap: ${this.formatGapLabel(s.gapMs)}`);
        }
        if (s.octaveSpan !== d.octaveSpan) {
            parts.push(s.octaveSpan === 2 ? '2 oct' : '1 oct');
        }
        if (s.rangeExpansion !== d.rangeExpansion) {
            parts.push(`wide +${s.rangeExpansion}`);
        }
        if (s.repeatCount !== d.repeatCount || (s.repeatCount === Infinity && s.repeatGapMs !== d.repeatGapMs)) {
            if (s.repeatCount === Infinity) {
                parts.push(s.repeatGapMs === 0 ? 'forever no gap' : 'forever');
            } else if (s.repeatCount > 1) {
                parts.push(`x${s.repeatCount}`);
            } else if (s.repeatCount === 0) {
                parts.push('repeat off');
            }
        }

        return parts.join(' | ');
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

        // Root note buttons
        document.querySelectorAll('[data-root]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.root = btn.dataset.root || 'C';
                this.onSettingChanged();
            });
        });

        // Scale type buttons
        document.querySelectorAll('[data-scale-type]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.scaleType = btn.dataset.scaleType || 'major';
                this.onSettingChanged();
            });
        });

        // Direction buttons
        document.querySelectorAll('[data-direction]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.direction = btn.dataset.direction || 'ascending';
                this.onSettingChanged();
            });
        });

        // Rising buttons
        document.querySelectorAll('[data-rising]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.setRisingSemitones(parseInt(btn.dataset.rising || '0'));
                this.onSettingChanged();
            });
        });

        // Exercise buttons
        document.querySelectorAll('[data-exercise]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                const exercise = btn.dataset.exercise || 'none';
                this.setExercise(exercise, exercise !== 'none'); // Enable shifting for exercises
                this.onSettingChanged();
            });
        });

        // Shifting buttons
        document.querySelectorAll('[data-shifting]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.setShiftingSteps(parseInt(btn.dataset.shifting || '0'));
                this.onSettingChanged();
            });
        });

        // Movement buttons
        document.querySelectorAll('[data-movement]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.movementStyle = btn.dataset.movement || 'normal';
                this.onSettingChanged();
            });
        });

        // Note length buttons
        document.querySelectorAll('[data-length-ms]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.setNoteLengthMs(parseInt(btn.dataset.lengthMs || '500'), 'button');
                this.onSettingChanged();
            });
        });

        // Gap buttons
        document.querySelectorAll('[data-gap-value]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.gapMs = parseFloat(btn.dataset.gapValue || '0');
                this.onSettingChanged();
            });
        });

        // Octave buttons
        document.querySelectorAll('[data-octave]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.octave = parseInt(btn.dataset.octave || '4');
                this.updatePianoKeyOctaves();
                this.onSettingChanged();
            });
        });

        // Octave span buttons
        document.querySelectorAll('[data-octave-span]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.octaveSpan = parseInt(btn.dataset.octaveSpan || '1');
                this.onSettingChanged();
            });
        });

        // Range expansion buttons
        document.querySelectorAll('[data-range]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.rangeExpansion = parseInt(btn.dataset.range || '0');
                this.onSettingChanged();
            });
        });

        // Section length buttons
        document.querySelectorAll('[data-section-length]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                this.settings.sectionLength = btn.dataset.sectionLength || '1o';
                this.onSettingChanged();
            });
        });

        // Reset button
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.settings = { ...this.defaultSettings };
                this.updatePianoKeyOctaves();
                this.voiceCore.updateStatus('Settings reset to defaults');
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
            // Show only if NOT previously dismissed
            if (localStorage.getItem('scales-instruction-dismissed') !== 'true') {
                instruction.style.display = '';
            }
            dismissBtn.addEventListener('click', () => {
                instruction.style.display = 'none';
                localStorage.setItem('scales-instruction-dismissed', 'true');
            });
        }

        // Show sequence toggle (off by default)
        const showSeqToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('showSequenceToggle'));
        const seqGridContainer = document.getElementById('sequenceGridContainer');
        if (showSeqToggle) {
            // Restore from localStorage, default to hidden
            const savedShowSeq = localStorage.getItem('scales-show-sequence');
            const show = savedShowSeq === 'true';
            showSeqToggle.checked = show;
            if (seqGridContainer) seqGridContainer.style.display = show ? 'grid' : 'none';

            showSeqToggle.addEventListener('change', () => {
                const showNow = showSeqToggle.checked;
                localStorage.setItem('scales-show-sequence', String(showNow));
                if (seqGridContainer) seqGridContainer.style.display = showNow ? 'grid' : 'none';
            });
        }

        // Use abbreviations toggle
        const abbrToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('useAbbrevToggle'));
        if (abbrToggle) {
            // Restore from localStorage
            const savedAbbr = localStorage.getItem('scales-use-abbrev');
            if (savedAbbr === 'true') {
                abbrToggle.checked = true;
                this.applyAbbreviations(true);
            }
            abbrToggle.addEventListener('change', () => {
                const useAbbr = abbrToggle.checked;
                localStorage.setItem('scales-use-abbrev', String(useAbbr));
                this.applyAbbreviations(useAbbr);
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
        // Toggle section labels
        document.querySelectorAll('.vf-label[data-abbr][data-full]').forEach(el => {
            const label = /** @type {HTMLElement} */ (el);
            label.textContent = useAbbr ? label.dataset.abbr : label.dataset.full;
        });
    }

    randomizeCoreFilters() {
        const roots = Array.from(document.querySelectorAll('[data-root]'))
            .map(el => (/** @type {HTMLElement} */ (el)).dataset.root)
            .filter(Boolean);
        const directions = Array.from(document.querySelectorAll('[data-direction]'))
            .map(el => (/** @type {HTMLElement} */ (el)).dataset.direction)
            .filter(Boolean);
        const movements = Array.from(document.querySelectorAll('[data-movement]'))
            .map(el => (/** @type {HTMLElement} */ (el)).dataset.movement)
            .filter(Boolean);
        const rising = Array.from(document.querySelectorAll('[data-rising]'))
            .map(el => parseInt((/** @type {HTMLElement} */ (el)).dataset.rising || '0'))
            .filter(n => Number.isFinite(n));
        const scaleTypes = Array.from(document.querySelectorAll('[data-scale-type]'))
            .map(el => (/** @type {HTMLElement} */ (el)).dataset.scaleType)
            .filter(Boolean);
        const lengths = Array.from(document.querySelectorAll('[data-length-ms]'))
            .map(el => parseInt((/** @type {HTMLElement} */ (el)).dataset.lengthMs || '0'))
            .filter(n => Number.isFinite(n));

        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        if (roots.length) this.settings.root = pick(roots);
        if (directions.length) this.settings.direction = pick(directions);
        if (movements.length) this.settings.movementStyle = pick(movements);
        if (rising.length) this.setRisingSemitones(pick(rising));
        if (scaleTypes.length) this.settings.scaleType = pick(scaleTypes);
        if (lengths.length) this.setNoteLengthMs(pick(lengths), 'random');

        this.onSettingChanged();
    }

    setupPianoKeys() {
        const pianoContainer = document.getElementById('pianoKeys');
        if (!pianoContainer) return;

        // Create piano keys: A below base octave through C two octaves up
        const whiteNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const blackKeyPositions = { 'C': true, 'D': true, 'F': true, 'G': true, 'A': true };

        // Build keys: 2 full octaves starting from C + final C
        const keysToCreate = [];
        // Add full octaves 0 and 1
        for (let oct = 0; oct <= 1; oct++) {
            whiteNotes.forEach(note => {
                keysToCreate.push({ note, octaveOffset: oct });
            });
        }
        // Add one more C at the top
        keysToCreate.push({ note: 'C', octaveOffset: 2 });

        keysToCreate.forEach(({ note, octaveOffset }) => {
            const octave = this.settings.octave + octaveOffset;
            const midi = noteNameToMidi(note, octave);
            const key = document.createElement('div');
            key.className = 'piano-key white-key';
            key.dataset.midi = String(midi);
            key.dataset.baseNote = note;
            key.dataset.octaveOffset = String(octaveOffset);

            const label = note === 'C' ? `C${octave}` : note;
            key.innerHTML = `<span>${label}</span>`;

            key.addEventListener('click', async () => {
                await this.ensureAudioStarted();
                this.playNote(parseInt(key.dataset.midi));
            });
            pianoContainer.appendChild(key);

            if (blackKeyPositions[note] && !(note === 'C' && octaveOffset === 2)) {
                const blackKey = document.createElement('div');
                blackKey.className = 'piano-key black-key';
                const sharpMidi = midi + 1;
                blackKey.dataset.midi = String(sharpMidi);
                blackKey.dataset.baseNote = `${note}#`;
                blackKey.dataset.octaveOffset = String(octaveOffset);
                blackKey.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.ensureAudioStarted();
                    this.playNote(parseInt(blackKey.dataset.midi));
                });
                pianoContainer.appendChild(blackKey);
            }
        });
    }

    async ensureAudioStarted() {
        await this.audio.ensureStarted();
    }

    updatePianoKeyOctaves() {
        document.querySelectorAll('.piano-key').forEach(el => {
            const key = /** @type {HTMLElement} */ (el);
            const baseNote = key.dataset.baseNote;
            const octaveOffset = parseInt(key.dataset.octaveOffset || '0');
            const newOctave = this.settings.octave + octaveOffset;
            const newMidi = noteNameToMidi(baseNote, newOctave);

            key.dataset.midi = String(newMidi);

            if (key.classList.contains('white-key')) {
                const noteName = baseNote.replace('#', '');
                const label = noteName === 'C' ? `C${newOctave}` : noteName;
                const span = key.querySelector('span');
                if (span) span.textContent = label;
            }
        });

        this.updateScalePreview();
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
            repeat: 1,          // number of times to repeat
            direction: null,    // 'ascending', 'descending', 'both'
            risingSemitones: null, // null (use settings) or integer semitones (0=off)
            movementStyle: null, // null (use settings) or one of movement styles
            rangeExpansion: null, // null (use settings) or number of extra notes
            octaveSpan: null    // null (use settings) or 1/2
        };

        // Wide scale modifier (check longer phrases first)
        if (text.match(/\bvery\s+wide\b/)) {
            modifiers.rangeExpansion = 5;
            text = text.replace(/\bvery\s+wide\b/, '');
        } else if (text.match(/\bwide\b/)) {
            modifiers.rangeExpansion = this.settings.rangeExpansion || 3;
            text = text.replace(/\bwide\b/, '');
        } else if (text.match(/\bnarrow\b/)) {
            modifiers.rangeExpansion = 0;
            text = text.replace(/\bnarrow\b/, '');
        }

        // Octave span modifier
        if (text.match(/\b(double|two|2)\s*octave(s)?\b/)) {
            modifiers.octaveSpan = 2;
            text = text.replace(/\b(double|two|2)\s*octave(s)?\b/, '');
        } else if (text.match(/\bsingle\s*octave\b/) || text.match(/\bone\s*octave\b/)) {
            modifiers.octaveSpan = 1;
            text = text.replace(/\b(single|one)\s*octave\b/, '');
        }

        // Movement style modifiers (within a scale)
        if (text.match(/\bstop\s*-\s*and\s*-\s*go\b/) || text.match(/\bstop\s+and\s+go\b/)) {
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
        } else if (text.match(/\bforever\s+no\s+gap\b/)) {
            modifiers.repeat = Infinity;
            modifiers.repeatGapMs = 0;
            text = text.replace(/\bforever\s+no\s+gap\b/, '');
        } else if (text.match(/\bforever\b/)) {
            modifiers.repeat = Infinity;
            modifiers.repeatGapMs = FOREVER_SECTION_GAP_MS;
            text = text.replace(/\bforever\b/, '');
        } else if (text.match(/\b(and\s+)?repeat\b/) || text.match(/\bloop\b/) || text.match(/\bforever\b/)) {
            // "repeat" alone = forever, "loop" = forever, "forever" = forever
            modifiers.repeat = Infinity;
            text = text.replace(/\b(and\s+)?repeat\b/, '').replace(/\bloop\b/, '').replace(/\bforever\b/, '');
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
        if (originalLower.match(/^(stop\s*-\s*and\s*-\s*go|stop\s+and\s+go|two\s+(steps?\s+)?forward\s+(one\s+step\s+)?back)$/)) {
            this.settings.movementStyle = 'stop_and_go';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'stop_and_go' };
        }
        if (originalLower.match(/^(1\s*[- ]?\s*3\s*[- ]?\s*5|one\s+three\s+five|triads?)$/)) {
            this.settings.movementStyle = 'one_three_five';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'one_three_five' };
        }
        if (originalLower.match(/^(nbr|neighbou?rs?)$/)) {
            this.settings.movementStyle = 'neighbors';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'neighbors' };
        }
        if (originalLower.match(/^(chd|chords?\s*(mode)?)$/)) {
            this.settings.movementStyle = 'chords';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'chords' };
        }
        if (originalLower.match(/^(from\s+(1|one)|from\s+the\s+root|root\s+always)$/)) {
            this.settings.movementStyle = 'from_one';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'from_one' };
        }
        if (originalLower.match(/^(to\s+(1|one)|to\s+the\s+root|interleave\s*(1|one)?|return\s+to\s+root)$/)) {
            this.settings.movementStyle = 'to_one';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'to_one' };
        }
        if (originalLower.match(/^(plus\s*minus\s*(1|one)|\+1\s*-1|dance\s+around)$/)) {
            this.settings.movementStyle = 'plus_minus_one';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'plus_minus_one' };
        }
        if (originalLower.match(/^(normal\s+movement|normal)$/)) {
            this.settings.movementStyle = 'normal';
            this.syncUIToSettings();
            return { type: 'setting', setting: 'movementStyle', value: 'normal' };
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

        // Single note: "play C", "note D", "C sharp", "B flat"
        // Also handles phonetic variants: "see" for C, "bee" for B, etc.
        const phoneticNotes = Object.keys(NOTE_PHONETIC_MAP).join('|');
        const phoneticMods = Object.keys(MODIFIER_PHONETIC_MAP).join('|');
        const noteRegex = new RegExp(`^(play\\s+|note\\s+)?(${phoneticNotes})\\s*(${phoneticMods})?(\\s*\\d)?$`, 'i');
        const noteMatch = lower.match(noteRegex);
        if (noteMatch) {
            let note = normalizeNoteName(noteMatch[2]);
            const modifier = normalizeModifier(noteMatch[3]);
            const octave = noteMatch[4] ? parseInt(noteMatch[4]) : this.settings.octave;

            if (note) {
                if (modifier === 'sharp') {
                    note += '#';
                } else if (modifier === 'flat') {
                    const flatIndex = NOTE_NAMES_FLAT.indexOf(note + 'b');
                    if (flatIndex >= 0) {
                        note = NOTE_NAMES[flatIndex];
                    }
                }
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
            'whole\\s*tone', 'diminished', 'augmented'
        ].join('|');

        // Build phonetic note pattern for regex
        const notePattern = Object.keys(NOTE_PHONETIC_MAP).join('|');
        const modPattern = Object.keys(MODIFIER_PHONETIC_MAP).join('|');

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
            scaleType = pattern1[3] ? pattern1[3].toLowerCase().replace(/\s+/g, '_') : 'major';
        } else if (pattern2 && pattern2[2]) {
            // Type-first pattern: "chromatic scale", "a chromatic scale", "harmonic minor from E"
            // pattern2[1] = optional "a " article (ignored)
            // pattern2[2] = scale type
            // pattern2[3] = "scale" (optional)
            // pattern2[4] = "from" (optional)
            // pattern2[5] = note (optional, may be phonetic)
            // pattern2[6] = sharp/flat (optional, may be phonetic)
            scaleMatch = pattern2;
            scaleType = pattern2[2].toLowerCase().replace(/\s+/g, '_');
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
            if (noteModifier === 'sharp') {
                root += '#';
            } else if (noteModifier === 'flat') {
                const flatIndex = NOTE_NAMES_FLAT.indexOf(root + 'b');
                if (flatIndex >= 0) {
                    root = NOTE_NAMES[flatIndex];
                }
            }

            return { type: 'scale', root, scaleType, modifiers };
        }

        // Arpeggio: "C arpeggio", "arpeggio D minor"
        const arpMatch = lower.match(/([a-g])?\s*(sharp|flat|#|b)?\s*(major|minor)?\s*arpeggio/i) ||
            lower.match(/arpeggio\s+([a-g])?\s*(sharp|flat|#|b)?\s*(major|minor)?/i);
        if (arpMatch) {
            let root = (arpMatch[1] || 'C').toUpperCase();
            const noteModifier = arpMatch[2];
            const quality = arpMatch[3] ? arpMatch[3].toLowerCase() : 'major';

            if (noteModifier === 'sharp' || noteModifier === '#') {
                root += '#';
            } else if (noteModifier === 'flat' || noteModifier === 'b') {
                const flatIndex = NOTE_NAMES_FLAT.indexOf(root + 'b');
                if (flatIndex >= 0) {
                    root = NOTE_NAMES[flatIndex];
                }
            }

            return { type: 'arpeggio', root, quality, modifiers };
        }

        // Chord: "C chord", "D minor chord"
        const chordMatch = lower.match(/([a-g])\s*(sharp|flat|#|b)?\s*(major|minor)?\s*chord/i);
        if (chordMatch) {
            let root = chordMatch[1].toUpperCase();
            const noteModifier = chordMatch[2];
            const quality = chordMatch[3] ? chordMatch[3].toLowerCase() : 'major';

            if (noteModifier === 'sharp' || noteModifier === '#') {
                root += '#';
            } else if (noteModifier === 'flat' || noteModifier === 'b') {
                const flatIndex = NOTE_NAMES_FLAT.indexOf(root + 'b');
                if (flatIndex >= 0) {
                    root = NOTE_NAMES[flatIndex];
                }
            }

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
            this.setNoteLengthMs(500, 'voice:500ms');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 500 };
        }
        if (originalLower.match(/^(one\s*second|a\s*second)$/)) {
            this.setNoteLengthMs(1000, 'voice:1000ms');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 1000 };
        }
        if (originalLower.match(/^(two\s*seconds?|a\s*couple\s*seconds?)$/)) {
            this.setNoteLengthMs(2000, 'voice:2000ms');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 2000 };
        }
        if (originalLower.match(/^(three\s*seconds?)$/)) {
            this.setNoteLengthMs(3000, 'voice:3000ms');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'noteLengthMs', value: 3000 };
        }
        if (originalLower.match(/^(five\s*seconds?)$/)) {
            this.setNoteLengthMs(5000, 'voice:5000ms');
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
                this.setNoteLengthMs(value, `voice:${value}ms`);
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
            const interval = intervalMap[intervalMatch[2].toLowerCase()] || intervalMatch[2].toLowerCase();
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
            this.setNoteLengthMs(this.tempoNameToMs['super slow'], 'voice:super slow');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'super slow' };
        }
        if (originalLower.match(/^(very\s+slow|real\s+slow)$/)) {
            this.setNoteLengthMs(this.tempoNameToMs['very slow'], 'voice:very slow');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'very slow' };
        }
        if (originalLower.match(/^(slow|slower)$/)) {
            this.setNoteLengthMs(this.tempoNameToMs['slow'], 'voice:slow');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'slow' };
        }
        if (originalLower.match(/^(normal\s+speed|normal\s+tempo|medium|default\s+speed)$/)) {
            this.setNoteLengthMs(this.tempoNameToMs['normal'], 'voice:normal');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'normal' };
        }
        if (originalLower.match(/^(fast|faster|quick)$/)) {
            this.setNoteLengthMs(this.tempoNameToMs['fast'], 'voice:fast');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'fast' };
        }
        if (originalLower.match(/^(very\s+fast|really\s+fast|super\s+fast)$/)) {
            this.setNoteLengthMs(this.tempoNameToMs['very fast'], 'voice:very fast');
            this.syncUIToSettings();
            return { type: 'setting', setting: 'tempo', value: 'very fast' };
        }

        // Octave commands (standalone) - "3", "4", "5", "octave 3", etc.
        const octaveMatch = originalLower.match(/^(octave\s+)?([2-6])$/);
        if (octaveMatch) {
            const octave = parseInt(octaveMatch[2]);
            this.settings.octave = octave;
            this.updatePianoKeyOctaves();
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
            this.settings.repeatForever = false;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: 1 };
        }
        if (originalLower.match(/^(twice|two\s*times|2\s*x|2\s*times)$/)) {
            this.settings.repeatCount = 2;
            this.settings.repeatForever = false;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: 2 };
        }
        if (originalLower.match(/^(thrice|three\s*times|3\s*x|3\s*times)$/)) {
            this.settings.repeatCount = 3;
            this.settings.repeatForever = false;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: 3 };
        }
        if (originalLower.match(/^(inf(inity)?|forever|loop|repeat\s*forever)$/)) {
            this.settings.repeatCount = Infinity;
            this.settings.repeatForever = true;
            this.settings.repeatGapMs = FOREVER_SECTION_GAP_MS;
            this.syncUIToSettings();
            return { type: 'setting', setting: 'repeat', value: Infinity };
        }
        if (originalLower.match(/^(inf(inity)?\s*(0\s*g(ap)?|no\s*gap)|forever\s*no\s*gap)$/)) {
            this.settings.repeatCount = Infinity;
            this.settings.repeatForever = true;
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
        // Ensure Tone.js audio context is started (required after user interaction)
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }

        // Track if we were playing (for setting commands that should restart)
        const wasPlaying = this.audio.isPlaying;

        // Stop any currently playing sequence immediately
        this.stopPlayback();

        // Update the piano notification area to show what we're doing.
        this.updatePianoNotificationCommand(command);
        this.setPianoNotificationActiveNotes([]);

        // Store transcript for replay (but not for 'play' itself)
        if (transcript && command.type !== 'play') {
            this.lastTranscript = transcript;
        }

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
                this.stopPlayback();
                this.voiceCore.updateStatus('Stopped');
                break;

            case 'help':
                this.showHelp();
                break;

            case 'play':
                // Play current settings (whatever is in the UI)
                await this.playCurrentSettings();
                return; // Don't store 'play' as last command

            case 'note': {
                const noteMidi = noteNameToMidi(command.note, command.octave);
                this.voiceCore.updateStatus(`Playing ${midiToPitchString(noteMidi)}`);
                this.updatePianoNotificationCommand(command);
                this.setPianoNotificationActiveNotes([noteMidi]);
                this.playNote(noteMidi);
                this.lastCommand = command;
                break;
            }

            case 'scale':
                // Update settings from voice command (voice-first bidirectional sync)
                this.settings.root = command.root;
                this.settings.scaleType = command.scaleType;
                if (command.modifiers.direction) this.settings.direction = command.modifiers.direction;
                if (command.modifiers.movementStyle) this.settings.movementStyle = command.modifiers.movementStyle;
                if (command.modifiers.risingSemitones !== null && command.modifiers.risingSemitones !== undefined) {
                    this.setRisingSemitones(command.modifiers.risingSemitones);
                }
                if (command.modifiers.rangeExpansion !== null) this.settings.rangeExpansion = command.modifiers.rangeExpansion;
                if (command.modifiers.octaveSpan !== null) this.settings.octaveSpan = command.modifiers.octaveSpan;
                // Apply tempo modifier to noteLengthMs
                if (command.modifiers.tempo) {
                    const ms = this.tempoNameToMs[command.modifiers.tempo];
                    if (ms !== undefined) this.setNoteLengthMs(ms, `voice:${command.modifiers.tempo}`);
                }
                // Apply gap modifier
                if (command.modifiers.gap) {
                    const gapVal = this.gapNameToValue[command.modifiers.gap];
                    if (gapVal !== undefined) this.settings.gapMs = gapVal;
                }
                // Apply repeat modifier
                if (command.modifiers.repeat !== undefined && command.modifiers.repeat !== null) {
                    this.settings.repeatCount = command.modifiers.repeat;
                }
                if (command.modifiers.repeatGapMs !== undefined && command.modifiers.repeatGapMs !== null) {
                    this.settings.repeatGapMs = command.modifiers.repeatGapMs;
                }
                this.syncUIToSettings();

                this.voiceCore.updateStatus(this.buildStatusMessage(command));
                await this.playScale(command.root, command.scaleType, command.modifiers);
                this.lastCommand = command;
                break;

            case 'arpeggio':
                this.voiceCore.updateStatus(this.buildStatusMessage(command));
                await this.playArpeggio(command.root, command.quality, command.modifiers);
                this.lastCommand = command;
                break;

            case 'chord':
                this.voiceCore.updateStatus(this.buildStatusMessage(command));
                await this.playChord(command.root, command.quality, command.modifiers);
                this.lastCommand = command;
                break;

            case 'interval':
                this.voiceCore.updateStatus(this.buildStatusMessage(command));
                await this.playInterval(command.root, command.interval, command.quality, command.modifiers);
                this.lastCommand = command;
                break;

            case 'tuning': {
                const tuningMidi = noteNameToMidi('A', 4);
                this.voiceCore.updateStatus('Playing A440 tuning note');
                this.updatePianoNotificationCommand(command);
                this.setPianoNotificationActiveNotes([tuningMidi]);
                this.playNote(tuningMidi, '2n');
                this.lastCommand = command;
                break;
            }

            case 'setting':
                // Setting was already applied in parseCommand, now restart if we were playing
                this.voiceCore.updateStatus(this.formatCurrentCommand());
                if (wasPlaying && this.lastCommand && this.lastCommand.type === 'scale') {
                    // Restart with new settings
                    const modifiers = this.buildModifiersFromSettings();
                    await this.playScale(this.settings.root, this.settings.scaleType, modifiers);
                }
                break;

            case 'reset':
                this.voiceCore.updateStatus('Settings reset to defaults');
                break;

            case 'random':
                this.voiceCore.updateStatus('Randomized settings: ' + this.formatCurrentCommand());
                break;
        }
    }

    /**
     * Build a descriptive status message including modifiers
     * @param {ScaleCommand} command
     */
    buildStatusMessage(command) {
        const mods = command.modifiers || {};
        let parts = [];

        if (mods.tempo) parts.push(mods.tempo);

        // Octave span
        const octaveSpan = mods.octaveSpan ?? this.settings.octaveSpan;
        if (octaveSpan === 2) parts.push('2-octave');

        // Wide scale
        const rangeExpansion = mods.rangeExpansion ?? this.settings.rangeExpansion;
        if (rangeExpansion > 0) parts.push('wide');

        // Movement style (only if not default)
        const movementStyle = mods.movementStyle ?? this.settings.movementStyle;
        if (movementStyle && movementStyle !== 'normal') parts.push(this.getMovementLabel(movementStyle));

        // Rising / transposition
        const risingSemitones = mods.risingSemitones ?? this.settings.risingSemitones;
        if (risingSemitones) parts.push(`rising ${this.getRisingLabel(risingSemitones)}`);

        switch (command.type) {
            case 'scale':
                parts.push(`${command.root} ${command.scaleType.replace('_', ' ')} scale`);
                break;
            case 'arpeggio':
                parts.push(`${command.root} ${command.quality} arpeggio`);
                break;
            case 'chord':
                parts.push(`${command.root} ${command.quality} chord`);
                break;
            case 'interval':
                parts.push(`${command.quality}${command.interval} from ${command.root}`);
                break;
        }

        if (mods.direction) parts.push(mods.direction);
        if (mods.gap === 'large' || mods.gap === 'very large') parts.push('with gaps');
        if (mods.repeat === Infinity) {
            const repeatGapMs = mods.repeatGapMs ?? this.settings.repeatGapMs;
            parts.push(repeatGapMs === 0 ? '(forever no gap)' : '(forever)');
        } else if (mods.repeat > 1) {
            parts.push(`x${mods.repeat}`);
        }

        return `Playing ${parts.join(' ')}`;
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
            if (mods.movementStyle === 'stop_and_go') parts.push('stop and go');
            else if (mods.movementStyle === 'one_three_five') parts.push('one three five');
            else if (mods.movementStyle === 'neighbors') parts.push('neighbors');
            else if (mods.movementStyle === 'chords') parts.push('chords');
            else if (mods.movementStyle === 'from_one') parts.push('from one');
            else if (mods.movementStyle === 'to_one') parts.push('to one');
            else if (mods.movementStyle === 'plus_minus_one') parts.push('plus minus one');
        }

        // Rising / modulation
        if (mods.risingSemitones) {
            parts.push('rising');
            parts.push(this.getRisingLabel(mods.risingSemitones));
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

    /**
     * Convert root note name + octave to MIDI.
     * Used at input boundaries (voice commands, UI settings).
     * @param {string} root - Note name like 'C', 'C#'
     * @param {number} octave
     * @returns {number} MIDI note number
     */
    rootToMidi(root, octave) {
        return noteNameToMidi(root, octave);
    }

    /**
     * Transpose an array of MIDI notes by semitones.
     * @param {number[]} midiNotes
     * @param {number} semitones
     * @returns {number[]}
     */
    transposeMidi(midiNotes, semitones) {
        if (!semitones) return midiNotes;
        return midiNotes.map(m => m + semitones);
    }

    /** @param {number} semitones */
    getRisingLabel(semitones) {
        const map = {
            0: 'off',
            1: 'half step',
            2: 'whole step',
            3: 'minor third',
            4: 'major third',
            5: 'perfect fourth',
            7: 'perfect fifth'
        };
        return map[semitones] || `+${semitones}`;
    }

    /** @param {string} style */
    getMovementLabel(style) {
        /** @type {Record<string, string>} */
        const map = {
            normal: 'normal',
            stop_and_go: 'stop-and-go',
            one_three_five: '1-3-5',
            neighbors: 'neighbors (dir)',
            chords: 'chords',
            from_one: 'from 1',
            to_one: 'to 1',
            plus_minus_one: '+1-1 (fixed)'
        };
        return map[style] || style;
    }

    getExerciseLabel(exercise) {
        /** @type {Record<string, string>} */
        const map = {
            none: 'full scale',
            five_note: '5-note',
            octave_jump: 'oct jump',
            arpeggio_return: 'arp return',
            thirds: 'thirds'
        };
        return map[exercise] || exercise;
    }

    /**
     * @param {string[]} a
     * @param {string[]} b
     */
    concatWithoutDuplicate(a, b) {
        if (!Array.isArray(a) || a.length === 0) return Array.isArray(b) ? b : [];
        if (!Array.isArray(b) || b.length === 0) return a;
        if (a[a.length - 1] === b[0]) return [...a, ...b.slice(1)];
        return [...a, ...b];
    }

    /**
     * Build movement groups from MIDI note arrays.
     * All inputs and outputs are MIDI integers.
     * @param {Object} params
     * @param {string} params.movementStyle
     * @param {number[]} params.degreesAscAll - Section notes in play order (MIDI)
     * @param {number[]} params.degreesFromRoot
     * @param {number} params.rootMidi
     * @param {number[]} params.degreesAscendingRef - Ascending scale reference (MIDI)
     * @param {string} params.scaleType
     * @param {number} [params.turnIndex]
     * @param {boolean} [params.startsAscending]
     * @returns {{ groups: Array<{notes: number[], sectionIndex: number, isChord: boolean}>, notes: number[] }}
     */
    buildMovementSequence({ movementStyle, degreesAscAll, degreesFromRoot, rootMidi, degreesAscendingRef, scaleType, turnIndex = -1, startsAscending = true }) {
        const style = movementStyle || 'normal';
        const sectionNotes = degreesAscAll;
        const ascendingScale = degreesAscendingRef || degreesAscAll;
        const lastIndex = sectionNotes.length - 1;

        let groups = [];

        const makeGroup = (notes, sectionIndex, isChord = false) => ({
            notes,
            sectionIndex,
            isChord
        });

        if (style === 'stop_and_go') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const aboveNotes = this.getNotesAbove(midi, ascendingScale, 2);
                    groups.push(makeGroup([midi, ...aboveNotes], 0));
                }
            }
        } else if (style === 'one_three_five') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const aboveNotes = this.getNotesAbove(midi, ascendingScale, 4);
                    const moveNotes = [];
                    if (aboveNotes.length >= 2) moveNotes.push(aboveNotes[1]);
                    if (aboveNotes.length >= 4) moveNotes.push(aboveNotes[3]);
                    groups.push(makeGroup([midi, ...moveNotes], 0));
                }
            }
        } else if (style === 'neighbors') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const belowNotes = this.getNotesBelow(midi, ascendingScale, 1);
                    const aboveNotes = this.getNotesAbove(midi, ascendingScale, 1);

                    let isAscending;
                    if (turnIndex === -1) {
                        isAscending = startsAscending;
                    } else {
                        isAscending = i <= turnIndex ? startsAscending : !startsAscending;
                    }

                    const moveNotes = [];
                    if (isAscending) {
                        if (aboveNotes.length > 0) moveNotes.push(aboveNotes[0]);
                        if (belowNotes.length > 0) moveNotes.push(belowNotes[0]);
                    } else {
                        if (belowNotes.length > 0) moveNotes.push(belowNotes[0]);
                        if (aboveNotes.length > 0) moveNotes.push(aboveNotes[0]);
                    }
                    groups.push(makeGroup([midi, ...moveNotes], 0));
                }
            }
        } else if (style === 'from_one') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex || midi === rootMidi) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    groups.push(makeGroup([rootMidi, midi], 1));
                }
            }
        } else if (style === 'to_one') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === 0 || i === lastIndex || midi === rootMidi) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    groups.push(makeGroup([midi, rootMidi], 0));
                }
            }
        } else if (style === 'plus_minus_one') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const aboveNotes = this.getNotesAbove(midi, ascendingScale, 1);
                    const belowNotes = this.getNotesBelow(midi, ascendingScale, 1);
                    const moveNotes = [midi];
                    if (aboveNotes.length > 0) moveNotes.push(aboveNotes[0]);
                    if (belowNotes.length > 0) moveNotes.push(belowNotes[0]);
                    groups.push(makeGroup(moveNotes, 0));
                }
            }
        } else if (style === 'chords') {
            for (const midi of sectionNotes) {
                const third = this.getDiatonicInterval(midi, 'third', scaleType);
                const fifth = this.getDiatonicInterval(midi, 'fifth', scaleType);
                const chordNotes = [midi];
                if (third !== null) chordNotes.push(third);
                if (fifth !== null) chordNotes.push(fifth);
                groups.push(makeGroup(chordNotes, 0, true));
            }
        } else {
            for (const midi of sectionNotes) {
                groups.push(makeGroup([midi], 0));
            }
        }

        const notes = groups.flatMap(g => g.notes);
        return { groups, notes };
    }

    /**
     * Get N notes above a MIDI note in the given scale.
     * @param {number} midi - Starting MIDI note
     * @param {number[]} ascendingScaleMidi - Ascending scale as MIDI array
     * @param {number} count
     * @returns {number[]} MIDI notes above
     */
    getNotesAbove(midi, ascendingScaleMidi, count) {
        const intervals = this.getScaleIntervalsFromMidi(ascendingScaleMidi);
        if (intervals.length === 0) return [];

        const pc = midiPitchClass(midi);
        const pitchClasses = intervals.map((_v, i) => midiPitchClass(ascendingScaleMidi[i < ascendingScaleMidi.length ? i : 0]));
        const uniquePCs = [...new Set(pitchClasses)];
        const idx = uniquePCs.indexOf(pc);
        if (idx === -1) return [];

        const result = [];
        let current = midi;
        for (let i = 0; i < count; i++) {
            const patternIdx = (idx + i) % intervals.length;
            current += intervals[patternIdx];
            result.push(current);
        }
        return result;
    }

    /**
     * Get N notes below a MIDI note in the given scale.
     * @param {number} midi - Starting MIDI note
     * @param {number[]} ascendingScaleMidi - Ascending scale as MIDI array
     * @param {number} count
     * @returns {number[]} MIDI notes below
     */
    getNotesBelow(midi, ascendingScaleMidi, count) {
        const intervals = this.getScaleIntervalsFromMidi(ascendingScaleMidi);
        if (intervals.length === 0) return [];

        const pc = midiPitchClass(midi);
        const uniquePCs = [];
        const seen = new Set();
        for (const m of ascendingScaleMidi) {
            const p = midiPitchClass(m);
            if (!seen.has(p)) { seen.add(p); uniquePCs.push(p); }
        }
        const idx = uniquePCs.indexOf(pc);
        if (idx === -1) return [];

        const result = [];
        let current = midi;
        for (let i = 0; i < count; i++) {
            const patternIdx = (idx - i - 1 + intervals.length) % intervals.length;
            current -= intervals[patternIdx];
            result.push(current);
        }
        return result;
    }

    /**
     * Calculate semitone intervals between consecutive unique pitch classes in a MIDI scale.
     * @param {number[]} ascendingScaleMidi
     * @returns {number[]}
     */
    getScaleIntervalsFromMidi(ascendingScaleMidi) {
        const uniquePCs = [];
        const seen = new Set();
        for (const m of ascendingScaleMidi) {
            const pc = midiPitchClass(m);
            if (!seen.has(pc)) { seen.add(pc); uniquePCs.push(pc); }
        }
        if (uniquePCs.length === 0) return [];
        const intervals = [];
        for (let i = 0; i < uniquePCs.length; i++) {
            const current = uniquePCs[i];
            const next = uniquePCs[(i + 1) % uniquePCs.length];
            let interval = next - current;
            if (interval <= 0) interval += 12;
            intervals.push(interval);
        }
        return intervals;
    }

    /**
     * Get a diatonic interval (3rd or 5th) above a MIDI note.
     * @param {number} midi
     * @param {string} intervalName - 'third' or 'fifth'
     * @param {string} scaleType
     * @returns {number | null} MIDI note, or null if invalid interval name
     */
    getDiatonicInterval(midi, intervalName, scaleType) {
        let semitones;
        if (intervalName === 'third') {
            if (scaleType === 'minor' || scaleType === 'natural_minor' ||
                scaleType === 'harmonic_minor' || scaleType === 'melodic_minor' ||
                scaleType === 'dorian' || scaleType === 'phrygian' || scaleType === 'aeolian') {
                semitones = 3;
            } else {
                semitones = 4;
            }
        } else if (intervalName === 'fifth') {
            semitones = 7;
        } else {
            return null;
        }

        return midi + semitones;
    }

    /**
     * Get interval name for scale degree
     * @param {number} semitones
     * @param {string} scaleType
     */
    getIntervalName(semitones, scaleType) {
        if (semitones < 0) return `${semitones}`;
        // For chromatic, just show semitone number
        if (scaleType === 'chromatic') {
            if (semitones === 0) return 'root';
            if (semitones === 12) return 'octave';
            return `+${semitones}`;
        }

        // Scale degree names
        const degreeNames = {
            0: 'root',
            1: 'flat second',
            2: 'second',
            3: 'flat third',
            4: 'third',
            5: 'fourth',
            6: 'flat fifth',
            7: 'fifth',
            8: 'flat sixth',
            9: 'sixth',
            10: 'flat seventh',
            11: 'seventh',
            12: 'octave'
        };

        return degreeNames[semitones] || `+${semitones}`;
    }

    // Get arpeggio interval name
    getArpeggioIntervalName(index, quality) {
        const names = quality === 'minor'
            ? ['root', 'flat third', 'fifth', 'octave']
            : ['root', 'third', 'fifth', 'octave'];
        return names[index] || `${index + 1}`;
    }

    /**
     * Format the status display for current note (MIDI).
     * Shows: "command set | current note [interval]"
     * @param {number} midi
     * @param {number} index
     * @param {Object} context
     */
    formatNoteStatus(midi, index, context) {
        const pitchStr = midiToPitchString(midi);

        const commandSet = this.formatCurrentCommand();

        if (!context.type) {
            return `${commandSet} | ${pitchStr}`;
        }

        let intervalInfo = '';

        if (context.type === 'scale') {
            if (context.rootMidi !== undefined && context.rootMidi !== null) {
                const repeatIndex = context.repeatIndex || 0;
                const risingSemitones = context.risingSemitones || 0;
                const repeatRootMidi = context.rootMidi + (repeatIndex * risingSemitones);
                intervalInfo = this.getIntervalName(midi - repeatRootMidi, context.scaleType);
            } else {
                const pattern = context.pattern || [];
                if (context.intervals && context.intervals[index] !== undefined) {
                    intervalInfo = this.getIntervalName(context.intervals[index], context.scaleType);
                } else if (pattern[index] !== undefined) {
                    intervalInfo = this.getIntervalName(pattern[index], context.scaleType);
                }
            }
        } else if (context.type === 'arpeggio') {
            if (context.intervals && context.intervals[index] !== undefined) {
                intervalInfo = this.getArpeggioIntervalName(context.intervals[index], context.quality);
            }
        } else if (context.type === 'interval') {
            intervalInfo = index === 0 ? 'root' : context.intervalName || '';
        }

        if (intervalInfo) {
            return `${commandSet} | ${pitchStr} [${intervalInfo}]`;
        }
        return `${commandSet} | ${pitchStr}`;
    }

    /**
     * @param {number} midi - MIDI note number
     * @param {string} [duration]
     */
    playNote(midi, duration = '8n') {
        this.audio.playNote(midi, duration);
    }

    /**
     * Get the semitone range for a section length setting
     * @param {string} sectionLength
     * @returns {{ min: number, max: number }}
     */
    getSectionRange(sectionLength) {
        switch (sectionLength) {
            case '1o+3':
                return { min: 0, max: 16 }; // octave + major 3rd
            case '1o+5':
                return { min: 0, max: 19 }; // octave + perfect 5th
            case '2o':
                return { min: 0, max: 24 }; // 2 octaves
            case 'centered':
                return { min: -4, max: 16 }; // major 3rd below to major 3rd above octave
            default: // '1o'
                return { min: 0, max: 12 }; // 1 octave
        }
    }

    /**
     * Get all scale degrees that fall within a semitone range
     * @param {readonly number[]} basePattern - Scale pattern (e.g., [0,2,4,5,7,9,11,12] for major)
     * @param {number} minSemitone - Minimum semitone (can be negative)
     * @param {number} maxSemitone - Maximum semitone
     * @returns {number[]} - Sorted array of semitone intervals within range
     */
    getScaleDegreesInRange(basePattern, minSemitone, maxSemitone) {
        const degrees = new Set();

        // Extend pattern across multiple octaves and filter to range
        for (let octaveShift = -2; octaveShift <= 3; octaveShift++) {
            for (const interval of basePattern) {
                const shifted = interval + (octaveShift * 12);
                if (shifted >= minSemitone && shifted <= maxSemitone) {
                    degrees.add(shifted);
                }
            }
        }

        return Array.from(degrees).sort((a, b) => a - b);
    }

    /**
     * @param {string} root
     * @param {string} scaleType
     * @param {ScaleModifiers} [modifiers]
     */
    async playScale(root, scaleType, modifiers = {}) {
        const rootMidi = noteNameToMidi(root, this.settings.octave);
        if (rootMidi === null) return;

        const basePattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        const sectionLength = this.settings.sectionLength || '1o';
        const { min: minSemitone, max: maxSemitone } = this.getSectionRange(sectionLength);
        const fullPattern = this.getScaleDegreesInRange(basePattern, minSemitone, maxSemitone);
        const degreesAscAll = fullPattern.map(interval => rootMidi + interval);

        const movementStyle = modifiers.movementStyle ?? this.settings.movementStyle;

        const exercise = modifiers.exercise ?? this.settings.exercise;
        const shiftingSteps = modifiers.shiftingSteps ?? this.settings.shiftingSteps;
        const exercisePattern = this.exercisePatterns[exercise];

        if (exercisePattern && exercisePattern.length > 0) {
            await this.playExercise(root, scaleType, exercisePattern, modifiers, {
                degreesAscAll,
                rootMidi,
                fullPattern,
                shiftingSteps
            });
            return;
        }

        const direction = modifiers.direction || this.settings.direction;
        const ascending = degreesAscAll;
        const descending = [...degreesAscAll].reverse();

        let sectionNotes;
        let turnIndex = -1;
        let startsAscending = true;

        if (direction === 'descending') {
            sectionNotes = descending;
            startsAscending = false;
        } else if (direction === 'both') {
            sectionNotes = [...ascending, ...descending.slice(1)];
            turnIndex = ascending.length - 1;
            startsAscending = true;
        } else if (direction === 'down_and_up') {
            sectionNotes = [...descending, ...ascending.slice(1)];
            turnIndex = descending.length - 1;
            startsAscending = false;
        } else {
            sectionNotes = ascending;
            startsAscending = true;
        }

        const rootIndexInSection = sectionNotes.indexOf(rootMidi);
        const movementResult = this.buildMovementSequence({
            movementStyle,
            degreesAscAll: sectionNotes,
            degreesFromRoot: rootIndexInSection >= 0 ? sectionNotes.slice(rootIndexInSection) : sectionNotes,
            rootMidi,
            degreesAscendingRef: degreesAscAll,
            scaleType,
            turnIndex,
            startsAscending
        });

        const notes = movementResult.notes;
        const allGroups = movementResult.groups;

        const context = {
            type: 'scale',
            root,
            scaleType,
            pattern: fullPattern,
            rootMidi,
            movementStyle
        };

        if (movementStyle !== 'normal' && allGroups.length > 1) {
            await this.playGroupSequence(allGroups, modifiers, context);
        } else {
            await this.playSequence(notes, modifiers, context);
        }
    }

    /**
     * Play a sequence organized into groups (phrases) with gaps between them.
     * All note arrays are MIDI integers.
     */
    async playGroupSequence(groups, modifiers = {}, context = {}) {
        this.clearScalePreview();
        this.clearActuallyPlayed();
        this.updatePatternPreview(0);

        const phraseGap = 'note';

        let repeatCount = modifiers.repeat ?? this.settings.repeatCount;
        const playTimes = repeatCount === 0 ? 1 : (repeatCount === Infinity ? Infinity : repeatCount);
        const isInfinite = playTimes === Infinity;
        const risingSemitones = (modifiers.risingSemitones ?? this.settings.risingSemitones) || 0;
        const repeatGapMs = modifiers.repeatGapMs ?? this.settings.repeatGapMs;

        const playId = this.audio.requestSequencePlayback();
        let r = 0;

        try {
            while (this.audio.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                const transpose = risingSemitones * r;

                for (let g = 0; g < groups.length; g++) {
                    if (!this.audio.isPlaybackValid(playId)) break;

                    const group = groups[g];
                    const duration = this.getNoteDuration(modifiers);
                    const { notes: groupMidi, sectionIndex, isChord } = group;

                    if (isChord) {
                        const chordMidi = transpose > 0 ? groupMidi.map(m => m + transpose) : groupMidi;

                        this.highlightPianoKeys(chordMidi);
                        this.voiceCore.updateStatus(`${context.root} ${context.scaleType} | ${chordMidi.map(midiToPitchString).join('+')}`);
                        this.setPianoNotificationActiveNotes(chordMidi);
                        this.appendActuallyPlayedChord(chordMidi);

                        this.audio.playChord(chordMidi, duration.tone + 's');
                        await this.audio.sleep(duration.ms + duration.gap);
                    } else {
                        for (let i = 0; i < groupMidi.length; i++) {
                            if (!this.audio.isPlaybackValid(playId)) break;

                            const midi = transpose > 0 ? groupMidi[i] + transpose : groupMidi[i];
                            const isSection = (i === sectionIndex);

                            this.highlightPianoKey(midi);
                            this.voiceCore.updateStatus(`${context.root} ${context.scaleType} | ${midiToPitchString(midi)}`);
                            this.setPianoNotificationActiveNotes([midi]);
                            this.appendActuallyPlayed(midi, isSection);

                            this.audio.playNote(midi, duration.tone + 's');
                            await this.audio.sleep(duration.ms + duration.gap);
                        }
                    }

                    const isLastGroup = g === groups.length - 1;
                    if (!isLastGroup) {
                        if (phraseGap === 'note') {
                            // no extra gap
                        } else if (phraseGap > 0) {
                            await this.audio.sleep(phraseGap);
                        }
                    }
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.audio.isPlaybackValid(playId)) {
                    const nextTranspose = risingSemitones * r;
                    this.clearActuallyPlayed();
                    this.updatePatternPreview(nextTranspose);

                    if (risingSemitones === 0) {
                        await this.audio.sleep(isInfinite ? repeatGapMs : 1500);
                    }
                }
            }
        } finally {
            if (this.audio.playbackId === playId) {
                this.audio.isPlaying = false;
            }
        }

        this.clearPianoHighlights();
        this.voiceCore.updateStatus('Ready');
        this.setPianoNotificationActiveNotes([]);
        this.updateScalePreview();
    }

    /**
     * Play an exercise pattern with optional shifting. All notes are MIDI.
     */
    async playExercise(root, scaleType, exercisePattern, modifiers, context) {
        const { degreesAscAll, rootMidi, shiftingSteps } = context;

        this.clearScalePreview();
        this.clearActuallyPlayed();

        const basePattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        const extendedScale = [];

        // Build 3 octaves of scale MIDI notes for shifting room
        for (let octaveShift = 0; octaveShift < 3; octaveShift++) {
            for (const interval of basePattern.slice(0, -1)) {
                extendedScale.push(rootMidi + interval + octaveShift * 12);
            }
        }
        const lastInterval = basePattern[basePattern.length - 1] || 12;
        extendedScale.push(rootMidi + lastInterval + 2 * 12);

        let repeatCount = modifiers.repeat ?? this.settings.repeatCount;
        const playTimes = repeatCount === 0 ? 1 : (repeatCount === Infinity ? Infinity : repeatCount);
        const isInfinite = playTimes === Infinity;
        const repeatGapMs = modifiers.repeatGapMs ?? this.settings.repeatGapMs;

        const playId = this.audio.requestSequencePlayback();
        let r = 0;

        const exerciseLabels = {
            'five_note': '5-note',
            'octave_jump': 'oct jump',
            'arpeggio_return': 'arp return',
            'thirds': 'thirds'
        };
        const exerciseName = exerciseLabels[this.settings.exercise] || this.settings.exercise;

        try {
            while (this.audio.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                const startingDegree = shiftingSteps * r;

                const notes = [];
                for (const offset of exercisePattern) {
                    const scaleIndex = startingDegree + offset;
                    if (scaleIndex >= 0 && scaleIndex < extendedScale.length) {
                        notes.push(extendedScale[scaleIndex]);
                    }
                }

                if (notes.length === 0) break;

                for (let i = 0; i < notes.length; i++) {
                    if (!this.audio.isPlaybackValid(playId)) break;

                    const midi = notes[i];
                    const duration = this.getNoteDuration(modifiers);

                    this.highlightPianoKey(midi);
                    const shiftLabel = shiftingSteps > 0 ? ` (shift ${r + 1})` : '';
                    this.voiceCore.updateStatus(`${root} ${scaleType} ${exerciseName}${shiftLabel} | ${midiToPitchString(midi)}`);
                    this.setPianoNotificationActiveNotes([midi]);
                    this.appendActuallyPlayed(midi, true);

                    this.audio.playNote(midi, duration.tone + 's');
                    await this.audio.sleep(duration.ms + duration.gap);
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.audio.isPlaybackValid(playId)) {
                    this.clearActuallyPlayed();

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

        this.clearPianoHighlights();
        this.voiceCore.updateStatus('Ready');
        this.setPianoNotificationActiveNotes([]);
        this.updateScalePreview();
    }

    async playArpeggio(root, quality, modifiers = {}) {
        const rootMidi = noteNameToMidi(root, this.settings.octave);
        if (rootMidi === null) return;

        const arpIntervals = quality === 'minor' ? [0, 3, 7, 12] : [0, 4, 7, 12];
        let notes = arpIntervals.map(interval => rootMidi + interval);
        let intervals = [0, 1, 2, 3];

        const direction = modifiers.direction || this.settings.direction;
        if (direction === 'descending') {
            notes = notes.reverse();
            intervals = intervals.reverse();
        } else if (direction === 'both') {
            const ascending = [...notes];
            const descending = [...notes].reverse().slice(1);
            notes = [...ascending, ...descending];
            intervals = [...intervals, ...[...intervals].reverse().slice(1)];
        } else if (direction === 'down_and_up') {
            const descending = [...notes].reverse();
            const ascending = [...notes].slice(1);
            notes = [...descending, ...ascending];
            intervals = [...[...intervals].reverse(), ...[...intervals].slice(1)];
        }

        const context = {
            type: 'arpeggio',
            root,
            quality,
            intervals
        };

        await this.playSequence(notes, modifiers, context);
    }

    async playChord(root, quality, modifiers = {}) {
        const rootMidi = noteNameToMidi(root, this.settings.octave);
        if (rootMidi === null) return;

        const intervals = quality === 'minor' ? [0, 3, 7] : [0, 4, 7];
        const midiNotes = intervals.map(interval => rootMidi + interval);

        const repeatCount = modifiers.repeat || 1;
        this.setPianoNotificationActiveNotes(midiNotes);
        await this.audio.playChordRepeated(midiNotes, {
            repeatCount,
            onStatus: (message) => this.voiceCore.updateStatus(message),
            gapMs: 2000
        });
        this.setPianoNotificationActiveNotes([]);
    }

    async playInterval(root, interval, quality, modifiers = {}) {
        const rootMidi = noteNameToMidi(root, this.settings.octave);
        if (rootMidi === null) return;

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

        const semitones = intervalMap[interval] || 0;
        const midi1 = rootMidi;
        const midi2 = rootMidi + semitones;

        const qualityPrefix = quality ? `${quality} ` : '';
        const intervalName = `${qualityPrefix}${interval}`;

        const context = {
            type: 'interval',
            root,
            interval,
            quality,
            intervalName
        };

        await this.playSequence([midi1, midi2], modifiers, context);
    }

    /**
     * Play a sequence of MIDI notes with repeat/rising support.
     * @param {number[]} notes - MIDI note array
     */
    async playSequence(notes, modifiers = {}, context = {}) {
        this.clearScalePreview();
        this.clearActuallyPlayed();
        this.updatePatternPreview(0);

        let repeatCount = modifiers.repeat ?? this.settings.repeatCount;
        const playTimes = repeatCount === 0 ? 1 : repeatCount;
        const isInfinite = repeatCount === Infinity;

        const risingSemitones = (modifiers.risingSemitones ?? this.settings.risingSemitones) || 0;
        const repeatGapMs = modifiers.repeatGapMs ?? this.settings.repeatGapMs;
        const getNotesForRepeat = risingSemitones > 0
            ? (repeatIndex) => this.transposeMidi(notes, repeatIndex * risingSemitones)
            : null;

        const direction = modifiers.direction || this.settings.direction;
        const isRoundTrip = direction === 'both' || direction === 'down_and_up';
        const seamlessRepeat = isRoundTrip && playTimes > 1 && risingSemitones === 0;

        const mergedContext = {
            ...context,
            risingSemitones
        };

        await this.audio.playSequence(notes, {
            getDuration: () => this.getNoteDuration(modifiers),
            onNote: (midi, index, repeatIndex) => {
                this.highlightPianoKey(midi);
                const noteDisplay = this.formatNoteStatus(midi, index, { ...mergedContext, repeatIndex });
                this.voiceCore.updateStatus(noteDisplay);
                this.setPianoNotificationActiveNotes([midi]);
                this.appendActuallyPlayed(midi, true);
            },
            onStatus: (message) => {
                this.clearPianoHighlights();
                this.voiceCore.updateStatus(message);
            },
            onRepeatEnd: (nextRepeatIndex) => {
                const nextTranspose = risingSemitones * nextRepeatIndex;
                this.clearActuallyPlayed();
                this.updatePatternPreview(nextTranspose);
            },
            repeatCount: playTimes,
            repeatGapMs: risingSemitones > 0 ? 0 : (isInfinite ? repeatGapMs : 1500),
            seamlessRepeat,
            getNotesForRepeat
        });

        this.clearPianoHighlights();
        this.voiceCore.updateStatus('Ready');
        this.setPianoNotificationActiveNotes([]);
        this.updateScalePreview();
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

        // Gap: voice modifier overrides setting
        // gapMs: negative = overlap ratio, 0+ = milliseconds
        let gap;
        if (modifiers.gap && this.gapNameToValue[modifiers.gap] !== undefined) {
            gap = this.gapNameToValue[modifiers.gap];
        } else {
            const gapVal = this.settings.gapMs;
            if (gapVal < 0 && gapVal > -1) {
                // Negative values are overlap ratios (e.g., -0.5 = 50% overlap)
                gap = Math.round(ms * gapVal);
            } else {
                gap = gapVal;
            }
        }

        return { ms, tone, gap };
    }

    stopPlayback() {
        this.audio.stop();
        this.clearPianoHighlights();
        this.updateScalePreview();
        this.setPianoNotificationActiveNotes([]);
        // Also cancel any in-progress voice recognition
        if (this.voiceCore) {
            this.voiceCore.stopListening();
        }
    }

    // Play current settings (always - "Again" always plays what's in the UI)
    async playCurrentSettings() {
        await this.ensureAudioStarted();

        // Build command from current settings
        const command = {
            type: 'scale',
            root: this.settings.root,
            scaleType: this.settings.scaleType,
            modifiers: {
                direction: this.settings.direction,
                movementStyle: this.settings.movementStyle,
                risingSemitones: this.settings.risingSemitones,
                rangeExpansion: this.settings.rangeExpansion,
                octaveSpan: this.settings.octaveSpan,
                tempo: this.msToTempoName(this.settings.noteLengthMs),
                gap: null, // gap is handled via gapMs directly
                repeat: this.settings.repeatCount,
                repeatGapMs: this.settings.repeatGapMs,
                exercise: this.settings.exercise,
                shiftingSteps: this.settings.shiftingSteps
            }
        };

        const transcript = `${this.settings.root} ${this.settings.scaleType} scale`;
        this.voiceCore.updateStatus(this.buildStatusMessage(command));
        this.updatePianoNotificationCommand(command);
        this.setPianoNotificationActiveNotes([]);
        await this.playScale(command.root, command.scaleType, command.modifiers);
        this.lastCommand = command;
        this.lastTranscript = transcript;
        this.addToHistory(command, transcript);
    }

    // Alias for button click (same behavior)
    async playAgainOrCurrent() {
        await this.playCurrentSettings();
    }

    // Add a command to history
    addToHistory(command, transcript) {
        const historyEntry = {
            type: 'command',
            command: JSON.parse(JSON.stringify(command)), // Deep copy
            transcript: transcript || this.getCommandDescription(command),
            description: this.getCommandDescription(command),
            timestamp: new Date()
        };

        this.commandHistory.unshift(historyEntry); // Add to beginning

        // Limit history length
        if (this.commandHistory.length > this.maxHistoryLength) {
            this.commandHistory.pop();
        }

        this.renderHistory();
    }

    // Clear command history
    clearHistory() {
        this.commandHistory = [];
        this.renderHistory();
    }

    // Render the history list
    renderHistory() {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        if (this.commandHistory.length === 0) {
            historyList.innerHTML = '<p class="history-empty">No commands yet</p>';
            return;
        }

        historyList.innerHTML = this.commandHistory.map((entry, index) => {
            const timeStr = this.formatTime(entry.timestamp);

            // Handle error entries
            if (entry.type === 'error') {
                const errorDetails = entry.details?.error ? `\n${this.formatErrorDetails(entry.details)}` : '';
                return `
                    <div class="history-item history-error" data-index="${index}">
                        <div class="history-error-icon">⚠</div>
                        <div class="history-text">
                            <div class="history-error-message">${this.escapeHtml(entry.message)}</div>
                            ${errorDetails ? `<div class="history-error-details">${this.escapeHtml(errorDetails)}</div>` : ''}
                        </div>
                        <span class="history-time">${timeStr}</span>
                    </div>
                `;
            }

            // Handle command entries
            return `
                <div class="history-item" data-index="${index}">
                    <button class="history-play-btn" data-index="${index}" title="Play again">
                        &#9654;
                    </button>
                    <div class="history-text">
                        ${this.escapeHtml(entry.description)}
                        ${entry.transcript !== entry.description ?
                    `<div class="history-transcript">"${this.escapeHtml(entry.transcript)}"</div>` : ''}
                    </div>
                    <span class="history-time">${timeStr}</span>
                </div>
            `;
        }).join('');

        // Add click handlers to play buttons (only for command entries)
        historyList.querySelectorAll('.history-play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = /** @type {HTMLElement} */ (e.currentTarget);
                const index = parseInt(target.dataset.index || '0');
                this.playFromHistory(index);
            });
        });
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
        if (this.commandHistory.length === 0) return;

        const lines = this.commandHistory.map((entry, index) => {
            const timeStr = this.formatTime(entry.timestamp);

            if (entry.type === 'error') {
                const errorDetails = entry.details?.error ? `\n${this.formatErrorDetails(entry.details)}` : '';
                return `[${timeStr}] ERROR: ${entry.message}${errorDetails}`;
            } else {
                const transcript = entry.transcript !== entry.description ? ` ("${entry.transcript}")` : '';
                return `[${timeStr}] ${entry.description}${transcript}`;
            }
        });

        const text = lines.join('\n');

        // Copy to clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.voiceCore.updateStatus('History copied to clipboard');
            }).catch(err => {
                console.error('Failed to copy:', err);
                this.voiceCore.updateStatus('Failed to copy history');
            });
        } else {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                this.voiceCore.updateStatus('History copied to clipboard');
            } catch (err) {
                console.error('Failed to copy:', err);
                this.voiceCore.updateStatus('Failed to copy history');
            }
            document.body.removeChild(textarea);
        }
    }

    // Play a command from history
    async playFromHistory(index) {
        const entry = this.commandHistory[index];
        if (entry && entry.type === 'command' && entry.command) {
            this.voiceCore.updateStatus(`Replaying: ${entry.description}`);
            await this.executeScaleCommand(entry.command, null, true); // skipHistory=true
        }
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

    // Escape HTML for safe rendering
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Highlight a single piano key by MIDI number.
     * @param {number} midi
     */
    highlightPianoKey(midi) {
        this.clearPianoHighlights();
        this.addPianoHighlight(midi);
    }

    /**
     * Highlight multiple piano keys by MIDI numbers (for chords).
     * @param {number[]} midiNotes
     */
    highlightPianoKeys(midiNotes) {
        this.clearPianoHighlights();
        midiNotes.forEach(m => this.addPianoHighlight(m));
    }

    /**
     * Add highlight to the piano key matching this MIDI note.
     * If the exact MIDI is off-keyboard, highlights the same pitch class
     * at the nearest octave that exists on the keyboard.
     * @param {number} midi
     */
    addPianoHighlight(midi) {
        let key = document.querySelector(`.piano-key[data-midi="${midi}"]`);
        if (!key) {
            const pc = midiPitchClass(midi);
            let bestKey = null;
            let bestDist = Infinity;
            document.querySelectorAll('.piano-key').forEach(el => {
                const k = /** @type {HTMLElement} */ (el);
                const km = parseInt(k.dataset.midi);
                if (midiPitchClass(km) === pc) {
                    const dist = Math.abs(km - midi);
                    if (dist < bestDist) { bestDist = dist; bestKey = k; }
                }
            });
            key = bestKey;
        }
        if (key) {
            key.classList.add('active');
        }
    }

    clearPianoHighlights() {
        document.querySelectorAll('.piano-key.active').forEach(key => {
            key.classList.remove('active');
        });
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

    clearScalePreview() {
        document.querySelectorAll('.piano-key.scale-root, .piano-key.scale-note').forEach(key => {
            key.classList.remove('scale-root', 'scale-note');
        });
    }

    /**
     * Update piano to show current scale preview using MIDI.
     * Highlights piano keys matching scale notes; for notes outside the
     * keyboard range, highlights the same pitch class at the nearest octave.
     */
    updateScalePreview() {
        this.clearScalePreview();

        if (this.audio.isPlaying) return;

        const root = this.settings.root;
        const scaleType = this.settings.scaleType;
        const sectionLength = this.settings.sectionLength;

        const degreesModel = this.buildScaleDegreesAscAll({ root, scaleType, sectionLength });
        if (!degreesModel) return;

        const { degreesAscAll, rootMidi } = degreesModel;
        const scaleMidiSet = new Set(degreesAscAll);
        const scalePitchClasses = new Set(degreesAscAll.map(m => midiPitchClass(m)));
        const rootPC = midiPitchClass(rootMidi);

        document.querySelectorAll('.piano-key').forEach(el => {
            const key = /** @type {HTMLElement} */ (el);
            const keyMidi = parseInt(key.dataset.midi);
            if (isNaN(keyMidi)) return;

            const exactMatch = scaleMidiSet.has(keyMidi);
            const pcMatch = !exactMatch && scalePitchClasses.has(midiPitchClass(keyMidi));
            if (!exactMatch && !pcMatch) return;

            if (midiPitchClass(keyMidi) === rootPC) {
                key.classList.add('scale-root');
            } else {
                key.classList.add('scale-note');
            }
        });
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
        const noteName = NOTE_NAMES[midiPitchClass(midi)];
        const octave = midiOctave(midi);
        const name = isSection ? noteName : noteName.toLowerCase();
        return octave === defaultOctave ? name : name + octave;
    }

    truncateText(text, maxLen) {
        if (!text) return '';
        if (text.length <= maxLen) return text;
        return text.slice(0, Math.max(0, maxLen - 1)) + '…';
    }

    /**
     * Build ascending scale degrees as MIDI array.
     * @param {Object} params
     * @param {string} params.root
     * @param {string} params.scaleType
     * @param {string} [params.sectionLength]
     * @returns {{ degreesAscAll: number[], rootMidi: number, pattern: number[] } | null}
     */
    buildScaleDegreesAscAll({ root, scaleType, sectionLength }) {
        const basePattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        const rootMidi = noteNameToMidi(root, this.settings.octave);
        if (rootMidi === null) return null;

        const { min: minSemitone, max: maxSemitone } = this.getSectionRange(sectionLength || '1o');
        const fullPattern = this.getScaleDegreesInRange(basePattern, minSemitone, maxSemitone);

        const degreesAscAll = fullPattern.map(interval => rootMidi + interval);

        return { degreesAscAll, rootMidi, pattern: fullPattern };
    }

    /**
     * Build a complete playback plan as MIDI arrays.
     * @returns {{ segments: Array, notes: number[], rootMidi: number, pattern: number[] } | null}
     */
    buildScalePlaybackPlan({ root, scaleType, direction, movementStyle, sectionLength }) {
        const degreesModel = this.buildScaleDegreesAscAll({ root, scaleType, sectionLength });
        if (!degreesModel) return null;

        const { degreesAscAll, rootMidi, pattern } = degreesModel;

        const ascending = degreesAscAll;
        const descending = [...degreesAscAll].reverse();

        let sectionNotes;
        let directionLabel;
        let turnIndex = -1;
        let startsAscending = true;

        if (direction === 'descending') {
            sectionNotes = descending;
            directionLabel = 'down';
            startsAscending = false;
        } else if (direction === 'both') {
            sectionNotes = [...ascending, ...descending.slice(1)];
            directionLabel = 'up+down';
            turnIndex = ascending.length - 1;
            startsAscending = true;
        } else if (direction === 'down_and_up') {
            sectionNotes = [...descending, ...ascending.slice(1)];
            directionLabel = 'down+up';
            turnIndex = descending.length - 1;
            startsAscending = false;
        } else {
            sectionNotes = ascending;
            directionLabel = 'up';
            startsAscending = true;
        }

        const rootIndexInSection = sectionNotes.indexOf(rootMidi);
        const movementResult = this.buildMovementSequence({
            movementStyle,
            degreesAscAll: sectionNotes,
            degreesFromRoot: rootIndexInSection >= 0 ? sectionNotes.slice(rootIndexInSection) : sectionNotes,
            rootMidi,
            degreesAscendingRef: degreesAscAll,
            scaleType,
            turnIndex,
            startsAscending
        });

        const segments = [{ label: directionLabel, groups: movementResult.groups }];
        const notes = movementResult.notes;

        return { segments, notes, rootMidi, pattern };
    }

    formatGroupsForPreview(groups, transposeSemitones = 0) {
        const groupStrings = groups.map(group => {
            const midiNotes = group.notes.map(m => m + transposeSemitones);
            return midiNotes.map(m => NOTE_NAMES[midiPitchClass(m)]).join(' ');
        });
        return groupStrings.join(' | ');
    }

    /**
     * Update the note sequence display. All notes are MIDI integers.
     * @param {number} [transpose=0] - Semitones to transpose the preview
     */
    updateNoteSequencePreview(transpose = 0) {
        const el = document.getElementById('noteSequence');
        if (!el) return;

        const { root, scaleType, direction, movementStyle, sectionLength } = this.settings;

        const plan = this.buildScalePlaybackPlan({
            root,
            scaleType,
            direction,
            movementStyle,
            sectionLength
        });

        if (!plan || !plan.segments || !plan.segments[0]) {
            el.textContent = '--';
            return;
        }

        const groups = plan.segments[0].groups;
        const defaultOctave = this.settings.octave;

        const parts = groups.map(group => {
            const { notes: midiNotes, sectionIndex, isChord } = group;
            const displayMidi = transpose !== 0
                ? midiNotes.map(m => m + transpose)
                : midiNotes;

            if (isChord) {
                return `[${displayMidi.map(m => this.formatMidiDisplay(m, true, defaultOctave)).join('')}]`;
            }

            return displayMidi.map((m, i) => {
                return this.formatMidiDisplay(m, i === sectionIndex, defaultOctave);
            }).join('');
        });

        el.textContent = parts.join(' ');
    }

    // Kept for backward compatibility - now delegates to updateNoteSequencePreview
    updatePatternPreview(transpose = 0) {
        this.updateNoteSequencePreview(transpose);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    showHelp() {
        // Comprehensive help organized by category
        const helpCategories = {
            scales: [
                'scale (C major)',
                'D scale, A minor scale',
                'chromatic scale, chromatic from E',
                'pentatonic, blues scale'
            ],
            notes: [
                'C, play D, F sharp, B flat',
                'C chord, A minor chord'
            ],
            intervals: [
                'fifth, 5th, third from G, 3rd',
                'minor third, major 3rd',
                'perfect fifth from D'
            ],
            arpeggios: [
                'arpeggio (C major)',
                'D minor arpeggio'
            ],
            modifiers: [
                'slowly, very slowly, quickly',
                'with a gap, with a large gap',
                'repeat, twice, three times',
                'ascending, descending, up and down'
            ],
            control: [
                'tuning (A440)',
                'stop, help'
            ]
        };

        // Short spoken summary
        const spokenHelp = 'Say scale, note, chord, arpeggio, or interval. Add slowly, with a gap, or repeat. Say stop to cancel.';

        // Detailed status text
        const statusParts = [];
        for (const [category, commands] of Object.entries(helpCategories)) {
            statusParts.push(`${category}: ${commands[0]}`);
        }

        this.voiceCore.updateStatus('Help: ' + statusParts.join(' | '));
        this.voiceCore.speakText(spokenHelp);
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
        this.voiceCore.updateStatus(`Error: ${message}`);

        // Add error to command history
        const errorEntry = {
            type: 'error',
            message: message,
            details: details,
            timestamp: new Date()
        };

        this.commandHistory.unshift(errorEntry);

        // Limit history length
        if (this.commandHistory.length > this.maxHistoryLength) {
            this.commandHistory.pop();
        }

        this.renderHistory();
    }

    showError(msg) {
        this.logError(msg);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.scalesController = new ScalesController();
});

