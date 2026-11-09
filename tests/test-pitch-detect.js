// @ts-check
// PitchDetectCore.detectPitch checked directly in Node against synthetic
// sung notes across the singable band (D2-D5): a glottal pulse train
// with cycle-to-cycle jitter and shimmer, shaped by vowel formants, and
// optionally through a phone mic's low cut. The octave is the contract -
// the Sing charts draw the voice where the detector says it is, so an
// octave-low read puts a sung Bb4 on the Bb3 rail (owner, 2026-11-03).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createReporter } = require('./helpers');

function loadDetector() {
    const context = { window: /** @type {any} */ ({}), console, performance, requestAnimationFrame() {}, cancelAnimationFrame() {} };
    vm.createContext(context);
    for (const file of ['music-constants.js', 'pitch-detect-core.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    return context.window.PitchDetectCore;
}

const report = createReporter('pitch detect');
const { detectPitch, VOICE_MIN_MIDI, VOICE_MAX_MIDI } = loadDetector();

const SAMPLE_RATE = 48000;
const FRAME = 2048;
const SETTLE = 4000;

let seed = 12345;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += random();
    return (sum - 3) / Math.sqrt(0.5);
};

/** @typedef {[number, number, number][]} Formants center Hz, bandwidth Hz, gain */
const VOWELS = /** @type {Record<string, Formants>} */ ({
    ah: [[700, 90, 1], [1150, 100, 0.6], [2600, 150, 0.25]],
    oo: [[350, 70, 1], [800, 90, 0.4], [2500, 150, 0.1]],
    ee: [[300, 60, 1], [2300, 120, 0.5], [3000, 150, 0.3]],
    eh: [[550, 80, 1], [1800, 120, 0.5], [2500, 150, 0.3]]
});

/** @param {Float32Array} input @param {number} center @param {number} bandwidth */
function resonate(input, center, bandwidth) {
    const r = Math.exp(-Math.PI * bandwidth / SAMPLE_RATE);
    const a1 = 2 * r * Math.cos(2 * Math.PI * center / SAMPLE_RATE);
    const a2 = -r * r;
    const out = new Float32Array(input.length);
    for (let i = 2; i < input.length; i++) out[i] = input[i] + a1 * out[i - 1] + a2 * out[i - 2];
    return out;
}

/** Second-order high-pass (two one-pole passes), a phone mic's low cut. @param {Float32Array} x @param {number} cutoff */
function lowCut(x, cutoff) {
    const a = Math.exp(-2 * Math.PI * cutoff / SAMPLE_RATE);
    for (let pass = 0; pass < 2; pass++) {
        let previousIn = 0;
        let previousOut = 0;
        for (let i = 0; i < x.length; i++) {
            const out = a * (previousOut + x[i] - previousIn);
            previousIn = x[i];
            previousOut = out;
            x[i] = out;
        }
    }
    return x;
}

/**
 * One analyser frame of a sung note.
 * @param {number} midi
 * @param {{ formants: Formants, jitter: number, shimmer: number, alternate?: number, lowCutHz?: number }} voice
 *   alternate: every other glottal pulse this much louder, the next this much softer
 */
function sungFrame(midi, voice) {
    const f0 = 440 * Math.pow(2, (midi - 69) / 12);
    const total = FRAME + SETTLE;
    const source = new Float32Array(total);
    let sign = 1;
    for (let t = random() * SAMPLE_RATE / f0; t < total;) {
        const period = SAMPLE_RATE / f0 * (1 + voice.jitter * gauss());
        const amplitude = (1 + voice.shimmer * gauss()) * (1 + (voice.alternate || 0) * sign);
        sign = -sign;
        const open = 0.4 * period;
        const close = 0.16 * period;
        for (let i = 0; i < period && t + i < total; i++) {
            const g = i < open ? 0.5 * (1 - Math.cos(Math.PI * i / open))
                : i < open + close ? Math.cos(Math.PI * (i - open) / (2 * close)) : 0;
            source[Math.floor(t + i)] += amplitude * g;
        }
        t += period;
    }
    const radiated = new Float32Array(total);
    for (let i = 1; i < total; i++) radiated[i] = source[i] - source[i - 1];
    let sung = new Float32Array(total);
    for (const [center, bandwidth, gain] of voice.formants) {
        const band = resonate(radiated, center, bandwidth);
        for (let i = 0; i < total; i++) sung[i] += gain * band[i];
    }
    if (voice.lowCutHz) sung = lowCut(sung, voice.lowCutHz);
    let peak = 0;
    for (let i = SETTLE; i < total; i++) peak = Math.max(peak, Math.abs(sung[i]));
    const frame = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) frame[i] = 0.3 * sung[SETTLE + i] / peak + 0.003 * gauss();
    return frame;
}

/**
 * How each sung frame read: on its note, an octave low, an octave high,
 * silent, or anything else.
 * @param {{ midi: number, frame: Float32Array }[]} frames
 */
