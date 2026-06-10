// @ts-check
// Every page must load with zero console errors and zero page errors.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const PAGES = [
    'index.html', 'scales.html', 'intervals.html', 'phrases.html', 'trace.html',
    'pitch-meter.html', 'ears.html', 'player.html', 'ebook.html'
];
const SETTLE_MS = Number(process.env.TEST_SETTLE_MS || (process.env.TEST_PROFILE === 'full' ? 2000 : 250));

(async () => {
    const report = createReporter('pages load');
    const browser = await launch();

    const results = await Promise.all(PAGES.map(async page => {
        const tab = await browser.newPage();
        /** @type {string[]} */
        const pageErrors = [];
        collectErrors(tab, page, pageErrors);
        try {
            await tab.goto(`${BASE_URL}/${page}`, { waitUntil: 'networkidle', timeout: 30000 });
            await tab.waitForTimeout(SETTLE_MS);
        } catch (err) {
            pageErrors.push(`${page} navigation: ${err.message}`);
        }
        await tab.close();
        return { page, pageErrors };
    }));

    for (const { page, pageErrors } of results) {
        report.check(`${page} loads clean`, pageErrors.length === 0);
        pageErrors.forEach(e => report.errors.push(e));
    }

    await browser.close();
    report.finish();
})();
