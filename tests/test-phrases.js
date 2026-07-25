// @ts-check
// phrases product behavior, extracted from the retired tab-functions monolith.
//
// Playback runs in real time, so this suite loads the page with the
// shortest Settings-offered note length (100ms) and waits on observable
// state - voice-start counts, transport state, DOM, storage - instead of
// fixed sleeps. Every check below is structural (counts, order, degrees,
// masks, persistence); none asserts wall-clock durations, so the shorter
// notes change nothing about what is verified. Short fixed settles remain
// only where a check asserts silence (absence has no completion signal).

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

const WAIT = { timeout: 10000 };

/** Page boot finished (phrasesDebug is published at the end of boot).
 * @param {import('playwright').Page} tab */
function waitForBoot(tab) {
    return tab.waitForFunction(() => Boolean(window.phrasesDebug), undefined, WAIT);
}

/** The honest transport state doubles as a playback-done signal.
 * @param {import('playwright').Page} tab @param {'playing' | 'paused'} state */
function waitForTransport(tab, state) {
    return tab.waitForFunction(expected => navigator.mediaSession.playbackState === expected, state, WAIT);
}

/** @param {import('playwright').Page} tab @param {number} atLeast */
function waitForVoices(tab, atLeast) {
    return tab.waitForFunction(count => window.__voiceStarts >= count, atLeast, WAIT);
}

/** @param {import('playwright').Page} tab @param {string} id @param {'true' | 'false'} value */
function waitForPressed(tab, id, value) {
    return tab.waitForFunction(
        ([buttonId, expected]) => document.getElementById(buttonId)?.getAttribute('aria-pressed') === expected,
        /** @type {[string, string]} */ ([id, value]), WAIT);
}

/** A persisted phrases setting reached a value (the save is the observable
 * the old sleeps padded for).
 * @param {import('playwright').Page} tab @param {string} key @param {unknown} value */
function waitForSaved(tab, key, value) {
    return tab.waitForFunction(([settingKey, expected]) => {
        const data = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS) || {};
        return data[settingKey] === expected;
    }, /** @type {[string, unknown]} */ ([key, value]), WAIT);
}

/** Click Next and wait for the new phrase to land in history.
 * @param {import('playwright').Page} tab */
async function nextPhrase(tab) {
    const before = await tab.evaluate(() => document.querySelectorAll('#historyList .history-item').length);
    await tab.click('#nextBtn');
    await tab.waitForFunction(count => document.querySelectorAll('#historyList .history-item').length > count, before, WAIT);
}

