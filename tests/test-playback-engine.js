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
        await tab.click('.vf-btn[data-root="G"]');
        await tab.waitForTimeout(1200);
        const trace = await tab.evaluate(() => window.__trace);
        const kills = trace.filter(e => e.type === 'kill' && e.t >= tChange);
        const newStarts = trace.filter(e => e.type === 'voice-start' && e.t >= tChange);
        report.check(`scales root-change: ${kills.length} kills then ${newStarts.length} voices, kill-first`,
            kills.length > 0 && newStarts.length > 0 && kills[0].t <= newStarts[0].t);
        await tab.evaluate(() => window.scalesController.stopPlayback());
        await tab.close();
    }

    await browser.close();
    report.finish();
})();
