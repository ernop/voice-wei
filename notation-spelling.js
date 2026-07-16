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
     * Pick the clef whose five staff lines need the fewest ledger lines
     * for the phrase; ties fall back to the pitch-center threshold.
     * @param {number} rootMidi
     * @param {number[]} midis
     */
    function clefForPhrase(rootMidi, midis) {
        const notes = midis.length ? midis : [rootMidi];
        const outside = (lo, hi) => notes.reduce(
            (sum, midi) => sum + Math.max(0, lo - midi, midi - hi), 0);
        const trebleCost = outside(64, 77); // staff lines E4..F5
        const bassCost = outside(43, 57);   // staff lines G2..A3
        if (trebleCost !== bassCost) return trebleCost < bassCost ? 'treble' : 'bass';
        const center = notes.reduce((sum, midi) => sum + midi, 0) / notes.length;
        return center < 57 ? 'bass' : 'treble';
    }

    /**
     * Which staff system a phrase needs: one clef when the phrase sits
     * within about one ledger line of a single staff, both clefs (grand
     * staff) when it reaches beyond A3 below AND beyond E4 above - the
     * registers where treble and bass each run out of readable room.
     * @param {number} rootMidi
     * @param {number[]} midis
     * @returns {'treble' | 'bass' | 'grand'}
     */
    function staffSystemForPhrase(rootMidi, midis) {
        const notes = midis.length ? midis : [rootMidi];
        const lowest = Math.min(...notes);
        const highest = Math.max(...notes);
        if (lowest < 57 && highest > 64) return 'grand';
        return clefForPhrase(rootMidi, midis);
    }

    /**
     * Staff assignment for one note on a grand staff: split at middle C
     * (C4 and above read from the treble staff).
     * @param {number} midi
     * @returns {'treble' | 'bass'}
     */
    function clefForNote(midi) {
        return midi < 60 ? 'bass' : 'treble';
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
        staffSystemForPhrase,
        clefForNote,
        passingAccidental
    };
})();

window.NotationSpelling = NotationSpelling;
