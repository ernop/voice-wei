// @ts-check
//-----------------------------------------------------------------------
// PITCH DETECT CORE
// Single owner of microphone pitch detection: the autocorrelation
// detector, the glitch-aware sample recorder, the voice-elapsed clock,
// and the mic capture pipeline. Pages must not call getUserMedia or
// implement their own detector; they consume this module.
// Requires music-constants.js.
//-----------------------------------------------------------------------

const PitchDetectCore = (function () {
    'use strict';

    // A detected jump bigger than GLITCH_JUMP_MIDI within GLITCH_WINDOW_MS
    // is held back until a second sample confirms it; one-frame detector
    // spikes (usually octave errors) never reach the trace.
    const GLITCH_JUMP_MIDI = 5.5;
    const GLITCH_WINDOW_MS = 220;
    const GLITCH_CONFIRM_MS = 260;
    const GLITCH_CONFIRM_MIDI = 1.2;
    // Canonical trace gap: the drawn line breaks across silences longer
    // than this (trace page used 260, phrases 240; unified at 250).
    const TRACE_BREAK_MS = 250;
    // Pause-on-silence clock only advances across gaps up to this long.
    const VOICE_CLOCK_MAX_STEP_MS = 240;
    const MAX_VALID_FREQ_HZ = 2000;
    const ANALYSER_FFT_SIZE = 2048;

    /** @typedef {{ time: number, freq: number, midi: number, cents: number, note: string }} PitchSample */

    /**
     * Autocorrelation pitch detector with parabolic peak interpolation.
     * @param {Float32Array} buffer
     * @param {number} sampleRate
     * @returns {number} Frequency in Hz, or -1 when no pitch found
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

    /**
     * Low-level microphone capture. Owns the AudioContext, analyser, and
     * stream; exposes on-demand pitch reads for pages that drive their
     * own loops.
     * @param {{ audioConstraints?: MediaTrackConstraints | boolean }} [options]
     */
    function createMicCapture(options = {}) {
        const { audioConstraints = true } = options;
        /** @type {AudioContext | null} */
        let audioContext = null;
        /** @type {AnalyserNode | null} */
        let analyser = null;
        /** @type {MediaStreamAudioSourceNode | null} */
        let microphone = null;
        /** @type {MediaStream | null} */
        let stream = null;

        return {
            get running() { return microphone !== null; },

            // Returns false when the browser refuses microphone access.
            async start() {
                if (microphone) return true;
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
                try {
                    if (!audioContext) {
                        audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    if (audioContext.state === 'suspended') await audioContext.resume();

                    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                    microphone = audioContext.createMediaStreamSource(stream);
                    analyser = audioContext.createAnalyser();
                    analyser.fftSize = ANALYSER_FFT_SIZE;
                    microphone.connect(analyser);
                    return true;
                } catch (err) {
                    console.error('Microphone access denied:', err);
                    this.stop();
                    return false;
                }
            },

            stop() {
                if (microphone) {
                    microphone.disconnect();
                    microphone = null;
                }
                if (stream) {
                    stream.getTracks().forEach(track => track.stop());
                    stream = null;
                }
                analyser = null;
            },

            /**
             * Read the current pitch from the live analyser.
             * @returns {{ freq: number, midi: number, cents: number, note: string } | null}
             */
            readPitch() {
                if (!analyser || !audioContext) return null;
                const buffer = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(buffer);
                const freq = detectPitch(buffer, audioContext.sampleRate);
                if (freq <= 0 || freq >= MAX_VALID_FREQ_HZ) return null;
                const midi = freqToMidi(freq);
                return {
                    freq,
                    midi,
                    cents: getCentsDeviation(freq),
                    note: midiToNoteName(midi).full
                };
            }
        };
    }

    /**
     * Pitch-trace session: mic capture + voice-elapsed clock + glitch
     * recorder + requestAnimationFrame loop. This is the engine behind
     * the pitch trace charts (test page, phrases test panel, pitch meter).
     *
     * @param {{
     *   pauseOnSilence: () => boolean,
     *   isOutlier?: (midi: number) => boolean,
     *   onAccepted?: (sample: PitchSample) => void,
     *   onSilence?: () => void,
     *   onFrame?: () => void,
     *   audioConstraints?: MediaTrackConstraints | boolean
     * }} options
     */
    function createTraceSession(options) {
        const capture = createMicCapture({ audioConstraints: options.audioConstraints });
        const isOutlier = options.isOutlier || null;

        let listening = false;
        /** @type {number | null} */
        let animationId = null;
        /** @type {PitchSample[]} */
        let history = [];
        /** @type {PitchSample | null} */
        let lastAccepted = null;
        /** @type {PitchSample | null} */
        let pendingJump = null;
        let startedAt = 0;
        let voiceElapsedMs = 0;
        /** @type {number | null} */
        let lastVoiceAt = null;

        function clockMs() {
            if (options.pauseOnSilence()) return voiceElapsedMs;
            return startedAt ? performance.now() - startedAt : 0;
        }

        // Voice-active clock: time only advances while singing is detected.
        function nextVoiceTime() {
            const now = performance.now();
            if (lastVoiceAt === null) {
                lastVoiceAt = now;
                return voiceElapsedMs;
            }
            const delta = now - lastVoiceAt;
            lastVoiceAt = now;
            if (delta <= VOICE_CLOCK_MAX_STEP_MS) voiceElapsedMs += delta;
            return voiceElapsedMs;
        }

        /** @param {PitchSample} sample */
        function record(sample) {
            if (isOutlier && isOutlier(sample.midi)) {
                pendingJump = null;
                return false;
            }

            if (!lastAccepted) {
                history.push(sample);
                lastAccepted = sample;
                return true;
            }

            const elapsedFromLast = sample.time - lastAccepted.time;
            const jumpFromLast = Math.abs(sample.midi - lastAccepted.midi);
            if (elapsedFromLast <= GLITCH_WINDOW_MS && jumpFromLast > GLITCH_JUMP_MIDI) {
                const confirmsPendingJump = pendingJump
                    && sample.time - pendingJump.time <= GLITCH_CONFIRM_MS
                    && Math.abs(sample.midi - pendingJump.midi) <= GLITCH_CONFIRM_MIDI;

                if (!confirmsPendingJump) {
                    pendingJump = sample;
                    return false;
                }

                history.push(pendingJump);
                history.push(sample);
                lastAccepted = sample;
                pendingJump = null;
                return true;
            }

            pendingJump = null;
            history.push(sample);
            lastAccepted = sample;
            return true;
        }

        function frameLoop() {
            if (!listening) return;

            const info = capture.readPitch();
            if (info) {
                const sample = {
                    time: options.pauseOnSilence() ? nextVoiceTime() : clockMs(),
                    freq: info.freq,
                    midi: info.midi,
                    cents: info.cents,
                    note: info.note
                };
                if (record(sample) && options.onAccepted) options.onAccepted(sample);
            } else {
                pendingJump = null;
                lastVoiceAt = null;
                if (options.onSilence) options.onSilence();
            }

            if (options.onFrame) options.onFrame();
            animationId = requestAnimationFrame(frameLoop);
        }

        return {
            get listening() { return listening; },
            get history() { return history; },
            get startedAt() { return startedAt; },
            clockMs,
            record,
            readPitch: () => capture.readPitch(),

            reset() {
                history = [];
                lastAccepted = null;
                pendingJump = null;
                voiceElapsedMs = 0;
                lastVoiceAt = null;
                startedAt = performance.now();
            },

            // Returns false when microphone access is unavailable or denied.
            async start() {
                if (listening) return true;
                const ok = await capture.start();
                if (!ok) return false;
                listening = true;
                frameLoop();
                return true;
            },

            stop() {
                listening = false;
                if (animationId !== null) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
                capture.stop();
                lastVoiceAt = null;
            }
        };
    }

    return {
        GLITCH_JUMP_MIDI,
        GLITCH_WINDOW_MS,
        TRACE_BREAK_MS,
        detectPitch,
        createMicCapture,
        createTraceSession
    };
})();

window.PitchDetectCore = PitchDetectCore;
