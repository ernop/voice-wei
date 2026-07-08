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
//
// scoreSequence is how the sing/test panels grade a whole take: the sung
// history is segmented into held notes and aligned IN ORDER to the target
// notes (dynamic alignment tolerating false starts and skipped notes),
// then each aligned pair is graded by scoreWindow. The take's clock never
// decides a verdict: a note held twice its slot, or reached after a long
// breath, scores exactly the same. Fixed windows remain only where a
// window is physically real (the Pitch tool's timed response periods).
//-----------------------------------------------------------------------

const PitchScore = (function () {
    'use strict';

    const MIN_VOICED = 3;          // samples needed to call the note attempted
    const IDENTITY_CENTS = 70;     // within ~2/3 of a semitone = reaching for THIS note
    const STEADY_RATIO = 0.5;      // majority of the window held within that band
    const GOOD_CENTS = 15;         // clean, in-tune
    const OK_CENTS = 30;           // acceptable
    const ACCURACY_ZERO_CENTS = 50; // accuracy reaches 0% at half a semitone off

    // Sequence scoring (scoreSequence): the singer's held notes, aligned
    // in order to the target notes. Timing is free - a note may be held
    // twice its slot or approached after a long breath; what scores is
    // WHICH pitches were sung and in WHAT order, matching what the test
    // asks of a human ("sing these notes"), not "sing on this clock".
    const SEGMENT_BREAK_MS = 250;      // a time gap this long starts a new held note
    const SEGMENT_SHIFT_MIDI = 0.8;    // a sustained move this far off the note starts a new one
    const SEGMENT_SHIFT_CONFIRM = 2;   // consecutive samples that confirm the move
    const SEGMENT_ANCHOR_SPAN = 15;    // running anchor = median of the last N samples
    const SAME_TARGET_MIDI = 0.5;      // consecutive targets closer than this are re-articulations
    const MATCH_CAP_CENTS = 300;       // wrong-note cost saturates at 3 semitones
    const SKIP_TARGET_COST = 2.0;      // alignment penalty: target never sung
    const SKIP_SEGMENT_COST = 1.5;     // alignment penalty: sung sound with no target (false start)
    const STAY_COST = 0.3;             // one held segment serving a repeated equal target

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

    /**
     * Segment voiced samples into held notes: a new segment starts at a
     * time gap (wall-clock mode; the voice clock compresses breaths to
     * zero) or when the pitch moves off the running anchor and stays
     * there. Fragments shorter than MIN_VOICED are transition glides or
     * scrapes, not held notes, and are dropped.
     * @param {{ time: number, midi: number }[]} samples time-sorted
     * @returns {{ midi: number, samples: { time: number, midi: number }[] }[]}
     */
    function segmentSamples(samples) {
        /** @type {{ time: number, midi: number }[][]} */
        const rawSegments = [];
        /** @type {{ time: number, midi: number }[]} */
        let current = [];
        /** @type {{ time: number, midi: number }[]} */
        let shiftRun = [];

        for (const sample of samples) {
            if (!current.length) {
                current = [sample];
                continue;
            }
            const previous = current[current.length - 1];
            if (Math.abs(sample.time - previous.time) > SEGMENT_BREAK_MS) {
                rawSegments.push(current);
                current = [sample];
                shiftRun = [];
                continue;
            }
            const anchor = median(current.slice(-SEGMENT_ANCHOR_SPAN).map(s => s.midi));
            if (Math.abs(sample.midi - anchor) > SEGMENT_SHIFT_MIDI) {
                shiftRun.push(sample);
                if (shiftRun.length >= SEGMENT_SHIFT_CONFIRM) {
                    rawSegments.push(current);
                    current = shiftRun.slice();
                    shiftRun = [];
                }
                continue;
            }
            shiftRun = [];
            current.push(sample);
        }
        if (current.length) rawSegments.push(current);

        return rawSegments
            .filter(segment => segment.length >= MIN_VOICED)
            .map(segment => ({ midi: median(segment.map(s => s.midi)), samples: segment }));
    }

    /**
     * Align sung segments to the target sequence (order-preserving,
     * minimal total cost) and grade each aligned pair with scoreWindow.
     * Timing never decides a verdict - only which pitches were sung, in
     * what order. A repeated equal-pitch target may share one held
     * segment (its samples split between them). Targets left unmatched
     * come back attempted:false; the CALLER decides whether that means
     * "pending" (the singer has not reached it) or "missed".
     *
     * @param {{ time: number, midi: number }[]} history all voiced samples of the take
     * @param {{ midi: number }[]} targets active targets, in order
     * @param {{ finalSegmentOpen?: boolean }} [options] exclude the still-being-sung segment
     * @returns {ReturnType<typeof scoreWindow>[]} one result per target
     */
    function scoreSequence(history, targets, options = {}) {
        const voiced = (history || [])
            .filter(s => s && Number.isFinite(s.midi))
            .slice()
            .sort((a, b) => a.time - b.time);
        let segments = segmentSamples(voiced);
        if (options.finalSegmentOpen && segments.length) {
            segments = segments.slice(0, -1);
        }

        const nSeg = segments.length;
        const nTgt = targets.length;
        /** @param {number} value */
        const costRow = (value) => new Array(nTgt + 1).fill(value);
        /** @type {number[][]} */
        const cost = [];
        /** @type {string[][]} match | skipT | skipS | stay */
        const action = [];
        for (let i = 0; i <= nSeg; i++) {
            cost.push(costRow(Infinity));
            action.push(new Array(nTgt + 1).fill(''));
        }
        cost[0][0] = 0;
        for (let i = 1; i <= nSeg; i++) { cost[i][0] = i * SKIP_SEGMENT_COST; action[i][0] = 'skipS'; }
        for (let j = 1; j <= nTgt; j++) { cost[0][j] = j * SKIP_TARGET_COST; action[0][j] = 'skipT'; }

        for (let i = 0; i <= nSeg; i++) {
            for (let j = 0; j <= nTgt; j++) {
                if (i === 0 && j === 0) continue;
                let best = cost[i][j];
                let bestAction = action[i][j];
                if (i > 0 && j > 0) {
                    const matchCost = Math.min(Math.abs(segments[i - 1].midi - targets[j - 1].midi) * 100, MATCH_CAP_CENTS) / 100;
                    if (cost[i - 1][j - 1] + matchCost < best) {
                        best = cost[i - 1][j - 1] + matchCost;
                        bestAction = 'match';
                    }
                }
                if (j > 0 && cost[i][j - 1] + SKIP_TARGET_COST < best) {
                    best = cost[i][j - 1] + SKIP_TARGET_COST;
                    bestAction = 'skipT';
                }
                if (i > 0 && cost[i - 1][j] + SKIP_SEGMENT_COST < best) {
                    best = cost[i - 1][j] + SKIP_SEGMENT_COST;
                    bestAction = 'skipS';
                }
                // A repeated equal target may reuse the segment that just
                // matched its twin (one long hold sung over "1 1").
                if (i > 0 && j > 1
                    && Math.abs(targets[j - 1].midi - targets[j - 2].midi) < SAME_TARGET_MIDI
                    && (action[i][j - 1] === 'match' || action[i][j - 1] === 'stay')
                    && cost[i][j - 1] + STAY_COST < best) {
                    best = cost[i][j - 1] + STAY_COST;
                    bestAction = 'stay';
                }
                cost[i][j] = best;
                action[i][j] = bestAction;
            }
        }

        /** @type {number[]} target index -> segment index (-1 = unmatched) */
        const segmentForTarget = new Array(nTgt).fill(-1);
        let i = nSeg;
        let j = nTgt;
        while (i > 0 || j > 0) {
            const step = action[i][j];
            if (step === 'match') { segmentForTarget[j - 1] = i - 1; i--; j--; }
            else if (step === 'stay') { segmentForTarget[j - 1] = i - 1; j--; }
            else if (step === 'skipT') { j--; }
            else { i--; }
        }

        // Targets sharing one segment split its samples evenly, in order.
        /** @type {Map<number, number[]>} segment index -> target indexes */
        const sharing = new Map();
        segmentForTarget.forEach((segIndex, tgtIndex) => {
            if (segIndex < 0) return;
            const list = sharing.get(segIndex) || [];
            list.push(tgtIndex);
            sharing.set(segIndex, list);
        });

        return targets.map((target, tgtIndex) => {
            const segIndex = segmentForTarget[tgtIndex];
            if (segIndex < 0) return scoreWindow([], target.midi);
            const shared = sharing.get(segIndex) || [tgtIndex];
            const segment = segments[segIndex];
            if (shared.length === 1) return scoreWindow(segment.samples, target.midi);
            const per = Math.floor(segment.samples.length / shared.length);
            const position = shared.indexOf(tgtIndex);
            const slice = position === shared.length - 1
                ? segment.samples.slice(position * per)
                : segment.samples.slice(position * per, (position + 1) * per);
            return scoreWindow(slice, target.midi);
        });
    }

    return {
        scoreWindow,
        scoreSequence,
        segmentSamples,
        verdictFor,
        accuracyFor,
        MIN_VOICED,
        IDENTITY_CENTS,
        GOOD_CENTS,
        OK_CENTS
    };
})();

window.PitchScore = PitchScore;
