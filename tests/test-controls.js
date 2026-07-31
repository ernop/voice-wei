// @ts-check
// Shared controls (steppers, segment rows, toggles) work and persist
// per tab on every page that has them.
//
// Sections use isolated browser contexts, so they run concurrently;
// checks are collected per section and reported in a fixed order.

const { BASE_URL, launchWithMic, collectErrors, createReporter } = require('./helpers');

// Generous ceiling with fast polling: waits resolve as soon as the
// observed state appears, so the timeout only matters on real failures.
const WAIT = { timeout: 10000, polling: 50 };

// Per-page "init finished" probes. Each observes a state the page sets
// AFTER its control wiring runs (steppers clickable, settings restored),
// so a passing probe means the page is safe to drive and measure.
const READY_PROBES = {
    // singPanel is created by setupSingPanel(), right after setupUI()
    // wires the steppers.
    scales: () => Boolean(window.scalesController && window.scalesController.singPanel),
    // Full boot: ear-training init sets this status after the piano
    // loads, in the same task that binds its toggles and steppers.
    intervals: () => (document.getElementById('intervalPrompt')?.textContent || '').includes('Ready!'),
    // Set right after initUI() wires every phrases control.
    phrases: () => Boolean(window.phrasesDebug),
    // Assigned after the constructor's synchronous wiring completes.
    'pitch-meter': () => Boolean(window.pitchMeter),
    // Set right after initUI() in trace's boot().
    trace: () => Boolean(window.traceDebug),
    player: () => window.__voiceWeiStartup?.ready === true,
    // renderLibrary() runs at the end of Books init.
    ebook: () => Boolean(document.querySelector('#savedBookList .library-empty, #savedBookList .saved-book-item')),
};

/**
 * Navigate and block until the page's init-finished probe passes.
 * @param {import('playwright').Page} tab
 * @param {keyof typeof READY_PROBES} page
 * @param {string} [query]
 */
async function gotoReady(tab, page, query = '') {
    await tab.goto(`${BASE_URL}/${page}.html${query}`, { waitUntil: 'networkidle' });
    await tab.waitForFunction(READY_PROBES[page], undefined, WAIT);
}

