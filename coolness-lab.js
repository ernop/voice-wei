// @ts-check
//-----------------------------------------------------------------------
// WORD LAB (deploys.html)
// UI glue for the word-coolness scorer. Loads coolness-config.json and
// the Python-generated coolness-report.json, scores typed words live
// with the browser engine (coolness-score.js), and lets the metric
// weights be tuned; weights and tried words persist on this device.
//-----------------------------------------------------------------------

const CoolnessLab = (function () {
    'use strict';

    const METRICS = [
        'pronounceability', 'flow', 'energy', 'phonesthemes',
        'novelty', 'anchors', 'brevity'
    ];
    const SHORT_LABELS = {
        pronounceability: 'Pron',
        flow: 'Flow',
        energy: 'Energy',
        phonesthemes: 'Phones',
        novelty: 'Novel',
        anchors: 'Anchor',
        brevity: 'Brev'
    };
    const WEIGHT_MAX = 3;

    /** @type {Record<string, any> | null} */
    let config = null;
    /** @type {Record<string, any> | null} */
    let report = null;
    /** @type {any} */
    let scorer = null;
    /** @type {Record<string, number>} */
    let weights = {};
    /** @type {string} */
    let formulaId = 'balanced';
    /** @type {string[]} */
    let triedWords = [];
    /** @type {string | null} */
    let featuredWord = null;
    /** @type {Array<{ text: string, form: string, source: string, score: number }>} */
    let combineResults = [];
    /** @type {{ a: Record<string, any>, b: Record<string, any> } | null} */
    let combineSets = null;
    let combineShown = 50;
    /** @type {number | undefined} */
    let combineRerankTimer;

    function el(id) {
        return document.getElementById(id);
    }

    async function fetchJson(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`${url}: HTTP ${response.status}`);
        }
        return response.json();
    }

    // ---- persisted state ------------------------------------------------

    function loadState() {
        weights = { ...config.weights };
        const stored = SettingsStore.loadJson(StorageKeys.COOLNESS_LAB, null);
        if (stored && typeof stored === 'object') {
            if (stored.weights && typeof stored.weights === 'object') {
                for (const name of METRICS) {
                    if (typeof stored.weights[name] === 'number') {
                        weights[name] = stored.weights[name];
                    }
                }
            }
            if (Array.isArray(stored.words)) {
                triedWords = stored.words.filter(w => typeof w === 'string' && w);
            }
            if (typeof stored.formulaId === 'string' && stored.formulaId) {
                formulaId = stored.formulaId;
            }
            const combineFields = {
                combineA: 'combineSetA',
                combineB: 'combineSetB',
                combineExpand: 'combineExpand',
                combineMode: 'combineMode'
            };
            for (const [key, id] of Object.entries(combineFields)) {
                if (typeof stored[key] === 'string' && stored[key]) {
                    const input = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (el(id));
                    if (input) input.value = stored[key];
                }
            }
        }
    }

    function saveState() {
        const field = (id) => {
            const input = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (el(id));
            return input ? input.value : '';
        };
        SettingsStore.saveJson(StorageKeys.COOLNESS_LAB, {
            weights,
            formulaId,
            words: triedWords,
            combineA: field('combineSetA'),
            combineB: field('combineSetB'),
            combineExpand: field('combineExpand'),
            combineMode: field('combineMode')
        });
    }

    // ---- weights UI ------------------------------------------------------

    function weightTitle(name) {
        const label = config.weightLabels[name] || name;
        const colon = label.indexOf(':');
        return colon === -1
            ? { short: label, long: label }
            : { short: label.slice(0, colon), long: label };
    }

    function renderWeights() {
        const host = el('wordLabWeights');
        if (!host) return;
        host.textContent = '';
        for (const name of METRICS) {
            const title = weightTitle(name);
            const wrap = document.createElement('div');
            wrap.className = 'word-lab-weight';
            wrap.title = title.long;

            const head = document.createElement('div');
            head.className = 'word-lab-weight-head';
            const label = document.createElement('span');
            label.textContent = title.short;
            const value = document.createElement('span');
            value.className = 'word-lab-weight-value';
            value.textContent = String(weights[name]);
            head.appendChild(label);
            head.appendChild(value);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = String(WEIGHT_MAX);
            slider.step = '0.05';
            slider.value = String(weights[name]);
            slider.setAttribute('aria-label', `Weight for ${title.short}`);
            slider.addEventListener('input', () => {
                weights[name] = Number(slider.value);
                value.textContent = String(weights[name]);
                formulaId = 'custom';
                syncFormulaUI();
                saveState();
                renderTable();
                renderFeatured();
                combineRerank(false);
            });

            wrap.appendChild(head);
            wrap.appendChild(slider);
            host.appendChild(wrap);
        }
    }

    function resetWeights() {
        weights = { ...config.weights };
        formulaId = 'balanced';
        syncFormulaUI();
        saveState();
        renderWeights();
        renderTable();
        renderFeatured();
        combineRerank(true);
    }

    // ---- formulas ---------------------------------------------------------

    function findFormula(id) {
        return config.formulas.find(f => f.id === id) || null;
    }

    function renderFormulaSelect() {
        const select = /** @type {HTMLSelectElement | null} */ (el('wordLabFormula'));
        if (!select) return;
        select.textContent = '';
        for (const formula of config.formulas) {
            const option = document.createElement('option');
            option.value = formula.id;
            option.textContent = formula.name;
            select.appendChild(option);
        }
        const custom = document.createElement('option');
        custom.value = 'custom';
        custom.textContent = 'Custom';
        select.appendChild(custom);
        select.addEventListener('change', () => {
            const formula = findFormula(select.value);
            if (!formula) return;
            formulaId = formula.id;
            weights = { ...formula.weights };
            syncFormulaUI();
            saveState();
            renderWeights();
            renderTable();
            renderFeatured();
            combineRerank(true);
        });
        syncFormulaUI();
    }

    function syncFormulaUI() {
        const select = /** @type {HTMLSelectElement | null} */ (el('wordLabFormula'));
        const note = el('wordLabFormulaNote');
        if (select) select.value = formulaId;
        if (note) {
            const formula = findFormula(formulaId);
            note.textContent = formula
                ? formula.note
                : 'Custom weights - move sliders freely, or pick a formula.';
        }
    }

    // ---- scoring context --------------------------------------------------
    // Persona formulas judge with their own anchor vocabulary, so rows are
    // always rescored live under the current formula's context.

    /** @type {Map<string, any>} */
    const anchorContextCache = new Map();

    function currentAnchorContext() {
        const formula = findFormula(formulaId);
        if (!formula || !formula.anchors) return undefined;
        if (!anchorContextCache.has(formula.id)) {
            anchorContextCache.set(formula.id, scorer.anchorContext(formula.anchors));
        }
        return anchorContextCache.get(formula.id);
    }

    function scoreLive(word) {
        return scorer.score(word, { weights, anchorContext: currentAnchorContext() });
    }

    // ---- leaderboard -----------------------------------------------------

    function allRows() {
        const sampleWords = new Set(report.words.map(row => row.word));
        const words = report.words.map(row => ({ word: row.word, tried: false }));
        for (const word of triedWords) {
            if (!sampleWords.has(word)) words.push({ word, tried: true });
        }
        const rows = words.map(({ word, tried }) => ({ ...scoreLive(word), tried }));
        rows.sort((a, b) => (b.total - a.total) || (a.word < b.word ? -1 : 1));
        return rows;
    }

    function renderTableHead() {
        const head = el('wordLabTableHead');
        if (!head) return;
        head.textContent = '';
        const tr = document.createElement('tr');
        for (const text of ['#', 'Word', 'Score', ...METRICS.map(m => SHORT_LABELS[m])]) {
            const th = document.createElement('th');
            th.textContent = text;
            tr.appendChild(th);
        }
        head.appendChild(tr);
    }

    function renderTable() {
        const body = el('wordLabTableBody');
        if (!body) return;
        body.textContent = '';
        allRows().forEach((row, index) => {
            const tr = document.createElement('tr');
            if (row.tried) tr.className = 'word-lab-row-user';
            const cells = [
                String(index + 1),
                row.word,
                row.total.toFixed(1),
                ...METRICS.map(m => row.metrics[m].toFixed(2))
            ];
            cells.forEach((text, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = text;
                if (cellIndex === 1) {
                    td.className = 'word-lab-word-cell';
                    td.title = `${row.tokens.join('-')} (${row.syllables} syllable${row.syllables === 1 ? '' : 's'})`;
                }
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    }

    // ---- featured word breakdown --------------------------------------------

    function renderFeatured() {
        const host = el('wordLabResult');
        if (!host) return;
        if (!featuredWord) {
            host.hidden = true;
            return;
        }
        const result = scoreLive(featuredWord);
        host.textContent = '';
        host.hidden = false;

        const title = document.createElement('div');
        title.className = 'word-lab-result-title';
        const wordSpan = document.createElement('span');
        wordSpan.textContent = result.word;
        const scoreSpan = document.createElement('span');
        scoreSpan.textContent = `${result.total.toFixed(1)}/100`;
        title.appendChild(wordSpan);
        title.appendChild(scoreSpan);
        host.appendChild(title);

        const detail = document.createElement('div');
        detail.className = 'word-lab-result-detail';
        detail.textContent = `sounds: ${result.tokens.join('-')}, `
            + `${result.syllables} syllable${result.syllables === 1 ? '' : 's'}`;
        host.appendChild(detail);

        for (const name of METRICS) {
            const value = result.metrics[name];
            const row = document.createElement('div');
            row.className = 'word-lab-metric';
            row.title = weightTitle(name).long;

            const label = document.createElement('span');
            label.textContent = weightTitle(name).short;
            const track = document.createElement('div');
            track.className = 'word-lab-bar-track';
            const bar = document.createElement('div');
            bar.className = 'word-lab-bar';
            bar.style.width = `${Math.round(value * 100)}%`;
            track.appendChild(bar);
            const amount = document.createElement('span');
            amount.className = 'word-lab-metric-value';
            amount.textContent = value.toFixed(2);

            row.appendChild(label);
            row.appendChild(track);
            row.appendChild(amount);
            host.appendChild(row);
        }
    }

    // ---- actions -----------------------------------------------------------

    function scoreInput() {
        const input = /** @type {HTMLInputElement | null} */ (el('wordLabInput'));
        if (!input) return;
        const words = input.value.split(/[\s,]+/)
            .map(word => scorer.clean(word))
            .filter(Boolean);
        if (!words.length) return;
        for (const word of words) {
            if (!triedWords.includes(word)) triedWords.push(word);
        }
        featuredWord = words[0];
        input.value = '';
        saveState();
        renderTable();
        renderFeatured();
    }

    function clearTriedWords() {
        triedWords = [];
        featuredWord = null;
        saveState();
        renderTable();
        renderFeatured();
    }

    // ---- combine two word sets --------------------------------------------

    function combineStatus(text) {
        const status = el('combineStatus');
        if (status) status.textContent = text;
    }

    async function updateLogCount() {
        const count = await CoolnessCombine.batchCount();
        const status = el('combineStatus');
        if (status && status.textContent) {
            status.textContent += ` Device log: ${count} batch${count === 1 ? '' : 'es'}.`;
        }
    }

    function combineMode() {
        const select = /** @type {HTMLSelectElement | null} */ (el('combineMode'));
        return /** @type {'phrase' | 'blend' | 'both'} */ (select ? select.value : 'both');
    }

    function rescoreCombine() {
        if (!combineSets) return [];
        return CoolnessCombine.crossProduct(
            combineSets.a.words, combineSets.b.words, combineMode(),
            scoreLive, CoolnessScore.roundPlaces);
    }

    async function runCombine() {
        const inputA = /** @type {HTMLInputElement | null} */ (el('combineSetA'));
        const inputB = /** @type {HTMLInputElement | null} */ (el('combineSetB'));
        const expandSelect = /** @type {HTMLSelectElement | null} */ (el('combineExpand'));
        if (!inputA || !inputB) return;
        const seedsA = CoolnessCombine.cleanWordList(inputA.value);
        const seedsB = CoolnessCombine.cleanWordList(inputB.value);
        if (!seedsA.length || !seedsB.length) {
            combineStatus('Both sets need at least one word.');
            return;
        }
        const expandBy = Number(expandSelect ? expandSelect.value : 0);
        saveState();
        try {
            let expandedA = [];
            let expandedB = [];
            if (expandBy > 0) {
                combineStatus(`Expanding both sets by up to ${expandBy} related words...`);
                [expandedA, expandedB] = await Promise.all([
                    CoolnessCombine.expandSet(seedsA, expandBy),
                    CoolnessCombine.expandSet(seedsB, expandBy)
                ]);
            }
            combineSets = {
                a: { label: 'set-a', seeds: seedsA, expanded: expandedA, words: seedsA.concat(expandedA) },
                b: { label: 'set-b', seeds: seedsB, expanded: expandedB, words: seedsB.concat(expandedB) }
            };
            combineResults = rescoreCombine();
            combineShown = 50;
            renderCombine();
            combineStatus(`${combineResults.length} candidates from `
                + `${combineSets.a.words.length} x ${combineSets.b.words.length} words`
                + (expandBy > 0 ? ` (expanded +${expandedA.length}/+${expandedB.length})` : '')
                + ` under ${formulaId}.`);
            await logCombineBatch();
            await updateLogCount();
        } catch (error) {
            combineStatus(error instanceof Error ? error.message : String(error));
        }
    }

    async function logCombineBatch() {
        if (!combineSets) return;
        await CoolnessCombine.logBatch({
            at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
            kind: 'combine-exhaustive',
            surface: 'browser',
            sets: combineSets,
            formula: formulaId,
            weights: { ...weights },
            mode: combineMode(),
            results: combineResults
        });
    }

    /** Rerank the existing cross product under the current formula/weights.
     * Discrete changes (formula switch) are logged; slider drags are not. */
    function combineRerank(log) {
        if (!combineSets) return;
        window.clearTimeout(combineRerankTimer);
        combineRerankTimer = window.setTimeout(() => {
            combineResults = rescoreCombine();
            renderCombine();
            combineStatus(`${combineResults.length} candidates re-ranked under ${formulaId}.`);
            if (log) {
                void logCombineBatch().then(updateLogCount);
            }
        }, log ? 0 : 150);
    }

    function renderCombine() {
        const head = el('combineTableHead');
        const body = el('combineTableBody');
        const moreBtn = el('combineMoreBtn');
        if (!head || !body) return;
        head.textContent = '';
        const tr = document.createElement('tr');
        for (const text of ['#', 'Candidate', 'Score', 'Form', 'From']) {
            const th = document.createElement('th');
            th.textContent = text;
            tr.appendChild(th);
        }
        head.appendChild(tr);

        body.textContent = '';
        combineResults.slice(0, combineShown).forEach((row, index) => {
            const line = document.createElement('tr');
            const cells = [String(index + 1), row.text, row.score.toFixed(1), row.form, row.source];
            cells.forEach((text, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = text;
                if (cellIndex === 1) td.className = 'word-lab-word-cell';
                line.appendChild(td);
            });
            body.appendChild(line);
        });
        if (moreBtn) {
            moreBtn.hidden = combineResults.length <= combineShown;
            moreBtn.textContent = `Show 100 more (${combineResults.length - Math.min(combineShown, combineResults.length)} hidden)`;
        }
    }

    async function exportDeviceLog() {
        const text = await CoolnessCombine.exportJsonl();
        const blob = new Blob([text], { type: 'application/jsonl' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'coolness-device-log.jsonl';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // ---- status line ----------------------------------------------------------

    function renderStatus() {
        const status = el('wordLabStatus');
        if (!status) return;
        const total = report.words.length;
        let matching = 0;
        for (const row of report.words) {
            const live = scorer.score(row.word);
            if (scorer.totalFromMetrics(live.metrics, report.weights) === row.total) {
                matching += 1;
            }
        }
        const parity = matching === total
            ? `browser engine matches all ${total} report words`
            : `ENGINE MISMATCH: browser agrees on only ${matching}/${total} report words`;
        status.textContent = `Report by coolness.py at ${report.generatedAt}; ${parity}. `
            + 'Regenerate with: python3 coolness.py --report';
    }

    // ---- init ----------------------------------------------------------------

    async function init() {
        if (!el('wordLabPanel')) return;
        const version = window.AppVersion ? window.AppVersion.current : '0';
        try {
            const [configData, reportData] = await Promise.all([
                fetchJson(`coolness-config.json?v=${version}`),
                fetchJson(`coolness-report.json?v=${version}`)
            ]);
            config = configData;
            report = reportData;
            scorer = CoolnessScore.createScorer(config);
        } catch (error) {
            const status = el('wordLabStatus');
            if (status) {
                status.textContent = error instanceof Error ? error.message : String(error);
            }
            return;
        }

        loadState();
        el('wordLabScoreBtn')?.addEventListener('click', scoreInput);
        el('wordLabInput')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') scoreInput();
        });
        el('wordLabClearBtn')?.addEventListener('click', clearTriedWords);
        el('wordLabResetBtn')?.addEventListener('click', resetWeights);
        el('combineRunBtn')?.addEventListener('click', () => void runCombine());
        el('combineExportBtn')?.addEventListener('click', () => void exportDeviceLog());
        el('combineMoreBtn')?.addEventListener('click', () => {
            combineShown += 100;
            renderCombine();
        });
        for (const id of ['combineSetA', 'combineSetB']) {
            el(id)?.addEventListener('keydown', event => {
                if (event.key === 'Enter') void runCombine();
            });
        }

        renderFormulaSelect();
        renderWeights();
        renderTableHead();
        renderTable();
        renderFeatured();
        renderStatus();
    }

    return { init };
})();

void CoolnessLab.init();
