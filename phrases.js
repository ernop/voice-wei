// @ts-check
//-----------------------------------------------------------------------
// PHRASES
// Dedicated phrase memory and reproduction practice.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const state = {
        root: 'D#',
        octave: 3,
        scaleType: 'major',
        startAtOne: true,
        allowOutOfOctave: false,
        minLength: 5,
        maxLength: 8,
        returnToInitial: true,
        returnToRoot: false,
        outputMode: 'tones',
        noteLengthMs: 300,
        gapMs: 0,
        showNoteNames: true,
        reflected: false,
        loopCurrent: false,
        testPanelOpen: false,
        testListening: false,
        showTestTargets: true,
        testPlayOnRestart: false
    };

    const STRUCTURE_KEYS = new Set([
        'startAtOne', 'allowOutOfOctave', 'minLength', 'maxLength',
        'returnToInitial', 'returnToRoot'
    ]);
    const PROJECT_KEYS = new Set(['root', 'octave', 'scaleType']);
    const PLAYBACK_KEYS = new Set(['outputMode', 'noteLengthMs', 'gapMs', 'showNoteNames']);
    const TEST_GLITCH_JUMP_MIDI = 5.5;
    const TEST_GLITCH_WINDOW_MS = 220;
    const TEST_GLITCH_CONFIRM_MS = 260;
    const TEST_GLITCH_CONFIRM_MIDI = 1.2;
    const ADJUSTER_VALUES = {
        noteLengthMs: [200, 250, 300, 350, 400, 450, 500, 600, 900, 1200, 1600],
        gapMs: [0, 100, 250, 500],
        minLength: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16],
        maxLength: [3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 32, 40, 50]
    };
    const ROOT_PITCH_MIN_MIDI = 36; // C2
    const ROOT_PITCH_MAX_MIDI = 71; // B4

    /** @type {InstanceType<typeof Tone.Sampler> | null} */
    let synth = null;
    /** @type {InstanceType<typeof Tone.Gain> | null} */
    let gainNode = null;
    /** @type {any | null} */
    let currentPhrase = null;
    /** @type {boolean[] } */
    let activeMask = [];
    /** @type {any[]} */
    const phraseHistory = [];
    let playToken = 0;
    let isPointerToggling = false;
    let pointerToggleValue = true;
    /** @type {AudioContext | null} */
    let testAudioContext = null;
    /** @type {AnalyserNode | null} */
    let testAnalyser = null;
    /** @type {MediaStreamAudioSourceNode | null} */
    let testMicrophone = null;
    /** @type {MediaStream | null} */
    let testStream = null;
    /** @type {number | null} */
    let testAnimationId = null;
    /** @type {Array<{ time: number, freq: number, midi: number, cents: number, note: string }>} */
    let testPitchHistory = [];
    /** @type {{ time: number, freq: number, midi: number, cents: number, note: string } | null} */
    let testLastAcceptedPitch = null;
    /** @type {{ time: number, freq: number, midi: number, cents: number, note: string } | null} */
    let testPendingPitchJump = null;
    let testSessionStartedAt = 0;
    let testVoiceElapsedMs = 0;
    /** @type {number | null} */
    let testLastVoiceAt = null;

    function getEl(id) { return document.getElementById(id); }
    function setStatus(text) { const el = getEl('phraseStatus'); if (el) el.textContent = text; }

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
                onload: () => resolve(undefined),
                onerror: reject
            }).connect(gainNode);
            synth.volume.value = -3;
        });
    }

    async function ensureAudioStarted() {
        if (Tone.context.state !== 'running') await Tone.start();
    }

    function cancelCurrentSound() {
        if (synth) synth.releaseAll();
        if (gainNode) gainNode.gain.setValueAtTime(0, Tone.now());
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    function stopPlayback(status = 'Stopped') {
        playToken++;
        state.loopCurrent = false;
        syncRepeatButton();
        cancelCurrentSound();
        setStatus(status);
    }

    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

    function playMidi(midi) {
        if (!synth || !gainNode) return;
        gainNode.gain.setValueAtTime(1, Tone.now());
        synth.triggerAttackRelease(midiToPitchString(midi), state.noteLengthMs / 1000);
    }

    function buildPhrase() {
        return PatternPracticeCore.generatePhrase({
            root: state.root,
            octave: state.octave,
            scaleType: state.scaleType,
            startAtOne: state.startAtOne,
            allowOutOfOctave: state.allowOutOfOctave,
            minLength: state.minLength,
            maxLength: state.maxLength,
            returnToInitial: state.returnToInitial,
            returnToRoot: state.returnToRoot
        });
    }

    function rootMidi() { return noteNameToMidi(state.root, state.octave); }

    function deriveDisplayPhrase() {
        if (!currentPhrase) return null;
        const root = rootMidi();
        if (root === null) return currentPhrase;

        const offsets = state.reflected
            ? PatternPracticeCore.reflectOffsets(currentPhrase.offsets, state.scaleType)
            : currentPhrase.offsets;
        const dp = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const midiNotes = offsets.map(offset => PatternPracticeCore.scaleOffsetToMidi(root, state.scaleType, offset));

        return {
            ...currentPhrase,
            root: state.root,
            scaleType: state.scaleType,
            octave: state.octave,
            offsets,
            midiNotes,
            displayDegrees: offsets.map(offset => PatternPracticeCore.offsetToDegree(offset, dp)),
            spokenDegrees: offsets.map(offset => PatternPracticeCore.offsetToSpoken(offset, dp)),
            noteNames: midiNotes.map(midi => midiToPitchString(midi))
        };
    }


    function renderPhraseUnits(phrase) {
        const degreesEl = getEl('phraseDegrees');
        if (!degreesEl) return;
        degreesEl.textContent = '';
        phrase.displayDegrees.forEach((degree, index) => {
            const unit = document.createElement('span');
            unit.className = 'phrase-note-unit';
            unit.dataset.index = String(index);
            unit.classList.toggle('inactive', activeMask[index] === false);

            const token = document.createElement('span');
            token.className = 'phrase-degree-token';
            token.dataset.index = String(index);
            token.textContent = degree;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'phrase-note-toggle';
            btn.textContent = activeMask[index] === false ? 'off' : 'on';
            btn.title = `${degree} ${phrase.noteNames[index]}`;
            btn.dataset.index = String(index);
            btn.classList.toggle('inactive', activeMask[index] === false);
            btn.addEventListener('pointerdown', event => {
                event.preventDefault();
                isPointerToggling = true;
                pointerToggleValue = activeMask[index] === false;
                setNoteActive(index, pointerToggleValue);
            });
            btn.addEventListener('pointerenter', () => {
                if (isPointerToggling) setNoteActive(index, pointerToggleValue);
            });

            unit.appendChild(token);
            unit.appendChild(btn);
            degreesEl.appendChild(unit);
        });
    }

    function activeIndexes(phrase) {
        const indexes = [];
        for (let i = 0; i < phrase.midiNotes.length; i++) {
            if (activeMask[i] !== false) indexes.push(i);
        }
        if (indexes.length) return indexes;
        return phrase.midiNotes.map((_, i) => i);
    }

    /** @param {number} degree */
    function ordinalForDegree(degree) {
        const names = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
        return names[degree] || `${degree}th`;
    }

    /**
     * @param {number} offset
     * @param {number} degreesPerOctave
     */
    function describeScaleOffset(offset, degreesPerOctave) {
        if (offset < 0) {
            const degree = PatternPracticeCore.positiveModulo(offset, degreesPerOctave) + 1;
            return `${degree} below`;
        }
        if (offset === degreesPerOctave) return `${degreesPerOctave + 1} ${ordinalForDegree(degreesPerOctave + 1)}`;
        if (offset > degreesPerOctave) {
            const degree = PatternPracticeCore.positiveModulo(offset, degreesPerOctave) + 1;
            return `${degree} above`;
        }
        const degree = offset + 1;
        return `${degree} ${ordinalForDegree(degree)}`;
    }

    /**
     * @param {any} phrase
     * @returns {Array<{ offset: number, midi: number, label: string, noteName: string }>}
     */
    function buildPhraseTestScaleLines(phrase) {
        const root = rootMidi();
        if (root === null || !phrase) return [];
        const degreesPerOctave = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const lines = [];
        const phraseOffsets = Array.isArray(phrase.offsets) ? phrase.offsets : [];
        const lowerOffset = Math.min(-1, ...phraseOffsets) - 1;
        const upperOffset = Math.max(degreesPerOctave + 1, ...phraseOffsets) + 1;
        for (let offset = lowerOffset; offset <= upperOffset; offset++) {
            const midi = PatternPracticeCore.scaleOffsetToMidi(root, state.scaleType, offset);
            lines.push({
                offset,
                midi,
                label: describeScaleOffset(offset, degreesPerOctave),
                noteName: midiToPitchString(midi)
            });
        }
        return lines;
    }

    /** @param {any} phrase */
    function phraseTestDurationMs(phrase) {
        if (!phrase) return 4000;
        const noteCount = Math.max(phrase.midiNotes.length, 1);
        const phraseMs = (noteCount * (state.noteLengthMs + state.gapMs)) - state.gapMs;
        return Math.max(1200, phraseMs);
    }

    /** @param {any} phrase */
    function phraseTestTimeWindowMs(phrase) {
        return Math.max(4000, phraseTestDurationMs(phrase) + 700, testVoiceElapsedMs + 250);
    }

    function syncPhraseTestControls() {
        const panel = getEl('phraseTestPanel');
        if (panel) panel.hidden = !state.testPanelOpen;

        const listenBtn = getEl('phraseTestListenBtn');
        if (listenBtn) {
            listenBtn.classList.toggle('listening', state.testListening);
            listenBtn.setAttribute('aria-pressed', String(state.testListening));
            listenBtn.textContent = state.testListening ? 'Listening On' : 'Listening Off';
        }

        const targetsBtn = getEl('phraseTestTargetsBtn');
        if (targetsBtn) {
            targetsBtn.classList.toggle('selected', state.showTestTargets);
            targetsBtn.setAttribute('aria-pressed', String(state.showTestTargets));
            targetsBtn.textContent = state.showTestTargets ? 'Targets On' : 'Targets Off';
        }

        syncPhraseTestPlayToggle();
    }

    /** @param {string} message */
    function setPhraseTestStatus(message) {
        const el = getEl('phraseTestStatus');
        if (el) el.textContent = message;
    }

    /**
     * @param {string} note
     * @param {number} cents
     * @param {number} freq
     */
    function updatePhraseTestReadout(note, cents, freq) {
        const pitchEl = getEl('phraseTestPitch');
        const centsEl = getEl('phraseTestCents');
        if (pitchEl) pitchEl.textContent = `Pitch: ${note} ${freq.toFixed(1)} Hz`;
        if (centsEl) centsEl.textContent = `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents`;
    }

    function clearPhraseTestReadout() {
        const pitchEl = getEl('phraseTestPitch');
        const centsEl = getEl('phraseTestCents');
        if (pitchEl) pitchEl.textContent = 'Pitch: --';
        if (centsEl) centsEl.textContent = '-- cents';
    }

    function resetPhraseTestSession() {
        testPitchHistory = [];
        testLastAcceptedPitch = null;
        testPendingPitchJump = null;
        testVoiceElapsedMs = 0;
        testLastVoiceAt = null;
        testSessionStartedAt = performance.now();
        clearPhraseTestReadout();
        setPhraseTestStatus('Sing to start time');
        drawPhraseTest();
    }

    function nextPhraseTestVoiceTime() {
        const now = performance.now();
        if (testLastVoiceAt === null) {
            testLastVoiceAt = now;
            return testVoiceElapsedMs;
        }

        const delta = now - testLastVoiceAt;
        testLastVoiceAt = now;
        if (delta <= 240) testVoiceElapsedMs += delta;
        return testVoiceElapsedMs;
    }

    /** @param {{ time: number, freq: number, midi: number, cents: number, note: string }} sample */
    function recordPhraseTestPitchSample(sample) {
        if (!testLastAcceptedPitch) {
            testPitchHistory.push(sample);
            testLastAcceptedPitch = sample;
            return true;
        }

        const elapsedFromLast = sample.time - testLastAcceptedPitch.time;
        const jumpFromLast = Math.abs(sample.midi - testLastAcceptedPitch.midi);
        if (elapsedFromLast <= TEST_GLITCH_WINDOW_MS && jumpFromLast > TEST_GLITCH_JUMP_MIDI) {
            const confirmsPendingJump = testPendingPitchJump
                && sample.time - testPendingPitchJump.time <= TEST_GLITCH_CONFIRM_MS
                && Math.abs(sample.midi - testPendingPitchJump.midi) <= TEST_GLITCH_CONFIRM_MIDI;

            if (!confirmsPendingJump) {
                testPendingPitchJump = sample;
                return false;
            }

            testPitchHistory.push(testPendingPitchJump);
            testPitchHistory.push(sample);
            testLastAcceptedPitch = sample;
            testPendingPitchJump = null;
            return true;
        }

        testPendingPitchJump = null;
        testPitchHistory.push(sample);
        testLastAcceptedPitch = sample;
        return true;
    }

    function resizePhraseTestCanvas() {
        const canvas = /** @type {HTMLCanvasElement | null} */ (getEl('phraseTestCanvas'));
        if (!canvas || !state.testPanelOpen) return;
        const container = canvas.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        const cssHeight = canvas.getBoundingClientRect().height || 380;
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${cssHeight}px`;

        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawPhraseTest();
    }

    function drawPhraseTest() {
        if (!state.testPanelOpen) return;

        const canvas = /** @type {HTMLCanvasElement | null} */ (getEl('phraseTestCanvas'));
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        if (width <= 0 || height <= 0) return;

        const phrase = phraseForPlayback();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
        ctx.fillRect(0, 0, width, height);

        if (!phrase) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.font = '14px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('Generate a phrase, then press Test.', width / 2, height / 2);
            return;
        }

        const scaleLines = buildPhraseTestScaleLines(phrase);
        if (!scaleLines.length) return;

        const minMidi = Math.min(...scaleLines.map(line => line.midi));
        const maxMidi = Math.max(...scaleLines.map(line => line.midi));
        const midiRange = Math.max(maxMidi - minMidi, 1);
        const left = width < 520 ? 96 : 132;
        const right = 16;
        const top = 18;
        const bottom = 28;
        const graphWidth = Math.max(width - left - right, 1);
        const graphHeight = Math.max(height - top - bottom, 1);
        const timeWindow = phraseTestTimeWindowMs(phrase);
        const phraseDuration = phraseTestDurationMs(phrase);

        /** @param {number} midi */
        const midiToY = (midi) => {
            const clamped = Math.max(minMidi, Math.min(maxMidi, midi));
            return top + (maxMidi - clamped) / midiRange * graphHeight;
        };
        /** @param {number} ms */
        const timeToX = (ms) => left + Math.max(0, Math.min(timeWindow, ms)) / timeWindow * graphWidth;

        ctx.font = width < 520 ? '11px system-ui' : '12px system-ui';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        scaleLines.forEach(line => {
            const y = midiToY(line.midi);
            const isOctave = line.offset >= 0 && line.offset <= PatternPracticeCore.degreesPerOctave(state.scaleType);
            ctx.strokeStyle = isOctave ? 'rgba(134, 239, 172, 0.46)' : 'rgba(134, 239, 172, 0.22)';
            ctx.lineWidth = isOctave ? 1.3 : 1;
            ctx.setLineDash(isOctave ? [] : [4, 6]);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(width - right, y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = isOctave ? 'rgba(216, 252, 225, 0.92)' : 'rgba(216, 252, 225, 0.55)';
            ctx.fillText(`${line.label} ${line.noteName}`, left - 8, y);
        });

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, height - bottom);
        ctx.lineTo(width - right, height - bottom);
        ctx.stroke();

        if (state.showTestTargets) {
            const stepMs = state.noteLengthMs + state.gapMs;
            phrase.midiNotes.forEach((midi, index) => {
                const y = midiToY(midi);
                const x1 = timeToX(index * stepMs);
                const x2 = timeToX(Math.min(index * stepMs + state.noteLengthMs, phraseDuration));
                const targetWidth = Math.max(x2 - x1, 5);
                const active = activeMask[index] !== false;
                ctx.fillStyle = active ? 'rgba(96, 165, 250, 0.3)' : 'rgba(148, 163, 184, 0.15)';
                ctx.strokeStyle = active ? 'rgba(147, 197, 253, 0.9)' : 'rgba(148, 163, 184, 0.38)';
                ctx.lineWidth = active ? 2 : 1;
                ctx.fillRect(x1, y - 8, targetWidth, 16);
                ctx.strokeRect(x1, y - 8, targetWidth, 16);
                ctx.fillStyle = active ? '#dbeafe' : 'rgba(226, 232, 240, 0.45)';
                ctx.font = width < 520 ? '10px system-ui' : '11px system-ui';
                ctx.textAlign = 'left';
                ctx.fillText(phrase.displayDegrees[index], x1 + 4, y - 16);
            });
        }

        if (testPitchHistory.length > 1) {
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#facc15';
            ctx.beginPath();
            let previous = testPitchHistory[0];
            ctx.moveTo(timeToX(previous.time), midiToY(previous.midi));
            for (let i = 1; i < testPitchHistory.length; i++) {
                const point = testPitchHistory[i];
                const fastJump = point.time - previous.time <= TEST_GLITCH_WINDOW_MS
                    && Math.abs(point.midi - previous.midi) > TEST_GLITCH_JUMP_MIDI;
                if (point.time - previous.time > 240 || fastJump) {
                    ctx.moveTo(timeToX(point.time), midiToY(point.midi));
                } else {
                    ctx.lineTo(timeToX(point.time), midiToY(point.midi));
                }
                previous = point;
            }
            ctx.stroke();

            for (let i = 0; i < testPitchHistory.length; i += 3) {
                const point = testPitchHistory[i];
                const absCents = Math.abs(point.cents);
                ctx.fillStyle = absCents < 12 ? '#4ade80' : absCents < 30 ? '#facc15' : '#fb7185';
                ctx.beginPath();
                ctx.arc(timeToX(point.time), midiToY(point.midi), 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (testSessionStartedAt) {
            const x = timeToX(testVoiceElapsedMs);
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

    function updatePhraseDisplay() {
        const degreesEl = getEl('phraseDegrees');
        const notesEl = getEl('phraseNotes');
        if (!degreesEl || !notesEl) return;
        const phrase = deriveDisplayPhrase();
        if (!phrase) {
            degreesEl.textContent = '--';
            notesEl.textContent = '';
            const togglesEl = getEl('phraseNoteToggles');
            if (togglesEl) togglesEl.textContent = '';
            return;
        }
        renderPhraseUnits(phrase);
        notesEl.textContent = state.showNoteNames ? phrase.noteNames.join(' ') : '';
        drawPhraseTest();
    }

    function generatePhrase() {
        currentPhrase = buildPhrase();
        if (!currentPhrase) { setStatus('Could not generate phrase'); return null; }
        activeMask = currentPhrase.midiNotes.map(() => true);
        phraseHistory.unshift(currentPhrase);
        if (phraseHistory.length > 50) phraseHistory.pop();
        updatePhraseDisplay();
        renderHistory();
        return currentPhrase;
    }

    function phraseForPlayback() { return deriveDisplayPhrase(); }

    async function playPhraseOnce(phrase, token) {
        updatePhraseDisplay();
        setStatus(`Playing ${phrase.displayDegrees.join(' ')}`);
        if (state.outputMode === 'none') { setStatus('No audio'); return; }
        if (state.outputMode === 'display') { setStatus('Displayed'); return; }
        if (state.outputMode === 'speak') {
            await VoiceOutput.speak(activeIndexes(phrase).map(i => phrase.spokenDegrees[i]).join(', '));
            if (token === playToken) setStatus('Ready');
            return;
        }
        if (state.outputMode === 'speak_tones') {
            await VoiceOutput.speak(activeIndexes(phrase).map(i => phrase.spokenDegrees[i]).join(', '));
            if (token !== playToken) return;
            await playToneSequence(phrase, token);
            return;
        }
        if (state.outputMode === 'sing_numbers') {
            await playSingNumberSequence(phrase, token);
            return;
        }
        await playToneSequence(phrase, token);
    }

    async function playPhrase(phrase) {
        await ensureAudioStarted();
        cancelCurrentSound();
        const token = ++playToken;
        do {
            await playPhraseOnce(phrase, token);
            if (token !== playToken || !state.loopCurrent) break;
            setStatus('Repeating');
            await sleep(650);
        } while (token === playToken && state.loopCurrent);
    }

    async function playToneSequence(phrase, token) {
        for (const i of activeIndexes(phrase)) {
            if (token !== playToken) return;
            const midi = phrase.midiNotes[i];
            setStatus(`${phrase.displayDegrees[i]} | ${midiToPitchString(midi)}`);
            playMidi(midi);
            await sleep(state.noteLengthMs + state.gapMs);
        }
        if (token === playToken && !state.loopCurrent) setStatus('Ready');
    }

    function speakNumberAtPitch(text, midi, durationMs) {
        return new Promise(resolve => {
            if (!('speechSynthesis' in window)) { resolve(undefined); return; }
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.pitch = PatternPracticeCore.midiToSpeechPitch(midi);
            utterance.rate = state.noteLengthMs >= 1000 ? 0.85 : 1.0;
            utterance.volume = 1.0;
            let settled = false;
            const finish = () => { if (settled) return; settled = true; resolve(undefined); };
            utterance.onend = finish;
            utterance.onerror = finish;
            window.speechSynthesis.speak(utterance);
            setTimeout(finish, Math.max(250, durationMs + 250));
        });
    }

    async function playSingNumberSequence(phrase, token) {
        for (const i of activeIndexes(phrase)) {
            if (token !== playToken) return;
            const midi = phrase.midiNotes[i];
            const degree = phrase.displayDegrees[i];
            setStatus(`${degree} | ${midiToPitchString(midi)}`);
            await speakNumberAtPitch(phrase.spokenDegrees[i], midi, state.noteLengthMs);
            if (state.gapMs > 0) await sleep(state.gapMs);
        }
        if (token === playToken && !state.loopCurrent) setStatus('Ready');
    }

    async function playCurrentOrNew() {
        if (!currentPhrase) generatePhrase();
        const phrase = phraseForPlayback();
        if (phrase) await playPhrase(phrase);
    }

    async function playNext() {
        closePhraseTestMode();
        state.loopCurrent = false;
        syncRepeatButton();
        generatePhrase();
        const phrase = phraseForPlayback();
        if (phrase) await playPhrase(phrase);
    }

    async function toggleRepeatLoop() {
        if (!currentPhrase) generatePhrase();
        state.loopCurrent = !state.loopCurrent;
        syncRepeatButton();
        if (state.loopCurrent) {
            const phrase = phraseForPlayback();
            if (phrase) await playPhrase(phrase);
        } else {
            stopPlayback('Repeat off');
        }
    }

    function syncRepeatButton() {
        const btn = getEl('repeatBtn');
        if (!btn) return;
        btn.classList.toggle('selected', state.loopCurrent);
        btn.setAttribute('aria-pressed', String(state.loopCurrent));
        const text = btn.querySelector('.button-text');
        if (text) text.textContent = state.loopCurrent ? 'Repeat On' : 'Repeat Off';
    }

    function renderNoteToggles(phrase) {
        const container = getEl('phraseNoteToggles');
        if (container) container.textContent = '';
    }

    function setNoteActive(index, active) {
        activeMask[index] = active;
        const btn = document.querySelector(`.phrase-note-toggle[data-index="${index}"]`);
        if (btn) {
            btn.classList.toggle('inactive', !active);
            btn.textContent = active ? 'on' : 'off';
        }
        const token = document.querySelector(`.phrase-degree-token[data-index="${index}"]`);
        if (token) token.classList.toggle('inactive', !active);
        const unit = document.querySelector(`.phrase-note-unit[data-index="${index}"]`);
        if (unit) unit.classList.toggle('inactive', !active);
        drawPhraseTest();
    }

    function endPointerToggle() { isPointerToggling = false; }

    function setAllNotes(active) {
        if (!currentPhrase) return;
        activeMask = currentPhrase.midiNotes.map(() => active);
        renderPhraseUnits(deriveDisplayPhrase());
        drawPhraseTest();
    }

    function stopPhraseTestListening() {
        state.testListening = false;
        if (testAnimationId !== null) {
            cancelAnimationFrame(testAnimationId);
            testAnimationId = null;
        }
        if (testMicrophone) {
            testMicrophone.disconnect();
            testMicrophone = null;
        }
        if (testStream) {
            testStream.getTracks().forEach(track => track.stop());
            testStream = null;
        }
        testLastVoiceAt = null;
        syncPhraseTestControls();
        setPhraseTestStatus('Listening off');
        drawPhraseTest();
    }

    function closePhraseTestMode() {
        if (!state.testPanelOpen && !state.testListening) return;
        stopPhraseTestListening();
        state.testPanelOpen = false;
        syncPhraseTestControls();
        clearPhraseTestReadout();
        setPhraseTestStatus('Ready');
    }

    function runPhraseTestPitchLoop() {
        if (!state.testListening || !testAnalyser || !testAudioContext) return;

        const buffer = new Float32Array(testAnalyser.fftSize);
        testAnalyser.getFloatTimeDomainData(buffer);
        const freq = detectPitch(buffer, testAudioContext.sampleRate);

        if (freq > 0 && freq < 2000) {
            const midi = freqToMidi(freq);
            const noteInfo = midiToNoteName(midi);
            const cents = getCentsDeviation(freq);
            const sample = {
                time: nextPhraseTestVoiceTime(),
                freq,
                midi,
                cents,
                note: noteInfo.full
            };
            const accepted = recordPhraseTestPitchSample(sample);
            if (accepted) {
                updatePhraseTestReadout(noteInfo.full, cents, freq);
                setPhraseTestStatus('Listening and drawing');
            }
        } else {
            testPendingPitchJump = null;
            testLastVoiceAt = null;
            clearPhraseTestReadout();
        }

        drawPhraseTest();
        testAnimationId = requestAnimationFrame(runPhraseTestPitchLoop);
    }

    async function startPhraseTestListening() {
        if (state.testListening) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setPhraseTestStatus('Microphone is unavailable in this browser');
            return;
        }

        try {
            if (!testAudioContext) {
                testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (testAudioContext.state === 'suspended') await testAudioContext.resume();

            testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            testMicrophone = testAudioContext.createMediaStreamSource(testStream);
            testAnalyser = testAudioContext.createAnalyser();
            testAnalyser.fftSize = 2048;
            testMicrophone.connect(testAnalyser);

            state.testListening = true;
            syncPhraseTestControls();
            setPhraseTestStatus('Sing to start time');
            runPhraseTestPitchLoop();
        } catch (err) {
            console.error('Microphone access denied:', err);
            state.testListening = false;
            syncPhraseTestControls();
            setPhraseTestStatus('Microphone access denied. Allow microphone access and try Test again.');
        }
    }

    async function restartPhraseTest() {
        if (!currentPhrase) generatePhrase();
        state.testPanelOpen = true;
        syncPhraseTestControls();
        resizePhraseTestCanvas();
        resetPhraseTestSession();
        await startPhraseTestListening();
        const phrase = phraseForPlayback();
        if (phrase && state.testPlayOnRestart) await playPhrase(phrase);
    }

    async function startPhraseTest() {
        if (!currentPhrase) generatePhrase();
        state.testPanelOpen = true;
        syncPhraseTestControls();
        resizePhraseTestCanvas();
        await restartPhraseTest();
    }

    async function togglePhraseTestListening() {
        if (state.testListening) {
            stopPhraseTestListening();
            return;
        }
        if (!testSessionStartedAt) resetPhraseTestSession();
        await startPhraseTestListening();
    }

    function togglePhraseTestTargets() {
        state.showTestTargets = !state.showTestTargets;
        syncPhraseTestControls();
        drawPhraseTest();
    }

    function syncPhraseTestPlayToggle() {
        const el = /** @type {HTMLInputElement | null} */ (getEl('phraseTestPlayToggle'));
        if (el) el.checked = state.testPlayOnRestart;
    }

    function renderHistory() {
        const list = getEl('historyList');
        if (!list) return;
        list.textContent = '';
        if (!phraseHistory.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'No phrases yet';
            list.appendChild(empty);
            return;
        }
        phraseHistory.forEach((phrase, index) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            const playBtn = document.createElement('button');
            playBtn.className = 'history-play-btn';
            playBtn.type = 'button';
            playBtn.title = 'Play phrase';
            playBtn.textContent = '>';
            playBtn.addEventListener('click', async () => {
                currentPhrase = phrase;
                activeMask = phrase.midiNotes.map(() => true);
                updatePhraseDisplay();
                const playbackPhrase = phraseForPlayback();
                if (playbackPhrase) await playPhrase(playbackPhrase);
            });
            const text = document.createElement('div');
            text.className = 'history-text';
            const degrees = document.createElement('div');
            degrees.className = 'phrase-history-degrees';
            degrees.textContent = phrase.displayDegrees.join(' ');
            const notes = document.createElement('div');
            notes.className = 'history-transcript';
            notes.textContent = phrase.noteNames.join(' ');
            const time = document.createElement('span');
            time.className = 'history-time';
            time.textContent = index === 0 ? 'new' : '';
            text.appendChild(degrees);
            text.appendChild(notes);
            item.appendChild(playBtn);
            item.appendChild(text);
            item.appendChild(time);
            list.appendChild(item);
        });
    }


    function syncSingleSelect(attr, expectedValue) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.getAttribute(attr) === String(expectedValue));
        });
    }

    function formatSeconds(ms) {
        return `${ms / 1000}s`;
    }

    function setValueText(id, text) {
        const el = getEl(id);
        if (el) el.textContent = text;
    }

    function syncLengthControls() {
        syncSingleSelect('data-min-length', state.minLength);
        syncSingleSelect('data-max-length', state.maxLength);
        setValueText('minLengthValue', String(state.minLength));
        setValueText('maxLengthValue', String(state.maxLength));
    }

    function syncAdjusterControls() {
        setValueText('rootPitchValue', `${state.root}${state.octave}`);
        setValueText('noteLengthValue', formatSeconds(state.noteLengthMs));
        setValueText('gapValue', formatSeconds(state.gapMs));
        syncLengthControls();

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
    }

    function onSettingChanged(key) {
        if (STRUCTURE_KEYS.has(key)) {
            if (currentPhrase) {
                stopPlayback('Regenerated');
                generatePhrase();
            }
            return;
        }
        if (PROJECT_KEYS.has(key) || PLAYBACK_KEYS.has(key)) {
            updatePhraseDisplay();
            if (currentPhrase) playCurrentOrNew();
        }
    }

    function wireSingleSelect(attr, stateKey, parse) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const raw = btn.getAttribute(attr) || '';
            if (String(parse(raw)) === String(state[stateKey])) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                document.querySelectorAll(`[${attr}]`).forEach(other => other.classList.remove('selected'));
                btn.classList.add('selected');
                state[stateKey] = parse(raw);
                if (state.minLength > state.maxLength) {
                    if (stateKey === 'maxLength') state.minLength = state.maxLength;
                    else state.maxLength = state.minLength;
                    syncLengthControls();
                }
                onSettingChanged(stateKey);
            });
        });
    }

    function normalizeLengthBounds(key) {
        if (state.minLength > state.maxLength) {
            if (key === 'maxLength') state.minLength = state.maxLength;
            else state.maxLength = state.minLength;
        }
    }

    function setAdjusterValue(key, value) {
        state[key] = value;
        normalizeLengthBounds(key);
        syncAdjusterControls();
        onSettingChanged(key);
    }

    /** @param {number} midi */
    function setRootPitchFromMidi(midi) {
        const bounded = PatternPracticeCore.clamp(midi, ROOT_PITCH_MIN_MIDI, ROOT_PITCH_MAX_MIDI);
        const info = midiToNoteName(bounded);
        state.root = info.name;
        state.octave = info.octave;
        syncAdjusterControls();
        onSettingChanged('root');
    }

    function stepAdjusterValue(key, delta) {
        if (key === 'rootPitch') {
            const midi = rootMidi();
            if (midi !== null) setRootPitchFromMidi(midi + delta);
            return;
        }

        const values = ADJUSTER_VALUES[key] || [];
        const index = values.indexOf(state[key]);
        if (index === -1) return;
        const nextIndex = PatternPracticeCore.clamp(index + delta, 0, values.length - 1);
        if (nextIndex === index) return;
        setAdjusterValue(key, values[nextIndex]);
    }

    function wireAdjusters() {
        document.querySelectorAll('[data-step-key]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                stepAdjusterValue(btn.getAttribute('data-step-key') || '', Number(btn.getAttribute('data-step-delta') || 0));
            });
        });

    }

    function wireToggle(id, stateKey) {
        const el = /** @type {HTMLInputElement | null} */ (getEl(id));
        if (!el) return;
        el.checked = Boolean(state[stateKey]);
        el.addEventListener('change', () => {
            state[stateKey] = el.checked;
            onSettingChanged(stateKey);
        });
    }

    function toggleReflect() {
        state.reflected = !state.reflected;
        const btn = getEl('reflectBtn');
        if (btn) {
            btn.classList.toggle('selected', state.reflected);
            btn.setAttribute('aria-pressed', String(state.reflected));
            btn.textContent = state.reflected ? 'Reflect On' : 'Reflect Off';
        }
        updatePhraseDisplay();
        if (currentPhrase) playCurrentOrNew();
    }

    function initUI() {
        wireSingleSelect('data-root', 'root', String);
        wireSingleSelect('data-octave', 'octave', Number);
        wireSingleSelect('data-scale', 'scaleType', String);
        wireSingleSelect('data-start', 'startAtOne', value => value === 'one');
        wireSingleSelect('data-range', 'allowOutOfOctave', value => value === 'expanded');
        wireSingleSelect('data-return-initial', 'returnToInitial', value => value === 'yes');
        wireSingleSelect('data-min-length', 'minLength', Number);
        wireSingleSelect('data-max-length', 'maxLength', Number);
        wireSingleSelect('data-output', 'outputMode', String);
        wireSingleSelect('data-length', 'noteLengthMs', Number);
        wireSingleSelect('data-gap', 'gapMs', Number);
        wireAdjusters();
        wireToggle('showNamesToggle', 'showNoteNames');
        getEl('playBtn')?.addEventListener('click', playCurrentOrNew);
        getEl('repeatBtn')?.addEventListener('click', toggleRepeatLoop);
        getEl('testBtn')?.addEventListener('click', startPhraseTest);
        getEl('nextBtn')?.addEventListener('click', playNext);
        getEl('stopBtn')?.addEventListener('click', () => {
            closePhraseTestMode();
            stopPlayback();
        });
        getEl('reflectBtn')?.addEventListener('click', toggleReflect);
        getEl('allNotesBtn')?.addEventListener('click', () => setAllNotes(true));
        getEl('phraseTestRestartBtn')?.addEventListener('click', restartPhraseTest);
        getEl('phraseTestListenBtn')?.addEventListener('click', togglePhraseTestListening);
        getEl('phraseTestTargetsBtn')?.addEventListener('click', togglePhraseTestTargets);
        const phraseTestPlayToggle = /** @type {HTMLInputElement | null} */ (getEl('phraseTestPlayToggle'));
        if (phraseTestPlayToggle) {
            phraseTestPlayToggle.checked = state.testPlayOnRestart;
            phraseTestPlayToggle.addEventListener('change', () => {
                state.testPlayOnRestart = phraseTestPlayToggle.checked;
            });
        }
        getEl('clearHistoryBtn')?.addEventListener('click', () => { phraseHistory.length = 0; renderHistory(); });
        window.addEventListener('pointerup', endPointerToggle);
        window.addEventListener('pointercancel', endPointerToggle);
        window.addEventListener('resize', resizePhraseTestCanvas);
        updatePhraseDisplay();
        renderHistory();
        syncRepeatButton();
        syncPhraseTestControls();
        syncAdjusterControls();
    }

    async function boot() {
        setStatus('Loading piano');
        await initAudio();
        initUI();
        setStatus('Ready');
    }

    boot();
})();
