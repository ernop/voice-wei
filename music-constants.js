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
    augmented: [0, 3, 4, 7, 8, 11, 12],

    // Microtonal scales - fractional semitones (0.5 = one quarter tone).
    // Playback is exact (the sampler pitches by ratio, not by key); note
    // NAMES come from the microtonal spelling path below.
    quarter_tone: [
        0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6,
        6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12
    ],                                            // 24-EDO ladder: every quarter tone
    rast: [0, 2, 3.5, 5, 7, 9, 10.5, 12],        // Maqam Rast: neutral 3rd and 7th
    bayati: [0, 1.5, 3, 5, 7, 8, 10, 12],        // Maqam Bayati: neutral 2nd
    sikah: [0, 1.5, 3.5, 5.5, 7, 8.5, 10.5, 12], // Maqam Sikah: built on a quarter-tone frame
    slendro: [0, 2.4, 4.8, 7.2, 9.6, 12],        // 5-EDO: gamelan-like equal pentatonic
    just_major: [0, 2.04, 3.86, 4.98, 7.02, 8.84, 10.88, 12] // 5-limit just intonation major
});

// Interval vocabulary - the single owner of interval ids, sizes, and names.
// Spoken-form aliases (voice recognition) are an ear-training concern and live
// there; the musical facts (order, semitones, canonical names) live here.

/** @type {readonly string[]} Interval ids, smallest to largest. */
const INTERVAL_ORDER = Object.freeze(['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8']);

/** @type {Readonly<Record<string, number>>} Interval id -> semitones. */
const INTERVAL_SEMITONES = Object.freeze({
    m2: 1, M2: 2, m3: 3, M3: 4, P4: 5, TT: 6, P5: 7, m6: 8, M6: 9, m7: 10, M7: 11, P8: 12
});

