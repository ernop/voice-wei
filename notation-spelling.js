// @ts-check
//-----------------------------------------------------------------------
// NOTATION SPELLING
// Key signatures and VexFlow spellings for staff rendering.
// Pitch math stays MIDI; this module owns staff-specific spelling only.
//-----------------------------------------------------------------------

const NotationSpelling = (function () {
    'use strict';

    /** @type {Readonly<Record<string, string>>} */
    const VEX_FLAT_KEYS = Object.freeze({
        'D#': 'Eb',
        'G#': 'Ab',
        'A#': 'Bb'
    });

    /**
     * VexFlow key signature string for the current key frame.
     * @param {string} root
     * @param {string} scaleType
     */
    function vexKeySignature(root, scaleType) {
        const canonical = normalizePitchClassName(root);
        if (!canonical) return 'C';
        const vexRoot = VEX_FLAT_KEYS[canonical] || canonical;
        if (scaleType === 'minor' || scaleType === 'harmonic_minor' || scaleType === 'm_minor') {
            return `${vexRoot}m`;
        }
        return vexRoot;
    }

    /**
     * @param {number} midi
     * @returns {string} VexFlow key, e.g. "f#/3"
     */
    function midiToVexKey(midi) {
        const rounded = Math.round(midi);
        const pitch = midiToPitchString(rounded);
        const match = pitch.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
        if (!match) return 'c/4';
        return `${match[1].toLowerCase()}/${match[2]}`;
    }

    /**
     * Pick treble or bass from the phrase's pitch center.
     * @param {number} rootMidi
     * @param {number[]} midis
     */
    function clefForPhrase(rootMidi, midis) {
        const center = midis.length
            ? midis.reduce((sum, midi) => sum + midi, 0) / midis.length
            : rootMidi;
        return center < 57 ? 'bass' : 'treble';
    }

    /**
     * Explicit accidental for chromatic passing tones (# = sharp, b = flat).
     * @param {number} offset
     * @param {number} dp
     * @param {number} index
     * @param {number[]} offsets
     * @returns {'#' | 'b' | null}
     */
    function passingAccidental(offset, dp, index, offsets) {
        if (Number.isInteger(offset)) return null;
        const next = offsets[index + 1];
        const ascending = next === undefined || next > offset;
        return ascending ? '#' : 'b';
    }

    return {
        vexKeySignature,
        midiToVexKey,
        clefForPhrase,
        passingAccidental
    };
})();

window.NotationSpelling = NotationSpelling;
