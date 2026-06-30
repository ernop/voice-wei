// @ts-check
//-----------------------------------------------------------------------
// PITCH METER - Real-time pitch detection with practice modes
// Consumes pitch-detect-core (mic + detection + glitch filtering),
// piano-core (Salamander piano), and settings-store.
//
// Requires: music-constants.js (NOTE_NAMES, SCALE_PATTERNS, utility functions)
//-----------------------------------------------------------------------

//-------INSTRUMENT PRESETS-------
/** @type {Readonly<Record<string, { octave: number, label: string }>>} */
const INSTRUMENT_PRESETS = Object.freeze({
    voice: { octave: 4, label: 'Voice' },
    violin: { octave: 4, label: 'Violin' },
    bass: { octave: 2, label: 'Bass' }
});

//-------PITCH METER CONTROLLER-------

/**
 * @typedef {{ midi: number, freq: number, name: string, noteName: string, octave: number }} TargetNote
 * @typedef {{ time: number, freq: number, midi: number, note: string, cents: number, targetNote?: string }} PitchSample
 * @typedef {{ matched: boolean, accuracy: number, avgCents?: number, biasCents?: number, reason?: string, targetNote?: string, samples?: number, label?: string, midi?: number }} NoteResult
 */

class PitchMeterController {
    static STORAGE_KEY = StorageKeys.PITCH_METER_SETTINGS;
    static PERSISTED_KEYS = ['mode', 'responseTime', 'instrument', 'rootNote', 'scaleType', 'octave'];
    static RESPONSE_TIME_VALUES = [1, 2, 3, 4, 5];

    constructor() {
        /** @type {boolean} */
        this.isListening = false;

        // Mic capture + glitch-filtered recording (shared core)
        this.session = PitchDetectCore.createTraceSession({
            pauseOnSilence: () => false,
            onAccepted: (sample) => this.onPitchAccepted(sample),
            onSilence: () => this.clearPitchDisplay()
        });
        // While set, accepted samples are tagged and collected for scoring.
        /** @type {PitchSample[] | null} */
        this.captureSamples = null;
        /** @type {string | null} */
        this.captureTargetName = null;

        // Piano (shared core)
        /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
        this.piano = null;
        /** @type {boolean} */
        this.samplerLoaded = false;
        /** @type {boolean} */
        this.isPlayingScale = false;

        // Practice mode
        /** @type {'free' | 'call-response' | 'play-along'} */
        this.mode = 'call-response';
        /** @type {number} */
        this.responseTime = 2;

        // Current scale config
        /** @type {string} */
        this.instrument = 'voice';
        /** @type {string} */
        this.rootNote = 'C';
        /** @type {string} */
        this.scaleType = 'major';
        /** @type {number} */
        this.octave = 4;
        /** @type {TargetNote[]} */
        this.targetNotes = [];

        // Call & Response tracking
        /** @type {number} */
        this.currentNoteIndex = 0;
        /** @type {number} */
        this.noteStartTime = 0;
        /** @type {NoteResult[]} */
        this.noteResults = [];
        /** @type {boolean} */
        this.sessionAborted = false;
        /** @type {boolean} One progress entry per session */
        this.sessionRecorded = false;

        // Canvas handled by pitch-trace-view.js
        /** @type {ReturnType<typeof PitchTraceView.create>} */
        this.traceView = null;

        // DOM elements
        /** @type {HTMLElement | null} */
        this.statusEl = null;
        /** @type {HTMLElement | null} */
        this.currentNoteEl = null;
        /** @type {HTMLElement | null} */
        this.currentCentsEl = null;
        /** @type {HTMLElement | null} */
        this.currentFreqEl = null;
        /** @type {HTMLElement | null} */
        this.centsMarkerEl = null;
        this.chartGate = new RateGate(50);
        this.pitchDisplayGate = new RateGate(50);
        this.pitchDisplayDiff = new ValueDiff();

        this.traceView = PitchTraceView.create({
            canvasId: 'pitchChart',
            defaultHeightPx: 300,
            rails: () => this.targetNotes.map(note => ({
                midi: note.midi,
                label: note.name,
                emphasized: true
            })),
            targets: () => [],
            history: () => this.session.history,
            clockMs: () => this.session.clockMs(),
            windowMs: () => {
                const history = this.session.history;
                if (history.length < 2) return 5000;
                return Math.max(history[history.length - 1].time, 5000);
            },
            fixedWindow: () => false,
            showPlayhead: () => this.isListening
        });

        this.init();
    }

