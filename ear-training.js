// @ts-check
//-----------------------------------------------------------------------
// EAR TRAINING - Interval recognition and singing (Intervals page, ear mode)
// Uses practice-audio, settings-store, and pitch-detect-core.
//-----------------------------------------------------------------------

(function () {
    'use strict';

//-------INTERVAL DEFINITIONS-------

/** @type {Readonly<Record<string, { semitones: number, name: string, aliases: string[] }>>} */
const INTERVALS = Object.freeze({
    'm2': { semitones: 1, name: 'minor 2nd', aliases: ['minor second', 'half step', 'semitone', 'm2', 'minor 2', 'minor two'] },
    'M2': { semitones: 2, name: 'Major 2nd', aliases: ['major second', 'whole step', 'whole tone', 'M2', 'major 2', 'major two'] },
    'm3': { semitones: 3, name: 'minor 3rd', aliases: ['minor third', 'm3', 'minor 3', 'minor three'] },
    'M3': { semitones: 4, name: 'Major 3rd', aliases: ['major third', 'M3', 'major 3', 'major three'] },
    'P4': { semitones: 5, name: 'Perfect 4th', aliases: ['perfect fourth', 'fourth', 'P4', 'perfect 4', 'four'] },
    'TT': { semitones: 6, name: 'Tritone', aliases: ['tritone', 'augmented fourth', 'diminished fifth', 'TT', 'tri tone', 'flat five', 'sharp four'] },
    'P5': { semitones: 7, name: 'Perfect 5th', aliases: ['perfect fifth', 'fifth', 'P5', 'perfect 5', 'five'] },
    'm6': { semitones: 8, name: 'minor 6th', aliases: ['minor sixth', 'm6', 'minor 6', 'minor six'] },
    'M6': { semitones: 9, name: 'Major 6th', aliases: ['major sixth', 'M6', 'major 6', 'major six'] },
    'm7': { semitones: 10, name: 'minor 7th', aliases: ['minor seventh', 'm7', 'minor 7', 'minor seven', 'flat seven'] },
    'M7': { semitones: 11, name: 'Major 7th', aliases: ['major seventh', 'M7', 'major 7', 'major seven'] },
    'P8': { semitones: 12, name: 'Octave', aliases: ['octave', 'perfect octave', 'P8', 'eighth', 'eight'] }
});

/** @type {string[]} */
const INTERVAL_ORDER = ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];

/** @type {Readonly<Record<string, string[]>>} Preset interval sets */
const INTERVAL_PRESETS = Object.freeze({
    all: [...INTERVAL_ORDER],
    perfect: ['P4', 'P5', 'P8'],
    thirds: ['m3', 'M3', 'm6', 'M6'],
    seconds: ['m2', 'M2', 'm7', 'M7'],
    // 'weak' is computed dynamically
});

//-------EAR TRAINING CONTROLLER-------

class EarTrainingController {
    /**
     * @param {{
     *   settings: Record<string, any>,
     *   saveSettings: () => void,
     *   loadStats: () => Record<string, { correct: number, total: number }>,
     *   saveStats: (stats: Record<string, { correct: number, total: number }>) => void
     * }} options
     */
    constructor(options) {
        this.settingsRef = options.settings;
        this.saveSettings = options.saveSettings;
        this.loadStatsFromStore = options.loadStats;
        this.saveStatsToStore = options.saveStats;

        // Audio
        this.audio = new PracticeAudio.Coordinator();

        // Pitch detection (shared core). Echo cancellation helps filter
        // out the piano/drone coming from the speakers.
        this.micCapture = PitchDetectCore.createMicCapture({
            audioConstraints: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        /** @type {boolean} */
        this.isPitchDetecting = false;
        /** @type {number | null} */
        this.pitchAnimationId = null;

        /** @type {Set<string>} */
        this.enabledIntervals = new Set(INTERVAL_ORDER);

        // Current interval
        /** @type {string | null} */
        this.currentInterval = null;
        /** @type {'ascending' | 'descending' | 'harmonic' | null} */
        this.currentDirection = null;
        /** @type {number | null} */
        this.currentRootMidi = null;
        /** @type {boolean} */
        this.awaitingAnswer = false;
        /** @type {boolean} */
        this.answered = false;

        // Phase tracking for "both" mode
        /** @type {'idle' | 'identifying' | 'singing'} */
        this.phase = 'idle';

        // Sing mode
        /** @type {number | null} */
        this.targetMidi = null;
        /** @type {number} */
        this.singTolerance = 50; // cents
        /** @type {number} */
        this.singGoodSamples = 0; // consecutive good pitch samples
        /** @type {number} */
        this.singRequiredSamples = 25; // ~1.5 seconds at 60fps
        /** @type {boolean} */
        this.singCompleted = false;
        /** @type {number | null} */
        this.singTimeoutId = null;
        /** @type {number} */
        this.singMaxTime = 15000; // 15 seconds max to sing

        // Drone test mode
        /** @type {boolean} */
        this.droneActive = false;
        // Quieter than the piano so the sung voice stays detectable.
        this.droneSynth = PianoCore.createSineSynth({
            volume: -12,
            envelope: { attack: 0.1, decay: 0.1, sustain: 0.8, release: 0.5 }
        });
        /** @type {number} */
        this.droneNoteMidi = 60; // C4 - MIDI like every other pitch here
        /** @type {number | null} */
        this.droneTargetMidi = null;

        // Stats
        /** @type {Record<string, { correct: number, total: number }>} */
        this.stats = {};
        this.initStats();

        /** @type {number} */
        this.sessionCorrect = 0;
        /** @type {number} */
        this.sessionTotal = 0;
        /** @type {number} */
        this.streak = 0;

        // History (created in init once the DOM is ready)
        /** @type {ReturnType<typeof HistoryList.create> | null} */
        this.history = null;

        // Voice recognition
        /** @type {VoiceCommandCore | null} */
        this.voiceCore = null;

        // DOM elements
        /** @type {HTMLElement | null} */
        this.intervalPrompt = null;
        /** @type {HTMLElement | null} */
        this.intervalNotes = null;
        /** @type {HTMLElement | null} */
        this.intervalFeedback = null;

        this.stats = this.loadStatsFromStore();
        this.initStats();
    }

    get mode() { return this.settingsRef.mode; }
    set mode(v) { this.settingsRef.mode = v; }
    get direction() { return this.settingsRef.direction; }
    set direction(v) { this.settingsRef.direction = v; }
    get rootRangeMid() { return this.settingsRef.rootRangeMid; }
    set rootRangeMid(v) { this.settingsRef.rootRangeMid = v; }
    get adaptiveMode() { return this.settingsRef.adaptiveMode; }
    set adaptiveMode(v) { this.settingsRef.adaptiveMode = v; }
    get drivingMode() { return this.settingsRef.drivingMode; }
    set drivingMode(v) { this.settingsRef.drivingMode = v; }
    get autoAdvance() { return this.settingsRef.autoAdvance; }
    set autoAdvance(v) { this.settingsRef.autoAdvance = v; }

    initStats() {
        for (const interval of INTERVAL_ORDER) {
            if (!this.stats[interval]) {
                this.stats[interval] = { correct: 0, total: 0 };
            }
        }
    }

    saveStats() {
        this.saveStatsToStore(this.stats);
    }

    syncSettingsToUI() {
        this.setMode(this.mode);
        this.setDirection(this.direction);
        if (Array.isArray(this.settingsRef.enabledIntervals)) {
            this.enabledIntervals = new Set(this.settingsRef.enabledIntervals);
        }
        this.updateIntervalToggles();
        const adaptiveToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('adaptiveToggle'));
        if (adaptiveToggle) adaptiveToggle.checked = this.adaptiveMode;
        const drivingToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('drivingToggle'));
        if (drivingToggle) drivingToggle.checked = this.drivingMode;
        const autoAdvanceToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('autoAdvanceToggle'));
        if (autoAdvanceToggle) autoAdvanceToggle.checked = this.autoAdvance;
        this.updateRangeDisplay();
        this.syncSteppers();
    }

    persistSettings() {
        this.settingsRef.enabledIntervals = [...this.enabledIntervals];
        this.saveSettings();
    }

    async init() {
        // Cache DOM elements
        this.intervalPrompt = document.getElementById('intervalPrompt');
        this.intervalNotes = document.getElementById('intervalNotes');
        this.intervalFeedback = document.getElementById('intervalFeedback');

        // Initialize audio
        this.setStatus('Loading piano samples...');
        try {
            await this.audio.init();
            this.setStatus('Ready! Press Next to start.');
        } catch (err) {
            console.error('Error loading piano samples:', err);
            this.setStatus('Piano failed to load. Refresh to retry.');
        }

        // Initialize voice recognition
        this.initVoiceRecognition();

        // Bind UI events
        this.bindEvents();

        // Update UI
        this.updateStatsDisplay();
        this.updateBreakdownDisplay();
        this.updateRangeDisplay();

        // Settings loaded by intervals.js before init
        this.syncSettingsToUI();

        // Hardware media keys registered by intervals.js when ear mode is active.
        MediaSessionCore.primeOnUserGesture();
    }

    setStatus(message) {
        if (this.intervalPrompt) {
            this.intervalPrompt.innerHTML = message;
        }
    }

    initVoiceRecognition() {
        // @ts-ignore - VoiceCommandCore is loaded from voice-command-core.js
        if (typeof VoiceCommandCore === 'undefined') {
            console.warn('VoiceCommandCore not available');
            return;
        }

        // @ts-ignore
        this.voiceCore = new VoiceCommandCore({
            onListeningChange: (isListening) => this.handleListeningChange(isListening),
            onStatusChange: (msg) => {}, // We handle our own status
            fallbackHandler: async (transcript) => this.handleVoiceCommand(transcript),
        });

        this.voiceCore.init();
    }

    /**
     * @param {string} transcript
     */
    handleVoiceCommand(transcript) {
        const lower = transcript.toLowerCase().trim();

        // Control commands
        if (/^(next|go|start)$/i.test(lower)) {
            this.playNextInterval();
            return;
        }
        if (/^(repeat|again|replay)$/i.test(lower)) {
            this.repeatCurrentInterval();
            return;
        }
        if (/^(skip)$/i.test(lower)) {
            this.skipInterval();
            return;
        }
        if (/^(stop|pause)$/i.test(lower)) {
            this.voiceCore?.stopListening();
            return;
        }
        if (/^(stats|score|statistics)$/i.test(lower)) {
            this.speakStats();
            return;
        }

        // If awaiting answer, try to match interval
        if (this.awaitingAnswer && !this.answered) {
            const matchedInterval = this.matchIntervalFromTranscript(lower);
            if (matchedInterval) {
                this.submitAnswer(matchedInterval);
            } else {
                this.showFeedback(`Didn't recognize: "${transcript}"`, 'info');
            }
        }
    }

    /**
     * @param {boolean} isListening
     */
    handleListeningChange(isListening) {
        const listenBtn = document.getElementById('earListenBtn');
        if (listenBtn) {
            listenBtn.classList.toggle('listening', isListening);
            const textSpan = listenBtn.querySelector('.button-text');
            if (textSpan) {
                textSpan.textContent = isListening ? 'Stop' : 'Listen';
            }
        }
    }

    /**
     * Match transcript to interval name
     * @param {string} transcript
     * @returns {string | null}
     */
    matchIntervalFromTranscript(transcript) {
        const lower = transcript.toLowerCase();

        for (const [key, info] of Object.entries(INTERVALS)) {
            // Check exact key match
            if (lower === key.toLowerCase()) return key;

            // Check name match
            if (lower === info.name.toLowerCase()) return key;

            // Check aliases
            for (const alias of info.aliases) {
                if (lower === alias.toLowerCase()) return key;
                // Fuzzy match - contains the alias
                if (lower.includes(alias.toLowerCase())) return key;
            }
        }

        return null;
    }

    bindEvents() {
        // Listen button
        document.getElementById('earListenBtn')?.addEventListener('click', () => {
            if (this.voiceCore?.isListening) {
                this.voiceCore.stopListening();
            } else {
                this.voiceCore?.startListening();
            }
        });

        // Next button
        document.getElementById('earNextBtn')?.addEventListener('click', () => {
            this.playNextInterval();
        });

        // Repeat button
        document.getElementById('earRepeatBtn')?.addEventListener('click', () => {
            this.repeatCurrentInterval();
        });

        // Answer buttons
        document.querySelectorAll('.answer-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const interval = /** @type {HTMLElement} */ (e.currentTarget).dataset.interval;
                if (interval && this.awaitingAnswer && !this.answered) {
                    this.submitAnswer(interval);
                }
            });
        });

        // Mode selection
        document.querySelectorAll('[data-mode]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = /** @type {HTMLElement} */ (e.currentTarget).dataset.mode;
                if (mode) {
                    this.setMode(/** @type {'identify' | 'sing' | 'both'} */ (mode));
                }
            });
        });

        // Direction selection
        document.querySelectorAll('[data-direction]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const direction = /** @type {HTMLElement} */ (e.currentTarget).dataset.direction;
                if (direction) {
                    this.setDirection(/** @type {'ascending' | 'descending' | 'harmonic' | 'random'} */ (direction));
                }
            });
        });

        // Interval toggles (shared multi-select wiring)
        PracticeControls.wireMultiSelect('.interval-toggle', 'data-interval',
            interval => this.toggleInterval(interval));

        // Presets
        document.querySelectorAll('[data-preset]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const preset = /** @type {HTMLElement} */ (e.currentTarget).dataset.preset;
                if (preset) {
                    this.applyPreset(preset);
                }
            });
        });

        // Steppers (shared control): drone note and root range center
        PracticeControls.wireSteppers((key, delta) => {
            if (key === 'droneNote') {
                this.droneNoteMidi = Math.max(48, Math.min(72, this.droneNoteMidi + delta));
            } else if (key === 'rootRangeMid') {
                this.rootRangeMid = Math.max(36, Math.min(72, this.rootRangeMid + delta));
                this.updateRangeDisplay();
                this.persistSettings();
            } else {
                return;
            }
            this.syncSteppers();
        });
        this.syncSteppers();

        // Toggles (shared control wiring)
        PracticeControls.wireToggle('adaptiveToggle', this.adaptiveMode, checked => {
            this.adaptiveMode = checked;
            this.persistSettings();
        });
        PracticeControls.wireToggle('drivingToggle', this.drivingMode, checked => {
            this.drivingMode = checked;
            this.persistSettings();
        });
        PracticeControls.wireToggle('autoAdvanceToggle', this.autoAdvance, checked => {
            this.autoAdvance = checked;
            this.persistSettings();
        });

        // Reset stats
        document.getElementById('resetStatsBtn')?.addEventListener('click', () => {
            this.resetSessionStats();
        });

        // History list (shared component owns rendering and the clear button)
        this.history = HistoryList.create({
            listId: 'earHistoryList',
            clearBtnId: 'earClearHistoryBtn',
            emptyText: 'No attempts yet',
            max: 20,
            renderItem: entry => this.renderHistoryItem(entry)
        });


        // Sing mode controls
        document.getElementById('singRepeatBtn')?.addEventListener('click', () => {
            this.repeatCurrentInterval();
        });

        document.getElementById('singSkipBtn')?.addEventListener('click', () => {
            this.skipInterval();
        });

        // Drone test controls
        document.getElementById('droneStartBtn')?.addEventListener('click', () => {
            this.startDroneTest();
        });

        document.getElementById('droneStopBtn')?.addEventListener('click', () => {
            this.stopDroneTest();
        });
    }

    /**
     * @param {'identify' | 'sing' | 'both'} mode
     */
    setMode(mode) {
        this.mode = mode;
        document.querySelectorAll('[data-mode]').forEach(btn => {
            btn.classList.toggle('selected', /** @type {HTMLElement} */ (btn).dataset.mode === mode);
        });

        // Show/hide appropriate UI based on mode
        // In 'both' mode, we start with identify UI visible, sing hidden
        // The phase controls which is active during gameplay
        this.updateUIForPhase();

        this.persistSettings();
    }

    /**
     * Update UI visibility based on current mode and phase
     */
    updateUIForPhase() {
        const answerGrid = document.getElementById('answerGrid');
        const singTarget = document.getElementById('singTarget');

        if (this.mode === 'identify') {
            if (answerGrid) answerGrid.style.display = 'grid';
            if (singTarget) singTarget.style.display = 'none';
        } else if (this.mode === 'sing') {
            if (answerGrid) answerGrid.style.display = 'none';
            if (singTarget) singTarget.style.display = 'block';
        } else if (this.mode === 'both') {
            // In both mode, show based on current phase
            if (this.phase === 'identifying' || this.phase === 'idle') {
                if (answerGrid) answerGrid.style.display = 'grid';
                if (singTarget) singTarget.style.display = 'none';
            } else if (this.phase === 'singing') {
                if (answerGrid) answerGrid.style.display = 'none';
                if (singTarget) singTarget.style.display = 'block';
            }
        }
    }

    /**
     * @param {'ascending' | 'descending' | 'harmonic' | 'random'} direction
     */
    setDirection(direction) {
        this.direction = direction;
        document.querySelectorAll('[data-direction]').forEach(btn => {
            btn.classList.toggle('selected', /** @type {HTMLElement} */ (btn).dataset.direction === direction);
        });
        this.persistSettings();
    }

    /**
     * @param {string} interval
     */
    toggleInterval(interval) {
        if (this.enabledIntervals.has(interval)) {
            // Don't allow disabling all intervals
            if (this.enabledIntervals.size > 1) {
                this.enabledIntervals.delete(interval);
            }
        } else {
            this.enabledIntervals.add(interval);
        }
        this.updateIntervalToggles();
        this.persistSettings();
    }

    updateIntervalToggles() {
        PracticeControls.syncMultiSelect('.interval-toggle', 'data-interval',
            interval => this.enabledIntervals.has(interval));
    }

    /**
     * @param {string} preset
     */
    applyPreset(preset) {
        if (preset === 'weak') {
            // Get weakest intervals (below 70% accuracy with at least 3 attempts)
            const weak = INTERVAL_ORDER.filter(interval => {
                const stat = this.stats[interval];
                return stat.total >= 3 && (stat.correct / stat.total) < 0.7;
            });
            if (weak.length > 0) {
                this.enabledIntervals = new Set(weak);
            } else {
                // No weak intervals, use all
                this.enabledIntervals = new Set(INTERVAL_ORDER);
                this.showFeedback('No weak intervals yet - using all', 'info');
            }
        } else if (INTERVAL_PRESETS[preset]) {
            this.enabledIntervals = new Set(INTERVAL_PRESETS[preset]);
        }
        this.updateIntervalToggles();
        this.persistSettings();
    }

    updateRangeDisplay() {
        const minEl = document.getElementById('rangeMin');
        const maxEl = document.getElementById('rangeMax');
        if (minEl) minEl.textContent = midiToNoteName(this.rootRangeMid - 12).full;
        if (maxEl) maxEl.textContent = midiToNoteName(this.rootRangeMid + 12).full;
    }

    /**
     * Select a random interval based on enabled set and adaptive weighting
     * @returns {string}
     */
    selectInterval() {
        const enabled = [...this.enabledIntervals];

        if (!this.adaptiveMode) {
            return enabled[Math.floor(Math.random() * enabled.length)];
        }

        // Adaptive: weight toward weaker intervals
        const weights = enabled.map(interval => {
            const stat = this.stats[interval];
            if (stat.total === 0) return 1; // No data = neutral weight
            const accuracy = stat.correct / stat.total;
            // Lower accuracy = higher weight (inverse relationship)
            return Math.max(0.1, 1.5 - accuracy);
        });

        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let random = Math.random() * totalWeight;

        for (let i = 0; i < enabled.length; i++) {
            random -= weights[i];
            if (random <= 0) return enabled[i];
        }

        return enabled[enabled.length - 1];
    }

    /**
     * Get direction for current interval
     * @returns {'ascending' | 'descending' | 'harmonic'}
     */
    getDirection() {
        if (this.direction === 'random') {
            const options = /** @type {const} */ (['ascending', 'descending', 'harmonic']);
            return options[Math.floor(Math.random() * options.length)];
        }
        return this.direction;
    }

    /**
     * Select a random root note within range
     * @returns {number}
     */
    selectRootMidi() {
        const min = this.rootRangeMid - 12;
        const max = this.rootRangeMid + 12;
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    async playNextInterval() {
        await MediaSessionCore.activate();

        // Reset state
        this.awaitingAnswer = false;
        this.answered = false;
        this.phase = 'idle';
        this.singCompleted = false;
        this.singGoodSamples = 0;
        this.clearAnswerHighlights();
        this.stopPitchDetection();
        this.clearSingTimeout();

        // Select interval
        this.currentInterval = this.selectInterval();
        this.currentDirection = this.getDirection();
        this.currentRootMidi = this.selectRootMidi();

        const intervalInfo = INTERVALS[this.currentInterval];
        const semitones = intervalInfo.semitones;

        // Update display
        this.setStatus('Listen...');
        if (this.intervalNotes) this.intervalNotes.textContent = '';
        if (this.intervalFeedback) {
            this.intervalFeedback.textContent = '';
            this.intervalFeedback.className = 'interval-feedback';
        }

        // Play interval
        if (this.currentDirection === 'harmonic') {
            await this.audio.playHarmonicInterval(this.currentRootMidi, semitones);
        } else {
            await this.audio.playMelodicInterval(
                this.currentRootMidi,
                semitones,
                this.currentDirection
            );
        }

        // Show notes played (but not the interval name yet)
        const note1 = midiToNoteName(this.currentRootMidi).full;
        const note2dir = this.currentDirection === 'ascending' ? semitones : -semitones;
        const note2 = midiToNoteName(this.currentRootMidi + (this.currentDirection === 'harmonic' ? semitones : note2dir)).full;

        if (this.intervalNotes) {
            if (this.currentDirection === 'harmonic') {
                this.intervalNotes.textContent = `${note1} + ${note2}`;
            } else {
                this.intervalNotes.textContent = `${this.currentDirection === 'ascending' ? note1 : note2} → ${this.currentDirection === 'ascending' ? note2 : note1}`;
            }
        }

        // Start appropriate mode
        if (this.mode === 'identify') {
            this.phase = 'identifying';
            this.setStatus('What interval?');
            this.awaitingAnswer = true;
            this.updateUIForPhase();
        } else if (this.mode === 'sing') {
            this.phase = 'singing';
            this.updateUIForPhase();
            this.startSingMode();
        } else if (this.mode === 'both') {
            // In both mode, start with identification
            this.phase = 'identifying';
            this.setStatus('What interval?');
            this.awaitingAnswer = true;
            this.updateUIForPhase();
        }
    }

    async repeatCurrentInterval() {
        if (!this.currentInterval || !this.currentRootMidi || !this.currentDirection) {
            this.showFeedback('No interval to repeat', 'info');
            return;
        }

        const semitones = INTERVALS[this.currentInterval].semitones;

        // In sing phase, just replay the reference note
        if (this.phase === 'singing') {
            await this.audio.playNote(this.currentRootMidi);
            return;
        }

        // In identify phase, replay the full interval
        if (this.currentDirection === 'harmonic') {
            await this.audio.playHarmonicInterval(this.currentRootMidi, semitones);
        } else {
            await this.audio.playMelodicInterval(
                this.currentRootMidi,
                semitones,
                this.currentDirection
            );
        }
    }

    skipInterval() {
        // Handle skip during identify phase
        if (this.phase === 'identifying' && this.currentInterval) {
            this.recordResult(this.currentInterval, false, 'skipped');
            this.revealAnswer();
        }
        // Handle skip during sing phase
        if (this.phase === 'singing') {
            this.completeSingMode(false, 'skipped');
            return; // completeSingMode handles the advance
        }
        // Auto-advance after short delay
        setTimeout(() => this.playNextInterval(), 1500);
    }

    /**
     * @param {string} answer
     */
    submitAnswer(answer) {
        if (!this.awaitingAnswer || this.answered || !this.currentInterval) return;

        this.answered = true;
        this.awaitingAnswer = false;
        const correct = answer === this.currentInterval;

        // Visual feedback
        this.highlightAnswer(answer, correct);

        if (correct) {
            this.showFeedback('Correct!', 'correct');
            if (this.drivingMode) this.speak('Correct!');

            // In "both" mode, transition to sing phase after correct identification
            if (this.mode === 'both') {
                // Don't record result yet - wait for sing phase
                setTimeout(() => {
                    this.phase = 'singing';
                    this.updateUIForPhase();
                    this.showFeedback('Now sing it!', 'info');
                    if (this.drivingMode) this.speak('Now sing it!');
                    this.startSingMode();
                }, 1200);
                return;
            }

            // For identify-only mode, record result and maybe advance
            this.recordResult(this.currentInterval, correct, answer);
            if (this.autoAdvance) {
                setTimeout(() => this.playNextInterval(), 1000);
            }
        } else {
            const correctName = INTERVALS[this.currentInterval].name;
            this.showFeedback(`That was ${correctName}`, 'incorrect');
            if (this.drivingMode) this.speak(`That was ${correctName}`);
            this.revealAnswer();

            // Record incorrect result
            this.recordResult(this.currentInterval, correct, answer);

            // In "both" mode with wrong answer, still go to sing phase but it won't count as fully correct
            if (this.mode === 'both') {
                setTimeout(() => {
                    this.phase = 'singing';
                    this.updateUIForPhase();
                    this.showFeedback('Try singing it anyway', 'info');
                    if (this.drivingMode) this.speak('Try singing it anyway');
                    this.startSingMode();
                }, 2000);
                return;
            }

            if (this.autoAdvance) {
                setTimeout(() => this.playNextInterval(), 2500);
            }
        }
    }

    /**
     * @param {string} interval
     * @param {boolean} correct
     * @param {string} [answer]
     */
    recordResult(interval, correct, answer) {
        // Update per-interval stats
        this.stats[interval].total++;
        if (correct) this.stats[interval].correct++;
        this.saveStats();

        // Update session stats
        this.sessionTotal++;
        if (correct) {
            this.sessionCorrect++;
            this.streak++;
        } else {
            this.streak = 0;
        }

        // Add to history
        if (this.history) {
            this.history.add({
                interval,
                direction: this.currentDirection || 'unknown',
                correct,
                answer
            });
        }

        // Update displays
        this.updateStatsDisplay();
        this.updateBreakdownDisplay();
    }

    /**
     * @param {string} answer
     * @param {boolean} correct
     */
    highlightAnswer(answer, correct) {
        document.querySelectorAll('.answer-btn').forEach(btn => {
            const interval = /** @type {HTMLElement} */ (btn).dataset.interval;
            if (interval === answer) {
                btn.classList.add(correct ? 'correct' : 'incorrect');
            }
            btn.classList.add('disabled');
        });
    }

    revealAnswer() {
        if (!this.currentInterval) return;
        document.querySelectorAll('.answer-btn').forEach(btn => {
            const interval = /** @type {HTMLElement} */ (btn).dataset.interval;
            if (interval === this.currentInterval) {
                btn.classList.add('revealed');
            }
        });
    }

    clearAnswerHighlights() {
        document.querySelectorAll('.answer-btn').forEach(btn => {
            btn.classList.remove('correct', 'incorrect', 'revealed', 'disabled');
        });
    }

    /**
     * @param {string} message
     * @param {'correct' | 'incorrect' | 'info'} type
     */
    showFeedback(message, type) {
        if (this.intervalFeedback) {
            this.intervalFeedback.textContent = message;
            this.intervalFeedback.className = `interval-feedback ${type}`;
        }
    }

    updateStatsDisplay() {
        const correctEl = document.getElementById('statCorrect');
        const totalEl = document.getElementById('statTotal');
        const percentEl = document.getElementById('statPercent');
        const streakEl = document.getElementById('statStreak');

        if (correctEl) correctEl.textContent = String(this.sessionCorrect);
        if (totalEl) totalEl.textContent = String(this.sessionTotal);
        if (percentEl) {
            const pct = this.sessionTotal > 0 ? Math.round(100 * this.sessionCorrect / this.sessionTotal) : 0;
            percentEl.textContent = this.sessionTotal > 0 ? `${pct}%` : '--%';
        }
        if (streakEl) streakEl.textContent = String(this.streak);
    }

    updateBreakdownDisplay() {
        const container = document.getElementById('statsBreakdown');
        if (!container) return;

        container.innerHTML = INTERVAL_ORDER.map(interval => {
            const stat = this.stats[interval];
            const pct = stat.total > 0 ? Math.round(100 * stat.correct / stat.total) : null;
            const cls = pct !== null ? (pct >= 80 ? 'strong' : pct < 60 ? 'weak' : '') : '';

            return `
                <div class="breakdown-item ${cls}">
                    <span class="breakdown-interval">${interval}</span>
                    <span class="breakdown-percent">${pct !== null ? `${pct}%` : '--'}</span>
                </div>
            `;
        }).join('');
    }

    /** @param {{ interval: string, direction: string, correct: boolean }} entry */
    renderHistoryItem(entry) {
        const icon = entry.correct ? '✓' : '✗';
        const dir = entry.direction === 'ascending' ? '↑' :
                   entry.direction === 'descending' ? '↓' : '⇅';
        const item = document.createElement('div');
        item.className = `history-item ${entry.correct ? 'correct' : 'incorrect'}`;
        item.innerHTML = `<span class="history-icon">${icon}</span><span>${entry.interval} ${dir}</span>`;
        return item;
    }

    resetSessionStats() {
        this.sessionCorrect = 0;
        this.sessionTotal = 0;
        this.streak = 0;
        this.updateStatsDisplay();
    }


    speakStats() {
        const pct = this.sessionTotal > 0 ? Math.round(100 * this.sessionCorrect / this.sessionTotal) : 0;
        const msg = `You've done ${this.sessionTotal} intervals, ${pct}% correct. Current streak: ${this.streak}.`;
        this.speak(msg);
    }

    /**
     * @param {string} text
     */
    speak(text) {
        VoiceOutput.speak(text);
    }

    //-------SING MODE-------

    clearSingTimeout() {
        if (this.singTimeoutId) {
            clearTimeout(this.singTimeoutId);
            this.singTimeoutId = null;
        }
    }

    async startSingMode() {
        if (!this.currentInterval || !this.currentRootMidi) return;

        // Reset sing state
        this.singCompleted = false;
        this.singGoodSamples = 0;
        this.clearSingTimeout();

        const semitones = INTERVALS[this.currentInterval].semitones;
        const direction = this.currentDirection === 'descending' ? 'below' : 'above';
        const intervalName = INTERVALS[this.currentInterval].name;

        // Calculate target note
        const targetOffset = this.currentDirection === 'descending' ? -semitones : semitones;
        this.targetMidi = this.currentRootMidi + targetOffset;

        // Show prompt
        const singPrompt = document.getElementById('singPrompt');
        if (singPrompt) {
            singPrompt.innerHTML = `Sing a <strong>${intervalName}</strong> ${direction}`;
        }

        const pitchTarget = document.getElementById('pitchTarget');
        if (pitchTarget) {
            pitchTarget.textContent = `Target: ${midiToNoteName(this.targetMidi).full}`;
        }

        const pitchAccuracy = document.getElementById('pitchAccuracy');
        if (pitchAccuracy) {
            pitchAccuracy.textContent = '';
            pitchAccuracy.className = 'pitch-accuracy';
        }

        this.setStatus('Sing the interval...');

        // Play reference note
        await this.audio.playNote(this.currentRootMidi);

        // Start pitch detection
        this.startPitchDetection();

        // Set timeout for sing mode
        this.singTimeoutId = setTimeout(() => {
            if (!this.singCompleted && this.phase === 'singing') {
                this.completeSingMode(false, 'timeout');
            }
        }, this.singMaxTime);
    }

    async startPitchDetection() {
        if (this.isPitchDetecting) return;

        const ok = await this.micCapture.start();
        if (!ok) {
            this.showFeedback('Microphone access required for sing mode', 'info');
            return;
        }
        this.isPitchDetecting = true;
        this.detectPitchLoop();
    }

    stopPitchDetection() {
        this.isPitchDetecting = false;
        if (this.pitchAnimationId) {
            cancelAnimationFrame(this.pitchAnimationId);
            this.pitchAnimationId = null;
        }
        this.micCapture.stop();
    }

    /**
     * Complete sing mode with success or failure
     * @param {boolean} success
     * @param {string} [reason]
     */
    completeSingMode(success, reason) {
        if (this.singCompleted) return;
        this.singCompleted = true;

        this.clearSingTimeout();
        this.stopPitchDetection();

        if (success) {
            this.showFeedback('Sung correctly', 'correct');
            if (this.drivingMode) this.speak('Sung correctly');

            // In sing-only mode, record as correct
            if (this.mode === 'sing' && this.currentInterval) {
                this.recordResult(this.currentInterval, true, 'sung');
            }
            // In both mode, the identify result was already handled
            // We could track sing accuracy separately in the future
        } else {
            const msg = reason === 'timeout' ? 'Time\'s up' : 'Not matched';
            this.showFeedback(msg, 'incorrect');
            if (this.drivingMode) this.speak(msg);

            // In sing-only mode, record as incorrect
            if (this.mode === 'sing' && this.currentInterval) {
                this.recordResult(this.currentInterval, false, reason || 'failed');
            }
        }

        // Auto-advance after sing mode completes
        if (this.autoAdvance) {
            setTimeout(() => this.playNextInterval(), success ? 1500 : 2500);
        }
    }

    detectPitchLoop() {
        if (!this.isPitchDetecting || !this.micCapture.running) return;
        if (this.singCompleted) return;

        const info = this.micCapture.readPitch();

        if (info) {
            const pitchCurrent = document.getElementById('pitchCurrent');
            if (pitchCurrent) {
                pitchCurrent.textContent = info.note;
            }

            // Check accuracy against target
            if (this.targetMidi !== null) {
                const cents = Math.round((info.midi - this.targetMidi) * 100);
                const pitchAccuracy = document.getElementById('pitchAccuracy');
                const isGood = Math.abs(cents) <= this.singTolerance;

                if (pitchAccuracy) {
                    if (isGood) {
                        // Show progress toward success
                        const progress = Math.min(100, Math.round(100 * this.singGoodSamples / this.singRequiredSamples));
                        pitchAccuracy.textContent = progress < 100 ? `Good! Hold it... ${progress}%` : 'Perfect!';
                        pitchAccuracy.className = 'pitch-accuracy good';
                    } else if (Math.abs(cents) <= this.singTolerance * 2) {
                        pitchAccuracy.textContent = cents > 0 ? 'A bit sharp' : 'A bit flat';
                        pitchAccuracy.className = 'pitch-accuracy close';
                    } else {
                        pitchAccuracy.textContent = cents > 0 ? 'Too high' : 'Too low';
                        pitchAccuracy.className = 'pitch-accuracy off';
                    }
                }

                // Track consecutive good samples for success detection
                if (isGood) {
                    this.singGoodSamples++;
                    if (this.singGoodSamples >= this.singRequiredSamples) {
                        this.completeSingMode(true);
                        return;
                    }
                } else {
                    // Reset if pitch goes off - require sustained correct pitch
                    // Use a decay instead of hard reset for better UX
                    this.singGoodSamples = Math.max(0, this.singGoodSamples - 2);
                }

                // Draw pitch meter
                this.drawPitchMeter(cents);
            }
        } else {
            const pitchCurrent = document.getElementById('pitchCurrent');
            if (pitchCurrent) pitchCurrent.textContent = '--';
            // Slowly decay good samples when no pitch detected
            this.singGoodSamples = Math.max(0, this.singGoodSamples - 1);
        }

        this.pitchAnimationId = requestAnimationFrame(() => this.detectPitchLoop());
    }

    /**
     * @param {number} cents
     */
    drawPitchMeter(cents) {
        const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('pitchMeter'));
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // Center line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();

        // Tolerance zone
        const toleranceWidth = (this.singTolerance / 100) * width;
        ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
        ctx.fillRect(width / 2 - toleranceWidth, 0, toleranceWidth * 2, height);

        // Current pitch indicator
        const clampedCents = Math.max(-100, Math.min(100, cents));
        const x = width / 2 + (clampedCents / 100) * (width / 2);

        const color = Math.abs(cents) <= this.singTolerance ? '#4ade80' :
                     Math.abs(cents) <= this.singTolerance * 2 ? '#fbbf24' : '#f87171';

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, height / 2, 8, 0, Math.PI * 2);
        ctx.fill();
    }

    //-------DRONE TEST MODE-------

    syncSteppers() {
        PracticeControls.setValueText('droneNoteValue', midiToPitchString(this.droneNoteMidi));
        PracticeControls.setValueText('rootRangeMidValue', midiToPitchString(this.rootRangeMid));
        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'droneNote') {
                return delta < 0 ? this.droneNoteMidi <= 48 : this.droneNoteMidi >= 72;
            }
            if (key === 'rootRangeMid') {
                return delta < 0 ? this.rootRangeMid <= 36 : this.rootRangeMid >= 72;
            }
            return false;
        });
    }

    async startDroneTest() {
        if (this.droneActive) return;

        this.droneTargetMidi = this.droneNoteMidi;

        // Show UI
        const startBtn = document.getElementById('droneStartBtn');
        const stopBtn = document.getElementById('droneStopBtn');
        const display = document.getElementById('droneDisplay');
        const targetEl = document.getElementById('droneTargetNote');

        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-block';
        if (display) display.style.display = 'block';
        if (targetEl) targetEl.textContent = midiToPitchString(this.droneNoteMidi);

        await PianoCore.ensureStarted();

        // Start drone
        this.droneActive = true;
        if (this.droneTargetMidi !== null) this.droneSynth.startMidi(this.droneTargetMidi);

        // Start pitch detection with echo cancellation
        await this.startDronePitchDetection();
    }

    stopDroneTest() {
        if (!this.droneActive) return;

        this.droneActive = false;
        this.droneSynth.stopAll();

        // Stop pitch detection
        this.stopPitchDetection();

        // Update UI
        const startBtn = document.getElementById('droneStartBtn');
        const stopBtn = document.getElementById('droneStopBtn');
        const display = document.getElementById('droneDisplay');

        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';
        if (display) display.style.display = 'none';
    }

    async startDronePitchDetection() {
        if (this.isPitchDetecting) return;

        const ok = await this.micCapture.start();
        if (!ok) {
            this.stopDroneTest();
            return;
        }
        this.isPitchDetecting = true;
        this.dronePitchLoop();
    }

    dronePitchLoop() {
        if (!this.isPitchDetecting || !this.droneActive || !this.micCapture.running) return;

        const info = this.micCapture.readPitch();

        const currentEl = document.getElementById('dronePitchCurrent');
        const centsEl = document.getElementById('droneCents');

        if (info && this.droneTargetMidi !== null) {
            const cents = Math.round((info.midi - this.droneTargetMidi) * 100);

            if (currentEl) currentEl.textContent = info.note;

            if (centsEl) {
                if (Math.abs(cents) <= 15) {
                    centsEl.textContent = 'Perfect!';
                    centsEl.className = 'drone-cents good';
                } else if (Math.abs(cents) <= 30) {
                    centsEl.textContent = cents > 0 ? `+${cents} cents (slightly sharp)` : `${cents} cents (slightly flat)`;
                    centsEl.className = 'drone-cents close';
                } else if (Math.abs(cents) <= 100) {
                    centsEl.textContent = cents > 0 ? `+${cents} cents (sharp)` : `${cents} cents (flat)`;
                    centsEl.className = 'drone-cents off';
                } else {
                    centsEl.textContent = cents > 0 ? 'Way too high' : 'Way too low';
                    centsEl.className = 'drone-cents off';
                }
            }

            this.drawDroneMeter(cents);
        } else {
            if (currentEl) currentEl.textContent = '--';
            if (centsEl) {
                centsEl.textContent = 'Sing!';
                centsEl.className = 'drone-cents';
            }
        }

        this.pitchAnimationId = requestAnimationFrame(() => this.dronePitchLoop());
    }

    /**
     * @param {number} cents
     */
    drawDroneMeter(cents) {
        const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('droneMeter'));
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // Center line (target)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();

        // Good zone
        const goodZone = (15 / 100) * (width / 2);
        ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
        ctx.fillRect(width / 2 - goodZone, 0, goodZone * 2, height);

        // Current pitch indicator
        const clampedCents = Math.max(-100, Math.min(100, cents));
        const x = width / 2 + (clampedCents / 100) * (width / 2);

        const color = Math.abs(cents) <= 15 ? '#4ade80' :
                     Math.abs(cents) <= 30 ? '#fbbf24' : '#f87171';

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, height / 2, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

//-------EXPORT-------

    window.EarTraining = {
        /** @param {ConstructorParameters<typeof EarTrainingController>[0]} options */
        create(options) {
            return new EarTrainingController(options);
        }
    };
})();
