// @ts-check
// Shared controls (steppers, segment rows, toggles) work and persist
// per tab on every page that has them.

const { BASE_URL, launchWithMic, collectErrors, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('shared controls');
    const browser = await launchWithMic();

    // CANONICAL PICKERS AND CONTROLS: every page uses the shared kinds only.
    // Root/octave/single-pitch choosers are root-pitch steppers; no chip
    // grids, sliders, or selects remain (except Scales' dynamic TTS voice
    // list, the one deliberate select). Retired control dialects must not
    // reappear anywhere.
    {
        const tab = await browser.newPage();
        // Classes deleted during convergence; markup using them is a regression
        const retired = [
            '.setting-btn', '.toggle-slider', '.setting-row', '.setting-label', '.setting-options',
            '.preset-btn', '.next-pattern-button', '.stop-button-pitch', '.play-ref-button',
            '.trace-primary-btn', '.trace-secondary-btn', '.phrase-button-row', '.phrase-toggle-row',
            '.phrase-repeat-button', '.clear-history-btn', '.copy-all-history-btn', '.copy-all-btn',
            '.vf-reset-btn', '.test-voice-btn', '.reset-stats-btn', '.sing-control-btn',
            '.select-all-btn', '.log-toggle-btn', '.clear-log-btn', '.model-selector', '.provider-tab',
            '.display-toggles', '.echo-toggle',
            // Books dialects retired into the shared vocabulary
            '.small-action-btn', '.primary-action-btn', '.danger-action-btn', '.upload-button',
            '.speed-step-btn', '.speed-control', '.voice-sample-btn', '.back-library-btn',
        ].join(', ');
        const expectations = [
            { page: 'scales', steppers: ['rootPitch'], forbidden: '[data-root], [data-octave], input[type="range"]' },
            { page: 'intervals', steppers: ['rootPitch', 'rootRangeMid', 'droneNote'], forbidden: '[data-root], [data-octave], select, input[type="range"]' },
            { page: 'phrases', steppers: ['rootPitch'], forbidden: 'select, input[type="range"]' },
            { page: 'pitch-meter', steppers: ['rootPitch'], forbidden: 'select, input[type="range"]' },
            { page: 'trace', steppers: [], forbidden: 'select, input[type="range"]' },
            { page: 'player', steppers: [], forbidden: 'select, input[type="range"]' },
            // Books keeps its selects (dynamic voice/model lists, the declared
            // exception) but must use the shared button vocabulary.
            { page: 'ebook', steppers: [], forbidden: 'input[type="range"]' },
        ];
        for (const { page, steppers, forbidden } of expectations) {
            await tab.goto(`${BASE_URL}/${page}.html`, { waitUntil: 'networkidle' });
            await tab.waitForTimeout(800);
            const result = await tab.evaluate(({ steppers, forbidden, retired }) => ({
                missing: steppers.filter(key =>
                    !document.querySelector(`.step-btn[data-step-key="${key}"]`)),
                stray: Array.from(document.querySelectorAll(forbidden)).length,
                dialects: Array.from(document.querySelectorAll(retired)).length,
            }), { steppers, forbidden, retired });
            report.check(`${page} canonical controls (missing: ${result.missing.join(',') || 'none'}, stray: ${result.stray}, retired: ${result.dialects})`,
                result.missing.length === 0 && result.stray === 0 && result.dialects === 0);
        }
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(800);
        const allowed = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('select')).map(s => s.id));
        report.check(`scales only select is the TTS voice list (${allowed.join(',')})`,
            allowed.length === 1 && allowed[0] === 'voiceSelect');
        await tab.close();
    }

    // SCALES: stepper changes value, persists, restores after reload
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'scales', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        const before = await tab.textContent('#noteLengthValue');
        await tab.click('[data-step-key="noteLengthMs"][data-step-delta="1"]');
        await tab.waitForTimeout(400);
        const after = await tab.textContent('#noteLengthValue');
        const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.SCALES_SETTINGS)?.noteLengthMs);
        report.check(`scales noteLength stepper ${before}->${after}`, before !== after && typeof saved === 'number');
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        const restored = await tab.textContent('#noteLengthValue');
        report.check('scales stepper restored after reload', restored === after);
        await ctx.close();
    }

    // INTERVALS: steppers persist
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'intervals', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        await tab.click('[data-step-key="lengthMs"][data-step-delta="-1"]');
        await tab.click('[data-step-key="gapMs"][data-step-delta="-1"]');
        await tab.waitForTimeout(300);
        const saved = await tab.evaluate(() => {
            const data = SettingsStore.peekData(StorageKeys.INTERVALS_SETTINGS);
            return data || {};
        });
        report.check(`intervals steppers saved ${saved.lengthMs}/${saved.gapMs}`,
            saved.lengthMs === 500 && saved.gapMs === 1500);

        // The trio of shared pickers exposes the same preset lists on every
        // page: one step from the shared defaults lands on shared values.
        const presets = await tab.evaluate(() => ({
            lengths: PracticeControls.NOTE_LENGTH_VALUES,
            gaps: PracticeControls.GAP_VALUES,
            rootMin: PracticeControls.ROOT_PITCH_MIN_MIDI,
            rootMax: PracticeControls.ROOT_PITCH_MAX_MIDI
        }));
        report.check(`shared step presets exposed (lengths=${presets.lengths.length}, gaps=${presets.gaps.length}, root=${presets.rootMin}-${presets.rootMax})`,
            presets.lengths.length > 0 && presets.gaps.length > 0
            && presets.rootMin === 36 && presets.rootMax === 83);
        await ctx.close();
    }

    // PITCH METER: segment rows + steppers, presets, restore
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'pitch-meter', report.errors);
        await tab.goto(`${BASE_URL}/pitch-meter.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.click('[data-step-key="responseTime"][data-step-delta="1"]');
        await tab.click('[data-mode="free"]');
        await tab.click('[data-step-key="rootPitch"][data-step-delta="1"]');
        await tab.click('[data-scale="minor"]');
        await tab.waitForTimeout(400);
        const root = await tab.textContent('#rootPitchValue');
        const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PITCH_METER_SETTINGS));
        report.check(`pitch-meter controls root=${root}, saved mode=${saved.mode}`,
            root === 'C#4' && saved.mode === 'free' && saved.scaleType === 'minor');
        await tab.click('[data-instrument="bass"]');
        await tab.waitForTimeout(300);
        const bassRoot = await tab.textContent('#rootPitchValue');
        report.check(`pitch-meter bass preset sets octave (${bassRoot})`, bassRoot === 'C#2');
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        const restoredMode = await tab.evaluate(() =>
            document.querySelector('[data-mode].selected')?.getAttribute('data-mode'));
        report.check('pitch-meter restored mode', restoredMode === 'free');
        await ctx.close();
    }

    // TRACE: guide sound option persists
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'trace', report.errors);
        await tab.goto(`${BASE_URL}/trace.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        const pianoDefault = await tab.evaluate(() =>
            document.querySelector('[data-guide-sound="piano"]').classList.contains('selected'));
        await tab.click('[data-guide-sound="beep"]');
        const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.TRACE_SETTINGS)?.guideSound);
        report.check(`trace guide sound default piano, persisted "${saved}"`, pianoDefault && saved === 'beep');
        await tab.click('#startBtn');
        await tab.waitForTimeout(1200);
        const status = await tab.textContent('#statusReadout');
        report.check(`trace listening starts ("${status}")`, status === 'Listening' || status === 'Listening and drawing');
        await ctx.close();
    }

    // INTERVALS EAR MODE: toggle persists in unified settings
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'intervals-ear', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html?mode=ear`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        await tab.evaluate(() => document.getElementById('autoAdvanceToggle').click());
        await tab.waitForTimeout(300);
        const saved = await tab.evaluate(() => {
            const data = SettingsStore.peekData(StorageKeys.INTERVALS_SETTINGS);
            return data && data.autoAdvance;
        });
        report.check('intervals ear toggle persisted', saved === true);
        await ctx.close();
    }

    // PHRASES: long phrases with multi-character degrees (10, 15, 7d)
    // stay compact and keep per-note controls centered over staff notes.
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const tab = await ctx.newPage();
        collectErrors(tab, 'phrases-stage', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.evaluate(() => {
            localStorage.setItem('phrases-settings', JSON.stringify({
                root: 'D#', octave: 3, scaleType: 'major', phraseAlgo: 'random',
                startAtOne: false, rangeMode: 'expanded', minLength: 28, maxLength: 32,
                returnToInitial: true, returnToRoot: false,
                hearTones: false, hearSpeech: false, singNumbers: false,
                noteLengthMs: 300, gapMs: 0, showNoteNames: true, showStaff: true
            }));
        });
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(1000);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(500);
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
            const noteGroups = Array.from(document.querySelectorAll('#phraseStaff .vf-stavenote'));
            const deltas = columns.map((column, index) => {
                const note = noteGroups[index];
                if (!note) return null;
                const columnRect = column.getBoundingClientRect();
                const noteRect = note.getBoundingClientRect();
                return Math.abs(
                    (columnRect.left + columnRect.width / 2) - (noteRect.left + noteRect.width / 2)
                );
            }).filter(delta => delta !== null);
            const compactStep = Number.parseFloat(stageEl.style.getPropertyValue('--phrase-staff-note-step'));
            return {
                count: tokens.length,
                clipped,
                overlaps,
                compactStep,
                alignmentDelta: deltas.length ? Math.max(...deltas) : Infinity
            };
        });
        report.check(`phrases stage is compact and aligned (n=${stage.count}, step=${stage.compactStep.toFixed(1)}, clipped=${stage.clipped}, overlaps=${stage.overlaps}, align=${stage.alignmentDelta.toFixed(1)})`,
            stage.count >= 28
            && stage.compactStep <= 24
            && stage.clipped === 0
            && stage.overlaps === 0
            && stage.alignmentDelta <= 7);
        await ctx.close();
    }

    // PHRASES: test panel options persist through the shared component
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'phrases', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(1500);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(400);
        await tab.click('#testBtn');
        await tab.waitForTimeout(1200);
        const panelOpen = await tab.evaluate(() => !document.getElementById('phraseTestPanel').hidden);
        await tab.evaluate(() => document.getElementById('phraseTestWindowToggle').click());
        const saved = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PANEL_PHRASES_TEST)?.fixedWindow);
        await tab.click('#phraseTestCloseBtn');
        const closed = await tab.evaluate(() => document.getElementById('phraseTestPanel').hidden);
        report.check('phrases test panel opens, persists options, closes', panelOpen && saved === true && closed);
        await ctx.close();
    }

    // PHRASES: compact control chips wrap without overlap or full-row stretching
    // on a car-phone-width viewport.
    {
        const ctx = await browser.newContext({ viewport: { width: 460, height: 900 } });
        const tab = await ctx.newPage();
        collectErrors(tab, 'phrases-controls-layout', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(1000);
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
        report.check(`phrases compact controls no overlap (overlaps=${layout.overlaps}, overflow=${layout.overflow}, motif=${layout.motifWidth.toFixed(0)}, mminor=${layout.minorWidth.toFixed(0)})`,
            layout.overlaps === 0 && layout.overflow === 0
            && layout.motifWidth < layout.controlWidth * 0.6
            && layout.minorWidth < layout.controlWidth * 0.75);
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
