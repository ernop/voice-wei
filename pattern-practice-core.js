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
     * @returns {Array<{ midi: number, name: string, noteName: string, octave: number, offset: number, degree: string }>}
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
                const name = scaleMidiToPitchString(root, octave, scaleType, midi);
                notes.push({
                    midi,
                    name,
                    noteName: name.replace(/-?\d+$/, ''),
                    octave: midiOctave(midi),
                    offset,
                    degree: offsetToDegree(offset, dp)
                });
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
     * Parse a typed degree series ("5v 1 1 7bv 7v 2# 2") into scale
     * offsets. Token grammar, matching the display vocabulary and the
     * trace pattern input: degree digits (1..8 in-octave, 9+ keeps
     * climbing), then any mix of accidental and octave marks - "#" / "b"
     * pick the chromatic passing note above / below the degree, "v", "d"
     * or "\u2193" drop an octave, "^", "u" or "\u2191" raise one. Marks may repeat
     * ("3vv") and come in any order ("7bv" = "7vb"). Unknown tokens and
     * accidentals that name no chromatic note in the scale (e.g. "3#" in
     * major, a half-step gap) are reported as errors, never guessed at.
     * @param {string} text @param {string} scaleType
     * @returns {{ offsets: number[], errors: string[] }}
     */
    function parseDegreeSeries(text, scaleType) {
        const dp = degreesPerOctave(scaleType);
        /** @type {number[]} */
        const offsets = [];
        /** @type {string[]} */
        const errors = [];
        const tokens = String(text || '').trim().split(/[\s,;/|-]+/).filter(Boolean);
        for (const raw of tokens) {
            const token = raw.toLowerCase();
            const match = /^([0-9]+)([#bdu^v\u2191\u2193]*)$/.exec(token);
            const degree = match ? Number(match[1]) : 0;
            if (!match || degree < 1) {
                errors.push(`"${raw}" is not a degree token`);
                continue;
            }
            const marks = match[2];
            const sharps = (marks.match(/#/g) || []).length;
            const flats = (marks.match(/b/g) || []).length;
            if (sharps + flats > 1) {
                errors.push(`"${raw}" has more than one accidental`);
                continue;
            }
            let offset = degree - 1;
            for (const mark of marks) {
                if (mark === 'v' || mark === 'd' || mark === '\u2193') offset -= dp;
                if (mark === '^' || mark === 'u' || mark === '\u2191') offset += dp;
            }
            if (sharps || flats) {
                const passing = sharps
                    ? chromaticBetween(scaleType, offset, offset + 1)
                    : chromaticBetween(scaleType, offset - 1, offset);
                if (passing === null) {
                    errors.push(`"${raw}": no chromatic note ${sharps ? 'above' : 'below'} degree ${degree} in ${scaleType}`);
                    continue;
                }
                offset = passing;
            }
            offsets.push(offset);
        }
        if (!tokens.length) errors.push('empty series');
        return { offsets, errors };
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
     * The endpoints a phrase-range endpoint may reach, as scale offsets:
     * the low endpoint may descend a full octave below unison, the high
     * endpoint may climb to two octaves. One owner for the page steppers
     * and the generator clamp.
     * @param {string} scaleType
     */
    function phraseRangeLimits(scaleType) {
        const dp = degreesPerOctave(scaleType);
        return { lowMin: -dp, highMax: dp * 2 };
    }

    /**
     * Explicit phrase-range endpoints as scale offsets (0 = degree 1,
     * dp = the octave). The user moves each endpoint independently:
     * negative low reaches below unison, high past dp reaches above the
     * octave, and high below dp shrinks the palette (e.g. high dp-1 =
     * degrees 1..7 only). Sanity-clamped to phraseRangeLimits with
     * low < high always.
     * @param {{ rangeLow?: number, rangeHigh?: number, scaleType: string }} options
     * @param {number} dp - degrees per octave
     */
    function rangeBounds(options, dp) {
        const { lowMin, highMax } = phraseRangeLimits(options.scaleType);
        const high = clamp(Math.round(options.rangeHigh ?? dp), lowMin + 1, highMax);
        const low = clamp(Math.round(options.rangeLow ?? 0), lowMin, high - 1);
        return { min: low, max: high };
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
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
     * Random starts stay in the first octave but must also fit the range
     * bounds.
     * @param {{ startAtOne: boolean }} options
     * @param {number} dp
     * @param {number} minOffset
     * @param {number} maxOffset
     */
    function initialPhraseOffset(options, dp, minOffset, maxOffset) {
        if (options.startAtOne) return 0;
        return randomInt(Math.max(0, minOffset), Math.min(dp, maxOffset));
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
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean
     * }} options
     * @returns {{ dp: number, minOffset: number, maxOffset: number, length: number, initial: number, offsets: number[] }}
     */
    function phraseSeed(options) {
        const dp = degreesPerOctave(options.scaleType);
        const { min: minOffset, max: maxOffset } = rangeBounds(options, dp);
        const length = phraseLength(options);
        const initial = initialPhraseOffset(options, dp, minOffset, maxOffset);
        return { dp, minOffset, maxOffset, length, initial, offsets: [initial] };
    }

    /**
     * The default generator: a balanced contour with mostly local motion,
     * occasional leaps, and dampened straight scalar runs.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
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
     *   rangeLow: number,
     *   rangeHigh: number,
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
     *   rangeLow: number,
     *   rangeHigh: number,
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
     *   rangeLow: number,
     *   rangeHigh: number,
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
     *   rangeLow: number,
     *   rangeHigh: number,
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
     *   rangeLow: number,
     *   rangeHigh: number,
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
     *   rangeLow: number,
     *   rangeHigh: number,
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

    /**
     * Fisher-Yates shuffle into a new array.
     * @param {number[]} values
     * @returns {number[]}
     */
    function shuffled(values) {
        const out = values.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = randomInt(0, i);
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    /**
     * Shuffle with the no-stutter rule: no value may equal its neighbor,
     * including the fixed boundary values around the shuffled section
     * (the 1-anchors in rearrange phrases). After the shuffle, each
     * conflicting position is repaired by swapping with a position where
     * the swap resolves the conflict without creating a new one. Pools
     * with a value in the majority (impossible to separate) keep the
     * unavoidable repeats.
     * @param {number[]} values
     * @param {number | null} leftBoundary
     * @param {number | null} rightBoundary
     * @returns {number[]}
     */
    function shuffledWithoutAdjacentRepeats(values, leftBoundary, rightBoundary) {
        const out = shuffled(values);
        /** @param {number} index */
        const conflicted = index => {
            const left = index === 0 ? leftBoundary : out[index - 1];
            const right = index === out.length - 1 ? rightBoundary : out[index + 1];
            return out[index] === left || out[index] === right;
        };
        for (let i = 0; i < out.length; i++) {
            if (!conflicted(i)) continue;
            for (let j = 0; j < out.length; j++) {
                if (j === i || out[j] === out[i]) continue;
                [out[i], out[j]] = [out[j], out[i]];
                if (!conflicted(i) && !conflicted(j)) break;
                [out[i], out[j]] = [out[j], out[i]];
            }
        }
        return out;
    }

    /**
     * Passing tones for rearrange phrases are INSERTED, never substituted:
     * a rearrangement must still exhaust every scale note in the range, so
     * the chromatic neighbor joins the phrase in addition to the notes it
     * connects (contrast applyChromaticPassingChoices, which replaces).
     * @param {number[]} offsets
     * @param {{ scaleType: string, accidentalRate?: number }} options
     * @returns {number[]}
     */
    function insertChromaticPassingTones(offsets, options) {
        const chance = clamp(options.accidentalRate || 0, 0, 1);
        if (chance <= 0 || !offsets.length) return offsets;
        const out = [offsets[0]];
        for (let i = 1; i < offsets.length; i++) {
            const passing = chromaticBetween(options.scaleType, offsets[i - 1], offsets[i]);
            if (passing !== null && Math.random() < chance) out.push(passing);
            out.push(offsets[i]);
        }
        return out;
    }

    /**
     * How unmusical an offset sequence sounds, judged only on how its
     * intervals are SEQUENCED, never on their sizes - rearrangement
     * phrases must keep their full variety of gaps. Penalized: leaps
     * stacked in the same direction and back-to-back wide leaps.
     * Rewarded: a leap resolved by contrary stepwise motion (the classic
     * recovery the ear expects).
     * @param {number[]} offsets
     */
    function melodicWildness(offsets) {
        let cost = 0;
        for (let i = 2; i < offsets.length; i++) {
            const prev = offsets[i - 1] - offsets[i - 2];
            const next = offsets[i] - offsets[i - 1];
            const sameDirection = Math.sign(prev) === Math.sign(next);
            if (Math.abs(prev) >= 3) {
                if (sameDirection && Math.abs(next) >= 3) cost += 3;
                else if (sameDirection) cost += 1;
                else if (Math.abs(next) <= 2) cost -= 1;
            }
            if (Math.abs(prev) >= 5 && Math.abs(next) >= 5) cost += 2;
        }
        return cost;
    }

    /**
     * Rearrange: every scale note inside the selected range appears exactly
     * once (or `copies` times), in random order, with no immediate repeats.
     * Length is dictated by the range, not by Min/Max.
     *
     * The 1-anchors consume degree 1's copies from the pool: with
     * 'start at 1' and/or 'return to 1' on, the anchored 1s are the pool's
     * 1s, so 1 never also appears inside the body. Single rearrange with
     * both anchors on is the one case where 1 sounds twice (both bookends)
     * by design. Degree 8 (the octave) is its own note and stays in the
     * body - only literal degree 1 (offset 0) is anchor-managed.
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   accidentalRate?: number
     * }} options
     * @param {number} copies
     * @returns {number[]}
     */
    const REARRANGE_CANDIDATES = 24;
    function generateRearrangeOffsets(options, copies) {
        const dp = degreesPerOctave(options.scaleType);
        const { min: minOffset, max: maxOffset } = rangeBounds(options, dp);
        const startAnchor = options.startAtOne;
        const endAnchor = options.returnToInitial || options.returnToRoot;
        const anchoredOnes = (startAnchor ? 1 : 0) + (endAnchor ? 1 : 0);
        const bodyOnes = Math.max(0, copies - anchoredOnes);

        /** @type {number[]} */
        const pool = [];
        for (let offset = minOffset; offset <= maxOffset; offset++) {
            const count = offset === 0 ? bodyOnes : copies;
            for (let c = 0; c < count; c++) pool.push(offset);
        }

        // Best-of-K shuffles: every permutation remains reachable (the
        // gap coverage that makes rearrange worth practicing is intact),
        // but among the candidates the least wild interval SEQUENCING
        // wins, so the phrase sounds arranged rather than rolled.
        let offsets = [];
        let bestCost = Infinity;
        for (let candidate = 0; candidate < REARRANGE_CANDIDATES; candidate++) {
            const body = shuffledWithoutAdjacentRepeats(
                pool,
                startAnchor ? 0 : null,
                endAnchor ? 0 : null
            );
            const attempt = [];
            if (startAnchor) attempt.push(0);
            attempt.push(...body);
            if (endAnchor) attempt.push(0);
            const cost = melodicWildness(attempt);
            if (cost < bestCost) {
                bestCost = cost;
                offsets = attempt;
            }
        }
        return insertChromaticPassingTones(offsets, options);
    }

    /**
     * Ordered note combinations ("subsequences") of a phrase for powerset
     * practice: all size-minSize combinations in lexicographic position
     * order, then all of the next size, up to the whole phrase. Two
     * filters: combos whose values stutter (adjacent equal notes) are
     * skipped, and combos that READ identically to one already produced
     * at the same size are skipped - 1,2,1 drawn from a different pair
     * of positions is still 1,2,1 and appears once.
     *
     * Lazy by necessity: combination counts grow combinatorially with
     * phrase length, so passes are produced one at a time as the user
     * advances, and only the visited texts are remembered.
     * @param {number[]} values
     * @param {number} minSize
     * @returns {{ next: () => number[] | null }}
     */
    function createUniqueSubsequenceIterator(values, minSize) {
        const n = values.length;
        let size = Math.max(1, Math.min(minSize, n));
        /** @type {number[] | null} */
        let combo = null;
        /** @type {Set<string>} */
        const seenAtSize = new Set();

        /** @param {number} k @returns {number[]} */
        function firstCombo(k) {
            return Array.from({ length: k }, (_, i) => i);
        }

        /**
         * Advance to the next lexicographic index combination in place,
         * or return null when the current size is exhausted.
         * @param {number[]} c
         */
        function bumpCombo(c) {
            let i = c.length - 1;
            while (i >= 0 && c[i] === n - c.length + i) i--;
            if (i < 0) return null;
            c[i]++;
            for (let j = i + 1; j < c.length; j++) c[j] = c[j - 1] + 1;
            return c;
        }

        /** @returns {number[] | null} */
        function nextRaw() {
            if (size > n) return null;
            if (combo === null) {
                combo = firstCombo(size);
                return combo;
            }
            if (bumpCombo(combo)) return combo;
            size++;
            seenAtSize.clear();
            if (size > n) return null;
            combo = firstCombo(size);
            return combo;
        }

        return {
            next() {
                for (let raw = nextRaw(); raw !== null; raw = nextRaw()) {
                    const picked = raw.map(index => values[index]);
                    if (picked.some((value, i) => i > 0 && value === picked[i - 1])) continue;
                    const text = picked.join(',');
                    if (seenAtSize.has(text)) continue;
                    seenAtSize.add(text);
                    return raw.slice();
                }
                return null;
            }
        };
    }

    /** @param {number[]} values @param {number} min @param {number} max */
    function boundedDegreeSet(values, min, max) {
        const out = Array.from(new Set(values.map(value => clamp(value, min, max)))).sort((a, b) => a - b);
        return out.length ? out : [min];
    }

    /**
     * A lesson palette re-scoped so the USER'S range endpoints govern the
     * span (the Staff page's authority rule; Phrases keeps lesson-owned
     * ranges via its lock system). The lesson still contributes its
     * CHARACTER: a contiguous drill palette (steps, pentachord, do-re)
     * becomes every degree in the range, while a gapped palette (triads,
     * landmarks, barbershop functions) keeps exactly its pitch classes,
     * tiled across every octave the range covers.
     * @param {number[]} values @param {number} dp
     * @param {number} min @param {number} max
     */
    function rangeGovernedPalette(values, dp, min, max) {
        const sorted = Array.from(new Set(values)).sort((a, b) => a - b);
        const contiguous = sorted.every((value, index) => index === 0 || value - sorted[index - 1] === 1);
        /** @type {number[]} */
        const out = [];
        if (contiguous) {
            for (let offset = min; offset <= max; offset++) out.push(offset);
            return out;
        }
        const classes = new Set(sorted.map(value => positiveModulo(value, dp)));
        for (let offset = min; offset <= max; offset++) {
            if (classes.has(positiveModulo(offset, dp))) out.push(offset);
        }
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
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseStyle?: string,
     *   phraseLesson?: string,
     *   rangeGovernsLessons?: boolean
     * }} options
     * @param {number[]} allowedDegrees
     * @param {'step' | 'skip' | 'mixed' | 'chord'} motion
     */
    function generateAllowedDegreeLesson(options, allowedDegrees, motion) {
        const { dp, minOffset, maxOffset, length, initial } = phraseSeed(options);
        const allowed = options.rangeGovernsLessons
            ? rangeGovernedPalette(allowedDegrees, dp, minOffset, maxOffset)
            : boundedDegreeSet(allowedDegrees, minOffset, maxOffset);
        // 'start at 1' outranks the palette for the seed note, mirroring
        // the return-to-1 anchor at the end: the tonic bookends the
        // phrase (easier to pitch) and the lesson palette governs
        // everything in between.
        const offsets = [options.startAtOne ? 0 : nearestAllowed(allowed, initial)];
        while (offsets.length < length) {
            let next = nextLessonOffset(allowed, offsets[offsets.length - 1], motion);
            if (next === offsets[offsets.length - 1] && allowed.length > 1) {
                next = allowed[randomIntExcluding(0, allowed.length - 1, allowed.indexOf(next))];
            }
            offsets.push(next);
        }
        return addPhraseAnchors(offsets, options);
    }

    // The one palette table: which degrees an allowed-degree lesson may
    // use and how it moves between them. Both the generators AND the
    // pages' palette displays read this, so what the UI names as the
    // palette is by construction what the generator draws from.
    // Pattern-based lessons (fixed melodic shapes) are not palette
    // lessons and are listed in PATTERN_LESSONS instead.
    /** @type {Record<string, { degrees: number[], motion: 'step' | 'skip' | 'mixed' | 'chord', scaleTypeOverride?: string }>} */
    const LESSON_PALETTES = Object.freeze({
        staff_steps: { degrees: [0, 1, 2, 3, 4], motion: 'step' },
        staff_skips: { degrees: [0, 2, 4, 6], motion: 'skip' },
        staff_mixed: { degrees: [0, 1, 2, 3, 4, 5], motion: 'mixed' },
        staff_landmarks: { degrees: [0, 2, 4, 7], motion: 'mixed' },
        sight_do_re: { degrees: [0, 1], motion: 'step' },
        sight_pentachord: { degrees: [0, 1, 2, 3, 4], motion: 'mixed' },
        sight_triad: { degrees: [0, 2, 4, 7], motion: 'chord' },
        sight_minor: { degrees: [0, 1, 2, 3, 4, 5], motion: 'mixed', scaleTypeOverride: 'minor' },
        sight_altered: { degrees: [0, 1, 2, 3, 4, 5, 6], motion: 'step' },
        barber_tonic: { degrees: [0, 2, 4, 7], motion: 'chord' },
        barber_dominant: { degrees: [4, 6, 1, 3], motion: 'chord' },
        barber_subdominant: { degrees: [3, 5, 0], motion: 'chord' },
        barber_thirds: { degrees: [0, 2, 4, 2, 3, 2], motion: 'mixed' },
        barber_sevenths: { degrees: [4, 6, 1, 3, 6], motion: 'chord' },
        genre_folk_hymn: { degrees: [0, 1, 2, 3, 4, 5, 6, 7], motion: 'mixed' },
        genre_pop_hook: { degrees: [0, 1, 2, 4, 5], motion: 'mixed' },
        genre_theatre: { degrees: [0, 1, 2, 3, 4, 5, 6, 7], motion: 'mixed' },
        genre_jazz: { degrees: [0, 1, 2, 4, 5, 6], motion: 'chord' },
        genre_gospel: { degrees: [0, 2, 3, 4, 5, 6], motion: 'mixed' },
        genre_calypso: { degrees: [0, 2, 4, 5, 7], motion: 'mixed' },
        genre_norteno: { degrees: [0, 1, 2, 3, 4], motion: 'skip' },
        genre_cantopop: { degrees: [0, 1, 2, 4, 5], motion: 'step' },
        genre_klezmer: { degrees: [0, 1, 2, 3, 4, 5, 6], motion: 'mixed' },
        genre_modal: { degrees: [0, 1, 2, 3, 4, 5, 6], motion: 'mixed' }
    });
    const PATTERN_LESSONS = Object.freeze(new Set([
        'sight_cadence', 'genre_classical', 'genre_blackbird_folk',
        'genre_hello_pop', 'genre_simon_folk', 'genre_scarborough_modal'
    ]));
    /** @type {Record<string, string>} */
    const STYLE_DEFAULT_LESSON = Object.freeze({
        staff: 'staff_steps',
        sight: 'sight_pentachord',
        barbershop: 'barber_tonic',
        genre: 'genre_folk_hymn'
    });

    /** @param {string} style @param {string | undefined} lesson */
    function paletteSpecFor(style, lesson) {
        if (lesson && LESSON_PALETTES[lesson]) return LESSON_PALETTES[lesson];
        return LESSON_PALETTES[STYLE_DEFAULT_LESSON[style]] || null;
    }

    /**
     * The palette actually in force for the current options - the same
     * resolution the generator applies, exposed for palette displays.
     * Returns null for the free style; { pattern: true } for fixed-shape
     * lessons; otherwise the resolved degree offsets and motion.
     * @param {{
     *   scaleType: string,
     *   phraseStyle?: string,
     *   phraseLesson?: string,
     *   rangeLow?: number,
     *   rangeHigh?: number,
     *   rangeGovernsLessons?: boolean
     * }} options
     * @returns {{ pattern: boolean, degrees: number[], motion: string, dp: number } | null}
     */
    function lessonPalette(options) {
        const style = options.phraseStyle;
        if (!style || style === 'free') return null;
        const lesson = options.phraseLesson || STYLE_DEFAULT_LESSON[style];
        const dp = degreesPerOctave(options.scaleType);
        if (PATTERN_LESSONS.has(lesson)) {
            return { pattern: true, degrees: [], motion: 'pattern', dp };
        }
        const spec = paletteSpecFor(style, lesson);
        if (!spec) return null;
        const effectiveDp = degreesPerOctave(spec.scaleTypeOverride || options.scaleType);
        const { min, max } = rangeBounds({ ...options, scaleType: spec.scaleTypeOverride || options.scaleType }, effectiveDp);
        const degrees = options.rangeGovernsLessons
            ? rangeGovernedPalette(spec.degrees, effectiveDp, min, max)
            : boundedDegreeSet(spec.degrees, min, max);
        return { pattern: false, degrees, motion: spec.motion, dp: effectiveDp };
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
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseStyle?: string,
     *   phraseLesson?: string
     * }} options
     */
    function generateStaffReadingOffsets(options) {
        const spec = paletteSpecFor('staff', options.phraseLesson);
        return generateAllowedDegreeLesson(options, spec.degrees, spec.motion);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseLesson?: string
     * }} options
     */
    function generateSightSingingOffsets(options) {
        if (options.phraseLesson === 'sight_cadence') {
            const length = requestedLength(options);
            return addPhraseAnchors(repeatPattern(randomChoice([
                [0, 1, 2, 3, 4, 3, 2, 1],
                [0, 2, 4, 3, 1],
                [4, 3, 2, 1, 0],
                [0, 3, 4, 2, 1]
            ]), length), options);
        }
        const spec = paletteSpecFor('sight', options.phraseLesson);
        const effective = spec.scaleTypeOverride
            ? { ...options, scaleType: spec.scaleTypeOverride }
            : options;
        return generateAllowedDegreeLesson(effective, spec.degrees, spec.motion);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseLesson?: string
     * }} options
     */
    function generateBarbershopOffsets(options) {
        const spec = paletteSpecFor('barbershop', options.phraseLesson);
        return generateAllowedDegreeLesson(options, spec.degrees, spec.motion);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseLesson?: string
     * }} options
     */
    function generateGenreOffsets(options) {
        const lesson = options.phraseLesson || 'genre_folk_hymn';
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
        const spec = paletteSpecFor('genre', lesson);
        return generateAllowedDegreeLesson(options, spec.degrees, spec.motion);
    }

    /**
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseAlgo?: string,
     *   phraseStyle?: string,
     *   phraseLesson?: string,
     *   accidentalRate?: number,
     *   rangeGovernsLessons?: boolean
     * }} options
     * @returns {number[]}
     */
    function generatePhraseOffsets(options) {
        if (options.phraseStyle === 'staff') return generateStaffReadingOffsets(options);
        if (options.phraseStyle === 'sight') return generateSightSingingOffsets(options);
        if (options.phraseStyle === 'barbershop') return generateBarbershopOffsets(options);
        if (options.phraseStyle === 'genre') return generateGenreOffsets(options);
        if (options.phraseAlgo === 'rearrange') return generateRearrangeOffsets(options, 1);
        if (options.phraseAlgo === 'rearrange_double') return generateRearrangeOffsets(options, 2);
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
     *   rangeLow: number,
     *   rangeHigh: number,
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
     *   rangeLow: number,
     *   rangeHigh: number,
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
        const rootInfo = midiToNoteName(rootMidi);
        return offsets.map((offset, i) => {
            const midi = scaleOffsetToMidi(rootMidi, scaleType, offset);
            return {
                offset,
                midi,
                degree: degrees[i],
                spoken: spokens[i],
                noteName: scaleMidiToPitchString(rootInfo.name, rootInfo.octave, scaleType, midi)
            };
        });
    }

    // Continuous staff-reading stream: phrase chunks joined by rests,
    // metered into 4/4 measures with per-note durations drawn from the
    // enabled duration set. Quarters dominate; longer values color the
    // line without taking it over.
    const DURATION_WEIGHTS = Object.freeze({ 0.5: 2, 1: 4, 2: 2, 4: 1 });
    const STANDARD_REST_BEATS = Object.freeze([4, 2, 1, 0.5]);

    /**
     * @param {number[]} durations ascending allowed note lengths in beats
     * @param {number} remaining beats left in the current measure
     * @returns {number | null} a weighted pick that fits, or null
     */
    function pickDurationBeats(durations, remaining) {
        const fits = durations.filter(beats => beats <= remaining + 1e-9);
        if (!fits.length) return null;
        const total = fits.reduce((sum, beats) => sum + (DURATION_WEIGHTS[beats] || 1), 0);
        let roll = Math.random() * total;
        for (const beats of fits) {
            roll -= DURATION_WEIGHTS[beats] || 1;
            if (roll <= 0) return beats;
        }
        return fits[fits.length - 1];
    }

    /**
     * A stateful generator for the Staff page: an unbounded stream of
     * timed note/rest events. Each call to nextEvents() extends the
     * stream by at least minBeats using the SAME phrase generators the
     * Phrases page uses (style/lesson/algo options pass through), then
     * separates phrases with the configured rest span. Notes never
     * cross a barline: a note that cannot fit the measure remainder is
     * pushed to the next measure and the remainder is filled with
     * standard rests (whole/half/quarter/eighth), largest first.
     *
     * @param {{
     *   scaleType: string,
     *   startAtOne: boolean,
     *   rangeLow: number,
     *   rangeHigh: number,
     *   minLength: number,
     *   maxLength: number,
     *   returnToInitial: boolean,
     *   returnToRoot: boolean,
     *   phraseAlgo?: string,
     *   phraseStyle?: string,
     *   phraseLesson?: string,
     *   accidentalRate?: number,
     *   rangeGovernsLessons?: boolean,
     *   durationBeats?: number[],
     *   restBeats?: number,
     *   restToBarline?: boolean,
     *   startBeat?: number
     * }} options
     */
    function createContinuousSequence(options) {
        const beatsPerMeasure = 4;
        const durations = (Array.isArray(options.durationBeats) && options.durationBeats.length
            ? options.durationBeats.slice()
            : [1]).sort((a, b) => a - b);
        // restBeats is the guaranteed rest after each phrase; restToBarline
        // then extends it to the next barline, so every phrase starts on a
        // downbeat. Both together read "rest at least N, then to the bar".
        const restBeats = Math.max(0, typeof options.restBeats === 'number' ? options.restBeats : 1);
        const restToBarline = options.restToBarline === true;
        let beat = Math.max(0, options.startBeat || 0);

        /** @param {TimedSequenceEvent[]} events @param {number} spanBeats */
        function pushRests(events, spanBeats) {
            let remaining = spanBeats;
            while (remaining > 1e-9) {
                const room = beatsPerMeasure - positiveModulo(beat, beatsPerMeasure);
                let piece = Math.min(remaining, room);
                for (const value of STANDARD_REST_BEATS) {
                    if (value <= piece + 1e-9) {
                        events.push({ type: 'rest', beats: value, startBeat: beat });
                        beat += value;
                        remaining -= value;
                        piece = 0;
                        break;
                    }
                }
                if (piece !== 0) break; // remainder smaller than an eighth
            }
        }

        return {
            /**
             * Generate at least minBeats of new content.
             * @param {number} minBeats
             * @returns {TimedSequenceEvent[]}
             */
            nextEvents(minBeats) {
                /** @type {TimedSequenceEvent[]} */
                const events = [];
                const targetBeat = beat + Math.max(1, minBeats);
                while (beat < targetBeat) {
                    const offsets = generatePhraseOffsets({
                        ...options,
                        accidentalRate: options.accidentalRate || 0
                    });
                    for (const offset of offsets) {
                        const remaining = beatsPerMeasure - positiveModulo(beat, beatsPerMeasure);
                        let beats = pickDurationBeats(durations, remaining);
                        if (beats === null) {
                            pushRests(events, remaining);
                            beats = pickDurationBeats(durations, beatsPerMeasure);
                            if (beats === null) beats = durations[0];
                        }
                        events.push({ type: 'note', offset, beats, startBeat: beat });
                        beat += beats;
                    }
                    if (restBeats > 0) pushRests(events, restBeats);
                    if (restToBarline) {
                        const intoMeasure = positiveModulo(beat, beatsPerMeasure);
                        if (intoMeasure > 1e-9) pushRests(events, beatsPerMeasure - intoMeasure);
                    }
                }
                return events;
            },
            get beatCursor() { return beat; }
        };
    }

    function generatePhrase(options) {
        const rootMidi = noteNameToMidi(options.root, options.octave);
        if (rootMidi === null) return null;

        const accidentalRate = typeof options.accidentalRate === 'number'
            ? options.accidentalRate
            : (options.chromaticRuns ? DEFAULT_CHROMATIC_PASSING_CHANCE : 0);
        const offsets = generatePhraseOffsets({ ...options, accidentalRate });

        return phraseFromOffsets({ ...options, offsets });
    }

    /**
     * The one Phrase constructor: explicit offsets (generated, or typed
     * as a degree series) projected into a key.
     * @param {{ offsets: number[], root: string, octave: number, scaleType: string }} options
     * @returns {Phrase | null}
     */
    function phraseFromOffsets(options) {
        const rootMidi = noteNameToMidi(options.root, options.octave);
        if (rootMidi === null) return null;
        return {
            notes: buildSequenceNotes(options.offsets, rootMidi, options.scaleType),
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
        phraseRangeLimits,
        degreesPerOctave,
        baseIntervalsForScale,
        buildExtendedScale,
        scaleOffsetToMidi,
        offsetToDegree,
        offsetToSpoken,
        offsetsToDisplay,
        offsetsToSpoken,
        parseDegreeSeries,
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
        generateRearrangeOffsets,
        insertChromaticPassingTones,
        melodicWildness,
        createUniqueSubsequenceIterator,
        reflectOffsets,
        lessonPalette,
        createContinuousSequence,
        generatePhrase,
        phraseFromOffsets
    };
})();

window.PatternPracticeCore = PatternPracticeCore;
