// @ts-check
//-----------------------------------------------------------------------
// PITCH METER - Real-time pitch detection with practice modes
// Uses Web Audio API for microphone capture
// Uses autocorrelation for pitch detection
// Uses Tone.js Sampler with Salamander piano samples
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

//-------PITCH DETECTION (Autocorrelation)-------

/**
 * @param {Float32Array} buffer - Audio buffer samples
 * @param {number} sampleRate - Audio sample rate
 * @returns {number} Detected frequency in Hz, or -1 if no pitch detected
 */
function autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let foundGoodCorrelation = false;
    const correlations = new Array(MAX_SAMPLES);

    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
        rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let lastCorrelation = 1;
    for (let offset = 0; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;
        for (let i = 0; i < MAX_SAMPLES; i++) {
            correlation += Math.abs(buffer[i] - buffer[i + offset]);
        }
        correlation = 1 - correlation / MAX_SAMPLES;
        correlations[offset] = correlation;

        if (correlation > 0.9 && correlation > lastCorrelation) {
            foundGoodCorrelation = true;
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
            }
        } else if (foundGoodCorrelation) {
            const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) /
                correlations[bestOffset];
            return sampleRate / (bestOffset + 8 * shift);
        }
        lastCorrelation = correlation;
    }

    if (bestCorrelation > 0.01) {
        return sampleRate / bestOffset;
    }
    return -1;
}

//-------PITCH METER CONTROLLER-------

/**
 * @typedef {{ midi: number, freq: number, name: string, noteName: string, octave: number }} TargetNote
 * @typedef {{ time: number, freq: number, midi: number, note: string, cents: number, targetNote?: string }} PitchSample
 * @typedef {{ matched: boolean, accuracy: number, avgCents?: number, reason?: string, targetNote?: string, samples?: number }} NoteResult
 */

class PitchMeterController {
    constructor() {
        /** @type {AudioContext | null} */
        this.audioContext = null;
        /** @type {AnalyserNode | null} */
        this.analyser = null;
        /** @type {MediaStreamAudioSourceNode | null} */
        this.microphone = null;
        /** @type {boolean} */
        this.isListening = false;
        /** @type {number | null} */
        this.animationId = null;

        // Piano sampler (same as scales page)
        /** @type {import('tone').Sampler | null} */
        this.sampler = null;
        /** @type {import('tone').Gain | null} */
        this.gainNode = null;
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

        // Recording/listening data
        /** @type {PitchSample[]} */
        this.pitchHistory = [];
        /** @type {number} */
        this.sessionStartTime = 0;

        // Call & Response tracking
        /** @type {number} */
        this.currentNoteIndex = 0;
        /** @type {number} */
        this.noteStartTime = 0;
        /** @type {NoteResult[]} */
        this.noteResults = [];
        /** @type {boolean} */
        this.sessionAborted = false;

        // Canvas
        /** @type {HTMLCanvasElement | null} */
        this.canvas = null;
        /** @type {CanvasRenderingContext2D | null} */
        this.ctx = null;

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

        this.init();
    }

