// @ts-check
//-----------------------------------------------------------------------
// WORD COOLNESS SCORER - browser mirror
// Exact port of the canonical Python engine (coolness.py); both read
// coolness-config.json and tests/test-coolness.js keeps them in lockstep
// against coolness-report.json. Any algorithm change must be made in
// both files. Metric definitions are documented in coolness.py.
//-----------------------------------------------------------------------

/**
 * @typedef {{ cool: Array<{ word: string, grams: Set<string> }>,
 *             uncool: Array<{ word: string, grams: Set<string> }> }} AnchorContext
 * @typedef {{ word: string, parts: string[], total: number, syllables: number,
 *             tokens: string[], metrics: Record<string, number> }} CoolnessResult
 */

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
        const sClusterStops = new Set(config.sonorityExceptions.sClusterStops);
        const codaAppendix = new Set(config.sonorityExceptions.codaAppendix);

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
            if (tokens.length >= 2 && tokens[tokens.length - 1] === 'e') {
                const flags = vowelFlags(tokens);
                const rest = tokens.slice(0, -1);
                const syllabicL = tokens.length >= 3 && tokens[tokens.length - 2] === 'l'
                    && !flags[flags.length - 3];
                if (!flags[flags.length - 2] && vowelFlags(rest).some(Boolean) && !syllabicL) {
                    return rest;
                }
            }
            return tokens;
        }

        /**
         * Which tokens are vowel sounds. y after the first sound is a vowel
         * (kyro); w closing a vowel before a consonant or the end is part of
         * that vowel (glow, brew, glowcode), not a coda.
         * @param {string[]} tokens @returns {boolean[]}
         */
        function vowelFlags(tokens) {
            /** @type {boolean[]} */
            const flags = [];
            tokens.forEach((token, i) => {
                if (vowels.has(token) || (token === 'y' && i > 0)) {
                    flags.push(true);
                } else if (token === 'w' && i > 0 && flags[i - 1]) {
                    flags.push(i + 1 === tokens.length || !vowels.has(tokens[i + 1]));
                } else {
                    flags.push(false);
                }
            });
            return flags;
        }

        // ---- syllabification ------------------------------------------

        /**
         * @param {string[]} tokens
         * @returns {Array<{ onset: string[], nucleus: string[], coda: string[] }>}
         */
        function syllabify(tokens) {
            const flags = vowelFlags(tokens);
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

        /**
         * Prebuilt { word, grams } entries for an anchor vocabulary
         * ({cool, uncool}). Persona formulas carry their own anchors;
         * mirrors coolness.py anchor_context().
         * @param {{ cool: string[], uncool: string[] }} anchors
         * @returns {AnchorContext}
         */
        function anchorContext(anchors) {
            const entries = (/** @type {string[]} */ words) =>
                words.map(w => ({ word: clean(w), grams: charBigrams(clean(w)) }));
            return { cool: entries(anchors.cool), uncool: entries(anchors.uncool) };
        }

        const defaultAnchorContext = anchorContext(config.anchors);

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
                    // English licenses s before a stop (spark, street)
                    // outside the sonority slope.
                    const sCluster = k === 0 && rising[k] === 's' && sClusterStops.has(rising[k + 1]);
                    if (sCluster || sonorityOf(rising[k]) <= sonorityOf(rising[k + 1])) good += 1;
                }
                const falling = syllable.nucleus.slice(-1).concat(syllable.coda);
                for (let k = 0; k < falling.length - 1; k++) {
                    transitions += 1;
                    // A coronal appendix after a coda consonant (flux,
                    // glints) is likewise licensed outside the slope.
                    const appendix = k > 0 && codaAppendix.has(falling[k + 1]);
                    if (appendix || sonorityOf(falling[k]) >= sonorityOf(falling[k + 1])) good += 1;
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

        /**
         * Leave-one-out: a listed word is judged by how it sounds like the
         * OTHER anchors, never by matching itself.
         * @param {string} letters
         * @param {AnchorContext} context
         */
        function metricAnchors(letters, context) {
            const grams = charBigrams(letters);
            let cool = 0;
            for (const entry of context.cool) {
                if (entry.word !== letters) cool = Math.max(cool, dice(grams, entry.grams));
            }
            let uncool = 0;
            for (const entry of context.uncool) {
                if (entry.word !== letters) uncool = Math.max(uncool, dice(grams, entry.grams));
            }
            return Math.max(0, Math.min(1, 0.5 + 0.5 * (cool - uncool)));
        }

        /** @param {number} syllableCount */
        function metricBrevity(syllableCount) {
            const table = config.brevityBySyllables;
            const index = Math.min(syllableCount, table.length) - 1;
            return table[index];
        }

        // ---- scoring ---------------------------------------------------------

        /**
         * A hyphen marks a compound joint (vibe-code): each part keeps its
         * own spelling rules, so vibe's silent e stays silent.
         * @param {string} word @returns {string[]}
         */
        function partsOf(word) {
            return String(word).split('-').map(clean).filter(Boolean);
        }

        /** @param {string[]} parts @returns {string[]} */
        function tokenizeParts(parts) {
            /** @type {string[]} */
            const tokens = [];
            for (const part of parts) {
                let partTokens = tokenize(part);
                // A consonant doubled across the joint is still one sound.
                if (tokens.length && partTokens.length
                    && tokens[tokens.length - 1] === partTokens[0]
                    && !vowels.has(partTokens[0])) {
                    partTokens = partTokens.slice(1);
                }
                tokens.push(...partTokens);
            }
            return tokens;
        }

        /**
         * @param {string} word
         * @param {{ weights?: Record<string, number>, anchorContext?: AnchorContext }} [opts]
         * @returns {CoolnessResult}
         */
        function score(word, opts) {
            const parts = partsOf(word);
            const letters = parts.join('');
            const tokens = tokenizeParts(parts);
            const syllables = syllabify(tokens);
            const hasVowel = vowelFlags(tokens).some(Boolean);
            const syllableCount = hasVowel ? syllables.length : 1;

            /** @type {Record<string, number>} */
            const metrics = {
                pronounceability: metricPronounceability(syllables, hasVowel),
                flow: metricFlow(syllables, hasVowel),
                energy: metricEnergy(tokens),
                phonesthemes: metricPhonesthemes(letters),
                novelty: metricNovelty(tokens),
                anchors: metricAnchors(letters,
                    (opts && opts.anchorContext) || defaultAnchorContext),
                brevity: metricBrevity(syllableCount)
            };
            for (const name of Object.keys(metrics)) {
                metrics[name] = roundPlaces(metrics[name], 4);
            }
            return {
                word: letters,
                parts,
                total: totalFromMetrics(metrics, (opts && opts.weights) || config.weights),
                syllables: syllableCount,
                tokens,
                metrics
            };
        }

        /**
         * Illegal clusters scale the whole score down: a word nobody can
         * say is not cool, however its other traits average out.
         * @param {Record<string, number>} metrics
         */
        function legalityGate(metrics) {
            const floor = config.legalityFloor;
            return floor + (1 - floor) * metrics.pronounceability;
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
            return roundPlaces(100 * legalityGate(metrics) * weighted / weightSum, 1);
        }

        return { score, totalFromMetrics, legalityGate, anchorContext, clean, partsOf };
    }

    return { createScorer, roundPlaces };
})();

window.CoolnessScore = CoolnessScore;
