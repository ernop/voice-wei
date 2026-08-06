// @ts-check
// Word-coolness engine contract:
// 1. coolness-report.json is fresh: generated from the current
//    coolness-config.json (digest match) over the config sampleWords.
// 2. The browser engine (coolness-score.js) reproduces the Python
//    engine's report exactly - the two implementations stay in lockstep.
// 3. Scoring sanity: cool words beat junk, metrics stay in [0, 1].
// 4. The Word lab on deploys.html loads, scores a typed word, and
//    renders the leaderboard without errors.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const METRICS = [
    'pronounceability', 'flow', 'energy', 'phonesthemes',
    'novelty', 'anchors', 'brevity'
];

function loadBrowserEngine() {
    const source = fs.readFileSync(path.join(ROOT, 'coolness-score.js'), 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox);
    return sandbox.window.CoolnessScore;
}

(async () => {
    const report = createReporter('coolness');

    const configRaw = fs.readFileSync(path.join(ROOT, 'coolness-config.json'));
    const config = JSON.parse(configRaw.toString('utf8'));
    const scored = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'coolness-report.json'), 'utf8'));

    // 1. Report freshness against the config it claims to come from.
    const digest = crypto.createHash('sha256').update(configRaw).digest('hex');
    report.check('report was generated from the current config (digest match)',
        scored.configDigest === digest);
    report.check('report weights equal config weights',
        JSON.stringify(scored.weights) === JSON.stringify(config.weights));
    const reportWords = scored.words.map(row => row.word).sort();
    const sampleWords = [...config.sampleWords].sort();
    report.check('report covers exactly the config sampleWords',
        JSON.stringify(reportWords) === JSON.stringify(sampleWords));

    // 2. Engine parity: browser mirror reproduces the Python report.
    const engine = loadBrowserEngine();
    const scorer = engine.createScorer(config);
    let parityFailures = 0;
    for (const row of scored.words) {
        const live = scorer.score(row.word);
        const mismatches = [];
        if (Math.abs(live.total - row.total) > 0.1) {
            mismatches.push(`total ${live.total} vs ${row.total}`);
        }
        for (const name of METRICS) {
            if (Math.abs(live.metrics[name] - row.metrics[name]) > 1e-4) {
                mismatches.push(`${name} ${live.metrics[name]} vs ${row.metrics[name]}`);
            }
        }
        if (live.tokens.join('-') !== row.tokens.join('-')) {
            mismatches.push(`tokens ${live.tokens.join('-')} vs ${row.tokens.join('-')}`);
        }
        if (live.syllables !== row.syllables) {
            mismatches.push(`syllables ${live.syllables} vs ${row.syllables}`);
        }
        if (mismatches.length) {
            parityFailures += 1;
            report.errors.push(`parity ${row.word}: ${mismatches.join('; ')}`);
        }
    }
    report.check(`browser engine matches the Python report (${scored.words.length} words)`,
        parityFailures === 0);

    // 3. Scoring sanity.
    const vibe = scorer.score('vibe');
    const phlegm = scorer.score('phlegm');
    const fnorpt = scorer.score('fnorpt');
    report.check('vibe outscores phlegm', vibe.total > phlegm.total);
    report.check('illegal onset+coda word gets 0 pronounceability',
        fnorpt.metrics.pronounceability === 0);
    report.check('vowelless strings score 0 pronounceability and flow',
        scorer.score('zzkrt').metrics.pronounceability === 0
        && scorer.score('zzkrt').metrics.flow === 0);
    const inRange = scored.words.every(row =>
        METRICS.every(name => row.metrics[name] >= 0 && row.metrics[name] <= 1));
    report.check('all report metrics stay within [0, 1]', inRange);
    report.check('unseen word scores without throwing',
        typeof scorer.score('squanchamora').total === 'number');

    // 4. Word lab UI on deploys.html.
    const browser = await launch();
    const tab = await browser.newPage();
    /** @type {string[]} */
    const pageErrors = [];
    collectErrors(tab, 'deploys.html', pageErrors);
    await tab.goto(`${BASE_URL}/deploys.html`, { waitUntil: 'networkidle', timeout: 30000 });
    await tab.waitForFunction(() => {
        const status = document.getElementById('wordLabStatus');
        return status !== null && status.textContent !== null
            && status.textContent.includes('coolness.py');
    }, undefined, { timeout: 10000 });

    const statusText = await tab.evaluate(
        () => document.getElementById('wordLabStatus')?.textContent || '');
    report.check('word lab reports engine parity on page',
        statusText.includes('matches all'));

    const rowCount = await tab.evaluate(
        () => document.querySelectorAll('#wordLabTableBody tr').length);
    report.check(`leaderboard renders the sample words (${rowCount} rows)`,
        rowCount === config.sampleWords.length);

    await tab.fill('#wordLabInput', 'squanch');
    await tab.click('#wordLabScoreBtn');
    const featured = await tab.evaluate(() => {
        const result = document.getElementById('wordLabResult');
        return {
            visible: result !== null && !result.hidden,
            text: result?.textContent || '',
            userRows: document.querySelectorAll('.word-lab-row-user').length
        };
    });
    report.check('typed word shows a featured breakdown',
        featured.visible && featured.text.includes('squanch'));
    report.check('typed word joins the leaderboard highlighted',
        featured.userRows === 1);

    await tab.click('#wordLabClearBtn');
    const clearedRows = await tab.evaluate(
        () => document.querySelectorAll('.word-lab-row-user').length);
    report.check('clear removes tried words', clearedRows === 0);

    report.check('deploys.html stays free of console errors', pageErrors.length === 0);
    pageErrors.forEach(e => report.errors.push(e));

    await browser.close();
    report.finish();
})();
