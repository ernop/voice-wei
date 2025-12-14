//-----------------------------------------------------------------------
// PITCH METER - Real-time pitch detection and visualization
// Uses Web Audio API for microphone capture
// Uses autocorrelation for pitch detection
//-----------------------------------------------------------------------

//-------MUSICAL CONSTANTS-------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Scale intervals (semitones from root)
const SCALE_PATTERNS = {
    major: [0, 2, 4, 5, 7, 9, 11, 12],
    minor: [0, 2, 3, 5, 7, 8, 10, 12],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    pentatonic: [0, 2, 4, 7, 9, 12],
    blues: [0, 3, 5, 6, 7, 10, 12]
};

// A4 = 440 Hz reference
const A4_FREQ = 440;
const A4_MIDI = 69;

// Instrument presets (default octave for each)
const INSTRUMENT_PRESETS = {
    voice: { octave: 4, label: 'Voice' },
    violin: { octave: 4, label: 'Violin' },
    bass: { octave: 2, label: 'Bass' }
};

//-------UTILITY FUNCTIONS-------

// Convert MIDI note number to frequency
function midiToFreq(midi) {
    return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

// Convert frequency to MIDI note number (continuous)
function freqToMidi(freq) {
    return A4_MIDI + 12 * Math.log2(freq / A4_FREQ);
}

// Get note name and octave from MIDI number
function midiToNoteName(midi) {
    const noteIndex = Math.round(midi) % 12;
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    return { name: NOTE_NAMES[noteIndex], octave, full: NOTE_NAMES[noteIndex] + octave };
}

// Get MIDI number from note name and octave (e.g., "C", 4 -> 60)
function noteNameToMidi(noteName, octave) {
    const noteIndex = NOTE_NAMES.indexOf(noteName);
    if (noteIndex === -1) return null;
    return (octave + 1) * 12 + noteIndex;
}

// Calculate cents deviation from nearest note
function getCentsDeviation(freq) {
    const midi = freqToMidi(freq);
    const nearestMidi = Math.round(midi);
    return (midi - nearestMidi) * 100;
}

// Build scale frequencies from root and pattern
function buildScaleFrequencies(rootNote, octave, scaleType) {
    const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
    const rootMidi = noteNameToMidi(rootNote, octave);
    return pattern.map(interval => {
        const midi = rootMidi + interval;
        const noteInfo = midiToNoteName(midi);
        return {
            midi,
            freq: midiToFreq(midi),
            name: noteInfo.full,
            noteName: noteInfo.name,
            octave: noteInfo.octave
        };
    });
}

//-------PITCH DETECTION (Autocorrelation)-------

function autoCorrelate(buffer, sampleRate) {
    // Find the best correlation offset (pitch period)
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let foundGoodCorrelation = false;
    const correlations = new Array(MAX_SAMPLES);

    // Check if there's enough signal
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
        rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1; // Not enough signal

    let lastCorrelation = 1;
    for (let offset = 0; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;
        for (let i = 0; i < MAX_SAMPLES; i++) {
            correlation += Math.abs(buffer[i] - buffer[i + offset]);
        }
        correlation = 1 - correlation / MAX_SAMPLES;
        correlations[offset] = correlation;

        // Find the first peak after crossing threshold
        if (correlation > 0.9 && correlation > lastCorrelation) {
            foundGoodCorrelation = true;
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
            }
        } else if (foundGoodCorrelation) {
            // We've found a peak and correlation is decreasing
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

class PitchMeterController {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isRecording = false;
        this.animationId = null;

        // Synth for reference playback
        this.synth = null;
        this.playbackTimeoutId = null;
        this.isPlayingScale = false;

        // Current scale config
        this.instrument = 'voice';
        this.rootNote = 'C';
        this.scaleType = 'major';
        this.octave = 4;
        this.targetNotes = [];

        // Recording data
        this.pitchHistory = [];
        this.recordingStartTime = 0;

        // Canvas
        this.canvas = null;
        this.ctx = null;

        // DOM elements
        this.statusEl = null;
        this.currentNoteEl = null;
        this.currentCentsEl = null;
        this.currentFreqEl = null;
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
        this.canvas = document.getElementById('pitchChart');
        this.ctx = this.canvas.getContext('2d');

        // Set up canvas size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Set up controls
        document.getElementById('recordBtn').addEventListener('click', () => this.toggleRecording());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopRecording());
        document.getElementById('playRefBtn').addEventListener('click', () => this.playReferenceScale());

        document.getElementById('instrumentSelect').addEventListener('change', (e) => {
            this.instrument = e.target.value;
            this.applyInstrumentPreset();
        });
        document.getElementById('rootSelect').addEventListener('change', (e) => {
            this.rootNote = e.target.value;
            this.updateTargetNotes();
        });
        document.getElementById('scaleSelect').addEventListener('change', (e) => {
            this.scaleType = e.target.value;
            this.updateTargetNotes();
        });
        document.getElementById('octaveSelect').addEventListener('change', (e) => {
            this.octave = parseInt(e.target.value);
            this.updateTargetNotes();
        });

        // Initialize target notes and draw initial chart
        this.updateTargetNotes();
        this.drawChart();

        this.updateStatus('Select a scale and click Record to begin');
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
            document.getElementById('octaveSelect').value = String(preset.octave);
            this.updateTargetNotes();
        }
    }

    updateTargetNotes() {
        this.targetNotes = buildScaleFrequencies(this.rootNote, this.octave, this.scaleType);
        this.drawChart();
    }

    updateStatus(message) {
        if (this.statusEl) {
            this.statusEl.textContent = message;
        }
    }

    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        // Stop any scale playback before recording
        this.stopScalePlayback();

        try {
            // Initialize audio context
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.microphone = this.audioContext.createMediaStreamSource(stream);

            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.microphone.connect(this.analyser);

            this.isRecording = true;
            this.pitchHistory = [];
            this.recordingStartTime = Date.now();

            // Update UI
            document.getElementById('recordBtn').classList.add('recording');
            document.getElementById('recordBtn').querySelector('.button-text').textContent = 'Recording...';
            document.getElementById('stopBtn').disabled = false;
            document.getElementById('resultsPanel').style.display = 'none';

            this.updateStatus('Listening... Sing the ' + this.rootNote + ' ' + this.scaleType + ' scale');

            // Start analysis loop
            this.analyzeLoop();

        } catch (err) {
            console.error('Microphone access denied:', err);
            this.updateStatus('Microphone access denied. Please allow microphone access.');
        }
    }

    stopRecording() {
        this.isRecording = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }

        // Update UI
        document.getElementById('recordBtn').classList.remove('recording');
        document.getElementById('recordBtn').querySelector('.button-text').textContent = 'Record';
        document.getElementById('stopBtn').disabled = true;

        this.updateStatus('Recording stopped');

        // Show results
        if (this.pitchHistory.length > 0) {
            this.analyzeResults();
        }
    }

    analyzeLoop() {
        if (!this.isRecording) return;

        const buffer = new Float32Array(this.analyser.fftSize);
        this.analyser.getFloatTimeDomainData(buffer);

        const freq = autoCorrelate(buffer, this.audioContext.sampleRate);

        if (freq > 0 && freq < 2000) {
            const midi = freqToMidi(freq);
            const noteInfo = midiToNoteName(midi);
            const cents = getCentsDeviation(freq);

            // Update real-time display
            this.currentNoteEl.textContent = noteInfo.full;
            this.currentCentsEl.textContent = (cents >= 0 ? '+' : '') + cents.toFixed(0) + ' cents';
            this.currentFreqEl.textContent = freq.toFixed(1) + ' Hz';

            // Update cents indicator
            const markerPos = 50 + (cents / 50) * 50; // Map -50 to +50 cents to 0% to 100%
            this.centsMarkerEl.style.left = Math.max(0, Math.min(100, markerPos)) + '%';

            // Color based on accuracy
            const absDeviation = Math.abs(cents);
            if (absDeviation < 10) {
                this.currentNoteEl.style.color = '#4ade80'; // Green
                this.centsMarkerEl.style.background = '#4ade80';
            } else if (absDeviation < 25) {
                this.currentNoteEl.style.color = '#facc15'; // Yellow
                this.centsMarkerEl.style.background = '#facc15';
            } else {
                this.currentNoteEl.style.color = '#f87171'; // Red
                this.centsMarkerEl.style.background = '#f87171';
            }

            // Record pitch data
            const elapsed = Date.now() - this.recordingStartTime;
            this.pitchHistory.push({
                time: elapsed,
                freq,
                midi,
                note: noteInfo.full,
                cents
            });

            // Update chart
            this.drawChart();
        } else {
            // No pitch detected
            this.currentNoteEl.textContent = '--';
            this.currentCentsEl.textContent = '-- cents';
            this.currentFreqEl.textContent = '-- Hz';
            this.currentNoteEl.style.color = 'rgba(255,255,255,0.5)';
        }

        this.animationId = requestAnimationFrame(() => this.analyzeLoop());
    }

    drawChart() {
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        // Clear
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.fillRect(0, 0, width, height);

        if (this.targetNotes.length === 0) return;

        // Determine frequency range
        const minMidi = this.targetNotes[0].midi - 2;
        const maxMidi = this.targetNotes[this.targetNotes.length - 1].midi + 2;
        const midiRange = maxMidi - minMidi;

        // Y mapping: MIDI to canvas Y (inverted so higher pitch is higher on screen)
        const midiToY = (midi) => {
            return height - ((midi - minMidi) / midiRange) * (height - 40) - 20;
        };

        // Draw horizontal lines for target notes
        this.ctx.font = '12px system-ui';
        this.targetNotes.forEach((note, i) => {
            const y = midiToY(note.midi);

            // Draw line
            this.ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(50, y);
            this.ctx.lineTo(width - 10, y);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // Draw note label
            this.ctx.fillStyle = 'rgba(74, 222, 128, 0.9)';
            this.ctx.textAlign = 'right';
            this.ctx.fillText(note.name, 45, y + 4);
        });

        // Draw pitch history trace
        if (this.pitchHistory.length > 1) {
            const maxTime = this.pitchHistory[this.pitchHistory.length - 1].time;
            const timeWindow = Math.max(maxTime, 5000); // At least 5 seconds window

            this.ctx.lineWidth = 2;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            // Draw the trace
            this.ctx.beginPath();
            let started = false;

            for (let i = 0; i < this.pitchHistory.length; i++) {
                const point = this.pitchHistory[i];
                const x = 50 + (point.time / timeWindow) * (width - 60);
                const y = midiToY(point.midi);

                // Color based on accuracy
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
                    // Draw segments with individual colors
                    this.ctx.lineTo(x, y);
                    this.ctx.stroke();
                    this.ctx.beginPath();
                    this.ctx.moveTo(x, y);
                }
            }
            this.ctx.stroke();

            // Draw dots at each point
            for (let i = 0; i < this.pitchHistory.length; i += 3) { // Every 3rd point for performance
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

    analyzeResults() {
        const resultsPanel = document.getElementById('resultsPanel');
        resultsPanel.style.display = 'block';

        // Find which target notes were hit
        const targetMidis = this.targetNotes.map(n => n.midi);
        const noteHits = {};
        targetMidis.forEach(midi => {
            noteHits[midi] = { hits: 0, totalCents: 0, count: 0 };
        });

        // Analyze each pitch sample
        let totalAccurateSamples = 0;
        let totalCentsDeviation = 0;
        let validSamples = 0;

        this.pitchHistory.forEach(sample => {
            // Find nearest target note
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
                // Within a semitone of a target
                const cents = (sample.midi - nearestTarget) * 100;
                noteHits[nearestTarget].hits++;
                noteHits[nearestTarget].totalCents += Math.abs(cents);
                noteHits[nearestTarget].count++;

                totalCentsDeviation += Math.abs(cents);
                validSamples++;

                if (Math.abs(cents) < 25) {
                    totalAccurateSamples++;
                }
            }
        });

        // Calculate overall stats
        const accuracy = validSamples > 0 ? (totalAccurateSamples / validSamples * 100) : 0;
        const avgDeviation = validSamples > 0 ? (totalCentsDeviation / validSamples) : 0;
        const notesHitCount = Object.values(noteHits).filter(n => n.count > 5).length;

        // Update summary
        document.getElementById('overallAccuracy').textContent = accuracy.toFixed(0) + '%';
        document.getElementById('avgDeviation').textContent = avgDeviation.toFixed(1) + ' cents';
        document.getElementById('notesHit').textContent = notesHitCount + '/' + this.targetNotes.length;

        // Color the accuracy based on score
        const accEl = document.getElementById('overallAccuracy');
        if (accuracy >= 80) {
            accEl.style.color = '#4ade80';
        } else if (accuracy >= 60) {
            accEl.style.color = '#facc15';
        } else {
            accEl.style.color = '#f87171';
        }

        // Build note breakdown
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
                    statusIcon = 'check';
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

        this.updateStatus('Analysis complete! ' + accuracy.toFixed(0) + '% accuracy');
    }

    // Central method to stop any audio playback. 
    // Call this before starting any action that needs exclusive audio.
    stopScalePlayback() {
        this.isPlayingScale = false;

        // Cancel any scheduled events
        Tone.Transport.cancel();
        Tone.Transport.stop();

        // Release any currently playing notes
        if (this.synth) {
            this.synth.triggerRelease();
        }

        // Clear the status timeout
        if (this.playbackTimeoutId) {
            clearTimeout(this.playbackTimeoutId);
            this.playbackTimeoutId = null;
        }
    }

    async playReferenceScale() {
        // Stop any current playback first (idempotent)
        this.stopScalePlayback();

        this.isPlayingScale = true;

        if (!this.synth) {
            await Tone.start();
            this.synth = new Tone.Synth({
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.3 }
            }).toDestination();
        }

        this.updateStatus('Playing ' + this.rootNote + ' ' + this.scaleType + ' scale...');

        const noteDuration = 0.4;
        const gap = 0.1;

        // Schedule notes using Transport for cancelability
        Tone.Transport.cancel();
        this.targetNotes.forEach((note, i) => {
            const time = i * (noteDuration + gap);
            Tone.Transport.schedule((t) => {
                this.synth.triggerAttackRelease(note.freq, noteDuration, t);
            }, time);
        });

        Tone.Transport.start();

        // Reset status after playback completes naturally
        const totalDuration = this.targetNotes.length * (noteDuration + gap);
        this.playbackTimeoutId = setTimeout(() => {
            this.isPlayingScale = false;
            if (!this.isRecording) {
                this.updateStatus('Ready to record');
            }
            Tone.Transport.stop();
        }, totalDuration * 1000);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    window.pitchMeter = new PitchMeterController();
});

