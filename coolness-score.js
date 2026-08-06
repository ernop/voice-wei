// @ts-check
//-----------------------------------------------------------------------
// WORD COOLNESS SCORER - browser mirror
// Exact port of the canonical Python engine (coolness.py); both read
// coolness-config.json and tests/test-coolness.js keeps them in lockstep
// against coolness-report.json. Any algorithm change must be made in
// both files. Metric definitions are documented in coolness.py.
//-----------------------------------------------------------------------

const CoolnessScore = (function () {
    'use strict';

    const SONORITY_CLASSES = {
        plosives: 1,
        affricates: 2,
        fricatives: 3,
        nasals: 4,
        liquids: 5,
        glides: 6
    };
    const VOWEL_SONORITY = 7;
    const MAX_ONSET_LEN = 3;

    /** Half-up rounding, identical to coolness.py round_places(). */
    function roundPlaces(value, places) {
        const factor = Math.pow(10, places);
        return Math.floor(value * factor + 0.5) / factor;
    }

    /** @param {Record<string, any>} config */
    function createScorer(config) {
        const digraphs = config.tokenizer.digraphs;
        const singles = config.tokenizer.singles;
        const softC = new Set(config.tokenizer.softCTriggers);
        const vowels = new Set(config.vowels);
        const legalOnsets = new Set(config.legalOnsets);
        const illegalSingleOnsets = new Set(config.illegalSingleOnsets);
        const legalCodas = new Set(config.legalCodas);
        const illegalSingleCodas = new Set(config.illegalSingleCodas);

        /** @type {Map<string, number>} */
        const sonority = new Map();
        for (const [className, value] of Object.entries(SONORITY_CLASSES)) {
            for (const token of config.sonorityClasses[className]) {
                sonority.set(token, value);
            }
        }
        for (const vowel of config.vowels) {
            sonority.set(vowel, VOWEL_SONORITY);
        }

        function sonorityOf(token) {
            const value = sonority.get(token);
            if (value === undefined) {
                throw new Error(`coolness: token "${token}" has no sonority class in config`);
            }
            return value;
        }

        // ---- tokenizer -----------------------------------------------

        function clean(word) {
            return String(word).toLowerCase().replace(/[^a-z]/g, '');
        }

        /** @param {string} letters @returns {string[]} */
        function tokenize(letters) {
            /** @type {string[]} */
            const tokens = [];
            const emit = (token) => {
                // Doubled consonants ("bubble", "jazz") are one sound.
                if (tokens.length && tokens[tokens.length - 1] === token && !vowels.has(token)) return;
                tokens.push(token);
            };

            let i = 0;
            const n = letters.length;
            while (i < n) {
                const two = letters.slice(i, i + 2);
                if (two === 'gh') {
                    // Hard g word-initially (ghost); silent elsewhere (night).
                    if (i === 0) emit('g');
                    i += 2;
                    continue;
                }
                if (two.length === 2 && Object.prototype.hasOwnProperty.call(digraphs, two)) {
                    for (const token of digraphs[two]) emit(token);
                    i += 2;
                    continue;
                }
                const ch = letters[i];
                if (ch === 'c') {
                    const soft = i + 1 < n && softC.has(letters[i + 1]);
                    emit(soft ? 's' : 'k');
                    i += 1;
                    continue;
                }
                if (Object.prototype.hasOwnProperty.call(singles, ch)) {
                    for (const token of singles[ch]) emit(token);
                    i += 1;
                    continue;
                }
                emit(ch);
                i += 1;
            }

            // Final silent e (vibe, blaze) - unless it makes a syllabic-l
            // syllable (table, bubble) or is the only vowel (the).
            if (tokens.length >= 2 && tokens[tokens.length - 1] === 'e'
                && !isVowel(tokens[tokens.length - 2], tokens.length - 2)) {
                const rest = tokens.slice(0, -1);
                const hasVowel = rest.some((t, idx) => isVowel(t, idx));
                const syllabicL = tokens.length >= 3 && tokens[tokens.length - 2] === 'l'
                    && !isVowel(tokens[tokens.length - 3], tokens.length - 3);
                if (hasVowel && !syllabicL) return rest;
            }
            return tokens;
        }

        function isVowel(token, index) {
            if (vowels.has(token)) return true;
            return token === 'y' && index > 0;
        }

        // ---- syllabification ------------------------------------------

        /**
         * @param {string[]} tokens
         * @returns {Array<{ onset: string[], nucleus: string[], coda: string[] }>}
         */
        function syllabify(tokens) {
            const flags = tokens.map((t, i) => isVowel(t, i));
            if (!flags.some(Boolean)) {
                return [{ onset: tokens.slice(), nucleus: [], coda: [] }];
            }

            /** @type {Array<[number, number]>} */
            const nuclei = [];
            let i = 0;
            while (i < tokens.length) {
                if (flags[i]) {
                    const start = i;
                    while (i < tokens.length && flags[i]) i += 1;
                    nuclei.push([start, i - 1]);
                } else {
                    i += 1;
                }
            }

            const syllables = nuclei.map(([start, end], k) => ({
                onset: k === 0 ? tokens.slice(0, start) : [],
                nucleus: tokens.slice(start, end + 1),
                coda: k === nuclei.length - 1 ? tokens.slice(end + 1) : []
            }));

            // Maximal onset: between two nuclei, the next syllable takes the
            // longest legal onset; the rest stays as the previous coda.
            for (let k = 0; k < nuclei.length - 1; k++) {
                const gap = tokens.slice(nuclei[k][1] + 1, nuclei[k + 1][0]);
                let take = 0;
                for (let j = Math.min(gap.length, MAX_ONSET_LEN); j > 0; j--) {
                    if (onsetLegal(gap.slice(gap.length - j))) {
                        take = j;
                        break;
                    }
                }
                syllables[k].coda = gap.slice(0, gap.length - take);
                syllables[k + 1].onset = gap.slice(gap.length - take);
            }
            return syllables;
        }

        /** @param {string[]} seq */
        function onsetLegal(seq) {
            if (seq.length === 1) return !illegalSingleOnsets.has(seq[0]);
            return legalOnsets.has(seq.join(''));
        }

        /** @param {string[]} seq */
        function codaLegal(seq) {
            if (seq.length === 1) return !illegalSingleCodas.has(seq[0]);
            return legalCodas.has(seq.join(''));
        }

        // ---- bigram model (novelty) -------------------------------------

        /** @type {Map<string, number>} */
        const bigramCounts = new Map();
        let bigramTotal = 0;
        const seenTokens = new Set();
        for (const word of config.referenceLexicon) {
            const tokens = tokenize(clean(word));
            tokens.forEach(t => seenTokens.add(t));
            for (let k = 0; k < tokens.length - 1; k++) {
                const key = tokens[k] + '|' + tokens[k + 1];
                bigramCounts.set(key, (bigramCounts.get(key) || 0) + 1);
                bigramTotal += 1;
            }
        }
        const bigramVocab = seenTokens.size * seenTokens.size;

        function rarity(a, b) {
            const count = bigramCounts.get(a + '|' + b) || 0;
            const p = (count + 0.5) / (bigramTotal + 0.5 * bigramVocab);
            return -Math.log(p);
        }

        // ---- anchor similarity -------------------------------------------

        /** @param {string} letters @returns {Set<string>} */
        function charBigrams(letters) {
            const padded = '^' + letters + '$';
            const grams = new Set();
            for (let k = 0; k < padded.length - 1; k++) {
                grams.add(padded.slice(k, k + 2));
            }
            return grams;
        }

        /** @param {Set<string>} a @param {Set<string>} b */
        function dice(a, b) {
            if (a.size === 0 || b.size === 0) return 0;
            let shared = 0;
            for (const gram of a) {
                if (b.has(gram)) shared += 1;
            }
            return 2 * shared / (a.size + b.size);
        }

        const coolGrams = config.anchors.cool.map(w => charBigrams(clean(w)));
        const uncoolGrams = config.anchors.uncool.map(w => charBigrams(clean(w)));

        // ---- metrics -------------------------------------------------------

        function metricPronounceability(syllables, hasVowel) {
            if (!hasVowel) return 0;
            /** @type {boolean[]} */
            const checks = [];
            for (const syllable of syllables) {
                if (syllable.onset.length) checks.push(onsetLegal(syllable.onset));
                if (syllable.coda.length) checks.push(codaLegal(syllable.coda));
            }
            if (!checks.length) return 1;
            return checks.filter(Boolean).length / checks.length;
        }

        function metricFlow(syllables, hasVowel) {
            if (!hasVowel) return 0;
            let good = 0;
            let transitions = 0;
            for (const syllable of syllables) {
                const rising = syllable.onset.concat(syllable.nucleus.slice(0, 1));
                for (let k = 0; k < rising.length - 1; k++) {
                    transitions += 1;
                    if (sonorityOf(rising[k]) <= sonorityOf(rising[k + 1])) good += 1;
                }
                const falling = syllable.nucleus.slice(-1).concat(syllable.coda);
                for (let k = 0; k < falling.length - 1; k++) {
                    transitions += 1;
                    if (sonorityOf(falling[k]) >= sonorityOf(falling[k + 1])) good += 1;
                }
            }
            if (transitions === 0) return config.flowNoTransitionScore;
            return good / transitions;
        }

        /** @param {string[]} tokens */
        function metricEnergy(tokens) {
            if (!tokens.length) return 0;
            const values = config.energy.values;
            let total = 0;
            for (const token of tokens) {
                total += Object.prototype.hasOwnProperty.call(values, token)
                    ? values[token] : config.energy.default;
            }
            return total / tokens.length;
        }

        /** @param {string} letters */
        function metricPhonesthemes(letters) {
            let score = 0;
            for (const entry of config.phonesthemes) {
                const matched =
                    (entry.position === 'start' && letters.startsWith(entry.pattern))
                    || (entry.position === 'end' && letters.endsWith(entry.pattern))
                    || (entry.position === 'any' && letters.includes(entry.pattern));
                if (matched) score += entry.value;
            }
            score = Math.max(-1, Math.min(1, score));
            return (score + 1) / 2;
        }

        /** @param {string[]} tokens */
        function metricNovelty(tokens) {
            if (tokens.length < 2) return config.novelty.shortWordScore;
            const peak = config.novelty.peakRarity;
            const width = config.novelty.width;
            let total = 0;
            for (let k = 0; k < tokens.length - 1; k++) {
                const r = rarity(tokens[k], tokens[k + 1]);
                total += Math.max(0, 1 - Math.abs(r - peak) / width);
            }
            return total / (tokens.length - 1);
        }

        /** @param {string} letters */
        function metricAnchors(letters) {
            const grams = charBigrams(letters);
            let cool = 0;
            for (const g of coolGrams) cool = Math.max(cool, dice(grams, g));
            let uncool = 0;
            for (const g of uncoolGrams) uncool = Math.max(uncool, dice(grams, g));
            return Math.max(0, Math.min(1, 0.5 + 0.5 * (cool - uncool)));
        }

        /** @param {number} syllableCount */
        function metricBrevity(syllableCount) {
            const table = config.brevityBySyllables;
            const index = Math.min(syllableCount, table.length) - 1;
            return table[index];
        }

        // ---- scoring ---------------------------------------------------------

        /** @param {string} word */
        function score(word) {
            const letters = clean(word);
            const tokens = tokenize(letters);
            const syllables = syllabify(tokens);
            const hasVowel = tokens.some((t, idx) => isVowel(t, idx));
            const syllableCount = hasVowel ? syllables.length : 1;

            /** @type {Record<string, number>} */
            const metrics = {
                pronounceability: metricPronounceability(syllables, hasVowel),
                flow: metricFlow(syllables, hasVowel),
                energy: metricEnergy(tokens),
                phonesthemes: metricPhonesthemes(letters),
                novelty: metricNovelty(tokens),
                anchors: metricAnchors(letters),
                brevity: metricBrevity(syllableCount)
            };
            for (const name of Object.keys(metrics)) {
                metrics[name] = roundPlaces(metrics[name], 4);
            }
            return {
                word: letters,
                total: totalFromMetrics(metrics, config.weights),
                syllables: syllableCount,
                tokens,
                metrics
            };
        }

        /**
         * @param {Record<string, number>} metrics
         * @param {Record<string, number>} weights
         */
        function totalFromMetrics(metrics, weights) {
            let weightSum = 0;
            let weighted = 0;
            for (const [name, weight] of Object.entries(weights)) {
                weightSum += weight;
                weighted += weight * metrics[name];
            }
            if (weightSum <= 0) return 0;
            return roundPlaces(100 * weighted / weightSum, 1);
        }

        return { score, totalFromMetrics, clean };
    }

    return { createScorer, roundPlaces };
})();

window.CoolnessScore = CoolnessScore;