/** @typedef {{ label: string, ok: boolean }} SectionCheck */

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionCanonicalControls(browser, errors) {
    // CANONICAL PICKERS AND CONTROLS: every page uses the shared kinds only.
    // Root/octave/single-pitch choosers are root-pitch steppers; no chip
    // grids, sliders, or selects remain (except Scales' dynamic TTS voice
    // list, the one deliberate select). Retired control dialects must not
    // reappear anywhere.
    const ctx = await browser.newContext();
    // Classes deleted during convergence; markup using them is a regression
    const retired = [
        '.setting-btn', '.toggle-slider', '.setting-row', '.setting-label', '.setting-options',
        '.preset-btn', '.next-pattern-button', '.stop-button-pitch', '.play-ref-button',
        '.trace-primary-btn', '.trace-secondary-btn', '.phrase-button-row', '.phrase-toggle-row',
        '.phrase-repeat-button', '.clear-history-btn', '.copy-all-history-btn', '.copy-all-btn',
        '.vf-reset-btn', '.test-voice-btn', '.reset-stats-btn', '.sing-control-btn',
        '.select-all-btn', '.log-toggle-btn', '.clear-log-btn', '.model-selector', '.provider-tab',
        '.display-toggles', '.echo-toggle',
        // External-label stepper dialect: labels now live inside the pill
        '.step-field-bare',
        // Books dialects retired into the shared vocabulary
        '.small-action-btn', '.primary-action-btn', '.danger-action-btn', '.upload-button',
        '.speed-step-btn', '.speed-control', '.voice-sample-btn', '.back-library-btn',
    ].join(', ');
    /** @type {Array<{ page: keyof typeof READY_PROBES, steppers: string[], forbidden: string }>} */
    const expectations = [
        { page: 'scales', steppers: ['rootPitch'], forbidden: '[data-root], [data-octave], input[type="range"]' },
        { page: 'intervals', steppers: ['rootPitch', 'rootRangeMid', 'droneNote'], forbidden: '[data-root], [data-octave], select, input[type="range"]' },
        { page: 'phrases', steppers: ['rootPitch'], forbidden: 'select, input[type="range"]' },
        { page: 'pitch-meter', steppers: ['rootPitch'], forbidden: 'select, input[type="range"]' },
        { page: 'trace', steppers: ['rootPitch', 'rangeLowMidi', 'rangeHighMidi', 'guideIntervalMs', 'windowMs'], forbidden: 'select, input[type="range"]' },
        { page: 'player', steppers: [], forbidden: 'select, input[type="range"]' },
        // Books keeps its selects (dynamic voice/model lists, the declared
        // exception) but must use the shared button vocabulary.
        { page: 'ebook', steppers: [], forbidden: 'input[type="range"]' },
    ];
    const checks = await Promise.all(expectations.map(async ({ page, steppers, forbidden }) => {
        const tab = await ctx.newPage();
        await gotoReady(tab, page);
        const result = await tab.evaluate(({ steppers, forbidden, retired }) => ({
            missing: steppers.filter(key =>
                !document.querySelector(`.step-btn[data-step-key="${key}"]`)),
            stray: Array.from(document.querySelectorAll(forbidden)).length,
            dialects: Array.from(document.querySelectorAll(retired)).length,
        }), { steppers, forbidden, retired });
        const selects = page === 'scales'
            ? await tab.evaluate(() => Array.from(document.querySelectorAll('select')).map(s => s.id))
            : null;
        await tab.close();
        /** @type {SectionCheck[]} */
        const pageChecks = [{
            label: `${page} canonical controls (missing: ${result.missing.join(',') || 'none'}, stray: ${result.stray}, retired: ${result.dialects})`,
            ok: result.missing.length === 0 && result.stray === 0 && result.dialects === 0
        }];
        if (selects) {
            pageChecks.push({
                label: `scales only select is the TTS voice list (${selects.join(',')})`,
                ok: selects.length === 1 && selects[0] === 'voiceSelect'
            });
        }
        return pageChecks;
    }));
    await ctx.close();
    return checks.flat();
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionScalesStepper(browser, errors) {
    // SCALES: stepper changes value, persists, restores after reload
    const ctx = await browser.newContext();
    const tab = await ctx.newPage();
    collectErrors(tab, 'scales', errors);
    await gotoReady(tab, 'scales');
    const before = await tab.textContent('#noteLengthValue');
    await tab.click('[data-step-key="noteLengthMs"][data-step-delta="1"]');
    await tab.waitForFunction(prev =>
        document.getElementById('noteLengthValue')?.textContent !== prev, before, WAIT);
    const after = await tab.textContent('#noteLengthValue');
    const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.SCALES_SETTINGS)?.noteLengthMs);
    /** @type {SectionCheck[]} */
    const checks = [{
        label: `scales noteLength stepper ${before}->${after}`,
        ok: before !== after && typeof saved === 'number'
    }];
    await tab.reload({ waitUntil: 'networkidle' });
    await tab.waitForFunction(READY_PROBES.scales, undefined, WAIT);
    const restored = await tab.textContent('#noteLengthValue');
    checks.push({ label: 'scales stepper restored after reload', ok: restored === after });
    await ctx.close();
    return checks;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionIntervalsSteppers(browser, errors) {
    // INTERVALS: steppers persist
    const ctx = await browser.newContext();
    const tab = await ctx.newPage();
    collectErrors(tab, 'intervals', errors);
    // Steppers are wired by initUI(), which sets intervalsDebug at
    // its end - enough readiness for this section.
    await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
    await tab.waitForFunction(() => Boolean(window.intervalsDebug), undefined, WAIT);
    await tab.click('[data-step-key="lengthMs"][data-step-delta="-1"]');
    await tab.click('[data-step-key="gapMs"][data-step-delta="-1"]');
    // Stepper handlers save synchronously; read the store directly.
    const saved = await tab.evaluate(() => {
        const data = SettingsStore.peekData(StorageKeys.INTERVALS_SETTINGS);
        return data || {};
    });

    // The trio of shared pickers exposes the same preset lists on every
    // page: one step from the shared defaults lands on shared values.
    // Every seconds-valued stepper derives from ONE time ladder.
    const presets = await tab.evaluate(() => ({
        ladder: Array.from(PracticeControls.TIME_VALUES_MS),
        lengths: Array.from(PracticeControls.NOTE_LENGTH_VALUES),
        gaps: Array.from(PracticeControls.GAP_VALUES),
        rootMin: PracticeControls.ROOT_PITCH_MIN_MIDI,
        rootMax: PracticeControls.ROOT_PITCH_MAX_MIDI
    }));
    const ladderOk = presets.ladder[0] === 0
        && [100, 900, 1100, 1900, 2250, 4500, 10000].every(v => presets.ladder.includes(v))
        && presets.lengths.join(',') === presets.ladder.filter(v => v >= 100).join(',')
        && presets.gaps.slice(0, 3).join(',') === '-0.5,-0.1,-0.05'
        && presets.gaps.slice(3).join(',') === presets.ladder.join(',');
    await ctx.close();
    return [
        {
            label: `intervals steppers saved ${saved.lengthMs}/${saved.gapMs}`,
            ok: saved.lengthMs === 500 && saved.gapMs === 1900
        },
        {
            label: `shared step presets expose one time ladder (ladder=${presets.ladder.length}, lengths=${presets.lengths.length}, gaps=${presets.gaps.length}, root=${presets.rootMin}-${presets.rootMax})`,
            ok: ladderOk && presets.rootMin === 36 && presets.rootMax === 83
        }
    ];
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionPitchMeter(browser, errors) {
    // PITCH METER: segment rows + steppers, presets, restore
    const ctx = await browser.newContext();
    const tab = await ctx.newPage();
    collectErrors(tab, 'pitch-meter', errors);
    await gotoReady(tab, 'pitch-meter');
    await tab.click('[data-step-key="responseTime"][data-step-delta="1"]');
    await tab.click('[data-mode="free"]');
    await tab.click('[data-step-key="rootPitch"][data-step-delta="1"]');
    await tab.click('[data-scale="minor"]');
    // Control handlers update the display and save synchronously.
    const root = await tab.textContent('#rootPitchValue');
    const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PITCH_METER_SETTINGS));
    /** @type {SectionCheck[]} */
    const checks = [{
        label: `pitch-meter controls root=${root}, saved mode=${saved.mode}`,
        ok: root === 'C#4' && saved.mode === 'free' && saved.scaleType === 'minor'
    }];
    await tab.click('[data-instrument="bass"]');
    const bassRoot = await tab.textContent('#rootPitchValue');
    checks.push({ label: `pitch-meter bass preset sets octave (${bassRoot})`, ok: bassRoot === 'C#2' });
    await tab.reload({ waitUntil: 'networkidle' });
    await tab.waitForFunction(READY_PROBES['pitch-meter'], undefined, WAIT);
    const restoredMode = await tab.evaluate(() =>
        document.querySelector('[data-mode].selected')?.getAttribute('data-mode'));
    checks.push({ label: 'pitch-meter restored mode', ok: restoredMode === 'free' });
    await ctx.close();
    return checks;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionTrace(browser, errors) {
    // TRACE: fixed note bounds, time-window width, and guide sound persist.
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const tab = await ctx.newPage();
    collectErrors(tab, 'trace', errors);
    await gotoReady(tab, 'trace');
    const pianoDefault = await tab.evaluate(() =>
        document.querySelector('[data-guide-sound="piano"]').classList.contains('selected'));
    await tab.click('[data-guide-sound="beep"]');
    const initialBounds = await tab.evaluate(() => window.traceDebug.verticalBounds());
    await tab.click('[data-step-key="rangeLowMidi"][data-step-delta="1"]');
    const manualBounds = await tab.evaluate(() => window.traceDebug.verticalBounds());
    await tab.click('[data-step-key="rootPitch"][data-step-delta="1"]');
    const afterKeyChange = await tab.evaluate(() => window.traceDebug.verticalBounds());
    await tab.evaluate(() => document.getElementById('rangeFollowsKeyToggle').click());
    const followedBounds = await tab.evaluate(() => window.traceDebug.verticalBounds());

    for (let i = 0; i < 4; i++) {
        await tab.click('[data-step-key="windowMs"][data-step-delta="-1"]');
    }
    await tab.evaluate(() => document.getElementById('fixedWindowToggle').click());
    const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.TRACE_SETTINGS));
    /** @type {SectionCheck[]} */
    const checks = [
        {
            label: `trace guide sound default piano, persisted "${saved.guideSound}"`,
            ok: pianoDefault && saved.guideSound === 'beep'
        },
        {
            label: `trace bounds become absolute when stepped (${initialBounds.minMidi}-${initialBounds.maxMidi} -> ${manualBounds.minMidi}-${manualBounds.maxMidi})`,
            ok: manualBounds.minMidi === initialBounds.minMidi + 1
                && manualBounds.maxMidi === initialBounds.maxMidi
                && afterKeyChange.minMidi === manualBounds.minMidi
                && afterKeyChange.maxMidi === manualBounds.maxMidi
        },
        {
            label: `trace Follow key recomputes bounds (${followedBounds.minMidi}-${followedBounds.maxMidi})`,
            ok: saved.rangeFollowsKey === true
                && (followedBounds.minMidi !== manualBounds.minMidi || followedBounds.maxMidi !== manualBounds.maxMidi)
        },
        {
            label: `trace rolling window steps down to 2s (${saved.windowMs}ms)`,
            ok: saved.fixedWindow === true && saved.windowMs === 2000
                && await tab.textContent('#fixedWindowLabel') === '2s window'
        }
    ];

    await tab.reload({ waitUntil: 'networkidle' });
    await tab.waitForFunction(READY_PROBES.trace, undefined, WAIT);
    const restored = await tab.evaluate(() => ({
        windowMs: window.traceDebug.windowMs(),
        bounds: window.traceDebug.verticalBounds(),
        fixed: /** @type {HTMLInputElement} */ (document.getElementById('fixedWindowToggle')).checked
    }));
    checks.push({
        label: 'trace range and 2s window restore after reload',
        ok: restored.windowMs === 2000 && restored.fixed
            && restored.bounds.minMidi === followedBounds.minMidi
            && restored.bounds.maxMidi === followedBounds.maxMidi
    });
    await tab.click('#startBtn');
    await tab.waitForFunction(() =>
        (document.getElementById('statusReadout')?.textContent || '').startsWith('Listening'), undefined, WAIT);
    const status = await tab.textContent('#statusReadout');
    checks.push({
        label: `trace listening starts ("${status}")`,
        ok: status === 'Listening' || status === 'Listening and drawing'
    });
    await ctx.close();
    return checks;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionIntervalsEarMode(browser, errors) {
    // INTERVALS EAR MODE: toggle persists in unified settings
    const ctx = await browser.newContext();
    const tab = await ctx.newPage();
    collectErrors(tab, 'intervals-ear', errors);
    // autoAdvanceToggle is bound by ear-training's init, after the
    // piano loads - the "Ready!" prompt lands in that same task.
    await gotoReady(tab, 'intervals', '?mode=ear');
    await tab.evaluate(() => document.getElementById('autoAdvanceToggle').click());
    const saved = await tab.evaluate(() => {
        const data = SettingsStore.peekData(StorageKeys.INTERVALS_SETTINGS);
        return data && data.autoAdvance;
    });
    await ctx.close();
    return [{ label: 'intervals ear toggle persisted', ok: saved === true }];
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionPhrasesStage(browser, errors) {
    // PHRASES: long phrases with multi-character degrees (10, 15, 7d)
    // stay compact and keep per-note controls centered over staff notes.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await ctx.newPage();
    collectErrors(tab, 'phrases-stage', errors);
    await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
    await tab.evaluate(() => {
        localStorage.setItem('phrases-settings', JSON.stringify({
            root: 'D#', octave: 3, scaleType: 'major', phraseAlgo: 'random',
            startAtOne: false, rangeLow: -3, rangeHigh: 14, minLength: 28, maxLength: 32,
            returnToInitial: true, returnToRoot: false,
            hearTones: false, hearSpeech: false, singNumbers: false,
            noteLengthMs: 300, gapMs: 0, showNoteNames: true, showStaff: true
        }));
    });
    await tab.reload({ waitUntil: 'networkidle' });
    await tab.waitForFunction(READY_PROBES.phrases, undefined, WAIT);
    await tab.click('#nextBtn');
    await tab.waitForFunction(() =>
        document.querySelectorAll('.phrase-degree-token').length >= 28
        && document.querySelectorAll('#phraseStaff .vf-stavenote').length >= 28, undefined, WAIT);
    const stage = await tab.evaluate(() => {
        const stageEl = document.querySelector('.phrase-stage');
        const tokens = Array.from(document.querySelectorAll('.phrase-degree-token'));
        const clipped = tokens.filter(t => t.scrollWidth > t.clientWidth + 1).length;
        const rects = tokens.map(t => t.getBoundingClientRect());
        let overlaps = 0;
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const x = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
                const y = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
                if (x > 1 && y > 1) overlaps++;
            }
        }
        const columns = Array.from(document.querySelectorAll('.phrase-note-column'));
        // Columns run in beat order left to right. The staff draws one
        // voice per stave (grand staff = treble then bass), so
        // .vf-stavenote DOM order is NOT beat order; sorting note
        // centers by x recovers it. Bar-padding rests (also
        // .vf-stavenote) sit right of the last beat, so extras at the
        // tail are harmless.
        const noteCenters = Array.from(document.querySelectorAll('#phraseStaff .vf-stavenote'))
            .map(group => {
                const rect = group.getBoundingClientRect();
                return rect.left + rect.width / 2;
            })
            .sort((a, b) => a - b);
        // Structural containment: each beat's note center must fall
        // within its column's horizontal span.
        const misaligned = columns.filter((column, index) => {
            const rect = column.getBoundingClientRect();
            const center = noteCenters[index];
            return center === undefined || center < rect.left || center > rect.right;
        }).length;
        const compactStep = Number.parseFloat(stageEl.style.getPropertyValue('--phrase-staff-note-step'));
        return {
            count: tokens.length,
            clipped,
            overlaps,
            compactStep,
            misaligned
        };
    });
    await ctx.close();
    return [{
        label: `phrases stage is compact and aligned (n=${stage.count}, step=${stage.compactStep.toFixed(1)}, clipped=${stage.clipped}, overlaps=${stage.overlaps}, misaligned=${stage.misaligned})`,
        ok: stage.count >= 28
            && stage.compactStep <= 24
            && stage.clipped === 0
            && stage.overlaps === 0
            && stage.misaligned === 0
    }];
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionPhrasesSeriesStaff(browser, errors) {
    // PHRASES: an accidental-heavy typed series gets real glyph room on
    // the staff - the width follows the formatter's minimum, so noteheads
    // and accidentals never collapse into each other.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await ctx.newPage();
    collectErrors(tab, 'phrases-series-staff', errors);
    await gotoReady(tab, 'phrases');
    await tab.evaluate(() => {
        const tones = document.getElementById('hearTonesToggle');
        if (tones instanceof HTMLInputElement && tones.checked) tones.click();
    });
    await tab.fill('#seriesInput', '1 2# 3 4# 5 5b 4 3b 2 7bv 7v 1');
    await tab.click('#seriesSetBtn');
    await tab.waitForFunction(() =>
        document.querySelectorAll('#phraseStaff .vf-notehead').length >= 12, undefined, WAIT);
    await tab.click('#stopBtn');
    const staff = await tab.evaluate(() => {
        const heads = Array.from(document.querySelectorAll('#phraseStaff .vf-notehead'))
            .map(el => el.getBoundingClientRect())
            .sort((a, b) => a.left - b.left);
        let minCenterStep = Infinity;
        let overlaps = 0;
        for (let i = 1; i < heads.length; i++) {
            const step = (heads[i].left + heads[i].width / 2) - (heads[i - 1].left + heads[i - 1].width / 2);
            minCenterStep = Math.min(minCenterStep, step);
            if (heads[i].left < heads[i - 1].right - 1) overlaps++;
        }
        return { count: heads.length, minCenterStep, overlaps };
    });
    await ctx.close();
    return [{
        label: `phrases series staff gives accidentals room (n=${staff.count}, minStep=${staff.minCenterStep.toFixed(1)}, overlaps=${staff.overlaps})`,
        ok: staff.count === 12 && staff.overlaps === 0 && staff.minCenterStep >= 14
    }];
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionPhrasesTestPanel(browser, errors) {
    // PHRASES: test panel options persist through the shared component
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const tab = await ctx.newPage();
    collectErrors(tab, 'phrases', errors);
    await gotoReady(tab, 'phrases');
    await tab.click('#nextBtn');
    await tab.waitForFunction(() =>
        document.querySelectorAll('.phrase-degree-token').length > 0, undefined, WAIT);
    await tab.click('#testBtn');
    await tab.waitForFunction(() =>
        !document.getElementById('phraseTestPanel').hidden, undefined, WAIT);
    const panelOpen = await tab.evaluate(() => !document.getElementById('phraseTestPanel').hidden);
    await tab.evaluate(() => document.getElementById('phraseTestWindowToggle').click());
    const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PANEL_PHRASES_TEST)?.fixedWindow);
    await tab.click('#phraseTestCloseBtn');
    await tab.waitForFunction(() =>
        document.getElementById('phraseTestPanel').hidden, undefined, WAIT);
    const closed = await tab.evaluate(() => document.getElementById('phraseTestPanel').hidden);
    await ctx.close();
    return [{
        label: 'phrases test panel opens, persists options, closes',
        ok: panelOpen && saved === true && closed
    }];
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string[]} errors
 * @returns {Promise<SectionCheck[]>}
 */
