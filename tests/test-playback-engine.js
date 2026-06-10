// @ts-check
// The playback law: old-settings voices are killed before new-settings
// voices start; stops are final; setting-change behaviors follow
// docs/parameters.md (phrases regen rules).

const { BASE_URL, launch, collectErrors, instrumentVoices, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('playback engine');
    const browser = await launch();

    // --- PHRASES ---
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'phrases', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(1500);
        await tab.evaluate(instrumentVoices);
        await tab.click('#playBtn');
        await tab.waitForTimeout(700);
        const degreesBefore = await tab.textContent('#phraseDegrees');
        const notesBefore = await tab.textContent('#phraseNotes');
        const tChange = await tab.evaluate(() => performance.now());
        await tab.click('[data-step-key="rootPitch"][data-step-delta="1"]');
        await tab.waitForTimeout(1200);
        const trace = await tab.evaluate(() => window.__trace);

        const kills = trace.filter(e => e.type === 'kill' && e.t >= tChange);
        const newStarts = trace.filter(e => e.type === 'voice-start' && e.t >= tChange);
        report.check(`phrases root+: ${kills.length} kills then ${newStarts.length} voices, kill-first`,
            kills.length > 0 && newStarts.length > 0 && kills[0].t <= newStarts[0].t);

        const degreesAfter = await tab.textContent('#phraseDegrees');
        const notesAfter = await tab.textContent('#phraseNotes');
        report.check('phrases root+ keeps degrees, transposes notes',
            degreesBefore === degreesAfter && notesBefore !== notesAfter);

        // min/max phrase length is bounds-next: never regenerates the current phrase
        await tab.click('#stopBtn');
        await tab.waitForTimeout(300);
        const seqBefore = await tab.textContent('#phraseDegrees');
        await tab.click('[data-step-key="maxLength"][data-step-delta="-1"]');
        await tab.click('[data-step-key="minLength"][data-step-delta="1"]');
        await tab.waitForTimeout(300);
        const seqAfter = await tab.textContent('#phraseDegrees');
        report.check('phrases min/max steppers keep current phrase', seqBefore === seqAfter);

        // show-names is redraw-only
        const startsBefore = (await tab.evaluate(() => window.__voiceStarts));
        await tab.evaluate(() => document.getElementById('showNamesToggle').click());
        await tab.waitForTimeout(500);
        const startsAfter = (await tab.evaluate(() => window.__voiceStarts));
        report.check('phrases show-names is redraw-only', startsBefore === startsAfter);

        // stop is final
        await tab.click('#playBtn');
        await tab.waitForTimeout(500);
        await tab.click('#stopBtn');
        await tab.waitForTimeout(150);
        const t2 = await tab.evaluate(() => performance.now());
        await tab.waitForTimeout(500);
        const lateStarts = (await tab.evaluate(() => window.__trace))
            .filter(e => e.type === 'voice-start' && e.t > t2).length;
        report.check('phrases stop is final (no voices after stop)', lateStarts === 0);
        await tab.close();
    }

    // --- PHRASES: live note mask ---
    // Muting an upcoming note mid-playthrough skips it when its position
    // arrives, without restarting playback or killing the sounding note.
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'phrases-live-mask', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.evaluate(() => {
            localStorage.setItem('phrases-settings', JSON.stringify({
                root: 'D#', octave: 3, scaleType: 'major', phraseAlgo: 'arch',
                startAtOne: true, rangeMode: 'within', minLength: 8, maxLength: 8,
                returnToInitial: false, returnToRoot: false, outputMode: 'tones',
                noteLengthMs: 1000, gapMs: 0, showNoteNames: true
            }));
        });
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(1500);
        await tab.evaluate(instrumentVoices);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(1500);
        await tab.click('.phrase-degree-token[data-index="6"]');
        await tab.waitForTimeout(8000);
        // 7 starts proves the muted note was skipped in place: a restart
        // would replay from the top (9+), no live read would play all 8.
        const result = await tab.evaluate(() => ({
            starts: window.__voiceStarts,
            stepsMs: window.__trace
                .filter(e => e.type === 'voice-start')
                .map((e, i, all) => (i ? e.t - all[i - 1].t : 0))
                .slice(1)
        }));
        const stepsOk = result.stepsMs.every(step => step > 700);
        report.check(`phrases live mask skips muted note without restart (${result.starts} voices, steady steps: ${stepsOk})`,
            result.starts === 7 && stepsOk);
        await ctx.close();
    }

    // --- SCALES ---
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'scales', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.evaluate(instrumentVoices);
        await tab.click('#againBtn');
        await tab.waitForTimeout(800);
        const tChange = await tab.evaluate(() => performance.now());
        await tab.click('.step-btn[data-step-key="rootPitch"][data-step-delta="1"]');
        await tab.waitForTimeout(1200);
        const trace = await tab.evaluate(() => window.__trace);
        const kills = trace.filter(e => e.type === 'kill' && e.t >= tChange);
        const newStarts = trace.filter(e => e.type === 'voice-start' && e.t >= tChange);
        report.check(`scales root-change: ${kills.length} kills then ${newStarts.length} voices, kill-first`,
            kills.length > 0 && newStarts.length > 0 && kills[0].t <= newStarts[0].t);
        await tab.evaluate(() => window.scalesController.stopPlayback());
        await tab.close();
    }

    // --- TRACE: guide playback spacing matches the drawn target spacing ---
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'trace', report.errors);
        await tab.goto(`${BASE_URL}/trace.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        await tab.evaluate(instrumentVoices);
        await tab.fill('#patternInput', '1 3 5');
        await tab.evaluate(() => {
            document.getElementById('patternInput').dispatchEvent(new Event('input', { bubbles: true }));
            const toggle = /** @type {HTMLInputElement} */ (document.getElementById('playGuidesToggle'));
            if (!toggle.checked) toggle.click();
        });
        await tab.click('#resetBtn');
        await tab.waitForTimeout(3200);
        const spacing = await tab.evaluate(() => {
            const starts = window.__trace.filter(e => e.type === 'voice-start').map(e => e.t);
            const deltas = [];
            for (let i = 1; i < starts.length; i++) deltas.push(starts[i] - starts[i - 1]);
            return { count: starts.length, deltas: deltas.map(d => Math.round(d)) };
        });
        // Default guide interval is 1000ms; drawn targets are spaced at
        // exactly that, so the sounded guide must be too.
        const spacingOk = spacing.count === 3
            && spacing.deltas.every(d => d >= 900 && d <= 1250);
        report.check(`trace guide spacing matches chart (${spacing.deltas.join(', ')}ms)`, spacingOk);
        await tab.close();
    }

    await browser.close();
    report.finish();
})();
