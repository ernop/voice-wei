// @ts-check
//-----------------------------------------------------------------------
// PITCH SCORE
// The single owner of "did the singer hit this note, and how accurately?"
// Every sung-pitch verdict in the app (the embedded sing/test panel, the
// Pitch tool's call-and-response and free practice) goes through scoreWindow
// so correctness means exactly one thing everywhere.
//
// Definition of correct, from one consistent idea:
//   1. ATTEMPT - there must be at least MIN_VOICED voiced samples in the
//      note's window. Fewer than that is "didn't sing it", not "wrong".
//   2. IDENTITY - the pitch the singer actually sustained is the MEDIAN of
//      the voiced samples (robust to the onset slide-up, the release, and the
//      occasional octave glitch, which a mean is not). That sustained pitch
//      must sit within IDENTITY_CENTS of the target, AND a majority
//      (STEADY_RATIO) of the samples must be within that band - so wobbling
//      wildly around the target is not credited as holding it.
//   3. ACCURACY - graded from the sustained pitch's distance from the target:
//      good <= GOOD_CENTS, ok <= OK_CENTS, otherwise it counts as missed
//      (the note was reached but held too loosely to be a clean rep).
//
//   biasCents is always reported with sign (+ sharp, - flat) so degree-level
//   weak-spot analysis can say "you overshoot the 6th" - the training goal.
//
// These thresholds are deliberately stricter than the old per-tool numbers
// (which had drifted to a 1.5-semitone / 150-cent match window): a note sung
// 90 cents off is musically a different note and should not read as a hit.
//-----------------------------------------------------------------------

const PitchScore = (function () {
    'use strict';

    const MIN_VOICED = 3;          // samples needed to call the note attempted
    const IDENTITY_CENTS = 70;     // within ~2/3 of a semitone = reaching for THIS note
    const STEADY_RATIO = 0.5;      // majority of the window held within that band
    const GOOD_CENTS = 15;         // clean, in-tune
    const OK_CENTS = 30;           // acceptable
    const ACCURACY_ZERO_CENTS = 50; // accuracy reaches 0% at half a semitone off

    /** @param {number[]} values @returns {number} */
    function median(values) {
        if (values.length === 0) return NaN;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /** Verdict band for an absolute cents deviation of a matched note. @param {number} absCents @returns {'good' | 'ok' | 'missed'} */
    function verdictFor(absCents) {
        return absCents <= GOOD_CENTS ? 'good' : absCents <= OK_CENTS ? 'ok' : 'missed';
    }

    /** @param {number} absCents @returns {number} 0-100 */
    function accuracyFor(absCents) {
        return Math.max(0, Math.min(100, Math.round(100 - absCents * (100 / ACCURACY_ZERO_CENTS))));
    }

    /**
     * Score one note's window of voiced pitch samples against its target.
     * @param {{ midi: number }[]} samples
     * @param {number} targetMidi
     * @returns {{
     *   attempted: boolean,
     *   matched: boolean,
     *   sungMidi: number | null,
     *   avgCents: number,
     *   biasCents: number,
     *   verdict: 'good' | 'ok' | 'missed',
     *   accuracy: number,
     *   sampleCount: number,
     *   onTargetCount: number
     * }}
     */
    function scoreWindow(samples, targetMidi) {
        const voiced = (samples || []).filter(s => s && Number.isFinite(s.midi));
        if (voiced.length < MIN_VOICED) {
            return { attempted: false, matched: false, sungMidi: null, avgCents: 0, biasCents: 0, verdict: 'missed', accuracy: 0, sampleCount: voiced.length, onTargetCount: 0 };
        }

        const sungMidi = median(voiced.map(s => s.midi));
        const biasCents = (sungMidi - targetMidi) * 100;
        const avgCents = Math.abs(biasCents);
        const onTarget = voiced.filter(s => Math.abs(s.midi - targetMidi) * 100 <= IDENTITY_CENTS);
        const steady = onTarget.length / voiced.length >= STEADY_RATIO;
        const matched = steady && avgCents <= IDENTITY_CENTS;
        const verdict = matched ? verdictFor(avgCents) : 'missed';
        const accuracy = matched ? accuracyFor(avgCents) : 0;

        return {
            attempted: true,
            matched,
            sungMidi,
            avgCents,
            biasCents,
            verdict,
            accuracy,
            sampleCount: voiced.length,
            onTargetCount: onTarget.length
        };
    }

    return {
        scoreWindow,
        verdictFor,
        accuracyFor,
        MIN_VOICED,
        IDENTITY_CENTS,
        GOOD_CENTS,
        OK_CENTS
    };
})();

window.PitchScore = PitchScore;
