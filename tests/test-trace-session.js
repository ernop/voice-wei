// @ts-check
// PitchDetectCore.createTraceSession's voice clock, checked in Node with a
// fake wall clock, hand-stepped animation frames, and a fake microphone
// that hears either a steady sung tone or silence. The contract: with
// pause-on-silence a pause adds at most the silence allowance to the take
// clock; changing the allowance mid-pause changes the time from then on
// (the chart never jumps); a session that never sets an allowance keeps
// the clock that stops in silence.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createReporter } = require('./helpers');

const FRAME_MS = 16;
const SAMPLE_RATE = 48000;
const SUNG_HZ = 220;

function loadHarness() {
    let now = 1000;
    /** @type {(() => void) | null} */
    let pendingFrame = null;
    /** @type {number | null} the heard tone; null is silence */
    let toneHz = null;
    const analyser = {
        fftSize: 2048,
        /** @param {Float32Array} buffer */
        getFloatTimeDomainData(buffer) {
            for (let i = 0; i < buffer.length; i++) {
                buffer[i] = toneHz === null ? 0 : 0.3 * Math.sin(2 * Math.PI * toneHz * i / SAMPLE_RATE);
            }
        }
    };
    class FakeAudioContext {
        constructor() {
            this.state = 'running';
            this.sampleRate = SAMPLE_RATE;
        }
        async resume() { }
        createMediaStreamSource() { return { connect() { }, disconnect() { } }; }
        createAnalyser() { return analyser; }
    }
    const context = {
        window: /** @type {any} */ ({ AudioContext: FakeAudioContext }),
        navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
        console,
        performance: { now: () => now },
        /** @param {() => void} callback */
        requestAnimationFrame(callback) {
            pendingFrame = callback;
            return 1;
        },
        cancelAnimationFrame() {
            pendingFrame = null;
        }
    };
    vm.createContext(context);
    for (const file of ['music-constants.js', 'pitch-detect-core.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    return {
        core: context.window.PitchDetectCore,
        /**
         * Step animation frames through `ms` of wall time hearing `hz`.
         * @param {number} ms @param {number | null} hz
         */
        run(ms, hz) {
            toneHz = hz;
            for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
                now += FRAME_MS;
                const frame = pendingFrame;
                pendingFrame = null;
                if (frame) frame();
            }
        },
        /** Wall time passing with no frames (the microphone is off). @param {number} ms */
        wait(ms) {
            now += ms;
        }
    };
}

/**
 * Sing, pause, sing again; report the clock along the way and the gap the
 * pause left between the last sample before it and the first after it.
 * @param {number | null} allowanceMs null leaves the session's default
 * @param {(session: any) => void} [duringPause] runs halfway through the pause
 */
async function singPauseSing(allowanceMs, duringPause) {
    const harness = loadHarness();
    const session = harness.core.createTraceSession({ pauseOnSilence: () => true });
    if (allowanceMs !== null) session.setMaxSilenceMs(allowanceMs);
    await session.start();
    harness.run(1000, null);
    const beforeFirstNote = session.clockMs();
    harness.run(1000, SUNG_HZ);
    const sungCount = session.history.length;
    const lastBefore = session.history[sungCount - 1].time;
    harness.run(1000, null);
    const midPause = session.clockMs();
    if (duringPause) duringPause(session);
    const afterChange = session.clockMs();
    harness.run(1000, null);
    const endPause = session.clockMs();
    harness.run(500, SUNG_HZ);
    const firstAfter = session.history[sungCount].time;
    const times = session.history.map(sample => sample.time);
    return {
        session,
        harness,
        sungCount,
        beforeFirstNote,
        midPause: midPause - lastBefore,
        jumpAtChange: afterChange - midPause,
        endPause: endPause - lastBefore,
        gap: firstAfter - lastBefore,
        ordered: times.every((time, index) => index === 0 || time >= times[index - 1])
    };
}

(async () => {
    const report = createReporter('trace session');

    const stops = await singPauseSing(null);
    report.check(`by default the clock stops in silence (wait ${stops.beforeFirstNote}ms, pause ${stops.endPause}ms, gap ${stops.gap}ms, ${stops.sungCount} samples)`,
        stops.sungCount > 30 && stops.beforeFirstNote === 0 && stops.midPause === 0
        && stops.endPause === 0 && stops.gap === 0 && stops.ordered);

    const capped = await singPauseSing(400);
    report.check(`a 400ms allowance counts each pause up to 400ms and no more (wait ${capped.beforeFirstNote}, mid-pause ${capped.midPause}, end ${capped.endPause}, gap ${capped.gap})`,
        capped.beforeFirstNote === 400 && capped.midPause === 400 && capped.endPause === 400
        && capped.gap === 400 && capped.ordered);

    const flowing = await singPauseSing(Infinity);
    report.check(`an unlimited allowance runs the clock through silence like wall time (wait ${flowing.beforeFirstNote}, end ${flowing.endPause}, gap ${flowing.gap})`,
        Math.abs(flowing.beforeFirstNote - 1000) <= FRAME_MS
        && Math.abs(flowing.endPause - 2000) <= 2 * FRAME_MS
        && Math.abs(flowing.gap - 2000) <= 3 * FRAME_MS && flowing.ordered);

    const stopped = await singPauseSing(Infinity, session => session.setMaxSilenceMs(400));
    report.check(`switching time off mid-pause freezes the clock where it is, no snap back (jump ${stopped.jumpAtChange}, mid ${stopped.midPause}, end ${stopped.endPause}, gap ${stopped.gap})`,
        stopped.jumpAtChange === 0 && Math.abs(stopped.midPause - 1000) <= FRAME_MS
        && stopped.endPause === stopped.midPause && stopped.gap === stopped.midPause && stopped.ordered);

    const started = await singPauseSing(400, session => session.setMaxSilenceMs(Infinity));
    report.check(`switching time on mid-pause runs the clock from then on, no jump ahead (jump ${started.jumpAtChange}, mid ${started.midPause}, end ${started.endPause}, gap ${started.gap})`,
        started.jumpAtChange === 0 && started.midPause === 400
        && Math.abs(started.endPause - 1400) <= 2 * FRAME_MS
        && Math.abs(started.gap - 1400) <= 3 * FRAME_MS && started.ordered);

    // Stopping keeps the counted silence; time with the microphone off
    // never counts, and the next silence counts again after a restart.
    const restart = await singPauseSing(Infinity);
    restart.session.stop();
    const atStop = restart.session.clockMs();
    restart.harness.wait(5000);
    const whileOff = restart.session.clockMs();
    await restart.session.start();
    restart.harness.run(1000, null);
    const afterRestart = restart.session.clockMs();
    report.check(`stopping holds the clock and the restart counts only new silence (stop ${atStop}, off ${whileOff}, +1s ${afterRestart})`,
        whileOff === atStop && Math.abs(afterRestart - atStop - 1000) <= FRAME_MS);

    restart.session.reset();
    const afterReset = { clock: restart.session.clockMs(), samples: restart.session.history.length };
    restart.harness.run(400, null);
    report.check(`reset starts a fresh take at 0 that keeps the allowance (${afterReset.clock}ms, ${afterReset.samples} samples, +400ms ${restart.session.clockMs()})`,
        afterReset.clock === 0 && afterReset.samples === 0
        && Math.abs(restart.session.clockMs() - 400) <= FRAME_MS);

    report.finish();
})();
