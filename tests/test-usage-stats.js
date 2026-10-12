// @ts-check
// Usage statistics (docs/architecture.md, "Usage statistics"). Static half:
// the vendored client is its fuseki4_ai original, unedited, and every page
// loads it before usage-stats.js. Browser half: the local tree is served as
// https://fuseki.net/voice-wei/ through request routing - the one place the
// client sends - and its pings are recorded in the page as they are sent and
// answered locally, so nothing reaches the real host. One sing take, one ear
// question, and one Pitch session each send exactly one round with their
// fields; engaged() follows the microphone and the piano, never the silent
// media-session loop.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { BASE_URL, launchWithMic, collectErrors, createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const APP_URL = 'https://fuseki.net/voice-wei/';
const WAIT_MS = 10000;
const ID = /^[0-9a-f]{16}$/;
// ears.html only redirects to intervals.html?mode=ear, which loads the client.
const REDIRECT_STUBS = ['ears.html'];

/** @param {string} relative */
function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/**
 * Poll a page condition until it holds; returns false on timeout so the
 * caller's assertion reports the final state itself.
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

/**
 * Serve the local tree as the app directory on fuseki.net. The client's
 * pings get an empty 204, as the host's nginx answers them; every other
 * path on the host is refused, so no request reaches the real server.
 * @param {import('playwright').BrowserContext} ctx
 */
async function serveAsFuseki(ctx) {
    await ctx.route('https://fuseki.net/**', async route => {
        const url = new URL(route.request().url());
        if (!url.pathname.startsWith('/voice-wei/')) {
            await route.abort();
            return;
        }
        if (url.pathname === '/voice-wei/_event') {
            await route.fulfill({ status: 204 });
            return;
        }
        const local = `${BASE_URL}/${url.pathname.slice('/voice-wei/'.length)}${url.search}`;
        await route.fulfill({ response: await route.fetch({ url: local }) });
    });
}

// Init script: record each ping's fields when the client sends it, so
// "exactly one" needs no settling wait.
function recordPings() {
    window.__statsPings = [];
    const pageFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname === '/voice-wei/_event') {
            window.__statsPings.push(Object.fromEntries(url.searchParams));
        }
        return pageFetch(input, init);
    };
}

/** @param {import('playwright').Page} tab @returns {Promise<Array<Record<string, string>>>} */
function pingsOf(tab) {
    return tab.evaluate(() => window.__statsPings);
}

