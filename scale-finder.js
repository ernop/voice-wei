// @ts-check
//-----------------------------------------------------------------------
// SCALE FINDER
// Ranks the scales a sung melody could be in, from its held notes. Pure
// computation: the page segments the take into held notes
// (PitchScore.createSegmenter) and renders the result.
//
// The model is the probabilistic key finder used for melodies (Temperley,
// "Music and Probability", 2007): each candidate scale is a distribution
// over the 12 pitch classes, and the candidates are ranked by how likely
// they make the notes that were sung.
//   - In-scale pitch classes share most of the mass, weighted toward the
//     tonic triad (tonic 3, fifth 2, third 2, other scale tones 1): that
//     is what tells D major from B minor when both use the same notes.
//   - Out-of-scale pitch classes share OUTSIDE_MASS, so a stray note
//     lowers a candidate instead of ruling it out.
//   - A smaller scale spreads its mass over fewer notes, so when only
//     pentatonic notes are sung the pentatonic outranks the 7-note scale
//     that contains it (Occam's razor, from the arithmetic, not a rule).
//   - Each held note counts once on average, longer notes more (capped),
//     and the evidence is tempered (EVIDENCE_TEMPER) so the percentages
//     stay honest about a crude model instead of reading 100% after a
//     dozen notes.
// Pitch classes are taken relative to the singer's own tuning: the
// duration-weighted circular mean of every held note's offset from equal
// temperament. A singer 40c flat throughout still sings D, not C#/D.
//
// Requires music-constants.js.
//-----------------------------------------------------------------------

