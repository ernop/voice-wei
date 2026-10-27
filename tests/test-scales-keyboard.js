// @ts-check
// The Scales keyboard and the page around it. PianoKeyboard.buildModel
// decides every musical fact of the board (span, three scale notes of
// context each way, white-key edges, degrees, key-aware spelling,
// microtone markers, exact lookup); the view draws it edge to edge, lights
// exactly what sounds, and keeps every label inside its key at phone
// width; the page keeps the owner display rules, the buttons' words, its
// settings round trips (Reset, voice commands, presets, history), and an
// honest transport state for the car's play/pause toggle.

const { BASE_URL, launchWithMic, collectErrors, installGrayTextScan, createReporter } = require('./helpers');

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const WAIT = { timeout: 10000, polling: 50 };

/** @param {import('playwright').Page} tab */
function waitForScalesReady(tab) {
    return tab.waitForFunction(() => navigator.mediaSession.metadata?.title === 'Scales', null, WAIT);
}

(async () => {
    const report = createReporter('scales keyboard');
    const browser = await launchWithMic();
    const context = await browser.newContext({ viewport: DESKTOP, permissions: ['microphone'] });
    const tab = await context.newPage();
    collectErrors(tab, 'scales-keyboard', report.errors);
    await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
    await waitForScalesReady(tab);

    // ============ MODEL ============
    const model = await tab.evaluate(() => {
        /** @param {string} root @param {number} octave @param {string} scaleType @param {number[]} notes */
        const build = (root, octave, scaleType, notes) => PianoKeyboard.buildModel({ root, octave, scaleType, notes });
        const cMajor = build('C', 4, 'major', [60, 62, 64, 65, 67, 69, 71, 72]);
        const ebMajor = build('D#', 3, 'major', [51, 53, 55, 56, 58, 60, 62, 63]);
        const rast = build('C', 4, 'rast', [60, 62, 63.5, 65, 67, 69, 70.5, 72]);
        const quarter = build('C', 4, 'quarter_tone', Array.from({ length: 25 }, (_, i) => 60 + i / 2));
        /** @param {PianoKeyboardModel} board @param {number} midi */
        const key = (board, midi) => board.keys.find(k => k.midi === midi);
        /** @param {() => unknown} fn */
        const throws = fn => {
            try { fn(); } catch (_) { return true; }
            return false;
        };
        /** @param {PianoKeyboardModel} board @param {number} midi */
        const markerBetweenKeys = (board, midi) => {
            const marker = PianoKeyboard.noteAt(board, midi);
            return marker !== null
                && marker.center > key(board, Math.floor(midi)).center
                && marker.center < key(board, Math.ceil(midi)).center;
        };
        const ebEdges = [ebMajor.keys[0], ebMajor.keys[ebMajor.keys.length - 1]];
        const cNotes = [60, 62, 64, 65, 67, 69, 71, 72];
        const wide = PianoKeyboard.buildModel({ root: 'C', octave: 4, scaleType: 'major', notes: cNotes, whiteKeys: 24 });
        const plain = wide.keys.filter(k => k.midi < cMajor.lowMidi || k.midi > cMajor.highMidi);
        /** @param {PianoKeyboardKey[]} keys */
        const faces = keys => keys.map(k => `${k.midi}${k.label}${k.degree}${k.inSpan}${k.tonic}`).join(' ');
        const nearLow = PianoKeyboard.buildModel({ root: 'F', octave: 1, scaleType: 'major', notes: [29, 41], whiteKeys: 30 });
        const nearHigh = PianoKeyboard.buildModel({ root: 'G', octave: 6, scaleType: 'major', notes: [91, 103], whiteKeys: 30 });
        /** @param {PianoKeyboardModel} board @param {number} from @param {number} to */
        const labels = (board, from, to) => board.keys.filter(k => k.midi >= from && k.midi <= to).map(k => k.label).join(' ');
        const bbChromatic = build('A#', 2, 'chromatic', Array.from({ length: 13 }, (_, i) => 46 + i));
        const cChromatic = build('C', 4, 'chromatic', Array.from({ length: 13 }, (_, i) => 60 + i));
        const bbRast = build('A#', 3, 'rast', [58, 60, 61.5, 63, 65, 67, 68.5, 70]);
        return {
            wideRange: `${wide.lowMidi}-${wide.highMidi}, ${wide.whiteCount} white`,
            plainLabels: plain.filter(k => k.label).map(k => k.label).join(' '),
            plainBare: plain.every(k => k.degree === null && !k.tonic && !k.inSpan),
            labeledKept: faces(wide.keys.filter(k => !plain.includes(k))) === faces(cMajor.keys),
            pianoEnds: `${nearLow.lowMidi} ${nearLow.whiteCount}, ${nearHigh.highMidi} ${nearHigh.whiteCount}`,
            bbChromatic: labels(bbChromatic, 46, 58),
            cChromatic: labels(cChromatic, 60, 66),
            bbRast: [58, 63].map(midi => `${key(bbRast, midi).degree}${key(bbRast, midi).label}`).join(' '),
            cRange: `${cMajor.lowMidi}-${cMajor.highMidi}, ${cMajor.whiteCount} white`,
            cDegrees: cMajor.keys.filter(k => k.degree !== null).map(k => `${k.degree}${k.label}`).join(' '),
            cInSpan: cMajor.keys.filter(k => k.inSpan).map(k => k.midi).join(','),
            cTonics: cMajor.keys.filter(k => k.tonic).map(k => k.midi).join(','),
            cSharp: key(cMajor, 61).label,
            cBlackUnnumbered: [61, 63, 66, 68, 70].every(midi => key(cMajor, midi).degree === null),
            ebRange: `${ebMajor.lowMidi}-${ebMajor.highMidi}`,
            ebEdges: ebEdges.map(k => `${k.label}${k.black ? ' black' : ''}${k.degree === null ? '' : ` ${k.degree}`}`).join(' | '),
            ebContext: [46, 48, 68].map(midi => `${key(ebMajor, midi).degree}${key(ebMajor, midi).label}`).join(' '),
            ebOffScale: key(ebMajor, 66).label,
            rastMarkers: rast.markers.map(m => `${m.midi}:${m.degree}${m.inSpan ? '' : ' context'}`).join(' '),
            rastLabels: rast.markerLabels,
            rastPlainE: key(rast, 64).degree,
            rastBetween: markerBetweenKeys(rast, 63.5) && markerBetweenKeys(rast, 70.5),
            quarterTicks: quarter.markers.length > 0 && !quarter.markerLabels,
            lookup: [
                PianoKeyboard.noteAt(cMajor, 60)?.pitch, PianoKeyboard.noteAt(cMajor, 72)?.pitch,
                PianoKeyboard.noteAt(cMajor, 84), PianoKeyboard.noteAt(cMajor, 60.5),
                PianoKeyboard.noteAt(rast, 63.5)?.degree, PianoKeyboard.noteAt(rast, 63.4)
            ],
            rejectsEmpty: throws(() => build('C', 4, 'major', [])),
            rejectsRoot: throws(() => build('H', 4, 'major', [60]))
        };
    });
    report.check(`C4 major spans the octave plus three degrees each way (${model.cRange}; ${model.cDegrees})`,
        model.cRange === '55-77, 14 white'
        && model.cDegrees === '5G 6A 7B 1C4 2D 3E 4F 5G 6A 7B 8C5 2D 3E 4F'
        && model.cInSpan === '60,61,62,63,64,65,66,67,68,69,70,71,72'
        && model.cTonics === '60,72');
    report.check(`off-scale keys carry no degree and spell with the key's accidentals (C major ${model.cSharp}, Eb major ${model.ebOffScale})`,
        model.cBlackUnnumbered && model.cSharp === 'C#' && model.ebOffScale === 'Gb');
    report.check(`a board whose context ends on black keys extends to white edges (Eb3 major ${model.ebRange}: ${model.ebEdges}; context ${model.ebContext})`,
        model.ebRange === '45-69' && model.ebEdges === 'A | A' && model.ebContext === '5Bb 6C3 4Ab');
    report.check(`microtonal degrees are markers between their keys (rast ${model.rastMarkers}; plain E unnumbered: ${model.rastPlainE === null})`,
        model.rastMarkers === '58.5:7 context 63.5:3 70.5:7 75.5:3 context'
        && model.rastLabels && model.rastPlainE === null && model.rastBetween);
    report.check('quarter-tone markers too close to label show bare ticks', model.quarterTicks);
    report.check(`lookup is exact: no other octave, no neighbor (${JSON.stringify(model.lookup)})`,
        JSON.stringify(model.lookup) === JSON.stringify(['C4', 'C5', null, null, 3, null]));
    report.check('a board needs a known root and at least one note', model.rejectsEmpty && model.rejectsRoot);
    report.check(`room for more keys fills with plain piano on both sides: no degrees, only C keys named, the labeled part unchanged (C4 major in 24 white keys: ${model.wideRange}; named ${model.plainLabels})`,
        model.wideRange === '47-86, 24 white' && model.plainLabels === 'C3 C6' && model.plainBare && model.labeledKept);
    report.check(`plain piano stops at A0 and C8 and grows on the other side (F1 major low ${model.pianoEnds})`,
        model.pianoEnds === '21 30, 108 30');
    report.check(`a scale with no letter pattern spells with its root's accidentals (Bb chromatic ${model.bbChromatic}; C chromatic ${model.cChromatic}; Bb rast ${model.bbRast})`,
        model.bbChromatic === 'Bb B C3 Db D Eb E F Gb G Ab A Bb' && model.cChromatic === 'C4 C# D D# E F F#'
        && model.bbRast === '1Bb 4Eb');

    const coverage = await tab.evaluate(() => {
        const c = window.scalesController;
        /** @param {string} name */
        const values = name => [...document.querySelectorAll(`[data-${name}]`)].map(el => el.getAttribute(`data-${name}`));
        /** @type {string[]} */
        const failures = [];
        let boards = 0;
        /** @param {string} label @param {Partial<ScalesSettings>} overrides */
        const show = (label, overrides) => {
            Object.assign(c.settings, c.defaultSettings, overrides);
            c.showIdle();
            boards++;
            const board = c.keyboard.model;
            const notes = c.patternNotes(0);
            const undrawn = notes.filter(midi => PianoKeyboard.noteAt(board, midi) === null);
            const numbered = [...board.keys, ...board.markers].filter(note => note.degree !== null);
            const below = numbered.filter(note => note.midi < board.spanLow - 1e-6).length;
            const above = numbered.filter(note => note.midi > board.spanHigh + 1e-6).length;
            const exactSpan = board.spanLow === Math.min(...notes) && board.spanHigh === Math.max(...notes);
            if (undrawn.length || below < PianoKeyboard.CONTEXT_DEGREES || above < PianoKeyboard.CONTEXT_DEGREES || !exactSpan) {
                failures.push(`${label}: undrawn [${undrawn.join(',')}], context ${below} below / ${above} above, span ${board.spanLow}-${board.spanHigh}`);
            }
        };
        for (const scaleType of values('scale-type')) {
            for (const sectionLength of values('section-length')) {
                for (const movementStyle of values('movement')) {
                    show(`${scaleType} ${sectionLength} ${movementStyle}`, { scaleType, sectionLength, movementStyle, direction: 'both' });
                }
                for (const ladder of ['on', 'reverse']) {
                    show(`${scaleType} ${sectionLength} ${ladder} ladder`, { scaleType, sectionLength, ladder, ladderSize: 4 });
                }
            }
            for (const direction of values('direction')) show(`${scaleType} ${direction}`, { scaleType, direction });
            for (const exercise of values('exercise')) show(`${scaleType} ${exercise}`, { scaleType, exercise });
        }
        Object.assign(c.settings, c.defaultSettings);
        c.onSettingChanged();
        return { boards, failures };
    });
    report.check(`every planned note is drawn, with three scale degrees of context each way (${coverage.boards} boards${coverage.failures.length ? `; ${coverage.failures.length} fail: ${coverage.failures.slice(0, 3).join('; ')}` : ''})`,
        coverage.boards > 1000 && coverage.failures.length === 0);

    // ============ VIEW ============
    const view = await tab.evaluate(() => {
        const c = window.scalesController;
        const host = document.getElementById('pianoKeyboard');
        const hostBox = host.getBoundingClientRect();
        const whites = [...host.querySelectorAll('.kb-white')].map(el => el.getBoundingClientRect());
        const bar = host.querySelector('.kb-span').getBoundingClientRect();
        const c4 = host.querySelector('.kb-key[data-midi="60"]').getBoundingClientRect();
        const c5 = host.querySelector('.kb-key[data-midi="72"]').getBoundingClientRect();
        c.showSounding([64]);
        const lit = [...host.querySelectorAll('.kb-sounding')].map(el => /** @type {HTMLElement} */ (el).dataset.midi).join(',');
        const readout = document.getElementById('pianoReadoutNotes').textContent;
        c.showSounding([]);
        return {
            drawn: host.querySelectorAll('.kb-key').length === c.keyboard.model.keys.length,
            gaps: `${Math.round(Math.min(...whites.map(b => b.left)) - hostBox.left)}/${Math.round(hostBox.right - Math.max(...whites.map(b => b.right)))}`,
            barOnSpan: Math.abs(bar.left - c4.left) <= 1 && Math.abs(bar.right - c5.right) <= 1,
            lit,
            readout,
            litAfter: host.querySelectorAll('.kb-sounding').length,
            plan: document.getElementById('pianoReadoutPlan').textContent
        };
    });
    report.check(`the board draws every key edge to edge with the span bar over the played keys (side gaps ${view.gaps}px)`,
        view.drawn && view.gaps === '0/0' && view.barOnSpan);
    report.check(`a sounding note lights only its key and the readout names it with its degree ("${view.readout}", lit ${view.lit})`,
        view.lit === '64' && view.readout === '3E4' && view.litAfter === 0);
    report.check(`at rest the readout names what Play plays ("${view.plan}")`, view.plan === 'C4 major \u00b7 up');

    await tab.evaluate(() => {
        const c = window.scalesController;
        window.__taps = [];
        const sound = c.soundSingleNote.bind(c);
        c.soundSingleNote = (midi, duration) => {
            sound(midi, duration);
            window.__taps.push({ midi, lit: c.keyboard.sounding.join(','), readout: document.getElementById('pianoReadoutNotes').textContent });
        };
    });
    await tab.click('#pianoKeyboard .kb-key[data-midi="62"]');
    await tab.waitForFunction(() => window.__taps.length === 1, null, WAIT);
    await tab.waitForFunction(() => window.scalesController.keyboard.sounding.length === 0, null, WAIT);
    const tap = await tab.evaluate(() => {
        delete window.scalesController.soundSingleNote;
        return window.__taps[0];
    });
    report.check(`a tapped key sounds and lights itself, then the board returns to rest (${tap.midi}, lit ${tap.lit}, "${tap.readout}")`,
        tap.midi === 62 && tap.lit === '62' && tap.readout === '2D4');

    // The board as the current width fits it, once the refit a resize
    // schedules has run: white-key width, and the plain white keys beyond
    // the labeled part on each side.
    const fitted = () => tab.evaluate(async () => {
        const c = window.scalesController;
        const host = document.getElementById('pianoKeyboard');
        const shown = c.settingsShown();
        const labeled = PianoKeyboard.buildModel({
            root: NOTE_NAMES[midiPitchClass(shown.rootMidi)], octave: midiOctave(shown.rootMidi),
            scaleType: shown.scaleType, notes: c.patternNotes(0)
        });
        // As many 48px keys as fit, or the labeled board when it needs more
        const settled = () => c.keyboard.model.whiteCount === Math.max(labeled.whiteCount, Math.floor(host.clientWidth / 48));
        for (let frame = 0; frame < 10 && (frame < 3 || !settled()); frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        const board = c.keyboard.model;
        /** @param {(midi: number) => boolean} beyond */
        const plainWhite = beyond => board.keys.filter(k => !k.black && beyond(k.midi)).length;
        return {
            settled: settled(),
            whitePx: host.clientWidth / board.whiteCount,
            below: plainWhite(midi => midi < labeled.lowMidi),
            above: plainWhite(midi => midi > labeled.highMidi)
        };
    });
    /** @param {{ settled: boolean, whitePx: number, below: number, above: number }} fit */
    const fitText = fit => `${fit.whitePx.toFixed(1)}px keys, plain ${fit.below}+${fit.above}${fit.settled ? '' : ' (not refit)'}`;
    /** @param {{ settled: boolean, whitePx: number }} fit */
    const natural = fit => fit.settled && fit.whitePx >= 48 && fit.whitePx < 52;
    const desktopFit = await fitted();

    await tab.setViewportSize(PHONE);
    const phoneFit = await fitted();
    const phone = await tab.evaluate(() => {
        const c = window.scalesController;
        const host = document.getElementById('pianoKeyboard');
        const overflowing = () => [...host.querySelectorAll('.kb-key, .kb-marker')].flatMap(el => {
            const box = el.getBoundingClientRect();
            return [...el.children].filter(label => {
                const b = label.getBoundingClientRect();
                return b.width > 0 && (b.left < box.left - 0.5 || b.right > box.right + 0.5);
            }).map(label => `${el.getAttribute('aria-label')} "${label.textContent}"`);
        });
        /** @type {[string, Partial<ScalesSettings>][]} */
        const boards = [
            ['C4 major', {}],
            ['B4 major 2 octaves', { root: 'B', sectionLength: '2o' }],
            ['Eb3 minor 2 octaves', { root: 'D#', octave: 3, scaleType: 'minor', sectionLength: '2o' }],
            ['C4 chromatic 2 octaves', { scaleType: 'chromatic', sectionLength: '2o' }],
            ['C4 quarter tone', { scaleType: 'quarter_tone' }],
            ['C4 rast', { scaleType: 'rast' }]
        ];
        const results = boards.map(([label, overrides]) => {
            Object.assign(c.settings, c.defaultSettings, overrides);
            c.showIdle();
            return { label, narrow: host.classList.contains('kb-narrow'), overflow: overflowing() };
        });
        Object.assign(c.settings, c.defaultSettings, { sectionLength: '2o' });
        c.showIdle();
        return { results, twoOctavesNarrow: host.classList.contains('kb-narrow') };
    });
    const overflow = phone.results.flatMap(result => result.overflow.map(text => `${result.label}: ${text}`));
    report.check(`at phone width every key and marker label stays inside its key (narrow boards: ${phone.results.filter(r => r.narrow).map(r => r.label).join(', ') || 'none'}${overflow.length ? `; overflow ${overflow.slice(0, 4).join('; ')}` : ''})`,
        overflow.length === 0);
    await tab.setViewportSize(DESKTOP);
    const widenedFit = await fitted();
    const widened = await tab.evaluate(() => document.getElementById('pianoKeyboard').classList.contains('kb-narrow'));
    report.check(`black-key names drop on a narrow board and return when it widens (phone ${phone.twoOctavesNarrow}, desktop ${widened})`,
        phone.twoOctavesNarrow && !widened);
    report.check(`keys keep a piano's proportions: a wide screen shows more piano around the scale, a phone just the scale and its context, refit on resize (desktop ${fitText(desktopFit)}; phone ${fitText(phoneFit)}; two octaves widened ${fitText(widenedFit)})`,
        natural(desktopFit) && desktopFit.below + desktopFit.above > 0 && Math.abs(desktopFit.below - desktopFit.above) <= 1
        && phoneFit.settled && phoneFit.below + phoneFit.above === 0 && natural(widenedFit));

    // ============ PAGE: owner display rules ============
    await tab.evaluate(installGrayTextScan);
    await tab.click('.voice-settings-section summary');
    const gray = await tab.evaluate(() => {
        const c = window.scalesController;
        /** @type {Record<string, string[]>} */
        const scans = {};
        Object.assign(c.settings, c.defaultSettings);
        c.onSettingChanged();
        scans.rest = window.__scanGrayText();
        c.showSounding([64]);
        scans.sounding = window.__scanGrayText();
        Object.assign(c.settings, c.defaultSettings, { scaleType: 'rast' });
        c.onSettingChanged();
        c.showSounding([63.5]);
        scans.markers = window.__scanGrayText();
        Object.assign(c.settings, c.defaultSettings);
        c.onSettingChanged();

        c.addToHistory(c.settingsCommand(), 'c major scale');
        c.history.add({ type: 'error', message: 'Could not copy the history', details: { error: 'denied' }, timestamp: new Date() });
        c.saveCurrentAsPreset('warm-up');
        c.voiceCore.transcript.show('c major scale');
        /** @type {HTMLElement} */ (document.getElementById('showSequenceToggle')).click();
        scans.panels = window.__scanGrayText();
        /** @type {HTMLElement} */ (document.getElementById('useAbbrevToggle')).click();
        scans.abbreviated = window.__scanGrayText();
        /** @type {HTMLElement} */ (document.getElementById('useAbbrevToggle')).click();

        c.loadFailure = 'Piano failed to load. Refresh to retry.';
        c.showIdle();
        scans.loadFailure = window.__scanGrayText();
        c.loadFailure = null;
        c.showIdle();
        return Object.entries(scans).flatMap(([state, offenders]) => offenders.map(text => `${state}: ${text}`));
    });
    await tab.click('#singBtn');
    await tab.waitForFunction(() => document.getElementById('scalesSingListenBtn')?.textContent.includes('Listening On'), null, WAIT);
    const singGray = await tab.evaluate(() => window.__scanGrayText().map(text => `sing panel: ${text}`));
    await tab.click('#singBtn');
    await tab.setViewportSize(PHONE);
    const phoneGray = await tab.evaluate(() => window.__scanGrayText().map(text => `phone: ${text}`));
    await tab.setViewportSize(DESKTOP);
    const offenders = [...gray, ...singGray, ...phoneGray];
    report.check(`no gray or dimmed text in any state: rest, sounding, markers, panels, abbreviations, load failure, Sing, phone (${offenders.length} offenders${offenders.length ? ': ' + offenders.slice(0, 5).join('; ') : ''})`,
        offenders.length === 0);

    /** @param {string} label */
    const measureRows = label => tab.evaluate(rowsLabel => {
        const c = window.scalesController;
        /** @type {HTMLElement} */ (document.getElementById('clearHistoryBtn')).click();
        Object.assign(c.settings, c.defaultSettings);
        c.addToHistory(c.settingsCommand(), null);
        Object.assign(c.settings, {
            root: 'F#', scaleType: 'harmonic_minor', direction: 'down_and_up', sectionLength: '1o+5',
            movementStyle: 'seventh_down', ladder: 'reverse', ladderSize: 6, ladderGapMs: 1500,
            repeatCount: Infinity, repeatGapMs: 0, noteLengthMs: 1000, gapMs: 300
        });
        c.addToHistory(c.settingsCommand(), 'f sharp harmonic minor down and up sevenths down reverse ladder of six forever no gap very slowly with a large gap');
        c.history.add({ type: 'error', message: 'Unhandled Promise Rejection: a long reason that keeps on going well past the width of a phone', details: {}, timestamp: new Date() });
        c.presets.splice(0);
        c.saveCurrentAsPreset('a long name for a saved config that runs on');
        c.saveCurrentAsPreset('');
        Object.assign(c.settings, c.defaultSettings);
        c.onSettingChanged();
        c.saveCurrentAsPreset('');
        // One line: each text lays out in a single line box, and every
        // text in the row shares that line.
        /** @param {Element} row */
        const isOneLine = row => {
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            const centers = [];
            while (walker.nextNode()) {
                if (!walker.currentNode.textContent.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
                if (new Set(rects.map(rect => Math.round(rect.top))).size > 1) return false;
                centers.push(...rects.map(rect => rect.top + rect.height / 2));
            }
            return centers.length > 0 && Math.max(...centers) - Math.min(...centers) <= 6;
        };
        /** @param {string} selector */
        const rows = selector => [...document.querySelectorAll(selector)].map(row => ({
            height: Math.round(row.getBoundingClientRect().height),
            oneLine: isOneLine(row)
        }));
        const history = rows('#historyList .history-item');
        const presets = rows('#presetList .preset-item');
        return {
            label: rowsLabel,
            history: history.map(row => `${row.height}${row.oneLine ? '' : ' wrapped'}`).join('/'),
            presets: presets.map(row => `${row.height}${row.oneLine ? '' : ' wrapped'}`).join('/'),
            oneLine: [history, presets].every(list => list.length === 3 && list.every(row => row.oneLine))
        };
    }, label);
    const desktopRows = await measureRows('desktop');
    await tab.setViewportSize(PHONE);
    const phoneRows = await measureRows('phone');
    await tab.setViewportSize(DESKTOP);
    report.check(`history and preset rows stay one line with long text (desktop ${desktopRows.history} / ${desktopRows.presets}px, phone ${phoneRows.history} / ${phoneRows.presets}px)`,
        desktopRows.oneLine && phoneRows.oneLine);

    const words = await tab.evaluate(() => {
        const c = window.scalesController;
        /** @type {Record<string, string>} */
        const attributes = { sectionLength: 'section-length', direction: 'direction', movementStyle: 'movement', exercise: 'exercise', risingSemitones: 'rising' };
        /** @type {string[]} */
        const mismatches = [];
        let compared = 0;
        /** @param {Element} btn @param {string} expected */
        const compare = (btn, expected) => {
            compared++;
            const full = /** @type {HTMLElement} */ (btn).dataset.full;
            if (full !== expected) mismatches.push(`${btn.outerHTML.match(/data-[a-z-]+="[^"]*"/)?.[0]}: "${expected}" vs "${full}"`);
        };
        for (const [setting, attribute] of Object.entries(attributes)) {
            document.querySelectorAll(`.vf-btn[data-${attribute}]`).forEach(btn => {
                const value = btn.getAttribute(`data-${attribute}`);
                // Rising off has no words: descriptions leave it out.
                if (setting === 'risingSemitones' && value === '0') return;
                compare(btn, SCALES_OPTION_LABELS[setting][value]);
            });
        }
        document.querySelectorAll('.vf-btn[data-repeat]').forEach(btn => {
            const { repeatCount, repeatGapMs } = c.parseRepeatButtonValue(btn.getAttribute('data-repeat'));
            compare(btn, scalesRepeatLabel(repeatCount, repeatGapMs ?? c.settings.repeatGapMs));
        });
        document.querySelectorAll('.vf-btn[data-scale-type]').forEach(btn => {
            compare(btn, btn.getAttribute('data-scale-type').replace(/_/g, ' '));
        });
        return { compared, mismatches };
    });
    report.check(`descriptions use each option button's own words (${words.compared} buttons${words.mismatches.length ? '; ' + words.mismatches.join('; ') : ''})`,
        words.compared > 40 && words.mismatches.length === 0);

    // ============ PAGE: settings round trips ============
    await tab.click('.vf-btn[data-direction="descending"]');
    await tab.click('label:has(#useAbbrevToggle)');
    await tab.click('.step-btn[data-step-key="voiceRate"][data-step-delta="1"]');
    await tab.click('#resetBtn');
    const afterReset = await tab.evaluate(() => {
        const c = window.scalesController;
        return `${c.settings.direction} abbrev=${c.settings.useAbbrev} rate=${c.voiceCore.settings.voiceRate}`;
    });
    await tab.reload({ waitUntil: 'networkidle' });
    await waitForScalesReady(tab);
    const afterReload = await tab.evaluate(() => {
        const c = window.scalesController;
        return `${c.settings.direction} abbrev=${c.settings.useAbbrev} rate=${c.voiceCore.settings.voiceRate}`;
    });
    report.check(`Reset restores the practice settings and keeps the preferences, across a reload (${afterReset}; reloaded ${afterReload})`,
        afterReset === 'ascending abbrev=true rate=1.1' && afterReload === afterReset);
    await tab.click('label:has(#useAbbrevToggle)');

    const voice = await tab.evaluate(async () => {
        const c = window.scalesController;
        /** @param {string} text */
        const say = async text => {
            // Not awaited: a forever loop's command never finishes.
            c.voiceCore.handleVoiceCommand(text);
            await new Promise(resolve => setTimeout(resolve, 150));
        };
        /** @param {string} attribute */
        const selected = attribute => [...document.querySelectorAll(`.vf-btn[${attribute}].selected`)]
            .map(btn => btn.getAttribute(attribute)).join(',');
        const plan = () => document.getElementById('pianoReadoutPlan').textContent;

        await say('d major five note warmup');
        const warmup = `${selected('data-exercise')} shifting=${selected('data-shifting')} repeat=${selected('data-repeat')} playing=${c.audio.isPlaying} "${plan()}"`;
        c.stopPlayback();
        await say('c major two octaves');
        const notes = c.patternNotes(0);
        const twoOctaves = `${selected('data-section-length')} ${notes[0]}-${notes[notes.length - 1]} "${plan()}"`;
        c.stopPlayback();
        await say('g major rising');
        const rising = `rising=${selected('data-rising')} repeat=${selected('data-repeat')}`;
        c.stopPlayback();
        await say('e sharp major');
        const eSharp = c.settings.root;
        c.stopPlayback();
        const spelled = ['c flat major', 'b sharp minor', 'f flat major'].map(text => c.parseScaleCommand(text).root).join(',');
        await say('random');
        const stored = SettingsStore.peekData(StorageKeys.SCALES_SETTINGS);
        const randomKept = ['root', 'scaleType', 'direction', 'movementStyle', 'risingSemitones', 'noteLengthMs']
            .every(key => stored[key] === (c.settings[key] === Infinity ? -1 : c.settings[key]));
        c.stopPlayback();
        return { warmup, twoOctaves, rising, eSharp, spelled, randomKept };
    });
    report.check(`a spoken exercise shows on its buttons and the readout (${voice.warmup})`,
        voice.warmup === 'five_note shifting=1 repeat=Infinity playing=true "D4 major \u00b7 up \u00b7 5-note \u00b7 shifting \u00b7 repeat \u221e"');
    report.check(`"two octaves" sets the section width and plays it (${voice.twoOctaves})`,
        voice.twoOctaves === '2o 60-84 "C4 major \u00b7 up \u00b7 2 octaves"');
    report.check(`spoken rising repeats forever (${voice.rising})`, voice.rising === 'rising=1 repeat=Infinity');
    report.check(`spoken E sharp, C flat, B sharp, F flat name real keys (${voice.eSharp}; ${voice.spelled})`,
        voice.eSharp === 'F' && voice.spelled === 'B,C,E');
    report.check('spoken random persists what it picked', voice.randomKept);

    const movementRule = await tab.evaluate(async () => {
        const c = window.scalesController;
        /** @param {string} attribute */
        const selected = attribute => [...document.querySelectorAll(`.vf-btn[${attribute}].selected`)]
            .map(btn => btn.getAttribute(attribute)).join(',');
        Object.assign(c.settings, c.defaultSettings);
        c.onSettingChanged();
        /** @type {HTMLElement} */ (document.querySelector('.vf-btn[data-chop-head="1"]')).click();
        /** @type {HTMLElement} */ (document.querySelector('.vf-btn[data-movement="neighbors"]')).click();
        const clicked = `${selected('data-movement')} chop=${selected('data-chop-head')}`;
        /** @type {HTMLElement} */ (document.querySelector('.vf-btn[data-ladder="on"]')).click();
        await c.voiceCore.handleVoiceCommand('neighbors');
        const spoken = `${selected('data-movement')} ladder=${selected('data-ladder')}`;
        await c.voiceCore.handleVoiceCommand('4 u');
        const leap = selected('data-movement');
        Object.assign(c.settings, c.defaultSettings);
        c.onSettingChanged();
        return { clicked, spoken, leap };
    });
    report.check(`a movement figure turns chop head and the ladder off, by button or by voice (clicked ${movementRule.clicked}; spoken ${movementRule.spoken}; "4 u" ${movementRule.leap})`,
        movementRule.clicked === 'neighbors chop=0' && movementRule.spoken === 'neighbors ladder=off'
        && movementRule.leap === 'fourth_up');

    await tab.click('.vf-btn[data-repeat="Infinity-nogap"]');
    await tab.fill('#presetNameInput', 'forever-test');
    await tab.click('#savePresetBtn');
    await tab.evaluate(() => {
        const settings = SettingsStore.peekData(StorageKeys.SCALES_SETTINGS);
        localStorage.setItem(StorageKeys.SCALES_SETTINGS, JSON.stringify({ ...settings, root: 'E#', sectionLength: 'centered' }));
        const presets = SettingsStore.peekData(StorageKeys.SCALES_PRESETS);
        presets.push({ ...presets[0], id: 'stored-b-sharp', name: 'b-sharp', config: { ...presets[0].config, root: 'B#', movementStyle: 'retired' } });
        localStorage.setItem(StorageKeys.SCALES_PRESETS, JSON.stringify(presets));
    });
    await tab.reload({ waitUntil: 'networkidle' });
    await waitForScalesReady(tab);
    const stored = await tab.evaluate(() => {
        const c = window.scalesController;
        const forever = c.presets.find(p => p.name === 'forever-test');
        const bSharp = c.presets.find(p => p.name === 'b-sharp');
        return {
            forever: forever ? `${forever.config.repeatCount} gap ${forever.config.repeatGapMs}` : 'missing',
            settings: `${c.settings.root} ${c.settings.sectionLength}`,
            preset: bSharp ? `${bSharp.config.root} ${bSharp.config.movementStyle}` : 'missing',
            plan: document.getElementById('pianoReadoutPlan').textContent,
            board: c.keyboard.model.keys.length > 0
        };
    });
    report.check(`a forever preset survives a reload (${stored.forever})`, stored.forever === 'Infinity gap 0');
    report.check(`a stored value that names no current option loads as its default (settings ${stored.settings}, preset ${stored.preset}, "${stored.plan}")`,
        stored.settings === 'C 1o' && stored.preset === 'C normal' && !stored.plan.includes('undefined') && stored.board);

    const replay = await tab.evaluate(async () => {
        const c = window.scalesController;
        /** @type {HTMLElement} */ (document.getElementById('clearHistoryBtn')).click();
        /** @type {number[]} */
        const played = [];
        const realPlayMidi = c.audio.piano.playMidi.bind(c.audio.piano);
        const realSleep = c.audio.sleep;
        c.audio.piano.playMidi = midi => { played.push(midi); };
        c.audio.sleep = async () => {};
        Object.assign(c.settings, c.defaultSettings, { root: 'D', scaleType: 'minor', direction: 'both' });
        await c.playCurrentSettings();
        const first = played.splice(0).join(',');
        Object.assign(c.settings, c.defaultSettings, { root: 'G', direction: 'descending' });
        c.setChopHead(1);
        c.onSettingChanged();
        await c.playFromHistory(0);
        const again = played.splice(0).join(',');
        c.audio.piano.playMidi = realPlayMidi;
        c.audio.sleep = realSleep;
        return {
            first,
            again,
            restored: `${c.settings.root} ${c.settings.scaleType} ${c.settings.direction} chop=${c.settings.chopHead}`,
            row: document.querySelector('#historyList .history-item .history-text').textContent,
            rows: c.history.entries.length
        };
    });
    report.check(`replaying a history row plays its own settings and shows them, whatever was on since (${replay.restored}; "${replay.row}"; ${replay.again})`,
        replay.first.startsWith('62,64,65') && replay.again === replay.first
        && replay.restored === 'D minor both chop=0' && replay.row === 'D4 minor \u00b7 up+down' && replay.rows === 1);

    // A car's one play/pause toggle is routed by this state.
    const transport = await tab.evaluate(async () => {
        const c = window.scalesController;
        const state = () => navigator.mediaSession.playbackState;
        /** @param {() => boolean} done */
        const until = async done => {
            for (let i = 0; i < 300 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 10));
        };
        const rest = state();
        Object.assign(c.settings, c.defaultSettings, { noteLengthMs: 50 });
        const run = c.playCurrentSettings();
        await until(() => c.audio.isPlaying);
        const playing = state();
        await run;
        const finished = state();
        c.playCurrentSettings();
        await until(() => c.audio.isPlaying);
        c.stopPlayback();
        return `${rest} ${playing} ${finished} ${state()}`;
    });
    report.check(`the media session reports playing only while a scale plays (rest, playing, played out, stopped: ${transport})`,
        transport === 'paused playing paused paused');

    await browser.close();
    report.finish();
})();
