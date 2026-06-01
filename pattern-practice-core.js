// @ts-check
//-----------------------------------------------------------------------
// PATTERN PRACTICE CORE
// Pure helpers for scale-degree pattern and phrase practice pages.
// Requires music-constants.js.
//-----------------------------------------------------------------------

const PatternPracticeCore = (function () {
    'use strict';

    /** @param {number} min @param {number} max */
    function randomInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    /** @param {number} value @param {number} min @param {number} max */
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /** @param {number} n @param {number} modulus */
    function positiveModulo(n, modulus) {
        return ((n % modulus) + modulus) % modulus;
    }

    /** @param {string} scaleType */
    function degreesPerOctave(scaleType) {
        const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        return pattern.filter(interval => interval < 12).length;
    }

    /** @param {string} scaleType */
    function baseIntervalsForScale(scaleType) {
        const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        return pattern.filter(interval => interval < 12);
    }

    /**
     * @param {{ root: string, octave: number, scaleType: string, lowerOctaves?: number, upperOctaves?: number }} options
     * @returns {Array<{ midi: number, name: string, noteName: string, octave: number, offset: number }>}
     */
    function buildExtendedScale(options) {
        const { root, octave, scaleType, lowerOctaves = 0, upperOctaves = 3 } = options;
        const rootMidi = noteNameToMidi(root, octave);
        if (rootMidi === null) return [];

        const baseIntervals = baseIntervalsForScale(scaleType);
        const dp = baseIntervals.length;
        const notes = [];

        for (let octaveShift = -lowerOctaves; octaveShift < upperOctaves; octaveShift++) {
            for (let degreeIndex = 0; degreeIndex < baseIntervals.length; degreeIndex++) {
                const offset = octaveShift * dp + degreeIndex;
                const midi = rootMidi + octaveShift * 12 + baseIntervals[degreeIndex];
                const info = midiToNoteName(midi);
                notes.push({ midi, name: info.full, noteName: info.name, octave: info.octave, offset });
            }
        }

        return notes;
    }

    /**
     * Offset 0 is degree 1; in a 7-note scale, offset 7 is degree 8.
     * Negative offsets address degrees in the lower octave.
     * @param {number} rootMidi
     * @param {string} scaleType
     * @param {number} offset
     */
    function scaleOffsetToMidi(rootMidi, scaleType, offset) {
        const baseIntervals = baseIntervalsForScale(scaleType);
        const dp = baseIntervals.length;
        const octaveShift = Math.floor(offset / dp);
        const degreeIndex = positiveModulo(offset, dp);
        return rootMidi + octaveShift * 12 + baseIntervals[degreeIndex];
    }

    /** @param {number} offset @param {number} dp */
    function offsetToDegree(offset, dp) {
        if (offset >= 0) return String(offset + 1);
        return `${positiveModulo(offset, dp) + 1}d`;
    }

    /** @param {number} offset @param {number} dp */
    function offsetToSpoken(offset, dp) {
        if (offset >= 0) return String(offset + 1);
        return `${positiveModulo(offset, dp) + 1} down`;
    }

    /**
     * Native speech pitch is approximate. This mapping keeps spoken numbers
     * moving in the same direction as the exact piano target underneath them.
     * @param {number} midi
     */
    function midiToSpeechPitch(midi) {
        const c4 = noteNameToMidi('C', 4) || 60;
        return clamp(1 + ((midi - c4) / 24), 0.45, 1.9);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   allowOutOfOctave: boolean,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateClusteredOffsets(options) {
        const dp = degreesPerOctave(options.scaleType);
        const minOffset = options.allowOutOfOctave ? -Math.floor(dp / 2) : 0;
        const maxOffset = options.allowOutOfOctave ? dp * 2 : dp;
        const minLength = clamp(Math.round(options.minLength), 1, 32);
        const maxLength = clamp(Math.max(Math.round(options.maxLength), minLength), minLength, 32);
        const length = randomInt(minLength, maxLength);

        const offsets = [];
        let current = options.startAtOne ? 0 : randomInt(0, dp);
        const initial = current;
        offsets.push(current);

        for (let i = 1; i < length; i++) {
            let next = current;
            for (let attempt = 0; attempt < 8; attempt++) {
                const roll = Math.random();
                if (roll < 0.62) {
                    next = current + randomInt(1, 2) * (Math.random() < 0.5 ? -1 : 1);
                } else if (roll < 0.86) {
                    next = current + randomInt(3, 4) * (Math.random() < 0.5 ? -1 : 1);
                } else {
                    next = randomInt(minOffset, maxOffset);
                    break;
                }

                if (next >= minOffset && next <= maxOffset && next !== current) break;
                next = current;
            }

            if (next === current) next = randomInt(minOffset, maxOffset);
            current = clamp(next, minOffset, maxOffset);
            offsets.push(current);
        }

        if (options.returnToInitial && offsets[offsets.length - 1] !== initial) {
            offsets.push(initial);
        }
        if (options.returnToRoot && offsets[offsets.length - 1] !== 0) {
            offsets.push(0);
        }

        return offsets;
    }

    /**
     * @param {{
     *   root: string,
     *   octave: number,
     *   scaleType: string,
     *   startAtOne: boolean,
     *   allowOutOfOctave: boolean,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     */
    function generatePhrase(options) {
        const rootMidi = noteNameToMidi(options.root, options.octave);
        if (rootMidi === null) return null;

        const dp = degreesPerOctave(options.scaleType);
        const offsets = generateClusteredOffsets(options);
        const midiNotes = offsets.map(offset => scaleOffsetToMidi(rootMidi, options.scaleType, offset));

        return {
            offsets,
            midiNotes,
            displayDegrees: offsets.map(offset => offsetToDegree(offset, dp)),
            spokenDegrees: offsets.map(offset => offsetToSpoken(offset, dp)),
            noteNames: midiNotes.map(midi => midiToPitchString(midi)),
            root: options.root,
            scaleType: options.scaleType,
            octave: options.octave,
            createdAt: new Date().toISOString()
        };
    }

    return {
        randomInt,
        clamp,
        positiveModulo,
        degreesPerOctave,
        baseIntervalsForScale,
        buildExtendedScale,
        scaleOffsetToMidi,
        offsetToDegree,
        offsetToSpoken,
        midiToSpeechPitch,
        generateClusteredOffsets,
        generatePhrase
    };
})();

window.PatternPracticeCore = PatternPracticeCore;