const ScaleFinder = (function () {
    'use strict';

    /**
     * The scales the finder considers, with prior weights: how often the
     * scale is the answer before any note is heard. Major and natural
     * minor dominate sung music; the modes, pentatonics, and blues are
     * real but rarer, so they need clear evidence to outrank them.
     * Chromatic is never a candidate (every melody fits it).
     */
    const CANDIDATE_SCALES = Object.freeze([
        { scaleType: 'major', prior: 1 },
        { scaleType: 'minor', prior: 0.8 },
        { scaleType: 'harmonic_minor', prior: 0.25 },
        { scaleType: 'melodic_minor', prior: 0.15 },
        { scaleType: 'dorian', prior: 0.25 },
        { scaleType: 'phrygian', prior: 0.1 },
        { scaleType: 'lydian', prior: 0.1 },
        { scaleType: 'mixolydian', prior: 0.25 },
        { scaleType: 'pentatonic', prior: 0.4 },
        { scaleType: 'minor_pentatonic', prior: 0.4 },
        { scaleType: 'blues', prior: 0.25 }
    ]);

    const TONIC_WEIGHT = 3;
    const FIFTH_WEIGHT = 2;
    const THIRD_WEIGHT = 2;
    const OTHER_WEIGHT = 1;
    const OUTSIDE_MASS = 0.05;
    const EVIDENCE_TEMPER = 0.5;
    // A held note's weight grows with its length up to this cap, so one
    // long drone cannot outvote the melody around it.
    const NOTE_WEIGHT_CAP_MS = 2000;
    // A pitch class under this share of the sung time is a passing touch:
    // it still counts as evidence, but it is not listed as an outside
    // note and does not count toward "different notes heard".
    const PRESENT_SHARE = 0.03;
    // Ranking starts once this much has been sung; before that, dozens
    // of scales fit equally and a list would only be noise.
    const MIN_DISTINCT_PITCH_CLASSES = 3;
    const MIN_HELD_NOTES = 4;
    const MAX_CANDIDATES = 5;
    const MIN_LISTED_PROBABILITY = 0.01;

    /**
     * @typedef {{ midi: number, durationMs: number }} HeldNote
     * share is of the counted singing (each held note up to
     * NOTE_WEIGHT_CAP_MS), the same weights the ranking uses; ms is the
     * plain sung time.
     * @typedef {{ pitchClass: number, ms: number, share: number }} PitchClassTime
     * @typedef {{
     *   root: number,
     *   scaleType: string,
     *   name: string,
     *   probability: number,
     *   outside: number[]
     * }} ScaleCandidate
     * @typedef {{
     *   noteCount: number,
     *   totalMs: number,
     *   tuningCents: number,
     *   pitchClasses: PitchClassTime[],
     *   distinctPitchClasses: number,
     *   ready: boolean,
     *   candidates: ScaleCandidate[]
     * }} ScaleFinderResult
     */

    /**
     * Pitch-class weights for one scale with its root on pitch class 0.
     * @param {string} scaleType
     * @returns {number[]} 12 entries; 0 for pitch classes outside the scale
     */
    function scaleProfile(scaleType) {
        const intervals = new Set(scalePattern(scaleType).map(step => positiveModulo(step, 12)));
        const third = scaleThirdInterval(scaleType);
        const profile = new Array(12).fill(0);
        intervals.forEach(interval => {
            profile[interval] = interval === 0 ? TONIC_WEIGHT
                : interval === 7 ? FIFTH_WEIGHT
                    : interval === third ? THIRD_WEIGHT
                        : OTHER_WEIGHT;
        });
        return profile;
    }

    /**
     * Log-probability of each pitch class under a profile.
     * @param {number[]} profile
     * @returns {number[]}
     */
    function logProbabilities(profile) {
        const inside = profile.reduce((sum, weight) => sum + weight, 0);
        const outsideCount = profile.filter(weight => weight === 0).length;
        return profile.map(weight => weight > 0
            ? Math.log((1 - OUTSIDE_MASS) * weight / inside)
            : Math.log(OUTSIDE_MASS / outsideCount));
    }

    const PROFILES = CANDIDATE_SCALES.map(candidate => ({
        ...candidate,
        logProbability: logProbabilities(scaleProfile(candidate.scaleType)),
        members: scaleProfile(candidate.scaleType).map(weight => weight > 0)
    }));

    /**
     * Duration-weighted circular mean of the notes' offsets from equal
     * temperament, in semitones (-0.5..0.5).
     * @param {HeldNote[]} notes
     */
    function tuningOffset(notes) {
        let sin = 0;
        let cos = 0;
        for (const note of notes) {
            const weight = Math.min(note.durationMs, NOTE_WEIGHT_CAP_MS);
            const angle = 2 * Math.PI * (note.midi - Math.round(note.midi));
            sin += weight * Math.sin(angle);
            cos += weight * Math.cos(angle);
        }
        if (sin === 0 && cos === 0) return 0;
        return Math.atan2(sin, cos) / (2 * Math.PI);
    }

    /**
     * Display name of a candidate, spelled the way every page spells keys.
     * @param {number} root pitch class
     * @param {string} scaleType
     */
    function candidateName(root, scaleType) {
        return `${preferredScaleRootName(NOTE_NAMES[root])} ${scaleType.replace(/_/g, ' ')}`;
    }

    /**
     * Rank the candidate scales for a list of held notes.
     * @param {HeldNote[]} notes
     * @returns {ScaleFinderResult}
     */
    function rank(notes) {
        const held = notes.filter(note => Number.isFinite(note.midi) && note.durationMs > 0);
        const offset = tuningOffset(held);
        const ms = new Array(12).fill(0);
        const cappedMs = new Array(12).fill(0);
        for (const note of held) {
            const pitchClass = midiPitchClass(Math.round(note.midi - offset));
            ms[pitchClass] += note.durationMs;
            cappedMs[pitchClass] += Math.min(note.durationMs, NOTE_WEIGHT_CAP_MS);
        }
        const totalMs = ms.reduce((sum, value) => sum + value, 0);
        const totalCappedMs = cappedMs.reduce((sum, value) => sum + value, 0);
        /** @type {PitchClassTime[]} */
        const pitchClasses = ms.map((value, pitchClass) => ({
            pitchClass,
            ms: value,
            share: totalCappedMs > 0 ? cappedMs[pitchClass] / totalCappedMs : 0
        }));
        const present = pitchClasses.filter(entry => entry.share >= PRESENT_SHARE);
        const ready = present.length >= MIN_DISTINCT_PITCH_CLASSES && held.length >= MIN_HELD_NOTES;

        /** @type {ScaleCandidate[]} */
        let candidates = [];
        if (ready) {
            // Evidence per pitch class: the held-note count, shared out
            // in proportion to the counted singing.
            const evidence = pitchClasses.map(entry => held.length * entry.share);
            const scored = [];
            for (const profile of PROFILES) {
                for (let root = 0; root < 12; root++) {
                    let logLikelihood = 0;
                    for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
                        if (evidence[pitchClass] === 0) continue;
                        logLikelihood += evidence[pitchClass]
                            * profile.logProbability[positiveModulo(pitchClass - root, 12)];
                    }
                    scored.push({
                        root,
                        profile,
                        score: Math.log(profile.prior) + EVIDENCE_TEMPER * logLikelihood
                    });
                }
            }
            const best = Math.max(...scored.map(entry => entry.score));
            const total = scored.reduce((sum, entry) => sum + Math.exp(entry.score - best), 0);
            candidates = scored
                .map(entry => ({
                    root: entry.root,
                    scaleType: entry.profile.scaleType,
                    name: candidateName(entry.root, entry.profile.scaleType),
                    probability: Math.exp(entry.score - best) / total,
                    prior: entry.profile.prior,
                    outside: present
                        .filter(item => !entry.profile.members[positiveModulo(item.pitchClass - entry.root, 12)])
                        .sort((a, b) => b.ms - a.ms)
                        .map(item => item.pitchClass)
                }))
                .sort((a, b) => b.probability - a.probability || b.prior - a.prior || a.root - b.root)
                .filter((candidate, index) => index === 0 || candidate.probability >= MIN_LISTED_PROBABILITY)
                .slice(0, MAX_CANDIDATES)
                .map(({ prior, ...candidate }) => candidate);
        }

        return {
            noteCount: held.length,
            totalMs,
            tuningCents: Math.round(offset * 100),
            pitchClasses,
            distinctPitchClasses: present.length,
            ready,
            candidates
        };
    }

    return {
        CANDIDATE_SCALE_TYPES: Object.freeze(CANDIDATE_SCALES.map(candidate => candidate.scaleType)),
        MIN_DISTINCT_PITCH_CLASSES,
        MIN_HELD_NOTES,
        PRESENT_SHARE,
        rank
    };
})();

window.ScaleFinder = ScaleFinder;
