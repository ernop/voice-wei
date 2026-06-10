// @ts-check
// Every page must load with zero console errors and zero page errors.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const PAGES = [
    'index.html', 'scales.html', 'intervals.html', 'phrases.html', 'trace.html',
    'pitch-meter.html', 'ears.html', 'player.html', 'ebook.html'
];

(async () => {
    const report = createReporter('pages load');
    const browser = await launch();

    for (const page of PAGES) {
        const tab = await browser.newPage();
        /** @type {string[]} */
        const pageErrors = [];
        collectErrors(tab, page, pageErrors);
        try {
            await tab.goto(`${BASE_URL}/${page}`, { waitUntil: 'networkidle', timeout: 30000 });
            await tab.waitForTimeout(2000);
        } catch (err) {
            pageErrors.push(`${page} navigation: ${err.message}`);
        }
        report.check(`${page} loads clean`, pageErrors.length === 0);
        pageErrors.forEach(e => report.errors.push(e));
        await tab.close();
    }

    await browser.close();
    report.finish();
})();