(async () => {
    const report = createReporter('phrases');
    const browser = await launchWithMic();
    // ============ PHRASES: stored sharp root displays as conventional flat key ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'phrases-eb-display', report.errors);
        // Settings are seeded before load (legacy flat form; the store
        // migrates it), so one page load replaces goto + write + reload.
        await tab.addInitScript(() => {
            localStorage.setItem('phrases-settings', JSON.stringify({
                root: 'D#', octave: 3, scaleType: 'major', phraseAlgo: 'random',
                startAtOne: false, rangeLow: 0, rangeHigh: 7, minLength: 9, maxLength: 9,
                returnToInitial: true, returnToRoot: false,
                hearTones: false, hearSpeech: false, singNumbers: false,
                noteLengthMs: 500, gapMs: 0, showNumbers: true, showNoteNames: true,
                showStaff: true, showPlayRow: true, accidentalRate: 0
            }));
        });
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'domcontentloaded' });
        await waitForBoot(tab);
        await tab.click('#nextBtn');
        await tab.waitForSelector('.phrase-note-name-token', WAIT);
        const ebDisplay = await tab.evaluate(() => {
            const root = document.getElementById('rootPitchValue')?.textContent || '';
            const notes = [...document.querySelectorAll('.phrase-note-name-token')].map(el => el.textContent || '');
            return {
                root,
                notes,
                noSharpSpellings: notes.every(note => !note.includes('#')),
                noCanonicalEnharmonics: notes.every(note => !['D#3', 'G#3', 'A#3', 'D#4', 'G#4', 'A#4'].includes(note))
            };
        });
        report.check(`phrases stored D# major displays as Eb key (root=${ebDisplay.root}, notes=${ebDisplay.notes.join(' ')})`,
            ebDisplay.root === 'Eb3' && ebDisplay.noSharpSpellings && ebDisplay.noCanonicalEnharmonics);
        await tab.close();
    }

    // ============ PHRASES: reflect / mask / modes / history ============
    {
        const tab = await browser.newPage();
        collectErrors(tab, 'phrases', report.errors);
        // Shortest Settings-offered note length: playback-completion waits
        // below finish in real time without changing any structural check.
        await tab.addInitScript(() => {
            localStorage.setItem('phrases-settings', JSON.stringify({ noteLengthMs: 100 }));
        });
        await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'domcontentloaded' });
        await waitForBoot(tab);
        await tab.evaluate(instrumentVoices);

        await tab.click('#nextBtn');
        await tab.waitForSelector('.phrase-degree-token', WAIT);
        await tab.click('#stopBtn');
        const degrees = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        const phraseTitle = await tab.evaluate(() => {
            const degrees = window.phrasesDebug.takePlan()
                .filter(note => note.enabled)
                .map(note => note.degree)
                .join(',');
            return {
                degrees,
                documentTitle: document.title,
                mediaTitle: navigator.mediaSession.metadata?.title || '',
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || ''
            };
        });
        const titleShape = /^[A-G][b#]?\d [a-z ]+ [^ ]+$/;
        report.check(`phrases title is scale name plus degree list ("${phraseTitle.documentTitle}")`,
            titleShape.test(phraseTitle.documentTitle)
            && phraseTitle.documentTitle.endsWith(` ${phraseTitle.degrees}`)
            && phraseTitle.mediaTitle === phraseTitle.documentTitle
            && phraseTitle.headerTitle === phraseTitle.documentTitle
            && phraseTitle.degrees.length > 0
            && !phraseTitle.documentTitle.includes('Phrases')
            && !phraseTitle.documentTitle.includes('Voice'));

        await tab.click('#reflectBtn');
        await waitForPressed(tab, 'reflectBtn', 'true');
        const reflected = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        await tab.click('#reflectBtn');
        await waitForPressed(tab, 'reflectBtn', 'false');
        const restored = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        report.check('phrases reflect roundtrip', reflected !== degrees && restored === degrees);

        await tab.evaluate(() => {
            const btn = document.querySelector('.phrase-degree-token[data-index="0"]');
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        });
        await tab.waitForFunction(() => {
            const token = document.querySelector('.phrase-degree-token[data-index="0"]');
            return Boolean(token && token.classList.contains('inactive'));
        }, undefined, WAIT);
        const maskedTitle = await tab.evaluate(() => {
            const degrees = window.phrasesDebug.takePlan()
                .filter(note => note.enabled)
                .map(note => note.degree)
                .join(',');
            return {
                degrees,
                documentTitle: document.title,
                mediaTitle: navigator.mediaSession.metadata?.title || '',
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || ''
            };
        });
        report.check('phrases title follows playable note mask',
            maskedTitle.documentTitle.endsWith(` ${maskedTitle.degrees}`)
            && maskedTitle.mediaTitle === maskedTitle.documentTitle
            && maskedTitle.headerTitle === maskedTitle.documentTitle);

        const breakdownPlan = await tab.evaluate(() => {
            const passes = window.phrasesDebug.breakdownPasses();
            const total = window.phrasesDebug.takePlan().length;
            const first = passes[0] || [];
            const final = passes[passes.length - 1] || [];
            let largestGapAdds = true;
            let oneAtATime = true;
            let previous = first;
            for (const pass of passes.slice(1)) {
                const additions = pass.filter(index => !previous.includes(index));
                if (additions.length !== 1) oneAtATime = false;
                const added = additions[0];
                const prevSorted = previous.slice().sort((a, b) => a - b);
                const gaps = [];
                for (let i = 0; i < prevSorted.length - 1; i++) {
                    const left = prevSorted[i];
                    const right = prevSorted[i + 1];
                    const size = right - left - 1;
                    if (size > 0) gaps.push({ left, right, size });
                }
                const maxGap = Math.max(...gaps.map(gap => gap.size));
                const chosenGap = gaps.find(gap => gap.left < added && added < gap.right);
                if (!chosenGap || chosenGap.size !== maxGap) largestGapAdds = false;
                previous = pass;
            }
            const firstShape = total === 1
                ? first.length === 1 && first[0] === 0
                : total === 2
                    ? first.length === 2 && first.includes(0) && first.includes(1)
                    : first.length === 3 && first.includes(0) && first.includes(total - 1)
                        && first.some(index => index > 0 && index < total - 1);
            return {
                total,
                passCount: passes.length,
                firstCount: first.length,
                firstShape,
                oneAtATime,
                largestGapAdds,
                finalAll: final.length === total && final.every((index, idx) => index === idx)
            };
        });
        report.check(`phrases breakdown plan fills largest gaps one note at a time (${breakdownPlan.passCount} passes for ${breakdownPlan.total} notes)`,
            breakdownPlan.passCount === Math.max(1, breakdownPlan.total - 2)
            && breakdownPlan.firstShape && breakdownPlan.oneAtATime
            && breakdownPlan.largestGapAdds && breakdownPlan.finalAll);

        await tab.evaluate(() => {
            const tones = document.getElementById('hearTonesToggle');
            if (tones instanceof HTMLInputElement && tones.checked) tones.click();
        });
        await tab.waitForFunction(() => window.phrasesDebug.settings().hearTones === false, undefined, WAIT);
        await tab.click('#stopBtn');
        const sBefore = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        // Silence has no completion signal: with every hear toggle off the
        // play cycle ends immediately, so a short settle catches wrong sound.
        await tab.waitForTimeout(300);
        const sAfter = await tab.evaluate(() => window.__voiceStarts);
        report.check('phrases silent when all hear toggles off', sBefore === sAfter);

        await tab.click('#breakdownBtn');
        await waitForPressed(tab, 'breakdownBtn', 'true');
        const breakdownOn = await tab.evaluate(() => ({
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            addHidden: document.getElementById('addNoteBtn').hidden,
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed')
        }));
        report.check(`phrases breakdown mode reveals partial phrase (${breakdownOn.enabled}/${breakdownOn.total})`,
            breakdownOn.pressed === 'true' && breakdownOn.addHidden === false
            && breakdownOn.enabled < breakdownOn.total);

        await tab.click('#breakdownBtn');
        await waitForPressed(tab, 'breakdownBtn', 'false');
        const breakdownOff = await tab.evaluate(() => ({
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed')
        }));
        report.check(`phrases breakdown off restores full phrase (${breakdownOff.enabled}/${breakdownOff.total})`,
            breakdownOff.pressed === 'false' && breakdownOff.enabled === breakdownOff.total);

        await tab.click('#breakdownBtn');
        await waitForPressed(tab, 'breakdownBtn', 'true');
        const manualBefore = await tab.evaluate(() => ({
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed'),
            playOnStep: document.getElementById('playOnStepBtn').getAttribute('aria-pressed'),
            addHidden: document.getElementById('addNoteBtn').hidden,
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            voices: window.__voiceStarts
        }));
        await tab.click('#addNoteBtn');
        await tab.waitForFunction(expected =>
            window.phrasesDebug.takePlan().filter(note => note.enabled).length === expected,
        Math.min(manualBefore.total, manualBefore.enabled + 1), WAIT);
        await tab.waitForTimeout(200); // silence settle: the step must not sound
        const manualAfter = await tab.evaluate(() => ({
            pressed: document.getElementById('breakdownBtn').getAttribute('aria-pressed'),
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            voices: window.__voiceStarts
        }));
        report.check(`phrases add note advances silently without play on step (${manualBefore.enabled}->${manualAfter.enabled})`,
            manualBefore.pressed === 'true' && manualBefore.playOnStep === 'false' && manualBefore.addHidden === false
            && manualAfter.pressed === 'true'
            && manualAfter.enabled === Math.min(manualBefore.total, manualBefore.enabled + 1)
            && manualAfter.voices === manualBefore.voices);
        await tab.click('#stopBtn');

        await tab.click('#breakdownBtn');
        await waitForPressed(tab, 'breakdownBtn', 'false');

        // Powerset combos: ordered subsequences per size, stutters skipped,
        // as-text duplicates produced once (1,2,5,2,1 is the worked example).
        const powersetOrder = await tab.evaluate(() => {
            const iterator = PatternPracticeCore.createUniqueSubsequenceIterator([0, 1, 4, 1, 0], 3);
            const passes = [];
            for (let pass = iterator.next(); pass; pass = iterator.next()) {
                passes.push(pass.join(''));
            }
            return passes.join(' ');
        });
        report.check(`phrases powerset combos dedupe as-text and skip stutters (${powersetOrder})`,
            powersetOrder === '012 014 023 024 123 124 234 0123 0124 0234 1234 01234');

        // Powerset mode masks the take to the current combo, steps via the
        // stage button, and is exclusive with breakdown.
        await tab.click('#powersetBtn');
        await waitForPressed(tab, 'powersetBtn', 'true');
        const powersetOn = await tab.evaluate(() => ({
            pressed: document.getElementById('powersetBtn').getAttribute('aria-pressed'),
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length,
            addHidden: document.getElementById('addNoteBtn').hidden,
            addLabel: document.getElementById('addNoteBtn').textContent,
            mask: window.phrasesDebug.takePlan().map(note => (note.enabled ? 1 : 0)).join('')
        }));
        await tab.click('#addNoteBtn');
        await tab.waitForFunction(previousMask =>
            window.phrasesDebug.takePlan().map(note => (note.enabled ? 1 : 0)).join('') !== previousMask,
        powersetOn.mask, WAIT);
        const powersetStepped = await tab.evaluate(() => ({
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            mask: window.phrasesDebug.takePlan().map(note => (note.enabled ? 1 : 0)).join('')
        }));
        report.check(`phrases powerset masks 3-note combos and steps (${powersetOn.mask}->${powersetStepped.mask}, "${powersetOn.addLabel}")`,
            powersetOn.pressed === 'true' && powersetOn.addHidden === false
            && powersetOn.addLabel === 'next combo'
            && powersetOn.total >= 4 && powersetOn.enabled === 3
            && powersetStepped.enabled === 3 && powersetStepped.mask !== powersetOn.mask);

        await tab.click('#breakdownBtn');
        await waitForPressed(tab, 'breakdownBtn', 'true');
        const powersetExclusive = await tab.evaluate(() => ({
            breakdown: window.phrasesDebug.settings().breakdownEnabled,
            powerset: window.phrasesDebug.settings().powersetEnabled
        }));
        report.check('phrases breakdown and powerset are exclusive',
            powersetExclusive.breakdown === true && powersetExclusive.powerset === false);

        await nextPhrase(tab);
        const powersetCleared = await tab.evaluate(() => ({
            breakdown: window.phrasesDebug.settings().breakdownEnabled,
            powerset: window.phrasesDebug.settings().powersetEnabled,
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length,
            total: window.phrasesDebug.takePlan().length
        }));
        report.check('phrases next exits powerset and breakdown modes',
            powersetCleared.breakdown === false && powersetCleared.powerset === false
            && powersetCleared.enabled === powersetCleared.total);

        await tab.evaluate(() => {
            const tones = document.getElementById('hearTonesToggle');
            if (tones instanceof HTMLInputElement && !tones.checked) tones.click();
        });
        await tab.waitForFunction(() => window.phrasesDebug.settings().hearTones === true, undefined, WAIT);
        await tab.click('#stopBtn');

        // Reverse: with powerset on, each combo replays back to front in
        // the same section, so one Play sounds 3 forward + 3 reversed.
        await tab.click('#powersetBtn');
        await waitForPressed(tab, 'powersetBtn', 'true');
        await tab.click('#reverseBtn');
        await waitForPressed(tab, 'reverseBtn', 'true');
        const reverseOn = await tab.evaluate(() => ({
            pressed: document.getElementById('reverseBtn').getAttribute('aria-pressed'),
            setting: window.phrasesDebug.settings().reverseAfterSection,
            saved: SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.reverseAfterSection,
            enabled: window.phrasesDebug.takePlan().filter(note => note.enabled).length
        }));
        const reverseVoices0 = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#playBtn');
        await waitForTransport(tab, 'playing');
        await waitForTransport(tab, 'paused');
        const reverseVoices = await tab.evaluate(() => window.__voiceStarts) - reverseVoices0;
        report.check(`phrases reverse replays powerset combo backwards (${reverseOn.enabled} enabled, ${reverseVoices} voices)`,
            reverseOn.pressed === 'true' && reverseOn.setting === true && reverseOn.saved === true
            && reverseOn.enabled === 3 && reverseVoices === 6);
        await tab.click('#stopBtn');
        await tab.click('#reverseBtn');
        await tab.click('#powersetBtn');
        await tab.waitForFunction(() => {
            const settings = window.phrasesDebug.settings();
            return settings.reverseAfterSection === false && settings.powersetEnabled === false;
        }, undefined, WAIT);

        await nextPhrase(tab);
        await tab.click('#stopBtn');
        const historyCount = await tab.evaluate(() => document.querySelectorAll('#historyList .history-item').length);
        const s1 = await tab.evaluate(() => window.__voiceStarts);
        await tab.evaluate(() => document.querySelector('#historyList .history-play-btn').click());
        await waitForVoices(tab, s1 + 1);
        const s2 = await tab.evaluate(() => window.__voiceStarts);
        report.check(`phrases history records and replays (${historyCount} items)`, historyCount >= 2 && s2 > s1);

        // Transport state honesty: idle reports 'paused' so a car's
        // play/pause toggle sends 'play'; the media back handler steps
        // to the previous history phrase and plays it audibly.
        await tab.click('#stopBtn');
        await waitForTransport(tab, 'paused');
        const idleState = await tab.evaluate(() => navigator.mediaSession.playbackState);
        const degreesNow = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        const s3 = await tab.evaluate(() => window.__voiceStarts);
        await tab.evaluate(() => { window.phrasesDebug.mediaPrevious(); });
        await waitForTransport(tab, 'playing');
        const playingState = await tab.evaluate(() => navigator.mediaSession.playbackState);
        await waitForVoices(tab, s3 + 1);
        const s4 = await tab.evaluate(() => window.__voiceStarts);
        const degreesPrev = await tab.evaluate(() =>
            Array.from(document.querySelectorAll('.phrase-degree-token')).map(el => el.textContent).join(' '));
        await tab.click('#stopBtn');
        report.check(`phrases media back plays previous phrase (state ${idleState}->${playingState}, ${s4 - s3} voices)`,
            idleState === 'paused' && playingState === 'playing' && s4 > s3 && degreesPrev !== degreesNow);

        // Play-on-next off: Next generates and shows a new phrase silently
        await tab.click('#playOnNextBtn');
        await waitForPressed(tab, 'playOnNextBtn', 'false');
        const silentNextBefore = await tab.evaluate(() => ({
            pressed: document.getElementById('playOnNextBtn').getAttribute('aria-pressed'),
            history: document.querySelectorAll('#historyList .history-item').length,
            voices: window.__voiceStarts
        }));
        await tab.click('#nextBtn');
        await tab.waitForFunction(count =>
            document.querySelectorAll('#historyList .history-item').length === count + 1,
        silentNextBefore.history, WAIT);
        await tab.waitForTimeout(250); // silence settle: the next must not sound
        const silentNextAfter = await tab.evaluate(() => ({
            history: document.querySelectorAll('#historyList .history-item').length,
            voices: window.__voiceStarts,
            playOnNext: window.phrasesDebug.settings().playOnNext
        }));
        report.check(`phrases next is silent with play on next off (${silentNextBefore.history}->${silentNextAfter.history} items, ${silentNextAfter.voices - silentNextBefore.voices} voices)`,
            silentNextBefore.pressed === 'false'
            && silentNextAfter.playOnNext === false
            && silentNextAfter.history === silentNextBefore.history + 1
            && silentNextAfter.voices === silentNextBefore.voices);
        await tab.click('#playOnNextBtn');
        await waitForPressed(tab, 'playOnNextBtn', 'true');

        // Typed degree series: the token grammar parses to exact offsets
        // (octave marks, chromatic passing accidentals), errors never guess.
        const seriesParse = await tab.evaluate(() => {
            const good = PatternPracticeCore.parseDegreeSeries('5d 1, 1 | 7bv 7v 2# 2 9 6\u2193', 'major');
            const badToken = PatternPracticeCore.parseDegreeSeries('1 2 zz', 'major');
            const badAccidental = PatternPracticeCore.parseDegreeSeries('3# 1', 'major');
            const empty = PatternPracticeCore.parseDegreeSeries('   ', 'major');
            return {
                offsets: good.offsets.join(','),
                goodErrors: good.errors.length,
                badTokenErrors: badToken.errors.length,
                badTokenOffsets: badToken.offsets.join(','),
                badAccidentalErrors: badAccidental.errors.length,
                emptyErrors: empty.errors.length
            };
        });
        report.check(`phrases series parser maps tokens to offsets (${seriesParse.offsets})`,
            seriesParse.offsets === '-3,0,0,-1.5,-1,1.5,1,8,-2'
            && seriesParse.goodErrors === 0
            && seriesParse.badTokenErrors === 1 && seriesParse.badTokenOffsets === '0,1'
            && seriesParse.badAccidentalErrors === 1
            && seriesParse.emptyErrors === 1);

        // Series Set loads the typed series as the current take (honoring
        // play on next), and it joins phrase history.
        await tab.fill('#seriesInput', '5v 1 1 7bv 7v 2# 2');
        const seriesVoices0 = await tab.evaluate(() => window.__voiceStarts);
        await tab.click('#seriesSetBtn');
        await waitForTransport(tab, 'playing');
        await waitForTransport(tab, 'paused');
        const seriesLoaded = await tab.evaluate(() => ({
            offsets: window.phrasesDebug.takePlan().map(note => note.offset).join(','),
            degrees: window.phrasesDebug.takePlan().map(note => note.degree).join(' '),
            voices: window.__voiceStarts,
            errorHidden: document.getElementById('seriesError').hidden,
            historyDegrees: document.querySelector('#historyList .phrase-history-degrees')?.textContent || ''
        }));
        report.check(`phrases series loads as the take and plays (${seriesLoaded.degrees}, ${seriesLoaded.voices - seriesVoices0} voices)`,
            seriesLoaded.offsets === '-3,0,0,-1.5,-1,1.5,1'
            && seriesLoaded.voices - seriesVoices0 === 7
            && seriesLoaded.errorHidden === true
            && seriesLoaded.historyDegrees.split(' ').length === 7);

        // Bad tokens list under the input and change nothing.
        await tab.fill('#seriesInput', '1 2 zz 3#');
        await tab.click('#seriesSetBtn');
        await tab.waitForFunction(() => document.getElementById('seriesError')?.hidden === false, undefined, WAIT);
        const seriesError = await tab.evaluate(() => ({
            hidden: document.getElementById('seriesError').hidden,
            text: document.getElementById('seriesError').textContent,
            offsets: window.phrasesDebug.takePlan().map(note => note.offset).join(',')
        }));
        report.check(`phrases series errors leave the take unchanged ("${seriesError.text}")`,
            seriesError.hidden === false
            && seriesError.text.includes('zz') && seriesError.text.includes('3#')
            && seriesError.offsets === '-3,0,0,-1.5,-1,1.5,1');
        await tab.click('#stopBtn');

        // Explicit range endpoints: offsets bounded to the chosen span,
        // including a low endpoint a full octave below unison.
        const rangeBounded = await tab.evaluate(() => {
            const algos = ['balanced', 'random', 'stepwise', 'leapy', 'arch', 'motif', 'alto_gaps'];
            const spans = [[-2, 9], [-7, 7]];
            for (const [rangeLow, rangeHigh] of spans) {
                for (const phraseAlgo of algos) {
                    for (let i = 0; i < 300; i++) {
                        const offsets = PatternPracticeCore.generatePhraseOffsets({
                            scaleType: 'major', phraseAlgo, startAtOne: false, rangeLow, rangeHigh,
                            minLength: 5, maxLength: 9, returnToInitial: false, returnToRoot: false
                        });
                        if (Math.min(...offsets) < rangeLow || Math.max(...offsets) > rangeHigh) return false;
                    }
                }
            }
            return true;
        });
        report.check('phrases algos honor range endpoints (-2..9 and -7..7)', rangeBounded);

        // Range endpoint steppers: one degree per step, endpoint labels
        // name degrees, and both endpoints persist.
        const rangeBefore = await tab.evaluate(() => {
            const data = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS) || {};
            return { low: data.rangeLow ?? 0, high: data.rangeHigh ?? 7 };
        });
        await tab.click('[data-step-key="rangeLow"][data-step-delta="-1"]');
        await tab.click('[data-step-key="rangeHigh"][data-step-delta="1"]');
        await tab.waitForFunction(([low, high]) => {
            const data = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS) || {};
            return data.rangeLow === low && data.rangeHigh === high;
        }, /** @type {[number, number]} */ ([rangeBefore.low - 1, rangeBefore.high + 1]), WAIT);
        const rangeState = await tab.evaluate(() => ({
            saved: (() => {
                const data = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS) || {};
                return { low: data.rangeLow, high: data.rangeHigh };
            })(),
            lowLabel: document.getElementById('rangeLowValue').textContent,
            highLabel: document.getElementById('rangeHighValue').textContent
        }));
        report.check(`phrases range endpoints step and persist (low ${rangeState.lowLabel}, high ${rangeState.highLabel})`,
            rangeState.saved.low === rangeBefore.low - 1
            && rangeState.saved.high === rangeBefore.high + 1
            && rangeState.lowLabel.length > 0 && rangeState.highLabel.length > 0);
        await tab.click('[data-phrase-algo="arch"]');
        await waitForSaved(tab, 'phraseAlgo', 'arch');
        const savedAlgo = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.phraseAlgo);
        report.check('phrases algorithm persists', savedAlgo === 'arch');

        const lessonFamilies = await tab.evaluate(() => {
            const staff = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'staff', phraseLesson: 'staff_steps',
                phraseAlgo: 'balanced', startAtOne: true, rangeLow: 0, rangeHigh: 7,
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const sight = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'sight', phraseLesson: 'sight_pentachord',
                phraseAlgo: 'balanced', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const barber = PatternPracticeCore.generatePhraseOffsets({
                scaleType: 'major', phraseStyle: 'barbershop', phraseLesson: 'barber_dominant',
                phraseAlgo: 'balanced', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                accidentalRate: 0
            });
            const staffStepsOnly = staff.slice(1).every((offset, index) => Math.abs(offset - staff[index]) === 1);
            const sightInPentachord = sight.every(offset => [0, 1, 2, 3, 4].includes(offset));
            const barberDominant = barber.every(offset => [1, 3, 4, 6].includes(offset));
            // 'start at 1' outranks a palette that excludes the tonic:
            // the seed note is literal degree 1, the rest stays in palette.
            let tonicSeeded = true;
            for (let i = 0; i < 40; i++) {
                const offsets = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseStyle: 'barbershop', phraseLesson: 'barber_sevenths',
                    phraseAlgo: 'balanced', startAtOne: true, rangeLow: 0, rangeHigh: 7,
                    minLength: 6, maxLength: 8, returnToInitial: false, returnToRoot: false,
                    accidentalRate: 0
                });
                if (offsets[0] !== 0) tonicSeeded = false;
                if (!offsets.slice(1).every(offset => [1, 3, 4, 6].includes(offset))) tonicSeeded = false;
            }
            return { staffStepsOnly, sightInPentachord, barberDominant, tonicSeeded };
        });
        report.check('phrases style lessons constrain generated degrees',
            lessonFamilies.staffStepsOnly && lessonFamilies.sightInPentachord && lessonFamilies.barberDominant);
        report.check('phrases start-at-1 seeds tonic even outside lesson palette',
            lessonFamilies.tonicSeeded);
        await tab.click('[data-phrase-style="barbershop"]');
        await waitForSaved(tab, 'phraseStyle', 'barbershop');
        await tab.click('[data-phrase-lesson="barber_dominant"]');
        await waitForSaved(tab, 'phraseLesson', 'barber_dominant');
        const savedLesson = await tab.evaluate(() => {
            const saved = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS);
            return saved && saved.phraseStyle === 'barbershop' && saved.phraseLesson === 'barber_dominant';
        });
        report.check('phrases style and lesson persist', savedLesson);
        await tab.click('#fillChordBtn');
        await waitForSaved(tab, 'fillMode', 'chord');
        await tab.click('[data-phrase-lesson="barber_tonic"]');
        await waitForSaved(tab, 'phraseLesson', 'barber_tonic');
        const lessonFillState = await tab.evaluate(() => {
            const saved = SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS);
            return {
                fillMode: saved?.fillMode,
                lockedFill: saved?.lessonLockedKeys?.includes('fillMode') === true,
                lockedMarker: document.getElementById('fillChordBtn').classList.contains('lesson-locked')
            };
        });
        report.check('phrases lesson presets leave fill modes user-controlled',
            lessonFillState.fillMode === 'chord' && !lessonFillState.lockedFill && !lessonFillState.lockedMarker);

        // Genre lessons (pop hook and the song-inspired ones) generate
        // their own degree sets, staying abstract and bounded.
        const genreLessons = await tab.evaluate(() => {
            const lessons = [
                'genre_pop_hook',
                'genre_blackbird_folk',
                'genre_hello_pop',
                'genre_simon_folk',
                'genre_scarborough_modal'
            ];
            return lessons.every(phraseLesson => {
                const phrase = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseStyle: 'genre', phraseLesson,
                    phraseAlgo: 'balanced', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                    minLength: 8, maxLength: 8, returnToInitial: false, returnToRoot: false,
                    accidentalRate: 0
                });
                return phrase.length === 8
                    && phrase.every(offset => offset >= 0 && offset <= 5)
                    && phrase.slice(1).every((offset, index) => offset !== phrase[index]);
            });
        });
        report.check('phrases genre lessons generate their own bounded degree sets', genreLessons);

        // Motif is a transposed shape, not a wandering walk: the leading
        // interval shape must be restated verbatim later in the phrase
        // (away from range edges, where bounding may distort it).
        const motifStructure = await tab.evaluate(() => {
            let hits = 0;
            for (let i = 0; i < 6; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeLow: -3, rangeHigh: 14, minLength: 8, maxLength: 10,
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

        const altoGaps = await tab.evaluate(() => {
            let pairTouches = 0;
            for (let i = 0; i < 12; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeLow: 0, rangeHigh: 7, minLength: 8, maxLength: 10,
                    returnToInitial: false, returnToRoot: false, phraseAlgo: 'alto_gaps'
                });
                const offsets = phrase.notes.map(n => n.offset);
                for (let j = 1; j < offsets.length; j++) {
                    const pair = `${offsets[j - 1]},${offsets[j]}`;
                    if (pair === '2,3' || pair === '3,2' || pair === '6,7' || pair === '7,6') {
                        pairTouches++;
                    }
                }
            }
            return pairTouches;
        });
        report.check(`phrases alto gaps emphasizes 3/4 and 7/8 pairs (${altoGaps} direct touches)`, altoGaps >= 8);

        const returnToOne = await tab.evaluate(() => {
            for (let i = 0; i < 200; i++) {
                const offsets = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseAlgo: 'arch', startAtOne: false, rangeLow: 0, rangeHigh: 7,
                    minLength: 5, maxLength: 8, returnToInitial: true, returnToRoot: false
                });
                if (offsets[offsets.length - 1] !== 0) return false;
            }
            return true;
        });
        report.check('phrases return to 1 ends on degree 1 even with random start', returnToOne);

        // Rearrange: every scale note inside the range exactly once (or
        // twice for the double variant), anchors consume the pool's 1s,
        // and no note stutters back-to-back.
        const rearrange = await tab.evaluate(() => {
            const sorted = values => values.slice().sort((a, b) => a - b).join(',');
            const range = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
            const base = {
                scaleType: 'major', phraseAlgo: 'rearrange', rangeLow: 0, rangeHigh: 7,
                minLength: 5, maxLength: 8, accidentalRate: 0, returnToRoot: false
            };
            for (let i = 0; i < 60; i++) {
                const plain = PatternPracticeCore.generatePhraseOffsets({
                    ...base, startAtOne: false, returnToInitial: false
                });
                if (sorted(plain) !== sorted(range(0, 7))) return 'plain permutation broken';
                const anchored = PatternPracticeCore.generatePhraseOffsets({
                    ...base, startAtOne: true, returnToInitial: true
                });
                if (anchored[0] !== 0 || anchored[anchored.length - 1] !== 0) return 'anchors missing';
                if (sorted(anchored.slice(1, -1)) !== sorted(range(1, 7))) return 'anchored interior broken';
                const expanded = PatternPracticeCore.generatePhraseOffsets({
                    ...base, startAtOne: false, returnToInitial: false, rangeLow: -3, rangeHigh: 14
                });
                if (sorted(expanded) !== sorted(range(-3, 14))) return 'expanded range broken';
                const doubled = PatternPracticeCore.generatePhraseOffsets({
                    ...base, phraseAlgo: 'rearrange_double', startAtOne: true, returnToInitial: true
                });
                if (doubled[0] !== 0 || doubled[doubled.length - 1] !== 0) return 'double anchors missing';
                if (doubled.slice(1, -1).includes(0)) return 'double interior repeats 1';
                if (sorted(doubled) !== sorted(range(0, 7).flatMap(value => [value, value]))) return 'double multiset broken';
                if (doubled.slice(1).some((value, idx) => value === doubled[idx])) return 'double stutters';
            }
            return 'ok';
        });
        report.check(`phrases rearrange exhausts the range with anchor-managed 1s (${rearrange})`, rearrange === 'ok');

        // Rearrange passing tones are inserted in addition to the notes
        // they connect; the underlying permutation stays intact.
        const rearrangeChromatic = await tab.evaluate(() => {
            const sorted = values => values.slice().sort((a, b) => a - b).join(',');
            const range = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
            let inserted = 0;
            for (let i = 0; i < 60; i++) {
                const offsets = PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseAlgo: 'rearrange', rangeLow: 0, rangeHigh: 7,
                    minLength: 5, maxLength: 8, startAtOne: false, returnToInitial: false,
                    returnToRoot: false, accidentalRate: 1
                });
                if (sorted(offsets.filter(Number.isInteger)) !== sorted(range(0, 7))) return -1;
                for (let j = 0; j < offsets.length; j++) {
                    if (Number.isInteger(offsets[j])) continue;
                    inserted++;
                    const between = PatternPracticeCore.chromaticBetween('major', offsets[j - 1], offsets[j + 1]);
                    if (between !== offsets[j]) return -1;
                }
            }
            return inserted;
        });
        report.check(`phrases rearrange inserts passing tones without dropping scale notes (${rearrangeChromatic} inserted)`,
            rearrangeChromatic > 0);

        // Rearrange orderings are chosen for interval sequencing: leaps
        // stacked in the same direction should be much rarer than in a
        // naive shuffle (the notes themselves stay a full permutation).
        const rearrangeShape = await tab.evaluate(() => {
            const compoundLeaps = offsets => {
                let count = 0;
                for (let i = 2; i < offsets.length; i++) {
                    const prev = offsets[i - 1] - offsets[i - 2];
                    const next = offsets[i] - offsets[i - 1];
                    if (Math.abs(prev) >= 3 && Math.abs(next) >= 3 && Math.sign(prev) === Math.sign(next)) count++;
                }
                return count;
            };
            const naiveShuffle = values => {
                const out = values.slice();
                for (let i = out.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [out[i], out[j]] = [out[j], out[i]];
                }
                return out;
            };
            let chosen = 0;
            let naive = 0;
            for (let i = 0; i < 200; i++) {
                chosen += compoundLeaps(PatternPracticeCore.generatePhraseOffsets({
                    scaleType: 'major', phraseAlgo: 'rearrange', rangeLow: 0, rangeHigh: 7,
                    minLength: 5, maxLength: 8, startAtOne: false, returnToInitial: false,
                    returnToRoot: false, accidentalRate: 0
                }));
                naive += compoundLeaps(naiveShuffle([0, 1, 2, 3, 4, 5, 6, 7]));
            }
            return { chosen, naive };
        });
        report.check(`phrases rearrange avoids same-direction leap stacks (${rearrangeShape.chosen} chosen vs ${rearrangeShape.naive} naive over 200)`,
            rearrangeShape.chosen <= rearrangeShape.naive * 0.5 && rearrangeShape.naive > 0);

        // Chromatic choices: Acc replaces normal note slots with passing
        // tones, never lengthening the phrase beyond Min/Max.
        const chromatic = await tab.evaluate(() => {
            let decorated = 0;
            let invalid = 0;
            let wrongLength = 0;
            for (let i = 0; i < 100; i++) {
                const phrase = PatternPracticeCore.generatePhrase({
                    root: 'C', octave: 4, scaleType: 'major', startAtOne: false,
                    rangeLow: -2, rangeHigh: 9, minLength: 16, maxLength: 16,
                    returnToInitial: false, returnToRoot: false,
                    phraseAlgo: 'stepwise', accidentalRate: 1
                });
                if (phrase.notes.length !== 16) wrongLength++;
                phrase.notes.forEach((note, idx) => {
                    if (Number.isInteger(note.offset)) return;
                    decorated++;
                    const label = note.degree;
                    const validSlot = PatternPracticeCore.chromaticBetween(
                        'major',
                        Math.floor(note.offset),
                        Math.ceil(note.offset)
                    ) !== null;
                    if (!validSlot || !(label.endsWith('#') || label.endsWith('b'))) invalid++;
                });
            }
            return { decorated, invalid, wrongLength };
        });
        report.check(`phrases accidental rate selects valid passing tones without changing length (${chromatic.decorated} chosen, ${chromatic.invalid} invalid)`,
            chromatic.decorated > 0 && chromatic.invalid === 0 && chromatic.wrongLength === 0);
        await tab.click('[data-step-key="accidentalRate"][data-step-delta="1"]');
        await waitForSaved(tab, 'accidentalRate', 0.05);
        const savedAccidental = await tab.evaluate(() => SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.accidentalRate);
        report.check('phrases accidental rate stepper persists', savedAccidental === 0.05);

        // Section pause: the stepper adjusts the pause between repeat
        // loops / breakdown passes / powerset combos and persists.
        await tab.click('[data-step-key="sectionPauseMs"][data-step-delta="1"]');
        await waitForSaved(tab, 'sectionPauseMs', 1100);
        const sectionPause = await tab.evaluate(() => ({
            saved: SettingsStore.peekData(StorageKeys.PHRASES_SETTINGS)?.sectionPauseMs,
            shown: document.getElementById('sectionPauseValue')?.textContent
        }));
        report.check(`phrases section pause stepper persists (${sectionPause.saved}ms, "${sectionPause.shown}")`,
            sectionPause.saved === 1100 && sectionPause.shown === '1.1s');
        await tab.click('[data-step-key="sectionPauseMs"][data-step-delta="-1"]');
        await waitForSaved(tab, 'sectionPauseMs', 1000);

        const extendedLabels = await tab.evaluate(() => {
            const dp = PatternPracticeCore.degreesPerOctave('major');
            return PatternPracticeCore.offsetToDegree(8, dp) === '2\u2191'
                && PatternPracticeCore.offsetToDegree(-2, dp) === '6\u2193'
                && PatternPracticeCore.offsetToDegree(7, dp) === '8'
                && PatternPracticeCore.offsetToSpoken(8, dp) === '2 above'
                && PatternPracticeCore.offsetToSpoken(-2, dp) === '6 below';
        });
        report.check('phrases extended degrees label above/below, not raw 9 or 6d', extendedLabels);

        const staffSpelling = await tab.evaluate(() => {
            return NotationSpelling.vexKeySignature('D#', 'major') === 'Eb'
                && NotationSpelling.vexKeySignature('A', 'minor') === 'Am'
                && NotationSpelling.vexKeySignature('A', 'melodic_minor') === 'Am'
                && NotationSpelling.midiToVexKey(51) === 'd#/3'
                && NotationSpelling.midiToVexKey(54, 'b') === 'gb/3'
                && NotationSpelling.midiToVexKeyForScale(51, 51, 'major') === 'eb/3'
                && NotationSpelling.midiToVexKeyForScale(56, 51, 'major') === 'ab/3'
                && NotationSpelling.midiToVexKeyForScale(70, 65, 'major') === 'bb/4'
                // Written octave follows the letter: B# in C# major sits on
                // the B line below its sounding C (midi 60 -> b#/3, not /4)
                && NotationSpelling.midiToVexKeyForScale(60, 49, 'major') === 'b#/3'
                && scaleMidiToPitchString('C#', 3, 'major', 60) === 'B#3'
                && NotationSpelling.clefForPhrase(51, [51, 53, 55]) === 'bass'
                // Clef minimizes ledger lines: C#3 phrases hug the bass staff
                && NotationSpelling.clefForPhrase(49, [49, 60, 61, 60, 58, 49]) === 'bass'
                && NotationSpelling.clefForPhrase(60, [60, 64, 67, 72]) === 'treble'
                && NotationSpelling.passingAccidental(4.5, 7, 0, [4.5, 5]) === '#';
        });
        report.check('phrases staff spelling helpers', staffSpelling);

        const fillPlans = await tab.evaluate(() => {
            const fullBtn = document.getElementById('fillFullBtn');
            const chordBtn = document.getElementById('fillChordBtn');
            if (fullBtn.getAttribute('aria-pressed') === 'true') fullBtn.click();
            if (chordBtn.getAttribute('aria-pressed') === 'true') chordBtn.click();
            const before = {
                take: window.phrasesDebug.takePlan().length,
                tone: window.phrasesDebug.tonePlaybackPlan().length,
                targets: window.phrasesDebug.testTargets().length
            };
            fullBtn.click();
            const full = {
                take: window.phrasesDebug.takePlan().length,
                tone: window.phrasesDebug.tonePlaybackPlan().length,
                targets: window.phrasesDebug.testTargets().length,
                pressed: fullBtn.getAttribute('aria-pressed')
            };
            chordBtn.click();
            const chord = {
                take: window.phrasesDebug.takePlan().length,
                tone: window.phrasesDebug.tonePlaybackPlan().length,
                targets: window.phrasesDebug.testTargets().length,
                fullPressed: fullBtn.getAttribute('aria-pressed'),
                chordPressed: chordBtn.getAttribute('aria-pressed')
            };
            return { before, full, chord };
        });
        report.check(`phrases fill modes add invisible tone notes (${fillPlans.before.tone}->${fillPlans.full.tone}->${fillPlans.chord.tone})`,
            fillPlans.before.take === fillPlans.before.tone
            && fillPlans.full.take === fillPlans.before.take
            && fillPlans.full.targets === fillPlans.before.targets
            && fillPlans.full.tone >= fillPlans.before.tone
            && fillPlans.full.pressed === 'true'
            && fillPlans.chord.take === fillPlans.before.take
            && fillPlans.chord.targets === fillPlans.before.targets
            && fillPlans.chord.tone >= fillPlans.before.tone
            && fillPlans.chord.fullPressed === 'false'
            && fillPlans.chord.chordPressed === 'true');

        const fillBreakdownGap = await tab.evaluate(() => {
            const tokens = [...document.querySelectorAll('.phrase-degree-token')];
            if (tokens.length < 3) return { ok: false, reason: 'short phrase' };
            if (document.getElementById('fillChordBtn').getAttribute('aria-pressed') !== 'true') {
                document.getElementById('fillChordBtn').click();
            }
            const setActive = (token, active) => {
                if (token.classList.contains('inactive') === !active) return;
                token.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            };
            tokens.forEach(token => setActive(token, false));
            [0, tokens.length - 1].forEach(index => {
                const token = tokens[index];
                setActive(token, true);
            });
            const enabled = window.phrasesDebug.takePlan().filter(note => note.enabled).length;
            const tone = window.phrasesDebug.tonePlaybackPlan().length;
            tokens.forEach(token => setActive(token, true));
            return { ok: tone === enabled, enabled, tone };
        });
        report.check(`phrases chord fill does not bridge breakdown gaps (${fillBreakdownGap.enabled} enabled, ${fillBreakdownGap.tone} tones)`,
            fillBreakdownGap.ok === true);

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

        // Test is a mode switch into singing: it stops any active phrase
        // playback and never lets the page keep playing under the test.
        await tab.click('#stopBtn');
        await waitForTransport(tab, 'paused');
        await tab.evaluate(() => {
            const tones = document.getElementById('hearTonesToggle');
            if (tones instanceof HTMLInputElement && !tones.checked) tones.click();
        });
        await tab.waitForFunction(() => window.phrasesDebug.settings().hearTones === true, undefined, WAIT);
        const voicesBeforePlay = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.click('#playBtn');
        await tab.waitForFunction(count =>
            window.__trace.filter(e => e.type === 'voice-start').length > count,
        voicesBeforePlay, WAIT);
        // Tap Test and read the voice count in the same page task: the
        // tap's synchronous stop is the cut line the check measures from.
        const voicesAtTestTap = await tab.evaluate(() => {
            document.getElementById('testBtn').click();
            return window.__trace.filter(e => e.type === 'voice-start').length;
        });
        await tab.waitForFunction(() => !document.getElementById('phraseTestPanel').hidden, undefined, WAIT);
        await tab.waitForTimeout(300); // silence settle: no voice may trail the tap
        const testInterrupt = await tab.evaluate(() => ({
            open: !document.getElementById('phraseTestPanel').hidden,
            voicesAfter: window.__trace.filter(e => e.type === 'voice-start').length
        }));
        report.check(`phrases Test stops active playback (${voicesAtTestTap}->${testInterrupt.voicesAfter} voices)`,
            testInterrupt.open && testInterrupt.voicesAfter === voicesAtTestTap);

        // Opening the test never auto-plays: the user is there to sing.
        // Quiesce playback and close the panel (Stop no longer closes it)
        // so the next Test tap is an OPEN.
        await tab.click('#stopBtn');
        await tab.evaluate(() => {
            if (!document.getElementById('phraseTestPanel').hidden) {
                document.getElementById('phraseTestCloseBtn').click();
            }
        });
        await tab.waitForFunction(() =>
            document.getElementById('phraseTestPanel').hidden
            && navigator.mediaSession.playbackState === 'paused', undefined, WAIT);
        const voicesBefore = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.click('#testBtn');
        await tab.waitForFunction(() => !document.getElementById('phraseTestPanel').hidden, undefined, WAIT);
        await tab.waitForTimeout(400); // silence settle: auto-play would begin right at open
        const voicesAfter = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        report.check(`phrases test open is silent (${voicesAfter - voicesBefore} voices started)`,
            voicesAfter === voicesBefore);
        // The Guide button plays the targets on demand.
        const guideBefore = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.evaluate(() => { document.getElementById('phraseTestGuideBtn').click(); });
        await tab.waitForFunction(expected =>
            window.__trace.filter(e => e.type === 'voice-start').length >= expected,
        guideBefore + plan.targetCount, WAIT);
        await tab.waitForTimeout(250); // overshoot settle: an extra note would start within a slot
        const guideVoices = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length) - guideBefore;
        report.check(`phrases Guide button plays enabled targets (${guideVoices} voices)`,
            guideVoices === plan.targetCount);

        // Playback and Test coexist: with the panel open and listening,
        // Play sounds the phrase, Stop stops it WITHOUT closing the
        // panel, single-note taps sound, and Next starts a fresh take
        // for the new phrase with the panel still open.
        const duetStart = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.evaluate(() => { document.getElementById('playBtn').click(); });
        await tab.waitForFunction(count =>
            window.__trace.filter(e => e.type === 'voice-start').length > count, duetStart, WAIT);
        const afterPlay = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.evaluate(() => { document.getElementById('stopBtn').click(); });
        await waitForTransport(tab, 'paused');
        const openAfterStop = await tab.evaluate(() => !document.getElementById('phraseTestPanel').hidden);
        const afterStop = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await tab.evaluate(() => { document.querySelector('.phrase-note-play-token')?.click(); });
        await tab.waitForFunction(count =>
            window.__trace.filter(e => e.type === 'voice-start').length > count, afterStop, WAIT);
        const afterToken = await tab.evaluate(() => window.__trace.filter(e => e.type === 'voice-start').length);
        await nextPhrase(tab);
        const openAfterNext = await tab.evaluate(() => !document.getElementById('phraseTestPanel').hidden);
        report.check('phrases playback works during Test; Stop and Next keep the panel open',
            afterPlay > duetStart && openAfterStop
            && afterToken > afterStop && openAfterNext);

        // END-TO-END NOTE LINKAGE: with notes disabled, singing exactly
        // the displayed enabled notes must credit every one of them.
        // Sing via the explicit sample seam at each target's window.
        const linkageSetup = await tab.evaluate(() => {
            // Deterministic take: stop the mic BEFORE resetting. The trace
            // records everything sung - including the fake device's beep
            // tones - so a live mic would contaminate the injected samples.
            const listenBtn = document.getElementById('phraseTestListenBtn');
            if (listenBtn.textContent.includes('On')) listenBtn.click();
            document.getElementById('phraseTestPauseToggle').click(); // wall clock + session reset
            const recordedBefore = (SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [])
                .filter(entry => entry.tool === 'phrases-test').length;
            const targets = window.phrasesDebug.testTargets();
            const panel = window.phrasesDebug.panel;
            for (const t of targets) {
                // Five samples spread inside each target's own window,
                // whatever the configured note length.
                const step = Math.max(1, Math.floor((t.endMs - t.startMs - 20) / 4));
                for (let k = 0; k < 5; k++) {
                    panel.recordSample(t.midi, t.startMs + 10 + k * step);
                }
            }
            return { count: targets.length, recordedBefore };
        });
        // Every target verdicts once the idle window closes the final held
        // note; the recorded progress entry is that completion signal.
        await tab.waitForFunction(recordedBefore => {
            window.phrasesDebug.panel.draw();
            return (SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [])
                .filter(entry => entry.tool === 'phrases-test').length > recordedBefore;
        }, linkageSetup.recordedBefore, WAIT);
        // With the mic stopped there are no frames; evaluate by name.
        const linkage = {
            count: linkageSetup.count,
            score: await tab.evaluate(() => document.getElementById('phraseTestScore').textContent)
        };
        report.check(`phrases sings-right-thing-scores-right (${linkage.score})`,
            linkage.score.includes(`${linkage.count}/${linkage.count}`));

        // The recorded take carries per-note outcomes with signed bias -
        // the degree-level data the training goal needs.
        const noteRecord = await tab.evaluate(() => {
            const entries = SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [];
            const mine = entries.filter(e => e.tool === 'phrases-test');
            const last = mine[mine.length - 1] || {};
            const notes = last.notes || [];
            return {
                count: notes.length,
                labels: notes.map(n => n.label).join(' '),
                allGoodCentered: notes.every(n => n.result === 'good'
                    && n.biasCents !== null && Math.abs(n.biasCents) < 5)
            };
        });
        report.check(`phrases take records per-note results (${noteRecord.count} notes: ${noteRecord.labels})`,
            noteRecord.count === linkage.count && noteRecord.allGoodCentered);

        // RUBATO: scoring aligns the sung note sequence to the targets,
        // so holding every note far longer than its timeline slot (and
        // breathing freely) still credits every note. Under the old
        // fixed-window scoring this take misassigned every note after
        // the first.
        const rubatoSetup = await tab.evaluate(async () => {
            const panel = window.phrasesDebug.panel;
            await panel.open();
            const listenBtn = document.getElementById('phraseTestListenBtn');
            if (listenBtn.textContent.includes('On')) listenBtn.click(); // deterministic: no mic
            const recordedBefore = (SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [])
                .filter(entry => entry.tool === 'phrases-test').length;
            const targets = window.phrasesDebug.testTargets();
            let t = 5;
            for (const target of targets) {
                for (let k = 0; k < 10; k++) { // ~550ms hold, several times the slot
                    panel.recordSample(target.midi, t);
                    t += 55;
                }
                t += 40;
            }
            return { count: targets.length, recordedBefore };
        });
        await tab.waitForFunction(recordedBefore => {
            window.phrasesDebug.panel.draw();
            return (SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [])
                .filter(entry => entry.tool === 'phrases-test').length > recordedBefore;
        }, rubatoSetup.recordedBefore, WAIT);
        const rubato = {
            count: rubatoSetup.count,
            score: await tab.evaluate(() => document.getElementById('phraseTestScore').textContent)
        };
        report.check(`phrases rubato take credits held notes (${rubato.score})`,
            rubato.score.includes(`${rubato.count}/${rubato.count}`));

        // One wrong note misses exactly itself: neighbors stay credited
        // (no cascade through the rest of the take).
        const wrongNoteSetup = await tab.evaluate(async () => {
            const panel = window.phrasesDebug.panel;
            await panel.open();
            const listenBtn = document.getElementById('phraseTestListenBtn');
            if (listenBtn.textContent.includes('On')) listenBtn.click();
            const recordedBefore = (SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [])
                .filter(entry => entry.tool === 'phrases-test').length;
            const targets = window.phrasesDebug.testTargets();
            let t = 5;
            targets.forEach((target, index) => {
                const midi = index === 1 ? target.midi + 2.5 : target.midi;
                for (let k = 0; k < 6; k++) {
                    panel.recordSample(midi, t);
                    t += 55;
                }
                t += 30;
            });
            return { count: targets.length, recordedBefore };
        });
        await tab.waitForFunction(recordedBefore => {
            window.phrasesDebug.panel.draw();
            return (SettingsStore.peekData(StorageKeys.PRACTICE_PROGRESS) || [])
                .filter(entry => entry.tool === 'phrases-test').length > recordedBefore;
        }, wrongNoteSetup.recordedBefore, WAIT);
        const wrongNote = {
            count: wrongNoteSetup.count,
            score: await tab.evaluate(() => document.getElementById('phraseTestScore').textContent)
        };
        report.check(`phrases wrong note misses only itself (${wrongNote.score})`,
            wrongNote.score.includes(`${wrongNote.count - 1}/${wrongNote.count}`));

        // DRAW-WHAT-YOU-SING: pitch far outside the charted rails (the
        // singer's real register an octave off, an overshoot) must still
        // be recorded and drawn - rails and targets never gate the trace.
        // A sustained (confirmed) off-rails note passes the glitch
        // holdback and lands in the recorded history the chart draws.
        const offRails = await tab.evaluate(() => {
            const targets = window.phrasesDebug.testTargets();
            const panel = window.phrasesDebug.panel;
            const lowMidi = Math.min(...targets.map(t => t.midi)) - 12;
            const t0 = targets[0].startMs + 5;
            panel.recordSample(lowMidi, t0);
            panel.recordSample(lowMidi, t0 + 50);
            panel.recordSample(lowMidi, t0 + 100);
            const sustained = panel.history.filter(s => s.midi === lowMidi).length;

            // A brief scrape - a large jump that does NOT sustain for the
            // confirmation frames - never reaches the trace; the return
            // to the held pitch does. The scrape pitch sits above every
            // target so no other injected sample can share its midi.
            const scrapeMidi = Math.max(...targets.map(t => t.midi)) + 15;
            panel.recordSample(scrapeMidi, t0 + 150);
            panel.recordSample(scrapeMidi, t0 + 180);
            panel.recordSample(lowMidi, t0 + 210);
            return {
                lowMidi,
                recorded: sustained,
                scrapeRecorded: panel.history.filter(s => s.midi === scrapeMidi).length,
                returnRecorded: panel.history.filter(s => s.midi === lowMidi).length
            };
        });
        report.check(`phrases trace keeps off-rails singing (${offRails.recorded} samples at midi ${offRails.lowMidi})`,
            offRails.recorded === 3);
        report.check(`phrases trace drops unconfirmed scrapes (${offRails.scrapeRecorded} scrape samples, ${offRails.returnRecorded} held)`,
            offRails.scrapeRecorded === 0 && offRails.returnRecorded === 4);

        // Weak-spot aggregation names the leaning degree and its direction.
        const weakLine = await tab.evaluate(() => {
            for (let i = 0; i < 3; i++) {
                ProgressStore.record({
                    tool: 'weak-spot-check', context: 'test', total: 2, hit: 2, avgCents: 12,
                    notes: [
                        { label: '6', midi: 60, result: 'ok', avgCents: 22, biasCents: 21 },
                        { label: '1', midi: 52, result: 'good', avgCents: 3, biasCents: 1 }
                    ]
                });
            }
            return ProgressStore.weakSpotLine('weak-spot-check');
        });
        report.check(`weak spots name the sharp degree ("${weakLine}")`,
            weakLine.includes('6:') && weakLine.includes('sharp') && !weakLine.includes('1:'));

        // The action row lives in the fixed bottom dock sheet.
        // Programmatic scroll applies synchronously (no smooth behavior).
        await tab.evaluate(() => window.scrollTo(0, 700));
        const pinned = await tab.evaluate(() => {
            const dock = document.getElementById('phraseTestDock');
            const actions = document.querySelector('#phraseTestPanel .pitch-test-actions');
            if (!dock || !actions) return { ok: false };
            const dockRect = dock.getBoundingClientRect();
            const actionsRect = actions.getBoundingClientRect();
            return {
                ok: true,
                dockOpen: dock.classList.contains('open'),
                dockAtBottom: Math.abs(dockRect.bottom - window.innerHeight) < 4,
                actionsVisible: actionsRect.top >= 0 && actionsRect.bottom <= window.innerHeight
            };
        });
        report.check(`phrases test dock stays fixed at bottom when scrolled (open=${pinned.dockOpen})`,
            pinned.ok && pinned.dockOpen && pinned.dockAtBottom && pinned.actionsVisible);
        await tab.close();
    }
    await browser.close();
    report.finish();
})();
