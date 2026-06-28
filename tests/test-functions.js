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
                ['c major and repeat', cmd => cmd && cmd.root === 'C' && cmd.modifiers.repeat === Infinity]
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
                startAtOne: false, rangeMode: 'within', minLength: 9, maxLength: 9,
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
        // Sing deterministically through the explicit sample seam (the
        // fake mic's beeps are not reliable enough to count on).
        await tab.evaluate(() => {
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
        const phraseTitle = await tab.evaluate(() => document.title);
        report.check(`phrases document title follows generated sequence ("${phraseTitle}")`,
            phraseTitle === degrees && phraseTitle.length > 0 && !phraseTitle.includes('Phrases'));

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
        report.check(`phrases breakdown controls are left/tall (left=${breakdownControls.leftDelta.toFixed(0)}, h=${breakdownControls.buttonHeight.toFixed(0)})`,
            breakdownControls.leftDelta <= 16 && breakdownControls.buttonHeight >= 44
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

        await tab.evaluate(() => {
            const tones = document.getElementById('hearTonesToggle');
            if (tones instanceof HTMLInputElement && !tones.checked) tones.click();
        });
        await tab.waitForTimeout(200);
        await tab.click('#stopBtn');

        await tab.click('#nextBtn');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const historyCount = await tab.evaluate(() => document.querySelectorAll('#historyList .history-item').length);
        const s1 = await tab.evaluate(() => window.__voiceStarts);
        await tab.evaluate(() => document.querySelector('#historyList .history-play-btn').click());
        await tab.waitForTimeout(1500);
        const s2 = await tab.evaluate(() => window.__voiceStarts);
        report.check(`phrases history records and replays (${historyCount} items)`, historyCount >= 2 && s2 > s1);

        // "just over" range: offsets bounded to two degrees past the octave
        const overBounded = await tab.evaluate(() => {
            const algos = ['balanced', 'random', 'stepwise', 'leapy', 'arch', 'motif', 'alto_gaps'];
            for (const phraseAlgo of algos) {
                for (let i = 0; i < 300; i++) {
                    const offsets = PatternPracticeCore.generatePhraseOffsets({
                        scaleType: 'major', phraseAlgo, startAtOne: false, rangeMode: 'over',
                        minLength: 5, maxLength: 9, returnToInitial: false, returnToRoot: false
                    });
                    if (Math.min(...offsets) < -2 || Math.max(...offsets) > 9) return false;
                }
            }
            return true;
        });
        report.check('phrases algos keep "just over" bounded to 6-below..3-above', overBounded);
        await tab.click('[data-range="over"]');
        await tab.waitForTimeout(200);
        const savedRange = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.rangeMode);
        report.check('phrases range mode persists', savedRange === 'over');
        await tab.click('[data-phrase-algo="arch"]');
        await tab.waitForTimeout(200);
        const savedAlgo = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.phraseAlgo);
        report.check('phrases algorithm persists', savedAlgo === 'arch');

        const lessonFamilies = await tab.evaluate(() => {
            const staff = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'staff', phraseLesson: 'staff_steps',
                phraseAlgo: 'balanced', startAtOne: true, rangeMode: 'within',
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const sight = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'sight', phraseLesson: 'sight_pentachord',
                phraseAlgo: 'balanced', startAtOne: false, rangeMode: 'within',
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const barber = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'barbershop', phraseLesson: 'barber_dominant',
                phraseAlgo: 'balanced', startAtOne: false, rangeMode: 'within',
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const staffStepsOnly = staff.slice(1).every((offset, index) => Math.abs(offset - staff[index]) === 1);
            const sightInPentachord = sight.every(offset => [0, 1, 2, 3, 4].includes(offset));
            const barberDominant = barber.every(offset => [1, 3, 4, 6].includes(offset));
            return { staffStepsOnly, sightInPentachord, barberDominant };
        });
        report.check('phrases style lessons constrain generated degrees',
            lessonFamilies.staffStepsOnly && lessonFamilies.sightInPentachord && lessonFamilies.barberDominant);
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
                phraseAlgo: 'balanced', startAtOne: false, rangeMode: 'within',
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
                    phraseAlgo: 'balanced', startAtOne: false, rangeMode: 'within',
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
                    rangeMode: 'expanded', minLength: 8, maxLength: 10,
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
                    rangeMode: 'within', minLength: 8, maxLength: 10,
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
                    scaleType: 'major', phraseAlgo: 'arch', startAtOne: false, rangeMode: 'within',
                    minLength: 5, maxLength: 8, returnToInitial: true, returnToRoot: false
                });
                if (offsets[offsets.length - 1] !== 0) return false;
            }
            return true;
        });
        report.check('phrases return to 1 ends on degree 1 even with random start', returnToOne);

        // Chromatic choices: Acc replaces normal note slots with passing
        // tones, never lengthening the phrase beyond Min/Max.
        const chromatic = await tab.evaluate(() => {
            let decorated = 0;
            let invalid = 0;
            let wrongLength = 0;
            for (let i = 0; i < 100; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeMode: 'over', minLength: 16, maxLength: 16,
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
                && NotationSpelling.clefForPhrase(51, [51, 53, 55]) === 'bass'
                && NotationSpelling.passingAccidental(4.5, 7, 0, [4.5, 5]) === '#';
        });
        report.check('phrases staff spelling helpers', staffSpelling);

        const staffRendered = await tab.evaluate(() => {
            const host = document.getElementById('phraseStaff');
            return Boolean(host && !host.classList.contains('phrase-staff-empty') && host.querySelector('svg'));
        });
        report.check('phrases staff renders svg for current phrase', staffRendered);

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
        // Quiesce any playback still running from earlier checks first.
        await tab.click('#stopBtn');
        await tab.waitForTimeout(500);
        const voicesBefore = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.click('#testBtn');
        await tab.waitForTimeout(1500);
        const voicesAfter = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        report.check(`phrases test open is silent (${voicesAfter - voicesBefore} voices started)`,
            voicesAfter === voicesBefore);
        await tab.evaluate(() => {
            window.phrasesDebug.mediaPlay();
            window.phrasesDebug.mediaNext();
            document.getElementById('playBtn').click();
            document.getElementById('nextBtn').click();
            document.querySelector('.phrase-note-play-token')?.click();
            document.querySelector('.step-btn[data-step-key="rootPitch"][data-step-delta="1"]')?.click();
            document.querySelector('#historyList .history-play-btn')?.click();
        });
        await tab.waitForTimeout(5200);
        const voicesAfterMediaActions = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        report.check(`phrases playback entry points stay silent during Test (${voicesAfter}->${voicesAfterMediaActions} voices)`,
            voicesAfterMediaActions === voicesAfter);

        // The Guide button is the explicit way to hear the targets.
        await tab.evaluate(() => document.getElementById('phraseTestGuideBtn').click());
        await tab.waitForTimeout(2500);
        const voicesGuide = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        report.check(`phrases Guide button plays enabled targets (${voicesGuide - voicesAfter} voices)`,
            voicesGuide - voicesAfter === plan.targetCount);

        // END-TO-END NOTE LINKAGE: with notes disabled, singing exactly
        // the displayed enabled notes must credit every one of them.
        // Sing via the explicit sample seam at each target's window.
        const linkage = await tab.evaluate(async () => {
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

        // The action row stays visible while scrolled mid-take.
        await tab.evaluate(() => window.scrollTo(0, 700));
        await tab.waitForTimeout(300);
        const pinned = await tab.evaluate(() => {
            const rect = document.querySelector('#phraseTestPanel .pitch-test-actions').getBoundingClientRect();
            return { top: rect.top, visible: rect.top >= 0 && rect.bottom <= window.innerHeight };
        });
        report.check(`phrases test actions stay visible when scrolled (top=${pinned.top.toFixed(0)}px)`, pinned.visible);
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
        report.check(`pitch-meter free session (${samples} samples, notesHit ${notesHit})`,
            samples > 10 && resultsShown === 'block' && /^\d+\/\d+$/.test(notesHit));

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
        // Wall-clock mode so all target windows pass deterministically
        await tab.evaluate(() => document.getElementById('scalesSingPauseToggle').click());
        await tab.waitForTimeout(4500);
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
                }
                start() { this.onstart && this.onstart(); }
                stop() { this.onend && this.onend(); }
                abort() { this.onend && this.onend(); }
            }
            window.__emitResult = (text, isFinal = true) => {
                const rec = window.__recs[window.__recs.length - 1];
                const result = [{ transcript: text }];
                result.isFinal = isFinal;
                rec.onresult({ resultIndex: 0, results: [result] });
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

        const aiParsing = await tab.evaluate(async () => {
            const harness = {
                statuses: [],
                messages: [],
                updateStatus(message) { this.statuses.push(message); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                logClaudeMessage(text) { this.messages.push({ kind: 'claude', label: 'Claude', text }); }
            };
            PlayerCommands.install(harness);

            const wrapped = harness.parseAIResponse(JSON.stringify({
                songs: [
                    'The Clash London Calling',
                    { song: 'Cecilia', artist: 'Simon & Garfunkel' },
                    { band: 'The Ventures', comment: 'regional riff band' }
                ]
            }), 'prompt');

            const realFetch = window.fetch;
            const fetchUrls = [];
            window.fetch = async url => {
                fetchUrls.push(String(url));
                return new Response(JSON.stringify({
                    url: 'https://example.test/page',
                    requestedUrl: 'https://example.test/page',
                    title: 'Regional riffs',
                    text: 'The page mentions The Clash, London Calling, and The Ventures.',
                    charCount: 67
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const prepared = await harness.prepareMusicSearchRequest('all songs in https://example.test/page please');
            const inferred = await harness.prepareMusicSearchRequest('get the songs bands and search terms from the tvtropes regional riffs page');
            window.fetch = realFetch;

            return {
                urls: harness.extractUrlsFromTranscript('read https://example.test/page, thanks'),
                inferredUrls: harness.inferKnownPageUrls('get tvtropes regional riffs'),
                fetchUrls,
                count: wrapped.songList.length,
                terms: wrapped.songList.map(song => song.searchTerm),
                linkedTitle: prepared.linkedPages[0]?.title || '',
                inferredTitle: inferred.linkedPages[0]?.title || '',
                status: harness.statuses[0] || ''
            };
        });
        report.check('player AI parser accepts wrapped songs and search terms',
            aiParsing.count === 3
            && aiParsing.terms.includes('The Clash London Calling')
            && aiParsing.terms.includes('Simon & Garfunkel Cecilia')
            && aiParsing.terms.includes('The Ventures'));
        report.check('player URL requests are prepared with linked page text',
            aiParsing.urls[0] === 'https://example.test/page'
            && aiParsing.linkedTitle === 'Regional riffs'
            && aiParsing.status.includes('Reading 1 linked page'));
        report.check('player infers TV Tropes Regional Riff page without pasted URL',
            aiParsing.inferredUrls[0] === 'https://tvtropes.org/pmwiki/pmwiki.php/Main/RegionalRiff'
            && aiParsing.fetchUrls.some(url => url.includes('RegionalRiff'))
            && aiParsing.inferredTitle === 'Regional riffs');

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
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
