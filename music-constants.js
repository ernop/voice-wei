// @ts-check
//-----------------------------------------------------------------------
// MUSIC CONSTANTS
// Shared musical constants used across the application.
// Loaded by scales.html and pitch-meter.html.
//-----------------------------------------------------------------------

/** @type {readonly string[]} Note names in chromatic order */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** @type {readonly string[]} Note names with flats */
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** @type {Readonly<Record<string, readonly number[]>>} Scale patterns - semitones from root */
const SCALE_PATTERNS = Object.freeze({
    // Basic scales
    major: [0, 2, 4, 5, 7, 9, 11, 12],
    minor: [0, 2, 3, 5, 7, 8, 10, 12],           // Natural minor
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],

    // Pentatonic & Blues
    pentatonic: [0, 2, 4, 7, 9, 12],             // Major pentatonic
    minor_pentatonic: [0, 3, 5, 7, 10, 12],      // Minor pentatonic
    blues: [0, 3, 5, 6, 7, 10, 12],

    // Modes
    dorian: [0, 2, 3, 5, 7, 9, 10, 12],
    phrygian: [0, 1, 3, 5, 7, 8, 10, 12],
    lydian: [0, 2, 4, 6, 7, 9, 11, 12],
    mixolydian: [0, 2, 4, 5, 7, 9, 10, 12],
    locrian: [0, 1, 3, 5, 6, 8, 10, 12],

    // Harmonic scales
    harmonic_minor: [0, 2, 3, 5, 7, 8, 11, 12],
    harmonic_major: [0, 2, 4, 5, 7, 8, 11, 12],
    double_harmonic: [0, 1, 4, 5, 7, 8, 11, 12], // aka Byzantine, Arabic

    // Melodic minor
    melodic_minor: [0, 2, 3, 5, 7, 9, 11, 12],   // Jazz melodic minor

    // Exotic scales
    whole_tone: [0, 2, 4, 6, 8, 10, 12],
    diminished: [0, 2, 3, 5, 6, 8, 9, 11, 12],   // Half-whole diminished
    augmented: [0, 3, 4, 7, 8, 11, 12]
});

// A4 reference frequency and MIDI number
const A4_FREQ = 440;
const A4_MIDI = 69;

//-------UTILITY FUNCTIONS-------

/**
 * Convert MIDI note number to frequency in Hz
 * @param {number} midi - MIDI note number
 * @returns {number} Frequency in Hz
 */
function midiToFreq(midi) {
    return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Convert frequency to MIDI note number (may be fractional)
 * @param {number} freq - Frequency in Hz
 * @returns {number} MIDI note number
 */
function freqToMidi(freq) {
    return A4_MIDI + 12 * Math.log2(freq / A4_FREQ);
}

/**
 * Convert MIDI note number to note name and octave
 * @param {number} midi - MIDI note number
 * @returns {{ name: string, octave: number, full: string }}
 */
function midiToNoteName(midi) {
    const noteIndex = Math.round(midi) % 12;
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    return { name: NOTE_NAMES[noteIndex], octave, full: NOTE_NAMES[noteIndex] + octave };
}

/**
 * Convert note name and octave to MIDI note number
 * @param {string} noteName - Note name (e.g., 'C', 'F#')
 * @param {number} octave - Octave number
 * @returns {number | null} MIDI note number or null if invalid
 */
function noteNameToMidi(noteName, octave) {
    const noteIndex = NOTE_NAMES.indexOf(noteName);
    if (noteIndex === -1) return null;
    return (octave + 1) * 12 + noteIndex;
}

/**
 * Get cents deviation from nearest note
 * @param {number} freq - Frequency in Hz
 * @returns {number} Cents deviation (-50 to +50)
 */
function getCentsDeviation(freq) {
    const midi = freqToMidi(freq);
    const nearestMidi = Math.round(midi);
    return (midi - nearestMidi) * 100;
}

/**
 * Build array of note frequencies for a scale
 * @param {string} rootNote - Root note name
 * @param {number} octave - Starting octave
 * @param {string} scaleType - Scale type key from SCALE_PATTERNS
 * @returns {Array<{ midi: number, freq: number, name: string, noteName: string, octave: number }>}
 */
function buildScaleFrequencies(rootNote, octave, scaleType) {
    const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
    const rootMidi = noteNameToMidi(rootNote, octave);
    if (rootMidi === null) return [];

    return pattern.map(interval => {
        const midi = rootMidi + interval;
        const noteInfo = midiToNoteName(midi);
        return {
            midi,
            freq: midiToFreq(midi),
            name: noteInfo.full,
            noteName: noteInfo.name,
            octave: noteInfo.octave
        };
    });
}
