// @ts-check
// Shared helpers for the headless browser test suite.
// Requires the dev server (tests/run-all.js starts one, or run
// `python3 -m http.server 8000` yourself) and Chrome installed.

const { chromium } = require('playwright');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8000';

function launchOptions(extraArgs = []) {
    /** @type {import('playwright').LaunchOptions} */
    const options = {
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...extraArgs]
    };
    if (process.env.CHROME_PATH) {
        options.executablePath = process.env.CHROME_PATH;
    } else {
        options.channel = 'chrome';
    }
    return options;
}

function launch() {
    return chromium.launch(launchOptions());
}

// Fake microphone (emits a tone) for pages that listen.
function launchWithMic() {
    return chromium.launch(launchOptions([
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream'
    ]));
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
        window.__trace.push({ t: performance.now(), type: 'kill' });
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
