// @ts-check
// Shared helpers for the headless browser test suite.
// Requires the dev server (tests/run-all.js starts one, or run
// `python3 -m http.server 8000` yourself) and Playwright Chromium installed.

const { chromium, firefox } = require('playwright');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8000';
const TEST_BROWSER = process.env.TEST_BROWSER || 'chrome';

function launchOptions(extraArgs = []) {
    /** @type {import('playwright').LaunchOptions} */
    const options = {};
    if (TEST_BROWSER === 'firefox') {
        if (process.env.FIREFOX_PATH) options.executablePath = process.env.FIREFOX_PATH;
    } else {
        options.args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...extraArgs];
        if (process.env.CHROME_PATH) {
            options.executablePath = process.env.CHROME_PATH;
        }
    }
    return options;
}

// Piano samples normally come from the Salamander CDN. The gate must never
// depend on external network: under parallel load those fetches fail and
// poison console-error assertions. Every page and context created from a
// test browser transparently receives the same locally served silent WAV.
const SILENT_WAV = buildSilentWav();

function buildSilentWav() {
    const sampleRate = 44100;
    const sampleCount = Math.round(sampleRate * 0.05);
    const buffer = Buffer.alloc(44 + sampleCount * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + sampleCount * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(sampleCount * 2, 40);
    return buffer;
}

/** @param {import('playwright').Page | import('playwright').BrowserContext} target */
async function routePianoSamples(target) {
    await target.route('https://tonejs.github.io/audio/salamander/**', route => route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: SILENT_WAV
    }));
}

/** @param {import('playwright').Browser} browser */
function stubExternalAudio(browser) {
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...args) => {
        const page = await newPage(...args);
        await routePianoSamples(page);
        return page;
    };
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
        const context = await newContext(...args);
        await routePianoSamples(context);
        return context;
    };
    return browser;
}

function launch() {
    return (TEST_BROWSER === 'firefox' ? firefox : chromium).launch(launchOptions())
        .then(stubExternalAudio);
}

// Fake microphone (emits a tone) for pages that listen.
function launchWithMic() {
    return (TEST_BROWSER === 'firefox' ? firefox : chromium).launch(launchOptions([
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream'
    ])).then(stubExternalAudio);
}

/**
 * Collect page errors and console errors (favicon noise excluded).
 * @param {import('playwright').Page} tab
 * @param {string} label
 * @param {string[]} store
 */
function collectErrors(tab, label, store) {
    tab.on('pageerror', err => store.push(`${label} pageerror: ${err.message}`));
    tab.on('console', msg => {
        if (msg.type() === 'error' && !msg.text().includes('favicon')) {
            store.push(`${label} console.error: ${msg.text()}`);
        }
    });
}

// Injected into pages to count piano voice starts and kills.
function instrumentVoices() {
    window.__voiceStarts = 0;
    window.__trace = [];
    const start = Tone.ToneBufferSource.prototype.start;
    Tone.ToneBufferSource.prototype.start = function (...args) {
        window.__voiceStarts++;
        window.__trace.push({ t: performance.now(), type: 'voice-start' });
        return start.apply(this, args);
    };
    const cah = Tone.Param.prototype.cancelAndHoldAtTime;
    Tone.Param.prototype.cancelAndHoldAtTime = function (...args) {
        // Two callers reach this hook: a kill (stopAll cancels the gain
        // ramp NOW) and a starting voice scheduling its own stop at its
        // musical end, always >= 0.3s ahead (Tone's source.stop cancels
        // the internal gain at the stop time). Only the immediate
        // cancel is a kill; counting the scheduled self-stop would pair
        // every voice-start with a phantom kill just after it.
        if (this.toSeconds(args[0]) <= Tone.now() + 0.15) {
            window.__trace.push({ t: performance.now(), type: 'kill' });
        }
        return cah.apply(this, args);
    };
}

/** Minimal test reporter: collects checks, prints, exits non-zero on failure. */
function createReporter(suiteName) {
    /** @type {string[]} */
    const results = [];
    /** @type {string[]} */
    const errors = [];
    let failed = false;

    return {
        errors,
        check(label, ok) {
            if (!ok) failed = true;
            results.push(`${label}: ${ok ? 'PASS' : 'FAIL'}`);
        },
        note(label) {
            results.push(label);
        },
        finish() {
            console.log(`--- ${suiteName} ---`);
            results.forEach(r => console.log(r));
            if (errors.length) {
                console.log('--- ERRORS ---');
                errors.forEach(e => console.log(e));
                failed = true;
            }
            process.exit(failed ? 1 : 0);
        }
    };
}

module.exports = { BASE_URL, launch, launchWithMic, collectErrors, instrumentVoices, createReporter };
