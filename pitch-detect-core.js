// @ts-check
//-----------------------------------------------------------------------
// PITCH DETECT CORE
// Single owner of microphone pitch detection: the band-limited McLeod
// (MPM) detector, the glitch-aware sample recorder, the voice-elapsed
// clock, and the mic capture pipeline. Pages must not call getUserMedia
// or implement their own detector; they consume this module.
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
    // the owner's range: D2 below a normal barbershop bass line's low
    // notes, Bb4 just above a lead line's top (the owner sings lead/bari;
    // the downward extension covers all four parts).
    const VOICE_MIN_MIDI = 38; // D2, ~73 Hz
    const VOICE_MAX_MIDI = 70; // Bb4, ~466 Hz
    const ANALYSER_FFT_SIZE = 2048;
    // onFrame fires every animation frame by default: live surfaces draw
    // per frame (smooth scroll); consumers throttle their own analysis.
    const DEFAULT_FRAME_CALLBACK_INTERVAL_MS = 0;

    /** @typedef {{ time: number, freq: number, midi: number, cents: number, note: string }} PitchSample */

    // The detector is the McLeod Pitch Method (MPM, "A Smarter Way to
    // Find Pitch", McLeod & Wyvill 2005) - the standard tuner algorithm,
    // designed against exactly the octave/harmonic locks that plagued
    // the naive autocorrelation it replaced. It evaluates ONLY the
    // periods a voice in the singable band can produce, on a half-rate
    // copy of the signal: candidates outside the band never cost a
    // multiply, and a frame's cost is fixed (~280 lags), voiced or not.
    const MPM_CLARITY_MIN = 0.80;          // NSDF peak below this is not a voiced pitch
    const MPM_PEAK_RATIO = 0.90;           // pick the first peak within 90% of the tallest
    const MPM_SUBHARMONIC_MARGIN = 0.015;  // walk down only when clearly more periodic
    const DETECT_DECIMATE = 2;             // detect at half rate: Bb4's period is still ~51 samples

    /** @type {Float32Array} half-rate signal scratch (detector only) */
    let mpmSignal = new Float32Array(0);
    /** @type {Float32Array} NSDF scratch, indexed by lag */
    let mpmNsdf = new Float32Array(0);

    /**
     * Band-limited MPM pitch detector with parabolic peak interpolation.
     * @param {Float32Array} buffer time-domain samples
     * @param {number} sampleRate
     * @returns {number} Frequency in Hz, or -1 when no voiced pitch found
     */
    function detectPitch(buffer, sampleRate) {
        const size = buffer.length;

        let rms = 0;
        for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
        rms = Math.sqrt(rms / size);
        if (rms < 0.01) return -1;

        // Half-rate copy (pair averaging): the band tops out at Bb4
        // (~466 Hz), far below the decimated Nyquist, and the cost of
        // every lag halves twice over.
        const rate = sampleRate / DETECT_DECIMATE;
        const len = Math.floor(size / DETECT_DECIMATE);
        if (mpmSignal.length < len) mpmSignal = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            mpmSignal[i] = (buffer[2 * i] + buffer[2 * i + 1]) * 0.5;
        }

        // Selectable periods are only the singable ones; the NSDF is
        // still computed from small lags so peak lobes are well formed
        // (the band's shortest period can sit mid-lobe otherwise).
        const tauStart = 2;
        const tauMin = Math.max(tauStart + 1, Math.floor(rate / midiToFreq(VOICE_MAX_MIDI)) - 2);
        const tauMax = Math.min(Math.floor(len / 2) - 1, Math.ceil(rate / midiToFreq(VOICE_MIN_MIDI)) + 2);
        if (tauMax <= tauMin) return -1;
        const window = len - tauMax;
        if (mpmNsdf.length < tauMax + 2) mpmNsdf = new Float32Array(tauMax + 2);

        // NSDF: n(tau) = 2*r(tau) / m(tau), in [-1, 1]; 1 = perfect
        // periodicity at that lag. Computed over a fixed window so all
        // lags are comparable.
        for (let tau = tauStart; tau <= tauMax; tau++) {
            let r = 0;
            let m = 0;
            for (let i = 0; i < window; i++) {
                const a = mpmSignal[i];
                const b = mpmSignal[i + tau];
                r += a * b;
                m += a * a + b * b;
            }
            mpmNsdf[tau] = m > 0 ? (2 * r) / m : 0;
        }

        // Key maxima: the tallest NSDF point per positive region,
        // skipping the trivial opening lobe (contiguous with lag 0).
        /** @type {number[]} */
        const peaks = [];
        let tau = tauStart;
        while (tau <= tauMax && mpmNsdf[tau] > 0) tau++;
        while (tau <= tauMax) {
            while (tau <= tauMax && mpmNsdf[tau] <= 0) tau++;
            let best = -1;
            while (tau <= tauMax && mpmNsdf[tau] > 0) {
                if (best < 0 || mpmNsdf[tau] > mpmNsdf[best]) best = tau;
                tau++;
            }
            if (best > 0) peaks.push(best);
        }
        if (!peaks.length) return -1;

        // All peak comparisons use the parabola-fitted maximum, not the
        // raw bin: a period midway between integer lags reads lower on
        // the grid than one sitting on a lag, which otherwise skews
        // every choice toward on-grid (often subharmonic) candidates.
        /** @param {number} peak */
        const peakValue = (peak) => {
            if (peak <= tauStart || peak >= tauMax) return mpmNsdf[peak];
            const left = mpmNsdf[peak - 1];
            const mid = mpmNsdf[peak];
            const right = mpmNsdf[peak + 1];
            const denom = 2 * (2 * mid - left - right);
            if (denom === 0) return mid;
            const shift = (right - left) / denom;
            return mid + ((right - left) * shift) / 4;
        };

        let tallest = 0;
        for (const peak of peaks) tallest = Math.max(tallest, peakValue(peak));
        if (tallest < MPM_CLARITY_MIN) return -1;

        // First peak within MPM_PEAK_RATIO of the tallest (classic MPM
        // selection), then the subharmonic walk-down: when a longer
        // period at 1.5x/2x/3x the pick is CLEARLY more periodic (a
        // dominant harmonic was masquerading as the note), step down to
        // it - but never below the singable band. For a true pick, the
        // longer multiples correlate about equally, never clearly
        // better, so real notes stay put.
        let chosen = peaks[0];
        for (const peak of peaks) {
            if (peakValue(peak) >= tallest * MPM_PEAK_RATIO) {
                chosen = peak;
                break;
            }
        }
        for (let pass = 0; pass < 3; pass++) {
            let improved = false;
            for (const multiple of [2, 1.5, 3]) {
                const target = Math.round(chosen * multiple);
                if (target > tauMax) continue;
                /** @type {number} */
                let candidate = -1;
                for (const peak of peaks) {
                    if (Math.abs(peak - target) <= 3 && (candidate < 0 || peakValue(peak) > peakValue(candidate))) {
                        candidate = peak;
                    }
                }
                if (candidate > 0 && peakValue(candidate) > peakValue(chosen) + MPM_SUBHARMONIC_MARGIN) {
                    chosen = candidate;
                    improved = true;
                    break;
                }
            }
            if (!improved) break;
        }
        if (chosen < tauMin) return -1; // above the singable band

        // Parabolic interpolation for sub-sample period precision.
        let period = chosen;
        if (chosen > tauStart && chosen < tauMax) {
            const left = mpmNsdf[chosen - 1];
            const mid = mpmNsdf[chosen];
            const right = mpmNsdf[chosen + 1];
            const denom = 2 * (2 * mid - left - right);
            if (denom !== 0) period = chosen + (right - left) / denom;
        }
        return rate / period;
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
        /** @type {{ rms: number, freq: number, rejected: string | null } | null} */
        let lastRead = null;

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
            },

            /** Why the previous readPitch returned what it did - the raw
             *  material for the on-page diagnostics log. */
            get lastRead() { return lastRead; },

            /**
             * Read the current pitch from the live analyser.
             * @returns {{ freq: number, midi: number, cents: number, note: string } | null}
             */
            readPitch() {
                if (!analyser || !audioContext) return null;
                if (!timeDomainBuffer || timeDomainBuffer.length !== analyser.fftSize) {
                    timeDomainBuffer = new Float32Array(analyser.fftSize);
                }
                analyser.getFloatTimeDomainData(/** @type {Float32Array<ArrayBuffer>} */ (/** @type {unknown} */ (timeDomainBuffer)));

                let rms = 0;
                for (let i = 0; i < timeDomainBuffer.length; i++) rms += timeDomainBuffer[i] * timeDomainBuffer[i];
                rms = Math.sqrt(rms / timeDomainBuffer.length);

                const freq = detectPitch(timeDomainBuffer, audioContext.sampleRate);
                lastRead = { rms, freq, rejected: null };
                if (freq <= 0) {
                    lastRead.rejected = rms >= 0.01 ? 'no-pitch' : 'quiet';
                    return null;
                }
                const midi = freqToMidi(freq);
                if (midi < VOICE_MIN_MIDI || midi > VOICE_MAX_MIDI) {
                    lastRead.rejected = midi < VOICE_MIN_MIDI ? 'below-band' : 'above-band';
                    return null;
                }
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
        // Rolling mic diagnostics: what happened to every frame since the
        // consumer last asked (the on-page log renders these as summaries).
        const diagCounts = { frames: 0, voiced: 0, quiet: 0, noPitch: 0, belowBand: 0, aboveBand: 0, held: 0 };

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
            diagCounts.frames++;
            const read = capture.lastRead;
            if (info) {
                diagCounts.voiced++;
                const sample = {
                    time: options.pauseOnSilence() ? nextVoiceTime() : clockMs(),
                    freq: info.freq,
                    midi: info.midi,
                    cents: info.cents,
                    note: info.note
                };
                const accepted = record(sample);
                if (!accepted) diagCounts.held++;
                if (accepted && options.onAccepted) options.onAccepted(sample);
            } else {
                if (read) {
                    if (read.rejected === 'quiet') diagCounts.quiet++;
                    else if (read.rejected === 'no-pitch') diagCounts.noPitch++;
                    else if (read.rejected === 'below-band') diagCounts.belowBand++;
                    else if (read.rejected === 'above-band') diagCounts.aboveBand++;
                }
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

            /**
             * Mic-frame outcomes since the last call (delta semantics):
             * how many frames were voiced, too quiet, pitchless despite
             * signal, outside the singable band, re-octaved by the
             * harmonic guard, or held back by the glitch filter.
             */
            diagnostics() {
                const snapshot = { ...diagCounts };
                for (const key of Object.keys(diagCounts)) diagCounts[key] = 0;
                return snapshot;
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