(async () => {
    const report = createReporter('usage statistics');

    //-------VENDORED CLIENT-------
    const [digest, name] = read('fuseki-stats.sha256').trim().split(/\s+\*?/);
    // Git may check text files out with CRLF line endings on Windows.
    const source = Buffer.from(fs.readFileSync(path.join(ROOT, 'fuseki-stats.js')).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    const unedited = name === 'fuseki-stats.js'
        && crypto.createHash('sha256').update(source).digest('hex') === digest;
    report.check('fuseki-stats.js is the fuseki4_ai original, unedited', unedited);
    if (!unedited) {
        report.errors.push('fuseki-stats.js differs from fuseki-stats.sha256: change it in fuseki4_ai '
            + '(setup/apps/fuseki-stats.js), copy it here unchanged, then run sha256sum fuseki-stats.js > fuseki-stats.sha256');
    }

    //-------PAGES-------
    const pages = fs.readdirSync(ROOT)
        .filter(file => file.endsWith('.html') && !REDIRECT_STUBS.includes(file))
        .sort();
    const unwired = pages.filter(page => {
        const html = read(page);
        const clientAt = html.search(/<script src="fuseki-stats\.js[?"]/);
        return clientAt === -1 || html.search(/<script src="usage-stats\.js[?"]/) < clientAt;
    });
    report.check(`every page loads fuseki-stats.js, then usage-stats.js (${pages.length} pages)`, unwired.length === 0);
    unwired.forEach(page => report.errors.push(`${page} must load fuseki-stats.js and, after it, usage-stats.js`));
    const stubsRunScripts = REDIRECT_STUBS.filter(page => /<script src=/.test(read(page)));
    report.check('the exempt redirect stubs still only redirect', stubsRunScripts.length === 0);

    //-------BROWSER: SERVED AS FUSEKI.NET/VOICE-WEI/-------
    const browser = await launchWithMic();
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    await serveAsFuseki(ctx);
    await ctx.addInitScript(recordPings);
    // Short notes keep the sing take brief (targets are note-length slots).
    await ctx.addInitScript(() => {
        localStorage.setItem('voice-wei:intervals-settings', JSON.stringify({ lengthMs: 100, gapMs: 200 }));
    });

    // ============ INTERVALS: play ping, engaged, sing take, ear question ============
    const intervals = await ctx.newPage();
    collectErrors(intervals, 'intervals', report.errors);
    await intervals.goto(`${APP_URL}intervals.html`, { waitUntil: 'networkidle' });
    // Ear training is ready once its piano has loaded ('Ready!' prompt).
    await intervals.waitForFunction(
        () => Boolean(window.intervalsDebug)
            && (document.getElementById('intervalPrompt')?.textContent || '').includes('Ready!'),
        null, { timeout: WAIT_MS });
    const atRest = await intervals.evaluate(() => ({
        pings: window.__statsPings.length,
        engaged: UsageStats.engaged()
    }));
    report.check('nothing is sent before the first input; a silent page is not engaged',
        atRest.pings === 0 && atRest.engaged === false);

    // The first real input (a pointer press) starts the session.
    await intervals.click('#singBtn');
    await waitOn(intervals, () => {
        const listenBtn = document.getElementById('intervalsSingListenBtn');
        const status = document.getElementById('intervalsSingStatus')?.textContent || '';
        return Boolean(listenBtn && listenBtn.textContent.includes('On')) || status.includes('Microphone unavailable');
    });
    const [play] = await pingsOf(intervals);
    report.check(`first input sends one play ping (${JSON.stringify(play)})`,
        Boolean(play) && play.e === 'play' && play.v === '1' && play.n === '0'
        && ID.test(play.p) && ID.test(play.s) && play.pg === '/voice-wei/intervals.html');
    const listening = await intervals.evaluate(() => ({
        mic: PitchDetectCore.isListening(),
        engaged: UsageStats.engaged()
    }));
    report.check('engaged while the microphone listens', listening.mic && listening.engaged);

    // Stop the mic (the fake device's endless beeps keep unreached targets
    // pending), then sing through the panel's explicit sample seam.
    await intervals.evaluate(() => {
        const listenBtn = document.getElementById('intervalsSingListenBtn');
        if (listenBtn && listenBtn.textContent.includes('On')) listenBtn.click();
        document.getElementById('intervalsSingPauseToggle').click();
        for (let k = 0; k < 5; k++) window.intervalsDebug.panel.recordSample(60, 30 + k * 50);
    });
    const quiet = await intervals.evaluate(() => ({
        engaged: UsageStats.engaged(),
        keepAlive: MediaSessionCore.getKeepAliveState()
    }));
    report.check(`not engaged once the microphone stops, with the silent session loop ${quiet.keepAlive}`,
        !quiet.engaged && quiet.keepAlive === 'playing');

    // The take completes once the voice has been idle ~600ms; each draw
    // rescores, and a recorded take must never send twice.
    const takeSent = await waitOn(intervals, () => {
        window.intervalsDebug.panel.draw();
        return window.__statsPings.some(ping => ping.e === 'game');
    });
    await intervals.evaluate(() => {
        window.intervalsDebug.panel.draw();
        window.intervalsDebug.panel.draw();
    });
    const takes = (await pingsOf(intervals)).filter(ping => ping.e === 'game');
    const take = takes[0] || {};
    report.check(`sing take sends one round (${JSON.stringify(take)})`,
        takeSent && takes.length === 1 && take.m === 'intervals-a1' && take.r === 'done'
        && Number(take.total) >= 2 && /^\d+$/.test(take.hit) && Number(take.d) > 0
        && take.pg === '/voice-wei/intervals.html');

    await intervals.click('[data-training-mode="ear"]');
    await intervals.click('#earNextBtn');
    await waitOn(intervals, () => document.getElementById('intervalPrompt')?.textContent === 'What interval?');
    const heard = await intervals.evaluate(() => ({
        engaged: UsageStats.engaged(),
        mic: PitchDetectCore.isListening()
    }));
    report.check('engaged by the piano just played (microphone off)', heard.engaged && !heard.mic);
    await intervals.click('.answer-btn[data-interval="P5"]');
    // Skip after an answer only moves on: no second result, no second round.
    await intervals.evaluate(() => document.getElementById('singSkipBtn').click());
    const ear = await intervals.evaluate(() => ({
        rounds: window.__statsPings.filter(ping => ping.e === 'game' && ping.m.startsWith('ears')),
        total: document.getElementById('statTotal')?.textContent
    }));
    const question = ear.rounds[0] || {};
    report.check(`ear question sends one round; Skip after the answer adds nothing (${JSON.stringify(question)}, total ${ear.total})`,
        ear.rounds.length === 1 && question.m === 'ears-identify'
        && (question.r === 'pass' || question.r === 'fail') && Number(question.d) > 0 && ear.total === '1');

    // Both mode records a correct identification at once; singing is practice.
    await intervals.click('[data-mode="both"]');
    await intervals.click('#earNextBtn');
    await waitOn(intervals, () => window.intervalsDebug.ear.awaitingAnswer === true);
    const before = await intervals.evaluate(() => {
        const ear = window.intervalsDebug.ear;
        return { target: ear.currentInterval, correct: ear.stats[ear.currentInterval].correct };
    });
    await intervals.click(`.answer-btn[data-interval="${before.target}"]`);
    const both = await intervals.evaluate((interval) => ({
        rounds: window.__statsPings.filter(ping => ping.e === 'game' && ping.m === 'ears-both'),
        correct: window.intervalsDebug.ear.stats[interval].correct
    }), before.target);
    report.check(`Both mode records a correct identification (${JSON.stringify({ ...before, ...both })})`,
        both.rounds.length === 1 && both.rounds[0].r === 'pass' && both.correct === before.correct + 1);

    // ============ PITCH: one scored session, same player ============
    const pitch = await ctx.newPage();
    collectErrors(pitch, 'pitch-meter', report.errors);
    await pitch.goto(`${APP_URL}pitch-meter.html`, { waitUntil: 'networkidle' });
    await pitch.waitForFunction(() => Boolean(window.pitchMeter && window.pitchMeter.samplerLoaded),
        null, { timeout: WAIT_MS });
    await pitch.click('[data-mode="free"]');
    await pitch.click('#listenBtn');
    // Any accepted sample from the fake device makes the session scorable.
    await waitOn(pitch, () => window.pitchMeter.session.history.length > 0);
    await pitch.click('#stopBtn');
    const pitchPings = await pingsOf(pitch);
    const sessions = pitchPings.filter(ping => ping.e === 'game');
    const scored = sessions[0] || {};
    report.check(`Pitch session sends one round (${JSON.stringify(scored)})`,
        sessions.length === 1 && scored.m === 'pitch-free' && scored.r === 'done'
        && Number(scored.total) > 0 && /^\d+$/.test(scored.acc) && Number(scored.d) > 0
        && scored.pg === '/voice-wei/pitch-meter.html');
    const pitchPlay = pitchPings.find(ping => ping.e === 'play');
    report.check('the player number persists across pages; the session does not',
        Boolean(play && pitchPlay) && pitchPlay.p === play.p && pitchPlay.s !== play.s);

    await ctx.close();
    await browser.close();
    report.finish();
})();
