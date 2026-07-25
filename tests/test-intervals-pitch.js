// @ts-check
// intervals and pitch product behavior, extracted from the retired tab-functions monolith.
// Waits poll the observable state each step produces (page-ready handles,
// voice starts, prompt/status text, PRACTICE_PROGRESS entries) instead of
// padding wall-clock time.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

const WAIT_MS = 10000;

/**
 * Poll a page condition until it holds; returns false on timeout so the
 * caller's assertion reads and reports the final state itself.
 * @param {import('playwright').Page} tab
 * @param {(arg: any) => any} fn
 * @param {any} [arg]
 */
async function waitOn(tab, fn, arg) {
    try {
        await tab.waitForFunction(fn, arg, { timeout: WAIT_MS, polling: 50 });
        return true;
    } catch (err) {
        return false;
    }
}

// The assertions on these pages are structural (pattern text, counts,
// recorded verdicts), not pacing-sensitive, so the intervals contexts run
// with short configured durations: 100ms notes, 200ms gaps.
/** @param {import('playwright').Page} tab */
function seedFastIntervalTimings(tab) {
    return tab.addInitScript(() => {
        localStorage.setItem('voice-wei:intervals-settings',
            JSON.stringify({ lengthMs: 100, gapMs: 200 }));
    });
}

