//-----------------------------------------------------------------------
// SCALES - Voice-controlled scale and pitch training
// Uses VoiceCommandCore for voice recognition
// Uses Tone.js for piano sound synthesis
//-----------------------------------------------------------------------

//-------AUDIO COORDINATOR-------
// Single authority for all audio playback - prevents overlapping sounds
class AudioCoordinator {
    constructor() {
        this.synth = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.playbackId = 0;  // Monotonic ID to detect stale/superseded playback
        this.onNoteCallback = null;
        this.onStatusCallback = null;
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

    // Play a single note (does not affect sequence playback state)
    playNote(note, duration = '8n') {
        this.enableAudio();
        this.synth.triggerAttackRelease(note, duration);
    }

    // Play a chord (multiple notes simultaneously)
    playChord(notes, duration = '2n') {
        this.enableAudio();
        this.synth.triggerAttackRelease(notes, duration);
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

    // Check if a playback session is still the current one
    isPlaybackValid(id) {
        return this.isPlaying && id === this.playbackId;
    }

    // Play a sequence of notes with full control
    async playSequence(notes, options = {}) {
        const {
            getDuration,      // Function returning { ms, tone, gap } for current note
            onNote,           // Callback(note, index) called when each note plays
            onStatus,         // Callback(message) for status updates
            repeatCount = 1,  // Number of times to repeat (Infinity for forever)
            repeatGapMs = 1500, // Gap between repeats
            seamlessRepeat = false // If true, no gap and skip first note on repeats (for up+down/down+up)
        } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        const playTimes = repeatCount === 0 ? 1 : (isInfinite ? Infinity : repeatCount);
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                // For seamless repeat, skip first note on iterations after the first
                // (it would duplicate the last note of previous iteration)
                const startIndex = (seamlessRepeat && r > 0) ? 1 : 0;

                // Play the sequence
                for (let i = startIndex; i < notes.length; i++) {
                    if (!this.isPlaybackValid(playId)) break;

                    const duration = getDuration ? getDuration() : { ms: 500, tone: 0.5, gap: 0 };

                    if (onNote) onNote(notes[i], i);
                    this.synth.triggerAttackRelease(notes[i], duration.tone);

                    await this.sleep(duration.ms + duration.gap);
                }

                r++;

                // Pause between repeats (skip for seamless repeat)
                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.isPlaybackValid(playId) && !seamlessRepeat) {
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
        } finally {
            // Only clear isPlaying if we're still the current playback
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
    }

    // Play a chord with repeat support
    async playChordRepeated(notes, options = {}) {
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
                this.synth.triggerAttackRelease(notes, '2n');
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

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

//-------MUSICAL CONSTANTS-------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Phonetic aliases for note names (speech recognition often mishears these)
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

// Phonetic aliases for sharp/flat
const MODIFIER_PHONETIC_MAP = {
    'sharp': 'sharp', 'shop': 'sharp', 'sharpe': 'sharp', 'shark': 'sharp',
    'flat': 'flat', 'flap': 'flat', 'flight': 'flat',
    '#': 'sharp', 'b': 'flat'
};

// Normalize a spoken note name to standard form
function normalizeNoteName(spoken) {
    if (!spoken) return null;
    const lower = spoken.toLowerCase().trim();
    return NOTE_PHONETIC_MAP[lower] || (lower.length === 1 && lower.match(/[a-g]/i) ? lower.toUpperCase() : null);
}

// Normalize sharp/flat modifier
function normalizeModifier(spoken) {
    if (!spoken) return null;
    const lower = spoken.toLowerCase().trim();
    return MODIFIER_PHONETIC_MAP[lower] || null;
}

// Scale intervals (semitones from root)
const SCALE_PATTERNS = {
    // Basic scales
    major: [0, 2, 4, 5, 7, 9, 11, 12],
    minor: [0, 2, 3, 5, 7, 8, 10, 12],           // Natural minor
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],

    // Pentatonic & Blues
    pentatonic: [0, 2, 4, 7, 9, 12],             // Major pentatonic
    minor_pentatonic: [0, 3, 5, 7, 10, 12],      // Minor pentatonic
    blues: [0, 3, 5, 6, 7, 10, 12],

    // Modes
    dorian: [0, 2, 3, 5, 7, 9, 10, 12],
    phrygian: [0, 1, 3, 5, 7, 8, 10, 12],
    lydian: [0, 2, 4, 6, 7, 9, 11, 12],
    mixolydian: [0, 2, 4, 5, 7, 9, 10, 12],
    locrian: [0, 1, 3, 5, 6, 8, 10, 12],

    // Harmonic scales
    harmonic_minor: [0, 2, 3, 5, 7, 8, 11, 12],
    harmonic_major: [0, 2, 4, 5, 7, 8, 11, 12],
    double_harmonic: [0, 1, 4, 5, 7, 8, 11, 12], // aka Byzantine, Arabic, Hungarian gypsy

    // Melodic minor
    melodic_minor: [0, 2, 3, 5, 7, 9, 11, 12],   // Jazz melodic minor (same up & down)

    // Exotic scales
    whole_tone: [0, 2, 4, 6, 8, 10, 12],
    diminished: [0, 2, 3, 5, 6, 8, 9, 11, 12],   // Half-whole diminished
    augmented: [0, 3, 4, 7, 8, 11, 12]
};

// Default octave for scales
const DEFAULT_OCTAVE = 4;

// Timing for scale playback
const NOTE_DURATION_MS = 400;
const NOTE_GAP_MS = 50;

//-------SCALES CONTROLLER-------
class ScalesController {
    constructor() {
        this.voiceCore = null;
        this.audio = new AudioCoordinator();  // Single authority for all audio
        this.settings = {
            noteLength: 5,    // index into noteLengthMap (1.5s default)
            gap: 3,           // index into gapMap (0s default)
            direction: 'ascending', // ascending, descending, both, down_and_up
            octave: DEFAULT_OCTAVE,
            repeatCount: 1,   // 1=once, 2=twice, Infinity=forever
            // Voice-first settings (also controllable via UI)
            scaleType: 'major',
            root: 'C',
            rangeExpansion: 0,  // 0-6: extra notes on each end for "wide scale"
            octaveSpan: 1       // 1 or 2: how many octaves to span
        };

        // Default settings for reset (and for voice commands which reset first)
        this.defaultSettings = {
            noteLength: 5,    // 1.5s by default
            gap: 3,           // 0s (no gap) by default
            direction: 'ascending',
            octave: DEFAULT_OCTAVE,
            repeatCount: 1,   // Once by default
            scaleType: 'major',
            root: 'C',
            rangeExpansion: 0,
            octaveSpan: 1
        };

        // Maps tempo/speed voice commands to noteLength indices (voice commands still work)
        this.tempoNameToIndex = {
            'very fast': 0,
            'fast': 1,
            'normal': 2,
            'slow': 3,
            'very slow': 4,
            'super slow': 5
        };
        this.tempoIndexToName = ['very fast', 'fast', 'normal', 'slow', 'very slow', 'super slow'];

        // Maps gap names to gap indices
        this.gapNameToIndex = {
            '-1s': 0,
            '-0.5s': 1,
            '-0.25s': 2,
            '0s': 3,
            '0.05s': 4,
            '0.1s': 5,
            '0.15s': 6,
            '0.3s': 7,
            '0.5s': 8,
            '1s': 9
        };
        this.gapIndexToName = ['-1s', '-0.5s', '-0.25s', '0s', '0.05s', '0.1s', '0.15s', '0.3s', '0.5s', '1s'];

        // Track last command for "repeat" / "again" functionality
        this.lastCommand = null;
        this.lastTranscript = null;

        // Command history for replay
        this.commandHistory = [];
        this.maxHistoryLength = 50;

        // Maps note length index to durations (ms)
        this.noteLengthMap = [150, 300, 500, 800, 1000, 1500, 2000, 3000, 5000];
        this.gapMap = [-1000, -500, -250, 0, 50, 100, 150, 300, 500, 1000];
        this.noteLengthLabels = ['0.15s', '0.3s', '0.5s', '0.8s', '1s', '1.5s', '2s', '3s', '5s'];
        this.gapLabels = ['-1s', '-0.5s', '-0.25s', '0s', '0.05s', '0.1s', '0.15s', '0.3s', '0.5s', '1s'];
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
        this.setupErrorHandling();
    }

    updateLoadingStatus(loaded, message = null) {
        const status = document.getElementById('status');
        if (status) {
            if (loaded) {
                status.textContent = 'Ready - say a command or tap the piano';
            } else if (message) {
                status.textContent = message;
            }
        }
    }

    setupVoiceCore() {
        this.voiceCore = new VoiceCommandCore({
            settings: {
                autoSubmitMode: true
            },
            onStatusChange: (msg) => console.log('Status:', msg),
            onError: (msg) => this.showError(msg)
        });

        // Register scale commands
        // Voice commands reset to defaults first, then apply modifiers from speech
        this.voiceCore.registerHandler({
            parse: (transcript) => this.parseScaleCommand(transcript),
            execute: async (command, transcript) => {
                // Reset to defaults before applying voice command (unless it's a control command)
                const controlCommands = ['stop', 'help', 'play'];
                if (!controlCommands.includes(command.type)) {
                    this.resetToDefaults();
                }
                await this.executeScaleCommand(command, transcript);
            }
        });

        this.voiceCore.init();
    }

    // Reset to defaults without updating status (used before voice commands)
    resetToDefaults() {
        this.settings = { ...this.defaultSettings };
        this.syncUIToSettings();
    }

    setupUI() {
        // Stop button (main)
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopPlayback());
        }

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
    }

    setupVoiceControls() {
        // Wait a bit for voices to load, then populate dropdown
        setTimeout(() => this.populateVoiceDropdown(), 100);
        // Also try again after a longer delay (Chrome loads voices async)
        setTimeout(() => this.populateVoiceDropdown(), 500);

        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) {
            voiceSelect.addEventListener('change', (e) => {
                this.voiceCore.setVoice(e.target.value || null);
            });
        }

        const voiceRate = document.getElementById('voiceRate');
        const voiceRateValue = document.getElementById('voiceRateValue');
        if (voiceRate) {
            voiceRate.addEventListener('input', (e) => {
                const rate = parseFloat(e.target.value);
                this.voiceCore.setVoiceRate(rate);
                if (voiceRateValue) voiceRateValue.textContent = rate + 'x';
            });
        }

        const voicePitch = document.getElementById('voicePitch');
        const voicePitchValue = document.getElementById('voicePitchValue');
        if (voicePitch) {
            voicePitch.addEventListener('input', (e) => {
                const pitch = parseFloat(e.target.value);
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
        document.querySelectorAll('[data-repeat]').forEach(btn => {
            const val = btn.dataset.repeat;
            const btnVal = val === 'Infinity' ? Infinity : parseInt(val);
            btn.classList.toggle('selected', btnVal === this.settings.repeatCount);
        });

        // Root note buttons
        document.querySelectorAll('[data-root]').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.root === this.settings.root);
        });

        // Scale type buttons
        document.querySelectorAll('[data-scale-type]').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.scaleType === this.settings.scaleType);
        });

        // Direction buttons
        document.querySelectorAll('[data-direction]').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.direction === this.settings.direction);
        });

        // Note length buttons
        document.querySelectorAll('[data-length]').forEach(btn => {
            btn.classList.toggle('selected', parseInt(btn.dataset.length) === this.settings.noteLength);
        });

        // Gap buttons
        const gapName = this.gapIndexToName[this.settings.gap] || 'small';
        document.querySelectorAll('[data-gap]').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.gap === gapName);
        });

        // Octave buttons
        document.querySelectorAll('[data-octave]').forEach(btn => {
            btn.classList.toggle('selected', parseInt(btn.dataset.octave) === this.settings.octave);
        });

        // Octave span buttons
        document.querySelectorAll('[data-octave-span]').forEach(btn => {
            const span = parseInt(btn.dataset.octaveSpan);
            btn.classList.toggle('selected', span === this.settings.octaveSpan);
        });

        // Range expansion buttons
        document.querySelectorAll('[data-range]').forEach(btn => {
            const range = parseInt(btn.dataset.range);
            btn.classList.toggle('selected', range === this.settings.rangeExpansion);
        });

        // Update piano scale preview
        this.updateScalePreview();
    }

    // Reset all settings to defaults
    resetSettings() {
        this.settings = { ...this.defaultSettings };
        this.syncUIToSettings();
        this.updatePianoKeyOctaves();
        this.voiceCore.updateStatus('Settings reset to defaults');
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
        if (s.octave !== d.octave) {
            parts.push(`oct ${s.octave}`);
        }
        if (s.noteLength !== d.noteLength) {
            parts.push(this.noteLengthLabels[s.noteLength]);
        }
        if (s.gap !== d.gap) {
            parts.push(`gap: ${this.gapLabels[s.gap]}`);
        }
        if (s.octaveSpan !== d.octaveSpan) {
            parts.push(s.octaveSpan === 2 ? '2 oct' : '1 oct');
        }
        if (s.rangeExpansion !== d.rangeExpansion) {
            parts.push(`wide +${s.rangeExpansion}`);
        }
        if (s.repeatCount !== d.repeatCount) {
            const repeatLabels = { 1: '', 2: 'x2', [Infinity]: 'loop' };
            const label = repeatLabels[s.repeatCount] || `x${s.repeatCount}`;
            if (label) parts.push(label);
        }

        return parts.join(' | ');
    }

    // Setup voice-first clickable UI elements (all bidirectional controls)
    setupVoiceFirstUI() {
        // Repeat buttons (at the top)
        document.querySelectorAll('[data-repeat]').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.repeat;
                this.settings.repeatCount = val === 'Infinity' ? Infinity : parseInt(val);
                this.syncUIToSettings();
            });
        });

        // Root note buttons
        document.querySelectorAll('[data-root]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.root = btn.dataset.root;
                this.syncUIToSettings();
            });
        });

        // Scale type buttons
        document.querySelectorAll('[data-scale-type]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.scaleType = btn.dataset.scaleType;
                this.syncUIToSettings();
            });
        });

        // Direction buttons
        document.querySelectorAll('[data-direction]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.direction = btn.dataset.direction;
                this.syncUIToSettings();
            });
        });

        // Note length buttons
        document.querySelectorAll('[data-length]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.noteLength = parseInt(btn.dataset.length);
                this.syncUIToSettings();
            });
        });

        // Gap buttons
        document.querySelectorAll('[data-gap]').forEach(btn => {
            btn.addEventListener('click', () => {
                const gapName = btn.dataset.gap;
                const index = this.gapNameToIndex[gapName];
                if (index !== undefined) {
                    this.settings.gap = index;
                    this.syncUIToSettings();
                }
            });
        });

        // Octave buttons
        document.querySelectorAll('[data-octave]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.octave = parseInt(btn.dataset.octave);
                this.syncUIToSettings();
                this.updatePianoKeyOctaves();
            });
        });

        // Octave span buttons
        document.querySelectorAll('[data-octave-span]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.octaveSpan = parseInt(btn.dataset.octaveSpan);
                this.syncUIToSettings();
            });
        });

        // Range expansion buttons
        document.querySelectorAll('[data-range]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.rangeExpansion = parseInt(btn.dataset.range);
                this.syncUIToSettings();
            });
        });

        // Reset button
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetSettings());
        }

        // Dismissable instruction (persists in localStorage)
        const instruction = document.getElementById('vfInstruction');
        const dismissBtn = document.getElementById('dismissInstruction');
        if (instruction && dismissBtn) {
            // Hide if previously dismissed
            if (localStorage.getItem('scales-instruction-dismissed') === 'true') {
                instruction.classList.add('hidden');
            }
            dismissBtn.addEventListener('click', () => {
                instruction.classList.add('hidden');
                localStorage.setItem('scales-instruction-dismissed', 'true');
            });
        }

        // Initial sync
        this.syncUIToSettings();
    }

    setupPianoKeys() {
        const pianoContainer = document.getElementById('pianoKeys');
        if (!pianoContainer) return;

        // Create almost 2 octaves of piano keys (C to C, 15 white keys)
        const whiteNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const blackKeyPositions = { 'C': true, 'D': true, 'F': true, 'G': true, 'A': true };

        // Build keys for octave and octave+1 (plus final C)
        const keysToCreate = [];
        for (let oct = 0; oct <= 1; oct++) {
            whiteNotes.forEach(note => {
                keysToCreate.push({ note, octaveOffset: oct });
            });
        }
        // Add one more C at the top
        keysToCreate.push({ note: 'C', octaveOffset: 2 });

        keysToCreate.forEach(({ note, octaveOffset }) => {
            const octave = this.settings.octave + octaveOffset;
            const key = document.createElement('div');
            key.className = 'piano-key white-key';
            key.dataset.note = `${note}${octave}`;
            key.dataset.baseNote = note;
            key.dataset.octaveOffset = octaveOffset;

            // Show note name (and octave marker for C notes)
            const label = note === 'C' ? `C${octave}` : note;
            key.innerHTML = `<span>${label}</span>`;

            key.addEventListener('click', async () => {
                await this.ensureAudioStarted();
                this.playNote(`${note}${octave}`);
            });
            pianoContainer.appendChild(key);

            // Add black key after certain white keys (but not after B or the final C)
            if (blackKeyPositions[note] && !(note === 'C' && octaveOffset === 2)) {
                const blackKey = document.createElement('div');
                blackKey.className = 'piano-key black-key';
                const sharpNote = `${note}#${octave}`;
                blackKey.dataset.note = sharpNote;
                blackKey.dataset.baseNote = `${note}#`;
                blackKey.dataset.octaveOffset = octaveOffset;
                blackKey.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.ensureAudioStarted();
                    this.playNote(sharpNote);
                });
                pianoContainer.appendChild(blackKey);
            }
        });
    }

    async ensureAudioStarted() {
        await this.audio.ensureStarted();
    }

    updatePianoKeyOctaves() {
        // Update all piano key data-note attributes to use current base octave
        document.querySelectorAll('.piano-key').forEach(key => {
            const baseNote = key.dataset.baseNote;
            const octaveOffset = parseInt(key.dataset.octaveOffset) || 0;
            const newOctave = this.settings.octave + octaveOffset;

            // Update the data-note attribute
            key.dataset.note = `${baseNote}${newOctave}`;

            // Update label for white keys (show octave number on C notes)
            if (key.classList.contains('white-key')) {
                const noteName = baseNote.replace('#', '');
                const label = noteName === 'C' ? `C${newOctave}` : noteName;
                const span = key.querySelector('span');
                if (span) span.textContent = label;
            }
        });

        // Update scale preview to reflect new octave
        this.updateScalePreview();
    }

    // Extract modifiers from transcript and return cleaned transcript + modifiers
    extractModifiers(transcript) {
        let text = transcript.toLowerCase().trim();
        const modifiers = {
            tempo: null,        // 'very slow', 'slow', 'normal', 'fast', 'very fast'
            gap: null,          // 'none', 'small', 'normal', 'large', 'very large'
            repeat: 1,          // number of times to repeat
            direction: null,    // 'ascending', 'descending', 'both'
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

    parseScaleCommand(transcript) {
        // First extract modifiers
        const { cleanedText, modifiers } = this.extractModifiers(transcript);
        const lower = cleanedText.toLowerCase().trim();
        const originalLower = transcript.toLowerCase().trim();

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

        // Direction commands (standalone)
        if (originalLower.match(/^(ascending|up|upward)$/)) {
            this.settings.direction = 'ascending';
            return { type: 'setting', setting: 'direction', value: 'ascending' };
        }
        if (originalLower.match(/^(descending|down|downward)$/)) {
            this.settings.direction = 'descending';
            return { type: 'setting', setting: 'direction', value: 'descending' };
        }

        // Tempo commands (standalone)
        if (originalLower.match(/^(slow|slower)$/)) {
            this.settings.tempo = 'slow';
            return { type: 'setting', setting: 'tempo', value: 'slow' };
        }
        if (originalLower.match(/^(fast|faster|quick)$/)) {
            this.settings.tempo = 'fast';
            return { type: 'setting', setting: 'tempo', value: 'fast' };
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

        return null;
    }

    async executeScaleCommand(command, transcript = null, skipHistory = false) {
        // Ensure Tone.js audio context is started (required after user interaction)
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }

        // Stop any currently playing sequence immediately
        this.stopPlayback();

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

            case 'note':
                this.voiceCore.updateStatus(`Playing ${command.note}${command.octave}`);
                this.playNote(`${command.note}${command.octave}`);
                this.lastCommand = command;
                break;

            case 'scale':
                // Update settings from voice command (voice-first bidirectional sync)
                this.settings.root = command.root;
                this.settings.scaleType = command.scaleType;
                if (command.modifiers.direction) this.settings.direction = command.modifiers.direction;
                if (command.modifiers.rangeExpansion !== null) this.settings.rangeExpansion = command.modifiers.rangeExpansion;
                if (command.modifiers.octaveSpan !== null) this.settings.octaveSpan = command.modifiers.octaveSpan;
                // Apply tempo modifier to noteLength
                if (command.modifiers.tempo) {
                    const tempoIndex = this.tempoNameToIndex[command.modifiers.tempo];
                    if (tempoIndex !== undefined) this.settings.noteLength = tempoIndex;
                }
                // Apply gap modifier
                if (command.modifiers.gap) {
                    const gapIndex = this.gapNameToIndex[command.modifiers.gap];
                    if (gapIndex !== undefined) this.settings.gap = gapIndex;
                }
                // Apply repeat modifier
                if (command.modifiers.repeat !== undefined && command.modifiers.repeat !== null) {
                    this.settings.repeatCount = command.modifiers.repeat;
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

            case 'tuning':
                this.voiceCore.updateStatus('Playing A440 tuning note');
                this.playNote('A4', '2n');
                this.lastCommand = command;
                break;

            case 'setting':
                this.voiceCore.updateStatus(`${command.setting} set to ${command.value}`);
                break;
        }
    }

    // Build a descriptive status message including modifiers
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
            parts.push('(loop)');
        } else if (mods.repeat > 1) {
            parts.push(`x${mods.repeat}`);
        }

        return `Playing ${parts.join(' ')}`;
    }

    // Get a speakable description of a command (for echo mode)
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
            parts.push('on repeat');
        } else if (mods.repeat > 1) {
            parts.push(mods.repeat === 2 ? 'twice' : `${mods.repeat} times`);
        }

        return parts.filter(p => p).join(' ');
    }

    // Convert note name to speakable form (C# -> C sharp)
    speakableNote(note) {
        if (!note) return '';
        return note
            .replace('#', ' sharp')
            .replace('b', ' flat');
    }

    // Get interval name for scale degree
    getIntervalName(semitones, scaleType) {
        // For chromatic, just show semitone number
        if (scaleType === 'chromatic') {
            if (semitones === 0) return 'root';
            if (semitones === 12) return 'octave';
            return `+${semitones}`;
        }

        // Scale degree names
        const degreeNames = {
            0: 'root',
            1: 'b2',
            2: '2nd',
            3: 'b3',
            4: '3rd',
            5: '4th',
            6: 'b5',
            7: '5th',
            8: 'b6',
            9: '6th',
            10: 'b7',
            11: '7th',
            12: 'octave'
        };

        return degreeNames[semitones] || `+${semitones}`;
    }

    // Get arpeggio interval name
    getArpeggioIntervalName(index, quality) {
        const names = quality === 'minor'
            ? ['root', 'b3', '5th', 'octave']
            : ['root', '3rd', '5th', 'octave'];
        return names[index] || `${index + 1}`;
    }

    // Format the status display for current note
    // Shows: "command set | current note [interval]"
    formatNoteStatus(note, index, context) {
        // Extract note name without octave for display
        const noteName = note.replace(/\d+$/, '');
        const octave = note.match(/\d+$/)?.[0] || '';

        // Get the command set prefix
        const commandSet = this.formatCurrentCommand();

        if (!context.type) {
            // No context, just show command set and note
            return `${commandSet} | ${noteName}${octave}`;
        }

        let intervalInfo = '';

        if (context.type === 'scale') {
            const pattern = context.pattern || [];
            // Handle direction changes - find the interval for this position
            if (context.intervals && context.intervals[index] !== undefined) {
                intervalInfo = this.getIntervalName(context.intervals[index], context.scaleType);
            } else if (pattern[index] !== undefined) {
                intervalInfo = this.getIntervalName(pattern[index], context.scaleType);
            }
        } else if (context.type === 'arpeggio') {
            if (context.intervals && context.intervals[index] !== undefined) {
                intervalInfo = this.getArpeggioIntervalName(context.intervals[index], context.quality);
            }
        } else if (context.type === 'interval') {
            intervalInfo = index === 0 ? 'root' : context.intervalName || '';
        }

        // Format: "C major | F#4 [5th]"
        if (intervalInfo) {
            return `${commandSet} | ${noteName}${octave} [${intervalInfo}]`;
        }
        return `${commandSet} | ${noteName}${octave}`;
    }

    playNote(note, duration = '8n') {
        this.audio.playNote(note, duration);
    }

    async playScale(root, scaleType, modifiers = {}) {
        const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        const rootIndex = NOTE_NAMES.indexOf(root);
        if (rootIndex === -1) return;

        // Determine octave span (1 or 2 octaves)
        const octaveSpan = modifiers.octaveSpan ?? this.settings.octaveSpan;

        // Build base pattern (potentially spanning 2 octaves)
        let fullPattern = [...pattern];
        if (octaveSpan === 2) {
            // Add second octave: shift all intervals up by 12 (except skip the duplicate octave note)
            const secondOctave = pattern.slice(1).map(i => i + 12);
            fullPattern = [...pattern, ...secondOctave];
        }

        // Determine range expansion
        const rangeExpansion = modifiers.rangeExpansion ?? this.settings.rangeExpansion;

        // Expand range if requested (add notes below and above)
        if (rangeExpansion > 0) {
            // Add notes below the root
            const belowNotes = [];
            for (let i = rangeExpansion; i >= 1; i--) {
                belowNotes.push(-i); // negative semitones = below root
            }
            // Add notes above the top
            const topInterval = fullPattern[fullPattern.length - 1];
            const aboveNotes = [];
            for (let i = 1; i <= rangeExpansion; i++) {
                aboveNotes.push(topInterval + i);
            }
            fullPattern = [...belowNotes, ...fullPattern, ...aboveNotes];
        }

        let notes = fullPattern.map(interval => {
            const noteIndex = ((rootIndex + interval) % 12 + 12) % 12; // Handle negative intervals
            const octaveOffset = Math.floor((rootIndex + interval) / 12);
            return `${NOTE_NAMES[noteIndex]}${this.settings.octave + octaveOffset}`;
        });

        // Track intervals for each note position
        let intervals = [...fullPattern];

        // Handle direction (from modifiers or settings)
        const direction = modifiers.direction || this.settings.direction;
        if (direction === 'descending') {
            notes = notes.reverse();
            intervals = intervals.reverse();
        } else if (direction === 'both') {
            // Up and down: ascending then descending
            const ascending = [...notes];
            const descending = [...notes].reverse().slice(1);
            notes = [...ascending, ...descending];
            const ascIntervals = [...intervals];
            const descIntervals = [...intervals].reverse().slice(1);
            intervals = [...ascIntervals, ...descIntervals];
        } else if (direction === 'down_and_up') {
            // Down and up: descending then ascending
            const descending = [...notes].reverse();
            const ascending = [...notes].slice(1);
            notes = [...descending, ...ascending];
            const descIntervals = [...intervals].reverse();
            const ascIntervals = [...intervals].slice(1);
            intervals = [...descIntervals, ...ascIntervals];
        }

        const context = {
            type: 'scale',
            root,
            scaleType,
            pattern,
            intervals
        };

        await this.playSequence(notes, modifiers, context);
    }

    async playArpeggio(root, quality, modifiers = {}) {
        const rootIndex = NOTE_NAMES.indexOf(root);
        if (rootIndex === -1) return;

        // Major: 0, 4, 7, 12 | Minor: 0, 3, 7, 12
        const arpIntervals = quality === 'minor' ? [0, 3, 7, 12] : [0, 4, 7, 12];

        let notes = arpIntervals.map(interval => {
            const noteIndex = (rootIndex + interval) % 12;
            const octaveOffset = Math.floor((rootIndex + interval) / 12);
            return `${NOTE_NAMES[noteIndex]}${this.settings.octave + octaveOffset}`;
        });

        // Track position indices for interval names (0=root, 1=3rd, 2=5th, 3=octave)
        let intervals = [0, 1, 2, 3];

        const direction = modifiers.direction || this.settings.direction;
        if (direction === 'descending') {
            notes = notes.reverse();
            intervals = intervals.reverse();
        } else if (direction === 'both') {
            // Up and down: ascending then descending
            const ascending = [...notes];
            const descending = [...notes].reverse().slice(1);
            notes = [...ascending, ...descending];
            const ascIntervals = [...intervals];
            const descIntervals = [...intervals].reverse().slice(1);
            intervals = [...ascIntervals, ...descIntervals];
        } else if (direction === 'down_and_up') {
            // Down and up: descending then ascending
            const descending = [...notes].reverse();
            const ascending = [...notes].slice(1);
            notes = [...descending, ...ascending];
            const descIntervals = [...intervals].reverse();
            const ascIntervals = [...intervals].slice(1);
            intervals = [...descIntervals, ...ascIntervals];
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
        const rootIndex = NOTE_NAMES.indexOf(root);
        if (rootIndex === -1) return;

        // Major: root, major third, perfect fifth | Minor: root, minor third, perfect fifth
        const intervals = quality === 'minor' ? [0, 3, 7] : [0, 4, 7];

        const notes = intervals.map(interval => {
            const noteIndex = (rootIndex + interval) % 12;
            return `${NOTE_NAMES[noteIndex]}${this.settings.octave}`;
        });

        const repeatCount = modifiers.repeat || 1;
        await this.audio.playChordRepeated(notes, {
            repeatCount,
            onStatus: (message) => this.voiceCore.updateStatus(message),
            gapMs: 2000
        });
    }

    async playInterval(root, interval, quality, modifiers = {}) {
        const rootIndex = NOTE_NAMES.indexOf(root);
        if (rootIndex === -1) return;

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
        const secondNoteIndex = (rootIndex + semitones) % 12;
        const octaveOffset = Math.floor((rootIndex + semitones) / 12);

        const note1 = `${root}${this.settings.octave}`;
        const note2 = `${NOTE_NAMES[secondNoteIndex]}${this.settings.octave + octaveOffset}`;

        // Format interval name for display
        const qualityPrefix = quality ? `${quality} ` : '';
        const intervalName = `${qualityPrefix}${interval}`;

        const context = {
            type: 'interval',
            root,
            interval,
            quality,
            intervalName
        };

        await this.playSequence([note1, note2], modifiers, context);
    }

    async playSequence(notes, modifiers = {}, context = {}) {
        this.clearScalePreview();  // Hide scale preview while playing

        // Repeat count from settings (voice command can override via modifiers)
        let repeatCount = modifiers.repeat ?? this.settings.repeatCount;
        const playTimes = repeatCount === 0 ? 1 : repeatCount;

        // For up+down or down+up with repeat, use seamless repeat (no gap, skip duplicate root)
        const direction = modifiers.direction || this.settings.direction;
        const isRoundTrip = direction === 'both' || direction === 'down_and_up';
        const seamlessRepeat = isRoundTrip && playTimes > 1;

        await this.audio.playSequence(notes, {
            getDuration: () => this.getNoteDuration(modifiers),
            onNote: (note, index) => {
                this.highlightPianoKey(note);
                const noteDisplay = this.formatNoteStatus(note, index, context);
                this.voiceCore.updateStatus(noteDisplay);
            },
            onStatus: (message) => {
                this.clearPianoHighlights();
                this.voiceCore.updateStatus(message);
            },
            repeatCount: playTimes,
            repeatGapMs: 1500,
            seamlessRepeat
        });

        this.clearPianoHighlights();
        this.voiceCore.updateStatus('Ready');
        this.updateScalePreview();
    }

    getNoteDuration(modifiers = {}) {
        // Note length: voice modifier overrides slider
        let ms;
        if (modifiers.tempo) {
            // Voice command specified tempo (matching noteLengthMap values)
            switch (modifiers.tempo) {
                case 'super slow': ms = 3000; break;
                case 'very slow': ms = 1500; break;
                case 'slow': ms = 800; break;
                case 'fast': ms = 300; break;
                case 'very fast': ms = 150; break;
                default: ms = 500; break;
            }
        } else {
            // Use slider value
            ms = this.noteLengthMap[this.settings.noteLength];
        }

        // Use explicit seconds for Tone.js - ensures note duration matches sleep time
        const tone = ms / 1000;

        // Gap: voice modifier overrides slider
        let gap;
        if (modifiers.gap) {
            switch (modifiers.gap) {
                case 'none': gap = 0; break;
                case 'small': gap = 50; break;
                case 'normal': gap = 150; break;
                case 'large': gap = 300; break;
                case 'very large': gap = 500; break;
                default: gap = this.gapMap[this.settings.gap]; break;
            }
        } else {
            // Use slider value
            gap = this.gapMap[this.settings.gap];
        }

        return { ms, tone, gap };
    }

    stopPlayback() {
        this.audio.stop();
        this.clearPianoHighlights();
        this.updateScalePreview();
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
                rangeExpansion: this.settings.rangeExpansion,
                octaveSpan: this.settings.octaveSpan,
                tempo: this.tempoIndexToName[this.settings.noteLength],
                gap: this.gapIndexToName[this.settings.gap]
            }
        };

        const transcript = `${this.settings.root} ${this.settings.scaleType} scale`;
        this.voiceCore.updateStatus(this.buildStatusMessage(command));
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
                const index = parseInt(e.currentTarget.dataset.index);
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

    // Format timestamp for display
    formatTime(date) {
        const now = new Date();
        const diffMs = now - date;
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

    highlightPianoKey(note) {
        this.clearPianoHighlights();

        // Exact match only - if the note isn't on the visible keyboard, nothing highlights
        const key = document.querySelector(`.piano-key[data-note="${note}"]`);
        if (key) {
            key.classList.add('active');
        }
    }

    clearPianoHighlights() {
        document.querySelectorAll('.piano-key.active').forEach(key => {
            key.classList.remove('active');
        });
    }

    // Clear scale preview highlights (separate from active playing highlight)
    clearScalePreview() {
        document.querySelectorAll('.piano-key.scale-root, .piano-key.scale-note').forEach(key => {
            key.classList.remove('scale-root', 'scale-note');
        });
    }

    // Update piano to show current scale preview (root + scale notes)
    // Only shows when not playing
    updateScalePreview() {
        this.clearScalePreview();

        // Don't show preview while playing
        if (this.audio.isPlaying) return;

        const root = this.settings.root;
        const scaleType = this.settings.scaleType;
        const baseOctave = this.settings.octave;

        const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        const rootIndex = NOTE_NAMES.indexOf(root);
        if (rootIndex === -1) return;

        // Get all semitones in the scale (within one octave, 0-11)
        const scaleIntervals = new Set(pattern.map(i => i % 12));

        // The exact root note (e.g., "C4" when octave is 4 and root is C)
        const exactRoot = `${root}${baseOctave}`;

        // Highlight each piano key based on whether it's part of the scale
        document.querySelectorAll('.piano-key').forEach(key => {
            const noteAttr = key.dataset.note;
            if (!noteAttr) return;

            // Parse note name and octave from data-note (e.g., "C4", "F#5")
            const match = noteAttr.match(/^([A-G]#?)(\d+)$/);
            if (!match) return;

            const noteName = match[1];

            // Get semitone position of this note
            const noteIndex = NOTE_NAMES.indexOf(noteName);
            if (noteIndex === -1) return;

            // Calculate interval from root (accounting for octave difference)
            const semitoneFromRoot = ((noteIndex - rootIndex) % 12 + 12) % 12;

            // Check if this note is part of the scale
            if (scaleIntervals.has(semitoneFromRoot)) {
                if (noteAttr === exactRoot) {
                    // This is THE root note at the selected octave
                    key.classList.add('scale-root');
                } else {
                    // This is another scale note (including octaves of root)
                    key.classList.add('scale-note');
                }
            }
        });
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

