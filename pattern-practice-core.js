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
        const baseIntervals = baseIntervalsForScale(scaleType);
        const dp = baseIntervals.length;
        const octaveShift = Math.floor(offset / dp);
        const degreeIndex = positiveModulo(offset, dp);
        return rootMidi + octaveShift * 12 + baseIntervals[degreeIndex];
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
    function generateMotifOffsets(options) {
        const { minOffset, maxOffset, length, initial, offsets } = phraseSeed(options);
        const cells = [
            [1, 1, -2],
            [2, -1, -1],
            [1, -2, 1],
            [3, -1, -2],
            [-1, -1, 2],
            [-2, 1, 1]
        ];
        const cell = randomChoice(cells);
        let current = initial;

        for (let i = 1; i < length; i++) {
            let delta = cell[(i - 1) % cell.length];
            if (i > 1 && (i - 1) % cell.length === 0 && Math.random() < 0.55) {
                delta += randomChoice([-1, 1]);
            }
            current = boundedMove(current, delta, minOffset, maxOffset);
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
        return offsets.map(offset => dp - offset);
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
     *   phraseAlgo?: string
     * }} options
     */
    function generatePhrase(options) {
        const rootMidi = noteNameToMidi(options.root, options.octave);
        if (rootMidi === null) return null;

        const dp = degreesPerOctave(options.scaleType);
        const offsets = generatePhraseOffsets(options);
        const midiNotes = offsets.map(offset => scaleOffsetToMidi(rootMidi, options.scaleType, offset));

        return {
            offsets,
            midiNotes,
            displayDegrees: offsets.map(offset => offsetToDegree(offset, dp)),
            spokenDegrees: offsets.map(offset => offsetToSpoken(offset, dp)),
            noteNames: midiNotes.map(midi => midiToPitchString(midi)),
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
        midiToSpeechPitch,
        generatePhraseOffsets,
        generateClusteredOffsets,
        reflectOffsets,
        generatePhrase
    };
})();

window.PatternPracticeCore = PatternPracticeCore;
