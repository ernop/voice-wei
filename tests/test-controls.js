// @ts-check
// Shared controls (steppers, segment rows, toggles) work and persist
// per tab on every page that has them.

const { BASE_URL, launchWithMic, collectErrors, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('shared controls');
    const browser = await launchWithMic();

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
        const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('scales-settings')).noteLengthMs);
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
        const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('intervals-settings')));
        report.check(`intervals steppers saved ${saved.lengthMs}/${saved.gapMs}`,
            saved.lengthMs === 400 && saved.gapMs === 1500);
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
        const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('pitch-meter-settings')));
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
        const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('trace-settings')).guideSound);
        report.check(`trace guide sound default piano, persisted "${saved}"`, pianoDefault && saved === 'beep');
        await tab.click('#startBtn');
        await tab.waitForTimeout(1200);
        const status = await tab.textContent('#statusReadout');
        report.check(`trace listening starts ("${status}")`, status === 'Listening' || status === 'Listening and drawing');
        await ctx.close();
    }

    // EARS: toggle persists
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'ears', report.errors);
        await tab.goto(`${BASE_URL}/ears.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        await tab.evaluate(() => document.getElementById('autoAdvanceToggle').click());
        await tab.waitForTimeout(300);
        const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('ears-settings')).autoAdvance);
        report.check('ears toggle persisted', saved === true);
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
        const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('phrases-test-panel')).fixedWindow);
        await tab.click('#phraseTestCloseBtn');
        const closed = await tab.evaluate(() => document.getElementById('phraseTestPanel').hidden);
        report.check('phrases test panel opens, persists options, closes', panelOpen && saved === true && closed);
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