/** @type {Readonly<Record<string, string>>} Interval id -> canonical display name. */
const INTERVAL_NAMES = Object.freeze({
    m2: 'minor 2nd', M2: 'Major 2nd', m3: 'minor 3rd', M3: 'Major 3rd',
    P4: 'Perfect 4th', TT: 'Tritone', P5: 'Perfect 5th', m6: 'minor 6th',
    M6: 'Major 6th', m7: 'minor 7th', M7: 'Major 7th', P8: 'Octave'
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
 * Display a root pitch using the same spelling preference as scale notes.
 * @param {string} root
 * @param {number} octave
 * @returns {string}
 */
function scaleRootPitchString(root, octave) {
    return `${preferredScaleRootName(root) || root}${octave}`;
}

/**
 * @param {string} scaleType
 * @returns {readonly number[]}
 */
function scalePattern(scaleType) {
    return SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
}

/**
 * True when the scale's pattern has non-integer (microtonal) steps.
 * @param {string} scaleType
 * @returns {boolean}
 */
function scaleIsMicrotonal(scaleType) {
    return scalePattern(scaleType).some(step => !Number.isInteger(step));
}

// Quarter-tone accidentals: down arrow = quarter-tone flat, up arrow =
// quarter-tone sharp. Chosen over the SMuFL half-accidental glyphs for
// universal font support on phones.
const QUARTER_FLAT_MARK = '\u2193';
const QUARTER_SHARP_MARK = '\u2191';

/**
 * Spell a non-integer MIDI value.
 * Exact quarter tones (x.5) use arrow accidentals on the neighboring
 * natural, matching maqam convention: 63.5 -> E(down)4 ("E half-flat"),
 * 65.5 -> F(up)4. Other offsets show nearest note plus signed cents:
 * 62.4 -> "D4+40c".
 * @param {number} midi
 * @returns {{ noteName: string, octave: number, centsSuffix: string }}
 */
function midiToMicrotonalParts(midi) {
    if (midi - Math.floor(midi) === 0.5) {
        const upperName = NOTE_NAMES[midiPitchClass(midi + 0.5)];
        if (upperName.length === 1) {
            return { noteName: `${upperName}${QUARTER_FLAT_MARK}`, octave: midiOctave(midi + 0.5), centsSuffix: '' };
        }
        return { noteName: `${NOTE_NAMES[midiPitchClass(midi - 0.5)]}${QUARTER_SHARP_MARK}`, octave: midiOctave(midi - 0.5), centsSuffix: '' };
    }
    const nearest = Math.round(midi);
    const cents = Math.round((midi - nearest) * 100);
    return { noteName: NOTE_NAMES[midiPitchClass(nearest)], octave: midiOctave(nearest), centsSuffix: `${formatCents(cents)}c` };
}

/**
 * Microtonal pitch string with octave, e.g. "E<down>4" or "D4+40c".
 * @param {number} midi
 * @returns {string}
 */
function midiToMicrotonalPitchString(midi) {
    const parts = midiToMicrotonalParts(midi);
    return `${parts.noteName}${parts.octave}${parts.centsSuffix}`;
}

/**
 * Microtonal note name without octave, e.g. "E<down>" or "D+40c".
 * @param {number} midi
 * @returns {string}
 */
function midiToMicrotonalNoteName(midi) {
    const parts = midiToMicrotonalParts(midi);
    return `${parts.noteName}${parts.centsSuffix}`;
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
 * @returns {{ degreeIndex: number, degree: number, octaveShift: number, interval: number } | null}
 */
function scaleDegreeForInterval(scaleType, interval) {
    const pattern = scalePattern(scaleType);
    /** @type {{ degreeIndex: number, degree: number, octaveShift: number, interval: number } | null} */
    let best = null;
    for (let octaveShift = -8; octaveShift <= 8; octaveShift++) {
        for (let degreeIndex = 0; degreeIndex < pattern.length; degreeIndex++) {
            const candidate = pattern[degreeIndex] + octaveShift * 12;
            if (candidate !== interval) continue;
            const item = { degreeIndex, degree: degreeIndex + 1, octaveShift, interval };
            if (!best || Math.abs(item.octaveShift) < Math.abs(best.octaveShift)) {
                best = item;
            }
        }
    }
    return best;
}

/**
 * @param {string} scaleType
 * @param {number} interval
 * @returns {number}
 */
function scaleDegreeIndexForInterval(scaleType, interval) {
    const degree = scaleDegreeForInterval(scaleType, interval);
    return degree ? degree.degreeIndex : -1;
}

/**
 * @param {string} scaleType
 * @param {number} minSemitone
 * @param {number} maxSemitone
 * @returns {number[]}
 */
function scaleIntervalsInRange(scaleType, minSemitone, maxSemitone) {
    const intervals = new Set();
    const pattern = scalePattern(scaleType);
    for (let octaveShift = -8; octaveShift <= 8; octaveShift++) {
        for (const interval of pattern) {
            const shifted = interval + octaveShift * 12;
            if (shifted >= minSemitone && shifted <= maxSemitone) {
                intervals.add(shifted);
            }
        }
    }
    return Array.from(intervals).sort((a, b) => a - b);
}

/**
 * @param {string} root
 * @param {number} octave
 * @param {string} scaleType
 * @param {number} minSemitone
 * @param {number} maxSemitone
 * @returns {ScaleDegreeNote[]}
 */
function scaleDegreeNotesInRange(root, octave, scaleType, minSemitone, maxSemitone) {
    const rootMidi = noteNameToMidi(root, octave);
    if (rootMidi === null) return [];
    /** @type {ScaleDegreeNote[]} */
    const notes = [];
    for (const interval of scaleIntervalsInRange(scaleType, minSemitone, maxSemitone)) {
        const degree = scaleDegreeForInterval(scaleType, interval);
        if (!degree) continue;
        const midi = rootMidi + interval;
        const name = scaleIntervalToPitchString(root, octave, scaleType, interval);
        notes.push({
            interval,
            degree: degree.degree,
            degreeIndex: degree.degreeIndex,
            octaveShift: degree.octaveShift,
            midi,
            name,
            noteName: Number.isInteger(interval) ? name.replace(/-?\d+$/, '') : midiToMicrotonalNoteName(midi),
            octave: midiOctave(midi)
        });
    }
    return notes;
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
    if (rootMidi === null) {
        return midiToPitchStringWithPreference(60, accidentalPreference);
    }
    if (!Number.isInteger(interval)) {
        return midiToMicrotonalPitchString(rootMidi + interval);
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
    // The written octave follows the letter, not the sounding pitch:
    // B#3 sounds as C4 (midi 60) but sits on B3's staff position, and Cb4
    // sounds as B3. Back the accidental shift out before taking the octave.
    const accidentalShift = (name.match(/#/g) || []).length - (name.match(/b/g) || []).length;
    return `${name}${midiOctave(midi - accidentalShift)}`;
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
    // Microtonal scales keep the fractional MIDI so the spelling carries
    // the quarter-tone/cents detail; 12-TET scales round as before.
    const effectiveMidi = scaleIsMicrotonal(scaleType) ? midi : Math.round(midi);
    return scaleIntervalToPitchString(root, octave, scaleType, effectiveMidi - rootMidi, accidentalPreference);
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
    if (!Number.isInteger(midi)) return midiToMicrotonalNoteName(midi);
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
 * Format a cents deviation as a signed integer string ("+12", "-5", "+0").
 * The single formatter for every pitch readout; callers add their own suffix.
 * @param {number} cents
 * @returns {string}
 */
function formatCents(cents) {
    const rounded = Math.round(cents);
    return cents >= 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * Build array of note frequencies for a scale
 * @param {string} rootNote - Root note name
 * @param {number} octave - Starting octave
 * @param {string} scaleType - Scale type key from SCALE_PATTERNS
 * @returns {Array<{ midi: number, freq: number, name: string, noteName: string, octave: number }>}
 */
function buildScaleFrequencies(rootNote, octave, scaleType) {
    return scaleDegreeNotesInRange(rootNote, octave, scaleType, 0, 12).map(note => {
        return {
            midi: note.midi,
            freq: midiToFreq(note.midi),
            name: note.name,
            noteName: note.noteName,
            octave: note.octave,
            degree: note.degree,
            interval: note.interval
        };
    });
}
