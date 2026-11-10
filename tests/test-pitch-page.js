// @ts-check
// The Pitch page's Listen tool in a browser. Listen starts the microphone
// at once and nothing plays; Bottom, Top, and Fit to singing frame the
// chart; the Width slider shows its notched scale and sets the window;
// the silence switch sets the session's allowance; Reset clears the take;
// the scale finder ranks what was sung and Use applies its key; every
// setting survives a reload; no text is gray and finder rows stay one
// line on a phone. Notes are sung through the page's explicit sample
// seam, so nothing depends on the fake microphone's tone.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, installGrayTextScan, createReporter } = require('./helpers');

const WAIT = { timeout: 10000, polling: 50 };
const PHONE = { width: 390, height: 844 };

/**
 * Sing a melody through the sample seam: each note 10 samples 20ms apart,
 * notes 600ms apart so each is its own held note.
 * @param {import('playwright').Page} tab
 * @param {number[]} midis
 */
function sing(tab, midis) {
    return tab.evaluate(notes => {
        const start = window.pitchDebug.clockMs() + 1000;
        notes.forEach((midi, index) => {
            for (let k = 0; k < 10; k++) window.pitchDebug.recordSample(midi, start + index * 600 + k * 20);
        });
    }, midis);
}

const D_MAJOR_RUN = [62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62];

