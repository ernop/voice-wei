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

    // Copy Text: the full state as pasteable text - settings plus the
    // generated sequence, token-for-token.
    const stateText = await tab.evaluate(() => {
        const text = window.staffDebug.stateText();
        const events = window.staffDebug.events();
        const noteTokens = (text.match(/(^|\s)[0-9][0-9#b\u2191\u2193]*\.[qhw8]/g) || []).length;
        const restTokens = (text.match(/(^|\s)r\.[qhw8]/g) || []).length;
        return {
            hasHeader: text.includes('Voice-Wei Staff state'),
            hasKey: /key: .+ major|minor|chromatic|pentatonic/.test(text),
            hasSettings: text.includes('tempo:') && text.includes('range:') && text.includes('note values:'),
            noteTokens,
            restTokens,
            noteCount: events.filter(event => event.type === 'note').length,
            restCount: events.filter(event => event.type === 'rest').length,
            hasNames: text.includes('note names: '),
            buttonExists: Boolean(document.getElementById('copyStateBtn'))
        };
    });
    report.check('Copy Text has header, key, and settings lines',
        stateText.hasHeader && stateText.hasKey && stateText.hasSettings && stateText.buttonExists);
    report.check(`Copy Text sequence tokens match the events (${stateText.noteTokens}/${stateText.noteCount} notes, ${stateText.restTokens}/${stateText.restCount} rests)`,
        stateText.noteTokens === stateText.noteCount && stateText.restTokens === stateText.restCount && stateText.hasNames);

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

    // While a run is on the move the TRANSPORT owns the take clock, so
    // the panel and the moving sheet can never split; with no run the
    // panel is self-paced (voice-gated).
    const clockSync = await tab.evaluate(async () => {
        const debug = window.staffDebug;
        debug.stopRun();
        const idleClock = debug.singTakeClockMs();
        const historyBeforeStart = debug.singPanel().history.length; // 5 from above
        await debug.startRun();
        const bpm = debug.settings().bpm;
        debug.setClockBeat(8);
        const runningClock = debug.singTakeClockMs();
        const historyAfterStart = debug.singPanel().history.length;
        debug.stopRun();
        const clockAfterStop = debug.singTakeClockMs();
        const historyAfterStop = debug.singPanel().history.length;
        return {
            idleClock,
            historyBeforeStart,
            runningClock,
            expectedRunningClock: 8 * (60000 / bpm),
            historyAfterStart,
            clockAfterStop,
            historyAfterStop
        };
    });
    report.check(`staff sing take clock is voice-gated with no run (${clockSync.idleClock})`,
        clockSync.idleClock === null);
    report.check(`staff sing take clock follows the transport mid-run (${clockSync.runningClock}ms at beat 8)`,
        clockSync.runningClock === clockSync.expectedRunningClock);
    report.check(`starting a run resets the open take so they begin together (${clockSync.historyBeforeStart} -> ${clockSync.historyAfterStart} samples)`,
        clockSync.historyBeforeStart === 5 && clockSync.historyAfterStart === 0);
    report.check(`stopping the run hands the clock back and starts a fresh take (clock ${clockSync.clockAfterStop}, ${clockSync.historyAfterStop} samples)`,
        clockSync.clockAfterStop === null && clockSync.historyAfterStop === 0);
    await tab.evaluate(() => { window.staffDebug.singPanel().close(); });

    await browser.close();
    report.finish();
})();
