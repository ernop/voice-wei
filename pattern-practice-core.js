// @ts-check
//-----------------------------------------------------------------------
// PATTERN PRACTICE CORE
// Pure helpers for scale-degree pattern and phrase practice pages.
// Requires music-constants.js.
//-----------------------------------------------------------------------

const PatternPracticeCore = (function () {
    'use strict';

    /** @param {number} min @param {number} max */
    function randomInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    /** @param {ReadonlyArray<any>} items */
    function randomChoice(items) {
        return items[randomInt(0, items.length - 1)];
    }

    /**
     * Uniform random integer in [min, max] excluding one value. Immediate
     * note repetition reads as a stutter, so generators draw with this
     * unless a repeat serves a deliberate anchor.
     * @param {number} min @param {number} max @param {number} exclude
     */
    function randomIntExcluding(min, max, exclude) {
        if (min >= max) return min;
        if (exclude < min || exclude > max) return randomInt(min, max);
        const drawn = randomInt(min, max - 1);
        return drawn >= exclude ? drawn + 1 : drawn;
    }

    /** @param {number} value @param {number} min @param {number} max */
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /** @param {number} n @param {number} modulus */
    function positiveModulo(n, modulus) {
        return ((n % modulus) + modulus) % modulus;
    }

    /** @param {string} scaleType */
    function degreesPerOctave(scaleType) {
        const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        return pattern.filter(interval => interval < 12).length;
    }

    /** @param {string} scaleType */
    function baseIntervalsForScale(scaleType) {
        const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        return pattern.filter(interval => interval < 12);
    }

    /**
     * @param {{ root: string, octave: number, scaleType: string, lowerOctaves?: number, upperOctaves?: number }} options
     * @returns {Array<{ midi: number, name: string, noteName: string, octave: number, offset: number }>}
     */
    function buildExtendedScale(options) {
        const { root, octave, scaleType, lowerOctaves = 0, upperOctaves = 3 } = options;
        const rootMidi = noteNameToMidi(root, octave);
        if (rootMidi === null) return [];

        const baseIntervals = baseIntervalsForScale(scaleType);
        const dp = baseIntervals.length;
        const notes = [];

        for (let octaveShift = -lowerOctaves; octaveShift < upperOctaves; octaveShift++) {
            for (let degreeIndex = 0; degreeIndex < baseIntervals.length; degreeIndex++) {
                const offset = octaveShift * dp + degreeIndex;
                const midi = rootMidi + octaveShift * 12 + baseIntervals[degreeIndex];
                const info = midiToNoteName(midi);
                notes.push({ midi, name: info.full, noteName: info.name, octave: info.octave, offset });
            }
        }

        return notes;
    }

    /**
     * Offset 0 is degree 1; in a 7-note scale, offset 7 is degree 8.
     * Negative offsets address degrees in the lower octave.
     * @param {number} rootMidi
     * @param {string} scaleType
     * @param {number} offset
     */
    function scaleOffsetToMidi(rootMidi, scaleType, offset) {
        // Half-integer offsets are chromatic passing tones: the note
        // between two adjacent scale degrees (only generated where the
        // degrees are a whole step apart, so this lands on the chromatic
        // note - e.g. 4.5 in C major is F#).
        if (!Number.isInteger(offset)) {
            const lower = scaleOffsetToMidi(rootMidi, scaleType, Math.floor(offset));
            const upper = scaleOffsetToMidi(rootMidi, scaleType, Math.ceil(offset));
            return Math.round((lower + upper) / 2);
        }
        const baseIntervals = baseIntervalsForScale(scaleType);
        const dp = baseIntervals.length;
        const octaveShift = Math.floor(offset / dp);
        const degreeIndex = positiveModulo(offset, dp);
        return rootMidi + octaveShift * 12 + baseIntervals[degreeIndex];
    }

    /**
     * The chromatic passing offset between two phrase notes, or null if
     * none exists: the notes must be adjacent scale degrees a whole step
     * apart (4-5 in major has #4 between; 3-4 has nothing).
     * @param {string} scaleType @param {number} a @param {number} b
     * @returns {number | null}
     */
    function chromaticBetween(scaleType, a, b) {
        if (Math.abs(a - b) !== 1 || !Number.isInteger(a) || !Number.isInteger(b)) return null;
        const lower = Math.min(a, b);
        const gap = scaleOffsetToMidi(0, scaleType, lower + 1) - scaleOffsetToMidi(0, scaleType, lower);
        return gap === 2 ? lower + 0.5 : null;
    }

    /**
     * Display label for a scale-degree offset. In-octave degrees stay 1..8
     * (dp+1 for a 7-note scale). Beyond that: 2↑, 6↓ — not raw 9 or 6d.
     * @param {number} offset @param {number} dp
     */
    function offsetToDegree(offset, dp) {
        if (offset >= 0 && offset <= dp) return String(offset + 1);
        const degree = positiveModulo(offset, dp) + 1;
        if (offset > dp) {
            const octavesAbove = Math.floor(offset / dp);
            return `${degree}${'\u2191'.repeat(octavesAbove)}`;
        }
        const octavesBelow = Math.ceil(Math.abs(offset) / dp);
        return `${degree}${'\u2193'.repeat(octavesBelow)}`;
    }

    /**
     * Spoken label for the same offset ("2 above", "6 below", or "5").
     * @param {number} offset @param {number} dp
     */
    function offsetToSpoken(offset, dp) {
        if (offset >= 0 && offset <= dp) return String(offset + 1);
        const degree = positiveModulo(offset, dp) + 1;
        if (offset > dp) {
            const octavesAbove = Math.floor(offset / dp);
            return octavesAbove === 1 ? `${degree} above` : `${degree} above ${octavesAbove}`;
        }
        const octavesBelow = Math.ceil(Math.abs(offset) / dp);
        return octavesBelow === 1 ? `${degree} below` : `${degree} below ${octavesBelow}`;
    }

    /**
     * Display labels with direction-aware spelling for passing tones:
     * ascending through 4.5 reads "4#", descending reads "5b".
     * @param {number[]} offsets @param {number} dp
     * @returns {string[]}
     */
    function offsetsToDisplay(offsets, dp) {
        return offsets.map((offset, i) => {
            if (Number.isInteger(offset)) return offsetToDegree(offset, dp);
            const next = offsets[i + 1];
            const ascending = next === undefined || next > offset;
            return ascending
                ? `${offsetToDegree(Math.floor(offset), dp)}#`
                : `${offsetToDegree(Math.ceil(offset), dp)}b`;
        });
    }

    /**
     * Spoken labels matching offsetsToDisplay ("sharp 4" / "flat 5").
     * @param {number[]} offsets @param {number} dp
     * @returns {string[]}
     */
    function offsetsToSpoken(offsets, dp) {
        return offsets.map((offset, i) => {
            if (Number.isInteger(offset)) return offsetToSpoken(offset, dp);
            const next = offsets[i + 1];
            const ascending = next === undefined || next > offset;
            return ascending
                ? `sharp ${offsetToSpoken(Math.floor(offset), dp)}`
                : `flat ${offsetToSpoken(Math.ceil(offset), dp)}`;
        });
    }

    /**
     * Native speech pitch is approximate. This mapping keeps spoken numbers
     * moving in the same direction as the exact piano target underneath them.
     * @param {number} midi
     */
    function midiToSpeechPitch(midi) {
        const c4 = noteNameToMidi('C', 4) || 60;
        return clamp(1 + ((midi - c4) / 24), 0.45, 1.9);
    }

    /**
     * Phrase range modes: how far offsets may wander beyond the octave.
     * 'within' = degrees 1..8 only; 'over' = two degrees past each end
     * (down to 6 of the octave below, up to 3 of the octave above for
     * seven-note scales); 'expanded' = half an octave below to two
     * octaves up.
     * @param {string} rangeMode
     * @param {number} dp - degrees per octave
     */
    function rangeBounds(rangeMode, dp) {
        if (rangeMode === 'expanded') return { min: -Math.floor(dp / 2), max: dp * 2 };
        if (rangeMode === 'over') return { min: -2, max: dp + 2 };
        return { min: 0, max: dp };
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     */
    function phraseLength(options) {
        const minLength = clamp(Math.round(options.minLength), 1, 32);
        const maxLength = clamp(Math.max(Math.round(options.maxLength), minLength), minLength, 64);
        return randomInt(minLength, maxLength);
    }

    /**
     * @param {{ startAtOne: boolean }} options
     * @param {number} dp
     */
    function initialPhraseOffset(options, dp) {
        return options.startAtOne ? 0 : randomInt(0, dp);
    }

    /**
     * @param {number[]} offsets
     * @param {{ scaleType: string, returnToInitial: boolean, returnToRoot: boolean, accidentalRate?: number }} options
     */
    function addPhraseAnchors(offsets, options) {
        offsets = applyChromaticPassingChoices(offsets, options);
        if (options.returnToInitial && offsets[offsets.length - 1] !== 0) {
            offsets.push(0);
        }
        if (options.returnToRoot && offsets[offsets.length - 1] !== 0) {
            offsets.push(0);
        }
        return offsets;
    }

    /**
     * @param {number} current
     * @param {number} delta
     * @param {number} minOffset
     * @param {number} maxOffset
     */
    function boundedMove(current, delta, minOffset, maxOffset) {
        let next = current + delta;
        if (next < minOffset || next > maxOffset) next = current - delta;
        if (next < minOffset || next > maxOffset) next = clamp(current + Math.sign(delta || 1), minOffset, maxOffset);
        if (next === current && minOffset < maxOffset) next = current > minOffset ? current - 1 : current + 1;
        return clamp(next, minOffset, maxOffset);
    }

    /**
     * @param {number} current
     * @param {number} target
     * @param {number} maxStep
     * @param {number} minOffset
     * @param {number} maxOffset
     */
    function stepToward(current, target, maxStep, minOffset, maxOffset) {
        if (target === current) {
            return boundedMove(current, randomChoice([-1, 1]), minOffset, maxOffset);
        }
        const distance = target - current;
        const step = Math.sign(distance) * randomInt(1, Math.min(Math.abs(distance), maxStep));
        return boundedMove(current, step, minOffset, maxOffset);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {{ dp: number, minOffset: number, maxOffset: number, length: number, initial: number, offsets: number[] }}
     */
    function phraseSeed(options) {
        const dp = degreesPerOctave(options.scaleType);
        const { min: minOffset, max: maxOffset } = rangeBounds(options.rangeMode, dp);
        const length = phraseLength(options);
        const initial = initialPhraseOffset(options, dp);
        return { dp, minOffset, maxOffset, length, initial, offsets: [initial] };
    }

    /**
     * The default generator: a balanced contour with mostly local motion,
     * occasional leaps, and dampened straight scalar runs.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateBalancedOffsets(options) {
        const { minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);
        let current = initial;

        for (let i = 1; i < length; i++) {
            let next = current;
            for (let attempt = 0; attempt < 8; attempt++) {
                const roll = Math.random();
                if (roll < 0.38) {
                    next = current + randomInt(1, 2) * (Math.random() < 0.5 ? -1 : 1);
                } else if (roll < 0.78) {
                    next = current + randomInt(3, 5) * (Math.random() < 0.5 ? -1 : 1);
                } else {
                    next = randomIntExcluding(minOffset, maxOffset, current);
                    break;
                }

                const delta = next - current;
                const previousDelta = offsets.length >= 2 ? current - offsets[offsets.length - 2] : 0;
                if (Math.abs(delta) === 1 && delta === previousDelta && attempt < 7) {
                    next = current;
                    continue;
                }

                if (next >= minOffset && next <= maxOffset && next !== current) break;
                next = current;
            }

            if (next === current) next = randomIntExcluding(minOffset, maxOffset, current);
            current = clamp(next, minOffset, maxOffset);
            offsets.push(current);
        }

        return addPhraseAnchors(offsets, options);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateRandomOffsets(options) {
        const { minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);

        for (let i = 1; i < length; i++) {
            offsets.push(randomIntExcluding(minOffset, maxOffset, offsets[offsets.length - 1]));
        }

        return addPhraseAnchors(offsets, options);
    }

    /**
     * Conjunct motion: mostly neighboring scale degrees with a few skips.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateStepwiseOffsets(options) {
        const { minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);
        let current = initial;

        for (let i = 1; i < length; i++) {
            const size = Math.random() < 0.82 ? 1 : randomInt(2, 3);
            current = boundedMove(current, size * randomChoice([-1, 1]), minOffset, maxOffset);
            offsets.push(current);
        }

        return addPhraseAnchors(offsets, options);
    }

    /**
     * Disjunct motion with leap compensation: larger intervals tend to resolve
     * by smaller contrary motion.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateLeapyOffsets(options) {
        const { minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);
        let current = initial;
        let previousDelta = 0;

        for (let i = 1; i < length; i++) {
            let delta;
            if (Math.abs(previousDelta) >= 3 && Math.random() < 0.76) {
                delta = -Math.sign(previousDelta) * randomInt(1, 2);
            } else {
                delta = randomInt(3, 5) * randomChoice([-1, 1]);
            }
            const next = boundedMove(current, delta, minOffset, maxOffset);
            previousDelta = next - current;
            current = next;
            offsets.push(current);
        }

        return addPhraseAnchors(offsets, options);
    }

    /**
     * A phrase-level contour: move toward a midpoint climax, then away from it.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateArchOffsets(options) {
        const { minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);
        const ascendFirst = initial <= (minOffset + maxOffset) / 2;
        const apexIndex = Math.max(1, Math.floor((length - 1) * 0.55));
        let current = initial;

        for (let i = 1; i < length; i++) {
            const target = (ascendFirst && i <= apexIndex) || (!ascendFirst && i > apexIndex)
                ? maxOffset
                : minOffset;
            const maxStep = Math.random() < 0.72 ? 2 : 4;
            const previous = current;
            current = stepToward(current, target, maxStep, minOffset, maxOffset);
            if (Math.random() < 0.18) {
                // The wiggle must not step back onto the note just played.
                const wiggled = boundedMove(current, randomChoice([-1, 1]), minOffset, maxOffset);
                if (wiggled !== previous) current = wiggled;
            }
            offsets.push(current);
        }

        return addPhraseAnchors(offsets, options);
    }

    /**
     * Motivic motion: repeat a short contour cell, transposed through the range.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    /**
     * Motif: a short interval shape is the meta-idea, and the phrase is
     * that one shape stated again and again from moving anchors - the
     * same gaps heard from different places in the scale. The shape
     * never mutates; only its starting point moves. The ear is invited
     * to hear through the surface notes to the relationship underneath.
     */
    function generateMotifOffsets(options) {
        const { minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);
        // The identity: 2-3 scale-degree intervals, restated verbatim.
        // No uniform shapes ([1,1]) - those read as scale runs, not as a
        // figure; every shape changes direction or mixes step sizes.
        const shapes = [
            [2, -1], [1, -2], [-2, 1], [2, 1], [-1, -2],
            [1, 2, -1], [2, -1, -1], [1, -2, 1], [3, -1, -1], [-1, 2, 1], [1, 3, -2]
        ];
        const shape = randomChoice(shapes);
        // The guises: how the anchor walks between statements - a steady
        // sequence step (classic rosalia) or a small alternating walk.
        const anchorWalk = randomChoice([[1], [2], [-1], [-2], [2, -1], [1, 1, -2], [3, -1]]);
        let anchor = initial;
        let statement = 0;

        while (offsets.length < length) {
            if (statement > 0) {
                anchor = boundedMove(anchor, anchorWalk[(statement - 1) % anchorWalk.length], minOffset, maxOffset);
                // Never repeat a note back-to-back across the seam: if the
                // new anchor is the note we just ended on, nudge it.
                if (anchor === offsets[offsets.length - 1]) {
                    anchor = boundedMove(anchor, 1, minOffset, maxOffset);
                }
                offsets.push(anchor);
            }
            let position = anchor;
            for (const delta of shape) {
                if (offsets.length >= length) break;
                position = boundedMove(position, delta, minOffset, maxOffset);
                offsets.push(position);
            }
            statement++;
        }

        return addPhraseAnchors(offsets, options);
    }

    /**
     * Alto gap work: orbit the 3/4 and 7/8 pairs, including direct
     * 34, 43, 78, 87 motion plus neighbor approaches around those pairs.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateAltoGapOffsets(options) {
        const { dp, minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);
        const pairStarts = [2, 6].filter(offset => offset + 1 <= dp);
        const patterns = [];
        pairStarts.forEach(start => {
            patterns.push([start, start + 1]);
            patterns.push([start + 1, start]);
            patterns.push([start - 1, start, start + 1]);
            patterns.push([start + 2, start + 1, start]);
            patterns.push([start, start + 1, start - 1]);
            patterns.push([start + 1, start, start + 2]);
        });

        while (offsets.length < length) {
            const pattern = randomChoice(patterns);
            for (const raw of pattern) {
                if (offsets.length >= length) break;
                const offset = clamp(raw, minOffset, maxOffset);
                if (offset !== offsets[offsets.length - 1]) offsets.push(offset);
            }
        }

        return addPhraseAnchors(offsets, options);
    }

    /** @param {number[]} values @param {number} min @param {number} max */
    function boundedDegreeSet(values, min, max) {
        const out = Array.from(new Set(values.map(value => clamp(value, min, max)))).sort((a, b) => a - b);
        return out.length ? out : [min];
    }

    /**
     * @param {number[]} allowed
     * @param {number} current
     */
    function nearestAllowed(allowed, current) {
        return allowed.reduce((best, value) =>
            Math.abs(value - current) < Math.abs(best - current) ? value : best,
        allowed[0]);
    }

    /**
     * @param {number[]} allowed
     * @param {number} current
     * @param {'step' | 'skip' | 'mixed' | 'chord'} motion
     */
    function nextLessonOffset(allowed, current, motion) {
        const index = Math.max(0, allowed.indexOf(current));
        if (motion === 'step') {
            const choices = [allowed[index - 1], allowed[index + 1]].filter(value => value !== undefined);
            return choices.length ? randomChoice(choices) : current;
        }
        if (motion === 'skip') {
            const skips = [allowed[index - 2], allowed[index + 2]].filter(value => value !== undefined);
            if (skips.length && Math.random() < 0.82) return randomChoice(skips);
            const steps = [allowed[index - 1], allowed[index + 1]].filter(value => value !== undefined);
            return steps.length ? randomChoice(steps) : randomChoice(allowed);
        }
        if (motion === 'chord') {
            const far = allowed.filter(value => Math.abs(value - current) >= 2);
            return far.length ? randomChoice(far) : allowed[randomIntExcluding(0, allowed.length - 1, index)];
        }
        const near = allowed.filter(value => Math.abs(value - current) <= 2 && value !== current);
        return (near.length && Math.random() < 0.76) ? randomChoice(near) : randomChoice(allowed);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseStyle?: string,
     *   phraseLesson?: string
     * }} options
     * @param {number[]} allowedDegrees
     * @param {'step' | 'skip' | 'mixed' | 'chord'} motion
     */
    function generateAllowedDegreeLesson(options, allowedDegrees, motion) {
        const { minOffset, maxOffset, length, initial } = phraseSeed(options);
        const allowed = boundedDegreeSet(allowedDegrees, minOffset, maxOffset);
        const offsets = [nearestAllowed(allowed, initial)];
        while (offsets.length < length) {
            let next = nextLessonOffset(allowed, offsets[offsets.length - 1], motion);
            if (next === offsets[offsets.length - 1] && allowed.length > 1) {
                next = allowed[randomIntExcluding(0, allowed.length - 1, allowed.indexOf(next))];
            }
            offsets.push(next);
        }
        return addPhraseAnchors(offsets, options);
    }

    /** @param {number[]} pattern @param {number} length */
    function repeatPattern(pattern, length) {
        const out = [];
        for (let i = 0; out.length < length; i++) out.push(pattern[i % pattern.length]);
        return out;
    }

    /** @param {{ minLength: number, maxLength: number }} options */
    function requestedLength(options) {
        const minLength = clamp(Math.round(options.minLength), 1, 32);
        const maxLength = clamp(Math.max(Math.round(options.maxLength), minLength), minLength, 64);
        return randomInt(minLength, maxLength);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseStyle?: string,
     *   phraseLesson?: string
     * }} options
     */
    function generateStaffReadingOffsets(options) {
        const lesson = options.phraseLesson || 'staff_steps';
        if (lesson === 'staff_skips') return generateAllowedDegreeLesson(options, [0, 2, 4, 6], 'skip');
        if (lesson === 'staff_mixed') return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4, 5], 'mixed');
        if (lesson === 'staff_landmarks') return generateAllowedDegreeLesson(options, [0, 2, 4, 7], 'mixed');
        return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4], 'step');
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseLesson?: string
     * }} options
     */
    function generateSightSingingOffsets(options) {
        const lesson = options.phraseLesson || 'sight_pentachord';
        if (lesson === 'sight_do_re') return generateAllowedDegreeLesson(options, [0, 1], 'step');
        if (lesson === 'sight_triad') return generateAllowedDegreeLesson(options, [0, 2, 4, 7], 'chord');
        if (lesson === 'sight_cadence') {
            const length = requestedLength(options);
            return addPhraseAnchors(repeatPattern(randomChoice([
                [0, 1, 2, 3, 4, 3, 2, 1],
                [0, 2, 4, 3, 1],
                [4, 3, 2, 1, 0],
                [0, 3, 4, 2, 1]
            ]), length), options);
        }
        if (lesson === 'sight_minor') return generateAllowedDegreeLesson({ ...options, scaleType: 'minor' }, [0, 1, 2, 3, 4, 5], 'mixed');
        if (lesson === 'sight_altered') return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4, 5, 6], 'step');
        return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4], 'mixed');
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseLesson?: string
     * }} options
     */
    function generateBarbershopOffsets(options) {
        const lesson = options.phraseLesson || 'barber_tonic';
        if (lesson === 'barber_dominant') return generateAllowedDegreeLesson(options, [4, 6, 1, 3], 'chord');
        if (lesson === 'barber_subdominant') return generateAllowedDegreeLesson(options, [3, 5, 0], 'chord');
        if (lesson === 'barber_thirds') return generateAllowedDegreeLesson(options, [0, 2, 4, 2, 3, 2], 'mixed');
        if (lesson === 'barber_sevenths') return generateAllowedDegreeLesson(options, [4, 6, 1, 3, 6], 'chord');
        return generateAllowedDegreeLesson(options, [0, 2, 4, 7], 'chord');
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseLesson?: string
     * }} options
     */
    function generateGenreOffsets(options) {
        const lesson = options.phraseLesson || 'genre_folk_hymn';
        if (lesson === 'genre_pop_hook') return generateAllowedDegreeLesson(options, [0, 1, 2, 4, 5], 'mixed');
        if (lesson === 'genre_theatre') return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4, 5, 6, 7], 'mixed');
        if (lesson === 'genre_jazz') return generateAllowedDegreeLesson(options, [0, 1, 2, 4, 5, 6], 'chord');
        if (lesson === 'genre_gospel') return generateAllowedDegreeLesson(options, [0, 2, 3, 4, 5, 6], 'mixed');
        if (lesson === 'genre_classical') {
            const length = requestedLength(options);
            return addPhraseAnchors(repeatPattern(randomChoice([
                [0, 1, 2, 3, 1, 2, 3, 4],
                [0, 2, 4, 1, 3, 5],
                [4, 3, 2, 1, 3, 2, 1, 0]
            ]), length), options);
        }
        if (lesson === 'genre_blackbird_folk') {
            const length = requestedLength(options);
            return addPhraseAnchors(repeatPattern(randomChoice([
                [0, 4, 1, 5, 2, 4, 1, 3],
                [0, 2, 5, 4, 1, 3, 4, 2],
                [2, 0, 4, 1, 5, 2, 4, 0]
            ]), length), options);
        }
        if (lesson === 'genre_hello_pop') {
            const length = requestedLength(options);
            return addPhraseAnchors(repeatPattern(randomChoice([
                [0, 1, 2, 3, 4, 2, 1, 0],
                [4, 5, 2, 0, 2, 4, 5, 4],
                [0, 2, 4, 5, 2, 0, 1, 2]
            ]), length), options);
        }
        if (lesson === 'genre_simon_folk') {
            const length = requestedLength(options);
            return addPhraseAnchors(repeatPattern(randomChoice([
                [0, 2, 4, 3, 1, 0, 2, 1],
                [4, 3, 2, 0, 1, 2, 3, 1],
                [0, 1, 3, 4, 3, 1, 2, 0]
            ]), length), options);
        }
        if (lesson === 'genre_scarborough_modal') {
            const length = requestedLength(options);
            return addPhraseAnchors(repeatPattern(randomChoice([
                [0, 1, 3, 4, 3, 1, 0, 1],
                [3, 4, 5, 3, 1, 0, 1, 3],
                [0, 3, 4, 3, 1, 0, 1, 0]
            ]), length), options);
        }
        if (lesson === 'genre_calypso') return generateAllowedDegreeLesson(options, [0, 2, 4, 5, 7], 'mixed');
        if (lesson === 'genre_norteno') return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4], 'skip');
        if (lesson === 'genre_cantopop') return generateAllowedDegreeLesson(options, [0, 1, 2, 4, 5], 'step');
        if (lesson === 'genre_klezmer') return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4, 5, 6], 'mixed');
        if (lesson === 'genre_modal') return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4, 5, 6], 'mixed');
        return generateAllowedDegreeLesson(options, [0, 1, 2, 3, 4, 5, 6, 7], 'mixed');
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseAlgo?: string,
     *   phraseStyle?: string,
     *   phraseLesson?: string
     * }} options
     * @returns {number[]}
     */
    function generatePhraseOffsets(options) {
        if (options.phraseStyle === 'staff') return generateStaffReadingOffsets(options);
        if (options.phraseStyle === 'sight') return generateSightSingingOffsets(options);
        if (options.phraseStyle === 'barbershop') return generateBarbershopOffsets(options);
        if (options.phraseStyle === 'genre') return generateGenreOffsets(options);
        if (options.phraseAlgo === 'random') return generateRandomOffsets(options);
        if (options.phraseAlgo === 'stepwise') return generateStepwiseOffsets(options);
        if (options.phraseAlgo === 'leapy') return generateLeapyOffsets(options);
        if (options.phraseAlgo === 'arch') return generateArchOffsets(options);
        if (options.phraseAlgo === 'motif') return generateMotifOffsets(options);
        if (options.phraseAlgo === 'alto_gaps') return generateAltoGapOffsets(options);
        return generateBalancedOffsets(options);
    }

    /**
     * Backward-compatible name for the default phrase generator.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {number[]}
     */
    function generateClusteredOffsets(options) {
        return generateBalancedOffsets(options);
    }

    /** @param {number[]} offsets @param {string} scaleType */
    function reflectOffsets(offsets, scaleType) {
        const dp = degreesPerOctave(scaleType);
        return offsets.map(offset => {
            const reflected = dp - offset;
            if (Number.isInteger(reflected)) return reflected;
            // A reflected passing tone may land where no chromatic note
            // exists (the gap is a half step there); snap to the degree.
            return chromaticBetween(scaleType, Math.floor(reflected), Math.ceil(reflected)) !== null
                ? reflected
                : Math.floor(reflected);
        });
    }

    /**
     * Chromatic choices (an opt-in difficulty layer): wherever the normal
     * next note is an adjacent scale degree a whole step away, sometimes
     * use the chromatic passing tone for that slot instead. This keeps
     * phrase length exact: Acc changes which notes are chosen, never how
     * many notes there are.
     * @param {number[]} offsets
     * @param {{ scaleType: string, accidentalRate?: number }} options
     * @returns {number[]}
     */
    const DEFAULT_CHROMATIC_PASSING_CHANCE = 0.35;
    function applyChromaticPassingChoices(offsets, options) {
        const chance = typeof options.accidentalRate === 'number'
            ? clamp(options.accidentalRate, 0, 1)
            : DEFAULT_CHROMATIC_PASSING_CHANCE;
        if (chance <= 0) return offsets.slice();
        const out = offsets.slice();
        for (let i = 1; i < offsets.length; i++) {
            const passing = chromaticBetween(options.scaleType, offsets[i - 1], offsets[i]);
            if (passing !== null
                && Math.random() < chance) {
                out[i] = passing;
            }
        }
        return out;
    }

    const addChromaticPassingTones = applyChromaticPassingChoices;

    /**
     * @param {{
     *   root: string,
     *   octave: number,
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeMode: string,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseAlgo?: string,
     *   chromaticRuns?: boolean,
     *   accidentalRate?: number
     * }} options
     * @returns {Phrase | null}
     */
    /**
     * The single construction point for note sequences: zip offsets with
     * their projection and labels ONCE, here. Consumers receive a list
     * of SequenceNote objects and never re-zip parallel arrays by index.
     * @param {number[]} offsets
     * @param {number} rootMidi
     * @param {string} scaleType
     * @returns {SequenceNote[]}
     */
    function buildSequenceNotes(offsets, rootMidi, scaleType) {
        const dp = degreesPerOctave(scaleType);
        const degrees = offsetsToDisplay(offsets, dp);
        const spokens = offsetsToSpoken(offsets, dp);
        return offsets.map((offset, i) => {
            const midi = scaleOffsetToMidi(rootMidi, scaleType, offset);
            return {
                offset,
                midi,
                degree: degrees[i],
                spoken: spokens[i],
                noteName: midiToPitchString(midi)
            };
        });
    }

    function generatePhrase(options) {
        const rootMidi = noteNameToMidi(options.root, options.octave);
        if (rootMidi === null) return null;

        const accidentalRate = typeof options.accidentalRate === 'number'
            ? options.accidentalRate
            : (options.chromaticRuns ? DEFAULT_CHROMATIC_PASSING_CHANCE : 0);
        const offsets = generatePhraseOffsets({ ...options, accidentalRate });

        return {
            notes: buildSequenceNotes(offsets, rootMidi, options.scaleType),
            root: options.root,
            scaleType: options.scaleType,
            octave: options.octave,
            createdAt: new Date().toISOString()
        };
    }

    return {
        randomInt,
        randomIntExcluding,
        clamp,
        positiveModulo,
        rangeBounds,
        degreesPerOctave,
        baseIntervalsForScale,
        buildExtendedScale,
        scaleOffsetToMidi,
        offsetToDegree,
        offsetToSpoken,
        offsetsToDisplay,
        offsetsToSpoken,
        chromaticBetween,
        addChromaticPassingTones,
        applyChromaticPassingChoices,
        buildSequenceNotes,
        midiToSpeechPitch,
        generatePhraseOffsets,
        generateStaffReadingOffsets,
        generateSightSingingOffsets,
        generateBarbershopOffsets,
        generateGenreOffsets,
        generateClusteredOffsets,
        reflectOffsets,
        generatePhrase
    };
})();

window.PatternPracticeCore = PatternPracticeCore;