(async () => {
    const report = createReporter('pitch page');
    const browser = await launchWithMic();
    const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 900 } });
    const tab = await ctx.newPage();
    collectErrors(tab, 'pitch', report.errors);
    // A returning user may still have the retired free-practice mode stored.
    await tab.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('voice-wei:pitch-meter-settings', JSON.stringify({ mode: 'free' }));
    });
    await tab.goto(`${BASE_URL}/pitch-meter.html`, { waitUntil: 'networkidle' });
    await tab.waitForFunction(() => Boolean(window.pitchDebug), undefined, WAIT);
    await tab.evaluate(instrumentVoices);

    const boot = await tab.evaluate(() => {
        const debug = window.pitchDebug;
        const rails = debug.rails();
        /** @param {string} label */
        const priority = label => rails.find(rail => rail.label === label)?.labelPriority;
        return {
            mode: debug.settings().mode,
            selectedMode: document.querySelector('[data-mode].selected')?.getAttribute('data-mode'),
            listenEnabled: !(/** @type {HTMLButtonElement} */ (document.getElementById('listenBtn')).disabled),
            bounds: debug.verticalBounds(),
            railCount: rails.length,
            roots: rails.filter(rail => rail.context).map(rail => rail.label).join(' '),
            priorities: ['C4', 'G4', 'E4', 'D4', 'C#4'].map(priority).join(' '),
            allowance: debug.silenceAllowanceMs()
        };
    });
    report.check(`a stored retired free mode opens as call & response (${boot.mode}, chip ${boot.selectedMode})`,
        boot.mode === 'call-response' && boot.selectedMode === 'call-response');
    report.check(`the chart is chromatic from C3 to C5 with the key's labels ranked root, fifth, third, key, other (${boot.railCount} rails, roots ${boot.roots}, priorities ${boot.priorities})`,
        boot.railCount === 25 && boot.bounds.minMidi === 47.5 && boot.bounds.maxMidi === 72.5
        && boot.roots === 'C3 C4 C5' && boot.priorities === '0 1 2 3 4');

    await tab.click('#listenBtn');
    await tab.waitForFunction(() => window.pitchDebug.listening(), undefined, WAIT);
    const listening = await tab.evaluate(() => ({
        text: document.getElementById('listenBtn').textContent,
        active: document.getElementById('listenBtn').classList.contains('listening'),
        status: document.getElementById('status').textContent
    }));
    report.check(`Listen is ready at once and starts the microphone (${JSON.stringify(listening)}, enabled at boot ${boot.listenEnabled})`,
        boot.listenEnabled && listening.text === 'Stop' && listening.active && listening.status === 'Listening');

    await tab.evaluate(() => document.getElementById('timePassesToggle').click());
    const flowing = await tab.evaluate(() => ({
        allowance: String(window.pitchDebug.silenceAllowanceMs()),
        saved: SettingsStore.peekData(StorageKeys.PITCH_METER_SETTINGS).timePassesInSilence
    }));
    report.check(`time stops in silence by default (400ms mark); the switch lets it pass (${boot.allowance} -> ${flowing.allowance}, saved ${flowing.saved})`,
        boot.allowance === 400 && flowing.allowance === 'Infinity' && flowing.saved === true);

    await tab.click('#listenBtn');
    const stopped = await tab.evaluate(() => ({
        listening: window.pitchDebug.listening(),
        text: document.getElementById('listenBtn').textContent,
        status: document.getElementById('status').textContent
    }));
    report.check(`pressing it again stops listening (${JSON.stringify(stopped)})`,
        !stopped.listening && stopped.text === 'Listen' && stopped.status === 'Stopped');

    // Whatever the fake microphone's tone left on the chart goes first.
    await tab.click('#resetBtn');
    await sing(tab, D_MAJOR_RUN);
    const finder = await tab.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#scaleFinderList .pitch-finder-row'));
        const tonic = document.querySelector('.pitch-finder-bar.is-tonic .pitch-finder-note');
        return {
            top: window.pitchDebug.finder().candidates[0]?.name,
            rows: rows.length,
            firstName: rows[0]?.querySelector('.pitch-finder-name')?.textContent,
            firstPercent: rows[0]?.querySelector('.pitch-finder-percent')?.textContent,
            bars: document.querySelectorAll('#scaleFinderBars .pitch-finder-bar').length,
            tonic: tonic?.textContent,
            summary: document.getElementById('scaleFinderSummary').textContent,
            fitEnabled: !(/** @type {HTMLButtonElement} */ (document.getElementById('fitRangeBtn')).disabled)
        };
    });
    report.check(`the scale finder ranks a sung D major run (${JSON.stringify(finder)})`,
        finder.top === 'D major' && finder.firstName === 'D major' && /^\d+%$/.test(finder.firstPercent || '')
        && finder.rows >= 2 && finder.bars === 12 && finder.tonic === 'D'
        && finder.summary.startsWith('15 notes') && finder.fitEnabled);

    await tab.click('#scaleFinderList .pitch-finder-row:first-child .panel-action-btn');
    const used = await tab.evaluate(() => {
        const button = /** @type {HTMLButtonElement} */ (document.querySelector('#scaleFinderList .pitch-finder-row:first-child .panel-action-btn'));
        const settings = window.pitchDebug.settings();
        return {
            key: `${settings.rootNote} ${settings.scaleType}`,
            shown: document.getElementById('rootPitchValue').textContent,
            chip: document.querySelector('[data-scale].selected')?.getAttribute('data-scale'),
            button: `${button.textContent}${button.disabled ? ' (disabled)' : ''}`,
            roots: window.pitchDebug.rails().filter(rail => rail.context).map(rail => rail.label).join(' ')
        };
    });
    report.check(`Use applies the candidate's key to the page and the chart (${JSON.stringify(used)})`,
        used.key === 'D major' && used.shown === 'D4' && used.chip === 'major'
        && used.button === 'In use (disabled)' && used.roots === 'D3 D4');

    await tab.click('#fitRangeBtn');
    const fitted = await tab.evaluate(() => ({
        bounds: window.pitchDebug.verticalBounds(),
        bottom: document.getElementById('bottomValue').textContent,
        top: document.getElementById('topValue').textContent
    }));
    report.check(`Fit to singing frames the held notes with a semitone of room (${JSON.stringify(fitted)})`,
        fitted.bounds.minMidi === 60.5 && fitted.bounds.maxMidi === 75.5
        && fitted.bottom === 'C#4' && fitted.top === 'D#5');

    await tab.click('[data-step-key="bottomMidi"][data-step-delta="1"]');
    await tab.click('[data-step-key="topMidi"][data-step-delta="-1"]');
    const stepped = await tab.evaluate(() => ({
        bounds: window.pitchDebug.verticalBounds(),
        bottom: document.getElementById('bottomValue').textContent,
        top: document.getElementById('topValue').textContent,
        rails: window.pitchDebug.rails().length
    }));
    report.check(`Bottom and Top step by a semitone (${JSON.stringify(stepped)})`,
        stepped.bounds.minMidi === 61.5 && stepped.bounds.maxMidi === 74.5
        && stepped.bottom === 'D4' && stepped.top === 'D5' && stepped.rails === 13);

    const width = await tab.evaluate(() => {
        const slider = /** @type {HTMLInputElement} */ (document.getElementById('widthSlider'));
        const labels = Array.from(document.querySelectorAll('#widthScale b')).map(label => label.textContent);
        const notches = document.querySelectorAll('#widthScale i').length;
        const before = { value: slider.value, shown: document.getElementById('widthValue').textContent };
        slider.value = String(PracticeControls.WINDOW_VALUES_MS.indexOf(60000));
        slider.dispatchEvent(new Event('input'));
        return {
            labels: labels.join(' '),
            notches,
            before,
            windowMs: window.pitchDebug.settings().windowMs,
            shown: document.getElementById('widthValue').textContent,
            saved: SettingsStore.peekData(StorageKeys.PITCH_METER_SETTINGS).windowMs
        };
    });
    report.check(`the Width slider shows every notch labeled, both ends, and its value, and sets the window (${JSON.stringify(width)})`,
        width.labels === '2s 5s 10s 15s 20s 30s 45s 60s 90s 120s' && width.notches === 10
        && width.before.value === '4' && width.before.shown === '20s'
        && width.windowMs === 60000 && width.shown === '60s' && width.saved === 60000);

    await tab.evaluate(installGrayTextScan);
    const grayWithFinder = await tab.evaluate(() => window.__scanGrayText());

    await tab.evaluate(() => document.getElementById('scaleFinderToggle').click());
    const finderHidden = await tab.evaluate(() => ({
        hidden: document.getElementById('scaleFinderCard').hidden,
        saved: SettingsStore.peekData(StorageKeys.PITCH_METER_SETTINGS).showScaleFinder
    }));
    await tab.evaluate(() => document.getElementById('scaleFinderToggle').click());
    report.check(`the Scale finder switch hides and shows its card (${JSON.stringify(finderHidden)})`,
        finderHidden.hidden && finderHidden.saved === false
        && await tab.evaluate(() => !document.getElementById('scaleFinderCard').hidden));

    await tab.setViewportSize(PHONE);
    const phone = await tab.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#scaleFinderList .pitch-finder-row'));
        // One line: every item that shows something sits on the row's
        // vertical center (the row centers its items).
        const multiLine = rows.filter(row => {
            const rowRect = row.getBoundingClientRect();
            const rowCenter = rowRect.top + rowRect.height / 2;
            return Array.from(row.children)
                .filter(child => child.textContent)
                .some(child => {
                    const rect = child.getBoundingClientRect();
                    return Math.abs(rect.top + rect.height / 2 - rowCenter) > 4;
                });
        }).length;
        const labels = Array.from(document.querySelectorAll('#widthScale b')).map(label => label.getBoundingClientRect());
        const overlaps = labels.filter((rect, index) => index > 0 && rect.left < labels[index - 1].right - 1).length;
        const page = document.querySelector('main').getBoundingClientRect();
        const overflow = labels.filter(rect => rect.left < page.left - 1 || rect.right > page.right + 1).length;
        return { rows: rows.length, multiLine, overlaps, overflow, gray: window.__scanGrayText() };
    });
    report.check(`on a phone the finder rows stay one line and the slider labels neither overlap nor overflow (${phone.rows} rows, ${phone.multiLine} multi-line, ${phone.overlaps} overlaps, ${phone.overflow} outside)`,
        phone.rows >= 2 && phone.multiLine === 0 && phone.overlaps === 0 && phone.overflow === 0);
    const offenders = [...grayWithFinder, ...phone.gray];
    report.check(`no gray or dimmed text, desktop and phone (${offenders.length} offenders${offenders.length ? ': ' + offenders.slice(0, 5).join('; ') : ''})`,
        offenders.length === 0);
    await tab.setViewportSize({ width: 1280, height: 900 });

    await tab.click('#resetBtn');
    const reset = await tab.evaluate(() => ({
        samples: window.pitchDebug.history().length,
        clock: window.pitchDebug.clockMs(),
        summary: document.getElementById('scaleFinderSummary').textContent,
        rows: document.querySelectorAll('#scaleFinderList .pitch-finder-row').length,
        fitDisabled: /** @type {HTMLButtonElement} */ (document.getElementById('fitRangeBtn')).disabled
    }));
    report.check(`Reset clears the take, the finder, and Fit (${JSON.stringify(reset)})`,
        reset.samples === 0 && reset.clock === 0 && reset.summary === 'Sing a few notes'
        && reset.rows === 0 && reset.fitDisabled);

    const voiceStarts = await tab.evaluate(() => window.__voiceStarts);
    report.check(`listening, finding, framing, and resetting play nothing (${voiceStarts} piano voices)`, voiceStarts === 0);

    await tab.reload({ waitUntil: 'networkidle' });
    await tab.waitForFunction(() => Boolean(window.pitchDebug), undefined, WAIT);
    const restored = await tab.evaluate(() => {
        const settings = window.pitchDebug.settings();
        return {
            range: `${settings.bottomMidi}-${settings.topMidi}`,
            key: `${settings.rootNote}${settings.octave} ${settings.scaleType}`,
            windowMs: settings.windowMs,
            slider: /** @type {HTMLInputElement} */ (document.getElementById('widthSlider')).value,
            allowance: String(window.pitchDebug.silenceAllowanceMs()),
            toggle: /** @type {HTMLInputElement} */ (document.getElementById('timePassesToggle')).checked,
            mode: settings.mode
        };
    });
    report.check(`range, key, width, and the silence switch survive a reload (${JSON.stringify(restored)})`,
        restored.range === '62-74' && restored.key === 'D4 major' && restored.windowMs === 60000
        && restored.slider === '7' && restored.allowance === 'Infinity' && restored.toggle
        && restored.mode === 'call-response');

    await ctx.close();
    await browser.close();
    report.finish();
})();
