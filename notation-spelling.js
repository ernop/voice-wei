// @ts-check
//-----------------------------------------------------------------------
// NOTATION SPELLING
// Key signatures and VexFlow spellings for staff rendering.
// Pitch math stays MIDI; this module owns staff-specific spelling only.
//-----------------------------------------------------------------------

const NotationSpelling = (function () {
    'use strict';

    /**
     * VexFlow key signature string for the current key frame.
     * @param {string} root
     * @param {string} scaleType
     */
    function vexKeySignature(root, scaleType) {
        const canonical = normalizePitchClassName(root);
        if (!canonical) return 'C';
        const vexRoot = preferredScaleRootName(canonical) || canonical;
        if (scaleType === 'minor' || scaleType === 'harmonic_minor' || scaleType === 'melodic_minor') {
            return `${vexRoot}m`;
        }
        return vexRoot;
    }

    /**
     * @param {number} midi
     * @param {'#' | 'b' | null=} accidentalPreference
     * @returns {string} VexFlow key, e.g. "f#/3"
     */
    function midiToVexKey(midi, accidentalPreference = null) {
        const rounded = Math.round(midi);
        const noteInfo = midiToNoteName(rounded);
        const names = accidentalPreference === 'b' ? NOTE_NAMES_FLAT : NOTE_NAMES;
        const name = names[midiPitchClass(rounded)] || noteInfo.name;
        return `${name.toLowerCase()}/${noteInfo.octave}`;
    }

    /**
     * @param {string} pitch
     * @returns {string | null}
     */
    function pitchStringToVexKey(pitch) {
        const match = pitch.match(/^([A-G](?:#{1,2}|b{1,2})?)(-?\d+)$/);
        if (!match) return null;
        return `${match[1].toLowerCase()}/${match[2]}`;
    }

    /**
     * Spell staff notes in the current scale/key before handing them to VexFlow.
     * @param {number} midi
     * @param {number} rootMidi
     * @param {string} scaleType
     * @param {'#' | 'b' | null=} accidentalPreference
     * @returns {string}
     */
    function midiToVexKeyForScale(midi, rootMidi, scaleType, accidentalPreference = null) {
        const root = midiToNoteName(rootMidi);
        const pitch = scaleMidiToPitchString(root.name, root.octave, scaleType, midi, accidentalPreference);
        return pitchStringToVexKey(pitch) || midiToVexKey(midi, accidentalPreference);
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
        midiToVexKeyForScale,
        clefForPhrase,
        passingAccidental
    };
})();

window.NotationSpelling = NotationSpelling;
