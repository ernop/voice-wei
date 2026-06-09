// @ts-check
//-----------------------------------------------------------------------
// PIANO CORE
// Single owner of the Salamander grand piano sampler.
// Every page that plays piano notes loads this instead of building its
// own Tone.Sampler. Requires Tone.js and music-constants.js.
//-----------------------------------------------------------------------

const PianoCore = (function () {
    'use strict';

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
    const DEFAULT_VOLUME_DB = -3;

    // Tone.js requires a user gesture before audio can start.
    async function ensureStarted() {
        if (Tone.context.state !== 'running') await Tone.start();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * @param {InstanceType<typeof Tone.Sampler>} synth
     * @param {InstanceType<typeof Tone.Gain>} gainNode
     */
    function makePiano(synth, gainNode) {
        return {
            synth,
            gainNode,
            // Restore gain after a hard mute; call before every trigger.
            unmute() {
                gainNode.gain.setValueAtTime(1, Tone.now());
            },
            // Hard cutoff: release voices and mute so nothing lingers.
            mute() {
                synth.releaseAll();
                gainNode.gain.setValueAtTime(0, Tone.now());
            },
            /**
             * @param {number} midi
             * @param {number | string} duration - Tone time (seconds or notation like '2n')
             */
            playMidi(midi, duration) {
                this.unmute();
                synth.triggerAttackRelease(midiToPitchString(midi), duration);
            },
            /**
             * @param {string} name - Pitch string like 'C4'
             * @param {number | string} duration
             */
            playName(name, duration) {
                this.unmute();
                synth.triggerAttackRelease(name, duration);
            },
            /**
             * @param {number[]} midis - Notes played simultaneously
             * @param {number | string} duration
             */
            playMidiChord(midis, duration) {
                this.unmute();
                synth.triggerAttackRelease(midis.map(midiToPitchString), duration);
            }
        };
    }

    /**
     * Load the Salamander piano. Resolves with a piano object once all
     * samples are ready.
     * @param {{ volume?: number }} [options]
     * @returns {Promise<ReturnType<typeof makePiano>>}
     */
    function createPiano(options = {}) {
        const { volume = DEFAULT_VOLUME_DB } = options;
        const gainNode = new Tone.Gain(1).toDestination();
        return new Promise((resolve, reject) => {
            const synth = new Tone.Sampler({
                urls: { ...SALAMANDER_URLS },
                baseUrl: SALAMANDER_BASE_URL,
                onload: () => resolve(makePiano(synth, gainNode)),
                onerror: reject
            }).connect(gainNode);
            synth.volume.value = volume;
        });
    }

    /**
     * Lightweight sine synth with the same playMidi/mute interface as the
     * piano. Ready immediately (no sample download); used for guide beeps
     * and sustained drones where the full sampler is not wanted.
     * @param {{ volume?: number, envelope?: object }} [options]
     */
    function createSineSynth(options = {}) {
        const {
            volume = -10,
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
            // Sustained note (drone); ends on mute().
            /** @param {number} midi */
            startMidi(midi) {
                synth.triggerAttack(midiToPitchString(midi));
            },
            mute() {
                synth.triggerRelease();
            }
        };
    }

    return { ensureStarted, sleep, createPiano, createSineSynth };
})();

window.PianoCore = PianoCore;