    async init() {
        // Get DOM elements
        this.statusEl = document.getElementById('status');
        this.currentNoteEl = document.getElementById('currentNote');
        this.currentCentsEl = document.getElementById('currentCents');
        this.currentFreqEl = document.getElementById('currentFreq');
        this.centsMarkerEl = document.getElementById('centsMarker');

        this.traceView.resize();
        window.addEventListener('resize', () => this.traceView.resize());

        // Set up controls
        const listenBtn = document.getElementById('listenBtn');
        const stopBtn = document.getElementById('stopBtn');
        const playRefBtn = document.getElementById('playRefBtn');

        if (listenBtn) listenBtn.addEventListener('click', () => this.toggleListening());
        if (stopBtn) stopBtn.addEventListener('click', () => this.stopSession());
        if (playRefBtn) playRefBtn.addEventListener('click', () => this.playReferenceScale());

        SettingsStore.load(PitchMeterController.STORAGE_KEY, this, PitchMeterController.PERSISTED_KEYS);

        PracticeControls.wireSingleSelect('data-mode', String, this.mode, value => {
            this.mode = /** @type {'free' | 'call-response' | 'play-along'} */ (value);
            this.saveSettings();
            this.updateModeUI();
        });
        PracticeControls.wireSingleSelect('data-instrument', String, this.instrument, value => {
            this.instrument = value;
            this.saveSettings();
            this.applyInstrumentPreset();
        });
        PracticeControls.wireSingleSelect('data-scale', String, this.scaleType, value => {
            this.scaleType = value;
            this.saveSettings();
            this.updateTargetNotes();
        });
        PracticeControls.wireSteppers((key, delta) => this.stepSetting(key, delta));
        this.syncControls();

        await this.initPiano();

        this.updateTargetNotes();
        this.updateModeUI();
        this.traceView.draw();
    }

    saveSettings() {
        SettingsStore.save(PitchMeterController.STORAGE_KEY, this, PitchMeterController.PERSISTED_KEYS);
    }

    /** @param {string} key @param {number} delta */
    stepSetting(key, delta) {
        if (key === 'responseTime') {
            const next = PracticeControls.stepValue(PitchMeterController.RESPONSE_TIME_VALUES, this.responseTime, delta);
            if (next === null) return;
            this.responseTime = next;
        } else if (key === 'rootPitch') {
            const midi = noteNameToMidi(this.rootNote, this.octave);
            if (midi === null) return;
            const bounded = PracticeControls.stepRootMidi(midi, delta);
            const info = midiToNoteName(bounded);
            this.rootNote = info.name;
            this.octave = info.octave;
            this.updateTargetNotes();
        } else {
            return;
        }
        this.saveSettings();
        this.syncControls();
    }

    syncControls() {
        PracticeControls.syncSingleSelect('data-mode', this.mode);
        PracticeControls.syncSingleSelect('data-instrument', this.instrument);
        PracticeControls.syncSingleSelect('data-scale', this.scaleType);
        PracticeControls.setValueText('rootPitchValue', scaleRootPitchString(this.rootNote, this.octave));
        PracticeControls.setValueText('responseTimeValue', `${this.responseTime}s`);
        PracticeControls.syncStepperDisabled((key, delta) => {
            if (key === 'responseTime') {
                return PracticeControls.stepDisabled(PitchMeterController.RESPONSE_TIME_VALUES, this.responseTime, delta);
            }
            return PracticeControls.rootStepDisabled(noteNameToMidi(this.rootNote, this.octave), delta);
        });
    }

    async initPiano() {
        this.updateStatus('Loading piano...');
        try {
            this.piano = await PianoCore.createPiano();
            this.samplerLoaded = true;
            this.enableButtons();
            this.updateStatus('Choose a mode and click Start');
        } catch (err) {
            console.error('Error loading piano samples:', err);
            this.updateStatus('Failed to load piano. Refresh to retry.');
        }
    }

