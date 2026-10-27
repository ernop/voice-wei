// @ts-check
//-----------------------------------------------------------------------
// SCALES PATTERNS
// The note patterns Scales plays, as pure functions of their inputs: one
// pass of a section walked by direction, the ladder's rungs, movement
// figures, exercise repetitions, and repeats raised by rising. MIDI in,
// MIDI out; nothing here reads the page's settings, so every pattern can
// be checked directly (tests/test-scales-patterns.js).
// Requires music-constants.js.
//-----------------------------------------------------------------------

/**
 * A phrase playback paces by: a ladder rung, a movement figure, or a
 * chord struck at once.
 * @typedef {Object} ScalesGroup
 * @property {number[]} notes - MIDI
 * @property {number} sectionIndex - which note is the section's own degree (the rest decorate it)
 * @property {boolean} isChord
 */

/**
 * One pass of a scale: its groups, and the same notes flattened.
 * @typedef {Object} ScalesPass
 * @property {ScalesGroup[]} groups
 * @property {number[]} notes
 */

const ScalesPatterns = (function () {
    'use strict';

    // Interval movement styles: each scale degree is followed by a diatonic
    // interval above or below it (scale-based, so absolute semitone size varies).
    // scaleSteps counts scale degrees away: third = 2 steps, seventh = 6 steps.
    /** @type {Record<string, { scaleSteps: number, direction: 1 | -1 }>} */
    const INTERVAL_MOVEMENTS = {
        third_up: { scaleSteps: 2, direction: 1 },
        fourth_up: { scaleSteps: 3, direction: 1 },
        fifth_up: { scaleSteps: 4, direction: 1 },
        sixth_up: { scaleSteps: 5, direction: 1 },
        seventh_up: { scaleSteps: 6, direction: 1 },
        third_down: { scaleSteps: 2, direction: -1 },
        fourth_down: { scaleSteps: 3, direction: -1 },
        fifth_down: { scaleSteps: 4, direction: -1 },
        sixth_down: { scaleSteps: 5, direction: -1 },
        seventh_down: { scaleSteps: 6, direction: -1 }
    };

    /**
     * Build ladder rungs: overlapping windows of `size` consecutive scale
     * degrees, shifting one degree per rung (123, 234, 345, ...). Normal
     * rungs play toward the direction of travel; reverse rungs play against
     * it, so each rung leads with the one note that has not been heard yet
     * (321, 432, 543, ...).
     *
     * Boundary behavior (yui, 2026-08-02):
     * - A turnaround boundary (travel reverses there mid-cycle) REFLECTS:
     *   windows fold over the peak (678, 787, 876, ...).
     * - A terminal boundary (the cycle ends there) PLAYS OUT: windows clip
     *   and shrink to the last boundary note (678, 78, 8) - never stop
     *   while unplayed rung starts remain, and never invent notes beyond
     *   the range.
     * - A seamless loop (repeat forever, no repeat gap, up+down or down+up)
     *   has no terminal end: both boundaries reflect and the cycle is one
     *   full triangle period, so the loop seam continues the climb.
     * @param {Object} params
     * @param {number[]} params.degreesAscAll - Ascending section degrees (MIDI)
     * @param {string} params.direction - ascending, descending, both, down_and_up
     * @param {number} params.size - Notes per rung (clamped to the section)
     * @param {boolean} params.reverse - Lead each rung with the new note
     * @param {boolean} [params.seamlessLoop] - Repeat-forever-no-gap: reflect at the seam too
     * @returns {ScalesPass}
     */
    function buildLadderGroups({ degreesAscAll, direction, size, reverse, seamlessLoop = false }) {
        const asc = degreesAscAll;
        const top = asc.length - 1;
        const rungSize = Math.max(2, Math.min(size, asc.length));

        /** @param {number} start */
        const ascWindow = start => Array.from({ length: rungSize }, (_, j) => start + j);
        /** @param {number} start */
        const descWindow = start => Array.from({ length: rungSize }, (_, j) => start - j);
        /** @param {number} i */
        const reflectTop = i => (i > top ? 2 * top - i : i);
        /** @param {number} i */
        const reflectBottom = i => (i < 0 ? -i : i);

        /** @type {number[][]} */
        const rungs = [];
        // Climb with the top reflected; the start at the peak itself is the
        // first descending rung, so the climb stops one short of it.
        const climbReflected = () => {
            for (let s = 0; s < top; s++) rungs.push(ascWindow(s).map(reflectTop));
        };
        // Descend with the bottom reflected; stops one short of the bottom
        // start, whose rung (123 again) belongs to the next climb - either
        // the following climb phase or the loop seam.
        const descendReflected = () => {
            for (let s = top; s >= 1; s--) rungs.push(descWindow(s).map(reflectBottom));
        };
        // Play out toward a terminal end: rung starts keep walking and the
        // windows clip, shrinking down to the single boundary note.
        const climbPlayedOut = () => {
            for (let s = 0; s <= top; s++) rungs.push(ascWindow(s).filter(i => i <= top));
        };
        const descendPlayedOut = () => {
            for (let s = top; s >= 0; s--) rungs.push(descWindow(s).filter(i => i >= 0));
        };

        if (direction === 'descending') {
            descendPlayedOut();
        } else if (direction === 'both') {
            climbReflected();
            if (seamlessLoop) descendReflected();
            else descendPlayedOut();
        } else if (direction === 'down_and_up') {
            descendReflected();
            if (seamlessLoop) climbReflected();
            else climbPlayedOut();
        } else {
            climbPlayedOut();
        }

        const groups = rungs.map(indices => {
            const notes = indices.map(i => asc[i]);
            return { notes: reverse ? notes.reverse() : notes, sectionIndex: 0, isChord: false };
        });
        return { groups, notes: groups.flatMap(g => g.notes) };
    }

    /**
     * Build movement groups from MIDI note arrays.
     * All inputs and outputs are MIDI integers.
     * @param {Object} params
     * @param {string} params.movementStyle
     * @param {number[]} params.degreesAscAll - Section notes in play order (MIDI)
     * @param {number[]} params.degreesFromRoot
     * @param {number} params.rootMidi
     * @param {number[]} params.degreesAscendingRef - Ascending scale reference (MIDI)
     * @param {string} params.scaleType
     * @param {number} [params.turnIndex]
     * @param {boolean} [params.startsAscending]
     * @returns {ScalesPass}
     */
    function buildMovementSequence({ movementStyle, degreesAscAll, degreesFromRoot, rootMidi, degreesAscendingRef, scaleType, turnIndex = -1, startsAscending = true }) {
        const style = movementStyle || 'normal';
        const sectionNotes = degreesAscAll;
        const ascendingScale = degreesAscendingRef || degreesAscAll;
        const lastIndex = sectionNotes.length - 1;

        let groups = [];

        const makeGroup = (notes, sectionIndex, isChord = false) => ({
            notes,
            sectionIndex,
            isChord
        });

        if (style === 'stop_and_go') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    groups.push(makeGroup([midi, ...scaleNotesFrom(midi, ascendingScale, 2, 1)], 0));
                }
            }
        } else if (style === 'one_three_five') {
            // Arpeggiate the diatonic triad on each scale degree:
            // skip one scale step for the 3rd, skip three for the 5th
            const DIATONIC_3RD = 2;
            const DIATONIC_5TH = 4;
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const scaleSteps = scaleNotesFrom(midi, ascendingScale, DIATONIC_5TH, 1);
                    const moveNotes = [midi];
                    if (scaleSteps.length >= DIATONIC_3RD) moveNotes.push(scaleSteps[DIATONIC_3RD - 1]);
                    if (scaleSteps.length >= DIATONIC_5TH) moveNotes.push(scaleSteps[DIATONIC_5TH - 1]);
                    groups.push(makeGroup(moveNotes, 0));
                }
            }
        } else if (style === 'neighbors') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const belowNotes = scaleNotesFrom(midi, ascendingScale, 1, -1);
                    const aboveNotes = scaleNotesFrom(midi, ascendingScale, 1, 1);

                    let isAscending;
                    if (turnIndex === -1) {
                        isAscending = startsAscending;
                    } else {
                        isAscending = i <= turnIndex ? startsAscending : !startsAscending;
                    }

                    const moveNotes = [];
                    if (isAscending) {
                        if (aboveNotes.length > 0) moveNotes.push(aboveNotes[0]);
                        if (belowNotes.length > 0) moveNotes.push(belowNotes[0]);
                    } else {
                        if (belowNotes.length > 0) moveNotes.push(belowNotes[0]);
                        if (aboveNotes.length > 0) moveNotes.push(aboveNotes[0]);
                    }
                    groups.push(makeGroup([midi, ...moveNotes], 0));
                }
            }
        } else if (style === 'from_one') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex || midi === rootMidi) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    groups.push(makeGroup([rootMidi, midi], 1));
                }
            }
        } else if (style === 'to_one') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === 0 || i === lastIndex || midi === rootMidi) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    groups.push(makeGroup([midi, rootMidi], 0));
                }
            }
        } else if (style === 'plus_minus_one') {
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const aboveNotes = scaleNotesFrom(midi, ascendingScale, 1, 1);
                    const belowNotes = scaleNotesFrom(midi, ascendingScale, 1, -1);
                    const moveNotes = [midi];
                    if (aboveNotes.length > 0) moveNotes.push(aboveNotes[0]);
                    if (belowNotes.length > 0) moveNotes.push(belowNotes[0]);
                    groups.push(makeGroup(moveNotes, 0));
                }
            }
        } else if (style === 'chromatic_stop_and_go') {
            // Chromatic version of stop-and-go: +1 and +2 semitones from each
            // scale degree, regardless of scale membership.
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    groups.push(makeGroup([midi, midi + 1, midi + 2], 0));
                }
            }
        } else if (style === 'plus_minus_half') {
            // Chromatic neighbors: +1 semitone, then -1 semitone from the
            // original note, then continue to the next scale degree.
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    groups.push(makeGroup([midi, midi + 1, midi - 1], 0));
                }
            }
        } else if (INTERVAL_MOVEMENTS[style]) {
            const { scaleSteps, direction } = INTERVAL_MOVEMENTS[style];
            for (let i = 0; i < sectionNotes.length; i++) {
                const midi = sectionNotes[i];
                if (i === lastIndex) {
                    groups.push(makeGroup([midi], 0));
                } else {
                    const steps = scaleNotesFrom(midi, ascendingScale, scaleSteps, direction);
                    const moveNotes = [midi];
                    if (steps.length >= scaleSteps) moveNotes.push(steps[scaleSteps - 1]);
                    groups.push(makeGroup(moveNotes, 0));
                }
            }
        } else if (style === 'chords') {
            for (const midi of sectionNotes) {
                const third = getDiatonicInterval(rootMidi, midi, 'third', scaleType);
                const fifth = getDiatonicInterval(rootMidi, midi, 'fifth', scaleType);
                const chordNotes = [midi];
                if (third !== null) chordNotes.push(third);
                if (fifth !== null) chordNotes.push(fifth);
                groups.push(makeGroup(chordNotes, 0, true));
            }
        } else {
            for (const midi of sectionNotes) {
                groups.push(makeGroup([midi], 0));
            }
        }

        const notes = groups.flatMap(g => g.notes);
        return { groups, notes };
    }

    /**
     * The next `count` scale notes from a scale note, walking up (1) or
     * down (-1) the scale's pitch classes, so the walk continues into any
     * octave. A note outside the scale has none.
     * @param {number} midi
     * @param {number[]} ascendingScaleMidi
     * @param {number} count
     * @param {1 | -1} direction
     * @returns {number[]} MIDI
     */
    function scaleNotesFrom(midi, ascendingScaleMidi, count, direction) {
        const pitchClasses = [...new Set(ascendingScaleMidi.map(midiPitchClass))];
        // steps[k]: semitones from pitch class k up to the next one
        const steps = pitchClasses.map((pc, k) => {
            const step = pitchClasses[(k + 1) % pitchClasses.length] - pc;
            return step <= 0 ? step + 12 : step;
        });
        const start = pitchClasses.indexOf(midiPitchClass(midi));
        if (start === -1) return [];

        const notes = [];
        let current = midi;
        for (let i = 0; i < count; i++) {
            current += direction === 1
                ? steps[(start + i) % steps.length]
                : -steps[positiveModulo(start - i - 1, steps.length)];
            notes.push(current);
        }
        return notes;
    }

    /**
     * Get a diatonic interval (3rd or 5th) above a MIDI note in the selected scale.
     * @param {number} rootMidi
     * @param {number} midi
     * @param {string} intervalName - 'third' or 'fifth'
     * @param {string} scaleType
     * @returns {number | null} MIDI note, or null if invalid interval name
     */
    function getDiatonicInterval(rootMidi, midi, intervalName, scaleType) {
        let degreeSteps;
        if (intervalName === 'third') {
            degreeSteps = 2;
        } else if (intervalName === 'fifth') {
            degreeSteps = 4;
        } else {
            return null;
        }
        const interval = midi - rootMidi;
        const scale = scaleIntervalsInRange(scaleType, interval - 48, interval + 72);
        // Tolerant match: microtonal steps like 2.4 pick up one-ulp float
        // noise on the midi round trip, so exact equality can miss.
        const index = scale.findIndex(value => Math.abs(value - interval) < 1e-6);
        if (index === -1) return null;
        const target = scale[index + degreeSteps];
        return target === undefined ? null : rootMidi + target;
    }

    /**
     * Get the semitone range for a section length setting
     * @param {string} sectionLength
     * @returns {{ min: number, max: number }}
     */
    function getSectionRange(sectionLength) {
        switch (sectionLength) {
            case '1o+3':
                return { min: 0, max: 16 }; // octave + major 3rd
            case '1o+5':
                return { min: 0, max: 19 }; // octave + perfect 5th
            case '2o':
                return { min: 0, max: 24 }; // 2 octaves
            case 'centered':
                return { min: -4, max: 16 }; // major 3rd below to major 3rd above octave
            default: // '1o'
                return { min: 0, max: 12 }; // 1 octave
        }
    }

    /**
     * Build one repetition of an exercise pattern as MIDI notes.
     * 'O' placeholders resolve to this scale's notes-per-octave; shifting
     * moves the starting degree.
     * @param {number} rootMidi
     * @param {string} scaleType
     * @param {(number | 'O')[]} exercisePattern
     * @param {number} [startingDegree]
     * @returns {number[]}
     */
    function buildExerciseNotes(rootMidi, scaleType, exercisePattern, startingDegree = 0) {
        const basePattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS.major;
        const notesPerOctave = basePattern.length - 1;
        const extendedScale = [];

        for (let octaveShift = 0; octaveShift < 3; octaveShift++) {
            for (const interval of basePattern.slice(0, -1)) {
                extendedScale.push(rootMidi + interval + octaveShift * 12);
            }
        }
        const lastInterval = basePattern[basePattern.length - 1] || 12;
        extendedScale.push(rootMidi + lastInterval + 2 * 12);

        const resolvedPattern = exercisePattern.map(v => v === 'O' ? notesPerOctave : v);
        const notes = [];
        for (const offset of resolvedPattern) {
            const scaleIndex = startingDegree + offset;
            if (scaleIndex >= 0 && scaleIndex < extendedScale.length) {
                notes.push(extendedScale[scaleIndex]);
            }
        }
        return notes;
    }

    /**
     * The MIDI notes of one repetition: raised by the rising offset, and
     * without the repeated start note on a seamless loop.
     * @param {number[]} notes
     * @param {number} repeatIndex
     * @param {number} risingSemitones
     * @param {boolean} omitRepeatedStart
     * @returns {number[]}
     */
    function buildRepeatNotes(notes, repeatIndex, risingSemitones, omitRepeatedStart = false) {
        const transpose = repeatIndex * risingSemitones;
        const startIndex = omitRepeatedStart && repeatIndex > 0 ? 1 : 0;
        return notes.slice(startIndex).map(midi => midi + transpose);
    }

    /**
     * One pass of a scale as MIDI: the section's degrees walked in the
     * direction by the ladder or the movement style. The groups are the
     * phrases playback paces by; the notes are the same pass flattened.
     * @param {Object} params
     * @param {number} params.rootMidi
     * @param {string} params.scaleType
     * @param {string} params.direction
     * @param {string} params.movementStyle
     * @param {string} params.sectionLength
     * @param {string} params.ladder
     * @param {number} params.ladderSize
     * @param {boolean} params.seamlessLoop - forever with no gap, so ladder cycles reflect at the seam
     * @returns {ScalesPass}
     */
    function buildScalePlaybackPlan({ rootMidi, scaleType, direction, movementStyle, sectionLength, ladder, ladderSize, seamlessLoop }) {
        const { min, max } = getSectionRange(sectionLength);
        const degreesAscAll = scaleIntervalsInRange(scaleType, min, max).map(interval => rootMidi + interval);

        // The ladder owns sequence generation: rungs replace section-note
        // traversal and movement styles entirely.
        if (ladder !== 'off') {
            return buildLadderGroups({
                degreesAscAll,
                direction,
                size: ladderSize,
                reverse: ladder === 'reverse',
                seamlessLoop
            });
        }

        const ascending = degreesAscAll;
        const descending = [...degreesAscAll].reverse();

        let sectionNotes;
        let turnIndex = -1;
        let startsAscending = true;

        if (direction === 'descending') {
            sectionNotes = descending;
            startsAscending = false;
        } else if (direction === 'both') {
            sectionNotes = [...ascending, ...descending.slice(1)];
            turnIndex = ascending.length - 1;
        } else if (direction === 'down_and_up') {
            sectionNotes = [...descending, ...ascending.slice(1)];
            turnIndex = descending.length - 1;
            startsAscending = false;
        } else {
            sectionNotes = ascending;
        }

        const rootIndexInSection = sectionNotes.indexOf(rootMidi);
        return buildMovementSequence({
            movementStyle,
            degreesAscAll: sectionNotes,
            degreesFromRoot: rootIndexInSection >= 0 ? sectionNotes.slice(rootIndexInSection) : sectionNotes,
            rootMidi,
            degreesAscendingRef: degreesAscAll,
            scaleType,
            turnIndex,
            startsAscending
        });
    }

    return {
        INTERVAL_MOVEMENTS,
        buildLadderGroups,
        buildMovementSequence,
        scaleNotesFrom,
        getDiatonicInterval,
        getSectionRange,
        buildExerciseNotes,
        buildRepeatNotes,
        buildScalePlaybackPlan
    };
})();

window.ScalesPatterns = ScalesPatterns;
