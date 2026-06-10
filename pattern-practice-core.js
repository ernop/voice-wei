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

    /** @param {number} offset @param {number} dp */
    function offsetToDegree(offset, dp) {
        if (offset >= 0) return String(offset + 1);
        return `${positiveModulo(offset, dp) + 1}d`;
    }

    /** @param {number} offset @param {number} dp */
    function offsetToSpoken(offset, dp) {
        if (offset >= 0) return String(offset + 1);
        return `${positiveModulo(offset, dp) + 1} down`;
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
     * @param {{ returnToInitial: boolean, returnToRoot: boolean }} options
     * @param {number} initial
     */
    function addPhraseAnchors(offsets, options, initial) {
        if (options.returnToInitial && offsets[offsets.length - 1] !== initial) {
            offsets.push(initial);
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

        return addPhraseAnchors(offsets, options, initial);
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

        return addPhraseAnchors(offsets, options, initial);
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

        return addPhraseAnchors(offsets, options, initial);
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

        return addPhraseAnchors(offsets, options, initial);
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

        return addPhraseAnchors(offsets, options, initial);
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

        return addPhraseAnchors(offsets, options, initial);
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
     *   phraseAlgo?: string
     * }} options
     * @returns {number[]}
     */
    function generatePhraseOffsets(options) {
        if (options.phraseAlgo === 'random') return generateRandomOffsets(options);
        if (options.phraseAlgo === 'stepwise') return generateStepwiseOffsets(options);
        if (options.phraseAlgo === 'leapy') return generateLeapyOffsets(options);
        if (options.phraseAlgo === 'arch') return generateArchOffsets(options);
        if (options.phraseAlgo === 'motif') return generateMotifOffsets(options);
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
     * Chromatic runs (an opt-in difficulty layer): wherever two
     * consecutive notes are adjacent degrees a whole step apart,
     * sometimes insert the chromatic note between them - 4 #4 5 going
     * up, 6 b6 5 coming down. Inserts only where such a note exists and
     * never past the phrase length cap.
     * @param {number[]} offsets
     * @param {{ scaleType: string, maxLength: number }} options
     * @returns {number[]}
     */
    const CHROMATIC_PASSING_CHANCE = 0.35;
    function addChromaticPassingTones(offsets, options) {
        const out = [offsets[0]];
        for (let i = 1; i < offsets.length; i++) {
            const passing = chromaticBetween(options.scaleType, offsets[i - 1], offsets[i]);
            const remaining = offsets.length - i;
            if (passing !== null
                && out.length + remaining < options.maxLength
                && Math.random() < CHROMATIC_PASSING_CHANCE) {
                out.push(passing);
            }
            out.push(offsets[i]);
        }
        return out;
    }

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
     *   chromaticRuns?: boolean
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

        let offsets = generatePhraseOffsets(options);
        if (options.chromaticRuns) offsets = addChromaticPassingTones(offsets, options);

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
        buildSequenceNotes,
        midiToSpeechPitch,
        generatePhraseOffsets,
        generateClusteredOffsets,
        reflectOffsets,
        generatePhrase
    };
})();

window.PatternPracticeCore = PatternPracticeCore;
