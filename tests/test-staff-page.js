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
    // Fake mic so the Sing panel's listen start succeeds silently.
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
    // row), one per note under the staff, toggleable.
    const degrees = await tab.evaluate(() => {
        const noteCount = window.staffDebug.events().filter(event => event.type === 'note').length;
        const tokens = [...document.querySelectorAll('.staff-scroll-chunk .degree-token')];
        const labels = tokens.map(el => el.textContent || '');
        const valid = labels.every(label => /^\d+[#b\u2191\u2193]*$/.test(label));
        const toggle = document.getElementById('showDegreesToggle');
        toggle.click();
        const afterOff = document.querySelectorAll('.staff-scroll-chunk .degree-token').length;
        toggle.click();
        return { noteCount, labelCount: labels.length, valid, afterOff };
    });
    report.check(`show numbers draws one shared degree token per note (${degrees.labelCount}/${degrees.noteCount})`,
        degrees.labelCount === degrees.noteCount && degrees.valid);
    report.check('turning show numbers off removes the tokens', degrees.afterOff === 0);

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
        const after = window.staffDebug.geometry().scrollOffset;
        return { before, after, fired: window.staffDebug.firedNoteCount() };
    });
    report.check(`scroll mode moves the strip (offset ${Math.round(scroll.before)} -> ${Math.round(scroll.after)})`, scroll.after > scroll.before);
    report.check(`notes fire as they pass the now-line (${scroll.fired} fired)`, scroll.fired > 0);

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

    // --- Sing panel: the shared docked test chart on the staff page ----
    const singModel = await tab.evaluate(() => {
        window.staffDebug.regenerate();
        const rails = window.staffDebug.singRails(false);
        const targets = window.staffDebug.singTargets();
        const events = window.staffDebug.events().filter(event => event.type === 'note');
        const railMidis = rails.map(rail => rail.midi);
        const bpm = window.staffDebug.settings().bpm;
        const msPerBeat = 60000 / bpm;
        const timingMatches = targets.every((target, index) => {
            const event = events[index];
            return Math.abs(target.startMs - event.startBeat * msPerBeat) < 1e-6
                && Math.abs(target.endMs - (event.startBeat + event.beats) * msPerBeat) < 1e-6;
        });
        return {
            railCount: rails.length,
            targetCount: targets.length,
            noteCount: events.length,
            midisMatch: targets.every((target, index) => target.midi === events[index].midi),
            timingMatches,
            targetsCovered: targets.every(target =>
                target.midi >= Math.min(...railMidis) && target.midi <= Math.max(...railMidis)),
            docked: Boolean(document.querySelector('#staffSingDock .pitch-test-launch-button'))
        };
    });
    report.check(`staff sing targets are the sheet notes (${singModel.targetCount}/${singModel.noteCount})`,
        singModel.targetCount === singModel.noteCount && singModel.targetCount > 0 && singModel.midisMatch);
    report.check('staff sing target timing follows the sheet beats at the current bpm', singModel.timingMatches);
    report.check(`staff sing rails cover every sheet note (${singModel.railCount} rails)`,
        singModel.railCount > 0 && singModel.targetsCovered);
    report.check('staff sing launch button lives in the bottom dock', singModel.docked);

    // Open the panel, sing one note through the sample seam, and check
    // the take scores and records like every other panel page.
    await tab.evaluate(() => {
        window.staffDebug.singPanel().open();
    });
    await tab.waitForFunction(() => {
        const listenBtn = document.getElementById('staffSingListenBtn');
        return listenBtn && listenBtn.textContent.includes('Listening On');
    }, null, { timeout: 10000 });
    const singScored = await tab.evaluate(async () => {
        const panel = window.staffDebug.singPanel();
        // Stop the mic (the fake device beeps forever) and feed samples
        // through the deterministic seam instead.
        document.getElementById('staffSingListenBtn')?.click();
        // Wall-clock mode so unsung target windows pass deterministically.
        document.getElementById('staffSingPauseToggle')?.click();
        const targets = window.staffDebug.singTargets();
        for (let k = 0; k < 5; k++) panel.recordSample(targets[0].midi, 30 + k * 50);
        return {
            open: panel.isOpen,
            recorded: panel.history.length,
            keyLine: document.getElementById('staffSingKey')?.textContent || ''
        };
    });
    report.check(`staff sing panel opens and records samples (${singScored.recorded} samples, "${singScored.keyLine}")`,
        singScored.open && singScored.recorded === 5 && /^Key: /.test(singScored.keyLine));
    await tab.evaluate(() => { window.staffDebug.singPanel().close(); });

    await browser.close();
    report.finish();
})();
