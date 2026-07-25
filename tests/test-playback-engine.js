// @ts-check
// The playback law: old-settings voices are killed before new-settings
// voices start; stops are final; setting-change behaviors follow
// docs/parameters.md (phrases regen rules).
//
// No fixed sleeps: every wait polls the observable state it is padding
// for (window.__voiceStarts / window.__trace from instrumentVoices, the
// pages' debug handles, DOM control state). The only clock-based waits
// left are the observation windows that negative assertions need ("no
// voice started in this span"), and those are anchored to observed event
// times and sized in multiples of the configured note cadence. Sections
// are independent pages, so they run in parallel contexts; checks are
// buffered per section and reported in a stable order.

const { BASE_URL, launch, collectErrors, instrumentVoices, createReporter } = require('./helpers');

const WAIT = { timeout: 10000, polling: 25 };

(async () => {
    const report = createReporter('playback engine');
    const browser = await launch();

    /**
     * Run one section in its own browser context, buffering its checks so
     * parallel sections cannot interleave the report. A thrown error
     * (usually a wait timeout) becomes a FAIL line instead of killing the
     * other sections.
     * @param {string} name
     * @param {(ctx: import('playwright').BrowserContext,
     *          check: (label: string, ok: boolean) => void) => Promise<void>} body
     * @returns {Promise<Array<[string, boolean]>>}
     */
    async function runSection(name, body) {
        /** @type {Array<[string, boolean]>} */
        const checks = [];
        const ctx = await browser.newContext();
        try {
            await body(ctx, (label, ok) => checks.push([label, ok]));
        } catch (err) {
            const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
            checks.push([`${name} section error: ${message}`, false]);
        } finally {
            await ctx.close();
        }
        return checks;
    }

    // --- PHRASES ---
    const phrasesSection = runSection('phrases', async (ctx, check) => {
        const tab = await ctx.newPage();
        collectErrors(tab, 'phrases', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'domcontentloaded' });
        // phrasesDebug appears at the end of boot: piano samples resolved
        // and the UI is wired.
        await tab.waitForFunction(() => window.phrasesDebug !== undefined, undefined, WAIT);
        await tab.evaluate(instrumentVoices);
        await tab.click('#playBtn');
        await tab.waitForFunction(() =>
            window.__voiceStarts >= 1
            && document.querySelectorAll('.phrase-degree-token').length > 0, undefined, WAIT);
        const degreesBefore = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        const notesBefore = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-note-name-token')).map(el => el.textContent).join(' '));
        const tChange = await tab.evaluate(() => performance.now());
        await tab.click('[data-step-key="rootPitch"][data-step-delta="1"]');
        // Wait until playback demonstrably continued past the change (a
        // new voice started) and the 150ms kill-burst window has fully
        // elapsed, so the no-kill check below observes the whole span.
        await tab.waitForFunction(tc =>
            window.__trace.some(e => e.type === 'voice-start' && e.t >= tc)
            && performance.now() >= tc + 250, tChange, WAIT);
        const trace = await tab.evaluate(() => window.__trace);

        // Setting changes never start or restart playback: the running
        // loop continues uninterrupted (no kill burst at the change) and
        // picks the new key up live on its next note.
        const kills = trace.filter(e => e.type === 'kill' && e.t >= tChange && e.t < tChange + 150);
        const newStarts = trace.filter(e => e.type === 'voice-start' && e.t >= tChange);
        check(`phrases root+ mid-playback: no restart (${kills.length} kills at change), playback continues (${newStarts.length} voices)`,
            kills.length === 0 && newStarts.length > 0);

        const degreesAfter = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        const notesAfter = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-note-name-token')).map(el => el.textContent).join(' '));
        check('phrases root+ keeps degrees, transposes notes',
            degreesBefore === degreesAfter && notesBefore !== notesAfter);

        // min/max phrase length is bounds-next: never regenerates the current phrase
        await tab.click('#stopBtn');
        const seqBefore = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        const lenBefore = await tab.evaluate(() => ({
            min: document.getElementById('minLengthValue').textContent,
            max: document.getElementById('maxLengthValue').textContent
        }));
        await tab.click('[data-step-key="maxLength"][data-step-delta="-1"]');
        await tab.click('[data-step-key="minLength"][data-step-delta="1"]');
        // The stepper value readouts are the observable that both steps
        // (and any synchronous regeneration they would cause) landed.
        await tab.waitForFunction(before =>
            document.getElementById('minLengthValue').textContent !== before.min
            && document.getElementById('maxLengthValue').textContent !== before.max, lenBefore, WAIT);
        const seqAfter = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        check('phrases min/max steppers keep current phrase', seqBefore === seqAfter);

        // show-names is redraw-only
        const startsBefore = (await tab.evaluate(() => window.__voiceStarts));
        const showBefore = await tab.evaluate(() => window.phrasesDebug.settings().showNoteNames);
        const tToggle = await tab.evaluate(() => performance.now());
        await tab.evaluate(() => document.getElementById('showNamesToggle').click());
        // Observable: the setting flipped; then a 300ms window (one full
        // note cadence at the 300ms default) in which a wrongly triggered
        // replay's first voice would have started.
        await tab.waitForFunction(args =>
            window.phrasesDebug.settings().showNoteNames === !args.showBefore
            && performance.now() >= args.tToggle + 300, { showBefore, tToggle }, WAIT);
        const startsAfter = (await tab.evaluate(() => window.__voiceStarts));
        check('phrases show-names is redraw-only', startsBefore === startsAfter);

        // stop is final
        const startsAtPlay = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        await tab.waitForFunction(n => window.__voiceStarts > n, startsAtPlay, WAIT);
        await tab.click('#stopBtn');
        // 150ms grace for a voice already in flight at the stop, then a
        // 700ms observation window: at the 300ms default cadence a loop
        // that survived the stop would land 2+ voices inside it.
        const t2 = await tab.evaluate(() => performance.now() + 150);
        await tab.waitForFunction(t => performance.now() >= t + 700, t2, WAIT);
        const lateStarts = (await tab.evaluate(() => window.__trace))
            .filter(e => e.type === 'voice-start' && e.t > t2).length;
        check('phrases stop is final (no voices after stop)', lateStarts === 0);
    });

    // --- PHRASES: live note mask ---
    // Muting an upcoming note mid-playthrough skips it when its position
    // arrives, without restarting playback or killing the sounding note.
    // The assertions are structural (voice count, steady step ratio), so
    // the phrase runs at a 300ms cadence instead of 1000ms; the steady-
    // step threshold keeps the same 0.7 ratio of the cadence.
    const liveMaskSection = runSection('phrases-live-mask', async (ctx, check) => {
        await ctx.addInitScript(() => {
            localStorage.setItem('phrases-settings', JSON.stringify({
                root: 'D#', octave: 3, scaleType: 'major', phraseAlgo: 'arch',
                startAtOne: true, rangeLow: 0, rangeHigh: 7, minLength: 8, maxLength: 8,
                returnToInitial: false, returnToRoot: false,
                hearTones: true, hearSpeech: false, singNumbers: false,
                noteLengthMs: 300, gapMs: 0, showNoteNames: true
            }));
        });
        const tab = await ctx.newPage();
        collectErrors(tab, 'phrases-live-mask', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() => window.phrasesDebug !== undefined, undefined, WAIT);
        await tab.evaluate(instrumentVoices);
        await tab.click('#nextBtn');
        // Mute while the first slots are sounding - well before slot 6
        // arrives at ~1.8s into the 8x300ms phrase.
        await tab.waitForFunction(() =>
            window.__voiceStarts >= 1
            && document.querySelector('.phrase-degree-token[data-index="6"]') !== null, undefined, WAIT);
        await tab.evaluate(() => {
            const token = document.querySelector('.phrase-degree-token[data-index="6"]');
            token.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        });
        // Completion: the 7 expected voices, then a quiet gap of well over
        // two cadences to prove nothing else follows (an 8th voice or a
        // restarted pass would extend the trace and fail the count).
        await tab.waitForFunction(() => window.__voiceStarts >= 7, undefined, WAIT);
        await tab.waitForFunction(() =>
            performance.now() - window.__trace[window.__trace.length - 1].t > 800, undefined, WAIT);
        // 7 starts proves the muted note was skipped in place: a restart
        // would replay from the top (9+), no live read would play all 8.
        const result = await tab.evaluate(() => ({
            starts: window.__voiceStarts,
            stepsMs: window.__trace
                .filter(e => e.type === 'voice-start')
                .map((e, i, all) => (i ? e.t - all[i - 1].t : 0))
                .slice(1)
        }));
        const stepsOk = result.stepsMs.every(step => step > 210);
        check(`phrases live mask skips muted note without restart (${result.starts} voices, steady steps: ${stepsOk})`,
            result.starts === 7 && stepsOk);
    });

    // --- SCALES ---
    const scalesSection = runSection('scales', async (ctx, check) => {
        const tab = await ctx.newPage();
        collectErrors(tab, 'scales', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'domcontentloaded' });
        // init() registers the media session ('Scales') last, after the
        // piano samples resolved and the UI is wired.
        await tab.waitForFunction(() =>
            navigator.mediaSession && navigator.mediaSession.metadata
            && navigator.mediaSession.metadata.title === 'Scales', undefined, WAIT);
        await tab.evaluate(instrumentVoices);
        await tab.click('#againBtn');
        // Change the root while the first note is still sounding (0.3s
        // note + 0.25s damper at default settings), so the old-settings
        // voice is live and must be killed.
        await tab.waitForFunction(() => window.__voiceStarts >= 1, undefined, WAIT);
        const tChange = await tab.evaluate(() => performance.now());
        await tab.click('.step-btn[data-step-key="rootPitch"][data-step-delta="1"]');
        await tab.waitForFunction(tc =>
            window.__trace.some(e => e.type === 'kill' && e.t >= tc)
            && window.__trace.some(e => e.type === 'voice-start' && e.t >= tc), tChange, WAIT);
        const trace = await tab.evaluate(() => window.__trace);
        const kills = trace.filter(e => e.type === 'kill' && e.t >= tChange);
        const newStarts = trace.filter(e => e.type === 'voice-start' && e.t >= tChange);
        check(`scales root-change: ${kills.length} kills then ${newStarts.length} voices, kill-first`,
            kills.length > 0 && newStarts.length > 0 && kills[0].t <= newStarts[0].t);
        await tab.evaluate(() => window.scalesController.stopPlayback());
    });

    // --- SCALES: chop head ---
    // One repeat = a full shrinking cycle: 8-note scale plays 8 passes of
    // 8, 7, 6, ... 1 notes (36 voices), with the section gap between passes.
    const chopHeadSection = runSection('scales-chop-head', async (ctx, check) => {
        await ctx.addInitScript(() => {
            localStorage.setItem('scales-settings', JSON.stringify({
                root: 'C', octave: 4, scaleType: 'major', direction: 'ascending',
                sectionLength: '1o', movementStyle: 'normal', exercise: 'none',
                risingSemitones: 0, shiftingSteps: 0, chopHead: 1,
                repeatCount: 1, repeatGapMs: 200, noteLengthMs: 100, gapMs: 0
            }));
        });
        const tab = await ctx.newPage();
        collectErrors(tab, 'scales-chop-head', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() =>
            navigator.mediaSession && navigator.mediaSession.metadata
            && navigator.mediaSession.metadata.title === 'Scales', undefined, WAIT);

        const chopOnSelected = await tab.evaluate(() =>
            document.querySelector('[data-chop-head="1"]')?.classList.contains('selected'));
        check('scales chop head button reflects persisted setting', chopOnSelected === true);

        await tab.evaluate(instrumentVoices);
        await tab.click('#againBtn');
        // Completion: all 36 voices, then a quiet gap longer than the
        // 300ms pass gap (100ms note + 200ms repeat gap) so a 37th voice
        // or an extra pass would have shown up before we read the trace.
        await tab.waitForFunction(() => window.__voiceStarts >= 36, undefined, WAIT);
        await tab.waitForFunction(() =>
            performance.now() - window.__trace[window.__trace.length - 1].t > 700, undefined, WAIT);

        const result = await tab.evaluate(() => {
            const starts = window.__trace.filter(e => e.type === 'voice-start').map(e => e.t);
            const passBreaks = [];
            for (let i = 1; i < starts.length; i++) {
                if (starts[i] - starts[i - 1] > 220) passBreaks.push(i);
            }
            return { total: starts.length, passBreaks };
        });
        // Pass sizes come from the break positions: 8, 15, 21, 26, 30, 33, 35.
        const expectedBreaks = [8, 15, 21, 26, 30, 33, 35];
        const breaksOk = result.passBreaks.length === expectedBreaks.length
            && result.passBreaks.every((b, i) => b === expectedBreaks[i]);
        check(`scales chop head plays 36 shrinking notes (got ${result.total}, breaks ${result.passBreaks.join(',')})`,
            result.total === 36 && breaksOk);
    });

    // --- TRACE: guide playback spacing matches the drawn target spacing ---
    // The invariant is proportional (sounded spacing == chart spacing ==
    // guideIntervalMs), so the guide interval runs at 400ms instead of the
    // 1000ms default; the accepted band keeps the same -10%/+25% ratios.
    const traceSection = runSection('trace', async (ctx, check) => {
        await ctx.addInitScript(() => {
            localStorage.setItem('trace-settings', JSON.stringify({ guideIntervalMs: 400 }));
        });
        const tab = await ctx.newPage();
        collectErrors(tab, 'trace', report.errors);
        await tab.goto(`${BASE_URL}/trace.html`, { waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() =>
            window.traceDebug !== undefined && typeof Tone !== 'undefined', undefined, WAIT);
        // The guide piano is silently skipped until its samples resolve;
        // Tone.loaded() is the samples-ready observable.
        await tab.evaluate(() => Tone.loaded());
        await tab.evaluate(instrumentVoices);
        await tab.fill('#patternInput', '1 3 5');
        await tab.evaluate(() => {
            document.getElementById('patternInput').dispatchEvent(new Event('input', { bubbles: true }));
            const toggle = /** @type {HTMLInputElement} */ (document.getElementById('playGuidesToggle'));
            if (!toggle.checked) toggle.click();
        });
        await tab.click('#resetBtn');
        // All 3 guide voices, then a quiet gap longer than one interval:
        // a doubled playback's 4th voice would land inside it.
        await tab.waitForFunction(() => window.__voiceStarts >= 3, undefined, WAIT);
        await tab.waitForFunction(() =>
            performance.now() - window.__trace[window.__trace.length - 1].t > 600, undefined, WAIT);
        const spacing = await tab.evaluate(() => {
            const starts = window.__trace.filter(e => e.type === 'voice-start').map(e => e.t);
            const deltas = [];
            for (let i = 1; i < starts.length; i++) deltas.push(starts[i] - starts[i - 1]);
            return { count: starts.length, deltas: deltas.map(d => Math.round(d)) };
        });
        // Guide interval is set to 400ms; drawn targets are spaced at
        // exactly that, so the sounded guide must be too.
        const spacingOk = spacing.count === 3
            && spacing.deltas.every(d => d >= 360 && d <= 500);
        check(`trace guide spacing matches chart (${spacing.deltas.join(', ')}ms)`, spacingOk);
    });

    const sections = await Promise.all([
        phrasesSection, liveMaskSection, scalesSection, chopHeadSection, traceSection
    ]);
    await browser.close();
    sections.flat().forEach(([label, ok]) => report.check(label, ok));
    report.finish();
})();
