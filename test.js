// @ts-check
//-----------------------------------------------------------------------
// TEST
// Standalone key-aware pitch trace and pattern guide page.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const state = {
        root: 'D#',
        octave: 3,
        scaleType: 'major',
        guideIntervalMs: 1000,
        patternText: '',
        playGuidesOnReset: false
    };

    const ADJUSTER_VALUES = {
        octave: [2, 3, 4],
        guideIntervalMs: [500, 750, 1000, 1250, 1500, 2000, 3000]
    };
    const ROOT_PITCH_MIN_MIDI = 36; // C2
    const ROOT_PITCH_MAX_MIDI = 71; // B4

    const GLITCH_JUMP_MIDI = 5.5;
    const GLITCH_WINDOW_MS = 220;
    const GLITCH_CONFIRM_MS = 260;
    const GLITCH_CONFIRM_MIDI = 1.2;

    /** @type {AudioContext | null} */
    let audioContext = null;
    /** @type {AnalyserNode | null} */
    let analyser = null;
    /** @type {MediaStreamAudioSourceNode | null} */
    let microphone = null;
    /** @type {MediaStream | null} */
    let stream = null;
    /** @type {number | null} */
    let animationId = null;
    /** @type {Array<{ time: number, freq: number, midi: number, cents: number, note: string }>} */
    let pitchHistory = [];
    /** @type {{ time: number, freq: number, midi: number, cents: number, note: string } | null} */
    let lastAcceptedPitch = null;
    /** @type {{ time: number, freq: number, midi: number, cents: number, note: string } | null} */
    let pendingPitchJump = null;
    let sessionStartedAt = 0;
    let isListening = false;
    let guidePlaybackToken = 0;

    function getEl(id) { return document.getElementById(id); }

    /**
     * @param {Float32Array} buffer
     * @param {number} sampleRate
     */
    function detectPitch(buffer, sampleRate) {
        const size = buffer.length;
        const maxSamples = Math.floor(size / 2);
        let bestOffset = -1;
        let bestCorrelation = 0;
        let foundGoodCorrelation = false;
        const correlations = new Array(maxSamples);

        let rms = 0;
        for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
        rms = Math.sqrt(rms / size);
        if (rms < 0.01) return -1;

        let lastCorrelation = 1;
        for (let offset = 0; offset < maxSamples; offset++) {
            let correlation = 0;
            for (let i = 0; i < maxSamples; i++) {
                correlation += Math.abs(buffer[i] - buffer[i + offset]);
            }
            correlation = 1 - correlation / maxSamples;
            correlations[offset] = correlation;

            if (correlation > 0.9 && correlation > lastCorrelation) {
                foundGoodCorrelation = true;
                if (correlation > bestCorrelation) {
                    bestCorrelation = correlation;
                    bestOffset = offset;
                }
            } else if (foundGoodCorrelation) {
                const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) / correlations[bestOffset];
                return sampleRate / (bestOffset + 8 * shift);
            }
            lastCorrelation = correlation;
        }

        if (bestCorrelation > 0.01 && bestOffset > 0) return sampleRate / bestOffset;
        return -1;
    }

    function rootMidi() {
        return noteNameToMidi(state.root, state.octave);
    }

    function scaleIntervals() {
        return (SCALE_PATTERNS[state.scaleType] || SCALE_PATTERNS.major).slice();
    }

    function scaleNotes() {
        const root = rootMidi();
        if (root === null) return [];
        return scaleIntervals().map((interval, index) => {
            const midi = root + interval;
            return {
                degree: index + 1,
                midi,
                noteName: midiToPitchString(midi)
            };
        });
    }

    function scaleRange() {
        const notes = scaleNotes();
        if (!notes.length) return { min: 0, max: 0 };
        return {
            min: notes[0].midi - 2,
            max: notes[notes.length - 1].midi + 2
        };
    }

    /** @param {number} midi */
    function isExtremeOutlier(midi) {
        const range = scaleRange();
        return midi < range.min || midi > range.max;
    }

    /** @param {{ time: number, freq: number, midi: number, cents: number, note: string }} sample */
    function recordPitchSample(sample) {
        if (isExtremeOutlier(sample.midi)) {
            pendingPitchJump = null;
            return false;
        }

        if (!lastAcceptedPitch) {
            pitchHistory.push(sample);
            lastAcceptedPitch = sample;
            return true;
        }

        const elapsedFromLast = sample.time - lastAcceptedPitch.time;
        const jumpFromLast = Math.abs(sample.midi - lastAcceptedPitch.midi);
        if (elapsedFromLast <= GLITCH_WINDOW_MS && jumpFromLast > GLITCH_JUMP_MIDI) {
            const confirmsPendingJump = pendingPitchJump
                && sample.time - pendingPitchJump.time <= GLITCH_CONFIRM_MS
                && Math.abs(sample.midi - pendingPitchJump.midi) <= GLITCH_CONFIRM_MIDI;

            if (!confirmsPendingJump) {
                pendingPitchJump = sample;
                return false;
            }

            pitchHistory.push(pendingPitchJump);
            pitchHistory.push(sample);
            lastAcceptedPitch = sample;
            pendingPitchJump = null;
            return true;
        }

        pendingPitchJump = null;
        pitchHistory.push(sample);
        lastAcceptedPitch = sample;
        return true;
    }

    function setStatus(message) {
        const el = getEl('statusReadout');
        if (el) el.textContent = message;
    }

    /**
     * @param {string} note
     * @param {number} cents
     * @param {number} freq
     */
    function updatePitchReadout(note, cents, freq) {
        const el = getEl('pitchReadout');
        if (!el) return;
        el.textContent = `Pitch: ${note} ${freq.toFixed(1)} Hz ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}c`;
    }

    function clearPitchReadout() {
        const el = getEl('pitchReadout');
        if (el) el.textContent = 'Pitch: --';
    }

    function resetTrace() {
        guidePlaybackToken++;
        pitchHistory = [];
        lastAcceptedPitch = null;
        pendingPitchJump = null;
        sessionStartedAt = performance.now();
        clearPitchReadout();
        setStatus(isListening ? 'Listening' : 'Ready');
        drawChart();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function ensureAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') await audioContext.resume();
        return audioContext;
    }

    /**
     * @param {number} midi
     * @param {number} durationMs
     */
    async function playGuideTone(midi, durationMs) {
        const ctx = await ensureAudioContext();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = midiToFreq(midi);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + durationMs / 1000 + 0.03);
    }

    async function playPatternGuide() {
        const notes = scaleNotes();
        const pattern = parsedPatternDegrees();
        if (!pattern.length) return;
        const token = ++guidePlaybackToken;
        const durationMs = Math.max(120, Math.min(650, state.guideIntervalMs * 0.7));

        for (const degree of pattern) {
            if (token !== guidePlaybackToken) return;
            const note = notes[degree - 1];
            if (note) await playGuideTone(note.midi, durationMs);
            await sleep(Math.max(80, state.guideIntervalMs - durationMs));
        }
    }

    async function resetFromButton() {
        resetTrace();
        if (state.playGuidesOnReset) await playPatternGuide();
    }

    function stopListening() {
        guidePlaybackToken++;
        isListening = false;
        if (animationId !== null) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        if (microphone) {
            microphone.disconnect();
            microphone = null;
        }
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        syncControls();
        setStatus('Stopped');
        drawChart();
    }

    function analyzeLoop() {
        if (!isListening || !analyser || !audioContext) return;

        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);
        const freq = detectPitch(buffer, audioContext.sampleRate);

        if (freq > 0 && freq < 2000) {
            const midi = freqToMidi(freq);
            const noteInfo = midiToNoteName(midi);
            const cents = getCentsDeviation(freq);
            const sample = {
                time: performance.now() - sessionStartedAt,
                freq,
                midi,
                cents,
                note: noteInfo.full
            };
            if (recordPitchSample(sample)) {
                updatePitchReadout(noteInfo.full, cents, freq);
                setStatus('Listening and drawing');
            }
        } else {
            pendingPitchJump = null;
            clearPitchReadout();
        }

        drawChart();
        animationId = requestAnimationFrame(analyzeLoop);
    }

    async function startListening() {
        if (isListening) {
            stopListening();
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus('Microphone unavailable');
            return;
        }

        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContext.state === 'suspended') await audioContext.resume();

            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            microphone = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            microphone.connect(analyser);

            isListening = true;
            resetTrace();
            syncControls();
            analyzeLoop();
        } catch (err) {
            console.error('Microphone access denied:', err);
            isListening = false;
            syncControls();
            setStatus('Microphone access denied');
        }
    }

    function parsedPatternDegrees() {
        const tokens = state.patternText.trim().split(/[\s,;/-]+/).filter(Boolean);
        const notes = scaleNotes();
        return tokens.map(token => Number(token))
            .filter(degree => Number.isInteger(degree) && degree >= 1 && degree <= notes.length);
    }

    function patternDurationMs() {
        const count = parsedPatternDegrees().length;
        return count ? count * state.guideIntervalMs : 0;
    }

    function timeWindowMs() {
        const elapsed = sessionStartedAt ? performance.now() - sessionStartedAt : 0;
        return Math.max(8000, patternDurationMs() + 1000, elapsed + 500);
    }

    function resizeCanvas() {
        const canvas = /** @type {HTMLCanvasElement | null} */ (getEl('testCanvas'));
        if (!canvas) return;
        const container = canvas.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        const cssHeight = canvas.getBoundingClientRect().height || 430;
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${cssHeight}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawChart();
    }

    function drawChart() {
        const canvas = /** @type {HTMLCanvasElement | null} */ (getEl('testCanvas'));
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        if (width <= 0 || height <= 0) return;

        const notes = scaleNotes();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
        ctx.fillRect(0, 0, width, height);
        if (!notes.length) return;

        const minMidi = notes[0].midi;
        const maxMidi = notes[notes.length - 1].midi;
        const midiRange = Math.max(maxMidi - minMidi, 1);
        const left = width < 520 ? 88 : 118;
        const right = 14;
        const top = 18;
        const bottom = 30;
        const graphWidth = Math.max(width - left - right, 1);
        const graphHeight = Math.max(height - top - bottom, 1);
        const timeWindow = timeWindowMs();

        /** @param {number} midi */
        const midiToY = (midi) => top + (maxMidi - Math.max(minMidi, Math.min(maxMidi, midi))) / midiRange * graphHeight;
        /** @param {number} ms */
        const timeToX = (ms) => left + Math.max(0, Math.min(timeWindow, ms)) / timeWindow * graphWidth;

        ctx.font = width < 520 ? '11px system-ui' : '12px system-ui';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        notes.forEach(note => {
            const y = midiToY(note.midi);
            ctx.strokeStyle = 'rgba(134, 239, 172, 0.46)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(width - right, y);
            ctx.stroke();

            ctx.fillStyle = 'rgba(216, 252, 225, 0.92)';
            ctx.fillText(`${note.degree} ${note.noteName}`, left - 8, y);
        });

        const pattern = parsedPatternDegrees();
        pattern.forEach((degree, index) => {
            const note = notes[degree - 1];
            if (!note) return;
            const x1 = timeToX(index * state.guideIntervalMs);
            const x2 = timeToX(index * state.guideIntervalMs + state.guideIntervalMs * 0.82);
            const y = midiToY(note.midi);
            ctx.fillStyle = 'rgba(96, 165, 250, 0.28)';
            ctx.strokeStyle = 'rgba(147, 197, 253, 0.92)';
            ctx.lineWidth = 2;
            ctx.fillRect(x1, y - 8, Math.max(x2 - x1, 6), 16);
            ctx.strokeRect(x1, y - 8, Math.max(x2 - x1, 6), 16);
            ctx.fillStyle = '#dbeafe';
            ctx.textAlign = 'left';
            ctx.fillText(String(degree), x1 + 4, y - 17);
        });

        if (pitchHistory.length > 1) {
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#facc15';
            ctx.beginPath();
            let previous = pitchHistory[0];
            ctx.moveTo(timeToX(previous.time), midiToY(previous.midi));
            for (let i = 1; i < pitchHistory.length; i++) {
                const point = pitchHistory[i];
                const fastJump = point.time - previous.time <= GLITCH_WINDOW_MS
                    && Math.abs(point.midi - previous.midi) > GLITCH_JUMP_MIDI;
                if (point.time - previous.time > 260 || fastJump) {
                    ctx.moveTo(timeToX(point.time), midiToY(point.midi));
                } else {
                    ctx.lineTo(timeToX(point.time), midiToY(point.midi));
                }
                previous = point;
            }
            ctx.stroke();

            for (let i = 0; i < pitchHistory.length; i += 3) {
                const point = pitchHistory[i];
                const absCents = Math.abs(point.cents);
                ctx.fillStyle = absCents < 12 ? '#4ade80' : absCents < 30 ? '#facc15' : '#fb7185';
                ctx.beginPath();
                ctx.arc(timeToX(point.time), midiToY(point.midi), 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (sessionStartedAt) {
            const x = timeToX(performance.now() - sessionStartedAt);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 5]);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, height - bottom);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    function syncControls() {
        document.querySelectorAll('[data-scale]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.getAttribute('data-scale') === state.scaleType);
        });
        document.querySelectorAll('[data-preset-key]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const key = btn.getAttribute('data-preset-key') || '';
            btn.classList.toggle('selected', String(state[key]) === btn.getAttribute('data-preset-value'));
        });
        document.querySelectorAll('[data-step-key]').forEach(el => {
            const btn = /** @type {HTMLButtonElement} */ (el);
            const key = btn.getAttribute('data-step-key') || '';
            const delta = Number(btn.getAttribute('data-step-delta') || 0);
            if (key === 'rootPitch') {
                const midi = rootMidi();
                btn.disabled = midi === null || (delta < 0 ? midi <= ROOT_PITCH_MIN_MIDI : midi >= ROOT_PITCH_MAX_MIDI);
                return;
            }
            const values = ADJUSTER_VALUES[key] || [];
            const index = values.indexOf(state[key]);
            btn.disabled = delta < 0 ? index <= 0 : index >= values.length - 1;
        });

        const startBtn = getEl('startBtn');
        if (startBtn) {
            startBtn.textContent = isListening ? 'Stop' : 'Start';
            startBtn.classList.toggle('listening', isListening);
        }
        const rootPitchValue = getEl('rootPitchValue');
        if (rootPitchValue) rootPitchValue.textContent = `${state.root}${state.octave}`;
        const intervalValue = getEl('guideIntervalValue');
        if (intervalValue) intervalValue.textContent = `${state.guideIntervalMs / 1000}s`;
    }

    /** @param {string} key @param {string | number} value */
    function setStateValue(key, value) {
        state[key] = value;
        syncControls();
        resetTrace();
    }

    /** @param {number} midi */
    function setRootPitchFromMidi(midi) {
        const bounded = Math.max(ROOT_PITCH_MIN_MIDI, Math.min(ROOT_PITCH_MAX_MIDI, midi));
        const info = midiToNoteName(bounded);
        state.root = info.name;
        state.octave = info.octave;
        syncControls();
        resetTrace();
    }

    /** @param {string} key @param {number} delta */
    function stepStateValue(key, delta) {
        if (key === 'rootPitch') {
            const midi = rootMidi();
            if (midi !== null) setRootPitchFromMidi(midi + delta);
            return;
        }

        const values = ADJUSTER_VALUES[key] || [];
        const index = values.indexOf(state[key]);
        if (index === -1) return;
        const nextIndex = Math.max(0, Math.min(values.length - 1, index + delta));
        if (nextIndex === index) return;
        setStateValue(key, values[nextIndex]);
    }

    function initUI() {
        document.querySelectorAll('[data-scale]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => setStateValue('scaleType', btn.getAttribute('data-scale') || state.scaleType));
        });
        document.querySelectorAll('[data-step-key]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => stepStateValue(btn.getAttribute('data-step-key') || '', Number(btn.getAttribute('data-step-delta') || 0)));
        });
        document.querySelectorAll('[data-preset-key]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => setStateValue(btn.getAttribute('data-preset-key') || '', Number(btn.getAttribute('data-preset-value') || 0)));
        });

        const patternInput = /** @type {HTMLInputElement | null} */ (getEl('patternInput'));
        if (patternInput) {
            state.patternText = patternInput.value;
            patternInput.addEventListener('input', () => {
                state.patternText = patternInput.value;
                drawChart();
            });
        }
        getEl('startBtn')?.addEventListener('click', startListening);
        getEl('resetBtn')?.addEventListener('click', resetFromButton);
        const playGuidesToggle = /** @type {HTMLInputElement | null} */ (getEl('playGuidesToggle'));
        if (playGuidesToggle) {
            playGuidesToggle.checked = state.playGuidesOnReset;
            playGuidesToggle.addEventListener('change', () => {
                state.playGuidesOnReset = playGuidesToggle.checked;
            });
        }
        window.addEventListener('resize', resizeCanvas);
        syncControls();
        resizeCanvas();
        resetTrace();
    }

    initUI();
})();
