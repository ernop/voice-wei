// @ts-check
// Load-smoke for pages that NO other suite navigates to. Every other page
// (scales, intervals, phrases, trace, pitch-meter, player, ebook) is opened
// with collectErrors by its own product suite, which proves clean load as a
// side effect; re-loading them here added nothing. ears.html stays because
// only this suite exercises the redirect stub to intervals.html?mode=ear.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const PAGES = ['index.html', 'ears.html', 'deploys.html'];
const SETTLE_MS = Number(process.env.TEST_SETTLE_MS || 250);

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
            const monitoredErrors = await tab.evaluate(() => window.__voiceWeiErrors || []);
            monitoredErrors.forEach(err => {
                const source = err.source ? ` (${err.source})` : '';
                pageErrors.push(`${page} monitor: ${err.type}: ${err.message}${source}`);
            });
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
