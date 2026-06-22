// @ts-check
//-----------------------------------------------------------------------
// MUSIC CONSTANTS
// Shared musical constants and the ONLY pitch-representation converters.
//
// Representation law (see docs/architecture.md):
// - MIDI integers are the internal currency for pitch. All math is MIDI.
// - Note-name strings ("D#", "Bb") and pitch strings ("D#3") exist only
//   at boundaries: user input (voice, steppers), persistence, display.
// - Every conversion goes through this file. No page builds pitch
//   strings by hand or parses names with its own table.
// - Sharp spellings are canonical internally; flats are accepted on
//   input and normalized.
//-----------------------------------------------------------------------

/** @type {readonly string[]} Note names in chromatic order */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** @type {readonly string[]} Note names with flats */
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** @type {readonly string[]} Musical letters in staff order */
const NOTE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** @type {Readonly<Record<string, number>>} Natural pitch classes by letter */
const NATURAL_PITCH_CLASSES = Object.freeze({
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
});

/** @type {Readonly<Record<string, string>>} */
const PREFERRED_FLAT_ROOT_NAMES = Object.freeze({
    'D#': 'Eb',
    'G#': 'Ab',
    'A#': 'Bb'
});

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

const DIATONIC_LETTER_STEPS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);

/** @type {Readonly<Record<string, readonly number[]>>} Letter steps for scale-degree spelling. */
const SCALE_LETTER_STEPS = Object.freeze({
    major: DIATONIC_LETTER_STEPS,
    minor: DIATONIC_LETTER_STEPS,
    dorian: DIATONIC_LETTER_STEPS,
    phrygian: DIATONIC_LETTER_STEPS,
    lydian: DIATONIC_LETTER_STEPS,
    mixolydian: DIATONIC_LETTER_STEPS,
    locrian: DIATONIC_LETTER_STEPS,
    harmonic_minor: DIATONIC_LETTER_STEPS,
    harmonic_major: DIATONIC_LETTER_STEPS,
    double_harmonic: DIATONIC_LETTER_STEPS,
    melodic_minor: DIATONIC_LETTER_STEPS,
    pentatonic: [0, 1, 2, 4, 5, 7],
    minor_pentatonic: [0, 2, 3, 4, 6, 7],
    blues: [0, 2, 3, 4, 4, 6, 7],
    whole_tone: [0, 1, 2, 3, 4, 5, 7],
    diminished: [0, 1, 2, 3, 4, 5, 5, 6, 7],
    augmented: [0, 2, 2, 4, 4, 6, 7]
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
    const rounded = Math.round(midi);
    return {
        name: NOTE_NAMES[midiPitchClass(rounded)],
        octave: midiOctave(rounded),
        full: midiToPitchString(rounded)
    };
}

/**
 * Canonical converter: MIDI integer to Tone.js pitch string.
 * This is the ONLY place pitch strings should be constructed from MIDI.
 * All internal note passing uses MIDI integers; this converts at boundaries
 * (Tone.js playback, DOM display, status text).
 * @param {number} midi - MIDI note number (e.g. 60 = C4)
 * @returns {string} Pitch string (e.g. "C4", "C#4")
 */
function midiToPitchString(midi) {
    const noteIndex = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Convert MIDI integer to pitch string using a simple sharp/flat preference.
 * @param {number} midi
 * @param {'#' | 'b' | null=} accidentalPreference
 * @returns {string}
 */
function midiToPitchStringWithPreference(midi, accidentalPreference = null) {
    const rounded = Math.round(midi);
    const names = accidentalPreference === 'b' ? NOTE_NAMES_FLAT : NOTE_NAMES;
    return `${names[midiPitchClass(rounded)]}${midiOctave(rounded)}`;
}

/**
 * Extract pitch class index (0-11) from MIDI note number.
 * @param {number} midi
 * @returns {number} 0=C, 1=C#, 2=D, ... 11=B
 */
function midiPitchClass(midi) {
    return ((midi % 12) + 12) % 12;
}

/**
 * Extract octave from MIDI note number.
 * @param {number} midi
 * @returns {number}
 */
function midiOctave(midi) {
    return Math.floor(midi / 12) - 1;
}

/**
 * Normalize a pitch-class name to its canonical sharp spelling.
 * Accepts sharps ('F#'), flats ('Gb'), and naturals ('G').
 * @param {string} name
 * @returns {string | null} Canonical name, or null if not a pitch class
 */
function normalizePitchClassName(name) {
    if (NOTE_NAMES.includes(name)) return name;
    const flatIndex = NOTE_NAMES_FLAT.indexOf(name);
    return flatIndex === -1 ? null : NOTE_NAMES[flatIndex];
}

/**
 * Choose the readable root spelling for scale/staff display.
 * @param {string} root
 * @returns {string | null}
 */
function preferredScaleRootName(root) {
    const canonical = normalizePitchClassName(root);
    if (!canonical) return null;
    return PREFERRED_FLAT_ROOT_NAMES[canonical] || canonical;
}

/**
 * Convert note name and octave to MIDI note number.
 * Accepts sharp and flat spellings ('F#' and 'Gb').
 * @param {string} noteName - Note name (e.g., 'C', 'F#', 'Bb')
 * @param {number} octave - Octave number
 * @returns {number | null} MIDI note number or null if invalid
 */
function noteNameToMidi(noteName, octave) {
    const canonical = normalizePitchClassName(noteName);
    if (canonical === null) return null;
    return (octave + 1) * 12 + NOTE_NAMES.indexOf(canonical);
}

/**
 * @param {number} value
 * @param {number} modulo
 */
function positiveModulo(value, modulo) {
    return ((value % modulo) + modulo) % modulo;
}

/**
 * @param {string} scaleType
 * @param {number} interval
 * @returns {number}
 */
function scaleDegreeIndexForInterval(scaleType, interval) {
    const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
    const pitchClass = positiveModulo(interval, 12);
    const last = pattern.length - 1;
    for (let index = 0; index < pattern.length; index++) {
        if (index === last && pattern[index] === 12) continue;
        if (positiveModulo(pattern[index], 12) === pitchClass) return index;
    }
    return -1;
}

/**
 * @param {string} letter
 * @param {number} pitchClass
 */
function spellPitchClassWithLetter(letter, pitchClass) {
    const natural = NATURAL_PITCH_CLASSES[letter];
    if (natural === undefined) return NOTE_NAMES[pitchClass] || letter;
    let delta = positiveModulo(pitchClass - natural, 12);
    if (delta > 6) delta -= 12;
    if (delta === 0) return letter;
    if (delta === 1) return `${letter}#`;
    if (delta === -1) return `${letter}b`;
    if (delta === 2) return `${letter}##`;
    if (delta === -2) return `${letter}bb`;
    return NOTE_NAMES[pitchClass] || letter;
}

/**
 * Spell a note in the selected scale/key instead of using canonical sharps.
 * @param {string} root
 * @param {number} octave
 * @param {string} scaleType
 * @param {number} interval
 * @param {'#' | 'b' | null=} accidentalPreference
 * @returns {string}
 */
function scaleIntervalToPitchString(root, octave, scaleType, interval, accidentalPreference = null) {
    const rootMidi = noteNameToMidi(root, octave);
    if (rootMidi === null || !Number.isInteger(interval)) {
        return midiToPitchStringWithPreference(rootMidi === null ? 60 : rootMidi + interval, accidentalPreference);
    }

    const midi = rootMidi + interval;
    const steps = SCALE_LETTER_STEPS[scaleType];
    const degreeIndex = scaleDegreeIndexForInterval(scaleType, interval);
    if (!steps || degreeIndex < 0 || degreeIndex >= steps.length) {
        return midiToPitchStringWithPreference(midi, accidentalPreference);
    }

    const displayRoot = preferredScaleRootName(root);
    if (!displayRoot) return midiToPitchStringWithPreference(midi, accidentalPreference);
    const rootLetterIndex = NOTE_LETTERS.indexOf(displayRoot.charAt(0));
    if (rootLetterIndex < 0) return midiToPitchStringWithPreference(midi, accidentalPreference);

    const letter = NOTE_LETTERS[(rootLetterIndex + steps[degreeIndex]) % NOTE_LETTERS.length];
    const name = spellPitchClassWithLetter(letter, midiPitchClass(midi));
    return `${name}${midiOctave(midi)}`;
}

/**
 * Spell MIDI in the selected scale/key instead of using canonical sharps.
 * @param {string} root
 * @param {number} octave
 * @param {string} scaleType
 * @param {number} midi
 * @param {'#' | 'b' | null=} accidentalPreference
 * @returns {string}
 */
function scaleMidiToPitchString(root, octave, scaleType, midi, accidentalPreference = null) {
    const rootMidi = noteNameToMidi(root, octave);
    if (rootMidi === null) return midiToPitchStringWithPreference(midi, accidentalPreference);
    return scaleIntervalToPitchString(root, octave, scaleType, Math.round(midi) - rootMidi, accidentalPreference);
}

/**
 * Scale-aware note name without octave.
 * @param {string} root
 * @param {number} octave
 * @param {string} scaleType
 * @param {number} midi
 * @param {'#' | 'b' | null=} accidentalPreference
 * @returns {string}
 */
function scaleMidiToNoteName(root, octave, scaleType, midi, accidentalPreference = null) {
    return scaleMidiToPitchString(root, octave, scaleType, midi, accidentalPreference).replace(/-?\d+$/, '');
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
        const pitch = scaleIntervalToPitchString(rootNote, octave, scaleType, interval);
        const noteName = pitch.replace(/-?\d+$/, '');
        return {
            midi,
            freq: midiToFreq(midi),
            name: pitch,
            noteName,
            octave: midiOctave(midi)
        };
    });
}
