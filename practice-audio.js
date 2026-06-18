// @ts-check
//-----------------------------------------------------------------------
// PRACTICE AUDIO
// Thin shared wrapper over piano-core for pages that need simple playback.
//-----------------------------------------------------------------------

const PracticeAudio = (function () {
    'use strict';

    class Coordinator {
        constructor() {
            /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
            this.piano = null;
            /** @type {boolean} */
            this.isReady = false;
        }

        async init() {
            this.piano = await PianoCore.createPiano();
            this.isReady = true;
        }

        async ensureStarted() {
            await PianoCore.ensureStarted();
        }

        /** @param {number} ms */
        sleep(ms) {
            return PianoCore.sleep(ms);
        }

        /**
         * @param {number} midi
         * @param {ToneDuration} [duration]
         */
        playNote(midi, duration = '8n') {
            if (!this.piano) return;
            this.piano.playMidi(midi, duration);
        }

        /**
         * @param {number[]} midiNotes
         * @param {ToneDuration} [duration]
         */
        playChord(midiNotes, duration = '2n') {
            if (!this.piano) return;
            this.piano.playMidiChord(midiNotes, duration);
        }

        stopAll() {
            if (this.piano) this.piano.stopAll();
        }

        /**
         * @param {number} rootMidi
         * @param {number} semitones
         * @param {'ascending' | 'descending'} direction
         * @param {number} [noteLengthMs]
         * @param {number} [gapMs]
         */
        async playMelodicInterval(rootMidi, semitones, direction, noteLengthMs = 800, gapMs = 200) {
            await this.ensureStarted();
            if (!this.piano) return;
            const targetMidi = direction === 'ascending' ? rootMidi + semitones : rootMidi - semitones;
            const duration = noteLengthMs / 1000;
            this.piano.playMidi(rootMidi, duration);
            await this.sleep(noteLengthMs + gapMs);
            this.piano.playMidi(targetMidi, duration);
        }

        /** @param {number} rootMidi @param {number} semitones */
        async playHarmonicInterval(rootMidi, semitones) {
            await this.ensureStarted();
            if (!this.piano) return;
            this.piano.playMidiChord([rootMidi, rootMidi + semitones], '2n');
        }
    }

    return { Coordinator };
})();

window.PracticeAudio = PracticeAudio;