function tally(frames) {
    const counts = { total: frames.length, ok: 0, octaveLow: 0, octaveHigh: 0, silent: 0, other: 0 };
    for (const { midi, frame } of frames) {
        const freq = detectPitch(frame, SAMPLE_RATE);
        if (freq <= 0) { counts.silent++; continue; }
        const off = 69 + 12 * Math.log2(freq / 440) - midi;
        if (Math.abs(off) < 0.5) counts.ok++;
        else if (Math.abs(off + 12) < 0.5) counts.octaveLow++;
        else if (Math.abs(off - 12) < 0.5) counts.octaveHigh++;
        else counts.other++;
    }
    return counts;
}

/** @param {ReturnType<typeof tally>} c */
const pct = (c, key) => `${(100 * c[key] / c.total).toFixed(1)}%`;
/** @param {ReturnType<typeof tally>} c */
const summary = c => `${c.total} frames: ${pct(c, 'ok')} on the note, ${pct(c, 'octaveLow')} octave low, ${pct(c, 'octaveHigh')} octave high, ${pct(c, 'silent')} silent`;

/**
 * @param {(midi: number, vowel: Formants) => object[]} voices
 * @param {{ lowMidi: number, highMidi: number }} [span] defaults to the whole band
 */
function framesAcrossBand(voices, span = { lowMidi: VOICE_MIN_MIDI, highMidi: VOICE_MAX_MIDI }) {
    const frames = [];
    for (let midi = span.lowMidi; midi <= span.highMidi; midi++) {
        for (const vowel of Object.values(VOWELS)) {
            for (const voice of voices(midi, vowel)) {
                frames.push({ midi, frame: sungFrame(midi, /** @type {any} */ (voice)) });
            }
        }
    }
    return frames;
}

/** @param {number} midi @param {Formants} formants */
const ordinaryVoices = (midi, formants) => [
    { formants, jitter: 0.005, shimmer: 0.04 },
    { formants, jitter: 0.01, shimmer: 0.06 },
    { formants, jitter: 0.02, shimmer: 0.08 },
    { formants, jitter: 0.01, shimmer: 0.06, lowCutHz: 200 }
];
const everyday = tally(framesAcrossBand(ordinaryVoices, { lowMidi: VOICE_MIN_MIDI, highMidi: 70 }));
report.check(`ordinary sung notes read on their own note across D2-Bb4, through a phone's low cut too (${summary(everyday)})`,
    everyday.ok / everyday.total >= 0.99 && everyday.octaveLow === 0 && everyday.octaveHigh === 0);

// The default Scales key (C4, one octave) tops out at B4 and C5. With a
// Bb4 band top those read as silence or an octave low on every vowel
// (owner, 2026-11-08). Up here the contract is looser than below: "ee"
// and "oo" put the first formant near HALF the sung pitch (300-350 Hz
// against C5-D5), and with jitter that resonance repeats every two
// cycles, so some frames read an octave low ("ah" and "eh" stay exact).
// Singers usually lift such vowels at these pitches; unproven on a
// recorded voice.
const bandTop = tally(framesAcrossBand(ordinaryVoices, { lowMidi: 71, highMidi: 74 }));
report.check(`ordinary sung notes from B4 to D5 read on their own note, an octave low only rarely (${summary(bandTop)})`,
    bandTop.ok / bandTop.total >= 0.9 && bandTop.octaveLow / bandTop.total <= 0.08 && bandTop.octaveHigh === 0);

// Alternate glottal pulses a little louder and softer still sound at
// their own pitch; the previous 0.015 walk-down margin read about a third
// of these an octave low through the middle of the band.
const alternating = tally(framesAcrossBand((midi, formants) => midi > 67 ? [] : [
    { formants, jitter: 0.008, shimmer: 0.05, alternate: 0.1 },
    { formants, jitter: 0.008, shimmer: 0.05, alternate: 0.1 }
]));
report.check(`a voice whose alternate cycles are 10% louder and softer reads on its note, not an octave low (D2-G4, ${summary(alternating)})`,
    alternating.ok / alternating.total >= 0.9 && alternating.octaveLow / alternating.total <= 0.1);

// A dominant 2nd harmonic (the first formant sitting on it) masquerades
// as the octave above; the walk-down must still find the note.
const harmonic = tally(framesAcrossBand(midi => {
    const f0 = 440 * Math.pow(2, (midi - 69) / 12);
    const formants = /** @type {Formants} */ ([[2 * f0, 80, 1], [2300, 120, 0.3], [3000, 150, 0.2]]);
    return [{ formants, jitter: 0.008, shimmer: 0.05 }];
}));
report.check(`a dominant 2nd harmonic still reads as the sung note (${summary(harmonic)})`,
    harmonic.ok / harmonic.total >= 0.99 && harmonic.octaveHigh === 0);

/** @param {number} hz */
const tone = hz => Float32Array.from({ length: FRAME }, (_, i) => 0.3 * Math.sin(2 * Math.PI * hz * i / SAMPLE_RATE));
const noise = Float32Array.from({ length: FRAME }, () => 0.1 * gauss());
const outside = [55, 900].map(hz => detectPitch(tone(hz), SAMPLE_RATE));
report.check(`tones outside the band and plain noise read as no pitch (55 Hz ${outside[0]}, 900 Hz ${outside[1]}, noise ${detectPitch(noise, SAMPLE_RATE)})`,
    outside.every(freq => freq === -1) && detectPitch(noise, SAMPLE_RATE) === -1);

report.finish();