    async init() {
        // Get DOM elements
        this.statusEl = document.getElementById('status');
        this.currentNoteEl = document.getElementById('currentNote');
        this.currentCentsEl = document.getElementById('currentCents');
        this.currentFreqEl = document.getElementById('currentFreq');
        this.centsMarkerEl = document.getElementById('centsMarker');
        this.canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('pitchChart'));
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Set up controls
        const listenBtn = document.getElementById('listenBtn');
        const stopBtn = document.getElementById('stopBtn');
        const playRefBtn = document.getElementById('playRefBtn');
        const modeSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('modeSelect'));
        const responseTimeSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('responseTimeSelect'));

        if (listenBtn) listenBtn.addEventListener('click', () => this.toggleListening());
        if (stopBtn) stopBtn.addEventListener('click', () => this.stopSession());
        if (playRefBtn) playRefBtn.addEventListener('click', () => this.playReferenceScale());

        if (modeSelect) modeSelect.addEventListener('change', (e) => {
            const target = /** @type {HTMLSelectElement} */ (e.target);
            this.mode = /** @type {'free' | 'call-response' | 'play-along'} */ (target.value);
            this.updateModeUI();
        });

        if (responseTimeSelect) responseTimeSelect.addEventListener('change', (e) => {
            const target = /** @type {HTMLSelectElement} */ (e.target);
            this.responseTime = parseInt(target.value);
        });

        const instrumentSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('instrumentSelect'));
        const rootSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('rootSelect'));
        const scaleSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('scaleSelect'));
        const octaveSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('octaveSelect'));

        if (instrumentSelect) instrumentSelect.addEventListener('change', (e) => {
            const target = /** @type {HTMLSelectElement} */ (e.target);
            this.instrument = target.value;
            this.applyInstrumentPreset();
        });
        if (rootSelect) rootSelect.addEventListener('change', (e) => {
            const target = /** @type {HTMLSelectElement} */ (e.target);
            this.rootNote = target.value;
            this.updateTargetNotes();
        });
        if (scaleSelect) scaleSelect.addEventListener('change', (e) => {
            const target = /** @type {HTMLSelectElement} */ (e.target);
            this.scaleType = target.value;
            this.updateTargetNotes();
        });
        if (octaveSelect) octaveSelect.addEventListener('change', (e) => {
            const target = /** @type {HTMLSelectElement} */ (e.target);
            this.octave = parseInt(target.value);
            this.updateTargetNotes();
        });

        // Initialize sampler
        await this.initSampler();

        this.updateTargetNotes();
        this.updateModeUI();
        this.drawChart();
    }

    async initSampler() {
        this.updateStatus('Loading piano...');

        const baseUrl = 'https://tonejs.github.io/audio/salamander/';
        this.gainNode = new Tone.Gain(1).toDestination();

        return new Promise((resolve) => {
            this.sampler = new Tone.Sampler({
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
                    this.samplerLoaded = true;
                    this.enableButtons();
                    this.updateStatus('Choose a mode and click Start');
                    resolve();
                },
                onerror: (err) => {
                    console.error('Error loading piano samples:', err);
                    this.updateStatus('Failed to load piano. Refresh to retry.');
                    resolve();
                }
            }).connect(this.gainNode);

            this.sampler.volume.value = -3;
        });
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
        const container = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();

        this.canvas.width = rect.width * dpr;
        this.canvas.height = 300 * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = '300px';

        this.ctx.scale(dpr, dpr);
        this.drawChart();
    }

    applyInstrumentPreset() {
        const preset = INSTRUMENT_PRESETS[this.instrument];
        if (preset) {
            this.octave = preset.octave;
            const octaveSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('octaveSelect'));
            if (octaveSelect) octaveSelect.value = String(preset.octave);
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

    async toggleListening() {
        if (this.isListening) {
            this.stopSession();
        } else {
            await this.startSession();
        }
    }

    async startSession() {
        this.stopScalePlayback();

        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.microphone = this.audioContext.createMediaStreamSource(stream);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.microphone.connect(this.analyser);

            this.isListening = true;
            this.sessionAborted = false;
            this.pitchHistory = [];
            this.noteResults = [];
            this.currentNoteIndex = 0;
            this.sessionStartTime = Date.now();

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

            await Tone.start();

            // Start the appropriate mode
            if (this.mode === 'free') {
                this.updateStatus('Listening... Sing any notes');
                this.analyzeLoop();
            } else if (this.mode === 'call-response') {
                this.startCallResponseMode();
            } else if (this.mode === 'play-along') {
                this.startPlayAlongMode();
            }

        } catch (err) {
            console.error('Microphone access denied:', err);
            this.updateStatus('Microphone access denied. Please allow microphone access.');
        }
    }

    stopSession() {
        this.sessionAborted = true;
        this.isListening = false;
        this.isPlayingScale = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }

        // Stop any playing notes
        if (this.sampler) {
            this.sampler.releaseAll();
        }

        // Update UI
        const listenBtn = document.getElementById('listenBtn');
        const stopBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('stopBtn'));
        if (listenBtn) listenBtn.classList.remove('listening');
        this.updateModeUI();  // Reset button text
        if (stopBtn) stopBtn.disabled = true;

        this.updateStatus('Stopped');

        // Show results if we have data
        if (this.pitchHistory.length > 0) {
            if (this.mode === 'call-response' && this.noteResults.length > 0) {
                this.analyzeCallResponseResults();
            } else {
                this.analyzeResults();
            }
        }
    }

    //-------FREE PRACTICE MODE-------

    analyzeLoop() {
        if (!this.isListening) return;

        const buffer = new Float32Array(this.analyser.fftSize);
        this.analyser.getFloatTimeDomainData(buffer);

        const freq = autoCorrelate(buffer, this.audioContext.sampleRate);

        if (freq > 0 && freq < 2000) {
            const midi = freqToMidi(freq);
            const noteInfo = midiToNoteName(midi);
            const cents = getCentsDeviation(freq);

            this.updatePitchDisplay(noteInfo.full, cents, freq);

            const elapsed = Date.now() - this.sessionStartTime;
            this.pitchHistory.push({
                time: elapsed,
                freq,
                midi,
                note: noteInfo.full,
                cents
            });

            this.drawChart();
        } else {
            this.clearPitchDisplay();
        }

        this.animationId = requestAnimationFrame(() => this.analyzeLoop());
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
        this.sampler.triggerAttackRelease(note.name, '2n');

        // Wait a moment for the note to sound, then start listening period
        await this.sleep(600);

        if (!this.isListening || this.sessionAborted) return;

        this.updateStatus(`Now sing ${note.name}! (${this.responseTime}s)`);
        this.noteStartTime = Date.now();

        // Collect pitch data for the response time window
        const pitchSamples = [];
        const endTime = Date.now() + (this.responseTime * 1000);

        while (Date.now() < endTime && this.isListening && !this.sessionAborted) {
            const buffer = new Float32Array(this.analyser.fftSize);
            this.analyser.getFloatTimeDomainData(buffer);
            const freq = autoCorrelate(buffer, this.audioContext.sampleRate);

            if (freq > 0 && freq < 2000) {
                const midi = freqToMidi(freq);
                const noteInfo = midiToNoteName(midi);
                const cents = getCentsDeviation(freq);

                this.updatePitchDisplay(noteInfo.full, cents, freq);

                pitchSamples.push({
                    time: Date.now() - this.sessionStartTime,
                    freq,
                    midi,
                    note: noteInfo.full,
                    cents
                });

                // Also add to overall history for chart
                const elapsed = Date.now() - this.sessionStartTime;
                this.pitchHistory.push({
                    time: elapsed,
                    freq,
                    midi,
                    note: noteInfo.full,
                    cents,
                    targetNote: note.name
                });

                this.drawChart();
            } else {
                this.clearPitchDisplay();
            }

            await this.sleep(50);  // Sample roughly 20 times per second
        }

        if (!this.isListening || this.sessionAborted) return;

        // Analyze how well they matched
        const result = this.evaluateNoteMatch(note, pitchSamples);
        this.noteResults.push(result);

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
        if (pitchSamples.length < 5) {
            return { matched: false, reason: 'no sound detected', accuracy: 0 };
        }

        // Filter samples that are close to the target note
        const targetMidi = targetNote.midi;
        const closeMatches = pitchSamples.filter(s => Math.abs(s.midi - targetMidi) < 1.5);

        if (closeMatches.length < pitchSamples.length * 0.3) {
            // Less than 30% of samples were close to the target
            const avgMidi = pitchSamples.reduce((sum, s) => sum + s.midi, 0) / pitchSamples.length;
            const sungNote = midiToNoteName(avgMidi).full;
            return { matched: false, reason: `sang ${sungNote} instead`, accuracy: 0 };
        }

        // Calculate accuracy based on cents deviation
        const centsDeviations = closeMatches.map(s => Math.abs((s.midi - targetMidi) * 100));
        const avgCents = centsDeviations.reduce((a, b) => a + b, 0) / centsDeviations.length;

        // Convert cents to accuracy percentage (0 cents = 100%, 50 cents = 0%)
        const accuracy = Math.max(0, Math.round(100 - (avgCents * 2)));

        return {
            matched: true,
            accuracy,
            avgCents,
            targetNote: targetNote.name,
            samples: closeMatches.length
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

        // Play scale while simultaneously listening
        for (let i = 0; i < this.targetNotes.length; i++) {
            if (!this.isListening || this.sessionAborted) break;

            const note = this.targetNotes[i];
            this.updateStatus(`Sing: ${note.name}`);

            // Play the note
            this.sampler.triggerAttackRelease(note.name, '4n');

            // Listen for response time while note is playing
            const endTime = Date.now() + (this.responseTime * 1000);
            while (Date.now() < endTime && this.isListening && !this.sessionAborted) {
                const buffer = new Float32Array(this.analyser.fftSize);
                this.analyser.getFloatTimeDomainData(buffer);
                const freq = autoCorrelate(buffer, this.audioContext.sampleRate);

                if (freq > 0 && freq < 2000) {
                    const midi = freqToMidi(freq);
                    const noteInfo = midiToNoteName(midi);
                    const cents = getCentsDeviation(freq);

                    this.updatePitchDisplay(noteInfo.full, cents, freq);

                    const elapsed = Date.now() - this.sessionStartTime;
                    this.pitchHistory.push({
                        time: elapsed,
                        freq,
                        midi,
                        note: noteInfo.full,
                        cents,
                        targetNote: note.name
                    });

                    this.drawChart();
                } else {
                    this.clearPitchDisplay();
                }

                await this.sleep(50);
            }
        }

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
        this.currentNoteEl.textContent = noteName;
        this.currentCentsEl.textContent = (cents >= 0 ? '+' : '') + cents.toFixed(0) + ' cents';
        this.currentFreqEl.textContent = freq.toFixed(1) + ' Hz';

        const markerPos = 50 + (cents / 50) * 50;
        this.centsMarkerEl.style.left = Math.max(0, Math.min(100, markerPos)) + '%';

        const absDeviation = Math.abs(cents);
        if (absDeviation < 10) {
            this.currentNoteEl.style.color = '#4ade80';
            this.centsMarkerEl.style.background = '#4ade80';
        } else if (absDeviation < 25) {
            this.currentNoteEl.style.color = '#facc15';
            this.centsMarkerEl.style.background = '#facc15';
        } else {
            this.currentNoteEl.style.color = '#f87171';
            this.centsMarkerEl.style.background = '#f87171';
        }
    }

    clearPitchDisplay() {
        this.currentNoteEl.textContent = '--';
        this.currentCentsEl.textContent = '-- cents';
        this.currentFreqEl.textContent = '-- Hz';
        this.currentNoteEl.style.color = 'rgba(255,255,255,0.5)';
    }

    //-------SCALE PLAYBACK (preview)-------

    stopScalePlayback() {
        this.isPlayingScale = false;
        if (this.sampler) {
            this.sampler.releaseAll();
        }
    }

    async playReferenceScale() {
        this.stopScalePlayback();

        if (!this.samplerLoaded) {
            this.updateStatus('Piano not loaded yet');
            return;
        }

        this.isPlayingScale = true;
        await Tone.start();

        this.updateStatus('Playing ' + this.rootNote + ' ' + this.scaleType + ' scale...');

        for (let i = 0; i < this.targetNotes.length; i++) {
            if (!this.isPlayingScale) break;

            const note = this.targetNotes[i];
            this.sampler.triggerAttackRelease(note.name, '4n');
            await this.sleep(500);
        }

        this.isPlayingScale = false;
        if (!this.isListening) {
            this.updateModeUI();
        }
    }

    //-------CHART DRAWING-------

    drawChart() {
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.fillRect(0, 0, width, height);

        if (this.targetNotes.length === 0) return;

        const minMidi = this.targetNotes[0].midi - 2;
        const maxMidi = this.targetNotes[this.targetNotes.length - 1].midi + 2;
        const midiRange = maxMidi - minMidi;

        /** @param {number} midi */
        const midiToY = (midi) => {
            return height - ((midi - minMidi) / midiRange) * (height - 40) - 20;
        };

        // Draw horizontal lines for target notes
        this.ctx.font = '12px system-ui';
        this.targetNotes.forEach((note) => {
            const y = midiToY(note.midi);

            this.ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(50, y);
            this.ctx.lineTo(width - 10, y);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            this.ctx.fillStyle = 'rgba(74, 222, 128, 0.9)';
            this.ctx.textAlign = 'right';
            this.ctx.fillText(note.name, 45, y + 4);
        });

        // Draw pitch history trace
        if (this.pitchHistory.length > 1) {
            const maxTime = this.pitchHistory[this.pitchHistory.length - 1].time;
            const timeWindow = Math.max(maxTime, 5000);

            this.ctx.lineWidth = 2;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            this.ctx.beginPath();
            let started = false;

            for (let i = 0; i < this.pitchHistory.length; i++) {
                const point = this.pitchHistory[i];
                const x = 50 + (point.time / timeWindow) * (width - 60);
                const y = midiToY(point.midi);

                const absDeviation = Math.abs(point.cents);
                if (absDeviation < 10) {
                    this.ctx.strokeStyle = '#4ade80';
                } else if (absDeviation < 25) {
                    this.ctx.strokeStyle = '#facc15';
                } else {
                    this.ctx.strokeStyle = '#f87171';
                }

                if (!started) {
                    this.ctx.moveTo(x, y);
                    started = true;
                } else {
                    this.ctx.lineTo(x, y);
                    this.ctx.stroke();
                    this.ctx.beginPath();
                    this.ctx.moveTo(x, y);
                }
            }
            this.ctx.stroke();

            // Draw dots at each point
            for (let i = 0; i < this.pitchHistory.length; i += 3) {
                const point = this.pitchHistory[i];
                const x = 50 + (point.time / timeWindow) * (width - 60);
                const y = midiToY(point.midi);

                const absDeviation = Math.abs(point.cents);
                if (absDeviation < 10) {
                    this.ctx.fillStyle = '#4ade80';
                } else if (absDeviation < 25) {
                    this.ctx.fillStyle = '#facc15';
                } else {
                    this.ctx.fillStyle = '#f87171';
                }

                this.ctx.beginPath();
                this.ctx.arc(x, y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    //-------FREE PRACTICE RESULTS (same as before)-------

    analyzeResults() {
        const resultsPanel = document.getElementById('resultsPanel');
        if (resultsPanel) resultsPanel.style.display = 'block';

        const targetMidis = this.targetNotes.map(n => n.midi);
        /** @type {Record<number, { hits: number, totalCents: number, count: number }>} */
        const noteHits = {};
        targetMidis.forEach(midi => {
            noteHits[midi] = { hits: 0, totalCents: 0, count: 0 };
        });

        let totalAccurateSamples = 0;
        let totalCentsDeviation = 0;
        let validSamples = 0;

        this.pitchHistory.forEach(sample => {
            let nearestTarget = null;
            let nearestDist = Infinity;

            targetMidis.forEach(targetMidi => {
                const dist = Math.abs(sample.midi - targetMidi);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestTarget = targetMidi;
                }
            });

            if (nearestTarget !== null && nearestDist < 1.5) {
                /** @type {number} */
                const targetKey = nearestTarget;  // Type narrowing
                const entry = noteHits[targetKey];
                if (!entry) return;
                const cents = (sample.midi - targetKey) * 100;
                entry.hits++;
                entry.totalCents += Math.abs(cents);
                entry.count++;

                totalCentsDeviation += Math.abs(cents);
                validSamples++;

                if (Math.abs(cents) < 25) {
                    totalAccurateSamples++;
                }
            }
        });

        const accuracy = validSamples > 0 ? (totalAccurateSamples / validSamples * 100) : 0;
        const avgDeviation = validSamples > 0 ? (totalCentsDeviation / validSamples) : 0;
        const notesHitCount = Object.values(noteHits).filter(n => n.count > 5).length;

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
            const data = noteHits[note.midi];
            const avgCents = data.count > 0 ? (data.totalCents / data.count) : 0;
            const wasHit = data.count > 5;

            const noteDiv = document.createElement('div');
            noteDiv.className = 'note-result';

            let statusClass = 'note-missed';
            let statusIcon = 'x';
            if (wasHit) {
                if (avgCents < 15) {
                    statusClass = 'note-good';
                    statusIcon = String.fromCharCode(10003);
                } else if (avgCents < 30) {
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
