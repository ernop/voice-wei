// @ts-check
// Staff page: the continuous grand-staff sight-singing tool.
// - the continuous generator meters notes/rests into 4/4 without
//   crossing barlines, using only the enabled duration values
// - the scroll view splits notes at middle C (one staff each, never
//   duplicated) and keeps the sung-trace y-mapping continuous through
//   the gap between the staves
// - scroll mode advances the strip, fires passed notes, extends the
//   sequence ahead of the now-line, and saves the run for review
// - a saved run loads back as a reviewable sheet with its sung trace

const { BASE_URL, launchWithMic, collectErrors, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('staff page');
    // Fake mic so Listen starts succeed silently.
    const browser = await launchWithMic();
    const tab = await browser.newPage();
    collectErrors(tab, 'staff', report.errors);

    await tab.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('voice-wei:staff-settings', JSON.stringify({
            v: 'test',
            data: {
                // rearrange emits every scale note in the range once per
                // phrase, so the C3..G4 range deterministically spans
                // both staves (the grand-staff split assertions below).
                root: 'C', octave: 3, scaleType: 'major',
                phraseStyle: 'free', phraseLesson: 'free_open', phraseAlgo: 'rearrange',
                startAtOne: true, rangeLow: 0, rangeHigh: 11, accidentalRate: 0,
                minLength: 5, maxLength: 8, returnToInitial: true,
                bpm: 120, restBeats: 2, measures: 8, durationBeats: [1],
                pxPerBeat: 26, nowFraction: 0.3, staffWidthPct: 100,
                hearTones: true, mode: 'page'
            }
        }));
    });
    await tab.goto(`${BASE_URL}/staff.html`, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => Boolean(window.staffDebug && window.staffDebug.events().length), null, { timeout: 20000 });

    // --- Continuous generator: metering, durations, contiguity ---------
    const generation = await tab.evaluate(() => {
        const events = window.staffDebug.timedEvents();
        const crossesBarline = events.some(event =>
            Math.floor(event.startBeat / 4) !== Math.floor((event.startBeat + event.beats - 0.001) / 4));
        const contiguous = events.every((event, index) =>
            index === 0 || Math.abs(event.startBeat - (events[index - 1].startBeat + events[index - 1].beats)) < 1e-6);
        const notes = events.filter(event => event.type === 'note');
        const rests = events.filter(event => event.type === 'rest');
        const durationsOk = notes.every(event => event.beats === 1);
        const last = events[events.length - 1];
        return {
            totalBeats: last.startBeat + last.beats,
            noteCount: notes.length,
            restCount: rests.length,
            crossesBarline,
            contiguous,
            durationsOk
        };
    });
    report.check(`continuous sequence covers the requested bars (${generation.totalBeats} beats)`, generation.totalBeats >= 32);
    report.check('no event crosses a barline', !generation.crossesBarline);
    report.check('events tile the timeline with no gaps or overlaps', generation.contiguous);
    report.check(`rests separate the phrases (${generation.restCount} rests)`, generation.restCount > 0);
    report.check('note durations obey the enabled set (quarters only)', generation.durationsOk);

    // Mixed durations through the pure generator seam.
    const mixed = await tab.evaluate(() => {
        const generator = PatternPracticeCore.createContinuousSequence({
            scaleType: 'major', startAtOne: true, rangeLow: 0, rangeHigh: 7,
            minLength: 5, maxLength: 8, returnToInitial: true, returnToRoot: false,
            phraseAlgo: 'arch', durationBeats: [0.5, 1, 2, 4], restBeats: 1
        });
        const events = generator.nextEvents(96);
        const allowed = new Set([0.5, 1, 2, 4]);
        return {
            durationsOk: events.every(event => allowed.has(event.beats)),
            crossesBarline: events.some(event =>
                Math.floor(event.startBeat / 4) !== Math.floor((event.startBeat + event.beats - 0.001) / 4)),
            variety: new Set(events.filter(event => event.type === 'note').map(event => event.beats)).size
        };
    });
    report.check('mixed-duration stream stays within the enabled values', mixed.durationsOk);
    report.check('mixed-duration stream never crosses a barline', !mixed.crossesBarline);
    report.check(`mixed-duration stream actually varies (${mixed.variety} values used)`, mixed.variety >= 2);

    // Rest to the barline: restBeats is the GUARANTEED rest after each
    // phrase; restToBarline then keeps resting to the next barline, so
    // every phrase starts on a downbeat. With no guaranteed rest, a
    // phrase ending exactly on the barline gets no filler at all; with
    // one, there is always a breath.
    const measureRest = await tab.evaluate(() => {
        const base = {
            scaleType: 'major', startAtOne: true, rangeLow: 0, rangeHigh: 7,
            returnToInitial: false, returnToRoot: false,
            phraseAlgo: 'arch', durationBeats: [1], restBeats: 0, restToBarline: true
        };
        /** @param {any[]} events */
        const phraseStartsOnBarline = events => events.every((event, index) =>
            event.type !== 'note'
            || index === 0
            || events[index - 1].type === 'note'
            || event.startBeat % 4 === 0);
        /** Every rest run spans at least this many beats. @param {any[]} events */
        const minRestRun = events => {
            let min = Infinity;
            let run = 0;
            for (const event of events) {
                if (event.type === 'rest') { run += event.beats; continue; }
                if (run > 0) min = Math.min(min, run);
                run = 0;
            }
            return min;
        };
        const varied = PatternPracticeCore.createContinuousSequence(
            { ...base, minLength: 3, maxLength: 6 }).nextEvents(96);
        const exact = PatternPracticeCore.createContinuousSequence(
            { ...base, minLength: 4, maxLength: 4 }).nextEvents(32);
        // The complaint case: exact-bar phrases with a 2-beat guaranteed
        // rest still breathe (2 beats, then fill to the next barline).
        const guaranteed = PatternPracticeCore.createContinuousSequence(
            { ...base, restBeats: 2, minLength: 4, maxLength: 4 }).nextEvents(48);
        const guaranteedVaried = PatternPracticeCore.createContinuousSequence(
            { ...base, restBeats: 2, minLength: 3, maxLength: 6 }).nextEvents(96);
        return {
            variedOnBarline: phraseStartsOnBarline(varied),
            variedRests: varied.filter(event => event.type === 'rest').length,
            firstStart: varied[0]?.startBeat,
            exactRests: exact.filter(event => event.type === 'rest').length,
            exactContiguous: exact.every((event, index) =>
                index === 0 || event.startBeat === exact[index - 1].startBeat + exact[index - 1].beats),
            guaranteedOnBarline: phraseStartsOnBarline(guaranteed),
            guaranteedMinRest: minRestRun(guaranteed),
            guaranteedVariedOnBarline: phraseStartsOnBarline(guaranteedVaried),
            guaranteedVariedMinRest: minRestRun(guaranteedVaried)
        };
    });
    report.check(`rest to barline starts every phrase on a downbeat (${measureRest.variedRests} filler rests)`,
        measureRest.variedOnBarline && measureRest.firstStart === 0 && measureRest.variedRests > 0);
    report.check('rest to barline with no guaranteed rest adds nothing when a phrase ends on the barline',
        measureRest.exactRests === 0 && measureRest.exactContiguous);
    report.check(`minimum rest + to barline always breathes and stays on downbeats (bar-exact phrases rest ${measureRest.guaranteedMinRest} beats)`,
        measureRest.guaranteedOnBarline && measureRest.guaranteedMinRest === 4
        && measureRest.guaranteedVariedOnBarline && measureRest.guaranteedVariedMinRest >= 2);

    const restUi = await tab.evaluate(() => {
        window.staffDebug.applySettings({ restBeats: 4, restToBarline: false });
        const label = document.getElementById('restBeatsValue')?.textContent;
        const up = document.querySelector('[data-step-key="restBeats"][data-step-delta="1"]');
        const upDisabled = up ? up.disabled : null;
        const pill = document.getElementById('restToBarlineBtn');
        const pillOffText = pill?.textContent;
        pill.click();
        const pillOnText = pill?.textContent;
        const stored = SettingsStore.peekData(StorageKeys.STAFF_SETTINGS) || {};
        const persisted = stored.restToBarline === true;
        pill.click();
        window.staffDebug.applySettings({ restBeats: 2 });
        return { label, upDisabled, pillOffText, pillOnText, persisted };
    });
    report.check(`rest stepper is the guaranteed span ("${restUi.label}" tops out) and the barline pill toggles and persists ("${restUi.pillOffText}" -> "${restUi.pillOnText}")`,
        restUi.label === '4 beats' && restUi.upDisabled === true
        && restUi.pillOffText === 'fixed rest' && restUi.pillOnText === 'then to end of bar'
        && restUi.persisted);

    // Yesterday's 'measure' sentinel migrates to (rest 0, to-barline on).
    const migrateCtx = await browser.newContext();
    const migrateTab = await migrateCtx.newPage();
    await migrateTab.addInitScript(() => {
        localStorage.setItem('voice-wei:staff-settings', JSON.stringify({
            v: 'test', data: { restBeats: 'measure' }
        }));
    });
    await migrateTab.goto(`${BASE_URL}/staff.html`, { waitUntil: 'domcontentloaded' });
    await migrateTab.waitForFunction(() => Boolean(window.staffDebug && window.staffDebug.events().length), null, { timeout: 20000 });
    const migrated = await migrateTab.evaluate(() => {
        const settings = window.staffDebug.settings();
        return { restBeats: settings.restBeats, restToBarline: settings.restToBarline };
    });
    await migrateCtx.close();
    report.check(`stored 'measure' rest migrates to rest 0 + to barline (${migrated.restBeats}, ${migrated.restToBarline})`,
        migrated.restBeats === 0 && migrated.restToBarline === true);

    // --- Phrase repeat: the clock jumps back to replay each phrase, and
    // repeat passes keep their own sound + display settings ------------
    const phraseRepeat = await tab.evaluate(() => {
        const debug = window.staffDebug;
        debug.applySettings({
            phraseRepeats: 2, hearTones: true, showDegrees: true,
            repeatHearTones: false, repeatShowDegrees: false, repeatShowPitchGuides: true,
            restBeats: 2, restToBarline: false
        });
        debug.regenerate();
        debug.stopRun();
        const events = debug.events();
        /** @type {Array<{ startBeat: number, endBeat: number, notes: any[] }>} */
        const runs = [];
        let current = null;
        for (const event of events) {
            if (event.type !== 'note') { current = null; continue; }
            if (!current) { current = { startBeat: event.startBeat, endBeat: 0, notes: [] }; runs.push(current); }
            current.notes.push(event);
            current.endBeat = event.startBeat + event.beats;
        }
        const shell = document.querySelector('.staff-scroll-shell');
        const piano = debug.piano();
        const real = piano.playMidiAudibleIn;
        let calls = 0;
        piano.playMidiAudibleIn = () => { calls++; };

        // First pass: notes sound (hear tones on) and numbers show.
        debug.setClockBeat(runs[0].notes[0].startBeat + 0.01);
        const firstPassCalls = calls;
        const passDuringFirst = debug.passNumber();
        const degreesShownOnFirst = !shell.classList.contains('staff-degrees-hidden');

        // Crossing the next phrase's start jumps the clock BACK instead
        // of moving on: same sheet, second pass.
        calls = 0;
        debug.setClockBeat(runs[1].startBeat + 0.01);
        const jumpedBack = debug.clockBeat() < runs[0].endBeat;
        const passAfterJump = debug.passNumber();
        const degreesHiddenOnRepeat = shell.classList.contains('staff-degrees-hidden');

        // The repeat pass re-fires every note of the phrase, silently
        // (repeat hear tones off).
        for (const note of runs[0].notes) debug.setClockBeat(note.startBeat + 0.01);
        const repeatCalls = calls;

        // Crossing the boundary again moves on: pass resets to 1 and the
        // next phrase sounds under first-pass settings again.
        calls = 0;
        debug.setClockBeat(runs[1].startBeat + 0.01);
        const movedOn = debug.clockBeat() >= runs[1].startBeat;
        const passAfterMovingOn = debug.passNumber();
        const nextPhraseCalls = calls;
        const degreesBackAfterMovingOn = !shell.classList.contains('staff-degrees-hidden');

        piano.playMidiAudibleIn = real;
        // Rewind before stopping so this synthetic walk never saves a
        // Past Run (the session tests below count exact rows).
        debug.setClockBeat(-4);
        debug.stopRun();
        debug.applySettings({ phraseRepeats: 1, repeatHearTones: true, repeatShowDegrees: true });
        debug.regenerate();
        return {
            firstPassCalls, passDuringFirst, degreesShownOnFirst,
            jumpedBack, passAfterJump, degreesHiddenOnRepeat, repeatCalls,
            movedOn, passAfterMovingOn, nextPhraseCalls, degreesBackAfterMovingOn
        };
    });
    report.check(`repeat x2 first pass sounds and counts as pass 1 (${phraseRepeat.firstPassCalls} tones)`,
        phraseRepeat.firstPassCalls >= 1 && phraseRepeat.passDuringFirst === 1
        && phraseRepeat.degreesShownOnFirst);
    report.check('crossing the next phrase start jumps the clock back for pass 2',
        phraseRepeat.jumpedBack && phraseRepeat.passAfterJump === 2);
    report.check(`repeat pass honors its own settings: silent, numbers hidden (${phraseRepeat.repeatCalls} tones)`,
        phraseRepeat.repeatCalls === 0 && phraseRepeat.degreesHiddenOnRepeat);
    report.check(`after the final pass the run moves on under first-pass settings (${phraseRepeat.nextPhraseCalls} tones)`,
        phraseRepeat.movedOn && phraseRepeat.passAfterMovingOn === 1
        && phraseRepeat.nextPhraseCalls >= 1 && phraseRepeat.degreesBackAfterMovingOn);

    // Stored phrase-twice settings migrate to the repeat transport.
    const repeatMigrateCtx = await browser.newContext();
    const repeatMigrateTab = await repeatMigrateCtx.newPage();
    await repeatMigrateTab.addInitScript(() => {
        localStorage.setItem('voice-wei:staff-settings', JSON.stringify({
            v: 'test', data: { phraseTwice: true, secondPassOnYourOwn: true }
        }));
    });
    await repeatMigrateTab.goto(`${BASE_URL}/staff.html`, { waitUntil: 'domcontentloaded' });
    await repeatMigrateTab.waitForFunction(() => Boolean(window.staffDebug && window.staffDebug.events().length), null, { timeout: 20000 });
    const repeatMigrated = await repeatMigrateTab.evaluate(() => {
        const settings = window.staffDebug.settings();
        return { phraseRepeats: settings.phraseRepeats, repeatHearTones: settings.repeatHearTones };
    });
    await repeatMigrateCtx.close();
    report.check(`stored phrase x2 + 2nd-pass-on-your-own migrate to repeat x2 with silent repeats (x${repeatMigrated.phraseRepeats}, tones ${repeatMigrated.repeatHearTones})`,
        repeatMigrated.phraseRepeats === 2 && repeatMigrated.repeatHearTones === false);

    // --- Reveal when done: guides + sung line wait for the phrase ------
    const reveal = await tab.evaluate(async () => {
        const debug = window.staffDebug;
        debug.applySettings({ revealAfterPhrase: true, showPitchGuides: true, sungLinePlacement: 'band' });
        debug.setMode('scroll');
        await debug.startRun();
        const events = debug.events();
        const runs = [];
        let current = null;
        for (const event of events) {
            if (event.type !== 'note') { current = null; continue; }
            if (!current) { current = { startBeat: event.startBeat, endBeat: 0 }; runs.push(current); }
            current.endBeat = event.startBeat + event.beats;
        }
        const countBand = () => {
            const overlay = /** @type {HTMLCanvasElement} */ (document.querySelector('.staff-scroll-overlay'));
            const geometry = window.staffDebug.geometry();
            const left = Math.round(geometry.headerWidth) + 20;
            const pixels = overlay.getContext('2d').getImageData(
                left, geometry.pitchZoneTop + 16, overlay.width - left - 2, geometry.pitchZoneHeight - 18).data;
            let guides = 0;
            let trace = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                const [r, , b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
                if (a <= 60 || b <= r) continue;
                if (b - r < 60) guides++;
                else if (b - r > 150) trace++;
            }
            return { guides, trace };
        };
        // Sing near the phrase END so the revealed dot still sits inside
        // the counted region behind the now-line at reveal time.
        debug.recordTraceSample(runs[0].endBeat - 1, 50);
        debug.setClockBeat(runs[0].startBeat + 0.4);
        const boundaryDuring = debug.revealBeforeBeat();
        const during = countBand();
        debug.setClockBeat(runs[0].endBeat + 0.05);
        const boundaryAfter = debug.revealBeforeBeat();
        const after = countBand();
        debug.setClockBeat(-4);
        debug.stopRun();
        const idleBoundary = debug.revealBeforeBeat();
        debug.applySettings({ revealAfterPhrase: false });
        debug.setMode('page');
        return {
            boundaryDuring, boundaryAfter, during, after, idleBoundary,
            run0Start: runs[0].startBeat, run1Start: runs[1] ? runs[1].startBeat : null
        };
    });
    report.check(`reveal when done hides guides and sung line during the phrase (${reveal.during.guides}/${reveal.during.trace}, boundary ${reveal.boundaryDuring})`,
        reveal.during.guides === 0 && reveal.during.trace === 0
        && reveal.boundaryDuring === reveal.run0Start);
    report.check(`reveal when done shows the finished phrase (${reveal.after.guides} guide px, ${reveal.after.trace} trace px, boundary ${reveal.boundaryAfter}); idle reviews in full`,
        reveal.after.guides > 0 && reveal.after.trace > 0
        && reveal.boundaryAfter === reveal.run1Start
        && reveal.idleBoundary === null);

    // --- Reveal pill nudges the now-line; hear 1 plays the root --------
    const stageActions = await tab.evaluate(async () => {
        const debug = window.staffDebug;
        debug.applySettings({ revealAfterPhrase: false, nowFraction: 0.3 });
        /** @type {HTMLElement} */ (document.getElementById('revealBtn')).click();
        const afterOn = { reveal: debug.settings().revealAfterPhrase, now: debug.settings().nowFraction };
        const pillText = document.getElementById('revealBtn')?.textContent;
        /** @type {HTMLElement} */ (document.getElementById('revealBtn')).click();
        const afterOff = { reveal: debug.settings().revealAfterPhrase, now: debug.settings().nowFraction };

        const piano = debug.piano();
        const before = new Set(piano.activeVoices().map(voice => voice.id));
        /** @type {HTMLElement} */ (document.getElementById('hearRootBtn')).click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const rootMidiValue = 48; // C3 in this suite's settings
        const rootVoice = piano.activeVoices()
            .find(voice => voice.midi === rootMidiValue && !before.has(voice.id)) || null;
        piano.stopAll();
        return { afterOn, pillText, afterOff, rootPlayed: rootVoice !== null };
    });
    report.check(`reveal pill nudges the now-line right once ("${stageActions.pillText}", now 30% -> ${Math.round(stageActions.afterOn.now * 100)}% -> stays ${Math.round(stageActions.afterOff.now * 100)}%)`,
        stageActions.afterOn.reveal === true && stageActions.afterOn.now === 0.5
        && stageActions.pillText === 'reveal when done'
        && stageActions.afterOff.reveal === false && stageActions.afterOff.now === 0.5);
    report.check('hear 1 button plays the key root', stageActions.rootPlayed);

    // --- Car display: phrase numbers lead the sheet ---------------------
    // While a run moves, the now-playing title is the number sequence of
    // the phrase that is playing or (during rests and the lead-in) coming
    // up next; Stop hands the surface back to the page default.
    const phraseMedia = await tab.evaluate(async () => {
        const debug = window.staffDebug;
        debug.stopRun();
        debug.setMode('scroll');
        await debug.startRun();
        const events = debug.events();
        const runs = [];
        let current = null;
        for (const event of events) {
            if (event.type !== 'note') { current = null; continue; }
            if (!current) {
                current = { startBeat: event.startBeat, endBeat: 0, degrees: [] };
                runs.push(current);
            }
            current.degrees.push(String(event.degree));
            current.endBeat = event.startBeat + event.beats;
        }
        const firstRest = events.find(event => event.type === 'rest');

        // Lead-in presents the first phrase before its first note plays.
        debug.setClockBeat(-1);
        const duringLeadIn = navigator.mediaSession.metadata?.title;
        debug.setClockBeat(runs[0].startBeat + 0.1);
        const duringFirstPhrase = navigator.mediaSession.metadata?.title;
        debug.setClockBeat(firstRest.startBeat + 0.05);
        const duringRest = navigator.mediaSession.metadata?.title;
        const artistDuringRest = navigator.mediaSession.metadata?.artist;
        const headerDuringRest = document.querySelector('#siteHeader h1')?.textContent;
        // Rewind below the session-save threshold so this probe run does
        // not add a Past Run, then restore page mode for later checks.
        debug.setClockBeat(-4);
        debug.stopRun();
        const afterStop = navigator.mediaSession.metadata?.title;
        debug.setMode('page');
        return {
            expectedFirst: runs[0].degrees.join(','),
            expectedSecond: runs[1] ? runs[1].degrees.join(',') : null,
            duringLeadIn,
            duringFirstPhrase,
            duringRest,
            artistDuringRest,
            headerDuringRest,
            afterStop
        };
    });
    report.check(`car display shows the playing phrase's numbers ("${phraseMedia.duringFirstPhrase}")`,
        phraseMedia.duringLeadIn === phraseMedia.expectedFirst
        && phraseMedia.duringFirstPhrase === phraseMedia.expectedFirst
        && phraseMedia.artistDuringRest === 'C3 major');
    report.check(`rests flip the title to the upcoming phrase ("${phraseMedia.duringRest}"), header follows, Stop restores`,
        phraseMedia.expectedSecond !== null
        && phraseMedia.duringRest === phraseMedia.expectedSecond
        && phraseMedia.headerDuringRest === phraseMedia.expectedSecond
        && phraseMedia.afterStop === 'Staff');

    // Range governs lessons on Staff: the user's endpoints set the span;
    // the lesson keeps its motion character. Without the flag (Phrases),
    // lesson palettes stay lesson-owned.
    const rangeAuthority = await tab.evaluate(() => {
        const base = {
            scaleType: 'major', startAtOne: true, minLength: 6, maxLength: 8,
            returnToInitial: true, returnToRoot: false, accidentalRate: 0
        };
        const span = (options, runs = 120) => {
            let min = 99, max = -99;
            const values = new Set();
            for (let i = 0; i < runs; i++) {
                for (const offset of PatternPracticeCore.generatePhraseOffsets(options)) {
                    min = Math.min(min, offset);
                    max = Math.max(max, offset);
                    values.add(offset);
                }
            }
            return { min, max, values: [...values].sort((a, b) => a - b) };
        };
        // Longer walks: a pure step random walk needs room to reach the
        // top of the range at all (the old cap froze it at degree 5).
        const steps = span({
            ...base, minLength: 12, maxLength: 14,
            phraseStyle: 'staff', phraseLesson: 'staff_steps',
            rangeLow: 0, rangeHigh: 7, rangeGovernsLessons: true
        }, 200);
        const pentachord = span({ ...base, phraseStyle: 'sight', phraseLesson: 'sight_pentachord', rangeLow: 0, rangeHigh: 7, rangeGovernsLessons: true });
        const stepsMotion = (() => {
            for (let i = 0; i < 40; i++) {
                const offsets = PatternPracticeCore.generatePhraseOffsets({
                    ...base, phraseStyle: 'staff', phraseLesson: 'staff_steps',
                    rangeLow: 0, rangeHigh: 7, rangeGovernsLessons: true, returnToInitial: false
                });
                for (let j = 1; j < offsets.length; j++) {
                    if (Math.abs(offsets[j] - offsets[j - 1]) !== 1) return false;
                }
            }
            return true;
        })();
        const landmarks = span({ ...base, phraseStyle: 'staff', phraseLesson: 'staff_landmarks', rangeLow: 0, rangeHigh: 11, rangeGovernsLessons: true });
        const landmarkClassesOk = landmarks.values.every(offset =>
            [0, 2, 4].includes(PatternPracticeCore.positiveModulo(offset, 7)));
        const phrasesSteps = span({ ...base, phraseStyle: 'staff', phraseLesson: 'staff_steps', rangeLow: 0, rangeHigh: 7 });
        return {
            stepsSpan: `${steps.min}..${steps.max}`,
            stepsUncapped: steps.min === 0 && steps.max >= 6 && steps.max <= 7,
            pentachordSpan: `${pentachord.min}..${pentachord.max}`,
            pentachordFull: pentachord.min === 0 && pentachord.max === 7,
            stepsMotion,
            landmarksHigh: landmarks.max > 7,
            landmarkClassesOk,
            phrasesCapped: phrasesSteps.max <= 4
        };
    });
    report.check(`range governs staff-steps span (${rangeAuthority.stepsSpan} within range 1..8, no longer capped at 5)`, rangeAuthority.stepsUncapped);
    report.check(`range governs pentachord span (${rangeAuthority.pentachordSpan} over range 1..8)`, rangeAuthority.pentachordFull);
    report.check('range-governed steps lesson keeps pure step motion', rangeAuthority.stepsMotion);
    report.check('gapped lesson palettes tile their pitch classes across the range', rangeAuthority.landmarksHigh && rangeAuthority.landmarkClassesOk);
    report.check('without the flag (Phrases), lesson palettes stay lesson-owned (max degree 5)', rangeAuthority.phrasesCapped);

    // --- Rendering: grand staff with a single position per note --------
    const rendering = await tab.evaluate(() => {
        const geometry = window.staffDebug.geometry();
        const events = window.staffDebug.events().filter(event => event.type === 'note');
        const positions = geometry.notePositions;
        const clefsCorrect = positions.every(position =>
            position.clef === (position.midi < 60 ? 'bass' : 'treble'));
        const midis = events.map(event => event.midi);
        return {
            chunkCount: geometry.chunkCount,
            headerWidth: geometry.headerWidth,
            drawn: positions.length,
            noteCount: events.length,
            clefsCorrect,
            spansBothStaves: Math.min(...midis) < 60 && Math.max(...midis) >= 60,
            headerSvg: Boolean(document.querySelector('.staff-scroll-header svg')),
            chunkSvgs: document.querySelectorAll('.staff-scroll-chunk svg').length
        };
    });
    report.check(`chunk SVGs rendered (${rendering.chunkSvgs} chunks)`, rendering.chunkSvgs > 0 && rendering.chunkCount === rendering.chunkSvgs);

    // Chunk-seam clipping: a note in a chunk's last beat must draw fully
    // inside its SVG (the number-without-a-note bug at 8-bar seams).
    // Gapless quarters guarantee notes land on every chunk's last beat.
    const clipping = await tab.evaluate(() => {
        window.staffDebug.applySettings({
            restBeats: 0, durationBeats: [1], phraseAlgo: 'stepwise', measures: 32
        });
        window.staffDebug.regenerate();
        const lastBeatNotes = window.staffDebug.timedEvents()
            .filter(event => event.type === 'note' && event.startBeat % 32 === 31).length;
        let worst = -999;
        let glyphs = 0;
        document.querySelectorAll('.staff-scroll-chunk').forEach(chunk => {
            const svg = chunk.querySelector('svg');
            const svgRect = svg.getBoundingClientRect();
            const svgWidth = Number(svg.getAttribute('width'));
            chunk.querySelectorAll('.vf-stavenote').forEach(group => {
                glyphs++;
                worst = Math.max(worst, group.getBoundingClientRect().right - svgRect.left - svgWidth);
            });
        });
        return { worst: Math.round(worst), glyphs, lastBeatNotes };
    });
    report.check(`seam-exercising sequence has last-beat notes (${clipping.lastBeatNotes})`, clipping.lastBeatNotes > 0);
    report.check(`no glyph clipped at a chunk seam (worst overhang ${clipping.worst}px over ${clipping.glyphs} glyphs)`,
        clipping.worst <= 0);
    report.check('fixed header (clefs + key signature) rendered', rendering.headerSvg && rendering.headerWidth > 40);
    report.check(`every note drawn exactly once (${rendering.drawn}/${rendering.noteCount})`, rendering.drawn === rendering.noteCount);
    report.check('C3-based line uses both staves', rendering.spansBothStaves);
    report.check('notes split at middle C: below on bass, C4 and up on treble', rendering.clefsCorrect);

    // Degree labels: the shared .degree-token (same as the Phrases degree
    // row), one per note under the staff, toggleable. Visibility is a
    // class flip on the shell (per-pass safe), never a chunk rebuild.
    const degrees = await tab.evaluate(() => {
        const noteCount = window.staffDebug.events().filter(event => event.type === 'note').length;
        const tokens = [...document.querySelectorAll('.staff-scroll-chunk .degree-token')];
        const labels = tokens.map(el => el.textContent || '');
        const valid = labels.every(label => /^\d+[#b\u2191\u2193]*$/.test(label));
        const toggle = document.getElementById('showDegreesToggle');
        toggle.click();
        const hiddenAfterOff = getComputedStyle(tokens[0]).display === 'none';
        const chunksIntact = document.querySelectorAll('.staff-scroll-chunk .degree-token').length === tokens.length;
        toggle.click();
        const shownAfterOn = getComputedStyle(tokens[0]).display !== 'none';
        return { noteCount, labelCount: labels.length, valid, hiddenAfterOff, chunksIntact, shownAfterOn };
    });
    report.check(`show numbers draws one shared degree token per note (${degrees.labelCount}/${degrees.noteCount})`,
        degrees.labelCount === degrees.noteCount && degrees.valid);
    report.check('turning show numbers off hides the tokens without rebuilding chunks',
        degrees.hiddenAfterOff && degrees.chunksIntact && degrees.shownAfterOn);

    const horizontalGeometry = await tab.evaluate(() => {
        const geometry = window.staffDebug.geometry();
        const strip = document.querySelector('.staff-scroll-strip');
        const stripLeft = strip.getBoundingClientRect().left;
        const headCenters = [...document.querySelectorAll('.staff-scroll-chunk .vf-notehead')].map(head => {
            const rect = head.getBoundingClientRect();
            return rect.left + rect.width / 2 - stripLeft;
        });
        const tokenCenters = [...document.querySelectorAll('.staff-scroll-chunk .staff-degree-token')].map(token => {
            const rect = token.getBoundingClientRect();
            return rect.left + rect.width / 2 - stripLeft;
        });
        const maxDelta = (actual, expected) => Math.max(
            ...expected.map((x, index) => Math.abs((actual[index] ?? Infinity) - x)));
        const onsetXs = geometry.notePositions.map(position => position.x);
        return {
            noteCount: onsetXs.length,
            headCount: headCenters.length,
            tokenCount: tokenCenters.length,
            maxHeadDelta: maxDelta(headCenters, onsetXs),
            maxTokenDelta: maxDelta(tokenCenters, onsetXs)
        };
    });
    report.check(`rendered noteheads consume canonical onset x (max delta ${horizontalGeometry.maxHeadDelta.toFixed(3)}px)`,
        horizontalGeometry.headCount === horizontalGeometry.noteCount && horizontalGeometry.maxHeadDelta < 0.01);
    report.check(`degree labels consume canonical onset x (max delta ${horizontalGeometry.maxTokenDelta.toFixed(3)}px)`,
        horizontalGeometry.tokenCount === horizontalGeometry.noteCount && horizontalGeometry.maxTokenDelta < 0.01);

    // --- Trace geometry: continuous through the staff gap --------------
    const traceGeometry = await tab.evaluate(() => {
        const y = (midi) => window.staffDebug.yForMidi(midi);
        let monotonic = true;
        let maxStep = 0;
        for (let midi = 48; midi < 72; midi++) {
            const step = y(midi) - y(midi + 1);
            if (step < 0) monotonic = false;
            maxStep = Math.max(maxStep, step);
        }
        // Crossing between staves (B3 -> C4) must be a normal staff step,
        // not a jump across a wide grand-staff gap.
        const crossing = Math.abs(y(59) - y(60));
        const interpolated = y(59.5);
        const betweenOk = interpolated < y(59) && interpolated > y(60);
        return { monotonic, maxStep, crossing, betweenOk };
    });
    report.check('higher pitch always draws higher on the system', traceGeometry.monotonic);
    report.check(`no y jump anywhere in the singable band (max step ${traceGeometry.maxStep.toFixed(1)}px)`, traceGeometry.maxStep <= 16);
    report.check(`B3 to C4 crossing is one staff step (${traceGeometry.crossing.toFixed(1)}px)`, traceGeometry.crossing <= 11);
    report.check('fractional midi interpolates between the neighbors', traceGeometry.betweenOk);

    // --- Scroll mode: transform, firing, extension ----------------------
    const scroll = await tab.evaluate(() => {
        window.staffDebug.setMode('scroll');
        const before = window.staffDebug.geometry().scrollOffset;
        window.staffDebug.setClockBeat(8);
        const geometry = window.staffDebug.geometry();
        const after = geometry.scrollOffset;
        const position = geometry.notePositions.find(item => item.beat === 8);
        return {
            before,
            after,
            nowScreenX: geometry.nowScreenX,
            clockStripAnchor: after + geometry.nowScreenX,
            eventStripAnchor: position ? position.x : null,
            fired: window.staffDebug.firedNoteCount()
        };
    });
    report.check(`scroll mode moves the strip (offset ${Math.round(scroll.before)} -> ${Math.round(scroll.after)})`, scroll.after > scroll.before);
    report.check(`notes fire as they pass the now-line (${scroll.fired} fired)`, scroll.fired > 0);
    report.check('now-line consumes the canonical onset x',
        scroll.eventStripAnchor !== null && Math.abs(scroll.clockStripAnchor - scroll.eventStripAnchor) < 0.01);

    const extension = await tab.evaluate(() => {
        const beatsBefore = (() => {
            const events = window.staffDebug.timedEvents();
            const last = events[events.length - 1];
            return last.startBeat + last.beats;
        })();
        window.staffDebug.setClockBeat(beatsBefore - 20);
        const events = window.staffDebug.timedEvents();
        const last = events[events.length - 1];
        return { beatsBefore, beatsAfter: last.startBeat + last.beats };
    });
    report.check(`scroll mode generates ahead of the now-line (${extension.beatsBefore} -> ${extension.beatsAfter} beats)`,
        extension.beatsAfter > extension.beatsBefore);

    // --- Sessions: a run persists and loads back with its trace --------
    const sessions = await tab.evaluate(() => {
        window.staffDebug.recordTraceSample(2, 55.5);
        window.staffDebug.recordTraceSample(2.2, 56.1);
        window.staffDebug.stopRun();
        const saved = window.staffDebug.sessions();
        const stored = SettingsStore.peekData(StorageKeys.STAFF_SESSIONS);
        return {
            count: saved.length,
            storedCount: Array.isArray(stored) ? stored.length : 0,
            hasEvents: saved.length > 0 && Array.isArray(saved[0].events) && saved[0].events.length > 0,
            hasTrace: saved.length > 0 && Array.isArray(saved[0].trace) && saved[0].trace.length === 2,
            listRows: document.querySelectorAll('#sessionList .history-item').length
        };
    });
    report.check('stopping a run saves it as a session', sessions.count === 1 && sessions.storedCount === 1);
    report.check('the saved session holds the generated events', sessions.hasEvents);
    report.check('the saved session holds the sung trace', sessions.hasTrace);
    report.check('the session appears in the Past Runs list', sessions.listRows === 1);

    const review = await tab.evaluate(() => {
        window.staffDebug.regenerate(); // wipe the live sheet first
        const freshLength = window.staffDebug.timedEvents().length;
        window.staffDebug.loadSessionAt(0);
        const loaded = window.staffDebug.timedEvents();
        const session = window.staffDebug.sessions()[0];
        return {
            freshLength,
            restored: loaded.length === session.events.length,
            traceRestored: window.staffDebug.traceSamples().length === 2,
            mode: window.staffDebug.settings().mode
        };
    });
    report.check('loading a session restores its sheet', review.restored);
    report.check('loading a session restores its sung trace', review.traceRestored);
    report.check('a loaded session reviews in page mode', review.mode === 'page');

    // Copy Text: the full state as pasteable text - settings plus the
    // generated sequence, token-for-token.
    const stateText = await tab.evaluate(() => {
        const text = window.staffDebug.stateText();
        const events = window.staffDebug.events();
        const sequencePart = text.split(/\nlog \(/)[0];
        const noteTokens = (sequencePart.match(/(^|\s)[0-9][0-9#b\u2191\u2193]*\.[qhw8]/g) || []).length;
        const restTokens = (sequencePart.match(/(^|\s)r\.[qhw8]/g) || []).length;
        return {
            hasHeader: text.includes('Voice-Wei Staff state'),
            hasKey: /key: .+ major|minor|chromatic|pentatonic/.test(text),
            hasSettings: text.includes('tempo:') && text.includes('range:') && text.includes('note values:'),
            noteTokens,
            restTokens,
            noteCount: events.filter(event => event.type === 'note').length,
            restCount: events.filter(event => event.type === 'rest').length,
            hasNames: text.includes('note names: '),
            hasLogHeader: /\nlog \(\d+ lines, \d+ frontend errors\):/.test(text),
            logLines: window.staffDebug.statusLog().length,
            logInText: /\n\[\d{2}:\d{2}:\d{2}\] /.test(text),
            buttonExists: Boolean(document.getElementById('copyStateBtn')),
            buttonInUtilityRow: Boolean(document.querySelector('.staff-utility-row #copyStateBtn')),
            buttonInStageMeta: Boolean(document.querySelector('.staff-stage-meta #copyStateBtn'))
        };
    });
    report.check('Copy Text has header, key, and settings lines',
        stateText.hasHeader && stateText.hasKey && stateText.hasSettings && stateText.buttonExists);
    report.check(`Copy Text sequence tokens match the events (${stateText.noteTokens}/${stateText.noteCount} notes, ${stateText.restTokens}/${stateText.restCount} rests)`,
        stateText.noteTokens === stateText.noteCount && stateText.restTokens === stateText.restCount && stateText.hasNames);
    report.check(`Copy Text carries the session log lines (${stateText.logLines} recorded)`,
        stateText.hasLogHeader && stateText.logLines > 0 && stateText.logInText);
    report.check('Copy Text button sits in the utility row above Past Runs, not the stage row',
        stateText.buttonInUtilityRow && !stateText.buttonInStageMeta);

    // Palette line: names the exact degrees in force, from the same core
    // resolution the generator uses, live with the controls.
    const paletteLine = await tab.evaluate(() => {
        const read = () => document.getElementById('paletteLine').textContent || '';
        const freeText = (() => {
            document.querySelector('[data-phrase-style="free"]').click();
            return read();
        })();
        document.querySelector('[data-phrase-style="staff"]').click();
        const stepsText = read();
        const palette = PatternPracticeCore.lessonPalette({
            scaleType: 'major', phraseStyle: 'staff', phraseLesson: 'staff_steps',
            rangeLow: window.staffDebug.settings().rangeLow,
            rangeHigh: window.staffDebug.settings().rangeHigh,
            rangeGovernsLessons: true
        });
        const labels = palette.degrees.map(offset =>
            PatternPracticeCore.offsetToDegree(offset, palette.dp)).join(' ');
        document.querySelector('[data-phrase-style="free"]').click();
        return {
            freeText,
            stepsText,
            stepsMatchesCore: stepsText.includes(labels) && stepsText.includes('single-step motion'),
            freeNamesRange: freeText.includes('your range') && freeText.includes('contour')
        };
    });
    report.check(`palette line names the lesson degrees from the core (\u201c${paletteLine.stepsText}\u201d)`, paletteLine.stepsMatchesCore);
    report.check(`palette line explains the free style (\u201c${paletteLine.freeText}\u201d)`, paletteLine.freeNamesRange);

    const lessonRows = await tab.evaluate(() => {
        document.querySelector('[data-phrase-style="sight"]').click();
        const rows = [...document.querySelectorAll('.staff-lesson-row')]
            .map(row => ({ family: row.dataset.lessonFamily, visible: row.offsetParent !== null }));
        document.querySelector('[data-phrase-style="free"]').click();
        return rows;
    });
    report.check('only the selected style\'s lesson row is visible',
        lessonRows.every(row => row.visible === (row.family === 'sight')));

    // --- Controls: mode buttons and duration invariant ------------------
    await tab.click('[data-staff-mode="scroll"]');
    const afterModeClick = await tab.evaluate(() => window.staffDebug.settings().mode);
    report.check('mode segment switches to scroll', afterModeClick === 'scroll');
    await tab.click('[data-staff-mode="page"]');

    const durationInvariant = await tab.evaluate(async () => {
        const chips = document.querySelectorAll('.staff-duration-row .vf-btn');
        // Deselect everything selectable; the last one must refuse.
        for (const chip of chips) /** @type {HTMLElement} */ (chip).click();
        return window.staffDebug.settings().durationBeats.length;
    });
    report.check('at least one duration always stays enabled', durationInvariant >= 1);

    // --- Chunk geometry: nothing clipped, barlines honest ---------------
    // Eighth notes land in the last half beat of measures and chunks -
    // exactly where glyphs used to draw past their barline or vanish at
    // the chunk seam.
    const chunkGeometry = await tab.evaluate(() => {
        window.staffDebug.settings(); // (no-op read; settings drive below)
        const debug = window.staffDebug;
        const controllerState = debug.settings();
        // Force eighths + quarters and a long page-mode sheet.
        const chips = document.querySelectorAll('.staff-duration-row .vf-btn');
        chips.forEach(chip => {
            const beats = Number(chip.getAttribute('data-duration-beats'));
            const selected = chip.classList.contains('selected');
            if ((beats === 0.5 || beats === 1) !== selected) /** @type {HTMLElement} */ (chip).click();
        });
        debug.setMode('page');
        debug.regenerate();

        /** @type {string[]} */
        const problems = [];
        /** @type {number[]} strip-space barline positions from the DOM */
        const barlineXs = [];
        let glyphCount = 0;
        document.querySelectorAll('.staff-scroll-chunk').forEach(chunk => {
            const svg = chunk.querySelector('svg');
            if (!svg) return;
            const chunkLeft = parseFloat(/** @type {HTMLElement} */(chunk).style.left);
            const svgWidth = svg.width.baseVal.value;
            // Vertical rects are barlines; horizontal ones are staff lines.
            [...svg.querySelectorAll('rect')]
                .filter(rect => rect.width.baseVal.value <= 2 && rect.height.baseVal.value > 20)
                .forEach(rect => barlineXs.push(chunkLeft + rect.x.baseVal.value));
            svg.querySelectorAll('.vf-stavenote').forEach(glyph => {
                glyphCount++;
                const box = /** @type {SVGGraphicsElement} */ (glyph).getBBox();
                if (box.x + box.width > svgWidth) {
                    problems.push(`glyph clipped at ${Math.round(box.x + box.width)}/${svgWidth}`);
                }
            });
        });
        // A NOTEHEAD must sit fully on its own side of every barline
        // (stems and flags may reach past; heads may not). Barlines are
        // read back from the DOM in order, so the k-th unique barline is
        // the boundary after measure k+1; every head must be on the
        // matching side. The old unpadded barline grid put a measure's
        // final eighth PAST its barline.
        const uniqueBarlines = [...new Set(barlineXs.map(x => Math.round(x)))].sort((a, b) => a - b);
        const positions = debug.geometry().notePositions;
        for (const position of positions) {
            uniqueBarlines.forEach((barX, index) => {
                const boundaryBeat = 4 * (index + 1);
                const headHalf = 5;
                if (position.beat < boundaryBeat && position.x + headHalf > barX) {
                    problems.push(`head at beat ${position.beat} crosses barline ${boundaryBeat} (${Math.round(position.x)} vs ${barX})`);
                }
                if (position.beat >= boundaryBeat && position.x - headHalf < barX) {
                    problems.push(`head at beat ${position.beat} behind barline ${boundaryBeat} (${Math.round(position.x)} vs ${barX})`);
                }
            });
        }
        return {
            durationBeats: debug.settings().durationBeats,
            restoredMode: controllerState.mode,
            glyphCount,
            barlineCount: barlineXs.length,
            problems: problems.slice(0, 5)
        };
    });
    report.check(`chunk glyphs never clipped or split across barlines (${chunkGeometry.glyphCount} glyphs, ${chunkGeometry.barlineCount} barlines: ${chunkGeometry.problems.join('; ') || 'clean'})`,
        chunkGeometry.glyphCount > 0 && chunkGeometry.barlineCount > 0 && chunkGeometry.problems.length === 0);

    // Every note of every measure is inside the strip's drawable area:
    // the last events of a chunk used to be cut off by the SVG edge.
    const chunkEdge = await tab.evaluate(() => {
        const events = window.staffDebug.events().filter(event => event.type === 'note');
        const positions = window.staffDebug.geometry().notePositions;
        return { events: events.length, drawn: positions.length };
    });
    report.check(`every generated note is drawn (${chunkEdge.drawn}/${chunkEdge.events})`,
        chunkEdge.drawn === chunkEdge.events && chunkEdge.events > 0);

    // --- Pitch band: dedicated, stable, taller than the staff scale ----
    const pitchBand = await tab.evaluate(() => {
        const debug = window.staffDebug;
        const geometry = debug.geometry();
        const range = debug.pitchRange();
        const overlay = document.querySelector('.staff-scroll-overlay');
        const yTop = debug.zoneYForMidi(range.maxMidi);
        const yBottom = debug.zoneYForMidi(range.minMidi);
        const zonePxPerSemitone = (yBottom - yTop) / (range.maxMidi - range.minMidi);
        const beforeRange = JSON.stringify(range);
        // A wild low sample must not move the band's frame.
        debug.recordTraceSample(1, range.minMidi - 10);
        const afterRange = JSON.stringify(debug.pitchRange());
        return {
            zoneTop: geometry.pitchZoneTop,
            zoneHeight: geometry.pitchZoneHeight,
            overlayHeight: overlay ? /** @type {HTMLElement} */ (overlay).style.height : '',
            insideBand: yTop >= geometry.pitchZoneTop && yBottom <= geometry.pitchZoneTop + geometry.pitchZoneHeight,
            monotonic: debug.zoneYForMidi(60) > debug.zoneYForMidi(61),
            zonePxPerSemitone,
            frameStable: beforeRange === afterRange
        };
    });
    report.check(`pitch band is a dedicated lane under the staff (top ${pitchBand.zoneTop}, height ${pitchBand.zoneHeight}, overlay ${pitchBand.overlayHeight})`,
        pitchBand.zoneTop >= 190 && pitchBand.zoneHeight > 60
        && pitchBand.overlayHeight === `${pitchBand.zoneTop + pitchBand.zoneHeight}px`);
    report.check(`pitch band maps the working range inside itself, high notes up (${pitchBand.zonePxPerSemitone.toFixed(1)}px/semitone)`,
        pitchBand.insideBand && pitchBand.monotonic && pitchBand.zonePxPerSemitone > 3);
    report.check('pitch band frame never rescales from singing', pitchBand.frameStable);

    // The band's contents are independently controllable: "note guides"
    // (the gray right-answer segments) toggle, and the sung blue line
    // has a PLACEMENT - band (default), staff (drawn on the notation's
    // own diatonic grid), or off (sing blind, then review).
    const bandToggles = await tab.evaluate(() => {
        const countRegionPixels = (top, height) => {
            const overlay = /** @type {HTMLCanvasElement} */ (document.querySelector('.staff-scroll-overlay'));
            const geometry = window.staffDebug.geometry();
            const left = Math.round(geometry.headerWidth) + 40;
            const width = overlay.width - left - 2;
            const pixels = overlay.getContext('2d').getImageData(left, top, width, height).data;
            let guides = 0;
            let trace = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                const [r, , b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
                if (a <= 60 || b <= r) continue;
                // Muted slate = guides; strong blue = the sung trace.
                if (b - r < 60) guides++;
                else if (b - r > 150) trace++;
            }
            return { guides, trace };
        };
        const geometry = window.staffDebug.geometry();
        const countBand = () => countRegionPixels(geometry.pitchZoneTop + 16, geometry.pitchZoneHeight - 18);
        const countStaff = () => countRegionPixels(2, geometry.pitchZoneTop - 8);
        /** @param {string} placement */
        const setPlacement = placement => {
            /** @type {HTMLElement} */ (
                document.querySelector(`[data-sung-line="${placement}"]`)).click();
        };
        // Recorded singing so the trace is on screen in this window.
        window.staffDebug.recordTraceSample(2.0, 50);
        window.staffDebug.recordTraceSample(2.5, 51);
        window.staffDebug.recordTraceSample(3.0, 52);
        const bothOn = countBand();
        const staffRegionDefault = countStaff();
        document.getElementById('pitchGuidesToggle').click();
        const guidesOff = countBand();
        document.getElementById('pitchGuidesToggle').click();
        setPlacement('off');
        const traceOff = countBand();
        const staffRegionOff = countStaff();
        setPlacement('staff');
        const bandWithStaffPlacement = countBand();
        const staffRegionOn = countStaff();
        setPlacement('band');
        const stored = SettingsStore.peekData(StorageKeys.STAFF_SETTINGS) || {};
        return {
            bothOn,
            staffRegionDefault,
            guidesOff,
            traceOff,
            staffRegionOff,
            bandWithStaffPlacement,
            staffRegionOn,
            persisted: stored.showPitchGuides === true && stored.sungLinePlacement === 'band',
            inStageMeta: Boolean(document.querySelector('.staff-stage-meta #pitchGuidesToggle'))
                && Boolean(document.querySelector('.staff-stage-meta [data-sung-line]'))
        };
    });
    report.check(`note guides toggle clears only the guides (${bandToggles.bothOn.guides}/${bandToggles.bothOn.trace} -> ${bandToggles.guidesOff.guides}/${bandToggles.guidesOff.trace})`,
        bandToggles.bothOn.guides > 50 && bandToggles.bothOn.trace > 10
        && bandToggles.guidesOff.guides === 0 && bandToggles.guidesOff.trace > 10);
    report.check(`sung line off clears the trace everywhere (band ${bandToggles.traceOff.trace}, staff ${bandToggles.staffRegionOff.trace}, guides stay ${bandToggles.traceOff.guides})`,
        bandToggles.traceOff.trace === 0 && bandToggles.staffRegionOff.trace === 0
        && bandToggles.traceOff.guides > 50);
    report.check(`sung line on the staff draws on the notation, not the band (staff ${bandToggles.staffRegionOn.trace}, band ${bandToggles.bandWithStaffPlacement.trace}; band placement kept it off the staff: ${bandToggles.staffRegionDefault.trace})`,
        bandToggles.staffRegionOn.trace > 10 && bandToggles.bandWithStaffPlacement.trace === 0
        && bandToggles.staffRegionDefault.trace === 0);
    report.check('band controls persist and sit in the stage row under the band',
        bandToggles.persisted && bandToggles.inStageMeta);

    // The stage row owns every display-affecting toggle: note guides,
    // sung line, hear tones, show numbers, and pitch info. The pitch
    // readout itself hides with its toggle and the choice persists.
    const stageToggles = await tab.evaluate(() => {
        const inMeta = id => Boolean(document.querySelector(`.staff-stage-meta #${id}`));
        const readout = document.getElementById('pitchReadout');
        const toggle = document.getElementById('pitchReadoutToggle');
        toggle.click();
        const hiddenAfterOff = readout.hidden;
        const stored = SettingsStore.peekData(StorageKeys.STAFF_SETTINGS) || {};
        const persistedOff = stored.showPitchReadout === false;
        toggle.click();
        return {
            tonesInMeta: inMeta('hearTonesToggle'),
            degreesInMeta: inMeta('showDegreesToggle'),
            pitchToggleInMeta: inMeta('pitchReadoutToggle'),
            hiddenAfterOff,
            persistedOff,
            shownAfterOn: !readout.hidden
        };
    });
    report.check('hear tones and show numbers live in the stage row',
        stageToggles.tonesInMeta && stageToggles.degreesInMeta);
    report.check('pitch info toggle hides the readout, persists, and restores it',
        stageToggles.pitchToggleInMeta && stageToggles.hiddenAfterOff
        && stageToggles.persistedOff && stageToggles.shownAfterOn);

    // --- Stalled clock: missed notes pass silently, never as a burst ---
    const burst = await tab.evaluate(() => {
        const debug = window.staffDebug;
        debug.stopRun(); // reset the clock and firing cursor
        const firedBefore = debug.firedNoteCount();
        const soundedBefore = debug.soundedNoteCount();
        // One giant clock jump = returning to a long-hidden tab.
        debug.setClockBeat(12);
        return {
            firedDelta: debug.firedNoteCount() - firedBefore,
            soundedDelta: debug.soundedNoteCount() - soundedBefore
        };
    });
    report.check(`a stalled clock fires missed notes silently (${burst.firedDelta} fired, ${burst.soundedDelta} sounded)`,
        burst.firedDelta >= 4 && burst.soundedDelta <= 2);

    // --- Audible-onset scheduling: sound lands ON the now-line ---------
    // Notes are handed to the audio layer ahead of their beat with an
    // exact scheduled onset; firing at the crossing itself put Tone's
    // lookAhead plus device latency after the visual moment.
    await tab.waitForFunction(() => Boolean(window.staffDebug.piano()), null, { timeout: 30000 });
    // Scheduling assertions live in the AUDIO clock domain: the registry
    // reports the exact scheduled context time (startAtSeconds), and the
    // fire is bracketed between two context reads. Wall-clock comparisons
    // flake here - under parallel-suite load the context clock advances in
    // bursts, desynchronized from performance.now by tens of ms.
    const audible = await tab.evaluate(() => {
        const debug = window.staffDebug;
        const piano = debug.piano();
        const ctxNow = () => Tone.context.currentTime;
        // The reported output latency fluctuates between reads in this
        // environment, so each assertion uses the compensation the voice
        // RECORDED at schedule time: onset = fire moment (bracketed by
        // two context reads) + inSeconds - that compensation, floored at
        // the 5ms minimum.
        const onsetOk = (voice, ctx0, ctx1, inSec) => {
            if (!voice) return false;
            const expected = Math.max(0.005, inSec - voice.latencyCompensationSeconds);
            return voice.startAtSeconds >= ctx0 + expected - 0.001
                && voice.startAtSeconds <= ctx1 + expected + 0.001
                && voice.latencyCompensationSeconds >= 0
                && voice.latencyCompensationSeconds <= 0.5;
        };
        // Killed voices linger in the registry for the declick fade, so
        // "the voice this fire created" is found by diffing voice ids,
        // never by midi or schedule time (earlier steps play the same
        // pitches, and a stalled context clock reuses schedule times).
        const captureNewVoice = (midi, fire) => {
            const before = new Set(piano.activeVoices().map(v => v.id));
            const ctx0 = ctxNow();
            fire();
            const ctx1 = ctxNow();
            const voice = piano.activeVoices()
                .find(v => v.midi === midi && !before.has(v.id)) || null;
            return { voice, ctx0, ctx1 };
        };

        // Direct scheduling probe: an onset requested 0.4s out must sit
        // in the registry with the matching future start, not "now".
        const probeCapture = captureNewVoice(60, () => piano.playMidiAudibleIn(60, 0.1, 0.4));
        piano.stopAll();

        // Transport lead window: a note fires only once the clock is
        // within audioLeadMs of its beat, with the onset scheduled at
        // beat-crossing minus the reported latency.
        debug.stopRun();
        const noteEvents = debug.events().filter(event => event.type === 'note');
        const first = noteEvents[0];
        const msPerBeat = 60000 / debug.settings().bpm;
        const leadBeats = debug.audioLeadMs() / msPerBeat;
        const firedBefore = debug.firedNoteCount();
        debug.setClockBeat(first.startBeat - leadBeats - 0.05);
        const firedOutsideWindow = debug.firedNoteCount() - firedBefore;
        const fireInSec = (leadBeats / 2) * msPerBeat / 1000;
        const fireCapture = captureNewVoice(first.midi,
            () => debug.setClockBeat(first.startBeat - leadBeats / 2));
        const firedInsideWindow = debug.firedNoteCount() - firedBefore;
        piano.stopAll();
        debug.stopRun();
        return {
            probeOk: onsetOk(probeCapture.voice, probeCapture.ctx0, probeCapture.ctx1, 0.4),
            probeAheadMs: probeCapture.voice
                ? (probeCapture.voice.startAtSeconds - probeCapture.ctx0) * 1000 : null,
            firedOutsideWindow,
            firedInsideWindow,
            scheduledOk: onsetOk(fireCapture.voice, fireCapture.ctx0, fireCapture.ctx1, fireInSec),
            scheduledAheadMs: fireCapture.voice
                ? (fireCapture.voice.startAtSeconds - fireCapture.ctx0) * 1000 : null
        };
    });
    report.check(`piano schedules audible onsets at the requested time (probe +${Math.round(audible.probeAheadMs ?? -1)}ms)`,
        audible.probeOk);
    report.check(`staff fires notes inside the audio lead window with a scheduled onset (${audible.firedOutsideWindow} early, ${audible.firedInsideWindow} in window, onset +${Math.round(audible.scheduledAheadMs ?? -1)}ms)`,
        audible.firedOutsideWindow === 0 && audible.firedInsideWindow >= 1 && audible.scheduledOk);

    // --- Manual audio-lead trim (devices that under-report latency) ----
    const trim = await tab.evaluate(() => {
        const debug = window.staffDebug;
        const piano = debug.piano();
        const ctxNow = () => Tone.context.currentTime;
        const baseLead = debug.audioLeadMs();
        debug.applySettings({ audioOffsetMs: 100 });
        const plusLead = debug.audioLeadMs();
        debug.applySettings({ audioOffsetMs: -100 });
        const minusLead = debug.audioLeadMs();

        // With +100ms trim, a note fires while still outside the untrimmed
        // window and its onset is pulled correspondingly earlier (the trim
        // plus the compensation the voice recorded at schedule time).
        debug.applySettings({ audioOffsetMs: 100 });
        debug.stopRun();
        const first = debug.events().filter(event => event.type === 'note')[0];
        const msPerBeat = 60000 / debug.settings().bpm;
        const firedBefore = debug.firedNoteCount();
        const inSec = (baseLead + 50 - 100) / 1000;
        const before = new Set(piano.activeVoices().map(voice => voice.id));
        const ctx0 = ctxNow();
        debug.setClockBeat(first.startBeat - (baseLead + 50) / msPerBeat);
        const ctx1 = ctxNow();
        const firedInWidenedWindow = debug.firedNoteCount() - firedBefore;
        const scheduled = piano.activeVoices()
            .find(voice => voice.midi === first.midi && !before.has(voice.id)) || null;
        piano.stopAll();
        debug.stopRun();
        debug.applySettings({ audioOffsetMs: 0 });
        const expected = scheduled
            ? Math.max(0.005, inSec - scheduled.latencyCompensationSeconds)
            : null;
        return {
            baseLead,
            plusLead,
            minusLead,
            firedInWidenedWindow,
            scheduledOk: scheduled !== null
                && scheduled.startAtSeconds >= ctx0 + expected - 0.001
                && scheduled.startAtSeconds <= ctx1 + expected + 0.001,
            scheduledAheadMs: scheduled ? (scheduled.startAtSeconds - ctx0) * 1000 : null
        };
    });
    report.check(`audio lead trim widens the window only when positive (${Math.round(trim.baseLead)} -> +${Math.round(trim.plusLead)} / -${Math.round(trim.minusLead)}ms)`,
        Math.abs(trim.plusLead - trim.baseLead - 100) < 1e-6 && Math.abs(trim.minusLead - trim.baseLead) < 1e-6);
    report.check(`audio lead trim fires notes earlier with an earlier onset (${trim.firedInWidenedWindow} fired, onset ${trim.scheduledAheadMs === null ? 'voice-missing' : `+${Math.round(trim.scheduledAheadMs)}ms`})`,
        trim.firedInWidenedWindow >= 1 && trim.scheduledOk);

    // --- Hidden tab pauses the run instead of piling up the clock ------
    await tab.evaluate(() => window.staffDebug.startRun());
    await tab.waitForFunction(() => navigator.mediaSession.playbackState === 'playing', null, { timeout: 10000 });
    const hiddenPause = await tab.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        const status = document.getElementById('statusReadout')?.textContent || '';
        const state = navigator.mediaSession.playbackState;
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        return { status, state };
    });
    report.check(`hiding the tab pauses the run ("${hiddenPause.status}", ${hiddenPause.state})`,
        hiddenPause.state === 'paused' && hiddenPause.status.includes('hidden'));

    // --- No Sing dock: the staff itself owns singing review ------------
    const dockGone = await tab.evaluate(() => ({
        dock: Boolean(document.getElementById('staffSingDock')),
        launch: Boolean(document.querySelector('.pitch-test-launch-button'))
    }));
    report.check('the retired bottom Sing dock is gone from the page',
        !dockGone.dock && !dockGone.launch);

    // --- Pitch band collapses when nothing draws in it -----------------
    const bandCollapse = await tab.evaluate(() => {
        const overlayHeight = () => /** @type {HTMLCanvasElement} */ (
            document.querySelector('.staff-scroll-overlay')).getBoundingClientRect().height;
        /** @param {string} placement */
        const setPlacement = placement => {
            /** @type {HTMLElement} */ (
                document.querySelector(`[data-sung-line="${placement}"]`)).click();
        };
        /** @param {boolean} want */
        const setGuides = want => {
            const el = /** @type {HTMLInputElement} */ (document.getElementById('pitchGuidesToggle'));
            if (el.checked !== want) el.click();
        };
        setGuides(true);
        setPlacement('band');
        const withBand = { height: overlayHeight(), ...window.staffDebug.geometry() };
        // Nothing aims at the band: guides off, sung line on the staff.
        setGuides(false);
        setPlacement('staff');
        const collapsed = {
            height: overlayHeight(),
            visible: window.staffDebug.geometry().pitchBandVisible
        };
        // Either user of the band brings it back on its own.
        setPlacement('band');
        const backViaPlacement = window.staffDebug.geometry().pitchBandVisible;
        setPlacement('staff');
        setGuides(true);
        const backViaGuides = window.staffDebug.geometry().pitchBandVisible;
        setPlacement('band');
        return {
            withBandHeight: withBand.height,
            withBandVisible: withBand.pitchBandVisible,
            zoneTop: withBand.pitchZoneTop,
            zoneHeight: withBand.pitchZoneHeight,
            collapsedHeight: collapsed.height,
            collapsedVisible: collapsed.visible,
            backViaPlacement,
            backViaGuides
        };
    });
    report.check(`pitch band collapses when nothing draws in it (${bandCollapse.withBandHeight}px -> ${bandCollapse.collapsedHeight}px)`,
        bandCollapse.withBandVisible && !bandCollapse.collapsedVisible
        && bandCollapse.withBandHeight === bandCollapse.zoneTop + bandCollapse.zoneHeight
        && bandCollapse.collapsedHeight === bandCollapse.zoneTop);
    report.check('note guides or band placement each bring the band back',
        bandCollapse.backViaPlacement && bandCollapse.backViaGuides);

    // --- Fullscreen: the only mobile route past the browser bars -------
    const fullscreenBefore = await tab.evaluate(() => {
        const btn = document.getElementById('fullscreenBtn');
        return {
            present: Boolean(btn),
            shown: btn ? !btn.hidden : false,
            apiEnabled: document.fullscreenEnabled,
            label: btn ? (btn.textContent || '') : '',
            compact: document.body.classList.contains('staff-compact'),
            inStageMeta: Boolean(document.querySelector('.staff-stage-meta #fullscreenBtn'))
        };
    });
    report.check(`fullscreen button sits in the stage row and shows where the API exists (api ${fullscreenBefore.apiEnabled}, "${fullscreenBefore.label}")`,
        fullscreenBefore.present && fullscreenBefore.inStageMeta
        && fullscreenBefore.shown === fullscreenBefore.apiEnabled
        && fullscreenBefore.label === 'full screen' && !fullscreenBefore.compact);
    await tab.click('#fullscreenBtn');
    await tab.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 5000 });
    const inFullscreen = await tab.evaluate(() => ({
        compact: document.body.classList.contains('staff-compact'),
        headerHidden: getComputedStyle(/** @type {HTMLElement} */ (
            document.getElementById('siteHeader'))).display === 'none',
        label: document.getElementById('fullscreenBtn')?.textContent || ''
    }));
    await tab.click('#fullscreenBtn');
    await tab.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
    const afterExit = await tab.evaluate(() => ({
        compact: document.body.classList.contains('staff-compact'),
        label: document.getElementById('fullscreenBtn')?.textContent || ''
    }));
    report.check(`fullscreen enters the compact layout and hides the header ("${inFullscreen.label}")`,
        inFullscreen.compact && inFullscreen.headerHidden && inFullscreen.label === 'exit full screen');
    report.check('exiting fullscreen restores the normal layout',
        !afterExit.compact && afterExit.label === 'full screen');

    // --- Landscape phones: compact layout gives height to the staff ----
    const landscapeCtx = await browser.newContext({ viewport: { width: 844, height: 390 } });
    const landscapeTab = await landscapeCtx.newPage();
    collectErrors(landscapeTab, 'staff-landscape', report.errors);
    await landscapeTab.goto(`${BASE_URL}/staff.html`, { waitUntil: 'domcontentloaded' });
    await landscapeTab.waitForFunction(() => Boolean(window.staffDebug && window.staffDebug.events().length), null, { timeout: 20000 });
    const landscape = await landscapeTab.evaluate(() => {
        const header = document.getElementById('siteHeader');
        const stop = document.getElementById('stopBtn');
        const stage = document.querySelector('.staff-stage');
        return {
            compact: document.body.classList.contains('staff-compact'),
            headerHidden: header ? getComputedStyle(header).display === 'none' : false,
            stopHeight: stop ? stop.getBoundingClientRect().height : 0,
            stageTop: stage ? stage.getBoundingClientRect().top : -1
        };
    });
    report.check(`landscape short viewport gets the compact layout (transport ${Math.round(landscape.stopHeight)}px tall)`,
        landscape.compact && landscape.headerHidden
        && landscape.stopHeight > 0 && landscape.stopHeight <= 48);
    report.check(`landscape: the staff stage starts right under the slim transport (top ${Math.round(landscape.stageTop)}px)`,
        landscape.stageTop > 0 && landscape.stageTop < 80);
    await landscapeCtx.close();

    // --- Narrow-width layout: controls obey the sizing rules ------------
    // Every control unit sizes to its content (no stretched pills), no
    // unit overlaps another or overflows the grid, every stepper carries
    // its label inside its own shell, and value readouts never wrap.
    const narrowCtx = await browser.newContext({ viewport: { width: 460, height: 900 } });
    const narrowTab = await narrowCtx.newPage();
    collectErrors(narrowTab, 'staff-narrow', report.errors);
    await narrowTab.goto(`${BASE_URL}/staff.html`, { waitUntil: 'domcontentloaded' });
    await narrowTab.waitForFunction(() => Boolean(window.staffDebug && window.staffDebug.events().length), null, { timeout: 20000 });
    const narrow = await narrowTab.evaluate(() => {
        const grid = document.querySelector('.staff-control-grid').getBoundingClientRect();
        const units = Array.from(document.querySelectorAll(
            '.staff-control-grid .step-field, .staff-control-grid .segment-row, .staff-control-grid .display-toggle'))
            .filter(el => el.getClientRects().length > 0);
        const rects = units.map(el => el.getBoundingClientRect());
        let overlaps = 0;
        let overflow = 0;
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            if (rect.left < grid.left - 1 || rect.right > grid.right + 1) overflow++;
            for (let j = i + 1; j < rects.length; j++) {
                const x = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
                const y = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
                if (x > 1 && y > 1) overlaps++;
            }
        }
        const steppers = Array.from(document.querySelectorAll('.staff-control-grid .step-field'));
        const unlabeled = steppers.filter(field => !field.querySelector('.step-label')).length;
        const wrappedValues = Array.from(document.querySelectorAll('.step-value'))
            .filter(el => el.getBoundingClientRect().height > 26).length;
        // Steppers size to content; a stepper spanning most of the grid
        // means the stretch-to-fill special case crept back. (Segment
        // rows may wrap and legitimately fill the row.)
        const stretched = steppers.filter(field =>
            field.getBoundingClientRect().width > grid.width * 0.9).length;
        return { unitCount: units.length, overlaps, overflow, unlabeled, wrappedValues, stretched };
    });
    report.check(`narrow layout: ${narrow.unitCount} control units, no overlap or overflow (${narrow.overlaps}/${narrow.overflow})`,
        narrow.unitCount > 10 && narrow.overlaps === 0 && narrow.overflow === 0);
    report.check(`narrow layout: every stepper carries its label inside its shell (${narrow.unlabeled} unlabeled)`,
        narrow.unlabeled === 0);
    report.check(`narrow layout: value readouts stay on one line, pills never stretch (${narrow.wrappedValues} wrapped, ${narrow.stretched} stretched)`,
        narrow.wrappedValues === 0 && narrow.stretched === 0);
    await narrowCtx.close();

    await browser.close();
    report.finish();
})();
