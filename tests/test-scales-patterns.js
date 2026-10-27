// @ts-check
// The note patterns Scales plays (scales-patterns.js), checked directly in
// Node: every movement style against its documented example
// (docs/scales-commands.md), the engine laws in docs/architecture.md
// ("Scales engine rules"), scale walks of any length, exercises, and
// rising repeats.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createReporter } = require('./helpers');

function loadPatterns() {
    const context = { window: /** @type {any} */ ({}) };
    vm.createContext(context);
    for (const file of ['music-constants.js', 'scales-patterns.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    return context.window.ScalesPatterns;
}

const report = createReporter('scales patterns');
const P = loadPatterns();

/**
 * One pass of C4 major, one octave.
 * @param {string} movementStyle
 * @param {string} [direction]
 */
const cMajor = (movementStyle, direction = 'ascending') => P.buildScalePlaybackPlan({
    rootMidi: 60, scaleType: 'major', direction, movementStyle,
    sectionLength: '1o', ladder: 'off', ladderSize: 3, seamlessLoop: false
});

/** @param {{ notes: number[] }[]} groups */
const groupString = groups => groups.map(group => group.notes.join(',')).join(' | ');

// docs/scales-commands.md "Movement styles", the "Example (C major up)"
// column, as MIDI.
const EXAMPLES = {
    stop_and_go: '60,62,64 | 62,64,65 | 64,65,67',
    one_three_five: '60,64,67 | 62,65,69 | 64,67,71',
    neighbors: '60,62,59',
    from_one: '60 | 60,62 | 60,64 | 60,65',
    to_one: '60 | 62,60 | 64,60 | 65,60',
    plus_minus_one: '60,62,59 | 62,64,60 | 64,65,62',
    chords: '60,64,67 | 62,65,69 | 64,67,71',
    chromatic_stop_and_go: '60,61,62 | 62,63,64',
    plus_minus_half: '60,61,59 | 62,63,61',
    third_up: '60,64 | 62,65 | 64,67',
    third_down: '60,57 | 62,59 | 64,60'
};
const exampleMismatches = Object.entries(EXAMPLES).flatMap(([style, expected]) => {
    const count = expected.split(' | ').length;
    const actual = groupString(cMajor(style).groups.slice(0, count));
    return actual === expected ? [] : [`${style}: ${actual}`];
});
report.check(`every movement style plays its documented example (${Object.keys(EXAMPLES).length} styles${exampleMismatches.length ? '; ' + exampleMismatches.join('; ') : ''})`,
    exampleMismatches.length === 0);

const neighborsDown = groupString(cMajor('neighbors', 'descending').groups.slice(0, 1));
report.check(`neighbors follow the direction: C-B-D going down (${neighborsDown})`, neighborsDown === '72,71,74');

const upAndDown = cMajor('normal', 'both').notes.join(',');
report.check(`a turnaround plays its peak once (${upAndDown})`,
    upAndDown === '60,62,64,65,67,69,71,72,71,69,67,65,64,62,60');

// Section notes are sacred, and the final note of a pass resolves clean.
const STYLES = [...new Set(['normal', ...Object.keys(EXAMPLES), ...Object.keys(P.INTERVAL_MOVEMENTS)])];
const DIRECTIONS = ['ascending', 'descending', 'both', 'down_and_up'];
/** @type {string[]} */
const lawBreaks = [];
for (const direction of DIRECTIONS) {
    const sectionNotes = cMajor('normal', direction).notes.join(',');
    for (const style of STYLES) {
        const { groups } = cMajor(style, direction);
        const played = groups.map(group => group.notes[group.sectionIndex]).join(',');
        if (played !== sectionNotes) lawBreaks.push(`${style} ${direction} sections ${played}`);
        if (style !== 'chords' && groups[groups.length - 1].notes.length !== 1) lawBreaks.push(`${style} ${direction} ends with extras`);
    }
}
report.check(`every style plays each section note in order and ends on it alone (${STYLES.length} styles x ${DIRECTIONS.length} directions${lawBreaks.length ? '; ' + lawBreaks.slice(0, 4).join('; ') : ''})`,
    lawBreaks.length === 0);

// A seventh down in a five-note scale wraps past the octave more than once.
const cPentatonic = [60, 62, 64, 67, 69, 72];
const walkDown = P.scaleNotesFrom(60, cPentatonic, 6, -1).join(',');
const walkUp = P.scaleNotesFrom(69, cPentatonic, 6, 1).join(',');
report.check(`scale walks wrap any number of steps (pentatonic down from C4 ${walkDown}; up from A4 ${walkUp})`,
    walkDown === '57,55,52,50,48,45' && walkUp === '72,74,76,79,81,84'
    && P.scaleNotesFrom(61, cPentatonic, 2, 1).length === 0);

// docs/scales-commands.md "Exercises", with 'O' as the octave
const fiveNote = P.buildExerciseNotes(60, 'major', [0, 1, 2, 3, 4, 3, 2, 1, 0]).join(',');
const fiveNoteShifted = P.buildExerciseNotes(60, 'major', [0, 1, 2, 3, 4, 3, 2, 1, 0], 1).join(',');
const octaveJump = P.buildExerciseNotes(60, 'pentatonic', [0, 'O', 0]).join(',');
report.check(`exercises walk scale degrees, shifting moves the start, and 'O' is the scale's own octave (${fiveNote}; ${fiveNoteShifted}; ${octaveJump})`,
    fiveNote === '60,62,64,65,67,65,64,62,60' && fiveNoteShifted === '62,64,65,67,69,67,65,64,62'
    && octaveJump === '60,72,60');

const risen = P.buildRepeatNotes([60, 62, 64], 2, 1, false).join(',');
const seamless = P.buildRepeatNotes([60, 62, 64, 62, 60], 1, 0, true).join(',');
report.check(`repeats rise by their offset and a seamless loop skips the repeated start (${risen}; ${seamless})`,
    risen === '62,64,66' && seamless === '62,64,62,60');

report.finish();
