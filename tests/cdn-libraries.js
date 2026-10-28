// @ts-check
// Pages load Tone.js, VexFlow, pdf.js and JSZip from cdnjs at pinned
// versions. Tests serve those files from tests/.cdn-cache instead: a pinned
// file never changes, so each one is downloaded once per machine (once per
// CI run) rather than once per test page (146 times per full run before),
// and the gate never waits on cdnjs (a cdnjs stall timed out six suites on
// 2026-10-28).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cdn-cache');
const CDN_PREFIX = 'https://cdnjs.cloudflare.com/ajax/libs/';
const CDN_URL = /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/[^"'`\s)]+/g;

/** @param {string} url */
function cachePath(url) {
    return path.join(CACHE_DIR, url.slice(CDN_PREFIX.length));
}

/** Every cdnjs URL written in a root page or script. */
function siteCdnUrls() {
    const urls = new Set();
    for (const name of fs.readdirSync(ROOT)) {
        if (!/\.(html|js)$/.test(name)) continue;
        for (const match of fs.readFileSync(path.join(ROOT, name), 'utf8').matchAll(CDN_URL)) {
            urls.add(match[0]);
        }
    }
    return [...urls].sort();
}

/** Downloads the pinned files not cached yet; returns the URLs it fetched. */
async function fillCdnCache() {
    const missing = siteCdnUrls().filter(url => !fs.existsSync(cachePath(url)));
    await Promise.all(missing.map(async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const file = cachePath(url);
        const partial = `${file}.${process.pid}.part`;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
        fs.renameSync(partial, file);
    }));
    return missing;
}

/** @param {import('playwright').Page | import('playwright').BrowserContext} target */
async function routeCdnLibraries(target) {
    await target.route(`${CDN_PREFIX}**`, route => {
        const url = route.request().url();
        const file = cachePath(url);
        if (!fs.existsSync(file)) {
            console.error(`No cached copy of ${url}: fillCdnCache only finds cdnjs URLs written out in a root .html or .js file`);
            return route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill({ path: file, headers: { 'access-control-allow-origin': '*' } });
    });
}

module.exports = { fillCdnCache, routeCdnLibraries, siteCdnUrls };
