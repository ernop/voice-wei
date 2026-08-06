// @ts-check
// Word-coolness engine contract:
// 1. coolness-report.json is fresh: generated from the current
//    coolness-config.json (digest match) over the config sampleWords.
// 2. The browser engine (coolness-score.js) reproduces the Python
//    engine's report exactly - the two implementations stay in lockstep.
// 3. Scoring sanity: cool words beat junk, metrics stay in [0, 1].
// 4. Formulas are well-formed weight presets over exactly the 7 metrics.
// 5. The theme combiner produces ranked batches, appends every batch to
//    its append-only log, and rejects a same-theme pair.
// 6. The Word lab on deploys.html loads, scores a typed word, applies a
//    formula preset, and renders the leaderboard without errors.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
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

function loadBrowserCombiner() {
    const source = fs.readFileSync(path.join(ROOT, 'coolness-combine.js'), 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox);
    return sandbox.window.CoolnessCombine;
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

    // 4. Formula presets (independent scoring systems).
    const formulaIds = config.formulas.map(f => f.id);
    report.check(`at least ten scoring systems ship (${formulaIds.length})`,
        formulaIds.length >= 10);
    report.check('formula ids are unique and include balanced',
        new Set(formulaIds).size === formulaIds.length
        && formulaIds.includes('balanced'));
    const metricKey = JSON.stringify([...METRICS].sort());
    report.check('every formula weights exactly the 7 metrics',
        config.formulas.every(f =>
            JSON.stringify(Object.keys(f.weights).sort()) === metricKey));
    report.check('persona anchor vocabularies are well-formed',
        config.formulas.every(f => !f.anchors
            || (Array.isArray(f.anchors.cool) && f.anchors.cool.length > 0
                && Array.isArray(f.anchors.uncool) && f.anchors.uncool.length > 0)));
    const edge = config.formulas.find(f => f.id === 'edge');
    report.check('formulas rerank: vibe total differs between balanced and edge',
        scorer.totalFromMetrics(vibe.metrics, edge.weights)
        !== scorer.totalFromMetrics(vibe.metrics, config.weights));

    // Cross-engine parity under a persona formula (own anchor vocabulary).
    const genalpha = config.formulas.find(f => f.id === 'genalpha');
    const personaWords = ['vibe', 'skibidi', 'groovy', 'zorvane'];
    const pythonPersona = spawnSync('python3',
        ['coolness.py', '--json', '--formula', 'genalpha', ...personaWords],
        { cwd: ROOT, encoding: 'utf8' });
    report.check('python scores under a persona formula', pythonPersona.status === 0);
    const personaRows = JSON.parse(pythonPersona.stdout || '[]');
    const personaContext = scorer.anchorContext(genalpha.anchors);
    const personaMismatch = personaRows.some(row => {
        const live = scorer.score(row.word,
            { weights: genalpha.weights, anchorContext: personaContext });
        return Math.abs(live.total - row.total) > 0.1
            || METRICS.some(name =>
                Math.abs(live.metrics[name] - row.metrics[name]) > 1e-4);
    });
    report.check('engines agree under persona anchors (genalpha)', !personaMismatch);
    const genalphaSkibidi = personaRows.find(row => row.word === 'skibidi');
    const genalphaGroovy = personaRows.find(row => row.word === 'groovy');
    report.check('genalpha rates skibidi over groovy',
        genalphaSkibidi.total > genalphaGroovy.total);

    // 5. Theme combiner and its append-only log.
    const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coolness-')), 'log.jsonl');
    const combineArgs = ['coolness-combine.py', '--themes', 'mood', 'tech',
        '--count', '6', '--seed', '11', '--once', '--json', '--log', logPath];
    const realWords = new Set(JSON.parse(
        fs.readFileSync(path.join(ROOT, 'coolness-wordlist.json'), 'utf8')).words);
    report.check('real-English wordlist is substantial and excludes inventions',
        realWords.size > 25000 && realWords.has('muse') && realWords.has('node')
        && !realWords.has('zorvane') && !realWords.has('dript'));

    const first = spawnSync('python3', combineArgs, { cwd: ROOT, encoding: 'utf8' });
    report.check('combiner one-shot exits cleanly', first.status === 0);
    /** @type {Array<{ text: string, form: string, score: number }>} */
    const batch = JSON.parse(first.stdout || '[]');
    report.check('combiner produced the requested batch size', batch.length === 6);
    report.check('combiner batch is sorted by score descending',
        batch.every((row, i) => i === 0 || batch[i - 1].score >= row.score));
    report.check('every generated candidate is a NEW single word',
        batch.every(row => row.form === 'blend'
            && !row.text.includes(' ') && !realWords.has(row.text)));
    spawnSync('python3', combineArgs, { cwd: ROOT, encoding: 'utf8' });
    const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    report.check('log is append-only: two runs leave two batch lines',
        logLines.length === 2
        && logLines.every(line => JSON.parse(line).kind === 'combine-batch'));
    const sameTheme = spawnSync('python3',
        ['coolness-combine.py', '--themes', 'tech', 'tech', '--once', '--log', logPath],
        { cwd: ROOT, encoding: 'utf8' });
    report.check('combiner rejects picking the same theme twice',
        sameTheme.status !== 0);

    // Custom word sets: exhaustive cross product (phrases + blends).
    const exhaustive = spawnSync('python3',
        ['coolness-combine.py', '--words-a', 'glow,neon', '--words-b', 'code,pixel',
            '--once', '--json', '--top', '0', '--log', logPath],
        { cwd: ROOT, encoding: 'utf8' });
    report.check('custom word sets run exhaustively', exhaustive.status === 0);
    /** @type {Array<{ text: string, form: string, strategy: string, score: number }>} */
    const cross = JSON.parse(exhaustive.stdout || '[]');
    report.check('cross product yields only new single words (6 from 2x2)',
        cross.length === 6
        && cross.every(r => !r.text.includes(' ') && !realWords.has(r.text)));
    report.check('real-word collisions are dropped (node from neon+code)',
        !cross.some(r => r.text === 'node'));
    report.check('exhaustive batch is sorted by score descending',
        cross.every((row, i) => i === 0 || cross[i - 1].score >= row.score));
    const lastLog = JSON.parse(
        fs.readFileSync(logPath, 'utf8').trim().split('\n').pop() || '{}');
    report.check('exhaustive run logs the sets, drops, and full results',
        lastLog.kind === 'combine-exhaustive'
        && lastLog.sets.a.seeds.join(',') === 'glow,neon'
        && lastLog.droppedRealWords >= 1
        && lastLog.results.length === 6);

    // Browser combiner mirrors the Python cross product exactly.
    const combiner = loadBrowserCombiner();
    const jsCross = combiner.crossProduct(
        ['glow', 'neon'], ['code', 'pixel'], realWords,
        word => scorer.score(word));
    report.check('browser combiner matches the Python cross product',
        JSON.stringify(jsCross.results.map(r => [r.text, r.score, r.strategy]))
        === JSON.stringify(cross.map(r => [r.text, r.score, r.strategy]))
        && jsCross.droppedReal === lastLog.droppedRealWords);
    const zernel = combiner.blendParts('zen', 'kernel')
        .some(([, text]) => text === 'zernel');
    const drixel = combiner.blendParts('drift', 'pixel')
        .some(([, text]) => text === 'drixel');
    report.check('browser blend strategies mirror Python (zernel, drixel)',
        zernel && drixel);

    // 6. Word lab UI on deploys.html.
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

    const optionCount = await tab.evaluate(
        () => document.querySelectorAll('#wordLabFormula option').length);
    report.check('formula dropdown lists every formula plus Custom',
        optionCount === config.formulas.length + 1);
    await tab.selectOption('#wordLabFormula', 'edge');
    const afterFormula = await tab.evaluate(() => {
        const sliders = [...document.querySelectorAll('#wordLabWeights input[type="range"]')];
        return {
            values: sliders.map(s => /** @type {HTMLInputElement} */(s).value),
            note: document.getElementById('wordLabFormulaNote')?.textContent || ''
        };
    });
    const edgeExpected = METRICS.map(name => String(edge.weights[name]));
    report.check('selecting the edge formula applies its weights to the sliders',
        JSON.stringify(afterFormula.values) === JSON.stringify(edgeExpected));
    report.check('formula note explains the selected formula',
        afterFormula.note.includes('Westbury'));
    const customAfterNudge = await tab.evaluate(() => {
        const slider = /** @type {HTMLInputElement} */ (
            document.querySelector('#wordLabWeights input[type="range"]'));
        slider.value = '0.4';
        slider.dispatchEvent(new Event('input'));
        const select = /** @type {HTMLSelectElement} */ (
            document.getElementById('wordLabFormula'));
        return select.value;
    });
    report.check('moving a slider switches the formula to Custom',
        customAfterNudge === 'custom');

    // Persona anchors change the anchors column, not just the weighting.
    const anchorColumn = () => tab.evaluate(() => {
        /** @type {Record<string, string>} */
        const byWord = {};
        document.querySelectorAll('#wordLabTableBody tr').forEach(tr => {
            const cells = tr.querySelectorAll('td');
            byWord[cells[1].textContent || ''] = cells[8].textContent || '';
        });
        return byWord;
    });
    await tab.selectOption('#wordLabFormula', 'balanced');
    const balancedAnchors = await anchorColumn();
    await tab.selectOption('#wordLabFormula', 'genalpha');
    const genalphaAnchors = await anchorColumn();
    report.check('persona formula rescoring changes anchor metric values',
        Object.keys(balancedAnchors).some(word =>
            word in genalphaAnchors && balancedAnchors[word] !== genalphaAnchors[word]));

    // On-page combine flow (expansion off so the gate stays offline).
    await tab.fill('#combineSetA', 'glow, neon');
    await tab.fill('#combineSetB', 'code, pixel');
    await tab.selectOption('#combineExpand', '0');
    await tab.click('#combineRunBtn');
    await tab.waitForFunction(() => {
        const status = document.getElementById('combineStatus');
        return status !== null && (status.textContent || '').includes('new words');
    }, undefined, { timeout: 10000 });
    const combineState = await tab.evaluate(() => ({
        status: document.getElementById('combineStatus')?.textContent || '',
        rows: document.querySelectorAll('#combineTableBody tr').length,
        words: [...document.querySelectorAll('#combineTableBody tr td:nth-child(2)')]
            .map(td => td.textContent || '')
    }));
    report.check('page combine builds and ranks only new words (6 from 2x2)',
        combineState.status.includes('6 new words') && combineState.rows === 6
        && combineState.words.every(word => !word.includes(' ') && word !== 'node'));
    await tab.selectOption('#wordLabFormula', 'streetwise');
    await tab.waitForFunction(() => {
        const status = document.getElementById('combineStatus');
        return status !== null && (status.textContent || '').includes('re-ranked under streetwise');
    }, undefined, { timeout: 10000 });
    const deviceLogCount = await tab.evaluate(() => window.CoolnessCombine.batchCount());
    report.check('combine batches persist to the device log (IndexedDB)',
        deviceLogCount >= 2);
    report.check('export button for the device log is present',
        await tab.evaluate(() => document.getElementById('combineExportBtn') !== null));

    report.check('deploys.html stays free of console errors', pageErrors.length === 0);
    pageErrors.forEach(e => report.errors.push(e));

    await browser.close();
    report.finish();
})();