(async () => {
    const report = createReporter('intervals and pitch');
    const browser = await launchWithMic();
    // ============ INTERVALS: loop / Repeat / Next / Stop ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'intervals', report.errors);
        await seedFastIntervalTimings(tab);
        await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
        // Boot is done when the page publishes its debug handle (piano
        // loaded, buttons wired).
        await tab.waitForFunction(() => Boolean(window.intervalsDebug), null, { timeout: WAIT_MS });
        await tab.evaluate(instrumentVoices);
        // TTS never completes in headless Chrome, so the loop would stall on speech
        await tab.evaluate(() => document.getElementById('toggleSpeak').click());
        await tab.evaluate(() => document.getElementById('toggleRepeat').click());
        await tab.click('#playBtn');
        await tab.waitForFunction(
            () => Boolean(document.querySelector('#currentDisplay .pattern-degrees')?.textContent),
            null, { timeout: WAIT_MS, polling: 50 });
        const p1 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        // Repeat must hold the pattern across a full playback cycle: wait
        // until the piano starts a note beyond the first pass (counted by
        // the instrumented voice starts), then re-read the display.
        const noteCount = String(p1).split('-').length;
        await waitOn(tab, count => window.__voiceStarts > count, noteCount);
        const p2 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        report.check(`intervals repeat holds pattern ("${p1}")`, Boolean(p1) && p1 === p2);
        await tab.click('#nextBtn');
        // Next takes effect at the loop's next checkpoint; wait for the
        // display to actually advance.
        await waitOn(tab, prev => {
            const text = document.querySelector('#currentDisplay .pattern-degrees')?.textContent;
            return Boolean(text) && text !== prev;
        }, p1);
        const p3 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        report.check(`intervals Next advances ("${p1}" -> "${p3}")`, Boolean(p3) && p3 !== p1);
        await tab.click('#stopBtn');
        // stopLoop rewrites the display synchronously inside the click
        // handler, so no wait: read it back immediately.
        const stopped = await tab.evaluate(() => document.getElementById('currentDisplay').textContent);
        report.check('intervals Stop is immediate', stopped === 'Stopped');
        await tab.close();
    }

    // ============ INTERVALS SING: panel seeds from the pattern and scores ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'intervals-sing', report.errors);
        await seedFastIntervalTimings(tab);
        await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
        await tab.waitForFunction(() => Boolean(window.intervalsDebug), null, { timeout: WAIT_MS });
        await tab.click('#singBtn');
        // The panel opens with a generated pattern, then the mic start
        // attempt settles: Listening On, or the explicit unavailable
        // status. Only after that can the test decide whether there is a
        // live mic to stop.
        await waitOn(tab, () => {
            const open = !document.getElementById('intervalsSingPanel').hidden;
            const pattern = document.querySelector('#currentDisplay .pattern-degrees')?.textContent || '';
            const listenBtn = document.getElementById('intervalsSingListenBtn');
            const status = document.getElementById('intervalsSingStatus')?.textContent || '';
            const micSettled = Boolean(listenBtn && listenBtn.textContent.includes('On'))
                || status.includes('Microphone unavailable');
            return open && pattern.length > 0 && micSettled;
        });
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
        // Stop the mic first (the fake device's endless beeps keep the
        // voice "active", which keeps unreached targets pending), then
        // sing deterministically through the explicit sample seam.
        await tab.evaluate(() => {
            const listenBtn = document.getElementById('intervalsSingListenBtn');
            if (listenBtn && listenBtn.textContent.includes('On')) listenBtn.click();
            document.getElementById('intervalsSingPauseToggle').click();
            for (let k = 0; k < 5; k++) {
                window.intervalsDebug.panel.recordSample(60, 30 + k * 50);
            }
        });
        // Verdicts re-evaluate on mic frames; with the mic stopped the
        // panel only rescores when asked, so drive the evaluation by name
        // and poll until the finished take lands in PRACTICE_PROGRESS
        // (the last target resolves once the voice has been idle ~600ms).
        const recorded = await waitOn(tab, () => {
            window.intervalsDebug.panel.draw();
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            return entries.some(e => e.tool === 'intervals-sing');
        });
        report.check('intervals sing take recorded', recorded);
        await ctx.close();
    }

    // ============ PITCH METER: free session produces results ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'pitch-meter', report.errors);
        await tab.goto(`${BASE_URL}/pitch-meter.html`, { waitUntil: 'networkidle' });
        // Ready once the piano sampler has loaded and unlocked the controls.
        await tab.waitForFunction(() => Boolean(window.pitchMeter && window.pitchMeter.samplerLoaded),
            null, { timeout: WAIT_MS });
        await tab.click('[data-mode="free"]');
        await tab.click('#listenBtn');
        // The fake device's tone sits mostly above the singable band
        // (D2-C5), so only a handful of its samples register - which is
        // the band doing its job. Any recorded sample proves the
        // mic -> detector -> session pipeline end to end, so wait for the
        // first accepted sample rather than padding a listening period.
        await waitOn(tab, () => window.pitchMeter.session.history.length > 0);
        const samples = await tab.evaluate(() => window.pitchMeter.session.history.length);
        await tab.click('#stopBtn');
        // stopSession analyzes and renders results synchronously inside
        // the click handler.
        const resultsShown = await tab.evaluate(() => document.getElementById('resultsPanel').style.display);
        const notesHit = await tab.textContent('#notesHit');
        report.check(`pitch-meter free session (${samples} samples, notesHit ${notesHit})`,
            samples > 0 && resultsShown === 'block' && /^\d+\/\d+$/.test(notesHit));

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

    // ============ INTERVALS EAR: identify-answer-record + presets ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'intervals-ear', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html?mode=ear`, { waitUntil: 'networkidle' });
        // Full ear-mode boot shows 'Ready!' in the prompt (samples loaded,
        // buttons bound).
        await tab.waitForFunction(
            () => (document.getElementById('intervalPrompt')?.textContent || '').includes('Ready!'),
            null, { timeout: WAIT_MS });
        await tab.click('#earNextBtn');
        // The interval plays at the app's fixed pace (~1s), then the
        // prompt flips to the answer phase.
        await waitOn(tab, () => document.getElementById('intervalPrompt')?.textContent === 'What interval?');
        await tab.click('.answer-btn[data-interval="P5"]');
        // submitAnswer records feedback and stats synchronously inside the
        // click handler.
        const feedback = await tab.textContent('#intervalFeedback');
        const stats = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.INTERVALS_EAR_STATS));
        const total = Object.values(stats || {}).reduce((sum, s) => sum + s.total, 0);
        report.check('intervals ear answer recorded with feedback', feedback.trim().length > 0 && total >= 1);
        await tab.click('.vf-btn[data-preset="perfect"]');
        // applyPreset persists synchronously through SettingsStore.
        const enabled = await tab.evaluate(() => {
            const data = SettingsStore.peekData(StorageKeys.INTERVALS_SETTINGS);
            return data && data.enabledIntervals;
        });
        report.check('intervals ear preset filters intervals', Array.isArray(enabled) && enabled.length === 3);
        const mediaTitle = await tab.evaluate(() => navigator.mediaSession.metadata?.title || 'none');
        report.check('intervals ear media session registered', mediaTitle === 'Ear training');
        await ctx.close();
    }
    await browser.close();
    report.finish();
})();
