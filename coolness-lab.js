// @ts-check
//-----------------------------------------------------------------------
// WORD LAB (wording.html)
// UI glue for the word-coolness scorer. Loads coolness-config.json and
// the Python-generated coolness-report.json, scores words live with the
// browser engine (coolness-score.js), measures how well the current
// formula orders the config's sample tiers, and runs the two-set word
// combiner (coolness-combine.js). Weights, typed words, and combine
// inputs persist on this device.
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
    const WEIGHT_NOTCH = 0.5;
    const TRIED_TIER = 'yours';
    const COMBINE_PAGE = 50;
    const COMBINE_MORE = 100;

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
    /** Typed words, stored with their hyphen joints (vibe-code). @type {string[]} */
    let triedWords = [];
    /** @type {string | null} */
    let featuredWord = null;
    /** @type {CombineRow[]} */
    let combineResults = [];
    /** @type {{ a: Record<string, any>, b: Record<string, any> } | null} */
    let combineSets = null;
    let combineShown = COMBINE_PAGE;
    let combineDroppedReal = 0;
    /** @type {number | undefined} */
    let combineRerankTimer;
    /** @type {Set<string> | null} */
    let realWords = null;

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

    /** @param {string} tag @param {string} [className] @param {string} [text] */
    function make(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function showError(text) {
        const box = el('wordLabError');
        if (!box) return;
        box.textContent = text;
        box.hidden = false;
    }

    // ---- persisted state ------------------------------------------------

    function loadState() {
        weights = { ...config.weights };
        const stored = SettingsStore.loadJson(StorageKeys.COOLNESS_LAB, null);
        if (!stored || typeof stored !== 'object') return;
        if (stored.weights && typeof stored.weights === 'object') {
            for (const name of METRICS) {
                if (typeof stored.weights[name] === 'number') {
                    weights[name] = stored.weights[name];
                }
            }
        }
        if (Array.isArray(stored.words)) {
            triedWords = stored.words
                .filter(w => typeof w === 'string')
                .map(w => scorer.partsOf(w).join('-'))
                .filter(Boolean);
        }
        if (typeof stored.formulaId === 'string'
            && (stored.formulaId === 'custom' || findFormula(stored.formulaId))) {
            formulaId = stored.formulaId;
        }
        const combineFields = {
            combineA: 'combineSetA',
            combineB: 'combineSetB',
            combineExpand: 'combineExpand'
        };
        for (const [key, id] of Object.entries(combineFields)) {
            if (typeof stored[key] === 'string' && stored[key]) {
                const input = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (el(id));
                if (input) input.value = stored[key];
            }
        }
        if (typeof stored.combineGroupBest === 'boolean') {
            const check = /** @type {HTMLInputElement | null} */ (el('combineGroupBest'));
            if (check) check.checked = stored.combineGroupBest;
        }
    }

    function saveState() {
        const field = (id) => {
            const input = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (el(id));
            return input ? input.value : '';
        };
        const groupCheck = /** @type {HTMLInputElement | null} */ (el('combineGroupBest'));
        SettingsStore.saveJson(StorageKeys.COOLNESS_LAB, {
            weights,
            formulaId,
            words: triedWords,
            combineA: field('combineSetA'),
            combineB: field('combineSetB'),
            combineExpand: field('combineExpand'),
            combineGroupBest: groupCheck ? groupCheck.checked : true
        });
    }

    // ---- formulas -----------------------------------------------------------

    function findFormula(id) {
        return config.formulas.find(f => f.id === id) || null;
    }

    function formulaName() {
        const formula = findFormula(formulaId);
        return formula ? formula.name : 'Custom';
    }

    function renderFormulaSelect() {
        const select = /** @type {HTMLSelectElement | null} */ (el('wordLabFormula'));
        if (!select) return;
        select.textContent = '';
        for (const formula of config.formulas) {
            const option = make('option', '', formula.name);
            /** @type {HTMLOptionElement} */ (option).value = formula.id;
            select.appendChild(option);
        }
        const custom = make('option', '', 'Custom');
        /** @type {HTMLOptionElement} */ (custom).value = 'custom';
        select.appendChild(custom);
        select.addEventListener('change', () => {
            const formula = findFormula(select.value);
            if (!formula) {
                formulaId = 'custom';
            } else {
                formulaId = formula.id;
                weights = { ...formula.weights };
            }
            syncFormulaUI();
            saveState();
            renderWeights();
            refreshScores(true);
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
                : 'Custom weights: move the sliders freely, or pick a formula.';
        }
    }

    // ---- weights ------------------------------------------------------------

    function weightTitle(name) {
        const label = config.weightLabels[name] || name;
        const colon = label.indexOf(':');
        return colon === -1
            ? { short: label, long: label }
            : { short: label.slice(0, colon), long: label };
    }

    /** A notched scale under each slider: marks every half step, labels whole numbers. */
    function renderScale() {
        const scale = make('div', 'wording-scale');
        scale.setAttribute('aria-hidden', 'true');
        for (let at = 0; at <= WEIGHT_MAX + 1e-9; at += WEIGHT_NOTCH) {
            const whole = Math.abs(at - Math.round(at)) < 1e-9;
            const notch = make('span', whole ? 'wording-notch is-labeled' : 'wording-notch',
                whole ? String(Math.round(at)) : '');
            notch.style.setProperty('--at', String(at / WEIGHT_MAX));
            scale.appendChild(notch);
        }
        return scale;
    }

    function renderWeights() {
        const host = el('wordLabWeights');
        if (!host) return;
        host.textContent = '';
        for (const name of METRICS) {
            const title = weightTitle(name);
            const wrap = make('div', 'wording-weight');
            wrap.title = title.long;

            const head = make('div', 'wording-weight-head');
            head.appendChild(make('span', 'wording-weight-label', title.short));
            const value = make('span', 'wording-weight-value', weights[name].toFixed(2));
            head.appendChild(value);

            const slider = /** @type {HTMLInputElement} */ (make('input'));
            slider.type = 'range';
            slider.min = '0';
            slider.max = String(WEIGHT_MAX);
            slider.step = '0.05';
            slider.value = String(weights[name]);
            slider.dataset.metric = name;
            slider.setAttribute('aria-label', `Weight for ${title.short}`);
            slider.addEventListener('input', () => {
                weights[name] = Number(slider.value);
                value.textContent = weights[name].toFixed(2);
                formulaId = 'custom';
                syncFormulaUI();
                saveState();
                refreshScores(false);
            });

            wrap.appendChild(head);
            wrap.appendChild(slider);
            wrap.appendChild(renderScale());
            host.appendChild(wrap);
        }
    }

    function resetWeights() {
        weights = { ...config.weights };
        formulaId = 'balanced';
        syncFormulaUI();
        saveState();
        renderWeights();
        refreshScores(true);
    }

    // ---- scoring context ----------------------------------------------------
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

    /** @param {string} word may carry hyphen joints @returns {CoolnessResult} */
    function scoreLive(word) {
        return scorer.score(word, { weights, anchorContext: currentAnchorContext() });
    }

    /**
     * Share of word pairs from differently ranked sample tiers that the
     * totals order correctly (ties are misses), plus each tier's mean.
     * Same rule as coolness.py calibration().
     * @param {Map<string, number>} totals
     */
    function calibration(totals) {
        const round = CoolnessScore.roundPlaces;
        const tiers = config.sampleTiers;
        let good = 0;
        let pairs = 0;
        for (const upper of tiers) {
            for (const lower of tiers) {
                if (upper.rank >= lower.rank) continue;
                for (const a of upper.words) {
                    for (const b of lower.words) {
                        pairs += 1;
                        if (totals.get(a) > totals.get(b)) good += 1;
                    }
                }
            }
        }
        /** @type {Array<{ id: string, mean: number }>} */
        const means = tiers.map(tier => ({
            id: tier.id,
            mean: round(tier.words.reduce((sum, w) => sum + totals.get(w), 0) / tier.words.length, 1)
        }));
        return { pairAccuracy: round(good / pairs, 4), means };
    }

    // ---- leaderboard ----------------------------------------------------------

    /** @returns {Array<CoolnessResult & { tier: string, input: string }>} */
    function allRows() {
        /** @type {Array<{ input: string, tier: string }>} */
        const entries = [];
        const sampled = new Set();
        for (const tier of config.sampleTiers) {
            for (const word of tier.words) {
                entries.push({ input: word, tier: tier.id });
                sampled.add(word);
            }
        }
        for (const word of triedWords) {
            if (!sampled.has(word.replace(/-/g, ''))) entries.push({ input: word, tier: TRIED_TIER });
        }
        const rows = entries.map(({ input, tier }) => ({ ...scoreLive(input), tier, input }));
        rows.sort((a, b) => (b.total - a.total) || (a.word < b.word ? -1 : 1));
        return rows;
    }

    function renderTableHead() {
        const head = el('wordLabTableHead');
        if (!head) return;
        head.textContent = '';
        const tr = make('tr');
        for (const [text, className] of [['#', 'wording-rank'], ['Word', ''], ['Tier', ''], ['Score', 'wording-score']]) {
            tr.appendChild(make('th', className, text));
        }
        for (const name of METRICS) {
            const th = make('th', 'wording-metric-col', SHORT_LABELS[name]);
            th.title = weightTitle(name).long;
            tr.appendChild(th);
        }
        head.appendChild(tr);
    }

    function renderTable() {
        const body = el('wordLabTableBody');
        if (!body) return;
        body.textContent = '';
        const rows = allRows();
        rows.forEach((row, index) => {
            const tr = make('tr');
            tr.dataset.tier = row.tier;
            if (row.tier === TRIED_TIER) tr.classList.add('wording-row-user');
            tr.appendChild(make('td', 'wording-rank', String(index + 1)));
            const wordCell = make('td', 'wording-word', row.word);
            wordCell.title = `${row.tokens.join('-')} (${row.syllables} syllable${row.syllables === 1 ? '' : 's'})`;
            tr.appendChild(wordCell);
            tr.appendChild(make('td', 'wording-tier', row.tier));
            tr.appendChild(make('td', 'wording-score', row.total.toFixed(1)));
            for (const name of METRICS) {
                const td = make('td', 'wording-metric-col', row.metrics[name].toFixed(2));
                td.dataset.metric = name;
                tr.appendChild(td);
            }
            tr.addEventListener('click', () => featureWord(row.input));
            body.appendChild(tr);
        });
        renderCalibration(rows);
    }

    /** @param {Array<CoolnessResult & { tier: string }>} rows */
    function renderCalibration(rows) {
        const status = el('wordLabStatus');
        if (!status) return;
        /** @type {Map<string, number>} */
        const totals = new Map();
        for (const row of rows) {
            if (row.tier !== TRIED_TIER) totals.set(row.word, row.total);
        }
        const result = calibration(totals);
        status.textContent = '';
        status.dataset.accuracy = String(result.pairAccuracy);
        const lead = make('span', 'wording-calibration-lead');
        lead.appendChild(make('span', 'wording-calibration-label', 'Tier order'));
        lead.appendChild(make('span', 'wording-calibration-value',
            `${(result.pairAccuracy * 100).toFixed(1)}%`));
        lead.title = 'Share of sample-word pairs from differently ranked tiers '
            + '(cool and coined > bland > gross > junk) that this formula orders correctly';
        status.appendChild(lead);
        for (const { id, mean } of result.means) {
            const item = make('span', 'wording-calibration-tier');
            item.appendChild(make('span', 'wording-calibration-label', id));
            item.appendChild(make('span', 'wording-calibration-value', mean.toFixed(1)));
            status.appendChild(item);
        }
        status.appendChild(make('span', 'wording-calibration-label', `under ${formulaName()}`));
    }

    // ---- featured word breakdown ------------------------------------------------

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

        const title = make('div', 'wording-featured-title');
        title.appendChild(make('span', 'wording-featured-word', result.word));
        title.appendChild(make('span', 'wording-featured-score', result.total.toFixed(1)));
        host.appendChild(title);

        const gate = scorer.legalityGate(result.metrics);
        const joint = result.parts.length > 1 ? `${result.parts.join(' + ')}: ` : '';
        host.appendChild(make('div', 'wording-featured-detail',
            `${joint}${result.tokens.join('-')}, `
            + `${result.syllables} syllable${result.syllables === 1 ? '' : 's'}, `
            + `legality x${gate.toFixed(2)}`));

        for (const name of METRICS) {
            const value = result.metrics[name];
            const row = make('div', 'wording-metric');
            row.title = weightTitle(name).long;
            row.appendChild(make('span', 'wording-metric-label', weightTitle(name).short));
            const track = make('div', 'wording-bar-track');
            const bar = make('div', 'wording-bar');
            bar.style.width = `${Math.round(value * 100)}%`;
            track.appendChild(bar);
            row.appendChild(track);
            row.appendChild(make('span', 'wording-metric-value', value.toFixed(2)));
            host.appendChild(row);
        }
    }

    /** Tap any ranked word to see its full metric breakdown up top. @param {string} input */
    function featureWord(input) {
        featuredWord = input;
        renderFeatured();
        el('wordLabResult')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // ---- typed words ----------------------------------------------------------

    function scoreInput() {
        const input = /** @type {HTMLInputElement | null} */ (el('wordLabInput'));
        if (!input) return;
        const words = input.value.split(/[\s,]+/)
            .map(word => scorer.partsOf(word).join('-'))
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

    // ---- combine two word sets --------------------------------------------------

    function combineStatus(text) {
        const status = el('combineStatus');
        if (status) status.textContent = text;
    }

    async function appendLogCount() {
        const count = await CoolnessCombine.batchCount();
        const status = el('combineStatus');
        if (status && status.textContent) {
            status.textContent += ` Device log: ${count} batch${count === 1 ? '' : 'es'}.`;
        }
    }

    /** The real-English filter list, fetched once on first combine. */
    async function ensureRealWords() {
        if (realWords) return realWords;
        const version = window.AppVersion ? window.AppVersion.current : '0';
        const data = await fetchJson(`coolness-wordlist.json?v=${version}`);
        realWords = new Set(data.words);
        return realWords;
    }

    function rescoreCombine() {
        if (!combineSets || !realWords) return [];
        const { results, droppedReal } = CoolnessCombine.crossProduct(
            combineSets.a.words, combineSets.b.words, realWords, scoreLive);
        combineDroppedReal = droppedReal;
        return results;
    }

    async function runCombine() {
        const inputA = /** @type {HTMLInputElement | null} */ (el('combineSetA'));
        const inputB = /** @type {HTMLInputElement | null} */ (el('combineSetB'));
        const expandSelect = /** @type {HTMLSelectElement | null} */ (el('combineExpand'));
        const runBtn = /** @type {HTMLButtonElement | null} */ (el('combineRunBtn'));
        if (!inputA || !inputB) return;
        const seedsA = CoolnessCombine.cleanWordList(inputA.value);
        const seedsB = CoolnessCombine.cleanWordList(inputB.value);
        if (!seedsA.length || !seedsB.length) {
            combineStatus('Both sets need at least one word.');
            return;
        }
        const expandBy = Number(expandSelect ? expandSelect.value : 0);
        saveState();
        if (runBtn) runBtn.disabled = true;
        try {
            await ensureRealWords();
            let expandedA = [];
            let expandedB = [];
            if (expandBy > 0) {
                combineStatus(`Finding up to ${expandBy} related words per set...`);
                [expandedA, expandedB] = await Promise.all([
                    CoolnessCombine.expandSet(seedsA, expandBy),
                    CoolnessCombine.expandSet(seedsB, expandBy)
                ]);
            }
            // Same set construction as the Python combiner: seeds, their
            // inflected forms (run -> running), then Datamuse expansion.
            const inflectedA = CoolnessCombine.inflectSet(seedsA, config.inflections);
            const inflectedB = CoolnessCombine.inflectSet(seedsB, config.inflections);
            combineSets = {
                a: {
                    label: 'set-a', seeds: seedsA, inflected: inflectedA,
                    expanded: expandedA, words: seedsA.concat(inflectedA, expandedA)
                },
                b: {
                    label: 'set-b', seeds: seedsB, inflected: inflectedB,
                    expanded: expandedB, words: seedsB.concat(inflectedB, expandedB)
                }
            };
            combineResults = rescoreCombine();
            combineShown = COMBINE_PAGE;
            renderCombine();
            combineStatus(`${combineResults.length} new words from `
                + `${combineSets.a.words.length} x ${combineSets.b.words.length} words`
                + (expandBy > 0 ? ` (+${expandedA.length} / +${expandedB.length} related)` : '')
                + `, ${combineDroppedReal} real words dropped, ranked under ${formulaName()}.`);
            // On phones the results land below the fold; bring them into view.
            el('combineStatus')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            await logCombineBatch();
            await appendLogCount();
        } catch (error) {
            combineStatus(error instanceof Error ? error.message : String(error));
            el('combineStatus')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } finally {
            if (runBtn) runBtn.disabled = false;
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
            droppedRealWords: combineDroppedReal,
            results: combineResults
        });
    }

    /**
     * Rerank the existing cross product under the current formula/weights.
     * Discrete changes (formula switch, reset) are logged; slider drags are
     * debounced and not logged.
     * @param {boolean} log
     */
    function combineRerank(log) {
        if (!combineSets) return;
        window.clearTimeout(combineRerankTimer);
        combineRerankTimer = window.setTimeout(() => {
            combineResults = rescoreCombine();
            renderCombine();
            combineStatus(`${combineResults.length} new words re-ranked under ${formulaName()}.`);
            if (log) {
                void logCombineBatch().then(appendLogCount);
            }
        }, log ? 0 : 150);
    }

    /** Everything that depends on weights or formula, redrawn together. @param {boolean} log */
    function refreshScores(log) {
        renderTable();
        renderFeatured();
        combineRerank(log);
    }

    /**
     * Rows for display. With "Best per pair" on, the first (= best,
     * results are sorted) variant of each source pair represents it and
     * the rest fold into a variants count. The full list is always what
     * gets logged.
     */
    function combineDisplayRows() {
        const group = /** @type {HTMLInputElement | null} */ (el('combineGroupBest'));
        if (!group || !group.checked) {
            return combineResults.map(row => ({ row, variants: 0 }));
        }
        /** @type {Map<string, { row: CombineRow, variants: number }>} */
        const bySource = new Map();
        for (const row of combineResults) {
            const kept = bySource.get(row.source);
            if (kept) kept.variants += 1;
            else bySource.set(row.source, { row, variants: 0 });
        }
        return [...bySource.values()];
    }

    function renderCombine() {
        const head = el('combineTableHead');
        const body = el('combineTableBody');
        const moreBtn = el('combineMoreBtn');
        if (!head || !body) return;
        head.textContent = '';
        const tr = make('tr');
        for (const [text, className] of [['#', 'wording-rank'], ['New word', ''], ['Score', 'wording-score'], ['Made from', '']]) {
            tr.appendChild(make('th', className, text));
        }
        head.appendChild(tr);

        const rows = combineDisplayRows();
        body.textContent = '';
        rows.slice(0, combineShown).forEach(({ row, variants }, index) => {
            const line = make('tr');
            line.appendChild(make('td', 'wording-rank', String(index + 1)));
            line.appendChild(make('td', 'wording-word', row.text));
            line.appendChild(make('td', 'wording-score', row.score.toFixed(1)));
            const extra = variants > 0 ? `, +${variants} variant${variants === 1 ? '' : 's'}` : '';
            line.appendChild(make('td', 'wording-source', `${row.source} (${row.strategy}${extra})`));
            line.addEventListener('click', () => featureWord(row.parts.join('-')));
            body.appendChild(line);
        });
        if (moreBtn) {
            const hidden = Math.max(0, rows.length - combineShown);
            moreBtn.hidden = hidden === 0;
            moreBtn.textContent = `Show ${Math.min(COMBINE_MORE, hidden)} more (${hidden} hidden)`;
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

    // ---- engine parity ----------------------------------------------------------

    /** The browser engine must reproduce the Python report exactly; say so loudly if not. */
    function checkParity() {
        let matching = 0;
        for (const row of report.words) {
            if (scorer.score(row.word).total === row.total) matching += 1;
        }
        if (matching !== report.words.length) {
            showError(`Engine mismatch: the browser scorer agrees with coolness.py on only `
                + `${matching} of ${report.words.length} report words. `
                + 'Regenerate with python3 coolness.py --report.');
        }
    }

    // ---- init ---------------------------------------------------------------------

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
            if (status) status.textContent = '';
            showError(error instanceof Error ? error.message : String(error));
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
            combineShown += COMBINE_MORE;
            renderCombine();
        });
        el('combineGroupBest')?.addEventListener('change', () => {
            combineShown = COMBINE_PAGE;
            saveState();
            renderCombine();
        });
        el('combineExpand')?.addEventListener('change', saveState);
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
        checkParity();
    }

    return { init };
})();

void CoolnessLab.init();
