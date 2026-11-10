// @ts-check
// ScaleFinder.rank checked in Node on held-note melodies: the familiar
// key wins for ordinary tunes, the tonic separates relative major and
// minor, a smaller scale wins when only its notes are sung, a stray note
// lowers a scale instead of ruling it out (and is named), the singer's
// own tuning does not shift the answer, one long drone cannot outvote
// the melody, and the percentages stay honest (no 100% from a dozen
// notes, nothing confident for a chromatic run).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createReporter } = require('./helpers');

function load() {
    const context = { window: /** @type {any} */ ({}), console };
    vm.createContext(context);
    for (const file of ['music-constants.js', 'scale-finder.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    return { finder: context.window.ScaleFinder, scaleThirdInterval: vm.runInContext('scaleThirdInterval', context) };
}

const { finder, scaleThirdInterval } = load();
const report = createReporter('scale finder');

const PITCH_CLASS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/**
 * Held notes from a melody written as "C4 D4 E4:1000" (500ms unless a
 * length follows the colon), optionally detuned by a fraction of a semitone.
 * @param {string} melody @param {number} [detune]
 */
function held(melody, detune = 0) {
    return melody.split(/\s+/).filter(Boolean).map(token => {
        const match = /^([A-G][#b]?)(\d)(?::(\d+))?$/.exec(token);
        if (!match) throw new Error(`bad note ${token}`);
        return {
            midi: (Number(match[2]) + 1) * 12 + PITCH_CLASS[match[1]] + detune,
            durationMs: match[3] ? Number(match[3]) : 500
        };
    });
}

/** @param {string} melody @param {number} [detune] */
function rank(melody, detune) {
    return finder.rank(held(melody, detune));
}

/** @param {ReturnType<typeof rank>} result */
const top = result => result.candidates.map(c => `${c.name} ${Math.round(c.probability * 100)}%`).slice(0, 3).join(', ');

const C_MAJOR_SCALE = 'C4 D4 E4 F4 G4 A4 B4 C5 B4 A4 G4 F4 E4 D4 C4:1000';

const short = rank('C4 D4 E4');
report.check(`three notes are not enough to rank anything (${short.noteCount} notes, ready ${short.ready}, ${short.candidates.length} candidates)`,
    !short.ready && short.candidates.length === 0 && short.noteCount === 3);

const cMajor = rank(C_MAJOR_SCALE);
const sorted = cMajor.candidates.every((c, i) => i === 0 || c.probability <= cMajor.candidates[i - 1].probability);
const shareSum = cMajor.pitchClasses.reduce((sum, entry) => sum + entry.share, 0);
report.check(`a C major scale reads as C major, its relative minor next (${top(cMajor)})`,
    cMajor.ready && cMajor.candidates[0].name === 'C major' && cMajor.candidates[1].name === 'A minor');
report.check(`candidates are ranked, at most five, and honest about a crude model (top ${Math.round(cMajor.candidates[0].probability * 100)}%, shares sum ${shareSum.toFixed(3)})`,
    sorted && cMajor.candidates.length <= 5 && cMajor.candidates[0].probability < 0.9
    && cMajor.pitchClasses.length === 12 && Math.abs(shareSum - 1) < 1e-9);

const aMinor = rank('A3 B3 C4 D4 E4 F4 G4 A4 G4 F4 E4 D4 C4 B3 A3:1000');
report.check(`the same notes around A read as A minor (${top(aMinor)})`, aMinor.candidates[0].name === 'A minor');

const twinkle = rank('C4 C4 G4 G4 A4 A4 G4:1000 F4 F4 E4 E4 D4 D4 C4:1000 G4 G4 F4 F4 E4 E4 D4:1000 G4 G4 F4 F4 E4 E4 D4:1000 C4 C4 G4 G4 A4 A4 G4:1000 F4 F4 E4 E4 D4 D4 C4:1500');
const birthday = rank('C4:300 C4:200 D4:500 C4:500 F4:500 E4:1000 C4:300 C4:200 D4:500 C4:500 G4:500 F4:1000 C4:300 C4:200 C5:500 A4:500 F4:500 E4:500 D4:1000 Bb4:300 Bb4:200 A4:500 F4:500 G4:500 F4:1500');
report.check(`ordinary tunes find their key with a clear lead (Twinkle: ${top(twinkle)}; Happy Birthday: ${top(birthday)})`,
    twinkle.candidates[0].name === 'C major' && twinkle.candidates[0].probability >= 0.5
    && birthday.candidates[0].name === 'F major' && birthday.candidates[0].probability >= 0.5);

const pentatonic = rank('C4 D4 E4 G4 A4 G4 E4 D4 C4 E4 G4 A4 C5 A4 G4 E4 D4 C4:1000');
report.check(`only pentatonic notes rank the pentatonic above the major scale holding it (${top(pentatonic)})`,
    pentatonic.candidates[0].name === 'C pentatonic'
    && pentatonic.candidates.some(c => c.name === 'C major'));

const blues = rank('A3 C4 D4 Eb4 E4 G4 A4 G4 E4 Eb4 D4 C4 A3:1000 C4 A3:1000');
const minorPent = blues.candidates.find(c => c.name === 'A minor pentatonic');
report.check(`the blue note makes it A blues; the minor pentatonic stays listed with Eb named outside (${top(blues)})`,
    blues.candidates[0].name === 'A blues' && Boolean(minorPent)
    && JSON.stringify(minorPent && minorPent.outside) === JSON.stringify([3]));

const harmonic = rank('A3 B3 C4 D4 E4 F4 G#4 A4 G#4 F4 E4 D4 C4 B3 A3:1000 E4 G#4 A4:1000');
report.check(`a raised seventh reads as harmonic minor (${top(harmonic)})`,
    harmonic.candidates[0].name === 'A harmonic minor');

const flat = rank(C_MAJOR_SCALE, -0.4);
const sharp = rank(C_MAJOR_SCALE, 0.45);
report.check(`a singer 40c flat or 45c sharp throughout still sings C major (tuning ${flat.tuningCents}c: ${top(flat)}; ${sharp.tuningCents}c: ${top(sharp)})`,
    flat.candidates[0].name === 'C major' && flat.tuningCents === -40
    && sharp.candidates[0].name === 'C major' && sharp.tuningCents === 45);

const drone = rank('D4:30000 E4:200 F#4:200 G4:200 A4:200 B4:200 C#5:200 D5:200');
report.check(`a 30s drone on D does not hide the melody around it (${top(drone)})`,
    drone.ready && drone.candidates[0].name === 'D major');

const chromatic = rank('C4 C#4 D4 D#4 E4 F4 F#4 G4 G#4 A4 A#4 B4 C5');
report.check(`a chromatic run gives no confident answer, and the leader lists what it leaves out (${top(chromatic)}; outside ${chromatic.candidates[0].outside.length})`,
    chromatic.distinctPitchClasses === 12 && chromatic.candidates[0].probability < 0.1
    && chromatic.candidates[0].outside.length >= 5);

const bFlat = rank('Bb3 C4 D4 Eb4 F4 G4 A4 Bb4 A4 G4 F4 Eb4 D4 C4 Bb3:1000');
report.check(`keys are spelled the way the pages spell them (${top(bFlat)})`, bFlat.candidates[0].name === 'Bb major');

const thirds = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic', 'minor_pentatonic', 'blues', 'chromatic']
    .map(scaleType => `${scaleType} ${scaleThirdInterval(scaleType)}`).join(', ');
report.check(`each scale's tonic third is the major third only when it lacks the minor one (${thirds})`,
    thirds === 'major 4, minor 3, dorian 3, mixolydian 4, pentatonic 4, minor_pentatonic 3, blues 3, chromatic 3');

report.finish();
