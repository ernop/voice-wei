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
        await tab.click('.step-btn[data-step-key="rootPitch"][data-step-delta="1"]');
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

    // ============ INTERVALS SING: panel seeds from the pattern and scores ============
    {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        const tab = await ctx.newPage();
        collectErrors(tab, 'intervals-sing', report.errors);
        await tab.goto(`${BASE_URL}/intervals.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);
        await tab.click('#singBtn');
        await tab.waitForTimeout(1000);
        const opened = await tab.evaluate(() => ({
            open: !document.getElementById('intervalsSingPanel').hidden,
            pattern: document.querySelector('#currentDisplay .pattern-degrees')?.textContent || ''
        }));
        report.check(`intervals Sing opens with a pattern ("${opened.pattern}")`,
            opened.open && opened.pattern.length > 0);
        // Wall-clock mode so the windows pass; take should be recorded.
        // Sing deterministically through the explicit sample seam (the
        // fake mic's beeps are not reliable enough to count on).
        await tab.evaluate(() => {
            document.getElementById('intervalsSingPauseToggle').click();
            for (let k = 0; k < 5; k++) {
                window.intervalsDebug.panel.recordSample(60, 30 + k * 50);
            }
        });
        const noteCount = Math.max(2, opened.pattern.split('-').length);
        await tab.waitForTimeout(noteCount * 600 + 2500);
        const recorded = await tab.evaluate(() => {
            // Verdicts re-evaluate on mic frames; the headless fake mic
            // sometimes fails to start, so drive the evaluation by name.
            window.intervalsDebug.panel.draw();
            const entries = JSON.parse(localStorage.getItem('practice-progress') || '[]');
            return entries.some(e => e.tool === 'intervals-sing');
        });
        report.check('intervals sing take recorded', recorded);
        await ctx.close();
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
            const btn = document.querySelector('.phrase-degree-token[data-index="0"]');
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
            const algos = ['balanced', 'random', 'stepwise', 'leapy', 'arch', 'motif'];
            for (const phraseAlgo of algos) {
                for (let i = 0; i < 300; i++) {
                    const offsets = PatternPracticeCore.generatePhraseOffsets({
                        scaleType: 'major', phraseAlgo, startAtOne: false, rangeMode: 'over',
                        minLength: 5, maxLength: 9, returnToInitial: false, returnToRoot: false
                    });
                    if (Math.min(...offsets) < -2 || Math.max(...offsets) > 9) return false;
                }
            }
            return true;
        });
        report.check('phrases algos keep "just over" bounded to 6-below..3-above', overBounded);
        await tab.click('[data-range="over"]');
        await tab.waitForTimeout(200);
        const savedRange = await tab.evaluate(() => JSON.parse(localStorage.getItem('phrases-settings')).rangeMode);
        report.check('phrases range mode persists', savedRange === 'over');
        await tab.click('[data-phrase-algo="arch"]');
        await tab.waitForTimeout(200);
        const savedAlgo = await tab.evaluate(() => JSON.parse(localStorage.getItem('phrases-settings')).phraseAlgo);
        report.check('phrases algorithm persists', savedAlgo === 'arch');

        // Motif is a transposed shape, not a wandering walk: the leading
        // interval shape must be restated verbatim later in the phrase
        // (away from range edges, where bounding may distort it).
        const motifStructure = await tab.evaluate(() => {
            let hits = 0;
            for (let i = 0; i < 6; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeMode: 'expanded', minLength: 8, maxLength: 10,
                    returnToInitial: false, returnToRoot: false, phraseAlgo: 'motif'
                });
                const o = phrase.notes.map(n => n.offset);
                const d = o.slice(1).map((v, idx) => v - o[idx]);
                for (let shapeLen = 2; shapeLen <= 3; shapeLen++) {
                    const shape = d.slice(0, shapeLen).join(',');
                    const rest = [];
                    for (let s = shapeLen + 1; s + shapeLen <= d.length; s++) {
                        rest.push(d.slice(s, s + shapeLen).join(','));
                    }
                    if (rest.includes(shape)) { hits++; break; }
                }
            }
            return hits;
        });
        report.check(`phrases motif restates its shape (${motifStructure}/6 samples)`, motifStructure >= 4);

        // Chromatic runs: passing tones appear only between whole-step
        // degrees and always sit strictly between their neighbors' pitches.
        const chromatic = await tab.evaluate(() => {
            let decorated = 0;
            let invalid = 0;
            for (let i = 0; i < 10; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeMode: 'over', minLength: 6, maxLength: 12,
                    returnToInitial: false, returnToRoot: false,
                    phraseAlgo: 'stepwise', chromaticRuns: true
                });
                phrase.notes.forEach((note, idx) => {
                    if (Number.isInteger(note.offset)) return;
                    decorated++;
                    const m = phrase.notes.map(n => n.midi);
                    const between = (m[idx - 1] < m[idx] && m[idx] < m[idx + 1])
                        || (m[idx - 1] > m[idx] && m[idx] > m[idx + 1]);
                    const label = note.degree;
                    if (!between || !(label.endsWith('#') || label.endsWith('b'))) invalid++;
                });
            }
            return { decorated, invalid };
        });
        report.check(`phrases chromatic runs insert valid passing tones (${chromatic.decorated} inserted, ${chromatic.invalid} invalid)`,
            chromatic.decorated > 0 && chromatic.invalid === 0);
        await tab.evaluate(() => document.getElementById('chromaticToggle').click());
        await tab.waitForTimeout(200);
        const savedChromatic = await tab.evaluate(() => JSON.parse(localStorage.getItem('phrases-settings')).chromaticRuns);
        report.check('phrases chromatic toggle persists', savedChromatic === true);

        // The take plan is one explicit timeline: with the FIRST note
        // muted, the first enabled target starts at 0 and disabled notes
        // own no time (test matches what playback actually sounds like).
        const plan = await tab.evaluate(() => {
            const tokens = document.querySelectorAll('.phrase-degree-token');
            tokens[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            const notes = window.phrasesDebug.takePlan();
            const targets = window.phrasesDebug.testTargets();
            return {
                total: notes.length,
                firstDisabled: notes[0].enabled === false && notes[0].startMs === null,
                targetCount: targets.length,
                enabledCount: notes.filter(n => n.enabled).length,
                firstTargetAtZero: targets[0].startMs === 0,
                allActive: targets.every(t => t.active)
            };
        });
        report.check(`phrases take plan: muted first note owns no time, timeline starts at 0 (${plan.targetCount}/${plan.total} targets)`,
            plan.firstDisabled && plan.firstTargetAtZero && plan.targetCount === plan.enabledCount && plan.allActive);

        // Opening the test never auto-plays: the user is there to sing.
        // Quiesce any playback still running from earlier checks first.
        await tab.click('#stopBtn');
        await tab.waitForTimeout(500);
        const voicesBefore = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.click('#testBtn');
        await tab.waitForTimeout(1500);
        const voicesAfter = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        report.check(`phrases test open is silent (${voicesAfter - voicesBefore} voices started)`,
            voicesAfter === voicesBefore);

        // The Guide button is the explicit way to hear the targets.
        await tab.evaluate(() => document.getElementById('phraseTestGuideBtn').click());
        await tab.waitForTimeout(2500);
        const voicesGuide = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        report.check(`phrases Guide button plays enabled targets (${voicesGuide - voicesAfter} voices)`,
            voicesGuide - voicesAfter === plan.targetCount);

        // END-TO-END NOTE LINKAGE: with notes disabled, singing exactly
        // the displayed enabled notes must credit every one of them.
        // Sing via the explicit sample seam at each target's window.
        const linkage = await tab.evaluate(async () => {
            document.getElementById('phraseTestPauseToggle').click(); // wall clock + session reset
            const targets = window.phrasesDebug.testTargets();
            const panel = window.phrasesDebug.panel;
            for (const t of targets) {
                for (let k = 0; k < 5; k++) {
                    panel.recordSample(t.midi, t.startMs + 10 + k * 55);
                }
            }
            const lastEnd = targets[targets.length - 1].endMs;
            await new Promise(r => setTimeout(r, lastEnd + 800));
            return {
                count: targets.length,
                score: document.getElementById('phraseTestScore').textContent
            };
        });
        report.check(`phrases sings-right-thing-scores-right (${linkage.score})`,
            linkage.score.includes(`${linkage.count}/${linkage.count}`));

        // The action row stays visible while scrolled mid-take.
        await tab.evaluate(() => window.scrollTo(0, 700));
        await tab.waitForTimeout(300);
        const pinned = await tab.evaluate(() => {
            const rect = document.querySelector('#phraseTestPanel .pitch-test-actions').getBoundingClientRect();
            return { top: rect.top, visible: rect.top >= 0 && rect.bottom <= window.innerHeight };
        });
        report.check(`phrases test actions stay visible when scrolled (top=${pinned.top.toFixed(0)}px)`, pinned.visible);
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

        const pmProgress = await tab.evaluate(() => {
            const entries = JSON.parse(localStorage.getItem('practice-progress') || '[]');
            return {
                count: entries.filter(e => e.tool === 'pitch-meter').length,
                line: document.getElementById('progressSummary').textContent
            };
        });
        report.check(`pitch-meter session recorded once (${pmProgress.count}) trend "${pmProgress.line}"`,
            pmProgress.count === 1 && /^Progress: Today \d+%/.test(pmProgress.line));
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

        // The completed take is recorded and the trend line appears
        const progress = await tab.evaluate(() => {
            const entries = JSON.parse(localStorage.getItem('practice-progress') || '[]');
            return {
                entry: entries.find(e => e.tool === 'scales-sing') || null,
                line: document.getElementById('scalesSingProgress').textContent
            };
        });
        report.check(`sing take recorded (${JSON.stringify(progress.entry && progress.entry.total)}) trend "${progress.line}"`,
            progress.entry !== null && progress.entry.total > 0 && /^Progress: Today \d+%/.test(progress.line));
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
        await tab.click('.vf-btn[data-preset="perfect"]');
        await tab.waitForTimeout(300);
        const enabled = await tab.evaluate(() => JSON.parse(localStorage.getItem('ears-settings')).enabledIntervals);
        report.check('ears preset filters intervals', Array.isArray(enabled) && enabled.length === 3);
        const mediaTitle = await tab.evaluate(() => navigator.mediaSession.metadata?.title || 'none');
        report.check('ears media session registered', mediaTitle === 'Ears');
        await ctx.close();
    }

    // ============ PLAYER VOICE: shared core drives commands and music requests ============
    {
        const ctx = await browser.newContext();
        // Fake key (long enough to pass the gate) and a controllable fake
        // SpeechRecognition, installed before page scripts run.
        await ctx.addInitScript(() => {
            localStorage.setItem('claudeApiKey', 'test-key-not-real-1234567890');
            window.__recs = [];
            class FakeSpeechRecognition {
                constructor() {
                    window.__recs.push(this);
                    this.continuous = false;
                    this.interimResults = false;
                    this.lang = '';
                }
                start() { this.onstart && this.onstart(); }
                stop() { this.onend && this.onend(); }
                abort() { this.onend && this.onend(); }
            }
            window.__emitResult = (text, isFinal = true) => {
                const rec = window.__recs[window.__recs.length - 1];
                const result = [{ transcript: text }];
                result.isFinal = isFinal;
                rec.onresult({ resultIndex: 0, results: [result] });
            };
            window.SpeechRecognition = FakeSpeechRecognition;
            window.webkitSpeechRecognition = FakeSpeechRecognition;
            // Claude is unreachable in tests; fail fast so the flow resolves
            const realFetch = window.fetch.bind(window);
            window.fetch = (url, ...rest) => {
                if (String(url).includes('anthropic')) return Promise.reject(new Error('offline test'));
                return realFetch(url, ...rest);
            };
        });
        const tab = await ctx.newPage();
        // The manual-mode request intentionally fails at the stubbed Claude
        // fetch; those logged errors are expected.
        /** @type {string[]} */
        const playerVoiceErrors = [];
        collectErrors(tab, 'player-voice', playerVoiceErrors);
        await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'networkidle' });
        await tab.waitForTimeout(2000);

        // Auto mode: spoken control command executes locally
        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        const listeningStatus = await tab.textContent('#status');
        await tab.evaluate(() => window.__emitResult('clear'));
        await tab.waitForTimeout(400);
        const afterClear = await tab.textContent('#status');
        report.check(`player voice control ("${listeningStatus}" -> "${afterClear}")`,
            listeningStatus === 'Listening...' && afterClear === 'Playlist is already empty');

        // Manual mode: segments accumulate, spoken "submit" sends to Claude path
        await tab.click('#settingsBtn');
        await tab.evaluate(() => document.getElementById('autoSubmitMode').click());
        await tab.click('#closeSettingsBtn');
        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        const manualStatus = await tab.textContent('#status');
        await tab.evaluate(() => window.__emitResult('play some jazz'));
        await tab.waitForTimeout(200);
        await tab.evaluate(() => window.__emitResult('submit'));
        await tab.waitForTimeout(600);
        const logged = await tab.evaluate(() =>
            document.getElementById('logContent').textContent.includes('play some jazz'));
        report.check(`player manual mode + spoken submit ("${manualStatus}", request logged: ${logged})`,
            manualStatus.includes('say "submit"') && logged);
        playerVoiceErrors
            .filter(e => !e.includes('offline test'))
            .forEach(e => report.errors.push(e));
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
