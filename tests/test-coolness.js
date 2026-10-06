// @ts-check
// Word-coolness engine contract:
// 1. coolness-report.json is fresh: generated from the current
//    coolness-config.json (digest match) over the config sampleTiers.
// 2. The browser engine (coolness-score.js) reproduces the Python
//    engine's report exactly - the two implementations stay in lockstep.
// 3. Scoring sanity: the sample tiers come out in order, hyphen joints,
//    the legality gate, leave-one-out anchors, and the sound fixes hold.
// 4. Formulas are well-formed weight presets over exactly the 7 metrics.
// 5. The theme combiner produces ranked batches, appends every batch to
//    its append-only log, and rejects a same-theme pair.
// 6. The Word lab on wording.html loads, scores a typed word, applies a
//    formula preset, shows live tier calibration, and combines sets.

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
    /** @type {string[]} */
    const sampleWords = config.sampleTiers.flatMap(tier => tier.words);
    report.check('report covers exactly the config sampleTiers words',
        JSON.stringify(reportWords) === JSON.stringify([...sampleWords].sort()));

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
    report.check(`legality gate sinks unpronounceable strings (fnorpt ${fnorpt.total})`,
        fnorpt.total < 35 && scorer.legalityGate(fnorpt.metrics) === config.legalityFloor);
    const tierRank = new Map(config.sampleTiers.map(tier => [tier.id, tier.rank]));
    const tierMeans = scored.calibration.tierMeans;
    report.check(`sample tier means fall with tier rank (${JSON.stringify(tierMeans)})`,
        config.sampleTiers.every(upper => config.sampleTiers.every(lower =>
            tierRank.get(upper.id) >= tierRank.get(lower.id)
            || tierMeans[upper.id] > tierMeans[lower.id])));
    report.check(`Balanced orders the sample tiers well (${scored.calibration.pairAccuracy})`,
        scored.calibration.pairAccuracy >= 0.85);
    const joined = scorer.score('vibe-code');
    report.check('a hyphen marks a compound joint: vibe-code is two syllables, silent e kept silent',
        joined.word === 'vibecode' && joined.syllables === 2
        && joined.tokens.join('-') === 'v-i-b-k-o-d'
        && JSON.stringify(joined.parts) === '["vibe","code"]'
        && scorer.score('vibecode').syllables === 3);
    report.check('a w closing a vowel is part of it (glow, brew, glowcode stay legal)',
        ['glow', 'brew', 'glow-code', 'draw'].every(w => scorer.score(w).metrics.pronounceability === 1));
    report.check('s+stop onsets and coronal coda appendices flow (spark, flux)',
        scorer.score('spark').metrics.flow === 1 && scorer.score('flux').metrics.flow === 1);
    report.check('anchors are leave-one-out: a listed cool word never matches itself',
        config.anchors.cool.includes('vibe') && vibe.metrics.anchors < 1);
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
    const personaWords = ['vibe', 'skibidi', 'groovy', 'zorvane', 'rizzler', 'groovester'];
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
    // Unlisted words only: anchors are leave-one-out, so a persona's own
    // list words prove nothing about its taste.
    const boomer = config.formulas.find(f => f.id === 'boomer');
    const boomerContext = scorer.anchorContext(boomer.anchors);
    const underBoomer = (/** @type {string} */ word) =>
        scorer.score(word, { weights: boomer.weights, anchorContext: boomerContext }).total;
    const genalphaTotal = (/** @type {string} */ word) =>
        personaRows.find(row => row.word === word).total;
    report.check('personas flip: genalpha rates rizzler over groovester, boomer the reverse',
        genalphaTotal('rizzler') > genalphaTotal('groovester')
        && underBoomer('groovester') > underBoomer('rizzler'));

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
    /** @type {Array<{ text: string, strategy: string, score: number }>} */
    const batch = JSON.parse(first.stdout || '[]');
    report.check('combiner produced the requested batch size', batch.length === 6);
    report.check('combiner batch is sorted by score descending',
        batch.every((row, i) => i === 0 || batch[i - 1].score >= row.score));
    report.check('every generated candidate is a NEW single word',
        batch.every(row => typeof row.strategy === 'string'
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
    /** @type {Array<{ text: string, strategy: string, score: number }>} */
    const cross = JSON.parse(exhaustive.stdout || '[]');
    report.check('cross product yields only new single words (24 from 2x2 seeds + inflections)',
        cross.length === 24
        && cross.every(r => !r.text.includes(' ') && !realWords.has(r.text)));
    report.check('compounds lead: straight joins like glowcode are generated',
        cross.some(r => r.text === 'glowcode' && r.strategy === 'compound'));
    report.check('every coinage carries its joint (parts join to the text)',
        cross.every(r => Array.isArray(r.parts) && r.parts.length === 2 && r.parts.join('') === r.text));
    report.check('inflected forms join the sets (glowing + coding compounds)',
        cross.some(r => r.text === 'glowingcoding'));
    report.check('exhaustive batch is sorted by score descending',
        cross.every((row, i) => i === 0 || cross[i - 1].score >= row.score));
    const lastLog = JSON.parse(
        fs.readFileSync(logPath, 'utf8').trim().split('\n').pop() || '{}');
    report.check('exhaustive run logs seeds, inflections, and full results',
        lastLog.kind === 'combine-exhaustive'
        && lastLog.sets.a.seeds.join(',') === 'glow,neon'
        && lastLog.sets.a.inflected.includes('glowing')
        && lastLog.results.length === 24);

    // Real-word collisions are dropped (run + way would be "runway").
    const runway = spawnSync('python3',
        ['coolness-combine.py', '--words-a', 'run', '--words-b', 'way',
            '--once', '--json', '--top', '0', '--log', logPath],
        { cwd: ROOT, encoding: 'utf8' });
    /** @type {Array<{ text: string }>} */
    const runwayRows = JSON.parse(runway.stdout || '[]');
    const runwayLog = JSON.parse(
        fs.readFileSync(logPath, 'utf8').trim().split('\n').pop() || '{}');
    report.check('real-word collisions are dropped (runway from run+way)',
        runway.status === 0
        && !runwayRows.some(r => r.text === 'runway')
        && runwayLog.droppedRealWords >= 1);

    // Browser combiner mirrors the Python cross product exactly (same
    // full word lists, inflections included, from the logged sets).
    const combiner = loadBrowserCombiner();
    const jsCross = combiner.crossProduct(
        lastLog.sets.a.words, lastLog.sets.b.words, realWords,
        word => scorer.score(word));
    report.check('browser combiner matches the Python cross product',
        JSON.stringify(jsCross.results.map(r => [r.text, r.parts, r.score, r.strategy]))
        === JSON.stringify(cross.map(r => [r.text, r.parts, r.score, r.strategy]))
        && jsCross.droppedReal === lastLog.droppedRealWords);
    report.check('browser strategies and inflection mirror Python',
        JSON.stringify(combiner.combineParts('vibe', 'code'))
        === JSON.stringify([['compound', ['vibe', 'code']], ['seam', ['vib', 'code']], ['clip', ['vi', 'code']]])
        && JSON.stringify(combiner.combineParts('vibe', 'byte'))
        === JSON.stringify([['compound', ['vibe', 'byte']], ['seam', ['vi', 'byte']], ['clip', ['vi', 'byte']]])
        && JSON.stringify(combiner.combineParts('aura', 'code'))
        === JSON.stringify([['compound', ['aura', 'code']]])
        && combiner.inflect('run', 'ing') === 'running'
        && combiner.inflect('code', 'ing') === 'coding'
        && combiner.inflect('glow', 'ing') === 'glowing'
        && JSON.stringify(combiner.inflectSet(['run', 'code'], ['ing']))
        === JSON.stringify(['running', 'coding']));

    // 6. Word lab UI on its own Wording tab (wording.html).
    const browser = await launch();
    const tab = await browser.newPage();
    /** @type {string[]} */
    const pageErrors = [];
    collectErrors(tab, 'wording.html', pageErrors);
    await tab.goto(`${BASE_URL}/wording.html`, { waitUntil: 'networkidle', timeout: 30000 });
    await tab.waitForFunction(
        () => document.getElementById('wordLabStatus')?.dataset.accuracy !== undefined,
        undefined, { timeout: 10000 });

    const pageState = await tab.evaluate(() => ({
        error: document.getElementById('wordLabError')?.hidden === false
            ? document.getElementById('wordLabError')?.textContent || '' : '',
        accuracy: Number(document.getElementById('wordLabStatus')?.dataset.accuracy),
        calibrationText: document.getElementById('wordLabStatus')?.textContent || '',
        rows: document.querySelectorAll('#wordLabTableBody tr').length,
        sliders: document.querySelectorAll('#wordLabWeights input[type="range"]').length,
        scaleLabels: [...document.querySelectorAll('#wordLabWeights .wording-weight')[0]
            .querySelectorAll('.wording-notch')].map(n => n.textContent),
        valueText: document.querySelector('#wordLabWeights .wording-weight-value')?.textContent || ''
    }));
    report.check('page shows no engine-mismatch error', pageState.error === '');
    report.check(`page tier calibration matches the Python report (${pageState.accuracy})`,
        pageState.accuracy === scored.calibration.pairAccuracy
        && pageState.calibrationText.includes('Tier order'));
    report.check(`leaderboard renders every sample tier word (${pageState.rows} rows)`,
        pageState.rows === sampleWords.length);
    report.check(`weight sliders show a notched scale with numbered endpoints and value (${pageState.scaleLabels.join(',')})`,
        pageState.sliders === METRICS.length
        && pageState.scaleLabels.length === 7
        && pageState.scaleLabels[0] === '0' && pageState.scaleLabels[6] === '3'
        && pageState.valueText === config.weights.pronounceability.toFixed(2));

    await tab.fill('#wordLabInput', 'squanch, vibe-code');
    await tab.click('#wordLabScoreBtn');
    const featured = await tab.evaluate(() => {
        const result = document.getElementById('wordLabResult');
        const userCells = [...document.querySelectorAll('.wording-row-user .wording-word')];
        return {
            visible: result !== null && !result.hidden,
            text: result?.textContent || '',
            userWords: userCells.map(td => td.textContent || '')
        };
    });
    report.check('typed word shows a featured breakdown',
        featured.visible && featured.text.includes('squanch'));
    report.check(`typed words join the leaderboard highlighted, joints scored (${featured.userWords.join(',')})`,
        featured.userWords.length === 2 && featured.userWords.includes('vibecode'));
    const typedVibeCode = await tab.evaluate(() => {
        const row = [...document.querySelectorAll('.wording-row-user')]
            .find(tr => tr.querySelector('.wording-word')?.textContent === 'vibecode');
        return row?.querySelector('.wording-score')?.textContent || '';
    });
    report.check('typed vibe-code scores as the two-part compound',
        typedVibeCode === joined.total.toFixed(1));

    await tab.click('#wordLabClearBtn');
    const clearedRows = await tab.evaluate(
        () => document.querySelectorAll('.wording-row-user').length);
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
            note: document.getElementById('wordLabFormulaNote')?.textContent || '',
            accuracy: Number(document.getElementById('wordLabStatus')?.dataset.accuracy)
        };
    });
    const edgeExpected = METRICS.map(name => String(edge.weights[name]));
    report.check('selecting the edge formula applies its weights to the sliders',
        JSON.stringify(afterFormula.values) === JSON.stringify(edgeExpected));
    report.check('formula note explains the selected formula',
        afterFormula.note.includes('Westbury'));
    report.check('tier calibration recomputes live under the selected formula',
        afterFormula.accuracy !== scored.calibration.pairAccuracy);
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
            const word = tr.querySelector('.wording-word')?.textContent || '';
            byWord[word] = tr.querySelector('td[data-metric="anchors"]')?.textContent || '';
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
        return status !== null && (status.textContent || '').includes('Device log');
    }, undefined, { timeout: 10000 });
    const combineState = await tab.evaluate(() => ({
        status: document.getElementById('combineStatus')?.textContent || '',
        rows: document.querySelectorAll('#combineTableBody tr').length,
        words: [...document.querySelectorAll('#combineTableBody .wording-word')]
            .map(td => td.textContent || '')
    }));
    const distinctSources = new Set(cross.map(r => r.source)).size;
    report.check(`page groups best-per-pair by default (${distinctSources} pairs from ${cross.length} words)`,
        combineState.status.includes(`${cross.length} new words`)
        && combineState.rows === distinctSources
        && combineState.words.every(word => !word.includes(' ')));
    await tab.setChecked('#combineGroupBest', false);
    const ungroupedRows = await tab.evaluate(
        () => document.querySelectorAll('#combineTableBody tr').length);
    report.check(`all variants show when grouping is off (${cross.length} rows)`,
        ungroupedRows === cross.length);

    // Tapping a ranked word features its metric breakdown, joint included.
    const tappedWord = await tab.evaluate(() => {
        const row = /** @type {HTMLElement} */ (
            document.querySelector('#combineTableBody tr'));
        row.click();
        return {
            word: row.querySelector('.wording-word')?.textContent || '',
            featured: document.getElementById('wordLabResult')?.textContent || '',
            hidden: document.getElementById('wordLabResult')?.hidden
        };
    });
    report.check('tapping a coined word shows its breakdown with the joint',
        tappedWord.hidden === false && tappedWord.featured.includes(tappedWord.word)
        && tappedWord.featured.includes(' + '));
    await tab.selectOption('#wordLabFormula', 'streetwise');
    await tab.waitForFunction(() => {
        const status = document.getElementById('combineStatus');
        return status !== null && (status.textContent || '').includes('re-ranked under Streetwise');
    }, undefined, { timeout: 10000 });
    const deviceLogCount = await tab.evaluate(() => window.CoolnessCombine.batchCount());
    report.check('combine batches persist to the device log (IndexedDB)',
        deviceLogCount >= 2);
    report.check('export button for the device log is present',
        await tab.evaluate(() => document.getElementById('combineExportBtn') !== null));

    // Owner display rule: no gray or dimmed neutral text anywhere on the page.
    const grayText = await tab.evaluate(() => {
        /** @type {string[]} */
        const offenders = [];
        document.querySelectorAll('.wording-panel *').forEach(node => {
            const element = /** @type {HTMLElement} */ (node);
            if (!element.childNodes.length || element.offsetParent === null) return;
            const hasText = [...element.childNodes].some(c =>
                c.nodeType === Node.TEXT_NODE && (c.textContent || '').trim());
            if (!hasText) return;
            const style = getComputedStyle(element);
            const match = style.color.match(/rgba?\(([^)]+)\)/);
            if (!match) return;
            const [r, g, b, a = '1'] = match[1].split(',').map(v => v.trim());
            const neutral = r === g && g === b;
            if ((neutral && r !== '255' && r !== '0') || Number(a) < 1 || Number(style.opacity) < 1) {
                offenders.push(`${element.className || element.tagName}: ${style.color}`);
            }
        });
        return offenders;
    });
    report.check(`no gray or translucent text on the page${grayText.length ? ' (' + grayText.slice(0, 4).join('; ') + ')' : ''}`,
        grayText.length === 0);

    report.check('wording.html stays free of console errors', pageErrors.length === 0);
    pageErrors.forEach(e => report.errors.push(e));

    await browser.close();
    report.finish();
})();
