// @ts-check
// Each tab's primary function works end to end.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('tab functions');
    const browser = await launchWithMic();

    // ============ SCALES: voice parser + execution + presets ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'scales', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);

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
            await new Promise(r => setTimeout(r, 700));
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

            c.playCurrentSettings();
            await new Promise(r => setTimeout(r, 500));
            const playButtonDuration = durations[0];

            c.settings.scaleType = 'minor';
            c.onSettingChanged();
            await new Promise(r => setTimeout(r, 700));
            const afterChangeDuration = durations[durations.length - 1];

            c.stopPlayback();
            await new Promise(r => setTimeout(r, 100));
            c.audio.piano.playMidi = realPlayMidi;
            c.settings.repeatCount = 1;
            c.settings.direction = 'ascending';
            return { playButtonDuration, afterChangeDuration };
        });
        report.check(`scales play button pacing matches the setting before and after live-restart (${pacing.playButtonDuration}s -> ${pacing.afterChangeDuration}s)`,
            pacing.playButtonDuration === 0.3 && pacing.afterChangeDuration === 0.3);

        await tab.fill('#presetNameInput', 'suite-test');
        await tab.click('#savePresetBtn');
        await tab.waitForTimeout(300);
        await tab.click('.step-btn[data-step-key="rootPitch"][data-step-delta="1"]');
        await tab.waitForTimeout(400);
        const presetApplied = await tab.evaluate(async () => {
            const c = window.scalesController;
            const preset = c.presets.find(p => p.name === 'suite-test');
            if (!preset) return false;
            c.applyConfig(preset.config);
            await new Promise(r => setTimeout(r, 300));
            c.stopPlayback();
            c.deletePresetById(preset.id);
            return c.settings.root === 'E';
        });
        report.check('scales preset save/apply', presetApplied);

        await tab.click('.vf-btn[data-repeat="Infinity"]');
        await tab.waitForTimeout(300);
        await tab.evaluate(() => window.scalesController.stopPlayback());
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        const inf = await tab.evaluate(() => window.scalesController.settings.repeatCount === Infinity);
        report.check('scales repeat-forever survives reload', inf);

        const mediaTitle = await tab.evaluate(() => navigator.mediaSession.metadata?.title || 'none');
        report.check('scales media session registered', mediaTitle === 'Scales');

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
        await tab.waitForTimeout(1500);
        const pattern = await tab.evaluate(() => {
            const input = /** @type {HTMLInputElement} */ (document.getElementById('patternInput'));
            input.value = '5d 1 3 8 2u 9 5dd x';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const entries = window.traceDebug.patternEntries();
            const targets = window.traceDebug.guideTargets();
            const rails = window.traceDebug.rails();
            return {
                intervals: entries.map(entry => entry.interval).join(','),
                labels: entries.map(entry => entry.label).join(','),
                targetsOnRails: targets.length === entries.length
                    && targets.every(target => rails.some(rail => rail.midi === target.midi)),
                labelsMatchTokens: targets.every((target, i) => target.label === entries[i].label)
            };
        });
        report.check(`trace pattern suffixes reach other octaves (${pattern.intervals} | ${pattern.labels})`,
            pattern.intervals === '-5,0,4,12,14,14,-17'
            && pattern.labels === '5d,1,3,8,2u,9,5dd'
            && pattern.targetsOnRails && pattern.labelsMatchTokens);
        await tab.close();
    }

    // ============ PHRASES: stored sharp root displays as conventional flat key ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'phrases-eb-display', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.evaluate(() => {
            localStorage.setItem('phrases-settings', JSON.stringify({
                root: 'D#', octave: 3, scaleType: 'major', phraseAlgo: 'random',
                startAtOne: false, rangeLow: 0, rangeHigh: 7, minLength: 9, maxLength: 9,
                returnToInitial: true, returnToRoot: false,
                hearTones: false, hearSpeech: false, singNumbers: false,
                noteLengthMs: 500, gapMs: 0, showNumbers: true, showNoteNames: true,
                showStaff: true, showPlayRow: true, accidentalRate: 0
            }));
        });
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(1000);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(500);
        const ebDisplay = await tab.evaluate(() => {
            const root = document.getElementById('rootPitchValue')?.textContent || '';
            const notes = [...document.querySelectorAll('.phrase-note-name-token')].map(el => el.textContent || '');
            return {
                root,
                notes,
                noSharpSpellings: notes.every(note => !note.includes('#')),
                noCanonicalEnharmonics: notes.every(note => !['D#3', 'G#3', 'A#3', 'D#4', 'G#4', 'A#4'].includes(note))
            };
        });
        report.check(`phrases stored D# major displays as Eb key (root=${ebDisplay.root}, notes=${ebDisplay.notes.join(' ')})`,
            ebDisplay.root === 'Eb3' && ebDisplay.noSharpSpellings && ebDisplay.noCanonicalEnharmonics);
        await tab.close();
    }

    // ============ INTERVALS: loop / Repeat / Next / Stop ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'intervals', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        // TTS never completes in headless Chrome, so the loop would stall on speech
        await tab.evaluate(() => document.getElementById('toggleSpeak').click());
        await tab.evaluate(() => document.getElementById('toggleRepeat').click());
        await tab.click('#playBtn');
        await tab.waitForTimeout(2500);
        const p1 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        await tab.waitForTimeout(2500);
        const p2 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        report.check(`intervals repeat holds pattern ("${p1}")`, Boolean(p1) && p1 === p2);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(3500);
        const p3 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        report.check(`intervals Next advances ("${p1}" -> "${p3}")`, Boolean(p3) && p3 !== p1);
        await tab.click('#stopBtn');
        await tab.waitForTimeout(300);
        const stopped = await tab.evaluate(() => document.getElementById('currentDisplay').textContent);
        report.check('intervals Stop is immediate', stopped === 'Stopped');
        await tab.close();
    }

    // ============ INTERVALS SING: panel seeds from the pattern and scores ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'intervals-sing', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        await tab.click('#singBtn');
        await tab.waitForTimeout(1000);
        const opened = await tab.evaluate(() => ({
            open: !document.getElementById('intervalsSingPanel').hidden,
            pattern: document.querySelector('#currentDisplay .pattern-degrees')?.textContent || ''
        }));
        report.check(`intervals Sing opens with a pattern ("${opened.pattern}")`,
            opened.open && opened.pattern.length > 0);
        const intervalScaleModel = await tab.evaluate(() => {
            const scale = PatternPracticeCore.buildExtendedScale({
                root: 'D#',
                octave: 3,
                scaleType: 'major',
                lowerOctaves: 0,
                upperOctaves: 2
            });
            const labels = scale.slice(0, 10).map(note => `${note.degree}:${note.name}`).join(' ');
            return {
                labels,
                spellsEb: labels.startsWith('1:Eb3 2:F3 3:G3 4:Ab3 5:Bb3 6:C4 7:D4 8:Eb4 2↑:F4'),
                noSharpLeak: !labels.includes('#')
            };
        });
        report.check(`intervals extended scale uses standard degree objects (${intervalScaleModel.labels})`,
            intervalScaleModel.spellsEb && intervalScaleModel.noSharpLeak);
        // Wall-clock mode so the windows pass; take should be recorded.
        // Stop the mic first (the fake device's endless beeps keep the
        // voice "active", which keeps unreached targets pending), then
        // sing deterministically through the explicit sample seam.
        await tab.evaluate(() => {
            const listenBtn = document.getElementById('intervalsSingListenBtn');
            if (listenBtn && listenBtn.textContent.includes('On')) listenBtn.click();
            document.getElementById('intervalsSingPauseToggle').click();
            for (let k = 0; k < 5; k++) {
                window.intervalsDebug.panel.recordSample(60, 30 + k * 50);
            }
        });
        const noteCount = Math.max(2, opened.pattern.split('-').length);
        await tab.waitForTimeout(noteCount * 600 + 2500);
        const recorded = await tab.evaluate(() => {
            // Verdicts re-evaluate on mic frames; the headless fake mic
            // sometimes fails to start, so drive the evaluation by name.
            window.intervalsDebug.panel.draw();
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            return entries.some(e => e.tool === 'intervals-sing');
        });
        report.check('intervals sing take recorded', recorded);
        await ctx.close();
    }

    // ============ PHRASES: reflect / mask / modes / history ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'phrases', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(1500);
        await tab.evaluate(instrumentVoices);

        await tab.click('#nextBtn');
        await tab.waitForTimeout(400);
        await tab.click('#stopBtn');
        const degrees = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        const phraseTitle = await tab.evaluate(() => {
            const degrees = window.phrasesDebug.takePlan()
                .filter(note => note.enabled)
                .map(note => note.degree)
                .join(',');
            return {
                degrees,
                documentTitle: document.title,
                mediaTitle: navigator.mediaSession.metadata?.title || '',
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || ''
            };
        });
        const titleShape = /^[A-G][b#]?\d [a-z ]+ [^ ]+$/;
        report.check(`phrases title is scale name plus degree list ("${phraseTitle.documentTitle}")`,
            titleShape.test(phraseTitle.documentTitle)
            && phraseTitle.documentTitle.endsWith(` ${phraseTitle.degrees}`)
            && phraseTitle.mediaTitle === phraseTitle.documentTitle
            && phraseTitle.headerTitle === phraseTitle.documentTitle
            && phraseTitle.degrees.length > 0
            && !phraseTitle.documentTitle.includes('Phrases')
            && !phraseTitle.documentTitle.includes('Voice'));

        await tab.click('#reflectBtn');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const reflected = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        await tab.click('#reflectBtn');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const restored = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        report.check('phrases reflect roundtrip', reflected !== degrees && restored === degrees);

        const noteCount = degrees.split(' ').length;
        await tab.evaluate(() => {
            const btn = document.querySelector('.phrase-degree-token[data-index="0"]');
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        });
        await tab.waitForTimeout(200);
        const maskedTitle = await tab.evaluate(() => {
            const degrees = window.phrasesDebug.takePlan()
                .filter(note => note.enabled)
                .map(note => note.degree)
                .join(',');
            return {
                degrees,
                documentTitle: document.title,
                mediaTitle: navigator.mediaSession.metadata?.title || '',
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || ''
            };
        });
        report.check('phrases title follows playable note mask',
            maskedTitle.documentTitle.endsWith(` ${maskedTitle.degrees}`)
            && maskedTitle.mediaTitle === maskedTitle.documentTitle
            && maskedTitle.headerTitle === maskedTitle.documentTitle);
        const starts0 = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        await tab.waitForTimeout(noteCount * 350 + 1200);
        const played = await tab.evaluate(() => window.__voiceStarts) - starts0;
        report.check(`phrases note mask (${noteCount} notes, 1 off, ${played} played)`, played === noteCount - 1);

        const breakdownPlan = await tab.evaluate(() => {
            const passes = window.phrasesDebug.breakdownPasses();
            const total = window.phrasesDebug.takePlan().length;
            const first = passes[0] || [];
            const final = passes[passes.length - 1] || [];
            let largestGapAdds = true;
            let oneAtATime = true;
            let previous = first;
            for (const pass of passes.slice(1)) {
                const additions = pass.filter(index => !previous.includes(index));
                if (additions.length !== 1) oneAtATime = false;
                const added = additions[0];
                const prevSorted = previous.slice().sort((a, b) => a - b);
                const gaps = [];
                for (let i = 0; i < prevSorted.length - 1; i++) {
                    const left = prevSorted[i];
                    const right = prevSorted[i + 1];
                    const size = right - left - 1;
                    if (size > 0) gaps.push({ left, right, size });
                }
                const maxGap = Math.max(...gaps.map(gap => gap.size));
                const chosenGap = gaps.find(gap => gap.left < added && added < gap.right);
                if (!chosenGap || chosenGap.size !== maxGap) largestGapAdds = false;
                previous = pass;
            }
            const firstShape = total === 1
                ? first.length === 1 && first[0] === 0
                : total === 2
                    ? first.length === 2 && first.includes(0) && first.includes(1)
                    : first.length === 3 && first.includes(0) && first.includes(total - 1)
                        && first.some(index => index > 0 && index < total - 1);
            return {
                total,
                passCount: passes.length,
                firstCount: first.length,
                firstShape,
                oneAtATime,
                largestGapAdds,
                finalAll: final.length === total && final.every((index, idx) => index === idx)
            };
        });
        report.check(`phrases breakdown plan fills largest gaps one note at a time (${breakdownPlan.passCount} passes for ${breakdownPlan.total} notes)`,
            breakdownPlan.passCount === Math.max(1, breakdownPlan.total - 2)
            && breakdownPlan.firstShape && breakdownPlan.oneAtATime
            && breakdownPlan.largestGapAdds && breakdownPlan.finalAll);

        const breakdownControls = await tab.evaluate(() => {
            const stage = document.querySelector('.phrase-stage').getBoundingClientRect();
            const actions = document.querySelector('.phrase-stage-actions').getBoundingClientRect();
            const breakdownBtn = document.getElementById('breakdownBtn').getBoundingClientRect();
            return {
                leftDelta: actions.left - stage.left,
                buttonHeight: breakdownBtn.height,
                autoStep: document.getElementById('autoStepBtn').getAttribute('aria-pressed'),
                addHidden: document.getElementById('addNoteBtn').hidden
            };
        });
        report.check(`phrases breakdown controls are left/compact (left=${breakdownControls.leftDelta.toFixed(0)}, h=${breakdownControls.buttonHeight.toFixed(0)})`,
            breakdownControls.leftDelta <= 16 && breakdownControls.buttonHeight <= 16.5
            && breakdownControls.autoStep === 'false' && breakdownControls.addHidden === true);

        await tab.evaluate(() => {
            const tones = document.getElementById('hearTonesToggle');
            if (tones instanceof HTMLInputElement && tones.checked) tones.click();
        });
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const sBefore = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        await tab.waitForTimeout(800);
        const sAfter = await tab.evaluate(() => window.__voiceStarts);
        report.check('phrases silent when all hear toggles off', sBefore === sAfter);

        await tab.click('#breakdownBtn');
        await tab.waitForTimeout(200);
        const breakdownOn = await tab.evaluate(() => ({
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            addHidden: document.getElementById('addNoteBtn').hidden,
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed')
        }));
        report.check(`phrases breakdown mode reveals partial phrase (${breakdownOn.enabled}/${breakdownOn.total})`,
            breakdownOn.pressed === 'true' && breakdownOn.addHidden === false
            && breakdownOn.enabled < breakdownOn.total);

        await tab.click('#breakdownBtn');
        await tab.waitForTimeout(200);
        const breakdownOff = await tab.evaluate(() => ({
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed')
        }));
        report.check(`phrases breakdown off restores full phrase (${breakdownOff.enabled}/${breakdownOff.total})`,
            breakdownOff.pressed === 'false' && breakdownOff.enabled === breakdownOff.total);

        await tab.click('#breakdownBtn');
        await tab.waitForTimeout(200);
        const manualBefore = await tab.evaluate(() => ({
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed'),
            playOnStep: document.getElementById('playOnStepBtn').getAttribute('aria-pressed'),
            addHidden: document.getElementById('addNoteBtn').hidden,
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            voices: window.__voiceStarts
        }));
        await tab.click('#addNoteBtn');
        await tab.waitForTimeout(300);
        const manualAfter = await tab.evaluate(() => ({
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed'),
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            voices: window.__voiceStarts
        }));
        report.check(`phrases add note advances silently without play on step (${manualBefore.enabled}->${manualAfter.enabled})`,
            manualBefore.pressed === 'true' && manualBefore.playOnStep === 'false' && manualBefore.addHidden === false
            && manualAfter.pressed === 'true'
            && manualAfter.enabled === Math.min(manualBefore.total, manualBefore.enabled + 1)
            && manualAfter.voices === manualBefore.voices);
        await tab.click('#stopBtn');
        await tab.waitForTimeout(200);

        await tab.click('#breakdownBtn');
        await tab.waitForTimeout(200);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(400);
        const nextClearsBreakdown = await tab.evaluate(() => ({
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed'),
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            breakdownEnabled: window.phrasesDebug.settings().breakdownEnabled
        }));
        report.check(`phrases next exits breakdown and shows full new phrase (${nextClearsBreakdown.enabled}/${nextClearsBreakdown.total})`,
            nextClearsBreakdown.pressed === 'false'
            && nextClearsBreakdown.breakdownEnabled === false
            && nextClearsBreakdown.enabled === nextClearsBreakdown.total);

        // Powerset combos: ordered subsequences per size, stutters skipped,
        // as-text duplicates produced once (1,2,5,2,1 is the worked example).
        const powersetOrder = await tab.evaluate(() => {
            const iterator = PatternPracticeCore.createUniqueSubsequenceIterator([0, 1, 4, 1, 0], 3);
            const passes = [];
            for (let pass = iterator.next(); pass; pass = iterator.next()) {
                passes.push(pass.join(''));
            }
            return passes.join(' ');
        });
        report.check(`phrases powerset combos dedupe as-text and skip stutters (${powersetOrder})`,
            powersetOrder === '012 014 023 024 123 124 234 0123 0124 0234 1234 01234');

        // Powerset mode masks the take to the current combo, steps via the
        // stage button, and is exclusive with breakdown.
        await tab.click('#powersetBtn');
        await tab.waitForTimeout(200);
        const powersetOn = await tab.evaluate(() => ({
            pressed: document.getElementById('powersetBtn').getAttribute('aria-pressed'),
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            addHidden: document.getElementById('addNoteBtn').hidden,
            addLabel: document.getElementById('addNoteBtn').textContent,
            mask: window.phrasesDebug.takePlan().map(note => (note.enabled ? 1 : 0)).join('')
        }));
        await tab.click('#addNoteBtn');
        await tab.waitForTimeout(200);
        const powersetStepped = await tab.evaluate(() => ({
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            mask: window.phrasesDebug.takePlan().map(note => (note.enabled ? 1 : 0)).join('')
        }));
        report.check(`phrases powerset masks 3-note combos and steps (${powersetOn.mask}->${powersetStepped.mask}, "${powersetOn.addLabel}")`,
            powersetOn.pressed === 'true' && powersetOn.addHidden === false
            && powersetOn.addLabel === 'next combo'
            && powersetOn.total >= 4 && powersetOn.enabled === 3
            && powersetStepped.enabled === 3 && powersetStepped.mask !== powersetOn.mask);

        await tab.click('#breakdownBtn');
        await tab.waitForTimeout(200);
        const powersetExclusive = await tab.evaluate(() => ({
            breakdown: window.phrasesDebug.settings().breakdownEnabled,
            powerset: window.phrasesDebug.settings().powersetEnabled
        }));
        report.check('phrases breakdown and powerset are exclusive',
            powersetExclusive.breakdown === true && powersetExclusive.powerset === false);

        await tab.click('#nextBtn');
        await tab.waitForTimeout(400);
        const powersetCleared = await tab.evaluate(() => ({
            breakdown: window.phrasesDebug.settings().breakdownEnabled,
            powerset: window.phrasesDebug.settings().powersetEnabled,
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length
        }));
        report.check('phrases next exits powerset and breakdown modes',
            powersetCleared.breakdown === false && powersetCleared.powerset === false
            && powersetCleared.enabled === powersetCleared.total);

        await tab.evaluate(() => {
            const tones = document.getElementById('hearTonesToggle');
            if (tones instanceof HTMLInputElement && !tones.checked) tones.click();
        });
        await tab.waitForTimeout(200);
        await tab.click('#stopBtn');

        // Reverse: with powerset on, each combo replays back to front in
        // the same section, so one Play sounds 3 forward + 3 reversed.
        await tab.click('#powersetBtn');
        await tab.waitForTimeout(200);
        await tab.click('#reverseBtn');
        await tab.waitForTimeout(200);
        const reverseOn = await tab.evaluate(() => ({
            pressed: document.getElementById('reverseBtn').getAttribute('aria-pressed'),
            setting: window.phrasesDebug.settings().reverseAfterSection,
            saved: SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.reverseAfterSection,
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length
        }));
        const reverseVoices0 = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        await tab.waitForTimeout(4000);
        const reverseVoices = await tab.evaluate(() => window.__voiceStarts) - reverseVoices0;
        report.check(`phrases reverse replays powerset combo backwards (${reverseOn.enabled} enabled, ${reverseVoices} voices)`,
            reverseOn.pressed === 'true' && reverseOn.setting === true && reverseOn.saved === true
            && reverseOn.enabled === 3 && reverseVoices === 6);
        await tab.click('#stopBtn');
        await tab.click('#reverseBtn');
        await tab.click('#powersetBtn');
        await tab.waitForTimeout(200);

        await tab.click('#nextBtn');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const historyCount = await tab.evaluate(() => document.querySelectorAll('#historyList .history-item').length);
        const s1 = await tab.evaluate(() => window.__voiceStarts);
        await tab.evaluate(() => document.querySelector('#historyList .history-play-btn').click());
        await tab.waitForTimeout(1500);
        const s2 = await tab.evaluate(() => window.__voiceStarts);
        report.check(`phrases history records and replays (${historyCount} items)`, historyCount >= 2 && s2 > s1);

        // Transport state honesty: idle reports 'paused' so a car's
        // play/pause toggle sends 'play'; the media back handler steps
        // to the previous history phrase and plays it audibly.
        await tab.click('#stopBtn');
        await tab.waitForTimeout(300);
        const idleState = await tab.evaluate(() => navigator.mediaSession.playbackState);
        const degreesNow = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        const s3 = await tab.evaluate(() => window.__voiceStarts);
        await tab.evaluate(() => { window.phrasesDebug.mediaPrevious(); });
        await tab.waitForTimeout(300);
        const playingState = await tab.evaluate(() => navigator.mediaSession.playbackState);
        await tab.waitForTimeout(1500);
        const s4 = await tab.evaluate(() => window.__voiceStarts);
        const degreesPrev = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        await tab.click('#stopBtn');
        report.check(`phrases media back plays previous phrase (state ${idleState}->${playingState}, ${s4 - s3} voices)`,
            idleState === 'paused' && playingState === 'playing' && s4 > s3 && degreesPrev !== degreesNow);

        // Play-on-next off: Next generates and shows a new phrase silently
        await tab.click('#playOnNextBtn');
        await tab.waitForTimeout(200);
        const silentNextBefore = await tab.evaluate(() => ({
            pressed: document.getElementById('playOnNextBtn').getAttribute('aria-pressed'),
            history: document.querySelectorAll('#historyList .history-item').length,
            voices: window.__voiceStarts
        }));
        await tab.click('#nextBtn');
        await tab.waitForTimeout(600);
        const silentNextAfter = await tab.evaluate(() => ({
            history: document.querySelectorAll('#historyList .history-item').length,
            voices: window.__voiceStarts,
            playOnNext: window.phrasesDebug.settings().playOnNext
        }));
        report.check(`phrases next is silent with play on next off (${silentNextBefore.history}->${silentNextAfter.history} items, ${silentNextAfter.voices - silentNextBefore.voices} voices)`,
            silentNextBefore.pressed === 'false'
            && silentNextAfter.playOnNext === false
            && silentNextAfter.history === silentNextBefore.history + 1
            && silentNextAfter.voices === silentNextBefore.voices);
        await tab.click('#playOnNextBtn');
        await tab.waitForTimeout(200);

        // Typed degree series: the token grammar parses to exact offsets
        // (octave marks, chromatic passing accidentals), errors never guess.
        const seriesParse = await tab.evaluate(() => {
            const good = PatternPracticeCore.parseDegreeSeries('5d 1, 1 | 7bv 7v 2# 2 9 6\u2193', 'major');
            const badToken = PatternPracticeCore.parseDegreeSeries('1 2 zz', 'major');
            const badAccidental = PatternPracticeCore.parseDegreeSeries('3# 1', 'major');
            const empty = PatternPracticeCore.parseDegreeSeries('   ', 'major');
            return {
                offsets: good.offsets.join(','),
                goodErrors: good.errors.length,
                badTokenErrors: badToken.errors.length,
                badTokenOffsets: badToken.offsets.join(','),
                badAccidentalErrors: badAccidental.errors.length,
                emptyErrors: empty.errors.length
            };
        });
        report.check(`phrases series parser maps tokens to offsets (${seriesParse.offsets})`,
            seriesParse.offsets === '-3,0,0,-1.5,-1,1.5,1,8,-2'
            && seriesParse.goodErrors === 0
            && seriesParse.badTokenErrors === 1 && seriesParse.badTokenOffsets === '0,1'
            && seriesParse.badAccidentalErrors === 1
            && seriesParse.emptyErrors === 1);

        // Series Set loads the typed series as the current take (honoring
        // play on next), and it joins phrase history.
        await tab.fill('#seriesInput', '5v 1 1 7bv 7v 2# 2');
        const seriesVoices0 = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#seriesSetBtn');
        await tab.waitForTimeout(7 * 320 + 900);
        const seriesLoaded = await tab.evaluate(() => ({
            offsets: window.phrasesDebug.takePlan().map(note => note.offset).join(','),
            degrees: window.phrasesDebug.takePlan().map(note => note.degree).join(' '),
            voices: window.__voiceStarts,
            errorHidden: document.getElementById('seriesError').hidden,
            historyDegrees: document.querySelector('#historyList .phrase-history-degrees')?.textContent || ''
        }));
        report.check(`phrases series loads as the take and plays (${seriesLoaded.degrees}, ${seriesLoaded.voices - seriesVoices0} voices)`,
            seriesLoaded.offsets === '-3,0,0,-1.5,-1,1.5,1'
            && seriesLoaded.voices - seriesVoices0 === 7
            && seriesLoaded.errorHidden === true
            && seriesLoaded.historyDegrees.split(' ').length === 7);

        // Bad tokens list under the input and change nothing.
        await tab.fill('#seriesInput', '1 2 zz 3#');
        await tab.click('#seriesSetBtn');
        await tab.waitForTimeout(300);
        const seriesError = await tab.evaluate(() => ({
            hidden: document.getElementById('seriesError').hidden,
            text: document.getElementById('seriesError').textContent,
            offsets: window.phrasesDebug.takePlan().map(note => note.offset).join(',')
        }));
        report.check(`phrases series errors leave the take unchanged ("${seriesError.text}")`,
            seriesError.hidden === false
            && seriesError.text.includes('zz') && seriesError.text.includes('3#')
            && seriesError.offsets === '-3,0,0,-1.5,-1,1.5,1');
        await tab.click('#stopBtn');

        // Explicit range endpoints: offsets bounded to the chosen span
        const overBounded = await tab.evaluate(() => {
            const algos = ['balanced', 'random', 'stepwise', 'leapy', 'arch', 'motif', 'alto_gaps'];
            for (const phraseAlgo of algos) {
                for (let i = 0; i < 300; i++) {
                    const offsets = PatternPracticeCore.generatePhraseOffsets({
                        scaleType: 'major', phraseAlgo, startAtOne: false, rangeLow: -2, rangeHigh: 9,
                        minLength: 5, maxLength: 9, returnToInitial: false, returnToRoot: false
                    });
                    if (Math.min(...offsets) < -2 || Math.max(...offsets) > 9) return false;
                }
            }
            return true;
        });
        report.check('phrases algos honor range endpoints -2..9 (6-below..3-above)', overBounded);

        // Low endpoint a full octave below unison, high capped at the octave
        const aroundBounded = await tab.evaluate(() => {
            const algos = ['balanced', 'random', 'stepwise', 'leapy', 'arch', 'motif', 'alto_gaps'];
            for (const phraseAlgo of algos) {
                for (let i = 0; i < 300; i++) {
                    const offsets = PatternPracticeCore.generatePhraseOffsets({
                        scaleType: 'major', phraseAlgo, startAtOne: false, rangeLow: -7, rangeHigh: 7,
                        minLength: 5, maxLength: 9, returnToInitial: false, returnToRoot: false
                    });
                    if (Math.min(...offsets) < -7 || Math.max(...offsets) > 7) return false;
                }
            }
            return true;
        });
        report.check('phrases algos honor range endpoints -7..7 (octave-below-1..8)', aroundBounded);

        // Range endpoint steppers: one degree per step, endpoint labels
        // name degrees, and both endpoints persist.
        const rangeBefore = await tab.evaluate(() => {
            const data = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS) || {};
            return { low: data.rangeLow ?? 0, high: data.rangeHigh ?? 7 };
        });
        await tab.click('[data-step-key="rangeLow"][data-step-delta="-1"]');
        await tab.click('[data-step-key="rangeHigh"][data-step-delta="1"]');
        await tab.waitForTimeout(200);
        const rangeState = await tab.evaluate(() => ({
            saved: (() => {
                const data = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS) || {};
                return { low: data.rangeLow, high: data.rangeHigh };
            })(),
            lowLabel: document.getElementById('rangeLowValue').textContent,
            highLabel: document.getElementById('rangeHighValue').textContent
        }));
        report.check(`phrases range endpoints step and persist (low ${rangeState.lowLabel}, high ${rangeState.highLabel})`,
            rangeState.saved.low === rangeBefore.low - 1
            && rangeState.saved.high === rangeBefore.high + 1
            && rangeState.lowLabel.length > 0 && rangeState.highLabel.length > 0);
        await tab.click('[data-phrase-algo="arch"]');
        await tab.waitForTimeout(200);
        const savedAlgo = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.phraseAlgo);
        report.check('phrases algorithm persists', savedAlgo === 'arch');

        const lessonFamilies = await tab.evaluate(() => {
            const staff = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'staff', phraseLesson: 'staff_steps',
                phraseAlgo: 'balanced', startAtOne: true, rangeLow: 0, rangeHigh: 7,
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const sight = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'sight', phraseLesson: 'sight_pentachord',
                phraseAlgo: 'balanced', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const barber = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'barbershop', phraseLesson: 'barber_dominant',
                phraseAlgo: 'balanced', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const staffStepsOnly = staff.slice(1).every((offset, index) => Math.abs(offset - staff[index]) === 1);
            const sightInPentachord = sight.every(offset => [0, 1, 2, 3, 4].includes(offset));
            const barberDominant = barber.every(offset => [1, 3, 4, 6].includes(offset));
            // 'start at 1' outranks a palette that excludes the tonic:
            // the seed note is literal degree 1, the rest stays in palette.
            let tonicSeeded = true;
            for (let i = 0; i < 40; i++) {
                const offsets = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseStyle: 'barbershop', phraseLesson: 'barber_sevenths',
                    phraseAlgo: 'balanced', startAtOne: true, rangeLow: 0, rangeHigh: 7,
                    minLength: 6, maxLength: 8, returnToInitial: false, returnToRoot: false,
                    accidentalRate: 0
                });
                if (offsets[0] !== 0) tonicSeeded = false;
                if (!offsets.slice(1).every(offset => [1, 3, 4, 6].includes(offset))) tonicSeeded = false;
            }
            return { staffStepsOnly, sightInPentachord, barberDominant, tonicSeeded };
        });
        report.check('phrases style lessons constrain generated degrees',
            lessonFamilies.staffStepsOnly && lessonFamilies.sightInPentachord && lessonFamilies.barberDominant);
        report.check('phrases start-at-1 seeds tonic even outside lesson palette',
            lessonFamilies.tonicSeeded);
        await tab.click('[data-phrase-style="barbershop"]');
        await tab.waitForTimeout(200);
        await tab.click('[data-phrase-lesson="barber_dominant"]');
        await tab.waitForTimeout(200);
        const savedLesson = await tab.evaluate(() => {
            const saved = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS);
            return saved && saved.phraseStyle === 'barbershop' && saved.phraseLesson === 'barber_dominant';
        });
        report.check('phrases style and lesson persist', savedLesson);
        await tab.click('#fillChordBtn');
        await tab.waitForTimeout(200);
        await tab.click('[data-phrase-lesson="barber_tonic"]');
        await tab.waitForTimeout(200);
        const lessonFillState = await tab.evaluate(() => {
            const saved = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS);
            return {
                fillMode: saved?.fillMode,
                lockedFill: saved?.lessonLockedKeys?.includes('fillMode') === true,
                lockedMarker: document.getElementById('fillChordBtn').classList.contains('lesson-locked')
            };
        });
        report.check('phrases lesson presets leave fill modes user-controlled',
            lessonFillState.fillMode === 'chord' && !lessonFillState.lockedFill && !lessonFillState.lockedMarker);

        const genreLesson = await tab.evaluate(() => {
            const phrase = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'genre', phraseLesson: 'genre_pop_hook',
                phraseAlgo: 'balanced', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            return phrase.every(offset => [0, 1, 2, 3, 4, 5].includes(offset));
        });
        report.check('phrases genre lessons generate their own degree sets', genreLesson);

        const songInspiredLessons = await tab.evaluate(() => {
            const lessons = [
                'genre_blackbird_folk',
                'genre_hello_pop',
                'genre_simon_folk',
                'genre_scarborough_modal'
            ];
            return lessons.every(phraseLesson => {
                const phrase = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseStyle: 'genre', phraseLesson,
                    phraseAlgo: 'balanced', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                    minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                    accidentalRate: 0
                });
                return phrase.length === 8
                    && phrase.every(offset => offset >= 0 && offset <= 5)
                    && phrase.slice(1).every((offset, index) => offset !== phrase[index]);
            });
        });
        report.check('phrases song-inspired lessons stay abstract and bounded', songInspiredLessons);

        // Motif is a transposed shape, not a wandering walk: the leading
        // interval shape must be restated verbatim later in the phrase
        // (away from range edges, where bounding may distort it).
        const motifStructure = await tab.evaluate(() => {
            let hits = 0;
            for (let i = 0; i < 6; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeLow: -3, rangeHigh: 14, minLength: 8, maxLength: 10,
                    returnToInitial: false, returnToRoot: false, phraseAlgo: 'motif'
                });
                const o = phrase.notes.map(n => n.offset);
                const d = o.slice(1).map((v, idx) => v - o[idx]);
                for (let shapeLen = 2; shapeLen <= 3; shapeLen++) {
                    const shape = d.slice(0, shapeLen).join(',');
                    const rest = [];
                    for (let s = shapeLen + 1; s + shapeLen <= d.length; s++) {
                        rest.push(d.slice(s, s + shapeLen).join(','));
                    }
                    if (rest.includes(shape)) { hits++; break; }
                }
            }
            return hits;
        });
        report.check(`phrases motif restates its shape (${motifStructure}/6 samples)`, motifStructure >= 4);

        const altoGaps = await tab.evaluate(() => {
            let pairTouches = 0;
            for (let i = 0; i < 12; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeLow: 0, rangeHigh: 7, minLength: 8, maxLength: 10,
                    returnToInitial: false, returnToRoot: false, phraseAlgo: 'alto_gaps'
                });
                const offsets = phrase.notes.map(n => n.offset);
                for (let j = 1; j < offsets.length; j++) {
                    const pair = `${offsets[j - 1]},${offsets[j]}`;
                    if (pair === '2,3' || pair === '3,2' || pair === '6,7' || pair === '7,6') {
                        pairTouches++;
                    }
                }
            }
            return pairTouches;
        });
        report.check(`phrases alto gaps emphasizes 3/4 and 7/8 pairs (${altoGaps} direct touches)`, altoGaps >= 8);

        const returnToOne = await tab.evaluate(() => {
            for (let i = 0; i < 200; i++) {
                const offsets = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseAlgo: 'arch', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                    minLength: 5, maxLength: 8, returnToInitial: true, returnToRoot: false
                });
                if (offsets[offsets.length - 1] !== 0) return false;
            }
            return true;
        });
        report.check('phrases return to 1 ends on degree 1 even with random start', returnToOne);

        // Rearrange: every scale note inside the range exactly once (or
        // twice for the double variant), anchors consume the pool's 1s,
        // and no note stutters back-to-back.
        const rearrange = await tab.evaluate(() => {
            const sorted = values => values.slice().sort((a, b) => a - b).join(',');
            const range = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
            const base = {
                scaleType: 'major', phraseAlgo: 'rearrange', rangeLow: 0, rangeHigh: 7,
                minLength: 5, maxLength: 8, accidentalRate: 0, returnToRoot: false
            };
            for (let i = 0; i < 60; i++) {
                const plain = PatternPracticeCore.generatePhraseOffsets({
                    ...base, startAtOne: false, returnToInitial: false
                });
                if (sorted(plain) !== sorted(range(0, 7))) return 'plain permutation broken';
                const anchored = PatternPracticeCore.generatePhraseOffsets({
                    ...base, startAtOne: true, returnToInitial: true
                });
                if (anchored[0] !== 0 || anchored[anchored.length - 1] !== 0) return 'anchors missing';
                if (sorted(anchored.slice(1, -1)) !== sorted(range(1, 7))) return 'anchored interior broken';
                const expanded = PatternPracticeCore.generatePhraseOffsets({
                    ...base, startAtOne: false, returnToInitial: false, rangeLow: -3, rangeHigh: 14
                });
                if (sorted(expanded) !== sorted(range(-3, 14))) return 'expanded range broken';
                const doubled = PatternPracticeCore.generatePhraseOffsets({
                    ...base, phraseAlgo: 'rearrange_double', startAtOne: true, returnToInitial: true
                });
                if (doubled[0] !== 0 || doubled[doubled.length - 1] !== 0) return 'double anchors missing';
                if (doubled.slice(1, -1).includes(0)) return 'double interior repeats 1';
                if (sorted(doubled) !== sorted(range(0, 7).flatMap(value => [value, value]))) return 'double multiset broken';
                if (doubled.slice(1).some((value, idx) => value === doubled[idx])) return 'double stutters';
            }
            return 'ok';
        });
        report.check(`phrases rearrange exhausts the range with anchor-managed 1s (${rearrange})`, rearrange === 'ok');

        // Rearrange passing tones are inserted in addition to the notes
        // they connect; the underlying permutation stays intact.
        const rearrangeChromatic = await tab.evaluate(() => {
            const sorted = values => values.slice().sort((a, b) => a - b).join(',');
            const range = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
            let inserted = 0;
            for (let i = 0; i < 60; i++) {
                const offsets = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseAlgo: 'rearrange', rangeLow: 0, rangeHigh: 7,
                    minLength: 5, maxLength: 8, startAtOne: false, returnToInitial: false,
                    returnToRoot: false, accidentalRate: 1
                });
                if (sorted(offsets.filter(Number.isInteger)) !== sorted(range(0, 7))) return -1;
                for (let j = 0; j < offsets.length; j++) {
                    if (Number.isInteger(offsets[j])) continue;
                    inserted++;
                    const between = PatternPracticeCore.chromaticBetween('major', offsets[j - 1], offsets[j + 1]);
                    if (between !== offsets[j]) return -1;
                }
            }
            return inserted;
        });
        report.check(`phrases rearrange inserts passing tones without dropping scale notes (${rearrangeChromatic} inserted)`,
            rearrangeChromatic > 0);

        // Rearrange orderings are chosen for interval sequencing: leaps
        // stacked in the same direction should be much rarer than in a
        // naive shuffle (the notes themselves stay a full permutation).
        const rearrangeShape = await tab.evaluate(() => {
            const compoundLeaps = offsets => {
                let count = 0;
                for (let i = 2; i < offsets.length; i++) {
                    const prev = offsets[i - 1] - offsets[i - 2];
                    const next = offsets[i] - offsets[i - 1];
                    if (Math.abs(prev) >= 3 && Math.abs(next) >= 3 && Math.sign(prev) === Math.sign(next)) count++;
                }
                return count;
            };
            const naiveShuffle = values => {
                const out = values.slice();
                for (let i = out.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [out[i], out[j]] = [out[j], out[i]];
                }
                return out;
            };
            let chosen = 0;
            let naive = 0;
            for (let i = 0; i < 200; i++) {
                chosen += compoundLeaps(PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseAlgo: 'rearrange', rangeLow: 0, rangeHigh: 7,
                    minLength: 5, maxLength: 8, startAtOne: false, returnToInitial: false,
                    returnToRoot: false, accidentalRate: 0
                }));
                naive += compoundLeaps(naiveShuffle([0, 1, 2, 3, 4, 5, 6, 7]));
            }
            return { chosen, naive };
        });
        report.check(`phrases rearrange avoids same-direction leap stacks (${rearrangeShape.chosen} chosen vs ${rearrangeShape.naive} naive over 200)`,
            rearrangeShape.chosen <= rearrangeShape.naive * 0.5 && rearrangeShape.naive > 0);

        // Chromatic choices: Acc replaces normal note slots with passing
        // tones, never lengthening the phrase beyond Min/Max.
        const chromatic = await tab.evaluate(() => {
            let decorated = 0;
            let invalid = 0;
            let wrongLength = 0;
            for (let i = 0; i < 100; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeLow: -2, rangeHigh: 9, minLength: 16, maxLength: 16,
                    returnToInitial: false, returnToRoot: false,
                    phraseAlgo: 'stepwise', accidentalRate: 1
                });
                if (phrase.notes.length !== 16) wrongLength++;
                phrase.notes.forEach((note, idx) => {
                    if (Number.isInteger(note.offset)) return;
                    decorated++;
                    const label = note.degree;
                    const validSlot = PatternPracticeCore.chromaticBetween(
                        'major',
                        Math.floor(note.offset),
                        Math.ceil(note.offset)
                    ) !== null;
                    if (!validSlot || !(label.endsWith('#') || label.endsWith('b'))) invalid++;
                });
            }
            return { decorated, invalid, wrongLength };
        });
        report.check(`phrases accidental rate selects valid passing tones without changing length (${chromatic.decorated} chosen, ${chromatic.invalid} invalid)`,
            chromatic.decorated > 0 && chromatic.invalid === 0 && chromatic.wrongLength === 0);
        await tab.click('[data-step-key="accidentalRate"][data-step-delta="1"]');
        await tab.waitForTimeout(200);
        const savedAccidental = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.accidentalRate);
        report.check('phrases accidental rate stepper persists', savedAccidental === 0.05);

        // Section pause: the stepper adjusts the pause between repeat
        // loops / breakdown passes / powerset combos and persists.
        await tab.click('[data-step-key="sectionPauseMs"][data-step-delta="1"]');
        await tab.waitForTimeout(200);
        const sectionPause = await tab.evaluate(() => ({
            saved: SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.sectionPauseMs,
            shown: document.getElementById('sectionPauseValue')?.textContent
        }));
        report.check(`phrases section pause stepper persists (${sectionPause.saved}ms, "${sectionPause.shown}")`,
            sectionPause.saved === 1100 && sectionPause.shown === '1.1s');
        await tab.click('[data-step-key="sectionPauseMs"][data-step-delta="-1"]');
        await tab.waitForTimeout(200);

        const extendedLabels = await tab.evaluate(() => {
            const dp = PatternPracticeCore.degreesPerOctave('major');
            return PatternPracticeCore.offsetToDegree(8, dp) === '2\u2191'
                && PatternPracticeCore.offsetToDegree(-2, dp) === '6\u2193'
                && PatternPracticeCore.offsetToDegree(7, dp) === '8'
                && PatternPracticeCore.offsetToSpoken(8, dp) === '2 above'
                && PatternPracticeCore.offsetToSpoken(-2, dp) === '6 below';
        });
        report.check('phrases extended degrees label above/below, not raw 9 or 6d', extendedLabels);

        const staffSpelling = await tab.evaluate(() => {
            return NotationSpelling.vexKeySignature('D#', 'major') === 'Eb'
                && NotationSpelling.vexKeySignature('A', 'minor') === 'Am'
                && NotationSpelling.vexKeySignature('A', 'melodic_minor') === 'Am'
                && NotationSpelling.midiToVexKey(51) === 'd#/3'
                && NotationSpelling.midiToVexKey(54, 'b') === 'gb/3'
                && NotationSpelling.midiToVexKeyForScale(51, 51, 'major') === 'eb/3'
                && NotationSpelling.midiToVexKeyForScale(56, 51, 'major') === 'ab/3'
                && NotationSpelling.midiToVexKeyForScale(70, 65, 'major') === 'bb/4'
                // Written octave follows the letter: B# in C# major sits on
                // the B line below its sounding C (midi 60 -> b#/3, not /4)
                && NotationSpelling.midiToVexKeyForScale(60, 49, 'major') === 'b#/3'
                && scaleMidiToPitchString('C#', 3, 'major', 60) === 'B#3'
                && NotationSpelling.clefForPhrase(51, [51, 53, 55]) === 'bass'
                // Clef minimizes ledger lines: C#3 phrases hug the bass staff
                && NotationSpelling.clefForPhrase(49, [49, 60, 61, 60, 58, 49]) === 'bass'
                && NotationSpelling.clefForPhrase(60, [60, 64, 67, 72]) === 'treble'
                && NotationSpelling.passingAccidental(4.5, 7, 0, [4.5, 5]) === '#';
        });
        report.check('phrases staff spelling helpers', staffSpelling);

        const staffRendered = await tab.evaluate(() => {
            const host = document.getElementById('phraseStaff');
            return Boolean(host && !host.classList.contains('phrase-staff-empty') && host.querySelector('svg'));
        });
        report.check('phrases staff renders svg for current phrase', staffRendered);

        // The staff is metered 4/4: phrase notes plus padding rests always
        // fill whole measures, and the padding never exceeds one measure.
        const staffMeasures = await tab.evaluate(() => {
            const planLength = window.phrasesDebug.takePlan().length;
            const drawn = document.querySelectorAll('#phraseStaff .vf-stavenote').length;
            return { planLength, drawn };
        });
        report.check(`phrases staff pads to whole 4/4 measures (${staffMeasures.planLength} notes -> ${staffMeasures.drawn} beats)`,
            staffMeasures.drawn % 4 === 0
            && staffMeasures.drawn >= staffMeasures.planLength
            && staffMeasures.drawn - staffMeasures.planLength < 4);

        const fillPlans = await tab.evaluate(() => {
            const fullBtn = document.getElementById('fillFullBtn');
            const chordBtn = document.getElementById('fillChordBtn');
            if (fullBtn.getAttribute('aria-pressed') === 'true') fullBtn.click();
            if (chordBtn.getAttribute('aria-pressed') === 'true') chordBtn.click();
            const before = {
                take: window.phrasesDebug.takePlan().length,
                tone: window.phrasesDebug.tonePlaybackPlan().length,
                targets: window.phrasesDebug.testTargets().length
            };
            fullBtn.click();
            const full = {
                take: window.phrasesDebug.takePlan().length,
                tone: window.phrasesDebug.tonePlaybackPlan().length,
                targets: window.phrasesDebug.testTargets().length,
                pressed: fullBtn.getAttribute('aria-pressed')
            };
            chordBtn.click();
            const chord = {
                take: window.phrasesDebug.takePlan().length,
                tone: window.phrasesDebug.tonePlaybackPlan().length,
                targets: window.phrasesDebug.testTargets().length,
                fullPressed: fullBtn.getAttribute('aria-pressed'),
                chordPressed: chordBtn.getAttribute('aria-pressed')
            };
            return { before, full, chord };
        });
        report.check(`phrases fill modes add invisible tone notes (${fillPlans.before.tone}->${fillPlans.full.tone}->${fillPlans.chord.tone})`,
            fillPlans.before.take === fillPlans.before.tone
            && fillPlans.full.take === fillPlans.before.take
            && fillPlans.full.targets === fillPlans.before.targets
            && fillPlans.full.tone >= fillPlans.before.tone
            && fillPlans.full.pressed === 'true'
            && fillPlans.chord.take === fillPlans.before.take
            && fillPlans.chord.targets === fillPlans.before.targets
            && fillPlans.chord.tone >= fillPlans.before.tone
            && fillPlans.chord.fullPressed === 'false'
            && fillPlans.chord.chordPressed === 'true');

        const fillBreakdownGap = await tab.evaluate(() => {
            const tokens = [...document.querySelectorAll('.phrase-degree-token')];
            if (tokens.length < 3) return { ok: false, reason: 'short phrase' };
            if (document.getElementById('fillChordBtn').getAttribute('aria-pressed') !== 'true') {
                document.getElementById('fillChordBtn').click();
            }
            const setActive = (token, active) => {
                if (token.classList.contains('inactive') === !active) return;
                token.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            };
            tokens.forEach(token => setActive(token, false));
            [0, tokens.length - 1].forEach(index => {
                const token = tokens[index];
                setActive(token, true);
            });
            const enabled = window.phrasesDebug.takePlan().filter(note => note.enabled).length;
            const tone = window.phrasesDebug.tonePlaybackPlan().length;
            tokens.forEach(token => setActive(token, true));
            return { ok: tone === enabled, enabled, tone };
        });
        report.check(`phrases chord fill does not bridge breakdown gaps (${fillBreakdownGap.enabled} enabled, ${fillBreakdownGap.tone} tones)`,
            fillBreakdownGap.ok === true);

        // The take plan is one explicit timeline: with the FIRST note
        // muted, the first enabled target starts at 0 and disabled notes
        // own no time (test matches what playback actually sounds like).
        const plan = await tab.evaluate(() => {
            const tokens = document.querySelectorAll('.phrase-degree-token');
            tokens[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            const notes = window.phrasesDebug.takePlan();
            const targets = window.phrasesDebug.testTargets();
            return {
                total: notes.length,
                firstDisabled: notes[0].enabled === false && notes[0].startMs === null,
                targetCount: targets.length,
                enabledCount: notes.filter(n => n.enabled).length,
                firstTargetAtZero: targets[0].startMs === 0,
                allActive: targets.every(t => t.active)
            };
        });
        report.check(`phrases take plan: muted first note owns no time, timeline starts at 0 (${plan.targetCount}/${plan.total} targets)`,
            plan.firstDisabled && plan.firstTargetAtZero && plan.targetCount === plan.enabledCount && plan.allActive);

        // Test is a mode switch into singing: it stops any active phrase
        // playback and never lets the page keep playing under the test.
        await tab.click('#stopBtn');
        await tab.waitForTimeout(300);
        await tab.evaluate(() => {
            const tones = document.getElementById('hearTonesToggle');
            if (tones instanceof HTMLInputElement && !tones.checked) tones.click();
        });
        await tab.click('#playBtn');
        await tab.waitForTimeout(450);
        const voicesAtTestTap = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.click('#testBtn');
        await tab.waitForTimeout(1600);
        const testInterrupt = await tab.evaluate(() => ({
            open: !document.getElementById('phraseTestPanel').hidden,
            voicesAfter: window.__trace.filter(e => e.type === 'voice-start').length
        }));
        report.check(`phrases Test stops active playback (${voicesAtTestTap}->${testInterrupt.voicesAfter} voices)`,
            testInterrupt.open && testInterrupt.voicesAfter === voicesAtTestTap);

        // Opening the test never auto-plays: the user is there to sing.
        // Quiesce playback and close the panel (Stop no longer closes it)
        // so the next Test tap is an OPEN.
        await tab.click('#stopBtn');
        await tab.evaluate(() => {
            if (!document.getElementById('phraseTestPanel').hidden) {
                document.getElementById('phraseTestCloseBtn').click();
            }
        });
        await tab.waitForTimeout(500);
        const voicesBefore = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.click('#testBtn');
        await tab.waitForTimeout(1500);
        const voicesAfter = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        report.check(`phrases test open is silent (${voicesAfter - voicesBefore} voices started)`,
            voicesAfter === voicesBefore);
        // The Guide button plays the targets on demand.
        const guideVoices = await tab.evaluate(async () => {
            const voices = () => window.__trace.filter(e => e.type === 'voice-start').length;
            const before = voices();
            document.getElementById('phraseTestGuideBtn').click();
            await new Promise(r => setTimeout(r, 2500));
            return voices() - before;
        });
        report.check(`phrases Guide button plays enabled targets (${guideVoices} voices)`,
            guideVoices === plan.targetCount);

        // Playback and Test coexist: with the panel open and listening,
        // Play sounds the phrase, Stop stops it WITHOUT closing the
        // panel, single-note taps sound, and Next starts a fresh take
        // for the new phrase with the panel still open.
        const playDuringTest = await tab.evaluate(async () => {
            const voices = () => window.__trace.filter(e => e.type === 'voice-start').length;
            const panelOpen = () => !document.getElementById('phraseTestPanel').hidden;
            const start = voices();
            document.getElementById('playBtn').click();
            await new Promise(r => setTimeout(r, 900));
            const afterPlay = voices();
            document.getElementById('stopBtn').click();
            await new Promise(r => setTimeout(r, 400));
            const openAfterStop = panelOpen();
            const afterStop = voices();
            document.querySelector('.phrase-note-play-token')?.click();
            await new Promise(r => setTimeout(r, 400));
            const afterToken = voices();
            document.getElementById('nextBtn').click();
            await new Promise(r => setTimeout(r, 1200));
            return {
                playSounds: afterPlay > start,
                openAfterStop,
                tokenSounds: afterToken > afterStop,
                openAfterNext: panelOpen()
            };
        });
        report.check('phrases playback works during Test; Stop and Next keep the panel open',
            playDuringTest.playSounds && playDuringTest.openAfterStop
            && playDuringTest.tokenSounds && playDuringTest.openAfterNext);

        // END-TO-END NOTE LINKAGE: with notes disabled, singing exactly
        // the displayed enabled notes must credit every one of them.
        // Sing via the explicit sample seam at each target's window.
        const linkage = await tab.evaluate(async () => {
            // Deterministic take: stop the mic BEFORE resetting. The trace
            // records everything sung - including the fake device's beep
            // tones - so a live mic would contaminate the injected samples.
            const listenBtn = document.getElementById('phraseTestListenBtn');
            if (listenBtn.textContent.includes('On')) listenBtn.click();
            document.getElementById('phraseTestPauseToggle').click(); // wall clock + session reset
            const targets = window.phrasesDebug.testTargets();
            const panel = window.phrasesDebug.panel;
            for (const t of targets) {
                for (let k = 0; k < 5; k++) {
                    panel.recordSample(t.midi, t.startMs + 10 + k * 55);
                }
            }
            const lastEnd = targets[targets.length - 1].endMs;
            await new Promise(r => setTimeout(r, lastEnd + 800));
            // With the mic stopped there are no frames; evaluate by name.
            panel.draw();
            return {
                count: targets.length,
                score: document.getElementById('phraseTestScore').textContent
            };
        });
        report.check(`phrases sings-right-thing-scores-right (${linkage.score})`,
            linkage.score.includes(`${linkage.count}/${linkage.count}`));

        // The recorded take carries per-note outcomes with signed bias -
        // the degree-level data the training goal needs.
        const noteRecord = await tab.evaluate(() => {
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            const mine = entries.filter(e => e.tool === 'phrases-test');
            const last = mine[mine.length - 1] || {};
            const notes = last.notes || [];
            return {
                count: notes.length,
                labels: notes.map(n => n.label).join(' '),
                allGoodCentered: notes.every(n => n.result === 'good'
                    && n.biasCents !== null && Math.abs(n.biasCents) < 5)
            };
        });
        report.check(`phrases take records per-note results (${noteRecord.count} notes: ${noteRecord.labels})`,
            noteRecord.count === linkage.count && noteRecord.allGoodCentered);

        // RUBATO: scoring aligns the sung note sequence to the targets,
        // so holding every note far longer than its timeline slot (and
        // breathing freely) still credits every note. Under the old
        // fixed-window scoring this take misassigned every note after
        // the first.
        const rubato = await tab.evaluate(async () => {
            const panel = window.phrasesDebug.panel;
            await panel.open();
            const listenBtn = document.getElementById('phraseTestListenBtn');
            if (listenBtn.textContent.includes('On')) listenBtn.click(); // deterministic: no mic
            const targets = window.phrasesDebug.testTargets();
            let t = 5;
            for (const target of targets) {
                for (let k = 0; k < 10; k++) { // ~550ms hold against a 300ms slot
                    panel.recordSample(target.midi, t);
                    t += 55;
                }
                t += 40;
            }
            await new Promise(r => setTimeout(r, 800)); // idle closes the final note
            panel.draw();
            return {
                count: targets.length,
                score: document.getElementById('phraseTestScore').textContent
            };
        });
        report.check(`phrases rubato take credits held notes (${rubato.score})`,
            rubato.score.includes(`${rubato.count}/${rubato.count}`));

        // One wrong note misses exactly itself: neighbors stay credited
        // (no cascade through the rest of the take).
        const wrongNote = await tab.evaluate(async () => {
            const panel = window.phrasesDebug.panel;
            await panel.open();
            const listenBtn = document.getElementById('phraseTestListenBtn');
            if (listenBtn.textContent.includes('On')) listenBtn.click();
            const targets = window.phrasesDebug.testTargets();
            let t = 5;
            targets.forEach((target, index) => {
                const midi = index === 1 ? target.midi + 2.5 : target.midi;
                for (let k = 0; k < 6; k++) {
                    panel.recordSample(midi, t);
                    t += 55;
                }
                t += 30;
            });
            await new Promise(r => setTimeout(r, 800));
            panel.draw();
            return {
                count: targets.length,
                score: document.getElementById('phraseTestScore').textContent
            };
        });
        report.check(`phrases wrong note misses only itself (${wrongNote.score})`,
            wrongNote.score.includes(`${wrongNote.count - 1}/${wrongNote.count}`));

        // DRAW-WHAT-YOU-SING: pitch far outside the charted rails (the
        // singer's real register an octave off, an overshoot) must still
        // be recorded and drawn - rails and targets never gate the trace.
        // A sustained (confirmed) off-rails note passes the glitch
        // holdback and lands in the recorded history the chart draws.
        const offRails = await tab.evaluate(() => {
            const targets = window.phrasesDebug.testTargets();
            const panel = window.phrasesDebug.panel;
            const lowMidi = Math.min(...targets.map(t => t.midi)) - 12;
            const t0 = targets[0].startMs + 5;
            panel.recordSample(lowMidi, t0);
            panel.recordSample(lowMidi, t0 + 50);
            panel.recordSample(lowMidi, t0 + 100);
            const sustained = panel.history.filter(s => s.midi === lowMidi).length;

            // A brief scrape - a large jump that does NOT sustain for the
            // confirmation frames - never reaches the trace; the return
            // to the held pitch does. The scrape pitch sits above every
            // target so no other injected sample can share its midi.
            const scrapeMidi = Math.max(...targets.map(t => t.midi)) + 15;
            panel.recordSample(scrapeMidi, t0 + 150);
            panel.recordSample(scrapeMidi, t0 + 180);
            panel.recordSample(lowMidi, t0 + 210);
            return {
                lowMidi,
                recorded: sustained,
                scrapeRecorded: panel.history.filter(s => s.midi === scrapeMidi).length,
                returnRecorded: panel.history.filter(s => s.midi === lowMidi).length
            };
        });
        report.check(`phrases trace keeps off-rails singing (${offRails.recorded} samples at midi ${offRails.lowMidi})`,
            offRails.recorded === 3);
        report.check(`phrases trace drops unconfirmed scrapes (${offRails.scrapeRecorded} scrape samples, ${offRails.returnRecorded} held)`,
            offRails.scrapeRecorded === 0 && offRails.returnRecorded === 4);

        // Weak-spot aggregation names the leaning degree and its direction.
        const weakLine = await tab.evaluate(() => {
            for (let i = 0; i < 3; i++) {
                ProgressStore.record({
                    tool: 'weak-spot-check', context: 'test', total: 2, hit: 2, avgCents: 12,
                    notes: [
                        { label: '6', midi: 60, result: 'ok', avgCents: 22, biasCents: 21 },
                        { label: '1', midi: 52, result: 'good', avgCents: 3, biasCents: 1 }
                    ]
                });
            }
            return ProgressStore.weakSpotLine('weak-spot-check');
        });
        report.check(`weak spots name the sharp degree ("${weakLine}")`,
            weakLine.includes('6:') && weakLine.includes('sharp') && !weakLine.includes('1:'));

        // The action row lives in the fixed bottom dock sheet.
        await tab.evaluate(() => window.scrollTo(0, 700));
        await tab.waitForTimeout(300);
        const pinned = await tab.evaluate(() => {
            const dock = document.getElementById('phraseTestDock');
            const actions = document.querySelector('#phraseTestPanel .pitch-test-actions');
            if (!dock || !actions) return { ok: false };
            const dockRect = dock.getBoundingClientRect();
            const actionsRect = actions.getBoundingClientRect();
            return {
                ok: true,
                dockOpen: dock.classList.contains('open'),
                dockAtBottom: Math.abs(dockRect.bottom - window.innerHeight) < 4,
                actionsVisible: actionsRect.top >= 0 && actionsRect.bottom <= window.innerHeight
            };
        });
        report.check(`phrases test dock stays fixed at bottom when scrolled (open=${pinned.dockOpen})`,
            pinned.ok && pinned.dockOpen && pinned.dockAtBottom && pinned.actionsVisible);
        await tab.close();
    }

    // ============ PITCH METER: free session produces results ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'pitch-meter', report.errors);
        await tab.goto(`${BASE_URL}/pitch-meter.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.click('[data-mode="free"]');
        await tab.click('#listenBtn');
        await tab.waitForTimeout(3000);
        const samples = await tab.evaluate(() => window.pitchMeter.session.history.length);
        await tab.click('#stopBtn');
        await tab.waitForTimeout(500);
        const resultsShown = await tab.evaluate(() => document.getElementById('resultsPanel').style.display);
        const notesHit = await tab.textContent('#notesHit');
        // The fake device's tone sits mostly above the singable band
        // (D2-C5), so only a handful of its samples register - which is
        // the band doing its job. Any recorded sample proves the
        // mic -> detector -> session pipeline end to end.
        report.check(`pitch-meter free session (${samples} samples, notesHit ${notesHit})`,
            samples > 0 && resultsShown === 'block' && /^\d+\/\d+$/.test(notesHit));

        const pmProgress = await tab.evaluate(() => {
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            return {
                count: entries.filter(e => e.tool === 'pitch-meter').length,
                line: document.getElementById('progressSummary').textContent
            };
        });
        report.check(`pitch-meter session recorded once (${pmProgress.count}) trend "${pmProgress.line}"`,
            pmProgress.count === 1 && /^Progress: Today \d+%/.test(pmProgress.line));
        await ctx.close();
    }

    // ============ SING PANEL: per-note scoring appears once windows pass ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'sing-panel', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.click('#singBtn');
        await tab.waitForTimeout(1000);
        // Wall-clock mode so all target windows pass deterministically.
        // Stop the mic: with the fake device beeping forever, the voice
        // never goes idle, so unsung targets would stay pending instead
        // of resolving to missed.
        await tab.evaluate(() => {
            const listenBtn = document.getElementById('scalesSingListenBtn');
            if (listenBtn && listenBtn.textContent.includes('On')) listenBtn.click();
            document.getElementById('scalesSingPauseToggle').click();
            // A take records only when something was sung: one
            // deterministic note through the sample seam.
            for (let k = 0; k < 5; k++) {
                window.scalesController.singPanel.recordSample(60, 30 + k * 50);
            }
        });
        await tab.waitForTimeout(4500);
        // With the mic stopped there are no frames; evaluate by name.
        await tab.evaluate(() => window.scalesController.singPanel.draw());
        const score = await tab.textContent('#scalesSingScore');
        report.check(`sing panel scores after windows pass ("${score}")`,
            /Score: \d+\/\d+ on pitch/.test(score));

        // The completed take is recorded and the trend line appears
        const progress = await tab.evaluate(() => {
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            return {
                entry: entries.find(e => e.tool === 'scales-sing') || null,
                line: document.getElementById('scalesSingProgress').textContent
            };
        });
        report.check(`sing take recorded (${JSON.stringify(progress.entry && progress.entry.total)}) trend "${progress.line}"`,
            progress.entry !== null && progress.entry.total > 0 && /^Progress: Today \d+%/.test(progress.line));
        await ctx.close();
    }

    // ============ INTERVALS EAR: identify-answer-record + presets ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'intervals-ear', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html?mode=ear`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.click('#earNextBtn');
        await tab.waitForTimeout(2500);
        await tab.click('.answer-btn[data-interval="P5"]');
        await tab.waitForTimeout(600);
        const feedback = await tab.textContent('#intervalFeedback');
        const stats = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.INTERVALS_EAR_STATS));
        const total = Object.values(stats || {}).reduce((sum, s) => sum + s.total, 0);
        report.check('intervals ear answer recorded with feedback', feedback.trim().length > 0 && total >= 1);
        await tab.click('.vf-btn[data-preset="perfect"]');
        await tab.waitForTimeout(300);
        const enabled = await tab.evaluate(() => {
            const data = SettingsStore.peekData(StorageKeys.INTERVALS_SETTINGS);
            return data && data.enabledIntervals;
        });
        report.check('intervals ear preset filters intervals', Array.isArray(enabled) && enabled.length === 3);
        const mediaTitle = await tab.evaluate(() => navigator.mediaSession.metadata?.title || 'none');
        report.check('intervals ear media session registered', mediaTitle === 'Ear training');
        await ctx.close();
    }

    // ============ PLAYER VOICE: shared core drives commands and music requests ============
    {
        const ctx = await browser.newContext();
        // Fake key (long enough to pass the gate) and a controllable fake
        // SpeechRecognition, installed before page scripts run.
        await ctx.addInitScript(() => {
            localStorage.setItem('claudeApiKey', 'test-key-not-real-1234567890');
            window.__recs = [];
            class FakeSpeechRecognition {
                constructor() {
                    window.__recs.push(this);
                    this.continuous = false;
                    this.interimResults = false;
                    this.lang = '';
                    // Real engines keep a growing per-session result list and
                    // re-send it in every event; the fakes must do the same.
                    this._results = [];
                }
                start() { this._results = []; this.onstart && this.onstart(); }
                stop() { this.onend && this.onend(); }
                abort() { this.onend && this.onend(); }
            }
            // Desktop pattern: each utterance appends a new result index.
            window.__emitResult = (text, isFinal = true) => {
                const rec = window.__recs[window.__recs.length - 1];
                const result = [{ transcript: text }];
                result.isFinal = isFinal;
                rec._results.push(result);
                rec.onresult({ resultIndex: rec._results.length - 1, results: rec._results });
            };
            // Android pattern: the SAME index is re-sent with grown
            // cumulative text, repeatedly marked final.
            window.__emitCumulative = (text, isFinal = true) => {
                const rec = window.__recs[window.__recs.length - 1];
                const result = [{ transcript: text }];
                result.isFinal = isFinal;
                const index = Math.max(0, rec._results.length - 1);
                rec._results[index] = result;
                rec.onresult({ resultIndex: index, results: rec._results });
            };
            window.SpeechRecognition = FakeSpeechRecognition;
            window.webkitSpeechRecognition = FakeSpeechRecognition;
            // Claude is unreachable in tests; fail fast so the flow resolves
            const realFetch = window.fetch.bind(window);
            window.fetch = (url, ...rest) => {
                if (String(url).includes('anthropic')) return Promise.reject(new Error('offline test'));
                return realFetch(url, ...rest);
            };
        });
        const tab = await ctx.newPage();
        // The manual-mode request intentionally fails at the stubbed Claude
        // fetch; those logged errors are expected.
        /** @type {string[]} */
        const playerVoiceErrors = [];
        collectErrors(tab, 'player-voice', playerVoiceErrors);
        await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);

        const modelOptions = await tab.evaluate(() => {
            return {
                hasClaudeFable5: !!document.querySelector('[data-claude-model="claude-fable-5"]'),
                hasClaudeOpus48: !!document.querySelector('[data-claude-model="claude-opus-4-8"]'),
                hasClaudeSonnet5: !!document.querySelector('[data-claude-model="claude-sonnet-5"]'),
                hasClaudeHaiku45: !!document.querySelector('[data-claude-model="claude-haiku-4-5"]'),
                openaiModels: Array.from(document.querySelectorAll('[data-openai-model]'))
                    .map(btn => /** @type {HTMLElement} */ (btn).dataset.openaiModel)
            };
        });
        report.check('player exposes current LLM model options',
            modelOptions.hasClaudeFable5
            && modelOptions.hasClaudeOpus48
            && modelOptions.hasClaudeSonnet5
            && modelOptions.hasClaudeHaiku45
            && modelOptions.openaiModels.includes('gpt-5.5')
            && modelOptions.openaiModels.includes('gpt-5.4')
            && modelOptions.openaiModels.includes('gpt-4.1'));

        const musicHistoryCache = await tab.evaluate(async () => {
            const query = `cache test ${Date.now()}`;
            PlayerHistoryDB.recordYouTubeSearch(query, [{
                videoId: 'cached-video',
                title: 'Cached Video',
                channelTitle: 'Cached Channel',
                duration: 100
            }], { source: 'test' });
            await new Promise(resolve => setTimeout(resolve, 100));
            const cached = await PlayerHistoryDB.getYouTubeSearch(query);
            return {
                query: cached?.query || '',
                count: cached?.results?.length || 0,
                videoId: cached?.results?.[0]?.videoId || '',
                source: cached?.source || ''
            };
        });
        report.check('player IndexedDB stores YouTube search conversions',
            musicHistoryCache.query.startsWith('cache test')
            && musicHistoryCache.count === 1
            && musicHistoryCache.videoId === 'cached-video'
            && musicHistoryCache.source === 'test');

        // Log lines persist across sessions: recorded to IndexedDB as they
        // happen, and the panel replays earlier-session lines on first open.
        const logHistory = await tab.evaluate(async () => {
            const stamp = `log history probe ${Date.now()}`;
            PlayerHistoryDB.recordLog({ type: 'claude', label: 'Probe', text: stamp, line: `[00:00:00] Probe: ${stamp}` });
            await new Promise(resolve => setTimeout(resolve, 120));
            const recent = await PlayerHistoryDB.listRecentLogs(50);
            const c = window.musicController;
            // Pretend this session started after the probe was written, so
            // the replay path treats it as an earlier session's line.
            c.sessionStartedAt = new Date(Date.now() + 1000).toISOString();
            c.historicalLogsLoaded = false;
            await c.loadHistoricalLogs();
            const replayed = Array.from(document.querySelectorAll('#logContent .log-line.log-history'))
                .some(line => line.textContent.includes(stamp));
            const divider = !!document.querySelector('#logContent .log-history-divider');
            return { stored: recent.some(record => record.text === stamp), replayed, divider };
        });
        report.check('player log lines persist and replay from earlier sessions',
            logHistory.stored && logHistory.replayed && logHistory.divider);

        const playlistSourceGroups = await tab.evaluate(() => {
            const harness = {
                favorites: {},
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                lyricsRowMarker(item) {
                    return item.lyricsStatus === 'ready'
                        ? { label: '\u2713', className: 'timed', aria: 'Timed lyrics (line-synced) - tap to view' }
                        : { label: '\u00b7', className: '', aria: 'Get lyrics' };
                }
            };
            PlayerPlaylist.install(harness);
            const body = document.getElementById('playlistBody');
            body.innerHTML = '';
            harness.addPlaylistItemToDOM({
                id: 501,
                videoId: 'restored-video',
                name: 'Restored Song',
                artist: 'Restored Artist',
                year: '',
                album: '',
                title: 'Restored Song',
                channelTitle: 'Restored Artist',
                duration: '1:00',
                comment: 'Loaded before this page session',
                searchTerm: 'Restored Artist Restored Song',
                sourceKind: 'restored',
                sourceLabel: 'Known at load'
            });
            harness.addPlaylistItemToDOM({
                id: 502,
                videoId: 'search-video',
                name: 'Search Song',
                artist: 'Search Artist',
                year: '',
                album: '',
                title: 'Search Song',
                channelTitle: 'Search Artist',
                duration: '1:00',
                comment: 'Included because it matches the requested search',
                searchTerm: 'Search Artist Search Song',
                sourceKind: 'search',
                sourceLabel: 'Search: Search Artist Search Song',
                sourceSearchTerm: 'Search Artist Search Song'
            });
            const rows = Array.from(body.querySelectorAll('.playlist-row'));
            const dataRows = rows.map(row => row.dataset.itemId);
            // One flat data line per row: leading gutter (star + lyric
            // marker), name, meta, duration, and remove; the note is the
            // only extra element (own line, Notes toggle).
            const slots = rows.map(row => ({
                name: row.querySelector(':scope > .playlist-song-name')?.textContent || '',
                duration: row.querySelector(':scope > .playlist-song-duration')?.textContent || '',
                artist: row.querySelector(':scope > .playlist-row-meta .playlist-song-artist')?.textContent || '',
                hasLeading: !!row.querySelector(':scope > .playlist-row-leading'),
                hasStar: !!row.querySelector('.playlist-row-leading > .favorite-btn'),
                hasMarker: !!row.querySelector('.playlist-row-leading > .lyrics-row-btn'),
                hasRemove: !!row.querySelector(':scope > .playlist-remove-btn'),
                nestedWrappers: row.querySelectorAll(':scope > div:not(.playlist-song-comment):not(.playlist-row-leading)').length
            }));
            const comments = Array.from(body.querySelectorAll('.playlist-song-comment')).map(el => el.textContent);
            body.innerHTML = '';
            return { dataRows, slots, comments };
        });
        report.check('player playlist rows are one flat data line with fixed slots',
            playlistSourceGroups.dataRows.includes('501')
            && playlistSourceGroups.dataRows.includes('502')
            && playlistSourceGroups.slots.every(slot => slot.name && slot.duration && slot.artist
                && slot.hasLeading && slot.hasStar && slot.hasMarker && slot.hasRemove && slot.nestedWrappers === 0)
            && playlistSourceGroups.comments.some(comment =>
                comment.includes('Included because it matches the requested search')));

        // Leading gutter (star + lyric marker): taps there must not start
        // playback; only the row body plays. Markers: ✓ timed, ~ non-timed.
        const starGutterAndMarkers = await tab.evaluate(() => {
            const harness = {
                favorites: {},
                playlist: [],
                playedIds: /** @type {number[]} */ ([]),
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                playVideo(item) { this.playedIds.push(item.id); },
                lyricsRowMarker(item) {
                    if (item.lyricsStatus === 'ready' && item.lyricsData?.syncedLines?.length) {
                        return { label: '\u2713', className: 'timed', aria: 'Timed lyrics (line-synced) - tap to view' };
                    }
                    if (item.lyricsStatus === 'ready') {
                        return { label: '~', className: 'simple', aria: 'Simple lyrics (text only) - tap to view' };
                    }
                    return { label: '\u00b7', className: '', aria: 'Get lyrics' };
                }
            };
            PlayerPlaylist.install(harness);
            harness.playVideo = item => harness.playedIds.push(item.id);
            const body = document.getElementById('playlistBody');
            body.innerHTML = '';
            const timed = {
                id: 701, videoId: 'v-sync', name: 'Sync Song', artist: 'A', year: '', album: '',
                title: 'Sync Song', channelTitle: 'A', duration: '1:00', comment: '', searchTerm: '',
                lyricsStatus: 'ready', lyricsData: { syncedLines: [{ time: 1, text: 'hi' }], plainLyrics: '' }
            };
            const simple = {
                id: 702, videoId: 'v-text', name: 'Text Song', artist: 'B', year: '', album: '',
                title: 'Text Song', channelTitle: 'B', duration: '1:00', comment: '', searchTerm: '',
                lyricsStatus: 'ready', lyricsData: { syncedLines: [], plainLyrics: 'hi' }
            };
            harness.addPlaylistItemToDOM(timed);
            harness.addPlaylistItemToDOM(simple);
            const row1 = document.querySelector('.playlist-row[data-item-id="701"]');
            const leading = row1.querySelector('.playlist-row-leading');
            leading.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const afterLeading = harness.playedIds.slice();
            row1.querySelector('.playlist-song-name').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const afterName = harness.playedIds.slice();
            const markers = Array.from(body.querySelectorAll('.lyrics-row-btn')).map(btn => btn.textContent);
            body.innerHTML = '';
            return { afterLeading, afterName, markers };
        });
        report.check('player star gutter taps do not play; row body does',
            starGutterAndMarkers.afterLeading.length === 0
            && starGutterAndMarkers.afterName.length === 1
            && starGutterAndMarkers.afterName[0] === 701);
        report.check('player lyric markers are check for timed and tilde for simple',
            starGutterAndMarkers.markers.includes('\u2713')
            && starGutterAndMarkers.markers.includes('~'));

        const lyricsStoreChecks = await tab.evaluate(async () => {
            const run = Date.now();
            const makeHarness = (favorites = {}) => {
                const harness = {
                    playlist: [],
                    favorites,
                    youtubeAlternateResults: new Map(),
                    lyricsLookupCache: new Map(),
                    lyricsFetchQueue: [],
                    lyricsFetchActive: 0,
                    lyricsLookupsInFlight: new Map(),
                    currentLyricsItemId: null,
                    currentLyricsLineIndex: -1,
                    lyricsPanelVisible: false,
                    lyricsPanelDismissed: false,
                    nowPlayingShowsLyric: false,
                    settings: { lyricsOnNowPlaying: false },
                    isFavorite() { return false; },
                    escapeHtml(value) { return String(value || ''); },
                    truncateForStatus(value) { return String(value || ''); },
                    addMessage() {},
                    updateStatus() {},
                    persistPlaylist() {},
                    updatePlaylistLabel() {},
                    showPlaylistSurfaces() {}
                };
                PlayerPlaylist.install(harness);
                PlayerLyrics.install(harness);
                harness.addPlaylistItemToDOM = () => {};
                harness.lookups = 0;
                harness.inFlight = 0;
                harness.maxInFlight = 0;
                harness.lookupLyrics = async (item) => {
                    harness.lookups++;
                    harness.inFlight++;
                    harness.maxInFlight = Math.max(harness.maxInFlight, harness.inFlight);
                    await new Promise(resolve => setTimeout(resolve, 30));
                    harness.inFlight--;
                    if (item.name.startsWith('Missing')) return null;
                    return {
                        provider: 'LRCLIB', trackName: item.name, artistName: item.artist,
                        albumName: '', duration: 100, instrumental: false,
                        plainLyrics: 'la la', syncedLyrics: null, syncedLines: []
                    };
                };
                return harness;
            };
            const makeItem = (name) => PlayerSongs.createPlaylistItem({
                videoId: `lyr-${run}-${name.replace(/\s+/g, '-')}`,
                name, artist: 'Queue Artist', duration: '1:40', durationSeconds: 100,
                searchTerm: `Queue Artist ${name}`
            }, { sourceKind: 'search', sourceLabel: 'test' });
            const drain = async (harness) => {
                for (let i = 0; i < 200; i++) {
                    if (harness.lyricsFetchActive === 0 && harness.lyricsFetchQueue.length === 0
                        && harness.lyricsLookupsInFlight.size === 0
                        && harness.playlist.every(item => item.lyricsStatus !== 'idle' && item.lyricsStatus !== 'loading')) {
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                return false;
            };

            // Session 1: six songs added at once resolve through the bounded
            // queue; each answer is saved to the permanent store (IndexedDB
            // lyricStates) as it arrives.
            const first = makeHarness();
            ['Song One', 'Song Two', 'Song Three', 'Song Four', 'Song Five', 'Missing Song']
                .forEach(name => first.appendPlaylistItem(makeItem(name)));
            const firstSettled = await drain(first);
            const missingState = await PlayerHistoryDB.getLyricState(`lyr-${run}-Missing-Song`);
            const foundState = await PlayerHistoryDB.getLyricState(`lyr-${run}-Song-One`);
            const storedPerSong = !!missingState && missingState.status === 'none'
                && !!foundState && foundState.status === 'found'
                && !!foundState.lyrics && foundState.lyrics.plainLyrics === 'la la';

            // Session 2 (interrupted-then-reopened): fresh page state, same
            // permanent store. Resolved songs settle from the store with
            // ZERO provider lookups; only the never-seen song hits it.
            const second = makeHarness();
            second.appendPlaylistItem(makeItem('Song One'));
            second.appendPlaylistItem(makeItem('Missing Song'));
            await drain(second);
            const resumedFromStore = second.playlist[0].lyricsStatus === 'ready'
                && !!second.playlist[0].lyricsData
                && second.playlist[1].lyricsStatus === 'not_found'
                && second.lookups === 0;
            second.appendPlaylistItem(makeItem('Song Never Seen'));
            const secondSettled = await drain(second);
            const newSongLookups = second.lookups;

            // Tapping the chip on a stored "none" forces a provider recheck.
            const missingItem = second.playlist[1];
            await second.showLyricsForItem(missingItem);
            const chipRetried = second.lookups === 2 && missingItem.lyricsStatus === 'not_found';
            second.setLyricsPanelVisible(false);

            return {
                firstSettled,
                maxInFlight: first.maxInFlight,
                firstLookups: first.lookups,
                storedPerSong,
                resumedFromStore,
                secondSettled,
                newSongLookups,
                chipRetried
            };
        });
        report.check(`player lyric queue is bounded and resumes from the store after reload (max in-flight ${lyricsStoreChecks.maxInFlight}, resume lookups ${lyricsStoreChecks.newSongLookups})`,
            lyricsStoreChecks.firstSettled
            && lyricsStoreChecks.maxInFlight === 2
            && lyricsStoreChecks.firstLookups === 6
            && lyricsStoreChecks.storedPerSong
            && lyricsStoreChecks.resumedFromStore
            && lyricsStoreChecks.secondSettled
            && lyricsStoreChecks.newSongLookups === 1
            && lyricsStoreChecks.chipRetried);

        const lyricsIntegrityChecks = await tab.evaluate(async () => {
            const run = Date.now();
            const makeHarness = (favorites = {}) => {
                const harness = {
                    playlist: [],
                    favorites,
                    youtubeAlternateResults: new Map(),
                    lyricsLookupCache: new Map(),
                    lyricsFetchQueue: [],
                    lyricsFetchActive: 0,
                    lyricsLookupsInFlight: new Map(),
                    currentLyricsItemId: null,
                    currentLyricsLineIndex: -1,
                    lyricsPanelVisible: false,
                    lyricsPanelDismissed: false,
                    nowPlayingShowsLyric: false,
                    settings: { lyricsOnNowPlaying: false },
                    isFavorite() { return false; },
                    escapeHtml(value) { return String(value || ''); },
                    truncateForStatus(value) { return String(value || ''); },
                    addMessage() {},
                    updateStatus() {},
                    persistPlaylist() {},
                    updatePlaylistLabel() {},
                    showPlaylistSurfaces() {}
                };
                PlayerPlaylist.install(harness);
                PlayerLyrics.install(harness);
                harness.addPlaylistItemToDOM = () => {};
                return harness;
            };
            const makeItem = (name) => PlayerSongs.createPlaylistItem({
                videoId: `int-${run}-${name.replace(/\s+/g, '-')}`,
                name, artist: 'Integrity Artist', duration: '1:40', durationSeconds: 100,
                searchTerm: `Integrity Artist ${name}`
            }, { sourceKind: 'search', sourceLabel: 'test' });
            const drain = async (harness) => {
                for (let i = 0; i < 200; i++) {
                    if (harness.lyricsFetchActive === 0 && harness.lyricsFetchQueue.length === 0
                        && harness.lyricsLookupsInFlight.size === 0) return true;
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                return false;
            };

            // Provider FAILURE saves nothing and lands in 'error' (retried
            // on next use); an ANSWERED empty saves a durable 'none'.
            const failing = makeHarness();
            failing.searchLyricsProvider = async () => { throw new Error('HTTP 429'); };
            const failedItem = makeItem('Rate Limited Song');
            failing.playlist.push(failedItem);
            await failing.ensureLyricsForItem(failedItem);
            const failedState = await PlayerHistoryDB.getLyricState(failedItem.videoId);
            const failureIsError = failedItem.lyricsStatus === 'error' && failedState === null;
            failing.searchLyricsProvider = async () => [];
            failing.lyricsLookupCache.clear();
            const emptyItem = makeItem('Truly Missing Song');
            failing.playlist.push(emptyItem);
            await failing.ensureLyricsForItem(emptyItem);
            const emptyState = await PlayerHistoryDB.getLyricState(emptyItem.videoId);
            const answeredEmptyIsNone = emptyItem.lyricsStatus === 'not_found'
                && !!emptyState && emptyState.status === 'none';

            // Save-then-activate: at the moment the store write happens the
            // live item must NOT yet be activated (status still 'loading').
            const ordering = makeHarness();
            ordering.lookupLyrics = async (item) => ({
                provider: 'LRCLIB', trackName: item.name, artistName: item.artist,
                albumName: '', duration: 100, instrumental: false,
                plainLyrics: 'order', syncedLyrics: null, syncedLines: []
            });
            const orderedItem = makeItem('Ordering Song');
            ordering.playlist.push(orderedItem);
            const realPut = PlayerHistoryDB.putLyricState;
            let statusAtSaveTime = '';
            PlayerHistoryDB.putLyricState = async (record) => {
                statusAtSaveTime = orderedItem.lyricsStatus;
                return realPut(record);
            };
            await ordering.ensureLyricsForItem(orderedItem);
            PlayerHistoryDB.putLyricState = realPut;
            const savedBeforeActivated = statusAtSaveTime === 'loading'
                && orderedItem.lyricsStatus === 'ready';

            // Reconcile is per song against the store: first pass resolves
            // both favorites at the provider; a later pass with one new
            // favorite looks up exactly that one.
            const fav = (name) => ({
                videoId: `int-${run}-fav-${name}`,
                name: `Favorite ${name}`, artist: 'Integrity Artist',
                duration: '1:40', durationSeconds: 100, searchTerm: name
            });
            const reconcile = makeHarness({ a: fav('A'), b: fav('B') });
            reconcile.lookups = 0;
            reconcile.lookupLyrics = async (item) => {
                reconcile.lookups++;
                await new Promise(resolve => setTimeout(resolve, 20));
                return {
                    provider: 'LRCLIB', trackName: item.name, artistName: item.artist,
                    albumName: '', duration: 100, instrumental: false,
                    plainLyrics: 'la', syncedLyrics: null, syncedLines: []
                };
            };
            reconcile.reconcileLibraryLyrics();
            await drain(reconcile);
            const firstPassLookups = reconcile.lookups;
            const nextLoad = makeHarness({ a: fav('A'), b: fav('B'), c: fav('C') });
            nextLoad.lookups = 0;
            nextLoad.lookupLyrics = reconcile.lookupLyrics;
            nextLoad.reconcileLibraryLyrics();
            await drain(nextLoad);
            const secondPassLookups = reconcile.lookups - firstPassLookups;

            return { failureIsError, answeredEmptyIsNone, savedBeforeActivated, firstPassLookups, secondPassLookups };
        });
        report.check(`player lyric store integrity: failures unsaved, save-before-activate, per-song reconcile (${lyricsIntegrityChecks.firstPassLookups}+${lyricsIntegrityChecks.secondPassLookups} lookups)`,
            lyricsIntegrityChecks.failureIsError
            && lyricsIntegrityChecks.answeredEmptyIsNone
            && lyricsIntegrityChecks.savedBeforeActivated
            && lyricsIntegrityChecks.firstPassLookups === 2
            && lyricsIntegrityChecks.secondPassLookups === 1);

        // Live playlist filter: as-you-type hides non-matching rows, the
        // status line names the query and counts, Cancel restores all.
        // Timed only hides rows without synced lyrics. Song notes are a
        // CSS display toggle on the container.
        const playlistFilterAndNotes = await tab.evaluate(() => {
            const harness = {
                favorites: {},
                playlist: [],
                settings: { showSongNotes: false, playlistTimedOnly: false },
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                lyricsRowMarker() { return { label: '\u00b7', className: '', aria: 'Get lyrics' }; },
                saveSettings() {}
            };
            PlayerPlaylist.install(harness);
            const body = document.getElementById('playlistBody');
            const container = document.getElementById('playlistContainer');
            const savedDisplay = container.style.display;
            container.style.display = 'block';
            body.innerHTML = '';
            const items = [
                {
                    id: 601, videoId: 'v-sunset', name: 'Sunset Drive', artist: 'Evening Band', year: '1984', album: '',
                    title: 'Sunset Drive', channelTitle: 'Evening Band', duration: '3:00', comment: 'A sunset note',
                    searchTerm: 'Evening Band Sunset Drive',
                    lyricsStatus: 'ready',
                    lyricsData: { syncedLines: [{ time: 12, text: 'sunset line' }], plainLyrics: '' }
                },
                {
                    id: 602, videoId: 'v-morning', name: 'Morning Run', artist: 'Dawn Crew', year: '2001', album: '',
                    title: 'Morning Run', channelTitle: 'Dawn Crew', duration: '2:30', comment: 'A morning note',
                    searchTerm: 'Dawn Crew Morning Run',
                    lyricsStatus: 'ready',
                    lyricsData: { syncedLines: [], plainLyrics: 'simple only' }
                }
            ];
            for (const item of items) {
                harness.playlist.push(item);
                harness.addPlaylistItemToDOM(item);
            }

            const rowHidden = id => document.querySelector(`.playlist-row[data-item-id="${id}"]`).hidden;
            const status = document.getElementById('playlistFilterStatus');
            const statusText = document.getElementById('playlistFilterStatusText');

            harness.setPlaylistFilter('sunset');
            const filtered = {
                sunsetShown: !rowHidden(601),
                morningHidden: rowHidden(602),
                statusVisible: status.style.display !== 'none',
                statusText: statusText.textContent
            };
            // Year matching too: "1984" should match the sunset song only
            harness.setPlaylistFilter('1984');
            const yearFiltered = { sunsetShown: !rowHidden(601), morningHidden: rowHidden(602) };

            harness.clearPlaylistFilter();
            harness.settings.playlistTimedOnly = true;
            harness.applyPlaylistFilter();
            const timedOnly = {
                sunsetShown: !rowHidden(601),
                morningHidden: rowHidden(602),
                statusVisible: status.style.display !== 'none',
                statusText: statusText.textContent
            };

            harness.clearPlaylistFilter();
            const cancelled = {
                bothShown: !rowHidden(601) && !rowHidden(602),
                statusHidden: status.style.display === 'none',
                timedOnlyOff: harness.settings.playlistTimedOnly === false
            };

            // Notes toggle: comments hidden by default, instantly shown by class
            const comment = body.querySelector('.playlist-song-comment');
            const hiddenByDefault = getComputedStyle(comment).display === 'none';
            harness.settings.showSongNotes = true;
            harness.applySongNotesVisibility();
            const shownWhenOn = getComputedStyle(comment).display !== 'none';
            harness.settings.showSongNotes = false;
            harness.applySongNotesVisibility();
            const hiddenWhenOff = getComputedStyle(comment).display === 'none';

            body.innerHTML = '';
            container.style.display = savedDisplay;
            return { filtered, yearFiltered, timedOnly, cancelled, hiddenByDefault, shownWhenOn, hiddenWhenOff };
        });
        report.check(`player playlist filter live-hides rows ("${playlistFilterAndNotes.filtered.statusText}")`,
            playlistFilterAndNotes.filtered.sunsetShown
            && playlistFilterAndNotes.filtered.morningHidden
            && playlistFilterAndNotes.filtered.statusVisible
            && playlistFilterAndNotes.filtered.statusText.includes('"sunset"')
            && playlistFilterAndNotes.filtered.statusText.includes('1 of 2')
            && playlistFilterAndNotes.yearFiltered.sunsetShown
            && playlistFilterAndNotes.yearFiltered.morningHidden);
        report.check(`player timed-only filter hides non-timed rows ("${playlistFilterAndNotes.timedOnly.statusText}")`,
            playlistFilterAndNotes.timedOnly.sunsetShown
            && playlistFilterAndNotes.timedOnly.morningHidden
            && playlistFilterAndNotes.timedOnly.statusVisible
            && playlistFilterAndNotes.timedOnly.statusText.includes('timed lyrics only'));
        report.check('player playlist filter cancel restores the full list',
            playlistFilterAndNotes.cancelled.bothShown
            && playlistFilterAndNotes.cancelled.statusHidden
            && playlistFilterAndNotes.cancelled.timedOnlyOff);
        report.check('player song notes toggle shows/hides comments instantly',
            playlistFilterAndNotes.hiddenByDefault
            && playlistFilterAndNotes.shownWhenOn
            && playlistFilterAndNotes.hiddenWhenOff);

        const musicHistoryWorkflows = await tab.evaluate(async () => {
            const harness = {
                musicHistoryLookups: [{
                    id: 1,
                    requestText: 'old lookup request',
                    songCount: 2,
                    provider: 'openai',
                    createdAt: '2026-01-01',
                    songList: [{ searchTerm: 'old one' }, { searchTerm: 'old two' }]
                }],
                musicHistorySongs: [{
                    videoId: 'known-video',
                    name: 'Known Song',
                    artist: 'Known Artist',
                    title: 'Known Song',
                    channelTitle: 'Known Artist',
                    duration: '2:00',
                    durationSeconds: 120,
                    searchTerm: 'Known Artist Known Song',
                    sourceKind: 'search',
                    lastSeenAt: '2026-01-02'
                }],
                musicHistorySearches: [{
                    query: 'cached query',
                    queryKey: 'cached query',
                    resultCount: 1,
                    source: 'cache',
                    updatedAt: '2026-01-03',
                    results: [{ videoId: 'cached-video', title: 'Cached Video', channelTitle: 'Cached Channel', duration: 100 }]
                }],
                playlist: [],
                currentPlaylistIndex: -1,
                statuses: [],
                messages: [],
                searchedTerms: [],
                rerunRequest: '',
                escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); },
                truncateForStatus(value) { return String(value || ''); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.statuses.push(message); },
                async searchAndAddToPlaylist(songList) { this.searchedTerms.push(...songList.map(song => song.searchTerm)); },
                async processMusicSearch(requestText) { this.rerunRequest = requestText; },
                appendPlaylistItem(item) { this.playlist.push(item); },
                updatePlaylistLabel() {},
                persistPlaylist() {},
                showPlaylistSurfaces() {}
            };
            PlayerHistoryUI.install(harness);
            harness.refreshMusicHistoryPanel = async () => {};
            harness.renderLookupHistory(harness.musicHistoryLookups);
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            harness.renderSearchCacheHistory(harness.musicHistorySearches);
            const rendered = {
                lookup: document.getElementById('musicLookupHistoryList').textContent,
                song: document.getElementById('musicKnownSongsList').textContent,
                cache: document.getElementById('musicSearchCacheList').textContent
            };
            await harness.loadHistoryLookups([1]);
            await harness.rerunHistoryLookupById(1);
            await harness.loadKnownSongs(['known-video']);
            document.getElementById('musicLookupHistoryList').innerHTML = '';
            document.getElementById('musicKnownSongsList').innerHTML = '';
            document.getElementById('musicSearchCacheList').innerHTML = '';
            return {
                rendered,
                searchedTerms: harness.searchedTerms.join('|'),
                rerunRequest: harness.rerunRequest,
                loadedKnown: harness.playlist[0]?.sourceKind || ''
            };
        });
        report.check('player history UI loads, reruns, and combines stored work',
            musicHistoryWorkflows.rendered.lookup.includes('old lookup request')
            && musicHistoryWorkflows.rendered.song.includes('Known Song')
            && musicHistoryWorkflows.rendered.cache.includes('cached query')
            && musicHistoryWorkflows.searchedTerms === 'old one|old two'
            && musicHistoryWorkflows.rerunRequest === 'old lookup request'
            && musicHistoryWorkflows.loadedKnown === 'history');

        // Known Songs live search: the list filters with the same matcher
        // as the playlist filter, and Load All Shown loads exactly the
        // matching songs into the working playlist.
        const knownSongsSearch = await tab.evaluate(async () => {
            const harness = {
                musicHistoryLookups: [],
                musicHistorySongs: [
                    { videoId: 'v-sunset', name: 'Sunset Boulevard', artist: 'Evening Band', year: '1984', title: 'Sunset Boulevard', channelTitle: 'Evening Band', duration: '3:00', searchTerm: 'Evening Band Sunset Boulevard', sourceKind: 'search', lastSeenAt: '2026-01-02' },
                    { videoId: 'v-morning', name: 'Morning Run', artist: 'Dawn Crew', year: '2001', title: 'Morning Run', channelTitle: 'Dawn Crew', duration: '2:30', searchTerm: 'Dawn Crew Morning Run', sourceKind: 'search', lastSeenAt: '2026-01-03' }
                ],
                musicHistorySearches: [],
                playlist: [],
                knownSongsQuery: '',
                statuses: [],
                messages: [],
                escapeHtml(value) { return String(value || ''); },
                truncateForStatus(value) { return String(value || ''); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.statuses.push(message); },
                hydrateItemLyricsFromCache() {},
                appendPlaylistItem(item) { this.playlist.push(item); },
                updatePlaylistLabel() {},
                persistPlaylist() {},
                showPlaylistSurfaces() {}
            };
            PlayerHistoryUI.install(harness);
            harness.refreshMusicHistoryPanel = async () => {};

            const host = document.getElementById('musicKnownSongsList');
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            const unfilteredRows = host.querySelectorAll('.music-history-item').length;

            harness.knownSongsQuery = 'evening sunset';
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            const filteredText = host.textContent;
            const filteredRows = host.querySelectorAll('.music-history-item').length;

            await harness.loadShownKnownSongs();
            const loadedIds = harness.playlist.map(item => item.videoId).join('|');

            harness.knownSongsQuery = 'no such song anywhere';
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            const emptyMessage = host.textContent;

            host.innerHTML = '';
            return { unfilteredRows, filteredRows, filteredText, loadedIds, emptyMessage };
        });
        report.check(`player known songs search filters and loads shown (loaded: ${knownSongsSearch.loadedIds})`,
            knownSongsSearch.unfilteredRows === 2
            && knownSongsSearch.filteredRows === 1
            && knownSongsSearch.filteredText.includes('Sunset Boulevard')
            && !knownSongsSearch.filteredText.includes('Morning Run')
            && knownSongsSearch.loadedIds === 'v-sunset'
            && knownSongsSearch.emptyMessage.includes('No known songs match'));

        const musicHistoryRefreshOverride = await tab.evaluate(async () => {
            const query = `refresh cache ${Date.now()}`;
            const realFetch = window.fetch;
            window.fetch = async url => {
                if (String(url).includes('proxy.php?q=')) {
                    return new Response(JSON.stringify({
                        results: [{ videoId: 'fresh-video', title: 'Fresh Video', channelTitle: 'Fresh Channel', duration: 111 }],
                        source: 'fresh-source',
                        instance: 'fresh-instance'
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url);
            };
            const harness = {
                statuses: [],
                messages: [],
                updateStatus(message) { this.statuses.push(message); },
                truncateForStatus(value) { return String(value || ''); },
                escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                async refreshMusicHistoryPanel() {}
            };
            PlayerHistoryUI.install(harness);
            await harness.refreshCachedSearchQuery(query);
            window.fetch = realFetch;
            await new Promise(resolve => setTimeout(resolve, 100));
            const cached = await PlayerHistoryDB.getYouTubeSearch(query);
            return {
                videoId: cached?.results?.[0]?.videoId || '',
                source: cached?.source || '',
                refreshedByUser: cached?.refreshedByUser === true
            };
        });
        report.check('player search cache can be force-refreshed from remote',
            musicHistoryRefreshOverride.videoId === 'fresh-video'
            && musicHistoryRefreshOverride.source === 'fresh-source'
            && musicHistoryRefreshOverride.refreshedByUser);

        const aiParsing = await tab.evaluate(async () => {
            const harness = {
                statuses: [],
                messages: [],
                settings: { openaiModel: 'gpt-5.5' },
                updateStatus(message) { this.statuses.push(message); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                logClaudeMessage(text) { this.messages.push({ kind: 'claude', label: 'Claude', text }); }
            };
            PlayerCommands.install(harness);
            const openaiRequest = harness.buildOpenAIRequest('Return []');
            const openaiText = harness.extractOpenAIResponseText({
                output: [{
                    content: [{ type: 'output_text', text: '[{"searchTerm":"test"}]' }]
                }]
            });

            const wrapped = harness.parseAIResponse(JSON.stringify({
                songs: [
                    'The Clash London Calling',
                    { song: 'Cecilia', artist: 'Simon & Garfunkel' },
                    { band: 'The Ventures', comment: 'regional riff band' }
                ]
            }), 'prompt');
            let emptyErrorName = '';
            try {
                harness.parseAIResponse('[]', 'prompt');
            } catch (error) {
                emptyErrorName = error.name;
            }

            const realFetch = window.fetch;
            const fetchUrls = [];
            window.fetch = async url => {
                fetchUrls.push(String(url));
                return new Response(JSON.stringify({
                    url: 'https://example.test/page',
                    requestedUrl: 'https://example.test/page',
                    title: 'Regional riffs',
                    text: 'The page mentions The Clash, London Calling, and The Ventures.',
                    charCount: 67,
                    originalCharCount: 1000,
                    truncated: true
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const prepared = await harness.prepareMusicSearchRequest('all songs in https://example.test/page please');
            const inferred = await harness.prepareMusicSearchRequest('get the songs bands and search terms from the tvtropes regional riffs page');
            const prompt = harness.getMusicSearchPrompt(prepared);
            const longTextPrompts = harness.getMusicSearchPrompts({
                transcript: `Please extract every song. ${'Song line. '.repeat(7000)}`,
                linkedPages: []
            });
            window.fetch = realFetch;

            return {
                urls: harness.extractUrlsFromTranscript('read https://example.test/page, thanks'),
                inferredUrls: harness.inferKnownPageUrls('get tvtropes regional riffs'),
                fetchUrls,
                count: wrapped.songList.length,
                terms: wrapped.songList.map(song => song.searchTerm),
                openaiUrl: openaiRequest.url,
                openaiMaxOutputTokens: openaiRequest.body.max_output_tokens,
                openaiReasoningEffort: openaiRequest.body.reasoning?.effort || '',
                openaiText,
                emptyErrorName,
                linkedTitle: prepared.linkedPages[0]?.title || '',
                inferredTitle: inferred.linkedPages[0]?.title || '',
                prompt,
                longTextPromptCount: longTextPrompts.length,
                longTextPromptHasContinuationNote: longTextPrompts[0].includes('continues in the extraction batches'),
                status: harness.statuses[0] || ''
            };
        });
        report.check('player AI parser accepts wrapped songs and search terms',
            aiParsing.count === 3
            && aiParsing.terms.includes('The Clash London Calling')
            && aiParsing.terms.includes('Simon & Garfunkel Cecilia')
            && aiParsing.terms.includes('The Ventures')
            && aiParsing.openaiUrl.endsWith('/v1/responses')
            && aiParsing.openaiMaxOutputTokens === 16000
            && aiParsing.openaiReasoningEffort === 'low'
            && aiParsing.openaiText.includes('test')
            && aiParsing.emptyErrorName === 'NoSongsFoundError');
        report.check('player URL requests are prepared with linked page text',
            aiParsing.urls[0] === 'https://example.test/page'
            && aiParsing.linkedTitle === 'Regional riffs'
            && aiParsing.status.includes('Reading 1 linked page')
            && aiParsing.prompt.includes('return every distinct music item')
            && aiParsing.prompt.includes('never substitute a different better-known artist')
            && aiParsing.prompt.includes('truncated from 1000 chars')
            && !aiParsing.prompt.includes('5-25')
            && aiParsing.longTextPromptCount > 1
            && aiParsing.longTextPromptHasContinuationNote);
        // A response cut off mid-list by the output token limit must not
        // fail the whole request: every complete song is recovered and the
        // partial trailing object is dropped. Braces/quotes inside values
        // cannot fool the scanner.
        const truncatedRecovery = await tab.evaluate(() => {
            const harness = { messages: [], addMessage(kind, label, text) { this.messages.push({ kind, label, text }); }, logClaudeMessage() {} };
            PlayerCommands.install(harness);
            harness.addMessage = (kind, label, text) => harness.messages.push({ kind, label, text });
            harness.logClaudeMessage = () => {};
            const truncated = `[
                { "name": "Feel It All Around", "artist": "Washed Out", "year": "2009", "album": "Life of Leisure", "comment": "Chillwave with a { brace } and \\"quotes\\" inside", "searchTerm": "Washed Out Feel It All Around" },
                { "name": "Electric Feel", "artist": "MGMT", "year": "2007", "album": "Oracular Spectacular", "comment": "Psych-pop", "searchTerm": "MGMT Electric Feel" },
                { "name": "It Is Not Meant to Be", "artist": "Tame Impala",`;
            const recovered = harness.parseAIResponse(truncated, 'p', { allowEmpty: true, truncated: true });
            let unrecoverableThrew = false;
            try {
                harness.parseAIResponse('complete garbage, no array here', 'p', { allowEmpty: true });
            } catch (error) {
                unrecoverableThrew = error instanceof SyntaxError;
            }
            return {
                count: recovered.songList.length,
                terms: recovered.songList.map(song => song.searchTerm).join('|'),
                recoveryLogged: harness.messages.some(message =>
                    message.label === 'Truncated response recovered' && message.text.includes('Kept 2 complete songs')),
                unrecoverableThrew
            };
        });
        report.check(`player recovers complete songs from a truncated AI response (${truncatedRecovery.count} kept)`,
            truncatedRecovery.count === 2
            && truncatedRecovery.terms === 'Washed Out Feel It All Around|MGMT Electric Feel'
            && truncatedRecovery.recoveryLogged
            && truncatedRecovery.unrecoverableThrew);

        report.check('player infers TV Tropes Regional Riff page without pasted URL',
            aiParsing.inferredUrls[0] === 'https://tvtropes.org/pmwiki/pmwiki.php/Main/RegionalRiff'
            && aiParsing.fetchUrls.some(url => url.includes('RegionalRiff'))
            && aiParsing.inferredTitle === 'Regional riffs');

        const partialPlaylist = await tab.evaluate(async () => {
            const harness = {
                playlist: [],
                youtubeAlternateResults: new Map(),
                currentPlaylistIndex: -1,
                settings: { playlistTimedOnly: false },
                messages: [],
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus() {},
                showTransportBar() {},
                decodeHtml(value) { return value; },
                addPlaylistItemToDOM() {},
                updatePlaylistLabel() {},
                persistPlaylist() {},
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            harness.showTransportBar = () => {};
            harness.addPlaylistItemToDOM = () => {};
            harness.updatePlaylistLabel = () => {};
            harness.persistPlaylist = () => {};
            harness.ensureLyricsForItem = () => Promise.resolve();
            harness.queueLyricsLookup = () => {};
            harness.searchYouTube = query => {
                if (query === 'found song') {
                    return Promise.resolve({
                        videoId: 'abc123',
                        title: 'Found Song',
                        channelTitle: 'Found Artist',
                        duration: '3:00',
                        durationSeconds: 180,
                        alternateVideos: [{
                            videoId: 'alternate-found',
                            title: 'Found Alternate',
                            channelTitle: 'Found Artist',
                            duration: '3:10',
                            durationSeconds: 190
                        }]
                    });
                }
                return Promise.resolve(null);
            };
            const result = await harness.searchAndAddToPlaylist([
                { searchTerm: 'found song', name: 'Found Song', artist: 'Found Artist' },
                { searchTerm: 'missing song', name: 'Missing Song', artist: 'Missing Artist' }
            ]);
            return {
                result,
                playlistLength: harness.playlist.length,
                playlistHasAlternates: Array.isArray(harness.playlist[0]?.alternateVideos),
                cachedAlternate: harness.youtubeAlternateResults.get(harness.playlist[0]?.id)?.[0]?.videoId || '',
                hasErrorLog: harness.messages.some(message => message.kind === 'error'),
                hasNotAddedLog: harness.messages.some(message => message.label.includes('not added'))
            };
        });
        report.check('player partial YouTube misses return counts without error logs',
            partialPlaylist.result.addedCount === 1
            && partialPlaylist.result.skippedCount === 1
            && partialPlaylist.result.attemptedTerms.join('|') === 'found song|missing song'
            && partialPlaylist.result.skippedTerms.join('|') === 'missing song'
            && partialPlaylist.playlistLength === 1
            && partialPlaylist.playlistHasAlternates === false
            && partialPlaylist.cachedAlternate === 'alternate-found'
            && partialPlaylist.hasErrorLog === false
            && partialPlaylist.hasNotAddedLog === true);

        // Replace-on-search keeps the playing song: the old list is only
        // dropped when the first found song is actually added, the current
        // song carries over as entry 0 still playing, and a search that
        // finds nothing leaves the playlist untouched.
        const keepPlayingReplace = await tab.evaluate(async () => {
            const makeHarness = () => {
                const harness = {
                    playlist: [],
                    youtubeAlternateResults: new Map(),
                    lyricsFetchQueue: [],
                    settings: { playlistTimedOnly: false },
                    spoken: []
                };
                PlayerPlaylist.install(harness);
                Object.assign(harness, {
                    addMessage() {},
                    updateStatus() {},
                    showPlaylistSurfaces() {},
                    decodeHtml(value) { return value; },
                    addPlaylistItemToDOM() {},
                    updatePlaylistLabel() {},
                    persistPlaylist() {},
                    queueLyricsLookup() {},
                    renderLyricsStateForItem() {},
                    speakText(text) { this.spoken.push(text); }
                });
                return harness;
            };
            const song = (videoId, name) => PlayerSongs.createPlaylistItem({
                videoId, name, artist: 'Keep Artist', duration: '1:00', durationSeconds: 60, searchTerm: name
            }, { sourceKind: 'search', sourceLabel: 'test' });

            const harness = makeHarness();
            const oldA = song('old-a', 'Old A');
            const oldB = song('old-b', 'Old B');
            harness.playlist.push(oldA, oldB);
            harness.playback.markPlaying(oldB.id);
            harness.currentPlaylistIndex = 1;
            harness.searchYouTube = async () => ({
                videoId: 'new-1', title: 'New One', channelTitle: 'Y', duration: '2:00', durationSeconds: 120
            });
            await harness.searchAndAddToPlaylist(
                [{ searchTerm: 'new one', name: 'New One', artist: 'Y' }],
                { replaceExisting: true }
            );
            const afterReplace = {
                ids: harness.playlist.map(entry => entry.videoId).join('|'),
                cursor: harness.currentPlaylistIndex,
                stillPlaying: harness.isPlaying && harness.currentPlayingId === oldB.id
            };

            // A replace search that finds nothing must not touch the list.
            const untouched = makeHarness();
            untouched.playlist.push(song('keep-1', 'Keep One'));
            untouched.searchYouTube = async () => null;
            await untouched.searchAndAddToPlaylist(
                [{ searchTerm: 'nothing', name: 'Nothing', artist: 'Z' }],
                { replaceExisting: true }
            );
            return {
                afterReplace,
                untouchedIds: untouched.playlist.map(entry => entry.videoId).join('|'),
                unexpectedSpeech: untouched.spoken
            };
        });
        report.check(`player replace keeps the playing song and defers clearing (${keepPlayingReplace.afterReplace.ids})`,
            keepPlayingReplace.afterReplace.ids === 'old-b|new-1'
            && keepPlayingReplace.afterReplace.cursor === 0
            && keepPlayingReplace.afterReplace.stillPlaying === true
            && keepPlayingReplace.untouchedIds === 'keep-1'
            && keepPlayingReplace.unexpectedSpeech.length === 0);

        const boundedSearch = await tab.evaluate(async () => {
            const harness = {
                active: 0,
                maxActive: 0,
                status: '',
                messages: [],
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                async fakeSearchYouTube(query) {
                    this.active++;
                    this.maxActive = Math.max(this.maxActive, this.active);
                    await new Promise(resolve => setTimeout(resolve, 10));
                    this.active--;
                    return { videoId: query, title: query, channelTitle: 'Test', duration: '1:00', durationSeconds: 60 };
                }
            };
            PlayerPlaylist.install(harness);
            harness.searchYouTube = query => harness.fakeSearchYouTube(query);
            const validSongs = Array.from({ length: 9 }, (_, index) => ({
                index,
                song: { searchTerm: `term-${index}` }
            }));
            const incrementalOrder = [];
            const results = await harness.searchSongsWithConcurrency(validSongs, {
                concurrency: 3,
                onResult: result => incrementalOrder.push(result.videoData.videoId)
            });
            return {
                count: results.length,
                order: results.map(result => result.videoData.videoId).join('|'),
                incrementalCount: incrementalOrder.length,
                maxActive: harness.maxActive,
                status: harness.status
            };
        });
        report.check('player searches every YouTube term with bounded concurrency and per-result delivery',
            boundedSearch.count === 9
            && boundedSearch.order === 'term-0|term-1|term-2|term-3|term-4|term-5|term-6|term-7|term-8'
            && boundedSearch.incrementalCount === 9
            && boundedSearch.maxActive <= 3
            && boundedSearch.status.includes('Searched 9/9'));

        const alternateSearchResult = await tab.evaluate(async () => {
            const harness = {
                messages: [],
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); }
            };
            PlayerPlaylist.install(harness);
            const realFetch = window.fetch;
            window.fetch = async () => new Response(JSON.stringify({
                results: [
                    { videoId: 'bad-video', title: 'Bad Result', channelTitle: 'Bad Channel', duration: 100 },
                    { videoId: 'good-video', title: 'Good Result', channelTitle: 'Good Channel', duration: 120 }
                ],
                source: 'test'
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            const result = await harness.searchYouTube('retry song');
            window.fetch = realFetch;
            return {
                first: result.videoId,
                alternate: result.alternateVideos[0]?.videoId || '',
                message: harness.messages.find(message => message.label === 'Found')?.text || ''
            };
        });
        report.check('player stores alternate YouTube results for retry',
            alternateSearchResult.first === 'bad-video'
            && alternateSearchResult.alternate === 'good-video'
            && alternateSearchResult.message.includes('Bad Result'));

        // Studio-version-first ranking: live/cover/remix markers lose to
        // the studio upload unless the request asked for them, and Topic
        // (auto-generated album) uploads win outright. Key-level provider
        // errors are classified for the persistent banner.
        const versionRanking = await tab.evaluate(() => {
            const harness = { addMessage() {} };
            PlayerPlaylist.install(harness);
            PlayerCommands.install(harness);
            const videos = [
                { videoId: 'live-1', title: 'New Slang (Live at KEXP)', channelTitle: 'KEXP', duration: '4:10', durationSeconds: 250 },
                { videoId: 'cover-1', title: 'New Slang - cover by somebody', channelTitle: 'Somebody', duration: '3:50', durationSeconds: 230 },
                { videoId: 'studio-1', title: 'New Slang', channelTitle: 'The Shins - Topic', duration: '3:51', durationSeconds: 231 },
                { videoId: 'video-1', title: 'The Shins - New Slang (Official Music Video)', channelTitle: 'Sub Pop', duration: '3:52', durationSeconds: 232 },
                { videoId: 'full-1', title: 'The Shins - Full Performance', channelTitle: 'KEXP', duration: '40:58', durationSeconds: 2458 }
            ];
            const normal = harness.rankYouTubeResults(videos, { searchTerm: 'The Shins New Slang', artist: 'The Shins', name: 'New Slang' })
                .map(video => video.videoId);
            const liveRequested = harness.rankYouTubeResults(videos, { searchTerm: 'The Shins New Slang live kexp', artist: 'The Shins', name: 'New Slang' })
                .map(video => video.videoId);
            // A marker word inside the song's own name must not read as a
            // version request: "Cover Me Up" wants the studio track.
            const nameCollision = harness.rankYouTubeResults([
                { videoId: 'cmu-live', title: 'Jason Isbell - Cover Me Up | Live From Austin City Limits TV', channelTitle: 'ACL', duration: '5:00', durationSeconds: 300 },
                { videoId: 'cmu-studio', title: 'Cover Me Up', channelTitle: 'Jason Isbell - Topic', duration: '5:20', durationSeconds: 320 }
            ], { searchTerm: 'Jason Isbell Cover Me Up', artist: 'Jason Isbell', name: 'Cover Me Up' }).map(video => video.videoId);
            // A clean-titled recording that names the artist nowhere is
            // probably someone else's version (movie-cast covers).
            const wrongArtist = harness.rankYouTubeResults([
                { videoId: 'castcover-1', title: 'I Want To Hold Your Hand (Tracks On The Tracks Sessions)', channelTitle: 'Himesh Patel', duration: '3:20', durationSeconds: 200 },
                { videoId: 'plain-1', title: 'The Beatles - I Want To Hold Your Hand', channelTitle: 'SomeUploader', duration: '2:25', durationSeconds: 145 }
            ], { searchTerm: 'The Beatles I Want to Hold Your Hand', artist: 'The Beatles', name: 'I Want to Hold Your Hand' }).map(video => video.videoId);
            const quotaError = harness.classifyProviderError('claude', 429, { error: { type: 'rate_limit_error', message: 'Your credit balance is too low' } });
            const plainError = harness.classifyProviderError('openai', 500, { error: { message: 'server exploded' } });
            return {
                normalFirst: normal[0],
                normalLiveLast: normal.indexOf('live-1') > normal.indexOf('studio-1') && normal.indexOf('cover-1') > normal.indexOf('video-1'),
                normalFullSetLast: normal[normal.length - 1] === 'full-1',
                liveRequestedFirstIsLive: liveRequested[0] === 'live-1',
                nameCollisionFirst: nameCollision[0],
                wrongArtistFirst: wrongArtist[0],
                quotaName: quotaError.name,
                quotaProvider: quotaError.provider,
                plainName: plainError.name
            };
        });
        report.check(`player ranks studio versions first (${versionRanking.normalFirst}, name-collision pick ${versionRanking.nameCollisionFirst}, wrong-artist pick ${versionRanking.wrongArtistFirst}) and classifies key-level errors`,
            versionRanking.normalFirst === 'studio-1'
            && versionRanking.normalLiveLast
            && versionRanking.normalFullSetLast
            && versionRanking.liveRequestedFirstIsLive
            && versionRanking.nameCollisionFirst === 'cmu-studio'
            && versionRanking.wrongArtistFirst === 'plain-1'
            && versionRanking.quotaName === 'ApiKeyError'
            && versionRanking.quotaProvider === 'claude'
            && versionRanking.plainName === 'Error');

        const singlePlayerCreation = await tab.evaluate(async () => {
            const harness = {
                players: new Map(),
                playerReadyPromises: new Map(),
                playlist: [],
                favorites: {},
                messages: [],
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                lyricsRowMarker() { return { label: '\u00b7', className: '', aria: 'Get lyrics' }; },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); }
            };
            PlayerPlaylist.install(harness);
            const item = {
                id: 4001,
                videoId: 'lazy-video-id',
                name: 'Lazy Song',
                artist: 'Lazy Artist',
                year: '',
                album: '',
                title: 'Lazy Song',
                channelTitle: 'Lazy Artist',
                duration: '2:00',
                comment: '',
                searchTerm: 'Lazy Artist Lazy Song'
            };
            const realYT = window.YT;
            window.YT = undefined;
            harness.addPlaylistItemToDOM(item);
            const beforeEnsure = {
                hasEntry: harness.playerReadyPromises.has(item.id),
                hasPlayerDiv: !!document.getElementById('active-youtube-player')
            };
            harness.ensurePlaylistPlayer(item);
            const afterEnsure = {
                hasEntry: harness.playerReadyPromises.has(item.id),
                hasPlayerDiv: !!document.getElementById('active-youtube-player')
            };
            await new Promise(resolve => setTimeout(resolve, 80));
            window.youtubeApiReady = [];
            document.querySelector(`[data-item-id="${item.id}"]`)?.remove();
            document.getElementById('active-youtube-player')?.remove();
            window.YT = realYT;
            return { beforeEnsure, afterEnsure };
        });
        report.check('player creates one YouTube iframe on first play',
            singlePlayerCreation.beforeEnsure.hasEntry === false
            && singlePlayerCreation.beforeEnsure.hasPlayerDiv === false
            && singlePlayerCreation.afterEnsure.hasEntry === true
            && singlePlayerCreation.afterEnsure.hasPlayerDiv === true);

        const playerVarsIdentity = await tab.evaluate(() => {
            const calls = [];
            const harness = {
                players: new Map(),
                playerReadyPromises: new Map(),
                addMessage() {}
            };
            PlayerPlaylist.install(harness);
            const realYT = window.YT;
            window.YT = {
                PlayerState: { ENDED: 0 },
                Player: function (id, config) {
                    calls.push({ id, playerVars: config.playerVars });
                    return { destroy() {} };
                }
            };
            const container = document.createElement('div');
            container.id = 'player-identity-container';
            document.getElementById('playlistContainer').appendChild(container);
            const item = {
                id: 4002,
                videoId: 'identity-id',
                name: 'Identity Song',
                artist: 'Identity Artist',
                searchTerm: 'Identity Artist Identity Song'
            };
            harness.createPlaylistPlayer(item);
            return new Promise(resolve => {
                setTimeout(() => {
                    document.getElementById('active-youtube-player')?.remove();
                    container.remove();
                    window.YT = realYT;
                    const playerVars = calls[0]?.playerVars || {};
                    resolve({
                        enablejsapi: playerVars.enablejsapi,
                        playsinline: playerVars.playsinline,
                        originMatches: playerVars.origin === window.location.origin,
                        widgetReferrerMatches: playerVars.widget_referrer === window.location.origin
                    });
                }, 100);
            });
        });
        report.check('player sends YouTube origin and referrer identity',
            playerVarsIdentity.enablejsapi === 1
            && playerVarsIdentity.playsinline === 1
            && playerVarsIdentity.originMatches
            && playerVarsIdentity.widgetReferrerMatches);

        const alternateRetry = await tab.evaluate(async () => {
            const harness = {
                players: new Map(),
                playerReadyPromises: new Map(),
                youtubeAlternateResults: new Map(),
                messages: [],
                status: '',
                settings: { readClaudeResponse: false },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                truncateForStatus(text) { return String(text || ''); },
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            let recreatedVideoId = '';
            let playedVideoId = '';
            let persisted = false;
            harness.recreatePlaylistPlayer = item => { recreatedVideoId = item.videoId; };
            harness.refreshPlaylistRowVideo = () => {};
            harness.persistPlaylist = () => { persisted = true; };
            harness.playVideo = item => { playedVideoId = item.videoId; return Promise.resolve(); };
            const item = {
                id: 45,
                videoId: 'bad-video',
                name: 'Retry Song',
                artist: 'Retry Artist',
                title: 'Bad Result',
                channelTitle: 'Bad Channel',
                duration: '1:40',
                durationSeconds: 100,
                searchTerm: 'Retry Artist Retry Song',
                lyricsStatus: 'idle',
                lyricsData: null
            };
            harness.youtubeAlternateResults.set(item.id, [{
                videoId: 'good-video',
                title: 'Good Result',
                channelTitle: 'Good Channel',
                duration: '2:00',
                durationSeconds: 120
            }]);
            harness.reportPlayerLoadFailure(item, 'YouTube player error 150');
            return {
                videoId: item.videoId,
                title: item.title,
                remaining: harness.youtubeAlternateResults.get(item.id)?.length || 0,
                recreatedVideoId,
                playedVideoId,
                persisted,
                retryReason: harness.messages.find(message => message.label === 'Retrying video result')?.text || '',
                hasRetryLog: harness.messages.some(message => message.label === 'Retrying video result'),
                hasFailureLog: harness.messages.some(message => message.label === 'Player load failed')
            };
        });
        report.check('player retries alternate video before final load failure',
            alternateRetry.videoId === 'good-video'
            && alternateRetry.title === 'Good Result'
            && alternateRetry.remaining === 0
            && alternateRetry.recreatedVideoId === 'good-video'
            && alternateRetry.playedVideoId === 'good-video'
            && alternateRetry.persisted
            && alternateRetry.retryReason.includes('owner disabled embedded playback')
            && alternateRetry.hasRetryLog
            && !alternateRetry.hasFailureLog);

        const nonVideoSpecificNoRetry = await tab.evaluate(async () => {
            const harness = {
                playerReadyPromises: new Map(),
                youtubeAlternateResults: new Map(),
                messages: [],
                status: '',
                settings: { readClaudeResponse: false },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                truncateForStatus(text) { return String(text || ''); },
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            let recreated = false;
            let played = false;
            harness.recreatePlaylistPlayer = () => { recreated = true; };
            harness.refreshPlaylistRowVideo = () => {};
            harness.persistPlaylist = () => {};
            harness.playVideo = () => { played = true; return Promise.resolve(); };
            const item = {
                id: 46,
                videoId: 'slow-video',
                name: 'Slow Song',
                artist: 'Slow Artist',
                title: 'Slow Song',
                channelTitle: 'Slow Artist',
                searchTerm: 'Slow Artist Slow Song',
                lyricsStatus: 'idle',
                lyricsData: null
            };
            harness.youtubeAlternateResults.set(item.id, [{
                videoId: 'other-video',
                title: 'Other Result',
                channelTitle: 'Other Channel',
                duration: '2:00',
                durationSeconds: 120
            }]);
            harness.reportPlayerLoadFailure(item, 'Player did not become ready within 8s');
            return {
                videoId: item.videoId,
                recreated,
                played,
                status: harness.status,
                hasRetryLog: harness.messages.some(message => message.label === 'Retrying video result'),
                hasFailureLog: harness.messages.some(message => message.label === 'Player load failed')
            };
        });
        report.check('player does not retry alternates for non-video-specific timeouts',
            nonVideoSpecificNoRetry.videoId === 'slow-video'
            && !nonVideoSpecificNoRetry.recreated
            && !nonVideoSpecificNoRetry.played
            && nonVideoSpecificNoRetry.status.includes('Player load failed')
            && !nonVideoSpecificNoRetry.hasRetryLog
            && nonVideoSpecificNoRetry.hasFailureLog);

        const playerLoadTimeout = await tab.evaluate(async () => {
            const harness = {
                playerReadyPromises: new Map(),
                messages: [],
                status: '',
                settings: { readClaudeResponse: false },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                truncateForStatus(text, maxLength = 120) {
                    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
                    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
                },
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            const item = {
                id: 44,
                videoId: 'slow-video',
                name: 'Slow Song',
                artist: 'Slow Artist',
                title: 'Slow Song',
                channelTitle: 'Slow Artist',
                searchTerm: 'Slow Artist Slow Song'
            };
            harness.playerReadyPromises.set(item.id, { promise: new Promise(() => {}), resolve() {} });
            const ready = await harness.waitForPlayerReady(item, 5);
            await harness.reportPlayerLoadFailure(item, ready.error);
            const failureLog = harness.messages.find(message => message.label === 'Player load failed');
            return {
                ok: ready.ok,
                status: harness.status,
                text: failureLog?.text || ''
            };
        });
        report.check('player loading timeout exposes track and search term',
            playerLoadTimeout.ok === false
            && playerLoadTimeout.status.includes('Slow Song')
            && playerLoadTimeout.text.includes('slow-video')
            && playerLoadTimeout.text.includes('Slow Artist Slow Song'));

        // Auto mode: spoken control command executes locally
        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        const listeningStatus = await tab.textContent('#status');
        await tab.evaluate(() => window.__emitResult('clear'));
        await tab.waitForTimeout(400);
        const afterClear = await tab.textContent('#status');
        report.check(`player voice control ("${listeningStatus}" -> "${afterClear}")`,
            listeningStatus === 'Listening...' && afterClear === 'Playlist is already empty');

        // Manual mode: segments accumulate, spoken "submit" sends to Claude path
        await tab.click('#settingsBtn');
        await tab.evaluate(() => document.getElementById('autoSubmitMode').click());
        await tab.click('#closeSettingsBtn');
        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        const manualStatus = await tab.textContent('#status');
        await tab.evaluate(() => window.__emitResult('play some jazz'));
        await tab.waitForTimeout(200);
        await tab.evaluate(() => window.__emitResult('submit'));
        await tab.waitForTimeout(600);
        const logged = await tab.evaluate(() =>
            document.getElementById('logContent').textContent.includes('play some jazz'));
        report.check(`player manual mode + spoken submit ("${manualStatus}", request logged: ${logged})`,
            manualStatus.includes('say "submit"') && logged);

        // Android-style cumulative re-delivery (same index re-sent with
        // grown text, marked final each time) must not duplicate anything
        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        await tab.evaluate(() => {
            window.__emitCumulative('there was', true);
            window.__emitCumulative('there was a guy', true);
            window.__emitCumulative('there was a guy I think', true);
        });
        const liveText = await tab.evaluate(() =>
            document.getElementById('transcript').textContent.trim());
        await tab.evaluate(() => window.__emitResult('submit'));
        await tab.waitForTimeout(600);
        const cumulativeLogged = await tab.evaluate(() =>
            document.getElementById('logContent').textContent.includes('there was a guy I think'));
        report.check(`player cumulative re-delivery stays deduped ("${liveText}")`,
            liveText === 'there was a guy I think' && cumulativeLogged);

        // Cross-index cumulative finals (the other Android variant) collapse
        const collapsed = await tab.evaluate(() => {
            const tm = new window.TranscriptManager();
            tm.updateSessionResult(0, 'there was', true);
            tm.updateSessionResult(1, 'there was a guy', true);
            tm.updateSessionResult(2, ' play it', true);
            return tm.getFinalizedText();
        });
        report.check(`transcript collapses cumulative finals across indices ("${collapsed}")`,
            collapsed === 'there was a guy play it');

        // The now-playing title (car / lock screen / tab / header line):
        // song identity for the first seconds, a countdown prefix before
        // a late first lyric line, then the bare lyric led ahead of the
        // sung moment - and outside the identity window, never song or
        // artist. Pause clears the surfaces.
        const lyricRelay = await tab.evaluate(() => {
            const item = {
                id: 77, name: 'Test Song', artist: 'Test Artist', year: '1999', album: 'Test Album',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Test Song', artistName: 'Test Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:12.00]late first line\n[00:15.00]second line here',
                    syncedLines: [
                        { time: 12, text: 'late first line' },
                        { time: 15, text: 'second line here' }
                    ]
                }
            };
            const harness = {
                settings: { lyricsOnNowPlaying: true },
                playlist: [item],
                playback: { player: null },
                currentLyricsItemId: 77,
                currentLyricsLineIndex: -1,
                nowPlayingShowsLyric: false,
                isPlaying: true,
                isPaused: false,
                currentPlayingId: 77,
                currentPlaylistItem() { return item; }
            };
            PlayerLyrics.install(harness);
            const meta = () => navigator.mediaSession.metadata;
            const snap = () => ({
                docTitle: document.title,
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || '',
                metaTitle: meta() ? meta().title : '',
                metaArtist: meta() ? meta().artist : '',
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                highlightIndex: harness.currentLyricsLineIndex
            });
            // 0.5s: the song identity intro - who and what is playing.
            harness.updateSyncedLyricsPosition(0.5);
            const identity = snap();
            // 3s: first line is 9s away (>5s from song start), so the
            // title counts down in front of the upcoming line.
            harness.updateSyncedLyricsPosition(3);
            const countdown = snap();
            // 11.5s: line 1 (at 12s) not sung yet but inside the title
            // lead window - the title runs ahead of the highlight.
            harness.updateSyncedLyricsPosition(11.5);
            const led = snap();
            harness.updateSyncedLyricsPosition(13);
            const during = snap();
            harness.isPaused = true;
            harness.relayLyricToNowPlaying(harness.currentLyricsLineIndex, 13);
            const after = snap();
            harness.updateTransportBarLyric('');
            return { identity, countdown, led, during, after };
        });
        const identityText = 'Test Artist - Test Song - 1999 - Test Album';
        const neverSongArtistPastIntro = [lyricRelay.countdown, lyricRelay.led, lyricRelay.during, lyricRelay.after]
            .every(snap => !snap.metaTitle.includes('Test Song') && !snap.metaArtist.includes('Test Artist')
                && !snap.docTitle.includes('Test Song'));
        report.check(`player titles: identity intro, countdown, then lyric only ("${lyricRelay.identity.metaTitle}" -> "${lyricRelay.countdown.metaTitle}" -> "${lyricRelay.led.metaTitle}", clean past intro: ${neverSongArtistPastIntro})`,
            lyricRelay.identity.metaTitle === identityText
            && lyricRelay.identity.docTitle === identityText
            && lyricRelay.identity.headerTitle === identityText
            && lyricRelay.identity.barLyric === identityText
            && lyricRelay.identity.highlightIndex === -1
            && lyricRelay.countdown.metaTitle === '9 late first line'
            && lyricRelay.countdown.barLyric === '9 late first line'
            && lyricRelay.led.metaTitle === 'late first line'
            && lyricRelay.led.docTitle === 'late first line'
            && lyricRelay.led.headerTitle === 'late first line'
            && lyricRelay.led.highlightIndex === -1
            && lyricRelay.during.metaTitle === 'late first line'
            && lyricRelay.during.barLyric === 'late first line'
            && lyricRelay.during.highlightIndex === 0
            && lyricRelay.after.metaTitle === ''
            && lyricRelay.after.docTitle !== 'late first line'
            && lyricRelay.after.headerTitle === 'Music'
            && neverSongArtistPastIntro);
        // Car/title relay follows the sounding track even when the lyrics
        // panel is focused on a different row (chip tap must not freeze
        // the Bluetooth/header lyric line).
        const lyricRelayIgnoresPanelFocus = await tab.evaluate(() => {
            const playing = {
                id: 11, name: 'Playing Song', artist: 'Playing Artist',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Playing Song', artistName: 'Playing Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:03.00]playing line one\n[00:08.00]playing line two',
                    syncedLines: [
                        { time: 3, text: 'playing line one' },
                        { time: 8, text: 'playing line two' }
                    ]
                }
            };
            const other = {
                id: 22, name: 'Other Song', artist: 'Other Artist',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Other Song', artistName: 'Other Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:01.00]other line',
                    syncedLines: [{ time: 1, text: 'other line' }]
                }
            };
            const harness = {
                settings: { lyricsOnNowPlaying: true },
                playlist: [playing, other],
                playback: { player: null },
                currentLyricsItemId: other.id,
                currentLyricsLineIndex: -1,
                nowPlayingShowsLyric: false,
                isPlaying: true,
                isPaused: false,
                currentPlayingId: playing.id,
                currentPlaylistItem() { return playing; }
            };
            PlayerLyrics.install(harness);
            harness.updateSyncedLyricsPosition(4);
            return {
                metaTitle: navigator.mediaSession.metadata?.title || '',
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || '',
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                panelFocusId: harness.currentLyricsItemId
            };
        });
        report.check(`player car/title relay follows playing song while panel shows another ("${lyricRelayIgnoresPanelFocus.metaTitle}")`,
            lyricRelayIgnoresPanelFocus.metaTitle === 'playing line one'
            && lyricRelayIgnoresPanelFocus.headerTitle === 'playing line one'
            && lyricRelayIgnoresPanelFocus.barLyric === 'playing line one'
            && lyricRelayIgnoresPanelFocus.panelFocusId === 22);
        // Per-song lyric offset: ff/rew lyrics nudge the display clock and
        // persist forever on the lyricStates record for that videoId.
        const lyricOffsetNudge = await tab.evaluate(async () => {
            const videoId = `offset-nudge-${Date.now()}`;
            const item = {
                id: 88, videoId, name: 'Offset Song', artist: 'Offset Artist',
                lyricsStatus: 'ready',
                lyricOffsetSeconds: 0,
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Offset Song', artistName: 'Offset Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:05.00]early line\n[00:15.00]later line',
                    syncedLines: [
                        { time: 5, text: 'early line' },
                        { time: 15, text: 'later line' }
                    ]
                }
            };
            await window.PlayerHistoryDB.putLyricState({
                videoId,
                status: 'found',
                checkedAt: Date.now(),
                searchVersion: 2,
                lyrics: item.lyricsData
            });
            const harness = {
                settings: { lyricsOnNowPlaying: true },
                playlist: [item],
                playback: { player: null },
                currentLyricsItemId: item.id,
                currentLyricsLineIndex: -1,
                nowPlayingShowsLyric: false,
                isPlaying: true,
                isPaused: false,
                currentPlayingId: item.id,
                currentPlaylistItem() { return item; },
                itemHasTimedLyrics(candidate) {
                    return !!(candidate && candidate.lyricsData && candidate.lyricsData.syncedLines
                        && candidate.lyricsData.syncedLines.length > 0);
                },
                resyncProgressClock() {}
            };
            PlayerLyrics.install(harness);
            harness.updateSyncedLyricsPosition(10);
            harness.updateLyricOffsetStatus();
            const before = {
                highlightIndex: harness.currentLyricsLineIndex,
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                offset: item.lyricOffsetSeconds,
                offsetStatus: document.getElementById('transportLyricOffsetStatus')?.textContent || ''
            };
            await harness.nudgeLyricOffset(5);
            harness.updateSyncedLyricsPosition(10);
            const afterFf = {
                highlightIndex: harness.currentLyricsLineIndex,
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                offset: item.lyricOffsetSeconds,
                offsetStatus: document.getElementById('transportLyricOffsetStatus')?.textContent || ''
            };
            await harness.nudgeLyricOffset(-10);
            harness.updateSyncedLyricsPosition(10);
            const afterRew = {
                highlightIndex: harness.currentLyricsLineIndex,
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                offset: item.lyricOffsetSeconds,
                offsetStatus: document.getElementById('transportLyricOffsetStatus')?.textContent || ''
            };
            const stored = await window.PlayerHistoryDB.getLyricState(videoId);
            const reloaded = {
                id: 99, videoId, name: 'Offset Song', artist: 'Offset Artist',
                lyricsStatus: 'idle', lyricsData: null, lyricOffsetSeconds: 0
            };
            harness.applyLyricStateToItem(reloaded, stored);
            harness.playlist = [reloaded];
            harness.currentPlayingId = reloaded.id;
            harness.currentLyricsItemId = reloaded.id;
            harness.updateLyricOffsetStatus();
            return {
                before, afterFf, afterRew,
                storedOffset: stored?.lyricOffsetSeconds,
                reloadedOffset: reloaded.lyricOffsetSeconds,
                reloadedOffsetStatus: document.getElementById('transportLyricOffsetStatus')?.textContent || '',
                deadlineAtZero: harness.nextLyricDeadline(0)
            };
        });
        report.check(`player lyric offset ff/rew nudges display and persists (ff=${lyricOffsetNudge.afterFf.offset}, rew=${lyricOffsetNudge.afterRew.offset}, stored=${lyricOffsetNudge.storedOffset})`,
            lyricOffsetNudge.before.highlightIndex === 0
            && lyricOffsetNudge.before.barLyric === 'early line'
            && lyricOffsetNudge.before.offset === 0
            && lyricOffsetNudge.before.offsetStatus === 'change 0s · total 0s'
            && lyricOffsetNudge.afterFf.highlightIndex === 1
            && lyricOffsetNudge.afterFf.barLyric === 'later line'
            && lyricOffsetNudge.afterFf.offset === 5
            && lyricOffsetNudge.afterFf.offsetStatus === 'change +5s · total +5s'
            && lyricOffsetNudge.afterRew.highlightIndex === 0
            && lyricOffsetNudge.afterRew.barLyric === 'early line'
            && lyricOffsetNudge.afterRew.offset === -5
            && lyricOffsetNudge.afterRew.offsetStatus === 'change -10s · total -5s'
            && lyricOffsetNudge.storedOffset === -5
            && lyricOffsetNudge.reloadedOffset === -5
            && lyricOffsetNudge.reloadedOffsetStatus === 'change 0s · total -5s'
            // With offset -5, first line (file t=5) appears at wall-clock 10;
            // led window opens 0.75s earlier at 9.25.
            && lyricOffsetNudge.deadlineAtZero === 9.25);
        // Deadline clock, not polling: the progress/lyric renderer sleeps
        // until the next known media-time boundary (whole display second
        // or lyric moment) instead of ticking every 100ms, and the lyric
        // transition still lands on time.
        const deadlineClock = await tab.evaluate(async () => {
            const c = window.musicController;
            if (!c) return { error: 'no controller' };
            const item = {
                id: 553, videoId: 'clock', name: 'Clock Song', artist: 'Clock Artist',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Clock Song', artistName: 'Clock Artist',
                    albumName: '', duration: 120, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:05.00]clock line one\n[00:09.00]clock line two',
                    syncedLines: [
                        { time: 5, text: 'clock line one' },
                        { time: 9, text: 'clock line two' }
                    ]
                }
            };
            c.playlist.push(item);
            c.currentLyricsItemId = item.id;
            c.playback.setActiveMedia(item.id, item.videoId);
            c.playback.markPlaying(item.id);

            const deadlines = {
                fromZero: c.nextLyricDeadline(0),
                beforeFirst: c.nextLyricDeadline(4.5),
                betweenLines: c.nextLyricDeadline(6),
                afterLast: c.nextLyricDeadline(9.5)
            };

            // Fake player whose clock advances like real playback.
            let reads = 0;
            let mediaStart = 0.2;
            let wallStart = performance.now();
            const fakePlayer = {
                getCurrentTime() { reads++; return mediaStart + (performance.now() - wallStart) / 1000; },
                getDuration() { return 120; }
            };
            c.playback.markPlayerReady(fakePlayer);

            // Mid-second, far from any lyric: one initial render, then the
            // clock sleeps to the next second boundary (0.8s away) - a
            // 100ms poll would have read the time ~7 times in 650ms.
            c.startProgressUpdates();
            reads = 0;
            await new Promise(resolve => setTimeout(resolve, 650));
            const idleReads = reads;

            // Jump to just before the first line's led window (4.25s):
            // the transition must land without any polling cadence.
            mediaStart = 4.1;
            wallStart = performance.now();
            c.resyncProgressClock();
            await new Promise(resolve => setTimeout(resolve, 450));
            const titleAfterLead = navigator.mediaSession.metadata?.title || '';

            c.stopProgressUpdates();
            c.playback.reset();
            c.currentLyricsItemId = null;
            c.relayLyricToNowPlaying(-1);
            c.playlist.pop();
            return { deadlines, idleReads, titleAfterLead };
        });
        report.check(`player progress clock sleeps to deadlines (idle reads ${deadlineClock.idleReads}, lead title "${deadlineClock.titleAfterLead}")`,
            !deadlineClock.error
            && deadlineClock.deadlines.fromZero === 4.25
            && deadlineClock.deadlines.beforeFirst === 5
            && deadlineClock.deadlines.betweenLines === 8.25
            && deadlineClock.deadlines.afterLast === Infinity
            && deadlineClock.idleReads <= 2
            && deadlineClock.titleAfterLead === 'clock line one');

        // Save-then-activate under a failing store write: the live item is
        // never activated with lyrics the permanent store does not hold
        // (that session-only state was the "L shows but reload loses it"
        // class). The song stays unresolved and heals on the next attempt.
        const storeWriteFailure = await tab.evaluate(async () => {
            const item = PlayerSongs.createPlaylistItem({
                videoId: `store-fail-${Date.now()}`,
                name: 'Store Fail Song', artist: 'Store Artist',
                duration: '1:30', durationSeconds: 90, searchTerm: 'x'
            }, { sourceKind: 'search', sourceLabel: 'test' });
            const harness = {
                settings: { lyricsOnNowPlaying: true },
                playlist: [item],
                currentLyricsItemId: null,
                currentLyricsLineIndex: -1,
                nowPlayingShowsLyric: false,
                isPlaying: false,
                isPaused: false,
                currentPlayingId: null,
                lyricsLookupCache: new Map(),
                lyricsFetchQueue: [],
                lyricsFetchActive: 0,
                lyricsLookupsInFlight: new Map(),
                currentPlaylistItem() { return item; },
                refreshLyricsRowButton() {},
                resyncProgressClock() {},
                renderLyricsStateForItem() {},
                describePlaylistItem() { return 'Store Fail Song'; },
                parseDurationToSeconds() { return 90; },
                addMessage() {}
            };
            PlayerLyrics.install(harness);
            harness.lookupLyrics = async () => ({
                provider: 'LRCLIB', trackName: 'Store Fail Song', artistName: 'Store Artist',
                albumName: '', duration: 90, instrumental: false, plainLyrics: 'la la',
                syncedLyrics: '[00:01.00]la la', syncedLines: [{ time: 1, text: 'la la' }]
            });
            const realPut = PlayerHistoryDB.putLyricState;
            PlayerHistoryDB.putLyricState = async () => { throw new Error('IndexedDB write failed (simulated)'); };
            await harness.ensureLyricsForItem(item);
            const afterFailure = {
                status: item.lyricsStatus,
                hasData: !!item.lyricsData,
                stored: await PlayerHistoryDB.getLyricState(item.videoId)
            };
            PlayerHistoryDB.putLyricState = realPut;
            await harness.ensureLyricsForItem(item);
            const afterRetry = {
                status: item.lyricsStatus,
                storedStatus: (await PlayerHistoryDB.getLyricState(item.videoId))?.status || 'absent'
            };
            return { afterFailure, afterRetry };
        });
        report.check(`player store write failure leaves song unresolved, retry heals (then ${storeWriteFailure.afterRetry.status})`,
            storeWriteFailure.afterFailure.status === 'error'
            && storeWriteFailure.afterFailure.hasData === false
            && storeWriteFailure.afterFailure.stored === null
            && storeWriteFailure.afterRetry.status === 'ready'
            && storeWriteFailure.afterRetry.storedStatus === 'found');

        // Imported library songs (bulky note arrays) live in IndexedDB;
        // hydration migrates anything stranded in the legacy localStorage
        // blob and leaves that blob empty.
        const songLibraryMigration = await tab.evaluate(async () => {
            const legacySong = {
                id: 'song_test_migrate', title: 'Migrate Me', sourceType: 'midi',
                sourceName: 'migrate.mid', importedAt: Date.now(), favorite: false,
                tempoBpm: 120, durationMs: 2000, noteCount: 2, lyricsText: '',
                lyricLines: [],
                notes: [
                    { midi: 60, startMs: 0, endMs: 500 },
                    { midi: 64, startMs: 500, endMs: 1000 }
                ]
            };
            PlayerStorage.saveSongLibrary({ songs: [legacySong] });
            const harness = {
                songLibrary: { songs: [] },
                addMessage() {}
            };
            PlayerSongLibrary.install(harness);
            harness.renderSongLibrary = () => {}; // display is not under test
            await harness.hydrateSongLibrary();
            const inIdb = (await PlayerHistoryDB.listLibrarySongs())
                .some(song => song.id === 'song_test_migrate');
            const blob = SettingsStore.peekData(StorageKeys.PLAYER_SONG_LIBRARY);
            const blobEmpty = !blob || !blob.songs || blob.songs.length === 0;
            const inMemory = harness.songLibrary.songs.some(song => song.id === 'song_test_migrate');
            return { inIdb, blobEmpty, inMemory };
        });
        report.check(`player imported songs migrate to IndexedDB (idb: ${songLibraryMigration.inIdb}, blob empty: ${songLibraryMigration.blobEmpty})`,
            songLibraryMigration.inIdb && songLibraryMigration.blobEmpty && songLibraryMigration.inMemory);

        // Minimal display communication: identical repeat writes to the
        // now-playing surfaces are dropped at the core - one metadata
        // construction per distinct title, none for repeats.
        const minimalWrites = await tab.evaluate(() => {
            const RealMediaMetadata = window.MediaMetadata;
            let constructions = 0;
            // @ts-ignore - counting wrapper
            window.MediaMetadata = function (init) { constructions++; return new RealMediaMetadata(init); };
            MediaSessionCore.setNowPlayingTitle('repeat line', { artist: '' });
            for (let i = 0; i < 5; i++) MediaSessionCore.setNowPlayingTitle('repeat line', { artist: '' });
            const afterRepeats = constructions;
            MediaSessionCore.setNowPlayingTitle('changed line', { artist: '' });
            const afterChange = constructions;
            for (let i = 0; i < 5; i++) MediaSessionCore.setPlaybackState('paused');
            window.MediaMetadata = RealMediaMetadata;
            MediaSessionCore.clearNowPlayingTitle();
            return { afterRepeats, afterChange, state: navigator.mediaSession.playbackState };
        });
        report.check(`player now-playing writes are deduped (${minimalWrites.afterRepeats} write for 6 same, ${minimalWrites.afterChange} after change)`,
            minimalWrites.afterRepeats === 1
            && minimalWrites.afterChange === 2
            && minimalWrites.state === 'paused');

        playerVoiceErrors
            .filter(e => !e.includes('offline test'))
            .forEach(e => report.errors.push(e));
        await ctx.close();
    }

    // ============ PLAYER: API key gating + settings panel ============
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'player', report.errors);
        await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        const overlayShown = await tab.evaluate(() => {
            const overlay = document.getElementById('apiKeyOverlay');
            return overlay && getComputedStyle(overlay).display !== 'none';
        });
        report.check('player gates on missing API key', overlayShown === true);

        await tab.evaluate(() => localStorage.setItem('claudeApiKey', 'test-key-not-real-1234567890'));
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        const overlayGone = await tab.evaluate(() => {
            const overlay = document.getElementById('apiKeyOverlay');
            return !overlay || getComputedStyle(overlay).display === 'none';
        });
        await tab.click('#settingsBtn');
        await tab.waitForTimeout(400);
        const panelOpen = await tab.evaluate(() =>
            getComputedStyle(document.getElementById('settingsPanel')).display !== 'none');
        await tab.click('#closeSettingsBtn');
        await tab.waitForTimeout(300);
        const panelClosed = await tab.evaluate(() =>
            getComputedStyle(document.getElementById('settingsPanel')).display === 'none');
        report.check('player with key: overlay gone, settings open/close', overlayGone && panelOpen && panelClosed);

        // The Notes toggle is wired to the real controller: default off,
        // checking it flips the setting and the container class instantly.
        const notesToggleWiring = await tab.evaluate(() => {
            const controller = window.musicController;
            const container = document.getElementById('playlistContainer');
            const toggle = document.getElementById('playlistNotesToggle');
            const defaultOff = controller.settings.showSongNotes === false
                && toggle.checked === false
                && !container.classList.contains('playlist-notes-on');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));
            const onAfterClick = controller.settings.showSongNotes === true
                && container.classList.contains('playlist-notes-on');
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));
            const offAgain = controller.settings.showSongNotes === false
                && !container.classList.contains('playlist-notes-on');
            return { defaultOff, onAfterClick, offAgain };
        });
        report.check('player notes toggle defaults off and applies instantly',
            notesToggleWiring.defaultOff && notesToggleWiring.onAfterClick && notesToggleWiring.offAgain);
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
