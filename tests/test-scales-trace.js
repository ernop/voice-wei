// @ts-check
// scales and trace product behavior, extracted from the retired tab-functions monolith.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

// Scales init is complete when setupMediaSession (the last init step) has
// registered the page title; piano samples are loaded before that point.
/** @param {import('playwright').Page} tab */
function waitForScalesReady(tab) {
    return tab.waitForFunction(
        () => navigator.mediaSession.metadata?.title === 'Scales',
        null, { timeout: 10000, polling: 50 });
}

(async () => {
    const report = createReporter('scales and trace');
    const browser = await launchWithMic();
    // ============ SCALES: voice parser + execution + presets ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'scales', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await waitForScalesReady(tab);

        const parses = await tab.evaluate(() => {
            const c = window.scalesController;
            const cases = [
                ['d minor scale', cmd => cmd && cmd.type === 'scale' && cmd.root === 'D' && cmd.scaleType === 'minor'],
                ['g major up and down', cmd => cmd && cmd.type === 'scale' && cmd.root === 'G' && cmd.modifiers.direction === 'both'],
                ['slowly chromatic', cmd => cmd && cmd.scaleType === 'chromatic' && cmd.modifiers.tempo === 'slow'],
                ['perfect fifth from a', cmd => cmd && cmd.type === 'interval'],
                ['stop', cmd => cmd && cmd.type === 'stop'],
                ['harmonic minor repeat forever', cmd => cmd && cmd.scaleType === 'harmonic_minor' && cmd.modifiers.repeat === Infinity],
                ['d minor repeat forever no gap', cmd => cmd && cmd.root === 'D' && cmd.modifiers.repeat === Infinity && cmd.modifiers.repeatGapMs === 0],
                ['b flat major', cmd => cmd && cmd.root === 'A#' && cmd.scaleType === 'major'],
                ['c major and repeat', cmd => cmd && cmd.root === 'C' && cmd.modifiers.repeat === Infinity],
                ['rast', cmd => cmd && cmd.type === 'scale' && cmd.root === 'C' && cmd.scaleType === 'rast'],
                ['maqam bayati from d', cmd => cmd && cmd.root === 'D' && cmd.scaleType === 'bayati'],
                ['quarter tone scale', cmd => cmd && cmd.scaleType === 'quarter_tone'],
                ['d sikah scale', cmd => cmd && cmd.root === 'D' && cmd.scaleType === 'sikah'],
                ['slendro', cmd => cmd && cmd.scaleType === 'slendro'],
                ['slowly just major', cmd => cmd && cmd.scaleType === 'just_major' && cmd.modifiers.tempo === 'slow']
            ];
            return cases.map(([text, verify]) => {
                let cmd = null;
                try { cmd = c.parseScaleCommand(text); } catch (err) { return `${text} => THREW`; }
                return `${text} => ${verify(cmd) ? 'ok' : JSON.stringify(cmd)}`;
            });
        });
        parses.forEach(p => report.check(`scales parse "${p}"`, p.endsWith('ok')));

        const played = await tab.evaluate(async () => {
            const c = window.scalesController;
            const cmd = c.parseScaleCommand('e minor scale');
            c.executeScaleCommand(cmd, 'e minor scale');
            const deadline = performance.now() + 10000;
            while (!c.audio.isPlaying && performance.now() < deadline) {
                await new Promise(r => setTimeout(r, 15));
            }
            const playing = c.audio.isPlaying;
            c.stopPlayback();
            return playing && c.settings.root === 'E' && c.settings.scaleType === 'minor';
        });
        report.check('scales voice command executes and plays', played);

        // Regression: the Play button must honor noteLengthMs exactly.
        // It used to quantize through the coarse voice tempo names
        // (0.3s -> "normal" -> 0.5s), so a mid-play setting change
        // (live-restart reads the true setting) audibly sped playback up.
        const pacing = await tab.evaluate(async () => {
            const c = window.scalesController;
            c.stopPlayback();
            c.settings.noteLengthMs = 300; // between the 150/500 tempo presets
            c.settings.gapMs = 0;
            c.settings.direction = 'both';
            c.settings.repeatCount = Infinity;
            c.settings.repeatGapMs = 0;
            c.settings.scaleType = 'major';

            const durations = [];
            const realPlayMidi = c.audio.piano.playMidi.bind(c.audio.piano);
            c.audio.piano.playMidi = (midi, duration) => { durations.push(duration); };
            const until = async (fn) => {
                const deadline = performance.now() + 10000;
                while (!fn() && performance.now() < deadline) {
                    await new Promise(r => setTimeout(r, 15));
                }
            };

            c.playCurrentSettings();
            await until(() => durations.length >= 1);
            const playButtonDuration = durations[0];

            // stop() invalidates the old loop before its next playMidi, so
            // the first push after onSettingChanged is from the restart.
            const beforeChange = durations.length;
            c.settings.scaleType = 'minor';
            c.onSettingChanged();
            await until(() => durations.length > beforeChange);
            const afterChangeDuration = durations[durations.length - 1];

            c.stopPlayback();
            c.audio.piano.playMidi = realPlayMidi;
            c.settings.repeatCount = 1;
            c.settings.direction = 'ascending';
            return { playButtonDuration, afterChangeDuration };
        });
        report.check(`scales play button pacing matches the setting before and after live-restart (${pacing.playButtonDuration}s -> ${pacing.afterChangeDuration}s)`,
            pacing.playButtonDuration === 0.3 && pacing.afterChangeDuration === 0.3);

        await tab.fill('#presetNameInput', 'suite-test');
        await tab.click('#savePresetBtn');
        await tab.waitForFunction(() => window.scalesController.presets.some(p => p.name === 'suite-test'),
            null, { timeout: 10000, polling: 50 });
        await tab.click('.step-btn[data-step-key="rootPitch"][data-step-delta="1"]');
        await tab.waitForFunction(() => window.scalesController.settings.root === 'F',
            null, { timeout: 10000, polling: 50 });
        const presetApplied = await tab.evaluate(() => {
            const c = window.scalesController;
            const preset = c.presets.find(p => p.name === 'suite-test');
            if (!preset) return false;
            c.applyConfig(preset.config); // synchronous: settings + saveSettings
            c.stopPlayback();
            c.deletePresetById(preset.id);
            return c.settings.root === 'E';
        });
        report.check('scales preset save/apply', presetApplied);

        await tab.click('.vf-btn[data-repeat="Infinity"]');
        // onSettingChanged persists synchronously; -1 is the stored Infinity.
        await tab.waitForFunction(() => window.scalesController.settings.repeatCount === Infinity
            && SettingsStore.peekData(StorageKeys.SCALES_SETTINGS)?.repeatCount === -1,
        null, { timeout: 10000, polling: 50 });
        await tab.evaluate(() => window.scalesController.stopPlayback());
        await tab.reload({ waitUntil: 'networkidle' });
        await waitForScalesReady(tab);
        const inf = await tab.evaluate(() => window.scalesController.settings.repeatCount === Infinity);
        report.check('scales repeat-forever survives reload', inf);

        const renderedSequence = await tab.evaluate(async () => {
            const c = window.scalesController;
            c.stopPlayback();
            c.settings.octave = 4;
            c.settings.direction = 'both';
            c.settings.movementStyle = 'normal';
            c.settings.sectionLength = '1o';
            c.settings.repeatCount = 2;
            c.settings.risingSemitones = 0;
            c.settings.noteLengthMs = 10;
            c.settings.gapMs = 0;
            c.audio.sleep = async () => {};
            const played = [];
            const highlighted = [];
            const realPlayMidi = c.audio.piano.playMidi.bind(c.audio.piano);
            const realHighlight = c.highlightPianoKey.bind(c);
            const realSleep = c.audio.sleep;
            c.audio.piano.playMidi = (midi, duration) => { played.push(midi); };
            c.highlightPianoKey = midi => { highlighted.push(midi); };
            await c.playScale('C', 'major', { direction: 'both', repeat: 2, repeatGapMs: 0 });

            const loopPlayed = [];
            const loopHighlighted = [];
            c.audio.piano.playMidi = (midi, duration) => {
                loopPlayed.push(midi);
                if (loopPlayed.length >= 29) c.audio.stop();
            };
            c.highlightPianoKey = midi => { loopHighlighted.push(midi); };
            await c.playScale('C', 'major', { direction: 'both', repeat: Infinity, repeatGapMs: 0 });

            c.audio.piano.playMidi = realPlayMidi;
            c.highlightPianoKey = realHighlight;
            c.audio.sleep = realSleep;
            return {
                count: played.length,
                highlightMatches: played.join(',') === highlighted.join(','),
                first: played[0],
                repeatFirst: played[15],
                repeatSecond: played[16],
                loopCount: loopPlayed.length,
                loopHighlightMatches: loopPlayed.join(',') === loopHighlighted.join(','),
                loopFirst: loopPlayed[0],
                loopSeam: loopPlayed[15],
                loopAfterSeam: loopPlayed[16]
            };
        });
        report.check(`scales gapped rendered repeat restarts on root (${renderedSequence.count} notes, repeat ${renderedSequence.repeatFirst}->${renderedSequence.repeatSecond})`,
            renderedSequence.count === 30 && renderedSequence.highlightMatches
            && renderedSequence.first === 60 && renderedSequence.repeatFirst === 60 && renderedSequence.repeatSecond === 62);
        report.check(`scales no-gap infinite up+down omits repeated root (${renderedSequence.loopCount} notes, seam ${renderedSequence.loopSeam}->${renderedSequence.loopAfterSeam})`,
            renderedSequence.loopCount === 29 && renderedSequence.loopHighlightMatches
            && renderedSequence.loopFirst === 60 && renderedSequence.loopSeam === 62 && renderedSequence.loopAfterSeam === 64);

        const scaleSpelling = await tab.evaluate(() => {
            const cMajor = buildScaleFrequencies('C', 4, 'major').map(note => note.name).join(' ');
            const fMajor = buildScaleFrequencies('F', 4, 'major').map(note => note.name).join(' ');
            const cMinor = buildScaleFrequencies('C', 4, 'minor').map(note => note.name).join(' ');
            const ebMajorFromStoredSharp = buildScaleFrequencies('D#', 3, 'major').map(note => note.name).join(' ');
            const ebMajorDegrees = scaleDegreeNotesInRange('D#', 3, 'major', 0, 14)
                .map(note => `${note.degree}:${note.name}`).join(' ');
            const c = window.scalesController;
            return {
                cMajor,
                fMajor,
                cMinor,
                ebMajorFromStoredSharp,
                ebMajorDegrees,
                locrianFifth: c.getDiatonicInterval(60, 60, 'fifth', 'locrian'),
                dorianThird: c.getDiatonicInterval(60, 60, 'third', 'dorian'),
                cPlain: !/[#b]/.test(cMajor),
                fUsesBb: fMajor.includes('Bb4') && !fMajor.includes('A#4'),
                cMinorFlats: cMinor.includes('Eb4') && cMinor.includes('Ab4') && cMinor.includes('Bb4'),
                storedDSharpMajorSpellsAsEb: ebMajorFromStoredSharp === 'Eb3 F3 G3 Ab3 Bb3 C4 D4 Eb4',
                octaveDegreeIsEight: ebMajorDegrees.includes('8:Eb4') && ebMajorDegrees.includes('2:F4')
            };
        });
        report.check(`scale note spelling is key-aware (C=${scaleSpelling.cMajor}; F=${scaleSpelling.fMajor}; Cm=${scaleSpelling.cMinor}; D#=${scaleSpelling.ebMajorFromStoredSharp}; degrees=${scaleSpelling.ebMajorDegrees})`,
            scaleSpelling.cPlain && scaleSpelling.fUsesBb && scaleSpelling.cMinorFlats
            && scaleSpelling.storedDSharpMajorSpellsAsEb && scaleSpelling.octaveDegreeIsEight
            && scaleSpelling.locrianFifth === 66 && scaleSpelling.dorianThird === 63);

        const microtonal = await tab.evaluate(async () => {
            const rast = scaleDegreeNotesInRange('C', 4, 'rast', 0, 12);
            const quarter = buildScaleFrequencies('C', 4, 'quarter_tone');
            const c = window.scalesController;

            const played = [];
            const realPlayMidi = c.audio.piano.playMidi.bind(c.audio.piano);
            const realSleep = c.audio.sleep;
            c.audio.sleep = async () => {};
            c.audio.piano.playMidi = (midi) => { played.push(midi); };
            c.settings.octave = 4;
            c.settings.sectionLength = '1o';
            await c.playScale('C', 'rast', { direction: 'ascending', repeat: 1 });
            c.audio.piano.playMidi = realPlayMidi;
            c.audio.sleep = realSleep;

            return {
                rastNames: rast.map(n => n.name).join(' '),
                rastMidis: rast.map(n => n.midi).join(','),
                quarterCount: quarter.length,
                quarterStepRatio: quarter[1].freq / quarter[0].freq,
                slendroSpelling: scaleMidiToPitchString('C', 4, 'slendro', 62.4),
                neutralThirdName: c.getIntervalName(3.5, 'rast'),
                chordFifthOnMicrotonalDegree: c.getDiatonicInterval(60, 63.5, 'fifth', 'rast'),
                played: played.join(',')
            };
        });
        report.check(`microtonal rast degrees spell as cents from the nearest note (${microtonal.rastNames})`,
            microtonal.rastNames === 'C4 D4 E4-50c F4 G4 A4 B4-50c C5'
            && microtonal.rastMidis === '60,62,63.5,65,67,69,70.5,72');
        report.check(`microtonal quarter-tone scale has 25 degrees at 50-cent steps (${microtonal.quarterCount}, ratio ${microtonal.quarterStepRatio.toFixed(5)})`,
            microtonal.quarterCount === 25
            && Math.abs(microtonal.quarterStepRatio - Math.pow(2, 0.5 / 12)) < 1e-9);
        report.check(`microtonal non-quarter offsets spell as cents (${microtonal.slendroSpelling}) and degrees name neutrals (${microtonal.neutralThirdName})`,
            microtonal.slendroSpelling === 'D4+40c' && microtonal.neutralThirdName === 'neutral third');
        report.check(`microtonal chords movement finds the fifth above a neutral degree (${microtonal.chordFifthOnMicrotonalDegree})`,
            microtonal.chordFifthOnMicrotonalDegree === 70.5);
        report.check(`microtonal rast playback hits exact fractional midis (${microtonal.played})`,
            microtonal.played === '60,62,63.5,65,67,69,70.5,72');
        await tab.close();
    }

    // ============ TRACE: degree patterns reach other octaves ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'trace-pattern', report.errors);
        await tab.goto(`${BASE_URL}/trace.html`, { waitUntil: 'networkidle' });
        // traceDebug is published at the end of trace init.
        await tab.waitForFunction(() => window.traceDebug !== undefined,
            null, { timeout: 10000, polling: 50 });
        const pattern = await tab.evaluate(() => {
            const input = /** @type {HTMLInputElement} */ (document.getElementById('patternInput'));
            input.value = '5d 1 3 8 2u 9 5dd x';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const entries = window.traceDebug.patternEntries();
            const targets = window.traceDebug.guideTargets();
            const rails = window.traceDebug.rails();
            const bounds = window.traceDebug.verticalBounds();
            return {
                intervals: entries.map(entry => entry.interval).join(','),
                labels: entries.map(entry => entry.label).join(','),
                insideTargetsOnRails: targets
                    .filter(target => target.midi >= bounds.minMidi && target.midi <= bounds.maxMidi)
                    .every(target => rails.some(rail => rail.midi === target.midi)),
                outsideTargetsStayOutside: targets
                    .filter(target => target.midi < bounds.minMidi || target.midi > bounds.maxMidi)
                    .every(target => !rails.some(rail => rail.midi === target.midi)),
                labelsMatchTokens: targets.every((target, i) => target.label === entries[i].label)
            };
        });
        report.check(`trace pattern suffixes reach other octaves (${pattern.intervals} | ${pattern.labels})`,
            pattern.intervals === '-5,0,4,12,14,14,-17'
            && pattern.labels === '5d,1,3,8,2u,9,5dd'
            && pattern.insideTargetsOnRails && pattern.outsideTargetsStayOutside
            && pattern.labelsMatchTokens);

        const fixedFrame = await tab.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.id = 'fixedRangeTestCanvas';
            canvas.width = 400;
            canvas.height = 240;
            document.body.appendChild(canvas);
            const history = [
                { time: 100, midi: 70, cents: 0 },
                { time: 200, midi: 70, cents: 0 }
            ];
            const view = PitchTraceView.create({
                canvasId: canvas.id,
                defaultHeightPx: 240,
                rails: () => [
                    { midi: 60, label: '1', emphasized: true },
                    { midi: 62, label: '2', emphasized: true }
                ],
                targets: () => [],
                history: () => history,
                clockMs: () => 200,
                windowMs: () => 2000,
                verticalBounds: () => ({ minMidi: 60, maxMidi: 62 }),
                showPlayhead: () => false
            });
            const yellowPixels = () => {
                const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let count = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                    if (pixels[i] > 220 && pixels[i + 1] > 160 && pixels[i + 2] < 80) count++;
                }
                return count;
            };
            view.draw();
            const offscreenYellow = yellowPixels();
            history[0].midi = 61;
            history[1].midi = 61;
            view.draw();
            return { offscreenYellow, onscreenYellow: yellowPixels() };
        });
        report.check(`trace fixed frame clips out-of-range singing (off=${fixedFrame.offscreenYellow}, on=${fixedFrame.onscreenYellow})`,
            fixedFrame.offscreenYellow === 0 && fixedFrame.onscreenYellow > 0);
        await tab.close();
    }

    // ============ SING PANEL: per-note scoring appears once windows pass ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'sing-panel', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await waitForScalesReady(tab);
        await tab.click('#singBtn');
        // open() finishes when the mic session is up and the button reads On.
        await tab.waitForFunction(() => {
            const listenBtn = document.getElementById('scalesSingListenBtn');
            return listenBtn && listenBtn.textContent.includes('Listening On');
        }, null, { timeout: 10000, polling: 50 });
        // Wall-clock mode so all target windows pass deterministically.
        // Stop the mic: with the fake device beeping forever, the voice
        // never goes idle, so unsung targets would stay pending instead
        // of resolving to missed.
        await tab.evaluate(() => {
            document.getElementById('scalesSingListenBtn').click();
            // Short target windows: verdicts are order-based (timing never
            // decides them), so this only moves the resolution deadline.
            window.scalesController.settings.noteLengthMs = 50;
            window.scalesController.settings.gapMs = 0;
            document.getElementById('scalesSingPauseToggle').click();
            // A take records only when something was sung: one
            // deterministic note through the sample seam.
            for (let k = 0; k < 5; k++) {
                window.scalesController.singPanel.recordSample(60, 30 + k * 50);
            }
        });
        // With the mic stopped there are no frames, so drive scoring by
        // hand until the take lands in the progress store (all windows
        // past + the 600ms voice-idle gate).
        await tab.waitForFunction(() => {
            window.scalesController.singPanel.draw();
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            return entries.some(e => e.tool === 'scales-sing');
        }, null, { timeout: 10000, polling: 50 });
        // The panel scores once windows pass, and the completed take is
        // recorded with the trend line.
        await tab.evaluate(() => window.scalesController.singPanel.draw());
        const singResult = await tab.evaluate(() => {
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            return {
                score: document.getElementById('scalesSingScore').textContent,
                entry: entries.find(e => e.tool === 'scales-sing') || null,
                line: document.getElementById('scalesSingProgress').textContent
            };
        });
        report.check(`sing panel scores and records the take ("${singResult.score}", total ${JSON.stringify(singResult.entry && singResult.entry.total)}, trend "${singResult.line}")`,
            /Score: \d+\/\d+ on pitch/.test(singResult.score)
            && singResult.entry !== null && singResult.entry.total > 0
            && /^Progress: Today \d+%/.test(singResult.line));
        await ctx.close();
    }
    await browser.close();
    report.finish();
})();
