// @ts-check
//-----------------------------------------------------------------------
// SCALES VOICE MAPS
// Phonetic normalization for scale voice commands.
//-----------------------------------------------------------------------

/** @type {Record<string, string>} */
const SCALES_NOTE_PHONETIC_MAP = {
    'see': 'C', 'sea': 'C', 'si': 'C', 'cee': 'C',
    'dee': 'D', 'the': 'D',
    'ee': 'E', 'he': 'E',
    'eff': 'F', 'ef': 'F', 'half': 'F',
    'gee': 'G', 'jee': 'G', 'ji': 'G',
    'ay': 'A', 'hey': 'A', 'eh': 'A', 'eight': 'A',
    'bee': 'B', 'be': 'B', 'bea': 'B',
    'c': 'C', 'd': 'D', 'e': 'E', 'f': 'F', 'g': 'G', 'a': 'A', 'b': 'B'
};

/** @type {Record<string, string>} */
const SCALES_MODIFIER_PHONETIC_MAP = {
    'sharp': 'sharp', 'shop': 'sharp', 'sharpe': 'sharp', 'shark': 'sharp',
    'flat': 'flat', 'flap': 'flat', 'flight': 'flat',
    '#': 'sharp', 'b': 'flat'
};

/**
 * @param {string | null | undefined} spoken
 * @returns {string | null}
 */
function normalizeScaleNoteName(spoken) {
    if (!spoken) return null;
    const lower = spoken.toLowerCase().trim();
    return SCALES_NOTE_PHONETIC_MAP[lower]
        || (lower.length === 1 && lower.match(/[a-g]/i) ? lower.toUpperCase() : null);
}

/**
 * @param {string | null | undefined} spoken
 * @returns {string | null}
 */
function normalizeScaleModifier(spoken) {
    if (!spoken) return null;
    const lower = spoken.toLowerCase().trim();
    return SCALES_MODIFIER_PHONETIC_MAP[lower] || null;
}

// Spoken scale-type variants that differ from the SCALE_PATTERNS key.
// Keys are already lowercased with spaces/hyphens collapsed to underscores.
/** @type {Record<string, string>} */
const SCALES_SCALE_TYPE_ALIAS_MAP = {
    'maqam_rast': 'rast',
    'rust': 'rast',
    'maqam_bayati': 'bayati',
    'bayatti': 'bayati',
    'biati': 'bayati',
    'maqam_sikah': 'sikah',
    'sika': 'sikah',
    'seeka': 'sikah',
    'slendra': 'slendro',
    'quartertone': 'quarter_tone'
};

/**
 * Canonicalize a spoken scale-type phrase to its SCALE_PATTERNS key.
 * @param {string} spoken
 * @returns {string}
 */
function normalizeScaleTypeName(spoken) {
    const token = spoken.toLowerCase().trim().replace(/[\s-]+/g, '_');
    return SCALES_SCALE_TYPE_ALIAS_MAP[token] || token;
}

window.ScalesVoiceMaps = {
    NOTE_PHONETIC_MAP: SCALES_NOTE_PHONETIC_MAP,
    MODIFIER_PHONETIC_MAP: SCALES_MODIFIER_PHONETIC_MAP,
    normalizeScaleNoteName,
    normalizeScaleModifier,
    normalizeScaleTypeName
};

// Backward-compatible globals used throughout scales.js voice parsing
window.normalizeNoteName = normalizeScaleNoteName;
window.normalizeModifier = normalizeScaleModifier;
