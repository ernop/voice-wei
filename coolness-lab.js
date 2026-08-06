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
    /** @type {string[]} */
    let triedWords = [];
    /** @type {string | null} */
    let featuredWord = null;

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
        }
    }

    function saveState() {
        SettingsStore.saveJson(StorageKeys.COOLNESS_LAB, {
            weights,
            words: triedWords
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
                saveState();
                renderTable();
                renderFeatured();
            });

            wrap.appendChild(head);
            wrap.appendChild(slider);
            host.appendChild(wrap);
        }
    }

    function resetWeights() {
        weights = { ...config.weights };
        saveState();
        renderWeights();
        renderTable();
        renderFeatured();
    }

    // ---- leaderboard -----------------------------------------------------

    function allRows() {
        const sampleWords = new Set(report.words.map(row => row.word));
        const rows = report.words.map(row => ({ ...row, tried: false }));
        for (const word of triedWords) {
            if (sampleWords.has(word)) continue;
            rows.push({ ...scorer.score(word), tried: true });
        }
        for (const row of rows) {
            row.liveTotal = scorer.totalFromMetrics(row.metrics, weights);
        }
        rows.sort((a, b) => (b.liveTotal - a.liveTotal) || (a.word < b.word ? -1 : 1));
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
                row.liveTotal.toFixed(1),
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
        const result = scorer.score(featuredWord);
        const total = scorer.totalFromMetrics(result.metrics, weights);
        host.textContent = '';
        host.hidden = false;

        const title = document.createElement('div');
        title.className = 'word-lab-result-title';
        const wordSpan = document.createElement('span');
        wordSpan.textContent = result.word;
        const scoreSpan = document.createElement('span');
        scoreSpan.textContent = `${total.toFixed(1)}/100`;
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

        renderWeights();
        renderTableHead();
        renderTable();
        renderFeatured();
        renderStatus();
    }

    return { init };
})();

void CoolnessLab.init();