async function sectionPhrasesCompactControls(browser, errors) {
    // PHRASES: compact control chips wrap without overlap or full-row
    // stretching on a car-phone-width viewport.
    const ctx = await browser.newContext({ viewport: { width: 460, height: 900 } });
    const tab = await ctx.newPage();
    collectErrors(tab, 'phrases-controls-layout', errors);
    await gotoReady(tab, 'phrases');
    const layout = await tab.evaluate(() => {
        const controls = document.querySelector('.phrase-control-grid').getBoundingClientRect();
        const buttons = Array.from(document.querySelectorAll('.phrase-control-grid .vf-btn, .phrase-control-grid .step-field'))
            .filter(el => el.getClientRects().length > 0);
        const rects = buttons.map(el => el.getBoundingClientRect());
        let overlaps = 0;
        let overflow = 0;
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.left < controls.left - 1 || r.right > controls.right + 1) overflow++;
            for (let j = i + 1; j < rects.length; j++) {
                const x = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
                const y = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
                if (x > 1 && y > 1) overlaps++;
            }
        }
        const motif = document.querySelector('[data-phrase-algo="motif"]').getBoundingClientRect();
        const minor = document.querySelector('[data-scale="melodic_minor"]').getBoundingClientRect();
        return { overlaps, overflow, motifWidth: motif.width, minorWidth: minor.width, controlWidth: controls.width };
    });
    await ctx.close();
    return [{
        label: `phrases compact controls no overlap (overlaps=${layout.overlaps}, overflow=${layout.overflow}, motif=${layout.motifWidth.toFixed(0)}, mminor=${layout.minorWidth.toFixed(0)})`,
        ok: layout.overlaps === 0 && layout.overflow === 0
            && layout.motifWidth < layout.controlWidth * 0.6
            && layout.minorWidth < layout.controlWidth * 0.75
    }];
}

(async () => {
    const report = createReporter('shared controls');
    const browser = await launchWithMic();

    const sections = await Promise.all([
        sectionCanonicalControls,
        sectionScalesStepper,
        sectionIntervalsSteppers,
        sectionPitchMeter,
        sectionTrace,
        sectionIntervalsEarMode,
        sectionPhrasesStage,
        sectionPhrasesSeriesStaff,
        sectionPhrasesTestPanel,
        sectionPhrasesCompactControls,
    ].map(section => section(browser, report.errors)));
    sections.flat().forEach(({ label, ok }) => report.check(label, ok));

    await browser.close();
    report.finish();
})();
