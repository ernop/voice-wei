// @ts-check
// Each tab's primary function works end to end.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('tab functions');
    const browser = await launchWithMic();

    // ============ SCALES: voice parser + execution + presets ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'scales', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);

        const parses = await tab.evaluate(() => {
            const c = window.scalesController;
            const cases = [
                ['d minor scale', cmd => cmd && cmd.type === 'scale' && cmd.root === 'D' && cmd.scaleType === 'minor'],
                ['g major up and down', cmd => cmd && cmd.type === 'scale' && cmd.root === 'G' && cmd.modifiers.direction === 'both'],
                ['slowly chromatic', cmd => cmd && cmd.scaleType === 'chromatic' && cmd.modifiers.tempo === 'slow'],
                ['perfect fifth from a', cmd => cmd && cmd.type === 'interval'],
                ['stop', cmd => cmd && cmd.type === 'stop'],
                ['harmonic minor repeat forever', cmd => cmd && cmd.scaleType === 'harmonic_minor' && cmd.modifiers.repeat === Infinity],
                ['d minor repeat forever no gap', cmd => cmd && cmd.root === 'D' && cmd.modifiers.repeat === Infinity && cmd.modifiers.repeatGapMs === 0],
                ['b flat major', cmd => cmd && cmd.root === 'A#' && cmd.scaleType === 'major'],
                ['c major and repeat', cmd => cmd && cmd.root === 'C' && cmd.modifiers.repeat === Infinity]
            ];
            return cases.map(([text, verify]) => {
                let cmd = null;
                try { cmd = c.parseScaleCommand(text); } catch (err) { return `${text} => THREW`; }
                return `${text} => ${verify(cmd) ? 'ok' : JSON.stringify(cmd)}`;
            });
        });
        parses.forEach(p => report.check(`scales parse "${p}"`, p.endsWith('ok')));

        const played = await tab.evaluate(async () => {
            const c = window.scalesController;
            const cmd = c.parseScaleCommand('e minor scale');
            c.executeScaleCommand(cmd, 'e minor scale');
            await new Promise(r => setTimeout(r, 700));
            const playing = c.audio.isPlaying;
            c.stopPlayback();
            return playing && c.settings.root === 'E' && c.settings.scaleType === 'minor';
        });
        report.check('scales voice command executes and plays', played);

        await tab.fill('#presetNameInput', 'suite-test');
        await tab.click('#savePresetBtn');
        await tab.waitForTimeout(300);
        await tab.click('.vf-btn[data-root="A"]');
        await tab.waitForTimeout(400);
        const presetApplied = await tab.evaluate(async () => {
            const c = window.scalesController;
            const preset = c.presets.find(p => p.name === 'suite-test');
            if (!preset) return false;
            c.applyConfig(preset.config);
            await new Promise(r => setTimeout(r, 300));
            c.stopPlayback();
            c.deletePresetById(preset.id);
            return c.settings.root === 'E';
        });
        report.check('scales preset save/apply', presetApplied);

        await tab.click('.vf-btn[data-repeat="Infinity"]');
        await tab.waitForTimeout(300);
        await tab.evaluate(() => window.scalesController.stopPlayback());
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        const inf = await tab.evaluate(() => window.scalesController.settings.repeatCount === Infinity);
        report.check('scales repeat-forever survives reload', inf);

        const mediaTitle = await tab.evaluate(() => navigator.mediaSession.metadata?.title || 'none');
        report.check('scales media session registered', mediaTitle === 'Scales');
        await tab.close();
    }

    // ============ INTERVALS: loop / Repeat / Next / Stop ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'intervals', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        // TTS never completes in headless Chrome, so the loop would stall on speech
        await tab.evaluate(() => document.getElementById('toggleSpeak').click());
        await tab.evaluate(() => document.getElementById('toggleRepeat').click());
        await tab.click('#playBtn');
        await tab.waitForTimeout(2500);
        const p1 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        await tab.waitForTimeout(2500);
        const p2 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        report.check(`intervals repeat holds pattern ("${p1}")`, Boolean(p1) && p1 === p2);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(3500);
        const p3 = await tab.evaluate(() => document.querySelector('#currentDisplay .pattern-degrees')?.textContent);
        report.check(`intervals Next advances ("${p1}" -> "${p3}")`, Boolean(p3) && p3 !== p1);
        await tab.click('#stopBtn');
        await tab.waitForTimeout(300);
        const stopped = await tab.evaluate(() => document.getElementById('currentDisplay').textContent);
        report.check('intervals Stop is immediate', stopped === 'Stopped');
        await tab.close();
    }

    // ============ PHRASES: reflect / mask / modes / history ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'phrases', report.errors);
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(1500);
        await tab.evaluate(instrumentVoices);

        await tab.click('#nextBtn');
        await tab.waitForTimeout(400);
        await tab.click('#stopBtn');
        const degrees = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));

        await tab.click('#reflectBtn');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const reflected = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        await tab.click('#reflectBtn');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const restored = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        report.check('phrases reflect roundtrip', reflected !== degrees && restored === degrees);

        const noteCount = degrees.split(' ').length;
        await tab.evaluate(() => {
            const btn = document.querySelector('.phrase-note-toggle[data-index="0"]');
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        });
        await tab.waitForTimeout(200);
        const starts0 = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        await tab.waitForTimeout(noteCount * 350 + 1200);
        const played = await tab.evaluate(() => window.__voiceStarts) - starts0;
        report.check(`phrases note mask (${noteCount} notes, 1 off, ${played} played)`, played === noteCount - 1);

        await tab.click('[data-output="display"]');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const sBefore = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        await tab.waitForTimeout(800);
        const sAfter = await tab.evaluate(() => window.__voiceStarts);
        report.check('phrases display mode is silent', sBefore === sAfter);
        await tab.click('[data-output="tones"]');
        await tab.waitForTimeout(200);
        await tab.click('#stopBtn');

        await tab.click('#nextBtn');
        await tab.waitForTimeout(300);
        await tab.click('#stopBtn');
        const historyCount = await tab.evaluate(() => document.querySelectorAll('#historyList .history-item').length);
        const s1 = await tab.evaluate(() => window.__voiceStarts);
        await tab.evaluate(() => document.querySelector('#historyList .history-play-btn').click());
        await tab.waitForTimeout(1500);
        const s2 = await tab.evaluate(() => window.__voiceStarts);
        report.check(`phrases history records and replays (${historyCount} items)`, historyCount >= 2 && s2 > s1);

        // "just over" range: offsets bounded to two degrees past the octave
        const overBounded = await tab.evaluate(() => {
            for (let i = 0; i < 300; i++) {
                const offsets = PatternPracticeCore.generateClusteredOffsets({
                    scaleType: 'major', startAtOne: false, rangeMode: 'over',
                    minLength: 5, maxLength: 9, returnToInitial: false, returnToRoot: false
                });
                if (Math.min(...offsets) < -2 || Math.max(...offsets) > 9) return false;
            }
            return true;
        });
        report.check('phrases "just over" bounded to 6-below..3-above', overBounded);
        await tab.click('[data-range="over"]');
        await tab.waitForTimeout(200);
        const savedRange = await tab.evaluate(() => JSON.parse(localStorage.getItem('phrases-settings')).rangeMode);
        report.check('phrases range mode persists', savedRange === 'over');
        await tab.close();
    }

    // ============ PITCH METER: free session produces results ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'pitch-meter', report.errors);
        await tab.goto(`${BASE_URL}/pitch-meter.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.click('[data-mode="free"]');
        await tab.click('#listenBtn');
        await tab.waitForTimeout(3000);
        const samples = await tab.evaluate(() => window.pitchMeter.session.history.length);
        await tab.click('#stopBtn');
        await tab.waitForTimeout(500);
        const resultsShown = await tab.evaluate(() => document.getElementById('resultsPanel').style.display);
        const notesHit = await tab.textContent('#notesHit');
        report.check(`pitch-meter free session (${samples} samples, notesHit ${notesHit})`,
            samples > 10 && resultsShown === 'block' && /^\d+\/\d+$/.test(notesHit));
        await ctx.close();
    }

    // ============ SING PANEL: per-note scoring appears once windows pass ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'sing-panel', report.errors);
        await tab.goto(`${BASE_URL}/scales.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.click('#singBtn');
        await tab.waitForTimeout(1000);
        // Wall-clock mode so all target windows pass deterministically
        await tab.evaluate(() => document.getElementById('scalesSingPauseToggle').click());
        await tab.waitForTimeout(4500);
        const score = await tab.textContent('#scalesSingScore');
        report.check(`sing panel scores after windows pass ("${score}")`,
            /Score: \d+\/\d+ on pitch/.test(score));
        await ctx.close();
    }

    // ============ EARS: identify-answer-record + presets ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'ears', report.errors);
        await tab.goto(`${BASE_URL}/ears.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2500);
        await tab.click('#nextBtn');
        await tab.waitForTimeout(2500);
        await tab.click('.answer-btn[data-interval="P5"]');
        await tab.waitForTimeout(600);
        const feedback = await tab.textContent('#intervalFeedback');
        const stats = await tab.evaluate(() => JSON.parse(localStorage.getItem('ears-stats')));
        const total = Object.values(stats).reduce((sum, s) => sum + s.total, 0);
        report.check('ears answer recorded with feedback', feedback.trim().length > 0 && total >= 1);
        await tab.click('.preset-btn[data-preset="perfect"]');
        await tab.waitForTimeout(300);
        const enabled = await tab.evaluate(() => JSON.parse(localStorage.getItem('ears-settings')).enabledIntervals);
        report.check('ears preset filters intervals', Array.isArray(enabled) && enabled.length === 3);
        await ctx.close();
    }

    // ============ PLAYER: API key gating + settings panel ============
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'player', report.errors);
        await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        const overlayShown = await tab.evaluate(() => {
            const overlay = document.getElementById('apiKeyOverlay');
            return overlay && getComputedStyle(overlay).display !== 'none';
        });
        report.check('player gates on missing API key', overlayShown === true);

        await tab.evaluate(() => localStorage.setItem('claudeApiKey', 'test-key-not-real-1234567890'));
        await tab.reload({ waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        const overlayGone = await tab.evaluate(() => {
            const overlay = document.getElementById('apiKeyOverlay');
            return !overlay || getComputedStyle(overlay).display === 'none';
        });
        await tab.click('#settingsBtn');
        await tab.waitForTimeout(400);
        const panelOpen = await tab.evaluate(() =>
            getComputedStyle(document.getElementById('settingsPanel')).display !== 'none');
        await tab.click('#closeSettingsBtn');
        await tab.waitForTimeout(300);
        const panelClosed = await tab.evaluate(() =>
            getComputedStyle(document.getElementById('settingsPanel')).display === 'none');
        report.check('player with key: overlay gone, settings open/close', overlayGone && panelOpen && panelClosed);
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