    enableButtons() {
        const listenBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('listenBtn'));
        const playRefBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('playRefBtn'));
        if (listenBtn) listenBtn.disabled = false;
        if (playRefBtn) playRefBtn.disabled = false;
    }

    updateModeUI() {
        const responseTimeGroup = document.getElementById('responseTimeGroup');
        const listenBtn = document.getElementById('listenBtn');
        const btnText = listenBtn.querySelector('.button-text');

        // Show/hide response time selector based on mode
        responseTimeGroup.style.display = this.mode === 'call-response' ? 'flex' : 'none';

        // Update button text based on mode
        if (this.mode === 'free') {
            btnText.textContent = 'Start Listening';
            this.updateStatus('Free Practice: Sing any notes and see your pitch');
        } else if (this.mode === 'call-response') {
            btnText.textContent = 'Start';
            this.updateStatus('Call & Response: Piano plays a note, you match it');
        } else if (this.mode === 'play-along') {
            btnText.textContent = 'Start';
            this.updateStatus('Play Along: Sing with the piano as it plays the scale');
        }
    }

    resizeCanvas() {
        this.traceView.resize();
    }

    drawChart() {
        if (!this.chartGate.ready()) return;
        this.traceView.draw();
    }

    applyInstrumentPreset() {
        const preset = INSTRUMENT_PRESETS[this.instrument];
        if (preset) {
            this.octave = preset.octave;
            this.saveSettings();
            this.syncControls();
            this.updateTargetNotes();
        }
    }

    updateTargetNotes() {
        this.targetNotes = buildScaleFrequencies(this.rootNote, this.octave, this.scaleType);
        this.drawChart();
    }

    /** @param {string} message */
    updateStatus(message) {
        if (this.statusEl) {
            this.statusEl.textContent = message;
        }
    }

    /**
     * Persist a finished session's result and refresh the trend line.
     * @param {number} hit @param {number} total @param {number | null} avgCents
     * @param {ProgressNoteResult[]} [notes]
     */
    recordProgress(hit, total, avgCents, notes = []) {
        if (this.sessionRecorded || total === 0) return;
        this.sessionRecorded = true;
        ProgressStore.record({
            tool: 'pitch-meter',
            context: `${this.mode} ${this.rootNote}${this.octave} ${this.scaleType}`,
            total,
            hit,
            avgCents,
            notes
        });
        this.updateProgressLine();
    }

    updateProgressLine() {
        const el = document.getElementById('progressSummary');
        if (el) el.textContent = ProgressStore.trendLine('pitch-meter');
        const weakEl = document.getElementById('weakSpotsSummary');
        if (weakEl) weakEl.textContent = ProgressStore.weakSpotLine('pitch-meter');
    }

    async toggleListening() {
        if (this.isListening) {
            this.stopSession();
        } else {
            await this.startSession();
        }
    }

    async startSession() {
        this.stopScalePlayback();

        const ok = await this.session.start();
        if (!ok) {
            this.updateStatus('Microphone access denied. Please allow microphone access.');
            return;
        }
        this.session.reset();

        this.isListening = true;
        this.sessionAborted = false;
        this.sessionRecorded = false;
        this.noteResults = [];
        this.currentNoteIndex = 0;
        this.captureSamples = null;
        this.captureTargetName = null;

        // Update UI
        const listenBtn = document.getElementById('listenBtn');
        const stopBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('stopBtn'));
        const resultsPanel = document.getElementById('resultsPanel');
        if (listenBtn) {
            listenBtn.classList.add('listening');
            const btnText = listenBtn.querySelector('.button-text');
            if (btnText) btnText.textContent = 'Listening...';
        }
        if (stopBtn) stopBtn.disabled = false;
        if (resultsPanel) resultsPanel.style.display = 'none';

        await PianoCore.ensureStarted();

        // The shared session records continuously; modes only direct the
        // piano and tag/collect samples through onPitchAccepted.
        if (this.mode === 'free') {
            this.updateStatus('Listening... Sing any notes');
        } else if (this.mode === 'call-response') {
            this.startCallResponseMode();
        } else if (this.mode === 'play-along') {
            this.startPlayAlongMode();
        }
    }

    stopSession() {
        this.sessionAborted = true;
        this.isListening = false;
        this.isPlayingScale = false;
        this.captureSamples = null;
        this.captureTargetName = null;

        this.session.stop();

        // Stop any playing notes
        if (this.piano) {
            this.piano.stopAll();
        }

        // Update UI
        const listenBtn = document.getElementById('listenBtn');
        const stopBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('stopBtn'));
        if (listenBtn) listenBtn.classList.remove('listening');
        this.updateModeUI();  // Reset button text
        if (stopBtn) stopBtn.disabled = true;

        this.updateStatus('Stopped');

        // Show results if we have data
        if (this.session.history.length > 0) {
            if (this.mode === 'call-response' && this.noteResults.length > 0) {
                this.analyzeCallResponseResults();
            } else {
                this.analyzeResults();
            }
        }
    }

    //-------SAMPLE HANDLING-------

    /** @param {PitchSample} sample */
    onPitchAccepted(sample) {
        this.updatePitchDisplay(sample.note, sample.cents, sample.freq);
        if (this.captureTargetName) sample.targetNote = this.captureTargetName;
        if (this.captureSamples) this.captureSamples.push(sample);
        this.drawChart();
    }

    //-------CALL & RESPONSE MODE-------

    async startCallResponseMode() {
        this.currentNoteIndex = 0;
        this.noteResults = [];
        await this.playNextCallResponseNote();
    }

    async playNextCallResponseNote() {
        if (!this.isListening || this.sessionAborted) return;
        if (this.currentNoteIndex >= this.targetNotes.length) {
            this.finishCallResponseMode();
            return;
        }

        const note = this.targetNotes[this.currentNoteIndex];
        const noteNum = this.currentNoteIndex + 1;
        const total = this.targetNotes.length;

        this.updateStatus(`Note ${noteNum}/${total}: Hear ${note.name}, then match it!`);

        // Play the note
        this.piano.playMidi(note.midi, '2n');

        // Wait a moment for the note to sound, then start listening period
        await this.sleep(600);

        if (!this.isListening || this.sessionAborted) return;

        this.updateStatus(`Now sing ${note.name}! (${this.responseTime}s)`);
        this.noteStartTime = Date.now();

        // Collect pitch data for the response time window; the shared
        // session loop fills this through onPitchAccepted.
        /** @type {PitchSample[]} */
        const pitchSamples = [];
        this.captureSamples = pitchSamples;
        this.captureTargetName = note.name;
        await this.sleep(this.responseTime * 1000);
        this.captureSamples = null;
        this.captureTargetName = null;

        if (!this.isListening || this.sessionAborted) return;

        // Analyze how well they matched
        const result = this.evaluateNoteMatch(note, pitchSamples);
        this.noteResults.push({ ...result, label: note.name, midi: note.midi });

        // Brief feedback
        if (result.matched) {
            this.updateStatus(`${note.name}: ${result.accuracy}% accurate!`);
        } else {
            this.updateStatus(`${note.name}: Missed (${result.reason})`);
        }

        await this.sleep(500);

        // Next note
        this.currentNoteIndex++;
        await this.playNextCallResponseNote();
    }

    /**
     * @param {TargetNote} targetNote
     * @param {PitchSample[]} pitchSamples
     * @returns {NoteResult}
     */
    evaluateNoteMatch(targetNote, pitchSamples) {
        const score = PitchScore.scoreWindow(pitchSamples, targetNote.midi);
        if (!score.attempted) {
            return { matched: false, reason: 'no sound detected', accuracy: 0 };
        }
        if (!score.matched) {
            const sungNote = midiToNoteName(/** @type {number} */ (score.sungMidi)).full;
            return { matched: false, reason: `sang ${sungNote} instead`, accuracy: 0, biasCents: score.biasCents };
        }

        // Reached the note. 'good'/'ok' count as a hit; a matched-but-loose note
        // (verdict 'missed') is reported with its sharp/flat direction.
        const hit = score.verdict === 'good' || score.verdict === 'ok';
        if (!hit) {
            return {
                matched: false,
                reason: `${score.biasCents > 0 ? 'sharp' : 'flat'} by ${Math.round(score.avgCents)}c`,
                accuracy: score.accuracy,
                avgCents: score.avgCents,
                biasCents: score.biasCents,
                targetNote: targetNote.name,
                samples: score.onTargetCount
            };
        }

        return {
            matched: true,
            accuracy: score.accuracy,
            avgCents: score.avgCents,
            biasCents: score.biasCents,
            targetNote: targetNote.name,
            samples: score.onTargetCount
        };
    }

    finishCallResponseMode() {
        this.isListening = false;
        this.isPlayingScale = false;

        const listenBtn = document.getElementById('listenBtn');
        const stopBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('stopBtn'));
        if (listenBtn) listenBtn.classList.remove('listening');
        this.updateModeUI();
        if (stopBtn) stopBtn.disabled = true;

        this.analyzeCallResponseResults();
    }

    analyzeCallResponseResults() {
        const resultsPanel = document.getElementById('resultsPanel');
        resultsPanel.style.display = 'block';

        const matched = this.noteResults.filter(r => r.matched);
        const notesHitCount = matched.length;
        const totalNotes = this.noteResults.length;

        const avgAccuracy = matched.length > 0
            ? Math.round(matched.reduce((sum, r) => sum + r.accuracy, 0) / matched.length)
            : 0;

        const avgCents = matched.length > 0
            ? (matched.reduce((sum, r) => sum + r.avgCents, 0) / matched.length).toFixed(1)
            : '--';

        document.getElementById('overallAccuracy').textContent = avgAccuracy + '%';
        document.getElementById('avgDeviation').textContent = avgCents + ' cents';
        document.getElementById('notesHit').textContent = notesHitCount + '/' + totalNotes;

        const accEl = document.getElementById('overallAccuracy');
        if (avgAccuracy >= 80) {
            accEl.style.color = '#4ade80';
        } else if (avgAccuracy >= 60) {
            accEl.style.color = '#facc15';
        } else {
            accEl.style.color = '#f87171';
        }

        // Build note breakdown
        const breakdownEl = document.getElementById('noteBreakdown');
        breakdownEl.innerHTML = '<h4>Per-Note Results</h4>';

        const noteOutcomes = this.noteResults.map(r => ({
            label: r.label || r.targetNote || '?',
            midi: r.midi ?? 0,
            result: /** @type {'good' | 'ok' | 'missed'} */ (
                !r.matched ? 'missed'
                    : (r.avgCents ?? 99) <= 10 ? 'good'
                        : (r.avgCents ?? 99) <= 25 ? 'ok' : 'missed'),
            avgCents: r.avgCents ?? null,
            biasCents: r.biasCents ?? null
        }));
        this.recordProgress(notesHitCount, totalNotes, matched.length > 0 ? Number(avgCents) : null, noteOutcomes);

        this.noteResults.forEach((result, i) => {
            const note = this.targetNotes[i];
            const noteDiv = document.createElement('div');
            noteDiv.className = 'note-result';

            let statusClass, statusIcon;
            if (result.matched) {
                if (result.accuracy >= 80) {
                    statusClass = 'note-good';
                    statusIcon = String.fromCharCode(10003);  // checkmark
                } else if (result.accuracy >= 60) {
                    statusClass = 'note-ok';
                    statusIcon = '~';
                } else {
                    statusClass = 'note-poor';
                    statusIcon = '!';
                }
            } else {
                statusClass = 'note-missed';
                statusIcon = 'x';
            }

            noteDiv.innerHTML = `
                <span class="note-name">${note.name}</span>
                <span class="note-status ${statusClass}">${statusIcon}</span>
                <span class="note-deviation">${result.matched ? result.accuracy + '% (' + result.avgCents.toFixed(0) + ' cents)' : result.reason}</span>
            `;
            breakdownEl.appendChild(noteDiv);
        });

        this.updateStatus(`Done! ${notesHitCount}/${totalNotes} notes matched, ${avgAccuracy}% average accuracy`);
    }

    //-------PLAY ALONG MODE-------

    async startPlayAlongMode() {
        this.updateStatus('Get ready to sing along...');
        await this.sleep(1000);

        if (!this.isListening || this.sessionAborted) return;

        this.isPlayingScale = true;

        // Play scale while simultaneously listening; the shared session
        // records and tags samples via captureTargetName.
        for (let i = 0; i < this.targetNotes.length; i++) {
            if (!this.isListening || this.sessionAborted) break;

            const note = this.targetNotes[i];
            this.updateStatus(`Sing: ${note.name}`);

            this.piano.playMidi(note.midi, '4n');
            this.captureTargetName = note.name;
            await this.sleep(this.responseTime * 1000);
        }
        this.captureTargetName = null;

        if (this.isListening && !this.sessionAborted) {
            this.stopSession();
        }
    }

    //-------DISPLAY HELPERS-------

    /**
     * @param {string} noteName
     * @param {number} cents
     * @param {number} freq
     */
    updatePitchDisplay(noteName, cents, freq) {
        if (!this.pitchDisplayGate.ready()) return;

        const noteText = noteName;
        const centsText = (cents >= 0 ? '+' : '') + cents.toFixed(0) + ' cents';
        const freqText = freq.toFixed(1) + ' Hz';

        const markerPos = 50 + (cents / 50) * 50;
        const markerLeft = Math.max(0, Math.min(100, markerPos)).toFixed(1) + '%';

        const absDeviation = Math.abs(cents);
        let noteColor;
        let markerColor;
        if (absDeviation < 10) {
            noteColor = '#4ade80';
            markerColor = '#4ade80';
        } else if (absDeviation < 25) {
            noteColor = '#facc15';
            markerColor = '#facc15';
        } else {
            noteColor = '#f87171';
            markerColor = '#f87171';
        }

        const diff = this.pitchDisplayDiff;
        diff.text('note', this.currentNoteEl, noteText);
        diff.text('cents', this.currentCentsEl, centsText);
        diff.text('freq', this.currentFreqEl, freqText);
        diff.style('markerLeft', this.centsMarkerEl, 'left', markerLeft);
        diff.style('noteColor', this.currentNoteEl, 'color', noteColor);
        diff.style('markerColor', this.centsMarkerEl, 'background', markerColor);
    }

    clearPitchDisplay() {
        const diff = this.pitchDisplayDiff;
        diff.text('note', this.currentNoteEl, '--');
        diff.text('cents', this.currentCentsEl, '-- cents');
        diff.text('freq', this.currentFreqEl, '-- Hz');
        diff.style('noteColor', this.currentNoteEl, 'color', 'rgba(255,255,255,0.5)');
    }

    //-------SCALE PLAYBACK (preview)-------

    stopScalePlayback() {
        this.isPlayingScale = false;
        if (this.piano) {
            this.piano.stopAll();
        }
    }

    async playReferenceScale() {
        this.stopScalePlayback();

        if (!this.samplerLoaded) {
            this.updateStatus('Piano not loaded yet');
            return;
        }

        this.isPlayingScale = true;
        await PianoCore.ensureStarted();

        this.updateStatus('Playing ' + this.rootNote + ' ' + this.scaleType + ' scale...');

        for (let i = 0; i < this.targetNotes.length; i++) {
            if (!this.isPlayingScale) break;

            const note = this.targetNotes[i];
            this.piano.playMidi(note.midi, '4n');
            await this.sleep(500);
        }

        this.isPlayingScale = false;
        if (!this.isListening) {
            this.updateModeUI();
        }
    }

    //-------FREE PRACTICE RESULTS (same as before)-------

    analyzeResults() {
        const resultsPanel = document.getElementById('resultsPanel');
        if (resultsPanel) resultsPanel.style.display = 'block';

        // Free practice has no per-note time windows, so assign each voiced
        // sample to its nearest target (within the note-identity band) and then
        // grade each target with the one shared correctness definition.
        const identitySemitones = PitchScore.IDENTITY_CENTS / 100;
        /** @type {Map<number, { midi: number }[]>} */
        const samplesByTarget = new Map();
        this.targetNotes.forEach(note => samplesByTarget.set(note.midi, []));

        this.session.history.forEach(sample => {
            /** @type {number | null} */
            let nearestMidi = null;
            let nearestDist = Infinity;
            this.targetNotes.forEach(note => {
                const dist = Math.abs(sample.midi - note.midi);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestMidi = note.midi;
                }
            });
            if (nearestMidi !== null && nearestDist <= identitySemitones) {
                const bucket = samplesByTarget.get(nearestMidi);
                if (bucket) bucket.push(sample);
            }
        });

        /** @type {Map<number, any>} */
        const noteScoreByMidi = new Map();
        this.targetNotes.forEach(note => {
            noteScoreByMidi.set(note.midi, PitchScore.scoreWindow(samplesByTarget.get(note.midi) || [], note.midi));
        });

        const sungScores = this.targetNotes
            .map(note => noteScoreByMidi.get(note.midi))
            .filter(score => score && score.attempted);
        const notesHitCount = this.targetNotes.filter(note => {
            const score = noteScoreByMidi.get(note.midi);
            return score && (score.verdict === 'good' || score.verdict === 'ok');
        }).length;
        const avgDeviation = sungScores.length
            ? sungScores.reduce((sum, s) => sum + s.avgCents, 0) / sungScores.length
            : 0;
        const accuracy = sungScores.length
            ? sungScores.reduce((sum, s) => sum + s.accuracy, 0) / sungScores.length
            : 0;

        const playAlongOutcomes = this.targetNotes.map(note => {
            const score = noteScoreByMidi.get(note.midi);
            return {
                label: note.name,
                midi: note.midi,
                result: /** @type {'good' | 'ok' | 'missed'} */ (score ? score.verdict : 'missed'),
                avgCents: score && score.attempted ? score.avgCents : null,
                biasCents: score && score.attempted ? score.biasCents : null
            };
        });
        this.recordProgress(notesHitCount, this.targetNotes.length, sungScores.length ? avgDeviation : null, playAlongOutcomes);

        document.getElementById('overallAccuracy').textContent = accuracy.toFixed(0) + '%';
        document.getElementById('avgDeviation').textContent = avgDeviation.toFixed(1) + ' cents';
        document.getElementById('notesHit').textContent = notesHitCount + '/' + this.targetNotes.length;

        const accEl = document.getElementById('overallAccuracy');
        if (accuracy >= 80) {
            accEl.style.color = '#4ade80';
        } else if (accuracy >= 60) {
            accEl.style.color = '#facc15';
        } else {
            accEl.style.color = '#f87171';
        }

        const breakdownEl = document.getElementById('noteBreakdown');
        breakdownEl.innerHTML = '<h4>Per-Note Breakdown</h4>';

        this.targetNotes.forEach(note => {
            const score = noteScoreByMidi.get(note.midi);
            const wasHit = !!(score && score.attempted);
            const avgCents = wasHit ? score.avgCents : 0;

            const noteDiv = document.createElement('div');
            noteDiv.className = 'note-result';

            let statusClass = 'note-missed';
            let statusIcon = 'x';
            if (wasHit) {
                if (score.verdict === 'good') {
                    statusClass = 'note-good';
                    statusIcon = String.fromCharCode(10003);
                } else if (score.verdict === 'ok') {
                    statusClass = 'note-ok';
                    statusIcon = '~';
                } else {
                    statusClass = 'note-poor';
                    statusIcon = '!';
                }
            }

            noteDiv.innerHTML = `
                <span class="note-name">${note.name}</span>
                <span class="note-status ${statusClass}">${statusIcon}</span>
                <span class="note-deviation">${wasHit ? avgCents.toFixed(0) + ' cents avg' : 'not detected'}</span>
            `;
            breakdownEl.appendChild(noteDiv);
        });

        this.updateStatus('Done! ' + accuracy.toFixed(0) + '% accuracy');
    }

    //-------UTILITIES-------

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    window.pitchMeter = new PitchMeterController();
});
