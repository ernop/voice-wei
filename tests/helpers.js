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

// Owner display rule, rendered half: injected with
// tab.evaluate(installGrayTextScan), after which window.__scanGrayText()
// lists every visible text that is translucent, dimmed by opacity, or
// near-neutral without being pure white or pure black. It stays installed,
// so later states (open panels, overlays) are checked by one definition.
function installGrayTextScan() {
    /** @param {Element} el */
    const effectiveOpacity = el => {
        let opacity = 1;
        for (let node = /** @type {Element | null} */ (el); node; node = node.parentElement) {
            opacity *= Number(getComputedStyle(node).opacity);
        }
        return opacity;
    };
    window.__scanGrayText = () => {
        const offenders = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent?.trim()) continue;
            const el = node.parentElement;
            if (!el) continue;
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden') continue;
            const [r, g, b, a = 1] = (style.color.match(/[\d.]+/g) || []).map(Number);
            // Near-neutral text (low saturation, or tinted near-white /
            // near-black) must be pure white or pure black; semantic
            // colors must be opaque. Same test as isGrayTextColor below,
            // inlined because this function runs inside the page.
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const lightness = (max + min) / 510;
            const saturation = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * lightness - 1));
            const nearNeutral = saturation < 0.3 || min > 200 || max < 60;
            const pure = (r === 255 && g === 255 && b === 255) || (r === 0 && g === 0 && b === 0);
            const opacity = effectiveOpacity(el);
            if (a < 1 || opacity < 1 || (nearNeutral && !pure)) {
                offenders.push(`${el.tagName.toLowerCase()}.${el.className}: "${node.textContent.trim().slice(0, 24)}" ${style.color} opacity ${opacity}`);
            }
        }
        return offenders;
    };
}

/**
 * The rendered scan's test for one color: translucent, or near-neutral
 * (low saturation, or tinted near-white / near-black) without being pure
 * white or pure black. Semantic colors pass when saturated and opaque.
 * @param {number} r @param {number} g @param {number} b @param {number} [a]
 */
function isGrayTextColor(r, g, b, a = 1) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510;
    const saturation = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * lightness - 1));
    const nearNeutral = saturation < 0.3 || min > 200 || max < 60;
    const pure = (r === 255 && g === 255 && b === 255) || (r === 0 && g === 0 && b === 0);
    return a < 1 || (nearNeutral && !pure);
}

/**
 * Owner display rule, declared half: the text colors a stylesheet sets
 * that the rendered scan would call gray (hex or rgb/rgba values, gray
 * keywords), and partial opacity, which dims any text inside. Fully
 * transparent (opacity 0) hides rather than grays.
 * @param {string} css
 * @returns {string[]}
 */
function grayTextDeclarations(css) {
    /** @param {string} value */
    const isGray = value => {
        if (/^(gr[ae]y|silver|gainsboro|whitesmoke|lightgr[ae]y|darkgr[ae]y|dimgr[ae]y)$/i.test(value)) return true;
        const hex = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
        if (hex) {
            const full = hex.length <= 4 ? hex.split('').map(c => c + c).join('') : hex;
            const [r, g, b, a = 255] = (full.match(/../g) || []).map(part => parseInt(part, 16));
            return isGrayTextColor(r, g, b, a / 255);
        }
        const rgb = value.match(/^rgba?\(([^)]*)\)$/i)?.[1];
        if (rgb) {
            const [r, g, b, a = 1] = rgb.split(/[\s,/]+/).filter(Boolean).map(Number);
            return isGrayTextColor(r, g, b, a);
        }
        return false;
    };
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const colors = [...code.matchAll(/(?:^|[;{\s])color:\s*([^;]+);/g)]
        .map(match => match[1].replace(/\s*!important$/, '').trim())
        .filter(isGray);
    const dimming = [...code.matchAll(/(?:^|[;{\s])opacity:\s*([\d.]+)\s*;/g)]
        .map(match => Number(match[1]))
        .filter(value => value > 0 && value < 1)
        .map(value => `opacity ${value}`);
    return [...colors, ...dimming];
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

module.exports = {
    BASE_URL, launch, launchWithMic, collectErrors, instrumentVoices, installGrayTextScan, grayTextDeclarations, createReporter
};
