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
// The good/ok bands decide what counts as a hit; identity separates
// "this note, held loosely" from "a different note". A note sung 90
// cents off still never reads as a hit (it exceeds OK_CENTS) - it reads
// as this note, missed.
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

    // Bands doubled 2026-07-08 (owner-directed): the tight bands read as
    // punishing in real takes. good/ok grade the note; identity separates
    // "this note, loosely" from "a different note".
    const MIN_VOICED = 3;           // samples needed to call the note attempted
    const IDENTITY_CENTS = 140;     // within ~1.4 semitones = reaching for THIS note
    const STEADY_RATIO = 0.5;       // majority of the window held within that band
    const GOOD_CENTS = 30;          // clean, in-tune
    const OK_CENTS = 60;            // acceptable
    const ACCURACY_ZERO_CENTS = 100; // accuracy reaches 0% at a semitone off

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
     * Incremental held-note segmenter: each sample is processed exactly
     * once as it arrives (the live loop must never re-chew the whole
     * take per tick). A new segment starts at a time gap (wall-clock
     * mode; the voice clock compresses breaths to zero) or when the
     * pitch moves off the running anchor - the median of the last few
     * samples, maintained by insertion into a small sorted window, no
     * per-sample allocation - and stays there. Fragments shorter than
     * MIN_VOICED are transition glides or scrapes, not held notes, and
     * are dropped.
     */
    function createSegmenter() {
        /** @type {{ midi: number, samples: { time: number, midi: number }[] }[]} */
        const closed = [];
        /** @type {{ time: number, midi: number }[]} */
        let current = [];
        /** @type {{ time: number, midi: number }[]} */
        let shiftRun = [];
        /** @type {number[]} arrival order of the anchor window */
        const anchorQueue = [];
        /** @type {number[]} the same midis kept sorted */
        const anchorSorted = [];

        /** @param {number} midi */
        function anchorPush(midi) {
            anchorQueue.push(midi);
            let at = 0;
            while (at < anchorSorted.length && anchorSorted[at] < midi) at++;
            anchorSorted.splice(at, 0, midi);
            if (anchorQueue.length > SEGMENT_ANCHOR_SPAN) {
                const evicted = anchorQueue.shift();
                anchorSorted.splice(anchorSorted.indexOf(/** @type {number} */(evicted)), 1);
            }
        }

        function anchorMedian() {
            const mid = Math.floor(anchorSorted.length / 2);
            return anchorSorted.length % 2 === 1
                ? anchorSorted[mid]
                : (anchorSorted[mid - 1] + anchorSorted[mid]) / 2;
        }

        /** @param {{ time: number, midi: number }[]} samples */
        function anchorReset(samples) {
            anchorQueue.length = 0;
            anchorSorted.length = 0;
            for (const sample of samples.slice(-SEGMENT_ANCHOR_SPAN)) anchorPush(sample.midi);
        }

        function closeCurrent() {
            if (current.length >= MIN_VOICED) {
                closed.push({ midi: median(current.map(s => s.midi)), samples: current });
            }
        }

        return {
            /** @param {{ time: number, midi: number }} sample */
            push(sample) {
                if (!sample || !Number.isFinite(sample.midi)) return;
                if (!current.length) {
                    current = [sample];
                    anchorReset(current);
                    return;
                }
                const previous = current[current.length - 1];
                if (Math.abs(sample.time - previous.time) > SEGMENT_BREAK_MS) {
                    closeCurrent();
                    current = [sample];
                    shiftRun = [];
                    anchorReset(current);
                    return;
                }
                if (Math.abs(sample.midi - anchorMedian()) > SEGMENT_SHIFT_MIDI) {
                    shiftRun.push(sample);
                    if (shiftRun.length >= SEGMENT_SHIFT_CONFIRM) {
                        closeCurrent();
                        current = shiftRun.slice();
                        shiftRun = [];
                        anchorReset(current);
                    }
                    return;
                }
                shiftRun = [];
                current.push(sample);
                anchorPush(sample.midi);
            },

            /** Closed segments plus the still-open hold (when big enough), in order. */
            segments() {
                const out = closed.slice();
                if (current.length >= MIN_VOICED) {
                    out.push({ midi: median(current.map(s => s.midi)), samples: current });
                }
                return out;
            }
        };
    }

    /**
     * One-shot segmentation of a full take (the incremental segmenter is
     * the single implementation; this feeds it in time order).
     * @param {{ time: number, midi: number }[]} samples time-sorted
     * @returns {{ midi: number, samples: { time: number, midi: number }[] }[]}
     */
    function segmentSamples(samples) {
        const segmenter = createSegmenter();
        for (const sample of samples) segmenter.push(sample);
        return segmenter.segments();
    }

    /**
     * Align sung segments to the target sequence (order-preserving,
     * minimal total cost) and grade each aligned pair with scoreWindow.
     * Timing never decides a verdict - only which pitches were sung, in
     * what order. A repeated equal-pitch target may share one held
     * segment (its samples split between them).
     *
     * The alignment is a PREFIX: the sung segments consume only as many
     * leading targets as they account for. Each result carries
     * `reached` - true for targets inside the sung prefix (matched, or
     * skipped over and therefore missed), false for targets the singer
     * has not gotten to yet. Unreached targets never get a verdict here;
     * the CALLER decides when "not yet sung" becomes "never sung".
     *
     * @param {{ time: number, midi: number }[]} history all voiced samples of the take
     * @param {{ midi: number }[]} targets active targets, in order
     * @param {{ finalSegmentOpen?: boolean }} [options] exclude the still-being-sung segment
     * @returns {(ReturnType<typeof scoreWindow> & { reached: boolean })[]} one result per target
     */
    function scoreSequence(history, targets, options = {}) {
        const voiced = (history || [])
            .filter(s => s && Number.isFinite(s.midi))
            .slice()
            .sort((a, b) => a.time - b.time);
        return alignSegments(segmentSamples(voiced), targets, options);
    }

    /**
     * The alignment behind scoreSequence, taking segments directly so a
     * live loop with an incremental segmenter never re-segments the take.
     * Same contract: one result per target, with `reached`.
     * @param {{ midi: number, samples: { time: number, midi: number }[] }[]} allSegments
     * @param {{ midi: number }[]} targets active targets, in order
     * @param {{ finalSegmentOpen?: boolean }} [options] exclude the still-being-sung segment
     * @returns {(ReturnType<typeof scoreWindow> & { reached: boolean })[]}
     */
    function alignSegments(allSegments, targets, options = {}) {
        let segments = allSegments;
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

        // Prefix end: the alignment consumes all sung segments but only
        // as many leading targets as they pay for - trailing targets are
        // not-yet-reached, never "skipped". Ties keep the shorter prefix.
        let prefixEnd = 0;
        for (let j = 1; j <= nTgt; j++) {
            if (cost[nSeg][j] < cost[nSeg][prefixEnd]) prefixEnd = j;
        }

        /** @type {number[]} target index -> segment index (-1 = unmatched) */
        const segmentForTarget = new Array(nTgt).fill(-1);
        let i = nSeg;
        let j = prefixEnd;
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
            const reached = tgtIndex < prefixEnd;
            const segIndex = segmentForTarget[tgtIndex];
            if (segIndex < 0) return { ...scoreWindow([], target.midi), reached };
            const shared = sharing.get(segIndex) || [tgtIndex];
            const segment = segments[segIndex];
            if (shared.length === 1) return { ...scoreWindow(segment.samples, target.midi), reached };
            const per = Math.floor(segment.samples.length / shared.length);
            const position = shared.indexOf(tgtIndex);
            const slice = position === shared.length - 1
                ? segment.samples.slice(position * per)
                : segment.samples.slice(position * per, (position + 1) * per);
            return { ...scoreWindow(slice, target.midi), reached };
        });
    }

    return {
        scoreWindow,
        scoreSequence,
        alignSegments,
        createSegmenter,
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
