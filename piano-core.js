// @ts-check
//-----------------------------------------------------------------------
// PIANO CORE
// Singleton piano voice engine over the Salamander samples.
//
// Every sounding voice is tracked in a registry and owns its gain node,
// so playback control is exact: stopAll() kills the actual voices (with
// a short declick fade), never by muting the master output and hoping
// tails die. activeVoices() reports precisely what is sounding.
// Requires music-constants.js and audio-volume.js. Tone.js is loaded on
// first audio use when a page has not already loaded it.
//-----------------------------------------------------------------------

const PianoCore = (function () {
    'use strict';

    const TONE_SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js';
    const SALAMANDER_BASE_URL = 'https://tonejs.github.io/audio/salamander/';
    const SALAMANDER_URLS = Object.freeze({
        'A0': 'A0.mp3', 'C1': 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
        'A1': 'A1.mp3', 'C2': 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
        'A2': 'A2.mp3', 'C3': 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
        'A3': 'A3.mp3', 'C4': 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
        'A4': 'A4.mp3', 'C5': 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
        'A5': 'A5.mp3', 'C6': 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
        'A6': 'A6.mp3', 'C7': 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
        'A7': 'A7.mp3', 'C8': 'C8.mp3'
    });
    const DEFAULT_VOLUME_DB = AudioVolume.PIANO_DB;
    // Damper fade applied at a note's musical end (like lifting the key).
    const DAMPER_SECONDS = 0.25;
    // Declick fade when a voice is killed by stopAll(): long enough to
    // avoid a click, short enough to be imperceptible as sound.
    const KILL_FADE_SECONDS = 0.02;
    /** @type {Promise<void> | null} */
    let toneLoadPromise = null;

    function ensureToneLoaded() {
        if (typeof Tone !== 'undefined') return Promise.resolve();
        if (toneLoadPromise) return toneLoadPromise;

        toneLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = TONE_SCRIPT_URL;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Could not load Tone.js from ${TONE_SCRIPT_URL}`));
            document.head.appendChild(script);
        });
        return toneLoadPromise;
    }

    // The first call is always user-initiated, which also satisfies the
    // browser's audio-context gesture requirement.
    async function ensureStarted() {
        await ensureToneLoaded();
        if (Tone.context.state !== 'running') await Tone.start();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** @param {string} name - Sample key like 'D#1' */
    function sampleNameToMidi(name) {
        const match = name.match(/^([A-G]#?)(\d)$/);
        if (!match) throw new Error(`Bad sample name: ${name}`);
        const midi = noteNameToMidi(match[1], Number(match[2]));
        if (midi === null) throw new Error(`Bad sample name: ${name}`);
        return midi;
    }

    /**
     * @param {InstanceType<typeof Tone.ToneAudioBuffers>} buffers
     * @param {number} volume
     */
    function makePiano(buffers, volume) {
        const output = new Tone.Gain(Tone.dbToGain(volume)).toDestination();
        const samples = Object.keys(SALAMANDER_URLS)
            .map(name => ({ name, midi: sampleNameToMidi(name) }))
            .sort((a, b) => a.midi - b.midi);

        /**
         * The registry: every voice that is (or may be) sounding.
         * endsAtMs is authoritative - after it, the voice is silent.
         * @type {Set<{ midi: number, startedAtMs: number, endsAtMs: number, source: any, gain: any }>}
         */
        const voices = new Set();

        /** @param {number} midi */
        function nearestSample(midi) {
            let best = samples[0];
            for (const sample of samples) {
                if (Math.abs(sample.midi - midi) < Math.abs(best.midi - midi)) best = sample;
            }
            return best;
        }

        /**
         * @param {number} midi
         * @param {number} durationSeconds
         * @param {number} [startAtSeconds] - Absolute AudioContext time to
         *   start the source; defaults to Tone.now() (which includes the
         *   scheduling-safety lookAhead).
         */
        function startVoice(midi, durationSeconds, startAtSeconds) {
            const sample = nearestSample(midi);
            const gain = new Tone.Gain(1).connect(output);
            const source = new Tone.ToneBufferSource({
                url: buffers.get(sample.name),
                playbackRate: Math.pow(2, (midi - sample.midi) / 12)
            }).connect(gain);

            const startAt = startAtSeconds ?? Tone.now();
            // Registry bookkeeping is wall-clock; a scheduled-ahead voice
            // counts from its scheduled start, not from this call.
            const leadMs = Math.max(0, (startAt - Tone.context.currentTime) * 1000);
            const voice = {
                midi,
                startedAtMs: performance.now() + leadMs,
                endsAtMs: performance.now() + leadMs + (durationSeconds + DAMPER_SECONDS) * 1000,
                source,
                gain
            };
            source.onended = () => {
                voices.delete(voice);
                source.dispose();
                gain.dispose();
            };

            source.start(startAt);
            // Hold full level until the musical end, then damper to silence.
            gain.gain.setValueAtTime(1, startAt + durationSeconds);
            gain.gain.linearRampToValueAtTime(0, startAt + durationSeconds + DAMPER_SECONDS);
            source.stop(startAt + durationSeconds + DAMPER_SECONDS + 0.01);

            voices.add(voice);
        }

        /** @param {ToneDuration} duration */
        function toSeconds(duration) {
            return Tone.Time(duration).toSeconds();
        }

        /**
         * Seconds between an AudioContext start time and audible sound,
         * best effort: graph latency (baseLatency) plus device output
         * latency where the browser reports it (large on Bluetooth).
         */
        function audibleLatencySeconds() {
            // Offline contexts (and older browsers) lack the latency fields.
            const raw = /** @type {AudioContext} */ (Tone.context.rawContext);
            const base = typeof raw.baseLatency === 'number' ? raw.baseLatency : 0;
            const out = typeof raw.outputLatency === 'number' ? raw.outputLatency : 0;
            return base + out;
        }

        // Pitch is MIDI-only at this boundary (the representation law):
        // callers convert names/strings via music-constants before here.
        return {
            /**
             * @param {number} midi
             * @param {ToneDuration} duration
             */
            playMidi(midi, duration) {
                startVoice(midi, toSeconds(duration));
            },
            /**
             * Schedule a note so its AUDIBLE onset lands `inSeconds` from
             * now, compensating device output latency. Transport-driven
             * pages (the Staff scroll) hand notes over slightly early with
             * an exact onset so the sound lands on the now-line; plain
             * playMidi keeps Tone's default safety lookAhead and therefore
             * sounds ~100ms after the call.
             * @param {number} midi
             * @param {ToneDuration} duration
             * @param {number} inSeconds
             */
            playMidiAudibleIn(midi, duration, inSeconds) {
                const startAt = Math.max(
                    Tone.context.currentTime + 0.005,
                    Tone.context.currentTime + inSeconds - audibleLatencySeconds());
                startVoice(midi, toSeconds(duration), startAt);
            },
            audibleLatencySeconds,
            /**
             * @param {number[]} midis - Notes played simultaneously
             * @param {ToneDuration} duration
             */
            playMidiChord(midis, duration) {
                const seconds = toSeconds(duration);
                midis.forEach(midi => startVoice(midi, seconds));
            },
            // Kill every sounding voice now. Each voice's own gain ramps
            // to zero over the declick fade; nothing is hidden behind a
            // master mute, and nothing can come back later.
            stopAll() {
                const now = Tone.now();
                const nowMs = performance.now();
                voices.forEach(voice => {
                    if (voice.endsAtMs <= nowMs) return;
                    voice.gain.gain.cancelAndHoldAtTime(now);
                    voice.gain.gain.linearRampToValueAtTime(0, now + KILL_FADE_SECONDS);
                    voice.endsAtMs = nowMs + KILL_FADE_SECONDS * 1000;
                });
            },
            /**
             * Exactly what is sounding right now.
             * @returns {Array<{ midi: number, startedAtMs: number, endsAtMs: number }>}
             */
            activeVoices() {
                const nowMs = performance.now();
                return Array.from(voices)
                    .filter(voice => voice.endsAtMs > nowMs)
                    .map(voice => ({ midi: voice.midi, startedAtMs: voice.startedAtMs, endsAtMs: voice.endsAtMs }));
            }
        };
    }

    /**
     * Load the Salamander samples. Resolves with the piano voice engine
     * once all samples are ready.
     * @param {{ volume?: number }} [options]
     * @returns {Promise<ReturnType<typeof makePiano>>}
     */
    function createPiano(options = {}) {
        const { volume = DEFAULT_VOLUME_DB } = options;
        return new Promise((resolve, reject) => {
            const buffers = new Tone.ToneAudioBuffers({
                urls: { ...SALAMANDER_URLS },
                baseUrl: SALAMANDER_BASE_URL,
                onload: () => resolve(makePiano(buffers, volume)),
                onerror: reject
            });
        });
    }

    /**
     * Lightweight sine synth for guide beeps and sustained drones.
     * A mono Tone.Synth: its single voice is fully controlled by the
     * synth itself, so stopAll() is an exact stop here too.
     * @param {{ volume?: number, envelope?: object }} [options]
     */
    function createSineSynth(options = {}) {
        const {
            volume = AudioVolume.SINE_DB,
            envelope = { attack: 0.015, decay: 0.08, sustain: 0.55, release: 0.12 }
        } = options;
        const synth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope
        }).toDestination();
        synth.volume.value = volume;
        return {
            synth,
            /**
             * @param {number} midi
             * @param {number | string} duration - Tone time (seconds or notation like '2n')
             */
            playMidi(midi, duration) {
                synth.triggerAttackRelease(midiToPitchString(midi), duration);
            },
            // Sustained note (drone); ends on stopAll().
            /** @param {number} midi */
            startMidi(midi) {
                synth.triggerAttack(midiToPitchString(midi));
            },
            stopAll() {
                synth.triggerRelease();
            }
        };
    }

    return { ensureStarted, sleep, createPiano, createSineSynth };
})();

window.PianoCore = PianoCore;
