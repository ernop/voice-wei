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
    // is held back until GLITCH_CONFIRM_SAMPLES consecutive samples agree
    // at the new level; the held samples are then flushed together so a
    // real leap loses nothing. Voices cannot leap that far and settle
    // within a frame or two - brief detector scrapes (octave errors,
    // harmonic locks, breath transients) can, and never reach the trace.
    const GLITCH_JUMP_MIDI = 5.5;
    const GLITCH_WINDOW_MS = 220;
    const GLITCH_CONFIRM_MS = 260;
    const GLITCH_CONFIRM_MIDI = 1.2;
    const GLITCH_CONFIRM_SAMPLES = 3;
    // Canonical trace gap: the drawn line breaks across silences longer
    // than this (trace page used 260, phrases 240; unified at 250).
    const TRACE_BREAK_MS = 250;
    // Pause-on-silence clock only advances across gaps up to this long.
    const VOICE_CLOCK_MAX_STEP_MS = 240;
    // The capture is a VOICE instrument: a detection outside the singable
    // band is the room and the gear (harmonic locks, squeaks, hum,
    // rumble), not the singer, and reads as silence - it never reaches
    // the trace, the chart scale, scoring, or the voice clock. Band =
    // the full barbershop TTBB span with headroom: D2 below a normal
    // bass line's low notes, C5 above a tenor's falsetto top.
    const VOICE_MIN_MIDI = 38; // D2, ~73 Hz
    const VOICE_MAX_MIDI = 72; // C5, ~523 Hz
    const ANALYSER_FFT_SIZE = 2048;
    const DEFAULT_FRAME_CALLBACK_INTERVAL_MS = 50;

    /** @typedef {{ time: number, freq: number, midi: number, cents: number, note: string }} PitchSample */

    // Octave-lock guard: when a voice's 2nd harmonic dominates, the
    // first good correlation peak sits at HALF the true period and the
    // note reads an octave high. Before trusting the found peak, look at
    // double its period: for a true detection the doubled shift
    // correlates about equally, so only a CLEARLY better double (by this
    // margin) pulls the note down to its real octave.
    const OCTAVE_DOWN_MARGIN = 0.015;

    /**
     * Autocorrelation pitch detector with parabolic peak interpolation
     * and an octave-lock guard.
     * @param {Float32Array} buffer
     * @param {number} sampleRate
     * @param {any} [correlations]
     * @returns {number} Frequency in Hz, or -1 when no pitch found
     */
    function detectPitch(buffer, sampleRate, correlations = []) {
        const size = buffer.length;
        const maxSamples = Math.floor(size / 2);
        let bestOffset = -1;
        let bestCorrelation = 0;
        let foundGoodCorrelation = false;
        let peakLocked = false;

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

            if (!peakLocked && correlation > 0.9 && correlation > lastCorrelation) {
                foundGoodCorrelation = true;
                if (correlation > bestCorrelation) {
                    bestCorrelation = correlation;
                    bestOffset = offset;
                }
            } else if (!peakLocked && foundGoodCorrelation) {
                // Past the peak: freeze it, but keep scanning far enough
                // to inspect the octave-down candidate at double period.
                peakLocked = true;
            }
            lastCorrelation = correlation;
            if (peakLocked && offset >= Math.min(bestOffset * 2 + 3, maxSamples - 1)) break;
        }

        if (foundGoodCorrelation) {
            const doubled = bestOffset * 2;
            if (doubled + 2 < maxSamples) {
                let sub = doubled;
                for (let k = Math.max(1, doubled - 2); k <= doubled + 2; k++) {
                    if (correlations[k] > correlations[sub]) sub = k;
                }
                if (correlations[sub] > bestCorrelation + OCTAVE_DOWN_MARGIN) {
                    bestOffset = sub;
                }
            }
            const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) / correlations[bestOffset];
            return sampleRate / (bestOffset + 8 * shift);
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
        /** @type {Float32Array | null} */
        let timeDomainBuffer = null;
        /** @type {Float32Array | null} */
        let correlationBuffer = null;

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
                    timeDomainBuffer = new Float32Array(analyser.fftSize);
                    correlationBuffer = new Float32Array(Math.floor(analyser.fftSize / 2));
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
                timeDomainBuffer = null;
                correlationBuffer = null;
            },

            /**
             * Read the current pitch from the live analyser.
             * @returns {{ freq: number, midi: number, cents: number, note: string } | null}
             */
            readPitch() {
                if (!analyser || !audioContext) return null;
                if (!timeDomainBuffer || timeDomainBuffer.length !== analyser.fftSize) {
                    timeDomainBuffer = new Float32Array(analyser.fftSize);
                    correlationBuffer = new Float32Array(Math.floor(analyser.fftSize / 2));
                }
                analyser.getFloatTimeDomainData(/** @type {Float32Array<ArrayBuffer>} */ (/** @type {unknown} */ (timeDomainBuffer)));
                const freq = detectPitch(timeDomainBuffer, audioContext.sampleRate, correlationBuffer || undefined);
                if (freq <= 0) return null;
                const midi = freqToMidi(freq);
                if (midi < VOICE_MIN_MIDI || midi > VOICE_MAX_MIDI) return null;
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
     *   onAccepted?: (sample: PitchSample) => void,
     *   onSilence?: () => void,
     *   onFrame?: () => void,
     *   frameCallbackIntervalMs?: number,
     *   audioConstraints?: MediaTrackConstraints | boolean
     * }} options
     */
    function createTraceSession(options) {
        const capture = createMicCapture({ audioConstraints: options.audioConstraints });

        let listening = false;
        /** @type {number | null} */
        let animationId = null;
        /** @type {PitchSample[]} */
        let history = [];
        /** @type {PitchSample | null} */
        let lastAccepted = null;
        /** @type {PitchSample[]} Samples held back while a large jump awaits confirmation */
        let pendingJump = [];
        /** @type {number} Wall time of the last accepted sample (0 = none yet) */
        let lastAcceptedAtWall = 0;
        let startedAt = 0;
        let voiceElapsedMs = 0;
        /** @type {number | null} */
        let lastVoiceAt = null;
        let lastFrameCallbackAt = 0;
        const frameCallbackIntervalMs = Math.max(0, options.frameCallbackIntervalMs ?? DEFAULT_FRAME_CALLBACK_INTERVAL_MS);

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

        // The trace records whatever the singer actually sang. The ONLY
        // rejection is the glitch holdback below: a large instant jump
        // must sustain for GLITCH_CONFIRM_SAMPLES consecutive frames to
        // be voice; unconfirmed scrapes (octave errors, harmonic locks,
        // breath transients) are dropped, confirmed jumps are flushed
        // whole so nothing real is lost. Never discard samples for being
        // far from the chart's rails or targets - an off-octave note is
        // real singing the person must see in order to correct it.
        /** @param {PitchSample} sample */
        function record(sample) {
            if (!lastAccepted) {
                history.push(sample);
                lastAccepted = sample;
                lastAcceptedAtWall = performance.now();
                return true;
            }

            const elapsedFromLast = sample.time - lastAccepted.time;
            const jumpFromLast = Math.abs(sample.midi - lastAccepted.midi);
            if (elapsedFromLast <= GLITCH_WINDOW_MS && jumpFromLast > GLITCH_JUMP_MIDI) {
                const lastPending = pendingJump[pendingJump.length - 1];
                const continuesPendingJump = lastPending
                    && sample.time - pendingJump[0].time <= GLITCH_CONFIRM_MS
                    && Math.abs(sample.midi - lastPending.midi) <= GLITCH_CONFIRM_MIDI;

                if (!continuesPendingJump) {
                    pendingJump = [sample];
                    return false;
                }

                pendingJump.push(sample);
                if (pendingJump.length < GLITCH_CONFIRM_SAMPLES) {
                    return false;
                }

                history.push(...pendingJump);
                lastAccepted = sample;
                lastAcceptedAtWall = performance.now();
                pendingJump = [];
                return true;
            }

            pendingJump = [];
            history.push(sample);
            lastAccepted = sample;
            lastAcceptedAtWall = performance.now();
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
                pendingJump = [];
                lastVoiceAt = null;
                if (options.onSilence) options.onSilence();
            }

            if (options.onFrame) {
                const now = performance.now();
                if (now - lastFrameCallbackAt >= frameCallbackIntervalMs) {
                    lastFrameCallbackAt = now;
                    options.onFrame();
                }
            }
            animationId = requestAnimationFrame(frameLoop);
        }

        return {
            get listening() { return listening; },
            get history() { return history; },
            get startedAt() { return startedAt; },
            clockMs,
            record,
            readPitch: () => capture.readPitch(),

            /**
             * Wall-clock ms since the last accepted sample (Infinity when
             * none). Lets consumers tell "still holding a note" from
             * "stopped singing" - the voice clock cannot, since it
             * freezes during silence.
             */
            msSinceLastAccepted() {
                return lastAcceptedAtWall ? performance.now() - lastAcceptedAtWall : Infinity;
            },

            reset() {
                history = [];
                lastAccepted = null;
                pendingJump = [];
                lastAcceptedAtWall = 0;
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
        VOICE_MIN_MIDI,
        VOICE_MAX_MIDI,
        detectPitch,
        createMicCapture,
        createTraceSession
    };
})();

window.PitchDetectCore = PitchDetectCore;
